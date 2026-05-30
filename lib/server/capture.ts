import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { people, places, personPlace, placeTags, rawEntries } from '@/lib/db/schema';
import type { Place } from '@/lib/db/schema';
import { parseCapture } from './parse';
import { geocodePlace } from './geocode';
import type { AppliedChange, CaptureResult, CaptureSource, PendingDelete } from '@/lib/types';

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function upsertPerson(name: string): Promise<string> {
  const [row] = await db
    .insert(people)
    .values({ name: name.trim(), nameNormalized: normalizeName(name) })
    .onConflictDoUpdate({ target: people.nameNormalized, set: { name: name.trim() } })
    .returning({ id: people.id });
  return row.id;
}

async function findPersonId(name: string): Promise<string | null> {
  const rows = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.nameNormalized, normalizeName(name)))
    .limit(1);
  return rows[0]?.id ?? null;
}

// Cache-first place resolution: one geocode per distinct place string, stored
// forever (keeps Mapbox Permanent geocoding at cents/year).
async function resolvePlace(query: string): Promise<Place | null> {
  const qn = normalizeQuery(query);
  if (!qn) return null;

  const cached = await db.select().from(places).where(eq(places.queryNormalized, qn)).limit(1);
  if (cached[0]) return cached[0];

  const geo = await geocodePlace(query);
  if (!geo) return null;

  const [row] = await db
    .insert(places)
    .values({
      queryNormalized: qn,
      name: geo.name,
      lat: geo.lat,
      lng: geo.lng,
      placeType: geo.placeType,
      countryCode: geo.countryCode,
      countryName: geo.countryName,
      regionCode: geo.regionCode,
      regionName: geo.regionName,
      districtName: geo.districtName,
      placeName: geo.placeName,
      neighborhoodName: geo.neighborhoodName,
      provider: geo.provider,
      providerId: geo.providerId,
    })
    .onConflictDoUpdate({ target: places.queryNormalized, set: { name: geo.name } })
    .returning();
  return row;
}

/**
 * The whole capture flow. Raw text is stored first (immutable source of truth).
 * add/move ops are applied immediately; remove ops are resolved to concrete
 * targets and returned as pendingDeletes for the user to confirm (never
 * auto-deleted).
 */
export async function runCapture(text: string, source: CaptureSource = 'text'): Promise<CaptureResult> {
  const body = text.trim();
  const [raw] = await db.insert(rawEntries).values({ body, source }).returning({ id: rawEntries.id });

  const { ops, usedLLM, modelId } = await parseCapture(body);

  const applied: AppliedChange[] = [];
  const pendingDeletes: PendingDelete[] = [];
  const issues: string[] = [];

  for (const op of ops) {
    // --- ADD -----------------------------------------------------------------
    if (op.op === 'add') {
      // Resolve the place first — don't create an orphan person if it fails.
      const place = await resolvePlace(op.place);
      if (!place) {
        issues.push(`Couldn't find "${op.place}" for ${op.name}`);
        continue;
      }
      const personId = await upsertPerson(op.name);
      await db
        .insert(personPlace)
        .values({
          personId,
          placeId: place.id,
          relationship: op.relationship,
          rawEntryId: raw.id,
          confidence: op.confidence,
          modelId,
        })
        .onConflictDoNothing({
          target: [personPlace.personId, personPlace.placeId, personPlace.relationship],
        });
      applied.push({
        op: 'add',
        name: op.name,
        relationship: op.relationship,
        place: op.place,
        placeName: place.name,
        geocoded: true,
        was: null,
      });
      continue;
    }

    // --- MOVE (replace the person's links of this relationship) --------------
    if (op.op === 'move') {
      // Resolve the place first — don't create the person or delete the old
      // value if the new place can't be resolved.
      const place = await resolvePlace(op.place);
      if (!place) {
        issues.push(`Couldn't find "${op.place}" — left ${op.name} unchanged`);
        continue;
      }
      const personId = await upsertPerson(op.name);
      const oldLinks = await db
        .select({ name: places.name })
        .from(personPlace)
        .innerJoin(places, eq(personPlace.placeId, places.id))
        .where(and(eq(personPlace.personId, personId), eq(personPlace.relationship, op.relationship)));
      const was = oldLinks
        .map((l) => l.name)
        .filter((n) => n.toLowerCase() !== place.name.toLowerCase());

      await db
        .delete(personPlace)
        .where(and(eq(personPlace.personId, personId), eq(personPlace.relationship, op.relationship)));
      await db.insert(personPlace).values({
        personId,
        placeId: place.id,
        relationship: op.relationship,
        rawEntryId: raw.id,
        confidence: op.confidence,
        modelId,
      });

      applied.push({
        op: 'move',
        name: op.name,
        relationship: op.relationship,
        place: op.place,
        placeName: place.name,
        geocoded: true,
        was: was.length ? was.join(', ') : null,
      });
      continue;
    }

    // --- REMOVE (resolve target, queue for confirmation) ---------------------
    if (op.op === 'remove') {
      const personId = await findPersonId(op.name);
      if (!personId) {
        issues.push(`Couldn't find "${op.name}" to remove`);
        continue;
      }

      if (op.place) {
        const links = await db
          .select({ id: personPlace.id, placeName: places.name })
          .from(personPlace)
          .innerJoin(places, eq(personPlace.placeId, places.id))
          .where(eq(personPlace.personId, personId));
        const q = op.place.toLowerCase();
        const matched = links.filter(
          (l) => l.placeName.toLowerCase().includes(q) || q.includes(l.placeName.toLowerCase()),
        );
        if (!matched.length) {
          issues.push(`${op.name} has no place matching "${op.place}" to remove`);
          continue;
        }
        const names = Array.from(new Set(matched.map((m) => m.placeName))).join(', ');
        pendingDeletes.push({
          token: randomUUID(),
          personId,
          linkIds: matched.map((m) => m.id),
          deletePerson: false,
          label: `Remove ${op.name} from ${names} (${matched.length} ${matched.length === 1 ? 'place' : 'places'})`,
        });
      } else {
        const links = await db
          .select({ id: personPlace.id })
          .from(personPlace)
          .where(eq(personPlace.personId, personId));
        pendingDeletes.push({
          token: randomUUID(),
          personId,
          linkIds: links.map((l) => l.id),
          deletePerson: true,
          label: `Remove ${op.name} entirely (${links.length} ${links.length === 1 ? 'place' : 'places'})`,
        });
      }
    }
  }

  return { rawEntryId: raw.id, applied, pendingDeletes, issues, usedLLM, modelId };
}

/**
 * Direct, non-LLM add: attach a named person to an EXISTING place with a given
 * relationship. Used by the place panel's "add a name here" — the place is
 * already geocoded, so no parse and no geocode needed.
 */
export async function addLink(
  placeId: string,
  name: string,
  relationship: string,
): Promise<{ ok: boolean }> {
  const personId = await upsertPerson(name);
  await db
    .insert(personPlace)
    .values({ personId, placeId, relationship })
    .onConflictDoNothing({
      target: [personPlace.personId, personPlace.placeId, personPlace.relationship],
    });
  return { ok: true };
}

/**
 * Rename a person IN PLACE (by id) — updates the single people row, so the new
 * name shows everywhere that person is linked. Never creates a new row. If the
 * new name already belongs to a DIFFERENT person, we refuse rather than silently
 * merging two people (returns ok:false with the conflicting name).
 */
export async function renamePerson(
  personId: string,
  newName: string,
): Promise<{ ok: boolean; conflictName?: string }> {
  const name = newName.trim();
  if (!name) return { ok: false };
  const norm = normalizeName(name);

  const existing = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.nameNormalized, norm))
    .limit(1);
  if (existing[0] && existing[0].id !== personId) {
    return { ok: false, conflictName: existing[0].name };
  }

  await db.update(people).set({ name, nameNormalized: norm }).where(eq(people.id, personId));
  return { ok: true };
}

/** Add or remove a free-form tag on a place. */
export async function setPlaceTag(
  placeId: string,
  tag: string,
  remove: boolean,
): Promise<{ ok: boolean }> {
  const t = tag.trim();
  if (!t) return { ok: false };
  if (remove) {
    await db.delete(placeTags).where(and(eq(placeTags.placeId, placeId), eq(placeTags.tag, t)));
  } else {
    await db
      .insert(placeTags)
      .values({ placeId, tag: t })
      .onConflictDoNothing({ target: [placeTags.placeId, placeTags.tag] });
  }
  return { ok: true };
}

/** Apply confirmed deletes. Returns number of person_place rows removed. */
export async function applyDeletes(
  deletes: { personId: string; linkIds: string[]; deletePerson: boolean }[],
): Promise<{ removedPeople: number; removedLinks: number }> {
  let removedPeople = 0;
  let removedLinks = 0;

  for (const d of deletes) {
    if (d.deletePerson) {
      const res = await db.delete(people).where(eq(people.id, d.personId)).returning({ id: people.id });
      removedPeople += res.length; // links cascade
    } else if (d.linkIds.length) {
      // Scope to the person for safety, and delete each link by id.
      for (const linkId of d.linkIds) {
        const res = await db
          .delete(personPlace)
          .where(and(eq(personPlace.id, linkId), eq(personPlace.personId, d.personId)))
          .returning({ id: personPlace.id });
        removedLinks += res.length;
      }
    }
  }
  return { removedPeople, removedLinks };
}

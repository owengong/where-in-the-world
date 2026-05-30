// Merge duplicate place rows that point at the SAME physical feature.
//
// Two captures of one spot via different phrasings ("Niseko" vs "Niseko, Japan")
// each created a places row because the cache key is the query string. The
// provider's feature id (provider + provider_id) is the true identity, so rows
// that share it are provably the same place and safe to merge.
//
// Safety: a JSON snapshot of every affected place/link/tag is written before any
// write, and all writes for a group run in one transaction. Read-only by
// default; pass --apply to execute.
//
//   tsx scripts/dedupe-places.ts          # dry run (prints the plan)
//   tsx scripts/dedupe-places.ts --apply  # perform the merge
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { places, personPlace, placeTags } from '../lib/db/schema';

const APPLY = process.argv.includes('--apply');

type PlaceRow = typeof places.$inferSelect;

// Canonical = the row that keeps everyone. Prefer the one with the most links,
// then the shortest query string (usually the bare name), then the oldest.
function pickCanonical(group: PlaceRow[], linkCount: Map<string, number>): PlaceRow {
  return [...group].sort((a, b) => {
    const dl = (linkCount.get(b.id) ?? 0) - (linkCount.get(a.id) ?? 0);
    if (dl) return dl;
    const dq = a.queryNormalized.length - b.queryNormalized.length;
    if (dq) return dq;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

async function main() {
  const placeRows = await db.select().from(places);
  const links = await db.select().from(personPlace);
  const tags = await db.select().from(placeTags);

  const linkCount = new Map<string, number>();
  for (const l of links) linkCount.set(l.placeId, (linkCount.get(l.placeId) ?? 0) + 1);

  // Group by stable provider feature id.
  const groups = new Map<string, PlaceRow[]>();
  for (const p of placeRows) {
    if (!p.providerId) continue;
    const k = `${p.provider}:${p.providerId}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);

  console.log(`places=${placeRows.length}  duplicate groups=${dupes.length}  mode=${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (dupes.length === 0) {
    console.log('Nothing to merge.');
    await db.$client.end();
    return;
  }

  // Snapshot everything we might touch, BEFORE writing.
  const affectedIds = new Set(dupes.flat().map((p) => p.id));
  const snapshot = {
    takenAt: new Date().toISOString(),
    places: placeRows.filter((p) => affectedIds.has(p.id)),
    links: links.filter((l) => affectedIds.has(l.placeId)),
    tags: tags.filter((t) => affectedIds.has(t.placeId)),
  };
  const backupPath = `scripts/dedupe-backup-${Date.now()}.json`;
  writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot of ${affectedIds.size} affected places written to ${backupPath}\n`);

  let removedPlaces = 0;
  let movedLinks = 0;
  let droppedDupLinks = 0;
  let movedTags = 0;

  for (const group of dupes) {
    const canonical = pickCanonical(group, linkCount);
    const orphans = group.filter((p) => p.id !== canonical.id);
    console.log(`• ${canonical.name} (${canonical.provider}/${canonical.providerId})`);
    console.log(`    keep   ${canonical.id.slice(0, 8)} q="${canonical.queryNormalized}"`);
    for (const o of orphans) {
      console.log(`    merge  ${o.id.slice(0, 8)} q="${o.queryNormalized}" (links=${linkCount.get(o.id) ?? 0})`);
    }
    if (!APPLY) continue;

    await db.transaction(async (tx) => {
      // Which (person, relationship) pairs does the canonical already hold?
      const canonLinks = await tx
        .select({ personId: personPlace.personId, relationship: personPlace.relationship })
        .from(personPlace)
        .where(eq(personPlace.placeId, canonical.id));
      const held = new Set(canonLinks.map((l) => `${l.personId}|${l.relationship}`));

      for (const o of orphans) {
        const orphanLinks = await tx.select().from(personPlace).where(eq(personPlace.placeId, o.id));
        for (const l of orphanLinks) {
          const key = `${l.personId}|${l.relationship}`;
          if (held.has(key)) {
            // Canonical already has this exact link — drop the duplicate.
            await tx.delete(personPlace).where(eq(personPlace.id, l.id));
            droppedDupLinks++;
          } else {
            await tx.update(personPlace).set({ placeId: canonical.id }).where(eq(personPlace.id, l.id));
            held.add(key);
            movedLinks++;
          }
        }

        // Preserve tags: copy onto the canonical (ignore ones it already has),
        // then the orphan's own tag rows cascade away with the place delete.
        const orphanTags = await tx.select().from(placeTags).where(eq(placeTags.placeId, o.id));
        for (const t of orphanTags) {
          const res = await tx
            .insert(placeTags)
            .values({ placeId: canonical.id, tag: t.tag })
            .onConflictDoNothing({ target: [placeTags.placeId, placeTags.tag] })
            .returning({ id: placeTags.id });
          if (res.length) movedTags++;
        }

        await tx.delete(places).where(eq(places.id, o.id));
        removedPlaces++;
      }
    });
  }

  if (APPLY) {
    const after = await db.select().from(places);
    console.log(
      `\nDone. removed ${removedPlaces} places, moved ${movedLinks} links, ` +
        `dropped ${droppedDupLinks} duplicate links, moved ${movedTags} tags. ` +
        `places ${placeRows.length} -> ${after.length}. Backup: ${backupPath}`,
    );
  } else {
    console.log(`\nDry run only — re-run with --apply to merge. Backup will be written then.`);
  }

  await db.$client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

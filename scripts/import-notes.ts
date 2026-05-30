import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
// Relative imports — tsx doesn't resolve "@/..." aliases. geocode.ts is
// self-contained (no alias imports), so this works.
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { people, places, personPlace, placeTags, rawEntries } from '../lib/db/schema';
import { geocodePlace } from '../lib/server/geocode';

type Fact = { person: string; place: string; relationship: string };
type Owen = { place: string; relationship: string };
type Tag = { place: string; tag: string };
type Data = { facts: Fact[]; owen: Owen[]; tags: Tag[] };

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const normQuery = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

async function pool<T>(items: T[], size: number, fn: (item: T, i: number) => Promise<void>) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const data: Data = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'scripts', 'import-data.json'), 'utf8'),
  );
  console.log(`Loaded ${data.facts.length} facts, ${data.owen.length} owen places, ${data.tags.length} tags`);

  // 1. RESET
  await db.execute(
    sql`TRUNCATE person_place, place_tags, people, places, raw_entries RESTART IDENTITY CASCADE`,
  );
  console.log('Reset all tables.');

  // 2. Distinct places across facts/owen/tags
  const placeByNorm = new Map<string, string>(); // norm -> original (first seen)
  const addPlace = (p: string) => {
    const n = normQuery(p);
    if (n && !placeByNorm.has(n)) placeByNorm.set(n, p.trim());
  };
  data.facts.forEach((f) => addPlace(f.place));
  data.owen.forEach((o) => addPlace(o.place));
  data.tags.forEach((t) => addPlace(t.place));
  const distinct = Array.from(placeByNorm.entries()); // [norm, original]
  console.log(`Geocoding ${distinct.length} distinct places...`);

  // 3. Geocode + insert places (concurrent)
  const placeIdByNorm = new Map<string, string | null>();
  const failures: string[] = [];
  let done = 0;
  await pool(distinct, 6, async ([norm, original]) => {
    try {
      const geo = await geocodePlace(original);
      if (!geo) {
        placeIdByNorm.set(norm, null);
        failures.push(original);
      } else {
        const [row] = await db
          .insert(places)
          .values({
            queryNormalized: norm,
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
          .returning({ id: places.id });
        placeIdByNorm.set(norm, row.id);
      }
    } catch (e) {
      placeIdByNorm.set(norm, null);
      failures.push(original);
    }
    done++;
    if (done % 25 === 0) console.log(`  geocoded ${done}/${distinct.length}`);
  });
  const geocoded = distinct.length - failures.length;

  // 4. People (distinct from facts) + Owen Gong
  const personByNorm = new Map<string, string>();
  const personNames = new Map<string, string>(); // norm -> display
  data.facts.forEach((f) => {
    const n = normName(f.person);
    if (n && !personNames.has(n)) personNames.set(n, f.person.trim());
  });
  personNames.set(normName('Owen Gong'), 'Owen Gong');
  for (const [n, display] of Array.from(personNames)) {
    const [row] = await db
      .insert(people)
      .values({ name: display, nameNormalized: n })
      .onConflictDoUpdate({ target: people.nameNormalized, set: { name: display } })
      .returning({ id: people.id });
    personByNorm.set(n, row.id);
  }
  const owenId = personByNorm.get(normName('Owen Gong'))!;

  // 5. person_place links (facts)
  let links = 0;
  for (const f of data.facts) {
    const pid = personByNorm.get(normName(f.person));
    const plid = placeIdByNorm.get(normQuery(f.place));
    if (!pid || !plid) continue;
    const res = await db
      .insert(personPlace)
      .values({ personId: pid, placeId: plid, relationship: f.relationship })
      .onConflictDoNothing({ target: [personPlace.personId, personPlace.placeId, personPlace.relationship] })
      .returning({ id: personPlace.id });
    links += res.length;
  }

  // 6. Owen's places (visited beats wishlist for the same place)
  const owenRel = new Map<string, string>(); // placeNorm -> rel
  for (const o of data.owen) {
    const n = normQuery(o.place);
    const prev = owenRel.get(n);
    if (prev === 'visited') continue;
    owenRel.set(n, o.relationship === 'visited' ? 'visited' : prev || o.relationship);
  }
  let owenLinks = 0;
  for (const [n, rel] of Array.from(owenRel)) {
    const plid = placeIdByNorm.get(n);
    if (!plid) continue;
    const res = await db
      .insert(personPlace)
      .values({ personId: owenId, placeId: plid, relationship: rel })
      .onConflictDoNothing({ target: [personPlace.personId, personPlace.placeId, personPlace.relationship] })
      .returning({ id: personPlace.id });
    owenLinks += res.length;
  }

  // 7. place tags
  let tagCount = 0;
  for (const t of data.tags) {
    const plid = placeIdByNorm.get(normQuery(t.place));
    if (!plid) continue;
    const res = await db
      .insert(placeTags)
      .values({ placeId: plid, tag: t.tag.trim().toLowerCase() })
      .onConflictDoNothing({ target: [placeTags.placeId, placeTags.tag] })
      .returning({ id: placeTags.id });
    tagCount += res.length;
  }

  console.log('');
  console.log('=== IMPORT COMPLETE ===');
  console.log(`people:        ${personByNorm.size} (incl. Owen Gong)`);
  console.log(`places:        ${geocoded} geocoded, ${failures.length} failed`);
  console.log(`friend links:  ${links}`);
  console.log(`owen places:   ${owenLinks}`);
  console.log(`place tags:    ${tagCount}`);
  if (failures.length) console.log(`\nNOT geocoded (skipped):\n  ${failures.join('\n  ')}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Import failed:', e);
  process.exit(1);
});

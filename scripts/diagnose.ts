// READ-ONLY diagnostic. Confirms bug 1 (country people-count double-count) and
// enumerates bug 3 (duplicate place rows). Makes NO writes. Run: tsx scripts/diagnose.ts
import 'dotenv/config';
import { db } from '../lib/db';
import { places, personPlace, people } from '../lib/db/schema';

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

async function main() {
  const placeRows = await db.select().from(places);
  const links = await db.select().from(personPlace);
  const peopleRows = await db.select().from(people);

  console.log(`\n=== TOTALS ===`);
  console.log(`places=${placeRows.length}  people=${peopleRows.length}  person_place links=${links.length}`);

  // --- BUG 3: duplicate places ---------------------------------------------
  const byProvider = new Map<string, typeof placeRows>();
  const byName = new Map<string, typeof placeRows>();
  const byCoord = new Map<string, typeof placeRows>();
  for (const p of placeRows) {
    if (p.providerId) {
      const k = `${p.provider}:${p.providerId}`;
      (byProvider.get(k) ?? byProvider.set(k, []).get(k)!).push(p);
    }
    const nk = `${norm(p.name)}|${norm(p.countryName ?? '')}|${norm(p.regionName ?? '')}`;
    (byName.get(nk) ?? byName.set(nk, []).get(nk)!).push(p);
    const ck = `${round(p.lat)},${round(p.lng)}`;
    (byCoord.get(ck) ?? byCoord.set(ck, []).get(ck)!).push(p);
  }

  const linkCount = new Map<string, number>();
  for (const l of links) linkCount.set(l.placeId, (linkCount.get(l.placeId) ?? 0) + 1);

  const dump = (label: string, m: Map<string, typeof placeRows>) => {
    const dups = [...m.entries()].filter(([, v]) => v.length > 1);
    console.log(`\n=== BUG 3 dupes by ${label}: ${dups.length} group(s) ===`);
    for (const [k, v] of dups) {
      console.log(`  [${k}]`);
      for (const p of v) {
        console.log(
          `     ${p.id.slice(0, 8)}  "${p.name}" (${p.placeType ?? '?'}) q="${p.queryNormalized}" ` +
            `${round(p.lat)},${round(p.lng)} links=${linkCount.get(p.id) ?? 0} prov=${p.provider}/${p.providerId ?? '—'}`,
        );
      }
    }
    return dups.length;
  };
  dump('providerId', byProvider);
  dump('name+country+region', byName);
  dump('coord(~11m)', byCoord);

  // --- BUG 1: country people total (sum vs distinct) ------------------------
  const placeById = new Map(placeRows.map((p) => [p.id, p]));
  const peopleByCountry = new Map<string, Set<string>>(); // distinct personIds
  const sumByCountry = new Map<string, number>(); // current (buggy) sum-of-per-place-distinct
  const placePeople = new Map<string, Set<string>>();
  for (const l of links) {
    const set = placePeople.get(l.placeId) ?? placePeople.set(l.placeId, new Set()).get(l.placeId)!;
    set.add(l.personId);
  }
  for (const [placeId, set] of placePeople) {
    const country = placeById.get(placeId)?.countryName ?? '__other__';
    const c = peopleByCountry.get(country) ?? peopleByCountry.set(country, new Set()).get(country)!;
    set.forEach((id) => c.add(id));
    sumByCountry.set(country, (sumByCountry.get(country) ?? 0) + set.size);
  }
  console.log(`\n=== BUG 1: country ranking — current SUM vs correct DISTINCT ===`);
  const rows = [...peopleByCountry.keys()]
    .map((c) => ({ c, distinct: peopleByCountry.get(c)!.size, sum: sumByCountry.get(c) ?? 0 }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, 15);
  for (const r of rows) {
    const flag = r.sum !== r.distinct ? `  <-- inflated by ${r.sum - r.distinct}` : '';
    console.log(`  ${r.c.padEnd(22)} sum=${String(r.sum).padStart(4)}  distinct=${String(r.distinct).padStart(4)}${flag}`);
  }

  await db.$client.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

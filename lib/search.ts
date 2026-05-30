// Framework-agnostic search + grouping over the already-loaded MapPlace[]. No
// React/Next imports (mirrors lib/types.ts) so a future native client can reuse
// it. All matching is synchronous and in-memory — the whole dataset is already
// on the client.
import type { MapPlace } from '@/lib/types';

export type SearchResult = {
  place: MapPlace;
  matchedPersonNames: string[];
  score: number;
};

export type PlaceGroup = {
  key: string;
  label: string;
  places: MapPlace[];
  /** DISTINCT people across all the group's places (a friend tied to 3 places in
   *  the country counts once) — NOT the sum of per-place counts. */
  personTotal: number;
};

/** Diacritic-fold + lowercase + trim so "sao paulo" matches "São Paulo". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function placeFields(place: MapPlace): string[] {
  return [
    place.name,
    place.countryName,
    place.countryCode,
    place.regionName,
    place.districtName,
    place.placeName,
    place.neighborhoodName,
    place.placeType,
    ...place.tags,
  ]
    .filter((x): x is string => !!x)
    .map(normalize);
}

// Best single-field bucket for one search term (0 if no field contains it).
function fieldScore(name: string, admin: string[], tags: string[], term: string): number {
  if (name === term) return 1000;
  if (name.startsWith(term)) return 800;
  if (name.includes(term)) return 600;
  if (admin.some((a) => a.includes(term))) return 400;
  if (tags.some((t) => t.includes(term))) return 300;
  return 0;
}

// Rank by the strongest field hit across the whole query AND each token, so a
// strong token (e.g. "francisco" in "francisco ca", or reversed "francisco san")
// isn't lost when the joined query never appears contiguously in one field.
// Falls back to the person tier, then a floor.
function scorePlace(place: MapPlace, q: string, tokens: string[], hasPersonMatch: boolean): number {
  const name = normalize(place.name);
  const admin = [
    place.countryName,
    place.regionName,
    place.districtName,
    place.placeName,
    place.neighborhoodName,
    place.countryCode,
  ]
    .filter((x): x is string => !!x)
    .map(normalize);
  const tags = place.tags.map(normalize);

  let best = fieldScore(name, admin, tags, q); // whole-query contiguous hit
  for (const t of tokens) {
    const b = fieldScore(name, admin, tags, t);
    if (b > best) best = b;
  }
  if (best === 0) best = hasPersonMatch ? 200 : 100;
  return best + Math.min(place.personCount, 50); // small popularity tiebreak
}

/**
 * Token-AND search across place fields + the names of people tied to each place.
 * A place is returned if EVERY whitespace token hits at least one of its fields
 * or one of its people. Person hits surface on the place row (a person in 3
 * places yields 3 rows) via matchedPersonNames — never a separate person row.
 * Empty query returns all places ranked by personCount (the "most connected"
 * default list the palette shows before you type).
 */
export function searchPlaces(places: MapPlace[], query: string): SearchResult[] {
  const q = normalize(query);
  if (!q) {
    return [...places]
      .sort((a, b) => b.personCount - a.personCount || a.name.localeCompare(b.name))
      .map((place) => ({ place, matchedPersonNames: [], score: place.personCount }));
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const out: SearchResult[] = [];

  for (const place of places) {
    const fields = placeFields(place);
    const people = place.people.map((p) => ({ name: p.name, norm: normalize(p.name) }));
    const matched = new Set<string>();

    const everyToken = tokens.every((t) => {
      const inFields = fields.some((f) => f.includes(t));
      let inPerson = false;
      for (const p of people) {
        if (p.norm.includes(t)) {
          inPerson = true;
          if (!inFields) matched.add(p.name); // only attribute when a field didn't already explain it
        }
      }
      return inFields || inPerson;
    });
    if (!everyToken) continue;

    out.push({
      place,
      matchedPersonNames: Array.from(matched),
      score: scorePlace(place, q, tokens, matched.size > 0),
    });
  }

  out.sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));
  return out;
}

/** Group places by country for the browse drawer's default (unfiltered) view. */
export function groupByCountry(places: MapPlace[]): PlaceGroup[] {
  const byKey = new Map<string, MapPlace[]>();
  for (const p of places) {
    const key = p.countryName ?? '__other__';
    const list = byKey.get(key);
    if (list) list.push(p);
    else byKey.set(key, [p]);
  }

  const groups: PlaceGroup[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => b.personCount - a.personCount || a.name.localeCompare(b.name));
    // Distinct people across the whole country — summing per-place counts would
    // double-count anyone tied to several places in it (e.g. one friend with a
    // 20-city Italy wishlist would read as "20 people in Italy").
    const ids = new Set<string>();
    for (const p of list) for (const link of p.people) ids.add(link.personId);
    groups.push({
      key,
      label: key === '__other__' ? 'Other / regions' : key,
      places: list,
      personTotal: ids.size,
    });
  }

  groups.sort((a, b) => {
    if (a.key === '__other__') return 1;
    if (b.key === '__other__') return -1;
    return b.personTotal - a.personTotal || a.label.localeCompare(b.label);
  });
  return groups;
}

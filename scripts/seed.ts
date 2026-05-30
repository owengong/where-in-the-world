import 'dotenv/config';
// Relative imports (not "@/..."): this runs under tsx, which doesn't resolve
// tsconfig path aliases.
import { db } from '../lib/db';
import { people, places, personPlace } from '../lib/db/schema';

// Sample friends so the map isn't empty on first run. Coordinates are hardcoded
// so seeding needs no API keys or network (no geocoding). Includes a Brooklyn
// cluster + nearby NYC so you can watch the zoom-collapse behavior.
type Seed = {
  name: string;
  place: string;
  rel: 'lives' | 'from' | 'family' | 'visited' | 'wishlist';
  lat: number;
  lng: number;
  type: string;
};

const SEEDS: Seed[] = [
  { name: 'Ada', place: 'Brooklyn', rel: 'lives', lat: 40.6782, lng: -73.9442, type: 'neighborhood' },
  { name: 'Theo', place: 'Brooklyn', rel: 'lives', lat: 40.6782, lng: -73.9442, type: 'neighborhood' },
  { name: 'Mira', place: 'Brooklyn', rel: 'lives', lat: 40.6782, lng: -73.9442, type: 'neighborhood' },
  { name: 'Kai', place: 'Brooklyn', rel: 'lives', lat: 40.6782, lng: -73.9442, type: 'neighborhood' },
  { name: 'Remy', place: 'New York City', rel: 'lives', lat: 40.7128, lng: -74.006, type: 'place' },
  { name: 'Remy', place: 'Seoul', rel: 'from', lat: 37.5665, lng: 126.978, type: 'place' },
  { name: 'Noor', place: 'Lisbon', rel: 'visited', lat: 38.7223, lng: -9.1393, type: 'place' },
  { name: 'Iris', place: 'Mexico City', rel: 'lives', lat: 19.4326, lng: -99.1332, type: 'place' },
  { name: 'Lena', place: 'Nairobi', rel: 'family', lat: -1.2921, lng: 36.8219, type: 'place' },
  { name: 'Hugo', place: 'Reykjavik', rel: 'wishlist', lat: 64.1466, lng: -21.9426, type: 'place' },
  { name: 'Wren', place: 'Tokyo', rel: 'lives', lat: 35.6762, lng: 139.6503, type: 'place' },
  { name: 'Esme', place: 'San Francisco', rel: 'lives', lat: 37.7749, lng: -122.4194, type: 'place' },
  { name: 'Sol', place: 'London', rel: 'lives', lat: 51.5074, lng: -0.1278, type: 'place' },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  console.log('Seeding sample friends...');

  for (const s of SEEDS) {
    const [person] = await db
      .insert(people)
      .values({ name: s.name, nameNormalized: norm(s.name) })
      .onConflictDoUpdate({ target: people.nameNormalized, set: { name: s.name } })
      .returning({ id: people.id });

    const [place] = await db
      .insert(places)
      .values({
        queryNormalized: norm(s.place),
        name: s.place,
        lat: s.lat,
        lng: s.lng,
        placeType: s.type,
        provider: 'nominatim',
      })
      .onConflictDoUpdate({ target: places.queryNormalized, set: { name: s.place } })
      .returning({ id: places.id });

    await db
      .insert(personPlace)
      .values({ personId: person.id, placeId: place.id, relationship: s.rel, confidence: 1 })
      .onConflictDoNothing({
        target: [personPlace.personId, personPlace.placeId, personPlace.relationship],
      });
  }

  console.log(`Done — seeded ${SEEDS.length} connections.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});

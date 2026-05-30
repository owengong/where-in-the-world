import {
  pgTable,
  uuid,
  text,
  boolean,
  real,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// raw_entries — the immutable source of truth. Exactly what the user typed or
// spoke, kept forever. Everything else is a re-derivable projection on top of
// this. (Append-only is enforced by convention for now; a DB-level REVOKE /
// trigger comes with the re-derivation work in a later phase.)
// ---------------------------------------------------------------------------
export const rawEntries = pgTable('raw_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  body: text('body').notNull(),
  source: text('source').notNull().default('text'), // 'text' | 'paste' | 'voice'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// people — deduped by a normalized name.
// ---------------------------------------------------------------------------
export const people = pgTable(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    isStarred: boolean('is_starred').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('people_name_normalized_idx').on(t.nameNormalized)],
);

// ---------------------------------------------------------------------------
// places — a single POINT (lat/lng) plus the admin hierarchy from geocoding.
// No polygons: per-region counts come from grouping on these fields, and the
// zoom-collapse bubbles come from client-side clustering over the points.
// Provider-neutral columns (not raw Mapbox/OSM blobs) so a provider swap or a
// native client isn't locked in. Cached by the normalized query string.
// ---------------------------------------------------------------------------
export const places = pgTable(
  'places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queryNormalized: text('query_normalized').notNull(), // cache key: the string we geocoded
    name: text('name').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    placeType: text('place_type'), // country | region | place | district | neighborhood | poi
    countryCode: text('country_code'),
    countryName: text('country_name'),
    regionCode: text('region_code'), // e.g. US-NY
    regionName: text('region_name'),
    districtName: text('district_name'),
    placeName: text('place_name'),
    neighborhoodName: text('neighborhood_name'),
    provider: text('provider').notNull().default('nominatim'),
    providerId: text('provider_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('places_query_normalized_idx').on(t.queryNormalized)],
);

// ---------------------------------------------------------------------------
// person_place — the many-to-many with a typed relationship. This is the fix
// for the old "one home per person" limitation: "from Korea, lives in NYC,
// family in Naples" is just three rows. Carries provenance (raw_entry_id) +
// confidence + model so it can evolve toward full re-derivation later.
// ---------------------------------------------------------------------------
export const personPlace = pgTable(
  'person_place',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
    relationship: text('relationship').notNull(), // lives | from | family | visited | wishlist
    rawEntryId: uuid('raw_entry_id').references(() => rawEntries.id, { onDelete: 'set null' }),
    confidence: real('confidence'),
    modelId: text('model_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('person_place_uniq').on(t.personId, t.placeId, t.relationship),
    index('person_place_place_idx').on(t.placeId),
  ],
);

// ---------------------------------------------------------------------------
// place_tags — free-form labels on a place (e.g. "money capital", "ski resort",
// "holy site"). Separate from person relationships; a place can have any number.
// ---------------------------------------------------------------------------
export const placeTags = pgTable(
  'place_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('place_tags_uniq').on(t.placeId, t.tag)],
);

export type Place = typeof places.$inferSelect;
export type Person = typeof people.$inferSelect;
export type RawEntry = typeof rawEntries.$inferSelect;
export type PersonPlace = typeof personPlace.$inferSelect;

// Framework-agnostic domain types. Kept free of React/Next/Mapbox imports on
// purpose: a future Expo (React Native) client imports this same file. Anything
// that should be shareable across web + native lives here or in lib/api-client.ts.

export const RELATIONSHIPS = ['lives', 'from', 'family', 'visited', 'wishlist'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/** Relationships that mean "a friend is anchored here" — drives the green pin color. */
export const RESIDENT_RELATIONSHIPS: readonly Relationship[] = ['lives', 'from', 'family'];

/** A place's pin category. Highest rank wins when a place/cluster mixes categories. */
export type PlaceCategory = 'resident' | 'visited' | 'wishlist';
export const CATEGORY_RANK: Record<PlaceCategory, number> = { resident: 2, visited: 1, wishlist: 0 };

export function isRelationship(value: unknown): value is Relationship {
  return typeof value === 'string' && (RELATIONSHIPS as readonly string[]).includes(value);
}

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  lives: 'lives in',
  from: 'from',
  family: 'family in',
  visited: 'visited',
  wishlist: 'wants to visit',
};

/** One person ↔ place link, as shown in a place's detail panel. */
export type PersonLink = {
  linkId: string; // person_place row id — lets the UI remove this exact link
  personId: string;
  name: string;
  relationship: Relationship;
};

/** A place with everyone tied to it — the unit the map renders as a pin/cluster. */
export type MapPlace = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  placeType: string | null;
  /** distinct people tied to this place — the number shown in the bubble */
  personCount: number;
  /** pin color category — resident (green) > visited (blue) > wishlist (yellow) */
  category: PlaceCategory;
  /** free-form labels on the place (e.g. "ski resort", "holy site") */
  tags: string[];
  people: PersonLink[];
};

// A capture can add, move, or remove. add/move apply immediately; remove is
// gated behind user confirmation (destructive).
export const CAPTURE_OPS = ['add', 'move', 'remove'] as const;
export type CaptureOp = (typeof CAPTURE_OPS)[number];
export function isCaptureOp(v: unknown): v is CaptureOp {
  return typeof v === 'string' && (CAPTURE_OPS as readonly string[]).includes(v);
}

/** One operation the parser extracts from raw text, before geocoding. */
export type ParsedOp = {
  op: CaptureOp;
  name: string;
  place: string; // "" for "remove the whole person"
  relationship: Relationship;
  confidence: number;
};

/** An add/move that was applied immediately. */
export type AppliedChange = {
  op: 'add' | 'move';
  name: string;
  relationship: Relationship;
  place: string; // as typed
  placeName: string | null; // geocoded display name
  geocoded: boolean;
  was: string | null; // previous place(s) replaced by a move
};

/** A delete awaiting confirmation — never auto-applied. */
export type PendingDelete = {
  token: string;
  label: string; // "Remove Ada entirely (3 places)" / "Remove Ada's Lisbon"
  personId: string;
  linkIds: string[];
  deletePerson: boolean;
};

/** Confirmed delete sent to POST /api/delete. */
export type DeleteOp = {
  personId: string;
  linkIds: string[];
  deletePerson: boolean;
};

/** Response from POST /api/capture. */
export type CaptureResult = {
  rawEntryId: string;
  applied: AppliedChange[];
  pendingDeletes: PendingDelete[];
  issues: string[]; // e.g. "Couldn't find 'Bob' to remove"
  /** true if Claude parsed it, false if the built-in quick parser did */
  usedLLM: boolean;
  modelId: string | null;
};

export type CaptureSource = 'text' | 'paste' | 'voice';

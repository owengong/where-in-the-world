import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { people, places, personPlace, placeTags } from '@/lib/db/schema';
import {
  RESIDENT_RELATIONSHIPS,
  isRelationship,
  type MapPlace,
  type PersonLink,
  type PlaceCategory,
} from '@/lib/types';

type Acc = Omit<MapPlace, 'personCount' | 'category' | 'tags'> & {
  _ids: Set<string>;
  _resident: boolean;
  _visited: boolean;
};

/**
 * Every place with the people tied to it — the shape the map renders. One row
 * per place; `personCount` is distinct people (the bubble number), `category`
 * is the highest tier present (resident > visited > wishlist) and drives color.
 */
export async function getMapPlaces(): Promise<MapPlace[]> {
  const rows = await db
    .select({
      placeId: places.id,
      name: places.name,
      lat: places.lat,
      lng: places.lng,
      placeType: places.placeType,
      linkId: personPlace.id,
      personId: people.id,
      personName: people.name,
      relationship: personPlace.relationship,
    })
    .from(personPlace)
    .innerJoin(places, eq(personPlace.placeId, places.id))
    .innerJoin(people, eq(personPlace.personId, people.id));

  const byPlace = new Map<string, Acc>();

  for (const r of rows) {
    if (!isRelationship(r.relationship)) continue;

    let place = byPlace.get(r.placeId);
    if (!place) {
      place = {
        placeId: r.placeId,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        placeType: r.placeType,
        people: [],
        _ids: new Set<string>(),
        _resident: false,
        _visited: false,
      };
      byPlace.set(r.placeId, place);
    }

    const link: PersonLink = {
      linkId: r.linkId,
      personId: r.personId,
      name: r.personName,
      relationship: r.relationship,
    };
    place.people.push(link);
    place._ids.add(r.personId);
    if (RESIDENT_RELATIONSHIPS.includes(r.relationship)) place._resident = true;
    else if (r.relationship === 'visited') place._visited = true;
  }

  // Attach tags (separate query to avoid fanning out the person join).
  const tagRows = await db.select({ placeId: placeTags.placeId, tag: placeTags.tag }).from(placeTags);
  const tagsByPlace = new Map<string, string[]>();
  for (const r of tagRows) {
    const list = tagsByPlace.get(r.placeId) ?? [];
    list.push(r.tag);
    tagsByPlace.set(r.placeId, list);
  }

  return Array.from(byPlace.values()).map(({ _ids, _resident, _visited, ...p }) => {
    const category: PlaceCategory = _resident ? 'resident' : _visited ? 'visited' : 'wishlist';
    return { ...p, personCount: _ids.size, category, tags: tagsByPlace.get(p.placeId) ?? [] };
  });
}

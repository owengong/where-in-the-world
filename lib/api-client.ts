// Thin HTTP client shared by the web UI. A future Expo (React Native) app
// imports this same module and passes its own `baseUrl` — the only web-specific
// assumption (a relative '' base) is overridable.

import type { CaptureResult, CaptureSource, DeleteOp, MapPlace, Relationship } from '@/lib/types';

export type GeocodeHit = {
  name: string;
  lat: number;
  lng: number;
  placeType: string | null;
  bbox: [number, number, number, number] | null;
};

/** Resolve any place name to coords + bbox for map navigation (no DB write). */
export async function geocodeQuery(q: string, baseUrl = ''): Promise<GeocodeHit | null> {
  const res = await fetch(`${baseUrl}/api/geocode?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as { result: GeocodeHit | null };
  return data.result;
}

export async function fetchMapPlaces(baseUrl = ''): Promise<MapPlace[]> {
  const res = await fetch(`${baseUrl}/api/map`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/map failed: ${res.status}`);
  const data = (await res.json()) as { places: MapPlace[] };
  return data.places;
}

export async function postCapture(
  text: string,
  source: CaptureSource = 'text',
  baseUrl = '',
): Promise<CaptureResult> {
  const res = await fetch(`${baseUrl}/api/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`POST /api/capture failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as CaptureResult;
}

export async function addPersonToPlace(
  placeId: string,
  name: string,
  relationship: Relationship,
  baseUrl = '',
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placeId, name, relationship }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`POST /api/link failed: ${res.status} ${detail}`);
  }
}

export async function renamePerson(personId: string, name: string, baseUrl = ''): Promise<void> {
  const res = await fetch(`${baseUrl}/api/person/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personId, name }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `Rename failed: ${res.status}`);
  }
}

export async function changeLinkRelationship(
  linkId: string,
  relationship: Relationship,
  baseUrl = '',
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/link`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkId, relationship }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`PATCH /api/link failed: ${res.status} ${detail}`);
  }
}

export async function setPlaceTag(
  placeId: string,
  tag: string,
  remove: boolean,
  baseUrl = '',
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/place/tag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placeId, tag, remove }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`POST /api/place/tag failed: ${res.status} ${detail}`);
  }
}

export async function applyDeletes(deletes: DeleteOp[], baseUrl = ''): Promise<void> {
  const res = await fetch(`${baseUrl}/api/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deletes }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`POST /api/delete failed: ${res.status} ${detail}`);
  }
}

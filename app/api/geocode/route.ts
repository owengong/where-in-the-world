import { NextResponse } from 'next/server';
import { geocodePlace } from '@/lib/server/geocode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Resolve any place name to a point + bounding box so the map can jump there —
// even places where no one is tagged (e.g. "United States"). Display-only, so we
// use temporary (free) geocoding; nothing is stored.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Missing q' }, { status: 400 });
  try {
    const g = await geocodePlace(q, { permanent: false });
    if (!g) return NextResponse.json({ result: null });
    return NextResponse.json({
      result: { name: g.name, lat: g.lat, lng: g.lng, placeType: g.placeType, bbox: g.bbox },
    });
  } catch (e) {
    console.error('[api/geocode] failed:', e);
    return NextResponse.json({ error: 'Geocode failed' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getMapPlaces } from '@/lib/server/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const places = await getMapPlaces();
    return NextResponse.json({ places });
  } catch (e) {
    console.error('[api/map] failed:', e);
    return NextResponse.json({ error: 'Failed to load map' }, { status: 500 });
  }
}

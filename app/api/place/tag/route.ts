import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setPlaceTag } from '@/lib/server/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  placeId: z.string().uuid(),
  tag: z.string().min(1).max(60),
  remove: z.boolean().optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { placeId, tag, remove? }' }, { status: 400 });
  }

  try {
    const result = await setPlaceTag(parsed.data.placeId, parsed.data.tag, parsed.data.remove ?? false);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[api/place/tag] failed:', e);
    return NextResponse.json({ error: 'Tag update failed' }, { status: 500 });
  }
}

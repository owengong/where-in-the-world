import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addLink } from '@/lib/server/capture';
import { RELATIONSHIPS } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  placeId: z.string().uuid(),
  name: z.string().min(1).max(200),
  relationship: z.enum(RELATIONSHIPS),
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
    return NextResponse.json({ error: 'Expected { placeId, name, relationship }' }, { status: 400 });
  }

  try {
    const result = await addLink(parsed.data.placeId, parsed.data.name, parsed.data.relationship);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[api/link] failed:', e);
    return NextResponse.json({ error: 'Add failed' }, { status: 500 });
  }
}

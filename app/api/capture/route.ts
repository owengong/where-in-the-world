import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runCapture } from '@/lib/server/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  text: z.string().min(1).max(20_000),
  source: z.enum(['text', 'paste', 'voice']).optional(),
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
    return NextResponse.json({ error: 'Expected { text: string }' }, { status: 400 });
  }

  try {
    const result = await runCapture(parsed.data.text, parsed.data.source ?? 'text');
    return NextResponse.json(result);
  } catch (e) {
    console.error('[api/capture] failed:', e);
    return NextResponse.json({ error: 'Capture failed' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyDeletes } from '@/lib/server/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  deletes: z
    .array(
      z.object({
        personId: z.string().uuid(),
        linkIds: z.array(z.string().uuid()),
        deletePerson: z.boolean(),
      }),
    )
    .min(1),
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
    return NextResponse.json({ error: 'Expected { deletes: [...] }' }, { status: 400 });
  }

  try {
    const result = await applyDeletes(parsed.data.deletes);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[api/delete] failed:', e);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}

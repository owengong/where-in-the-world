import { NextResponse } from 'next/server';
import { z } from 'zod';
import { renamePerson } from '@/lib/server/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  personId: z.string().uuid(),
  name: z.string().min(1).max(200),
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
    return NextResponse.json({ error: 'Expected { personId, name }' }, { status: 400 });
  }

  try {
    const result = await renamePerson(parsed.data.personId, parsed.data.name);
    if (!result.ok) {
      if (result.conflictName) {
        return NextResponse.json(
          { error: `Another person is already named "${result.conflictName}" — rename skipped.` },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/person/rename] failed:', e);
    return NextResponse.json({ error: 'Rename failed' }, { status: 500 });
  }
}

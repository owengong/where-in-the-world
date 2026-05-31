// Delete orphaned people — rows in `people` with NO person_place links left.
//
// Removing someone's last place (the ✕ in a place panel, or a confirmed
// "remove X from <place>") deletes only the person_place link, never the
// people row (applyDeletes with deletePerson:false). The person then lingers:
// invisible on the map/search (every query INNER JOINs person_place) yet
// silently reused on re-add (upsertPerson dedupes on normalized name) and able
// to trip a "name belongs to a different person" rename collision for someone
// you can't see. This sweep clears that clutter. It's a periodic maintenance
// pass, not a realtime hook — run it whenever, it's idempotent.
//
// Safety: starred people are KEPT by default (you flagged them on purpose), and
// a JSON snapshot of every deleted row is written before any write. Read-only
// by default; pass --apply to execute.
//
//   tsx scripts/cleanup-orphans.ts                  # dry run (prints the plan)
//   tsx scripts/cleanup-orphans.ts --apply          # delete the orphans
//   tsx scripts/cleanup-orphans.ts --apply --include-starred  # also delete starred orphans
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { and, eq, isNull, inArray, notExists } from 'drizzle-orm';
import { db } from '../lib/db';
import { people, personPlace } from '../lib/db/schema';

const APPLY = process.argv.includes('--apply');
const INCLUDE_STARRED = process.argv.includes('--include-starred');

async function main() {
  // Orphans = people with no matching person_place row. Done as a LEFT JOIN so
  // it's one round-trip regardless of table size.
  const orphanRows = await db
    .select({ p: people }) // full row so the snapshot is re-INSERTable (incl. name_normalized, created_at)
    .from(people)
    .leftJoin(personPlace, eq(personPlace.personId, people.id))
    .where(isNull(personPlace.id))
    .then((rows) => rows.map((r) => r.p));

  const totalPeople = (await db.select({ id: people.id }).from(people)).length;

  const starred = orphanRows.filter((p) => p.isStarred);
  const deletable = INCLUDE_STARRED ? orphanRows : orphanRows.filter((p) => !p.isStarred);

  console.log(
    `people=${totalPeople}  orphans=${orphanRows.length}  ` +
      `starred-orphans=${starred.length} (${INCLUDE_STARRED ? 'WILL delete' : 'kept'})  ` +
      `to-delete=${deletable.length}  mode=${APPLY ? 'APPLY' : 'DRY RUN'}`,
  );

  if (deletable.length === 0) {
    console.log('Nothing to delete.');
    await db.$client.end();
    return;
  }

  for (const p of deletable) {
    console.log(`  ${p.id.slice(0, 8)}  "${p.name}"${p.isStarred ? '  [starred]' : ''}`);
  }

  if (!APPLY) {
    console.log(`\nDry run only — re-run with --apply to delete. Backup will be written then.`);
    await db.$client.end();
    return;
  }

  // Snapshot the exact rows we're about to delete, BEFORE writing.
  const backupPath = `scripts/cleanup-orphans-backup-${Date.now()}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify({ takenAt: new Date().toISOString(), deleted: deletable }, null, 2),
  );
  console.log(`\nSnapshot of ${deletable.length} people written to ${backupPath}`);

  const ids = deletable.map((p) => p.id);
  // Re-guard at write time: only delete people who are STILL orphaned, in case a
  // capture re-added one (reusing its row id) between the scan above and now.
  const removed = await db
    .delete(people)
    .where(
      and(
        inArray(people.id, ids),
        notExists(db.select().from(personPlace).where(eq(personPlace.personId, people.id))),
      ),
    )
    .returning({ id: people.id });
  const after = (await db.select({ id: people.id }).from(people)).length;
  console.log(`Done. Deleted ${removed.length} orphaned people. people ${totalPeople} -> ${after}. Backup: ${backupPath}`);

  await db.$client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

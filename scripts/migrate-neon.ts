// scripts/migrate-neon.ts
//
// One-shot migration tool: copy schema + data from one Neon project to
// another. Used to move from us-east-1 → ap-southeast-1 so the Worker
// (Singapore CF edge) talks to a same-region database and the ~480 ms
// trans-Pacific RTT goes away.
//
// Usage:
//   SOURCE_URL=... TARGET_URL=... bun scripts/migrate-neon.ts
//
// Strategy:
//   1. Apply every drizzle SQL migration in `drizzle/*.sql` to the target
//      in order. The new project starts empty, so this builds the full
//      schema (including the 0019 STORED generated columns).
//   2. For each user table, SELECT * from source and INSERT into target.
//      Wrap in `session_replication_role = replica` so FK + triggers are
//      bypassed during the load — copy order then doesn't matter.
//   3. Skip generated columns in the INSERT — Postgres recomputes them.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const SOURCE_URL = process.env.SOURCE_URL;
const TARGET_URL = process.env.TARGET_URL;

if (!SOURCE_URL || !TARGET_URL) {
  console.error('Set SOURCE_URL and TARGET_URL in env. Aborting.');
  process.exit(1);
}

// ── 1. Apply drizzle migrations to target ─────────────────────────────────
const migrationsDir = join(import.meta.dir, '..', 'drizzle');
const migrationFiles = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

console.log(`Applying ${migrationFiles.length} migrations to target…`);
const target = postgres(TARGET_URL, { max: 1, prepare: false });
try {
  for (const file of migrationFiles) {
    const sqlText = await readFile(join(migrationsDir, file), 'utf-8');
    // Drizzle separates statements within a file with `--> statement-breakpoint`.
    const statements = sqlText
      .split(/-->\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      try {
        await target.unsafe(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists')) {
          console.log(`  ${file}: skipping (${msg.split('\n')[0]})`);
          continue;
        }
        console.error(`  ${file}: FAILED on statement`);
        console.error(stmt.slice(0, 200));
        throw err;
      }
    }
    console.log(`  applied ${file}`);
  }
} finally {
  // Keep open — same instance reused below.
}

// ── 2. Discover user tables on source + copy ──────────────────────────────
const source = postgres(SOURCE_URL, { max: 1, prepare: false });

const tablesRows = await source<{ table_name: string }[]>`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name NOT IN ('__drizzle_migrations')
  ORDER BY table_name
`;
const tables = tablesRows.map((r) => r.table_name);
console.log(`\nCopying ${tables.length} tables…`);

// Neon's role can't toggle constraint triggers, so we have to honour the
// FK graph. Pull (table → depends_on[]) from information_schema and do a
// Kahn topological sort so parents land before children.
const fkRows = await source<{ child: string; parent: string }[]>`
  SELECT
    tc.table_name AS child,
    ccu.table_name AS parent
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name <> ccu.table_name
`;
const deps = new Map<string, Set<string>>();
for (const t of tables) deps.set(t, new Set());
for (const { child, parent } of fkRows) {
  if (deps.has(child) && deps.has(parent)) deps.get(child)!.add(parent);
}
const sorted: string[] = [];
const remaining = new Set(tables);
while (remaining.size > 0) {
  const ready = [...remaining].filter((t) => [...deps.get(t)!].every((p) => !remaining.has(p)));
  if (ready.length === 0) {
    throw new Error(
      `FK cycle detected among: ${[...remaining].join(', ')}. Manual order required.`,
    );
  }
  for (const t of ready) {
    sorted.push(t);
    remaining.delete(t);
  }
}
console.log(`Copy order:\n  ${sorted.join(' → ')}\n`);

let totalRowsCopied = 0;
for (const table of sorted) {
  // Get column names + identify GENERATED columns so we skip them in INSERT.
  const cols = await source<{ column_name: string; is_generated: string }[]>`
    SELECT column_name, is_generated
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `;
  const writeCols = cols.filter((c) => c.is_generated !== 'ALWAYS').map((c) => c.column_name);
  if (writeCols.length === 0) {
    console.log(`  ${table}: 0 writable columns, skipping`);
    continue;
  }
  const colListSrc = writeCols.map((c) => `"${c}"`).join(', ');
  const rows = await source.unsafe(`SELECT ${colListSrc} FROM "${table}"`);
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows`);
    continue;
  }
  // Bulk insert in chunks of 500 to keep parameter count under Postgres
  // limits (~65k bound params per statement; 500 rows × ~20 cols = 10k).
  // No conflict-ignore path: this is a one-shot production data copy, so a
  // duplicate or partial insert must stop the run instead of silently
  // printing success with missing target rows.
  const chunkSize = 500;
  let tableRowsCopied = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk
      .map((_, rowIdx) => {
        const params = writeCols
          .map((_, colIdx) => `$${rowIdx * writeCols.length + colIdx + 1}`)
          .join(', ');
        return `(${params})`;
      })
      .join(', ');
    const values = chunk.flatMap((row) => writeCols.map((c) => row[c]));
    const insertedRows = await target.unsafe(
      `INSERT INTO "${table}" (${colListSrc}) VALUES ${placeholders} RETURNING 1`,
      values,
    );
    if (insertedRows.length !== chunk.length) {
      throw new Error(
        `[migrate-neon] target insert count mismatch for table "${table}" chunk ${String(i / chunkSize + 1)}: expected ${String(chunk.length)}, inserted ${String(insertedRows.length)}`,
      );
    }
    tableRowsCopied += insertedRows.length;
  }
  totalRowsCopied += tableRowsCopied;
  console.log(`  ${table}: ${tableRowsCopied} rows`);
}

console.log(`\nDone. ${totalRowsCopied} rows copied across ${tables.length} tables.`);

await source.end();
await target.end();

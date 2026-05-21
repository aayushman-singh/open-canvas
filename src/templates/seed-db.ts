import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { template, type NewTemplate } from '../db/schema';
import * as schema from '../db/schema';
import { templates } from './registry';

declare const process: {
  env: Record<string, string | undefined>;
  exit: (code: number) => never;
};

declare global {
  interface ImportMeta {
    main?: boolean;
  }
}

type SeedDb = ReturnType<typeof drizzle<typeof schema>>;

export async function seedTemplates(db: SeedDb): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const t of templates) {
    const row: NewTemplate = {
      id: t.id,
      name: t.name,
      tagline: t.tagline,
      category: t.category,
      thumbnail: t.thumbnail,
      designLanguage: t.designLanguage,
      tokens: t.tokens,
      pages: t.pages,
    };

    const result = await db
      .insert(template)
      .values(row)
      .onConflictDoUpdate({
        target: template.id,
        set: {
          name: row.name,
          tagline: row.tagline,
          category: row.category,
          thumbnail: row.thumbnail,
          designLanguage: row.designLanguage,
          tokens: row.tokens,
          pages: row.pages,
        },
      })
      .returning({ id: template.id, createdAt: template.createdAt });

    const r = result[0];
    if (!r) continue;
    const isNew = Date.now() - new Date(r.createdAt).getTime() < 5_000;
    if (isNew) inserted++;
    else updated++;
  }

  return { inserted, updated };
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const client = neon(url);
  const db = drizzle(client, { schema });
  const { inserted, updated } = await seedTemplates(db);
  console.log(`[seed:templates] inserted=${inserted} updated=${updated}`);
  const count = await db.execute(sql`select count(*)::int as n from template`);
  console.log(`[seed:templates] total rows: ${String((count.rows[0] as { n: number }).n)}`);
}

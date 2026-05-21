import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { DocumentJSON, ThemeTokenSet } from '../document/schema';

export const customer = pgTable('customer', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;

// Templates are seed documents (ADR 0001 decision 11); creating a site copies pages + tokens.

export const TEMPLATE_CATEGORIES = ['business', 'portfolio', 'landing', 'product', 'blog'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_DESIGN_LANGUAGES = ['A', 'B', 'C', 'D'] as const;
export type TemplateDesignLanguage = (typeof TEMPLATE_DESIGN_LANGUAGES)[number];

export type TemplatePageDescriptor = {
  slug: string;
  title: string;
  doc: DocumentJSON;
};

export const template = pgTable('template', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  tagline: text('tagline').notNull(),
  category: text('category').notNull().$type<TemplateCategory>(),
  thumbnail: text('thumbnail'),
  designLanguage: text('design_language').notNull().$type<TemplateDesignLanguage>(),
  tokens: jsonb('tokens').notNull().$type<ThemeTokenSet>(),
  pages: jsonb('pages').notNull().$type<TemplatePageDescriptor[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Template = typeof template.$inferSelect;
export type NewTemplate = typeof template.$inferInsert;

export const site = pgTable('site', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  customerId: text('customer_id')
    .notNull()
    .references(() => customer.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  templateId: text('template_id').references(() => template.id, { onDelete: 'set null' }),
  tokens: jsonb('tokens').notNull().$type<ThemeTokenSet>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Site = typeof site.$inferSelect;
export type NewSite = typeof site.$inferInsert;

export const page = pgTable(
  'page',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    doc: jsonb('doc').notNull().$type<DocumentJSON>(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteSlugUnique: uniqueIndex('page_site_slug_unique').on(t.siteId, t.slug),
  }),
);

export type Page = typeof page.$inferSelect;
export type NewPage = typeof page.$inferInsert;

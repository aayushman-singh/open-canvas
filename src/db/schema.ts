import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { CanvasSiteState, PublishedSnapshot, StyleKit } from '../canvas/schema';

type LegacyDocumentJSON = Record<string, unknown>;
type LegacyThemeTokenSet = Record<string, unknown>;

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

// The legacy template table remains in the database for existing migrations,
// but the active canvas-first creation flow reads Template Seeds from
// src/templates/registry.ts instead of this table.

export const TEMPLATE_CATEGORIES = ['business', 'portfolio', 'landing', 'product', 'blog'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_DESIGN_LANGUAGES = ['A', 'B', 'C', 'D'] as const;
export type TemplateDesignLanguage = (typeof TEMPLATE_DESIGN_LANGUAGES)[number];

export type TemplatePageDescriptor = {
  slug: string;
  title: string;
  doc: LegacyDocumentJSON;
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
  tokens: jsonb('tokens').notNull().$type<LegacyThemeTokenSet>(),
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
  subdomain: text('subdomain').notNull().unique(),
  styleKit: text('style_kit').notNull().$type<StyleKit>(),
  editableState: jsonb('editable_state').notNull().$type<CanvasSiteState>(),
  publishedSnapshot: jsonb('published_snapshot').$type<PublishedSnapshot | null>(),
  publishedVersion: integer('published_version').notNull().default(0),
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
    doc: jsonb('doc').notNull().$type<LegacyDocumentJSON>(),
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

export const siteAsset = pgTable('site_asset', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id')
    .notNull()
    .references(() => site.id, { onDelete: 'cascade' }),
  mediaType: text('media_type').notNull(),
  bytesBase64: text('bytes_base64').notNull(),
  kind: text('kind').notNull().$type<'image' | 'video'>(),
  alt: text('alt').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SiteAsset = typeof siteAsset.$inferSelect;
export type NewSiteAsset = typeof siteAsset.$inferInsert;

export const ownerAsset = pgTable(
  'owner_asset',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    mediaType: text('media_type').notNull(),
    bytesBase64: text('bytes_base64').notNull(),
    kind: text('kind').notNull().$type<'image' | 'video'>(),
    alt: text('alt').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerAssetByCustomer: index('owner_asset_by_customer').on(t.customerId, t.lastUsedAt.desc()),
  }),
);

export type OwnerAsset = typeof ownerAsset.$inferSelect;
export type NewOwnerAsset = typeof ownerAsset.$inferInsert;

export const slotHistory = pgTable(
  'slot_history',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    assetId: text('asset_id')
      .notNull()
      .references(() => ownerAsset.id, { onDelete: 'cascade' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.siteId, t.elementId, t.assetId] }),
    bySlot: index('slot_history_by_slot').on(t.siteId, t.elementId, t.lastUsedAt.desc()),
  }),
);

export type SlotHistory = typeof slotHistory.$inferSelect;
export type NewSlotHistory = typeof slotHistory.$inferInsert;

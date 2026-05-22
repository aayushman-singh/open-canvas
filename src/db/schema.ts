import {
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { CanvasSiteState, PublishedSnapshot, StyleKit } from '../canvas/schema';

// -- Postgres `bytea` custom column (Phase 0 — Wave 1 #3 version history) ----
//
// Drizzle does not ship a first-class `bytea` builder. We declare it via
// `customType` so the Wave 1 version-history agent can store Yjs snapshot
// blobs without round-tripping through base64. The JS side reads/writes
// `Uint8Array`; the SQL side is `bytea`. If a future deployment hits a
// driver that returns hex (`\x...`) strings rather than `Buffer`, the
// `fromDriver` shim should be revisited; for now we accept whatever the
// Neon driver hands back as-is — Wave 1 owns the read-side handling.
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

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
  // Wave 2 #9 — password-protected publish. `passwordEnabled` is the visitor-
  // gate switch; `passwordHash` is the PBKDF2 hash + salt blob set by the
  // owner; `passwordSetAt` lets the unlock cookie's iat be compared so
  // password changes invalidate previously-issued cookies.
  passwordEnabled: boolean('password_enabled').notNull().default(false),
  passwordHash: text('password_hash'),
  passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
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

// ===========================================================================
// Phase 0 scaffold tables — declared here, unused until the owning wave
// agent fills in the corresponding feature dir. Each table's column shape is
// frozen by the per-feature plan referenced in the leading comment. Adding
// columns is fine in a future migration; renaming or retyping is a contract
// break.
// ===========================================================================

// -- customDomain (Wave 1 #5 — see plan 05-custom-domains.md) ---------------
//
// One row per Owner-registered custom hostname. `cfHostnameId` is the
// Cloudflare for SaaS Custom Hostname id returned from the API; the public
// host router resolves `Host` header → `customDomain.hostname` →
// `customDomain.siteId` → Published Snapshot. The `verificationRecord` blob
// holds the CNAME/TXT-target Cloudflare reported, surfaced to the Owner.
export const CUSTOM_DOMAIN_STATUSES = ['pending', 'verifying', 'active', 'failed'] as const;
export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number];

export const customDomain = pgTable('custom_domain', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id')
    .notNull()
    .references(() => site.id, { onDelete: 'cascade' }),
  hostname: text('hostname').notNull().unique(),
  cfHostnameId: text('cf_hostname_id').notNull(),
  status: text('status').notNull().$type<CustomDomainStatus>(),
  verificationRecord: jsonb('verification_record').notNull().$type<Record<string, unknown>>(),
  certIssuedAt: timestamp('cert_issued_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CustomDomain = typeof customDomain.$inferSelect;
export type NewCustomDomain = typeof customDomain.$inferInsert;

// -- formSubmission (Wave 2 #7 — see plan 07-forms.md) ----------------------
//
// One row per visitor form submission. `formElementId` is the Owner-authored
// FormElement id (lives inside `site.editableState`); `payload` is the raw
// field-value map. `ipHash` is a hashed IP for rate-limit accounting — never
// the raw IP. `userAgent` is verbatim for debugging.
export const formSubmission = pgTable('form_submission', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id')
    .notNull()
    .references(() => site.id, { onDelete: 'cascade' }),
  formElementId: text('form_element_id').notNull(),
  pageSlug: text('page_slug').notNull(),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  ipHash: text('ip_hash').notNull(),
  userAgent: text('user_agent').notNull().default(''),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FormSubmission = typeof formSubmission.$inferSelect;
export type NewFormSubmission = typeof formSubmission.$inferInsert;

// -- siteSnapshot (Wave 1 #3 — see plan 03-version-history.md) --------------
//
// One row per Yjs snapshot capture (publish or manual). `yjsSnapshotBytes`
// stores the result of `Y.encodeStateAsUpdate(doc)` — the bytea custom
// column above keeps the bytes binary on the wire. `publishedVersion` is
// set only when `reason === 'publish'`; manual snapshots leave it NULL.
export const SITE_SNAPSHOT_REASONS = ['publish', 'manual'] as const;
export type SiteSnapshotReason = (typeof SITE_SNAPSHOT_REASONS)[number];

export const siteSnapshot = pgTable('site_snapshot', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id')
    .notNull()
    .references(() => site.id, { onDelete: 'cascade' }),
  yjsSnapshotBytes: bytea('yjs_snapshot_bytes').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason').notNull().$type<SiteSnapshotReason>(),
  label: text('label'),
  publishedVersion: integer('published_version'),
});

export type SiteSnapshot = typeof siteSnapshot.$inferSelect;
export type NewSiteSnapshot = typeof siteSnapshot.$inferInsert;

// -- siteFont (Wave 5 #12 — see plan 12-custom-fonts.md) --------------------
//
// One row per Owner-uploaded WOFF2 font file. Bytes live in R2 keyed by
// `contentHash`; the `font:<contentHash>` token resolves at render time to a
// `@font-face` declaration plus a `font-family: <name>` rule.
export const SITE_FONT_STYLES = ['normal', 'italic'] as const;
export type SiteFontStyle = (typeof SITE_FONT_STYLES)[number];

export const siteFont = pgTable('site_font', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id')
    .notNull()
    .references(() => site.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  family: text('family').notNull(),
  weight: integer('weight').notNull().default(400),
  style: text('style').notNull().$type<SiteFontStyle>().default('normal'),
  contentHash: text('content_hash').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SiteFont = typeof siteFont.$inferSelect;
export type NewSiteFont = typeof siteFont.$inferInsert;

// -- siteSearchEntry (Wave 3 #13 — see plan 13-site-search.md) --------------
//
// One row per text-bearing element in a Published Snapshot. The `tsv`
// column is a generated `tsvector` populated by a raw-SQL migration applied
// alongside this drizzle definition — drizzle does not model generated
// columns directly, so the migration includes:
//
//   ALTER TABLE site_search_entry
//     ADD COLUMN tsv tsvector
//     GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
//   CREATE INDEX site_search_entry_tsv_idx ON site_search_entry USING gin (tsv);
//
// Queries reference `tsv` directly via `sql\`tsv @@ ...\``; the type
// surface here intentionally omits it so application code never reads it.
export const siteSearchEntry = pgTable('site_search_entry', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id')
    .notNull()
    .references(() => site.id, { onDelete: 'cascade' }),
  pageSlug: text('page_slug').notNull(),
  elementId: text('element_id').notNull(),
  text: text('text').notNull(),
  publishedVersion: integer('published_version').notNull(),
});

export type SiteSearchEntry = typeof siteSearchEntry.$inferSelect;
export type NewSiteSearchEntry = typeof siteSearchEntry.$inferInsert;

// -- chatSession (Wave 5 #23 — see plan 23-ai-chat.md) ----------------------
//
// One row per Owner ↔ Agent chat session. Messages array carries the
// turn-by-turn payload (`role`, `content`, optional `toolCalls`). Sessions
// are pinned per (site, customer); the orchestrator keeps the active session
// in DO storage and persists to this table on session end.
export const chatSession = pgTable('chat_session', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id')
    .notNull()
    .references(() => site.id, { onDelete: 'cascade' }),
  customerId: text('customer_id')
    .notNull()
    .references(() => customer.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  messages: jsonb('messages').notNull().$type<Array<Record<string, unknown>>>(),
});

export type ChatSession = typeof chatSession.$inferSelect;
export type NewChatSession = typeof chatSession.$inferInsert;

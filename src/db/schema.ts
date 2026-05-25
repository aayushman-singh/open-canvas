import {
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { CanvasSection, CanvasSiteState, PublishedSnapshot, StyleKit } from '../canvas/schema';

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
  displayName: text('display_name'),
  bio: text('bio'),
  timezone: text('timezone').notNull().default('UTC'),
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

export type CollaboratorRole = 'editor' | 'viewer';

export const siteCollaborator = pgTable(
  'site_collaborator',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    customerId: text('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    role: text('role').notNull().$type<CollaboratorRole>().default('editor'),
    invitedByCustomerId: text('invited_by_customer_id')
      .notNull()
      .references(() => customer.id),
    invitedEmail: text('invited_email').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteCustomerUnique: uniqueIndex('site_collaborator_site_customer_unique').on(
      t.siteId,
      t.customerId,
    ),
  }),
);

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

// -- ownerAsset (ADR 0004 + ADR 0006 + plan #2 asset pipeline) --------------
//
// The Owner Asset table re-roots media from `site` to `customer` per ADR 0004.
// Bytes live in Cloudflare R2 keyed by `r2Key` (a content-addressed key
// derived from `contentHash`). The `id` column is a UUID — canvas state JSON
// references this id via `MediaElement.assetId`, and the rendering path
// resolves the UUID through this table to the `r2Key` that fetches the actual
// bytes. Re-uploading the same bytes for the same Owner deduplicates at the
// (customerId, contentHash) pair: the existing row is returned and no new R2
// object is written. Two Owners uploading the same bytes share the R2 object
// (one set of bytes on disk) but each get their own ownerAsset row.
export const ownerAsset = pgTable('owner_asset', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  customerId: text('customer_id')
    .notNull()
    .references(() => customer.id, { onDelete: 'cascade' }),
  contentHash: text('content_hash').notNull(),
  r2Key: text('r2_key').notNull(),
  mediaType: text('media_type').notNull(),
  kind: text('kind').notNull().$type<'image' | 'video'>(),
  alt: text('alt').notNull().default(''),
  width: integer('width'),
  height: integer('height'),
  byteSize: integer('byte_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OwnerAsset = typeof ownerAsset.$inferSelect;
export type NewOwnerAsset = typeof ownerAsset.$inferInsert;

// -- slotHistory (ADR 0004 decision 4) --------------------------------------
//
// Per-(site, mediaElement) MRU list of which Owner Assets have lived in each
// slot. Keys are `(site_id, element_id, owner_asset_id)` — composite primary
// key, so re-applying the same asset to the same slot is a noop. Rows are
// dropped by cascade when either the site or the owner asset is deleted. The
// editor reads this table to show "previous occupants of this slot" in the
// gallery picker per ADR 0004.
export const slotHistory = pgTable(
  'slot_history',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    ownerAssetId: text('owner_asset_id')
      .notNull()
      .references(() => ownerAsset.id, { onDelete: 'cascade' }),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.siteId, t.elementId, t.ownerAssetId] }),
  }),
);

export type SlotHistory = typeof slotHistory.$inferSelect;
export type NewSlotHistory = typeof slotHistory.$inferInsert;

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

// -- AssetManifestEntry (shared by library_section + custom_template) ---------
//
// Snapshot of an ownerAsset at save time. On import, the target Owner gets
// new ownerAsset rows with the same contentHash/r2Key, deduped by
// (customerId, contentHash). No bytes are copied — R2 is content-addressed.

export interface AssetManifestEntry {
  assetId: string;
  contentHash: string;
  r2Key: string;
  mediaType: string;
  kind: 'image' | 'video';
  alt: string;
  width: number | null;
  height: number | null;
  byteSize: number;
}

// -- librarySection (Section Library — global + per-Owner reusable sections) --
//
// Stores reusable section definitions. Global sections (customerId NULL,
// visibility 'global') are admin-curated and visible to all Owners. Private
// sections (customerId set, visibility 'private') are per-Owner.

export const LIBRARY_SECTION_VISIBILITY = ['global', 'private'] as const;
export type LibrarySectionVisibility = (typeof LIBRARY_SECTION_VISIBILITY)[number];

export const librarySection = pgTable('library_section', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  customerId: text('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
  visibility: text('visibility').notNull().$type<LibrarySectionVisibility>(),
  name: text('name').notNull(),
  recipeId: text('recipe_id').notNull(),
  sectionData: jsonb('section_data').notNull().$type<CanvasSection>(),
  assetManifest: jsonb('asset_manifest').notNull().$type<AssetManifestEntry[]>(),
  headingPreview: text('heading_preview').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LibrarySection = typeof librarySection.$inferSelect;
export type NewLibrarySection = typeof librarySection.$inferInsert;

// -- customTemplate (Owner-created templates — global + per-Owner) ------------
//
// Stores templates created via "save as template" from the editor. Global
// templates (customerId NULL, visibility 'global') are admin-curated. Private
// templates (customerId set, visibility 'private') are per-Owner.

export const CUSTOM_TEMPLATE_VISIBILITY = ['global', 'private'] as const;
export type CustomTemplateVisibility = (typeof CUSTOM_TEMPLATE_VISIBILITY)[number];

export const customTemplate = pgTable('custom_template', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  customerId: text('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
  visibility: text('visibility').notNull().$type<CustomTemplateVisibility>(),
  name: text('name').notNull(),
  tagline: text('tagline').notNull().default(''),
  styleKit: text('style_kit').notNull(),
  siteState: jsonb('site_state').notNull().$type<CanvasSiteState>(),
  assetManifest: jsonb('asset_manifest').notNull().$type<AssetManifestEntry[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CustomTemplate = typeof customTemplate.$inferSelect;
export type NewCustomTemplate = typeof customTemplate.$inferInsert;

// -- addonEntitlement (ADR 0009 — addon entitlement model) --------------------
//
// One row per (customer, addon) pair. Represents the fact that an Owner has
// acquired an addon and may enable it on any of their sites. The `addonId`
// matches an entry in the hardcoded addon registry (`src/addons/registry.ts`).
// Rows are never cascade-deleted from site deletion — entitlements are
// account-scoped.
export const addonEntitlement = pgTable(
  'addon_entitlement',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerId: text('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    addonId: text('addon_id').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    customerAddonUnique: uniqueIndex('addon_entitlement_customer_addon_unique').on(
      t.customerId,
      t.addonId,
    ),
  }),
);

export type AddonEntitlement = typeof addonEntitlement.$inferSelect;
export type NewAddonEntitlement = typeof addonEntitlement.$inferInsert;

// -- siteAddon (ADR 0009 — addon entitlement model) --------------------------
//
// One row per (site, addon) pair. Stores per-site activation state and
// configuration for an addon the Owner has acquired. The `config` JSONB
// column holds addon-specific key-value pairs (e.g. `{ measurementId: "G-..." }`
// for Google Analytics). Rows are NOT cascade-deleted when an entitlement is
// removed — the config becomes inert until the entitlement is restored.
// Rows ARE cascade-deleted when the site is deleted.
export const siteAddon = pgTable(
  'site_addon',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    addonId: text('addon_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').notNull().$type<Record<string, string>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteAddonUnique: uniqueIndex('site_addon_site_addon_unique').on(t.siteId, t.addonId),
  }),
);

export type SiteAddon = typeof siteAddon.$inferSelect;
export type NewSiteAddon = typeof siteAddon.$inferInsert;

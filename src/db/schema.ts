import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { CanvasSection, EditableSite, PublishedSnapshot, StyleKit } from '../canvas/schema';

// -- Postgres `bytea` custom column -------------------------------------------
//
// Drizzle does not ship a first-class `bytea` builder. We declare it via
// `customType` so version-history can store Yjs snapshot blobs without
// round-tripping through base64. The JS side reads/writes `Uint8Array`; the
// SQL side is `bytea`. The Neon HTTP driver normally returns bytea as a
// Buffer (Uint8Array subclass) via its built-in parseBytea type parser, but
// the response shape can vary across Neon runtime versions / pooled vs
// direct connections. Decode Postgres' textual `\x...` representation
// explicitly and reject malformed bytes instead of handing Y.applyUpdate a
// corrupt update.
const BYTEA_HEX_RE = /^[0-9a-fA-F]*$/;

export function decodeByteaDriverValue(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    if (!value.startsWith('\\x')) {
      throw new Error('bytea fromDriver: unrecognised string format (expected \\x hex)');
    }
    const hex = value.slice(2);
    if (hex.length % 2 !== 0) {
      throw new Error(`bytea fromDriver: hex payload must have even length, got ${hex.length}`);
    }
    if (!BYTEA_HEX_RE.test(hex)) {
      throw new Error('bytea fromDriver: hex payload contains non-hex characters');
    }
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  throw new Error(`bytea fromDriver: unsupported driver type ${typeof value}`);
}

// Ambient declaration for node's Buffer — only used by the bytea customType
// below. We can't pull in `@types/node` for one usage, and `BufferSource`
// (workers-types) isn't enough because postgres.js detects binary writes via
// the runtime `Buffer.isBuffer` check, which only returns true for the real
// thing.
declare const Buffer: {
  from(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint8Array;
};

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array | string }>({
  dataType() {
    return 'bytea';
  },
  fromDriver(value: unknown): Uint8Array {
    return decodeByteaDriverValue(value);
  },
  // postgres.js needs a Buffer (or any nodejs_compat Buffer-tagged value) to
  // encode bytea as binary on the wire — we run with `fetch_types: false`
  // (db/client.ts) so postgres.js never resolves the bytea OID and otherwise
  // falls back to text-encoding the Uint8Array, which mangles the snapshot
  // bytes. The Worker has `nodejs_compat` so Buffer is available.
  toDriver(value: Uint8Array): Uint8Array {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
});

export const BILLING_PLANS = ['free', 'pro', 'team'] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export const customer = pgTable('customer', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  // Local source of truth for "one opencanvas customer per email". Clerk can
  // mint multiple users for the same email (e.g. password sign-up then later
  // "Continue with Google" creates a second Clerk user with a different id),
  // so deferring email uniqueness to Clerk forked our customer rows: the new
  // Clerk session insert-failed nothing, so a fresh row was created with the
  // new clerk_user_id and the original Owner's sites/assets/plan orphaned
  // behind the previous identity. The application-layer dedupe in
  // `src/auth/customer-upsert.ts` reuses the existing row by rebinding
  // clerk_user_id when this case is detected; this constraint is the physical
  // backstop so a bug, a manual SQL insert, or a future regression cannot
  // re-introduce the duplicate. Drizzle 0020 backfills the merge of the
  // historical dupes and then adds the constraint.
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  bio: text('bio'),
  timezone: text('timezone').notNull().default('UTC'),
  plan: text('plan').notNull().default('free').$type<BillingPlan>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;

export const SITE_KINDS = ['owner_site', 'template_draft'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export const site = pgTable(
  'site',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerId: text('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    siteKind: text('site_kind').notNull().default('owner_site').$type<SiteKind>(),
    name: text('name').notNull(),
    subdomain: text('subdomain').notNull().unique(),
    styleKit: text('style_kit').notNull().$type<StyleKit>(),
    editableState: jsonb('editable_state').notNull().$type<EditableSite>(),
    // Generated columns projected from editableState — they were paying
    // ~500ms per dashboard listing query via JSONB partial extraction
    // because Postgres had to read the entire ~300kB editableState blob
    // per row to compute `(editable_state->>'visitorTheme')` on demand.
    // STORED generated columns evaluate the expression at write time and
    // persist the scalar value, so reads touch a narrow column. Every
    // editableState update auto-recomputes them; no manual sync.
    visitorTheme: text('visitor_theme').generatedAlwaysAs(
      sql`(editable_state->>'visitorTheme')`,
    ),
    siteNoIndex: boolean('site_no_index').generatedAlwaysAs(
      sql`((editable_state->>'siteNoIndex')::boolean)`,
    ),
    faviconAssetId: text('favicon_asset_id').generatedAlwaysAs(
      sql`(editable_state->>'faviconAssetId')`,
    ),
    publishedSnapshot: jsonb('published_snapshot').$type<PublishedSnapshot | null>(),
    publishedVersion: integer('published_version').notNull().default(0),
    // Password-protected publish. `passwordEnabled` is the visitor-gate switch;
    // `passwordHash` is the PBKDF2 hash + salt blob set by the owner;
    // `passwordSetAt` lets the unlock cookie's iat be compared so password
    // changes invalidate previously-issued cookies.
    passwordEnabled: boolean('password_enabled').notNull().default(false),
    passwordHash: text('password_hash'),
    passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    customerIdx: index('site_customer_id_idx').on(t.customerId),
  }),
);

export type Site = typeof site.$inferSelect;
export type NewSite = typeof site.$inferInsert;

export const COLLABORATOR_ROLES = ['editor', 'viewer'] as const;
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];

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
export const ownerAsset = pgTable(
  'owner_asset',
  {
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
  },
  (t) => ({
    customerContentHashUnique: uniqueIndex('owner_asset_customer_content_hash_unique').on(
      t.customerId,
      t.contentHash,
    ),
  }),
);

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
// Feature-scaffold tables. Each table's column shape is the contract for the
// owning feature directory. Adding columns is fine in a future migration;
// renaming or retyping is a contract break.
// ===========================================================================

// -- customDomain -------------------------------------------------------------
//
// One row per Owner-registered custom hostname. `cfHostnameId` is the
// Cloudflare for SaaS Custom Hostname id returned from the API; the public
// host router resolves `Host` header → `customDomain.hostname` →
// `customDomain.siteId` → Published Snapshot. The `verificationRecord` blob
// holds the CNAME/TXT-target Cloudflare reported, surfaced to the Owner.
export const CUSTOM_DOMAIN_STATUSES = ['pending', 'verifying', 'active', 'failed'] as const;
export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number];

export const customDomain = pgTable(
  'custom_domain',
  {
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
  },
  (t) => ({
    siteIdx: index('custom_domain_site_id_idx').on(t.siteId),
  }),
);

export type CustomDomain = typeof customDomain.$inferSelect;
export type NewCustomDomain = typeof customDomain.$inferInsert;

// -- formSubmission -----------------------------------------------------------
//
// One row per visitor form submission. `formElementId` is the Owner-authored
// FormElement id (lives inside `site.editableState`); `payload` is the raw
// field-value map. `ipHash` is a hashed IP for rate-limit accounting — never
// the raw IP. `userAgent` is verbatim for debugging.
export const formSubmission = pgTable(
  'form_submission',
  {
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
  },
  (t) => ({
    siteFormSubmittedIdx: index('form_submission_site_form_submitted_idx').on(
      t.siteId,
      t.formElementId,
      t.submittedAt.desc(),
    ),
  }),
);

export type FormSubmission = typeof formSubmission.$inferSelect;
export type NewFormSubmission = typeof formSubmission.$inferInsert;

// -- siteSnapshot -------------------------------------------------------------
//
// One row per Yjs snapshot capture (publish or manual). `yjsSnapshotBytes`
// stores the result of `Y.encodeStateAsUpdate(doc)` — the bytea custom
// column above keeps the bytes binary on the wire. `publishedVersion` is
// set only when `reason === 'publish'`; manual snapshots leave it NULL.
export const SITE_SNAPSHOT_REASONS = ['publish', 'manual'] as const;
export type SiteSnapshotReason = (typeof SITE_SNAPSHOT_REASONS)[number];

export const siteSnapshot = pgTable(
  'site_snapshot',
  {
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
  },
  (t) => ({
    siteCapturedIdx: index('site_snapshot_site_captured_idx').on(t.siteId, t.capturedAt.desc()),
  }),
);

export type SiteSnapshot = typeof siteSnapshot.$inferSelect;
export type NewSiteSnapshot = typeof siteSnapshot.$inferInsert;

// -- siteFont -----------------------------------------------------------------
//
// One row per Owner-uploaded WOFF2 font file. Bytes live in R2 keyed by
// `contentHash`; the `font:<contentHash>` token resolves at render time to a
// `@font-face` declaration plus a `font-family: <name>` rule.
export const SITE_FONT_STYLES = ['normal', 'italic'] as const;
export type SiteFontStyle = (typeof SITE_FONT_STYLES)[number];

export const siteFont = pgTable(
  'site_font',
  {
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
  },
  (t) => ({
    siteIdx: index('site_font_site_id_idx').on(t.siteId),
  }),
);

export type SiteFont = typeof siteFont.$inferSelect;
export type NewSiteFont = typeof siteFont.$inferInsert;

// -- siteSearchEntry ----------------------------------------------------------
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
export const siteSearchEntry = pgTable(
  'site_search_entry',
  {
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
  },
  (t) => ({
    siteIdx: index('site_search_entry_site_id_idx').on(t.siteId),
  }),
);

export type SiteSearchEntry = typeof siteSearchEntry.$inferSelect;
export type NewSiteSearchEntry = typeof siteSearchEntry.$inferInsert;

// -- chatSession --------------------------------------------------------------
//
// One row per Owner ↔ Agent chat session. Messages array carries the
// turn-by-turn payload (`role`, `content`, optional `toolCalls`). Sessions
// are pinned per (site, customer); the orchestrator keeps the active session
// in DO storage and persists to this table on session end.
export const chatSession = pgTable(
  'chat_session',
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
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    messages: jsonb('messages').notNull().$type<Array<Record<string, unknown>>>(),
  },
  (t) => ({
    siteCustomerStartedIdx: index('chat_session_site_customer_started_idx').on(
      t.siteId,
      t.customerId,
      t.startedAt.desc(),
    ),
  }),
);

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

// ADR 0061 Decision 8 — the closed Section Category enum lives in a slim
// module so the editor-client bundle can import it for the picker
// dropdown without pulling in `drizzle-orm/pg-core`. Re-exported here so
// existing server-side imports from `db/schema` keep working.
import { SECTION_CATEGORIES, type SectionCategory } from '../canvas/section-library/categories.js';
export { SECTION_CATEGORIES };
export type { SectionCategory };

export const librarySection = pgTable(
  'library_section',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerId: text('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    visibility: text('visibility').notNull().$type<LibrarySectionVisibility>(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    recipeId: text('recipe_id').notNull(),
    sectionData: jsonb('section_data').notNull().$type<CanvasSection>(),
    assetManifest: jsonb('asset_manifest').notNull().$type<AssetManifestEntry[]>(),
    headingPreview: text('heading_preview').notNull().default(''),
    // ADR 0061 Decision 5 — origin-named slug (e.g. `home-template-hero`,
    // `library-template-testimonial-quote`). Backfilled to `id` on
    // pre-existing rows so the NOT NULL constraint holds without a code
    // change to the legacy POST route.
    baseSlug: text('base_slug').notNull(),
    // ADR 0061 Decision 4 — lineage column. v2 = v1.version + 1; v1 stays
    // referenced by every Template that pinned its exact id.
    version: integer('version').notNull().default(1),
    // Self-FK to the predecessor row when this row is a save-as-new of an
    // existing section. text (not uuid) because library_section.id is text.
    parentId: text('parent_id').references((): AnyPgColumn => librarySection.id),
    // ADR 0061 Decision 8 — picker filter axis, orthogonal to recipeId.
    category: text('category').notNull().default('other').$type<SectionCategory>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('library_section_base_slug_version_idx').on(table.baseSlug, table.version)],
);

export type LibrarySection = typeof librarySection.$inferSelect;
export type NewLibrarySection = typeof librarySection.$inferInsert;

// -- customTemplate (Owner-created templates — global + per-Owner) ------------
//
// Stores templates created via "save as template" from the editor. Global
// templates (customerId NULL, visibility 'global') are admin-curated. Private
// templates (customerId set, visibility 'private') are per-Owner.

export const CUSTOM_TEMPLATE_VISIBILITY = ['global', 'private'] as const;
export type CustomTemplateVisibility = (typeof CUSTOM_TEMPLATE_VISIBILITY)[number];

export const CUSTOM_TEMPLATE_PUBLICATION_STATUSES = [
  'drafting',
  'published',
  'unpublished',
] as const;
export type CustomTemplatePublicationStatus =
  (typeof CUSTOM_TEMPLATE_PUBLICATION_STATUSES)[number];

export const customTemplate = pgTable(
  'custom_template',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerId: text('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    visibility: text('visibility').notNull().$type<CustomTemplateVisibility>(),
    publicationStatus: text('publication_status')
      .notNull()
      .default('published')
      .$type<CustomTemplatePublicationStatus>(),
    templateDraftSiteId: text('template_draft_site_id').references(() => site.id, {
      onDelete: 'set null',
    }),
    // When set, this curated global template overrides the built-in Template
    // Seed with the same id (e.g. raydotsh-portfolio). Only one row may bind
    // to a given seed id; publish makes the override selectable via the seed
    // card while keeping the code seed as fallback when unpublished.
    sourceTemplateId: text('source_template_id'),
    name: text('name').notNull(),
    tagline: text('tagline').notNull().default(''),
    styleKit: text('style_kit').notNull(),
    siteState: jsonb('site_state').notNull().$type<EditableSite>(),
    assetManifest: jsonb('asset_manifest').notNull().$type<AssetManifestEntry[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    templateDraftSiteIdUnique: uniqueIndex('custom_template_template_draft_site_id_unique')
      .on(table.templateDraftSiteId)
      .where(sql`template_draft_site_id IS NOT NULL`),
    sourceTemplateIdUnique: uniqueIndex('custom_template_source_template_id_unique')
      .on(table.sourceTemplateId)
      .where(sql`source_template_id IS NOT NULL`),
  })
);

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

// -- notification + notificationRead (ADR 0043) ------------------------------
//
// In-app notifications, hybrid recipient model: a row is either addressed to
// one customer (recipientKind='customer') or one site (recipientKind='site').
// Fan-out happens at write time — e.g. revoking access on a shared site writes
// one 'customer' row for the affected person plus one 'site' row for the
// others. The ADR uses "Owner" as the user-facing word; the DB table is
// `customer`, so the schema follows that convention.
//
// `recipientId` is polymorphic and intentionally not foreign-keyed (the column
// points at either customer.id or site.id depending on recipientKind). Orphan
// rows after a customer/site delete are not user-visible (the inbox query
// gates on current membership) and the 90-day TTL sweep (Follow-ups in ADR
// 0043) collects them.
export const NOTIFICATION_KINDS = [
  'form_submission',
  'collaborator_event',
  'publish_event',
  'access_event',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_RECIPIENT_KINDS = ['customer', 'site'] as const;
export type NotificationRecipientKind = (typeof NOTIFICATION_RECIPIENT_KINDS)[number];

export const notification = pgTable(
  'notification',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').notNull().$type<NotificationKind>(),
    recipientKind: text('recipient_kind').notNull().$type<NotificationRecipientKind>(),
    recipientId: text('recipient_id').notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    // Only consulted when recipientKind='customer'. Site-kind rows track read
    // state per collaborator in the notification_read table below.
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => ({
    recipientCreatedIdx: index('notification_recipient_created_idx').on(
      t.recipientKind,
      t.recipientId,
      t.createdAt.desc(),
    ),
  }),
);

export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;

// Per-collaborator read state for site-kind notifications. Absence of a row
// for (notification, customer) means "unread for that customer." The inbox
// query LEFT JOINs this table for site-kind rows; customer-kind rows use
// `notification.readAt` directly. Cascade-delete tracks the notification and
// the customer rows.
export const notificationRead = pgTable(
  'notification_read',
  {
    notificationId: text('notification_id')
      .notNull()
      .references(() => notification.id, { onDelete: 'cascade' }),
    customerId: text('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.notificationId, t.customerId] }),
    customerReadAtIdx: index('notification_read_customer_read_at_idx').on(
      t.customerId,
      t.readAt.desc(),
    ),
  }),
);

export type NotificationRead = typeof notificationRead.$inferSelect;
export type NewNotificationRead = typeof notificationRead.$inferInsert;

// -- collectionEntry (ADR 0060 — CMS-style entries) --------------------------
//
// One row per content entry (blog post, case study, etc.) for a given
// collection on a given site. After ADR 0063 F5 the canvas only ships
// `collection-item-template` pages (the retired `collection-index`
// value was replaced by element-level `CollectionElement.collectionSlug`);
// this table holds the actual content. A publish-time
// `materializeCollections` pass clones the template per published row in
// the matching collection and hydrates element-level Collection bindings.
//
// `collectionSlug` is the user-facing name ("blog", "notes") and groups
// entries within a site. Per-entry `slug` is unique within (site,
// collectionSlug) — the unique index in the migration enforces this and the
// API surfaces collisions as 409.
//
// `publishedDate` is an ISO date string (not a timestamp) because entries
// represent editorial dates the Owner controls, not row mutation times. The
// row mutation timestamp is `updatedAt` and is the tie-breaker for the
// last-writer-wins collaboration model documented in the ADR.
//
// `tags` is a `string[]` stored as jsonb — typed at the Drizzle layer with
// `$type<string[]>().default([])` so callers never see `unknown`.
export const COLLECTION_ENTRY_STATUSES = ['draft', 'published'] as const;
export type CollectionEntryStatus = (typeof COLLECTION_ENTRY_STATUSES)[number];

export const collectionEntry = pgTable(
  'collection_entry',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    siteId: text('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'cascade' }),
    collectionSlug: text('collection_slug').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt').notNull().default(''),
    body: text('body').notNull().default(''),
    publishedDate: text('published_date').notNull(),
    author: text('author').notNull().default(''),
    category: text('category').notNull().default(''),
    tags: jsonb('tags').notNull().$type<string[]>().default([]),
    ogImageAssetId: text('og_image_asset_id'),
    status: text('status').notNull().$type<CollectionEntryStatus>().default('draft'),
    /**
     * ADR 0063 dec 7 — optional sub-grouping within a `collectionSlug`. Owners
     * partition entries inside one slug ("tech notes" vs "design notes" in
     * `blog`) without forking taxonomy. `null` = ungrouped.
     *
     * Format constraint (`length <= 64`, no `/` or `\`) is enforced at the
     * API write boundary by Phase 2C — DB-level CHECK lives in drizzle 0018
     * so a direct SQL writer can't sneak in a malformed value either.
     */
    folder: text('folder'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteCollectionPublishedIdx: index('collection_entry_site_collection_published_idx').on(
      t.siteId,
      t.collectionSlug,
      t.publishedDate.desc(),
    ),
    // Narrow 2-column btree for the dashboard entries route's
    // `SELECT DISTINCT collection_slug ... WHERE site_id = ? GROUP BY
    // collection_slug` lookup. The planner prefers this index over the
    // wider 3-column one above for the GROUP BY rewrite because the page
    // size is smaller. Added in drizzle/0016 — see that file for the perf
    // motivation. Writes pay marginal extra btree maintenance.
    siteCollectionIdx: index('collection_entry_site_collection_idx').on(
      t.siteId,
      t.collectionSlug,
    ),
    siteCollectionSlugUnique: uniqueIndex('collection_entry_site_collection_slug_unique').on(
      t.siteId,
      t.collectionSlug,
      t.slug,
    ),
    // ADR 0063 dec 7 — folder-filtered listing index. The Collection
    // materializer reads `(siteId, collectionSlug, folder)` for the per-
    // element filter, ordered by `publishedDate DESC`. The trailing
    // `published_date` column keeps the same descending-date order the
    // un-foldered index above uses, so the two indexes have parallel shape.
    siteCollectionFolderPublishedIdx: index(
      'collection_entry_site_collection_folder_published_idx',
    ).on(t.siteId, t.collectionSlug, t.folder, t.publishedDate.desc()),
  }),
);

export type CollectionEntry = typeof collectionEntry.$inferSelect;
export type NewCollectionEntry = typeof collectionEntry.$inferInsert;

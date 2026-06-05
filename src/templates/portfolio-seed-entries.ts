// src/templates/portfolio-seed-entries.ts
//
// ADR 0060 F2. The portfolio-showcase fixture used to ship four mock blog
// post pages directly in `pages[]` (`page-pf-post-*`). After the CMS-entries
// migration, those pages are gone from the fixture and the blog template
// page (`page-pf-post-template`) carries `{{title}}`/`{{body}}`/etc.
// placeholders that the publish-time materializer substitutes from rows in
// `collection_entry`. To preserve the demo experience — a new site created
// from this template arrives with four sample posts already visible — these
// rows are inserted alongside the site row when `POST /api/sites` runs with
// `templateId === 'portfolio-showcase'`.
//
// Seeded rows are real `collection_entry` rows owned by the new site: the
// Owner can edit or delete them like any other entry, and deleting one does
// NOT bring it back. The seed exists only at site-create time.
//
// `body` is plain text with `\n\n` paragraph separators (no Markdown). When
// the template's body element is rendered, the renderer converts `\n` to
// `<br>` so paragraph breaks survive. If a future ADR lands rich-text body
// rendering on flagged TextElements, these bodies will still work — the
// renderer treats plain prose the same way.

import type { CollectionEntryStatus } from '../db/schema.js';

export interface SeedEntryRow {
  collectionSlug: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  publishedDate: string;
  author: string;
  category: string;
  tags: string[];
  ogImageAssetId: string | null;
  status: CollectionEntryStatus;
}

export const PORTFOLIO_SHOWCASE_SEED_ENTRIES: readonly SeedEntryRow[] = [
  {
    collectionSlug: 'blog',
    slug: 'demos-lie',
    title: 'Demos lie. Week three is the only honest metric.',
    excerpt:
      "The first demo is easy. Week three — when the energy fades and the bug surface hasn't — is where the engineering happens.",
    body: [
      "Most demos work. That's the trap. A demo is a controlled environment with a known input, a friendly audience, and a fifteen-minute attention budget. It tells you almost nothing about whether the thing will survive contact with a real user.",
      "Week three is when the honest signal arrives. By then the launch energy has burned off, the bug surface has not, and the user has discovered all the affordances you forgot to build. If the thing is still in their workflow at week three, you built something. If it isn't, the demo lied.",
      'What week three actually measures',
      'The fact that the user returned to do real work — not curiosity, not novelty, not the same five clicks they did the first time. It measures whether the edges of the product hold up: the empty state, the error case, the upgrade path, the boring repeat task on a Tuesday afternoon. None of that shows up in a launch demo. All of it shows up at week three.',
      'How to build for it',
      "Ship the boring parts first. The thing that loads when the database is empty. The error that fires when the third-party API is down. The path the user takes after they finish the canonical flow and need to do it again. If your demo skips these, you've built a trailer, not a product.",
    ].join('\n\n'),
    publishedDate: '2026-04-14',
    author: 'Aayushman Singh',
    category: 'notes',
    tags: ['product', 'engineering', 'principles'],
    ogImageAssetId: null,
    status: 'published',
  },
  {
    collectionSlug: 'blog',
    slug: 'jarvis-self-healing-ci',
    title: 'Three-tier self-healing CI: how Jarvis closes its own PRs',
    excerpt:
      'Runner LLMs grind implementation against your tests. Claude reviews. You merge. A three-tier brain split across processes — and why no tier ever gets to decide.',
    body: [
      "Most autonomous agent designs fall over in the same place: the agent gets to decide. Mine doesn't. The runner LLM grinds implementation against tests I wrote. Claude reviews. I merge. Nobody in this loop is allowed to ship without a check from the next person up.",
      'Tier 0: the runner workhorse',
      'Tier 0 sees TASK.md and your tests. It picks a model per task — Sonnet for most things, Opus when the spec is gnarly, Haiku for plumbing. The runner writes code, runs the tests, eats the failures, tries again. It is allowed to fail. It is not allowed to decide what to ship.',
      'Tier 1: review before the PR',
      "Tier 1 is Claude in review mode, fresh context, no access to the runner's prior turns. The runner produces a patch; Claude reads the diff against the spec, flags drift, asks for revisions in a tone that does not negotiate. Only when the review passes does the patch land on an agent/ branch.",
      'Tier 2: you merge',
      "The agent never merges. That's not paranoia — it's design. Safety here doesn't come from trust, it comes from constraints. The agent earns autonomy on the parts you've already mechanised: tests, lint, review. Everything else still routes through a human.",
    ].join('\n\n'),
    publishedDate: '2026-03-22',
    author: 'Aayushman Singh',
    category: 'notes',
    tags: ['agents', 'ci', 'claude-sdk'],
    ogImageAssetId: null,
    status: 'published',
  },
  {
    collectionSlug: 'blog',
    slug: 'local-first-honest',
    title: "Local-first is not a buzzword — it's the only honest software",
    excerpt:
      "If your app stops working when the server goes down, you don't have software — you have a thin client to someone else's database.",
    body: [
      'Software that needs a server to start is a thin client. Software that needs a server to save is a thin client with delusions. Local-first is just the position that your data and your runtime should keep working when the network goes away — because the network always, eventually, goes away.',
      'The honesty test',
      "Turn off your wifi. Open the app. Does it load? Can you make a change? Does the change persist after a restart? If three answers are yes, you have software. If one is no, you have a marketing claim wrapped around someone else's database.",
      'Sync is a feature, not the substrate',
      'Local-first does not mean offline-only. It means the local copy is the authoritative one, and sync is an additive convenience — a CRDT, a log shipped to a server, a peer-to-peer pull from a friend. The substrate is your machine; the cloud is a participant. Once you frame it that way, half the failure modes that haunt modern apps stop being problems and start being design choices.',
    ].join('\n\n'),
    publishedDate: '2026-02-09',
    author: 'Aayushman Singh',
    category: 'notes',
    tags: ['local-first', 'principles', 'architecture'],
    ogImageAssetId: null,
    status: 'published',
  },
  {
    collectionSlug: 'blog',
    slug: 'state-trust',
    title: 'Building software the State will trust',
    excerpt:
      'Notes from shipping OSINT tooling that landed inside an investigative agency — what changes when the buyer is a department, not a user.',
    body: [
      'Shipping for a department instead of a user changes the product. The user is one investigator with six hours to file a report. The department is the chain of custody, the procurement officer, the audit log, and the constitutional limit nobody reads but everybody enforces. Both are real. Neither is optional.',
      'Outputs that survive court',
      "Every artifact your tool produces will end up in front of a defence lawyer who is paid to take it apart. That means hashes at every stage, timestamps that match the device clock, raw blobs alongside the parsed views, and a written description of the pipeline that doesn't change between releases. Anything less and the report is suggestive, not evidentiary.",
      'Constraints come first',
      'Air-gapped install. No telemetry. Per-user keys with rotation logs. The temptation in a startup is to defer all of this and ship features. The State will not deploy the result. Build the constraints first, then put features on top of them; the order is load-bearing and switching it costs you the customer.',
    ].join('\n\n'),
    publishedDate: '2026-01-03',
    author: 'Aayushman Singh',
    category: 'notes',
    tags: ['osint', 'government', 'deployment'],
    ogImageAssetId: null,
    status: 'published',
  },
];

/** Map of templateId → seeded entry rows inserted alongside a new site
 *  created from that template. Templates with no seed list contribute zero
 *  rows. Today only `portfolio-showcase` carries a seed; new entries here
 *  belong with whichever template's demo experience needs them. */
export const TEMPLATE_SEED_ENTRIES: Record<string, readonly SeedEntryRow[]> = {
  'portfolio-showcase': PORTFOLIO_SHOWCASE_SEED_ENTRIES,
};

// -----------------------------------------------------------------------------
// "+ New Collection" wizard seeds (ADR 0063 dec 11)
// -----------------------------------------------------------------------------
//
// When the Owner clicks "+ New Collection", the scaffold endpoint creates two
// real `collection_entry` rows so the freshly-minted Collection element renders
// as a multi-card grid the moment the Owner lands on the index page (no
// placeholder banner). The rows are real DB rows — the Owner edits or deletes
// them from the Entries dashboard like any other entry.
//
// Per ADR 0063 dec 11 constraint: "Sample content that pretends to be real but
// isn't is forbidden." These rows live in `collection_entry` like any other
// row; the materializer treats them no differently. The wizard's only role is
// inserting them; once inserted they belong to the site, not the wizard.
//
// `publishedDate` for the two rows is "today" and "yesterday" relative to the
// wizard call, so the date-desc default sort displays them in the obvious
// order on the first render.

/** Compute an ISO-date (YYYY-MM-DD) for `daysAgo` days before `now`.
 *  Exposed (not just used inline) so the smoke can mint deterministic rows by
 *  passing a fixed `now`. */
export function isoDateDaysAgo(now: Date, daysAgo: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Two seed rows for the "+ New Collection" wizard, bound to `collectionSlug`.
 *  Pure: caller (the POST endpoint) annotates each row with the new site's id
 *  before inserting. The shapes match `NewCollectionEntry` minus `siteId` and
 *  the DB-defaulted `id`/`createdAt`/`updatedAt` columns. */
export function wizardSeedEntries(collectionSlug: string, now: Date): SeedEntryRow[] {
  const today = isoDateDaysAgo(now, 0);
  const yesterday = isoDateDaysAgo(now, 1);
  return [
    {
      collectionSlug,
      slug: 'welcome-to-your-blog',
      title: 'Welcome to your blog',
      excerpt: 'A short intro to your new blog.',
      body:
        '# Welcome\n\n' +
        'This is a real entry — edit it from the Entries dashboard tab, or delete it. ' +
        'Your second post shows what a multi-entry list looks like.\n\n' +
        'Add more entries any time. The card layout you see here is auto-generated ' +
        "from this entry's title, excerpt, and OG image.",
      publishedDate: today,
      author: 'You',
      category: '',
      tags: [],
      ogImageAssetId: null,
      status: 'published',
    },
    {
      collectionSlug,
      slug: 'your-second-post',
      title: 'Your second post',
      excerpt: 'Another post so the grid has more than one card.',
      body:
        '# Second post\n\n' +
        'Delete me when you write your first real entry. I exist so your home page ' +
        'shows what a multi-entry blog feels like.',
      publishedDate: yesterday,
      author: 'You',
      category: '',
      tags: [],
      ogImageAssetId: null,
      status: 'published',
    },
  ];
}

// Theme studio route — GET/POST /dashboard/sites/:siteId/theme
//
// Server-renders a palette-seed form, a live preview using the derived OKLCH
// token graph (src/theme/derive.ts), a swatch table of the twelve tokens, and
// a fg vs bg WCAG contrast matrix. Save POSTs back to the same URL, writes
// site.tokens, then redirects with ?saved=1.
//
// Ownership is verified via Clerk userId -> customer.id -> site.customer_id.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';
import type { ThemeDensity, ThemeRadius, ThemeTokenSet } from '../../document/schema';
import { checkContrast, type ContrastResult } from '../../theme/contrast';
import {
  deriveTokens,
  THEME_TOKEN_NAMES,
  TOKEN_TO_CSS_VAR,
  tokensToHexMap,
  type ThemeTokenName,
  type ThemeTokens,
} from '../../theme/derive';
import { toCss } from '../../theme/oklch';
import { styles } from './theme.styles';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const theme = new Hono<Env>();

theme.use('*', clerkAuth());
theme.use('*', requireAuth());

// ---------------------------------------------------------------------------
// Spec defaults (docs/specs/template-schema.md §2).
// ---------------------------------------------------------------------------

const DEFAULT_TOKENS: ThemeTokenSet = {
  paletteSeed: '#0a0e1a',
  font: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans' },
  radius: 'md',
  density: 'normal',
};

const FONT_CHOICES = ['IBM Plex Sans', 'IBM Plex Mono', 'IBM Plex Serif'] as const;
type FontChoice = (typeof FONT_CHOICES)[number];

const RADIUS_CHOICES: readonly ThemeRadius[] = ['none', 'sm', 'md', 'lg', 'full'] as const;
const DENSITY_CHOICES: readonly ThemeDensity[] = ['compact', 'normal', 'comfortable'] as const;

const RADIUS_PX: Record<ThemeRadius, string> = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '16px',
  full: '999px',
};

// Background tokens that take fg pairing in the contrast matrix.
const BG_TOKENS: readonly ThemeTokenName[] = [
  'bgDeep',
  'bgPanel',
  'bgPanelStrong',
  'accent',
  'warn',
  'ok',
  'err',
];

// Foreground tokens (rendered as the column dimension).
const FG_TOKENS: readonly ThemeTokenName[] = ['fg', 'fgMute', 'accent'];

// ---------------------------------------------------------------------------
// Ownership lookup.
// ---------------------------------------------------------------------------

interface OwnedSite {
  id: string;
  name: string;
  tokens: ThemeTokenSet;
}

async function lookupOwnedSite(
  env: Bindings,
  clerkUserId: string,
  siteId: string,
): Promise<OwnedSite | null> {
  const database = db(env);
  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      tokens: site.tokens,
    })
    .from(site)
    .innerJoin(customer, eq(customer.id, site.customerId))
    .where(and(eq(site.id, siteId), eq(customer.clerkUserId, clerkUserId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, tokens: row.tokens };
}

// ---------------------------------------------------------------------------
// Normalisation. On load: stamp defaults onto missing fields.
// On save: validate the form input against the same shape.
// ---------------------------------------------------------------------------

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normaliseLoaded(tokens: ThemeTokenSet | null | undefined): ThemeTokenSet {
  if (!tokens || typeof tokens !== 'object') {
    return { ...DEFAULT_TOKENS, font: { ...DEFAULT_TOKENS.font } };
  }
  const seed =
    typeof tokens.paletteSeed === 'string' && HEX_RE.test(tokens.paletteSeed)
      ? tokens.paletteSeed
      : DEFAULT_TOKENS.paletteSeed;
  const heading = isFontChoice(tokens.font?.heading)
    ? tokens.font.heading
    : DEFAULT_TOKENS.font.heading;
  const body = isFontChoice(tokens.font?.body) ? tokens.font.body : DEFAULT_TOKENS.font.body;
  const radius = isRadius(tokens.radius) ? tokens.radius : DEFAULT_TOKENS.radius;
  const density = isDensity(tokens.density) ? tokens.density : DEFAULT_TOKENS.density;
  return { paletteSeed: seed, font: { heading, body }, radius, density };
}

function isFontChoice(v: unknown): v is FontChoice {
  return typeof v === 'string' && (FONT_CHOICES as readonly string[]).includes(v);
}
function isRadius(v: unknown): v is ThemeRadius {
  return typeof v === 'string' && (RADIUS_CHOICES as readonly string[]).includes(v);
}
function isDensity(v: unknown): v is ThemeDensity {
  return typeof v === 'string' && (DENSITY_CHOICES as readonly string[]).includes(v);
}

interface ParsedForm {
  ok: true;
  tokens: ThemeTokenSet;
}
interface ParseError {
  ok: false;
  message: string;
}

function parseSaveForm(form: Record<string, unknown>): ParsedForm | ParseError {
  const seedRaw = typeof form.paletteSeed === 'string' ? form.paletteSeed.trim() : '';
  if (!HEX_RE.test(seedRaw)) {
    return {
      ok: false,
      message: `paletteSeed must be a 3- or 6-digit hex literal (got "${seedRaw}")`,
    };
  }
  const heading = isFontChoice(form.fontHeading) ? form.fontHeading : null;
  const body = isFontChoice(form.fontBody) ? form.fontBody : null;
  if (!heading) return { ok: false, message: 'fontHeading is not one of the allowed choices' };
  if (!body) return { ok: false, message: 'fontBody is not one of the allowed choices' };
  if (!isRadius(form.radius)) {
    return { ok: false, message: 'radius is not one of the allowed choices' };
  }
  if (!isDensity(form.density)) {
    return { ok: false, message: 'density is not one of the allowed choices' };
  }
  return {
    ok: true,
    tokens: {
      paletteSeed: seedRaw.toLowerCase(),
      font: { heading, body },
      radius: form.radius,
      density: form.density,
    },
  };
}

// ---------------------------------------------------------------------------
// Page render.
// ---------------------------------------------------------------------------

function previewVarBlock(derived: ThemeTokens, tokens: ThemeTokenSet): string {
  // Re-scope the studio's own preview pane: the derived token graph lives on
  // CSS custom properties prefixed `--t-` so it does not collide with the
  // page chrome (which uses `--bg-deep` etc.).
  const decls = THEME_TOKEN_NAMES.map((name) => {
    const variable = TOKEN_TO_CSS_VAR[name].replace('--rev01-', '--t-');
    return `${variable}: ${toCss(derived[name])};`;
  }).join(' ');
  const radiusPx = RADIUS_PX[tokens.radius];
  return `${decls} --t-radius-px: ${radiusPx}; --t-font-heading: ${cssIdent(tokens.font.heading)}; --t-font-body: ${cssIdent(tokens.font.body)};`;
}

function cssIdent(s: string): string {
  // Allow alphanumerics + spaces; everything else stripped so the font name
  // cannot break out of a style attribute. Wrapped in quotes at use-site.
  const stripped = s.replace(/[^A-Za-z0-9 ]/g, '');
  return `'${stripped}', system-ui, sans-serif`;
}

interface PageProps {
  ownedSite: OwnedSite;
  tokens: ThemeTokenSet;
  saved: boolean;
}

function Page({ ownedSite, tokens, saved }: PageProps) {
  const derived = deriveTokens(tokens.paletteSeed);
  const hexMap = tokensToHexMap(derived);
  const previewVars = previewVarBlock(derived, tokens);

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>rev01 — theme · {ownedSite.name}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:wght@400;500;600&display=swap"
        />
        <style>{raw(styles)}</style>
      </head>
      <body>
        <main>
          <div class="topbar">
            <span class="crumbs">
              <span>rev01</span>
              <span class="sep">/</span>
              <span>{ownedSite.name}</span>
              <span class="sep">/</span>
              <span class="here">theme</span>
            </span>
            <nav>
              <a href="/dashboard">Dashboard</a>
              <a href="/dashboard/templates">Templates</a>
              <a href={`/dashboard/sites/${ownedSite.id}/theme`} class="active">
                Theme
              </a>
            </nav>
          </div>

          <header class="head">
            <div>
              <h1>
                <span class="accent">{ownedSite.name}</span> · theme
              </h1>
              <p class="sub">
                Pick a palette seed; rev01 derives twelve OKLCH tokens from it and audits every
                foreground vs background pairing against WCAG AA/AAA in real time.
              </p>
            </div>
            {saved ? <span class="saved">saved</span> : null}
          </header>

          <section class="studio">
            <article class="panel">
              <h2>palette</h2>
              <form
                method="post"
                action={`/dashboard/sites/${ownedSite.id}/theme`}
                class="studio-form"
              >
                <div class="field">
                  <label for="paletteSeed">seed colour</label>
                  <div class="seed">
                    <input
                      type="color"
                      id="paletteSeed-color"
                      name="paletteSeedColor"
                      value={tokens.paletteSeed}
                      aria-label="palette seed colour picker"
                    />
                    <input
                      type="text"
                      id="paletteSeed"
                      name="paletteSeed"
                      value={tokens.paletteSeed}
                      pattern="#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})"
                      maxlength={7}
                      required
                    />
                  </div>
                </div>

                <FontField
                  name="fontHeading"
                  label="heading font"
                  selected={
                    isFontChoice(tokens.font.heading) ? tokens.font.heading : FONT_CHOICES[0]
                  }
                />
                <FontField
                  name="fontBody"
                  label="body font"
                  selected={isFontChoice(tokens.font.body) ? tokens.font.body : FONT_CHOICES[0]}
                />
                <SegmentedField
                  name="radius"
                  label="corner radius"
                  options={RADIUS_CHOICES}
                  selected={tokens.radius}
                />
                <SegmentedField
                  name="density"
                  label="density"
                  options={DENSITY_CHOICES}
                  selected={tokens.density}
                />

                <button type="submit" class="save">
                  save theme
                </button>
              </form>
            </article>

            <article class="panel">
              <h2>preview</h2>
              <div class="preview">
                <div class="preview-frame" style={previewVars}>
                  <span class="preview-eyebrow">// live preview</span>
                  <h3>{ownedSite.name} — your hero headline</h3>
                  <p>
                    Body copy renders with derived foreground and muted tokens. Buttons and accents
                    flow from the same seed; warn/ok/err stay fixed so destructive actions still
                    look dangerous.
                  </p>
                  <div class="preview-actions">
                    <a class="primary" href="#" onclick="return false">
                      Primary action
                    </a>
                    <a class="ghost" href="#" onclick="return false">
                      Secondary
                    </a>
                  </div>
                  <div class="preview-media" aria-hidden="true">
                    media placeholder · 16 / 7
                  </div>
                </div>
              </div>
            </article>
          </section>

          <section class="panel tokens" aria-labelledby="tokens-head">
            <h2 id="tokens-head">twelve derived tokens</h2>
            <table>
              <thead>
                <tr>
                  <th aria-label="swatch" />
                  <th>name</th>
                  <th>oklch</th>
                  <th>hex</th>
                </tr>
              </thead>
              <tbody>
                {THEME_TOKEN_NAMES.map((name) => (
                  <tr>
                    <td class="swatch-cell">
                      <span
                        class="swatch"
                        style={`background: ${toCss(derived[name])};`}
                        aria-hidden="true"
                      />
                    </td>
                    <td class="name">{name}</td>
                    <td class="value">{toCss(derived[name])}</td>
                    <td class="value">{hexMap[name]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section class="panel matrix" aria-labelledby="matrix-head">
            <h2 id="matrix-head">contrast matrix · fg × bg</h2>
            <table>
              <thead>
                <tr>
                  <th class="row-label">background ↓ / fg →</th>
                  {FG_TOKENS.map((f) => (
                    <th>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BG_TOKENS.map((bg) => (
                  <tr>
                    <th class="row-label">{bg}</th>
                    {FG_TOKENS.map((fg) => {
                      const result = checkContrast(derived[fg], derived[bg]);
                      return (
                        <td>
                          <ContrastCell result={result} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <footer>
            <span class="pip" /> rev01 / theme studio · derivation rules in src/theme/SUBSYSTEM.md
          </footer>
        </main>
        {raw(syncScript())}
      </body>
    </html>
  );
}

function FontField({
  name,
  label,
  selected,
}: {
  name: 'fontHeading' | 'fontBody';
  label: string;
  selected: FontChoice;
}) {
  return (
    <div class="field">
      <label>{label}</label>
      <div class="segmented" role="radiogroup" aria-label={label}>
        {FONT_CHOICES.map((opt, i) => {
          const id = `${name}-${String(i)}`;
          return (
            <>
              <input
                type="radio"
                id={id}
                name={name}
                value={opt}
                checked={opt === selected}
                required
              />
              <label for={id}>{opt.replace('IBM Plex ', '')}</label>
            </>
          );
        })}
      </div>
    </div>
  );
}

function SegmentedField<T extends string>({
  name,
  label,
  options,
  selected,
}: {
  name: string;
  label: string;
  options: readonly T[];
  selected: T;
}) {
  return (
    <div class="field">
      <label>{label}</label>
      <div class="segmented" role="radiogroup" aria-label={label}>
        {options.map((opt, i) => {
          const id = `${name}-${String(i)}`;
          return (
            <>
              <input
                type="radio"
                id={id}
                name={name}
                value={opt}
                checked={opt === selected}
                required
              />
              <label for={id}>{opt}</label>
            </>
          );
        })}
      </div>
    </div>
  );
}

function ContrastCell({ result }: { result: ContrastResult }) {
  const ratio = result.ratio.toFixed(2);
  return (
    <>
      <span class="ratio">{ratio}</span> <span class={`verdict ${result.aaNormal}`}>AA</span>
      <span class={`verdict ${result.aaaNormal}`}>AAA</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline sync script — keeps the colour picker and the hex text input in
// step so the operator sees one source of truth. No framework, no fetch; the
// form still posts normally. Re-derivation server-side on save.
// ---------------------------------------------------------------------------

function syncScript(): string {
  return `<script type="module">
const colorEl = document.getElementById('paletteSeed-color');
const textEl = document.getElementById('paletteSeed');
if (colorEl && textEl) {
  colorEl.addEventListener('input', () => { textEl.value = colorEl.value; });
  textEl.addEventListener('input', () => {
    const v = textEl.value.trim();
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      const expanded = v.length === 4
        ? '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]
        : v;
      colorEl.value = expanded;
    }
  });
}
</script>`;
}

// ---------------------------------------------------------------------------
// Routes.
// ---------------------------------------------------------------------------

theme.get('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('GET /dashboard/sites/:siteId/theme reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.text('missing siteId', 400);
  }
  const owned = await lookupOwnedSite(c.env, auth.userId, siteId);
  if (!owned) {
    return c.text('site not found or not owned by current user', 404);
  }
  const tokens = normaliseLoaded(owned.tokens);
  const saved = c.req.query('saved') === '1';
  return c.html(<Page ownedSite={owned} tokens={tokens} saved={saved} />);
});

theme.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('POST /dashboard/sites/:siteId/theme reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.text('missing siteId', 400);
  }
  const owned = await lookupOwnedSite(c.env, auth.userId, siteId);
  if (!owned) {
    return c.text('site not found or not owned by current user', 404);
  }
  const form = await c.req.parseBody();
  const parsed = parseSaveForm(form);
  if (!parsed.ok) {
    return c.text(`bad theme form: ${parsed.message}`, 400);
  }
  const database = db(c.env);
  await database.update(site).set({ tokens: parsed.tokens }).where(eq(site.id, owned.id));
  return c.redirect(`/dashboard/sites/${owned.id}/theme?saved=1`, 303);
});

export default theme;

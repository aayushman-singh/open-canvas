# legacy coming-soon

Legacy single-file static page kept for reference. The live Pages deploy now
serves the generated Post-Aero landing from `src/landing/`.

## Live URL

- https://rev01.aayushman.dev
- Origin: Cloudflare Pages project `rev01-coming-soon` (`*.pages.dev`)

## Deploy manually

```bash
# from repo root, with CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID exported
bun install --frozen-lockfile
bun run landing:preview
mkdir -p .pages
cp src/landing/PREVIEW.html .pages/index.html
npx wrangler@latest pages deploy .pages \
  --project-name rev01-coming-soon \
  --branch main
```

## Automated deploy

`.github/workflows/deploy-coming-soon.yml` re-deploys the generated landing on
every push to `main` that touches `src/landing/**`, `package.json`, `bun.lock`,
or the workflow itself.

# coming-soon

Single-file static page served at `https://rev01.aayushman.dev` until the real
landing page lands.

## Live URL

- https://rev01.aayushman.dev
- Origin: Cloudflare Pages project `rev01-coming-soon` (`*.pages.dev`)

## Deploy manually

```bash
# from repo root, with CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID exported
npx wrangler@latest pages deploy coming-soon \
  --project-name rev01-coming-soon \
  --branch main
```

## Automated deploy

`.github/workflows/deploy-coming-soon.yml` re-deploys on every push to `main`
that touches `coming-soon/**`.

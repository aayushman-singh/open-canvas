// Worker cron dispatcher. The Worker default export in src/index.ts wires
// `scheduled` here; the cron expression itself lives in wrangler.toml under
// `[triggers]`. Per-feature scheduled tasks live next to the feature they
// belong to and re-export their handler from this file so the entry stays
// free of per-feature cron knowledge.

import { scheduled as customDomainScheduled } from './custom-domain/cron';

export const scheduled = customDomainScheduled;

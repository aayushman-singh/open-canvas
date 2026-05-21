import { validateDocument } from '../document/validate';
import { templates } from './registry';

declare const process: { exit: (code: number) => never };

let failed = false;
let totalDocs = 0;

for (const t of templates) {
  for (const page of t.pages) {
    totalDocs++;
    const result = validateDocument(page.doc);
    if (!result.valid) {
      failed = true;
      console.error(`[validate-seeds] ${t.id} ${page.slug}: invalid`);
      for (const e of result.errors) console.error(`  - ${e}`);
      continue;
    }
    console.log(`[validate-seeds] ${t.id} ${page.slug}: ok`);
  }
}

if (failed) {
  console.error('[validate-seeds] FAILED');
  process.exit(1);
}
console.log(`[validate-seeds] ${totalDocs} doc(s) across ${templates.length} template(s): OK`);

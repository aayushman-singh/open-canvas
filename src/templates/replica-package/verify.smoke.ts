import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileReplicaPackage } from './compiler.js';
import { verifyReplicaOutputs } from './verify.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[replica-package-verify:smoke] ${message}`);
}

const repoRoot = await mkdtemp(join(tmpdir(), 'replica-verify-'));
const result = await compileReplicaPackage({
  sourceDir: 'src/templates/replicas/tiny-replica',
  target: 'both',
  repoRoot,
  importOutDir: join(repoRoot, 'tmp', 'replicas'),
});

await verifyReplicaOutputs({
  sourceDir: 'src/templates/replicas/tiny-replica',
  compileReport: result,
  importOutDir: join(repoRoot, 'tmp', 'replicas'),
});

const generatedSmokePath = join(repoRoot, 'src', 'templates', 'tiny-replica.replica.smoke.ts');
const generatedSmoke = await readFile(generatedSmokePath, 'utf8');
assert(
  generatedSmoke.includes("getTemplateSeed('tiny-replica')") &&
    generatedSmoke.includes('seed-tiny-replica-mark') &&
    generatedSmoke.includes('custom-cursor'),
  'compiler must generate seed replica smoke with registration, asset, and unsupported checks',
);

const report = JSON.parse(await readFile(join(repoRoot, 'tmp', 'replicas', 'tiny-replica', 'report.json'), 'utf8')) as {
  unsupported?: { id?: string }[];
  fidelityLedger?: { id?: string }[];
};
assert(report.unsupported?.some((item) => item.id === 'custom-cursor'), 'report must include unsupported finding');
assert(report.fidelityLedger?.some((item) => item.id === 'hero-copy'), 'report must include fidelity ledger');

console.log('[replica-package-verify:smoke] OK');

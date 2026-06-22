import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileReplicaPackage } from './compiler.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[replica-package-compiler:smoke] ${message}`);
}

const repoRoot = await mkdtemp(join(tmpdir(), 'replica-compile-'));
await mkdir(join(repoRoot, 'src', 'canvas', 'section-library', 'entries'), { recursive: true });
await mkdir(join(repoRoot, 'src', 'assets', 'seed-source'), { recursive: true });
await mkdir(join(repoRoot, 'src', 'canvas'), { recursive: true });
await mkdir(join(repoRoot, 'src', 'templates', 'generated'), { recursive: true });
await mkdir(join(repoRoot, 'src', 'templates'), { recursive: true });

const result = await compileReplicaPackage({
  sourceDir: 'src/templates/replicas/tiny-replica',
  target: 'both',
  repoRoot,
  importOutDir: join(repoRoot, 'tmp', 'replicas'),
});

assert(result.replicaId === 'tiny-replica', 'compile result must preserve replica id');
assert(result.target === 'both', 'compile result must preserve requested target');

const normalizedWrittenFiles = result.writtenFiles.map((file) => file.replace(/\\/g, '/'));

assert(
  normalizedWrittenFiles.some((file) => file.endsWith('src/templates/generated/tiny-replica.ts')),
  'seed target must write generated template file',
);
assert(
  normalizedWrittenFiles.some((file) => file.endsWith('tmp/replicas/tiny-replica/editable-site.json')),
  'import target must write editable-site.json',
);

const generatedTemplate = await readFile(join(repoRoot, 'src', 'templates', 'generated', 'tiny-replica.ts'), 'utf8');
assert(
  generatedTemplate.includes('id: "tiny-replica"') &&
    generatedTemplate.includes('sectionId: "tiny-replica-hero-v1"'),
  'generated template must contain deterministic template and section refs',
);

const generatedRegistry = await readFile(join(repoRoot, 'src', 'canvas', 'seed-assets.generated.ts'), 'utf8');
assert(
  generatedRegistry.includes('seed-tiny-replica-mark') &&
    generatedRegistry.includes('tiny-replica-mark.svg.b64'),
  'generated seed asset registry must include tiny asset',
);

const editableSite = JSON.parse(await readFile(join(repoRoot, 'tmp', 'replicas', 'tiny-replica', 'editable-site.json'), 'utf8')) as {
  pages?: { sections?: { elements?: { id?: string }[] }[] }[];
};
assert(
  editableSite.pages?.[0]?.sections?.[0]?.elements?.some((element) => element.id === 'tiny-replica-heading'),
  'import target must materialize package sections into editable-site.json',
);

let invalidTargetFailed = false;
try {
  await compileReplicaPackage({
    sourceDir: 'src/templates/replicas/tiny-replica',
    target: 'preview' as never,
    repoRoot,
    importOutDir: join(repoRoot, 'tmp', 'replicas'),
  });
} catch (error) {
  invalidTargetFailed =
    error instanceof Error && error.message.includes('unsupported target preview');
}
assert(invalidTargetFailed, 'compiler must fail loudly on unsupported target');

console.log('[replica-package-compiler:smoke] OK');

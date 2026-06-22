import { compileReplicaPackage, type CompileReplicaPackageInput } from '../src/templates/replica-package/compiler.js';

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function usage(): never {
  throw new Error(
    [
      'Usage:',
      '  bun run replica compile --source <dir> --target seed|import|both',
    ].join('\n'),
  );
}

const command = process.argv[2];
if (command !== 'compile') usage();

const sourceDir = valueAfter('--source');
const target = valueAfter('--target');
if (!sourceDir || !target) usage();
if (target !== 'seed' && target !== 'import' && target !== 'both') {
  throw new Error(`replica: --target must be seed, import, or both (got ${target})`);
}

const input: CompileReplicaPackageInput = {
  sourceDir,
  target,
};

const result = await compileReplicaPackage(input);
console.log(
  JSON.stringify(
    {
      replicaId: result.replicaId,
      target: result.target,
      writtenFiles: result.writtenFiles,
      unsupported: result.unsupported.map((item) => item.id),
      fidelity: result.fidelityLedger.map((item) => ({ id: item.id, status: item.status })),
    },
    null,
    2,
  ),
);

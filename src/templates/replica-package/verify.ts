import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadReplicaPackage } from './load.js';
import type { ReplicaCompileReport } from './types.js';

export interface VerifyReplicaOutputsInput {
  sourceDir: string;
  compileReport: ReplicaCompileReport;
  importOutDir: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`replica-verify: ${message}`);
}

export async function verifyReplicaOutputs(input: VerifyReplicaOutputsInput): Promise<void> {
  const pkg = await loadReplicaPackage(input.sourceDir);
  const report = input.compileReport;
  assert(report.replicaId === pkg.metadata.id, 'compile report replica id mismatch');
  for (const item of pkg.fidelityLedger) {
    if (item.status === 'native') {
      assert(Array.isArray(item.evidence) && item.evidence.length > 0, `native fidelity item ${item.id} must include evidence`);
    }
    if (item.status === 'unsupported') {
      assert(
        pkg.unsupported.some((finding) => finding.id === item.unsupportedId),
        `unsupported fidelity item ${item.id} must reference unsupported finding`,
      );
    }
  }
  if (report.target === 'import' || report.target === 'both') {
    const reportPath = join(input.importOutDir, pkg.metadata.id, 'report.json');
    const parsed = JSON.parse(await readFile(reportPath, 'utf8')) as ReplicaCompileReport;
    assert(parsed.replicaId === pkg.metadata.id, 'report.json replica id mismatch');
    assert(parsed.unsupported.length === pkg.unsupported.length, 'report.json unsupported finding count mismatch');
    assert(parsed.fidelityLedger.length === pkg.fidelityLedger.length, 'report.json fidelity ledger count mismatch');
  }
}

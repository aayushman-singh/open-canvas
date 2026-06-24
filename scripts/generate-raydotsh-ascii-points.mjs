import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outputPath = join(repoRoot, 'src/templates/raydotsh-ascii-points.ts');
const defaultSourceUrl =
  'https://raw.githubusercontent.com/raydotsh/raydotsh.github.io/main/src/assets/asciiData.js';

const BREAKPOINT_BY_SIZE = {
  220: 'phone',
  280: 'tablet',
  400: 'desktop',
};

async function loadAsciiData(source) {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch asciiData.js (${response.status} ${response.statusText})`);
    }
    return response.text();
  }

  const { readFileSync } = await import('node:fs');
  return readFileSync(source, 'utf8');
}

function parseAsciiData(sourceText) {
  const start = sourceText.indexOf('{');
  const end = sourceText.lastIndexOf('};');
  if (start < 0 || end < 0) {
    throw new Error('Could not locate asciiData object in source file');
  }
  const objectLiteral = sourceText.slice(start, end + 1);
  return Function(`"use strict"; return (${objectLiteral});`)();
}

function toPointSets(asciiData) {
  const pointSets = [];
  for (const [sizeText, breakpoint] of Object.entries(BREAKPOINT_BY_SIZE)) {
    const size = Number(sizeText);
    const points = asciiData[size];
    if (!Array.isArray(points) || points.length === 0) {
      throw new Error(`asciiData is missing a non-empty point array for size ${size}`);
    }
    pointSets.push({
      breakpoint,
      canvasSize: size,
      points,
    });
  }
  return pointSets;
}

function renderModule(pointSets) {
  return `import type { ParticleFieldPointSet } from '../canvas/behaviour-primitives.js';

// Generated from raydotsh.github.io/src/assets/asciiData.js.
export const RAYDOTSH_ASCII_POINT_SETS: ParticleFieldPointSet[] = ${JSON.stringify(pointSets)};
`;
}

async function main() {
  const source = process.argv[2] ?? process.env.RAYDOTSH_ASCII_SOURCE ?? defaultSourceUrl;
  const sourceText = await loadAsciiData(source);
  const asciiData = parseAsciiData(sourceText);
  const pointSets = toPointSets(asciiData);
  writeFileSync(outputPath, renderModule(pointSets), 'utf8');
  console.log(
    `[generate:raydotsh-ascii-points] Wrote ${pointSets.length} point sets to ${outputPath}`,
  );
}

main().catch((error) => {
  console.error('[generate:raydotsh-ascii-points] Failed:', error);
  process.exit(1);
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createTemplateSourcePullRequest, requireTemplateSourceGitHubConfig } from './source-admin-github.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[source-admin-github:smoke] ${message}`);
}

type FetchCall = {
  method: string;
  url: string;
  body: Record<string, unknown>;
};

const calls: FetchCall[] = [];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {};
  const parsed: unknown = JSON.parse(init.body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected request body to be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

const fetchOk = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = requestUrl(input);
  const method = init?.method ?? 'GET';
  const body = requestBody(init);
  calls.push({ method, url, body });

  if (method === 'GET' && url.endsWith('/git/ref/heads/main')) {
    return Promise.resolve(Response.json({ object: { sha: 'base-sha' } }));
  }
  if (method === 'POST' && url.endsWith('/git/refs')) {
    return Promise.resolve(
      Response.json({ ref: body.ref, object: { sha: body.sha } }, { status: 201 }),
    );
  }
  if (
    method === 'GET' &&
    url.includes('/contents/src/canvas/section-library/entries/starter-template-hero.json')
  ) {
    return Promise.resolve(Response.json({ sha: 'source-file-sha' }));
  }
  if (
    method === 'PUT' &&
    url.includes('/contents/src/canvas/section-library/entries/starter-template-hero.json')
  ) {
    return Promise.resolve(Response.json({ commit: { sha: 'commit-sha' } }));
  }
  if (method === 'POST' && url.endsWith('/pulls')) {
    return Promise.resolve(
      Response.json({ html_url: 'https://github.com/aayushman-singh/open-canvas/pull/123' }),
    );
  }
  return Promise.reject(new Error(`unexpected GitHub request ${method} ${url}`));
};

let missingConfigFailed = false;
try {
  requireTemplateSourceGitHubConfig({});
} catch (error) {
  missingConfigFailed =
    error instanceof Error && error.message.includes('TEMPLATE_SOURCE_GITHUB_TOKEN');
}
assert(missingConfigFailed, 'missing GitHub token must fail loudly before any write attempt');

const originalSource = await readFile(
  join(process.cwd(), 'src', 'canvas', 'section-library', 'entries', 'starter-template-hero.json'),
  'utf8',
);
const changedEntry = JSON.parse(originalSource) as Record<string, unknown>;
changedEntry.name = 'GitHub PR edited starter hero';

const result = await createTemplateSourcePullRequest(
  {
    token: 'ghs_example',
    repository: 'aayushman-singh/open-canvas',
    baseBranch: 'main',
  },
  {
    templateId: 'starter-canvas',
    sectionId: 'starter-template-hero-v1',
    source: JSON.stringify(changedEntry),
  },
  {
    fetch: fetchOk,
    now: () => new Date('2026-06-22T04:30:00.000Z'),
    randomSuffix: () => 'abc12345',
  },
);

assert(
  result.pullRequestUrl === 'https://github.com/aayushman-singh/open-canvas/pull/123',
  'PR creation must return the GitHub PR URL',
);
assert(
  result.branchName === 'template-source/starter-canvas/20260622-043000-abc12345',
  'branch name must be deterministic from template, timestamp, and suffix',
);
assert(
  result.changedPath === 'src/canvas/section-library/entries/starter-template-hero.json',
  'section edits must target the source JSON entry path',
);

const updateCall = calls.find((call) => call.method === 'PUT');
assert(updateCall !== undefined, 'GitHub flow must update the source file contents');
assert(
  typeof updateCall.body === 'object' &&
    updateCall.body !== null &&
    (updateCall.body as { branch?: string }).branch === result.branchName,
  'source file update must write to the new branch',
);
assert(
  typeof updateCall.body === 'object' &&
    updateCall.body !== null &&
    atob((updateCall.body as { content: string }).content).includes(
      '"name": "GitHub PR edited starter hero"',
    ),
  'source file update must send the validated JSON source content',
);

let invalidSectionFailed = false;
try {
  await createTemplateSourcePullRequest(
    {
      token: 'ghs_example',
      repository: 'aayushman-singh/open-canvas',
      baseBranch: 'main',
    },
    {
      templateId: 'starter-canvas',
      sectionId: 'raydotsh-template-hero-v1',
      source: originalSource,
    },
    { fetch: fetchOk },
  );
} catch (error) {
  invalidSectionFailed =
    error instanceof Error && error.message.includes('does not use section');
}
assert(
  invalidSectionFailed,
  'GitHub PR flow must reject edits for sections outside the selected template',
);

console.log('[source-admin-github:smoke] OK');

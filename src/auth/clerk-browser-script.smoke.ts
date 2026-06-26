import {
  shouldSkipClerkBrowserScriptInjection,
} from './clerk-browser-script.js';

const cases: Array<{ path: string; skip: boolean }> = [
  { path: '/dashboard/sites/abc/edit', skip: true },
  { path: '/dashboard/admin/templates/tpl-1/edit', skip: true },
  { path: '/dashboard/templates', skip: false },
  { path: '/dashboard', skip: false },
  { path: '/dashboard/sites/abc/preview', skip: true },
];

for (const { path, skip } of cases) {
  const actual = shouldSkipClerkBrowserScriptInjection(path);
  if (actual !== skip) {
    throw new Error(
      `shouldSkipClerkBrowserScriptInjection(${JSON.stringify(path)}) = ${String(actual)}, expected ${String(skip)}`,
    );
  }
}

console.log('[clerk-browser-script:smoke] OK');

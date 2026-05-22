import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      '.wrangler/',
      '.worktrees/',
      'node_modules/',
      'worker-configuration.d.ts',
      // Legacy ProseMirror + Yjs chain retired by the canvas-first POC (T9).
      // Files remain on disk for reference but are out of bundle, typecheck,
      // and lint scope.
      'src/multiplayer/**',
      'src/editor/client.ts',
      'src/editor/index.tsx',
      'src/editor/styles.ts',
      'src/agent/ops.ts',
      'src/agent/orchestrator.ts',
      'src/agent/smoke.ts',
      'src/agent/tools.ts',
      'src/agent/_live-smoke.ts',
      'src/routes/api/pages.ts',
      'src/routes/api/agent.ts',
      'src/routes/dashboard/theme.tsx',
    ],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  prettier,
);

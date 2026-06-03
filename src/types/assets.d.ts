declare module '*.ttf' {
  const bytes: ArrayBuffer | string;
  export default bytes;
}

// ADR 0015 — src/editor-client/ imports .css for side effect; Bun.build
// resolves the import as a CSS bundle entrypoint. TypeScript needs the
// declaration to accept the import shape; no value is returned.
declare module '*.css';

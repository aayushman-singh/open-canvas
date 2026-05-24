// Bun cannot resolve `cloudflare:workers` because it is a workerd built-in
// virtual module. The review smoke only exercises HTTP routes via app.request
// and never instantiates the DurableObject, so a stub class is enough to keep
// the module graph linking. Loaded via --preload from package.json.

interface BunPluginBuilder {
  module(specifier: string, callback: () => { loader: string; contents: string }): void;
  onLoad(
    options: { filter: RegExp },
    callback: (args: { path: string }) => { loader: string; contents: string },
  ): void;
}

interface BunPlugin {
  name: string;
  setup(build: BunPluginBuilder): void;
}

const globalScope = globalThis as { Bun?: { plugin: (p: BunPlugin) => void } };
if (!globalScope.Bun) {
  throw new Error('review-smoke-bun-shim was preloaded outside the Bun runtime');
}

globalScope.Bun.plugin({
  name: 'cloudflare-workers-shim',
  setup(build) {
    build.module('cloudflare:workers', () => ({
      loader: 'js',
      contents: `export class DurableObject {
  ctx;
  env;
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
export class WorkerEntrypoint {}
`,
    }));
    build.onLoad({ filter: /\.ttf$/ }, (args) => ({
      loader: 'js',
      contents: `export default ${JSON.stringify(args.path)};`,
    }));
  },
});

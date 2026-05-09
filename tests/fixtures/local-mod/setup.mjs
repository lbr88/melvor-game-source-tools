export function setup(ctx) {
  globalThis.__mcpLocalModSmokeLoaded = {
    name: ctx.name,
    namespace: ctx.namespace,
    version: ctx.version,
  };
}

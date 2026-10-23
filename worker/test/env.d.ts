import "@cloudflare/vitest-plugin/types";
import type { Env } from "../src/env";

declare module "cloudflare:test" {
  // Makes `env` from `cloudflare:test` typed with our bindings.
  interface ProvidedEnv extends Env {}
}

import type { Env } from "./env";

// Placeholder router. Task 6 of the implementation plan replaces this with the
// real /ws + /health router.
export default {
  fetch(_request: Request, _env: Env): Response {
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

import { defineConfig } from "vite";

// GitHub Pages serves project sites from /<repo>/, so the artefact must be built
// with that base. Set PAGES_BASE when the repository name differs.
const pagesBase = process.env.PAGES_BASE ?? "/DynoFreeChat/";
const base = process.env.GITHUB_ACTIONS === "true" ? pagesBase : "/";

export default defineConfig({
  base,
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
  },
});

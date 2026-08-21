import { defineConfig } from "vite";

// Library build: one ESM bundle with every runtime dependency
// externalized. CodeMirror and Lezer are peer dependencies on purpose:
// two copies of @codemirror/state on one page break the editor.
export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [/^@codemirror\//, /^@lezer\//, /^katex/],
    },
    sourcemap: true,
  },
});

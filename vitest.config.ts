import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      include: ["src/core/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      vscode: new URL("./tests/__mocks__/vscode.ts", import.meta.url).pathname,
    },
  },
});

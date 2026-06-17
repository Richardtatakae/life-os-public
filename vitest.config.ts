import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["archive/**", "node_modules/**"],
    environment: "node",
    globals: true,
    // Run test FILES sequentially to avoid SQLite write contention
    // across parallel test runners sharing the same prisma/data.db.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

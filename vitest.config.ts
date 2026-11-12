import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests do not load the React Router plugin.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
  },
});

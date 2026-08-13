import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const sharedCoverage = {
  provider: "v8" as const,
  reporter: ["text", "json-summary"],
  include: ["src/**/*.{ts,tsx}"],
  exclude: ["src/test/**", "src/main.tsx", "src/vite-env.d.ts", "**/*.test.{ts,tsx}"],
  thresholds: {
    lines: 80,
    functions: 80,
    statements: 80,
    branches: 75,
  },
};

export default defineConfig({
  plugins: [react()],
  test: {
    // Keep one coverage policy while each project owns the runtime it needs.
    coverage: sharedCoverage,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          globals: true,
          environment: "node",
          setupFiles: [],
          include: ["src/main/**/*.test.ts", "src/preload/**/*.test.ts", "src/migration-tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "renderer",
          globals: true,
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/main/**", "src/preload/**", "src/migration-tests/**"],
        },
      },
    ],
  },
});

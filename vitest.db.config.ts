import { defineConfig } from "vitest/config"

// The Postgres persistence suite: stands up a real database via testcontainers,
// applies the Drizzle migrations, and exercises the repositories. Needs Docker.
// Run with `npm run test:db`.
export default defineConfig({
  test: {
    include: ["tests/**/*.pg.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 200_000,
  },
})

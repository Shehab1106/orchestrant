import { defineConfig, configDefaults } from "vitest/config"

export default defineConfig({
  test: {
    // The Postgres persistence suite needs Docker; it runs via `npm run test:db`
    // (vitest.db.config.ts), so the default run stays fast and dependency-free.
    exclude: [...configDefaults.exclude, "tests/**/*.pg.test.ts"],
  },
})

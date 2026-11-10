import { json } from "../../../src/api/http"
import { buildDeps } from "../../../src/build-deps"

/**
 * Read-only view of the routing configuration that drives the cascade: the
 * ordered rules and the registered providers. The checkout reads this to show
 * WHY a charge routes the way it does, from the same source the engine uses, so
 * the UI never hard-codes a second copy of the rules.
 */
export async function GET(): Promise<Response> {
  const deps = buildDeps()
  const rules = await deps.rules.list()
  return json({ rules, providers: deps.registry.ids() })
}

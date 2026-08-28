import { voidSchema } from "../../../src/api/schemas"
import { json } from "../../../src/api/http"
import { buildDeps } from "../../../src/build-deps"

export async function POST(req: Request): Promise<Response> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ error: "invalid_json" }, 400)
  }

  const parsed = voidSchema.safeParse(raw)
  if (!parsed.success) {
    return json({ error: "validation_failed", issues: parsed.error.issues }, 400)
  }

  const adapter = buildDeps().registry.get(parsed.data.providerId)
  if (!adapter) {
    return json({ error: "unknown_provider", providerId: parsed.data.providerId }, 404)
  }

  const result = await adapter.void(parsed.data.pspReference)
  return json(result, result.status === "success" ? 200 : 402)
}

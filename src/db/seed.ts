/**
 * Seeds a default routing rule so a fresh database can route a charge.
 * Run with: pnpm db:seed  (after pnpm db:push).
 */
import { getDb } from "./client"
import { routingRule } from "./schema"

async function main(): Promise<void> {
  const db = getDb()
  await db.insert(routingRule).values({
    priority: 1,
    conditions: { currency: ["USD"] },
    weights: { mock_a: 70, mock_b: 30 },
    fallbackOrder: [],
    enabled: true,
  })
  console.log("seeded: USD -> mock_a(70)/mock_b(30)")
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

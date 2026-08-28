/**
 * Lazily-constructed Drizzle client over a node-postgres pool. The pool is a
 * singleton so serverless invocations reuse it.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

export type Db = NodePgDatabase<typeof schema>

let pool: Pool | null = null

export function getDb(): Db {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL is not set")
    pool = new Pool({ connectionString: url })
  }
  return drizzle(pool, { schema })
}

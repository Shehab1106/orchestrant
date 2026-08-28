# orchestrant

A framework-agnostic **payment orchestration engine**, wrapped in a thin
**Next.js** app (API + checkout) — frontend and backend in one repo. It routes a
card charge across multiple providers, cascades to a fallback when a provider
soft-declines, handles 3-D Secure, and stops cleanly on a hard decline, so a
single savable payment gets every reasonable chance to succeed.

The core engine is **pure TypeScript** with no framework or database dependency.
Next.js (delivery) and Postgres (storage) plug in behind interfaces.

## Concepts

| Piece | Responsibility |
|---|---|
| **`PSPAdapter`** | The contract every provider implements: `charge` / `refund` / `void` + capability flags (`supportsExternal3DS`, `supportsAutomatedRefund`, `supportsDescriptor`). |
| **Categorizer** | Turns a provider's raw response into three independent axes: `status` (drives the retry decision), `errorCategory` (analytics), `customerMessage` (shopper-facing). Only `soft_fail`/`timeout` cascade. |
| **Cascade** (`executeChargeChain`) | Walks an ordered chain: success wins and stops; `soft_fail`/`timeout` fall through; `hard_fail` stops; `requires_3ds` pauses (and is suppressed on a resume so the shopper is never challenged twice). |
| **Routing** (`resolveRoute`) | Picks the ordered chain from rules matched on `country` / `currency` / `card network`, using per-provider weights + an explicit fallback order. |
| **Service** (`orchestrateCharge`) | Ties the engine to persistence: idempotent replay, route resolution, cascade, attempt recording. Depends only on ports. |
| **Ports** | `AttemptsRepository` / `RoutingRuleRepository` / `IdempotencyStore` — implemented in-memory (tests, zero-setup) and on Postgres (Drizzle). |

## The retry model

```
charge on provider →
  success       → done ✅
  soft_fail     → cascade to next provider ↩
  timeout       → cascade (reconcile later) ↩
  requires_3ds  → pause for challenge (skip on resume) ⏸
  hard_fail     → stop the chain ⛔
```

## Project layout

```
app/
  page.tsx                          checkout FE (card, cascade trail, 3DS)
  api/{charge,refund,void,health}/  route handlers
  api/webhooks/[vendor]/            webhook ingestion (stub)
src/
  orchestration/                    the framework-agnostic engine + service
    adapters/  cascade/  routing/  persistence/
    ports.ts  registry.ts  orchestrate-charge.ts  types.ts
  db/                               Drizzle schema, client, seed
  api/                              Zod request schemas + JSON helper
  build-deps.ts                     Postgres-or-in-memory wiring
tests/                              engine + service + API tests
```

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Open the checkout and pay. Test cards:

| Card token | Outcome |
|---|---|
| `tok_ok` | cascades `mock_a` (soft-declines) → `mock_b` (approves) → success |
| `tok_3ds` | 3-D Secure challenge, then approves on resume |
| `invalid_card` | hard decline — stops the chain |

Or call the API directly:

```bash
curl -s localhost:3000/api/charge -H 'content-type: application/json' \
  -d '{"idempotencyKey":"t1","amount":5000,"currency":"USD","country":"US","card":{"token":"tok_ok","network":"visa"}}'
```

By default it uses a seeded **in-memory** store (zero setup). For **Postgres**:

```bash
docker compose up -d          # local Postgres
export DATABASE_URL=postgres://orchestrant:orchestrant@localhost:5432/orchestrant
pnpm db:push                  # create tables
pnpm db:seed                  # seed the default USD routing rule
pnpm dev
```

## API

| Method + path | Body | Notes |
|---|---|---|
| `POST /api/charge` | `idempotencyKey`, `amount` (minor units), `currency`, `card{token,network?}`, `country?`, `threeDSProof?` | routes + cascades; returns status, attempt trail, any 3DS challenge |
| `POST /api/refund` | `providerId`, `pspReference`, `amount`, `idempotencyKey` | dispatches to the adapter |
| `POST /api/void` | `providerId`, `pspReference` | dispatches to the adapter |
| `POST /api/webhooks/:vendor` | vendor payload | ack stub (signature + dispatch TODO) |
| `GET /api/health` | — | liveness |

## Develop

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # next build
```

## Status

- [x] Engine spine: adapter contract, cascade (+ 3DS / skip-on-resume), routing, mock gateway
- [x] Persistence: ports + in-memory + Postgres/Drizzle, and the `orchestrateCharge` service
- [x] Next.js API: `/charge`, `/refund`, `/void`, `/webhooks/:vendor`, `/health`
- [x] Checkout FE: card + cascade trail + 3DS challenge/resume
- [ ] Real demo adapter (e.g. Stripe test-mode)
- [ ] Webhook signature verification + dispatch
- [ ] Hardening: rate limits, structured logging, a real 3DS challenge iframe

## License

Personal project. All rights reserved (for now).

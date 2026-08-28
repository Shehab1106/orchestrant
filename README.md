# orchestrant

A framework-agnostic **payment orchestration engine**. It routes a card charge
across multiple payment providers, cascades to a fallback when a provider
soft-declines, handles 3D Secure, and stops cleanly on a hard decline — so a
single savable payment gets every reasonable chance to succeed.

The core engine is **pure TypeScript** with no framework or database
dependency. A Next.js app (added later) is only the delivery layer: API routes
for the backend and a checkout page for the frontend, both living in this one
repo.

## Concepts

| Piece | Responsibility |
|---|---|
| **`PSPAdapter`** | The contract every provider implements: `charge` / `refund` / `void` + capability flags (`supportsExternal3DS`, `supportsAutomatedRefund`, `supportsDescriptor`). |
| **Categorizer** | Turns a provider's raw response into three independent axes: `status` (drives the retry decision), `errorCategory` (analytics), `customerMessage` (shopper-facing). Only `soft_fail`/`timeout` cascade. |
| **Cascade** (`executeChargeChain`) | Walks an ordered chain of adapters: success wins and stops; `soft_fail`/`timeout` fall through to the next; `hard_fail` stops; `requires_3ds` pauses for a challenge (and is suppressed on a resume so the shopper is never challenged twice). |
| **Routing** (`resolveRoute`) | Picks the ordered chain from rules matched on `country` / `currency` / `card network`, using per-provider weights + an explicit fallback order. |
| **Vault port** | An interface for detokenizing card fields at egress. Real deployments back it with a PCI vault; the mock backs it with a plain token. |

## The retry model

```
charge on provider →
  success       → done ✅
  soft_fail     → cascade to next provider ↩
  timeout       → cascade (reconcile later) ↩
  requires_3ds  → pause for challenge (skip on resume) ⏸
  hard_fail     → stop the chain ⛔
```

## Status

- [x] Core engine spine: adapter contract, cascade, routing, mock gateway, e2e tests
- [ ] Persistence (Postgres + Drizzle, behind a repository port; in-memory for tests)
- [ ] Next.js API routes (`/charge`, `/refund`, `/void`, `/webhooks/:vendor`)
- [ ] Checkout frontend (card + 3DS)
- [ ] Real demo adapters (e.g. Stripe test-mode)

## Develop

```bash
pnpm install
pnpm test
```

## License

Personal project. All rights reserved (for now).

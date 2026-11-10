/**
 * Resolves a provider id (as produced by the router) to the adapter instance
 * that talks to it. The engine holds no vendor knowledge; this map is the only
 * place provider ids meet concrete adapters.
 */
import type { PSPAdapter } from "./adapters/psp-adapter"

export class AdapterRegistry {
  private readonly byId = new Map<string, PSPAdapter>()

  constructor(adapters: readonly PSPAdapter[]) {
    for (const adapter of adapters) {
      this.byId.set(adapter.providerId, adapter)
    }
  }

  get(providerId: string): PSPAdapter | undefined {
    return this.byId.get(providerId)
  }

  has(providerId: string): boolean {
    return this.byId.has(providerId)
  }

  /** Every registered provider id, in insertion order. */
  ids(): string[] {
    return [...this.byId.keys()]
  }
}

/**
 * Deterministic [0, 100) integer derived from a seed string (a cart id, a debt
 * id, whatever the caller keys stickiness on). Same seed always yields the same
 * number, so a weighted provider pick is stable across reloads and retries — a
 * charge never ping-pongs between providers.
 *
 * FNV-1a (32-bit) is a small, well-distributed non-cryptographic hash. We only
 * need spread, not secrecy, and it runs identically in the browser and in Node
 * with no dependency.
 */
export function seededPercent(seed: string): number {
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    // 32-bit FNV prime multiply, kept in uint32 via Math.imul.
    h = Math.imul(h, 0x01000193)
  }
  // Force unsigned, then fold into the percentage space.
  return (h >>> 0) % 100
}

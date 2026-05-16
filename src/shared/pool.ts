/**
 * Generic concurrent worker pool — processes items with bounded parallelism.
 * Supports cancellation via a token and returns results in original order.
 *
 * Used by both IMEISearchEngine and ExportEngine to manage NAS I/O concurrency.
 */

/** Cancellation token shared between caller and workers. */
export interface CancelToken {
  cancelled: boolean
}

/**
 * Process items concurrently, returning results in the same order as input.
 * Workers stop consuming items as soon as `token.cancelled` becomes true.
 */
export async function pooled<T, R>(
  items: T[],
  concurrency: number,
  token: CancelToken,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length && !token.cancelled) {
      const idx = nextIndex++
      results[idx] = await fn(items[idx])
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}

/**
 * Void-returning variant — same concurrency pattern but doesn't collect results.
 * Use when the work is side-effectful (file copies, network writes).
 */
export async function pooledVoid<T>(
  items: T[],
  concurrency: number,
  token: CancelToken,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length && !token.cancelled) {
      const idx = nextIndex++
      await fn(items[idx])
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  )
  await Promise.all(workers)
}

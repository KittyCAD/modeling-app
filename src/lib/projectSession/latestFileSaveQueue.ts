/** Serialize writes per file, coalescing waiting edits but preserving navigation saves. */
export function createLatestFileSaveQueue<T extends { requestedPath: string }>(
  write: (request: T) => Promise<void>
) {
  interface SaveBatch {
    next: T | undefined
    coalesce: boolean
    completion: ReturnType<typeof Promise.withResolvers<undefined>>
  }
  const pending = new Map<string, SaveBatch[]>()
  const submit = (request: T, coalesce: boolean): Promise<void> => {
    const path = request.requestedPath
    const waiting = pending.get(path)
    const last = waiting?.at(-1)
    if (coalesce && last?.coalesce) {
      last.next = request
      return last.completion.promise
    }
    const batch: SaveBatch = {
      next: request,
      coalesce,
      completion: Promise.withResolvers<undefined>(),
    }
    if (waiting) waiting.push(batch)
    else {
      const batches = [batch]
      pending.set(path, batches)
      const drain = async () => {
        while (batches.length) {
          const batch = batches[0]
          let failure: { error: unknown } | undefined
          while (batch.next) {
            const next = batch.next
            batch.next = undefined
            try {
              await write(next)
              failure = undefined
            } catch (error) {
              failure = { error }
            }
          }
          batches.shift()
          if (failure) batch.completion.reject(failure.error)
          else batch.completion.resolve(undefined)
        }
        pending.delete(path)
      }
      void drain().catch((error: unknown) => {
        pending.delete(path)
        for (const batch of batches) batch.completion.reject(error)
      })
    }
    return batch.completion.promise
  }
  return {
    has: (path: string) => pending.has(path),
    hasEdits: (path: string) =>
      pending.get(path)?.some((batch) => batch.coalesce) ?? false,
    settled: () =>
      Promise.allSettled(
        [...pending.values()].flatMap((batches) =>
          batches.map((batch) => batch.completion.promise)
        )
      ),
    save: (request: T) => submit(request, true),
    enqueue: (request: T) => submit(request, false),
  }
}

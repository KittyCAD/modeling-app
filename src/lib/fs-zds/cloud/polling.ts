const POLL_INTERVALS_MS = [1_500, 3_000, 6_000, 12_000].flatMap((interval) =>
  Array.from({ length: 5 }, () => interval)
)

/** One non-overlapping poll loop for the currently visible project. */
export function createProjectPoller({
  check,
  onError,
  random = Math.random,
}: {
  check: () => Promise<boolean>
  onError: (error: unknown) => void
  random?: () => number
}) {
  let enabled = false
  let disposed = false
  let inFlight = false
  let step = -1
  let failureInterval = 0
  let retryNotBefore = 0
  let generation = 0
  let due = Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  const delay = () => {
    const base = Math.max(
      POLL_INTERVALS_MS[Math.max(step, 0)] ?? 1_500,
      failureInterval
    )
    return base >= 30_000
      ? 15_000 + random() * 15_000
      : base * (0.8 + random() * 0.4)
  }
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
    due = Infinity
  }
  const schedule = (milliseconds: number) => {
    if (!enabled || disposed) return
    milliseconds = Math.max(milliseconds, retryNotBefore - Date.now())
    // Activity can bring a check forward, but typing must never postpone it.
    if (timer !== undefined && due <= Date.now() + milliseconds) return
    clear()
    due = Date.now() + milliseconds
    timer = setTimeout(() => {
      clear()
      void run()
    }, milliseconds)
  }
  const run = async () => {
    if (!enabled || disposed || inFlight) return
    inFlight = true
    const started = generation
    const startedAt = Date.now()
    let retryAfter = 0
    let failed = false
    try {
      const changed = await check()
      failureInterval = 0
      retryNotBefore = 0
      step =
        changed || generation !== started
          ? 0
          : (step + 1) % POLL_INTERVALS_MS.length
    } catch (error) {
      failed = true
      // Failed probes back off even if edits continue during an outage.
      failureInterval = Math.min(Math.max(3_000, failureInterval * 2), 30_000)
      if (
        typeof error === 'object' &&
        error !== null &&
        'retryAfterMs' in error &&
        typeof error.retryAfterMs === 'number'
      )
        retryAfter = error.retryAfterMs
      retryNotBefore = Date.now() + retryAfter
      if (!disposed) onError(error)
    } finally {
      inFlight = false
      if (enabled && !disposed) {
        // The interval measures check starts. Downloading and applying a
        // snapshot must not add another full interval to every update.
        // Failed probes still wait their complete retry delay after failure.
        const elapsed = failed ? 0 : Date.now() - startedAt
        schedule(Math.max(0, retryAfter, delay() - elapsed))
      }
    }
  }
  return {
    setEnabled(value: boolean) {
      if (enabled === value || disposed) return
      enabled = value
      clear()
      if (enabled) {
        step = -1
        generation += 1
        schedule(0)
      }
    },
    activity() {
      step = 0
      generation += 1
      if (!inFlight) schedule(delay())
    },
    checkNow() {
      step = -1
      generation += 1
      if (!inFlight) schedule(0)
    },
    dispose() {
      disposed = true
      enabled = false
      clear()
    },
  }
}

/**
 * Keep only the newest value, and act on it once a frame.
 *
 * For input that arrives faster than anything can usefully answer it. A pointer
 * produces moves several times a frame and every intermediate one is already
 * stale by the time it is read — so the question is not "how do I keep up" but
 * "which one actually matters", and the answer is the last.
 *
 * The two callers are the two ends of hovering, and both were costing real
 * frames before this. In the editor, resolving a pointer to a document offset
 * hit-tests against live coordinates and forces the browser to flush layout;
 * doing that several times a frame is felt as *typing* being slow, because the
 * keystroke and the hit test compete for the same synchronous layout. In the
 * scene, each hover is a round trip on the socket the whole app shares.
 *
 * Deliberately not a timed throttle. A frame is the rate at which an answer
 * could be *drawn*, so it is the rate worth computing one at — and it needs no
 * interval anybody has to justify.
 */
export interface Coalesced<T> {
  /** Offer a value. The newest one before the next frame wins. */
  offer(value: T): void
  /** Drop whatever is waiting. For a pointer leaving, or a teardown. */
  cancel(): void
}

export function coalesceToFrame<T>(
  act: (value: T) => void,
  schedule: (callback: () => void) => number = requestAnimationFrame,
  unschedule: (handle: number) => void = cancelAnimationFrame
): Coalesced<T> {
  let waiting: { value: T } | null = null
  let frame = 0

  return {
    offer(value) {
      waiting = { value }
      if (frame !== 0) return

      frame = schedule(() => {
        frame = 0
        const held = waiting
        waiting = null
        // Wrapped rather than compared against null, so `undefined` and `0` are
        // values like any other and not mistaken for "nothing waiting".
        if (held) act(held.value)
      })
    },

    cancel() {
      waiting = null
      if (frame === 0) return

      unschedule(frame)
      frame = 0
    },
  }
}

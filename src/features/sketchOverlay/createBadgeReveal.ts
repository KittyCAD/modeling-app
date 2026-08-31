import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlanePoint } from '@src/lib/scene/projection'

/**
 * Which segment's constraints are showing, and for how long after.
 *
 * Constraint badges are hidden by default, because a sketch with thirty of them
 * is a sketch you cannot see. Hovering a segment reveals *its* constraints; the
 * problem that creates is the one this module exists for — a badge that
 * disappears the moment the pointer leaves the segment is a badge nobody can
 * click, because reaching it means leaving.
 *
 * So a reveal outlives its hover. The existing app holds it for two seconds and
 * cancels the timer while the pointer is on the segment *or* on one of the badges
 * it revealed, which is the same two seconds and the same rule here.
 *
 * The position is pinned at the moment of the reveal rather than following the
 * pointer. A row of badges that slid along under the cursor would be a row you
 * chase; fixed, it is a row you move onto.
 */

export interface RevealedSegment {
  segmentId: ApiObjectId
  /** Where the pointer was when this was revealed, in the plane. */
  at: PlanePoint
}

export interface BadgeReveal {
  readonly revealed: ReadonlySignal<readonly RevealedSegment[]>
  /**
   * The pointer is over this segment, at this point — or over nothing.
   *
   * Called with null for a segment with no constraints to show, which is the same
   * thing as far as this is concerned: nothing to reveal, and anything already
   * revealed starts running down.
   */
  hover(segmentId: ApiObjectId | null, at: PlanePoint | null): void
  /** The pointer is on one of this segment's badges. Hold it. */
  keep(segmentId: ApiObjectId): void
  /** And has left it again. Start running down. */
  release(segmentId: ApiObjectId): void
  /** Everything goes, now — a drag has started. */
  dismiss(): void
  dispose(): void
}

/** How long a reveal outlives the hover that caused it. The existing app's. */
const LINGER_MS = 2000

export function createBadgeReveal(
  options: { lingerMs?: number } = {}
): BadgeReveal {
  const linger = options.lingerMs ?? LINGER_MS
  const revealed = signal<readonly RevealedSegment[]>([])

  /** Hide timers, by segment. A segment being held has no entry here. */
  const timers = new Map<ApiObjectId, number>()

  const cancel = (segmentId: ApiObjectId) => {
    const timer = timers.get(segmentId)
    if (timer === undefined) return
    window.clearTimeout(timer)
    timers.delete(segmentId)
  }

  const remove = (segmentId: ApiObjectId) => {
    cancel(segmentId)
    revealed.value = revealed.value.filter(
      (entry) => entry.segmentId !== segmentId
    )
  }

  const runDown = (segmentId: ApiObjectId) => {
    if (timers.has(segmentId)) return
    timers.set(
      segmentId,
      window.setTimeout(() => {
        timers.delete(segmentId)
        remove(segmentId)
      }, linger)
    )
  }

  return {
    revealed: computed(() => revealed.value),

    hover(segmentId, at) {
      const showing = revealed.peek()

      if (
        segmentId !== null &&
        at &&
        !showing.some((entry) => entry.segmentId === segmentId)
      ) {
        // Pinned where the pointer is now, and left there.
        revealed.value = [...showing, { segmentId, at }]
      }

      /*
       * Everything that is not the segment under the pointer starts running
       * down. More than one can be showing at once — moving between two segments
       * quickly reveals both — and each runs its own clock.
       */
      for (const entry of revealed.peek()) {
        if (entry.segmentId === segmentId) {
          cancel(entry.segmentId)
        } else {
          runDown(entry.segmentId)
        }
      }
    },

    keep: cancel,
    release: runDown,

    dismiss() {
      for (const segmentId of [...timers.keys()]) cancel(segmentId)
      revealed.value = []
    },

    dispose() {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    },
  }
}

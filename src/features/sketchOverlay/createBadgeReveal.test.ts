import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBadgeReveal } from '@src/features/sketchOverlay/createBadgeReveal'

const at = { x: 1, y: 2 }

describe('revealing a segment’s constraints', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows nothing until something is hovered', () => {
    const reveal = createBadgeReveal()

    expect(reveal.revealed.value).toEqual([])
  })

  it('reveals the segment under the pointer, where the pointer is', () => {
    const reveal = createBadgeReveal()

    reveal.hover(4, at)

    expect(reveal.revealed.value).toEqual([{ segmentId: 4, at }])
  })

  /*
   * A row that slid along under the cursor would be a row you chase. Pinned, it
   * is a row you move onto — which is the whole reason this state exists.
   */
  it('leaves the row where it appeared as the pointer moves along', () => {
    const reveal = createBadgeReveal()
    reveal.hover(4, at)

    reveal.hover(4, { x: 9, y: 9 })

    expect(reveal.revealed.value).toEqual([{ segmentId: 4, at }])
  })

  /*
   * The point of the linger: reaching a badge means leaving the segment that
   * revealed it, so a row that went at once would be a row nobody could click.
   */
  it('keeps showing for a moment after the pointer leaves', () => {
    const reveal = createBadgeReveal()
    reveal.hover(4, at)

    reveal.hover(null, null)
    vi.advanceTimersByTime(1900)

    expect(reveal.revealed.value).toHaveLength(1)
  })

  it('gives up once the moment has passed', () => {
    const reveal = createBadgeReveal()
    reveal.hover(4, at)

    reveal.hover(null, null)
    vi.advanceTimersByTime(2000)

    expect(reveal.revealed.value).toEqual([])
  })

  it('starts the clock again when the pointer comes back and leaves', () => {
    const reveal = createBadgeReveal()
    reveal.hover(4, at)
    reveal.hover(null, null)
    vi.advanceTimersByTime(1500)

    reveal.hover(4, at)
    vi.advanceTimersByTime(1500)

    // Back on the segment cancelled the clock rather than pausing it.
    expect(reveal.revealed.value).toHaveLength(1)
  })

  it('holds while the pointer is on one of its badges', () => {
    const reveal = createBadgeReveal()
    reveal.hover(4, at)
    reveal.hover(null, null)

    reveal.keep(4)
    vi.advanceTimersByTime(5000)

    expect(reveal.revealed.value).toHaveLength(1)
  })

  it('lets go again when the pointer leaves the badge', () => {
    const reveal = createBadgeReveal()
    reveal.hover(4, at)
    reveal.hover(null, null)
    reveal.keep(4)

    reveal.release(4)
    vi.advanceTimersByTime(2000)

    expect(reveal.revealed.value).toEqual([])
  })

  /*
   * Moving between two segments quickly shows both, each running its own clock —
   * which is what stops a row from vanishing because the pointer crossed
   * something else on the way to it.
   */
  it('shows more than one at a time, each with its own clock', () => {
    const reveal = createBadgeReveal()
    reveal.hover(4, at)
    vi.advanceTimersByTime(500)
    reveal.hover(7, { x: 5, y: 5 })

    vi.advanceTimersByTime(1900)
    expect(reveal.revealed.value.map((entry) => entry.segmentId)).toEqual([
      4, 7,
    ])

    vi.advanceTimersByTime(200)
    expect(reveal.revealed.value.map((entry) => entry.segmentId)).toEqual([7])
  })

  it('takes everything away at once when asked', () => {
    const reveal = createBadgeReveal()
    reveal.hover(4, at)
    reveal.hover(7, { x: 5, y: 5 })

    reveal.dismiss()

    expect(reveal.revealed.value).toEqual([])
  })

  it('fires no timer after it is disposed', () => {
    const reveal = createBadgeReveal()
    reveal.hover(4, at)
    reveal.hover(null, null)

    reveal.dispose()
    vi.advanceTimersByTime(5000)

    // Nothing to assert on the value; the point is that the timer does not run
    // into a torn-down signal graph. `advanceTimersByTime` would throw if it did.
    expect(reveal.revealed.value).toHaveLength(1)
  })

  it('takes a shorter linger when one is asked for', () => {
    const reveal = createBadgeReveal({ lingerMs: 100 })
    reveal.hover(4, at)

    reveal.hover(null, null)
    vi.advanceTimersByTime(100)

    expect(reveal.revealed.value).toEqual([])
  })
})

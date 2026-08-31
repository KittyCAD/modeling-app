import { describe, expect, it } from 'vitest'
import { coalesceToFrame } from '@src/lib/coalesceToFrame'

const harness = () => {
  const acted: unknown[] = []
  let scheduled: (() => void) | null = null
  let cancelled = 0

  const coalesced = coalesceToFrame<unknown>(
    (value) => acted.push(value),
    (callback) => {
      scheduled = callback
      return 1
    },
    () => {
      cancelled += 1
      scheduled = null
    }
  )

  return {
    coalesced,
    acted,
    get cancelled() {
      return cancelled
    },
    frame: () => {
      const run = scheduled
      scheduled = null
      run?.()
    },
    get pending() {
      return scheduled !== null
    },
  }
}

describe('keeping only the newest', () => {
  it('does nothing until a frame comes', () => {
    const app = harness()

    app.coalesced.offer('a')

    expect(app.acted).toEqual([])
  })

  /* The whole point: forty moves in one frame is one hit test, not forty. */
  it('acts once however many values arrived', () => {
    const app = harness()

    for (let at = 0; at < 40; at += 1) app.coalesced.offer(at)
    app.frame()

    expect(app.acted).toHaveLength(1)
  })

  it('acts on the last one, since the rest are already stale', () => {
    const app = harness()

    app.coalesced.offer('first')
    app.coalesced.offer('second')
    app.coalesced.offer('third')
    app.frame()

    expect(app.acted).toEqual(['third'])
  })

  it('schedules again for the next batch', () => {
    const app = harness()
    app.coalesced.offer('a')
    app.frame()

    app.coalesced.offer('b')
    app.frame()

    expect(app.acted).toEqual(['a', 'b'])
  })

  it('rests when nothing is offered', () => {
    const app = harness()
    app.coalesced.offer('a')
    app.frame()

    expect(app.pending).toBe(false)
  })

  /*
   * `undefined` and `0` are values. A held slot rather than a nullable one, so
   * offering either is not mistaken for having offered nothing.
   */
  it('carries a value that looks like nothing', () => {
    const app = harness()

    app.coalesced.offer(undefined)
    app.frame()

    expect(app.acted).toEqual([undefined])
  })
})

describe('giving up on what was waiting', () => {
  it('drops the value and the frame', () => {
    const app = harness()
    app.coalesced.offer('a')

    app.coalesced.cancel()
    app.frame()

    expect(app.acted).toEqual([])
    expect(app.cancelled).toBe(1)
  })

  it('is safe with nothing waiting', () => {
    const app = harness()

    expect(() => app.coalesced.cancel()).not.toThrow()
    expect(app.cancelled).toBe(0)
  })

  it('works again after being cancelled', () => {
    const app = harness()
    app.coalesced.offer('a')
    app.coalesced.cancel()

    app.coalesced.offer('b')
    app.frame()

    expect(app.acted).toEqual(['b'])
  })
})

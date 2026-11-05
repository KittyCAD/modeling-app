import { describe, expect, it } from 'vitest'
import { RenderTransition } from '@src/clientSideScene/localRenderer/RenderTransition'

describe('renderer crossfade', () => {
  it('fades in over 200 milliseconds and returns to real-time immediately', () => {
    const fade = new RenderTransition()
    expect(fade.update(true, 1000, true)).toBe(0)
    expect(fade.active).toBe(true)
    expect(fade.update(true, 1100, true)).toBe(0.5)
    expect(fade.update(true, 1200, true)).toBe(1)
    expect(fade.active).toBe(false)
    expect(fade.update(false, 2000, true)).toBe(0)
    expect(fade.active).toBe(false)
  })

  it('cancels a partial fade immediately and starts a fresh fade after release', () => {
    const fade = new RenderTransition()
    fade.update(true, 1000, true)
    expect(fade.update(true, 1100, true)).toBe(0.5)
    expect(fade.update(false, 1100, true)).toBe(0)
    expect(fade.active).toBe(false)
    expect(fade.update(true, 1200, true)).toBe(0)
    expect(fade.update(true, 1300, true)).toBe(0.5)
    expect(fade.update(true, 1400, true)).toBe(1)
  })

  it('switches immediately in continuous tracing and standard modes', () => {
    const fade = new RenderTransition()
    expect(fade.update(true, 1000, false)).toBe(1)
    expect(fade.active).toBe(false)
    expect(fade.update(false, 1001, false)).toBe(0)
  })
})

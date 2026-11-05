import { describe, expect, it } from 'vitest'
import { RenderTransition } from '@src/clientSideScene/localRenderer/RenderTransition'

describe('renderer crossfade', () => {
  it('fades in over 2000 milliseconds and returns to real-time immediately', () => {
    const fade = new RenderTransition()
    expect(fade.update(true, 1000, true)).toBe(0)
    expect(fade.active).toBe(true)
    expect(fade.update(true, 2000, true)).toBe(0.5)
    expect(fade.update(true, 3000, true)).toBe(1)
    expect(fade.active).toBe(false)
    expect(fade.update(false, 4000, true)).toBe(0)
    expect(fade.active).toBe(false)
  })

  it('cancels a partial fade immediately and starts a fresh fade after release', () => {
    const fade = new RenderTransition()
    fade.update(true, 1000, true)
    expect(fade.update(true, 2000, true)).toBe(0.5)
    expect(fade.update(false, 2000, true)).toBe(0)
    expect(fade.active).toBe(false)
    expect(fade.update(true, 3000, true)).toBe(0)
    expect(fade.update(true, 4000, true)).toBe(0.5)
    expect(fade.update(true, 5000, true)).toBe(1)
  })

  it('applies a new duration live without jumping or restarting a partial fade', () => {
    const fade = new RenderTransition()
    fade.update(true, 1000, true)
    expect(fade.update(true, 2000, true)).toBe(0.5)
    fade.setDuration(4000, 2000)
    expect(fade.value).toBe(0.5)
    expect(fade.update(true, 3000, true)).toBe(0.75)
    expect(fade.update(true, 4000, true)).toBe(1)
    fade.setDuration(8000, 5000)
    expect(fade.value).toBe(1)
    expect(fade.active).toBe(false)
  })

  it('allows zero for an instant switch and ignores invalid durations', () => {
    const fade = new RenderTransition()
    fade.setDuration(0, 0)
    expect(fade.update(true, 1000, true)).toBe(1)
    expect(fade.active).toBe(false)
    fade.setDuration(Number.NaN, 1000)
    fade.setDuration(-1, 1000)
    fade.update(false, 1000, true)
    expect(fade.update(true, 1001, true)).toBe(1)
  })

  it('switches immediately in continuous tracing and standard modes', () => {
    const fade = new RenderTransition()
    expect(fade.update(true, 1000, false)).toBe(1)
    expect(fade.active).toBe(false)
    expect(fade.update(false, 1001, false)).toBe(0)
  })
})

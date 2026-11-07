import { describe, expect, it } from 'vitest'
import { PIXELS_PER_MM, rulerTicks } from '@src/lib/drawings/rulers'

describe('drawing rulers', () => {
  it('keeps millimeter coordinates aligned with the sheet while panning and zooming', () => {
    for (const scale of [0.1, 0.5, 1, 4]) {
      for (const origin of [-1300, 0, 147]) {
        const ticks = rulerTicks(800, origin, PIXELS_PER_MM * scale)
        for (const tick of ticks) {
          expect(tick.position).toBeGreaterThanOrEqual(-1e-8)
          expect(tick.position).toBeLessThanOrEqual(800 + 1e-8)
          expect(tick.position).toBeCloseTo(
            origin + tick.value * PIXELS_PER_MM * scale
          )
        }
        const major = ticks.filter((tick) => tick.major)
        expect(major.length).toBeGreaterThan(1)
        expect(major[1].position - major[0].position).toBeGreaterThanOrEqual(
          60 - 1e-8
        )
        expect(major[1].position - major[0].position).toBeLessThanOrEqual(
          150 + 1e-8
        )
      }
    }
  })
})

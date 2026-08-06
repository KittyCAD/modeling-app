import { describe, expect, it } from 'vitest'

import { createArcPositions } from '@src/machines/sketchSolve/arcPositions'

describe('createArcPositions', () => {
  it('does not collapse full circles when startAngle + 2π rounds above 2π', () => {
    const startAngle = 2.752564435001932
    const positions = createArcPositions({
      center: [0, 0],
      radius: 5,
      startAngle,
      endAngle: startAngle + Math.PI * 2,
      ccw: true,
    })

    const uniquePoints = new Set<string>()
    for (let i = 0; i < positions.length; i += 3) {
      uniquePoints.add(
        `${positions[i].toFixed(6)},${positions[i + 1].toFixed(6)}`
      )
    }

    expect(positions).toHaveLength(303)
    expect(uniquePoints.size).toBeGreaterThan(95)

    const firstX = positions[0]
    const firstY = positions[1]
    const lastX = positions[positions.length - 3]
    const lastY = positions[positions.length - 2]
    expect(Math.hypot(firstX - lastX, firstY - lastY)).toBeLessThan(1e-9)
  })

  it('sweeps the other side of the circle when ccw is false', () => {
    const positions = createArcPositions({
      center: [0, 0],
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI,
      ccw: false,
    })

    // Both sweeps share endpoints (5, 0) and (-5, 0), but the clockwise
    // sweep passes through the bottom of the circle.
    expect(positions[0]).toBeCloseTo(5)
    expect(positions[1]).toBeCloseTo(0)
    expect(positions[positions.length - 3]).toBeCloseTo(-5)
    expect(positions[positions.length - 2]).toBeCloseTo(0)

    const midPointIndex = 3 * Math.floor(positions.length / 3 / 2)
    expect(positions[midPointIndex + 1]).toBeCloseTo(-5)
  })
})

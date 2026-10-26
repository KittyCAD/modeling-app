import type { Segment3d } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  sampleSegment3d,
  sketch3dConstructor,
  sketch3dConstraintStatement,
} from '@src/machines/sketchSolve/sketch3d'
import { describe, expect, it } from 'vitest'

describe('world-space circular geometry', () => {
  const arc: Segment3d = {
    label: 'arc1',
    kind: 'arc',
    points: [
      [0, 0, 10],
      [0, 10, 0],
      [0, 0, 0],
    ],
    normal: [1, 0, 0],
    clockwise: false,
    construction: false,
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
  it('samples the actual plane and major arc traversal', () => {
    const samples = sampleSegment3d(arc)
    expect(samples[0].toArray()).toEqual([0, 0, 10])
    expect(samples.at(-1)?.y).toBeCloseTo(10)
    expect(samples.every((p) => Math.abs(p.x) < 1e-10)).toBe(true)
    expect(samples[Math.floor(samples.length / 2)].z).toBeLessThan(0)
  })
  it('generates solver blocks geometry with three variable coordinates', () => {
    expect(
      sketch3dConstructor(
        'line',
        [
          [0, 0, 0],
          [1, 2, 3],
        ],
        [0, 0, 1],
        false
      )
    ).toBe(
      'line(start = [var 0mm, var 0mm, var 0mm], end = [var 1mm, var 2mm, var 3mm])'
    )
    expect(
      sketch3dConstructor('point', [[0, 0, Infinity]], [0, 0, 1], false)
    ).toBeInstanceOf(Error)
  })
  it('validates constraint selections before writing source and permits the origin anchor', () => {
    expect(
      sketch3dConstraintStatement('distance', ['arc1.start'], [arc], 20)
    ).toBeInstanceOf(Error)
    expect(
      sketch3dConstraintStatement(
        'distance',
        ['arc1.start', 'arc1.end'],
        [arc],
        20
      )
    ).toBe('distance([arc1.start, arc1.end]) == 20mm')
    expect(
      sketch3dConstraintStatement('fixed', ['arc1.center', 'ORIGIN'], [arc], 0)
    ).toBe('fixed([arc1.center, ORIGIN])')
    expect(
      sketch3dConstraintStatement('radius', ['arc1'], [arc], -1)
    ).toBeInstanceOf(Error)
  })
  it('keeps fixed coordinates fixed when editing geometry', () => {
    expect(
      sketch3dConstructor(
        'line',
        [
          [0, 0, 0],
          [1, 2, 3],
        ],
        [0, 0, 1],
        false,
        false,
        [
          [false, false, false],
          [true, true, true],
        ]
      )
    ).toBe('line(start = [0mm, 0mm, 0mm], end = [var 1mm, var 2mm, var 3mm])')
    expect(
      sketch3dConstructor(
        'arc',
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        [0, 0, 1],
        false,
        true
      )
    ).toContain('direction = CW')
  })
})

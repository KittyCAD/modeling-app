import type { Segment3d } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  sampleSegment3d,
  sketch3dConstructor,
  sketch3dConstraintStatement,
  fitSketch3dView,
} from '@src/machines/sketchSolve/sketch3d'
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'

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

  it('frames the full circular sweep in a narrow perspective viewport and syncs the engine camera', () => {
    const camera = new PerspectiveCamera(45, 0.5, 0.1, 20000)
    camera.position.set(200, -300, 200)
    const controls = {
      camera,
      target: new Vector3(),
      update: vi.fn(() => camera.updateMatrixWorld()),
    }
    expect(fitSketch3dView([arc], controls)).toBe(true)
    expect(controls.update).toHaveBeenCalledWith(true)
    for (const p of sampleSegment3d(arc)) {
      const projected = p.clone().project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(1)
      expect(Math.abs(projected.y)).toBeLessThan(1)
    }
  })

  it('frames orthographic views without depending on engine geometry', () => {
    const camera = new OrthographicCamera(-10, 10, 5, -5, 0.1, 20000)
    camera.position.set(100, -200, 100)
    const controls = {
      camera,
      target: new Vector3(),
      update: vi.fn(() => camera.updateMatrixWorld()),
    }
    expect(fitSketch3dView([arc], controls)).toBe(true)
    for (const p of sampleSegment3d(arc)) {
      const projected = p.clone().project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(1)
      expect(Math.abs(projected.y)).toBeLessThan(1)
    }
    expect(fitSketch3dView([], controls)).toBe(false)
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

import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { Line2NodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { IntegerIdPicker } from './IntegerIdPicker'

describe('IntegerIdPicker', () => {
  it('accepts an edge source before its geometry has been populated', () => {
    const geometry = new LineSegmentsGeometry()
    const material = new Line2NodeMaterial()
    const source = new LineSegments2(geometry, material)
    const picker = new IntegerIdPicker({} as WebGPURenderer)

    // Three defaults instanceCount to Infinity until setPositions is called.
    expect(geometry.instanceCount).toBe(Infinity)
    expect(() =>
      picker.setTargets([], null, { source, targets: [] })
    ).not.toThrow()

    picker.dispose()
    geometry.dispose()
    material.dispose()
  })
})

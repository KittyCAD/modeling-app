import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import { describe, expect, it } from 'vitest'

import {
  directedCameraFromNamedView,
  sanitizeViewName,
  uniqueViewName,
} from '@src/lang/modifyAst/namedViews'

function savedView(overrides: Partial<NamedView> = {}): NamedView {
  return {
    name: 'Saved',
    eye_offset: 100,
    fov_y: 45,
    ortho_scale_enabled: true,
    ortho_scale_factor: 1.6,
    world_coord_system: 'right_handed_up_z',
    is_ortho: false,
    pivot_position: [1, 2, 3],
    pivot_rotation: [0, 0, 0, 1],
    version: 1.0,
    ...overrides,
  }
}

function expectVector(actual: number[], expected: number[]) {
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 6)
  })
}

describe('directedCameraFromNamedView', () => {
  it('reads the identity rotation as the top view', () => {
    const camera = directedCameraFromNamedView(savedView())

    expectVector(camera.direction, [0, 0, -1])
    expectVector(camera.up, [0, 1, 0])
    expect(camera.target).toEqual([1, 2, 3])
    expect(camera.distance).toBe(100)
    expect(camera.projection).toBe('perspective')
  })

  it('reads a half turn about X as the bottom view', () => {
    const camera = directedCameraFromNamedView(
      savedView({ pivot_rotation: [1, 0, 0, 0], is_ortho: true })
    )

    expectVector(camera.direction, [0, 0, 1])
    expectVector(camera.up, [0, -1, 0])
    expect(camera.projection).toBe('orthographic')
  })

  it('reads a quarter turn about X as looking along +Y with Z up', () => {
    const half = Math.SQRT1_2
    const camera = directedCameraFromNamedView(
      savedView({ pivot_rotation: [half, 0, 0, half] })
    )

    expectVector(camera.direction, [0, 1, 0])
    expectVector(camera.up, [0, 0, 1])
  })

  it('normalizes a rotation that is not a unit quaternion', () => {
    const camera = directedCameraFromNamedView(
      savedView({ pivot_rotation: [2, 0, 0, 0] })
    )

    expectVector(camera.direction, [0, 0, 1])
  })

  it('drops a distance that is not positive', () => {
    expect(
      directedCameraFromNamedView(savedView({ eye_offset: 0 })).distance
    ).toBeUndefined()
  })

  it('converts a Y-up camera to Z-up', () => {
    const camera = directedCameraFromNamedView(
      savedView({ world_coord_system: 'right_handed_up_y' })
    )

    expectVector(camera.direction, [0, 1, 0])
    expectVector(camera.up, [0, 0, 1])
    expect(camera.target).toEqual([1, -3, 2])
  })
})

describe('sanitizeViewName', () => {
  it('trims and replaces characters a KCL string cannot hold', () => {
    expect(sanitizeViewName('  Front "A" \\ B ', 'View 1')).toBe(
      "Front 'A' / B"
    )
  })

  it('falls back when nothing is left', () => {
    expect(sanitizeViewName('   ', 'View 3')).toBe('View 3')
  })
})

describe('uniqueViewName', () => {
  it('keeps a free name', () => {
    expect(uniqueViewName('Front', new Set())).toBe('Front')
  })

  it('numbers a taken or reserved name', () => {
    expect(uniqueViewName('Front', new Set(['Front', 'Front (2)']))).toBe(
      'Front (3)'
    )
    expect(uniqueViewName('Default View', new Set())).toBe('Default View (2)')
  })
})

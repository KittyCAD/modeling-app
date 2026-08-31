import { describe, expect, it } from 'vitest'
import { orientationForName } from '@src/lib/scene/gizmoOrientation'

const direction = (name: string) => {
  const found = orientationForName(name)
  return found && [found.direction.x, found.direction.y, found.direction.z]
}

describe('orientationForName', () => {
  /*
   * The mapping the existing app uses, and the reason it serves twenty-six
   * targets without listing them: the direction is the *sum* of the axis for
   * each word in the name.
   */
  it('reads the six faces', () => {
    expect(direction('face_right')).toEqual([1, 0, 0])
    expect(direction('face_left')).toEqual([-1, 0, 0])
    expect(direction('face_back')).toEqual([0, 1, 0])
    expect(direction('face_front')).toEqual([0, -1, 0])
    expect(direction('face_top')).toEqual([0, 0, 1])
    expect(direction('face_bottom')).toEqual([0, 0, -1])
  })

  it('adds the axes together for an edge', () => {
    const found = direction('edge_front_right')
    expect(found?.[0]).toBeCloseTo(Math.SQRT1_2)
    expect(found?.[1]).toBeCloseTo(-Math.SQRT1_2)
    expect(found?.[2]).toBeCloseTo(0)
  })

  it('adds all three for a corner', () => {
    const found = direction('corner_front_left_top')
    const third = 1 / Math.sqrt(3)
    expect(found?.[0]).toBeCloseTo(-third)
    expect(found?.[1]).toBeCloseTo(-third)
    expect(found?.[2]).toBeCloseTo(third)
  })

  it('picks a usable up for the two faces where Z is degenerate', () => {
    // Looking straight down, there is no "up" along the axis being looked down.
    expect(orientationForName('face_top')?.up).toEqual({ x: 0, y: 1, z: 0 })
    expect(orientationForName('face_bottom')?.up).toEqual({ x: 0, y: -1, z: 0 })
    expect(orientationForName('face_front')?.up).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('has no answer for a name that means no direction', () => {
    expect(orientationForName('gizmo_boundary_lines')).toBeNull()
    expect(orientationForName('face_')).toBeNull()
  })
})

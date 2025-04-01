import { Quaternion } from 'three'

import { isQuaternionVertical } from './helpers'

describe('isQuaternionVertical', () => {
  it('should identify vertical quaternions', () => {
    const verticalQuaternions = [
      new Quaternion(1, 0, 0, 0).normalize(), // bottom
      new Quaternion(-0.7, 0.7, 0, 0).normalize(), // bottom 2
      new Quaternion(0, 1, 0, 0).normalize(), // bottom 3
      new Quaternion(0, 0, 0, 1).normalize(), // look from top
    ]
    verticalQuaternions.forEach((quaternion) => {
      expect(isQuaternionVertical(quaternion)).toBe(true)
    })
  })

  it('should identify non-vertical quaternions', () => {
    const nonVerticalQuaternions = [
      new Quaternion(0.7, 0, 0, 0.7).normalize(), // front
      new Quaternion(0, 0.7, 0.7, 0).normalize(), // back
      new Quaternion(-0.5, 0.5, 0.5, -0.5).normalize(), // left side
      new Quaternion(0.5, 0.5, 0.5, 0.5).normalize(), // right side
    ]
    nonVerticalQuaternions.forEach((quaternion) => {
      expect(isQuaternionVertical(quaternion)).toBe(false)
    })
  })
})

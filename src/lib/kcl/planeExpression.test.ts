import { describe, expect, it } from 'vitest'
import { planeExpression } from '@src/lib/kcl/planeExpression'

describe('writing down a clicked plane', () => {
  it('names the plane you clicked', () => {
    expect(planeExpression({ plane: 'xy', facing: 'front' })).toBe('XY')
    expect(planeExpression({ plane: 'xz', facing: 'front' })).toBe('XZ')
    expect(planeExpression({ plane: 'yz', facing: 'front' })).toBe('YZ')
  })

  /*
   * The negative planes are not other planes. They are the same plane faced the
   * other way, which is how sketching on the underside of something is written.
   */
  it('negates it when you clicked the back', () => {
    expect(planeExpression({ plane: 'xy', facing: 'back' })).toBe('-XY')
    expect(planeExpression({ plane: 'yz', facing: 'back' })).toBe('-YZ')
  })
})

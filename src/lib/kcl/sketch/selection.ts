import type { EntityReference } from '@kittycad/lib'
import type { SceneSelection } from '@src/lib/scene/selection'

/** Wire filters allow objects; semantic targets distinguish starting on a surface from editing a sketch. */
export function sketchIntent(
  reference: EntityReference
): 'new' | 'edit' | undefined {
  switch (reference.type) {
    case 'plane':
    case 'face':
      return 'new'
    case 'region':
    case 'solid2d':
    case 'segment':
      return 'edit'
    case 'helix':
    case 'solid3d':
    case 'edge':
    case 'vertex':
    case 'annotation':
    case 'solid2d_edge':
      return undefined
  }
}
export function selectedSketchTarget(values: readonly SceneSelection[]) {
  return (
    values.find((value) => sketchIntent(value.reference) === 'edit') ??
    values.find((value) => sketchIntent(value.reference) === 'new')
  )
}

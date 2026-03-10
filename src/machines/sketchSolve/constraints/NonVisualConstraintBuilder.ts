import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  createConstraintSprite,
  updateConstraintSprite,
} from '@src/machines/sketchSolve/constraints/ConstraintSprite'
import {
  getConstraintIconPath,
  getNonVisualConstraintPlacement,
  isNonVisualConstraint,
  type NonVisualConstraintObject,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { CONSTRAINT_COLOR } from '@src/machines/sketchSolve/constraints/DimensionLine'
import { getResolvedTheme } from '@src/lib/theme'
import type { Group } from 'three'

export class NonVisualConstraintBuilder {
  private readonly resources: ConstraintResources

  constructor(resources: ConstraintResources) {
    this.resources = resources
  }

  public init(obj: NonVisualConstraintObject) {
    return createConstraintSprite({
      constraintId: obj.id,
      constraintType: obj.kind.constraint.type,
      iconPath: getConstraintIconPath(obj.kind.constraint.type),
    })
  }

  public update(
    group: Group,
    obj: ApiObject,
    objects: ApiObject[],
    sceneInfra: SceneInfra,
    selectedIds: number[],
    hoveredId: number | null,
    showConstraints: boolean
  ) {
    if (!isNonVisualConstraint(obj)) {
      group.visible = false
      return
    }

    const placement = getNonVisualConstraintPlacement(obj, objects)
    if (!showConstraints || !placement) {
      group.visible = false
      return
    }

    const theme = getResolvedTheme(sceneInfra.theme)
    this.resources.updateMaterials(CONSTRAINT_COLOR[theme])

    updateConstraintSprite(group, {
      sceneInfra,
      position: placement.anchor,
      offsetPx: placement.offsetPx,
      color: this.resources.getConstraintColor(obj.id, selectedIds, hoveredId),
      visible: true,
    })
  }
}

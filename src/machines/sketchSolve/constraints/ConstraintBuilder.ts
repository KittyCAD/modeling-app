import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { type Group } from 'three'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  type ConstraintObject,
  isDiameterConstraint,
  isDistanceConstraint,
  isRadiusConstraint,
} from '@src/machines/sketchSolve/constraints/constraintUtils'

import { DistanceConstraintBuilder } from '@src/machines/sketchSolve/constraints/DistanceConstraintBuilder'
import { RadiusConstraintBuilder } from '@src/machines/sketchSolve/constraints/RadiusConstraintBuilder'

export type EditingCallbacks = {
  cancel: () => void
  submit: (value: string) => void | Promise<void>
}

export class ConstraintBuilder {
  private readonly resources = new ConstraintResources()
  private readonly distanceBuilder = new DistanceConstraintBuilder(
    this.resources
  )
  private readonly radiusBuilder = new RadiusConstraintBuilder(this.resources)

  public init(obj: ConstraintObject): Group | null {
    if (isDistanceConstraint(obj)) {
      return this.distanceBuilder.init(obj)
    } else if (isRadiusConstraint(obj) || isDiameterConstraint(obj)) {
      return this.radiusBuilder.init(obj)
    }
    console.warn('Unimplemented constraint type')
    return null
  }

  public update(
    group: Group,
    obj: ApiObject,
    objects: ApiObject[],
    scale: number,
    sceneInfra: SceneInfra,
    selectedIds: number[],
    hoveredId: number | null
  ) {
    if (isDistanceConstraint(obj)) {
      this.distanceBuilder.update(
        group,
        obj,
        objects,
        scale,
        sceneInfra,
        selectedIds,
        hoveredId
      )
    } else if (isRadiusConstraint(obj) || isDiameterConstraint(obj)) {
      this.radiusBuilder.update(
        group,
        obj,
        objects,
        scale,
        sceneInfra,
        selectedIds,
        hoveredId
      )
    }
  }
}

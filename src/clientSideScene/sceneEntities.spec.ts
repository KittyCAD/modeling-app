import { describe, expect, it } from 'vitest'

import { SceneEntities } from '@src/clientSideScene/sceneEntities'
import { X_AXIS, Y_AXIS } from '@src/clientSideScene/sceneUtils'
import { createSettings } from '@src/lib/settings/initialSettings'
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'

describe('SceneEntities sketch axes', () => {
  it('hides axis materials without removing their raycast targets', () => {
    const xAxisMaterial = new MeshBasicMaterial()
    const yAxisMaterial = new MeshBasicMaterial()
    const xAxis = new Mesh(new BoxGeometry(100, 1, 0.1), xAxisMaterial)
    const yAxis = new Mesh(new BoxGeometry(1, 100, 0.1), yAxisMaterial)
    xAxis.name = X_AXIS
    yAxis.name = Y_AXIS

    const axisGroup = new Group()
    axisGroup.add(xAxis, yAxis)
    axisGroup.updateMatrixWorld(true)

    const settings = createSettings()
    settings.modeling.showSketchGrid.project = false
    const sceneEntities = Object.create(
      SceneEntities.prototype
    ) as SceneEntities
    sceneEntities.axisGroup = axisGroup
    sceneEntities.getSettings = () => settings

    sceneEntities.updateSketchGrid()

    expect(xAxis.visible).toBe(true)
    expect(yAxis.visible).toBe(true)
    expect(xAxisMaterial.visible).toBe(false)
    expect(yAxisMaterial.visible).toBe(false)

    const xAxisRaycaster = new Raycaster(
      new Vector3(20, 0, 10),
      new Vector3(0, 0, -1)
    )
    const yAxisRaycaster = new Raycaster(
      new Vector3(0, 20, 10),
      new Vector3(0, 0, -1)
    )
    expect(xAxisRaycaster.intersectObject(xAxis).length).toBeGreaterThan(0)
    expect(yAxisRaycaster.intersectObject(yAxis).length).toBeGreaterThan(0)

    settings.modeling.showSketchGrid.project = true
    sceneEntities.updateSketchGrid()

    expect(xAxisMaterial.visible).toBe(true)
    expect(yAxisMaterial.visible).toBe(true)
  })
})

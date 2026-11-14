import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  type Object3D,
} from 'three'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { quaternionFromUpNForward } from '@src/clientSideScene/helpers'
import { InfiniteGridRenderer } from '@src/clientSideScene/InfiniteGridRenderer'
import { getGridScaleFactor } from '@src/clientSideScene/gridUtils'
import {
  RAYCASTABLE_PLANE,
  INTERSECTION_PLANE_LAYER,
  SKETCH_SOLVE_GROUP,
  SKETCH_LAYER,
  X_AXIS,
  Y_AXIS,
  AXIS_GROUP,
} from '@src/clientSideScene/sceneUtils'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { Themes, getResolvedTheme } from '@src/lib/theme'
function setAxisVisualVisibility(axis: Object3D | undefined, visible: boolean) {
  if (
    !(axis instanceof Mesh) ||
    !(axis.material instanceof MeshBasicMaterial)
  ) {
    return
  }

  // Keep the mesh raycastable while hiding only its rendered material.
  axis.visible = true
  axis.material.visible = visible
}

export function createIntersectionPlane(sceneInfra: SceneInfra) {
  const hundredM = 100_0000
  const planeGeometry = new PlaneGeometry(hundredM, hundredM)
  const planeMaterial = new MeshBasicMaterial({
    color: 0xff0000,
    side: DoubleSide,
    transparent: true,
    opacity: 0.5,
  })
  const intersectionPlane = new Mesh(planeGeometry, planeMaterial)
  intersectionPlane.userData = { type: RAYCASTABLE_PLANE }
  intersectionPlane.name = RAYCASTABLE_PLANE
  intersectionPlane.layers.set(INTERSECTION_PLANE_LAYER)
  sceneInfra.scene.add(intersectionPlane)
  return intersectionPlane
}
export function createSketchSolveGroup(sceneInfra: SceneInfra) {
  const group = new Group()
  group.userData = { type: SKETCH_SOLVE_GROUP }
  group.name = SKETCH_SOLVE_GROUP
  group.layers.set(SKETCH_LAYER)
  sceneInfra.scene.add(group)
  return group
}

export function createSketchAxis(
  sceneInfra: SceneInfra,
  forward: [number, number, number],
  up: [number, number, number],
  sketchPosition?: [number, number, number]
) {
  const baseXColor = 0x000055
  const baseYColor = 0x550000
  const axisPixelWidth = 1.6
  const xAxisGeometry = new BoxGeometry(100000, axisPixelWidth, 0.01)
  const yAxisGeometry = new BoxGeometry(axisPixelWidth, 100000, 0.01)
  const xAxisMaterial = new MeshBasicMaterial({
    color: baseXColor,
    depthTest: false,
  })
  const yAxisMaterial = new MeshBasicMaterial({
    color: baseYColor,
    depthTest: false,
  })
  const xAxisMesh = new Mesh(xAxisGeometry, xAxisMaterial)
  const yAxisMesh = new Mesh(yAxisGeometry, yAxisMaterial)
  xAxisMesh.renderOrder = -2
  yAxisMesh.renderOrder = -1

  xAxisMesh.userData = {
    type: X_AXIS,
    baseColor: baseXColor,
    isSelected: false,
  }
  yAxisMesh.userData = {
    type: Y_AXIS,
    baseColor: baseYColor,
    isSelected: false,
  }
  xAxisMesh.name = X_AXIS
  yAxisMesh.name = Y_AXIS

  const axisGroup = new Group()
  const gridRenderer = new InfiniteGridRenderer()

  const factor = sceneInfra.getClientSceneScaleFactor(axisGroup)
  xAxisMesh?.scale.set(1, factor, 1)
  yAxisMesh?.scale.set(factor, 1, 1)

  axisGroup.add(xAxisMesh, yAxisMesh, gridRenderer)

  axisGroup.userData = { type: AXIS_GROUP }
  axisGroup.name = AXIS_GROUP
  axisGroup.layers.set(SKETCH_LAYER)
  axisGroup.traverse((child) => {
    child.layers.set(SKETCH_LAYER)
  })

  const quat = quaternionFromUpNForward(
    new Vector3(...up),
    new Vector3(...forward)
  )
  axisGroup.setRotationFromQuaternion(quat)
  if (sketchPosition) {
    axisGroup.position.set(...sketchPosition)
  }
  sceneInfra.scene.add(axisGroup)

  return axisGroup
}

export function updateSketchGrid(
  sceneInfra: SceneInfra,
  axisGroup: Group | null,
  settings: SettingsType
) {
  const gridRenderer = axisGroup?.children.find(
    (child) => child instanceof InfiniteGridRenderer
  )

  const showSketchGrid = settings?.modeling.showSketchGrid.current ?? false
  const xAxis = axisGroup?.getObjectByName(X_AXIS)
  const yAxis = axisGroup?.getObjectByName(Y_AXIS)
  setAxisVisualVisibility(xAxis, showSketchGrid)
  setAxisVisualVisibility(yAxis, showSketchGrid)

  if (!gridRenderer) {
    return
  }
  if (!settings) {
    gridRenderer.visible = false
    console.error('Settings not available for grid update')
    return
  }
  if (!showSketchGrid) {
    gridRenderer.visible = false
    return
  }

  const majorGridSpacing = settings.modeling.majorGridSpacing.current ?? 1
  const minorGridsPerMajor = settings.modeling.minorGridsPerMajor.current ?? 4

  const camera = sceneInfra.camControls.camera
  const viewportSize = sceneInfra.renderer.getDrawingBufferSize(new Vector2())
  // Choose grid colors based on app theme: dark = existing colors, light = subtle gray
  const isLight = getResolvedTheme(sceneInfra.theme) === Themes.Light
  const majorColor: [number, number, number, number] = isLight
    ? [0.3, 0.3, 0.3, 1.0]
    : [0.7, 0.7, 0.7, 1.0]
  const minorColor: [number, number, number, number] = isLight
    ? [0.2, 0.2, 0.2, 1.0]
    : [0.9, 0.9, 0.9, 1.0]

  const pixelsPerBaseUnit = gridRenderer.getPixelsPerBaseUnit(camera, [
    viewportSize.x,
    viewportSize.y,
  ])
  const fixedSizeGrid = settings.modeling.fixedSizeGrid.current
  const gridScaleFactor = getGridScaleFactor({
    majorGridSpacing,
    pixelsPerBaseUnit,
    fixedSizeGrid,
  })
  gridRenderer.update(camera, pixelsPerBaseUnit, gridScaleFactor, {
    majorGridSpacing,
    minorGridsPerMajor,
    majorColor,
    minorColor,
    fixedSizeGrid,
  })
}

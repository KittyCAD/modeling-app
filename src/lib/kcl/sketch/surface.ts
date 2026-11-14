import type {
  MoveToolHost,
  MoveToolState,
} from '@src/machines/sketchSolve/tools/moveTool/host'
import { signal } from '@preact/signals-core'
import {
  updateSketchSelection,
  type SketchSolveSelectionId,
  type SelectionCoordinates,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import { attachSketchInput } from '@src/clientSideScene/sketchInput'
import { isArray } from '@src/lib/utils'
import { Vector3 } from 'three'
import { quaternionFromUpNForward } from '@src/clientSideScene/helpers'
import {
  createIntersectionPlane,
  createSketchSolveGroup,
  createSketchAxis,
  updateSketchGrid,
} from '@src/clientSideScene/sketchScene'
import { disposeGroupChildren } from '@src/clientSideScene/sceneHelpers'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  updateSceneGraphFromDelta,
  type SketchSceneContext,
} from '@src/machines/sketchSolve/sketchSceneGraph'
import type { SketchPlane } from '@src/lib/kcl/sketch/target'

/** Reuse the legacy Three.js sketch geometry, raycast plane, grid, and delta renderer in one owned surface. */
export function createSketchSurface(
  infra: SceneInfra,
  settings: SettingsRegistryService,
  plane: SketchPlane,
  sketchId: number
) {
  const detachInput = attachSketchInput(infra.renderer.domElement, infra)
  const intersection = createIntersectionPlane(infra)
  const group = createSketchSolveGroup(infra)
  const quaternion = quaternionFromUpNForward(
    new Vector3(...plane.yAxis),
    new Vector3(...plane.zAxis)
  )
  for (const object of [intersection, group]) {
    object.setRotationFromQuaternion(quaternion)
    object.position.set(...plane.origin)
  }
  const axes = createSketchAxis(infra, plane.zAxis, plane.yAxis, plane.origin)
  const selected = signal<SketchSolveSelectionId[]>([])
  const hovered = signal<SketchSolveSelectionId | null>(null)
  let coordinates: SelectionCoordinates = {}
  let duringAreaSelectIds: number[] = []
  let disposed = false
  const context: SketchSceneContext = {
    sketchId,
    sceneInfra: infra,
    sceneEntitiesManager: { sketchSolveGroup: group },
    selectedIds: [],
    hoveredId: null,
    showNonVisualConstraints: false,
    constraintHoverPopups: [],
  }
  let latest: SceneGraphDelta | undefined
  const render = (
    delta: SceneGraphDelta,
    draft?: { segmentIds: number[]; constraintIds: number[] }
  ) => {
    latest = delta
    if (disposed) return
    selected.value = selected
      .peek()
      .filter(
        (id) => typeof id !== 'number' || delta.new_graph.objects[id] != null
      )
    if (
      typeof hovered.peek() === 'number' &&
      !delta.new_graph.objects[Number(hovered.peek())]
    )
      hovered.value = null
    context.selectedIds = selected.peek()
    context.hoveredId = hovered.peek()
    context.draftEntities = draft
    updateSceneGraphFromDelta({
      sceneGraphDelta: delta,
      context,
      selectedIds: selected.peek(),
      duringAreaSelectIds,
    })
    infra.scene.updateMatrixWorld(true)
    infra.resumeRendering()
  }
  const refresh = () => {
    context.selectedIds = selected.peek()
    context.hoveredId = hovered.peek()
    if (latest && !disposed)
      updateSceneGraphFromDelta({
        sceneGraphDelta: { ...latest, invalidates_ids: false },
        context,
        selectedIds: selected.peek(),
        duringAreaSelectIds,
      })
    infra.resumeRendering()
  }
  const hover = (id: SketchSolveSelectionId | null) => {
    if (hovered.peek() !== id) {
      hovered.value = id
      refresh()
    }
  }
  const select = (
    ids: SketchSolveSelectionId[],
    replace = false,
    next: SelectionCoordinates = {}
  ) => {
    const update = updateSketchSelection(
      selected.peek(),
      ids,
      { ...coordinates, ...next },
      replace
    )
    selected.value = update.selectedIds
    coordinates = update.selectionCoordinates
    refresh()
  }
  const selection: MoveToolHost['selection'] = (data) => {
    if (data.duringAreaSelectIds !== undefined)
      duringAreaSelectIds = data.duringAreaSelectIds
    if (data.selectedIds !== undefined)
      select(
        data.selectedIds,
        data.replaceExistingSelection,
        data.selectionCoordinates
      )
    else refresh()
  }
  const updateHover: MoveToolHost['hover'] = (data) => {
    if (data.constraintHoverPopups !== undefined)
      context.constraintHoverPopups = data.constraintHoverPopups
    hovered.value = data.hoveredId
    refresh()
  }
  const getState = (
    sketchExecOutcome: MoveToolState['sketchExecOutcome']
  ): MoveToolState => ({
    sketchId,
    selectedIds: selected.peek(),
    hoveredId: hovered.peek(),
    selectionCoordinates: coordinates,
    duringAreaSelectIds,
    showNonVisualConstraints: context.showNonVisualConstraints,
    constraintHoverPopups: context.constraintHoverPopups,
    sketchExecOutcome,
  })
  const leave = () => hover(null)
  infra.renderer.domElement.addEventListener('mouseleave', leave)
  infra.setOnBeforeRender(() => {
    updateSketchGrid(infra, axes, settings.current.peek())
    if (latest)
      updateSceneGraphFromDelta({
        sceneGraphDelta: { ...latest, invalidates_ids: false },
        context,
        selectedIds: selected.peek(),
        duringAreaSelectIds,
      })
  })
  return {
    selected,
    hovered,
    hover,
    select,
    selection,
    updateHover,
    getState,
    group,
    render,
    dispose: () => {
      disposed = true
      infra.renderer.domElement.removeEventListener('mouseleave', leave)
      detachInput()
      infra.setOnBeforeRender(null)
      infra.resetMouseListeners()
      for (const object of [group, axes]) {
        disposeGroupChildren(object)
        object.removeFromParent()
      }
      intersection.removeFromParent()
      intersection.geometry.dispose()
      if (!isArray(intersection.material)) intersection.material.dispose()
    },
  }
}

import { createEntityStyling } from '@src/lib/scene/entityStyling'
import { ObjectStylingRenderer } from '@src/lib/scene/ObjectStylingRenderer'
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
import { Vector3, type Mesh } from 'three'
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
  getSegmentRenderState,
  getHoveredSegmentIds,
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
  const styling = createEntityStyling<number>()
  const stylingRenderer = new ObjectStylingRenderer(infra.scene)
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
  const projectStyles = () => {
    if (disposed || !latest) return
    if (!styling.service.groups.peek().length) {
      stylingRenderer.setGroups([])
      return
    }
    const objects = latest.new_graph.objects
    const hoveredSegments = getHoveredSegmentIds(hovered.peek(), objects)
    stylingRenderer.setGroups(
      styling.service.groups.peek().map((styleGroup) => ({
        id: styleGroup.id,
        style: styleGroup.style,
        targets: styleGroup.entities.flatMap((id) => {
          if (!objects[id]) return []
          const state = getSegmentRenderState(
            id,
            selected.peek(),
            duringAreaSelectIds,
            hovered.peek(),
            hoveredSegments,
            context.draftEntities?.segmentIds,
            objects
          )
          if (
            state.selected ||
            state.hovered ||
            state.secondaryHovered ||
            state.draft
          )
            return []
          const object = group.getObjectByName(String(id)),
            targets: Mesh[] = []
          object?.traverse((child) => {
            if ((child as Mesh).isMesh) targets.push(child as Mesh)
          })
          return targets
        }),
      }))
    )
  }
  const stopStyling = styling.service.groups.subscribe(() => {
    if (latest) {
      projectStyles()
      infra.resumeRendering()
    }
  })
  const render = (
    delta: SceneGraphDelta,
    draft?: { segmentIds: number[]; constraintIds: number[] }
  ) => {
    if (disposed) return
    if (latest !== delta) styling.reset()
    latest = delta
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
    projectStyles()
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
    projectStyles()
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
    projectStyles()
  })
  return {
    selected,
    entityStyling: styling.service,
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
      stopStyling()
      styling.dispose()
      stylingRenderer.dispose()
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

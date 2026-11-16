import {
  computed,
  effect,
  signal,
  type ReadonlySignal,
} from '@preact/signals-core'
import type { SnapshotFrom } from 'xstate'
import type { Mesh } from 'three'
import { ObjectStylingRenderer } from '@src/lib/scene/ObjectStylingRenderer'
import { createEntityStyling } from '@src/lib/scene/entityStyling'
import { createSketchCorrespondence } from '@src/lib/kcl/sketch/correspondence'
import type { SketchCorrespondenceEndpoint } from '@src/lib/kcl/correspondence/sketchContract'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import {
  getHoveredSegmentIds,
  getSegmentRenderState,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import type { KclManager } from '@src/lang/KclManager'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { KclSceneResource } from '@src/lib/kcl/scene'

/** Borrow the machine's rendered graph and Three.js objects; correspondence never owns another sketch surface or controller. */
export function bindMachineSketchCorrespondence(
  editor: Editor,
  scene: KclSceneResource,
  model: KclManager,
  child: ReadonlySignal<SnapshotFrom<typeof sketchSolveMachine> | undefined>
) {
  const endpoint = signal<SketchCorrespondenceEndpoint | undefined>(undefined)
  const styling = createEntityStyling<number>()
  const renderer = new ObjectStylingRenderer(scene.sceneInfra.scene)
  const selected = computed(() => child.value?.context.selectedIds ?? [])
  let binding: ReturnType<typeof createSketchCorrespondence> | undefined
  let owner: unknown, graph: unknown
  const refreshStyles = () => {
    const context = child.peek()?.context
    const delta = context?.sketchExecOutcome?.sceneGraphDelta
    const group = model.sceneEntitiesManager.sketchSolveGroup
    if (!context || !delta || !group) {
      renderer.setGroups([])
      return
    }
    const objects = delta.new_graph.objects
    const hovered = getHoveredSegmentIds(context.hoveredId, objects)
    renderer.setGroups(
      styling.service.groups.peek().map((styleGroup) => ({
        id: styleGroup.id,
        style: styleGroup.style,
        targets: styleGroup.entities.flatMap((id) => {
          if (!objects[id]) return []
          const state = getSegmentRenderState(
            id,
            context.selectedIds,
            context.duringAreaSelectIds,
            context.hoveredId,
            hovered,
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
          const targets: Mesh[] = []
          group.getObjectByName(String(id))?.traverse((object) => {
            if ((object as Mesh).isMesh) targets.push(object as Mesh)
          })
          return targets
        }),
      }))
    )
    renderer.update()
    scene.sceneInfra.resumeRendering()
  }
  const stopStyles = styling.service.groups.subscribe(refreshStyles)
  const stop = effect(() => {
    const snapshot = child.value
    if (!snapshot) {
      binding?.dispose()
      binding = undefined
      endpoint.value = undefined
      owner = undefined
      graph = undefined
      renderer.setGroups([])
      return
    }
    if (owner !== snapshot.context.sketchId) {
      binding?.dispose()
      owner = snapshot.context.sketchId
      binding = createSketchCorrespondence({
        editor,
        src: editor.src.peek() ?? '',
        sketchId: snapshot.context.sketchId,
        surface: { selected, entityStyling: styling.service },
        sources: scene.runtime.sources.peek(),
        isCurrent: () => child.peek()?.context.sketchId === owner,
      })
      endpoint.value = binding.endpoint
    }
    const outcome = snapshot.context.sketchExecOutcome
    if (outcome && graph !== outcome.sceneGraphDelta) {
      graph = outcome.sceneGraphDelta
      binding?.rendered(outcome.sceneGraphDelta, outcome.sourceDelta.text)
    }
    refreshStyles()
  })
  return {
    endpoint,
    dispose: () => {
      stop()
      stopStyles()
      binding?.dispose()
      styling.dispose()
      renderer.dispose()
    },
  }
}

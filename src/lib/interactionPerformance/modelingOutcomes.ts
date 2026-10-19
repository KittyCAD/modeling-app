import { Vector3 } from 'three'

import type { KclManager } from '@src/lang/KclManager'
import {
  isVisible,
  transitionsEnded,
} from '@src/lib/interactionPerformance/outcomes'
import type {
  InteractionDefinition,
  InteractionDescription,
} from '@src/lib/interactionPerformance/types'

export const modelingInteractions = {
  sketchPlaneEnter: {
    id: 'zds.sketch.enter.plane',
    testId: 'operations-list-pane',
    budgetMs: 150,
    outcome:
      'A new plane sketch has synchronized camera and enabled sketch tools',
  },
  sketchFaceEnter: {
    id: 'zds.sketch.enter.face',
    testId: 'stream',
    budgetMs: 150,
    outcome:
      'A new face sketch has synchronized camera and enabled sketch tools',
  },
  sketchExistingEdit: {
    id: 'zds.sketch.edit.existing',
    testId: 'feature-tree-operation-item',
    budgetMs: 150,
    outcome:
      'The existing sketch is editable with synchronized camera and enabled tools',
  },
  cubeFace: {
    id: 'zds.camera.cube.face',
    testId: 'gizmo',
    budgetMs: 150,
    outcome:
      'The front cube-face camera tween completed and orbit control is restored',
  },
  cubeEdge: {
    id: 'zds.camera.cube.edge',
    testId: 'gizmo',
    budgetMs: 150,
    outcome:
      'The front/top cube-edge camera tween completed and orbit control is restored',
  },
  cubeCorner: {
    id: 'zds.camera.cube.corner',
    testId: 'gizmo',
    budgetMs: 150,
    outcome:
      'The front/right/top cube-corner camera tween completed and orbit control is restored',
  },
  sceneDimmingEnter: {
    id: 'zds.scene.dimming.enter',
    testId: 'client-side-scene',
    budgetMs: 150,
    outcome:
      'Sketch mode is ready and the viewport dimming transition completed',
  },
  sceneDimmingExit: {
    id: 'zds.scene.dimming.exit',
    testId: 'sketch-exit',
    budgetMs: 150,
    outcome: 'Sketch mode exited and the viewport dimming transition completed',
  },
} satisfies Record<string, InteractionDescription>

/** Retained implementations are not measured by manufacturing removed UI state. */
export const unsupportedModelingInteractions: Array<{
  definition: InteractionDescription
  reason: string
}> = [
  {
    definition: {
      id: 'zds.legacySketch.enter',
      testId: 'sketch',
      budgetMs: 150,
      outcome: 'Legacy sketch entry completed its camera synchronization wait',
    },
    reason:
      'Legacy sketch creation/editing was removed from the UI; the retained camera helper still waits 600 ms.',
  },
  {
    definition: {
      id: 'zds.legacySketch.edit',
      testId: 'feature-tree-operation-item',
      budgetMs: 150,
      outcome: 'Legacy sketch edit completed its camera synchronization wait',
    },
    reason:
      'Edit Sketch is disabled for legacy sketches; feature-tree double-click reports that legacy sketch mode was removed.',
  },
  {
    definition: {
      id: 'zds.legacySketch.deleteWarning.open',
      testId: 'client-side-scene',
      budgetMs: 150,
      outcome:
        'The dependent-segment deletion warning completed its 300 ms opening transition',
    },
    reason:
      'The dependent-segment deletion warning requires the removed legacy sketch editor.',
  },
  {
    definition: {
      id: 'zds.legacySketch.deleteWarning.close',
      testId: 'client-side-scene',
      budgetMs: 150,
      outcome:
        'The dependent-segment deletion warning completed its 200 ms closing transition',
    },
    reason:
      'Continue and unconstrain / Cancel belong to the removed legacy sketch editor.',
  },
  {
    definition: {
      id: 'zds.legacySketch.orbit.disable',
      testId: 'allowOrbitInSketchMode',
      budgetMs: 150,
      outcome: 'Disabling orbit returned the legacy sketch camera to its plane',
    },
    reason:
      'The 600 ms return-to-plane effect only runs in legacy Sketch state, which is no longer reachable through the UI.',
  },
  {
    definition: {
      id: 'zds.legacySketch.angleLengthModal.open',
      testId: 'constraint-angle',
      budgetMs: 150,
      outcome:
        'The legacy angle/absolute-distance dialog completed its 300 ms opening transition',
    },
    reason:
      'SetAngleLengthModal is opened by the legacy angle and absolute-distance actors under Sketch.SketchIdle; normal UI no longer enters legacy Sketch state.',
  },
  {
    definition: {
      id: 'zds.legacySketch.angleLengthModal.close',
      testId: 'constraint-angle',
      budgetMs: 150,
      outcome:
        'The legacy angle/absolute-distance dialog completed its 200 ms closing transition',
    },
    reason:
      'SetAngleLengthModal requires the removed legacy Sketch editor; current sketch-solve dimensions use a different editor.',
  },
  {
    definition: {
      id: 'zds.legacySketch.constraintDetailsModal.open',
      testId: 'constraint-horizontal-distance',
      budgetMs: 150,
      outcome:
        'The legacy constraint-details dialog completed its 300 ms opening transition',
    },
    reason:
      'SetHorVertDistanceModal GetInfoModal callers for distance, angle-between, and intersection constraints are invoked only by legacy Sketch actors.',
  },
  {
    definition: {
      id: 'zds.legacySketch.constraintDetailsModal.close',
      testId: 'constraint-horizontal-distance',
      budgetMs: 150,
      outcome:
        'The legacy constraint-details dialog completed its 200 ms closing transition',
    },
    reason:
      'SetHorVertDistanceModal requires the removed legacy Sketch editor; current sketch-solve dimensions use a different editor.',
  },
]

const sceneSelector = '[data-testid="client-side-scene"]'

function isPlaneButton(target: Element) {
  return Boolean(
    target.closest('#operations-list-pane') &&
      target.closest('button')?.textContent?.includes('Top plane')
  )
}

export function createModelingOutcomes(
  getEditor: () => KclManager | undefined
): InteractionDefinition[] {
  const sketchReady = (document: Document) => {
    const editor = getEditor()
    return Boolean(
      editor?.modelingState?.matches('sketchSolveMode') &&
        editor.sceneInfra.camControls.syncDirection === 'clientToEngine' &&
        isVisible(
          document.querySelector('[data-testid="sketch-exit"]:enabled')
        ) &&
        isVisible(document.querySelector('[data-testid="line"]:enabled'))
    )
  }

  const cubeOutcome = (
    definition: InteractionDescription,
    direction: Vector3
  ): InteractionDefinition => ({
    ...definition,
    matchesTarget: (target) => target.matches('[data-testid="gizmo"] canvas'),
    prepareOutcome() {
      const before =
        getEditor()?.sceneInfra.camControls.camera.quaternion.clone()
      return () => {
        const controls = getEditor()?.sceneInfra.camControls
        if (!controls || !before) return false
        const currentDirection = new Vector3(0, 0, 1).applyQuaternion(
          controls.camera.quaternion
        )
        return (
          controls.camera.quaternion.angleTo(before) > 0.001 &&
          currentDirection.distanceTo(direction) < 0.001 &&
          controls.syncDirection === 'engineToClient' &&
          controls.enableRotate
        )
      }
    },
    isReady: () => false,
  })

  return [
    {
      ...modelingInteractions.sketchPlaneEnter,
      matchesTarget: isPlaneButton,
      isReady: sketchReady,
    },
    {
      ...modelingInteractions.sketchFaceEnter,
      matchesTarget: (target) => Boolean(target.closest('#stream')),
      isReady: sketchReady,
    },
    {
      ...modelingInteractions.sketchExistingEdit,
      events: ['dblclick'],
      matchesTarget: (target) =>
        Boolean(target.closest('[data-testid="feature-tree-operation-item"]')),
      isReady: sketchReady,
    },
    cubeOutcome(modelingInteractions.cubeFace, new Vector3(0, -1, 0)),
    cubeOutcome(
      modelingInteractions.cubeEdge,
      new Vector3(0, -1, 1).normalize()
    ),
    cubeOutcome(
      modelingInteractions.cubeCorner,
      new Vector3(1, -1, 1).normalize()
    ),
    {
      ...modelingInteractions.sceneDimmingEnter,
      matchesTarget: isPlaneButton,
      isReady: (document) =>
        sketchReady(document) &&
        transitionsEnded(document.querySelector(sceneSelector)),
    },
    {
      ...modelingInteractions.sceneDimmingExit,
      matchesTarget: (target) =>
        Boolean(target.closest('[data-testid="sketch-exit"]')),
      isReady: (document) => {
        const scene = document.querySelector(sceneSelector)
        return Boolean(
          getEditor()?.modelingState?.matches('idle') &&
            isVisible(
              document.querySelector('[data-testid="sketch"]:enabled')
            ) &&
            scene &&
            transitionsEnded(scene)
        )
      },
    },
  ]
}

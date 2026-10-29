import { Vector3 } from 'three'

import type { KclManager } from '@src/lang/KclManager'
import {
  animationsEnded,
  isVisible,
} from '@src/lib/interactionPerformance/outcomes'
import { createRenderedViewOutcome } from '@src/lib/interactionPerformance/renderedView'
import type {
  InteractionDefinition,
  InteractionDescription,
} from '@src/lib/interactionPerformance/types'

export const modelingInteractions = {
  sketchPlaneChooserOpen: {
    id: 'zds.sketch.planeChooser.open',
    testId: 'sketch',
    budgetMs: 150,
    outcome:
      'Start Sketch shows a rendered, usable plane chooser and Cancel Sketch control',
  },
  sketchPlaneEnter: {
    id: 'zds.sketch.enter.plane',
    testId: 'operations-list-pane',
    budgetMs: 150,
    outcome:
      'Choosing a plane shows a rendered, editable sketch with ready tools and synchronized camera',
  },
  sketchFaceEnter: {
    id: 'zds.sketch.enter.face',
    testId: 'stream',
    budgetMs: 150,
    outcome:
      'Choosing a face shows a rendered, editable sketch with ready tools and synchronized camera',
  },
  sketchExistingEdit: {
    id: 'zds.sketch.edit.existing',
    testId: 'feature-tree-operation-item',
    budgetMs: 150,
    outcome:
      'The existing sketch is rendered and editable with ready tools and synchronized camera',
  },
  cubeFace: {
    id: 'zds.camera.cube.face',
    testId: 'gizmo',
    budgetMs: 150,
    outcome:
      'The front cube-face view visibly changes, the camera is synchronized, and orbit control is restored',
  },
  cubeEdge: {
    id: 'zds.camera.cube.edge',
    testId: 'gizmo',
    budgetMs: 150,
    outcome:
      'The front/top cube-edge view visibly changes, the camera is synchronized, and orbit control is restored',
  },
  cubeCorner: {
    id: 'zds.camera.cube.corner',
    testId: 'gizmo',
    budgetMs: 150,
    outcome:
      'The front/right/top cube-corner view visibly changes, the camera is synchronized, and orbit control is restored',
  },
  sketchExit: {
    id: 'zds.sketch.exit',
    testId: 'sketch-exit',
    budgetMs: 150,
    outcome:
      'Exit Sketch renders the model again with usable modeling tools, restored camera projection and controls, and a settled scene and toolbar',
  },
} satisfies Record<string, InteractionDescription>

const sceneSelector = '[data-testid="client-side-scene"]'
const toolbarSelector = '[data-testid="toolbar"]'

function sceneAndToolbarReady(document: Document) {
  const scene = document.querySelector(sceneSelector)
  const toolbar = document.querySelector(toolbarSelector)
  return Boolean(
    scene && toolbar && animationsEnded(scene) && animationsEnded(toolbar)
  )
}

function viewCommandsReady(editor: KclManager) {
  const changesView = (type: string) =>
    type.startsWith('default_camera_') ||
    type === 'enable_sketch_mode' ||
    type === 'sketch_mode_disable' ||
    type === 'object_visible' ||
    type === 'set_selection_filter'

  // Plane visibility and selection-filter setup are not awaited by the mode
  // owner. Wait for those view commands, not unrelated background requests.
  return Object.values(editor.engineCommandManager.pendingCommands).every(
    ({ command }) => {
      if (command.type === 'modeling_cmd_req') {
        return !changesView(command.cmd.type)
      }
      if (command.type === 'modeling_cmd_batch_req') {
        return command.requests.every(({ cmd }) => !changesView(cmd.type))
      }
      return true
    }
  )
}

function isPlaneButton(target: Element) {
  return Boolean(
    target.closest('#operations-list-pane') &&
      target.closest('button')?.textContent?.includes('Top plane')
  )
}

export function createModelingOutcomes(
  getEditor: () => KclManager | undefined
): InteractionDefinition[] {
  const getScene = () => getEditor()?.sceneInfra
  const sketchReady = (document: Document) => {
    const editor = getEditor()
    const state = editor?.modelingState
    const controls = editor?.sceneInfra.camControls
    const sketch = state?.children.sketchSolveMachine?.getSnapshot()
    return Boolean(
      editor &&
        !editor.isExecutingSignal.value &&
        state?.matches({ sketchSolveMode: 'active' }) &&
        sketch &&
        typeof sketch === 'object' &&
        'status' in sketch &&
        sketch.status === 'active' &&
        'value' in sketch &&
        sketch.value === 'move and select' &&
        controls?.syncDirection === 'clientToEngine' &&
        !controls.isPerspective &&
        !controls.isFovAnimationInProgress &&
        controls.enablePan &&
        controls.enableRotate === controls._setting_allowOrbitInSketchMode &&
        isVisible(
          document.querySelector('[data-testid="sketch-exit"]:enabled')
        ) &&
        isVisible(document.querySelector('[data-testid="line"]:enabled')) &&
        viewCommandsReady(editor) &&
        sceneAndToolbarReady(document)
    )
  }

  const prepareSketchOutcome = (document: Document) =>
    createRenderedViewOutcome({
      document,
      getScene,
      kind: 'client',
      isReady: () => sketchReady(document),
    })

  const cubeOutcome = (
    definition: InteractionDescription,
    direction: Vector3
  ): InteractionDefinition => ({
    ...definition,
    matchesTarget: (target) => target.matches('[data-testid="gizmo"] canvas'),
    prepareOutcome(document) {
      const before =
        getEditor()?.sceneInfra.camControls.camera.quaternion.clone()
      return createRenderedViewOutcome({
        document,
        getScene,
        kind: 'stream',
        requireViewChange: true,
        isReady: () => {
          const editor = getEditor()
          const controls = editor?.sceneInfra.camControls
          if (!editor || !controls || !before) return false
          const currentDirection = new Vector3(0, 0, 1).applyQuaternion(
            controls.camera.quaternion
          )
          return (
            controls.camera.quaternion.angleTo(before) > 0.001 &&
            currentDirection.distanceTo(direction) < 0.001 &&
            controls.syncDirection === 'engineToClient' &&
            controls.enableRotate &&
            viewCommandsReady(editor)
          )
        },
      })
    },
    isReady: () => false,
  })

  return [
    {
      ...modelingInteractions.sketchPlaneChooserOpen,
      matchesTarget: (target) =>
        Boolean(target.closest('[data-testid="sketch"]')),
      prepareOutcome(document) {
        return createRenderedViewOutcome({
          document,
          getScene,
          kind: 'stream',
          isReady: () => {
            const editor = getEditor()
            const plane = Array.from(
              document.querySelectorAll('#operations-list-pane button:enabled')
            ).find((button) => button.textContent?.includes('Top plane'))
            return Boolean(
              editor?.modelingState?.matches('Sketch no face') &&
                isVisible(plane) &&
                isVisible(
                  document.querySelector('[data-testid="sketch-exit"]:enabled')
                ) &&
                viewCommandsReady(editor) &&
                sceneAndToolbarReady(document)
            )
          },
        })
      },
      isReady: () => false,
    },
    {
      ...modelingInteractions.sketchPlaneEnter,
      matchesTarget: isPlaneButton,
      prepareOutcome: prepareSketchOutcome,
      isReady: () => false,
    },
    {
      ...modelingInteractions.sketchFaceEnter,
      matchesTarget: (target) => Boolean(target.closest('#stream')),
      prepareOutcome: prepareSketchOutcome,
      isReady: () => false,
    },
    {
      ...modelingInteractions.sketchExistingEdit,
      events: ['dblclick'],
      matchesTarget: (target) =>
        Boolean(target.closest('[data-testid="feature-tree-operation-item"]')),
      prepareOutcome: prepareSketchOutcome,
      isReady: () => false,
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
      ...modelingInteractions.sketchExit,
      matchesTarget: (target) =>
        Boolean(target.closest('[data-testid="sketch-exit"]')),
      prepareOutcome(document) {
        return createRenderedViewOutcome({
          document,
          getScene,
          kind: 'stream',
          isReady: () => {
            const editor = getEditor()
            const state = editor?.modelingState
            const controls = editor?.sceneInfra.camControls
            return Boolean(
              editor &&
                !editor.isExecutingSignal.value &&
                !editor.hasErrors() &&
                !editor.hasEditsSinceLastExecutionSignal.value &&
                editor.lastSuccessfulCode === editor.code &&
                editor.artifactGraph.size > 0 &&
                state?.matches('idle') &&
                !state.children.sketchSolveMachine &&
                controls?.syncDirection === 'engineToClient' &&
                !controls.isFovAnimationInProgress &&
                controls.enablePan &&
                controls.enableRotate &&
                (controls.isPerspective ? 'perspective' : 'orthographic') ===
                  state.context.store.cameraProjection?.current &&
                isVisible(
                  document.querySelector('[data-testid="sketch"]:enabled')
                ) &&
                !isVisible(
                  document.querySelector('[data-testid="sketch-exit"]')
                ) &&
                !isVisible(document.querySelector('[data-testid="line"]')) &&
                viewCommandsReady(editor) &&
                sceneAndToolbarReady(document)
            )
          },
        })
      },
      isReady: () => false,
    },
  ]
}

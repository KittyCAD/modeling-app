import type {
  OnClickCallbackArgs,
  SceneInfra,
} from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import type { ModelingMachineEvent } from '@src/machines/modelingMachine'
import { findOperationForArtifact } from '@src/lang/queryAst'
import {
  getArtifactOfTypes,
  getSketchBlockForArtifact,
} from '@src/lang/std/artifactGraph'
import { getAllOperations } from '@src/lang/wasm'
import {
  getEngineRegionSelectionFromPoint,
  normalizeEntityReference,
} from '@src/lib/selections'
import { sendQueryEntityTypeWithPointFromSceneClick } from '@src/lib/kcl/scene/picking'
import { LEGACY_SKETCH_MODE_REMOVED_MESSAGE } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import toast from 'react-hot-toast'

/**
 * Open the editor for the entity under a scene double-click. Sketch geometry enters
 * sketch mode; a GD&T annotation opens its operation's edit command. Empty space
 * and entities without a supported edit action leave the view unchanged. KCL 1.0
 * sketch geometry shows the message that legacy sketch mode was removed.
 *
 * ConnectionStream and the hosted modeling machine both call this function. The
 * supplied element converts browser coordinates to scene coordinates, and the
 * supplied managers, command actor, and send callback belong to the clicked view.
 * acceptsInput checks whether that view still allows the action after async work.
 */
export async function activateSceneEntityAtPoint(
  point: Pick<MouseEvent, 'clientX' | 'clientY'>,
  element: Pick<HTMLElement, 'getBoundingClientRect'>,
  {
    kclManager,
    engineCommandManager,
    commandBarActor,
    wasmInstance,
    send,
    acceptsInput,
  }: {
    kclManager: Pick<
      KclManager,
      'artifactGraph' | 'ast' | 'code' | 'operationsByModule' | 'rustContext'
    >
    engineCommandManager: ConnectionManager
    commandBarActor: CommandBarActorType
    wasmInstance: ModuleType
    send: (event: ModelingMachineEvent) => void
    acceptsInput: () => boolean
  }
) {
  if (!acceptsInput()) return
  // Picking waits for a scene query. Discard its reply if the source or graph
  // was replaced, or if the caller no longer permits editing in this view.
  const graph = kclManager.artifactGraph
  const code = kclManager.code
  const isCurrent = () =>
    acceptsInput() &&
    kclManager.artifactGraph === graph &&
    kclManager.code === code
  const result = await sendQueryEntityTypeWithPointFromSceneClick(
    point,
    element,
    engineCommandManager
  )
  if (!isCurrent() || !result?.reference) {
    return
  }
  const selectedEntityRef = normalizeEntityReference(result.reference)
  let entityId: string | undefined
  switch (selectedEntityRef?.type) {
    case 'annotation':
      entityId = selectedEntityRef.annotation_id
      break
    case 'plane':
      entityId = selectedEntityRef.plane_id
      break
    case 'face':
      entityId = selectedEntityRef.face_id
      break
    case 'solid2d':
      entityId = selectedEntityRef.solid2d_id
      break
    case 'solid3d':
      entityId = selectedEntityRef.solid3d_id
      break
    case 'solid2d_edge':
      entityId = selectedEntityRef.edge_id
      break
    case 'segment':
      entityId = selectedEntityRef.segment_id
      break
    case 'region':
      entityId = selectedEntityRef.region_id
      break
    // Resolve solid edges and vertices through their first adjacent face.
    case 'edge':
    case 'vertex':
      entityId = selectedEntityRef.side_faces[0]
      break
    case 'helix':
    case undefined:
      break
  }
  if (!entityId) {
    return
  }
  const directArtifact = kclManager.artifactGraph.get(entityId)
  // Annotation editing uses the command dialog for its generating operation.
  if (directArtifact?.type === 'gdtAnnotation') {
    const operation = findOperationForArtifact({
      artifact: directArtifact,
      operations: getAllOperations(kclManager.operationsByModule),
    })
    if (!operation) return

    const { prepareEditCommand } = await import('@src/lib/featureTree')
    if (!isCurrent()) return
    await prepareEditCommand({
      artifactGraph: kclManager.artifactGraph,
      code: kclManager.code,
      commandBarActor: commandBarActor,
      operation,
      rustContext: kclManager.rustContext,
      artifact: directArtifact,
    })
    return
  }

  // A clicked segment or filled profile can lead back to its owning sketch block.
  // Send that block to the machine so its existing sketch-entry flow can run.
  const sketchBlockArtifact = getSketchBlockForArtifact(
    directArtifact,
    kclManager.artifactGraph
  )
  if (sketchBlockArtifact) {
    send({
      type: 'Edit sketch solve',
      data: { artifactId: sketchBlockArtifact.id },
    })
    return
  }

  // The engine can expose an enclosed region with no artifact-graph entry.
  // Ask which sketch owns it before giving up on entering sketch mode.
  if (!directArtifact) {
    const regionSelection = await getEngineRegionSelectionFromPoint(
      entityId,
      kclManager.artifactGraph,
      kclManager.ast,
      engineCommandManager,
      wasmInstance
    )

    if (isCurrent() && regionSelection?.sketchId) {
      send({
        type: 'Edit sketch solve',
        data: { artifactId: regionSelection.sketchId },
      })
    }
    return
  }

  const artifactResult = getArtifactOfTypes(
    {
      key: entityId,
      types: ['path', 'solid2d', 'segment', 'helix'],
    },
    kclManager.artifactGraph
  )
  if (err(artifactResult)) {
    return artifactResult
  }
  // These older sketch artifacts have no sketch block to edit. Keep the legacy
  // removal message instead of trying to enter the sketch-block workflow.
  toast.error(LEGACY_SKETCH_MODE_REMOVED_MESSAGE, {
    duration: 5_000,
  })
  return
}

/**
 * Handle left-button double-clicks on a hosted Modeling view's Three.js canvas.
 * Ignore camera drags, and allow editing while the modeling machine is idle and
 * the command bar is closed. The legacy file route uses ConnectionStream's DOM
 * double-click handler instead, so skip managers without a document host.
 */
export async function tryEnterSketchOnDoubleClickFromScene(
  args: OnClickCallbackArgs,
  elementForRect: { getBoundingClientRect(): DOMRect },
  deps: {
    engineCommandManager: ConnectionManager
    kclManager: KclManager
    sceneInfra: SceneInfra
  }
): Promise<void> {
  if (!deps.kclManager.hasDocumentHost) return
  if (args?.mouseEvent?.detail !== 2 || args.mouseEvent.which !== 1) return
  if (deps.sceneInfra.camControls.wasDragging) return
  const manager = deps.kclManager
  const send = deps.sceneInfra.modelingSend
  await activateSceneEntityAtPoint(args.mouseEvent, elementForRect, {
    kclManager: manager,
    engineCommandManager: deps.engineCommandManager,
    commandBarActor: manager.systemDeps.commandBar,
    wasmInstance: await manager.wasmInstancePromise,
    send,
    acceptsInput: () =>
      deps.sceneInfra.modelingSend === send &&
      manager.modelingState?.matches('idle') === true &&
      manager.systemDeps.commandBar.getSnapshot().matches('Closed'),
  })
}

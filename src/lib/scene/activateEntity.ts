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
import { sendQueryEntityTypeWithPointFromSceneClick } from '@src/lib/scene/picking'
import { LEGACY_SKETCH_MODE_REMOVED_MESSAGE } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import toast from 'react-hot-toast'

/** Shared legacy entity activation; its caller owns input eligibility and supplies the destination view. */
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
  // Anything left here belongs to a KCL 1.0 sketch, since sketch
  // blocks and undeclared regions were handled above.
  toast.error(LEGACY_SKETCH_MODE_REMOVED_MESSAGE, {
    duration: 5_000,
  })
  return
}

/** Adapt the machine canvas callback to the same activation used by the legacy stream. */
export async function tryEnterSketchOnDoubleClickFromScene(
  args: OnClickCallbackArgs,
  elementForRect: { getBoundingClientRect(): DOMRect },
  deps: {
    engineCommandManager: ConnectionManager
    kclManager: KclManager
    sceneInfra: SceneInfra
  }
): Promise<void> {
  // The file route already owns a DOM double-click handler on ConnectionStream.
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

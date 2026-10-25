import type { Node } from '@rust/kcl-lib/bindings/Node'

import { toUtf16 } from '@src/lang/errors'
import {
  getNodeFromPath,
  retrieveSelectionsFromArtifactIds,
} from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  KclNamedViewArtifact,
  Program,
} from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { STD_LIB_ENUMS } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import { isErr } from '@src/lib/trap'
import type { CommandBarMachineEvent } from '@src/machines/commandBarMachine'

function isOrientedCameraCall(
  camera: Expr | undefined
): camera is Node<CallExpressionKw> {
  return (
    camera?.type === 'CallExpressionKw' &&
    camera.callee.name.name === 'oriented' &&
    ['view', 'std::view'].includes(
      camera.callee.path.map(({ name }) => name).join('::')
    )
  )
}

export async function prepareNamedViewEditCommand({
  artifact,
  artifactGraph,
  ast,
  code,
  rustContext,
}: {
  artifact: KclNamedViewArtifact
  artifactGraph: ArtifactGraph
  ast: Node<Program>
  code: string
  rustContext: RustContext
}) {
  const callResult = getNodeFromPath<CallExpressionKw>(
    ast,
    artifact.codeRef.pathToNode,
    await rustContext.wasmInstancePromise,
    'CallExpressionKw'
  )
  if (isErr(callResult)) return callResult

  const camera = callResult.node.arguments.find(
    (argument) => argument.label?.name === 'camera'
  )?.arg
  const orientedCamera = isOrientedCameraCall(camera) ? camera : undefined
  const extractCameraArgument = async (
    name: 'target' | 'distance'
  ): Promise<KclCommandValue | undefined | Error> => {
    if (!orientedCamera) {
      return undefined
    }
    const argument = orientedCamera.arguments.find(
      (candidate) => candidate.label?.name === name
    )?.arg
    if (!argument) {
      return undefined
    }

    const source = code.slice(
      toUtf16(argument.start, code),
      toUtf16(argument.end, code)
    )
    const result = await stringToKclExpression(source, rustContext)
    if (isErr(result) || 'errors' in result) {
      return new Error(`Could not read the named view ${name} argument.`)
    }
    return result
  }

  const target = await extractCameraArgument('target')
  if (isErr(target)) {
    return target
  }

  const distance = await extractCameraArgument('distance')
  if (isErr(distance)) {
    return distance
  }

  const exceptIds =
    artifact.baseline === 'show' ? artifact.hideIds : artifact.showIds
  const except =
    exceptIds.length > 0
      ? retrieveSelectionsFromArtifactIds(exceptIds, artifactGraph)
      : undefined

  // Other camera expressions stay intact unless the user recaptures or changes mode.
  const look = artifact.camera.look
  const orientation =
    orientedCamera && look.type === 'oriented'
      ? STD_LIB_ENUMS['view::Orientation'].find(
          (value) => value.toLowerCase() === look.orientation
        )
      : undefined
  const argDefaultValues: ModelingCommandSchema['Named View'] = {
    name: artifact.name,
    cameraMode: orientation ? 'oriented' : 'directed',
    camera: orientedCamera ? undefined : camera,
    orientation,
    target,
    distance,
    projection: orientation
      ? artifact.camera.projection === 'orthographic'
        ? 'Orthographic'
        : 'Perspective'
      : undefined,
    baseline: artifact.baseline === 'show' ? 'Show' : 'Hide',
    // Selection reconstruction is best-effort; edits preserve the original except expression.
    except: isErr(except) ? undefined : except,
    nodeToEdit: structuredClone(artifact.codeRef.pathToNode),
  }

  return {
    type: 'Find and select command',
    data: {
      name: 'Named View',
      groupId: 'modeling',
      argDefaultValues,
    },
  } satisfies CommandBarMachineEvent
}

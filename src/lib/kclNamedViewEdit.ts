import type { Node } from '@rust/kcl-lib/bindings/Node'

import { toUtf16 } from '@src/lang/errors'
import { isOrientedCameraCall } from '@src/lang/modifyAst/namedViews'
import {
  getNodeFromPath,
  retrieveSelectionsFromArtifactIds,
} from '@src/lang/queryAst'
import type {
  Artifact,
  ArtifactGraph,
  CallExpressionKw,
  Program,
} from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { STD_LIB_ENUMS } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import { isErr } from '@src/lib/trap'
import type { CommandBarMachineEvent } from '@src/machines/commandBarMachine'

type NamedViewArtifact = Extract<Artifact, { type: 'namedView' }>

export async function prepareNamedViewEditCommand({
  artifact,
  artifactGraph,
  ast,
  code,
  rustContext,
}: {
  artifact: NamedViewArtifact
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
  const look = artifact.camera.look
  if (!isOrientedCameraCall(camera) || look.type !== 'oriented') {
    return new Error('Editing custom cameras is not supported yet.')
  }
  const extractCameraArgument = async (
    name: 'target' | 'distance'
  ): Promise<KclCommandValue | undefined | Error> => {
    const argument = camera.arguments.find(
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

  const orientation = STD_LIB_ENUMS['view::Orientation'].find(
    (value) => value.toLowerCase() === look.orientation
  )
  if (!orientation) {
    return new Error('Could not determine the named view orientation.')
  }
  const argDefaultValues: ModelingCommandSchema['Named View'] = {
    name: artifact.name,
    orientation,
    target,
    distance,
    projection:
      artifact.camera.projection === 'orthographic'
        ? 'Orthographic'
        : 'Perspective',
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

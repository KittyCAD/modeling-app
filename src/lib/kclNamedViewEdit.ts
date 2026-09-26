import type { Node } from '@rust/kcl-lib/bindings/Node'

import { toUtf16 } from '@src/lang/errors'
import {
  getNodeFromPath,
  retrieveSelectionsFromArtifactIds,
} from '@src/lang/queryAst'
import type {
  Artifact,
  ArtifactGraph,
  CallExpressionKw,
  KclNamedViewArtifact,
  Program,
} from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarMachineEvent } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'

type NamedViewArtifact = Extract<Artifact, { type: 'namedView' }>

function sourceForNode(
  node: { start: number; end: number },
  code: string
): string {
  return code
    .slice(toUtf16(node.start, code), toUtf16(node.end, code))
    .replace(/\s+/g, ' ')
    .trim()
}

function enumMember(source: string): string {
  return source.split('::').at(-1)?.trim() ?? source
}

/** Summarize only camera arguments that are actually present in KCL source. */
export function namedViewCameraSummary({
  artifact,
  ast,
  code,
  wasmInstance,
}: {
  artifact: KclNamedViewArtifact
  ast: Node<Program>
  code: string
  wasmInstance: ModuleType
}): string | undefined {
  const callResult = getNodeFromPath<CallExpressionKw>(
    ast,
    artifact.codeRef.pathToNode,
    wasmInstance,
    'CallExpressionKw'
  )
  if (isErr(callResult) || callResult.node.type !== 'CallExpressionKw') {
    return undefined
  }

  const camera = callResult.node.arguments.find(
    (argument) => argument.label?.name === 'camera'
  )?.arg
  if (!camera) {
    return undefined
  }
  if (camera.type !== 'CallExpressionKw') {
    return sourceForNode(camera, code) || undefined
  }

  const cameraKind = camera.callee.name.name
  if (cameraKind !== 'oriented' && cameraKind !== 'directed') {
    return sourceForNode(camera, code) || undefined
  }

  const parts: string[] = []
  if (camera.unlabeled) {
    const source = sourceForNode(camera.unlabeled, code)
    parts.push(
      cameraKind === 'oriented' ? enumMember(source) : `Direction ${source}`
    )
  }

  for (const argument of camera.arguments) {
    const label = argument.label?.name
    if (!label) continue

    const source = sourceForNode(argument.arg, code)
    switch (label) {
      case 'distance':
        parts.push(source)
        break
      case 'projection':
        parts.push(enumMember(source))
        break
      case 'target':
        parts.push(`Target ${source}`)
        break
      case 'up':
        parts.push(`Up ${source}`)
        break
      default:
        parts.push(`${label} ${source}`)
    }
  }

  return parts.join(' ') || undefined
}

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
}): Promise<CommandBarMachineEvent | Error> {
  if (artifact.camera.look.type !== 'oriented') {
    return new Error(
      'Editing directed named-view cameras is not supported yet. Please edit the KCL source.'
    )
  }

  const callResult = getNodeFromPath<CallExpressionKw>(
    ast,
    artifact.codeRef.pathToNode,
    await rustContext.wasmInstancePromise,
    'CallExpressionKw'
  )
  if (isErr(callResult) || callResult.node.type !== 'CallExpressionKw') {
    return new Error(
      'Could not find this named view in the KCL source. Please edit the source directly.'
    )
  }

  const camera = callResult.node.arguments.find(
    (argument) => argument.label?.name === 'camera'
  )?.arg
  if (
    camera?.type !== 'CallExpressionKw' ||
    camera.callee.name.name !== 'oriented'
  ) {
    return new Error(
      'Editing named views with a referenced camera is not supported yet. Please edit the KCL source.'
    )
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
  let except: Selections | undefined
  if (exceptIds.length > 0) {
    const selections = retrieveSelectionsFromArtifactIds(
      exceptIds,
      artifactGraph
    )
    if (isErr(selections)) {
      return new Error(
        'Could not resolve this named view visibility selection. Please edit the KCL source.'
      )
    }
    except = selections
  }

  const orientations = {
    front: 'Front',
    back: 'Back',
    left: 'Left',
    right: 'Right',
    top: 'Top',
    bottom: 'Bottom',
    isometric: 'Isometric',
  } as const
  const argDefaultValues: ModelingCommandSchema['Named View'] = {
    name: artifact.name,
    orientation: orientations[artifact.camera.look.orientation],
    target,
    distance,
    projection:
      artifact.camera.projection === 'orthographic'
        ? 'Orthographic'
        : 'Perspective',
    baseline: artifact.baseline === 'show' ? 'Show' : 'Hide',
    except,
    nodeToEdit: structuredClone(artifact.codeRef.pathToNode),
  }

  return {
    type: 'Find and select command',
    data: {
      name: 'Named View',
      groupId: 'modeling',
      argDefaultValues,
    },
  }
}

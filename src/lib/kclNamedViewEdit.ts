import type {
  ArtifactOrientation,
  ArtifactProjection,
  ArtifactVisibility,
} from '@rust/kcl-lib/bindings/Artifact'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Orientation } from '@rust/kcl-lib/bindings/Orientation'
import type { Projection } from '@rust/kcl-lib/bindings/Projection'
import type { Visibility } from '@rust/kcl-lib/bindings/Visibility'

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
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import { isErr } from '@src/lib/trap'
import type { CommandBarMachineEvent } from '@src/machines/commandBarMachine'

const ORIENTATIONS = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
  isometric: 'Isometric',
} satisfies Record<ArtifactOrientation, Orientation>

const PROJECTIONS = {
  orthographic: 'Orthographic',
  perspective: 'Perspective',
} satisfies Record<ArtifactProjection, Projection>

const BASELINES = {
  show: { baseline: 'Show', exceptKey: 'hideIds' },
  hide: { baseline: 'Hide', exceptKey: 'showIds' },
} satisfies Record<
  ArtifactVisibility,
  { baseline: Visibility; exceptKey: 'showIds' | 'hideIds' }
>

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

  const { baseline, exceptKey } = BASELINES[artifact.baseline]
  const exceptIds = artifact[exceptKey]
  const except =
    exceptIds.length > 0
      ? retrieveSelectionsFromArtifactIds(exceptIds, artifactGraph)
      : undefined

  // Other camera expressions stay intact unless the user recaptures or changes mode.
  const look = artifact.camera.look
  let orientation: Orientation | undefined
  switch (look.type) {
    case 'oriented':
      orientation = orientedCamera ? ORIENTATIONS[look.orientation] : undefined
      break
    case 'directed':
      orientation = undefined
      break
  }
  const argDefaultValues: ModelingCommandSchema['Named View'] = {
    name: artifact.name,
    cameraMode: orientation ? 'oriented' : 'directed',
    camera: orientedCamera ? undefined : camera,
    orientation,
    target,
    distance,
    projection: orientation
      ? PROJECTIONS[artifact.camera.projection]
      : undefined,
    baseline,
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

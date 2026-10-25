import type { Node } from '@rust/kcl-lib/bindings/Node'
import type {
  ArtifactCameraView,
  ArtifactPoint3d,
} from '@rust/kcl-lib/bindings/Artifact'
import type { Orientation } from '@rust/kcl-lib/bindings/Orientation'
import type { Projection } from '@rust/kcl-lib/bindings/Projection'
import type { Visibility } from '@rust/kcl-lib/bindings/Visibility'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import {
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  getNodeFromPath,
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { modelingStdLibCall } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import { capitaliseFC } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

function viewEnum(type: string, value: string) {
  return createLocalName(value, [
    createIdentifier('view'),
    createIdentifier(type),
  ])
}

export function addNamedView({
  ast,
  artifactGraph,
  name,
  camera: capturedCamera,
  cameraMode = capturedCamera ? 'directed' : 'oriented',
  orientation,
  target,
  distance,
  projection,
  baseline,
  except,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  name: string
  camera?: NamedViewCameraInput
  cameraMode?: NamedViewCameraMode
  orientation?: Orientation
  target?: KclCommandValue
  distance?: KclCommandValue
  projection?: Projection
  baseline: Visibility
  except?: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const namedCall = modelingStdLibCall('Named View')

  const exceptVars =
    !mNodeToEdit && except
      ? getVariableExprsFromSelection(
          except,
          artifactGraph,
          modifiedAst,
          wasmInstance,
          undefined,
          { lastChildLookup: false }
        )
      : { exprs: [] }
  if (err(exceptVars)) {
    return exceptVars
  }

  let camera: Expr | undefined
  if (cameraMode === 'directed') {
    if (!capturedCamera) return new Error('Capture the current camera first.')
    camera =
      'type' in capturedCamera
        ? structuredClone(capturedCamera)
        : createCapturedCamera(capturedCamera, wasmInstance)
  } else if (orientation && projection) {
    camera = createCallExpressionStdLibKw(
      'oriented',
      viewEnum('Orientation', orientation),
      [
        ...(target
          ? [createLabeledArg('target', valueOrVariable(target))]
          : []),
        ...(distance
          ? [createLabeledArg('distance', valueOrVariable(distance))]
          : []),
        createLabeledArg('projection', viewEnum('Projection', projection)),
      ],
      undefined,
      [createIdentifier('view')]
    )
    if (target && 'variableName' in target && target.variableName) {
      insertVariableAndOffsetPathToNode(target, modifiedAst, mNodeToEdit)
    }
    if (distance && 'variableName' in distance && distance.variableName) {
      insertVariableAndOffsetPathToNode(distance, modifiedAst, mNodeToEdit)
    }
  } else if (mNodeToEdit) {
    // Preserve the existing expression when no replacement was supplied.
    const result = getNodeFromPath<CallExpressionKw>(
      modifiedAst,
      mNodeToEdit,
      wasmInstance,
      'CallExpressionKw'
    )
    if (err(result)) return result
    camera = result.node.arguments.find(
      (argument) => argument.label?.name === 'camera'
    )?.arg
  }
  if (!camera) return new Error('Could not determine the named view camera.')

  const call = createCallExpressionStdLibKw(
    namedCall.name,
    createLiteral(name, wasmInstance),
    [
      createLabeledArg('camera', camera),
      createLabeledArg('baseline', viewEnum('Visibility', baseline)),
      ...(exceptVars.exprs.length > 0
        ? [createLabeledArg('except', createArrayExpression(exceptVars.exprs))]
        : []),
    ],
    undefined,
    namedCall.path.map(createIdentifier)
  )

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    labeledSelectionArgNames: ['except'],
    // The unlabeled argument is a name, not a read-only selection.
    preserveUnlabeledArgument: false,
    variableIfNewDecl: 'view',
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return { modifiedAst, pathToNode }
}

// A captured camera has an explicit target and distance rather than fitting the model.
export type NamedViewCameraSnapshot = ArtifactCameraView & {
  look: Extract<ArtifactCameraView['look'], { type: 'directed' }>
  target: NonNullable<ArtifactCameraView['target']>
  distance: NonNullable<ArtifactCameraView['distance']>
}

export type NamedViewCameraMode = ArtifactCameraView['look']['type']
// Keep an existing camera expression until the user explicitly recaptures it.
export type NamedViewCameraInput = NamedViewCameraSnapshot | Expr

function rounded(value: number): number {
  const result = Math.round(value * 1_000_000) / 1_000_000
  return Object.is(result, -0) ? 0 : result
}

function point(
  value: ArtifactPoint3d,
  wasmInstance: ModuleType,
  suffix?: 'Mm'
) {
  return createArrayExpression(
    [value.x, value.y, value.z].map((value) =>
      createLiteral(rounded(value), wasmInstance, suffix, 6)
    )
  )
}

function createCapturedCamera(
  camera: NamedViewCameraSnapshot,
  wasmInstance: ModuleType
) {
  return createCallExpressionStdLibKw(
    'directed',
    point(camera.look.direction, wasmInstance),
    [
      createLabeledArg('up', point(camera.look.up, wasmInstance)),
      createLabeledArg('target', point(camera.target, wasmInstance, 'Mm')),
      createLabeledArg(
        'distance',
        createLiteral(rounded(camera.distance), wasmInstance, 'Mm', 6)
      ),
      createLabeledArg(
        'projection',
        viewEnum('Projection', capitaliseFC(camera.projection))
      ),
    ],
    undefined,
    [createIdentifier('view')]
  )
}

/** Replace only the camera of one `view::named` call with a camera snapshot. */
export function updateNamedViewCamera({
  ast,
  pathToNode,
  camera,
  wasmInstance,
}: {
  ast: Node<Program>
  pathToNode: PathToNode
  camera: NamedViewCameraSnapshot
  wasmInstance: ModuleType
}): Node<Program> | Error {
  const modifiedAst = structuredClone(ast)
  const result = getNodeFromPath<CallExpressionKw>(
    modifiedAst,
    pathToNode,
    wasmInstance,
    'CallExpressionKw'
  )
  if (err(result)) return result
  const call = result.node
  if (call.callee.name.name !== 'named') {
    return new Error('Could not find this named view in the KCL source.')
  }

  const cameraArgument = call.arguments.find(
    (argument) => argument.label?.name === 'camera'
  )
  if (!cameraArgument) {
    return new Error('This named view has no camera to update.')
  }

  cameraArgument.arg = createCapturedCamera(camera, wasmInstance)

  return modifiedAst
}

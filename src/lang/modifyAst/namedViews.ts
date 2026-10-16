import type { Node } from '@rust/kcl-lib/bindings/Node'
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
  Artifact,
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { getArtifactsMatchingPathToNode } from '@src/lang/std/artifactGraph'
import { modelingStdLibCall } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

function viewEnum(
  type: string,
  value: string,
  previousValue?: string,
  previousExpression?: Expr | null
) {
  // Preserve authored expressions when the selected enum value is unchanged.
  if (
    previousExpression &&
    value.toLowerCase() === previousValue?.toLowerCase()
  )
    return previousExpression
  return createLocalName(value, [
    createIdentifier('view'),
    createIdentifier(type),
  ])
}

function createOrientedCamera(
  orientation: Expr,
  projection: Expr,
  target?: KclCommandValue,
  distance?: KclCommandValue
) {
  return createCallExpressionStdLibKw(
    'oriented',
    orientation,
    [
      ...(target ? [createLabeledArg('target', valueOrVariable(target))] : []),
      ...(distance
        ? [createLabeledArg('distance', valueOrVariable(distance))]
        : []),
      createLabeledArg('projection', projection),
    ],
    undefined,
    [createIdentifier('view')]
  )
}

function namedViewCall({
  ast,
  pathToNode,
  wasmInstance,
}: {
  ast: Node<Program>
  pathToNode: PathToNode
  wasmInstance: ModuleType
}): CallExpressionKw | Error {
  const result = getNodeFromPath<CallExpressionKw>(
    ast,
    pathToNode,
    wasmInstance,
    'CallExpressionKw'
  )
  if (err(result)) {
    return result
  }

  const { node } = result
  if (node.callee.name.name !== 'named') {
    return new Error('Could not find this named view in the KCL source.')
  }

  return node
}

type NamedViewArgs = {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  name: string
  orientation?: Orientation
  target?: KclCommandValue
  distance?: KclCommandValue
  projection?: Projection
  baseline: Visibility
  except?: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}

export function addNamedView(
  args: NamedViewArgs
): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  if (args.nodeToEdit) return editNamedView(args, args.nodeToEdit)

  const {
    ast,
    artifactGraph,
    name,
    orientation,
    target,
    distance,
    projection,
    baseline,
    except,
    wasmInstance,
  } = args
  if (!orientation || !projection) {
    return new Error('Could not determine the named view camera.')
  }
  const modifiedAst = structuredClone(ast)
  const namedCall = modelingStdLibCall('Named View')

  const exceptVars = except
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

  const camera = createOrientedCamera(
    viewEnum('Orientation', orientation),
    viewEnum('Projection', projection),
    target,
    distance
  )
  if (target && 'variableName' in target && target.variableName) {
    insertVariableAndOffsetPathToNode(target, modifiedAst)
  }
  if (distance && 'variableName' in distance && distance.variableName) {
    insertVariableAndOffsetPathToNode(distance, modifiedAst)
  }

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
    variableIfNewDecl: 'view',
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return { modifiedAst, pathToNode }
}

function editNamedView(
  {
    ast,
    artifactGraph,
    name,
    orientation,
    target,
    distance,
    projection,
    baseline,
    wasmInstance,
  }: NamedViewArgs,
  nodeToEdit: PathToNode
) {
  const modifiedAst = structuredClone(ast)
  const pathToNode = structuredClone(nodeToEdit)
  const call = namedViewCall({ ast: modifiedAst, pathToNode, wasmInstance })
  if (err(call)) return call

  const view = getArtifactsMatchingPathToNode(nodeToEdit, artifactGraph).find(
    (artifact): artifact is Extract<Artifact, { type: 'namedView' }> =>
      artifact.type === 'namedView' &&
      artifact.codeRef.range[2] === ast.moduleId
  )
  if (!view) {
    return new Error('Could not find this named view in the executed model.')
  }
  const cameraArgument = call.arguments.find(
    (argument) => argument.label?.name === 'camera'
  )
  if (!cameraArgument || Boolean(orientation) !== Boolean(projection)) {
    return new Error('Could not determine the named view camera.')
  }

  // A shared or directed camera is left untouched; its fields aren't editable.
  if (orientation && projection) {
    const previousCamera = cameraArgument.arg
    const orientedCamera =
      previousCamera.type === 'CallExpressionKw' &&
      previousCamera.callee.name.name === 'oriented'
        ? previousCamera
        : undefined
    cameraArgument.arg = createOrientedCamera(
      viewEnum(
        'Orientation',
        orientation,
        view.camera.look.type === 'oriented'
          ? view.camera.look.orientation
          : undefined,
        orientedCamera?.unlabeled
      ),
      viewEnum(
        'Projection',
        projection,
        view.camera.projection,
        orientedCamera?.arguments.find(
          (argument) => argument.label?.name === 'projection'
        )?.arg
      ),
      target,
      distance
    )
    if (target && 'variableName' in target && target.variableName) {
      insertVariableAndOffsetPathToNode(target, modifiedAst, pathToNode)
    }
    if (distance && 'variableName' in distance && distance.variableName) {
      insertVariableAndOffsetPathToNode(distance, modifiedAst, pathToNode)
    }
  }

  // Only update editable arguments, preserving the authored `except` expression.
  call.unlabeled = createLiteral(name, wasmInstance)
  const baselineArgument = call.arguments.find(
    (argument) => argument.label?.name === 'baseline'
  )
  const baselineExpression = viewEnum(
    'Visibility',
    baseline,
    view.baseline,
    baselineArgument?.arg
  )
  if (baselineArgument) baselineArgument.arg = baselineExpression
  else call.arguments.push(createLabeledArg('baseline', baselineExpression))

  return { modifiedAst, pathToNode }
}

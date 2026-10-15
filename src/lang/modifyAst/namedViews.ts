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

export function addNamedView({
  ast,
  artifactGraph,
  name,
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
  const pathToEdit = structuredClone(nodeToEdit)
  const namedCall = modelingStdLibCall('Named View')
  const existingCall = pathToEdit
    ? namedViewCall({ ast: modifiedAst, pathToNode: pathToEdit, wasmInstance })
    : undefined
  if (err(existingCall)) return existingCall

  const existingView = nodeToEdit
    ? getArtifactsMatchingPathToNode(nodeToEdit, artifactGraph).find(
        (artifact): artifact is Extract<Artifact, { type: 'namedView' }> =>
          artifact.type === 'namedView' &&
          artifact.codeRef.range[2] === ast.moduleId
      )
    : undefined
  if (nodeToEdit && !existingView) {
    return new Error('Could not find this named view in the executed model.')
  }
  const previousCamera = existingCall?.arguments.find(
    (argument) => argument.label?.name === 'camera'
  )?.arg
  const orientedCamera =
    previousCamera?.type === 'CallExpressionKw' &&
    previousCamera.callee.name.name === 'oriented'
      ? previousCamera
      : undefined

  const exceptVars =
    except && !pathToEdit
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
  if (orientation && projection) {
    camera = createCallExpressionStdLibKw(
      'oriented',
      viewEnum(
        'Orientation',
        orientation,
        existingView?.camera.look.type === 'oriented'
          ? existingView.camera.look.orientation
          : undefined,
        orientedCamera?.unlabeled
      ),
      [
        ...(target
          ? [createLabeledArg('target', valueOrVariable(target))]
          : []),
        ...(distance
          ? [createLabeledArg('distance', valueOrVariable(distance))]
          : []),
        createLabeledArg(
          'projection',
          viewEnum(
            'Projection',
            projection,
            existingView?.camera.projection,
            orientedCamera?.arguments.find(
              (argument) => argument.label?.name === 'projection'
            )?.arg
          )
        ),
      ],
      undefined,
      [createIdentifier('view')]
    )
    if (target && 'variableName' in target && target.variableName) {
      insertVariableAndOffsetPathToNode(target, modifiedAst, pathToEdit)
    }
    if (distance && 'variableName' in distance && distance.variableName) {
      insertVariableAndOffsetPathToNode(distance, modifiedAst, pathToEdit)
    }
  } else if (pathToEdit && !orientation && !projection) {
    camera = previousCamera
  }
  if (!camera) {
    return new Error('Could not determine the named view camera.')
  }

  const call = createCallExpressionStdLibKw(
    namedCall.name,
    createLiteral(name, wasmInstance),
    [
      createLabeledArg('camera', camera),
      createLabeledArg(
        'baseline',
        viewEnum(
          'Visibility',
          baseline,
          existingView?.baseline,
          existingCall?.arguments.find(
            (argument) => argument.label?.name === 'baseline'
          )?.arg
        )
      ),
      ...(exceptVars.exprs.length > 0
        ? [createLabeledArg('except', createArrayExpression(exceptVars.exprs))]
        : []),
    ],
    undefined,
    namedCall.path.map(createIdentifier)
  )

  // The positional argument here is an editable name, not a geometry selection.
  if (existingCall) existingCall.unlabeled = call.unlabeled

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit,
    labeledSelectionArgNames: ['except'],
    variableIfNewDecl: 'view',
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return { modifiedAst, pathToNode }
}

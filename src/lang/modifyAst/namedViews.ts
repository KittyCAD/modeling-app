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
import { getArtifactsMatchingPathToNode } from '@src/lang/std/artifactGraph'
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
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

export function isOrientedCameraCall(
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
  orientation: Orientation
  target?: KclCommandValue
  distance?: KclCommandValue
  projection: Projection
  baseline: Visibility
  except?: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const namedCall = modelingStdLibCall('Named View')
  let orientationExpr: Expr = viewEnum('Orientation', orientation)
  let projectionExpr: Expr | undefined = viewEnum('Projection', projection)
  let baselineExpr: Expr = viewEnum('Visibility', baseline)

  if (mNodeToEdit) {
    const result = getNodeFromPath<CallExpressionKw>(
      modifiedAst,
      mNodeToEdit,
      wasmInstance,
      'CallExpressionKw'
    )
    if (err(result)) return result
    const existingCamera = result.node.arguments.find(
      (argument) => argument.label?.name === 'camera'
    )?.arg
    if (!isOrientedCameraCall(existingCamera)) {
      return new Error('Editing custom cameras is not supported yet.')
    }

    const previousView = getArtifactsMatchingPathToNode(
      mNodeToEdit,
      artifactGraph
    ).find(
      (artifact) =>
        artifact.type === 'namedView' &&
        artifact.codeRef.range[2] === ast.moduleId
    )
    // Preserve authored bindings (and omitted defaults) for unchanged fields.
    if (previousView?.type === 'namedView') {
      const look = previousView.camera.look
      if (
        look.type === 'oriented' &&
        look.orientation === orientation.toLowerCase()
      ) {
        orientationExpr = existingCamera.unlabeled ?? orientationExpr
      }
      if (previousView.camera.projection === projection.toLowerCase()) {
        projectionExpr = existingCamera.arguments.find(
          (argument) => argument.label?.name === 'projection'
        )?.arg
      }
      if (previousView.baseline === baseline.toLowerCase()) {
        baselineExpr =
          result.node.arguments.find(
            (argument) => argument.label?.name === 'baseline'
          )?.arg ?? baselineExpr
      }
    }
  }

  const camera = createCallExpressionStdLibKw(
    'oriented',
    orientationExpr,
    [
      ...(target ? [createLabeledArg('target', valueOrVariable(target))] : []),
      ...(distance
        ? [createLabeledArg('distance', valueOrVariable(distance))]
        : []),
      ...(projectionExpr
        ? [createLabeledArg('projection', projectionExpr)]
        : []),
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

  const call = createCallExpressionStdLibKw(
    namedCall.name,
    createLiteral(name, wasmInstance),
    [
      createLabeledArg('camera', camera),
      createLabeledArg('baseline', baselineExpr),
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

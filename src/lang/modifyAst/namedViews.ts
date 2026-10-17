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
  const mNodeToEdit = structuredClone(nodeToEdit)
  const namedCall = modelingStdLibCall('Named View')

  let existingCall: CallExpressionKw | undefined
  let view: Extract<Artifact, { type: 'namedView' }> | undefined
  if (mNodeToEdit) {
    const result = getNodeFromPath<CallExpressionKw>(
      modifiedAst,
      mNodeToEdit,
      wasmInstance,
      'CallExpressionKw'
    )
    if (err(result)) return result
    existingCall = result.node
    view = getArtifactsMatchingPathToNode(mNodeToEdit, artifactGraph).find(
      (artifact): artifact is Extract<Artifact, { type: 'namedView' }> =>
        artifact.type === 'namedView' &&
        artifact.codeRef.range[2] === ast.moduleId
    )
    if (!view)
      return new Error('Could not find this named view in the executed model.')
  }

  const existingCamera = existingCall?.arguments.find(
    (argument) => argument.label?.name === 'camera'
  )?.arg
  const orientedCamera = isOrientedCameraCall(existingCamera)
    ? existingCamera
    : undefined
  let camera = existingCamera
  // Shared cameras, directed cameras, and custom helpers remain untouched.
  if (!mNodeToEdit || orientedCamera) {
    if (!orientation || !projection) {
      return new Error('Could not determine the named view camera.')
    }
    camera = createCallExpressionStdLibKw(
      'oriented',
      viewEnum(
        'Orientation',
        orientation,
        view?.camera.look.type === 'oriented'
          ? view.camera.look.orientation
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
            view?.camera.projection,
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
      insertVariableAndOffsetPathToNode(target, modifiedAst, mNodeToEdit)
    }
    if (distance && 'variableName' in distance && distance.variableName) {
      insertVariableAndOffsetPathToNode(distance, modifiedAst, mNodeToEdit)
    }
  }
  if (!camera) return new Error('Could not determine the named view camera.')

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
      createLabeledArg(
        'baseline',
        viewEnum(
          'Visibility',
          baseline,
          view?.baseline,
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

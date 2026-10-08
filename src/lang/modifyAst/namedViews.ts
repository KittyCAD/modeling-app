import type { Node } from '@rust/kcl-lib/bindings/Node'

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
  resolveToCodeRef,
  stringifyPathToNode,
  valueOrVariable,
} from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { ROOT_MODULE_ID } from '@src/lang/wasm'
import { modelingStdLibCall } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type {
  NamedViewOrientation,
  NamedViewProjection,
  NamedViewVisibility,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

function viewEnum(type: string, value: string) {
  return createLocalName(value, [
    createIdentifier('view'),
    createIdentifier(type),
  ])
}

export type NamedViewCameraSnapshot = {
  direction: [number, number, number]
  up: [number, number, number]
  target: [number, number, number]
  distance: number
  projection: NamedViewProjection
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

function rounded(value: number): number {
  const result = Math.round(value * 1_000_000) / 1_000_000
  return Object.is(result, -0) ? 0 : result
}

function point(
  values: [number, number, number],
  wasmInstance: ModuleType,
  suffix?: 'Mm'
) {
  return createArrayExpression(
    values.map((value) =>
      createLiteral(rounded(value), wasmInstance, suffix, 6)
    )
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
  const call = namedViewCall({ ast: modifiedAst, pathToNode, wasmInstance })
  if (err(call)) {
    return call
  }

  const cameraArgument = call.arguments.find(
    (argument) => argument.label?.name === 'camera'
  )
  if (!cameraArgument) {
    return new Error('This named view has no camera to update.')
  }

  cameraArgument.arg = createCallExpressionStdLibKw(
    'directed',
    point(camera.direction, wasmInstance),
    [
      createLabeledArg('up', point(camera.up, wasmInstance)),
      createLabeledArg('target', point(camera.target, wasmInstance, 'Mm')),
      createLabeledArg(
        'distance',
        createLiteral(rounded(camera.distance), wasmInstance, 'Mm', 6)
      ),
      createLabeledArg('projection', viewEnum('Projection', camera.projection)),
    ],
    undefined,
    [createIdentifier('view')]
  )

  return modifiedAst
}

function insertKclVariableIfNeeded(
  value: KclCommandValue | undefined,
  ast: Node<Program>,
  nodeToEdit?: PathToNode
) {
  if (value && 'variableName' in value && value.variableName) {
    insertVariableAndOffsetPathToNode(value, ast, nodeToEdit)
  }
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
  orientation?: NamedViewOrientation
  target?: KclCommandValue
  distance?: KclCommandValue
  projection?: NamedViewProjection
  baseline: NamedViewVisibility
  except?: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)
  const pathToEdit = structuredClone(nodeToEdit)
  const namedCall = modelingStdLibCall('Named View')

  let preserveExcept = Boolean(pathToEdit)
  if (pathToEdit && except) {
    const view = [...artifactGraph.values()].find(
      (artifact) =>
        artifact.type === 'namedView' &&
        artifact.codeRef.range[2] === ROOT_MODULE_ID &&
        stringifyPathToNode(artifact.codeRef.pathToNode) ===
          stringifyPathToNode(pathToEdit)
    )
    if (view?.type !== 'namedView') {
      return new Error('Could not find this named view visibility selection.')
    }
    const originalIds = new Set(
      view.baseline === 'show' ? view.hideIds : view.showIds
    )
    const selectedIds = new Set(
      except.graphSelections.map(
        (selection) => resolveToCodeRef(selection, artifactGraph)?.artifact?.id
      )
    )
    // Keep expressions such as `except = exceptions` when their selection is unchanged.
    preserveExcept =
      except.otherSelections.length === 0 &&
      originalIds.size === selectedIds.size &&
      [...originalIds].every((id) => selectedIds.has(id))
  }

  const exceptVars =
    except && !preserveExcept
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
    insertKclVariableIfNeeded(target, modifiedAst, pathToEdit)
    insertKclVariableIfNeeded(distance, modifiedAst, pathToEdit)
  } else if (pathToEdit && !orientation && !projection) {
    const existingCall = namedViewCall({
      ast: modifiedAst,
      pathToNode: pathToEdit,
      wasmInstance,
    })
    if (err(existingCall)) return existingCall
    camera = existingCall.arguments.find(
      (argument) => argument.label?.name === 'camera'
    )?.arg
  }
  if (!camera) {
    return new Error('Could not determine the named view camera.')
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
    pathToEdit,
    replaceUnlabeled: true,
    labeledSelectionArgNames: preserveExcept ? ['except'] : [],
    variableIfNewDecl: 'view',
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return { modifiedAst, pathToNode }
}

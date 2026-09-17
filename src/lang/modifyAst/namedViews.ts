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
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
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
  orientation: NamedViewOrientation
  target?: KclCommandValue
  distance?: KclCommandValue
  projection: NamedViewProjection
  baseline: NamedViewVisibility
  except?: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)
  const pathToEdit = structuredClone(nodeToEdit)
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

  const camera = createCallExpressionStdLibKw(
    'oriented',
    viewEnum('Orientation', orientation),
    [
      ...(target ? [createLabeledArg('target', valueOrVariable(target))] : []),
      ...(distance
        ? [createLabeledArg('distance', valueOrVariable(distance))]
        : []),
      createLabeledArg('projection', viewEnum('Projection', projection)),
    ],
    undefined,
    [createIdentifier('view')]
  )

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

  insertKclVariableIfNeeded(target, modifiedAst, pathToEdit)
  insertKclVariableIfNeeded(distance, modifiedAst, pathToEdit)

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit,
    replaceUnlabeled: true,
    variableIfNewDecl: 'view',
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return { modifiedAst, pathToNode }
}

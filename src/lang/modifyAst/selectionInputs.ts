import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import {
  getBodyIndex,
  getNodeFromPath,
  getVariableExprsFromSelection,
} from '@src/lang/queryAst'
import type { GetVariableExprsOptions } from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  Expr,
  ExpressionStatement,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

export type SelectionInputPlan = {
  exprs: Expr[]
  pathIfPipe?: PathToNode
}

type SelectionInputRecord = SelectionInputPlan & {
  pipeBodyIndex?: number
}

export function resolveSelectionInputPlan({
  selection,
  artifactGraph,
  ast,
  wasmInstance,
  options = {},
  materializePipes = 'when-multiple',
  variablePrefix = KCL_DEFAULT_CONSTANT_PREFIXES.SOLID,
  nodeToEdit,
}: {
  selection: Selections
  artifactGraph: ArtifactGraph
  ast: Node<Program>
  wasmInstance: ModuleType
  options?: GetVariableExprsOptions
  materializePipes?: 'always' | 'when-multiple'
  variablePrefix?: string
  nodeToEdit?: PathToNode
}): Error | SelectionInputPlan {
  const aggregate = getVariableExprsFromSelection(
    selection,
    artifactGraph,
    ast,
    wasmInstance,
    nodeToEdit,
    options
  )
  if (err(aggregate)) {
    return aggregate
  }

  // Editing still reconstructs selections for dialog defaults and future true
  // selection edits, but must not materialize or otherwise rewrite those inputs.
  if (nodeToEdit) {
    return aggregate
  }

  const shouldInspectIndividualInputs =
    materializePipes === 'always' || selection.graphSelections.length > 1
  if (!shouldInspectIndividualInputs) {
    return aggregate
  }

  const records: SelectionInputRecord[] = []
  const pipeBodyIndexes = new Set<number>()

  for (const graphSelection of selection.graphSelections) {
    const input = getVariableExprsFromSelection(
      {
        graphSelections: [graphSelection],
        otherSelections: [],
      },
      artifactGraph,
      ast,
      wasmInstance,
      undefined,
      options
    )
    if (err(input)) {
      return input
    }

    let pipeBodyIndex: number | undefined
    if (input.pathIfPipe) {
      const expression = getNodeFromPath<ExpressionStatement>(
        ast,
        input.pathIfPipe,
        wasmInstance,
        'ExpressionStatement'
      )
      if (err(expression) || expression.node.type !== 'ExpressionStatement') {
        return new Error('Could not resolve the selected source pipe')
      }

      const bodyIndex = getBodyIndex(expression.shallowPath)
      if (err(bodyIndex)) {
        return bodyIndex
      }
      pipeBodyIndex = bodyIndex
      pipeBodyIndexes.add(bodyIndex)
    }

    records.push({ ...input, pipeBodyIndex })
  }

  const shouldMaterialize =
    materializePipes === 'always'
      ? pipeBodyIndexes.size > 0
      : pipeBodyIndexes.size > 1
  if (!shouldMaterialize) {
    return aggregate
  }

  const variableByBodyIndex = new Map<number, string>()
  for (const bodyIndex of pipeBodyIndexes) {
    const statement = ast.body[bodyIndex]
    if (!statement || statement.type !== 'ExpressionStatement') {
      return new Error('Expected a variable-less source pipe')
    }

    const variableName = findUniqueName(ast, variablePrefix)
    const declaration = createVariableDeclaration(
      variableName,
      structuredClone(statement.expression)
    )
    declaration.preComments = statement.preComments
    ast.body[bodyIndex] = declaration
    variableByBodyIndex.set(bodyIndex, variableName)
  }

  return {
    exprs: records.flatMap(({ exprs, pathIfPipe, pipeBodyIndex }) => {
      if (!pathIfPipe) {
        return exprs
      }
      if (pipeBodyIndex === undefined) {
        return []
      }
      const variableName = variableByBodyIndex.get(pipeBodyIndex)
      return variableName ? [createLocalName(variableName)] : []
    }),
  }
}

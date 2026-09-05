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
import { STD_LIB_COMMANDS } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

export type SelectionInputPlan = {
  exprs: Expr[]
  pathIfPipe?: PathToNode
}

export type SelectionInputRequest = {
  selection: Selections
  materializePipes?: 'always' | 'when-multiple'
  variablePrefix?: string
}

type SelectionInputRecord = SelectionInputPlan & {
  pipeBodyIndex?: number
}

function directName(expr: Expr | null): string | null {
  if (expr?.type !== 'Name' || expr.path.length > 0) {
    return null
  }
  return expr.name.name
}

function expressionReferencesName(expr: Expr | null, name: string): boolean {
  if (!expr) {
    return false
  }
  if (directName(expr) === name) {
    return true
  }
  return (
    expr.type === 'ArrayExpression' &&
    expr.elements.some((element) => expressionReferencesName(element, name))
  )
}

function callReturnsSolid(call: Extract<Expr, { type: 'CallExpressionKw' }>) {
  const qualifiedName = [
    ...call.callee.path.map(({ name }) => name),
    call.callee.name.name,
  ].join('::')
  const command =
    STD_LIB_COMMANDS[qualifiedName as keyof typeof STD_LIB_COMMANDS]
  return Boolean(command?.returnType && /\bSolid\b/.test(command.returnType))
}

export function resolveLatestSolidInput(
  input: Expr | null,
  ast: Node<Program>
): Expr | null {
  let currentName = directName(input)
  if (!currentName) {
    return input
  }

  for (const statement of ast.body) {
    if (statement.type !== 'VariableDeclaration') {
      continue
    }
    const init = statement.declaration.init
    if (
      init.type !== 'CallExpressionKw' ||
      !callReturnsSolid(init) ||
      !expressionReferencesName(init.unlabeled, currentName)
    ) {
      continue
    }
    currentName = statement.declaration.id.name
  }

  return createLocalName(currentName)
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
  const plans = resolveSelectionInputPlans({
    requests: [{ selection, materializePipes, variablePrefix }],
    artifactGraph,
    ast,
    wasmInstance,
    nodeToEdit,
    options,
  })
  if (err(plans)) {
    return plans
  }
  return plans[0]
}

export function resolveSelectionInputPlans({
  requests,
  artifactGraph,
  ast,
  wasmInstance,
  options = {},
  nodeToEdit,
}: {
  requests: SelectionInputRequest[]
  artifactGraph: ArtifactGraph
  ast: Node<Program>
  wasmInstance: ModuleType
  options?: GetVariableExprsOptions
  nodeToEdit?: PathToNode
}): Error | SelectionInputPlan[] {
  const aggregates: SelectionInputPlan[] = []
  const recordsByRequest: SelectionInputRecord[][] = []
  const variablePrefixByBodyIndex = new Map<number, string>()
  let shouldMaterialize = false

  const pipeBodyIndexes = new Set<number>()
  for (const request of requests) {
    const aggregate = getVariableExprsFromSelection(
      request.selection,
      artifactGraph,
      ast,
      wasmInstance,
      nodeToEdit,
      options
    )
    if (err(aggregate)) {
      return aggregate
    }
    aggregates.push(aggregate)

    // Edit calls keep bounded selection reconstruction, but input planning is
    // create-only so reconstructed selections cannot rewrite source pipes.
    if (nodeToEdit) {
      recordsByRequest.push([])
      continue
    }

    const materializePipes = request.materializePipes ?? 'when-multiple'
    const shouldInspectIndividualInputs =
      materializePipes === 'always' ||
      request.selection.graphSelections.length > 1 ||
      requests.length > 1
    if (!shouldInspectIndividualInputs) {
      recordsByRequest.push([])
      continue
    }

    const records: SelectionInputRecord[] = []
    recordsByRequest.push(records)

    for (const graphSelection of request.selection.graphSelections) {
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
        variablePrefixByBodyIndex.set(
          bodyIndex,
          request.variablePrefix ?? KCL_DEFAULT_CONSTANT_PREFIXES.SOLID
        )
        if (materializePipes === 'always') {
          shouldMaterialize = true
        }
      }

      records.push({ ...input, pipeBodyIndex })
    }
  }

  shouldMaterialize ||= pipeBodyIndexes.size > 1
  if (!shouldMaterialize) {
    return aggregates
  }

  const variableByBodyIndex = new Map<number, string>()
  for (const bodyIndex of pipeBodyIndexes) {
    const statement = ast.body[bodyIndex]
    if (!statement || statement.type !== 'ExpressionStatement') {
      return new Error('Expected a variable-less source pipe')
    }

    const variableName = findUniqueName(
      ast,
      variablePrefixByBodyIndex.get(bodyIndex) ??
        KCL_DEFAULT_CONSTANT_PREFIXES.SOLID
    )
    const declaration = createVariableDeclaration(
      variableName,
      structuredClone(statement.expression)
    )
    declaration.preComments = statement.preComments
    ast.body[bodyIndex] = declaration
    variableByBodyIndex.set(bodyIndex, variableName)
  }

  return recordsByRequest.map((records, index) =>
    records.length === 0
      ? aggregates[index]
      : {
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
  )
}

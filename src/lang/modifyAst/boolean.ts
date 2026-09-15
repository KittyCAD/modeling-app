import type { Expr } from '@rust/kcl-lib/bindings/Expr'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  getBodyIndex,
  getVariableExprsFromSelection,
  stringifyPathToNode,
  valueOrVariable,
} from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import { modelingStdLibCommandName } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

const BOOLEAN_SELECTION_ERROR_MESSAGE =
  'The same body cannot be used more than once in a Boolean operation. Please check your selections.'

type BooleanSelectionGroup = {
  selections: Selections
  exprs: Expr[]
  pathIfPipe?: PathToNode
}

function materializePipeForLabeledArg(
  ast: Node<Program>,
  selection: Pick<BooleanSelectionGroup, 'exprs' | 'pathIfPipe'>
): Pick<BooleanSelectionGroup, 'exprs' | 'pathIfPipe'> | Error {
  if (
    !selection.pathIfPipe ||
    selection.exprs.length !== 1 ||
    selection.exprs[0].type !== 'PipeSubstitution'
  ) {
    return selection
  }

  const bodyIndex = getBodyIndex(selection.pathIfPipe)
  if (err(bodyIndex)) {
    return bodyIndex
  }

  const statement = ast.body[bodyIndex]
  if (statement?.type !== 'ExpressionStatement') {
    return new Error('Expected a variable-less Boolean tool pipe')
  }

  const variableName = findUniqueName(ast, KCL_DEFAULT_CONSTANT_PREFIXES.SOLID)
  const declaration = createVariableDeclaration(
    variableName,
    statement.expression
  )
  declaration.preComments = statement.preComments
  ast.body[bodyIndex] = declaration

  return { exprs: [createLocalName(variableName)] }
}

function booleanInputKey(expr: Expr, pathIfPipe?: PathToNode): string {
  switch (expr.type) {
    case 'Name':
      return `Name:${expr.abs_path ? 'absolute' : 'relative'}:${[
        ...expr.path.map(({ name }) => name),
        expr.name.name,
      ].join('::')}`
    case 'MemberExpression':
      return `MemberExpression:${expr.computed}:${booleanInputKey(
        expr.object
      )}:${booleanInputKey(expr.property)}`
    case 'Literal':
      return `Literal:${JSON.stringify(expr.value)}`
    case 'PipeSubstitution':
      return `PipeSubstitution:${
        pathIfPipe ? stringifyPathToNode(pathIfPipe) : ''
      }`
    default:
      return JSON.stringify(expr)
  }
}

function validateBooleanSelections(
  selectionGroups: BooleanSelectionGroup[]
): Error | undefined {
  const inputKeys = new Set<string>()

  for (const { selections, exprs, pathIfPipe } of selectionGroups) {
    if (exprs.length !== selections.graphSelections.length) {
      return new Error(BOOLEAN_SELECTION_ERROR_MESSAGE)
    }

    for (const expr of exprs) {
      const key = booleanInputKey(expr, pathIfPipe)
      if (inputKeys.has(key)) {
        return new Error(BOOLEAN_SELECTION_ERROR_MESSAGE)
      }
      inputKeys.add(key)
    }
  }
}

export function addUnion({
  ast,
  artifactGraph,
  solids,
  tolerance,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  tolerance?: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled arguments (no exposed labeled arguments for boolean yet)
  let vars: { exprs: Expr[]; pathIfPipe?: PathToNode } = { exprs: [] }
  if (!mNodeToEdit) {
    const selectionVars = getVariableExprsFromSelection(
      solids,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      {
        lastChildLookup: true,
        artifactTypeFilter: ['compositeSolid', 'sweep'],
      }
    )
    if (err(selectionVars)) {
      return selectionVars
    }
    vars = selectionVars

    const selectionError = validateBooleanSelections([
      { selections: solids, ...vars },
    ])
    if (selectionError) {
      return selectionError
    }
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Boolean Union'),
    objectsExpr,
    tolerance ? [createLabeledArg('tolerance', valueOrVariable(tolerance))] : []
  )
  if (tolerance && 'variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SOLID,
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addIntersect({
  ast,
  artifactGraph,
  solids,
  tolerance,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  tolerance?: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled arguments (no exposed labeled arguments for boolean yet)
  let vars: { exprs: Expr[]; pathIfPipe?: PathToNode } = { exprs: [] }
  if (!mNodeToEdit) {
    const selectionVars = getVariableExprsFromSelection(
      solids,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      {
        lastChildLookup: true,
        artifactTypeFilter: ['compositeSolid', 'sweep'],
      }
    )
    if (err(selectionVars)) {
      return selectionVars
    }
    vars = selectionVars

    const selectionError = validateBooleanSelections([
      { selections: solids, ...vars },
    ])
    if (selectionError) {
      return selectionError
    }
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Boolean Intersect'),
    objectsExpr,
    tolerance ? [createLabeledArg('tolerance', valueOrVariable(tolerance))] : []
  )
  if (tolerance && 'variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SOLID,
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addSubtract({
  ast,
  artifactGraph,
  solids,
  tools,
  tolerance,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  tools: Selections
  tolerance?: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  let vars: { exprs: Expr[]; pathIfPipe?: PathToNode } = { exprs: [] }
  let toolVars: { exprs: Expr[]; pathIfPipe?: PathToNode } = { exprs: [] }
  if (!mNodeToEdit) {
    const selectionVars = getVariableExprsFromSelection(
      solids,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      {
        lastChildLookup: true,
        artifactTypeFilter: ['compositeSolid', 'sweep'],
      }
    )
    if (err(selectionVars)) {
      return selectionVars
    }
    vars = selectionVars

    const selectionToolVars = getVariableExprsFromSelection(
      tools,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      {
        lastChildLookup: true,
        artifactTypeFilter: ['compositeSolid', 'sweep'],
      }
    )
    if (err(selectionToolVars)) {
      return selectionToolVars
    }
    toolVars = selectionToolVars

    const selectionError = validateBooleanSelections([
      { selections: solids, ...vars },
      { selections: tools, ...toolVars },
    ])
    if (selectionError) {
      return selectionError
    }
    if (vars.pathIfPipe && toolVars.pathIfPipe) {
      return new Error(
        'Cannot use both solids and tools in a subtraction operation with a pipe'
      )
    }
    const materializedToolVars = materializePipeForLabeledArg(
      modifiedAst,
      toolVars
    )
    if (err(materializedToolVars)) {
      return materializedToolVars
    }
    toolVars = materializedToolVars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const toolsExpr = createVariableExpressionsArray(toolVars.exprs)
  if (!mNodeToEdit && toolsExpr === null) {
    return new Error('No tools provided for subtraction operation')
  }

  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Boolean Subtract'),
    objectsExpr,
    [
      ...(toolsExpr ? [createLabeledArg('tools', toolsExpr)] : []),
      ...(tolerance
        ? [createLabeledArg('tolerance', valueOrVariable(tolerance))]
        : []),
    ]
  )
  if (tolerance && 'variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  const pathIfNewPipe = vars.pathIfPipe

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathIfNewPipe,
    pathToEdit: mNodeToEdit,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SOLID,
    labeledSelectionArgNames: ['tools'],
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addSplit({
  ast,
  artifactGraph,
  targets,
  tools,
  merge,
  keepTools,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  targets: Selections
  tools?: Selections
  merge?: boolean
  keepTools?: boolean
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  let vars: { exprs: Expr[]; pathIfPipe?: PathToNode } = { exprs: [] }
  if (!mNodeToEdit) {
    const selectionVars = getVariableExprsFromSelection(
      targets,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      {
        lastChildLookup: true,
        artifactTypeFilter: ['compositeSolid', 'sweep'],
      }
    )
    if (err(selectionVars)) {
      return selectionVars
    }
    vars = selectionVars
  }

  const hasTools = Boolean(
    !mNodeToEdit &&
      tools &&
      (tools.graphSelections.length > 0 || tools.otherSelections.length > 0)
  )
  const selectionGroups: BooleanSelectionGroup[] = [
    { selections: targets, ...vars },
  ]
  if (!mNodeToEdit) {
    const targetSelectionError = validateBooleanSelections(selectionGroups)
    if (targetSelectionError) {
      return targetSelectionError
    }
  }

  const labeledArgs: ReturnType<typeof createLabeledArg>[] = []
  let pathIfNewPipe = vars.pathIfPipe

  if (hasTools && tools) {
    const toolVars = getVariableExprsFromSelection(
      tools,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      {
        lastChildLookup: true,
        artifactTypeFilter: ['compositeSolid', 'sweep'],
      }
    )
    if (err(toolVars)) {
      return toolVars
    }
    selectionGroups.push({ selections: tools, ...toolVars })
    const selectionError = validateBooleanSelections(selectionGroups)
    if (selectionError) {
      return selectionError
    }

    if (vars.pathIfPipe && toolVars.pathIfPipe) {
      return new Error(
        'Cannot use both targets and tools in a split operation with a pipe'
      )
    }

    const materializedToolVars = materializePipeForLabeledArg(
      modifiedAst,
      toolVars
    )
    if (err(materializedToolVars)) {
      return materializedToolVars
    }

    const toolsExpr = createVariableExpressionsArray(materializedToolVars.exprs)
    if (toolsExpr === null) {
      return new Error('No tools provided for split operation')
    }

    pathIfNewPipe = vars.pathIfPipe
    labeledArgs.push(createLabeledArg('tools', toolsExpr))
  }

  if (merge !== undefined) {
    labeledArgs.push(
      createLabeledArg('merge', createLiteral(merge, wasmInstance))
    )
  }
  if ((hasTools || mNodeToEdit) && keepTools !== undefined) {
    labeledArgs.push(
      createLabeledArg('keepTools', createLiteral(keepTools, wasmInstance))
    )
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Boolean Split'),
    objectsExpr,
    labeledArgs
  )

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathIfNewPipe,
    pathToEdit: mNodeToEdit,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SPLIT,
    labeledSelectionArgNames: ['tools'],
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

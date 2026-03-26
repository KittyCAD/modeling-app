import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
} from '@src/lang/create'
import {
  createEdgeRefObjectExpression,
  entityReferenceToEdgeRefPayload,
} from '@src/lang/modifyAst/edges'
import {
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import { getAxisExpressionAndIndex } from '@src/lang/modifyAst/sweeps'
import {
  getVariableExprsFromSelection,
  resolveSelectionV2,
  valueOrVariable,
} from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  Expr,
  LabeledArg,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function addHelix({
  ast,
  artifactGraph,
  wasmInstance,
  axis,
  edge,
  cylinder,
  revolutions,
  angleStart,
  radius,
  length,
  ccw,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
  axis?: string
  cylinder?: Selections
  edge?: Selections
  revolutions: KclCommandValue
  angleStart: KclCommandValue
  radius?: KclCommandValue
  length?: KclCommandValue
  ccw?: boolean
  nodeToEdit?: PathToNode
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  let pathIfNewPipe: PathToNode | undefined
  const axisExpr: LabeledArg[] = []
  const cylinderExpr: LabeledArg[] = []
  if (cylinder) {
    const vars = getVariableExprsFromSelection(
      cylinder,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      mNodeToEdit,
      {
        lastChildLookup: true,
      }
    )
    if (err(vars)) {
      return vars
    }
    cylinderExpr.push(createLabeledArg('cylinder', vars.exprs[0]))
    pathIfNewPipe = vars.pathIfPipe
  } else if (axis || edge) {
    const hasV2Edge =
      edge?.graphSelections?.length &&
      edge.graphSelections[0]?.entityRef?.type === 'edge'
    const shouldUseEdgeRef =
      hasV2Edge && Boolean(edge?.graphSelections?.[0]?.entityRef)

    if (shouldUseEdgeRef) {
      const entityRef = edge.graphSelections[0].entityRef!
      if (entityRef.type !== 'edge') {
        return new Error('Expected helix axis edgeRef to be an edge entityRef')
      }
      const payload = entityReferenceToEdgeRefPayload(entityRef)
      const originalEdgeSelection = resolveSelectionV2(
        edge.graphSelections[0],
        artifactGraph
      )
      const edgeRefResult = createEdgeRefObjectExpression(
        payload,
        wasmInstance,
        modifiedAst,
        artifactGraph,
        originalEdgeSelection ?? undefined
      )
      if (err(edgeRefResult)) {
        return edgeRefResult
      }
      // createEdgeRefObjectExpression may mutate AST (e.g. to add tag declarations).
      // Preserve those mutations by using returned modifiedAst.
      modifiedAst = edgeRefResult.modifiedAst
      // `helix` overloads `axis` to accept an edgeRef payload object.
      axisExpr.push(createLabeledArg('axis', edgeRefResult.expr))
    } else {
      const result = getAxisExpressionAndIndex(
        axis,
        edge,
        modifiedAst,
        wasmInstance,
        artifactGraph
      )
      if (err(result)) {
        return result
      }
      axisExpr.push(createLabeledArg('axis', result.generatedAxis as Expr))
    }
  } else {
    return new Error('Helix must have either an axis or a cylinder')
  }

  // Optional args
  const ccwExpr =
    ccw !== undefined
      ? [createLabeledArg('ccw', createLiteral(ccw, wasmInstance))]
      : []
  const radiusExpr = radius
    ? [createLabeledArg('radius', valueOrVariable(radius))]
    : []
  const lengthExpr = length
    ? [createLabeledArg('length', valueOrVariable(length))]
    : []

  const unlabeledArgs = null
  const call = createCallExpressionStdLibKw('helix', unlabeledArgs, [
    ...axisExpr,
    ...cylinderExpr,
    createLabeledArg('revolutions', valueOrVariable(revolutions)),
    createLabeledArg('angleStart', valueOrVariable(angleStart)),
    ...radiusExpr,
    ...lengthExpr,
    ...ccwExpr,
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in angleStart && angleStart.variableName) {
    insertVariableAndOffsetPathToNode(angleStart, modifiedAst, mNodeToEdit)
  }

  if ('variableName' in revolutions && revolutions.variableName) {
    insertVariableAndOffsetPathToNode(revolutions, modifiedAst, mNodeToEdit)
  }

  if (radius && 'variableName' in radius && radius.variableName) {
    insertVariableAndOffsetPathToNode(radius, modifiedAst, mNodeToEdit)
  }

  if (length && 'variableName' in length && length.variableName) {
    insertVariableAndOffsetPathToNode(length, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.HELIX,
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

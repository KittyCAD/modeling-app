import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import {
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  getEdgeTagCall,
  getPrimitiveEdgeSelections,
  groupSelectionsByBodyAndAddTags,
  insertPrimitiveEdgeVariablesAndOffsetPathToNode,
} from '@src/lang/modifyAst/edges'
import { mutateAstWithTagForSketchSegment } from '@src/lang/modifyAst/tagManagement'
import {
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type {
  ArtifactGraph,
  LabeledArg,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { modelingStdLibCommandName } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

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
    const result = getAxisExpression(
      axis,
      edge,
      modifiedAst,
      wasmInstance,
      artifactGraph
    )
    if (err(result)) {
      return result
    }
    axisExpr.push(createLabeledArg('axis', result.generatedAxis))
    modifiedAst = result.modifiedAst
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
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Helix'),
    unlabeledArgs,
    [
      ...axisExpr,
      ...cylinderExpr,
      createLabeledArg('revolutions', valueOrVariable(revolutions)),
      createLabeledArg('angleStart', valueOrVariable(angleStart)),
      ...radiusExpr,
      ...lengthExpr,
      ...ccwExpr,
    ]
  )

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

export function getAxisExpression(
  axis: string | undefined,
  edge: Selections | undefined,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  artifactGraph?: ArtifactGraph,
  nodeToEdit?: PathToNode
) {
  let modifiedAst = structuredClone(ast)
  if (axis) {
    return { generatedAxis: createLocalName(axis), modifiedAst }
  } else if (edge && artifactGraph) {
    // Direct segment case (sketch solve)
    const segmentAxisExpr = getVariableExprsFromSelection(
      edge,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      nodeToEdit
    )
    if (!err(segmentAxisExpr) && segmentAxisExpr.exprs[0]) {
      const directAxisExpr = segmentAxisExpr.exprs[0]
      if (directAxisExpr.type === 'MemberExpression') {
        return { generatedAxis: directAxisExpr, modifiedAst }
      }
    }

    // Direct segment case (old sketch)
    const pathToAxisSelection = getNodePathFromSourceRange(
      modifiedAst,
      edge.graphSelections[0]?.codeRef.range
    )
    const tagResult = mutateAstWithTagForSketchSegment(
      modifiedAst,
      pathToAxisSelection,
      wasmInstance
    )
    if (!err(tagResult)) {
      modifiedAst = tagResult.modifiedAst
      const { tag } = tagResult
      const axisSelection = edge?.graphSelections[0]?.artifact
      if (!axisSelection) {
        return new Error('Generated axis selection is missing.')
      }

      const generatedAxis = getEdgeTagCall(tag, axisSelection)
      return { generatedAxis, modifiedAst }
    }

    // Sweep edge case (both sketch v1 and sketch solve)
    const bodyData = groupSelectionsByBodyAndAddTags(
      edge,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      nodeToEdit
    )
    if (err(bodyData)) return bodyData
    let bodies = bodyData.bodies
    modifiedAst = bodyData.modifiedAst

    const primitiveEdgeSelections = getPrimitiveEdgeSelections(edge)
    if (primitiveEdgeSelections.length > 0) {
      const primitiveEdgeResult =
        insertPrimitiveEdgeVariablesAndOffsetPathToNode({
          primitiveEdgeSelections,
          bodies,
          modifiedAst,
          artifactGraph,
          wasmInstance,
        })
      if (err(primitiveEdgeResult)) return primitiveEdgeResult
      bodies = primitiveEdgeResult.bodies
    }
    if (bodies.size !== 1) {
      return new Error('No edges found in the selection')
    }
    const expr = bodies.values().toArray()[0].tagsExpr
    return { generatedAxis: expr, modifiedAst }
  } else {
    return new Error('Must provide either an axis or an edge selection')
  }
}

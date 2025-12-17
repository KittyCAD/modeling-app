import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'

import {
  createCallExpressionStdLibKw,
  createName,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createTagDeclarator,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
  createPoint2dExpression,
} from '@src/lang/modifyAst'
import {
  modifyAstWithTagsForSelection,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/tagManagement'
import {
  getNodeFromPath,
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  getArtifactOfTypes,
  getSweepEdgeCodeRef,
} from '@src/lang/std/artifactGraph'
import type {
  ArtifactGraph,
  LabeledArg,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  KCL_DEFAULT_CONSTANT_PREFIXES,
  type KclPreludeExtrudeMethod,
  type KclPreludeBodyType,
} from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { getEdgeTagCall } from '@src/lang/modifyAst/edges'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function addExtrude({
  ast,
  artifactGraph,
  sketches,
  wasmInstance,
  length,
  to,
  symmetric,
  bidirectionalLength,
  tagStart,
  tagEnd,
  twistAngle,
  twistAngleStep,
  twistCenter,
  method,
  bodyType,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  sketches: Selections
  wasmInstance: ModuleType
  length?: KclCommandValue
  to?: Selections
  symmetric?: boolean
  bidirectionalLength?: KclCommandValue
  tagStart?: string
  tagEnd?: string
  twistAngle?: KclCommandValue
  twistAngleStep?: KclCommandValue
  twistCenter?: KclCommandValue
  method?: KclPreludeExtrudeMethod
  bodyType?: KclPreludeBodyType
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

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const vars = getVariableExprsFromSelection(sketches, modifiedAst, mNodeToEdit)
  if (err(vars)) {
    return vars
  }

  // Extra labeled args expressions
  const lengthExpr = length
    ? [createLabeledArg('length', valueOrVariable(length))]
    : []
  // Special handling for 'to' arg
  let toExpr: LabeledArg[] = []
  if (to) {
    if (to.graphSelections.length !== 1) {
      return new Error('Extrude "to" argument must have exactly one selection.')
    }
    const tagResult = modifyAstWithTagsForSelection(
      modifiedAst,
      to.graphSelections[0],
      artifactGraph
    )
    if (err(tagResult)) return tagResult
    modifiedAst = tagResult.modifiedAst
    toExpr = [createLabeledArg('to', createLocalName(tagResult.tags[0]))]
  }
  const symmetricExpr = symmetric
    ? [createLabeledArg('symmetric', createLiteral(symmetric, wasmInstance))]
    : []
  const bidirectionalLengthExpr = bidirectionalLength
    ? [
        createLabeledArg(
          'bidirectionalLength',
          valueOrVariable(bidirectionalLength)
        ),
      ]
    : []
  const tagStartExpr = tagStart
    ? [createLabeledArg('tagStart', createTagDeclarator(tagStart))]
    : []
  const tagEndExpr = tagEnd
    ? [createLabeledArg('tagEnd', createTagDeclarator(tagEnd))]
    : []
  const twistAngleExpr = twistAngle
    ? [createLabeledArg('twistAngle', valueOrVariable(twistAngle))]
    : []
  const twistAngleStepExpr = twistAngleStep
    ? [createLabeledArg('twistAngleStep', valueOrVariable(twistAngleStep))]
    : []
  let twistCenterExpr: LabeledArg[] = []
  if (twistCenter) {
    const twistCenterExpression = createPoint2dExpression(
      twistCenter,
      wasmInstance
    )
    if (err(twistCenterExpression)) return twistCenterExpression
    twistCenterExpr = [createLabeledArg('twistCenter', twistCenterExpression)]
  }
  const methodExpr = method
    ? [createLabeledArg('method', createLocalName(method))]
    : []
  const bodyTypeExpr = bodyType
    ? [createLabeledArg('bodyType', createLocalName(bodyType))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('extrude', sketchesExpr, [
    ...lengthExpr,
    ...toExpr,
    ...symmetricExpr,
    ...bidirectionalLengthExpr,
    ...tagStartExpr,
    ...tagEndExpr,
    ...twistAngleExpr,
    ...twistAngleStepExpr,
    ...twistCenterExpr,
    ...methodExpr,
    ...bodyTypeExpr,
  ])

  // Insert variables for labeled arguments if provided
  if (length && 'variableName' in length && length.variableName) {
    insertVariableAndOffsetPathToNode(length, modifiedAst, mNodeToEdit)
  }
  if (
    bidirectionalLength &&
    'variableName' in bidirectionalLength &&
    bidirectionalLength.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      bidirectionalLength,
      modifiedAst,
      mNodeToEdit
    )
  }
  if (twistAngle && 'variableName' in twistAngle && twistAngle.variableName) {
    insertVariableAndOffsetPathToNode(twistAngle, modifiedAst, mNodeToEdit)
  }
  if (
    twistAngleStep &&
    'variableName' in twistAngleStep &&
    twistAngleStep.variableName
  ) {
    insertVariableAndOffsetPathToNode(twistAngleStep, modifiedAst, mNodeToEdit)
  }
  if (
    twistCenter &&
    'variableName' in twistCenter &&
    twistCenter.variableName
  ) {
    insertVariableAndOffsetPathToNode(twistCenter, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.EXTRUDE,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

// From rust/kcl-lib/std/sweep.kcl
export type SweepRelativeTo = 'SKETCH_PLANE' | 'TRAJECTORY'
export const SWEEP_CONSTANTS: Record<string, SweepRelativeTo> = {
  SKETCH_PLANE: 'SKETCH_PLANE',
  TRAJECTORY: 'TRAJECTORY',
}
export const SWEEP_MODULE = 'sweep'

export function addSweep({
  ast,
  sketches,
  path,
  wasmInstance,
  sectional,
  relativeTo,
  tagStart,
  tagEnd,
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  path: Selections
  wasmInstance: ModuleType
  sectional?: boolean
  relativeTo?: SweepRelativeTo
  tagStart?: string
  tagEnd?: string
  nodeToEdit?: PathToNode
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const vars = getVariableExprsFromSelection(sketches, modifiedAst, mNodeToEdit)
  if (err(vars)) {
    return vars
  }

  // Find the path declaration for the labeled argument
  // TODO: see if we can replace this with `getVariableExprsFromSelection`
  const pathDeclaration = getNodeFromPath<VariableDeclaration>(
    ast,
    path.graphSelections[0].codeRef.pathToNode,
    'VariableDeclaration'
  )
  if (err(pathDeclaration)) {
    return pathDeclaration
  }

  // Extra labeled args expressions
  const pathExpr = createLocalName(pathDeclaration.node.declaration.id.name)
  const sectionalExpr = sectional
    ? [createLabeledArg('sectional', createLiteral(sectional, wasmInstance))]
    : []
  const relativeToExpr = relativeTo
    ? [createLabeledArg('relativeTo', createName([SWEEP_MODULE], relativeTo))]
    : []
  const tagStartExpr = tagStart
    ? [createLabeledArg('tagStart', createTagDeclarator(tagStart))]
    : []
  const tagEndExpr = tagEnd
    ? [createLabeledArg('tagEnd', createTagDeclarator(tagEnd))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('sweep', sketchesExpr, [
    createLabeledArg('path', pathExpr),
    ...sectionalExpr,
    ...relativeToExpr,
    ...tagStartExpr,
    ...tagEndExpr,
  ])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SWEEP,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addLoft({
  ast,
  sketches,
  wasmInstance,
  vDegree,
  bezApproximateRational,
  baseCurveIndex,
  tagStart,
  tagEnd,
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  wasmInstance: ModuleType
  vDegree?: KclCommandValue
  bezApproximateRational?: boolean
  baseCurveIndex?: KclCommandValue
  tagStart?: string
  tagEnd?: string
  nodeToEdit?: PathToNode
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const vars = getVariableExprsFromSelection(sketches, modifiedAst, mNodeToEdit)
  if (err(vars)) {
    return vars
  }

  // Extra labeled args expressions
  const vDegreeExpr = vDegree
    ? [createLabeledArg('vDegree', valueOrVariable(vDegree))]
    : []
  const bezApproximateRationalExpr = bezApproximateRational
    ? [
        createLabeledArg(
          'bezApproximateRational',
          createLiteral(bezApproximateRational, wasmInstance)
        ),
      ]
    : []
  const baseCurveIndexExpr = baseCurveIndex
    ? [createLabeledArg('baseCurveIndex', valueOrVariable(baseCurveIndex))]
    : []
  const tagStartExpr = tagStart
    ? [createLabeledArg('tagStart', createTagDeclarator(tagStart))]
    : []
  const tagEndExpr = tagEnd
    ? [createLabeledArg('tagEnd', createTagDeclarator(tagEnd))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('loft', sketchesExpr, [
    ...vDegreeExpr,
    ...bezApproximateRationalExpr,
    ...baseCurveIndexExpr,
    ...tagStartExpr,
    ...tagEndExpr,
  ])

  // Insert variables for labeled arguments if provided
  if (vDegree && 'variableName' in vDegree && vDegree.variableName) {
    insertVariableAndOffsetPathToNode(vDegree, modifiedAst, mNodeToEdit)
  }
  if (
    baseCurveIndex &&
    'variableName' in baseCurveIndex &&
    baseCurveIndex.variableName
  ) {
    insertVariableAndOffsetPathToNode(baseCurveIndex, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.LOFT,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addRevolve({
  ast,
  sketches,
  angle,
  wasmInstance,
  axis,
  edge,
  symmetric,
  bidirectionalAngle,
  tagStart,
  tagEnd,
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  angle: KclCommandValue
  wasmInstance: ModuleType
  axis?: string
  edge?: Selections
  symmetric?: boolean
  bidirectionalAngle?: KclCommandValue
  tagStart?: string
  tagEnd?: string
  nodeToEdit?: PathToNode
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const vars = getVariableExprsFromSelection(sketches, modifiedAst, mNodeToEdit)
  if (err(vars)) {
    return vars
  }

  // Retrieve axis expression depending on mode
  const getAxisResult = getAxisExpressionAndIndex(axis, edge, modifiedAst)
  if (err(getAxisResult) || !getAxisResult.generatedAxis) {
    return new Error('Generated axis selection is missing.')
  }

  // Extra labeled args expressions
  const symmetricExpr = symmetric
    ? [createLabeledArg('symmetric', createLiteral(symmetric, wasmInstance))]
    : []
  const bidirectionalAngleExpr = bidirectionalAngle
    ? [
        createLabeledArg(
          'bidirectionalAngle',
          valueOrVariable(bidirectionalAngle)
        ),
      ]
    : []
  const tagStartExpr = tagStart
    ? [createLabeledArg('tagStart', createTagDeclarator(tagStart))]
    : []
  const tagEndExpr = tagEnd
    ? [createLabeledArg('tagEnd', createTagDeclarator(tagEnd))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('revolve', sketchesExpr, [
    createLabeledArg('angle', valueOrVariable(angle)),
    createLabeledArg('axis', getAxisResult.generatedAxis),
    ...symmetricExpr,
    ...bidirectionalAngleExpr,
    ...tagStartExpr,
    ...tagEndExpr,
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in angle && angle.variableName) {
    insertVariableAndOffsetPathToNode(angle, modifiedAst, mNodeToEdit)
  }

  if (
    bidirectionalAngle &&
    'variableName' in bidirectionalAngle &&
    bidirectionalAngle.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      bidirectionalAngle,
      modifiedAst,
      mNodeToEdit
    )
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.REVOLVE,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

// Utilities

export function getAxisExpressionAndIndex(
  axis: string | undefined,
  edge: Selections | undefined,
  ast: Node<Program>
) {
  if (edge) {
    const pathToAxisSelection = getNodePathFromSourceRange(
      ast,
      edge.graphSelections[0]?.codeRef.range
    )
    const tagResult = mutateAstWithTagForSketchSegment(ast, pathToAxisSelection)

    // Have the tag whether it is already created or a new one is generated
    if (err(tagResult)) {
      return tagResult
    }

    const { tag } = tagResult
    const axisSelection = edge?.graphSelections[0]?.artifact
    if (!axisSelection) {
      return new Error('Generated axis selection is missing.')
    }

    const generatedAxis = getEdgeTagCall(tag, axisSelection)
    if (
      axisSelection.type === 'segment' ||
      axisSelection.type === 'path' ||
      axisSelection.type === 'edgeCut'
    ) {
      const axisDeclaration = axisSelection.codeRef.pathToNode
      if (!axisDeclaration) {
        return new Error('Expected to find axis declaration')
      }

      const axisIndexInPathToNode =
        axisDeclaration.findIndex((a) => a[0] === 'body') + 1
      const value = axisDeclaration[axisIndexInPathToNode][0]
      if (typeof value !== 'number') {
        return new Error('expected axis index value to be a number')
      }

      const axisIndexIfAxis = value
      return { generatedAxis, axisIndexIfAxis }
    } else {
      return { generatedAxis }
    }
  }

  if (axis) {
    return { generatedAxis: createLocalName(axis) }
  }

  return new Error('Axis or edge selection is missing.')
}

// Sort of an inverse from getAxisExpressionAndIndex
export function retrieveAxisOrEdgeSelectionsFromOpArg(
  opArg: OpArg,
  artifactGraph: ArtifactGraph
):
  | Error
  | {
      axisOrEdge: 'Axis' | 'Edge'
      axis?: string
      edge?: Selections
    } {
  let axisOrEdge: 'Axis' | 'Edge' | undefined
  let axis: string | undefined
  let edge: Selections | undefined
  const axisValue = opArg.value
  const nonZero = (val: OpKclValue): number => {
    if (val.type === 'Number') {
      return val.value
    } else {
      return 0
    }
  }
  if (axisValue.type === 'Object') {
    // default axis casee
    axisOrEdge = 'Axis'
    const direction = axisValue.value['direction']
    if (!direction || direction.type !== 'Array') {
      return new Error('No direction vector for axis')
    }
    if (nonZero(direction.value[0])) {
      axis = 'X'
    } else if (nonZero(direction.value[1])) {
      axis = 'Y'
    } else if (nonZero(direction.value[2])) {
      axis = 'Z'
    } else {
      return new Error('Bad direction vector for axis')
    }
  } else if (axisValue.type === 'TagIdentifier' && axisValue.artifact_id) {
    // segment case
    axisOrEdge = 'Edge'
    const artifact = getArtifactOfTypes(
      {
        key: axisValue.artifact_id,
        types: ['segment'],
      },
      artifactGraph
    )
    if (err(artifact)) {
      return new Error("Couldn't find related edge artifact")
    }

    edge = {
      graphSelections: [
        {
          artifact,
          codeRef: artifact.codeRef,
        },
      ],
      otherSelections: [],
    }
  } else if (axisValue.type === 'Uuid') {
    // sweepEdge case
    axisOrEdge = 'Edge'
    const artifact = getArtifactOfTypes(
      {
        key: axisValue.value,
        types: ['sweepEdge'],
      },
      artifactGraph
    )
    if (err(artifact)) {
      return new Error("Couldn't find related edge artifact")
    }

    const codeRef = getSweepEdgeCodeRef(artifact, artifactGraph)
    if (err(codeRef)) {
      return new Error("Couldn't find related edge code ref")
    }

    edge = {
      graphSelections: [
        {
          artifact,
          codeRef,
        },
      ],
      otherSelections: [],
    }
  } else {
    return new Error('The type of the axis argument is unsupported')
  }
  return { axisOrEdge, axis, edge }
}

export function retrieveTagDeclaratorFromOpArg(
  opArg: OpArg,
  code: string
): string {
  const dollarSignOffset = 1
  return code.slice(
    opArg.sourceRange[0] + dollarSignOffset,
    opArg.sourceRange[1]
  )
}

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
  getCodeRefsByArtifactId,
  getSweepEdgeCodeRef,
} from '@src/lang/std/artifactGraph'
import type {
  Artifact,
  ArtifactGraph,
  Expr,
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
  KCL_PRELUDE_BODY_TYPE_SOLID,
  KCL_PRELUDE_BODY_TYPE_SURFACE,
} from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { isFaceArtifact } from '@src/lang/modifyAst/faces'
import {
  getEdgeTagCall,
  entityReferenceToEdgeRefPayload,
  createEdgeRefObjectExpression,
} from '@src/lang/modifyAst/edges'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { toUtf16 } from '@src/lang/errors'

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
  // Map the face and sketch selections into a list of kcl expressions to be passed as unlabelled argument
  // V2 command bar picks (entity refs) need to be normalized into graphSelections,
  // otherwise extrude() can be generated without its required first positional arg.
  const normalizedV2GraphSelections = (sketches.graphSelectionsV2 || [])
    .map((v2Selection) => {
      if (v2Selection.codeRef) {
        return { codeRef: v2Selection.codeRef }
      }

      const entityRef = v2Selection.entityRef
      if (!entityRef) return null

      let entityId: string | undefined
      if (entityRef.type === 'solid2d') {
        entityId = entityRef.solid2d_id
      } else if (entityRef.type === 'face') {
        entityId = entityRef.face_id
      } else if (entityRef.type === 'plane') {
        entityId = entityRef.plane_id
      }

      if (!entityId) return null
      const codeRef = getCodeRefsByArtifactId(entityId, artifactGraph)?.[0]
      if (!codeRef) return null
      return { codeRef }
    })
    .filter(
      (
        selection
      ): selection is { codeRef: NonNullable<typeof selection>['codeRef'] } =>
        Boolean(selection)
    )

  const normalizedSketches: Selections = {
    graphSelections: [
      ...sketches.graphSelections,
      ...normalizedV2GraphSelections,
    ],
    otherSelections: sketches.otherSelections,
    graphSelectionsV2: [],
  }

  const vars: {
    exprs: Expr[]
    pathIfPipe?: PathToNode
  } = { exprs: [] }
  const faceSelections = normalizedSketches.graphSelections.filter(
    (selection) => isFaceArtifact(selection.artifact)
  )
  for (const faceSelection of faceSelections) {
    const res = modifyAstWithTagsForSelection(
      modifiedAst,
      faceSelection,
      artifactGraph,
      wasmInstance
    )
    if (err(res)) {
      return res
    }
    modifiedAst = res.modifiedAst
    const expr = createLocalName(res.tags[0])
    vars.exprs.push(expr)
  }

  const nonFaceSelections: Selections = {
    graphSelections: normalizedSketches.graphSelections.filter(
      (selection) => !isFaceArtifact(selection.artifact)
    ),
    otherSelections: normalizedSketches.otherSelections,
    graphSelectionsV2: [],
  }
  if (nonFaceSelections.graphSelections.length > 0) {
    const res = getVariableExprsFromSelection(
      nonFaceSelections,
      modifiedAst,
      wasmInstance,
      mNodeToEdit
    )
    if (err(res)) {
      return res
    }
    vars.pathIfPipe = res.pathIfPipe
    vars.exprs.push(...res.exprs)
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
      artifactGraph,
      wasmInstance
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
  bodyType,
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
  bodyType?: KclPreludeBodyType
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
  const vars = getVariableExprsFromSelection(
    sketches,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
  if (err(vars)) {
    return vars
  }

  // Find the path declaration for the labeled argument
  // TODO: see if we can replace this with `getVariableExprsFromSelection`
  const pathDeclaration = getNodeFromPath<VariableDeclaration>(
    ast,
    path.graphSelections[0].codeRef.pathToNode,
    wasmInstance,
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
  const bodyTypeExpr = bodyType
    ? [createLabeledArg('bodyType', createLocalName(bodyType))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('sweep', sketchesExpr, [
    createLabeledArg('path', pathExpr),
    ...sectionalExpr,
    ...relativeToExpr,
    ...tagStartExpr,
    ...tagEndExpr,
    ...bodyTypeExpr,
  ])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SWEEP,
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

export function addLoft({
  ast,
  sketches,
  wasmInstance,
  vDegree,
  bezApproximateRational,
  baseCurveIndex,
  tagStart,
  tagEnd,
  bodyType,
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
  bodyType?: KclPreludeBodyType
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
  const vars = getVariableExprsFromSelection(
    sketches,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
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
  const bodyTypeExpr = bodyType
    ? [createLabeledArg('bodyType', createLocalName(bodyType))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('loft', sketchesExpr, [
    ...vDegreeExpr,
    ...bezApproximateRationalExpr,
    ...baseCurveIndexExpr,
    ...tagStartExpr,
    ...tagEndExpr,
    ...bodyTypeExpr,
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

export function addRevolve({
  ast,
  artifactGraph,
  sketches,
  angle,
  wasmInstance,
  axis,
  edge,
  symmetric,
  bidirectionalAngle,
  tagStart,
  tagEnd,
  bodyType,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  sketches: Selections
  angle: KclCommandValue
  wasmInstance: ModuleType
  axis?: string
  edge?: Selections
  symmetric?: boolean
  bidirectionalAngle?: KclCommandValue
  tagStart?: string
  tagEnd?: string
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
  // V2 command bar picks (entity refs) need to be normalized into graphSelections,
  // otherwise revolve() can be generated without its required first positional arg.
  // TODO this is probably the wrong approach because we're going to get rid of `graphSelections` entirely
  // and replace it with `graphSelectionsV2`, so normalising to `graphSelections` is going to mean more refactoring
  // later, but at least it's working and tsc will tell us most/all of the places that need to be updated.
  const normalizedV2GraphSelections = (sketches.graphSelectionsV2 || [])
    .map((v2Selection) => {
      if (v2Selection.codeRef) {
        return { codeRef: v2Selection.codeRef }
      }

      const entityRef = v2Selection.entityRef
      if (!entityRef) return null

      let entityId: string | undefined
      if (entityRef.type === 'solid2d') {
        entityId = entityRef.solid2d_id
      } else if (entityRef.type === 'face') {
        entityId = entityRef.face_id
      } else if (entityRef.type === 'plane') {
        entityId = entityRef.plane_id
      }

      if (!entityId) return null
      const codeRef = getCodeRefsByArtifactId(entityId, artifactGraph)?.[0]
      if (!codeRef) return null
      return { codeRef }
    })
    .filter(
      (
        selection
      ): selection is { codeRef: NonNullable<typeof selection>['codeRef'] } =>
        Boolean(selection)
    )

  const normalizedSketches: Selections = {
    graphSelections: [
      ...sketches.graphSelections,
      ...normalizedV2GraphSelections,
    ],
    otherSelections: sketches.otherSelections,
    graphSelectionsV2: [],
  }

  const vars = getVariableExprsFromSelection(
    normalizedSketches,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
  if (err(vars)) {
    return vars
  }

  // Handle axis/edge: Check if edge has V2 selections (edgeRefs) or use tag-based approach
  let axisExpr: Expr | null = null
  let edgeRefExpr: Expr | null = null
  const hasV2Selections =
    edge && edge.graphSelectionsV2 && edge.graphSelectionsV2.length > 0
  const entityRefType = hasV2Selections
    ? edge.graphSelectionsV2[0]?.entityRef?.type
    : null

  // Solid2dEdge uses legacy tag-based approach, not edgeRefs
  // Only use edgeRefs for BRep edges (type === 'edge'), not for Solid2D edges
  const useEdgeRefs = hasV2Selections && entityRefType === 'edge'

  if (useEdgeRefs && edge.graphSelectionsV2[0]?.entityRef) {
    // Use edgeRefs (new API) - only for BRep edges, not Solid2D edges
    const entityRef = edge.graphSelectionsV2[0].entityRef
    if (entityRef.type === 'edge') {
      const payload = entityReferenceToEdgeRefPayload(entityRef)
      // Get the original edge selection for Solid2D edge handling
      // Prefer graphSelections (V1) which has the segment artifact directly
      // Fall back to graphSelectionsV2 codeRef if V1 is not available
      const originalEdgeSelection =
        edge.graphSelections && edge.graphSelections.length > 0
          ? edge.graphSelections[0]
          : undefined
      // Note: fallbackCodeRef removed - Solid2dEdge should use legacy path, not edgeRefs
      const edgeRefResult = createEdgeRefObjectExpression(
        payload,
        wasmInstance,
        modifiedAst,
        artifactGraph,
        originalEdgeSelection
      )
      if (err(edgeRefResult)) {
        return edgeRefResult
      }
      edgeRefExpr = edgeRefResult.expr
      modifiedAst = edgeRefResult.modifiedAst
    }
  } else if (edge) {
    // Use tag-based approach (legacy) - for Solid2dEdge or V1 selections
    // For Solid2dEdge, we need to normalize to V1 format (segment artifact)
    let normalizedEdge = edge
    if (
      edge.graphSelectionsV2 &&
      edge.graphSelectionsV2.length > 0 &&
      edge.graphSelectionsV2[0]?.entityRef?.type === 'solid2d_edge'
    ) {
      // Solid2dEdge: the edgeId IS the segment artifact ID directly!
      // When a segment becomes part of a solid2d, it becomes an edge, and the edgeId
      // is the same as the original segment's artifact ID.
      const edgeId = edge.graphSelectionsV2[0].entityRef.edge_id

      // Look up the segment artifact directly by edgeId
      const segmentArtifact = artifactGraph.get(edgeId)

      // Verify it's a segment and has a codeRef
      if (
        segmentArtifact &&
        segmentArtifact.type === 'segment' &&
        segmentArtifact.codeRef
      ) {
        normalizedEdge = {
          ...edge,
          graphSelections: [
            {
              artifact: segmentArtifact,
              codeRef: segmentArtifact.codeRef,
            },
          ],
        }
      } else {
        // If we can't find the segment, return an error with debug info
        return new Error(
          `Could not find segment artifact for Solid2D edge with ID ${edgeId}. ` +
            `Found artifact type: ${segmentArtifact?.type || 'undefined'}. ` +
            `Please select the edge again.`
        )
      }
    }

    const getAxisResult = getAxisExpressionAndIndex(
      axis,
      normalizedEdge,
      modifiedAst,
      wasmInstance
    )
    if (err(getAxisResult) || !getAxisResult.generatedAxis) {
      return new Error('Generated axis selection is missing.')
    }
    axisExpr = getAxisResult.generatedAxis
    modifiedAst = modifiedAst // getAxisResult might modify AST, but getAxisExpressionAndIndex doesn't return it
  } else if (axis) {
    // Use axis string
    axisExpr = createLocalName(axis)
  } else {
    return new Error('Axis or edge selection is missing.')
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
  const bodyTypeExpr = bodyType
    ? [createLabeledArg('bodyType', createLocalName(bodyType))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const axisArgs = edgeRefExpr
    ? [createLabeledArg('edgeRef', edgeRefExpr)]
    : axisExpr
      ? [createLabeledArg('axis', axisExpr)]
      : []
  const call = createCallExpressionStdLibKw('revolve', sketchesExpr, [
    createLabeledArg('angle', valueOrVariable(angle)),
    ...axisArgs,
    ...symmetricExpr,
    ...bidirectionalAngleExpr,
    ...tagStartExpr,
    ...tagEndExpr,
    ...bodyTypeExpr,
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

// Utilities

export function getAxisExpressionAndIndex(
  axis: string | undefined,
  edge: Selections | undefined,
  ast: Node<Program>,
  wasmInstance: ModuleType
) {
  if (edge) {
    const pathToAxisSelection = getNodePathFromSourceRange(
      ast,
      edge.graphSelections[0]?.codeRef.range
    )
    const tagResult = mutateAstWithTagForSketchSegment(
      ast,
      pathToAxisSelection,
      wasmInstance
    )

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
      graphSelectionsV2: [],
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
      graphSelectionsV2: [],
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
    toUtf16(opArg.sourceRange[0], code) + dollarSignOffset,
    toUtf16(opArg.sourceRange[1], code)
  )
}

export function retrieveBodyTypeFromOpArg(
  opArg: OpArg,
  code: string
): KclPreludeBodyType | Error {
  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)
  const result = code.slice(...opArg.sourceRange.map(boundToUtf16))
  if (result === KCL_PRELUDE_BODY_TYPE_SOLID) {
    return KCL_PRELUDE_BODY_TYPE_SOLID
  }

  if (result === KCL_PRELUDE_BODY_TYPE_SURFACE) {
    return KCL_PRELUDE_BODY_TYPE_SURFACE
  }

  return new Error("Couldn't retrieve bodyType argument")
}

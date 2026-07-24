import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createName,
  createTagDeclarator,
} from '@src/lang/create'
import { toUtf16 } from '@src/lang/errors'
import {
  createPoint2dExpression,
  createVariableExpressionsArray,
  insertRegionVariablesAndOffsetPathToNode,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  createEdgeRefObjectExpression,
  entityReferenceToEdgeRefPayload,
  getEdgeTagCall,
  getPrimitiveEdgeSelections,
  groupSelectionsByBodyAndAddTags,
  insertPrimitiveEdgeVariablesAndOffsetPathToNode,
  retrieveEdgeSelectionsFromSingleEdgeRef,
} from '@src/lang/modifyAst/edges'
import {
  getFacesExprsFromSelection,
  isFaceArtifact,
} from '@src/lang/modifyAst/faces'
import {
  modifyAstWithTagsForSelection,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/tagManagement'
import { addHide } from '@src/lang/modifyAst/transforms'
import {
  artifactToEntityRef,
  getVariableExprsFromSelection,
  getVariableNameFromNodePath,
  isCallExprWithName,
  resolveToCodeRef,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  getArtifactFromRange,
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getFaceCodeRef,
  getSweepEdgeCodeRef,
} from '@src/lang/std/artifactGraph'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  LabeledArg,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { modelingStdLibCommandName } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  KCL_DEFAULT_CONSTANT_PREFIXES,
  KCL_PRELUDE_BODY_TYPE_SOLID,
  KCL_PRELUDE_BODY_TYPE_SURFACE,
  type KclPreludeBodyType,
  type KclPreludeExtrudeMethod,
} from '@src/lib/constants'
import { isEngineRegionSelection } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EngineRegionSelection,
  Selections,
} from '@src/machines/modelingSharedTypes'

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
  hideSeams,
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
  hideSeams?: boolean
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
  // Use original list only; do not concatenate with a normalized list to avoid duplicating each
  // selection (which produced wrong multi-arg extrude calls, e.g. extrude([cap, profile], length)
  // instead of extrude(cap, length)). Resolution works from entityRef or codeRef on the original.
  const normalizedSketches: Selections = {
    graphSelections: sketches.graphSelections || [],
    otherSelections: sketches.otherSelections,
  }

  const vars: {
    exprs: Expr[]
    pathIfPipe?: PathToNode
  } = { exprs: [] }
  const faceSelections = normalizedSketches.graphSelections.filter((s) => {
    const r = resolveToCodeRef(s, artifactGraph)
    return r?.artifact != null && isFaceArtifact(r.artifact)
  })
  for (const faceSel of faceSelections) {
    const resolved = resolveToCodeRef(faceSel, artifactGraph)
    if (!resolved) continue
    const res = modifyAstWithTagsForSelection(
      modifiedAst,
      resolved,
      artifactGraph,
      wasmInstance
    )
    if (err(res)) {
      return res
    }
    modifiedAst = res.modifiedAst
    const expr = res.exprs[0]
    vars.exprs.push(expr)
  }

  const nonFaceSelections: Selections = {
    graphSelections: normalizedSketches.graphSelections.filter((s) => {
      const r = resolveToCodeRef(s, artifactGraph)
      return !r?.artifact || !isFaceArtifact(r.artifact)
    }),
    otherSelections: normalizedSketches.otherSelections,
  }
  if (nonFaceSelections.graphSelections.length > 0) {
    const res = getVariableExprsFromSelection(
      nonFaceSelections,
      artifactGraph,
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

  // When only otherSelections (e.g. region) are present, graphSelections is empty; get exprs from otherSelections
  if (
    vars.exprs.length === 0 &&
    (normalizedSketches.otherSelections?.length ?? 0) > 0
  ) {
    const res = getVariableExprsFromSelection(
      normalizedSketches,
      artifactGraph,
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
  const engineRegions = sketches.otherSelections.filter(isEngineRegionSelection)
  if (engineRegions.length > 0) {
    const hideResult = addHideCallsForRegionSketches({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(hideResult)) return hideResult
    modifiedAst = hideResult

    const regionExprs = insertRegionVariablesAndOffsetPathToNode({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(regionExprs)) return regionExprs
    vars.exprs.push(...regionExprs)
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
    const toResolved = resolveToCodeRef(to.graphSelections[0], artifactGraph)
    if (!toResolved) return new Error('Could not resolve "to" selection.')
    const tagResult = modifyAstWithTagsForSelection(
      modifiedAst,
      toResolved,
      artifactGraph,
      wasmInstance
    )
    if (err(tagResult)) return tagResult
    modifiedAst = tagResult.modifiedAst
    toExpr = [createLabeledArg('to', tagResult.exprs[0])]
  }
  const symmetricExpr =
    symmetric !== undefined
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
  const hideSeamsExpr =
    hideSeams !== undefined
      ? [createLabeledArg('hideSeams', createLiteral(hideSeams, wasmInstance))]
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
    ...hideSeamsExpr,
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
  artifactGraph,
  sketches,
  path,
  wasmInstance,
  sectional,
  tolerance,
  relativeTo,
  translateProfileToPath,
  orientProfilePerpendicular,
  tagStart,
  tagEnd,
  bodyType,
  version,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  sketches: Selections
  path: Selections
  wasmInstance: ModuleType
  sectional?: boolean
  tolerance?: KclCommandValue
  relativeTo?: SweepRelativeTo
  translateProfileToPath?: boolean
  orientProfilePerpendicular?: boolean
  tagStart?: string
  tagEnd?: string
  bodyType?: KclPreludeBodyType
  version?: KclCommandValue
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
  const isEditing = Boolean(mNodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Map the face and sketch selections into a list of kcl expressions to be passed as unlabelled argument
  const vars: {
    exprs: Expr[]
    pathIfPipe?: PathToNode
  } = { exprs: [] }
  const faceSelections: Selections = {
    graphSelections: sketches.graphSelections.filter((selection) => {
      const resolved = resolveToCodeRef(selection, artifactGraph)
      return resolved?.artifact != null && isFaceArtifact(resolved.artifact)
    }),
    otherSelections: [],
  }
  const faceExprs = getFacesExprsFromSelection(
    modifiedAst,
    faceSelections,
    artifactGraph,
    wasmInstance
  )
  if (err(faceExprs)) return faceExprs
  modifiedAst = faceExprs.modifiedAst
  vars.exprs.push(...faceExprs.exprs)

  const nonFaceSelections: Selections = {
    graphSelections: sketches.graphSelections.filter((selection) => {
      const resolved = resolveToCodeRef(selection, artifactGraph)
      return !resolved?.artifact || !isFaceArtifact(resolved.artifact)
    }),
    otherSelections: sketches.otherSelections,
  }
  if (nonFaceSelections.graphSelections.length > 0) {
    const res = getVariableExprsFromSelection(
      nonFaceSelections,
      artifactGraph,
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

  const engineRegions = sketches.otherSelections.filter(isEngineRegionSelection)
  if (engineRegions.length > 0) {
    const hideResult = addHideCallsForRegionSketches({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(hideResult)) return hideResult
    modifiedAst = hideResult

    const regionExprs = insertRegionVariablesAndOffsetPathToNode({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(regionExprs)) return regionExprs
    vars.exprs.push(...regionExprs)
  }

  const pathVars = getVariableExprsFromSelection(
    path,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
  if (err(pathVars)) {
    return pathVars
  }

  const pathExpr = createVariableExpressionsArray(pathVars.exprs)
  if (!pathExpr) {
    return new Error("Couldn't retrieve path selection")
  }

  // Extra labeled args expressions
  const sectionalExpr =
    sectional !== undefined
      ? [createLabeledArg('sectional', createLiteral(sectional, wasmInstance))]
      : []
  const toleranceExpr = tolerance
    ? [createLabeledArg('tolerance', valueOrVariable(tolerance))]
    : []
  // `relativeTo` is legacy for new sweep calls; only preserve or update it when
  // editing existing code that already depends on that argument.
  const relativeToExpr =
    relativeTo && isEditing
      ? [createLabeledArg('relativeTo', createName([SWEEP_MODULE], relativeTo))]
      : []
  // New sweep calls should explicitly use the current recommended behavior:
  // version = 2, translateProfileToPath = false, and orientProfilePerpendicular = false.
  // When editing, omit missing args so old sweep code is not silently upgraded.
  const translateProfileToPathExpr =
    translateProfileToPath !== undefined
      ? [
          createLabeledArg(
            'translateProfileToPath',
            createLiteral(translateProfileToPath, wasmInstance)
          ),
        ]
      : isEditing
        ? []
        : [
            createLabeledArg(
              'translateProfileToPath',
              createLiteral(false, wasmInstance)
            ),
          ]
  const orientProfilePerpendicularExpr =
    orientProfilePerpendicular !== undefined
      ? [
          createLabeledArg(
            'orientProfilePerpendicular',
            createLiteral(orientProfilePerpendicular, wasmInstance)
          ),
        ]
      : isEditing
        ? []
        : [
            createLabeledArg(
              'orientProfilePerpendicular',
              createLiteral(false, wasmInstance)
            ),
          ]
  const tagStartExpr = tagStart
    ? [createLabeledArg('tagStart', createTagDeclarator(tagStart))]
    : []
  const tagEndExpr = tagEnd
    ? [createLabeledArg('tagEnd', createTagDeclarator(tagEnd))]
    : []
  const bodyTypeExpr = bodyType
    ? [createLabeledArg('bodyType', createLocalName(bodyType))]
    : []
  const versionExpr = version
    ? [createLabeledArg('version', valueOrVariable(version))]
    : isEditing
      ? []
      : [createLabeledArg('version', createLiteral(2, wasmInstance))]

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Sweep'),
    sketchesExpr,
    [
      createLabeledArg('path', pathExpr),
      ...sectionalExpr,
      ...toleranceExpr,
      ...relativeToExpr,
      ...tagStartExpr,
      ...tagEndExpr,
      ...bodyTypeExpr,
      ...versionExpr,
      ...translateProfileToPathExpr,
      ...orientProfilePerpendicularExpr,
    ]
  )

  if (version && 'variableName' in version && version.variableName) {
    insertVariableAndOffsetPathToNode(version, modifiedAst, mNodeToEdit)
  }
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
  artifactGraph,
  sketches,
  wasmInstance,
  vDegree,
  bezApproximateRational,
  baseCurveIndex,
  tolerance,
  tagStart,
  tagEnd,
  bodyType,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  sketches: Selections
  wasmInstance: ModuleType
  vDegree?: KclCommandValue
  bezApproximateRational?: boolean
  baseCurveIndex?: KclCommandValue
  tolerance?: KclCommandValue
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
  const vars = getVariableExprsFromSelection(
    sketches,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
  if (err(vars)) {
    return vars
  }

  const engineRegions = sketches.otherSelections.filter(isEngineRegionSelection)
  if (engineRegions.length > 0) {
    const hideResult = addHideCallsForRegionSketches({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(hideResult)) return hideResult
    modifiedAst = hideResult

    const regionExprs = insertRegionVariablesAndOffsetPathToNode({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(regionExprs)) return regionExprs
    vars.exprs.push(...regionExprs)
  }

  // Extra labeled args expressions
  const vDegreeExpr = vDegree
    ? [createLabeledArg('vDegree', valueOrVariable(vDegree))]
    : []
  const bezApproximateRationalExpr =
    bezApproximateRational !== undefined
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
  const toleranceExpr = tolerance
    ? [createLabeledArg('tolerance', valueOrVariable(tolerance))]
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
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Loft'),
    sketchesExpr,
    [
      ...vDegreeExpr,
      ...bezApproximateRationalExpr,
      ...baseCurveIndexExpr,
      ...toleranceExpr,
      ...tagStartExpr,
      ...tagEndExpr,
      ...bodyTypeExpr,
    ]
  )

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
  tolerance,
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
  tolerance?: KclCommandValue
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
  // Entity refs need to be normalized into graphSelections,
  // otherwise revolve() can be generated without its required first positional arg.
  // TODO this is probably the wrong approach because we're going to get rid of `graphSelections` entirely
  // and replace it with a different selection shape, so normalising to `graphSelections` is going to mean more refactoring
  // later, but at least it's working and tsc will tell us most/all of the places that need to be updated.
  const normalizedV2GraphSelections = (sketches.graphSelections || [])
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

  // Use normalized list only to avoid duplicating selections (same fix as addExtrude).
  const normalizedSketches: Selections = {
    graphSelections:
      normalizedV2GraphSelections.length > 0
        ? normalizedV2GraphSelections
        : sketches.graphSelections,
    otherSelections: sketches.otherSelections,
  }

  const vars = getVariableExprsFromSelection(
    normalizedSketches,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
  if (err(vars)) {
    return vars
  }
  const engineRegions = sketches.otherSelections.filter(isEngineRegionSelection)
  if (engineRegions.length > 0) {
    const hideResult = addHideCallsForRegionSketches({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(hideResult)) return hideResult
    modifiedAst = hideResult

    const regionExprs = insertRegionVariablesAndOffsetPathToNode({
      engineRegions,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(regionExprs)) return regionExprs
    vars.exprs.push(...regionExprs)
  }

  const getAxisResult = getAxisExpression(
    axis,
    edge,
    modifiedAst,
    wasmInstance,
    artifactGraph,
    mNodeToEdit
  )
  if (err(getAxisResult)) {
    return new Error('Generated axis selection is missing.')
  }
  modifiedAst = getAxisResult.modifiedAst

  // Extra labeled args expressions
  const symmetricExpr =
    symmetric !== undefined
      ? [createLabeledArg('symmetric', createLiteral(symmetric, wasmInstance))]
      : []
  const toleranceExpr = tolerance
    ? [createLabeledArg('tolerance', valueOrVariable(tolerance))]
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
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Revolve'),
    sketchesExpr,
    [
      createLabeledArg('angle', valueOrVariable(angle)),
      createLabeledArg('axis', getAxisResult.generatedAxis),
      ...toleranceExpr,
      ...symmetricExpr,
      ...bidirectionalAngleExpr,
      ...tagStartExpr,
      ...tagEndExpr,
      ...bodyTypeExpr,
    ]
  )

  // Insert variables for labeled arguments if provided
  if ('variableName' in angle && angle.variableName) {
    insertVariableAndOffsetPathToNode(angle, modifiedAst, mNodeToEdit)
  }
  if (tolerance && 'variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
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

function addHideCallsForRegionSketches({
  engineRegions,
  modifiedAst,
  artifactGraph,
  wasmInstance,
}: {
  engineRegions: EngineRegionSelection[]
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
}): Error | Node<Program> {
  let updatedAst = modifiedAst
  const hiddenSketches = collectHiddenSketchNames(updatedAst)
  const hiddenSketchIds = new Set<string>()

  for (const regionSelection of engineRegions) {
    if (hiddenSketchIds.has(regionSelection.sketchId)) {
      continue
    }

    const sketchArtifact = artifactGraph.get(regionSelection.sketchId)
    if (!sketchArtifact || sketchArtifact.type !== 'sketchBlock') {
      return new Error("Couldn't retrieve sketch block artifact")
    }

    const sketchVarNameForHide = getVariableNameFromNodePath(
      sketchArtifact.codeRef.pathToNode,
      updatedAst,
      wasmInstance
    )
    if (!sketchVarNameForHide) {
      return new Error("Couldn't retrieve sketch block variable")
    }

    if (hiddenSketches.has(sketchVarNameForHide)) {
      hiddenSketchIds.add(regionSelection.sketchId)
      continue
    }

    const hideResult = addHide({
      ast: updatedAst,
      artifactGraph,
      objects: {
        graphSelections: [
          {
            codeRef: sketchArtifact.codeRef,
          },
        ],
        otherSelections: [],
      },
      wasmInstance,
    })
    if (err(hideResult)) {
      return hideResult
    }

    updatedAst = hideResult.modifiedAst
    hiddenSketchIds.add(regionSelection.sketchId)
    hiddenSketches.add(sketchVarNameForHide)
  }

  return updatedAst
}

function collectHiddenSketchNames(modifiedAst: Node<Program>): Set<string> {
  const hiddenSketches = new Set<string>()

  for (const bodyItem of modifiedAst.body) {
    const maybeCall =
      bodyItem.type === 'VariableDeclaration'
        ? bodyItem.declaration.init
        : bodyItem.type === 'ExpressionStatement'
          ? bodyItem.expression
          : undefined

    if (!maybeCall || !isCallExprWithName(maybeCall, 'hide')) {
      continue
    }

    const sketchNames = getSketchNamesFromHideArg(maybeCall.unlabeled)
    sketchNames.forEach((name) => hiddenSketches.add(name))
  }

  return hiddenSketches
}

function getSketchNamesFromHideArg(
  hideArg: CallExpressionKw['unlabeled']
): string[] {
  if (!hideArg) {
    return []
  }

  if (hideArg.type === 'Name') {
    return [hideArg.name.name]
  }

  if (hideArg.type === 'ArrayExpression') {
    return hideArg.elements
      .filter((element) => element.type === 'Name')
      .map((element) => element.name.name)
  }

  return []
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
    const firstEdgeSelection = edge.graphSelections[0]
    if (firstEdgeSelection?.entityRef?.type === 'edge') {
      const payload = entityReferenceToEdgeRefPayload(
        firstEdgeSelection.entityRef
      )
      const originalEdgeSelection = resolveToCodeRef(
        firstEdgeSelection,
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

      return {
        generatedAxis: edgeRefResult.expr,
        modifiedAst: edgeRefResult.modifiedAst,
      }
    }

    // Direct segment case (sketch solve)
    const segmentAxisExpr = getVariableExprsFromSelection(
      edge,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      nodeToEdit,
      { preferDirectSegment: true }
    )
    if (!err(segmentAxisExpr) && segmentAxisExpr.exprs[0]) {
      const directAxisExpr = segmentAxisExpr.exprs[0]
      if (directAxisExpr.type === 'MemberExpression') {
        return { generatedAxis: directAxisExpr, modifiedAst }
      }
    }

    // Direct segment case (old sketch)
    const edgeResolved = resolveToCodeRef(
      edge.graphSelections[0],
      artifactGraph
    )
    let axisSelection =
      edge?.graphSelections[0] != null
        ? resolveToCodeRef(edge.graphSelections[0], artifactGraph)?.artifact
        : undefined
    // Fallback: resolveToCodeRef returns no artifact for entityRef.type === 'edge' (BRep), or segment/solid2d_edge when ID not in graph;
    // try to find an artifact by codeRef.range or by codeRef.pathToNode (segment/path/edgeCut for tag-based axis).
    const axisSelectionAny = axisSelection as any
    if (
      (!axisSelectionAny || !axisSelectionAny.codeRef) &&
      edge?.graphSelections[0] != null &&
      artifactGraph
    ) {
      const resolved = resolveToCodeRef(edge.graphSelections[0], artifactGraph)
      if (resolved?.codeRef) {
        const byRange = getArtifactFromRange(
          resolved.codeRef.range,
          artifactGraph
        )
        if (
          byRange &&
          (byRange.type === 'segment' ||
            byRange.type === 'path' ||
            byRange.type === 'edgeCut')
        ) {
          axisSelection = byRange
        }
        // If range didn't find one, try matching by pathToNode (e.g. segment on solid2d from engine)
        if (
          !axisSelection &&
          resolved.codeRef.pathToNode &&
          resolved.codeRef.pathToNode.length > 0
        ) {
          const pathStr = JSON.stringify(resolved.codeRef.pathToNode)
          for (const artifact of artifactGraph.values()) {
            const cr = getFaceCodeRef(artifact)
            if (
              cr &&
              (artifact.type === 'segment' ||
                artifact.type === 'path' ||
                artifact.type === 'edgeCut') &&
              JSON.stringify(cr.pathToNode) === pathStr
            ) {
              axisSelection = artifact
              break
            }
          }
        }
      }
    }
    if (!axisSelection) {
      return new Error('Generated axis selection is missing.')
    }

    let pathToAxisSelection: PathToNode
    const axisCodeRef =
      axisSelectionAny.codeRef ?? (edgeResolved as any)?.codeRef
    if (axisCodeRef?.pathToNode && axisCodeRef.pathToNode.length > 0) {
      pathToAxisSelection = axisCodeRef.pathToNode
    } else {
      pathToAxisSelection = getNodePathFromSourceRange(
        ast,
        axisCodeRef?.range ?? edgeResolved?.codeRef?.range ?? [0, 0, 0]
      )
    }

    const tagResult = mutateAstWithTagForSketchSegment(
      modifiedAst,
      pathToAxisSelection,
      wasmInstance
    )
    if (!err(tagResult)) {
      modifiedAst = tagResult.modifiedAst
      const { tag } = tagResult
      const generatedAxis = getEdgeTagCall(tag, axisSelectionAny)
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

// Sort of an inverse from getAxisExpression
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
  const buildEdgeSelectionFromSegmentId = (
    segmentId: string
  ): Selections | Error => {
    const artifact = getArtifactOfTypes(
      {
        key: segmentId,
        types: ['segment'],
      },
      artifactGraph
    )
    if (err(artifact)) {
      return new Error("Couldn't find related edge artifact")
    }

    return {
      graphSelections: [
        {
          codeRef: artifact.codeRef,
          entityRef: artifactToEntityRef(
            artifact.type,
            artifact.id,
            artifact.type === 'segment' ? artifact.pathId : undefined
          ),
        },
      ],
      otherSelections: [],
    }
  }
  const nonZero = (val: OpKclValue): number => {
    if (val.type === 'Number') {
      return val.value
    } else {
      return 0
    }
  }
  if (axisValue.type === 'Object') {
    const direction = axisValue.value['direction']
    if (direction && direction.type === 'Array') {
      axisOrEdge = 'Axis'
      if (nonZero(direction.value[0])) {
        axis = 'X'
      } else if (nonZero(direction.value[1])) {
        axis = 'Y'
      } else if (nonZero(direction.value[2])) {
        axis = 'Z'
      } else {
        return new Error('Bad direction vector for axis')
      }
    } else if ('sideFaces' in axisValue.value) {
      axisOrEdge = 'Edge'
      const edgeSelection = retrieveEdgeSelectionsFromSingleEdgeRef(
        opArg,
        artifactGraph
      )
      if (err(edgeSelection)) {
        return new Error("Couldn't retrieve edge selection from axis")
      }
      edge = edgeSelection
    } else {
      return new Error('No direction vector for axis')
    }
  } else if (axisValue.type === 'TagIdentifier' && axisValue.artifact_id) {
    // segment case
    axisOrEdge = 'Edge'
    const edgeSelection = buildEdgeSelectionFromSegmentId(axisValue.artifact_id)
    if (err(edgeSelection)) {
      return edgeSelection
    }
    edge = edgeSelection
  } else if (axisValue.type === 'Segment') {
    // segment case from sketch-solve member expressions (for example: sketch001.line5)
    axisOrEdge = 'Edge'
    const edgeSelection = buildEdgeSelectionFromSegmentId(axisValue.artifact_id)
    if (err(edgeSelection)) {
      return edgeSelection
    }
    edge = edgeSelection
  } else if (axisValue.type === 'Uuid') {
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
      graphSelections: [{ artifact, codeRef }],
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

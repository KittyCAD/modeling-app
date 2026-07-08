import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createMemberExpression,
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
  getEdgeTagCall,
  getPrimitiveEdgeSelections,
  insertPrimitiveEdgeVariablesAndOffsetPathToNode,
} from '@src/lang/modifyAst/edges'
import {
  getFacesExprsFromSelection,
  isFaceArtifact,
} from '@src/lang/modifyAst/faces'
import { getAxisExpression } from '@src/lang/modifyAst/geometry'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { addHide } from '@src/lang/modifyAst/transforms'
import {
  getRegionSketchTagExprFromSourceSurface,
  getSketchSegmentName,
  getSketchSegmentNameFromSourceSurface,
  getVariableExprsFromSelection,
  getVariableNameFromNodePath,
  isCallExprWithName,
  valueOrVariable,
} from '@src/lang/queryAst'
import {
  getArtifactOfTypes,
  getSweepArtifactFromSelection,
  getSweepEdgeCodeRef,
} from '@src/lang/std/artifactGraph'
import type {
  Artifact,
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
  KCL_PRELUDE_EXTRUDE_METHOD_NEW,
  type KclPreludeBodyType,
  type KclPreludeExtrudeMethod,
} from '@src/lib/constants'
import {
  isEnginePrimitiveSelection,
  isEngineRegionSelection,
} from '@src/lib/selections'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EnginePrimitiveSelection,
  EngineRegionSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'

function isSweepEdgeProfileSelection(selection: Selection): boolean {
  return selection.artifact?.type === 'sweepEdge'
}

function isGraphEdgeProfileSelection(selection: Selection): boolean {
  return (
    selection.artifact?.type === 'sweepEdge' ||
    selection.artifact?.type === 'primitiveEdge'
  )
}

function isEnginePrimitiveEdgeSelection(
  selection: Selections['otherSelections'][number]
): selection is EnginePrimitiveSelection {
  return (
    isEnginePrimitiveSelection(selection) && selection.primitiveType === 'edge'
  )
}

function hasEdgeProfileSelection(selections: Selections): boolean {
  return (
    selections.graphSelections.some(isGraphEdgeProfileSelection) ||
    selections.otherSelections.some(isEnginePrimitiveEdgeSelection)
  )
}

function getEdgeProfileExprsFromSelection({
  selections,
  modifiedAst,
  artifactGraph,
  wasmInstance,
  nodeToEdit,
}: {
  selections: Selections
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; exprs: Expr[] } {
  const exprs: Expr[] = []
  const edgeSelections = selections.graphSelections.filter(
    isSweepEdgeProfileSelection
  )

  for (const selection of edgeSelections) {
    const edgeArtifact = selection.artifact
    if (!edgeArtifact || edgeArtifact.type !== 'sweepEdge') {
      return new Error('Extrude edge profiles must be sweep edge selections.')
    }

    const sourceSurfaceArtifact = getSweepArtifactFromSelection(
      selection,
      artifactGraph
    )
    if (err(sourceSurfaceArtifact)) return sourceSurfaceArtifact

    const sourceSurfaceVars = getVariableExprsFromSelection(
      {
        graphSelections: [
          {
            artifact: sourceSurfaceArtifact as Artifact,
            codeRef: sourceSurfaceArtifact.codeRef,
          },
        ],
        otherSelections: [],
      },
      artifactGraph,
      modifiedAst,
      wasmInstance,
      nodeToEdit
    )
    if (err(sourceSurfaceVars)) return sourceSurfaceVars
    if (sourceSurfaceVars.exprs.length !== 1) {
      return new Error(
        'Expected exactly one source surface for each selected edge.'
      )
    }
    const sourceSurfaceExpr = sourceSurfaceVars.exprs[0]

    const sketchSegmentName = getSketchSegmentNameFromSourceSurface(
      sourceSurfaceArtifact as Artifact,
      edgeArtifact,
      artifactGraph,
      modifiedAst,
      wasmInstance
    )
    if (sketchSegmentName) {
      const sketchTagExpr = createMemberExpression(
        createMemberExpression(
          createMemberExpression(structuredClone(sourceSurfaceExpr), 'sketch'),
          'tags'
        ),
        sketchSegmentName
      )
      exprs.push(getEdgeTagCall(sketchTagExpr, edgeArtifact))
      continue
    }

    let segmentName = getSketchSegmentName(
      modifiedAst,
      edgeArtifact.segId,
      artifactGraph,
      wasmInstance
    )
    if (!segmentName) {
      const selectedSegment = getArtifactOfTypes(
        { key: edgeArtifact.segId, types: ['segment'] },
        artifactGraph
      )
      if (
        !err(selectedSegment) &&
        selectedSegment.type === 'segment' &&
        selectedSegment.originalSegId
      ) {
        segmentName = getSketchSegmentName(
          modifiedAst,
          selectedSegment.originalSegId,
          artifactGraph,
          wasmInstance
        )
      }
    }
    if (segmentName) {
      const sketchTagExpr = createMemberExpression(
        createMemberExpression(
          createMemberExpression(structuredClone(sourceSurfaceExpr), 'sketch'),
          'tags'
        ),
        segmentName
      )
      exprs.push(getEdgeTagCall(sketchTagExpr, edgeArtifact))
      continue
    }

    const regionSketchTagExpr = getRegionSketchTagExprFromSourceSurface(
      sourceSurfaceArtifact as Artifact,
      edgeArtifact,
      artifactGraph,
      modifiedAst,
      wasmInstance
    )
    if (regionSketchTagExpr) {
      exprs.push(getEdgeTagCall(regionSketchTagExpr, edgeArtifact))
      continue
    }

    const tagResult = modifyAstWithTagsForSelection(
      modifiedAst,
      selection,
      artifactGraph,
      wasmInstance,
      ['oppositeAndAdjacentEdges']
    )
    if (err(tagResult)) return tagResult
    modifiedAst = tagResult.modifiedAst

    if (tagResult.exprs.length !== 1) {
      return new Error("Couldn't retrieve edge profile expression.")
    }

    exprs.push(getEdgeTagCall(tagResult.exprs[0], edgeArtifact))
  }

  const primitiveEdgeSelections = getPrimitiveEdgeSelections(selections)
  if (primitiveEdgeSelections.length > 0) {
    const primitiveEdgeResult = insertPrimitiveEdgeVariablesAndOffsetPathToNode(
      {
        primitiveEdgeSelections,
        bodies: new Map(),
        modifiedAst,
        artifactGraph,
        wasmInstance,
        nodeToEdit,
      }
    )
    if (err(primitiveEdgeResult)) return primitiveEdgeResult

    for (const { tagsExpr } of primitiveEdgeResult.bodies.values()) {
      if (tagsExpr.type === 'ArrayExpression') {
        exprs.push(...tagsExpr.elements)
      } else {
        exprs.push(tagsExpr)
      }
    }
  }

  return { modifiedAst, exprs }
}

export function addExtrude({
  ast,
  artifactGraph,
  sketches,
  wasmInstance,
  length,
  to,
  symmetric,
  direction,
  bidirectionalLength,
  tagStart,
  tagEnd,
  draftAngle,
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
  direction?: Selections
  bidirectionalLength?: KclCommandValue
  tagStart?: string
  tagEnd?: string
  draftAngle?: KclCommandValue
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
  // Map the face and sketch selections into a list of kcl expressions to be passed as unlabelled argument
  const vars: {
    exprs: Expr[]
    pathIfPipe?: PathToNode
  } = { exprs: [] }
  const res = getFacesExprsFromSelection(
    modifiedAst,
    sketches,
    artifactGraph,
    wasmInstance
  )
  if (err(res)) return res
  modifiedAst = res.modifiedAst
  vars.exprs.push(...res.exprs)

  const nonFaceSelections: Selections = {
    graphSelections: sketches.graphSelections.filter(
      (selection) =>
        !isFaceArtifact(selection.artifact) &&
        !isSweepEdgeProfileSelection(selection)
    ),
    otherSelections: sketches.otherSelections.filter(
      (selection) => !isEnginePrimitiveEdgeSelection(selection)
    ),
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

  const edgeProfileExprs = getEdgeProfileExprsFromSelection({
    selections: sketches,
    modifiedAst,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(edgeProfileExprs)) return edgeProfileExprs
  modifiedAst = edgeProfileExprs.modifiedAst
  vars.exprs.push(...edgeProfileExprs.exprs)

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
    const tagResult = modifyAstWithTagsForSelection(
      modifiedAst,
      to.graphSelections[0],
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
  let directionExpr: LabeledArg[] = []
  if (direction) {
    const directionResult = getAxisExpression(
      undefined,
      direction,
      modifiedAst,
      wasmInstance,
      artifactGraph,
      mNodeToEdit
    )
    if (err(directionResult)) return directionResult
    modifiedAst = directionResult.modifiedAst
    directionExpr = [
      createLabeledArg('direction', directionResult.generatedAxis),
    ]
  }
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
  const draftAngleExpr = draftAngle
    ? [createLabeledArg('draftAngle', valueOrVariable(draftAngle))]
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
  const effectiveMethod =
    method ??
    (hasEdgeProfileSelection(sketches)
      ? KCL_PRELUDE_EXTRUDE_METHOD_NEW
      : undefined)
  const methodExpr = effectiveMethod
    ? [createLabeledArg('method', createLocalName(effectiveMethod))]
    : []
  const hideSeamsExpr =
    hideSeams !== undefined
      ? [createLabeledArg('hideSeams', createLiteral(hideSeams, wasmInstance))]
      : []
  const bodyTypeExpr = bodyType
    ? [createLabeledArg('bodyType', createLocalName(bodyType))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Extrude'),
    sketchesExpr,
    [
      ...lengthExpr,
      ...toExpr,
      ...symmetricExpr,
      ...directionExpr,
      ...bidirectionalLengthExpr,
      ...tagStartExpr,
      ...tagEndExpr,
      ...draftAngleExpr,
      ...twistAngleExpr,
      ...twistAngleStepExpr,
      ...twistCenterExpr,
      ...methodExpr,
      ...hideSeamsExpr,
      ...bodyTypeExpr,
    ]
  )

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
  if (draftAngle && 'variableName' in draftAngle && draftAngle.variableName) {
    insertVariableAndOffsetPathToNode(draftAngle, modifiedAst, mNodeToEdit)
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
  const res = getFacesExprsFromSelection(
    modifiedAst,
    sketches,
    artifactGraph,
    wasmInstance
  )
  if (err(res)) return res
  modifiedAst = res.modifiedAst
  vars.exprs.push(...res.exprs)

  const nonFaceSelections: Selections = {
    graphSelections: sketches.graphSelections.filter(
      (selection) => !isFaceArtifact(selection.artifact)
    ),
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

  // Find the path declaration for the labeled argument
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

  // Retrieve axis expression depending on mode
  const getAxisResult = getAxisExpression(
    axis,
    edge,
    modifiedAst,
    wasmInstance,
    artifactGraph
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
            artifact: sketchArtifact,
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
          artifact,
          codeRef: artifact.codeRef,
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

import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import {
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import {
  createPoint2dExpression,
  createVariableExpressionsArray,
  deduplicateFaceExprs,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  modifyAstWithTagForCapFace,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/tagManagement'
import {
  artifactToEntityRef,
  getRegionTagExprFromSegmentId,
  getSelectedPlaneAsNode,
  getVariableExprsFromSelection,
  resolveToCodeRef,
  retrieveSelectionsFromOpArg,
  valueOrVariable,
} from '@src/lang/queryAst'
import {
  getArtifactOfTypes,
  getCapCodeRef,
  getCapForPathId,
  getFaceCodeRef,
} from '@src/lang/std/artifactGraph'
import { addTagToSingletonEdgeCut } from '@src/lang/std/sketchTaggingHelpers'
import {
  type Artifact,
  type ArtifactGraph,
  type CallExpressionKw,
  type Expr,
  type PathToNode,
  type Program,
  type VariableMap,
  formatNumberValue,
} from '@src/lang/wasm'
import type { KclCommandValue, KclExpression } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  getBodySelectionFromPrimitiveParentEntityId,
  getEngineTopologyFallbackNormalized,
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EnginePrimitiveSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'

export function addShell({
  ast,
  artifactGraph,
  faces,
  thickness,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  faces: Selections
  thickness: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
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
  const result = buildSolidsAndFacesExprs(
    faces,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
      artifactTypeFilter: ['sweep', 'compositeSolid'],
    }
  )
  if (err(result)) {
    return result
  }

  let { solidsExprs, facesExprs } = result
  modifiedAst = result.modifiedAst

  const enginePrimitives =
    facesExprs.length === 0
      ? getPrimitiveFaceSelectionsFromSelection(faces)
      : []
  if (enginePrimitives.length > 0) {
    const result = insertFacePrimitiveVariablesAndOffsetPathToNode({
      enginePrimitives,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(result)) return result
    solidsExprs = deduplicateFaceExprs(result.solidsExprs)
    facesExprs.push(...result.faceExprs)
  }

  const solidsExpr = createVariableExpressionsArray(solidsExprs)
  const facesExpr = createVariableExpressionsArray(facesExprs)
  if (!facesExpr) {
    return new Error("Couldn't retrieve face from selection")
  }

  const call = createCallExpressionStdLibKw('shell', solidsExpr, [
    createLabeledArg('faces', facesExpr),
    createLabeledArg('thickness', valueOrVariable(thickness)),
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in thickness && thickness.variableName) {
    insertVariableAndOffsetPathToNode(thickness, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: result.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SHELL,
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

export function addDeleteFace({
  ast,
  artifactGraph,
  faces,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  faces: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // An edgeCut identifies the chamfer/fillet result, but does not retain enough
  // source identity to split a multi-selector operation. Singleton operations
  // can be tagged directly without reconstructing a removed sweepEdge.
  for (const selection of faces.graphSelections) {
    const resolved = resolveToCodeRef(selection, artifactGraph)
    if (resolved?.artifact?.type !== 'edgeCut') continue

    const tagResult = addTagToSingletonEdgeCut(
      {
        node: modifiedAst,
        pathToNode: resolved.artifact.codeRef.pathToNode,
        wasmInstance,
      },
      wasmInstance
    )
    if (err(tagResult)) return tagResult
    modifiedAst = tagResult.modifiedAst
  }

  // 2. Prepare unlabeled and labeled arguments
  const result = buildSolidsAndFacesExprs(
    faces,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
      artifactTypeFilter: ['sweep', 'compositeSolid'],
    }
  )
  if (err(result)) {
    return result
  }

  let { solidsExprs, facesExprs } = result
  modifiedAst = result.modifiedAst

  const enginePrimitives = getPrimitiveFaceSelectionsFromSelection({
    graphSelections: faces.graphSelections.filter(
      (selection) => !resolveToCodeRef(selection, artifactGraph)
    ),
    otherSelections: faces.otherSelections,
  })
  if (enginePrimitives.length > 0) {
    const result = insertFacePrimitiveVariablesAndOffsetPathToNode({
      enginePrimitives,
      modifiedAst,
      artifactGraph,
      wasmInstance,
      useLatestBody: true,
    })
    if (err(result)) return result
    solidsExprs = deduplicateFaceExprs(solidsExprs.concat(result.solidsExprs))

    facesExprs.push(...result.faceExprs)
  }

  const solidsExpr = createVariableExpressionsArray(solidsExprs)
  const facesExpr = createVariableExpressionsArray(facesExprs)
  if (!facesExpr) {
    return new Error("Couldn't retrieve face from selection")
  }

  const call = createCallExpressionStdLibKw('deleteFace', solidsExpr, [
    createLabeledArg('faces', facesExpr),
  ])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: result.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SURFACE,
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

function getPrimitiveFaceSelectionsFromSelection({
  graphSelections,
  otherSelections,
}: Selections): EnginePrimitiveSelection[] {
  const otherPrimitiveFaces = otherSelections.filter(
    (selection): selection is EnginePrimitiveSelection =>
      isEnginePrimitiveSelection(selection) &&
      selection.primitiveType === 'face'
  )

  const graphPrimitiveFaces = graphSelections.flatMap((selection) => {
    const topologyFallback = getEngineTopologyFallbackNormalized(selection)
    if (!topologyFallback) return []

    const entityId =
      selection.engineEntityId ??
      (selection.entityRef?.type === 'face' ? selection.entityRef.face_id : '')
    if (!entityId) return []

    return [
      {
        type: 'enginePrimitive' as const,
        entityId,
        parentEntityId: topologyFallback.parentId,
        primitiveIndex: topologyFallback.primitiveIndex,
        primitiveType: 'face' as const,
      },
    ]
  })

  return [...otherPrimitiveFaces, ...graphPrimitiveFaces]
}

// TODO: figure out if KCL-defined modules like hole could let us derive types
export type HoleBody = 'blind'
export type HoleType = 'simple' | 'counterbore' | 'countersink'
export type HoleBottom = 'flat' | 'drill'

export function addHole({
  ast,
  artifactGraph,
  face,
  cutAt,
  holeBody,
  blindDepth,
  blindDiameter,
  holeType,
  counterboreDepth,
  counterboreDiameter,
  countersinkAngle,
  countersinkDiameter,
  countersinkHeadClearance,
  holeBottom,
  drillPointAngle,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  face: Selections
  cutAt: KclCommandValue
  holeBody: HoleBody
  blindDepth?: KclCommandValue
  blindDiameter?: KclCommandValue
  holeType: HoleType
  counterboreDepth?: KclCommandValue
  counterboreDiameter?: KclCommandValue
  countersinkAngle?: KclCommandValue
  countersinkDiameter?: KclCommandValue
  countersinkHeadClearance?: KclCommandValue
  holeBottom: HoleBottom
  drillPointAngle?: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  // 1. Clone the ast so we can edit it
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  const result = buildSolidsAndFacesExprs(
    face,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
      artifactTypeFilter: ['compositeSolid', 'sweep'],
    }
  )
  if (err(result)) {
    return result
  }

  const { solidsExpr, facesExpr, pathIfPipe } = result
  modifiedAst = result.modifiedAst
  if (!facesExpr) {
    return new Error("Couldn't retrieve face from selection")
  }

  // Extra args for createCallExpressionStdLibKw as we're calling functions from a module
  const nonCodeMeta = undefined
  const modulePath = [createIdentifier('hole')]

  // Prep the big label args
  let holeBodyNode: Node<CallExpressionKw> | undefined
  if (holeBody === 'blind' && blindDepth && blindDiameter) {
    holeBodyNode = createCallExpressionStdLibKw(
      'blind',
      null,
      [
        createLabeledArg('depth', valueOrVariable(blindDepth)),
        createLabeledArg('diameter', valueOrVariable(blindDiameter)),
      ],
      nonCodeMeta,
      modulePath
    )
  } else {
    return new Error('Unsupported hole body type')
  }

  let holeBottomNode: Node<CallExpressionKw> | undefined
  if (holeBottom === 'flat') {
    holeBottomNode = createCallExpressionStdLibKw(
      'flat',
      null,
      [],
      nonCodeMeta,
      modulePath
    )
  } else if (holeBottom === 'drill' && drillPointAngle) {
    holeBottomNode = createCallExpressionStdLibKw(
      'drill',
      null,
      [createLabeledArg('pointAngle', valueOrVariable(drillPointAngle))],
      nonCodeMeta,
      modulePath
    )
  } else {
    return new Error('Unsupported hole bottom type or missing parameters')
  }

  let holeTypeNode: Node<CallExpressionKw> | undefined
  if (holeType === 'simple') {
    holeTypeNode = createCallExpressionStdLibKw(
      'simple',
      null,
      [],
      nonCodeMeta,
      modulePath
    )
  } else if (
    holeType === 'counterbore' &&
    counterboreDepth &&
    counterboreDiameter
  ) {
    holeTypeNode = createCallExpressionStdLibKw(
      'counterbore',
      null,
      [
        createLabeledArg('depth', valueOrVariable(counterboreDepth)),
        createLabeledArg('diameter', valueOrVariable(counterboreDiameter)),
      ],
      nonCodeMeta,
      modulePath
    )
  } else if (
    holeType === 'countersink' &&
    countersinkAngle &&
    countersinkDiameter
  ) {
    const countersinkArgs = [
      createLabeledArg('angle', valueOrVariable(countersinkAngle)),
      createLabeledArg('diameter', valueOrVariable(countersinkDiameter)),
    ]
    if (countersinkHeadClearance) {
      countersinkArgs.push(
        createLabeledArg(
          'headClearance',
          valueOrVariable(countersinkHeadClearance)
        )
      )
    }
    holeTypeNode = createCallExpressionStdLibKw(
      'countersink',
      null,
      countersinkArgs,
      nonCodeMeta,
      modulePath
    )
  } else {
    return new Error('Unsupported hole type or missing parameters')
  }

  let cutAtExpr = createPoint2dExpression(cutAt, wasmInstance)
  if (err(cutAtExpr)) return cutAtExpr

  const call = createCallExpressionStdLibKw(
    'hole',
    solidsExpr,
    [
      createLabeledArg('face', facesExpr),
      createLabeledArg('cutAt', cutAtExpr),
      createLabeledArg('holeBottom', holeBottomNode),
      createLabeledArg('holeBody', holeBodyNode),
      createLabeledArg('holeType', holeTypeNode),
    ],
    nonCodeMeta,
    modulePath
  )

  // Insert variables for labeled arguments if provided
  // Only insert cutAt variable if we used valueOrVariable (not for arrays)
  if (
    !('value' in cutAt && isArray(cutAt.value)) &&
    'variableName' in cutAt &&
    cutAt.variableName
  ) {
    insertVariableAndOffsetPathToNode(cutAt, modifiedAst, mNodeToEdit)
  }
  if (blindDepth && 'variableName' in blindDepth && blindDepth.variableName) {
    insertVariableAndOffsetPathToNode(blindDepth, modifiedAst, mNodeToEdit)
  }
  if (
    blindDiameter &&
    'variableName' in blindDiameter &&
    blindDiameter.variableName
  ) {
    insertVariableAndOffsetPathToNode(blindDiameter, modifiedAst, mNodeToEdit)
  }
  if (
    counterboreDepth &&
    'variableName' in counterboreDepth &&
    counterboreDepth.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      counterboreDepth,
      modifiedAst,
      mNodeToEdit
    )
  }
  if (
    counterboreDiameter &&
    'variableName' in counterboreDiameter &&
    counterboreDiameter.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      counterboreDiameter,
      modifiedAst,
      mNodeToEdit
    )
  }
  if (
    countersinkAngle &&
    'variableName' in countersinkAngle &&
    countersinkAngle.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      countersinkAngle,
      modifiedAst,
      mNodeToEdit
    )
  }
  if (
    countersinkDiameter &&
    'variableName' in countersinkDiameter &&
    countersinkDiameter.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      countersinkDiameter,
      modifiedAst,
      mNodeToEdit
    )
  }
  if (
    countersinkHeadClearance &&
    'variableName' in countersinkHeadClearance &&
    countersinkHeadClearance.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      countersinkHeadClearance,
      modifiedAst,
      mNodeToEdit
    )
  }
  if (
    drillPointAngle &&
    'variableName' in drillPointAngle &&
    drillPointAngle.variableName
  ) {
    insertVariableAndOffsetPathToNode(drillPointAngle, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.HOLE,
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

// Util functions for hole edit flows
export async function retrieveHoleBodyArgs(
  opArg: OpArg | undefined,
  instance: ModuleType,
  providedRustContext?: RustContext
) {
  let holeBody: HoleBody | undefined
  let blindDepth: KclExpression | undefined
  let blindDiameter: KclExpression | undefined
  if (opArg?.value.type !== 'Object') {
    return new Error("Couldn't retrieve hole body arguments as an object")
  }

  const opArgValue = opArg.value.value
  if (
    'blindDepth' in opArgValue &&
    opArgValue.blindDepth?.type === 'Number' &&
    'diameter' in opArgValue &&
    opArgValue.diameter?.type === 'Number'
  ) {
    holeBody = 'blind'
    const depthStr = formatNumberValue(
      opArgValue.blindDepth.value,
      opArgValue.blindDepth.ty,
      instance
    )
    if (err(depthStr)) return depthStr
    const depthResult = await stringToKclExpression(
      depthStr,
      providedRustContext!
    )
    if (err(depthResult) || 'errors' in depthResult) {
      return new Error("Couldn't retrieve blindDepth argument")
    }
    blindDepth = depthResult

    const diameterStr = formatNumberValue(
      opArgValue.diameter.value,
      opArgValue.diameter.ty,
      instance
    )
    if (err(diameterStr)) return diameterStr
    const diameterResult = await stringToKclExpression(
      diameterStr,
      providedRustContext!
    )
    if (err(diameterResult) || 'errors' in diameterResult) {
      return new Error("Couldn't retrieve diameter argument")
    }
    blindDiameter = diameterResult
  } else {
    return new Error(
      "Couldn't retrieve hole body arguments: couldn't determine type"
    )
  }

  return { holeBody, blindDepth, blindDiameter }
}

export async function retrieveHoleBottomArgs(
  opArg: OpArg | undefined,
  instance: ModuleType,
  providedRustContext?: RustContext
) {
  let holeBottom: HoleBottom | undefined
  let drillPointAngle: KclExpression | undefined
  if (opArg?.value.type !== 'Object') {
    return new Error("Couldn't retrieve hole bottom arguments as an object")
  }

  const opArgValue = opArg.value.value
  if (
    'drillBitAngle' in opArgValue &&
    opArgValue.drillBitAngle?.type === 'Number'
  ) {
    if (opArgValue.drillBitAngle.value === 180) {
      holeBottom = 'flat'
    } else {
      holeBottom = 'drill'
      const angleStr = formatNumberValue(
        opArgValue.drillBitAngle.value,
        opArgValue.drillBitAngle.ty,
        instance
      )
      if (err(angleStr)) return angleStr
      const angleResult = await stringToKclExpression(
        angleStr,
        providedRustContext!
      )
      if (err(angleResult) || 'errors' in angleResult) {
        return new Error("Couldn't retrieve drillBitAngle argument")
      }
      drillPointAngle = angleResult
    }
  } else {
    return new Error(
      "Couldn't retrieve holeBottom argument: couldn't determine type"
    )
  }

  return { holeBottom, drillPointAngle }
}

export async function retrieveHoleTypeArgs(
  opArg: OpArg | undefined,
  instance: ModuleType,
  providedRustContext?: RustContext
) {
  let holeType: HoleType | undefined
  let counterboreDepth: KclExpression | undefined
  let counterboreDiameter: KclExpression | undefined
  let countersinkAngle: KclExpression | undefined
  let countersinkDiameter: KclExpression | undefined
  let countersinkHeadClearance: KclExpression | undefined
  if (opArg?.value.type !== 'Object') {
    return new Error("Couldn't retrieve hole bottom arguments as an object")
  }

  const holeTypeValue = opArg.value.value
  // TODO: figure out if we could pull types out of KCL-defined modules?
  // https://github.com/KittyCAD/modeling-app/blob/2666d89427c3350ededccb055ee0b2eceec12d4d/rust/kcl-lib/std/hole.kcl#L8-L10
  const holeTypeSimpleFeatureId = 0
  const holeTypeCounterboreFeatureId = 1
  const holeTypeCountersinkFeatureId = 2
  if (
    !('feature' in holeTypeValue && holeTypeValue.feature?.type === 'Number')
  ) {
    return new Error(
      "Couldn't retrieve holeType argument: couldn't determine type"
    )
  }

  const feature = holeTypeValue.feature.value
  if (feature === holeTypeSimpleFeatureId) {
    holeType = 'simple'
  } else if (
    feature === holeTypeCounterboreFeatureId &&
    'depth' in holeTypeValue &&
    holeTypeValue.depth?.type === 'Number' &&
    'diameter' in holeTypeValue &&
    holeTypeValue.diameter?.type === 'Number'
  ) {
    holeType = 'counterbore'
    const depthStr = formatNumberValue(
      holeTypeValue.depth.value,
      holeTypeValue.depth.ty,
      instance
    )
    if (err(depthStr)) return depthStr
    const depthResult = await stringToKclExpression(
      depthStr,
      providedRustContext!
    )
    if (err(depthResult) || 'errors' in depthResult) {
      return new Error("Couldn't retrieve depth argument")
    }
    counterboreDepth = depthResult

    const diameterStr = formatNumberValue(
      holeTypeValue.diameter.value,
      holeTypeValue.diameter.ty,
      instance
    )
    if (err(diameterStr)) return diameterStr
    const diameterResult = await stringToKclExpression(
      diameterStr,
      providedRustContext!
    )
    if (err(diameterResult) || 'errors' in diameterResult) {
      return new Error("Couldn't retrieve counterboreDiameter argument")
    }
    counterboreDiameter = diameterResult
  } else if (
    feature === holeTypeCountersinkFeatureId &&
    'angle' in holeTypeValue &&
    holeTypeValue.angle?.type === 'Number' &&
    'diameter' in holeTypeValue &&
    holeTypeValue.diameter?.type === 'Number'
  ) {
    holeType = 'countersink'
    const angleStr = formatNumberValue(
      holeTypeValue.angle.value,
      holeTypeValue.angle.ty,
      instance
    )
    if (err(angleStr)) return angleStr
    const angleResult = await stringToKclExpression(
      angleStr,
      providedRustContext!
    )
    if (err(angleResult) || 'errors' in angleResult) {
      return new Error("Couldn't retrieve countersinkAngle argument")
    }
    countersinkAngle = angleResult

    const diameterStr = formatNumberValue(
      holeTypeValue.diameter.value,
      holeTypeValue.diameter.ty,
      instance
    )
    if (err(diameterStr)) {
      return new Error("Couldn't format countersinkDiameter argument")
    }
    const diameterResult = await stringToKclExpression(
      diameterStr,
      providedRustContext!
    )
    if (err(diameterResult) || 'errors' in diameterResult) {
      return new Error("Couldn't retrieve countersinkDiameter argument")
    }
    countersinkDiameter = diameterResult

    if ('headClearance' in holeTypeValue) {
      if (holeTypeValue.headClearance?.type !== 'Number') {
        return new Error("Couldn't retrieve countersinkHeadClearance argument")
      }

      const headClearanceStr = formatNumberValue(
        holeTypeValue.headClearance.value,
        holeTypeValue.headClearance.ty,
        instance
      )
      if (err(headClearanceStr)) {
        return new Error("Couldn't format countersinkHeadClearance argument")
      }
      const headClearanceResult = await stringToKclExpression(
        headClearanceStr,
        providedRustContext!
      )
      if (err(headClearanceResult) || 'errors' in headClearanceResult) {
        return new Error("Couldn't retrieve countersinkHeadClearance argument")
      }
      countersinkHeadClearance = headClearanceResult
    }
  } else {
    return new Error(
      "Couldn't retrieve holeType argument: couldn't determine type"
    )
  }

  return {
    holeType,
    counterboreDepth,
    counterboreDiameter,
    countersinkAngle,
    countersinkDiameter,
    countersinkHeadClearance,
  }
}

export function addOffsetPlane({
  ast,
  artifactGraph,
  variables,
  plane,
  offset,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  variables: VariableMap
  plane: Selections
  offset: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
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
  let planeExpr: Expr | undefined
  const hasFaceToOffset = plane.graphSelections.some((sel) => {
    const resolved = resolveToCodeRef(sel, artifactGraph)
    const t = resolved?.artifact?.type
    return t === 'cap' || t === 'wall' || t === 'edgeCut'
  })
  if (hasFaceToOffset) {
    const result = buildSolidsAndFacesExprs(
      plane,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      mNodeToEdit
    )
    if (err(result)) {
      return result
    }

    const { solidsExpr, facesExpr } = result
    modifiedAst = result.modifiedAst
    if (!facesExpr) {
      return new Error("Couldn't retrieve face from selection")
    }

    planeExpr = createCallExpressionStdLibKw('planeOf', solidsExpr, [
      createLabeledArg('face', facesExpr),
    ])
  } else {
    planeExpr = getSelectedPlaneAsNode(plane, variables, wasmInstance)
    if (!planeExpr) {
      return new Error('No plane found in the selection')
    }
  }

  const call = createCallExpressionStdLibKw('offsetPlane', planeExpr, [
    createLabeledArg('offset', valueOrVariable(offset)),
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in offset && offset.variableName) {
    insertVariableAndOffsetPathToNode(offset, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: undefined,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.PLANE,
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

export function getPlaneExprFromSelection({
  ast,
  artifactGraph,
  variables,
  plane,
  wasmInstance,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  variables: VariableMap
  plane: Selections
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; expr: Expr } {
  let modifiedAst = ast
  const enginePrimitives = getPrimitiveFaceSelectionsFromSelection(plane)
  const hasFaceSelection = plane.graphSelections.some((sel) =>
    isFaceArtifact(sel.artifact)
  )

  // Face selections become a named planeOf(...) first. That keeps mirror3d and
  // offsetPlane on the same representation and preserves edit paths when we
  // insert faceId(...) variables before the edited node.
  if (enginePrimitives.length > 0 || hasFaceSelection) {
    const result = buildSolidsAndFacesExprs(
      plane,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      nodeToEdit,
      {
        // Keep lookup aligned with deleteFace so selected parent solids map directly.
        lastChildLookup: false,
        artifactTypeFilter: ['sweep', 'compositeSolid'],
      }
    )
    if (err(result)) {
      return result
    }

    let { solidsExprs, facesExprs } = result
    modifiedAst = result.modifiedAst

    if (enginePrimitives.length > 0) {
      const result = insertFacePrimitiveVariablesAndOffsetPathToNode({
        enginePrimitives,
        modifiedAst,
        artifactGraph,
        wasmInstance,
      })
      if (err(result)) {
        return result
      }
      solidsExprs = deduplicateFaceExprs(solidsExprs.concat(result.solidsExprs))
      facesExprs.push(...result.faceExprs)
    }

    const solidsExpr = createVariableExpressionsArray(solidsExprs)
    const facesExpr = createVariableExpressionsArray(facesExprs)
    if (!facesExpr) {
      return new Error("Couldn't retrieve face from selection")
    }

    const planeOfExpr = createCallExpressionStdLibKw('planeOf', solidsExpr, [
      createLabeledArg('face', facesExpr),
    ])
    const planeVariableName = findUniqueName(
      modifiedAst,
      KCL_DEFAULT_CONSTANT_PREFIXES.PLANE
    )
    const variableIdentifierAst = createLocalName(planeVariableName)
    insertVariableAndOffsetPathToNode(
      {
        valueAst: planeOfExpr,
        valueText: '',
        valueCalculated: '',
        variableName: planeVariableName,
        variableDeclarationAst: createVariableDeclaration(
          planeVariableName,
          planeOfExpr
        ),
        variableIdentifierAst,
        insertIndex:
          nodeToEdit && typeof nodeToEdit[1]?.[0] === 'number'
            ? nodeToEdit[1][0]
            : modifiedAst.body.length,
      },
      modifiedAst,
      nodeToEdit
    )

    return {
      modifiedAst,
      expr: variableIdentifierAst,
    }
  }

  const defaultPlane = plane.otherSelections.find(
    (selection) => typeof selection === 'object' && 'name' in selection
  )
  if (defaultPlane) {
    return {
      modifiedAst,
      expr: createLocalName(defaultPlane.name.toUpperCase()),
    }
  }

  let planeExpr: Expr | undefined = getSelectedPlaneAsNode(
    plane,
    variables,
    wasmInstance
  )
  if (!planeExpr) {
    const planeVars = getVariableExprsFromSelection(
      plane,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      nodeToEdit
    )
    if (!err(planeVars) && planeVars.exprs.length === 1) {
      const [planeVar] = planeVars.exprs
      if (planeVar.type !== 'PipeSubstitution') {
        planeExpr = planeVar
      }
    }
  }
  if (!planeExpr) {
    return new Error('No plane found in the selection')
  }

  return { modifiedAst, expr: planeExpr }
}

// Utilities

export function getFacesExprsFromSelection(
  ast: Node<Program>,
  faces: Selections,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
) {
  let modifiedAst = ast
  const exprs = faces.graphSelections.flatMap((v2Sel) => {
    const resolved = resolveToCodeRef(v2Sel, artifactGraph)
    if (!resolved?.artifact) {
      console.warn('No artifact found for face', v2Sel)
      return []
    }
    let artifact = resolved.artifact
    if (artifact.type === 'path') {
      const capForPath = getCapForPathId(artifact.id, artifactGraph)
      if (err(capForPath)) return []
      artifact = capForPath
    }
    if (artifact.type === 'cap') {
      // Add tagEnd/tagStart to the extrude and use that tag instead of END/START
      const tagResult = modifyAstWithTagForCapFace(
        modifiedAst,
        artifact,
        artifactGraph,
        wasmInstance
      )
      if (err(tagResult)) {
        console.warn('Failed to add cap tag to extrude', tagResult)
        return []
      }
      modifiedAst = tagResult.modifiedAst
      return [createLocalName(tagResult.tag)]
    } else if (artifact.type === 'wall' || artifact.type === 'edgeCut') {
      let targetArtifact: Artifact | undefined
      if (artifact.type === 'wall') {
        const key = artifact.segId
        const segmentArtifact = getArtifactOfTypes(
          { key, types: ['segment'] },
          artifactGraph
        )
        if (err(segmentArtifact) || segmentArtifact.type !== 'segment') {
          console.warn('No segment found for face', v2Sel)
          return []
        }

        const regionTagExpr = getRegionTagExprFromSegmentId(
          modifiedAst,
          segmentArtifact.id,
          artifactGraph,
          wasmInstance
        )
        if (regionTagExpr) {
          return [regionTagExpr]
        }

        if (segmentArtifact.originalSegId) {
          const originalSegmentArtifact = getArtifactOfTypes(
            { key: segmentArtifact.originalSegId, types: ['segment'] },
            artifactGraph
          )
          targetArtifact = err(originalSegmentArtifact)
            ? segmentArtifact
            : originalSegmentArtifact
        } else {
          targetArtifact = segmentArtifact
        }
      } else {
        targetArtifact = artifact
      }

      const codeRef =
        targetArtifact && 'codeRef' in targetArtifact
          ? targetArtifact.codeRef
          : undefined
      if (!codeRef) {
        console.warn('No codeRef for target artifact')
        return []
      }
      const tagResult =
        targetArtifact?.type === 'edgeCut'
          ? addTagToSingletonEdgeCut(
              {
                node: modifiedAst,
                pathToNode: codeRef.pathToNode,
                wasmInstance,
              },
              wasmInstance
            )
          : mutateAstWithTagForSketchSegment(
              ast,
              codeRef.pathToNode,
              wasmInstance
            )
      if (err(tagResult)) {
        console.warn(
          'Failed to mutate ast with tag for sketch segment',
          tagResult
        )
        return []
      }

      return [createLocalName(tagResult.tag)]
    } else {
      console.warn('Face was not a cap or wall or chamfer', v2Sel)
      return []
    }
  })
  return { modifiedAst, exprs }
}

// Check if an artifact is a face type (cap, wall, or edgeCut)
export function isFaceArtifact(artifact: Artifact | undefined): boolean {
  return (
    artifact !== undefined &&
    (artifact.type === 'cap' ||
      artifact.type === 'wall' ||
      artifact.type === 'edgeCut')
  )
}

// Sort of an opposite of getFacesExprsFromSelection above, used for edit flows
export function retrieveFaceSelectionsFromOpArgs(
  solidsArg: OpArg,
  facesArg: OpArg,
  artifactGraph: ArtifactGraph
) {
  const solids = retrieveSelectionsFromOpArg(solidsArg, artifactGraph)
  if (err(solids)) {
    return solids
  }

  // Collect sweep IDs from all solids (shell can have multiple solids e.g. [thing1, thing2])
  const sweepIdsSet = new Set<string>()
  for (const sel of solids.graphSelections) {
    const resolved = resolveToCodeRef(sel, artifactGraph)
    const artifact = resolved?.artifact
    if (artifact?.type === 'sweep') {
      sweepIdsSet.add(artifact.id)
    }
  }
  if (sweepIdsSet.size === 0) {
    return new Error('No sweep artifact found in solids selection')
  }
  const candidates = new Map<
    string,
    {
      artifact: Artifact
      codeRef: { pathToNode: PathToNode; range: [number, number, number] }
    }
  >()
  for (const artifact of artifactGraph.values()) {
    if (
      artifact.type === 'cap' &&
      sweepIdsSet.has(artifact.sweepId) &&
      artifact.subType
    ) {
      const codeRef = getCapCodeRef(artifact, artifactGraph)
      if (err(codeRef)) {
        return codeRef
      }

      const entry = { artifact, codeRef }
      candidates.set(artifact.subType, entry)
      candidates.set(artifact.id, entry)
    } else if (
      artifact.type === 'wall' &&
      sweepIdsSet.has(artifact.sweepId) &&
      artifact.segId
    ) {
      const segArtifact = getArtifactOfTypes(
        { key: artifact.segId, types: ['segment'] },
        artifactGraph
      )
      if (err(segArtifact)) {
        return segArtifact
      }

      const { codeRef } = segArtifact
      const entry = { artifact, codeRef }
      candidates.set(artifact.segId, entry)
      candidates.set(artifact.id, entry)
    }
  }

  const faceValues: OpKclValue[] = []
  if (facesArg.value.type === 'Array') {
    faceValues.push(...facesArg.value.value)
  } else {
    faceValues.push(facesArg.value)
  }
  const graphSelections: Selection[] = []
  for (const v of faceValues) {
    if (v.type === 'String' && v.value && candidates.has(v.value)) {
      const result = candidates.get(v.value)
      if (result) {
        graphSelections.push({
          entityRef: artifactToEntityRef(
            result.artifact.type,
            result.artifact.id
          ),
          codeRef: result.codeRef,
        })
      } else {
        console.warn(
          'retrieveFaceSelectionsFromOpArgs result is missing and not a selection'
        )
      }
    } else if (
      v.type === 'TagIdentifier' &&
      v.artifact_id &&
      candidates.has(v.artifact_id)
    ) {
      const result = candidates.get(v.artifact_id)
      if (result) {
        graphSelections.push({
          entityRef: artifactToEntityRef(
            result.artifact.type,
            result.artifact.id
          ),
          codeRef: result.codeRef,
        })
      } else {
        console.warn(
          'retrieveFaceSelectionsFromOpArgs result from artifact_id is missing and not a selection',
          {
            artifact_id: v.artifact_id,
            candidatesKeys: [...candidates.keys()],
          }
        )
      }
    } else {
      console.warn('Face value is not a String or TagIdentifier', v, {
        type: v.type,
        ...(v.type === 'TagIdentifier' && {
          artifact_id: v.artifact_id,
          inCandidates: v.artifact_id != null && candidates.has(v.artifact_id),
        }),
      })
      continue
    }
  }

  const faces: Selections = {
    graphSelections,
    otherSelections: [],
  }
  return { solids, faces }
}

export function retrieveNonDefaultPlaneSelectionFromOpArg(
  planeArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (planeArg.value.type !== 'Plane') {
    return new Error(
      'Unsupported case for edit flows at the moment, check the KCL code'
    )
  }

  const planeArtifact = getArtifactOfTypes(
    {
      key: planeArg.value.artifact_id,
      types: ['plane', 'planeOfFace'],
    },
    artifactGraph
  )
  if (err(planeArtifact)) {
    return new Error("Couldn't retrieve plane or planeOfFace artifact")
  }

  if (planeArtifact.type === 'plane') {
    return {
      graphSelections: [
        {
          entityRef: artifactToEntityRef('plane', planeArtifact.id),
          codeRef: planeArtifact.codeRef,
        },
      ],
      otherSelections: [],
    }
  } else if (planeArtifact.type === 'planeOfFace') {
    const faceArtifact = getArtifactOfTypes(
      { key: planeArtifact.faceId, types: ['cap', 'wall', 'edgeCut'] },
      artifactGraph
    )
    if (err(faceArtifact)) {
      return new Error("Couldn't retrieve face artifact for planeOfFace")
    }

    const codeRef = getFaceCodeRef(faceArtifact)
    if (!codeRef) {
      return new Error("Couldn't retrieve code reference for face artifact")
    }

    return {
      graphSelections: [
        {
          entityRef: artifactToEntityRef(faceArtifact.type, faceArtifact.id),
          codeRef,
        },
      ],
      otherSelections: [],
    }
  }

  return new Error('Unsupported plane artifact type')
}

export function buildSolidsAndFacesExprs(
  faces: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode,
  options: {
    lastChildLookup?: boolean
    artifactTypeFilter?: Array<Artifact['type']>
  } = {}
) {
  let modifiedAst = structuredClone(ast)
  const { lastChildLookup = true, artifactTypeFilter = ['sweep'] } = options
  // Map the sketches selection into a list of kcl expressions to be passed as unlabeled argument
  const vars = getVariableExprsFromSelection(
    faces,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    nodeToEdit,
    {
      lastChildLookup,
      artifactTypeFilter,
    }
  )
  if (err(vars)) {
    return vars
  }

  const pathIfPipe = vars.pathIfPipe

  const taggedFacesResult = getFacesExprsFromSelection(
    modifiedAst,
    faces,
    artifactGraph,
    wasmInstance
  )
  modifiedAst = taggedFacesResult.modifiedAst
  const taggedFacesExprs = taggedFacesResult.exprs

  const solidsExpr = createVariableExpressionsArray(vars.exprs)
  const facesExpr = createVariableExpressionsArray(taggedFacesExprs)
  return {
    solidsExprs: vars.exprs,
    facesExprs: taggedFacesExprs,
    solidsExpr,
    facesExpr,
    pathIfPipe,
    modifiedAst,
  }
}

// Adds all the faceId calls needed in the AST so we can refer to them,
// keeps track of their names as faces,
// and gathers the corresponding solid expressions.
function insertFacePrimitiveVariablesAndOffsetPathToNode({
  enginePrimitives,
  modifiedAst,
  artifactGraph,
  wasmInstance,
  useLatestBody = false,
}: {
  enginePrimitives: EnginePrimitiveSelection[]
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
  useLatestBody?: boolean
}): Error | { solidsExprs: Expr[]; faceExprs: Expr[] } {
  if (enginePrimitives.length === 0) {
    return { solidsExprs: [], faceExprs: [] }
  }

  const dedupedSelections = [
    ...new Map(
      enginePrimitives
        .filter((selection) => selection.primitiveType === 'face')
        .map((selection) => [
          `${selection.parentEntityId || ''}:${selection.primitiveIndex}`,
          selection,
        ])
    ).values(),
  ]

  let insertIndex = modifiedAst.body.length
  const solidExprs: Expr[] = []
  const faceExprs: Expr[] = []

  for (const primitiveSelection of dedupedSelections) {
    if (!primitiveSelection.parentEntityId) {
      continue
    }

    // Step 1. Retrieve the body
    const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
      primitiveSelection.parentEntityId,
      artifactGraph
    )
    if (!bodySelection) {
      return new Error(
        'Delete Face could not resolve a parent solid for a selected primitive face.'
      )
    }

    const art = bodySelection.artifact
    const pathId =
      art?.type === 'segment' ? (art as { pathId?: string }).pathId : undefined
    const entityRef = artifactToEntityRef(
      art?.type ?? 'sweep',
      art?.id ?? '',
      pathId
    )
    if (!entityRef) {
      return new Error(
        'Delete Face could not build entity ref for body selection.'
      )
    }
    const bodyVars = getVariableExprsFromSelection(
      {
        graphSelections: [{ entityRef, codeRef: bodySelection.codeRef }],
        otherSelections: [],
      },
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      {
        artifactTypeFilter: ['sweep', 'compositeSolid'],
      }
    )
    if (err(bodyVars)) {
      return bodyVars
    }

    let solidExpr = createVariableExpressionsArray(bodyVars.exprs)
    if (solidExpr === null && bodyVars.exprs.length === 1) {
      solidExpr = bodyVars.exprs[0]
    }
    if (!solidExpr) {
      return new Error(
        'Could not resolve selected primitive face bodies in code.'
      )
    }
    const resolvedSolidExpr = useLatestBody
      ? getLatestEdgeCutBodyExpr(solidExpr, modifiedAst)
      : solidExpr
    if (solidExprs.length === 0) {
      solidExprs.push(resolvedSolidExpr)
    }

    // Step 2. Create the faceId call and keep track of the new variable name
    const faceExpr = createCallExpressionStdLibKw(
      'faceId',
      structuredClone(resolvedSolidExpr),
      [
        createLabeledArg(
          'index',
          createLiteral(primitiveSelection.primitiveIndex, wasmInstance)
        ),
      ]
    )
    const faceVariableName = findUniqueName(
      modifiedAst,
      KCL_DEFAULT_CONSTANT_PREFIXES.FACE
    )
    const variableIdentifierAst = createLocalName(faceVariableName)
    insertVariableAndOffsetPathToNode(
      {
        valueAst: faceExpr,
        valueText: '',
        valueCalculated: '',
        variableName: faceVariableName,
        variableDeclarationAst: createVariableDeclaration(
          faceVariableName,
          faceExpr
        ),
        variableIdentifierAst,
        insertIndex,
      },
      modifiedAst
    )
    insertIndex++
    faceExprs.push(variableIdentifierAst)
  }

  return { solidsExprs: solidExprs, faceExprs }
}

function getLatestEdgeCutBodyExpr(
  initialBodyExpr: NonNullable<Expr>,
  ast: Node<Program>
): NonNullable<Expr> {
  if (initialBodyExpr.type !== 'Name') {
    return initialBodyExpr
  }

  const reachableBodyNames = new Set([initialBodyExpr.name.name])
  let latestBodyName = initialBodyExpr.name.name
  // Primitive face metadata identifies the originating solid. Follow the KCL
  // data flow so faceId targets the latest edge treatment that owns that body.
  for (const statement of ast.body) {
    if (
      statement.type !== 'VariableDeclaration' ||
      statement.declaration.init.type !== 'CallExpressionKw'
    ) {
      continue
    }

    const call = statement.declaration.init
    if (
      call.callee.type !== 'Name' ||
      (call.callee.name.name !== 'chamfer' &&
        call.callee.name.name !== 'fillet') ||
      call.unlabeled?.type !== 'Name' ||
      !reachableBodyNames.has(call.unlabeled.name.name)
    ) {
      continue
    }

    const outputName = statement.declaration.id.name
    reachableBodyNames.add(outputName)
    latestBodyName = outputName
  }

  return createLocalName(latestBodyName)
}

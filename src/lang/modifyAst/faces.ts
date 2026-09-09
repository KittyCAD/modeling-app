import { isEnginePrimitiveSelection } from '@src/lang/queryAst'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import {
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
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
  createPrimitiveIndexCallExpression,
  getRootBodyOfInputExpression,
  insertBodyOfVariableAndOffsetPathToNode,
} from '@src/lang/modifyAst/enginePrimitiveReference'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import {
  artifactToEntityRef,
  getNodeFromPath,
  isCallExprWithName,
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
  type VariableDeclaration,
  type VariableMap,
  formatNumberValue,
} from '@src/lang/wasm'
import {
  modelingStdLibCall,
  modelingStdLibCommandName,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue, KclExpression } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  getBodySelectionFromPrimitiveParentEntityId,
  getEnginePrimitiveSelectionFromSelection,
  getKclBodyIdFromEnginePrimitiveSelection,
  TOPOLOGY_BODY_ARTIFACT_TYPES,
} from '@src/lib/primitiveBodySelection'
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
  let solidsExpr: Expr | null = null
  let facesExpr: Expr | null = null
  let pathIfPipe: PathToNode | undefined
  if (!mNodeToEdit) {
    const result = buildSolidsAndFacesExprs(
      faces,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
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
    pathIfPipe = result.pathIfPipe

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
      })
      if (err(result)) return result
      solidsExprs = deduplicateFaceExprs(solidsExprs.concat(result.solidsExprs))
      facesExprs.push(...result.faceExprs)
    }

    solidsExpr = createVariableExpressionsArray(solidsExprs)
    facesExpr = createVariableExpressionsArray(facesExprs)
    if (!facesExpr) {
      return new Error("Couldn't retrieve face from selection")
    }
  }

  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Shell'),
    solidsExpr,
    [
      ...(facesExpr ? [createLabeledArg('faces', facesExpr)] : []),
      createLabeledArg('thickness', valueOrVariable(thickness)),
    ]
  )

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
    pathIfNewPipe: pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SHELL,
    labeledSelectionArgNames: ['faces'],
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

  if (mNodeToEdit) {
    const call = createCallExpressionStdLibKw(
      modelingStdLibCommandName('Delete Face'),
      null,
      []
    )
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call,
      pathToEdit: mNodeToEdit,
      labeledSelectionArgNames: ['faces'],
      wasmInstance,
    })
    if (err(pathToNode)) return pathToNode
    return { modifiedAst, pathToNode }
  }

  // Edge-reference cuts carry a selector index and are split while producing
  // the face expression below. Older edge cuts can only be tagged as a whole.
  for (const selection of faces.graphSelections) {
    const resolved = resolveToCodeRef(selection, artifactGraph)
    if (resolved?.artifact?.type !== 'edgeCut') continue
    if (resolved.artifact.sourceSelectorIndex != null) continue

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
    undefined,
    {
      lastChildLookup: true,
      artifactTypeFilter: [...TOPOLOGY_BODY_ARTIFACT_TYPES, 'edgeCut'],
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
    solidsExprs = deduplicateFaceExprs(
      solidsExprs.concat(result.rootSolidExprs)
    )

    facesExprs.push(...result.faceExprs)
  }

  const solidsExpr = createVariableExpressionsArray(solidsExprs)
  const facesExpr = createVariableExpressionsArray(facesExprs)
  if (!facesExpr) {
    return new Error("Couldn't retrieve face from selection")
  }

  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Delete Face'),
    solidsExpr,
    [createLabeledArg('faces', facesExpr)]
  )

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: result.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SURFACE,
    labeledSelectionArgNames: ['faces'],
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
    const primitive = getEnginePrimitiveSelectionFromSelection(selection)
    return primitive?.primitiveType === 'face' ? [primitive] : []
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
  let solidsExpr: Expr | null = null
  let facesExpr: Expr | null = null
  let pathIfPipe: PathToNode | undefined
  if (!mNodeToEdit) {
    const result = buildSolidsAndFacesExprs(
      face,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      undefined,
      {
        lastChildLookup: true,
        artifactTypeFilter: ['compositeSolid', 'sweep'],
      }
    )
    if (err(result)) {
      return result
    }

    solidsExpr = result.solidsExpr
    facesExpr = result.facesExpr
    pathIfPipe = result.pathIfPipe
    modifiedAst = result.modifiedAst
    if (!facesExpr) {
      return new Error("Couldn't retrieve face from selection")
    }
  }

  // Extra args for createCallExpressionStdLibKw as we're calling functions from a module
  const nonCodeMeta = undefined
  const holeCall = modelingStdLibCall('Hole')
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
    holeCall.name,
    solidsExpr,
    [
      ...(facesExpr ? [createLabeledArg('face', facesExpr)] : []),
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
    labeledSelectionArgNames: ['face'],
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
  let planeExpr: Expr | null = null
  if (!mNodeToEdit) {
    const planeResult = getPlaneExprFromSelection({
      ast: modifiedAst,
      artifactGraph,
      variables,
      plane,
      wasmInstance,
    })
    if (err(planeResult)) return planeResult
    modifiedAst = planeResult.modifiedAst
    planeExpr = planeResult.expr
  }

  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Offset plane'),
    planeExpr,
    [createLabeledArg('offset', valueOrVariable(offset))]
  )

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
  const enginePrimitives = getPrimitiveFaceSelectionsFromSelection({
    graphSelections: plane.graphSelections.filter(
      (selection) => !resolveToCodeRef(selection, artifactGraph)
    ),
    otherSelections: plane.otherSelections,
  })
  const hasFaceSelection = plane.graphSelections.some((sel) =>
    isFaceArtifact(resolveToCodeRef(sel, artifactGraph)?.artifact)
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
        artifactTypeFilter: TOPOLOGY_BODY_ARTIFACT_TYPES,
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
        pathToNode: nodeToEdit,
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

function getPrimitiveFaceCall(
  ast: Node<Program>,
  codeRef: NonNullable<Selection['codeRef']>,
  wasmInstance: ModuleType
): Node<CallExpressionKw> | Error {
  const faceNode = getNodeFromPath<
    VariableDeclaration | Node<CallExpressionKw>
  >(
    ast,
    codeRef.pathToNode,
    wasmInstance,
    ['VariableDeclaration', 'CallExpressionKw'],
    false,
    true
  )
  if (err(faceNode)) return faceNode
  const expr =
    faceNode.node.type === 'VariableDeclaration'
      ? faceNode.node.declaration.init
      : faceNode.node
  if (!isCallExprWithName(expr, 'faceId') || !expr.unlabeled) {
    return new Error("Couldn't retrieve solid from primitive face selection")
  }
  return expr
}

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
    if (artifact.type === 'primitiveFace') {
      const faceCall = getPrimitiveFaceCall(
        modifiedAst,
        resolved.codeRef,
        wasmInstance
      )
      if (err(faceCall)) return []
      const variable = getNodeFromPath<VariableDeclaration>(
        modifiedAst,
        resolved.codeRef.pathToNode,
        wasmInstance,
        'VariableDeclaration',
        false,
        true
      )
      if (!err(variable) && variable.node.declaration.init === faceCall) {
        return [createLocalName(variable.node.declaration.id.name)]
      }
      return [structuredClone(faceCall)]
    }
    if (isFaceArtifact(artifact)) {
      const result = modifyAstWithTagsForSelection(
        modifiedAst,
        { ...resolved, artifact },
        artifactGraph,
        wasmInstance
      )
      if (err(result)) {
        console.warn('Failed to generate face reference', result)
        return []
      }
      modifiedAst = result.modifiedAst
      return result.exprs
    } else {
      console.warn('Face was not a cap, wall, or edge cut', v2Sel)
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
      artifact.type === 'edgeCut' ||
      artifact.type === 'primitiveFace')
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

  const sweepIds = solids.graphSelections.flatMap((selection) => {
    const resolved = resolveToCodeRef(selection, artifactGraph)
    return getTargetSweepIdsFromBodyArtifact(resolved?.artifact, artifactGraph)
  })
  if (sweepIds.length === 0) {
    return new Error('No sweep artifact found in solids selection')
  }
  const sweepIdsSet = new Set(sweepIds)
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

function getTargetSweepIdsFromBodyArtifact(
  artifact: Artifact | undefined,
  artifactGraph: ArtifactGraph
): string[] {
  const sweepIds = new Set<string>()
  const visited = new Set<string>()

  const visit = (candidate: Artifact | undefined) => {
    if (!candidate || visited.has(candidate.id)) return
    visited.add(candidate.id)

    if (candidate.type === 'sweep') {
      sweepIds.add(candidate.id)
    } else if (candidate.type === 'path' && candidate.sweepId) {
      const sweep = artifactGraph.get(candidate.sweepId)
      if (sweep?.type === 'sweep') {
        sweepIds.add(sweep.id)
      }
    } else if (candidate.type === 'compositeSolid') {
      candidate.solidIds.forEach((id) => visit(artifactGraph.get(id)))
    }
  }

  visit(artifact)
  return [...sweepIds]
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
    {
      graphSelections: faces.graphSelections.filter(
        (selection) =>
          resolveToCodeRef(selection, artifactGraph)?.artifact?.type !==
          'primitiveFace'
      ),
      otherSelections: [],
    },
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

  const solidsExprs = [...vars.exprs]
  for (const selection of faces.graphSelections) {
    const resolved = resolveToCodeRef(selection, artifactGraph)
    if (resolved?.artifact?.type !== 'primitiveFace') continue
    const faceCall = getPrimitiveFaceCall(
      modifiedAst,
      resolved.codeRef,
      wasmInstance
    )
    if (err(faceCall)) return faceCall
    if (faceCall.unlabeled) {
      solidsExprs.push(
        getRootBodyOfInputExpression(faceCall.unlabeled, modifiedAst)
      )
    }
  }
  const dedupedSolidsExprs = deduplicateFaceExprs(solidsExprs)
  const solidsExpr = createVariableExpressionsArray(dedupedSolidsExprs)
  const facesExpr = createVariableExpressionsArray(taggedFacesExprs)
  return {
    solidsExprs: dedupedSolidsExprs,
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
export function insertFacePrimitiveVariablesAndOffsetPathToNode({
  enginePrimitives,
  modifiedAst,
  artifactGraph,
  wasmInstance,
  pathToNode,
  useLatestBody = false,
}: {
  enginePrimitives: EnginePrimitiveSelection[]
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
  pathToNode?: PathToNode
  useLatestBody?: boolean
}):
  | Error
  | {
      solidsExprs: Expr[]
      rootSolidExprs: Expr[]
      faceExprs: Expr[]
    } {
  if (enginePrimitives.length === 0) {
    return { solidsExprs: [], rootSolidExprs: [], faceExprs: [] }
  }

  const dedupedSelections = [
    ...new Map(
      enginePrimitives
        .filter((selection) => selection.primitiveType === 'face')
        .map((selection) => [
          JSON.stringify([
            getKclBodyIdFromEnginePrimitiveSelection(selection),
            selection.bodyPath ?? [],
            selection.primitiveIndex,
          ]),
          selection,
        ])
    ).values(),
  ]

  let insertIndex =
    pathToNode && typeof pathToNode[1]?.[0] === 'number'
      ? pathToNode[1][0]
      : modifiedAst.body.length
  const solidExprs: Expr[] = []
  const faceExprs: Expr[] = []
  const bodyExprs = new Map<string, Expr>()
  const rootBodyExprs = new Map<string, Expr>()

  for (const primitiveSelection of dedupedSelections) {
    const kclBodyId =
      getKclBodyIdFromEnginePrimitiveSelection(primitiveSelection)
    if (!kclBodyId) {
      continue
    }

    const bodyKey = JSON.stringify([
      kclBodyId,
      primitiveSelection.bodyPath ?? [],
    ])
    let solidExpr = bodyExprs.get(bodyKey)
    if (!solidExpr) {
      // Step 1. Retrieve the root imported geometry or procedural solid.
      const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
        kclBodyId,
        artifactGraph
      )
      if (!bodySelection) {
        return new Error(
          'Could not resolve a parent body for a selected primitive face.'
        )
      }

      const bodyVars = getVariableExprsFromSelection(
        {
          graphSelections: [bodySelection],
          otherSelections: [],
        },
        artifactGraph,
        modifiedAst,
        wasmInstance,
        undefined,
        {
          artifactTypeFilter: TOPOLOGY_BODY_ARTIFACT_TYPES,
        }
      )
      if (err(bodyVars)) {
        return bodyVars
      }

      let resolvedBodyExpr = createVariableExpressionsArray(bodyVars.exprs)
      if (resolvedBodyExpr === null && bodyVars.exprs.length === 1) {
        resolvedBodyExpr = bodyVars.exprs[0]
      }
      if (!resolvedBodyExpr) {
        return new Error(
          'Could not resolve selected primitive face bodies in code.'
        )
      }
      const currentBodyExpr = useLatestBody
        ? getLatestEdgeCutBodyExpr(resolvedBodyExpr, modifiedAst)
        : resolvedBodyExpr
      if (!rootBodyExprs.has(kclBodyId)) {
        rootBodyExprs.set(
          kclBodyId,
          getRootBodyOfInputExpression(currentBodyExpr, modifiedAst)
        )
      }
      const bodyOfResult = insertBodyOfVariableAndOffsetPathToNode({
        bodyExpr: currentBodyExpr,
        bodyPath: primitiveSelection.bodyPath,
        modifiedAst,
        wasmInstance,
        insertIndex,
        pathToNode,
      })
      if (bodyOfResult.inserted) {
        insertIndex++
      }
      const selectedBodyExpr = bodyOfResult.bodyExpr

      solidExpr = selectedBodyExpr
      bodyExprs.set(bodyKey, selectedBodyExpr)
      solidExprs.push(selectedBodyExpr)
    }
    if (!solidExpr) {
      return new Error(
        'Could not resolve selected primitive face body in code.'
      )
    }

    // Step 2. Create the faceId call and keep track of the new variable name
    const faceExpr = createPrimitiveIndexCallExpression(
      'faceId',
      structuredClone(solidExpr),
      primitiveSelection.primitiveIndex,
      wasmInstance
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
      modifiedAst,
      pathToNode
    )
    insertIndex++
    faceExprs.push(variableIdentifierAst)
  }

  return {
    solidsExprs: solidExprs,
    rootSolidExprs: [...rootBodyExprs.values()],
    faceExprs,
  }
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

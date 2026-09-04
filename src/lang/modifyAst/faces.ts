import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { OpArg } from '@rust/kcl-lib/bindings/Operation'
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
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import {
  getNodeFromPath,
  getSelectedPlaneAsNode,
  getVariableExprsFromSelection,
  isCallExprWithName,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getSweepFromSuspectedSweepSurface } from '@src/lang/std/artifactGraph'
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
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EnginePrimitiveSelection,
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
      {
        lastChildLookup: true,
        artifactTypeFilter: ['sweep', 'compositeSolid'],
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
      {
        lastChildLookup: true,
        artifactTypeFilter: ['sweep', 'compositeSolid', 'edgeCut'],
      }
    )
    if (err(result)) {
      return result
    }

    let { solidsExprs, facesExprs } = result
    pathIfPipe = result.pathIfPipe
    modifiedAst = result.modifiedAst

    const enginePrimitives =
      getEnginePrimitiveFaceSelectionsFromSelection(faces)
    if (enginePrimitives.length > 0) {
      const primitiveResult = insertFacePrimitiveVariables({
        enginePrimitives,
        modifiedAst,
        artifactGraph,
        wasmInstance,
      })
      if (err(primitiveResult)) return primitiveResult
      solidsExprs = deduplicateFaceExprs(
        solidsExprs.concat(primitiveResult.solidsExprs)
      )
      facesExprs.push(...primitiveResult.faceExprs)
    }

    solidsExpr = createVariableExpressionsArray(solidsExprs)
    facesExpr = createVariableExpressionsArray(facesExprs)
    if (!facesExpr) {
      return new Error("Couldn't retrieve face from selection")
    }
  }

  const call = createCallExpressionStdLibKw(
    modelingStdLibCommandName('Delete Face'),
    solidsExpr,
    facesExpr ? [createLabeledArg('faces', facesExpr)] : []
  )

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: pathIfPipe,
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
  const modulePath = holeCall.path.map(createIdentifier)

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
    if (err(planeResult)) {
      return planeResult
    }
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
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  variables: VariableMap
  plane: Selections
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; expr: Expr } {
  let modifiedAst = ast
  const enginePrimitives = getEnginePrimitiveFaceSelectionsFromSelection(plane)
  const hasFaceSelection = plane.graphSelections.some((sel) =>
    isFaceArtifact(sel.artifact)
  )

  // Face selections become a named planeOf(...) first so mirror3d and
  // offsetPlane use the same representation.
  if (enginePrimitives.length > 0 || hasFaceSelection) {
    const result = buildSolidsAndFacesExprs(
      plane,
      artifactGraph,
      modifiedAst,
      wasmInstance,
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
      const result = insertFacePrimitiveVariables({
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
        insertIndex: modifiedAst.body.length,
      },
      modifiedAst
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
      wasmInstance
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

function getSolidSelectionsFromFaceSelections(
  faces: Selections,
  artifactGraph: ArtifactGraph
): Selections {
  return {
    graphSelections: faces.graphSelections.flatMap((face) => {
      if (!face.artifact) {
        return []
      }
      if (face.artifact.type === 'edgeCut') {
        return {
          artifact: face.artifact,
          codeRef: face.artifact.codeRef,
        }
      }
      const sweep = getSweepFromSuspectedSweepSurface(
        face.artifact.id,
        artifactGraph
      )
      if (err(sweep) || !sweep) {
        return []
      }

      return {
        artifact: sweep as Artifact,
        codeRef: sweep.codeRef,
      }
    }),
    otherSelections: [],
  }
}

export function getFacesExprsFromSelection(
  ast: Node<Program>,
  faces: Selections,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
) {
  let modifiedAst = structuredClone(ast)
  const exprs: Expr[] = []
  const faceSelections = faces.graphSelections.filter((selection) =>
    isFaceArtifact(selection.artifact)
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
    exprs.push(res.exprs[0])
  }
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

export function buildSolidsAndFacesExprs(
  faces: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  options: {
    lastChildLookup?: boolean
    artifactTypeFilter?: Array<Artifact['type']>
  } = {}
) {
  let modifiedAst = structuredClone(ast)
  const { lastChildLookup = true, artifactTypeFilter = ['sweep'] } = options
  const solids = getSolidSelectionsFromFaceSelections(faces, artifactGraph)
  // Map the sketches selection into a list of kcl expressions to be passed as unlabeled argument
  const vars = getVariableExprsFromSelection(
    solids,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    {
      lastChildLookup,
      artifactTypeFilter,
    }
  )
  if (err(vars)) {
    return vars
  }

  const pathIfPipe = vars.pathIfPipe

  // Build face expressions
  const result = getFacesExprsFromSelection(
    modifiedAst,
    faces,
    artifactGraph,
    wasmInstance
  )
  if (err(result)) return result
  modifiedAst = result.modifiedAst

  const solidsExprs = [...vars.exprs]
  for (const faceSelection of faces.graphSelections) {
    if (faceSelection.artifact?.type !== 'primitiveFace') {
      continue
    }

    const faceNode = getNodeFromPath<
      VariableDeclaration | Node<CallExpressionKw>
    >(
      modifiedAst,
      faceSelection.codeRef.pathToNode,
      wasmInstance,
      ['VariableDeclaration', 'CallExpressionKw'],
      false,
      true
    )
    if (err(faceNode)) {
      return faceNode
    }

    const faceExpr: Expr =
      faceNode.node.type === 'VariableDeclaration'
        ? faceNode.node.declaration.init
        : faceNode.node
    if (!isCallExprWithName(faceExpr, 'faceId') || !faceExpr.unlabeled) {
      return new Error("Couldn't retrieve solid from primitive face selection")
    }
    solidsExprs.push(structuredClone(faceExpr.unlabeled))
  }

  const dedupedSolidsExprs = deduplicateFaceExprs(solidsExprs)
  const solidsExpr = createVariableExpressionsArray(dedupedSolidsExprs)
  const facesExpr = createVariableExpressionsArray(result.exprs)
  return {
    solidsExprs: dedupedSolidsExprs,
    facesExprs: result.exprs,
    solidsExpr,
    facesExpr,
    pathIfPipe,
    modifiedAst,
  }
}

// Adds all the faceId calls needed in the AST so we can refer to them,
// keeps track of their names as faces,
// and gathers the corresponding solid expressions.
function insertFacePrimitiveVariables({
  enginePrimitives,
  modifiedAst,
  artifactGraph,
  wasmInstance,
}: {
  enginePrimitives: EnginePrimitiveSelection[]
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
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

    const bodyVars = getVariableExprsFromSelection(
      {
        graphSelections: [bodySelection],
        otherSelections: [],
      },
      artifactGraph,
      modifiedAst,
      wasmInstance,
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
    if (solidExprs.length === 0) {
      solidExprs.push(solidExpr)
    }

    // Step 2. Create the faceId call and keep track of the new variable name
    const faceExpr = createCallExpressionStdLibKw(
      'faceId',
      structuredClone(solidExpr),
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

function getEnginePrimitiveFaceSelectionsFromSelection(selection: Selections) {
  return selection.otherSelections.filter(
    (s): s is EnginePrimitiveSelection =>
      isEnginePrimitiveSelection(s) && s.primitiveType === 'face'
  )
}

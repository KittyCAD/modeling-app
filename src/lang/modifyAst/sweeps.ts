import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createName,
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
  getSettingsAnnotation,
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
  CallExpressionKw,
  Expr,
  LabeledArg,
  NumericSuffix,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type {
  KclCommandValue,
  KclExpressionWithVariable,
} from '@src/lib/commandTypes'
import {
  KCL_DEFAULT_CONSTANT_PREFIXES,
  type KclPreludeExtrudeMethod,
  type KclPreludeBodyType,
  KCL_PRELUDE_BODY_TYPE_SOLID,
  KCL_PRELUDE_BODY_TYPE_SURFACE,
} from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import {
  getFacesExprsFromSelection,
  isFaceArtifact,
} from '@src/lang/modifyAst/faces'
import { getEdgeTagCall } from '@src/lang/modifyAst/edges'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { toUtf16 } from '@src/lang/errors'

function getSketchVarNameFromRegionSelection(
  selection: Selection,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | Error {
  const getSketchVarNameFromCall = (
    callExpression: CallExpressionKw
  ): string | undefined => {
    const sketchArg = callExpression.arguments[0]?.arg
    if (sketchArg?.type === 'Name' && sketchArg.path.length === 0) {
      return sketchArg.name.name
    }
    return undefined
  }

  const getSketchVarNameFromDeclaration = (
    declaration: VariableDeclaration
  ): string | undefined => {
    const init = declaration.declaration.init
    if (init.type === 'SketchBlock') {
      return declaration.declaration.id.name
    }

    if (init.type === 'CallExpressionKw') {
      if (init.callee.name.name === 'startSketchOn') {
        return declaration.declaration.id.name
      }
      return getSketchVarNameFromCall(init)
    }

    if (init.type === 'PipeExpression') {
      const firstPipeExpression = init.body[0]
      if (
        firstPipeExpression?.type === 'Name' &&
        firstPipeExpression.path.length === 0
      ) {
        return firstPipeExpression.name.name
      }
      if (firstPipeExpression?.type === 'CallExpressionKw') {
        if (firstPipeExpression.callee.name.name === 'startSketchOn') {
          return declaration.declaration.id.name
        }
        const sketchFromFirstPipe =
          getSketchVarNameFromCall(firstPipeExpression)
        if (sketchFromFirstPipe) {
          return sketchFromFirstPipe
        }
      }

      for (const expression of init.body) {
        if (expression.type !== 'CallExpressionKw') {
          continue
        }
        const sketchFromExpression = getSketchVarNameFromCall(expression)
        if (sketchFromExpression) {
          return sketchFromExpression
        }
      }
    }

    return undefined
  }

  const getVariableDeclarationAtOrAbovePath = (
    pathToNode: PathToNode
  ):
    | {
        node: VariableDeclaration
        shallowPath: PathToNode
        deepPath: PathToNode
      }
    | undefined => {
    for (let pathLength = pathToNode.length; pathLength > 0; pathLength--) {
      const maybeDeclaration = getNodeFromPath<VariableDeclaration>(
        ast,
        pathToNode.slice(0, pathLength),
        wasmInstance,
        'VariableDeclaration'
      )
      if (
        !err(maybeDeclaration) &&
        maybeDeclaration.node.type === 'VariableDeclaration'
      ) {
        return maybeDeclaration
      }
    }

    return undefined
  }

  const getTopLevelDeclaration = (
    pathToNode: PathToNode
  ): VariableDeclaration | undefined => {
    const bodyIndex = Number(pathToNode[1]?.[0])
    if (!Number.isInteger(bodyIndex)) {
      return undefined
    }

    const bodyNode = ast.body[bodyIndex]
    if (bodyNode?.type !== 'VariableDeclaration') {
      return undefined
    }

    return bodyNode
  }

  const resolveVarNameFromCodeRef = (
    codeRef: Selection['codeRef']
  ): string | undefined => {
    const candidatePaths: PathToNode[] = [
      codeRef.pathToNode,
      getNodePathFromSourceRange(ast, codeRef.range),
    ].filter((path) => path.length > 0)

    for (const path of candidatePaths) {
      const declarationAtPath = getVariableDeclarationAtOrAbovePath(path)
      if (!declarationAtPath) {
        continue
      }

      const declarationCandidates = [
        getTopLevelDeclaration(declarationAtPath.deepPath),
        declarationAtPath.node,
      ].filter((declaration): declaration is VariableDeclaration =>
        Boolean(declaration)
      )

      for (const declaration of declarationCandidates) {
        const sketchVarName = getSketchVarNameFromDeclaration(declaration)
        if (sketchVarName) {
          return sketchVarName
        }
      }

      // Last-resort fallback: keep going with the top-level declaration if present,
      // otherwise use the nearest variable declaration at the path.
      const topLevelDeclaration = getTopLevelDeclaration(
        declarationAtPath.deepPath
      )
      if (topLevelDeclaration) {
        return topLevelDeclaration.declaration.id.name
      }
      return declarationAtPath.node.declaration.id.name
    }

    return undefined
  }

  const selectionVarName = resolveVarNameFromCodeRef(selection.codeRef)
  if (selectionVarName) {
    return selectionVarName
  }

  if (selection.artifact?.type === 'segment') {
    const path = artifactGraph.get(selection.artifact.pathId)
    if (path?.type === 'path') {
      const pathVarName = resolveVarNameFromCodeRef(path.codeRef)
      if (pathVarName) return pathVarName
    }
  } else if (selection.artifact?.type === 'solid2d') {
    const path = artifactGraph.get(selection.artifact.pathId)
    if (path?.type === 'path') {
      const pathVarName = resolveVarNameFromCodeRef(path.codeRef)
      if (pathVarName) return pathVarName
    }
  } else if (selection.artifact?.type === 'path') {
    const pathVarName = resolveVarNameFromCodeRef(selection.artifact.codeRef)
    if (pathVarName) return pathVarName
  } else if (selection.artifact?.type === 'sketchBlock') {
    const sketchVarName = resolveVarNameFromCodeRef(selection.artifact.codeRef)
    if (sketchVarName) return sketchVarName
  }

  return new Error('Could not resolve sketch variable for region selection')
}

function getRegionExprFromSelection(
  selection: Selection,
  ast: Node<Program>,
  _artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Expr | Error {
  if (!selection.sketchRegion) {
    return new Error('Missing sketch region metadata for selection')
  }

  const sketchVarName = getSketchVarNameFromRegionSelection(
    selection,
    ast,
    _artifactGraph,
    wasmInstance
  )
  if (err(sketchVarName)) {
    return sketchVarName
  }

  const [x, y] = selection.sketchRegion.point
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return new Error('Region point coordinates are invalid')
  }
  const settings = getSettingsAnnotation(ast, wasmInstance)
  if (err(settings)) {
    return settings
  }
  const unitSuffix: NumericSuffix = baseUnitToNumericSuffix(
    settings.defaultLengthUnit
  )

  const regionArgs: LabeledArg[] = [
    createLabeledArg(
      'point',
      createArrayExpression([
        createLiteral(x, wasmInstance, unitSuffix),
        createLiteral(y, wasmInstance, unitSuffix),
      ])
    ),
    createLabeledArg('sketch', createLocalName(sketchVarName)),
  ]

  return createCallExpressionStdLibKw('region', null, regionArgs)
}

function isVariableKclExpression(
  value: unknown
): value is KclExpressionWithVariable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'variableName' in value &&
    typeof value.variableName === 'string'
  )
}

function isKclCommandValue(value: unknown): value is KclCommandValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'valueAst' in value &&
    'valueText' in value &&
    'valueCalculated' in value
  )
}

function getNumericCommandExpr(
  value: unknown,
  argName: string,
  wasmInstance: ModuleType
): Expr | Error {
  if (typeof value === 'number') {
    return createLiteral(value, wasmInstance)
  }
  if (isKclCommandValue(value)) {
    return valueOrVariable(value)
  }

  return new Error(
    `Expected ${argName} to be a KCL expression value or number literal`
  )
}

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
        !selection.sketchRegion && !isFaceArtifact(selection.artifact)
    ),
    otherSelections: sketches.otherSelections,
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

  const sketchRegionSelections = sketches.graphSelections.filter(
    (selection) => selection.sketchRegion
  )
  for (const selection of sketchRegionSelections) {
    const expr = getRegionExprFromSelection(
      selection,
      modifiedAst,
      artifactGraph,
      wasmInstance
    )
    if (err(expr)) {
      return expr
    }
    vars.exprs.push(expr)
  }
  if (sketchRegionSelections.length > 0) {
    // Region selection currently maps to an explicit region(...) value.
    // Avoid trying to append into arbitrary pipes when mixed selection plumbing
    // produced a pipe substitution placeholder.
    vars.pathIfPipe = undefined
    vars.exprs = vars.exprs.filter((expr) => expr.type !== 'PipeSubstitution')
  }

  // Extra labeled args expressions
  let lengthExpr: LabeledArg[] = []
  if (length !== undefined) {
    const lengthValueExpr = getNumericCommandExpr(
      length,
      'length',
      wasmInstance
    )
    if (err(lengthValueExpr)) return lengthValueExpr
    lengthExpr = [createLabeledArg('length', lengthValueExpr)]
  }
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
  let bidirectionalLengthExpr: LabeledArg[] = []
  if (bidirectionalLength !== undefined) {
    const bidirectionalLengthValueExpr = getNumericCommandExpr(
      bidirectionalLength,
      'bidirectionalLength',
      wasmInstance
    )
    if (err(bidirectionalLengthValueExpr)) return bidirectionalLengthValueExpr
    bidirectionalLengthExpr = [
      createLabeledArg('bidirectionalLength', bidirectionalLengthValueExpr),
    ]
  }
  const tagStartExpr = tagStart
    ? [createLabeledArg('tagStart', createTagDeclarator(tagStart))]
    : []
  const tagEndExpr = tagEnd
    ? [createLabeledArg('tagEnd', createTagDeclarator(tagEnd))]
    : []
  let twistAngleExpr: LabeledArg[] = []
  if (twistAngle !== undefined) {
    const twistAngleValueExpr = getNumericCommandExpr(
      twistAngle,
      'twistAngle',
      wasmInstance
    )
    if (err(twistAngleValueExpr)) return twistAngleValueExpr
    twistAngleExpr = [createLabeledArg('twistAngle', twistAngleValueExpr)]
  }
  let twistAngleStepExpr: LabeledArg[] = []
  if (twistAngleStep !== undefined) {
    const twistAngleStepValueExpr = getNumericCommandExpr(
      twistAngleStep,
      'twistAngleStep',
      wasmInstance
    )
    if (err(twistAngleStepValueExpr)) return twistAngleStepValueExpr
    twistAngleStepExpr = [
      createLabeledArg('twistAngleStep', twistAngleStepValueExpr),
    ]
  }
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
  if (isVariableKclExpression(length) && length.variableName) {
    insertVariableAndOffsetPathToNode(length, modifiedAst, mNodeToEdit)
  }
  if (
    isVariableKclExpression(bidirectionalLength) &&
    bidirectionalLength.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      bidirectionalLength,
      modifiedAst,
      mNodeToEdit
    )
  }
  if (isVariableKclExpression(twistAngle) && twistAngle.variableName) {
    insertVariableAndOffsetPathToNode(twistAngle, modifiedAst, mNodeToEdit)
  }
  if (isVariableKclExpression(twistAngleStep) && twistAngleStep.variableName) {
    insertVariableAndOffsetPathToNode(twistAngleStep, modifiedAst, mNodeToEdit)
  }
  if (isVariableKclExpression(twistCenter) && twistCenter.variableName) {
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

  // Retrieve axis expression depending on mode
  const getAxisResult = getAxisExpressionAndIndex(
    axis,
    edge,
    modifiedAst,
    wasmInstance
  )
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
  const bodyTypeExpr = bodyType
    ? [createLabeledArg('bodyType', createLocalName(bodyType))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('revolve', sketchesExpr, [
    createLabeledArg('angle', valueOrVariable(angle)),
    createLabeledArg('axis', getAxisResult.generatedAxis),
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

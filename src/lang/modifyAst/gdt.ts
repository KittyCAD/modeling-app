import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import {
  createPoint2dExpression,
  deduplicateFaceExprs,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  createEdgeRefObjectExpression,
  entityReferenceToEdgeRefPayload,
} from '@src/lang/modifyAst/edges'
import { isFaceArtifact } from '@src/lang/modifyAst/faces'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { resolveToCodeRef, traverse, valueOrVariable } from '@src/lang/queryAst'
import {
  type ResolvedGraphSelection,
  getArtifactOfTypes,
  getCapForPathId,
  getCommonFacesForEdge,
} from '@src/lang/std/artifactGraph'
import type { ArtifactGraph, Expr, PathToNode, Program } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'

export type ProfileGdtFunction = 'profile' | 'profileLine' | 'profileSurface'

function isProfileEdgeArtifact(
  artifact: Selections['graphSelections'][number]['artifact']
): boolean {
  return artifact?.type === 'segment'
}

function resolveSelectionsForTags(
  selections: Selections,
  artifactGraph: ArtifactGraph,
  artifactPredicate: (
    artifact: Selections['graphSelections'][number]['artifact']
  ) => boolean
): ResolvedGraphSelection[] {
  return selections.graphSelections.flatMap((selection) => {
    const resolved = resolveToCodeRef(selection, artifactGraph)
    if (!resolved) return []

    const artifact = artifactPredicate(selection.artifact)
      ? selection.artifact
      : resolved.artifact
    if (!artifactPredicate(artifact)) return []
    return [{ ...resolved, artifact }]
  })
}

function getEdgeRefPayloadFromSelection(
  selection: Selection,
  artifactGraph: ArtifactGraph
): ReturnType<typeof entityReferenceToEdgeRefPayload> | null {
  if (selection.entityRef?.type === 'edge') {
    const payload = entityReferenceToEdgeRefPayload(selection.entityRef)
    const reference = selection.entityRef as {
      side_faces?: string[]
      sideFaces?: string[]
      faces?: string[]
      end_faces?: string[]
      endFaces?: string[]
      index?: number
    }
    return {
      side_faces:
        payload.side_faces ?? reference.sideFaces ?? reference.faces ?? [],
      end_faces: payload.end_faces ?? reference.endFaces,
      index: payload.index ?? reference.index,
    }
  }

  if (selection.artifact?.type === 'segment') {
    const commonFaces = getCommonFacesForEdge(selection.artifact, artifactGraph)
    if (err(commonFaces)) return null

    return {
      side_faces: commonFaces.map((face) => face.id),
    }
  }

  return null
}

function buildGdtEdgeExpressions({
  selections,
  artifactGraph,
  ast,
  wasmInstance,
}: {
  selections: Selections
  artifactGraph: ArtifactGraph
  ast: Node<Program>
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; edgeExprs: Expr[] } {
  let modifiedAst = ast
  const edgeExprs: Expr[] = []

  for (const selection of selections.graphSelections) {
    const payload = getEdgeRefPayloadFromSelection(selection, artifactGraph)
    if (!payload) continue

    const originalEdgeSelection =
      selection.artifact?.type === 'segment'
        ? {
            artifact: selection.artifact,
            codeRef: selection.artifact.codeRef,
          }
        : undefined

    const edgeRefResult = createEdgeRefObjectExpression(
      payload,
      wasmInstance,
      modifiedAst,
      artifactGraph,
      originalEdgeSelection
    )
    if (err(edgeRefResult)) return edgeRefResult

    modifiedAst = edgeRefResult.modifiedAst
    edgeExprs.push(edgeRefResult.expr)
  }

  return { modifiedAst, edgeExprs }
}

function withoutEdgeLikeSelections(selections: Selections): Selections {
  return {
    ...selections,
    graphSelections: selections.graphSelections.filter(
      (selection) =>
        selection.entityRef?.type !== 'edge' &&
        selection.artifact?.type !== 'segment'
    ),
  }
}

function buildGdtFaceAndEdgeExpressions({
  selections,
  artifactGraph,
  ast,
  wasmInstance,
}: {
  selections: Selections
  artifactGraph: ArtifactGraph
  ast: Node<Program>
  wasmInstance: ModuleType
}):
  | Error
  | { modifiedAst: Node<Program>; faceExprs: Expr[]; edgeExprs: Expr[] } {
  let modifiedAst = ast
  const edgeResult = buildGdtEdgeExpressions({
    selections,
    artifactGraph,
    ast: modifiedAst,
    wasmInstance,
  })
  if (err(edgeResult)) return edgeResult
  modifiedAst = edgeResult.modifiedAst

  const faceSelections = resolveSelectionsForTags(
    withoutEdgeLikeSelections(selections),
    artifactGraph,
    isFaceArtifact
  )

  const faceExprs: Expr[] = []
  for (const faceSelection of faceSelections) {
    const tagResult = modifyAstWithTagsForSelection(
      modifiedAst,
      faceSelection,
      artifactGraph,
      wasmInstance
    )
    if (err(tagResult)) {
      console.warn('Failed to add tag for face selection', tagResult)
      continue
    }

    modifiedAst = tagResult.modifiedAst
    faceExprs.push(tagResult.exprs[0])
  }

  return {
    modifiedAst,
    faceExprs,
    edgeExprs: edgeResult.edgeExprs,
  }
}

function buildLegacyGdtEdgeExpressions({
  selections,
  artifactGraph,
  ast,
  wasmInstance,
}: {
  selections: Selections
  artifactGraph: ArtifactGraph
  ast: Node<Program>
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; edgeExprs: Expr[] } {
  let modifiedAst = ast
  const edgeSelections = resolveSelectionsForTags(
    selections,
    artifactGraph,
    isProfileEdgeArtifact
  )
  const edgeExprs: Expr[] = []

  for (const edgeSelection of edgeSelections) {
    const tagResult = modifyAstWithTagsForSelection(
      modifiedAst,
      edgeSelection,
      artifactGraph,
      wasmInstance
    )
    if (err(tagResult)) {
      console.warn('Failed to add tags for edge selection', tagResult)
      continue
    }

    modifiedAst = tagResult.modifiedAst
    if (tagResult.exprs.length < 2) {
      console.warn('Edge selection did not resolve to enough faces', tagResult)
      continue
    }

    edgeExprs.push(
      createCallExpressionStdLibKw('getCommonEdge', null, [
        createLabeledArg('faces', createArrayExpression(tagResult.exprs)),
      ])
    )
  }

  return { modifiedAst, edgeExprs }
}

/**
 * Adds flatness GD&T annotation(s) to the AST.
 * Creates one gdt::flatness call for each selected face.
 * Always adds annotations at the end of the AST body.
 *
 * @param ast - The AST to modify
 * @param artifactGraph - The artifact graph for face lookups
 * @param faces - Selected faces to annotate (only face selections will be used)
 * @param tolerance - The flatness tolerance value (required)
 * @param precision - Number of decimal places to display (optional)
 * @param framePosition - Position of the feature control frame [x, y] (optional)
 * @param framePlane - Plane for displaying the frame (XY, XZ, YZ) (optional)
 * @param leaderScale - Scale of the leader (optional)
 * @param fontSize - Font point size for annotation text (optional)
 * @param fontScale - Scale factor for annotation text (optional)
 * @param nodeToEdit - Path to node to edit (for edit mode)
 * @returns Modified AST and path to the last created node, or an Error
 */
export function addFlatnessGdt({
  ast,
  artifactGraph,
  faces,
  tolerance,
  wasmInstance,
  precision,
  framePosition,
  framePlane,
  leaderScale,
  fontSize,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  faces: Selections
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Clone the AST to avoid mutating the original
  let modifiedAst = structuredClone(ast)

  // Filter to only include face selections (resolve V2 to get artifact).
  // When the engine returns a path id for a cap face (edit flow), resolve path → cap.
  const resolved = faces.graphSelections.map((selV2) => {
    const r = resolveToCodeRef(selV2, artifactGraph)
    if (!r?.artifact) return r
    if (r.artifact.type === 'path') {
      const cap = getCapForPathId(r.artifact.id, artifactGraph)
      if (err(cap)) return r
      return { artifact: cap, codeRef: r.codeRef }
    }
    return r
  })
  const faceSelections = resolved.filter(
    (s): s is NonNullable<typeof s> => s != null && isFaceArtifact(s.artifact)
  )

  if (faceSelections.length === 0) {
    return new Error(
      'No valid face selections found. Please select faces (caps, walls, or edge cuts).'
    )
  }

  // Get face expressions from the selection
  // GDT annotations require tags for unambiguous face references (no body context)
  // We use modifyAstWithTagsForSelection directly to make the tagging explicit
  const facesExprs: Expr[] = []
  for (const faceSelection of faceSelections) {
    const tagResult = modifyAstWithTagsForSelection(
      modifiedAst,
      faceSelection,
      artifactGraph,
      wasmInstance
    )
    if (err(tagResult)) {
      console.warn('Failed to add tag for face selection', tagResult)
      continue
    }

    // Update the AST with the tagged version
    modifiedAst = tagResult.modifiedAst

    // Create expression from the first tag (faces have one tag)
    facesExprs.push(tagResult.exprs[0])
  }

  if (facesExprs.length === 0) {
    return new Error(
      'No valid face expressions could be generated from selection'
    )
  }

  // Deduplicate face expressions based on their string representation
  const uniqueFacesExprs = deduplicateFaceExprs(facesExprs)

  if (uniqueFacesExprs.length === 0) {
    return new Error('No unique faces found after deduplication')
  }

  // Insert variables for tolerance and precision parameters
  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, nodeToEdit)
  }
  if (precision && 'variableName' in precision && precision.variableName) {
    insertVariableAndOffsetPathToNode(precision, modifiedAst, nodeToEdit)
  }

  // Process common GDT style parameters
  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit,
    wasmInstance,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
  })
  if (err(styleResult)) {
    return styleResult
  }

  // Create one gdt::flatness call for each unique face
  let lastPathToNode: PathToNode | undefined

  for (const faceExpr of uniqueFacesExprs) {
    const facesArray = createArrayExpression([faceExpr])

    // Build labeled arguments starting with function-specific parameters
    const labeledArgs = [
      createLabeledArg('faces', facesArray),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    // Add precision if provided
    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    // Add common style parameter labeled arguments
    labeledArgs.push(...styleResult.labeledArgs)

    // Create the gdt::flatness call
    // Using null for unlabeled args since all args are labeled
    const nonCodeMeta = undefined
    const modulePath = [createIdentifier('gdt')]
    const call = createCallExpressionStdLibKw(
      'flatness',
      null,
      labeledArgs,
      nonCodeMeta,
      modulePath
    )

    // Insert the function call into the AST at the appropriate location
    // Using undefined for variableIfNewDecl so it creates an expression statement
    // This ensures GDT annotations are always added at the end
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call,
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined, // GDT annotations don't pipe
      variableIfNewDecl: undefined, // Creates expression statement at the end
      wasmInstance,
    })
    if (err(pathToNode)) {
      return pathToNode
    }

    lastPathToNode = pathToNode
  }

  if (!lastPathToNode) {
    return new Error('Failed to create any gdt::flatness calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

type MixedFaceEdgeGdtParams = {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  datums?: KclCommandValue
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}

function addMixedFaceEdgeGdt(
  functionName: string,
  {
    ast,
    artifactGraph,
    objects,
    datums,
    tolerance,
    wasmInstance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit,
  }: MixedFaceEdgeGdtParams
): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  const expressions = buildGdtFaceAndEdgeExpressions({
    selections: objects,
    artifactGraph,
    ast: modifiedAst,
    wasmInstance,
  })
  if (err(expressions)) return expressions
  modifiedAst = expressions.modifiedAst

  if (
    expressions.faceExprs.length === 0 &&
    expressions.edgeExprs.length === 0
  ) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

  const uniqueFaceExprs = deduplicateFaceExprs(expressions.faceExprs)
  const uniqueEdgeExprs = deduplicateFaceExprs(expressions.edgeExprs)
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  if (datums && 'variableName' in datums && datums.variableName) {
    insertVariableAndOffsetPathToNode(datums, modifiedAst, mNodeToEdit)
  }
  if (precision && 'variableName' in precision && precision.variableName) {
    insertVariableAndOffsetPathToNode(precision, modifiedAst, mNodeToEdit)
  }

  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit: mNodeToEdit,
    wasmInstance,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
  })
  if (err(styleResult)) return styleResult

  let lastPathToNode: PathToNode | undefined
  const createCall = (targetArgName: 'faces' | 'edges', targetExpr: Expr) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (datums) {
      labeledArgs.push(createLabeledArg('datums', valueOrVariable(datums)))
    }

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      functionName,
      null,
      labeledArgs,
      undefined,
      [createIdentifier('gdt')]
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createCall('faces', faceExpr),
      pathToEdit: mNodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) return pathToNode
    lastPathToNode = pathToNode
  }

  for (const edgeExpr of uniqueEdgeExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createCall('edges', edgeExpr),
      pathToEdit: mNodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) return pathToNode
    lastPathToNode = pathToNode
  }

  if (!lastPathToNode) {
    return new Error(`Failed to create any gdt::${functionName} calls`)
  }

  return { modifiedAst, pathToNode: lastPathToNode }
}

export function addStraightnessGdt(
  params: MixedFaceEdgeGdtParams
): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addMixedFaceEdgeGdt('straightness', params)
}

export function addCircularityGdt(
  params: MixedFaceEdgeGdtParams
): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addMixedFaceEdgeGdt('circularity', params)
}

export function addCylindricityGdt(
  params: MixedFaceEdgeGdtParams
): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addMixedFaceEdgeGdt('cylindricity', params)
}

export function addAngularityGdt(
  params: MixedFaceEdgeGdtParams
): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addMixedFaceEdgeGdt('angularity', params)
}

export function addConcentricityGdt(
  params: MixedFaceEdgeGdtParams
): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addMixedFaceEdgeGdt('concentricity', params)
}

export function addSymmetryGdt(
  params: MixedFaceEdgeGdtParams
): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addMixedFaceEdgeGdt('symmetry', params)
}

export function addRunoutGdt(
  params: MixedFaceEdgeGdtParams
): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addMixedFaceEdgeGdt('runout', params)
}

export function addPositionGdt({
  ast,
  artifactGraph,
  objects,
  datums,
  tolerance,
  wasmInstance,
  precision,
  framePosition,
  framePlane,
  leaderScale,
  fontSize,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  datums?: KclCommandValue
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  const expressions = buildGdtFaceAndEdgeExpressions({
    selections: objects,
    artifactGraph,
    ast: modifiedAst,
    wasmInstance,
  })
  if (err(expressions)) return expressions
  modifiedAst = expressions.modifiedAst

  if (
    expressions.faceExprs.length === 0 &&
    expressions.edgeExprs.length === 0
  ) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

  const uniqueFaceExprs = deduplicateFaceExprs(expressions.faceExprs)
  const uniqueEdgeExprs = deduplicateFaceExprs(expressions.edgeExprs)
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  if (datums && 'variableName' in datums && datums.variableName) {
    insertVariableAndOffsetPathToNode(datums, modifiedAst, mNodeToEdit)
  }
  if (precision && 'variableName' in precision && precision.variableName) {
    insertVariableAndOffsetPathToNode(precision, modifiedAst, mNodeToEdit)
  }

  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit: mNodeToEdit,
    wasmInstance,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
  })
  if (err(styleResult)) return styleResult

  let lastPathToNode: PathToNode | undefined
  const createPositionCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (datums) {
      labeledArgs.push(createLabeledArg('datums', valueOrVariable(datums)))
    }

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      'position',
      null,
      labeledArgs,
      undefined,
      [createIdentifier('gdt')]
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createPositionCall('faces', faceExpr),
      pathToEdit: mNodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) {
      return pathToNode
    }
    lastPathToNode = pathToNode
  }

  for (const edgeExpr of uniqueEdgeExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createPositionCall('edges', edgeExpr),
      pathToEdit: mNodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) {
      return pathToNode
    }
    lastPathToNode = pathToNode
  }

  if (!lastPathToNode) {
    return new Error('Failed to create any gdt::position calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

export function addProfileGdt({
  ast,
  artifactGraph,
  objects,
  edges,
  faces,
  datums,
  tolerance,
  wasmInstance,
  precision,
  framePosition,
  framePlane,
  leaderScale,
  fontSize,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects?: Selections
  edges?: Selections
  faces?: Selections
  datums?: string | KclCommandValue
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)
  const selections = objects ?? edges ?? faces

  if (!selections) {
    return new Error(
      'No selections found. Please select faces or edges for profile.'
    )
  }

  const expressions = buildGdtFaceAndEdgeExpressions({
    selections,
    artifactGraph,
    ast: modifiedAst,
    wasmInstance,
  })
  if (err(expressions)) return expressions

  if (expressions.faceExprs.length > 0 && expressions.edgeExprs.length > 0) {
    return new Error(
      'Profile requires either faces or edges, not both. Select faces for profileSurface or edges for profileLine.'
    )
  }

  modifiedAst = expressions.modifiedAst

  if (
    expressions.faceExprs.length === 0 &&
    expressions.edgeExprs.length === 0
  ) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

  const uniqueFaceExprs = deduplicateFaceExprs(expressions.faceExprs)
  const uniqueEdgeExprs = deduplicateFaceExprs(expressions.edgeExprs)
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid profile expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, nodeToEdit)
  }
  if (
    datums &&
    typeof datums !== 'string' &&
    'variableName' in datums &&
    datums.variableName
  ) {
    insertVariableAndOffsetPathToNode(datums, modifiedAst, nodeToEdit)
  }
  if (precision && 'variableName' in precision && precision.variableName) {
    insertVariableAndOffsetPathToNode(precision, modifiedAst, nodeToEdit)
  }

  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit,
    wasmInstance,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
  })
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const createProfileCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    const datumsArg = createOptionalDatumsArg(datums, wasmInstance)
    if (datumsArg) labeledArgs.push(datumsArg)

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      nodeToEdit
        ? 'profile'
        : targetArgName === 'faces'
          ? 'profileSurface'
          : 'profileLine',
      null,
      labeledArgs,
      undefined,
      [createIdentifier('gdt')]
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createProfileCall('faces', faceExpr),
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) return pathToNode
    lastPathToNode = pathToNode
  }

  for (const edgeExpr of uniqueEdgeExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createProfileCall('edges', edgeExpr),
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) return pathToNode
    lastPathToNode = pathToNode
  }

  if (!lastPathToNode) {
    return new Error('Failed to create any gdt::profile calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

export function addDistanceGdt({
  ast,
  artifactGraph,
  objects,
  edges,
  tolerance,
  wasmInstance,
  precision,
  framePosition,
  framePlane,
  leaderScale,
  fontSize,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects?: Selections
  edges?: Selections
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)
  const selections = objects ?? edges

  if (!selections) {
    return new Error(
      'No selections found. Select one edge for an edge length, or exactly two faces or edges for a distance.'
    )
  }

  const expressions = buildGdtFaceAndEdgeExpressions({
    selections,
    artifactGraph,
    ast: modifiedAst,
    wasmInstance,
  })
  if (err(expressions)) return expressions
  modifiedAst = expressions.modifiedAst

  if (
    expressions.faceExprs.length === 0 &&
    expressions.edgeExprs.length === 0
  ) {
    return new Error(
      'No valid selections found. Select one edge, or exactly two faces or edges.'
    )
  }

  const targetCount =
    expressions.faceExprs.length + expressions.edgeExprs.length
  let distanceEdgeExprs = expressions.edgeExprs
  if (targetCount === 2 && expressions.edgeExprs.length > 0) {
    const legacyEdgeResult = buildLegacyGdtEdgeExpressions({
      selections,
      artifactGraph,
      ast: modifiedAst,
      wasmInstance,
    })
    if (err(legacyEdgeResult)) return legacyEdgeResult
    modifiedAst = legacyEdgeResult.modifiedAst
    distanceEdgeExprs = legacyEdgeResult.edgeExprs
  }

  const targets: Array<{ kind: 'face' | 'edge'; expr: Expr }> = [
    ...expressions.faceExprs.map((expr) => ({ kind: 'face' as const, expr })),
    ...distanceEdgeExprs.map((expr) => ({ kind: 'edge' as const, expr })),
  ]

  if (targets.length === 0) {
    return new Error('No valid distance targets could be generated')
  }

  if (targets.length === 1 && targets[0].kind !== 'edge') {
    return new Error(
      'A single distance selection must be an edge. Select two faces or edges to measure between entities.'
    )
  }

  const allTargetsAreEdges = targets.every((target) => target.kind === 'edge')

  if (targets.length > 2 && !allTargetsAreEdges) {
    return new Error(
      'Select one or more edges for edge lengths, or exactly two faces or edges for a distance.'
    )
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, nodeToEdit)
  }
  if (precision && 'variableName' in precision && precision.variableName) {
    insertVariableAndOffsetPathToNode(precision, modifiedAst, nodeToEdit)
  }

  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit,
    wasmInstance,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
  })
  if (err(styleResult)) {
    return styleResult
  }

  const edgeLengthExprs =
    targets.length === 1 || targets.length > 2
      ? deduplicateFaceExprs(targets.map((target) => target.expr))
      : []

  if (
    (targets.length === 1 || targets.length > 2) &&
    edgeLengthExprs.length === 0
  ) {
    return new Error('No valid edge expressions could be generated')
  }

  const labeledArgs =
    edgeLengthExprs.length > 0
      ? [
          createLabeledArg('edges', createArrayExpression(edgeLengthExprs)),
          createLabeledArg('tolerance', valueOrVariable(tolerance)),
        ]
      : [
          createLabeledArg('from', targets[0].expr),
          createLabeledArg('to', targets[1].expr),
          createLabeledArg('tolerance', valueOrVariable(tolerance)),
        ]

  if (precision !== undefined) {
    labeledArgs.push(createLabeledArg('precision', valueOrVariable(precision)))
  }

  labeledArgs.push(...styleResult.labeledArgs)

  const call = createCallExpressionStdLibKw(
    'distance',
    null,
    labeledArgs,
    undefined,
    [createIdentifier('gdt')]
  )

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
    pathIfNewPipe: undefined,
    variableIfNewDecl: undefined,
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

export function addPerpendicularityGdt({
  ast,
  artifactGraph,
  objects,
  datums,
  tolerance,
  wasmInstance,
  precision,
  framePosition,
  framePlane,
  leaderScale,
  fontSize,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  datums?: string | KclCommandValue
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)

  const expressions = buildGdtFaceAndEdgeExpressions({
    selections: objects,
    artifactGraph,
    ast: modifiedAst,
    wasmInstance,
  })
  if (err(expressions)) return expressions
  modifiedAst = expressions.modifiedAst

  if (
    expressions.faceExprs.length === 0 &&
    expressions.edgeExprs.length === 0
  ) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

  const uniqueFaceExprs = deduplicateFaceExprs(expressions.faceExprs)
  const uniqueEdgeExprs = deduplicateFaceExprs(expressions.edgeExprs)
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, nodeToEdit)
  }
  if (precision && 'variableName' in precision && precision.variableName) {
    insertVariableAndOffsetPathToNode(precision, modifiedAst, nodeToEdit)
  }

  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit,
    wasmInstance,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
  })
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined

  const createPerpendicularityCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    const datumsArg = createOptionalDatumsArg(datums, wasmInstance)
    if (datumsArg) labeledArgs.push(datumsArg)

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      'perpendicularity',
      null,
      labeledArgs,
      undefined,
      [createIdentifier('gdt')]
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createPerpendicularityCall('faces', faceExpr),
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) {
      return pathToNode
    }
    lastPathToNode = pathToNode
  }

  for (const edgeExpr of uniqueEdgeExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createPerpendicularityCall('edges', edgeExpr),
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) {
      return pathToNode
    }
    lastPathToNode = pathToNode
  }

  if (!lastPathToNode) {
    return new Error('Failed to create any gdt::perpendicularity calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

export function addParallelismGdt({
  ast,
  artifactGraph,
  objects,
  datums,
  tolerance,
  wasmInstance,
  precision,
  framePosition,
  framePlane,
  leaderScale,
  fontSize,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  datums?: string | KclCommandValue
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)

  const expressions = buildGdtFaceAndEdgeExpressions({
    selections: objects,
    artifactGraph,
    ast: modifiedAst,
    wasmInstance,
  })
  if (err(expressions)) return expressions
  modifiedAst = expressions.modifiedAst

  if (
    expressions.faceExprs.length === 0 &&
    expressions.edgeExprs.length === 0
  ) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

  const uniqueFaceExprs = deduplicateFaceExprs(expressions.faceExprs)
  const uniqueEdgeExprs = deduplicateFaceExprs(expressions.edgeExprs)
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, nodeToEdit)
  }
  if (precision && 'variableName' in precision && precision.variableName) {
    insertVariableAndOffsetPathToNode(precision, modifiedAst, nodeToEdit)
  }

  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit,
    wasmInstance,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
  })
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined

  const createParallelismCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    const datumsArg = createOptionalDatumsArg(datums, wasmInstance)
    if (datumsArg) labeledArgs.push(datumsArg)

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      'parallelism',
      null,
      labeledArgs,
      undefined,
      [createIdentifier('gdt')]
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createParallelismCall('faces', faceExpr),
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) {
      return pathToNode
    }
    lastPathToNode = pathToNode
  }

  for (const edgeExpr of uniqueEdgeExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createParallelismCall('edges', edgeExpr),
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) {
      return pathToNode
    }
    lastPathToNode = pathToNode
  }

  if (!lastPathToNode) {
    return new Error('Failed to create any gdt::parallelism calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

export function addAnnotationGdt({
  ast,
  artifactGraph,
  objects,
  annotation,
  wasmInstance,
  framePosition,
  framePlane,
  leaderScale,
  fontSize,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  annotation: string
  wasmInstance: ModuleType
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)

  const expressions = buildGdtFaceAndEdgeExpressions({
    selections: objects,
    artifactGraph,
    ast: modifiedAst,
    wasmInstance,
  })
  if (err(expressions)) return expressions
  modifiedAst = expressions.modifiedAst

  if (
    expressions.faceExprs.length === 0 &&
    expressions.edgeExprs.length === 0
  ) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

  const uniqueFaceExprs = deduplicateFaceExprs(expressions.faceExprs)
  const uniqueEdgeExprs = deduplicateFaceExprs(expressions.edgeExprs)
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit,
    wasmInstance,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
  })
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const createAnnotationCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) =>
    createCallExpressionStdLibKw(
      'annotation',
      null,
      [
        createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
        createLabeledArg('annotation', createLiteral(annotation, wasmInstance)),
        ...styleResult.labeledArgs,
      ],
      undefined,
      [createIdentifier('gdt')]
    )

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createAnnotationCall('faces', faceExpr),
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) {
      return pathToNode
    }
    lastPathToNode = pathToNode
  }

  for (const edgeExpr of uniqueEdgeExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createAnnotationCall('edges', edgeExpr),
      pathToEdit: nodeToEdit,
      pathIfNewPipe: undefined,
      variableIfNewDecl: undefined,
      wasmInstance,
    })
    if (err(pathToNode)) {
      return pathToNode
    }
    lastPathToNode = pathToNode
  }

  if (!lastPathToNode) {
    return new Error('Failed to create any gdt::annotation calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

/**
 * Adds a free-floating GD&T note to the AST.
 * Unlike gdt::annotation, a note is not attached to any face or edge; it lives on a
 * plane (default XY). Creates a single gdt::note call at the end of the AST body.
 *
 * @param ast - The AST to modify
 * @param note - The note text to display
 * @param wasmInstance - The KCL wasm instance
 * @param framePosition - 2D position of the note within the plane (optional)
 * @param framePlane - Plane the note lies in: 'XY' | 'XZ' | 'YZ' or a variable (optional, default XY)
 * @param fontSize - Model-space font size for the note text (optional)
 * @param nodeToEdit - Path to node to edit (for edit mode)
 * @returns Modified AST and path to the created node, or an Error
 */
export function addNoteGdt({
  ast,
  note,
  wasmInstance,
  framePosition,
  framePlane,
  fontSize,
  nodeToEdit,
}: {
  ast: Node<Program>
  note: string
  wasmInstance: ModuleType
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // A note has no leader and selects no geometry, so it only carries style params.
  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit: mNodeToEdit,
    wasmInstance,
    framePosition,
    framePlane,
    fontSize,
  })
  if (err(styleResult)) {
    return styleResult
  }

  const call = createCallExpressionStdLibKw(
    'note',
    null,
    [
      createLabeledArg('note', createLiteral(note, wasmInstance)),
      ...styleResult.labeledArgs,
    ],
    undefined,
    [createIdentifier('gdt')]
  )

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: undefined,
    variableIfNewDecl: undefined,
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

/**
 * Adds datum GD&T annotation to the AST.
 * Creates a single gdt::datum call for a selected face.
 * Always adds annotation at the end of the AST body.
 *
 * @param ast - The AST to modify
 * @param artifactGraph - The artifact graph for face lookups
 * @param faces - Selected face to annotate (only first face selection will be used)
 * @param name - The datum identifier (e.g., 'A', 'B', 'C')
 * @param framePosition - Position of the feature control frame [x, y] (optional)
 * @param framePlane - Plane for displaying the frame (XY, XZ, YZ) (optional)
 * @param leaderScale - Scale of the leader (optional)
 * @param fontSize - Font point size for annotation text (optional)
 * @param fontScale - Scale factor for annotation text (optional)
 * @param nodeToEdit - Path to node to edit (for edit mode)
 * @returns Modified AST and path to the created node, or an Error
 */
export function addDatumGdt({
  ast,
  artifactGraph,
  faces,
  name,
  wasmInstance,
  framePosition,
  framePlane,
  leaderScale,
  fontSize,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  faces: Selections
  name: string
  wasmInstance: ModuleType
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Clone the AST to avoid mutating the original
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // Filter to only include face selections (resolve V2 to get artifact)
  const faceSelections = faces.graphSelections
    .map((selV2) => resolveToCodeRef(selV2, artifactGraph))
    .filter(
      (s): s is NonNullable<typeof s> => s != null && isFaceArtifact(s.artifact)
    )

  // Validate datum name is a single character
  if (name.length !== 1) {
    return new Error('Datum name must be a single character')
  }

  // Validate datum name does not contain double quotes
  if (name.includes('"')) {
    return new Error('Datum name cannot contain double quotes')
  }

  // Datum requires exactly one face
  if (faceSelections.length === 0) {
    return new Error('No face selected for datum annotation')
  }
  if (faceSelections.length > 1) {
    return new Error(
      'Datum annotation requires exactly one face, but multiple faces were selected'
    )
  }

  const faceSelection = faceSelections[0]

  // Get face expression with tag
  const tagResult = modifyAstWithTagsForSelection(
    modifiedAst,
    faceSelection,
    artifactGraph,
    wasmInstance
  )
  if (err(tagResult)) {
    return tagResult
  }

  // Update the AST with the tagged version
  modifiedAst = tagResult.modifiedAst

  // Create expression from the first tag
  const faceExpr = tagResult.exprs[0]

  // Process common GDT style parameters
  const styleResult = processGdtStyleParameters({
    modifiedAst,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
  })
  if (err(styleResult)) {
    return styleResult
  }

  // Build labeled arguments starting with function-specific parameters
  const labeledArgs = [
    createLabeledArg('face', faceExpr),
    createLabeledArg('name', createLiteral(name, wasmInstance)),
  ]

  // Add common style parameter labeled arguments
  labeledArgs.push(...styleResult.labeledArgs)

  // Create the gdt::datum call
  const nonCodeMeta = undefined
  const modulePath = [createIdentifier('gdt')]
  const call = createCallExpressionStdLibKw(
    'datum',
    null,
    labeledArgs,
    nonCodeMeta,
    modulePath
  )

  // Insert the function call into the AST at the appropriate location
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: undefined, // GDT annotations don't pipe
    variableIfNewDecl: undefined, // Creates expression statement at the end
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

/**
 * Scans the AST and returns all datum names currently in use
 * @param ast - The AST program node to scan for datum names
 * @returns Array of datum names that are currently in use
 */
export function getUsedDatumNames(ast: Node<Program>): string[] {
  const usedNames: string[] = []

  traverse(ast, {
    enter: (node) => {
      // Look for gdt::datum calls
      if (
        node.type === 'CallExpressionKw' &&
        node.callee.type === 'Name' &&
        node.callee.path.length === 1 &&
        node.callee.path[0]?.name === 'gdt' &&
        node.callee.name.name === 'datum'
      ) {
        // Extract the name argument
        const nameArg = node.arguments?.find(
          (arg) =>
            arg.label?.name === 'name' &&
            arg.arg.type === 'Literal' &&
            typeof arg.arg.value === 'string'
        )

        if (nameArg && nameArg.arg.type === 'Literal') {
          usedNames.push(nameArg.arg.value as string)
        }
      }
    },
  })

  return usedNames
}

/**
 * Returns the first available datum character (A, B, C, ..., Z)
 * @param ast - The AST program node to scan for existing datum names
 * @returns The next available datum character, or 'A' as fallback if all letters are used
 */
export function getNextAvailableDatumName(ast?: Node<Program>): string {
  // Fallback if all A-Z are used (unlikely but safe)
  const fallback = 'A'
  if (!ast) {
    return fallback
  }

  const usedNames = getUsedDatumNames(ast)
  const usedNamesSet = new Set(usedNames.map((name) => name.toUpperCase()))

  // Check A-Z
  for (let charCode = 65; charCode <= 90; charCode++) {
    const char = String.fromCharCode(charCode)
    if (!usedNamesSet.has(char)) {
      return char
    }
  }

  return fallback
}

function parseDatumNames(datums?: string): string[] {
  return (datums ?? '')
    .split(',')
    .map((datum) => datum.trim())
    .filter(Boolean)
}

function createOptionalDatumsArg(
  datums: string | KclCommandValue | undefined,
  wasmInstance: ModuleType
): ReturnType<typeof createLabeledArg> | undefined {
  if (!datums) return undefined
  if (typeof datums !== 'string') {
    return createLabeledArg('datums', valueOrVariable(datums))
  }

  const datumNames = parseDatumNames(datums)
  if (datumNames.length === 0) return undefined

  return createLabeledArg(
    'datums',
    createArrayExpression(
      datumNames.map((datum) => createLiteral(datum, wasmInstance))
    )
  )
}

/**
 * Handles common GDT style parameters for all GDT annotation functions.
 * Inserts variables into AST if needed and creates labeled arguments for style parameters.
 *
 * @param params - Object containing style parameters and AST modification context
 * @param params.modifiedAst - The AST being modified (will be mutated for variable insertion)
 * @param params.nodeToEdit - Path to node being edited (for edit mode)
 * @param params.framePosition - Position of the feature control frame [x, y] (optional)
 * @param params.framePlane - Plane for displaying the frame (XY, XZ, YZ) or variable (optional)
 * @param params.fontSize - Font point size for annotation text (optional)
 * @param params.fontScale - Scale factor for annotation text (optional)
 * @returns Object containing labeled arguments for the style parameters, or Error if parameter processing fails
 */
function processGdtStyleParameters({
  modifiedAst,
  wasmInstance,
  nodeToEdit,
  framePosition,
  framePlane,
  leaderScale,
  fontSize,
}: {
  modifiedAst: Node<Program>
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontSize?: KclCommandValue
}): Error | { labeledArgs: ReturnType<typeof createLabeledArg>[] } {
  const labeledArgs: ReturnType<typeof createLabeledArg>[] = []

  // Insert variables for labeled arguments only once (before creating any calls)
  // Only insert framePosition variable if we used valueOrVariable (not for arrays)
  if (
    framePosition &&
    !('value' in framePosition && isArray(framePosition.value)) &&
    'variableName' in framePosition &&
    framePosition.variableName
  ) {
    insertVariableAndOffsetPathToNode(framePosition, modifiedAst, nodeToEdit)
  }
  // Only insert framePlane variable if we used valueOrVariable (not for strings)
  if (
    framePlane &&
    typeof framePlane !== 'string' &&
    'variableName' in framePlane &&
    framePlane.variableName
  ) {
    insertVariableAndOffsetPathToNode(framePlane, modifiedAst, nodeToEdit)
  }
  if (
    leaderScale &&
    'variableName' in leaderScale &&
    leaderScale.variableName
  ) {
    insertVariableAndOffsetPathToNode(leaderScale, modifiedAst, nodeToEdit)
  }
  if (fontSize && 'variableName' in fontSize && fontSize.variableName) {
    insertVariableAndOffsetPathToNode(fontSize, modifiedAst, nodeToEdit)
  }
  // Handle framePlane parameter - can be a named plane (XY, XZ, YZ) or variable
  if (framePlane) {
    let framePlaneExpr: Expr
    if (typeof framePlane === 'string') {
      // Named plane like 'XY', 'XZ', 'YZ'
      framePlaneExpr = createLocalName(framePlane)
    } else {
      // Variable reference
      framePlaneExpr = valueOrVariable(framePlane)
    }
    labeledArgs.push(createLabeledArg('framePlane', framePlaneExpr))
  }

  // Handle framePosition parameter - should be Point2d [x, y]
  if (framePosition) {
    const framePositionExpr = createPoint2dExpression(
      framePosition,
      wasmInstance
    )
    if (err(framePositionExpr)) {
      return framePositionExpr
    }
    labeledArgs.push(createLabeledArg('framePosition', framePositionExpr))
  }

  // Add scale-related optional labeled arguments if provided
  if (leaderScale !== undefined) {
    labeledArgs.push(
      createLabeledArg('leaderScale', valueOrVariable(leaderScale))
    )
  }
  if (fontSize !== undefined) {
    labeledArgs.push(createLabeledArg('fontSize', valueOrVariable(fontSize)))
  }
  return { labeledArgs }
}

import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  createPoint2dExpression,
  deduplicateFaceExprs,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  getBodySelectionFromPrimitiveParentEntityId,
  insertFacePrimitiveVariablesAndOffsetPathToNode,
  isFaceArtifact,
} from '@src/lang/modifyAst/faces'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { traverse } from '@src/lang/queryAst'
import {
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  Expr,
  PathToNode,
  Program,
  SourceRange,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { isEnginePrimitiveSelection } from '@src/lib/selections'
import type {
  EnginePrimitiveSelection,
  Selections,
} from '@src/machines/modelingSharedTypes'

export function updateGdtFramePosition({
  ast,
  sourceRange,
  framePosition,
  wasmInstance,
}: {
  ast: Node<Program>
  sourceRange: SourceRange
  framePosition: [number, number]
  wasmInstance: ModuleType
}): Node<Program> | Error {
  const modifiedAst = structuredClone(ast)
  const [rangeStart, rangeEnd, moduleId] = sourceRange as unknown as [
    number,
    number,
    number,
  ]
  const framePositionExpression = createArrayExpression([
    createLiteral(framePosition[0], wasmInstance, undefined, 3),
    createLiteral(framePosition[1], wasmInstance, undefined, 3),
  ])
  let updated = false
  traverse(modifiedAst, {
    enter: (node) => {
      if (
        updated ||
        node.type !== 'CallExpressionKw' ||
        node.callee.path[0]?.name !== 'gdt' ||
        node.start > rangeEnd ||
        node.end < rangeStart ||
        node.moduleId !== moduleId
      ) {
        return
      }
      const existingFramePosition = node.arguments.find(
        (arg) => arg.label?.name === 'framePosition'
      )
      if (existingFramePosition) {
        existingFramePosition.arg = framePositionExpression
      } else {
        node.arguments.push(
          createLabeledArg('framePosition', framePositionExpression)
        )
      }
      updated = true
    },
  })
  return updated
    ? modifiedAst
    : new Error('Could not find GD&T annotation call to update')
}

function isProfileEdgeArtifact(
  artifact: Selections['graphSelections'][number]['artifact']
): boolean {
  return artifact?.type === 'segment' || artifact?.type === 'sweepEdge'
}

function getPrimitiveFaceSelections(
  selections: Selections
): EnginePrimitiveSelection[] {
  return selections.otherSelections.filter(
    (selection): selection is EnginePrimitiveSelection =>
      isEnginePrimitiveSelection(selection) &&
      selection.primitiveType === 'face'
  )
}

function getPrimitiveEdgeSelections(
  selections: Selections
): EnginePrimitiveSelection[] {
  return selections.otherSelections.filter(
    (selection): selection is EnginePrimitiveSelection =>
      isEnginePrimitiveSelection(selection) &&
      selection.primitiveType === 'edge'
  )
}

function primitiveEdgeExprsFromSelection({
  edgeSelections,
  modifiedAst,
  artifactGraph,
  wasmInstance,
}: {
  edgeSelections: EnginePrimitiveSelection[]
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
}): Error | Expr[] {
  const dedupedSelections = [
    ...new Map(
      edgeSelections
        .filter((selection) => selection.parentEntityId)
        .map((selection) => [
          `${selection.parentEntityId}:${selection.primitiveIndex}`,
          selection,
        ])
    ).values(),
  ]
  const edgeExprs: Expr[] = []
  let insertIndex = modifiedAst.body.length
  for (const primitiveSelection of dedupedSelections) {
    if (!primitiveSelection.parentEntityId) {
      continue
    }
    const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
      primitiveSelection.parentEntityId,
      artifactGraph
    )
    if (!bodySelection) {
      return new Error(
        'Could not resolve a parent solid for a selected primitive edge.'
      )
    }
    const bodyVars = getVariableExprsFromSelection(
      {
        graphSelections: [bodySelection],
        otherSelections: [],
      },
      artifactGraph,
      modifiedAst,
      wasmInstance
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
        'Could not resolve selected primitive edge bodies in code.'
      )
    }
    const edgeIdExpr = createCallExpressionStdLibKw(
      'edgeId',
      structuredClone(solidExpr),
      [
        createLabeledArg(
          'index',
          createLiteral(primitiveSelection.primitiveIndex, wasmInstance)
        ),
      ]
    )
    const edgeVariableName = findUniqueName(
      modifiedAst,
      KCL_DEFAULT_CONSTANT_PREFIXES.EDGE
    )
    const variableIdentifierAst = createLocalName(edgeVariableName)
    insertVariableAndOffsetPathToNode(
      {
        valueAst: edgeIdExpr,
        valueText: '',
        valueCalculated: '',
        variableName: edgeVariableName,
        variableDeclarationAst: createVariableDeclaration(
          edgeVariableName,
          edgeIdExpr
        ),
        variableIdentifierAst,
        insertIndex,
      },
      modifiedAst
    )
    insertIndex += 1
    edgeExprs.push(variableIdentifierAst)
  }
  return edgeExprs
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
 * @param fontPointSize - Font point size for annotation text (optional)
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
  fontPointSize,
  fontScale,
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
  fontPointSize?: KclCommandValue
  fontScale?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Clone the AST to avoid mutating the original
  let modifiedAst = structuredClone(ast)

  // Filter to only include face selections
  const faceSelections = faces.graphSelections.filter((selection) =>
    isFaceArtifact(selection.artifact)
  )

  const primitiveFaceSelections = getPrimitiveFaceSelections(faces)
  if (faceSelections.length === 0 && primitiveFaceSelections.length === 0) {
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
  if (primitiveFaceSelections.length > 0) {
    const primitiveResult = insertFacePrimitiveVariablesAndOffsetPathToNode({
      enginePrimitives: primitiveFaceSelections,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(primitiveResult)) return primitiveResult
    facesExprs.push(...primitiveResult.faceExprs)
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
    fontPointSize,
    fontScale,
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

export function addProfileGdt({
  ast,
  artifactGraph,
  edges,
  datums,
  tolerance,
  wasmInstance,
  precision,
  framePosition,
  framePlane,
  leaderScale,
  fontPointSize,
  fontScale,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  edges: Selections
  datums?: string
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontPointSize?: KclCommandValue
  fontScale?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)

  const edgeSelections = edges.graphSelections.filter((selection) =>
    isProfileEdgeArtifact(selection.artifact)
  )
  const primitiveEdgeSelections = getPrimitiveEdgeSelections(edges)
  if (edgeSelections.length === 0 && primitiveEdgeSelections.length === 0) {
    return new Error(
      'No valid edge selections found. Please select sketch or sweep edges.'
    )
  }

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
  if (primitiveEdgeSelections.length > 0) {
    const primitiveEdgeExprs = primitiveEdgeExprsFromSelection({
      edgeSelections: primitiveEdgeSelections,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(primitiveEdgeExprs)) return primitiveEdgeExprs
    edgeExprs.push(...primitiveEdgeExprs)
  }

  const uniqueEdgeExprs = deduplicateFaceExprs(edgeExprs)
  if (uniqueEdgeExprs.length === 0) {
    return new Error('No valid edge expressions could be generated')
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
    fontPointSize,
    fontScale,
  })
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  for (const edgeExpr of uniqueEdgeExprs) {
    const labeledArgs = [
      createLabeledArg('edges', createArrayExpression([edgeExpr])),
    ]

    labeledArgs.push(createLabeledArg('tolerance', valueOrVariable(tolerance)))

    const datumNames = parseDatumNames(datums)
    if (datumNames.length > 0) {
      labeledArgs.push(
        createLabeledArg(
          'datums',
          createArrayExpression(
            datumNames.map((datum) => createLiteral(datum, wasmInstance))
          )
        )
      )
    }

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    const call = createCallExpressionStdLibKw(
      'profile',
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
  fontPointSize,
  fontScale,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  datums?: string
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontPointSize?: KclCommandValue
  fontScale?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)

  const faceSelections = objects.graphSelections.filter((selection) =>
    isFaceArtifact(selection.artifact)
  )
  const edgeSelections = objects.graphSelections.filter((selection) =>
    isProfileEdgeArtifact(selection.artifact)
  )
  const primitiveFaceSelections = getPrimitiveFaceSelections(objects)
  const primitiveEdgeSelections = getPrimitiveEdgeSelections(objects)

  if (
    faceSelections.length === 0 &&
    edgeSelections.length === 0 &&
    primitiveFaceSelections.length === 0 &&
    primitiveEdgeSelections.length === 0
  ) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

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
  if (primitiveFaceSelections.length > 0) {
    const primitiveResult = insertFacePrimitiveVariablesAndOffsetPathToNode({
      enginePrimitives: primitiveFaceSelections,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(primitiveResult)) return primitiveResult
    faceExprs.push(...primitiveResult.faceExprs)
  }

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
  if (primitiveEdgeSelections.length > 0) {
    const primitiveEdgeExprs = primitiveEdgeExprsFromSelection({
      edgeSelections: primitiveEdgeSelections,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(primitiveEdgeExprs)) return primitiveEdgeExprs
    edgeExprs.push(...primitiveEdgeExprs)
  }

  const uniqueFaceExprs = deduplicateFaceExprs(faceExprs)
  const uniqueEdgeExprs = deduplicateFaceExprs(edgeExprs)
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
    fontPointSize,
    fontScale,
  })
  if (err(styleResult)) {
    return styleResult
  }

  const datumNames = parseDatumNames(datums)
  let lastPathToNode: PathToNode | undefined

  const createPerpendicularityCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (datumNames.length > 0) {
      labeledArgs.push(
        createLabeledArg(
          'datums',
          createArrayExpression(
            datumNames.map((datum) => createLiteral(datum, wasmInstance))
          )
        )
      )
    }

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
  fontPointSize,
  fontScale,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  datums?: string
  tolerance: KclCommandValue
  wasmInstance: ModuleType
  precision?: KclCommandValue
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontPointSize?: KclCommandValue
  fontScale?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)

  const faceSelections = objects.graphSelections.filter((selection) =>
    isFaceArtifact(selection.artifact)
  )
  const edgeSelections = objects.graphSelections.filter((selection) =>
    isProfileEdgeArtifact(selection.artifact)
  )
  const primitiveFaceSelections = getPrimitiveFaceSelections(objects)
  const primitiveEdgeSelections = getPrimitiveEdgeSelections(objects)

  if (
    faceSelections.length === 0 &&
    edgeSelections.length === 0 &&
    primitiveFaceSelections.length === 0 &&
    primitiveEdgeSelections.length === 0
  ) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

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
  if (primitiveFaceSelections.length > 0) {
    const primitiveResult = insertFacePrimitiveVariablesAndOffsetPathToNode({
      enginePrimitives: primitiveFaceSelections,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(primitiveResult)) return primitiveResult
    faceExprs.push(...primitiveResult.faceExprs)
  }

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
  if (primitiveEdgeSelections.length > 0) {
    const primitiveEdgeExprs = primitiveEdgeExprsFromSelection({
      edgeSelections: primitiveEdgeSelections,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(primitiveEdgeExprs)) return primitiveEdgeExprs
    edgeExprs.push(...primitiveEdgeExprs)
  }

  const uniqueFaceExprs = deduplicateFaceExprs(faceExprs)
  const uniqueEdgeExprs = deduplicateFaceExprs(edgeExprs)
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
    fontPointSize,
    fontScale,
  })
  if (err(styleResult)) {
    return styleResult
  }

  const datumNames = parseDatumNames(datums)
  let lastPathToNode: PathToNode | undefined

  const createParallelismCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (datumNames.length > 0) {
      labeledArgs.push(
        createLabeledArg(
          'datums',
          createArrayExpression(
            datumNames.map((datum) => createLiteral(datum, wasmInstance))
          )
        )
      )
    }

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
  fontPointSize,
  fontScale,
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
  fontPointSize?: KclCommandValue
  fontScale?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  let modifiedAst = structuredClone(ast)

  const faceSelections = objects.graphSelections.filter((selection) =>
    isFaceArtifact(selection.artifact)
  )
  const edgeSelections = objects.graphSelections.filter((selection) =>
    isProfileEdgeArtifact(selection.artifact)
  )
  const primitiveFaceSelections = getPrimitiveFaceSelections(objects)
  const primitiveEdgeSelections = getPrimitiveEdgeSelections(objects)

  if (
    faceSelections.length === 0 &&
    edgeSelections.length === 0 &&
    primitiveFaceSelections.length === 0 &&
    primitiveEdgeSelections.length === 0
  ) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

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
  if (primitiveFaceSelections.length > 0) {
    const primitiveResult = insertFacePrimitiveVariablesAndOffsetPathToNode({
      enginePrimitives: primitiveFaceSelections,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(primitiveResult)) return primitiveResult
    faceExprs.push(...primitiveResult.faceExprs)
  }

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
  if (primitiveEdgeSelections.length > 0) {
    const primitiveEdgeExprs = primitiveEdgeExprsFromSelection({
      edgeSelections: primitiveEdgeSelections,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(primitiveEdgeExprs)) return primitiveEdgeExprs
    edgeExprs.push(...primitiveEdgeExprs)
  }

  const uniqueFaceExprs = deduplicateFaceExprs(faceExprs)
  const uniqueEdgeExprs = deduplicateFaceExprs(edgeExprs)
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
    fontPointSize,
    fontScale,
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
 * @param fontPointSize - Font point size for annotation text (optional)
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
  fontPointSize,
  fontScale,
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
  fontPointSize?: KclCommandValue
  fontScale?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Clone the AST to avoid mutating the original
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // Filter to only include face selections
  const faceSelections = faces.graphSelections.filter((selection) =>
    isFaceArtifact(selection.artifact)
  )
  const primitiveFaceSelections = getPrimitiveFaceSelections(faces)

  // Validate datum name is a single character
  if (name.length !== 1) {
    return new Error('Datum name must be a single character')
  }

  // Validate datum name does not contain double quotes
  if (name.includes('"')) {
    return new Error('Datum name cannot contain double quotes')
  }

  // Datum requires exactly one face
  const faceSelectionCount =
    faceSelections.length + primitiveFaceSelections.length
  if (faceSelectionCount === 0) {
    return new Error('No face selected for datum annotation')
  }
  if (faceSelectionCount > 1) {
    return new Error(
      'Datum annotation requires exactly one face, but multiple faces were selected'
    )
  }

  const faceExprs: Expr[] = []
  const faceSelection = faceSelections[0]
  if (faceSelection) {
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
    faceExprs.push(tagResult.exprs[0])
  }
  if (primitiveFaceSelections.length > 0) {
    const primitiveResult = insertFacePrimitiveVariablesAndOffsetPathToNode({
      enginePrimitives: primitiveFaceSelections,
      modifiedAst,
      artifactGraph,
      wasmInstance,
    })
    if (err(primitiveResult)) return primitiveResult
    faceExprs.push(...primitiveResult.faceExprs)
  }
  const faceExpr = faceExprs[0]
  if (!faceExpr) {
    return new Error('No valid face expression could be generated')
  }

  // Process common GDT style parameters
  const styleResult = processGdtStyleParameters({
    modifiedAst,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
    framePosition,
    framePlane,
    leaderScale,
    fontPointSize,
    fontScale,
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

/**
 * Handles common GDT style parameters for all GDT annotation functions.
 * Inserts variables into AST if needed and creates labeled arguments for style parameters.
 *
 * @param params - Object containing style parameters and AST modification context
 * @param params.modifiedAst - The AST being modified (will be mutated for variable insertion)
 * @param params.nodeToEdit - Path to node being edited (for edit mode)
 * @param params.framePosition - Position of the feature control frame [x, y] (optional)
 * @param params.framePlane - Plane for displaying the frame (XY, XZ, YZ) or variable (optional)
 * @param params.fontPointSize - Font point size for annotation text (optional)
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
  fontPointSize,
  fontScale,
}: {
  modifiedAst: Node<Program>
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
  framePosition?: KclCommandValue
  framePlane?: KclCommandValue | string
  leaderScale?: KclCommandValue
  fontPointSize?: KclCommandValue
  fontScale?: KclCommandValue
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
  if (
    fontPointSize &&
    'variableName' in fontPointSize &&
    fontPointSize.variableName
  ) {
    insertVariableAndOffsetPathToNode(fontPointSize, modifiedAst, nodeToEdit)
  }
  if (fontScale && 'variableName' in fontScale && fontScale.variableName) {
    insertVariableAndOffsetPathToNode(fontScale, modifiedAst, nodeToEdit)
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
  if (fontPointSize !== undefined) {
    labeledArgs.push(
      createLabeledArg('fontPointSize', valueOrVariable(fontPointSize))
    )
  }
  if (fontScale !== undefined) {
    labeledArgs.push(createLabeledArg('fontScale', valueOrVariable(fontScale)))
  }

  return { labeledArgs }
}

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
  getEnginePrimitiveFaceSelectionsFromSelection,
  insertFacePrimitiveVariablesForSelection,
  isFaceArtifact,
} from '@src/lang/modifyAst/faces'
import {
  getPrimitiveEdgeSelections,
  insertPrimitiveEdgeVariablesForSelection,
} from '@src/lang/modifyAst/edges'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { getVariableExprsFromSelection, traverse } from '@src/lang/queryAst'
import { valueOrVariable } from '@src/lang/queryAst'
import type { ArtifactGraph, Expr, PathToNode, Program } from '@src/lang/wasm'
import { modelingStdLibCall } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

function isProfileEdgeArtifact(
  artifact: Selections['graphSelections'][number]['artifact']
): boolean {
  return (
    artifact?.type === 'segment' ||
    artifact?.type === 'sweepEdge' ||
    artifact?.type === 'primitiveEdge'
  )
}

function getGraphFaceExprs({
  modifiedAst,
  faceSelections,
  artifactGraph,
  wasmInstance,
}: {
  modifiedAst: Node<Program>
  faceSelections: Selections['graphSelections']
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; exprs: Expr[] } {
  const exprs: Expr[] = []
  let nextAst = modifiedAst

  for (const faceSelection of faceSelections) {
    const tagResult = modifyAstWithTagsForSelection(
      nextAst,
      faceSelection,
      artifactGraph,
      wasmInstance
    )
    if (err(tagResult)) {
      console.warn('Failed to add tag for face selection', tagResult)
      continue
    }

    nextAst = tagResult.modifiedAst
    exprs.push(tagResult.exprs[0])
  }

  return { modifiedAst: nextAst, exprs }
}

function getGraphEdgeExprs({
  modifiedAst,
  edgeSelections,
  artifactGraph,
  wasmInstance,
}: {
  modifiedAst: Node<Program>
  edgeSelections: Selections['graphSelections']
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; exprs: Expr[] } {
  const exprs: Expr[] = []
  let nextAst = modifiedAst

  for (const edgeSelection of edgeSelections) {
    if (edgeSelection.artifact?.type === 'primitiveEdge') {
      const primitiveEdgeExprs = getVariableExprsFromSelection(
        { graphSelections: [edgeSelection], otherSelections: [] },
        artifactGraph,
        nextAst,
        wasmInstance
      )
      if (err(primitiveEdgeExprs)) {
        console.warn(
          'Failed to resolve primitive edge selection',
          primitiveEdgeExprs
        )
        continue
      }
      if (primitiveEdgeExprs.exprs[0]) {
        exprs.push(primitiveEdgeExprs.exprs[0])
      }
      continue
    }

    const tagResult = modifyAstWithTagsForSelection(
      nextAst,
      edgeSelection,
      artifactGraph,
      wasmInstance
    )
    if (err(tagResult)) {
      console.warn('Failed to add tags for edge selection', tagResult)
      continue
    }

    nextAst = tagResult.modifiedAst
    if (tagResult.exprs.length < 2) {
      console.warn('Edge selection did not resolve to enough faces', tagResult)
      continue
    }

    exprs.push(
      createCallExpressionStdLibKw('getCommonEdge', null, [
        createLabeledArg('faces', createArrayExpression(tagResult.exprs)),
      ])
    )
  }

  return { modifiedAst: nextAst, exprs }
}

function getEnginePrimitiveFaceExprs({
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
}): Error | Expr[] {
  const result = insertFacePrimitiveVariablesForSelection({
    selection: selections,
    modifiedAst,
    artifactGraph,
    wasmInstance,
    pathToNode: nodeToEdit,
  })
  if (err(result)) return result
  return result.faceExprs
}

function getEnginePrimitiveEdgeExprs({
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
}): Error | Expr[] {
  const result = insertPrimitiveEdgeVariablesForSelection({
    selection: selections,
    modifiedAst,
    artifactGraph,
    wasmInstance,
    nodeToEdit,
  })
  if (err(result)) return result

  return result.edgeExprs
}

function getGdtSelectionExprs({
  modifiedAst,
  selections,
  artifactGraph,
  wasmInstance,
  nodeToEdit,
  includeFaces = true,
  includeEdges = true,
}: {
  modifiedAst: Node<Program>
  selections: Selections
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
  includeFaces?: boolean
  includeEdges?: boolean
}):
  | Error
  | {
      modifiedAst: Node<Program>
      uniqueFaceExprs: Expr[]
      uniqueEdgeExprs: Expr[]
    } {
  let nextAst = modifiedAst
  let faceExprs: Expr[] = []
  let edgeExprs: Expr[] = []

  if (includeFaces) {
    const faceSelections = selections.graphSelections.filter((selection) =>
      isFaceArtifact(selection.artifact)
    )
    const graphFaces = getGraphFaceExprs({
      modifiedAst: nextAst,
      faceSelections,
      artifactGraph,
      wasmInstance,
    })
    if (err(graphFaces)) return graphFaces
    nextAst = graphFaces.modifiedAst
    faceExprs = faceExprs.concat(graphFaces.exprs)

    const primitiveFaces = getEnginePrimitiveFaceExprs({
      selections,
      modifiedAst: nextAst,
      artifactGraph,
      wasmInstance,
      nodeToEdit,
    })
    if (err(primitiveFaces)) return primitiveFaces
    faceExprs = faceExprs.concat(primitiveFaces)
  }

  if (includeEdges) {
    const edgeSelections = selections.graphSelections.filter((selection) =>
      isProfileEdgeArtifact(selection.artifact)
    )
    const graphEdges = getGraphEdgeExprs({
      modifiedAst: nextAst,
      edgeSelections,
      artifactGraph,
      wasmInstance,
    })
    if (err(graphEdges)) return graphEdges
    nextAst = graphEdges.modifiedAst
    edgeExprs = edgeExprs.concat(graphEdges.exprs)

    const primitiveEdges = getEnginePrimitiveEdgeExprs({
      selections,
      modifiedAst: nextAst,
      artifactGraph,
      wasmInstance,
      nodeToEdit,
    })
    if (err(primitiveEdges)) return primitiveEdges
    edgeExprs = edgeExprs.concat(primitiveEdges)
  }

  return {
    modifiedAst: nextAst,
    uniqueFaceExprs: deduplicateFaceExprs(faceExprs),
    uniqueEdgeExprs: deduplicateFaceExprs(edgeExprs),
  }
}

function modelingStdLibCallWithModulePath(
  commandName: Parameters<typeof modelingStdLibCall>[0]
) {
  const stdLibCall = modelingStdLibCall(commandName)
  return {
    name: stdLibCall.name,
    modulePath: stdLibCall.path.map(createIdentifier),
  }
}

export type ProfileGdtFunction = 'profile' | 'profileLine' | 'profileSurface'

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
 * @param fontSize - Model-space font size for annotation text (optional)
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
  const mNodeToEdit = structuredClone(nodeToEdit)

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: faces,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
    includeEdges: false,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const uniqueFacesExprs = selectionExprs.uniqueFaceExprs

  if (uniqueFacesExprs.length === 0) {
    return new Error(
      'No valid face expressions could be generated from selection'
    )
  }

  // Insert variables for tolerance and precision parameters
  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  if (precision && 'variableName' in precision && precision.variableName) {
    insertVariableAndOffsetPathToNode(precision, modifiedAst, mNodeToEdit)
  }

  // Process common GDT style parameters
  const styleResult = processGdtStyleParameters({
    modifiedAst,
    nodeToEdit: mNodeToEdit,
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
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Flatness')

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
    const call = createCallExpressionStdLibKw(
      stdLibCall.name,
      null,
      labeledArgs,
      nonCodeMeta,
      stdLibCall.modulePath
    )

    // Insert the function call into the AST at the appropriate location
    // Using undefined for variableIfNewDecl so it creates an expression statement
    // This ensures GDT annotations are always added at the end
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

/**
 * Adds straightness GD&T annotation(s) to the AST.
 * Creates one gdt::straightness call per selected face or edge.
 * Always adds annotations at the end of the AST body.
 */
export function addStraightnessGdt({
  ast,
  artifactGraph,
  objects,
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Straightness')

  const createStraightnessCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      stdLibCall.name,
      null,
      labeledArgs,
      undefined,
      stdLibCall.modulePath
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createStraightnessCall('faces', faceExpr),
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
      call: createStraightnessCall('edges', edgeExpr),
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
    return new Error('Failed to create any gdt::straightness calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

/**
 * Adds circularity GD&T annotation(s) to the AST.
 * Creates one gdt::circularity call per selected face or edge.
 * Always adds annotations at the end of the AST body.
 */
export function addCircularityGdt({
  ast,
  artifactGraph,
  objects,
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Circularity')

  const createCircularityCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      stdLibCall.name,
      null,
      labeledArgs,
      undefined,
      stdLibCall.modulePath
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createCircularityCall('faces', faceExpr),
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
      call: createCircularityCall('edges', edgeExpr),
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
    return new Error('Failed to create any gdt::circularity calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

/**
 * Adds cylindricity GD&T annotation(s) to the AST.
 * Creates one gdt::cylindricity call per selected face or edge.
 * Always adds annotations at the end of the AST body.
 */
export function addCylindricityGdt({
  ast,
  artifactGraph,
  objects,
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Cylindricity')

  const createCylindricityCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      stdLibCall.name,
      null,
      labeledArgs,
      undefined,
      stdLibCall.modulePath
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createCylindricityCall('faces', faceExpr),
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
      call: createCylindricityCall('edges', edgeExpr),
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
    return new Error('Failed to create any gdt::cylindricity calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Position')
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
      stdLibCall.name,
      null,
      labeledArgs,
      undefined,
      stdLibCall.modulePath
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
  profileFunction,
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
  profileFunction?: ProfileGdtFunction
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
  const selections = objects ?? edges ?? faces

  if (!selections) {
    return new Error(
      'No selections found. Please select faces or edges for profile.'
    )
  }

  const enginePrimitiveFaceSelections =
    getEnginePrimitiveFaceSelectionsFromSelection(selections)
  const enginePrimitiveEdgeSelections = getPrimitiveEdgeSelections(selections)
  const supportedEnginePrimitiveCount =
    enginePrimitiveFaceSelections.length + enginePrimitiveEdgeSelections.length
  const unsupportedSelections =
    selections.otherSelections.length !== supportedEnginePrimitiveCount ||
    selections.graphSelections.some(
      (selection) =>
        !isProfileEdgeArtifact(selection.artifact) &&
        !isFaceArtifact(selection.artifact)
    )
  if (unsupportedSelections) {
    return new Error('Profile supports face selections or sketch/sweep edges.')
  }

  const hasFaceSelection =
    enginePrimitiveFaceSelections.length > 0 ||
    selections.graphSelections.some((selection) =>
      isFaceArtifact(selection.artifact)
    )
  const hasEdgeSelection =
    enginePrimitiveEdgeSelections.length > 0 ||
    selections.graphSelections.some((selection) =>
      isProfileEdgeArtifact(selection.artifact)
    )

  if (hasFaceSelection && hasEdgeSelection) {
    return new Error(
      'Profile requires either faces or edges, not both. Select faces for profileSurface or edges for profileLine.'
    )
  }

  if (!hasFaceSelection && !hasEdgeSelection) {
    return new Error('No valid selections found. Please select faces or edges.')
  }

  if (profileFunction === 'profileLine' && hasFaceSelection) {
    return new Error('profileLine requires edge selections.')
  }
  if (profileFunction === 'profileSurface' && hasEdgeSelection) {
    return new Error('profileSurface requires face selections.')
  }

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined

  const createProfileCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const functionName =
      profileFunction ??
      (mNodeToEdit
        ? 'profile'
        : targetArgName === 'faces'
          ? 'profileSurface'
          : 'profileLine')

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
      call: createProfileCall('faces', faceExpr),
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
      call: createProfileCall('edges', edgeExpr),
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
    return new Error('Failed to create any GDT profile calls')
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
  const mNodeToEdit = structuredClone(nodeToEdit)
  const selections = objects ?? edges

  if (!selections) {
    return new Error(
      'No selections found. Select one edge for an edge length, or exactly two faces or edges for a distance.'
    )
  }

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst

  if (
    selectionExprs.uniqueFaceExprs.length === 0 &&
    selectionExprs.uniqueEdgeExprs.length === 0
  ) {
    return new Error(
      'No valid selections found. Select one edge, or exactly two faces or edges.'
    )
  }

  const targets: Array<{ kind: 'face' | 'edge'; expr: Expr }> = [
    ...selectionExprs.uniqueFaceExprs.map((expr) => ({
      kind: 'face' as const,
      expr,
    })),
    ...selectionExprs.uniqueEdgeExprs.map((expr) => ({
      kind: 'edge' as const,
      expr,
    })),
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
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
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
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Distance')

  const call = createCallExpressionStdLibKw(
    stdLibCall.name,
    null,
    labeledArgs,
    undefined,
    stdLibCall.modulePath
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  if (datums && 'variableName' in datums && datums.variableName) {
    insertVariableAndOffsetPathToNode(datums, modifiedAst, nodeToEdit)
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Perpendicularity')

  const createPerpendicularityCall = (
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
      stdLibCall.name,
      null,
      labeledArgs,
      undefined,
      stdLibCall.modulePath
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createPerpendicularityCall('faces', faceExpr),
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
      call: createPerpendicularityCall('edges', edgeExpr),
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
    return new Error('Failed to create any gdt::perpendicularity calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

export function addAngularityGdt({
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  if (datums && 'variableName' in datums && datums.variableName) {
    insertVariableAndOffsetPathToNode(datums, modifiedAst, nodeToEdit)
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Angularity')

  const createAngularityCall = (
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
      stdLibCall.name,
      null,
      labeledArgs,
      undefined,
      stdLibCall.modulePath
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createAngularityCall('faces', faceExpr),
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
      call: createAngularityCall('edges', edgeExpr),
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
    return new Error('Failed to create any gdt::angularity calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

export function addConcentricityGdt({
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
  datums: KclCommandValue
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  if ('variableName' in datums && datums.variableName) {
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined

  const createConcentricityCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('datums', valueOrVariable(datums)),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      'concentricity',
      null,
      labeledArgs,
      undefined,
      [createIdentifier('gdt')]
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createConcentricityCall('faces', faceExpr),
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
      call: createConcentricityCall('edges', edgeExpr),
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
    return new Error('Failed to create any gdt::concentricity calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

export function addSymmetryGdt({
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
  datums: KclCommandValue
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  if ('variableName' in datums && datums.variableName) {
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined

  const createSymmetryCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('datums', valueOrVariable(datums)),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      'symmetry',
      null,
      labeledArgs,
      undefined,
      [createIdentifier('gdt')]
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createSymmetryCall('faces', faceExpr),
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
      call: createSymmetryCall('edges', edgeExpr),
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
    return new Error('Failed to create any gdt::symmetry calls')
  }

  return {
    modifiedAst,
    pathToNode: lastPathToNode,
  }
}

export function addRunoutGdt({
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
  datums: KclCommandValue
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  if ('variableName' in datums && datums.variableName) {
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined

  const createRunoutCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) => {
    const labeledArgs = [
      createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
      createLabeledArg('datums', valueOrVariable(datums)),
      createLabeledArg('tolerance', valueOrVariable(tolerance)),
    ]

    if (precision !== undefined) {
      labeledArgs.push(
        createLabeledArg('precision', valueOrVariable(precision))
      )
    }

    labeledArgs.push(...styleResult.labeledArgs)

    return createCallExpressionStdLibKw(
      'runout',
      null,
      labeledArgs,
      undefined,
      [createIdentifier('gdt')]
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createRunoutCall('faces', faceExpr),
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
      call: createRunoutCall('edges', edgeExpr),
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
    return new Error('Failed to create any gdt::runout calls')
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

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
  }

  if ('variableName' in tolerance && tolerance.variableName) {
    insertVariableAndOffsetPathToNode(tolerance, modifiedAst, mNodeToEdit)
  }
  if (datums && 'variableName' in datums && datums.variableName) {
    insertVariableAndOffsetPathToNode(datums, modifiedAst, nodeToEdit)
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Parallelism')

  const createParallelismCall = (
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
      stdLibCall.name,
      null,
      labeledArgs,
      undefined,
      stdLibCall.modulePath
    )
  }

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createParallelismCall('faces', faceExpr),
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
      call: createParallelismCall('edges', edgeExpr),
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
  const mNodeToEdit = structuredClone(nodeToEdit)

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: objects,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const { uniqueFaceExprs, uniqueEdgeExprs } = selectionExprs
  if (uniqueFaceExprs.length === 0 && uniqueEdgeExprs.length === 0) {
    return new Error('No valid face or edge expressions could be generated')
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
  if (err(styleResult)) {
    return styleResult
  }

  let lastPathToNode: PathToNode | undefined
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Annotation')
  const createAnnotationCall = (
    targetArgName: 'faces' | 'edges',
    targetExpr: Expr
  ) =>
    createCallExpressionStdLibKw(
      stdLibCall.name,
      null,
      [
        createLabeledArg(targetArgName, createArrayExpression([targetExpr])),
        createLabeledArg('annotation', createLiteral(annotation, wasmInstance)),
        ...styleResult.labeledArgs,
      ],
      undefined,
      stdLibCall.modulePath
    )

  for (const faceExpr of uniqueFaceExprs) {
    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call: createAnnotationCall('faces', faceExpr),
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
      call: createAnnotationCall('edges', edgeExpr),
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
 * @param fontSize - Model-space font size for annotation text (optional)
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

  // Validate datum name is a single character
  if (name.length !== 1) {
    return new Error('Datum name must be a single character')
  }

  // Validate datum name does not contain double quotes
  if (name.includes('"')) {
    return new Error('Datum name cannot contain double quotes')
  }

  const selectionExprs = getGdtSelectionExprs({
    modifiedAst,
    selections: faces,
    artifactGraph,
    wasmInstance,
    nodeToEdit: mNodeToEdit,
    includeEdges: false,
  })
  if (err(selectionExprs)) return selectionExprs
  modifiedAst = selectionExprs.modifiedAst
  const faceExprs = selectionExprs.uniqueFaceExprs

  // Datum requires exactly one face
  if (faceExprs.length === 0) {
    return new Error('No face selected for datum annotation')
  }
  if (faceExprs.length > 1) {
    return new Error(
      'Datum annotation requires exactly one face, but multiple faces were selected'
    )
  }

  const faceExpr = faceExprs[0]

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
  const stdLibCall = modelingStdLibCallWithModulePath('GDT Datum')
  const call = createCallExpressionStdLibKw(
    stdLibCall.name,
    null,
    labeledArgs,
    nonCodeMeta,
    stdLibCall.modulePath
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

/**
 * Handles common GDT style parameters for all GDT annotation functions.
 * Inserts variables into AST if needed and creates labeled arguments for style parameters.
 *
 * @param params - Object containing style parameters and AST modification context
 * @param params.modifiedAst - The AST being modified (will be mutated for variable insertion)
 * @param params.nodeToEdit - Path to node being edited (for edit mode)
 * @param params.framePosition - Position of the feature control frame [x, y] (optional)
 * @param params.framePlane - Plane for displaying the frame (XY, XZ, YZ) or variable (optional)
 * @param params.fontSize - Model-space font size for annotation text (optional)
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

import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createArrayExpression,
  createMemberExpression,
  createTagDeclarator,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  deleteTopLevelStatement,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  getNodeFromPath,
  getVariableExprsFromSelection,
  locateVariableWithCallOrPipe,
  valueOrVariable,
} from '@src/lang/queryAst'
import type {
  Artifact,
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  ExpressionStatement,
  PathToNode,
  Program,
  VariableDeclarator,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type {
  EnginePrimitiveSelection,
  Selections,
  Selection,
} from '@src/machines/modelingSharedTypes'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { getBodySelectionFromPrimitiveParentEntityId } from '@src/lang/modifyAst/faces'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import { deleteNodeInExtrudePipe } from '@src/lang/modifyAst/deleteNodeInExtrudePipe'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { isEnginePrimitiveSelection } from '@src/lib/selections'

export function addFillet({
  ast,
  artifactGraph,
  selection,
  radius,
  tag,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  selection: Selections
  radius: KclCommandValue
  tag?: string
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode[] // Array because multi-body selections create multiple fillet calls
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Group selections by body and add all tags first (before variable insertion)
  // This must happen before insertVariableAndOffsetPathToNode because that invalidates artifactGraph paths
  const bodyData = groupSelectionsByBodyAndAddTags(
    selection,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
  if (err(bodyData)) return bodyData
  let bodies = bodyData.bodies
  modifiedAst = bodyData.modifiedAst

  const primitiveEdgeSelections = getPrimitiveEdgeSelections(selection)
  if (primitiveEdgeSelections.length > 0) {
    const primitiveEdgeResult = insertPrimitiveEdgeVariablesAndOffsetPathToNode(
      {
        primitiveEdgeSelections,
        bodies,
        modifiedAst,
        artifactGraph,
        wasmInstance,
        nodeToEdit: mNodeToEdit,
      }
    )
    if (err(primitiveEdgeResult)) return primitiveEdgeResult
    bodies = primitiveEdgeResult.bodies
  }
  if (bodies.size === 0) {
    return new Error('No edges found in the selection')
  }

  // Insert variables for labeled arguments if provided
  if ('variableName' in radius && radius.variableName) {
    insertVariableAndOffsetPathToNode(radius, modifiedAst, mNodeToEdit)
  }

  // 3. Create fillet calls for each body
  const pathToNodes: PathToNode[] = []
  for (const data of bodies.values()) {
    const tagArgs = tag
      ? [createLabeledArg('tag', createTagDeclarator(tag))]
      : []
    const call = createCallExpressionStdLibKw('fillet', data.solidsExpr, [
      createLabeledArg('tags', data.tagsExpr),
      createLabeledArg('radius', valueOrVariable(radius)),
      ...tagArgs,
    ])

    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call,
      pathToEdit: mNodeToEdit,
      pathIfNewPipe: data.pathIfPipe,
      variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.FILLET,
      wasmInstance,
    })
    if (err(pathToNode)) return pathToNode
    pathToNodes.push(pathToNode)
  }

  return { modifiedAst, pathToNode: pathToNodes }
}

export function addChamfer({
  ast,
  artifactGraph,
  selection,
  length,
  secondLength,
  angle,
  tag,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  selection: Selections
  length: KclCommandValue
  secondLength?: KclCommandValue
  angle?: KclCommandValue
  tag?: string
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode[] // Array because multi-body selections create multiple chamfer calls
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Group selections by body and add all tags first (before variable insertion)
  // This must happen before insertVariableAndOffsetPathToNode because that invalidates artifactGraph paths
  const bodyData = groupSelectionsByBodyAndAddTags(
    selection,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )
  if (err(bodyData)) return bodyData
  let bodies = bodyData.bodies
  modifiedAst = bodyData.modifiedAst

  const primitiveEdgeSelections = getPrimitiveEdgeSelections(selection)
  if (primitiveEdgeSelections.length > 0) {
    const primitiveEdgeResult = insertPrimitiveEdgeVariablesAndOffsetPathToNode(
      {
        primitiveEdgeSelections,
        bodies,
        modifiedAst,
        artifactGraph,
        wasmInstance,
        nodeToEdit: mNodeToEdit,
      }
    )
    if (err(primitiveEdgeResult)) return primitiveEdgeResult
    bodies = primitiveEdgeResult.bodies
  }
  if (bodies.size === 0) {
    return new Error('No edges found in the selection')
  }

  // Insert variables for labeled arguments if provided
  if ('variableName' in length && length.variableName) {
    insertVariableAndOffsetPathToNode(length, modifiedAst, mNodeToEdit)
  }
  if (
    secondLength &&
    'variableName' in secondLength &&
    secondLength.variableName
  ) {
    insertVariableAndOffsetPathToNode(secondLength, modifiedAst, mNodeToEdit)
  }
  if (angle && 'variableName' in angle && angle.variableName) {
    insertVariableAndOffsetPathToNode(angle, modifiedAst, mNodeToEdit)
  }

  // 3. Create chamfer calls for each body
  const pathToNodes: PathToNode[] = []
  for (const data of bodies.values()) {
    const secondLengthArgs = secondLength
      ? [createLabeledArg('secondLength', valueOrVariable(secondLength))]
      : []
    const angleArgs = angle
      ? [createLabeledArg('angle', valueOrVariable(angle))]
      : []
    const tagArgs = tag
      ? [createLabeledArg('tag', createTagDeclarator(tag))]
      : []

    const call = createCallExpressionStdLibKw('chamfer', data.solidsExpr, [
      createLabeledArg('tags', data.tagsExpr),
      createLabeledArg('length', valueOrVariable(length)),
      ...secondLengthArgs,
      ...angleArgs,
      ...tagArgs,
    ])

    const pathToNode = setCallInAst({
      ast: modifiedAst,
      call,
      pathToEdit: mNodeToEdit,
      pathIfNewPipe: data.pathIfPipe,
      variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.CHAMFER,
      wasmInstance,
    })
    if (err(pathToNode)) return pathToNode
    pathToNodes.push(pathToNode)
  }

  return { modifiedAst, pathToNode: pathToNodes }
}

export function addBlend({
  ast,
  artifactGraph,
  edges,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  edges: Selections
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast so we can freely edit it
  let modifiedAst = structuredClone(ast)

  // 2. Validate the edge selection
  const selectedEdges = getEdgeSelections(edges)
  if (selectedEdges.length !== 2) {
    return new Error('Blend requires exactly two selected edges.')
  }

  // 3. Build two edges and use them in blend([edge1, edge2])
  const edgeExprs: Expr[] = []
  for (const edgeSelection of selectedEdges) {
    const edgeResult = buildEdgeExpr(
      edgeSelection,
      modifiedAst,
      artifactGraph,
      wasmInstance
    )
    if (err(edgeResult)) return edgeResult
    modifiedAst = edgeResult.modifiedAst
    edgeExprs.push(edgeResult.edgeExpr)
  }

  const call = createCallExpressionStdLibKw(
    'blend',
    createArrayExpression(edgeExprs),
    []
  )

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.BLEND,
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

type EdgeSelectionForExpr = Selection | EnginePrimitiveSelection
type BodySelectionData = {
  solidsExpr: Expr | null
  tagsExpr: Expr
  pathIfPipe?: PathToNode
}

function getEdgeSelections(edges: Selections): EdgeSelectionForExpr[] {
  return [...edges.graphSelections, ...getPrimitiveEdgeSelections(edges)]
}

function getSketchSegmentNameFromSourceSurface(
  sourceSurfaceArtifact: Artifact,
  ast: Node<Program>,
  wasmInstance: ModuleType
): string | null {
  if (sourceSurfaceArtifact.type !== 'sweep') {
    return null
  }

  const sourceSurfaceNode = getNodeFromPath<CallExpressionKw>(
    ast,
    sourceSurfaceArtifact.codeRef.pathToNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (
    err(sourceSurfaceNode) ||
    sourceSurfaceNode.node.type !== 'CallExpressionKw'
  ) {
    return null
  }

  const sweepInput = sourceSurfaceNode.node.unlabeled
  if (
    !sweepInput ||
    sweepInput.type !== 'MemberExpression' ||
    sweepInput.property.type !== 'Name'
  ) {
    return null
  }

  return sweepInput.property.name.name
}

function buildEdgeExpr(
  edgeSelection: EdgeSelectionForExpr,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Error | { modifiedAst: Node<Program>; edgeExpr: Expr } {
  if (
    typeof edgeSelection === 'object' &&
    'type' in edgeSelection &&
    edgeSelection.type === 'enginePrimitive'
  ) {
    if (!edgeSelection.parentEntityId) {
      return new Error(
        'Blend primitive edge selections must include a parent entity.'
      )
    }

    const primitiveEdgeResult = insertPrimitiveEdgeVariablesAndOffsetPathToNode(
      {
        primitiveEdgeSelections: [edgeSelection],
        bodies: new Map(),
        modifiedAst: ast,
        artifactGraph,
        wasmInstance,
      }
    )
    if (err(primitiveEdgeResult)) return primitiveEdgeResult

    const primitiveBody = [...primitiveEdgeResult.bodies.values()][0]
    if (!primitiveBody?.solidsExpr) {
      return new Error('Could not resolve the source surface for blend edge.')
    }

    const sourceSurfaceExpr = structuredClone(primitiveBody.solidsExpr)
    const primitiveEdgeIdExpr =
      primitiveBody.tagsExpr.type === 'ArrayExpression'
        ? primitiveBody.tagsExpr.elements[0]
        : primitiveBody.tagsExpr
    if (!primitiveEdgeIdExpr) {
      return new Error(
        'Blend primitive edge selections could not generate an edge identifier.'
      )
    }

    return {
      modifiedAst: ast,
      edgeExpr: createCallExpressionStdLibKw(
        'getBoundedEdge',
        sourceSurfaceExpr,
        [createLabeledArg('edge', primitiveEdgeIdExpr)]
      ),
    }
  }

  const graphEdgeSelection = edgeSelection as Selection
  const edgeArtifact = graphEdgeSelection.artifact
  if (
    !edgeArtifact ||
    (edgeArtifact.type !== 'sweepEdge' && edgeArtifact.type !== 'segment')
  ) {
    return new Error(
      'Blend only supports segment, sweepEdge, and enginePrimitiveEdge selections.'
    )
  }

  const sourceSurfaceArtifact = getSweepArtifactFromSelection(
    graphEdgeSelection,
    artifactGraph
  )
  if (err(sourceSurfaceArtifact)) {
    return sourceSurfaceArtifact
  }

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
    ast,
    wasmInstance
  )
  if (err(sourceSurfaceVars)) return sourceSurfaceVars
  if (sourceSurfaceVars.exprs.length !== 1) {
    return new Error('Expected exactly one source surface for each blend edge.')
  }
  const sourceSurfaceExpr = sourceSurfaceVars.exprs[0]

  const sketchSegmentName = getSketchSegmentNameFromSourceSurface(
    sourceSurfaceArtifact as Artifact,
    ast,
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
    const edgeExpr = getEdgeTagCall(sketchTagExpr, edgeArtifact)

    return {
      modifiedAst: ast,
      edgeExpr: createCallExpressionStdLibKw(
        'getBoundedEdge',
        structuredClone(sourceSurfaceExpr),
        [createLabeledArg('edge', edgeExpr)]
      ),
    }
  }

  const tagResult = modifyAstWithTagsForSelection(
    ast,
    graphEdgeSelection,
    artifactGraph,
    wasmInstance,
    ['oppositeAndAdjacentEdges']
  )
  if (err(tagResult)) return tagResult
  if (tagResult.exprs.length !== 1) {
    return new Error('Expected exactly one tag for each blend edge.')
  }

  const edgeExpr = getEdgeTagCall(tagResult.exprs[0], edgeArtifact)

  return {
    modifiedAst: tagResult.modifiedAst,
    edgeExpr: createCallExpressionStdLibKw(
      'getBoundedEdge',
      structuredClone(sourceSurfaceExpr),
      [createLabeledArg('edge', edgeExpr)]
    ),
  }
}

export function getPrimitiveEdgeSelections(
  edges: Selections
): EnginePrimitiveSelection[] {
  return edges.otherSelections.filter(
    (selection): selection is EnginePrimitiveSelection =>
      isEnginePrimitiveSelection(selection) &&
      selection.primitiveType === 'edge'
  )
}

// Utility functions

/**
 * Groups selections by body and adds tags to the AST.
 * Must be called BEFORE variable insertion to keep artifactGraph paths valid.
 *
 * @param selections - Edge selections to process
 * @param artifactGraph - Graph mapping artifacts to AST nodes
 * @param ast - The AST to modify
 * @param nodeToEdit - Optional path to the node being edited
 * @returns Object containing modified AST and Map of body data, or Error
 */
export function groupSelectionsByBodyAndAddTags(
  selections: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode
):
  | {
      modifiedAst: Node<Program>
      bodies: Map<string, BodySelectionData>
    }
  | Error {
  const selectionsByBody = groupSelectionsByBody(selections, artifactGraph)
  if (err(selectionsByBody)) return selectionsByBody

  let modifiedAst = ast
  const bodies = new Map<string, BodySelectionData>()

  for (const [bodyKey, bodySelections] of selectionsByBody.entries()) {
    // Add tags for graph selections in this body
    const { tagsExprs, modifiedAst: taggedAst } = getTagsExprsFromSelection(
      modifiedAst,
      bodySelections,
      artifactGraph,
      wasmInstance
    )
    modifiedAst = taggedAst

    let bodySelectionForSolids: Selection | undefined
    if (bodySelections.graphSelections.length > 0) {
      const sweep = getSweepArtifactFromSelection(
        bodySelections.graphSelections[0],
        artifactGraph
      )
      if (err(sweep)) return sweep
      bodySelectionForSolids = {
        codeRef: sweep.codeRef,
      }
    }

    // Build solids expression
    const solids: Selections = {
      graphSelections: bodySelectionForSolids ? [bodySelectionForSolids] : [],
      otherSelections: [],
    }

    const vars = getVariableExprsFromSelection(
      solids,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      nodeToEdit,
      {
        lastChildLookup: true,
      }
    )
    if (err(vars)) return vars

    const solidsExpr = createVariableExpressionsArray(vars.exprs)

    if (tagsExprs.length === 0) {
      return new Error('No edges found in the selection')
    }

    const tagsExpr = createVariableExpressionsArray(tagsExprs)
    if (!tagsExpr) {
      return new Error('No edges found in the selection')
    }

    bodies.set(bodyKey, {
      solidsExpr,
      tagsExpr,
      pathIfPipe: vars.pathIfPipe,
    })
  }

  return { modifiedAst, bodies }
}

/**
 * Groups edge selections by their parent editable body.
 * Uses each body's pathToNode as a unique key.
 *
 * @param selections - Edge selections to group by body
 * @param artifactGraph - Graph mapping artifacts to AST nodes
 * @returns Map from body key to selections for that body, or Error
 */
function groupSelectionsByBody(
  selections: Selections,
  artifactGraph: ArtifactGraph
): Map<string, Selections> | Error {
  const bodyToSelections = new Map<string, Selection[]>()

  for (const selection of selections.graphSelections) {
    const sweepArtifact = getSweepArtifactFromSelection(
      selection,
      artifactGraph
    )
    if (err(sweepArtifact)) return sweepArtifact

    const bodyKey = JSON.stringify(sweepArtifact.codeRef.pathToNode)
    if (bodyToSelections.has(bodyKey)) {
      bodyToSelections.get(bodyKey)?.push(selection)
    } else {
      bodyToSelections.set(bodyKey, [selection])
    }
  }

  const result = new Map<string, Selections>()
  for (const [bodyKey, selections] of bodyToSelections.entries()) {
    result.set(bodyKey, {
      graphSelections: selections,
      otherSelections: [],
    })
  }

  return result
}

export function buildSolidsAndTagsExprs(
  faces: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode,
  solidsCount = 1
) {
  const solids: Selections = {
    graphSelections: faces.graphSelections.flatMap((f) => {
      if (!f.artifact) return []
      const sweep = getSweepArtifactFromSelection(f, artifactGraph)
      if (err(sweep) || !sweep) return []
      return {
        artifact: sweep as Artifact,
        codeRef: sweep.codeRef,
      }
    }),
    otherSelections: [],
  }
  // Map the sketches selection into a list of kcl expressions to be passed as unlabeled argument
  const vars = getVariableExprsFromSelection(
    solids,
    artifactGraph,
    ast,
    wasmInstance,
    nodeToEdit,
    {
      lastChildLookup: true,
    }
  )
  if (err(vars)) {
    return vars
  }

  if (vars.exprs.length > solidsCount) {
    return new Error(
      `Selection has more solids (${vars.exprs.length}) than expected (${solidsCount})`
    )
  }

  const pathIfPipe = vars.pathIfPipe
  const solidsExpr = createVariableExpressionsArray(vars.exprs)
  const { tagsExprs, modifiedAst } = getTagsExprsFromSelection(
    ast,
    faces,
    artifactGraph,
    wasmInstance
  )
  const tagsExpr = createVariableExpressionsArray(tagsExprs)
  if (!tagsExpr) {
    return new Error('No edges found in the selection')
  }

  return { solidsExpr, tagsExpr, pathIfPipe, modifiedAst }
}

function getTagsExprsFromSelection(
  ast: Node<Program>,
  edges: Selections,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
) {
  const tagsExprs: Expr[] = []
  let modifiedAst = ast
  for (const edge of edges.graphSelections) {
    if (edge.artifact?.type === 'primitiveEdge') {
      const variable = locateVariableWithCallOrPipe(
        ast,
        edge.codeRef.pathToNode,
        wasmInstance
      )
      if (err(variable)) continue
      tagsExprs.push(createLocalName(variable.variableDeclarator.id.name))
    }

    const result = modifyAstWithTagsForSelection(
      modifiedAst,
      edge,
      artifactGraph,
      wasmInstance
    )
    if (err(result)) {
      console.warn('Failed to add tag for edge selection', result)
      continue
    }

    tagsExprs.push(
      createCallExpressionStdLibKw('getCommonEdge', null, [
        createLabeledArg('faces', createArrayExpression(result.exprs)),
      ])
    )

    modifiedAst = result.modifiedAst
  }
  return { tagsExprs, modifiedAst }
}

// Sort of an opposite of getTagsExprsFromSelection above, used for edit flows
export function retrieveEdgeSelectionsFromOpArgs(
  tagsArg: OpArg,
  artifactGraph: ArtifactGraph
) {
  const tagValues: OpKclValue[] = []
  if (tagsArg.value.type === 'Array') {
    tagValues.push(...tagsArg.value.value)
  } else {
    tagValues.push(tagsArg.value)
  }

  const graphSelections: Selection[] = []
  const unmatchedEdgeEntityIds: string[] = []
  for (const v of tagValues) {
    if (!(v.type == 'Uuid' && v.value)) {
      console.warn('Face value is not a TagIdentifier', v)
      continue
    }

    const artifact = getArtifactOfTypes(
      { key: v.value, types: ['segment', 'sweepEdge', 'primitiveEdge'] },
      artifactGraph
    )
    if (err(artifact)) {
      console.warn(
        'No artifact found for face tag, will try primitive fallback',
        v.value
      )
      unmatchedEdgeEntityIds.push(v.value)
      continue
    }

    const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      console.warn('No codeRefs found for artifact', artifact)
      continue
    }

    graphSelections.push({
      artifact,
      codeRef: codeRefs[0],
    })
  }

  return { graphSelections, otherSelections: [] }
}

// Delete Edge Treatment
// Type Guards
// Edge Treatment Types
export enum EdgeTreatmentType {
  Chamfer = 'chamfer',
  Fillet = 'fillet',
}
// Type Guards
function isEdgeTreatmentType(name: string): name is EdgeTreatmentType {
  return name === EdgeTreatmentType.Chamfer || name === EdgeTreatmentType.Fillet
}
export async function deleteEdgeTreatment(
  ast: Node<Program>,
  selection: Selection,
  wasmInstance: ModuleType
): Promise<Node<Program> | Error> {
  /**
   * Deletes an edge treatment (fillet or chamfer) from the AST
   *
   * Supported cases:
   * [+] fillet and chamfer
   * [+] piped, standalone (assigned and unassigned) edge treatments
   * [-] delete single tag from array of tags (currently whole expression is deleted)
   * [-] multiple selections with different edge treatments (currently single selection is supported)
   */

  // 1. Validate Selection Type
  const { artifact } = selection
  if (!artifact || artifact.type !== 'edgeCut') {
    return new Error('Selection is not an edge cut')
  }

  const { subType } = artifact
  if (!isEdgeTreatmentType(subType)) {
    return new Error('Unsupported or missing edge treatment type')
  }

  // 2. Clone ast and retrieve the edge treatment node
  const astClone = structuredClone(ast)
  const edgeTreatmentNode = getNodeFromPath<
    VariableDeclarator | ExpressionStatement
  >(astClone, selection?.codeRef?.pathToNode, wasmInstance, [
    'VariableDeclarator',
    'ExpressionStatement',
  ])
  if (err(edgeTreatmentNode)) return edgeTreatmentNode

  // 3: Delete edge treatments
  // There 3 possible cases:
  // - piped: const body = extrude(...) |> fillet(...)
  // - assigned to variables: fillet0001 = fillet(...)
  // - unassigned standalone statements: fillet(...)
  // piped and assigned nodes are in the variable declarator
  // unassigned nodes are in the expression statement

  if (
    edgeTreatmentNode.node.type === 'ExpressionStatement' || // unassigned
    (edgeTreatmentNode.node.type === 'VariableDeclarator' && // assigned
      edgeTreatmentNode.node.init?.type !== 'PipeExpression')
  ) {
    // Handle both standalone cases (assigned and unassigned)
    const deleteResult = deleteTopLevelStatement(
      astClone,
      selection.codeRef.pathToNode
    )
    if (err(deleteResult)) return deleteResult
    return astClone
  } else {
    const deleteResult = deleteNodeInExtrudePipe(
      astClone,
      selection.codeRef.pathToNode,
      wasmInstance
    )
    if (err(deleteResult)) return deleteResult
    return astClone
  }
}

export function getEdgeTagCall(
  tag: string | Expr,
  artifact: Artifact
): Node<Expr | CallExpressionKw> {
  let tagCall: Expr = typeof tag === 'string' ? createLocalName(tag) : tag

  // Modify the tag based on selectionType
  if (artifact.type === 'sweepEdge' && artifact.subType === 'opposite') {
    tagCall = createCallExpressionStdLibKw('getOppositeEdge', tagCall, [])
  } else if (artifact.type === 'sweepEdge' && artifact.subType === 'adjacent') {
    tagCall = createCallExpressionStdLibKw('getNextAdjacentEdge', tagCall, [])
  }
  return tagCall
}

// Adds all the edgeId calls needed in the AST so we can refer to them,
// keeps track of their names as "tags",
// and gathers the corresponding solid expressions.
export function insertPrimitiveEdgeVariablesAndOffsetPathToNode({
  primitiveEdgeSelections,
  bodies,
  modifiedAst,
  artifactGraph,
  wasmInstance,
  nodeToEdit,
}: {
  primitiveEdgeSelections: EnginePrimitiveSelection[]
  bodies: Map<string, BodySelectionData>
  modifiedAst: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
}): Error | { bodies: Map<string, BodySelectionData> } {
  if (primitiveEdgeSelections.length === 0) {
    return { bodies }
  }

  const primitiveSelectionsByBody = new Map<
    string,
    {
      bodySelection: Selection
      primitiveIndices: number[]
    }
  >()

  // Step 1. Gather all the indices by body
  for (const selection of primitiveEdgeSelections) {
    if (!selection.parentEntityId) {
      continue
    }

    const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
      selection.parentEntityId,
      artifactGraph
    )
    if (!bodySelection?.artifact) {
      continue
    }

    const bodyKey = JSON.stringify(bodySelection.codeRef.pathToNode)
    const byBody = primitiveSelectionsByBody.get(bodyKey)
    if (byBody) {
      if (!byBody.primitiveIndices.includes(selection.primitiveIndex)) {
        byBody.primitiveIndices.push(selection.primitiveIndex)
      }
    } else {
      primitiveSelectionsByBody.set(bodyKey, {
        bodySelection,
        primitiveIndices: [selection.primitiveIndex],
      })
    }
  }

  if (primitiveSelectionsByBody.size === 0) {
    return { bodies }
  }

  // Step 2. Create an array of variable references to bodies
  const updatedBodies = new Map(bodies)
  let insertIndex = modifiedAst.body.length
  for (const [bodyKey, primitiveData] of primitiveSelectionsByBody.entries()) {
    let bodyData = updatedBodies.get(bodyKey)
    let tagsExprs: Expr[] = []
    let solidsExpr: Expr | null = null
    let pathIfPipe: PathToNode | undefined

    if (bodyData) {
      tagsExprs =
        bodyData.tagsExpr.type === 'ArrayExpression'
          ? [...bodyData.tagsExpr.elements]
          : [bodyData.tagsExpr]
      solidsExpr = bodyData.solidsExpr
      pathIfPipe = bodyData.pathIfPipe
    } else {
      const vars = getVariableExprsFromSelection(
        {
          graphSelections: [primitiveData.bodySelection],
          otherSelections: [],
        },
        artifactGraph,
        modifiedAst,
        wasmInstance,
        nodeToEdit,
        {
          lastChildLookup: true,
        }
      )
      if (err(vars)) return vars
      solidsExpr = createVariableExpressionsArray(vars.exprs)
      pathIfPipe = vars.pathIfPipe
    }

    if (!solidsExpr) {
      return new Error(
        'Could not resolve selected primitive edge bodies in code.'
      )
    }

    // Step 3. Insert variable declarations for edgeId calls
    for (const primitiveIndex of primitiveData.primitiveIndices) {
      const edgeIdExpr = createCallExpressionStdLibKw(
        'edgeId',
        structuredClone(solidsExpr),
        [createLabeledArg('index', createLiteral(primitiveIndex, wasmInstance))]
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
      insertIndex++
      tagsExprs.push(variableIdentifierAst)
    }

    const tagsExpr = createVariableExpressionsArray(tagsExprs)
    if (!tagsExpr) {
      return new Error('No edges found in the selection')
    }

    bodyData = {
      solidsExpr,
      tagsExpr,
      pathIfPipe,
    }
    updatedBodies.set(bodyKey, bodyData)
  }

  return { bodies: updatedBodies }
}

import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createArrayExpression,
  createTagDeclarator,
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
  valueOrVariable,
} from '@src/lang/queryAst'
import { toUtf16 } from '@src/lang/errors'
import type {
  Artifact,
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  ExpressionStatement,
  Name,
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
    mNodeToEdit,
    { includePrimitiveEdgeIndices: true }
  )
  if (err(bodyData)) return bodyData
  modifiedAst = bodyData.modifiedAst

  // Insert variables for labeled arguments if provided
  if ('variableName' in radius && radius.variableName) {
    insertVariableAndOffsetPathToNode(radius, modifiedAst, mNodeToEdit)
  }

  // 3. Create fillet calls for each body
  const pathToNodes: PathToNode[] = []
  for (const data of bodyData.bodies.values()) {
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
    mNodeToEdit,
    { includePrimitiveEdgeIndices: true }
  )
  if (err(bodyData)) return bodyData
  modifiedAst = bodyData.modifiedAst

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
  for (const data of bodyData.bodies.values()) {
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

function getEdgeSelections(edges: Selections): EdgeSelectionForExpr[] {
  return [
    ...edges.graphSelections,
    ...edges.otherSelections.filter(
      (selection): selection is EnginePrimitiveSelection =>
        isEnginePrimitiveSelection(selection) &&
        selection.primitiveType === 'edge'
    ),
  ]
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

    const sourceSurfaceSelection = getBodySelectionFromPrimitiveParentEntityId(
      edgeSelection.parentEntityId,
      artifactGraph
    )
    if (!sourceSurfaceSelection) {
      return new Error('Could not resolve the source surface for blend edge.')
    }

    const sourceSurfaceVars = getVariableExprsFromSelection(
      {
        graphSelections: [sourceSurfaceSelection],
        otherSelections: [],
      },
      ast,
      wasmInstance
    )
    if (err(sourceSurfaceVars)) return sourceSurfaceVars
    if (sourceSurfaceVars.exprs.length !== 1) {
      return new Error(
        'Expected exactly one source surface for each blend edge.'
      )
    }

    const sourceSurfaceExpr = structuredClone(sourceSurfaceVars.exprs[0])
    const primitiveEdgeIdExpr = createCallExpressionStdLibKw(
      'edgeId',
      structuredClone(sourceSurfaceExpr),
      [
        createLabeledArg(
          'index',
          createLiteral(edgeSelection.primitiveIndex, wasmInstance)
        ),
      ]
    )

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

  const tagResult = modifyAstWithTagsForSelection(
    ast,
    graphEdgeSelection,
    artifactGraph,
    wasmInstance,
    ['oppositeAndAdjacentEdges']
  )
  if (err(tagResult)) return tagResult
  if (tagResult.tags.length !== 1) {
    return new Error('Expected exactly one tag for each blend edge.')
  }

  const edgeExpr = getEdgeTagCall(tagResult.tags[0], edgeArtifact)
  if (edgeExpr.type === 'Name') {
    return {
      modifiedAst: tagResult.modifiedAst,
      edgeExpr,
    }
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
    ast,
    wasmInstance
  )
  if (err(sourceSurfaceVars)) return sourceSurfaceVars
  if (sourceSurfaceVars.exprs.length !== 1) {
    return new Error('Expected exactly one source surface for each blend edge.')
  }

  const sourceSurfaceExpr = structuredClone(sourceSurfaceVars.exprs[0])

  return {
    modifiedAst: tagResult.modifiedAst,
    edgeExpr: createCallExpressionStdLibKw(
      'getBoundedEdge',
      sourceSurfaceExpr,
      [createLabeledArg('edge', edgeExpr)]
    ),
  }
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
function groupSelectionsByBodyAndAddTags(
  selections: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode,
  options: {
    includePrimitiveEdgeIndices?: boolean
  } = {}
):
  | {
      modifiedAst: Node<Program>
      bodies: Map<
        string,
        {
          solidsExpr: Expr | null
          tagsExpr: Expr
          pathIfPipe?: PathToNode
        }
      >
    }
  | Error {
  const { includePrimitiveEdgeIndices = false } = options
  const selectionsByBody = groupSelectionsByBody(selections, artifactGraph)
  if (err(selectionsByBody)) return selectionsByBody

  const primitiveSelectionsByBody = new Map<
    string,
    {
      bodySelection: Selection
      primitiveIndices: number[]
    }
  >()
  if (includePrimitiveEdgeIndices) {
    for (const selection of selections.otherSelections) {
      if (!isEnginePrimitiveSelection(selection) || !selection.parentEntityId) {
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

      if (!selectionsByBody.has(bodyKey)) {
        selectionsByBody.set(bodyKey, {
          graphSelections: [],
          otherSelections: [],
        })
      }
    }
  }

  if (selectionsByBody.size === 0) {
    return new Error('No edges found in the selection')
  }

  let modifiedAst = ast
  const bodies = new Map<
    string,
    {
      solidsExpr: Expr | null
      tagsExpr: Expr
      pathIfPipe?: PathToNode
    }
  >()

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
    } else {
      bodySelectionForSolids =
        primitiveSelectionsByBody.get(bodyKey)?.bodySelection
    }

    // Build solids expression
    const solids: Selections = {
      graphSelections: bodySelectionForSolids ? [bodySelectionForSolids] : [],
      otherSelections: [],
    }

    const vars = getVariableExprsFromSelection(
      solids,
      modifiedAst,
      wasmInstance,
      nodeToEdit,
      true,
      artifactGraph
    )
    if (err(vars)) return vars

    const solidsExpr = createVariableExpressionsArray(vars.exprs)
    const primitiveIndices = includePrimitiveEdgeIndices
      ? (primitiveSelectionsByBody.get(bodyKey)?.primitiveIndices ?? [])
      : []
    for (const primitiveIndex of primitiveIndices) {
      if (!solidsExpr) {
        return new Error(
          'Could not resolve selected primitive edge bodies in code.'
        )
      }
      tagsExprs.push(
        createCallExpressionStdLibKw('edgeId', structuredClone(solidsExpr), [
          createLabeledArg(
            'index',
            createLiteral(primitiveIndex, wasmInstance)
          ),
        ])
      )
    }

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
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    ast,
    wasmInstance,
    nodeToEdit,
    lastChildLookup,
    artifactGraph
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
        createLabeledArg(
          'faces',
          createArrayExpression(result.tags.map((tag) => createLocalName(tag)))
        ),
      ])
    )

    modifiedAst = result.modifiedAst
  }
  return { tagsExprs, modifiedAst }
}

// Sort of an opposite of getTagsExprsFromSelection above, used for edit flows
export function retrieveEdgeSelectionsFromOpArgs(
  solidArg: OpArg,
  tagsArg: OpArg,
  artifactGraph: ArtifactGraph,
  code: string
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
      { key: v.value, types: ['segment', 'sweepEdge'] },
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

  const primitiveIndices = getPrimitiveEdgeIndicesFromTagsArg(tagsArg, code)
  // Assumption: solidArg and edgeId's solidArg are the same
  const parentEntityId =
    solidArg?.value.type === 'Solid'
      ? solidArg.value.value.artifactId
      : undefined
  const otherSelections: EnginePrimitiveSelection[] = []
  if (
    primitiveIndices.length > 0 &&
    unmatchedEdgeEntityIds.length === primitiveIndices.length &&
    parentEntityId
  ) {
    primitiveIndices.forEach((primitiveIndex, i) => {
      otherSelections.push({
        type: 'enginePrimitive',
        entityId: unmatchedEdgeEntityIds[i],
        parentEntityId,
        primitiveIndex,
        primitiveType: 'edge',
      })
    })
  }

  return { graphSelections, otherSelections }
}

function getPrimitiveEdgeIndicesFromTagsArg(
  tagsArg: OpArg,
  code: string
): number[] {
  if (tagsArg.sourceRange.length < 2) {
    return []
  }

  const start = toUtf16(tagsArg.sourceRange[0], code)
  const end = toUtf16(tagsArg.sourceRange[1], code)
  if (start < 0 || end <= start || end > code.length) {
    return []
  }

  const tagsSource = code.slice(start, end)
  const edgeIdPattern = /edgeId\s*\(\s*[\s\S]*?,\s*index\s*=\s*(-?\d+)\s*\)/g
  const indices: number[] = []
  for (const match of tagsSource.matchAll(edgeIdPattern)) {
    const index = Number.parseInt(match[1], 10)
    if (!Number.isNaN(index)) {
      indices.push(index)
    }
  }
  return indices
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
  tag: string,
  artifact: Artifact
): Node<Name | CallExpressionKw> {
  let tagCall: Expr = createLocalName(tag)

  // Modify the tag based on selectionType
  if (artifact.type === 'sweepEdge' && artifact.subType === 'opposite') {
    tagCall = createCallExpressionStdLibKw('getOppositeEdge', tagCall, [])
  } else if (artifact.type === 'sweepEdge' && artifact.subType === 'adjacent') {
    tagCall = createCallExpressionStdLibKw('getNextAdjacentEdge', tagCall, [])
  }
  return tagCall
}

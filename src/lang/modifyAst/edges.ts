import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createObjectExpression,
  createArrayExpression,
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
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type {
  Artifact,
  ArtifactGraph,
  CallExpressionKw,
  CodeRef,
  DirectTagFilletMeta,
  EdgeRefactorMeta,
  Expr,
  ExpressionStatement,
  MemberExpression,
  Name,
  PathToNode,
  Program,
  VariableDeclarator,
} from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type {
  Selection,
  Selections,
  EnginePrimitiveSelection,
} from '@src/machines/modelingSharedTypes'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import {
  modifyAstWithTagsForSelection,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/tagManagement'
import { getBodySelectionFromPrimitiveParentEntityId } from '@src/lang/modifyAst/faces'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import { deleteNodeInExtrudePipe } from '@src/lang/modifyAst/deleteNodeInExtrudePipe'
import { findKwArg } from '@src/lang/util'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { isEnginePrimitiveSelection } from '@src/lib/selections'

function createMemberExpr(
  object: Expr,
  propertyName: string
): Node<MemberExpression> {
  return {
    type: 'MemberExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    object,
    property: createLocalName(propertyName),
    computed: false,
  }
}

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
  let modifiedAst = structuredClone(ast as Node<Program>)
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
  let modifiedAst = structuredClone(ast as Node<Program>)
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
  let modifiedAst = structuredClone(ast as Node<Program>)

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
    artifactGraph,
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

function getPrimitiveEdgeSelections(
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
function groupSelectionsByBodyAndAddTags(
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

type FilletEdgeRefPayload = {
  side_faces: string[]
  end_faces?: string[]
  index?: number
}

export function createEdgeRefObjectExpression(
  payload: FilletEdgeRefPayload,
  wasmInstance: ModuleType,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  originalEdgeSelection?: Selection,
  fallbackCodeRef?: CodeRef,
  tagsBaseExpr?: Expr | null
): { expr: Expr; modifiedAst: Node<Program> } | Error {
  const faceTags: string[] = []
  let currentAst = ast

  for (const faceId of payload.side_faces) {
    const faceArtifact = artifactGraph.get(faceId)
    if (!faceArtifact) {
      return new Error(
        `Could not find artifact for face ${faceId} in edge reference`
      )
    }

    const codeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
    if (!codeRefs?.length) {
      return new Error(
        `Could not find codeRefs for face ${faceId} in edge reference`
      )
    }

    if (faceArtifact.type === 'solid2d') {
      let segmentPathToNode: PathToNode | undefined

      if (
        originalEdgeSelection?.artifact &&
        originalEdgeSelection.artifact.type === 'segment'
      ) {
        segmentPathToNode = originalEdgeSelection.artifact.codeRef.pathToNode
      } else if (fallbackCodeRef?.pathToNode) {
        segmentPathToNode = fallbackCodeRef.pathToNode
      } else if (codeRefs[0]?.pathToNode) {
        segmentPathToNode = codeRefs[0].pathToNode
      }

      if (!segmentPathToNode?.length) {
        return new Error(
          `Cannot create tag for Solid2D edge ${faceId}: missing segment path`
        )
      }

      const tagResult = mutateAstWithTagForSketchSegment(
        currentAst,
        segmentPathToNode,
        wasmInstance
      )
      if (err(tagResult)) {
        return new Error(
          `Failed to create tag for Solid2D edge ${faceId}: ${tagResult.message}`
        )
      }

      faceTags.push(tagResult.tag)
      currentAst = tagResult.modifiedAst
    } else {
      const tagResult = modifyAstWithTagsForSelection(
        currentAst,
        {
          artifact: faceArtifact,
          codeRef: codeRefs[0],
        },
        artifactGraph,
        wasmInstance
      )
      if (err(tagResult)) {
        return new Error(
          `Failed to create tag for face ${faceId}: ${tagResult.message}`
        )
      }

      faceTags.push(tagResult.tags[0])
      currentAst = tagResult.modifiedAst
    }
  }

  const disambiguatorTags: string[] = []
  if (payload.end_faces?.length) {
    for (const faceId of payload.end_faces) {
      const faceArtifact = artifactGraph.get(faceId)
      if (!faceArtifact) continue
      const codeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
      if (!codeRefs?.length) continue

      const tagResult = modifyAstWithTagsForSelection(
        currentAst,
        {
          artifact: faceArtifact,
          codeRef: codeRefs[0],
        },
        artifactGraph,
        wasmInstance
      )
      if (err(tagResult)) continue

      disambiguatorTags.push(tagResult.tags[0])
      currentAst = tagResult.modifiedAst
    }
  }

  const sideFacesExprs =
    tagsBaseExpr != null
      ? faceTags.map((tag) =>
          createMemberExpr(createMemberExpr(tagsBaseExpr, 'tags'), tag)
        )
      : faceTags.map((tag) => createLocalName(tag))

  const properties: Record<string, Expr> = {
    sideFaces: createArrayExpression(sideFacesExprs),
  }

  if (disambiguatorTags.length > 0) {
    properties.endFaces = createArrayExpression(
      tagsBaseExpr != null
        ? disambiguatorTags.map((tag) =>
            createMemberExpr(createMemberExpr(tagsBaseExpr, 'tags'), tag)
          )
        : disambiguatorTags.map((tag) => createLocalName(tag))
    )
  }

  if (payload.index !== undefined) {
    properties.index = createLiteral(payload.index, wasmInstance)
  }

  return {
    expr: createObjectExpression(properties),
    modifiedAst: currentAst,
  }
}

const DEPRECATED_EDGE_STDLIB = [
  'getOppositeEdge',
  'getNextAdjacentEdge',
  'getPreviousAdjacentEdge',
  'getCommonEdge',
  'edgeId',
] as const

function isFilletOrChamfer(callee: string): boolean {
  return callee === 'fillet' || callee === 'chamfer'
}

function isRevolveOrHelix(callee: string): boolean {
  return callee === 'revolve' || callee === 'helix'
}

function isExtrude(callee: string): boolean {
  return callee === 'extrude'
}

function getTagsElementsFromCall(call: Node<CallExpressionKw>): Expr[] | null {
  const tagsArg = call.arguments?.find(
    (a) => (a.label as { name?: string })?.name === 'tags'
  )
  if (!tagsArg?.arg) return null
  if (tagsArg.arg.type === 'ArrayExpression') {
    return tagsArg.arg.elements ?? null
  }
  return [tagsArg.arg]
}

function getExistingEdgeRefsFromCall(call: Node<CallExpressionKw>): Expr[] {
  const edgeRefsArg = call.arguments?.find(
    (a) =>
      (a.label as { name?: string })?.name === 'edges' ||
      (a.label as { name?: string })?.name === 'edgeRefs'
  )
  if (!edgeRefsArg?.arg || edgeRefsArg.arg.type !== 'ArrayExpression') {
    return []
  }
  return edgeRefsArg.arg.elements ?? []
}

function getTagsBaseFromTagElement(el: Expr): Expr | null {
  if (el.type !== 'CallExpressionKw') return null
  const inner = el as Node<CallExpressionKw>
  const calleeName = (inner.callee as { name?: { name?: string } })?.name?.name
  if (
    !calleeName ||
    !(DEPRECATED_EDGE_STDLIB as readonly string[]).includes(calleeName)
  ) {
    return null
  }

  const firstArg = inner.unlabeled ?? null
  if (!firstArg || firstArg.type !== 'MemberExpression') return null
  const outerMember = firstArg as { object: Expr; property: Expr }
  if (outerMember.object.type !== 'MemberExpression') return null
  const innerMember = outerMember.object as { object: Expr; property: Expr }
  const propName = (innerMember.property as { name?: { name?: string } }).name
    ?.name
  if (propName !== 'tags') return null
  return innerMember.object
}

function callSourceRangeMatches(
  meta: DirectTagFilletMeta,
  start: number,
  end: number,
  moduleId: number
): boolean {
  const sr = meta.callSourceRange
  if (isArray(sr)) {
    return (
      Number(sr[0]) === start &&
      Number(sr[1]) === end &&
      Number((sr as [number, number, number])[2] ?? 0) === moduleId
    )
  }
  const sourceRange = sr as { start?: number; end?: number; moduleId?: number }
  return (
    Number(sourceRange.start ?? 0) === start &&
    Number(sourceRange.end ?? 0) === end &&
    Number(sourceRange.moduleId ?? 0) === moduleId
  )
}

function sourceRangeMatch(
  meta: EdgeRefactorMeta,
  start: number,
  end: number,
  moduleId: number
): boolean {
  const sr = meta.sourceRange
  const metaStart = isArray(sr)
    ? sr[0]
    : ((sr as { start?: number }).start ?? 0)
  const metaEnd = isArray(sr) ? sr[1] : ((sr as { end?: number }).end ?? 0)
  const metaModuleId = isArray(sr)
    ? (sr[2] ?? 0)
    : ((sr as { moduleId?: number }).moduleId ?? 0)
  if (metaModuleId !== moduleId) return false
  if (metaStart === start && metaEnd === end) return true
  if (metaStart <= start && metaEnd >= end) return true
  if (start <= metaEnd && end >= metaStart) return true
  return false
}

interface UnifiedCallToFix {
  range: [number, number, number]
  orderedFaceIds: [string, string][]
  hasExistingEdgeRefs: boolean
  tagsBaseExpr?: Expr | null
}

function findFilletChamferCallsToFixUnified(
  program: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  directTagFilletMetadata: DirectTagFilletMeta[]
): UnifiedCallToFix[] {
  const results: UnifiedCallToFix[] = []

  function visitExpr(expr: Expr): void {
    if (expr.type !== 'CallExpressionKw') {
      walkExpr(expr)
      return
    }
    const call = expr as Node<CallExpressionKw>
    const calleeName = (call.callee as { name?: { name?: string } })?.name?.name
    if (!calleeName || !isFilletOrChamfer(calleeName)) {
      walkExpr(expr)
      return
    }

    const elements = getTagsElementsFromCall(call)
    const existingEdgeRefExprs = getExistingEdgeRefsFromCall(call)
    const orderedFaceIds: [string, string][] = []
    let tagsBaseExpr: Expr | null = null

    if (elements?.length) {
      for (const el of elements) {
        if (tagsBaseExpr === null) {
          tagsBaseExpr = getTagsBaseFromTagElement(el)
        }

        if (el.type === 'CallExpressionKw') {
          const inner = el as Node<CallExpressionKw>
          const innerCallee = (inner.callee as { name?: { name?: string } })
            ?.name?.name
          if (
            innerCallee &&
            (DEPRECATED_EDGE_STDLIB as readonly string[]).includes(innerCallee)
          ) {
            const meta = edgeRefactorMetadata.find((m) =>
              sourceRangeMatch(
                m,
                inner.start,
                inner.end,
                (inner as { module_id?: number }).module_id ?? 0
              )
            )
            if (meta) {
              orderedFaceIds.push(meta.faceIds)
            }
          }
        } else if (el.type === 'Name') {
          const tagName = (el as Node<Name>).name?.name ?? ''
          const moduleId = (call as { module_id?: number }).module_id ?? 0
          const directMeta = directTagFilletMetadata.find((m) =>
            callSourceRangeMatches(m, call.start, call.end, moduleId)
          )
          const tagEntry = directMeta?.tags?.find(
            (t) => t.tagIdentifier === tagName
          )
          if (tagEntry) {
            orderedFaceIds.push(tagEntry.faceIds)
          }
        }
      }
    }

    if (orderedFaceIds.length > 0 || existingEdgeRefExprs.length > 0) {
      const moduleId = (call as { module_id?: number }).module_id ?? 0
      results.push({
        range: [call.start, call.end, moduleId],
        orderedFaceIds,
        hasExistingEdgeRefs: existingEdgeRefExprs.length > 0,
        tagsBaseExpr: tagsBaseExpr ?? undefined,
      })
    }

    walkExpr(expr)
  }

  function walkExpr(expr: Expr): void {
    if (expr.type === 'PipeExpression') {
      const body = (expr as { body?: Expr[] }).body
      if (isArray(body)) body.forEach(visitExpr)
      return
    }
    if (expr.type === 'CallExpressionKw') {
      if (expr.unlabeled) visitExpr(expr.unlabeled)
      for (const arg of expr.arguments ?? []) visitExpr(arg.arg)
      return
    }
    if (expr.type === 'BinaryExpression') {
      if (expr.left) walkExpr(expr.left)
      if (expr.right) walkExpr(expr.right)
      return
    }
    if (expr.type === 'ArrayExpression') {
      for (const element of expr.elements ?? []) walkExpr(element)
      return
    }
    if (expr.type === 'ObjectExpression') {
      for (const property of expr.properties ?? []) walkExpr(property.value)
      return
    }
    if (expr.type === 'LabelledExpression') visitExpr(expr.expr)
    else if (expr.type === 'AscribedExpression') visitExpr(expr.expr)
    else if (expr.type === 'UnaryExpression') walkExpr(expr.argument)
    else if (expr.type === 'MemberExpression') {
      walkExpr(expr.object)
      walkExpr(expr.property)
    }
  }

  for (const item of program.body ?? []) {
    if (item.type === 'VariableDeclaration' && item.declaration?.init) {
      visitExpr(item.declaration.init)
    } else if (item.type === 'ExpressionStatement' && item.expression) {
      visitExpr(item.expression)
    } else if (
      item.type === 'ReturnStatement' &&
      (item as { argument?: Expr }).argument
    ) {
      visitExpr((item as { argument: Expr }).argument)
    }
  }

  return results
}

function findFilletChamferCallsToFix(
  program: Program,
  metadata: EdgeRefactorMeta[]
): { range: [number, number, number]; orderedMetas: EdgeRefactorMeta[] }[] {
  const results: {
    range: [number, number, number]
    orderedMetas: EdgeRefactorMeta[]
  }[] = []

  function visitExpr(expr: Expr): void {
    if (expr.type !== 'CallExpressionKw') {
      walkExpr(expr)
      return
    }
    const call = expr as Node<CallExpressionKw>
    const calleeName = (call.callee as { name?: { name?: string } })?.name?.name
    if (!calleeName || !isFilletOrChamfer(calleeName)) {
      walkExpr(expr)
      return
    }
    const elements = getTagsElementsFromCall(call)
    if (!elements?.length) {
      walkExpr(expr)
      return
    }

    const deprecatedRanges: { start: number; end: number; moduleId: number }[] =
      []
    for (const el of elements) {
      if (el.type !== 'CallExpressionKw') continue
      const inner = el as Node<CallExpressionKw>
      const innerCallee = (inner.callee as { name?: { name?: string } })?.name
        ?.name
      if (
        !innerCallee ||
        !(DEPRECATED_EDGE_STDLIB as readonly string[]).includes(innerCallee)
      ) {
        continue
      }
      deprecatedRanges.push({
        start: inner.start,
        end: inner.end,
        moduleId: (inner as { module_id?: number }).module_id ?? 0,
      })
    }
    if (deprecatedRanges.length === 0) {
      walkExpr(expr)
      return
    }

    const orderedMetas: EdgeRefactorMeta[] = []
    for (const range of deprecatedRanges) {
      const meta = metadata.find((m) =>
        sourceRangeMatch(m, range.start, range.end, range.moduleId)
      )
      if (!meta) {
        walkExpr(expr)
        return
      }
      orderedMetas.push(meta)
    }

    const moduleId = (call as { module_id?: number }).module_id ?? 0
    results.push({
      range: [call.start, call.end, moduleId],
      orderedMetas,
    })
    walkExpr(expr)
  }

  function walkExpr(expr: Expr): void {
    if (expr.type === 'PipeExpression') {
      const body = (expr as { body?: Expr[] }).body
      if (isArray(body)) body.forEach(visitExpr)
      return
    }
    if (expr.type === 'CallExpressionKw') {
      if (expr.unlabeled) visitExpr(expr.unlabeled)
      for (const arg of expr.arguments ?? []) visitExpr(arg.arg)
      return
    }
    if (expr.type === 'BinaryExpression') {
      if (expr.left) walkExpr(expr.left)
      if (expr.right) walkExpr(expr.right)
      return
    }
    if (expr.type === 'ArrayExpression') {
      for (const element of expr.elements ?? []) walkExpr(element)
      return
    }
    if (expr.type === 'ObjectExpression') {
      for (const property of expr.properties ?? []) walkExpr(property.value)
      return
    }
    if (expr.type === 'LabelledExpression') visitExpr(expr.expr)
    else if (expr.type === 'AscribedExpression') visitExpr(expr.expr)
    else if (expr.type === 'UnaryExpression') walkExpr(expr.argument)
    else if (expr.type === 'MemberExpression') {
      walkExpr(expr.object)
      walkExpr(expr.property)
    }
  }

  for (const item of program.body ?? []) {
    if (item.type === 'VariableDeclaration' && item.declaration?.init) {
      visitExpr(item.declaration.init)
    } else if (item.type === 'ExpressionStatement' && item.expression) {
      visitExpr(item.expression)
    } else if (
      item.type === 'ReturnStatement' &&
      (item as { argument?: Expr }).argument
    ) {
      visitExpr((item as { argument: Expr }).argument)
    }
  }

  return results
}

export function refactorFilletChamferTagsToEdgeRefs(
  ast: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | Error {
  if (!edgeRefactorMetadata?.length) {
    return new Error('No edge refactor metadata')
  }

  let modifiedAst = structuredClone(ast as Node<Program>)
  const toFix = findFilletChamferCallsToFix(ast, edgeRefactorMetadata)
  for (const { range, orderedMetas } of toFix) {
    const path = getNodePathFromSourceRange(modifiedAst, range)
    const edgeRefExprs: Expr[] = []
    for (const meta of orderedMetas) {
      const result = createEdgeRefObjectExpression(
        { side_faces: meta.faceIds },
        wasmInstance,
        modifiedAst,
        artifactGraph
      )
      if (err(result)) continue
      edgeRefExprs.push(result.expr)
      modifiedAst = result.modifiedAst
    }
    if (edgeRefExprs.length === 0) continue

    const nodeResult = getNodeFromPath(modifiedAst, path, wasmInstance, [
      'CallExpressionKw',
    ])
    if (err(nodeResult)) continue
    const callNode = nodeResult.node as Node<CallExpressionKw>
    const tagsIndex = callNode.arguments?.findIndex(
      (a) => (a.label as { name?: string })?.name === 'tags'
    )
    if (tagsIndex === undefined || tagsIndex < 0) continue

    callNode.arguments[tagsIndex] = createLabeledArg(
      'edges',
      createArrayExpression(edgeRefExprs)
    )
  }

  const out = recast(modifiedAst, wasmInstance)
  return err(out) ? out : out
}

export function refactorFilletChamferTagsToEdgeRefsUnified(
  ast: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  directTagFilletMetadata: DirectTagFilletMeta[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | Error {
  const toFix = findFilletChamferCallsToFixUnified(
    ast,
    edgeRefactorMetadata,
    directTagFilletMetadata
  )
  if (toFix.length === 0) {
    return new Error('No fillet/chamfer calls with tags or edges to convert')
  }

  let modifiedAst = structuredClone(ast as Node<Program>)
  for (const {
    range,
    orderedFaceIds,
    hasExistingEdgeRefs,
    tagsBaseExpr,
  } of toFix) {
    const path = getNodePathFromSourceRange(modifiedAst, range)
    const edgeRefExprs: Expr[] = []
    for (const faceIds of orderedFaceIds) {
      const result = createEdgeRefObjectExpression(
        { side_faces: faceIds },
        wasmInstance,
        modifiedAst,
        artifactGraph,
        undefined,
        undefined,
        tagsBaseExpr
      )
      if (err(result)) continue
      edgeRefExprs.push(result.expr)
      modifiedAst = result.modifiedAst
    }

    const nodeResult = getNodeFromPath(modifiedAst, path, wasmInstance, [
      'CallExpressionKw',
    ])
    if (err(nodeResult)) continue
    const callNode = nodeResult.node as Node<CallExpressionKw>
    if (hasExistingEdgeRefs) {
      edgeRefExprs.push(...getExistingEdgeRefsFromCall(callNode))
    }
    if (edgeRefExprs.length === 0) continue

    const newArgs = (callNode.arguments ?? []).filter(
      (a) =>
        (a.label as { name?: string })?.name !== 'tags' &&
        (a.label as { name?: string })?.name !== 'edges' &&
        (a.label as { name?: string })?.name !== 'edgeRefs'
    )
    newArgs.push(createLabeledArg('edges', createArrayExpression(edgeRefExprs)))
    callNode.arguments = newArgs
  }

  const out = recast(modifiedAst, wasmInstance)
  return err(out) ? out : out
}

interface RevolveHelixCallToFix {
  range: [number, number, number]
  faceIds: [string, string]
  pathToCall?: PathToNode
}

interface ExtrudeToCallToFix {
  range: [number, number, number]
  faceIds: [string, string]
  pathToCall?: PathToNode
}

function getCallFromExpr(expr: Expr): Node<CallExpressionKw> | null {
  if (!expr || typeof expr !== 'object') return null
  const objectValue = expr as Record<string, unknown>
  if (objectValue.type === 'CallExpressionKw') {
    return objectValue as Node<CallExpressionKw>
  }
  const wrapped = objectValue.CallExpressionKw
  return wrapped && typeof wrapped === 'object'
    ? (wrapped as Node<CallExpressionKw>)
    : null
}

function getCallPathFromExpr(
  expr: Expr,
  pathPrefix?: PathToNode
): PathToNode | undefined {
  if (!pathPrefix?.length) return undefined
  const objectValue = expr as Record<string, unknown>
  if (objectValue.type === 'CallExpressionKw') return [...pathPrefix]
  if (
    objectValue.CallExpressionKw &&
    typeof objectValue.CallExpressionKw === 'object'
  ) {
    return [...pathPrefix, ['CallExpressionKw', '']]
  }
  return undefined
}

export function findRevolveHelixCallsToFix(
  program: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[]
): RevolveHelixCallToFix[] {
  const results: RevolveHelixCallToFix[] = []
  const candidates: {
    range: [number, number, number]
    faceIds: [string, string]
    metaIndex: number
    pathToCall: PathToNode
  }[] = []

  function visitExpr(expr: Expr, pathPrefix?: PathToNode): void {
    const call = getCallFromExpr(expr)
    if (!call) {
      walkExpr(expr, pathPrefix)
      return
    }

    const callPath = getCallPathFromExpr(expr, pathPrefix)
    const calleeName = (call.callee as { name?: { name?: string } })?.name?.name
    if (!calleeName || !isRevolveOrHelix(calleeName)) {
      walkExpr(expr, pathPrefix)
      return
    }

    const axisArg = findKwArg('axis', call)
    const inner = axisArg ? getCallFromExpr(axisArg) : null
    if (!inner) {
      walkExpr(expr, pathPrefix)
      return
    }
    const innerCallee = (inner.callee as { name?: { name?: string } })?.name
      ?.name
    if (
      !innerCallee ||
      !(DEPRECATED_EDGE_STDLIB as readonly string[]).includes(innerCallee)
    ) {
      walkExpr(expr, pathPrefix)
      return
    }

    const innerStart = Number((inner as { start?: number }).start ?? 0)
    const innerEnd = Number((inner as { end?: number }).end ?? 0)
    const innerModuleId = (inner as { module_id?: number }).module_id ?? 0
    const meta = edgeRefactorMetadata.find((m) =>
      sourceRangeMatch(m, innerStart, innerEnd, innerModuleId)
    )
    const moduleId = (call as { module_id?: number }).module_id ?? 0
    const callStart = Number((call as { start?: number }).start ?? 0)
    const callEnd = Number((call as { end?: number }).end ?? 0)
    if (meta) {
      results.push({
        range: [callStart, callEnd, moduleId],
        faceIds: [meta.faceIds[0], meta.faceIds[1]],
        pathToCall: callPath,
      })
    } else {
      const metaIndex = edgeRefactorMetadata.findIndex((m) => {
        const ids = isArray(m.faceIds)
          ? m.faceIds
          : (m as { faceIds?: unknown[] }).faceIds
        return Boolean(ids && ids.length >= 2)
      })
      if (metaIndex >= 0 && callPath?.length) {
        const metadata = edgeRefactorMetadata[metaIndex]
        const faceIds = isArray(metadata.faceIds)
          ? ([metadata.faceIds[0], metadata.faceIds[1]] as [string, string])
          : ([
              (metadata as { faceIds?: string[] }).faceIds?.[0],
              (metadata as { faceIds?: string[] }).faceIds?.[1],
            ].filter(Boolean) as [string, string])
        if (faceIds.length === 2) {
          candidates.push({
            range: [callStart, callEnd, moduleId],
            faceIds,
            metaIndex,
            pathToCall: callPath,
          })
        }
      }
    }
    walkExpr(expr, pathPrefix)
  }

  function walkExpr(expr: Expr, pathPrefix?: PathToNode): void {
    if (expr.type === 'PipeExpression') {
      for (const bodyExpr of (expr as { body?: Expr[] }).body ?? []) {
        visitExpr(bodyExpr, pathPrefix)
      }
      return
    }
    const callExpr = getCallFromExpr(expr)
    if (callExpr) {
      if (callExpr.unlabeled) walkExpr(callExpr.unlabeled, pathPrefix)
      for (const arg of callExpr.arguments ?? []) walkExpr(arg.arg, pathPrefix)
      return
    }
    if (expr.type === 'BinaryExpression') {
      if (expr.left) walkExpr(expr.left, pathPrefix)
      if (expr.right) walkExpr(expr.right, pathPrefix)
      return
    }
    if (expr.type === 'ArrayExpression') {
      for (const element of expr.elements ?? []) walkExpr(element, pathPrefix)
      return
    }
    if (expr.type === 'ObjectExpression') {
      for (const property of expr.properties ?? []) {
        walkExpr(property.value, pathPrefix)
      }
      return
    }
    if (expr.type === 'LabelledExpression') visitExpr(expr.expr, pathPrefix)
    else if (expr.type === 'AscribedExpression')
      visitExpr(expr.expr, pathPrefix)
    else if (expr.type === 'UnaryExpression')
      walkExpr(expr.argument, pathPrefix)
    else if (expr.type === 'MemberExpression') {
      walkExpr(expr.object, pathPrefix)
      walkExpr(expr.property, pathPrefix)
    }
  }

  const body = program.body ?? []
  for (let statementIndex = 0; statementIndex < body.length; statementIndex++) {
    const item = body[statementIndex] as {
      type?: string
      declaration?: { init?: Expr }
      expression?: Expr
      argument?: Expr
    }
    const pathPrefix: PathToNode = [
      ['body', ''],
      [statementIndex, 'index'],
    ]
    if (item.type === 'VariableDeclaration' && item.declaration?.init) {
      visitExpr(item.declaration.init, [
        ...pathPrefix,
        ['declaration', 'VariableDeclaration'],
        ['init', ''],
      ])
    } else if (item.type === 'ExpressionStatement' && item.expression) {
      visitExpr(item.expression, [
        ...pathPrefix,
        ['expression', 'ExpressionStatement'],
      ])
    } else if (
      item.type === 'ReturnStatement' &&
      (item as { argument?: Expr }).argument
    ) {
      visitExpr((item as { argument: Expr }).argument, [
        ...pathPrefix,
        ['argument', 'ReturnStatement'],
      ])
    }
  }

  if (results.length === 0 && candidates.length > 0) {
    const used = new Set<number>()
    for (const candidate of candidates) {
      if (used.has(candidate.metaIndex)) continue
      used.add(candidate.metaIndex)
      results.push({
        range: candidate.range,
        faceIds: candidate.faceIds,
        pathToCall: candidate.pathToCall,
      })
      break
    }
  }

  return results
}

function findToArg(call: Node<CallExpressionKw>): Expr | null {
  const arg = call.arguments?.find(
    (a) => (a.label as { name?: string })?.name === 'to'
  )
  return arg?.arg ?? null
}

export function findExtrudeToCallsToFix(
  program: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[]
): ExtrudeToCallToFix[] {
  const results: ExtrudeToCallToFix[] = []
  const candidates: {
    range: [number, number, number]
    faceIds: [string, string]
    metaIndex: number
    pathToCall: PathToNode
  }[] = []

  function visitExpr(expr: Expr, pathPrefix?: PathToNode): void {
    const call = getCallFromExpr(expr)
    if (!call) {
      walkExpr(expr, pathPrefix)
      return
    }
    const callPath = getCallPathFromExpr(expr, pathPrefix)
    const calleeName = (call.callee as { name?: { name?: string } })?.name?.name
    if (!calleeName || !isExtrude(calleeName)) {
      walkExpr(expr, pathPrefix)
      return
    }
    const toArg = findToArg(call)
    const inner = toArg ? getCallFromExpr(toArg) : null
    if (!inner) {
      walkExpr(expr, pathPrefix)
      return
    }
    const innerCallee = (inner.callee as { name?: { name?: string } })?.name
      ?.name
    if (
      !innerCallee ||
      !(DEPRECATED_EDGE_STDLIB as readonly string[]).includes(innerCallee)
    ) {
      walkExpr(expr, pathPrefix)
      return
    }

    const innerStart = Number((inner as { start?: number }).start ?? 0)
    const innerEnd = Number((inner as { end?: number }).end ?? 0)
    const innerModuleId = (inner as { module_id?: number }).module_id ?? 0
    const meta = edgeRefactorMetadata.find((m) =>
      sourceRangeMatch(m, innerStart, innerEnd, innerModuleId)
    )
    const moduleId = (call as { module_id?: number }).module_id ?? 0
    const callStart = Number((call as { start?: number }).start ?? 0)
    const callEnd = Number((call as { end?: number }).end ?? 0)
    if (meta) {
      results.push({
        range: [callStart, callEnd, moduleId],
        faceIds: [meta.faceIds[0], meta.faceIds[1]],
        pathToCall: callPath,
      })
    } else {
      const metaIndex = edgeRefactorMetadata.findIndex((m) => {
        const ids = isArray(m.faceIds)
          ? m.faceIds
          : (m as { faceIds?: unknown[] }).faceIds
        return Boolean(ids && ids.length >= 2)
      })
      if (metaIndex >= 0 && callPath?.length) {
        const metadata = edgeRefactorMetadata[metaIndex]
        const faceIds = isArray(metadata.faceIds)
          ? ([metadata.faceIds[0], metadata.faceIds[1]] as [string, string])
          : ([
              (metadata as { faceIds?: string[] }).faceIds?.[0],
              (metadata as { faceIds?: string[] }).faceIds?.[1],
            ].filter(Boolean) as [string, string])
        if (faceIds.length === 2) {
          candidates.push({
            range: [callStart, callEnd, moduleId],
            faceIds,
            metaIndex,
            pathToCall: callPath,
          })
        }
      }
    }
    walkExpr(expr, pathPrefix)
  }

  function walkExpr(expr: Expr, pathPrefix?: PathToNode): void {
    if (!expr || typeof expr !== 'object') return
    const objectValue = expr as Record<string, unknown>
    if (
      objectValue.type === 'CallExpressionKw' ||
      objectValue.CallExpressionKw
    ) {
      const call = getCallFromExpr(expr)
      if (call?.arguments) {
        for (const arg of call.arguments) visitExpr(arg.arg, pathPrefix)
      }
      return
    }
    if (objectValue.type === 'BinaryExpression') {
      if ((expr as { left?: Expr }).left)
        walkExpr((expr as { left: Expr }).left, pathPrefix)
      if ((expr as { right?: Expr }).right)
        walkExpr((expr as { right: Expr }).right, pathPrefix)
      return
    }
    if (objectValue.type === 'ArrayExpression') {
      for (const element of (expr as { elements?: Expr[] }).elements ?? []) {
        walkExpr(element, pathPrefix)
      }
      return
    }
    if (objectValue.type === 'ObjectExpression') {
      for (const property of (expr as { properties?: { value: Expr }[] })
        .properties ?? []) {
        walkExpr(property.value, pathPrefix)
      }
      return
    }
    if (objectValue.type === 'LabelledExpression') {
      visitExpr((expr as { expr: Expr }).expr, pathPrefix)
    } else if (objectValue.type === 'AscribedExpression') {
      visitExpr((expr as { expr: Expr }).expr, pathPrefix)
    } else if (objectValue.type === 'UnaryExpression') {
      walkExpr((expr as { argument: Expr }).argument, pathPrefix)
    } else if (objectValue.type === 'MemberExpression') {
      walkExpr((expr as { object: Expr }).object, pathPrefix)
      walkExpr((expr as { property: Expr }).property, pathPrefix)
    }
  }

  const body = program.body ?? []
  for (let statementIndex = 0; statementIndex < body.length; statementIndex++) {
    const item = body[statementIndex] as {
      type?: string
      declaration?: { init?: Expr }
      expression?: Expr
    }
    const pathPrefix: PathToNode = [
      ['body', ''],
      [statementIndex, 'index'],
    ]
    if (item.type === 'VariableDeclaration' && item.declaration?.init) {
      visitExpr(item.declaration.init, [
        ...pathPrefix,
        ['declaration', 'VariableDeclaration'],
        ['init', ''],
      ])
    } else if (item.type === 'ExpressionStatement' && item.expression) {
      visitExpr(item.expression, [
        ...pathPrefix,
        ['expression', 'ExpressionStatement'],
      ])
    }
  }

  if (results.length === 0 && candidates.length > 0) {
    const used = new Set<number>()
    for (const candidate of candidates) {
      if (used.has(candidate.metaIndex)) continue
      used.add(candidate.metaIndex)
      results.push({
        range: candidate.range,
        faceIds: candidate.faceIds,
        pathToCall: candidate.pathToCall,
      })
      break
    }
  }

  return results
}

function refactorRevolveHelixAxisToEdgeRefInPlace(
  modifiedAst: Node<Program>,
  toFix: RevolveHelixCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  if (toFix.length === 0) return modifiedAst
  for (let index = 0; index < toFix.length; index++) {
    const { faceIds, pathToCall } = toFix[index]
    const path = pathToCall?.length ? pathToCall : pathList[index]
    const result = createEdgeRefObjectExpression(
      { side_faces: faceIds },
      wasmInstance,
      modifiedAst,
      artifactGraph
    )
    if (err(result)) continue
    modifiedAst = result.modifiedAst
    const nodeResult = getNodeFromPath(modifiedAst, path, wasmInstance, [
      'CallExpressionKw',
    ])
    if (err(nodeResult)) continue
    const callNode = nodeResult.node as Node<CallExpressionKw>
    const newArgs = (callNode.arguments ?? []).filter(
      (a) => (a.label as { name?: string })?.name !== 'axis'
    )
    newArgs.push(createLabeledArg('axis', result.expr))
    callNode.arguments = newArgs
  }
  return modifiedAst
}

function refactorExtrudeToToEdgeSpecifierInPlace(
  modifiedAst: Node<Program>,
  toFix: ExtrudeToCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  if (toFix.length === 0) return modifiedAst
  for (let index = 0; index < toFix.length; index++) {
    const { faceIds, pathToCall } = toFix[index]
    const path = pathToCall?.length ? pathToCall : pathList[index]
    const result = createEdgeRefObjectExpression(
      { side_faces: faceIds },
      wasmInstance,
      modifiedAst,
      artifactGraph
    )
    if (err(result)) continue
    modifiedAst = result.modifiedAst
    const nodeResult = getNodeFromPath(modifiedAst, path, wasmInstance, [
      'CallExpressionKw',
    ])
    if (err(nodeResult)) continue
    const callNode = nodeResult.node as Node<CallExpressionKw>
    const newArgs = (callNode.arguments ?? []).filter(
      (a) => (a.label as { name?: string })?.name !== 'to'
    )
    newArgs.push(createLabeledArg('to', result.expr))
    callNode.arguments = newArgs
  }
  return modifiedAst
}

export function refactorZ0006Unified(
  ast: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  directTagFilletMetadata: DirectTagFilletMeta[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | Error {
  const toFixFilletChamfer = findFilletChamferCallsToFixUnified(
    ast,
    edgeRefactorMetadata,
    directTagFilletMetadata
  )
  const toFixRevolveHelix = findRevolveHelixCallsToFix(
    ast,
    edgeRefactorMetadata
  )
  const toFixExtrudeTo = findExtrudeToCallsToFix(ast, edgeRefactorMetadata)
  if (
    toFixFilletChamfer.length === 0 &&
    toFixRevolveHelix.length === 0 &&
    toFixExtrudeTo.length === 0
  ) {
    return new Error('No Z0006 fixes to apply')
  }

  let modifiedAst = structuredClone(ast) as Node<Program>

  for (const {
    range,
    orderedFaceIds,
    hasExistingEdgeRefs,
    tagsBaseExpr,
  } of toFixFilletChamfer) {
    const path = getNodePathFromSourceRange(modifiedAst, range)
    const edgeRefExprs: Expr[] = []
    for (const faceIds of orderedFaceIds) {
      const result = createEdgeRefObjectExpression(
        { side_faces: faceIds },
        wasmInstance,
        modifiedAst,
        artifactGraph,
        undefined,
        undefined,
        tagsBaseExpr
      )
      if (err(result)) continue
      edgeRefExprs.push(result.expr)
      modifiedAst = result.modifiedAst
    }
    const nodeResult = getNodeFromPath(modifiedAst, path, wasmInstance, [
      'CallExpressionKw',
    ])
    if (err(nodeResult)) continue
    const callNode = nodeResult.node as Node<CallExpressionKw>
    if (hasExistingEdgeRefs) {
      edgeRefExprs.push(...getExistingEdgeRefsFromCall(callNode))
    }
    if (edgeRefExprs.length === 0) continue
    const newArgs = (callNode.arguments ?? []).filter(
      (a) =>
        (a.label as { name?: string })?.name !== 'tags' &&
        (a.label as { name?: string })?.name !== 'edges' &&
        (a.label as { name?: string })?.name !== 'edgeRefs'
    )
    newArgs.push(createLabeledArg('edges', createArrayExpression(edgeRefExprs)))
    callNode.arguments = newArgs
  }

  modifiedAst = refactorRevolveHelixAxisToEdgeRefInPlace(
    modifiedAst,
    toFixRevolveHelix,
    toFixRevolveHelix.map((item) =>
      item.pathToCall?.length
        ? item.pathToCall
        : getNodePathFromSourceRange(ast, item.range)
    ),
    artifactGraph,
    wasmInstance
  )

  modifiedAst = refactorExtrudeToToEdgeSpecifierInPlace(
    modifiedAst,
    toFixExtrudeTo,
    toFixExtrudeTo.map((item) =>
      item.pathToCall?.length
        ? item.pathToCall
        : getNodePathFromSourceRange(ast, item.range)
    ),
    artifactGraph,
    wasmInstance
  )

  const out = recast(modifiedAst, wasmInstance)
  return err(out) ? out : out
}

function callSourceRangeToTuple(
  callSourceRange: DirectTagFilletMeta['callSourceRange']
): [number, number, number] {
  if (isArray(callSourceRange)) {
    return [
      Number(callSourceRange[0]),
      Number(callSourceRange[1]),
      Number((callSourceRange as [number, number, number])[2] ?? 0),
    ]
  }
  const sourceRange = callSourceRange as {
    start?: number
    end?: number
    moduleId?: number
  }
  return [
    Number(sourceRange.start ?? 0),
    Number(sourceRange.end ?? 0),
    Number(sourceRange.moduleId ?? 0),
  ]
}

export function refactorDirectTagFilletToEdgeRefs(
  ast: Program,
  directTagFilletMetadata: DirectTagFilletMeta[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | Error {
  if (!directTagFilletMetadata?.length) {
    return new Error('No direct tag fillet metadata')
  }

  let modifiedAst = structuredClone(ast as Node<Program>)
  for (const meta of directTagFilletMetadata) {
    if (!meta.tags?.length) continue
    const path = getNodePathFromSourceRange(
      modifiedAst,
      callSourceRangeToTuple(meta.callSourceRange)
    )
    const edgeRefExprs: Expr[] = []
    for (const tagEntry of meta.tags) {
      const result = createEdgeRefObjectExpression(
        { side_faces: tagEntry.faceIds },
        wasmInstance,
        modifiedAst,
        artifactGraph
      )
      if (err(result)) continue
      edgeRefExprs.push(result.expr)
      modifiedAst = result.modifiedAst
    }
    if (edgeRefExprs.length === 0) continue

    const nodeResult = getNodeFromPath(modifiedAst, path, wasmInstance, [
      'CallExpressionKw',
    ])
    if (err(nodeResult)) continue
    const callNode = nodeResult.node as Node<CallExpressionKw>
    const tagsIndex = callNode.arguments?.findIndex(
      (a) => (a.label as { name?: string })?.name === 'tags'
    )
    if (tagsIndex === undefined || tagsIndex < 0) continue
    callNode.arguments[tagsIndex] = createLabeledArg(
      'edges',
      createArrayExpression(edgeRefExprs)
    )
  }

  const out = recast(modifiedAst, wasmInstance)
  return err(out) ? out : out
}

function faceRefToArtifactId(v: OpKclValue): string | null {
  if (v.type === 'Uuid' && v.value) return v.value
  if (v.type === 'TagIdentifier' && v.artifact_id) {
    return v.artifact_id
  }
  return null
}

function findEdgeArtifactFromFaceIds(
  faceIds: string[],
  artifactGraph: ArtifactGraph
): Artifact | null {
  if (faceIds.length === 0) return null
  const faceArtifacts: Artifact[] = []
  for (const id of faceIds) {
    const artifact = artifactGraph.get(id)
    if (artifact) faceArtifacts.push(artifact)
  }
  if (faceArtifacts.length === 0) return null

  const edgeType = (
    artifact: Artifact
  ): artifact is Artifact & { type: 'segment' | 'edgeCut' } =>
    artifact.type === 'segment' || artifact.type === 'edgeCut'
  const directEdge = faceArtifacts.find(edgeType)
  if (directEdge) return directEdge

  const faceIdSet = new Set(faceIds)
  for (const [, artifact] of artifactGraph) {
    if (artifact.type !== 'segment') continue
    const commonIds = (artifact as { commonSurfaceIds?: string[] })
      .commonSurfaceIds
    if (!commonIds?.length) continue
    const commonIdSet = new Set(commonIds)
    if (
      faceIdSet.size === commonIdSet.size &&
      [...faceIdSet].every((id) => commonIdSet.has(id))
    ) {
      return artifact
    }
  }

  return null
}

export function retrieveEdgeSelectionsFromEdgeRefs(
  edgeRefsArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (edgeRefsArg.value.type !== 'Array') {
    return new Error('edges argument is not an array')
  }

  const graphSelections: Selection[] = []
  for (const item of edgeRefsArg.value.value) {
    if (item.type !== 'Object' || !item.value) continue
    const facesProp = (item.value.sideFaces ?? item.value.side_faces) as
      | OpKclValue
      | undefined
    if (!facesProp || facesProp.type !== 'Array') continue
    const faceIds = facesProp.value
      .map(faceRefToArtifactId)
      .filter((id): id is string => Boolean(id))
    if (faceIds.length < 2) continue

    const edgeArtifact = findEdgeArtifactFromFaceIds(faceIds, artifactGraph)
    if (!edgeArtifact) continue
    const codeRefs = getCodeRefsByArtifactId(edgeArtifact.id, artifactGraph)
    if (!codeRefs?.length) continue
    graphSelections.push({
      artifact: edgeArtifact,
      codeRef: codeRefs[0],
    })
  }

  return { graphSelections, otherSelections: [] }
}

export function retrieveEdgeSelectionsFromSingleEdgeRef(
  edgeRefArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (edgeRefArg.value.type !== 'Object' || !edgeRefArg.value.value) {
    return new Error('edgeRef argument is not an object')
  }

  const facesProp = (edgeRefArg.value.value.sideFaces ??
    edgeRefArg.value.value.side_faces) as OpKclValue | undefined
  if (!facesProp || facesProp.type !== 'Array') {
    return new Error('edgeRef has no sideFaces array')
  }

  const faceIds = facesProp.value
    .map(faceRefToArtifactId)
    .filter((id): id is string => Boolean(id))
  if (faceIds.length < 2) {
    return new Error('edgeRef sideFaces array needs at least 2 faces')
  }

  const edgeArtifact = findEdgeArtifactFromFaceIds(faceIds, artifactGraph)
  if (!edgeArtifact) {
    return new Error('Could not find edge from faces in artifact graph')
  }
  const codeRefs = getCodeRefsByArtifactId(edgeArtifact.id, artifactGraph)
  if (!codeRefs?.length) {
    return new Error('Edge artifact has no codeRef')
  }

  return {
    graphSelections: [
      {
        artifact: edgeArtifact,
        codeRef: codeRefs[0],
      },
    ],
    otherSelections: [],
  }
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

// Adds all the edgeId calls needed in the AST so we can refer to them,
// keeps track of their names as "tags",
// and gathers the corresponding solid expressions.
function insertPrimitiveEdgeVariablesAndOffsetPathToNode({
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

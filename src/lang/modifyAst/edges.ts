import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
  createArrayExpression,
  createTagDeclarator,
  createObjectExpression,
  createLiteral,
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
  Selections,
  Selection,
  EntityReference,
} from '@src/machines/modelingSharedTypes'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getSweepArtifactFromSelection,
  getCommonFacesForEdge,
} from '@src/lang/std/artifactGraph'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import { deleteNodeInExtrudePipe } from '@src/lang/modifyAst/deleteNodeInExtrudePipe'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/**
 * Converts an edge selection to an EntityReference with face information.
 * This is used for the new face-based edge selection API.
 */
function edgeSelectionToEntityReference(
  selection: Selection,
  artifactGraph: ArtifactGraph
): EntityReference | Error {
  if (!selection.artifact) {
    return new Error('Selection does not have an artifact')
  }

  const artifact = selection.artifact
  if (artifact.type !== 'sweepEdge' && artifact.type !== 'segment') {
    return new Error('Selection is not an edge')
  }

  // Get the faces that form this edge
  const commonFaces = getCommonFacesForEdge(artifact, artifactGraph)
  if (err(commonFaces)) {
    return commonFaces
  }

  // Extract face IDs from face artifacts
  const faceIds = commonFaces.map((face) => face.id)

  if (faceIds.length === 0) {
    return new Error('No faces found for edge')
  }

  return {
    type: 'edge',
    faces: faceIds,
  }
}

/**
 * Type alias for EdgeRef payload used in KCL edgeRefs array
 */
type FilletEdgeRefPayload = {
  faces: string[]
  disambiguators?: string[]
  index?: number
}

/**
 * Converts an EntityReference (edge type) to a KCL edgeRefs payload object.
 * Only includes optional fields when they are actually present.
 */
function entityReferenceToEdgeRefPayload(
  entityRef: Extract<EntityReference, { type: 'edge' }>
): FilletEdgeRefPayload {
  const payload: FilletEdgeRefPayload = {
    faces: entityRef.faces,
  }

  // Only include disambiguators if present and non-empty
  if (entityRef.disambiguators && entityRef.disambiguators.length > 0) {
    payload.disambiguators = entityRef.disambiguators
  }

  // Only include index if explicitly provided (0 is valid, undefined means no filter)
  if (entityRef.index !== undefined) {
    payload.index = entityRef.index
  }

  return payload
}

/**
 * Creates KCL object expression for an edgeRef payload.
 * Resolves face UUIDs to tags by looking up artifacts and getting/creating tags.
 */
function createEdgeRefObjectExpression(
  payload: FilletEdgeRefPayload,
  wasmInstance: ModuleType,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph
): { expr: Expr; modifiedAst: Node<Program> } {
  // Resolve face UUIDs to tags
  const faceTags: string[] = []
  let currentAst = ast

  for (const faceId of payload.faces) {
    const faceArtifact = artifactGraph.get(faceId)
    if (!faceArtifact) {
      faceTags.push(faceId)
      continue
    }

    const codeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      faceTags.push(faceId)
      continue
    }

    const tagResult = modifyAstWithTagsForSelection(
      currentAst,
      { artifact: faceArtifact, codeRef: codeRefs[0] },
      artifactGraph,
      wasmInstance
    )
    if (err(tagResult)) {
      faceTags.push(faceId)
      continue
    }

    faceTags.push(tagResult.tags[0])
    currentAst = tagResult.modifiedAst
  }

  const disambiguatorTags: string[] = []
  if (payload.disambiguators && payload.disambiguators.length > 0) {
    for (const disambId of payload.disambiguators) {
      const disambArtifact = artifactGraph.get(disambId)
      if (!disambArtifact) {
        disambiguatorTags.push(disambId)
        continue
      }

      const codeRefs = getCodeRefsByArtifactId(disambId, artifactGraph)
      if (!codeRefs || codeRefs.length === 0) {
        disambiguatorTags.push(disambId)
        continue
      }

      const tagResult = modifyAstWithTagsForSelection(
        currentAst,
        { artifact: disambArtifact, codeRef: codeRefs[0] },
        artifactGraph,
        wasmInstance
      )
      if (err(tagResult)) {
        disambiguatorTags.push(disambId)
        continue
      }

      disambiguatorTags.push(tagResult.tags[0])
      currentAst = tagResult.modifiedAst
    }
  }

  const properties: { [key: string]: Expr } = {
    faces: createArrayExpression(faceTags.map((tag) => createLocalName(tag))),
  }

  // Only add disambiguators if present
  if (disambiguatorTags.length > 0) {
    properties.disambiguators = createArrayExpression(
      disambiguatorTags.map((tag) => createLocalName(tag))
    )
  }

  // Only add index if explicitly provided
  if (payload.index !== undefined) {
    properties.index = createLiteral(payload.index, wasmInstance)
  }

  // Create object expression (KCL object literal)
  return {
    expr: createObjectExpression(properties),
    modifiedAst: currentAst,
  }
}

/**
 * Groups edge selections by body and creates edgeRefs expressions.
 * Uses graphSelectionsV2 if available, otherwise converts graphSelections to EntityReferences.
 */
function groupSelectionsByBodyAndCreateEdgeRefs(
  selections: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode
):
  | {
      modifiedAst: Node<Program>
      bodies: Map<
        string,
        {
          solidsExpr: Expr | null
          edgeRefsExpr: Expr
          pathIfPipe?: PathToNode
        }
      >
    }
  | Error {
  let modifiedAst = ast
  const bodies = new Map<
    string,
    {
      solidsExpr: Expr | null
      edgeRefsExpr: Expr
      pathIfPipe?: PathToNode
    }
  >()

  const v2Selections = selections.graphSelectionsV2 || []
  const hasV2Selections = v2Selections.length > 0
  const hasV1Selections = selections.graphSelections.length > 0

  if (hasV2Selections && !hasV1Selections) {
    // V2-only path: Group V2 selections by body using face IDs
    const bodyToV2Selections = new Map<string, typeof v2Selections>()

    for (const v2Sel of v2Selections) {
      if (!v2Sel.entityRef || v2Sel.entityRef.type !== 'edge') continue

      // Find the sweep artifact from the first face
      const firstFaceId = v2Sel.entityRef.faces[0]
      if (!firstFaceId) continue

      const faceArtifact = artifactGraph.get(firstFaceId)
      if (
        !faceArtifact ||
        (faceArtifact.type !== 'wall' && faceArtifact.type !== 'cap')
      ) {
        continue
      }

      // Get the sweep artifact
      const sweepArtifact = getSweepArtifactFromSelection(
        {
          artifact: faceArtifact,
          codeRef: v2Sel.codeRef || faceArtifact.faceCodeRef,
        },
        artifactGraph
      )
      if (err(sweepArtifact)) {
        continue
      }

      const bodyKey = JSON.stringify(sweepArtifact.codeRef.pathToNode)
      if (!bodyToV2Selections.has(bodyKey)) {
        bodyToV2Selections.set(bodyKey, [])
      }
      bodyToV2Selections.get(bodyKey)!.push(v2Sel)
    }

    // Process each body
    for (const [bodyKey, bodyV2Selections] of bodyToV2Selections.entries()) {
      const bodyEdgeRefs: Expr[] = []

      // Create edgeRefs from V2 selections
      for (const v2Sel of bodyV2Selections) {
        if (v2Sel.entityRef?.type === 'edge') {
          const payload = entityReferenceToEdgeRefPayload(v2Sel.entityRef)
          const result = createEdgeRefObjectExpression(
            payload,
            wasmInstance,
            modifiedAst,
            artifactGraph
          )
          bodyEdgeRefs.push(result.expr)
          modifiedAst = result.modifiedAst
        }
      }

      if (bodyEdgeRefs.length === 0) continue

      // Get the sweep artifact for this body (use first selection's face)
      const firstV2Sel = bodyV2Selections[0]
      if (!firstV2Sel.entityRef || firstV2Sel.entityRef.type !== 'edge')
        continue

      const firstFaceId = firstV2Sel.entityRef.faces[0]
      const faceArtifact = artifactGraph.get(firstFaceId)
      if (
        !faceArtifact ||
        (faceArtifact.type !== 'wall' && faceArtifact.type !== 'cap')
      )
        continue

      const sweepArtifact = getSweepArtifactFromSelection(
        {
          artifact: faceArtifact,
          codeRef: firstV2Sel.codeRef || faceArtifact.faceCodeRef,
        },
        artifactGraph
      )
      if (err(sweepArtifact)) continue

      // Build solids expression
      const solids: Selections = {
        graphSelections: [
          {
            artifact: { ...sweepArtifact, type: 'sweep' },
            codeRef: sweepArtifact.codeRef,
          },
        ],
        otherSelections: [],
        graphSelectionsV2: [],
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
      const edgeRefsExpr = createArrayExpression(bodyEdgeRefs)

      bodies.set(bodyKey, {
        solidsExpr,
        edgeRefsExpr,
        pathIfPipe: vars.pathIfPipe,
      })
    }
  } else {
    // V1 path or mixed: Group selections by body first (same logic as tags path)
    const selectionsByBody = groupSelectionsByBody(selections, artifactGraph)
    if (err(selectionsByBody)) return selectionsByBody

    for (const [bodyKey, bodySelections] of selectionsByBody.entries()) {
      // Get edgeRefs for edges in this body
      // Prefer V2 selections if available, otherwise convert V1
      const bodyEdgeRefs: Expr[] = []

      // Check if we have V2 selections for this body
      const v2ForBody = v2Selections.filter((sel) => {
        if (!sel.entityRef || sel.entityRef.type !== 'edge') return false
        // Match by checking if codeRef matches any selection in bodySelections
        return bodySelections.graphSelections.some(
          (bs) => bs.codeRef.pathToNode === sel.codeRef?.pathToNode
        )
      })

      if (v2ForBody.length > 0) {
        // Use V2 selections directly
        for (const v2Sel of v2ForBody) {
          if (v2Sel.entityRef?.type === 'edge') {
            const payload = entityReferenceToEdgeRefPayload(v2Sel.entityRef)
            const result = createEdgeRefObjectExpression(
              payload,
              wasmInstance,
              modifiedAst,
              artifactGraph
            )
            bodyEdgeRefs.push(result.expr)
            modifiedAst = result.modifiedAst
          }
        }
      } else {
        // Convert V1 selections to EntityReferences
        for (const selection of bodySelections.graphSelections) {
          const entityRef = edgeSelectionToEntityReference(
            selection,
            artifactGraph
          )
          if (err(entityRef) || entityRef.type !== 'edge') {
            continue
          }

          const payload = entityReferenceToEdgeRefPayload(entityRef)
          const result = createEdgeRefObjectExpression(
            payload,
            wasmInstance,
            modifiedAst,
            artifactGraph
          )
          bodyEdgeRefs.push(result.expr)
          modifiedAst = result.modifiedAst
        }
      }

      if (bodyEdgeRefs.length === 0) {
        continue
      }

      // Build solids expression (same as in groupSelectionsByBodyAndAddTags)
      const solids: Selections = {
        graphSelections: [bodySelections.graphSelections[0]].flatMap((edge) => {
          const sweep = getSweepArtifactFromSelection(edge, artifactGraph)
          if (err(sweep)) {
            console.error(
              'Skipping sweep artifact in solids selection',
              err(sweep)
            )
            return []
          }

          return {
            type: 'default',
            codeRef: sweep.codeRef,
          }
        }),
        otherSelections: [],
        graphSelectionsV2: [],
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
      const edgeRefsExpr = createArrayExpression(bodyEdgeRefs)

      bodies.set(bodyKey, {
        solidsExpr,
        edgeRefsExpr,
        pathIfPipe: vars.pathIfPipe,
      })
    }
  }

  if (bodies.size === 0) {
    return new Error('No edge selections found')
  }

  return { modifiedAst, bodies }
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
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  const edgeRefsBodyData = groupSelectionsByBodyAndCreateEdgeRefs(
    selection,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit
  )

  let useEdgeRefs = false
  let bodyData: ReturnType<typeof groupSelectionsByBodyAndAddTags> | null = null

  if (!err(edgeRefsBodyData)) {
    useEdgeRefs = true
    modifiedAst = edgeRefsBodyData.modifiedAst
  } else {
    bodyData = groupSelectionsByBodyAndAddTags(
      selection,
      artifactGraph,
      modifiedAst,
      wasmInstance,
      mNodeToEdit
    )
    if (err(bodyData)) return bodyData
    modifiedAst = bodyData.modifiedAst
  }

  if ('variableName' in radius && radius.variableName) {
    insertVariableAndOffsetPathToNode(radius, modifiedAst, mNodeToEdit)
  }

  const pathToNodes: PathToNode[] = []

  if (useEdgeRefs && !err(edgeRefsBodyData)) {
    for (const data of edgeRefsBodyData.bodies.values()) {
      const tagArgs = tag
        ? [createLabeledArg('tag', createTagDeclarator(tag))]
        : []
      const call = createCallExpressionStdLibKw('fillet', data.solidsExpr, [
        createLabeledArg('edgeRefs', data.edgeRefsExpr),
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
  } else if (bodyData) {
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
  const selectionsByBody = groupSelectionsByBody(selections, artifactGraph)
  if (err(selectionsByBody)) return selectionsByBody

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
    // Add tags for this body
    const { tagsExprs, modifiedAst: taggedAst } = getTagsExprsFromSelection(
      modifiedAst,
      bodySelections,
      artifactGraph,
      wasmInstance
    )
    modifiedAst = taggedAst

    if (tagsExprs.length === 0) {
      return new Error('No edges found in the selection')
    }

    // Build solids expression
    const solids: Selections = {
      graphSelections: [bodySelections.graphSelections[0]].flatMap((edge) => {
        const sweep = getSweepArtifactFromSelection(edge, artifactGraph)
        if (err(sweep)) {
          console.error(
            'Skipping sweep artifact in solids selection',
            err(sweep)
          )
          return []
        }

        return {
          type: 'default',
          codeRef: sweep.codeRef,
        }
      }),
      otherSelections: [],
      graphSelectionsV2: [],
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
 * Groups edge selections by their parent body (sweep artifact).
 * Uses the sweep artifact's pathToNode as a unique key for each body.
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
      graphSelectionsV2: [],
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
    graphSelectionsV2: [],
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
  tagsArg: OpArg,
  artifactGraph: ArtifactGraph
) {
  // TODO: check if we should look up the solid here as well, like in retrieveFaceSelectionsFromOpArgs

  const tagValues: OpKclValue[] = []
  if (tagsArg.value.type === 'Array') {
    tagValues.push(...tagsArg.value.value)
  } else {
    tagValues.push(tagsArg.value)
  }

  const graphSelections: Selection[] = []
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
      console.warn('No artifact found for face tag', v.value)
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

  return { graphSelections, otherSelections: [], graphSelectionsV2: [] }
}

/**
 * Retrieves edge selections from edgeRefs argument (new API).
 * Used for edit flows when reading existing fillet calls with edgeRefs.
 *
 * Phase 2: Basic implementation - full parsing of edgeRefs objects will be improved in later phases.
 * For now, this returns an error to indicate that edgeRefs parsing is not yet fully implemented.
 * The edit flow will fall back to manual editing in the code editor.
 */
export function retrieveEdgeSelectionsFromEdgeRefs(
  edgeRefsArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  // Phase 2: Basic implementation - return error for now
  // Full parsing of edgeRefs object structure from OpKclValue will be implemented
  // in a follow-up phase once we have better understanding of the OpKclValue structure
  // for Object types with nested properties.
  return new Error(
    'Edit flow for fillet with edgeRefs is not yet fully implemented. Please edit in the code editor.'
  )
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

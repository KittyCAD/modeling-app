import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createObjectExpression,
  createTagDeclarator,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  deleteTopLevelStatement,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  artifactToEntityRef,
  getNodeFromPath,
  getVariableExprsFromSelection,
  resolveSelectionV2,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { recast } from '@src/lang/wasm'
import { isArray } from '@src/lib/utils'
import type {
  Artifact,
  ArtifactGraph,
  CallExpressionKw,
  CodeRef,
  EdgeRefactorMeta,
  Expr,
  ExpressionStatement,
  Name,
  PathToNode,
  Program,
  SweepArtifact,
  VariableDeclarator,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type {
  Selections,
  Selection,
  SelectionV2,
  EntityReference,
  EnginePrimitiveSelection,
} from '@src/machines/modelingSharedTypes'
import type { ResolvedGraphSelection } from '@src/lang/std/artifactGraph'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getFaceCodeRef,
  getSweepArtifactFromSelection,
  getCommonFacesForEdge,
} from '@src/lang/std/artifactGraph'
import {
  modifyAstWithTagsForSelection,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/tagManagement'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import { deleteNodeInExtrudePipe } from '@src/lang/modifyAst/deleteNodeInExtrudePipe'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { isEnginePrimitiveSelection } from '@src/lib/selections'
import { getBodySelectionFromPrimitiveParentEntityId } from '@src/lang/modifyAst/faces'

/**
 * Converts a resolved edge selection to an EntityReference with face information.
 * This is used for the new face-based edge selection API (selectionsV2).
 */
function edgeSelectionToEntityReference(
  selection: ResolvedGraphSelection & { artifact: Artifact },
  artifactGraph: ArtifactGraph
): EntityReference | Error {
  const artifact = selection.artifact
  // Edge artifacts are segment or edgeCut (sweepEdge removed in selectionsV2)
  let segmentArtifact: Extract<Artifact, { type: 'segment' }> | null = null
  if (artifact.type === 'segment') {
    segmentArtifact = artifact
  } else if (artifact.type === 'edgeCut') {
    const edgeIds = (artifact as { edge_ids?: string[] }).edge_ids
    const firstEdgeId = edgeIds?.[0]
    if (!firstEdgeId) return new Error('EdgeCut has no edge_ids')
    const edgeArtifact = artifactGraph.get(firstEdgeId)
    if (edgeArtifact?.type === 'segment') segmentArtifact = edgeArtifact
  }
  if (!segmentArtifact) {
    return new Error('Selection is not an edge (segment or edgeCut)')
  }

  // Get the faces that form this edge
  const commonFaces = getCommonFacesForEdge(segmentArtifact, artifactGraph)
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
export function entityReferenceToEdgeRefPayload(
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
 * @param originalEdgeSelection - Optional original edge selection (segment/sweepEdge) for Solid2D edge handling
 * @param fallbackCodeRef - Optional codeRef to use when originalEdgeSelection is not available (for V2-only selections)
 */
export function createEdgeRefObjectExpression(
  payload: FilletEdgeRefPayload,
  wasmInstance: ModuleType,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  originalEdgeSelection?: ResolvedGraphSelection,
  fallbackCodeRef?: CodeRef
): { expr: Expr; modifiedAst: Node<Program> } | Error {
  // Resolve face UUIDs to tags
  const faceTags: string[] = []
  let currentAst = ast

  for (const faceId of payload.faces) {
    const faceArtifact = artifactGraph.get(faceId)
    if (!faceArtifact) {
      return new Error(
        `Could not find artifact for face ${faceId} in edge reference`
      )
    }

    const codeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      return new Error(
        `Could not find codeRefs for face ${faceId} in edge reference`
      )
    }

    // Handle Solid2D case: for Solid2D profiles, the "face" is actually the Solid2D itself
    // We need to tag the segment directly instead of trying to tag the face
    if (faceArtifact.type === 'solid2d') {
      // For Solid2D edges, we need to use the original edge selection or fallback codeRef to tag the segment
      let segmentPathToNode: PathToNode | undefined

      if (
        originalEdgeSelection?.artifact &&
        originalEdgeSelection.artifact.type === 'segment'
      ) {
        // Use the segment artifact's codeRef
        segmentPathToNode = originalEdgeSelection.artifact.codeRef.pathToNode
      } else if (fallbackCodeRef?.pathToNode) {
        // Fall back to the provided codeRef (from V2 selection)
        segmentPathToNode = fallbackCodeRef.pathToNode
      } else if (codeRefs[0]?.pathToNode) {
        // Last resort: use the codeRef from the Solid2D (points to the profile, but we can try to find the segment)
        // This is less ideal but might work if the segment is in the same path
        segmentPathToNode = codeRefs[0].pathToNode
      }

      if (!segmentPathToNode || segmentPathToNode.length === 0) {
        return new Error(
          `Cannot create tag for Solid2D edge ${faceId}: could not find segment pathToNode. Original edge selection or codeRef is required.`
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
      // Normal case: tag the face artifact
      const tagResult = modifyAstWithTagsForSelection(
        currentAst,
        {
          artifact: faceArtifact,
          codeRef: codeRefs[0],
        } as ResolvedGraphSelection,
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
  if (payload.disambiguators && payload.disambiguators.length > 0) {
    for (const disambId of payload.disambiguators) {
      const disambArtifact = artifactGraph.get(disambId)
      if (!disambArtifact) {
        continue
      }

      const codeRefs = getCodeRefsByArtifactId(disambId, artifactGraph)
      if (!codeRefs || codeRefs.length === 0) {
        continue
      }

      const tagResult = modifyAstWithTagsForSelection(
        currentAst,
        {
          artifact: disambArtifact,
          codeRef: codeRefs[0],
        } as ResolvedGraphSelection,
        artifactGraph,
        wasmInstance
      )
      if (err(tagResult)) {
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

function getTagsArrayFromCall(call: Node<CallExpressionKw>): Expr[] | null {
  const tagsArg = call.arguments?.find(
    (a) => (a.label as { name?: string })?.name === 'tags'
  )
  if (!tagsArg?.arg || tagsArg.arg.type !== 'ArrayExpression') return null
  return tagsArg.arg.elements ?? null
}

function sourceRangeMatch(
  meta: EdgeRefactorMeta,
  start: number,
  end: number,
  moduleId: number
): boolean {
  const sr = meta.sourceRange
  if (isArray(sr)) {
    return sr[0] === start && sr[1] === end && (sr[2] ?? 0) === moduleId
  }
  return (
    (sr as { start?: number }).start === start &&
    (sr as { end?: number }).end === end &&
    (sr as { moduleId?: number }).moduleId === moduleId
  )
}

/** Walk program and collect (range, orderedMetas) for each fillet/chamfer call that has tags with deprecated calls and full metadata. */
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
    const elements = getTagsArrayFromCall(call)
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
      )
        continue
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
    for (const r of deprecatedRanges) {
      const meta = metadata.find((m) =>
        sourceRangeMatch(m, r.start, r.end, r.moduleId)
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
      const c = expr as Node<CallExpressionKw>
      if (c.unlabeled) visitExpr(c.unlabeled)
      for (const a of c.arguments ?? []) visitExpr(a.arg)
      return
    }
    if (expr.type === 'BinaryExpression') {
      const b = expr as { left?: Expr; right?: Expr }
      if (b.left) walkExpr(b.left)
      if (b.right) walkExpr(b.right)
      return
    }
    if (expr.type === 'ArrayExpression') {
      for (const e of (expr as { elements?: Expr[] }).elements ?? [])
        walkExpr(e)
      return
    }
    if (expr.type === 'ObjectExpression') {
      const props = (expr as { properties?: { value: Expr }[] }).properties
      for (const p of isArray(props) ? props : []) walkExpr(p.value)
      return
    }
    if (expr.type === 'LabelledExpression')
      visitExpr((expr as { expr: Expr }).expr)
    else if (expr.type === 'AscribedExpression')
      visitExpr((expr as { expr: Expr }).expr)
    else if (expr.type === 'UnaryExpression')
      walkExpr((expr as { argument: Expr }).argument)
    else if (expr.type === 'MemberExpression') {
      walkExpr((expr as { object: Expr }).object)
      walkExpr((expr as { property: Expr }).property)
    }
  }

  for (const item of program.body ?? []) {
    if (item.type === 'VariableDeclaration' && item.declaration?.init)
      visitExpr(item.declaration.init)
    else if (item.type === 'ExpressionStatement' && item.expression)
      visitExpr(item.expression)
    else if (
      item.type === 'ReturnStatement' &&
      (item as { argument?: Expr }).argument
    )
      visitExpr((item as { argument: Expr }).argument)
  }
  return results
}

/**
 * Refactor fillet/chamfer `tags` that use deprecated edge stdlib to `edgeRefs` with face tags (not UUIDs).
 * Uses artifact graph to resolve face IDs to tag names (adding tagEnd/tagStart or segment tags when missing).
 */
export function refactorFilletChamferTagsToEdgeRefs(
  ast: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | Error {
  if (!edgeRefactorMetadata?.length)
    return new Error('No edge refactor metadata')
  let modifiedAst = structuredClone(ast)
  const toFix = findFilletChamferCallsToFix(ast, edgeRefactorMetadata)
  for (const { range, orderedMetas } of toFix) {
    const path = getNodePathFromSourceRange(modifiedAst, range)
    let edgeRefExprs: Expr[] = []
    for (const meta of orderedMetas) {
      const payload = { faces: meta.faceIds }
      const result = createEdgeRefObjectExpression(
        payload,
        wasmInstance,
        modifiedAst as Node<Program>,
        artifactGraph
      )
      if (err(result)) {
        console.warn(
          '[refactorFilletChamferTagsToEdgeRefs] createEdgeRefObjectExpression failed:',
          result
        )
        continue
      }
      edgeRefExprs.push(result.expr)
      modifiedAst = result.modifiedAst
    }
    if (edgeRefExprs.length === 0) continue
    const nodeResult = getNodeFromPath(modifiedAst, path, wasmInstance, [
      'CallExpressionKw',
    ])
    if (err(nodeResult)) continue
    const callNode = nodeResult.node as Node<CallExpressionKw>
    const tagsIdx = callNode.arguments?.findIndex(
      (a) => (a.label as { name?: string })?.name === 'tags'
    )
    if (tagsIdx === undefined || tagsIdx < 0) continue
    callNode.arguments[tagsIdx] = createLabeledArg(
      'edgeRefs',
      createArrayExpression(edgeRefExprs)
    )
  }
  const out = recast(modifiedAst, wasmInstance)
  return err(out) ? out : out
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
  nodeToEdit?: PathToNode,
  _options?: { includePrimitiveEdgeIndices?: boolean }
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

  if (hasV2Selections) {
    // V2-only path: Group V2 selections by body using face IDs
    const bodyToV2Selections = new Map<string, typeof v2Selections>()

    for (const v2Sel of v2Selections) {
      if (!v2Sel.entityRef || v2Sel.entityRef.type !== 'edge') continue

      // Find a wall or cap face to get the body (edge refs can list segment first)
      let faceArtifact: Artifact | undefined
      for (const faceId of v2Sel.entityRef.faces) {
        const a = artifactGraph.get(faceId)
        if (a && (a.type === 'wall' || a.type === 'cap')) {
          faceArtifact = a
          break
        }
      }
      if (!faceArtifact) continue

      // Get the sweep artifact
      const faceCodeRef =
        v2Sel.codeRef ??
        getFaceCodeRef(faceArtifact) ??
        getCodeRefsByArtifactId(faceArtifact.id, artifactGraph)?.[0]
      if (!faceCodeRef) continue
      const sweepArtifact = getSweepArtifactFromSelection(
        { artifact: faceArtifact, codeRef: faceCodeRef },
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
          if (err(result)) {
            console.warn('Failed to create edgeRef expression:', result)
            continue
          }
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

      const firstFaceCodeRef =
        firstV2Sel.codeRef ??
        getFaceCodeRef(faceArtifact) ??
        getCodeRefsByArtifactId(firstFaceId, artifactGraph)?.[0]
      if (!firstFaceCodeRef) continue
      const sweepArtifact = getSweepArtifactFromSelection(
        { artifact: faceArtifact, codeRef: firstFaceCodeRef },
        artifactGraph
      )
      if (err(sweepArtifact)) continue

      // Build solids expression
      const solids: Selections = {
        graphSelectionsV2: [
          {
            entityRef: artifactToEntityRef('sweep', sweepArtifact.id),
            codeRef: sweepArtifact.codeRef,
          },
        ],
        otherSelections: [],
      }

      const vars = getVariableExprsFromSelection(
        solids,
        artifactGraph,
        modifiedAst,
        wasmInstance,
        nodeToEdit,
        { lastChildLookup: true }
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
        return bodySelections.graphSelectionsV2.some(
          (bs: SelectionV2) =>
            bs.codeRef?.pathToNode === sel.codeRef?.pathToNode
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
            if (err(result)) {
              console.warn('Failed to create edgeRef expression:', result)
              continue
            }
            bodyEdgeRefs.push(result.expr)
            modifiedAst = result.modifiedAst
          }
        }
      } else {
        // Resolve V2 selections and convert to EntityReferences
        for (const v2Sel of bodySelections.graphSelectionsV2) {
          const resolved = resolveSelectionV2(v2Sel, artifactGraph)
          if (!resolved?.artifact) continue
          const entityRef = edgeSelectionToEntityReference(
            { codeRef: resolved.codeRef, artifact: resolved.artifact },
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
          if (err(result)) {
            console.warn('Failed to create edgeRef expression:', result)
            continue
          }
          bodyEdgeRefs.push(result.expr)
          modifiedAst = result.modifiedAst
        }
      }

      if (bodyEdgeRefs.length === 0) {
        continue
      }

      // Build solids expression (same as in groupSelectionsByBodyAndAddTags)
      const firstResolved = bodySelections.graphSelectionsV2[0]
        ? resolveSelectionV2(bodySelections.graphSelectionsV2[0], artifactGraph)
        : null
      if (!firstResolved) continue
      const sweep = getSweepArtifactFromSelection(firstResolved, artifactGraph)
      if (err(sweep)) continue
      const solids: Selections = {
        graphSelectionsV2: [
          {
            entityRef: artifactToEntityRef('sweep', sweep.id),
            codeRef: sweep.codeRef,
          },
        ],
        otherSelections: [],
      }

      const vars = getVariableExprsFromSelection(
        solids,
        artifactGraph,
        modifiedAst,
        wasmInstance,
        nodeToEdit,
        { lastChildLookup: true }
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
    mNodeToEdit,
    { includePrimitiveEdgeIndices: true }
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
      mNodeToEdit,
      { includePrimitiveEdgeIndices: true }
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
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  const edgeRefsBodyData = groupSelectionsByBodyAndCreateEdgeRefs(
    selection,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    { includePrimitiveEdgeIndices: true }
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
      mNodeToEdit,
      { includePrimitiveEdgeIndices: true }
    )
    if (err(bodyData)) return bodyData
    modifiedAst = bodyData.modifiedAst
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

  const pathToNodes: PathToNode[] = []
  const secondLengthArgs = secondLength
    ? [createLabeledArg('secondLength', valueOrVariable(secondLength))]
    : []
  const angleArgs = angle
    ? [createLabeledArg('angle', valueOrVariable(angle))]
    : []
  const tagArgs = tag ? [createLabeledArg('tag', createTagDeclarator(tag))] : []

  if (useEdgeRefs && !err(edgeRefsBodyData)) {
    for (const data of edgeRefsBodyData.bodies.values()) {
      const call = createCallExpressionStdLibKw('chamfer', data.solidsExpr, [
        createLabeledArg('edgeRefs', data.edgeRefsExpr),
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
  } else if (bodyData) {
    for (const data of bodyData.bodies.values()) {
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
    ...edges.graphSelectionsV2,
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
        graphSelectionsV2: [
          sourceSurfaceSelection.artifact
            ? {
                entityRef: artifactToEntityRef(
                  sourceSurfaceSelection.artifact.type,
                  sourceSurfaceSelection.artifact.id,
                  sourceSurfaceSelection.artifact.type === 'segment'
                    ? (sourceSurfaceSelection.artifact as { pathId: string })
                        .pathId
                    : undefined
                ),
                codeRef: sourceSurfaceSelection.codeRef,
              }
            : { codeRef: sourceSurfaceSelection.codeRef },
        ],
        otherSelections: [],
      },
      artifactGraph,
      ast,
      wasmInstance,
      undefined,
      { lastChildLookup: false }
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

  const graphEdgeSelection = edgeSelection as SelectionV2
  const resolved = resolveSelectionV2(graphEdgeSelection, artifactGraph)
  const edgeArtifact = resolved?.artifact
  if (
    !resolved?.codeRef ||
    !edgeArtifact ||
    (edgeArtifact.type !== 'segment' && edgeArtifact.type !== 'edgeCut')
  ) {
    return new Error(
      'Blend only supports segment, edgeCut, and enginePrimitiveEdge selections.'
    )
  }

  const tagResult = modifyAstWithTagsForSelection(
    ast,
    { codeRef: resolved.codeRef, artifact: resolved.artifact },
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
    resolved as { artifact: Artifact; codeRef: CodeRef },
    artifactGraph
  )
  if (err(sourceSurfaceArtifact)) {
    return sourceSurfaceArtifact
  }

  const sourceSurfaceVars = getVariableExprsFromSelection(
    {
      graphSelectionsV2: [
        {
          entityRef: artifactToEntityRef('sweep', sourceSurfaceArtifact.id),
          codeRef: sourceSurfaceArtifact.codeRef,
        },
      ],
      otherSelections: [],
    },
    artifactGraph,
    ast,
    wasmInstance,
    undefined,
    { lastChildLookup: false }
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
      bodySelection: ResolvedGraphSelection
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
          graphSelectionsV2: [],
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
    if (bodySelections.graphSelectionsV2.length > 0) {
      const firstResolved = resolveSelectionV2(
        bodySelections.graphSelectionsV2[0],
        artifactGraph
      )
      if (firstResolved) {
        const sweep = getSweepArtifactFromSelection(
          firstResolved,
          artifactGraph
        )
        if (err(sweep)) return sweep
        bodySelectionForSolids = {
          codeRef: sweep.codeRef,
        }
      }
    }
    if (!bodySelectionForSolids) {
      bodySelectionForSolids =
        primitiveSelectionsByBody.get(bodyKey)?.bodySelection
    }

    // Build solids expression: use V2 selection or, when only engine primitive edges, body from primitive
    const firstResolved = bodySelections.graphSelectionsV2[0]
      ? resolveSelectionV2(bodySelections.graphSelectionsV2[0], artifactGraph)
      : null
    let sweepResult: ReturnType<typeof getSweepArtifactFromSelection>
    if (firstResolved) {
      sweepResult = getSweepArtifactFromSelection(firstResolved, artifactGraph)
    } else {
      const primitiveBody =
        primitiveSelectionsByBody.get(bodyKey)?.bodySelection
      if (!primitiveBody?.artifact) continue
      if (primitiveBody.artifact.type === 'sweep') {
        sweepResult = primitiveBody.artifact as SweepArtifact
      } else {
        sweepResult = getSweepArtifactFromSelection(
          primitiveBody,
          artifactGraph
        )
      }
    }
    if (err(sweepResult)) continue
    const sweep = sweepResult
    const solids: Selections = {
      graphSelectionsV2: [
        {
          entityRef: artifactToEntityRef('sweep', sweep.id),
          codeRef: sweep.codeRef,
        },
      ],
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
  const bodyToV2Selections = new Map<string, SelectionV2[]>()

  for (const v2Sel of selections.graphSelectionsV2) {
    const resolved = resolveSelectionV2(v2Sel, artifactGraph)
    if (!resolved) continue
    const sweepArtifact = getSweepArtifactFromSelection(resolved, artifactGraph)
    if (err(sweepArtifact)) return sweepArtifact

    const bodyKey = JSON.stringify(sweepArtifact.codeRef.pathToNode)
    if (bodyToV2Selections.has(bodyKey)) {
      bodyToV2Selections.get(bodyKey)!.push(v2Sel)
    } else {
      bodyToV2Selections.set(bodyKey, [v2Sel])
    }
  }

  const result = new Map<string, Selections>()
  for (const [bodyKey, v2Sels] of bodyToV2Selections.entries()) {
    result.set(bodyKey, {
      graphSelectionsV2: v2Sels,
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
    graphSelectionsV2: faces.graphSelectionsV2.flatMap((f: SelectionV2) => {
      const resolved = resolveSelectionV2(f, artifactGraph)
      if (!resolved?.artifact) return []
      const sweep = getSweepArtifactFromSelection(resolved, artifactGraph)
      if (err(sweep) || !sweep) return []
      return [
        {
          entityRef: artifactToEntityRef('sweep', sweep.id),
          codeRef: sweep.codeRef,
        },
      ]
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
  for (const v2Sel of edges.graphSelectionsV2) {
    const resolved = resolveSelectionV2(v2Sel, artifactGraph)
    if (!resolved) continue
    const result = modifyAstWithTagsForSelection(
      modifiedAst,
      resolved,
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

  const graphSelectionsV2: SelectionV2[] = []
  for (const v of tagValues) {
    const key =
      v.type === 'Uuid' && v.value
        ? v.value
        : v.type === 'TagIdentifier' &&
            (v as { artifact_id?: string }).artifact_id
          ? (v as { artifact_id: string }).artifact_id
          : null
    if (!key) {
      console.warn('Tag value is not Uuid or TagIdentifier with artifact_id', v)
      continue
    }

    const artifact = getArtifactOfTypes(
      { key, types: ['segment', 'edgeCut'] },
      artifactGraph
    )
    if (err(artifact)) {
      console.warn('No artifact found for tag', key)
      continue
    }

    const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      console.warn('No codeRefs found for artifact', artifact)
      continue
    }

    const pathId =
      artifact.type === 'segment'
        ? (artifact as { pathId?: string }).pathId
        : undefined
    const entityRef = artifactToEntityRef(artifact.type, artifact.id, pathId)
    if (!entityRef) continue
    graphSelectionsV2.push({ entityRef, codeRef: codeRefs[0] })
  }

  return { graphSelectionsV2, otherSelections: [] }
}

/**
 * Resolves a face reference from OpKclValue to an artifact ID (UUID string).
 */
function faceRefToArtifactId(v: OpKclValue): string | null {
  if (v.type === 'Uuid' && v.value) return v.value
  if (
    v.type === 'TagIdentifier' &&
    (v as { artifact_id?: string }).artifact_id
  ) {
    return (v as { artifact_id: string }).artifact_id
  }
  return null
}

/**
 * Finds an edge artifact (segment, edgeCut, or sweepEdge) given the set of face
 * artifact IDs from an edgeRef. For getCommonEdge(faces=[seg01, capStart001]),
 * one "face" may be the segment (the edge) and one the cap; or both may be
 * wall/cap and we find the segment whose commonSurfaceIds match.
 */
function findEdgeArtifactFromFaceIds(
  faceIds: string[],
  artifactGraph: ArtifactGraph
): Artifact | null {
  if (faceIds.length === 0) return null
  const faceArtifacts: Artifact[] = []
  for (const id of faceIds) {
    const a = artifactGraph.get(id)
    if (a) faceArtifacts.push(a)
  }
  if (faceArtifacts.length === 0) return null
  const edgeType = (
    a: Artifact
  ): a is Artifact & { type: 'segment' | 'edgeCut' } =>
    a.type === 'segment' || a.type === 'edgeCut'
  const asEdge = faceArtifacts.find(edgeType)
  if (asEdge) return asEdge
  const faceIdSet = new Set(faceIds)
  for (const [, artifact] of artifactGraph) {
    if (artifact.type !== 'segment') continue
    const commonIds = (artifact as { commonSurfaceIds?: string[] })
      .commonSurfaceIds
    if (!commonIds?.length) continue
    const commonSet = new Set(commonIds)
    if (
      faceIdSet.size === commonSet.size &&
      [...faceIdSet].every((id) => commonSet.has(id))
    ) {
      return artifact
    }
  }
  return null
}

/**
 * Retrieves edge selections from edgeRefs argument (new API).
 * Used for edit flows when reading existing fillet calls with edgeRefs.
 * Parses edgeRefs array of objects with "faces" array (UUID or TagIdentifier refs)
 * and resolves each to graphSelectionsV2 for the command bar edit flow.
 */
export function retrieveEdgeSelectionsFromEdgeRefs(
  edgeRefsArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (edgeRefsArg.value.type !== 'Array') {
    return new Error('edgeRefs argument is not an array')
  }
  const edgeRefItems = edgeRefsArg.value.value
  const graphSelectionsV2: SelectionV2[] = []

  for (const item of edgeRefItems) {
    if (item.type !== 'Object' || !item.value) continue
    const value = item.value as Record<string, OpKclValue>
    const facesProp = value['faces']
    if (!facesProp || facesProp.type !== 'Array') continue
    const faceValues = facesProp.value ?? []
    const faceIds: string[] = []
    for (const v of faceValues) {
      const id = faceRefToArtifactId(v)
      if (id) faceIds.push(id)
    }
    if (faceIds.length < 2) continue
    const edgeArtifact = findEdgeArtifactFromFaceIds(faceIds, artifactGraph)
    if (!edgeArtifact) continue
    const codeRefs = getCodeRefsByArtifactId(edgeArtifact.id, artifactGraph)
    if (!codeRefs?.length) continue
    // Use type 'edge' with faces so addFillet emits edgeRefs (not tags)
    const entityRef: EntityReference = { type: 'edge', faces: faceIds }
    graphSelectionsV2.push({ entityRef, codeRef: codeRefs[0] })
  }

  return { graphSelectionsV2, otherSelections: [] }
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
  selection: ResolvedGraphSelection,
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
  const { artifact, codeRef } = selection
  if (!artifact || artifact.type !== 'edgeCut') {
    return new Error('Selection is not an edge cut')
  }
  if (!codeRef) {
    return new Error('Selection has no codeRef')
  }

  const { subType } = artifact
  if (!isEdgeTreatmentType(subType)) {
    return new Error('Unsupported or missing edge treatment type')
  }

  // 2. Clone ast and retrieve the edge treatment node
  const astClone = structuredClone(ast)
  const edgeTreatmentNode = getNodeFromPath<
    VariableDeclarator | ExpressionStatement
  >(astClone, codeRef.pathToNode, wasmInstance, [
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
    const deleteResult = deleteTopLevelStatement(astClone, codeRef.pathToNode)
    if (err(deleteResult)) return deleteResult
    return astClone
  } else {
    const deleteResult = deleteNodeInExtrudePipe(
      astClone,
      codeRef.pathToNode,
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
  // selectionsV2: edge artifacts are segment or edgeCut (sweepEdge removed); use tag directly
  return createLocalName(tag)
}

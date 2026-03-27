import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createMemberExpression,
  createObjectExpression,
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
  DirectTagFilletMeta,
  EdgeRefactorMeta,
  Expr,
  ExpressionStatement,
  MemberExpression,
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
  EdgeRefFromOpArgs,
  EntityReference,
  Selection,
  Selections,
  EnginePrimitiveSelection,
} from '@src/machines/modelingSharedTypes'
import type { ResolvedGraphSelection } from '@src/lang/std/artifactGraph'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getFaceCodeRef,
  getSweepArtifactFromSelection,
  getSweepFromSuspectedSweepSurface,
  getCommonFacesForEdge,
} from '@src/lang/std/artifactGraph'
import {
  modifyAstWithTagsForSelection,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/tagManagement'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import { deleteNodeInExtrudePipe } from '@src/lang/modifyAst/deleteNodeInExtrudePipe'
import { findKwArg } from '@src/lang/util'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  getEngineTopologyFallbackNormalized,
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import { getBodySelectionFromPrimitiveParentEntityId } from '@src/lang/modifyAst/faces'

/** Set localStorage DEBUG_FILLET_SELECTION=1 for topology / groupSelectionsByBody diagnostics. */
function debugFilletTopologyLogs(): boolean {
  return (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('DEBUG_FILLET_SELECTION') === '1'
  )
}

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
    side_faces: faceIds,
  }
}

/**
 * Type alias for EdgeRef payload used in KCL edgeRefs array
 */
type FilletEdgeRefPayload = {
  side_faces: string[]
  end_faces?: string[]
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
    side_faces: entityRef.side_faces,
  }

  // Only include end_faces if present and non-empty
  if (entityRef.end_faces && entityRef.end_faces.length > 0) {
    payload.end_faces = entityRef.end_faces
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
 * @param tagsBaseExpr - When original tags were referenced as base.tags.x (e.g. bs.tags.edge7), pass the base expr so we emit sideFaces = [base.tags.edge6, base.tags.edge7]
 */
export function createEdgeRefObjectExpression(
  payload: FilletEdgeRefPayload,
  wasmInstance: ModuleType,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  originalEdgeSelection?: ResolvedGraphSelection,
  fallbackCodeRef?: CodeRef,
  tagsBaseExpr?: Expr | null
): { expr: Expr; modifiedAst: Node<Program> } | Error {
  // Resolve face UUIDs to tags
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
  if (payload.end_faces && payload.end_faces.length > 0) {
    for (const disambId of payload.end_faces) {
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

  // KCL uses camelCase for object keys (sideFaces, endFaces)
  const sideFacesExprs =
    tagsBaseExpr != null
      ? faceTags.map((tag) =>
          createMemberExpression(
            createMemberExpression(tagsBaseExpr, 'tags'),
            tag
          )
        )
      : faceTags.map((tag) => createLocalName(tag))

  const properties: { [key: string]: Expr } = {
    sideFaces: createArrayExpression(sideFacesExprs),
  }

  if (disambiguatorTags.length > 0) {
    const endFacesExprs =
      tagsBaseExpr != null
        ? disambiguatorTags.map((tag) =>
            createMemberExpression(
              createMemberExpression(tagsBaseExpr, 'tags'),
              tag
            )
          )
        : disambiguatorTags.map((tag) => createLocalName(tag))
    properties.endFaces = createArrayExpression(endFacesExprs)
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

function isRevolveOrHelix(callee: string): boolean {
  return callee === 'revolve' || callee === 'helix'
}

function isExtrude(callee: string): boolean {
  return callee === 'extrude'
}

/** Tags as array elements: from tags = [a, b] or tags = singleExpr (single value is valid KCL). */
function getTagsElementsFromCall(call: Node<CallExpressionKw>): Expr[] | null {
  const tagsArg = call.arguments?.find(
    (a) => (a.label as { name?: string })?.name === 'tags'
  )
  if (!tagsArg?.arg) return null
  if (tagsArg.arg.type === 'ArrayExpression')
    return tagsArg.arg.elements ?? null
  return [tagsArg.arg]
}

function getExistingEdgeRefsFromCall(call: Node<CallExpressionKw>): Expr[] {
  const edgeRefsArg = call.arguments?.find(
    (a) =>
      (a.label as { name?: string })?.name === 'edges' ||
      (a.label as { name?: string })?.name === 'edgeRefs'
  )
  if (!edgeRefsArg?.arg || edgeRefsArg.arg.type !== 'ArrayExpression') return []
  return edgeRefsArg.arg.elements ?? []
}

/**
 * If the tag element is a deprecated stdlib call whose first argument is base.tags.tagName
 * (e.g. getPreviousAdjacentEdge(bs.tags.edge7)), returns the base expression (e.g. bs).
 * Used so Z0006 refactor can emit edgeRefs with the same style: sideFaces = [bs.tags.edge6, bs.tags.edge7].
 */
function getTagsBaseFromTagElement(el: Expr): Expr | null {
  if (el.type !== 'CallExpressionKw') return null
  const inner = el as Node<CallExpressionKw>
  const calleeName = (inner.callee as { name?: { name?: string } })?.name?.name
  if (
    !calleeName ||
    !(DEPRECATED_EDGE_STDLIB as readonly string[]).includes(calleeName)
  )
    return null
  const firstArg = inner.unlabeled ?? null
  if (!firstArg || firstArg.type !== 'MemberExpression') return null
  const outerMem = firstArg as { object: Expr; property: Expr }
  if (outerMem.object.type !== 'MemberExpression') return null
  const innerMem = outerMem.object as { object: Expr; property: Expr }
  const propName = (innerMem.property as { name?: { name?: string } })?.name
    ?.name
  if (propName !== 'tags') return null
  return innerMem.object
}

function callSourceRangeMatches(
  meta: DirectTagFilletMeta,
  start: number,
  end: number,
  moduleId: number
): boolean {
  const sr = meta.callSourceRange
  if (isArray(sr))
    return (
      Number(sr[0]) === start &&
      Number(sr[1]) === end &&
      (Number((sr as [number, number, number])[2]) ?? 0) === moduleId
    )
  const s = sr as { start?: number; end?: number; moduleId?: number }
  return (
    Number(s.start ?? 0) === start &&
    Number(s.end ?? 0) === end &&
    (Number(s.moduleId) ?? 0) === moduleId
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
  // Exact match
  if (metaStart === start && metaEnd === end) return true
  // Lenient: metadata range contains node range
  if (metaStart <= start && metaEnd >= end) return true
  // Lenient: ranges overlap (engine and parser may use slightly different spans)
  if (start <= metaEnd && end >= metaStart) return true
  return false
}

/** One entry per fillet/chamfer call: ordered face IDs from tags (stdlib + direct). Existing edgeRefs read from call when mutating. */
interface UnifiedCallToFix {
  range: [number, number, number]
  orderedFaceIds: [string, string][]
  hasExistingEdgeRefs: boolean
  /** When tags were referenced as base.tags.x (e.g. bs.tags.edge7), the base expr so we emit the same style. */
  tagsBaseExpr?: Expr | null
}

interface ExprWalkOptions {
  resolveWrappedCalls?: boolean
  includeCallUnlabeled?: boolean
}

type ExprVisitor = (
  expr: Expr,
  pathPrefix: PathToNode | undefined,
  walk: (expr: Expr, pathPrefix?: PathToNode) => void
) => void

function visitExpr(
  expr: Expr,
  visitor: ExprVisitor,
  options: ExprWalkOptions,
  pathPrefix?: PathToNode
): void {
  const walk = (nextExpr: Expr, nextPathPrefix = pathPrefix) =>
    walkExpr(nextExpr, visitor, options, nextPathPrefix)
  visitor(expr, pathPrefix, walk)
}

function walkExpr(
  expr: Expr,
  visitor: ExprVisitor,
  options: ExprWalkOptions,
  pathPrefix?: PathToNode
): void {
  if (!expr || typeof expr !== 'object') return

  if (expr.type === 'PipeExpression') {
    for (const bodyExpr of (expr as { body?: Expr[] }).body ?? []) {
      visitExpr(bodyExpr, visitor, options, pathPrefix)
    }
    return
  }

  const callExpr = options.resolveWrappedCalls
    ? getCallFromExpr(expr)
    : expr.type === 'CallExpressionKw'
      ? (expr as Node<CallExpressionKw>)
      : null
  if (callExpr) {
    if (options.includeCallUnlabeled && callExpr.unlabeled) {
      visitExpr(callExpr.unlabeled, visitor, options, pathPrefix)
    }
    for (const arg of callExpr.arguments ?? []) {
      visitExpr(arg.arg, visitor, options, pathPrefix)
    }
    return
  }

  if (expr.type === 'BinaryExpression') {
    if (expr.left) walkExpr(expr.left, visitor, options, pathPrefix)
    if (expr.right) walkExpr(expr.right, visitor, options, pathPrefix)
    return
  }
  if (expr.type === 'ArrayExpression') {
    for (const element of expr.elements ?? []) {
      walkExpr(element, visitor, options, pathPrefix)
    }
    return
  }
  if (expr.type === 'ObjectExpression') {
    for (const property of expr.properties ?? []) {
      walkExpr(property.value, visitor, options, pathPrefix)
    }
    return
  }
  if (expr.type === 'LabelledExpression') {
    visitExpr(expr.expr, visitor, options, pathPrefix)
  } else if (expr.type === 'AscribedExpression') {
    visitExpr(expr.expr, visitor, options, pathPrefix)
  } else if (expr.type === 'UnaryExpression') {
    walkExpr(expr.argument, visitor, options, pathPrefix)
  } else if (expr.type === 'MemberExpression') {
    walkExpr(expr.object, visitor, options, pathPrefix)
    walkExpr(expr.property, visitor, options, pathPrefix)
  }
}

/** Walk program and collect (range, orderedFaceIds, hasExistingEdgeRefs) for each fillet/chamfer call that has tags and/or edgeRefs. */
function findFilletChamferCallsToFixUnified(
  program: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  directTagFilletMetadata: DirectTagFilletMeta[]
): UnifiedCallToFix[] {
  const results: UnifiedCallToFix[] = []

  const processExpr: ExprVisitor = (expr, _pathPrefix, walk) => {
    if (expr.type !== 'CallExpressionKw') {
      walk(expr)
      return
    }
    const call = expr as Node<CallExpressionKw>
    const calleeName = (call.callee as { name?: { name?: string } })?.name?.name
    if (!calleeName || !isFilletOrChamfer(calleeName)) {
      walk(expr)
      return
    }
    const elements = getTagsElementsFromCall(call)
    const existingEdgeRefExprs = getExistingEdgeRefsFromCall(call)
    const orderedFaceIds: [string, string][] = []
    let tagsBaseExpr: Expr | null = null

    if (elements?.length) {
      for (const el of elements) {
        if (tagsBaseExpr === null) {
          const base = getTagsBaseFromTagElement(el)
          if (base !== null) tagsBaseExpr = base
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

    walk(expr)
  }

  for (const item of program.body ?? []) {
    if (item.type === 'VariableDeclaration' && item.declaration?.init) {
      visitExpr(item.declaration.init, processExpr, {
        includeCallUnlabeled: true,
      })
    } else if (item.type === 'ExpressionStatement' && item.expression) {
      visitExpr(item.expression, processExpr, {
        includeCallUnlabeled: true,
      })
    } else if (
      item.type === 'ReturnStatement' &&
      (item as { argument?: Expr }).argument
    ) {
      visitExpr((item as { argument: Expr }).argument, processExpr, {
        includeCallUnlabeled: true,
      })
    }
  }

  return results
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

  const processExpr: ExprVisitor = (expr, _pathPrefix, walk) => {
    if (expr.type !== 'CallExpressionKw') {
      walk(expr)
      return
    }
    const call = expr as Node<CallExpressionKw>
    const calleeName = (call.callee as { name?: { name?: string } })?.name?.name
    if (!calleeName || !isFilletOrChamfer(calleeName)) {
      walk(expr)
      return
    }
    const elements = getTagsElementsFromCall(call)
    if (!elements?.length) {
      walk(expr)
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
      walk(expr)
      return
    }

    const orderedMetas: EdgeRefactorMeta[] = []
    for (const range of deprecatedRanges) {
      const meta = metadata.find((m) =>
        sourceRangeMatch(m, range.start, range.end, range.moduleId)
      )
      if (!meta) {
        walk(expr)
        return
      }
      orderedMetas.push(meta)
    }

    const moduleId = (call as { module_id?: number }).module_id ?? 0
    results.push({
      range: [call.start, call.end, moduleId],
      orderedMetas,
    })
    walk(expr)
  }

  for (const item of program.body ?? []) {
    if (item.type === 'VariableDeclaration' && item.declaration?.init) {
      visitExpr(item.declaration.init, processExpr, {
        includeCallUnlabeled: true,
      })
    } else if (item.type === 'ExpressionStatement' && item.expression) {
      visitExpr(item.expression, processExpr, {
        includeCallUnlabeled: true,
      })
    } else if (
      item.type === 'ReturnStatement' &&
      (item as { argument?: Expr }).argument
    ) {
      visitExpr((item as { argument: Expr }).argument, processExpr, {
        includeCallUnlabeled: true,
      })
    }
  }

  return results
}

/**
 * Refactor fillet/chamfer `tags` that use deprecated edge stdlib to `edgeRefs` with face tags (not UUIDs).
 * Uses artifact graph to resolve face IDs to tag names (adding tagEnd/tagStart or segment tags when missing).
 */
export function refactorFilletChamferTagsToEdgeRefs(
  ast: Node<Program>,
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
      const payload = { side_faces: meta.faceIds }
      const result = createEdgeRefObjectExpression(
        payload,
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
    const tagsIdx = callNode.arguments?.findIndex(
      (a) => (a.label as { name?: string })?.name === 'tags'
    )
    if (tagsIdx === undefined || tagsIdx < 0) continue
    callNode.arguments[tagsIdx] = createLabeledArg(
      'edges',
      createArrayExpression(edgeRefExprs)
    )
  }
  const out = recast(modifiedAst, wasmInstance)
  return err(out) ? out : out
}

/**
 * Unified refactor: convert all tags (stdlib + direct) to edgeRefs and merge with existing edgeRefs.
 * Handles mixed tags = [e1, getOppositeEdge(e1)] and tags + edgeRefs together.
 */
export function refactorFilletChamferTagsToEdgeRefsUnified(
  ast: Node<Program>,
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
  if (toFix.length === 0)
    return new Error('No fillet/chamfer calls with tags or edgeRefs to convert')
  let modifiedAst = structuredClone(ast)
  for (const { range, orderedFaceIds, hasExistingEdgeRefs } of toFix) {
    const path = getNodePathFromSourceRange(modifiedAst, range)
    const edgeRefExprs: Expr[] = []
    for (const faceIds of orderedFaceIds) {
      const result = createEdgeRefObjectExpression(
        { side_faces: faceIds },
        wasmInstance,
        modifiedAst,
        artifactGraph
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
      const existing = getExistingEdgeRefsFromCall(callNode)
      edgeRefExprs.push(...existing)
    }
    if (edgeRefExprs.length === 0) continue
    const args = callNode.arguments ?? []
    const newArgs = args.filter(
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

/** One entry per revolve/helic call that has axis = deprecated stdlib (e.g. getOppositeEdge). */
interface RevolveHelixCallToFix {
  range: [number, number, number]
  faceIds: [string, string]
  /** When range is 0,0 we use this path to find the call (fallback). */
  pathToCall?: PathToNode
}

/** One entry per extrude call that has to = deprecated stdlib (e.g. getCommonEdge). */
interface ExtrudeToCallToFix {
  range: [number, number, number]
  faceIds: [string, string]
  pathToCall?: PathToNode
}

/** Get CallExpressionKw from Expr whether inline (expr.type) or Rust externally-tagged (expr.CallExpressionKw). */
function getCallFromExpr(expr: Expr): Node<CallExpressionKw> | null {
  if (!expr || typeof expr !== 'object') return null
  const o = expr as Record<string, unknown>
  if (o.type === 'CallExpressionKw') return o as Node<CallExpressionKw>
  const inner = o.CallExpressionKw
  return inner && typeof inner === 'object'
    ? (inner as Node<CallExpressionKw>)
    : null
}

/** Path to the concrete CallExpressionKw node for inline or externally-tagged Expr shapes. */
function getCallPathFromExpr(
  expr: Expr,
  pathPrefix?: PathToNode
): PathToNode | undefined {
  if (!pathPrefix || pathPrefix.length === 0) return undefined
  const o = expr as Record<string, unknown>
  if (o?.type === 'CallExpressionKw') return [...pathPrefix]
  if (o?.CallExpressionKw && typeof o.CallExpressionKw === 'object') {
    return [...pathPrefix, ['CallExpressionKw', '']]
  }
  return undefined
}

/** Exported for tests: find revolve/helic calls with deprecated axis to fix. */
export function findRevolveHelixCallsToFix(
  program: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[]
): RevolveHelixCallToFix[] {
  const results: RevolveHelixCallToFix[] = []
  /** Candidates: revolve/helic calls with deprecated axis, for fallback matching by order. */
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
      // Fallback: match by order (first metadata entry with first revolve/helic call)
      const metaIndex = edgeRefactorMetadata.findIndex((m) => {
        const ids = isArray(m.faceIds)
          ? m.faceIds
          : (m as { faceIds?: unknown[] }).faceIds
        return ids && ids.length >= 2
      })
      if (metaIndex >= 0 && callPath && callPath.length > 0) {
        const m = edgeRefactorMetadata[metaIndex]
        const faceIds = isArray(m.faceIds)
          ? ([m.faceIds[0], m.faceIds[1]] as [string, string])
          : ([
              (m as { faceIds?: string[] }).faceIds?.[0],
              (m as { faceIds?: string[] }).faceIds?.[1],
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
      const body = (expr as { body?: Expr[] }).body
      if (isArray(body)) body.forEach((e) => visitExpr(e, pathPrefix))
      return
    }
    const callExpr = getCallFromExpr(expr)
    if (callExpr) {
      const c = callExpr
      if (c.unlabeled) walkExpr(c.unlabeled, pathPrefix)
      for (const a of c.arguments ?? []) walkExpr(a.arg, pathPrefix)
      return
    }
    if (expr.type === 'BinaryExpression') {
      const b = expr as { left?: Expr; right?: Expr }
      if (b.left) walkExpr(b.left, pathPrefix)
      if (b.right) walkExpr(b.right, pathPrefix)
      return
    }
    if (expr.type === 'ArrayExpression') {
      for (const e of (expr as { elements?: Expr[] }).elements ?? [])
        walkExpr(e, pathPrefix)
      return
    }
    if (expr.type === 'ObjectExpression') {
      const props = (expr as { properties?: { value: Expr }[] }).properties
      for (const p of isArray(props) ? props : []) walkExpr(p.value, pathPrefix)
      return
    }
    if (expr.type === 'LabelledExpression')
      visitExpr((expr as { expr: Expr }).expr, pathPrefix)
    else if (expr.type === 'AscribedExpression')
      visitExpr((expr as { expr: Expr }).expr, pathPrefix)
    else if (expr.type === 'UnaryExpression')
      walkExpr((expr as { argument: Expr }).argument, pathPrefix)
    else if (expr.type === 'MemberExpression') {
      walkExpr((expr as { object: Expr }).object, pathPrefix)
      walkExpr((expr as { property: Expr }).property, pathPrefix)
    }
  }

  const body = program.body ?? []
  for (let statementIndex = 0; statementIndex < body.length; statementIndex++) {
    const item = body[statementIndex] as Record<string, unknown>
    const pathPrefix: PathToNode = [
      ['body', ''],
      [statementIndex, 'index'],
    ]
    // Support both inline shape (item.type + item.declaration) and Rust externally-tagged (item.VariableDeclaration)
    const varDecl =
      item?.type === 'VariableDeclaration'
        ? (item as { declaration?: { init?: Expr } }).declaration
        : (
            item?.VariableDeclaration as
              | { declaration?: { init?: Expr } }
              | undefined
          )?.declaration
    if (varDecl?.init) {
      const declPath: PathToNode =
        item?.type === 'VariableDeclaration'
          ? [
              ...pathPrefix,
              ['declaration', 'VariableDeclaration'],
              ['init', ''],
            ]
          : [
              ...pathPrefix,
              ['VariableDeclaration', ''],
              ['declaration', 'VariableDeclaration'],
              ['init', ''],
            ]
      visitExpr(varDecl.init, declPath)
    } else {
      const exprStmt =
        item?.type === 'ExpressionStatement'
          ? (item as { expression?: Expr }).expression
          : (item?.ExpressionStatement as { expression?: Expr } | undefined)
              ?.expression
      if (exprStmt) {
        const exprPath: PathToNode =
          item?.type === 'ExpressionStatement'
            ? [...pathPrefix, ['expression', 'ExpressionStatement']]
            : [
                ...pathPrefix,
                ['ExpressionStatement', ''],
                ['expression', 'ExpressionStatement'],
              ]
        visitExpr(exprStmt, exprPath)
      } else {
        const ret =
          item?.type === 'ReturnStatement'
            ? (item as { argument?: Expr }).argument
            : (item?.ReturnStatement as { argument?: Expr } | undefined)
                ?.argument
        if (ret) {
          const retPath: PathToNode =
            item?.type === 'ReturnStatement'
              ? [...pathPrefix, ['argument', 'ReturnStatement']]
              : [
                  ...pathPrefix,
                  ['ReturnStatement', ''],
                  ['argument', 'ReturnStatement'],
                ]
          visitExpr(ret, retPath)
        }
      }
    }
  }
  // If no range-based match (e.g. executor and parser use different offsets), use first candidate with pathToCall
  if (results.length === 0 && candidates.length > 0) {
    const used = new Set<number>()
    for (const c of candidates) {
      if (used.has(c.metaIndex)) continue
      used.add(c.metaIndex)
      results.push({
        range: c.range,
        faceIds: c.faceIds,
        pathToCall: c.pathToCall,
      })
      break
    }
  }
  return results
}

/** findKwArg for a call's arguments. */
function findToArg(call: Node<CallExpressionKw>): Expr | null {
  const arg = call.arguments?.find(
    (a) => (a.label as { name?: string })?.name === 'to'
  )
  return arg?.arg ?? null
}

/**
 * Find extrude calls whose `to` argument is a deprecated stdlib call (getCommonEdge, getOppositeEdge, etc.).
 * Used by Z0006 refactor to replace `to = getCommonEdge(...)` with `to = { sideFaces = [...] }`.
 */
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
      walkExprExtrude(expr, pathPrefix)
      return
    }
    const callPath = getCallPathFromExpr(expr, pathPrefix)
    const calleeName = (call.callee as { name?: { name?: string } })?.name?.name
    if (!calleeName || !isExtrude(calleeName)) {
      walkExprExtrude(expr, pathPrefix)
      return
    }
    const toArg = findToArg(call)
    const inner = toArg ? getCallFromExpr(toArg) : null
    if (!inner) {
      walkExprExtrude(expr, pathPrefix)
      return
    }
    const innerCallee = (inner.callee as { name?: { name?: string } })?.name
      ?.name
    if (
      !innerCallee ||
      !(DEPRECATED_EDGE_STDLIB as readonly string[]).includes(innerCallee)
    ) {
      walkExprExtrude(expr, pathPrefix)
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
      const faceIds = isArray(meta.faceIds)
        ? ([meta.faceIds[0], meta.faceIds[1]] as [string, string])
        : ([
            (meta as { faceIds?: string[] }).faceIds?.[0],
            (meta as { faceIds?: string[] }).faceIds?.[1],
          ].filter(Boolean) as [string, string])
      if (faceIds.length === 2) {
        results.push({
          range: [callStart, callEnd, moduleId],
          faceIds,
          pathToCall: callPath,
        })
      }
    } else {
      const metaIndex = edgeRefactorMetadata.findIndex((m) => {
        const ids = isArray(m.faceIds)
          ? m.faceIds
          : (m as { faceIds?: unknown[] }).faceIds
        return ids && ids.length >= 2
      })
      if (metaIndex >= 0 && callPath && callPath.length > 0) {
        const m = edgeRefactorMetadata[metaIndex]
        const faceIds = isArray(m.faceIds)
          ? ([m.faceIds[0], m.faceIds[1]] as [string, string])
          : ([
              (m as { faceIds?: string[] }).faceIds?.[0],
              (m as { faceIds?: string[] }).faceIds?.[1],
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
    walkExprExtrude(expr, pathPrefix)
  }

  function walkExprExtrude(expr: Expr, pathPrefix?: PathToNode): void {
    if (!expr || typeof expr !== 'object') return
    const o = expr as Record<string, unknown>
    if (o.type === 'CallExpressionKw' || o.CallExpressionKw) {
      const c = getCallFromExpr(expr)
      if (c?.arguments) {
        for (const a of c.arguments) {
          const label = a.label as { name?: string } | undefined
          if (label?.name && a.arg) visitExpr(a.arg, pathPrefix)
        }
      }
      return
    }
    if (o.type === 'VariableDeclaration' || o.VariableDeclaration) {
      const v = o.VariableDeclaration ?? o
      const decl = (v as { declaration?: { init?: Expr } }).declaration
      if (decl?.init) visitExpr(decl.init, pathPrefix)
      return
    }
    if (o.type === 'BinaryExpression') {
      const b = expr as { left?: Expr; right?: Expr }
      if (b.left) walkExprExtrude(b.left, pathPrefix)
      if (b.right) walkExprExtrude(b.right, pathPrefix)
      return
    }
    if (o.type === 'ArrayExpression') {
      for (const e of (expr as { elements?: Expr[] }).elements ?? [])
        walkExprExtrude(e, pathPrefix)
      return
    }
    if (o.type === 'ObjectExpression') {
      const props = (expr as { properties?: { value: Expr }[] }).properties
      for (const p of isArray(props) ? props : [])
        walkExprExtrude(p.value, pathPrefix)
      return
    }
    if (o.type === 'LabelledExpression')
      visitExpr((expr as { expr: Expr }).expr, pathPrefix)
    else if (o.type === 'AscribedExpression')
      visitExpr((expr as { expr: Expr }).expr, pathPrefix)
    else if (o.type === 'UnaryExpression')
      walkExprExtrude((expr as { argument: Expr }).argument, pathPrefix)
    else if (o.type === 'MemberExpression') {
      walkExprExtrude((expr as { object: Expr }).object, pathPrefix)
      walkExprExtrude((expr as { property: Expr }).property, pathPrefix)
    }
  }

  const body = program.body ?? []
  for (let statementIndex = 0; statementIndex < body.length; statementIndex++) {
    const item = body[statementIndex] as Record<string, unknown>
    const pathPrefix: PathToNode = [
      ['body', ''],
      [statementIndex, 'index'],
    ]
    const varDecl =
      item?.type === 'VariableDeclaration'
        ? (item as { declaration?: { init?: Expr } }).declaration
        : (
            item?.VariableDeclaration as
              | { declaration?: { init?: Expr } }
              | undefined
          )?.declaration
    if (varDecl?.init) {
      const declPath: PathToNode =
        item?.type === 'VariableDeclaration'
          ? [
              ...pathPrefix,
              ['declaration', 'VariableDeclaration'],
              ['init', ''],
            ]
          : [
              ...pathPrefix,
              ['VariableDeclaration', ''],
              ['declaration', 'VariableDeclaration'],
              ['init', ''],
            ]
      visitExpr(varDecl.init, declPath)
    } else {
      const exprStmt =
        item?.type === 'ExpressionStatement'
          ? (item as { expression?: Expr }).expression
          : (item?.ExpressionStatement as { expression?: Expr } | undefined)
              ?.expression
      if (exprStmt) {
        const exprPath: PathToNode =
          item?.type === 'ExpressionStatement'
            ? [...pathPrefix, ['expression', 'ExpressionStatement']]
            : [
                ...pathPrefix,
                ['ExpressionStatement', ''],
                ['expression', 'ExpressionStatement'],
              ]
        visitExpr(exprStmt, exprPath)
      }
    }
  }

  if (results.length === 0 && candidates.length > 0) {
    const used = new Set<number>()
    for (const c of candidates) {
      if (used.has(c.metaIndex)) continue
      used.add(c.metaIndex)
      results.push({
        range: c.range,
        faceIds: c.faceIds,
        pathToCall: c.pathToCall,
      })
      break
    }
  }
  return results
}

/**
 * Refactor revolve/helic calls that use deprecated axis (e.g. axis = getOppositeEdge(...))
 * to axis = { sideFaces = [...] } (edge reference payload). Mutates modifiedAst in place.
 * @param toFix - Precomputed list from findRevolveHelixCallsToFix(ast, ...)
 * @param pathList - Paths from getNodePathFromSourceRange(originalAst, range) so paths match the tree structure
 */
function refactorRevolveHelixAxisToEdgeRefInPlace(
  modifiedAst: Node<Program>,
  toFix: RevolveHelixCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  const resolveCallNode = (node: unknown): Node<CallExpressionKw> | null => {
    if (!node || typeof node !== 'object') return null
    const n = node as Record<string, unknown>
    if (n.type === 'CallExpressionKw') return n as Node<CallExpressionKw>
    const wrapped = n.CallExpressionKw
    return wrapped && typeof wrapped === 'object'
      ? (wrapped as Node<CallExpressionKw>)
      : null
  }

  if (toFix.length === 0) return modifiedAst
  for (let i = 0; i < toFix.length; i++) {
    const { faceIds, pathToCall } = toFix[i]
    const path = pathToCall && pathToCall.length > 0 ? pathToCall : pathList[i]
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
    const callNode = resolveCallNode(nodeResult.node)
    if (!callNode) continue
    const args = callNode.arguments ?? []
    const newArgs = args.filter(
      (a) =>
        (a.label as { name?: string })?.name !== 'axis' &&
        (a.label as { name?: string })?.name !== 'axis'
    )
    newArgs.push(createLabeledArg('axis', result.expr))
    callNode.arguments = newArgs
  }
  return modifiedAst
}

/**
 * Refactor extrude calls that use deprecated `to` (e.g. to = getCommonEdge(...))
 * to to = { sideFaces = [...] }. Mutates modifiedAst in place.
 */
function refactorExtrudeToToEdgeSpecifierInPlace(
  modifiedAst: Node<Program>,
  toFix: ExtrudeToCallToFix[],
  pathList: PathToNode[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Node<Program> {
  const resolveCallNode = (node: unknown): Node<CallExpressionKw> | null => {
    if (!node || typeof node !== 'object') return null
    const n = node as Record<string, unknown>
    if (n.type === 'CallExpressionKw') return n as Node<CallExpressionKw>
    const wrapped = n.CallExpressionKw
    return wrapped && typeof wrapped === 'object'
      ? (wrapped as Node<CallExpressionKw>)
      : null
  }

  if (toFix.length === 0) return modifiedAst
  for (let i = 0; i < toFix.length; i++) {
    const { faceIds, pathToCall } = toFix[i]
    const path = pathToCall && pathToCall.length > 0 ? pathToCall : pathList[i]
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
    const callNode = resolveCallNode(nodeResult.node)
    if (!callNode) continue
    const args = callNode.arguments ?? []
    const newArgs = args.filter(
      (a) => (a.label as { name?: string })?.name !== 'to'
    )
    newArgs.push(createLabeledArg('to', result.expr))
    callNode.arguments = newArgs
  }
  return modifiedAst
}

function isNodeProgram(ast: Program): ast is Node<Program> {
  return (
    'start' in ast &&
    typeof ast.start === 'number' &&
    'end' in ast &&
    typeof ast.end === 'number' &&
    'moduleId' in ast &&
    typeof ast.moduleId === 'number' &&
    'commentStart' in ast &&
    typeof ast.commentStart === 'number'
  )
}

/**
 * Unified Z0006 refactor: fillet/chamfer tags→edgeRefs and revolve/helic axis→edgeRef.
 * Returns refactored source or Error if nothing to fix.
 */
export function refactorZ0006Unified(
  ast: Program,
  edgeRefactorMetadata: EdgeRefactorMeta[],
  directTagFilletMetadata: DirectTagFilletMeta[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | Error {
  const toFixFC = findFilletChamferCallsToFixUnified(
    ast,
    edgeRefactorMetadata,
    directTagFilletMetadata
  )
  const toFixRH = findRevolveHelixCallsToFix(ast, edgeRefactorMetadata)
  const toFixET = findExtrudeToCallsToFix(ast, edgeRefactorMetadata)
  if (toFixFC.length === 0 && toFixRH.length === 0 && toFixET.length === 0)
    return new Error('No Z0006 fixes to apply')
  if (!isNodeProgram(ast)) {
    return new Error('Expected AST node metadata for Z0006 refactor')
  }

  let modifiedAst = structuredClone(ast)

  for (const {
    range,
    orderedFaceIds,
    hasExistingEdgeRefs,
    tagsBaseExpr,
  } of toFixFC) {
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
      const existing = getExistingEdgeRefsFromCall(callNode)
      edgeRefExprs.push(...existing)
    }
    if (edgeRefExprs.length === 0) continue
    const args = callNode.arguments ?? []
    const newArgs = args.filter(
      (a) =>
        (a.label as { name?: string })?.name !== 'tags' &&
        (a.label as { name?: string })?.name !== 'edges' &&
        (a.label as { name?: string })?.name !== 'edgeRefs'
    )
    newArgs.push(createLabeledArg('edges', createArrayExpression(edgeRefExprs)))
    callNode.arguments = newArgs
  }

  const pathListRH = toFixRH.map((t) =>
    t.pathToCall && t.pathToCall.length > 0
      ? t.pathToCall
      : getNodePathFromSourceRange(ast, t.range)
  )
  modifiedAst = refactorRevolveHelixAxisToEdgeRefInPlace(
    modifiedAst,
    toFixRH,
    pathListRH,
    artifactGraph,
    wasmInstance
  )

  const pathListET = toFixET.map((t) =>
    t.pathToCall && t.pathToCall.length > 0
      ? t.pathToCall
      : getNodePathFromSourceRange(ast, t.range)
  )
  modifiedAst = refactorExtrudeToToEdgeSpecifierInPlace(
    modifiedAst,
    toFixET,
    pathListET,
    artifactGraph,
    wasmInstance
  )

  const out = recast(modifiedAst, wasmInstance)
  return err(out) ? out : out
}

/** Normalize DirectTagFilletMeta.callSourceRange to [start, end, moduleId] for getNodePathFromSourceRange. */
function callSourceRangeToTuple(
  callSourceRange: DirectTagFilletMeta['callSourceRange']
): [number, number, number] {
  if (isArray(callSourceRange))
    return [
      Number(callSourceRange[0]),
      Number(callSourceRange[1]),
      Number((callSourceRange as [number, number, number])[2] ?? 0),
    ]
  const sr = callSourceRange as {
    start?: number
    end?: number
    moduleId?: number
  }
  return [Number(sr.start ?? 0), Number(sr.end ?? 0), Number(sr.moduleId ?? 0)]
}

/**
 * Refactor fillet/chamfer calls that use direct tags to edgeRefs using execution metadata.
 * Used for Z0006 auto-fix when directTagFilletMetadata is present.
 */
export function refactorDirectTagFilletToEdgeRefs(
  ast: Node<Program>,
  directTagFilletMetadata: DirectTagFilletMeta[],
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | Error {
  if (!directTagFilletMetadata?.length)
    return new Error('No direct tag fillet metadata')
  let modifiedAst = structuredClone(ast)
  for (const meta of directTagFilletMetadata) {
    if (!meta.tags?.length) continue
    const range = callSourceRangeToTuple(meta.callSourceRange)
    const path = getNodePathFromSourceRange(modifiedAst, range)
    const edgeRefExprs: Expr[] = []
    for (const tagEntry of meta.tags) {
      const payload = { side_faces: tagEntry.faceIds }
      const result = createEdgeRefObjectExpression(
        payload,
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
    const tagsIdx = callNode.arguments?.findIndex(
      (a) => (a.label as { name?: string })?.name === 'tags'
    )
    if (tagsIdx === undefined || tagsIdx < 0) continue
    callNode.arguments[tagsIdx] = createLabeledArg(
      'edges',
      createArrayExpression(edgeRefExprs)
    )
  }
  const out = recast(modifiedAst, wasmInstance)
  return err(out) ? out : out
}

/**
 * Groups edge selections by body and creates edgeRefs expressions.
 * Uses graphSelections if available, otherwise converts graphSelections to EntityReferences.
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

  const v2Selections = selections.graphSelections || []
  const hasV2Selections = v2Selections.length > 0

  if (hasV2Selections) {
    // V2-only path: Group V2 selections by body using face IDs
    const bodyToV2Selections = new Map<
      string,
      {
        sweepArtifact: SweepArtifact
        edgeEntityRefs: Array<Extract<EntityReference, { type: 'edge' }>>
      }
    >()

    for (const v2Sel of v2Selections) {
      const resolved = resolveSelectionV2(v2Sel, artifactGraph)
      if (!resolved?.artifact) continue

      // Convert segment/edgeCut selections into the V2 `edge` entityRef shape
      // expected by edgeRef payload creation.
      const edgeEntityRef:
        | Extract<EntityReference, { type: 'edge' }>
        | undefined =
        v2Sel.entityRef?.type === 'edge'
          ? v2Sel.entityRef
          : (() => {
              const er = edgeSelectionToEntityReference(
                {
                  ...(resolved as ResolvedGraphSelection),
                  artifact: resolved.artifact,
                },
                artifactGraph
              )
              return err(er)
                ? undefined
                : (er as Extract<EntityReference, { type: 'edge' }>)
            })()

      if (!edgeEntityRef) continue

      // Find a face artifact that ties this edge to a sweep (wall/cap/edgeCut/primitiveFace).
      // Shell and inner edges may not use only wall/cap in the graph; fall back via sweep surface resolution.
      let faceArtifact: Artifact | undefined
      for (const faceId of edgeEntityRef.side_faces) {
        const a = artifactGraph.get(faceId)
        if (
          a &&
          (a.type === 'wall' ||
            a.type === 'cap' ||
            a.type === 'edgeCut' ||
            a.type === 'primitiveFace')
        ) {
          faceArtifact = a
          break
        }
      }
      if (!faceArtifact) {
        for (const faceId of edgeEntityRef.side_faces) {
          const sweepTry = getSweepFromSuspectedSweepSurface(
            faceId,
            artifactGraph
          )
          if (!err(sweepTry)) {
            const a = artifactGraph.get(faceId)
            if (a) {
              faceArtifact = a
              break
            }
          }
        }
      }
      if (!faceArtifact) continue

      const faceCodeRef =
        getFaceCodeRef(faceArtifact as Parameters<typeof getFaceCodeRef>[0]) ??
        getCodeRefsByArtifactId(faceArtifact.id, artifactGraph)?.[0]
      if (!faceCodeRef) continue

      const sweepArtifact = getSweepArtifactFromSelection(
        { artifact: faceArtifact, codeRef: faceCodeRef },
        artifactGraph
      )
      if (err(sweepArtifact)) continue

      const bodyKey = JSON.stringify(sweepArtifact.codeRef.pathToNode)
      if (!bodyToV2Selections.has(bodyKey)) {
        bodyToV2Selections.set(bodyKey, {
          sweepArtifact,
          edgeEntityRefs: [],
        })
      }
      bodyToV2Selections.get(bodyKey)!.edgeEntityRefs.push(edgeEntityRef)
    }

    // Process each body
    for (const [bodyKey, bodyData] of bodyToV2Selections.entries()) {
      const bodyEdgeRefs: Expr[] = []

      // Create edgeRefs from V2 selections
      for (const edgeEntityRef of bodyData.edgeEntityRefs) {
        const payload = entityReferenceToEdgeRefPayload(edgeEntityRef)
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

      if (bodyEdgeRefs.length === 0) continue

      // Build solids expression
      const solids: Selections = {
        graphSelections: [
          {
            entityRef: artifactToEntityRef('sweep', bodyData.sweepArtifact.id),
            codeRef: bodyData.sweepArtifact.codeRef,
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
        return bodySelections.graphSelections.some(
          (bs: Selection) => bs.codeRef?.pathToNode === sel.codeRef?.pathToNode
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
        for (const v2Sel of bodySelections.graphSelections) {
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
      const firstResolved = bodySelections.graphSelections[0]
        ? resolveSelectionV2(bodySelections.graphSelections[0], artifactGraph)
        : null
      if (!firstResolved) continue
      const sweep = getSweepArtifactFromSelection(firstResolved, artifactGraph)
      if (err(sweep)) continue
      const solids: Selections = {
        graphSelections: [
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
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // When editing an existing fillet that already has edgeRefs, only update radius (and tag).
  // This avoids rebuilding from selection, which can fall back to deprecated tags/getCommonEdge.
  if (mNodeToEdit) {
    const existingResult = getNodeFromPath(
      modifiedAst,
      mNodeToEdit,
      wasmInstance,
      'CallExpressionKw'
    )
    if (!err(existingResult)) {
      const existingCall = existingResult.node as Node<CallExpressionKw>
      const hasEdgeRefs =
        findKwArg('edges', existingCall) !== undefined ||
        findKwArg('edgeRefs', existingCall) !== undefined
      if (hasEdgeRefs) {
        const newArgs = (existingCall.arguments ?? []).map((a) => {
          const name = (a.label as { name?: string })?.name
          if (name === 'radius')
            return createLabeledArg('radius', valueOrVariable(radius))
          if (name === 'tag' && tag)
            return createLabeledArg('tag', createTagDeclarator(tag))
          return a
        })
        const call = createCallExpressionStdLibKw(
          'fillet',
          existingCall.unlabeled,
          newArgs
        )
        const pathToNode = setCallInAst({
          ast: modifiedAst,
          call,
          pathToEdit: mNodeToEdit,
          wasmInstance,
        })
        if (err(pathToNode)) return pathToNode
        return { modifiedAst, pathToNode: [pathToNode] }
      }
    }
  }

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
        createLabeledArg('edges', data.edgeRefsExpr),
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

  // When editing an existing chamfer that already has edgeRefs, only update length/secondLength/angle/tag.
  if (mNodeToEdit) {
    const existingResult = getNodeFromPath(
      modifiedAst,
      mNodeToEdit,
      wasmInstance,
      'CallExpressionKw'
    )
    if (!err(existingResult)) {
      const existingCall = existingResult.node as Node<CallExpressionKw>
      const hasEdgeRefs =
        findKwArg('edges', existingCall) !== undefined ||
        findKwArg('edgeRefs', existingCall) !== undefined
      if (hasEdgeRefs) {
        const newArgs = (existingCall.arguments ?? []).map((a) => {
          const name = (a.label as { name?: string })?.name
          if (name === 'length')
            return createLabeledArg('length', valueOrVariable(length))
          if (name === 'secondLength' && secondLength != null)
            return createLabeledArg(
              'secondLength',
              valueOrVariable(secondLength)
            )
          if (name === 'angle' && angle != null)
            return createLabeledArg('angle', valueOrVariable(angle))
          if (name === 'tag' && tag)
            return createLabeledArg('tag', createTagDeclarator(tag))
          return a
        })
        const call = createCallExpressionStdLibKw(
          'chamfer',
          existingCall.unlabeled,
          newArgs
        )
        const pathToNode = setCallInAst({
          ast: modifiedAst,
          call,
          pathToEdit: mNodeToEdit,
          wasmInstance,
        })
        if (err(pathToNode)) return pathToNode
        return { modifiedAst, pathToNode: [pathToNode] }
      }
    }
  }

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
        createLabeledArg('edges', data.edgeRefsExpr),
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
type BodySelectionData = {
  solidsExpr: Expr | null
  tagsExpr: Expr
  pathIfPipe?: PathToNode
}

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
      graphSelections: [
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
 * User-visible "No edges found in the selection" has four distinct origins in this file (grep `codemod:`):
 * 1) groupSelectionsByBodyAndAddTags — no body keys (empty selectionsByBody)
 * 2) groupSelectionsByBodyAndAddTags — body keys existed but no fillet rows produced (empty bodies map)
 * 3) buildSolidsAndTagsExprs — no tags expression
 * 4) insertPrimitiveEdgeVariablesAndOffsetPathToNode — tagsExpr empty after edgeId inserts (e.g. blend)
 *
 * Fillet review uses addFillet → (1) or (2) only.
 */

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
  options?: { includePrimitiveEdgeIndices?: boolean }
):
  | {
      modifiedAst: Node<Program>
      bodies: Map<string, BodySelectionData>
    }
  | Error {
  const includePrimitiveEdgeIndices =
    options?.includePrimitiveEdgeIndices ?? false
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
      if (
        !isEnginePrimitiveSelection(selection) ||
        !selection.parentEntityId ||
        selection.primitiveType !== 'edge'
      ) {
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

    // Same SelectionV2 row as graph edge; topology_fallback supplies primitive index when tags fail.
    // Shell inner edges often lack wall/cap in the artifact graph — resolveSelectionV2 may fail; use
    // engineTopologyFallback.parentId to find the sweep body and edgeId(solid, primitiveIndex).
    for (const v2Sel of selections.graphSelections) {
      const topo = getEngineTopologyFallbackNormalized(v2Sel)
      if (!topo) continue
      const debugFillet = debugFilletTopologyLogs()
      if (debugFillet) {
        console.info(
          '[groupSelectionsByBodyAndAddTags topology loop] fallback candidate',
          {
            parentId: topo.parentId,
            primitiveIndex: topo.primitiveIndex,
            hasGraphEntityRef: Boolean(v2Sel.entityRef),
            hasGraphCodeRefPath: Boolean(v2Sel.codeRef?.pathToNode),
          }
        )
      }
      const { parentId, primitiveIndex } = topo

      let sweepArtifact: SweepArtifact | null = null
      let usedParentIdFallback = false

      const resolved = resolveSelectionV2(v2Sel, artifactGraph)
      if (resolved) {
        const sweepTry = getSweepArtifactFromSelection(resolved, artifactGraph)
        if (!err(sweepTry)) {
          sweepArtifact = sweepTry
        }
      }

      if (!sweepArtifact) {
        const fromParent = getBodySelectionFromPrimitiveParentEntityId(
          parentId,
          artifactGraph
        )
        if (fromParent?.artifact) {
          if (fromParent.artifact.type === 'sweep') {
            sweepArtifact = fromParent.artifact as SweepArtifact
          } else if (fromParent.artifact.type === 'compositeSolid') {
            // Shell/boolean body: same codeRef/id wiring as sweep for edgeId(solid, index)
            sweepArtifact = fromParent.artifact as unknown as SweepArtifact
          } else {
            const sweepTry = getSweepArtifactFromSelection(
              fromParent,
              artifactGraph
            )
            if (!err(sweepTry)) {
              sweepArtifact = sweepTry
            }
          }
        }
        if (sweepArtifact) {
          usedParentIdFallback = true
        }
      }

      if (!sweepArtifact) {
        if (debugFilletTopologyLogs()) {
          const fp = getBodySelectionFromPrimitiveParentEntityId(
            parentId,
            artifactGraph
          )
          console.info(
            '[groupSelectionsByBodyAndAddTags topology loop] skip: no sweepArtifact after resolve + parentId',
            {
              parentId,
              primitiveIndex,
              fromParentType: fp?.artifact?.type ?? null,
            }
          )
        }
        continue
      }

      const bodyKey = JSON.stringify(sweepArtifact.codeRef.pathToNode)
      const bodySelection: ResolvedGraphSelection = {
        artifact: sweepArtifact as Artifact,
        codeRef: sweepArtifact.codeRef,
      }
      if (debugFillet) {
        console.info(
          '[groupSelectionsByBodyAndAddTags topology loop] assigning primitive indices to body',
          {
            parentId,
            primitiveIndex,
            bodyKeySnippet: bodyKey.slice(0, 80),
            sweepArtifactType: (sweepArtifact as Artifact).type,
          }
        )
      }
      const byBody = primitiveSelectionsByBody.get(bodyKey)
      if (byBody) {
        if (!byBody.primitiveIndices.includes(primitiveIndex)) {
          byBody.primitiveIndices.push(primitiveIndex)
        }
      } else {
        primitiveSelectionsByBody.set(bodyKey, {
          bodySelection,
          primitiveIndices: [primitiveIndex],
        })
      }
      if (!selectionsByBody.has(bodyKey)) {
        selectionsByBody.set(bodyKey, {
          graphSelections: [],
          otherSelections: [],
        })
      }

      if (usedParentIdFallback) {
        console.warn(
          '[fillet topology fallback] entity_get_parent_id fallback executed — engine should now provide sweep/composite artifacts',
          {
            bodyKeySnippet: bodyKey.slice(0, 80),
            primitiveIndex,
            parentId,
          }
        )
      } else if (debugFillet) {
        console.info('[fillet topology fallback]', {
          bodyKeySnippet: bodyKey.slice(0, 80),
          primitiveIndex,
          parentId,
          usedParentIdFallback,
        })
      }
    }
  }

  if (selectionsByBody.size === 0) {
    return new Error(
      'No edges found in the selection (codemod: groupSelectionsByBodyAndAddTags — no body keys; graph grouping + primitive/topology fallback produced nothing)'
    )
  }

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
      const firstResolved = resolveSelectionV2(
        bodySelections.graphSelections[0],
        artifactGraph
      )
      if (firstResolved) {
        const sweep = getSweepArtifactFromSelection(
          firstResolved,
          artifactGraph
        )
        if (!err(sweep)) {
          bodySelectionForSolids = {
            codeRef: sweep.codeRef,
          }
        }
      }
    }
    if (!bodySelectionForSolids) {
      bodySelectionForSolids =
        primitiveSelectionsByBody.get(bodyKey)?.bodySelection
    }

    // Build solids expression: use V2 selection or, when only engine primitive edges, body from primitive
    const firstResolved = bodySelections.graphSelections[0]
      ? resolveSelectionV2(bodySelections.graphSelections[0], artifactGraph)
      : null
    let sweepResult: ReturnType<typeof getSweepArtifactFromSelection>
    if (firstResolved) {
      const trySweep = getSweepArtifactFromSelection(
        firstResolved,
        artifactGraph
      )
      if (!err(trySweep)) {
        sweepResult = trySweep
      } else {
        const primitiveBody =
          primitiveSelectionsByBody.get(bodyKey)?.bodySelection
        if (primitiveBody?.artifact) {
          if (primitiveBody.artifact.type === 'sweep') {
            sweepResult = primitiveBody.artifact as SweepArtifact
          } else if (primitiveBody.artifact.type === 'compositeSolid') {
            sweepResult = primitiveBody.artifact as unknown as SweepArtifact
          } else {
            sweepResult = getSweepArtifactFromSelection(
              primitiveBody,
              artifactGraph
            )
          }
        } else {
          sweepResult = trySweep
        }
      }
    } else {
      const primitiveBody =
        primitiveSelectionsByBody.get(bodyKey)?.bodySelection
      if (!primitiveBody?.artifact) continue
      if (primitiveBody.artifact.type === 'sweep') {
        sweepResult = primitiveBody.artifact as SweepArtifact
      } else if (primitiveBody.artifact.type === 'compositeSolid') {
        sweepResult = primitiveBody.artifact as unknown as SweepArtifact
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
      graphSelections: [
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

    const tagsExprsCombined = [...tagsExprs]
    const primForBody = primitiveSelectionsByBody.get(bodyKey)
    if (primForBody?.primitiveIndices.length && solidsExpr) {
      let insertIndex = modifiedAst.body.length
      for (const primitiveIndex of primForBody.primitiveIndices) {
        const edgeIdExpr = createCallExpressionStdLibKw(
          'edgeId',
          structuredClone(solidsExpr),
          [
            createLabeledArg(
              'index',
              createLiteral(primitiveIndex, wasmInstance)
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
        insertIndex++
        tagsExprsCombined.push(variableIdentifierAst)
      }
    }

    if (tagsExprsCombined.length === 0) {
      continue
    }

    const tagsExpr = createVariableExpressionsArray(tagsExprsCombined)
    if (!tagsExpr) {
      continue
    }

    bodies.set(bodyKey, {
      solidsExpr,
      tagsExpr,
      pathIfPipe: vars.pathIfPipe,
    })
  }

  if (bodies.size === 0) {
    return new Error(
      'No edges found in the selection (codemod: groupSelectionsByBodyAndAddTags — had body keys but every body skipped: no tags + no edgeId rows)'
    )
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
  const bodyToV2Selections = new Map<string, Selection[]>()

  for (const v2Sel of selections.graphSelections) {
    const resolved = resolveSelectionV2(v2Sel, artifactGraph)
    const topologyNormalized = getEngineTopologyFallbackNormalized(v2Sel)
    const debugFillet = debugFilletTopologyLogs()
    const rawTopologyCamel = v2Sel.engineTopologyFallback ?? undefined
    const rawTopologySnake = (v2Sel as { engine_topology_fallback?: unknown })
      .engine_topology_fallback
    if (!resolved) {
      if (debugFillet) {
        console.info('[groupSelectionsByBody] v2 iteration', {
          resolved: false,
          engineTopologyFallbackCamel: rawTopologyCamel ?? null,
          engineTopologyFallbackSnake: rawTopologySnake ?? null,
          topologyNormalized,
        })
      }
      continue
    }
    const sweepArtifact = getSweepArtifactFromSelection(resolved, artifactGraph)
    if (debugFillet) {
      console.info('[groupSelectionsByBody] v2 iteration', {
        resolved: true,
        resolvedArtifactType: resolved.artifact?.type,
        sweepFailed: err(sweepArtifact),
        engineTopologyFallbackCamel: rawTopologyCamel ?? null,
        engineTopologyFallbackSnake: rawTopologySnake ?? null,
        topologyNormalized,
      })
    }
    if (err(sweepArtifact)) {
      // Shell inner edges: graph may not resolve to a sweep; engineTopologyFallback + edgeId(index) below.
      // Use normalized fallback so snake_case engine_topology_fallback is honored (same as topology loop).
      if (topologyNormalized) {
        if (debugFillet) {
          console.info(
            '[groupSelectionsByBody] sweep lookup failed; deferring to topology fallback',
            {
              topologyNormalized,
              codeRefPath: resolved.codeRef.pathToNode,
            }
          )
        }
        continue
      }
      return sweepArtifact
    }

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
      graphSelections: v2Sels,
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
    graphSelections: faces.graphSelections.flatMap((f: Selection) => {
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
    return new Error(
      'No edges found in the selection (codemod: buildSolidsAndTagsExprs — no tags expression after getTagsExprsFromSelection)'
    )
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
  for (const v2Sel of edges.graphSelections) {
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
  _unlabeledArg: unknown,
  tagsArg: OpArg,
  artifactGraph: ArtifactGraph,
  _code?: string
) {
  if (
    !tagsArg?.value ||
    typeof tagsArg.value !== 'object' ||
    !('type' in tagsArg.value)
  ) {
    return { graphSelections: [], otherSelections: [] }
  }
  const tagValues: OpKclValue[] = []
  if (tagsArg.value.type === 'Array') {
    tagValues.push(...tagsArg.value.value)
  } else {
    tagValues.push(tagsArg.value)
  }

  const graphSelections: Selection[] = []
  for (const v of tagValues) {
    if (v == null || typeof v !== 'object' || !('type' in v)) {
      console.warn(
        'retrieveEdgeSelectionsFromOpArgs: skipping invalid tag value',
        v
      )
      continue
    }
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
    graphSelections.push({ entityRef, codeRef: codeRefs[0] })
  }

  return { graphSelections, otherSelections: [] }
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
 * Parses edgeRefs array of objects with "sideFaces" array (UUID or TagIdentifier refs)
 * and resolves each to graphSelections for the command bar edit flow.
 */
export function retrieveEdgeSelectionsFromEdgeRefs(
  edgeRefsArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (edgeRefsArg.value.type !== 'Array') {
    return new Error('edgeRefs argument is not an array')
  }
  const edgeRefItems = edgeRefsArg.value.value
  const graphSelections: Selection[] = []

  for (const item of edgeRefItems) {
    if (item.type !== 'Object' || !item.value) continue
    const value = item.value as EdgeRefFromOpArgs
    const facesProp = (value.sideFaces ?? value.side_faces) as
      | OpKclValue
      | undefined
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
    const entityRef: EntityReference = { type: 'edge', side_faces: faceIds }
    graphSelections.push({ entityRef, codeRef: codeRefs[0] })
  }

  return { graphSelections, otherSelections: [] }
}

/**
 * Retrieves edge selections from a single edge-ref-shaped kw arg (legacy `edgeRef` or `axis` object).
 * Used for edit flows when the call has axis = { sideFaces = [...] } (or legacy edgeRef = ...).
 */
export function retrieveEdgeSelectionsFromSingleEdgeRef(
  edgeRefArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (edgeRefArg.value.type !== 'Object' || !edgeRefArg.value.value) {
    return new Error('edgeRef argument is not an object')
  }
  const value = edgeRefArg.value.value as EdgeRefFromOpArgs
  const facesProp = (value.sideFaces ?? value.side_faces) as
    | OpKclValue
    | undefined
  if (!facesProp || facesProp.type !== 'Array') {
    return new Error('edgeRef has no sideFaces array')
  }
  const faceValues = facesProp.value ?? []
  const faceIds: string[] = []
  for (const v of faceValues) {
    const id = faceRefToArtifactId(v)
    if (id) faceIds.push(id)
  }
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
  const entityRef: EntityReference = { type: 'edge', side_faces: faceIds }
  return {
    graphSelections: [{ entityRef, codeRef: codeRefs[0] }],
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
      bodySelection: ResolvedGraphSelection
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
      const art = primitiveData.bodySelection.artifact
      const pathId =
        art?.type === 'segment'
          ? (art as { pathId?: string }).pathId
          : undefined
      const entityRef = artifactToEntityRef(
        art?.type ?? 'sweep',
        art?.id ?? '',
        pathId
      )
      if (!entityRef) continue
      const vars = getVariableExprsFromSelection(
        {
          graphSelections: [
            { entityRef, codeRef: primitiveData.bodySelection.codeRef },
          ],
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
      return new Error(
        'No edges found in the selection (codemod: insertPrimitiveEdgeVariablesAndOffsetPathToNode — tagsExpr empty after edgeId inserts)'
      )
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

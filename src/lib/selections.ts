import type { SelectionRange } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import type {
  Point2d,
  QueryEntityTypeWithPoint,
  RegionGetResolvableIntersectionInfo,
  WebSocketRequest,
} from '@kittycad/lib'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { Object3D } from 'three'
import { Mesh } from 'three'

import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { PlaneName } from '@rust/kcl-lib/bindings/PlaneName'

import type { EntityReference } from '@kittycad/lib'
import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import {
  EXTRA_SEGMENT_HANDLE,
  SEGMENT_BLUE,
  SEGMENT_BODIES_PLUS_PROFILE_START,
  getParentGroup,
} from '@src/clientSideScene/sceneConstants'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { OnClickCallbackArgs } from '@src/clientSideScene/sceneInfra'
import { AXIS_GROUP, X_AXIS } from '@src/clientSideScene/sceneUtils'
import { showSketchOnImportToast } from '@src/components/SketchOnImportToast'
import type { KclManager } from '@src/lang/KclManager'
import {
  createCallExpressionStdLibKw,
  createExpressionStatement,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createMemberExpression,
  nonCodeMetaEmpty,
} from '@src/lang/create'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import {
  findAllChildrenAndOrderByPlaceInCode,
  getEdgeCutMeta,
  getLastVariable,
  getNodeFromPath,
  getRegionSketchTagExprFromSourceSurface,
  getSettingsAnnotation,
  getSketchSegmentNameFromSourceSurface,
  getVariableExprsFromSelection,
  isSingleCursorInPipe,
} from '@src/lang/queryAst'
import { artifactToEntityRef, resolveToCodeRef } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { defaultSourceRange } from '@src/lang/sourceRange'
import type {
  Artifact,
  ArtifactId,
  CodeRef,
  ResolvedGraphSelection,
} from '@src/lang/std/artifactGraph'
import {
  getArtifactFromRange,
  getArtifactOfTypes,
  getCapCodeRef,
  getCodeRefsByArtifactId,
  getOriginalSegmentArtifact,
  getPatternArtifactForCopyId,
  getSketchBlockForArtifact,
  getSketchBlockForPathArtifact,
  getSolid2dCodeRef,
  getSweepArtifactFromSelection,
  getSweepFromSuspectedSweepSurface,
  getWallCodeRef,
} from '@src/lang/std/artifactGraph'
import type { PathToNodeMap } from '@src/lang/util'
import {
  findKwArg,
  isCursorInSketchCommandRange,
  topLevelRange,
} from '@src/lang/util'
import type {
  ArtifactGraph,
  CallExpressionKw,
  ExecState,
  Expr,
  Program,
  SourceRange,
} from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import type { ArtifactEntry, ArtifactIndex } from '@src/lib/artifactIndex'
import type {
  CommandArgument,
  CommandSelectionType,
} from '@src/lib/commandTypes'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  DEFAULT_LENGTH_UNIT_CONVERSION_DECIMAL_PLACES,
} from '@src/lib/constants'
import type { DefaultPlaneStr } from '@src/lib/planes'
import type RustContext from '@src/lib/rustContext'
import { err, isErr } from '@src/lib/trap'
import {
  getNormalisedCoordinates,
  isArray,
  isNonNullable,
  isOverlap,
  mmToBaseUnit,
  uuidv4,
} from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ModelingMachineEvent } from '@src/machines/modelingMachine'
import type {
  DefaultPlane,
  DefaultPlaneSelection,
  EnginePrimitiveSelection,
  EngineRegionSelection,
  ExtrudeFacePlane,
  NonCodeSelection,
  OffsetPlane,
} from '@src/machines/modelingSharedTypes'
import type {
  EngineTopologyFallback,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import toast from 'react-hot-toast'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
export const X_AXIS_UUID = 'ad792545-7fd3-482a-a602-a93924e3055b'
export const Y_AXIS_UUID = '680fd157-266f-4b8a-984f-cdf46b8bdf01'

type NormalizableEdgeReference = Partial<
  Extract<EntityReference, { type: 'edge' }>
> & {
  sideFaces?: unknown
  /** Legacy alias accepted by older engine/API payloads. */
  faces?: unknown
  endFaces?: unknown
}

type NormalizableVertexReference = Partial<
  Extract<EntityReference, { type: 'vertex' }>
> & {
  sideFaces?: unknown
  /** Legacy alias accepted by older engine/API payloads. */
  faces?: unknown
}

async function getParentEntityIdForEntity(
  entityId: string,
  engineCommandManager: ConnectionManager
): Promise<string | undefined> {
  const parentResponse = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'entity_get_parent_id',
      entity_id: entityId,
    },
  })
  if (!isModelingResponse(parentResponse)) return undefined
  const parentIdResponse = parentResponse.resp.data.modeling_response
  if (parentIdResponse.type !== 'entity_get_parent_id') return undefined
  return parentIdResponse.data.entity_id
}

/**
 * Walk the engine parent chain and artifact graph until we find a sweep (or composite solid)
 * that `getBodySelectionFromPrimitiveParentEntityId` can use for edgeId codemods.
 */
async function resolveSweepParentEntityIdForEdge(
  entityId: string,
  engineCommandManager: ConnectionManager,
  artifactGraph: ArtifactGraph
): Promise<string | undefined> {
  if (!entityId) return undefined
  const MAX_HOPS = 16
  type SearchNode = {
    id: string
    depth: number
    via: 'start' | 'parent'
  }
  const queue: SearchNode[] = [{ id: entityId, depth: 0, via: 'start' }]
  const visited = new Set<string>()
  const parentCache = new Map<string, string | null>()
  const fetchParent = async (id: string): Promise<string | undefined> => {
    if (parentCache.has(id)) {
      const cached = parentCache.get(id)
      return cached ?? undefined
    }
    const parent = await getParentEntityIdForEntity(id, engineCommandManager)
    parentCache.set(id, parent ?? null)
    return parent ?? undefined
  }

  while (queue.length > 0) {
    const node = queue.shift()!
    if (!node.id || visited.has(node.id)) continue
    visited.add(node.id)

    const artifact = artifactGraph.get(node.id)

    if (artifact?.type === 'sweep' || artifact?.type === 'compositeSolid') {
      return artifact.id
    }
    if (
      artifact &&
      (artifact.type === 'wall' ||
        artifact.type === 'cap' ||
        artifact.type === 'edgeCut')
    ) {
      const sweep = getSweepFromSuspectedSweepSurface(node.id, artifactGraph)
      if (!err(sweep)) {
        return sweep.id
      }
    }
    if (artifact?.type === 'path') {
      const pathArtifact = artifact as {
        sweepId?: string
        compositeSolidId?: string
      }
      const sweepId = pathArtifact.sweepId
      if (sweepId && artifactGraph.has(sweepId)) {
        return sweepId
      }
      const compositeSolidId = pathArtifact.compositeSolidId
      if (compositeSolidId && artifactGraph.has(compositeSolidId)) {
        return compositeSolidId
      }
    }

    if (node.depth >= MAX_HOPS) {
      continue
    }

    const parent = await fetchParent(node.id)
    if (parent) {
      queue.push({ id: parent, depth: node.depth + 1, via: 'parent' })
    }
  }
  return undefined
}

async function getResolvableIntersectionInfoForRegion(
  regionId: ArtifactId,
  engineCommandManager: ConnectionManager
): Promise<RegionGetResolvableIntersectionInfo | null> {
  const response = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'region_get_resolvable_intersection_info',
      region_id: regionId,
    },
  })
  if (!isModelingResponse(response)) return null
  const regionInfoResponse = response.resp.data.modeling_response
  if (regionInfoResponse.type !== 'region_get_resolvable_intersection_info') {
    return null
  }
  return regionInfoResponse.data
}

async function getRegionQueryPointForRegion(
  regionId: ArtifactId,
  engineCommandManager: ConnectionManager
): Promise<Point2d | null> {
  const response = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'region_get_query_point',
      region_id: regionId,
    },
  })
  if (!isModelingResponse(response)) return null
  const queryPointResponse = response.resp.data.modeling_response
  if (queryPointResponse?.type !== 'region_get_query_point') return null
  return queryPointResponse.data?.query_point ?? null
}

function getSketchIdForRegionInfo(
  regionInfo: RegionGetResolvableIntersectionInfo,
  artifactGraph: ArtifactGraph
): ArtifactId | null {
  const segmentIds = [regionInfo.segment, regionInfo.intersection_segment]
  for (const segmentId of segmentIds) {
    const segment = getOriginalSegmentArtifact(segmentId, artifactGraph)
    if (!segment) continue

    const sketch = getSketchBlockForArtifact(segment, artifactGraph)
    if (sketch) return sketch.id
  }

  return null
}

async function getSketchIdForEngineRegionEntity(
  regionEntityId: string,
  artifactGraph: ArtifactGraph,
  engineCommandManager: ConnectionManager
): Promise<ArtifactId | null> {
  const parentEntityId = await getParentEntityIdForEntity(
    regionEntityId,
    engineCommandManager
  )
  if (!parentEntityId) return null

  const path = artifactGraph.get(parentEntityId)
  if (!path || path.type !== 'path') return null

  const sketch = getSketchBlockForPathArtifact(path, artifactGraph)
  return sketch?.id ?? null
}

export async function getEngineRegionSelectionFromEntity(
  regionEntityId: string,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  engineCommandManager: ConnectionManager,
  wasmInstance: ModuleType,
  useSegmentsBasedRegions = false
): Promise<EngineRegionSelection | null> {
  if (!useSegmentsBasedRegions) {
    const queryPointMm = await getRegionQueryPointForRegion(
      regionEntityId,
      engineCommandManager
    )
    if (!queryPointMm) return null
    const decimals = DEFAULT_LENGTH_UNIT_CONVERSION_DECIMAL_PLACES
    const settings = getSettingsAnnotation(ast, wasmInstance)
    const lengthUnit =
      !isErr(settings) && settings.defaultLengthUnit
        ? settings.defaultLengthUnit
        : DEFAULT_DEFAULT_LENGTH_UNIT
    const point: Point2d = {
      x: mmToBaseUnit(queryPointMm.x, decimals, lengthUnit),
      y: mmToBaseUnit(queryPointMm.y, decimals, lengthUnit),
    }

    const sketchId = await getSketchIdForEngineRegionEntity(
      regionEntityId,
      artifactGraph,
      engineCommandManager
    )
    if (!sketchId) return null

    return {
      type: 'engineRegion',
      id: regionEntityId,
      point,
      sketchId,
    }
  }

  const regionInfo = await getResolvableIntersectionInfoForRegion(
    regionEntityId,
    engineCommandManager
  )
  if (!regionInfo) return null

  const sketchId = getSketchIdForRegionInfo(regionInfo, artifactGraph)
  if (!sketchId) return null

  return {
    type: 'engineRegion',
    id: regionEntityId,
    sketchId,
    resolvableIntersectionInfo: regionInfo,
  }
}

/** Engine `entity_get_primitive_index` + parent id; used when the artifact graph cannot resolve edge code refs (e.g. shell inner edges). */
export async function getPrimitiveSelectionForEntity(
  entityId: string,
  engineCommandManager: ConnectionManager,
  artifactGraph: ArtifactGraph
): Promise<EnginePrimitiveSelection | null> {
  const websocketResponse = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'entity_get_primitive_index',
      entity_id: entityId,
    },
  })

  if (!isModelingResponse(websocketResponse)) return null

  const primitiveIndexResponse = websocketResponse.resp.data.modeling_response
  if (primitiveIndexResponse?.type !== 'entity_get_primitive_index') return null

  const entityGetPrimitiveIndex = primitiveIndexResponse.data

  const parentEntityId = await resolveSweepParentEntityIdForEdge(
    entityId,
    engineCommandManager,
    artifactGraph
  )
  if (!parentEntityId) return null

  return {
    type: 'enginePrimitive',
    entityId,
    parentEntityId,
    primitiveIndex: entityGetPrimitiveIndex.primitive_index,
    primitiveType: entityGetPrimitiveIndex.entity_type,
  }
}

export type SelectionReference = {
  id: string
  label: string
  code: string
  graphSelection?: Selection
  enginePrimitiveSelection?: EnginePrimitiveSelection
}

type ReferenceablePrimitiveSelection = EnginePrimitiveSelection & {
  primitiveType: 'face' | 'edge'
  graphSelection?: Selection
  enginePrimitiveSelection?: EnginePrimitiveSelection
}

const BODY_REFERENCE_ARTIFACT_TYPES: Artifact['type'][] = [
  'sweep',
  'compositeSolid',
  'pattern',
  'helix',
]

function isReferenceablePrimitiveSelection(
  selection: EnginePrimitiveSelection
): selection is ReferenceablePrimitiveSelection {
  return (
    selection.primitiveType === 'face' || selection.primitiveType === 'edge'
  )
}

function isBodyReferenceArtifact(
  artifact: Artifact | undefined
): artifact is Extract<
  Artifact,
  { type: 'sweep' | 'compositeSolid' | 'pattern' | 'helix' }
> {
  return (
    artifact?.type === 'sweep' ||
    artifact?.type === 'compositeSolid' ||
    artifact?.type === 'pattern' ||
    artifact?.type === 'helix'
  )
}

function isSegmentReferenceArtifact(
  artifact: Artifact | undefined
): artifact is Extract<Artifact, { type: 'segment' }> {
  return artifact?.type === 'segment'
}

function isPrimitiveReferenceArtifact(artifact: Artifact | undefined): boolean {
  return (
    artifact?.type === 'wall' ||
    artifact?.type === 'cap' ||
    artifact?.type === 'primitiveFace' ||
    artifact?.type === 'sweepEdge' ||
    artifact?.type === 'primitiveEdge' ||
    artifact?.type === 'edgeCut'
  )
}

function recastExpr(expr: Expr, wasmInstance: ModuleType) {
  const code = recast(
    {
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      body: [createExpressionStatement(expr)],
      nonCodeMeta: nonCodeMetaEmpty(),
      shebang: null,
      innerAttrs: [],
    } as unknown as Parameters<typeof recast>[0],
    wasmInstance
  )
  return err(code) ? null : code.trim()
}

export function getBodySelectionFromPrimitiveParentEntityId(
  parentEntityId: string,
  artifactGraph: ArtifactGraph,
  {
    bodyArtifactTypes = ['sweep', 'compositeSolid'],
    codeRefLookup = 'last',
    lookUpPatternCopies = false,
  }: {
    bodyArtifactTypes?: Artifact['type'][]
    codeRefLookup?: 'first' | 'last'
    lookUpPatternCopies?: boolean
  } = {}
): Selection | null {
  const parentArtifact =
    artifactGraph.get(parentEntityId) ??
    (lookUpPatternCopies
      ? getPatternArtifactForCopyId(parentEntityId, artifactGraph)
      : undefined)
  if (!parentArtifact) {
    return null
  }

  if (
    bodyArtifactTypes.includes(parentArtifact.type) &&
    'codeRef' in parentArtifact
  ) {
    return {
      artifact: parentArtifact,
      codeRef: parentArtifact.codeRef,
      engineEntityId:
        parentArtifact.id === parentEntityId ? undefined : parentEntityId,
    }
  }

  if (parentArtifact.type === 'path' && parentArtifact.sweepId) {
    const parentSweep = getArtifactOfTypes(
      { key: parentArtifact.sweepId, types: ['sweep'] },
      artifactGraph
    )
    if (!err(parentSweep)) {
      return {
        artifact: parentSweep as Artifact,
        codeRef: parentSweep.codeRef,
      }
    }
  }

  if (
    parentArtifact.type === 'cap' ||
    parentArtifact.type === 'wall' ||
    parentArtifact.type === 'edgeCut'
  ) {
    const parentSweep = getSweepFromSuspectedSweepSurface(
      parentArtifact.id,
      artifactGraph
    )
    if (!err(parentSweep)) {
      return {
        artifact: parentSweep as Artifact,
        codeRef: parentSweep.codeRef,
      }
    }
  }

  const parentCodeRefs = getCodeRefsByArtifactId(parentEntityId, artifactGraph)
  if (!parentCodeRefs || parentCodeRefs.length === 0) {
    return null
  }

  return {
    artifact: parentArtifact,
    codeRef:
      codeRefLookup === 'first'
        ? parentCodeRefs[0]
        : parentCodeRefs[parentCodeRefs.length - 1],
  }
}

type SelectionExpressionBuilderContext = {
  primitiveSelection: ReferenceablePrimitiveSelection
  artifactGraph: ArtifactGraph
  kclManager: KclManager
  wasmInstance: ModuleType
  engineCommandManager: ConnectionManager
}

type SelectionExpressionValidationContext =
  SelectionExpressionBuilderContext & {
    expr: Expr
    code: string
  }

type SelectionExpressionApproach = {
  create: (context: SelectionExpressionBuilderContext) => Expr | null
  validate: (context: SelectionExpressionValidationContext) => Promise<boolean>
}

function createFaceApiReferenceExpr() {
  return null
}

async function validateFaceApiReferenceExpr() {
  return false
}

function getTaggableEdgeArtifact(
  selection: Selection,
  artifactGraph: ArtifactGraph
): Extract<Artifact, { type: 'segment' | 'sweepEdge' }> | null {
  if (
    selection.artifact?.type === 'segment' ||
    selection.artifact?.type === 'sweepEdge'
  ) {
    return selection.artifact
  }

  if (selection.artifact?.type !== 'edgeCut') {
    return null
  }

  const consumedEdge = getArtifactOfTypes(
    {
      key: selection.artifact.consumedEdgeId ?? '',
      types: ['segment', 'sweepEdge'],
    },
    artifactGraph
  )
  return err(consumedEdge) ? null : consumedEdge
}

function getEdgeTagCallExpr(tag: Expr, artifact: Artifact): Expr {
  if (artifact.type === 'sweepEdge' && artifact.subType === 'opposite') {
    return createCallExpressionStdLibKw('getOppositeEdge', tag, [])
  }

  if (artifact.type === 'sweepEdge' && artifact.subType === 'adjacent') {
    return createCallExpressionStdLibKw('getNextAdjacentEdge', tag, [])
  }

  if (
    artifact.type === 'sweepEdge' &&
    artifact.subType === 'previousAdjacent'
  ) {
    return createCallExpressionStdLibKw('getPreviousAdjacentEdge', tag, [])
  }

  return tag
}

function getSourceSurfaceExpr(
  sourceSurfaceArtifact: Extract<Artifact, { type: 'sweep' }>,
  { artifactGraph, kclManager, wasmInstance }: SelectionExpressionBuilderContext
): Expr | null {
  const sourceSurfaceVars = getVariableExprsFromSelection(
    {
      graphSelections: [
        {
          artifact: sourceSurfaceArtifact,
          codeRef: sourceSurfaceArtifact.codeRef,
        },
      ],
      otherSelections: [],
    },
    artifactGraph,
    kclManager.ast,
    wasmInstance
  )
  if (err(sourceSurfaceVars) || sourceSurfaceVars.exprs.length !== 1) {
    return null
  }

  return sourceSurfaceVars.exprs[0]
}

function getSegmentArtifactForTagReference(
  artifact: Artifact,
  artifactGraph: ArtifactGraph
): Extract<Artifact, { type: 'segment' }> | null {
  if (artifact.type === 'segment') {
    return artifact
  }

  const segmentId =
    artifact.type === 'sweepEdge'
      ? artifact.segId
      : artifact.type === 'wall'
        ? artifact.segId
        : null
  if (!segmentId) {
    return null
  }

  const segment = getArtifactOfTypes(
    { key: segmentId, types: ['segment'] },
    artifactGraph
  )
  return err(segment) ? null : segment
}

function getExistingSegmentTagExpr(
  segmentArtifact: Extract<Artifact, { type: 'segment' }>,
  { kclManager, wasmInstance }: SelectionExpressionBuilderContext
): Expr | null {
  const segmentNode = getNodeFromPath<CallExpressionKw>(
    kclManager.ast,
    segmentArtifact.codeRef.pathToNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (err(segmentNode) || segmentNode.node.type !== 'CallExpressionKw') {
    return null
  }

  const tagArg = findKwArg('tag', segmentNode.node)
  if (tagArg?.type === 'TagDeclarator') {
    return createLocalName(tagArg.value)
  }

  return tagArg?.type === 'Name' ? structuredClone(tagArg) : null
}

function getDirectTagExprFromSourceSurface({
  sourceSurfaceArtifact,
  sourceSurfaceExpr,
  taggedArtifact,
  context,
}: {
  sourceSurfaceArtifact: Extract<Artifact, { type: 'sweep' }>
  sourceSurfaceExpr: Expr | null
  taggedArtifact: Artifact
  context: SelectionExpressionBuilderContext
}): Expr | null {
  const { artifactGraph, kclManager, wasmInstance } = context

  const regionTagExpr = getRegionSketchTagExprFromSourceSurface(
    sourceSurfaceArtifact,
    taggedArtifact,
    artifactGraph,
    kclManager.ast,
    wasmInstance
  )
  if (regionTagExpr) {
    return regionTagExpr
  }

  const sketchSegmentName = getSketchSegmentNameFromSourceSurface(
    sourceSurfaceArtifact,
    taggedArtifact,
    artifactGraph,
    kclManager.ast,
    wasmInstance,
    { fallbackToFirstSegment: false }
  )
  if (sourceSurfaceExpr && sketchSegmentName) {
    return createMemberExpression(
      createMemberExpression(
        createMemberExpression(structuredClone(sourceSurfaceExpr), 'sketch'),
        'tags'
      ),
      sketchSegmentName
    )
  }

  const segmentArtifact = getSegmentArtifactForTagReference(
    taggedArtifact,
    artifactGraph
  )
  return segmentArtifact
    ? getExistingSegmentTagExpr(segmentArtifact, context)
    : null
}

function createDirectTaggedFaceReferenceExpr(
  context: SelectionExpressionBuilderContext
): Expr | null {
  const { primitiveSelection, artifactGraph } = context

  if (primitiveSelection.primitiveType !== 'face') {
    return null
  }

  const graphSelection = primitiveSelection.graphSelection
  if (graphSelection?.artifact?.type !== 'wall' || !graphSelection.codeRef) {
    return null
  }
  const resolvedGraphSelection: ResolvedGraphSelection = {
    artifact: graphSelection.artifact,
    codeRef: graphSelection.codeRef,
  }

  const sourceSurfaceArtifact = getSweepArtifactFromSelection(
    resolvedGraphSelection,
    artifactGraph
  )
  if (err(sourceSurfaceArtifact)) {
    return null
  }
  const sourceSurface = sourceSurfaceArtifact as Extract<
    Artifact,
    { type: 'sweep' }
  >

  return getDirectTagExprFromSourceSurface({
    sourceSurfaceArtifact: sourceSurface,
    sourceSurfaceExpr: getSourceSurfaceExpr(sourceSurface, context),
    taggedArtifact: graphSelection.artifact,
    context,
  })
}

function createDirectTaggedEdgeReferenceExpr(
  context: SelectionExpressionBuilderContext
): Expr | null {
  const { primitiveSelection, artifactGraph } = context

  if (primitiveSelection.primitiveType !== 'edge') {
    return null
  }

  const graphSelection = primitiveSelection.graphSelection
  if (!graphSelection?.codeRef) {
    return null
  }

  const edgeArtifact = getTaggableEdgeArtifact(graphSelection, artifactGraph)
  if (!edgeArtifact || edgeArtifact.type === 'sweepEdge') {
    return null
  }
  const edgeSelection: ResolvedGraphSelection = {
    artifact: edgeArtifact,
    codeRef: graphSelection.codeRef,
  }

  const sourceSurfaceArtifact = getSweepArtifactFromSelection(
    edgeSelection,
    artifactGraph
  )
  if (err(sourceSurfaceArtifact)) {
    return null
  }
  const sourceSurface = sourceSurfaceArtifact as Extract<
    Artifact,
    { type: 'sweep' }
  >

  const tagExpr = getDirectTagExprFromSourceSurface({
    sourceSurfaceArtifact: sourceSurface,
    sourceSurfaceExpr: getSourceSurfaceExpr(sourceSurface, context),
    taggedArtifact: edgeArtifact,
    context,
  })
  return tagExpr
}

function createAdjacentOrOppositeEdgeReferenceExpr({
  primitiveSelection,
  artifactGraph,
  kclManager,
  wasmInstance,
}: SelectionExpressionBuilderContext): Expr | null {
  if (primitiveSelection.primitiveType !== 'edge') {
    return null
  }

  const graphSelection = primitiveSelection.graphSelection
  if (!graphSelection?.codeRef) {
    return null
  }

  const edgeArtifact = getTaggableEdgeArtifact(graphSelection, artifactGraph)
  if (!edgeArtifact || edgeArtifact.type !== 'sweepEdge') {
    return null
  }

  const segmentArtifact = getArtifactOfTypes(
    { key: edgeArtifact.segId, types: ['segment'] },
    artifactGraph
  )
  if (err(segmentArtifact)) {
    return null
  }

  const segmentSelection: ResolvedGraphSelection = {
    artifact: segmentArtifact,
    codeRef: graphSelection.codeRef,
  }

  const sourceSurfaceArtifact = getSweepArtifactFromSelection(
    segmentSelection,
    artifactGraph
  )
  if (err(sourceSurfaceArtifact)) {
    return null
  }

  const tagResult = modifyAstWithTagsForSelection(
    kclManager.ast,
    {
      ...graphSelection,
      artifact: segmentArtifact,
      codeRef: graphSelection.codeRef,
    },
    artifactGraph,
    wasmInstance,
    ['oppositeAndAdjacentEdges']
  )
  const tagExpr = err(tagResult) ? null : tagResult.exprs[0]
  if (!tagExpr) {
    return null
  }

  return getEdgeTagCallExpr(tagExpr, edgeArtifact)
}

function createTagReferenceExpr(
  context: SelectionExpressionBuilderContext
): Expr | null {
  return (
    createDirectTaggedFaceReferenceExpr(context) ??
    createDirectTaggedEdgeReferenceExpr(context) ??
    createAdjacentOrOppositeEdgeReferenceExpr(context)
  )
}

async function validateAvailableReferenceExpr({
  code,
}: SelectionExpressionValidationContext) {
  return code.length > 0
}

function createPrimitiveIndexReferenceExpr({
  primitiveSelection,
  artifactGraph,
  kclManager,
  wasmInstance,
}: SelectionExpressionBuilderContext): Expr | null {
  if (!primitiveSelection.parentEntityId) {
    return null
  }

  const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
    primitiveSelection.parentEntityId,
    artifactGraph,
    {
      bodyArtifactTypes: BODY_REFERENCE_ARTIFACT_TYPES,
      codeRefLookup: 'first',
      lookUpPatternCopies: true,
    }
  )
  if (!bodySelection) {
    return null
  }

  const bodyVariables = getVariableExprsFromSelection(
    { graphSelections: [bodySelection], otherSelections: [] },
    artifactGraph,
    kclManager.ast,
    wasmInstance,
    undefined,
    {
      lastChildLookup: true,
      artifactTypeFilter: BODY_REFERENCE_ARTIFACT_TYPES,
    }
  )
  if (err(bodyVariables) || bodyVariables.exprs.length === 0) {
    return null
  }

  const bodyExpr = bodyVariables.exprs[0]
  const functionName =
    primitiveSelection.primitiveType === 'face' ? 'faceId' : 'edgeId'
  return createCallExpressionStdLibKw(functionName, structuredClone(bodyExpr), [
    createLabeledArg(
      'index',
      createLiteral(primitiveSelection.primitiveIndex, wasmInstance)
    ),
  ])
}

const selectionExpressionApproaches: SelectionExpressionApproach[] = [
  {
    create: createFaceApiReferenceExpr,
    validate: validateFaceApiReferenceExpr,
  },
  {
    create: createTagReferenceExpr,
    validate: validateAvailableReferenceExpr,
  },
  {
    create: createPrimitiveIndexReferenceExpr,
    validate: validateAvailableReferenceExpr,
  },
]

async function createPrimitiveReferenceCode(
  context: SelectionExpressionBuilderContext
): Promise<string | null> {
  for (const approach of selectionExpressionApproaches) {
    const expr = approach.create(context)
    if (!expr) {
      continue
    }

    const code = recastExpr(expr, context.wasmInstance)
    if (!code) {
      continue
    }

    const isValid = await approach.validate({
      ...context,
      expr,
      code,
    })
    if (isValid) {
      return code
    }
  }

  return null
}

function createExpressionReferences({
  label,
  selection,
  artifactGraph,
  kclManager,
  wasmInstance,
  options,
}: {
  label: string
  selection: Selection
  artifactGraph: ArtifactGraph
  kclManager: KclManager
  wasmInstance: ModuleType
  options?: Parameters<typeof getVariableExprsFromSelection>[5]
}): SelectionReference[] {
  const variableExprs = getVariableExprsFromSelection(
    { graphSelections: [selection], otherSelections: [] },
    artifactGraph,
    kclManager.ast,
    wasmInstance,
    undefined,
    options
  )
  if (err(variableExprs)) {
    return []
  }

  return variableExprs.exprs.flatMap((expr) => {
    const code = recastExpr(expr, wasmInstance)
    if (!code) {
      return []
    }

    return [
      {
        id: `${label}:${selection.artifact?.id || selection.engineEntityId || code}:${code}`,
        label,
        code,
        graphSelection: selection,
      },
    ]
  })
}

export async function getSelectionReferences({
  graphSelections,
  enginePrimitives,
  artifactGraph,
  engineCommandManager,
  kclManager,
  wasmInstance,
}: {
  graphSelections: Selection[]
  enginePrimitives: EnginePrimitiveSelection[]
  artifactGraph: ArtifactGraph
  engineCommandManager: ConnectionManager
  kclManager: KclManager
  wasmInstance: ModuleType
}): Promise<SelectionReference[]> {
  const references: SelectionReference[] = []
  const primitiveSelections: ReferenceablePrimitiveSelection[] = []
  const graphSelectionByEntityId = new Map<string, Selection>(
    graphSelections.flatMap((selection): [string, Selection][] => {
      const entityId = selection.artifact?.id || selection.engineEntityId
      return entityId ? [[entityId, selection]] : []
    })
  )

  for (const selection of graphSelections) {
    if (isBodyReferenceArtifact(selection.artifact)) {
      references.push(
        ...createExpressionReferences({
          label: 'Body',
          selection,
          artifactGraph,
          kclManager,
          wasmInstance,
          options: {
            lastChildLookup: true,
            artifactTypeFilter: BODY_REFERENCE_ARTIFACT_TYPES,
          },
        })
      )
      continue
    }

    if (isSegmentReferenceArtifact(selection.artifact)) {
      references.push(
        ...createExpressionReferences({
          label: 'Segment',
          selection,
          artifactGraph,
          kclManager,
          wasmInstance,
        })
      )
      continue
    }

    if (!isPrimitiveReferenceArtifact(selection.artifact)) {
      continue
    }

    const entityId = selection.artifact?.id || selection.engineEntityId
    if (!entityId) {
      continue
    }

    const primitiveSelection = await getPrimitiveSelectionForEntity(
      entityId,
      engineCommandManager,
      artifactGraph
    )
    if (
      primitiveSelection &&
      isReferenceablePrimitiveSelection(primitiveSelection)
    ) {
      primitiveSelections.push({
        ...primitiveSelection,
        graphSelection: selection,
      })
    }
  }

  for (const selection of enginePrimitives) {
    if (isReferenceablePrimitiveSelection(selection)) {
      primitiveSelections.push({
        ...selection,
        graphSelection: graphSelectionByEntityId.get(selection.entityId),
        enginePrimitiveSelection: selection,
      })
    }
  }

  const dedupedPrimitiveSelections = [
    ...new Map(
      primitiveSelections.map((selection) => [
        `${selection.primitiveType}:${selection.parentEntityId || ''}:${selection.primitiveIndex}:${selection.entityId}`,
        selection,
      ])
    ).values(),
  ]

  for (const primitiveSelection of dedupedPrimitiveSelections) {
    const code = await createPrimitiveReferenceCode({
      primitiveSelection,
      artifactGraph,
      engineCommandManager,
      kclManager,
      wasmInstance,
    })
    if (!code) {
      continue
    }

    references.push({
      id: `${primitiveSelection.primitiveType}:${primitiveSelection.entityId}`,
      label: primitiveSelection.primitiveType === 'face' ? 'Face' : 'Edge',
      code,
      graphSelection: primitiveSelection.graphSelection,
      enginePrimitiveSelection: primitiveSelection.enginePrimitiveSelection,
    })
  }

  return [
    ...new Map(
      references.map((reference) => [
        `${reference.label}:${reference.code}`,
        reference,
      ])
    ).values(),
  ]
}

function isSameCodeRange(left: Selection, right: Selection) {
  if (!left.codeRef || !right.codeRef) {
    return false
  }

  return (
    left.codeRef.range[0] === right.codeRef.range[0] &&
    left.codeRef.range[1] === right.codeRef.range[1]
  )
}

function isSameGraphSelection(left: Selection, right: Selection) {
  if (left.artifact?.id && right.artifact?.id) {
    return left.artifact.id === right.artifact.id
  }

  if (left.engineEntityId && right.engineEntityId) {
    return left.engineEntityId === right.engineEntityId
  }

  return isSameCodeRange(left, right)
}

function isSameEnginePrimitiveSelection(
  left: EnginePrimitiveSelection,
  right: EnginePrimitiveSelection
) {
  return left.entityId === right.entityId
}

export function removeReferenceFromSelections(
  selections: Selections,
  reference: SelectionReference
): Selections {
  const graphSelectionToRemove = reference.graphSelection
  const enginePrimitiveSelectionToRemove = reference.enginePrimitiveSelection

  return {
    graphSelections: graphSelectionToRemove
      ? selections.graphSelections.filter(
          (selection) =>
            !isSameGraphSelection(selection, graphSelectionToRemove)
        )
      : selections.graphSelections,
    otherSelections: enginePrimitiveSelectionToRemove
      ? selections.otherSelections.filter(
          (selection) =>
            !(
              isEnginePrimitiveSelection(selection) &&
              isSameEnginePrimitiveSelection(
                selection,
                enginePrimitiveSelectionToRemove
              )
            )
        )
      : selections.otherSelections,
  }
}

export function isEnginePrimitiveSelection(
  s: NonCodeSelection
): s is EnginePrimitiveSelection {
  return (
    typeof s === 'object' &&
    s !== null &&
    'type' in s &&
    (s as { type: string }).type === 'enginePrimitive'
  )
}

export function isEngineRegionSelection(
  selection: Selections['otherSelections'][number]
): selection is EngineRegionSelection {
  return (
    typeof selection === 'object' &&
    'type' in selection &&
    selection.type === 'engineRegion'
  )
}

export function normalizeEntityReference(
  reference: unknown
): EntityReference | null {
  if (!reference || typeof reference !== 'object') return null

  const raw = reference as Record<string, unknown>
  const typeRaw = raw.type
  if (typeof typeRaw !== 'string') return null
  const type = typeRaw.toLowerCase()

  if (type === 'plane') {
    const plane_id = raw.plane_id ?? raw.planeId
    if (typeof plane_id !== 'string') return null
    return { type: 'plane', plane_id }
  }

  if (type === 'face') {
    const face_id = raw.face_id ?? raw.faceId
    if (typeof face_id !== 'string') return null
    return { type: 'face', face_id }
  }

  if (type === 'solid2d') {
    const solid2d_id = raw.solid2d_id ?? raw.solid2dId
    if (typeof solid2d_id !== 'string') return null
    return { type: 'solid2d', solid2d_id }
  }

  if (type === 'solid3d') {
    const solid3d_id = raw.solid3d_id ?? raw.solid3dId
    if (typeof solid3d_id !== 'string') return null
    return { type: 'solid3d', solid3d_id }
  }

  if (type === 'solid2d_edge' || type === 'solid2dEdge') {
    const edge_id = raw.edge_id ?? raw.edgeId
    if (typeof edge_id !== 'string') return null
    return { type: 'solid2d_edge', edge_id }
  }

  if (type === 'edge') {
    const r = raw as NormalizableEdgeReference
    // CMS / engine may send side_faces, sideFaces, or faces (OpenAPI EntityReference uses "faces")
    const sideFacesRaw = r.side_faces ?? r.sideFaces ?? r.faces
    const side_faces = isArray(sideFacesRaw)
      ? sideFacesRaw.filter((v): v is string => typeof v === 'string')
      : []
    const endFacesRaw = r.end_faces ?? r.endFaces
    const end_faces = isArray(endFacesRaw)
      ? endFacesRaw.filter((v): v is string => typeof v === 'string')
      : undefined
    const index = typeof r.index === 'number' ? r.index : undefined
    return { type: 'edge', side_faces, end_faces, index }
  }

  if (type === 'vertex') {
    const r = raw as NormalizableVertexReference
    const sideFacesRaw = r.side_faces ?? r.sideFaces ?? r.faces
    const side_faces = isArray(sideFacesRaw)
      ? sideFacesRaw.filter((v): v is string => typeof v === 'string')
      : []
    const index = typeof r.index === 'number' ? r.index : undefined
    return { type: 'vertex', side_faces, index }
  }

  if (type === 'segment') {
    const path_id = raw.path_id ?? raw.pathId
    const segment_id = raw.segment_id ?? raw.segmentId
    if (typeof path_id !== 'string' || typeof segment_id !== 'string')
      return null
    return { type: 'segment', path_id, segment_id }
  }

  if (type === 'region') {
    const region_id = raw.region_id ?? raw.regionId
    if (typeof region_id !== 'string') return null
    return { type: 'region', region_id }
  }

  return null
}

/** Parse engine reference.topology_fallback (snake or camelCase) into the frontend topology shape for edge picks. */
export function engineTopologyFallbackFromReference(
  reference: unknown
): EngineTopologyFallback | undefined {
  if (!reference || typeof reference !== 'object') return undefined
  const r = reference as Record<string, unknown>
  const tf = r.topology_fallback ?? r.topologyFallback
  if (!tf || typeof tf !== 'object') return undefined
  const t = tf as Record<string, unknown>
  const parentId = t.parent_id ?? t.parentId
  const primitiveIndexRaw = t.primitive_index ?? t.primitiveIndex
  if (typeof parentId !== 'string') return undefined
  const primitiveIndex =
    typeof primitiveIndexRaw === 'number'
      ? primitiveIndexRaw
      : typeof primitiveIndexRaw === 'string'
        ? parseInt(primitiveIndexRaw, 10)
        : NaN
  if (!Number.isFinite(primitiveIndex)) return undefined
  return { parentId, primitiveIndex }
}

/** Normalize topology_fallback whether it came from TS (camelCase) or engine JSON (snake_case). */
export function getEngineTopologyFallbackNormalized(v2: Selection): {
  parentId: string
  primitiveIndex: number
} | null {
  const raw =
    v2.engineTopologyFallback ??
    (v2 as { engine_topology_fallback?: unknown }).engine_topology_fallback
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const parentId =
    typeof o.parentId === 'string'
      ? o.parentId
      : typeof o.parent_id === 'string'
        ? o.parent_id
        : ''
  let primitiveIndex = NaN
  if (typeof o.primitiveIndex === 'number') primitiveIndex = o.primitiveIndex
  else if (typeof o.primitiveIndex === 'string')
    primitiveIndex = parseInt(String(o.primitiveIndex), 10)
  else if (typeof o.primitive_index === 'number')
    primitiveIndex = o.primitive_index
  else if (typeof o.primitive_index === 'string')
    primitiveIndex = parseInt(String(o.primitive_index), 10)
  if (!parentId || !Number.isFinite(primitiveIndex)) return null
  return { parentId, primitiveIndex }
}

/**
 * Match command-bar vs live graph rows when merging topology (index alone can pair incorrectly).
 */
function entityReferencesEqualForMerge(
  a?: EntityReference,
  b?: EntityReference
): boolean {
  if (!a || !b) return false
  const na = normalizeEntityReference(a)
  const nb = normalizeEntityReference(b)
  if (!na || !nb) return false
  return JSON.stringify(na) === JSON.stringify(nb)
}

/**
 * Command-bar submitted args can lose nested fields; overlay live modeling selection topology
 * for fillet/chamfer review (shell inner edges rely on this).
 *
 * Pairs by index first, then by normalized entityRef so review still gets parentId + primitiveIndex
 * when ordering differs between submitted args and `selectionRanges`.
 */
export function mergeEngineTopologyFallbackFromLiveSelection(
  submitted: Selections | undefined,
  live: Selections | undefined
): Selections | undefined {
  if (!submitted) return submitted

  let graphSelections = submitted.graphSelections
  let otherSelections = submitted.otherSelections ?? []
  let changed = false

  if (submitted.graphSelections?.length && live?.graphSelections?.length) {
    const mergedGraph = submitted.graphSelections.map((g, i) => {
      if (getEngineTopologyFallbackNormalized(g)) {
        return g
      }

      const fromLiveSel = (liveG: Selection | undefined): Selection | null => {
        if (!liveG) return null
        const n = getEngineTopologyFallbackNormalized(liveG)
        if (!n) return null
        return {
          ...g,
          engineTopologyFallback: {
            parentId: n.parentId,
            primitiveIndex: n.primitiveIndex,
          },
        }
      }

      const byIndex = fromLiveSel(live.graphSelections[i])
      if (byIndex) return byIndex

      if (g.entityRef) {
        for (const candidate of live.graphSelections) {
          if (
            !entityReferencesEqualForMerge(g.entityRef, candidate.entityRef)
          ) {
            continue
          }
          const byRef = fromLiveSel(candidate)
          if (byRef) return byRef
        }
      }

      return g
    })
    const graphChanged =
      mergedGraph.some((g, idx) => g !== submitted.graphSelections?.[idx]) ||
      mergedGraph.length !== submitted.graphSelections.length
    if (graphChanged) {
      graphSelections = mergedGraph
      changed = true
    }
  }

  if (live?.otherSelections?.length) {
    const submittedPrimitiveIds = new Set(
      otherSelections
        .filter(isEnginePrimitiveSelection)
        .map((sel) => sel.entityId)
    )
    let appended = false
    for (const candidate of live.otherSelections) {
      if (!isEnginePrimitiveSelection(candidate)) continue
      if (submittedPrimitiveIds.has(candidate.entityId)) continue
      otherSelections = [...otherSelections, candidate]
      submittedPrimitiveIds.add(candidate.entityId)
      appended = true
    }
    if (appended) {
      changed = true
    }
  }

  if (!changed) {
    return submitted
  }

  return {
    ...submitted,
    graphSelections: graphSelections ?? submitted.graphSelections,
    otherSelections,
  }
}

export async function getEventForQueryEntityTypeWithPoint(
  engineEvent: QueryEntityTypeWithPointEvent | undefined,
  {
    engineCommandManager,
    kclManager,
    rustContext,
    wasmInstance,
    useSegmentsBasedRegions,
  }: {
    engineCommandManager: ConnectionManager
    kclManager: KclManager
    rustContext: RustContext
    wasmInstance: ModuleType
    useSegmentsBasedRegions: boolean
  }
): Promise<ModelingMachineEvent | null> {
  // Engine may return reference under data (e.g. { type, data: { reference } }) or at top level (e.g. { type, reference })
  const data = getQueryEntityTypeWithPointEventData(engineEvent)
  const { ast, artifactGraph } = kclManager
  const clickEntityId = data?.entity_id
  const reference = data?.reference
  if (!reference) {
    // No reference - clear selection (clicked in empty space)
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor', selection: {} },
    }
  }

  let entityRef = normalizeEntityReference(reference)
  if (!entityRef) {
    // Engine may return ref types not yet in EntityReference (e.g. helix); extract id for artifact lookup
    const ref = reference as Record<string, unknown>
    const refType = String(ref?.type).toLowerCase()
    let entityIdFromRef: string | undefined
    if (refType === 'path') {
      const pathId = ref.path_id ?? ref.pathId
      if (typeof pathId === 'string') entityIdFromRef = pathId
    } else if (refType === 'segment') {
      const segmentId = ref.segment_id ?? ref.segmentId
      if (typeof segmentId === 'string') entityIdFromRef = segmentId
    } else if (refType === 'helix') {
      const helixId = ref.helix_id ?? ref.helixId ?? ref.id
      if (typeof helixId === 'string') entityIdFromRef = helixId
    }
    if (entityIdFromRef) {
      const artifact = getArtifactOfTypes(
        {
          key: entityIdFromRef,
          types: ['path', 'solid2d', 'segment', 'helix'],
        },
        artifactGraph
      )
      if (!err(artifact)) {
        if (artifact.type === 'path')
          entityRef = { type: 'solid2d', solid2d_id: artifact.id }
        else if (artifact.type === 'helix')
          entityRef = { type: 'solid2d_edge', edge_id: artifact.id }
      }
    }
    if (!entityRef) {
      return {
        type: 'Set selection',
        data: { selectionType: 'singleCodeCursor', selection: {} },
      }
    }
  }

  if (
    entityRef.type === 'edge' &&
    entityRef.side_faces.length === 0 &&
    (!entityRef.end_faces || entityRef.end_faces.length === 0)
  ) {
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor', selection: {} },
    }
  }

  // Only convert face to solid2d when face_id directly references a solid2d (un-extruded profile).
  // Do not convert wall/cap (extruded) faces to solid2d so the engine can highlight the face and we send face_id to select_entity.
  if (entityRef.type === 'face' && entityRef.face_id) {
    const directSolid2d = artifactGraph.get(entityRef.face_id)
    if (directSolid2d && directSolid2d.type === 'solid2d') {
      entityRef = {
        type: 'solid2d',
        solid2d_id: entityRef.face_id,
      }
    }
  }

  if (clickEntityId && engineCommandManager) {
    const primitiveSel = await getPrimitiveSelectionForEntity(
      clickEntityId,
      engineCommandManager,
      artifactGraph
    )
    if (
      primitiveSel &&
      (primitiveSel.primitiveType === 'edge' ||
        String(primitiveSel.primitiveType).toLowerCase() === 'edge')
    ) {
      return {
        type: 'Set selection',
        data: {
          selectionType: 'enginePrimitiveSelection',
          selection: primitiveSel,
        },
      }
    }
  }

  // Get the entity ID from the EntityReference to find the artifact
  let entityId: string | undefined
  if (entityRef.type === 'plane') {
    entityId = entityRef.plane_id
  } else if (entityRef.type === 'face') {
    entityId = entityRef.face_id
  } else if (entityRef.type === 'solid2d') {
    entityId = entityRef.solid2d_id
  } else if (entityRef.type === 'solid3d') {
    entityId = entityRef.solid3d_id
  } else if (entityRef.type === 'solid2d_edge') {
    // For Solid2D edges, the edge_id is the curve UUID
    // We'll use it to find the segment later in getCodeRefsFromEntityReference
    entityId = entityRef.edge_id
  } else if (entityRef.type === 'segment') {
    entityId = entityRef.segment_id
  } else if (entityRef.type === 'region') {
    entityId = entityRef.region_id
  } else if (entityRef.type === 'edge' && entityRef.side_faces.length > 0) {
    // For edges, we need to find the edge artifact from the faces
    // Try to find an edge artifact that connects these faces
    // This is a temporary approach - ideally we'd query the engine for the edge ID
    // For now, we'll try to find it from the artifact graph
    const faceArtifacts = entityRef.side_faces
      .map((faceId: string) => artifactGraph.get(faceId))
      .filter(Boolean)
    if (faceArtifacts.length > 0) {
      // Try to find a sweepEdge that connects these faces
      // This is a simplified approach
      const firstFace = faceArtifacts[0]
      if (
        firstFace &&
        (firstFace.type === 'wall' || firstFace.type === 'cap')
      ) {
        // Look for edges in the commonSurfaceIds
        // This is not ideal but works for now
        entityId = firstFace.id
      }
    }
  } else if (entityRef.type === 'vertex' && entityRef.side_faces.length > 0) {
    // Similar approach for vertices
    entityId = entityRef.side_faces[0]
  }

  // Handle special cases (axes, default planes)
  if (entityId && [X_AXIS_UUID, Y_AXIS_UUID].includes(entityId)) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'axisSelection',
        selection: X_AXIS_UUID === entityId ? 'x-axis' : 'y-axis',
      },
    }
  }

  const foundDefaultPlane =
    entityId &&
    rustContext.defaultPlanes !== null &&
    Object.entries(rustContext.defaultPlanes).find(
      ([, plane]) => plane === entityId
    )
  if (foundDefaultPlane) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'defaultPlaneSelection',
        selection: {
          name: foundDefaultPlane[0] as DefaultPlaneStr,
          id: entityId!,
        },
      },
    }
  }

  const _artifactByEventId = clickEntityId
    ? (artifactGraph.get(clickEntityId) ??
      getPatternArtifactForCopyId(clickEntityId, artifactGraph))
    : undefined
  // Edge + topology_fallback: keep graph SelectionV2 (with engineTopologyFallback) for fillet/chamfer.
  // Otherwise region selection wins and we never attach engine topology data (e.g. shell inner edges).
  const engineTopologyFallbackEarly =
    engineTopologyFallbackFromReference(reference)
  let engineTopologyFallbackResolved = engineTopologyFallbackEarly
  let topologyResolutionOutcome: 'unchanged' | 'normalized' | null = null
  if (engineTopologyFallbackEarly && engineCommandManager) {
    const resolvedParentId = await resolveSweepParentEntityIdForEdge(
      engineTopologyFallbackEarly.parentId,
      engineCommandManager,
      artifactGraph
    )
    if (resolvedParentId) {
      if (resolvedParentId === engineTopologyFallbackEarly.parentId) {
        topologyResolutionOutcome = 'unchanged'
      } else {
        engineTopologyFallbackResolved = {
          parentId: resolvedParentId,
          primitiveIndex: engineTopologyFallbackEarly.primitiveIndex,
        }
        topologyResolutionOutcome = 'normalized'
      }
    }
  }
  const skipRegionSelectionForTopologyEdge =
    entityRef.type === 'edge' && engineTopologyFallbackResolved !== undefined

  if (entityRef.type === 'region') {
    const regionSelection = await getEngineRegionSelectionFromEntity(
      entityRef.region_id,
      artifactGraph,
      ast,
      engineCommandManager,
      wasmInstance,
      useSegmentsBasedRegions
    )
    if (regionSelection) {
      return {
        type: 'Set selection',
        data: {
          selectionType: 'engineRegionSelection',
          selection: regionSelection,
        },
      }
    }
  }

  if (
    !_artifactByEventId &&
    clickEntityId &&
    !skipRegionSelectionForTopologyEdge
  ) {
    const regionSelection = await getEngineRegionSelectionFromEntity(
      clickEntityId,
      artifactGraph,
      ast,
      engineCommandManager,
      wasmInstance
    )
    if (regionSelection) {
      return {
        type: 'Set selection',
        data: {
          selectionType: 'engineRegionSelection',
          selection: regionSelection,
        },
      }
    }
  }

  // For edges, vertices, solid2d_edge, and segment, use getCodeRefsFromEntityReference to handle references
  let codeRefs: any[] | undefined
  if (
    entityRef.type === 'edge' ||
    entityRef.type === 'vertex' ||
    entityRef.type === 'solid2d_edge' ||
    entityRef.type === 'segment'
  ) {
    const refs = getCodeRefsFromEntityReference(entityRef, artifactGraph)
    if (refs && refs.length > 0) {
      codeRefs = refs
    }
  } else if (entityId) {
    const _artifact =
      artifactGraph.get(entityId) ??
      getPatternArtifactForCopyId(entityId, artifactGraph)
    if (_artifact) {
      const refs = getCodeRefsByArtifactId(entityId, artifactGraph)
      codeRefs = refs || undefined
    }
  }

  // Prefer engine primitive index for solid edge picks when the API supports it.
  // The artifact graph often lacks wall/cap entries for shell/boolean edges, but
  // entity_get_primitive_index + parent id still drives fillet/chamfer edgeId codemods.
  const selection: Selection = {
    entityRef,
    codeRef: codeRefs?.[0],
    ...(engineTopologyFallbackResolved
      ? { engineTopologyFallback: engineTopologyFallbackResolved }
      : {}),
  }

  if (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('DEBUG_FILLET_SELECTION') === '1' &&
    engineTopologyFallbackEarly
  ) {
    try {
      console.info('[engine topology resolution]', {
        rawParentId: engineTopologyFallbackEarly?.parentId ?? null,
        resolvedParentId: engineTopologyFallbackResolved?.parentId ?? null,
        primitiveIndex: engineTopologyFallbackResolved?.primitiveIndex ?? null,
        outcome: topologyResolutionOutcome ?? 'missing-resolution',
      })
    } catch {
      // ignore logging errors (e.g. console not available)
    }
  }

  return {
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection,
    },
  }
}

export function getEventForSegmentSelection(
  obj: Object3D,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): ModelingMachineEvent | null {
  const group = getParentGroup(obj, SEGMENT_BODIES_PLUS_PROFILE_START)
  const axisGroup = getParentGroup(obj, [AXIS_GROUP])
  if (!group && !axisGroup) return null
  if (axisGroup?.userData.type === AXIS_GROUP) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'axisSelection',
        selection: obj?.userData?.type === X_AXIS ? 'x-axis' : 'y-axis',
      },
    }
  }
  // id does not match up with the artifact graph when in sketch mode, because mock executions
  // do not update the artifact graph, therefore we match up the pathToNode instead
  // we can reliably use `type === 'segment'` since it's in sketch mode and we're concerned with segments
  const segWithMatchingPathToNode__Id = [...artifactGraph].find((entry) => {
    return (
      entry[1].type === 'segment' &&
      JSON.stringify(entry[1].codeRef.pathToNode) ===
        JSON.stringify(group?.userData?.pathToNode)
    )
  })?.[0]

  const id = segWithMatchingPathToNode__Id

  if (!id && group) {
    const node = getNodeFromPath<Expr>(
      ast,
      group.userData.pathToNode,
      wasmInstance
    )
    if (err(node)) return null
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: {
          codeRef: {
            range: topLevelRange(node.node.start, node.node.end),
            pathToNode: group.userData.pathToNode,
          },
        },
      },
    }
  }
  if (!id || !group) return null
  const artifact = artifactGraph.get(id)
  if (!artifact) return null
  const node = getNodeFromPath<Expr>(
    ast,
    group.userData.pathToNode,
    wasmInstance
  )
  if (err(node)) return null
  const entityRef = artifactToEntityRef(
    artifact.type,
    artifact.id,
    artifact.type === 'segment'
      ? (artifact as { pathId: string }).pathId
      : undefined
  )
  return {
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection: {
        entityRef,
        codeRef: {
          pathToNode: group?.userData?.pathToNode,
          range: [node.node.start, node.node.end, 0],
        },
      },
    },
  }
}

export function handleSelectionBatch({
  selections,
  artifactGraph,
  code,
  ast,
  systemDeps,
}: {
  selections: Selections
  artifactGraph: ArtifactGraph
  code: string
  ast: Node<Program>
  systemDeps: {
    sceneEntitiesManager: SceneEntities
    engineCommandManager: ConnectionManager
    wasmInstance: ModuleType
  }
}): {
  engineEvents: WebSocketRequest[]
  codeMirrorSelection: EditorSelection
  updateSceneObjectColors: () => void
} {
  const ranges: ReturnType<typeof EditorSelection.cursor>[] = []
  const selectionToEngine: SelectionToEngine[] = []
  let engineEvents: WebSocketRequest[] = []

  const entityReferences: EntityReference[] = selections.graphSelections
    .map((v2Sel) => v2Sel.entityRef)
    .filter((ref): ref is EntityReference => ref !== undefined)

  if (entityReferences.length > 0) {
    engineEvents = setEngineEntitySelectionV2(entityReferences, systemDeps)
    const fallbackSelections = [
      ...selections.graphSelections
        .map((selection) => {
          if (selection.entityRef) return undefined
          const entityId = getEngineEntityIdForSelection(
            selection,
            artifactGraph
          )
          if (!entityId) return undefined
          return {
            id: entityId,
            range:
              getCodeRefsByArtifactId(entityId, artifactGraph)?.[0]?.range ||
              defaultSourceRange(),
          }
        })
        .filter(isNonNullable),
      ...selections.otherSelections
        .map((selection) => {
          if (isEnginePrimitiveSelection(selection)) {
            return {
              id: selection.entityId,
              range: defaultSourceRange(),
            }
          }
          if (isEngineRegionSelection(selection)) {
            return {
              id: selection.id,
              range: defaultSourceRange(),
            }
          }
          return undefined
        })
        .filter(isNonNullable),
    ]

    if (fallbackSelections.length > 0) {
      engineEvents.push(
        ...addEngineEntitySelectionCmds(fallbackSelections, systemDeps)
      )
    }
  } else {
    for (const s of selections.graphSelections) {
      const entityId = getEngineEntityIdForSelection(s, artifactGraph)
      if (!entityId) continue

      selectionToEngine.push({
        id: entityId,
        range:
          getCodeRefsByArtifactId(entityId, artifactGraph)?.[0]?.range ||
          defaultSourceRange(),
      })
    }

    for (const other of selections.otherSelections) {
      if (isEnginePrimitiveSelection(other)) {
        selectionToEngine.push({
          id: other.entityId,
          range: defaultSourceRange(),
        })
        continue
      }

      if (isEngineRegionSelection(other)) {
        selectionToEngine.push({
          id: other.id,
          range: defaultSourceRange(),
        })
      }
    }

    engineEvents = resetAndSetEngineEntitySelectionCmds(
      selectionToEngine,
      systemDeps
    )
  }

  selections.graphSelections.forEach(({ codeRef }) => {
    if (codeRef?.range?.[1]) {
      const safeEnd = Math.min(codeRef.range[1], code.length)
      ranges.push(EditorSelection.cursor(safeEnd))
    }
  })

  if (ranges.length)
    return {
      engineEvents,
      codeMirrorSelection: EditorSelection.create(
        ranges,
        ranges.length - 1
      ),
      updateSceneObjectColors: () =>
        updateSceneObjectColors(selections.graphSelections, ast, systemDeps),
    }

  return {
    codeMirrorSelection: EditorSelection.create(
      [EditorSelection.cursor(code.length)],
      0
    ),
    engineEvents,
    updateSceneObjectColors: () =>
      updateSceneObjectColors(selections.graphSelections, ast, systemDeps),
  }
}

type SelectionToEngine = {
  id?: string
  range: SourceRange
}

export function processCodeMirrorRanges({
  codeMirrorRanges,
  selectionRanges,
  isShiftDown,
  ast,
  artifactGraph,
  artifactIndex,
  systemDeps,
}: {
  codeMirrorRanges: readonly SelectionRange[]
  selectionRanges: Selections
  isShiftDown: boolean
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  artifactIndex: ArtifactIndex
  systemDeps: {
    sceneEntitiesManager: SceneEntities
    engineCommandManager: ConnectionManager
    wasmInstance: ModuleType
  }
}): null | {
  modelingEvent: ModelingMachineEvent
  engineEvents: WebSocketRequest[]
} {
  const isChange =
    codeMirrorRanges.length !== selectionRanges?.graphSelections?.length ||
    codeMirrorRanges.some(({ from, to }, i) => {
      return (
        from !== selectionRanges.graphSelections[i]?.codeRef?.range[0] ||
        to !== selectionRanges.graphSelections[i]?.codeRef?.range[1]
      )
    })

  if (!isChange) return null
  const codeBasedSelections: Array<{ codeRef: CodeRef; artifact?: Artifact }> =
    codeMirrorRanges.map(({ from, to }) => {
      const pathToNode = getNodePathFromSourceRange(
        ast,
        topLevelRange(from, to)
      )
      return {
        codeRef: {
          range: topLevelRange(from, to),
          pathToNode,
        },
      }
    })
  const idBasedSelections: SelectionToEngine[] = codeToIdSelections(
    codeBasedSelections,
    artifactGraph,
    artifactIndex
  )
  const graphSelections: Selection[] = []
  for (const { id, range } of idBasedSelections) {
    const pathToNode = getNodePathFromSourceRange(ast, range)
    const codeRef = { range, pathToNode }
    if (!id) {
      const invalidPathToNode =
        pathToNode.length === 1 &&
        pathToNode[0][0] === 'body' &&
        pathToNode[0][1] === ''
      if (invalidPathToNode) {
        console.warn('Could not find valid pathToNode, found:', pathToNode)
        continue
      }
      graphSelections.push({ codeRef })
      continue
    }
    const artifact = artifactGraph.get(id)
    const codeRefs = getCodeRefsByArtifactId(id, artifactGraph)
    const resolvedCodeRef = codeRefs?.[0] ?? codeRef
    if (artifact) {
      graphSelections.push({
        entityRef: artifactToEntityRef(
          artifact.type,
          id,
          artifact.type === 'segment'
            ? (artifact as { pathId: string }).pathId
            : undefined
        ),
        codeRef: resolvedCodeRef,
      })
    } else {
      graphSelections.push({ codeRef: resolvedCodeRef })
    }
  }

  if (!selectionRanges) return null
  updateSceneObjectColors(codeBasedSelections, ast, systemDeps)
  return {
    modelingEvent: {
      type: 'Set selection',
      data: {
        selectionType: 'mirrorCodeMirrorSelections',
        selection: {
          otherSelections: isShiftDown ? selectionRanges.otherSelections : [],
          graphSelections,
        },
      },
    },
    engineEvents: resetAndSetEngineEntitySelectionCmds(
      idBasedSelections.filter(({ id }) => !!id),
      systemDeps
    ),
  }
}

function updateSceneObjectColors(
  codeBasedSelections: Array<{ codeRef?: { range?: SourceRange } }>,
  ast: Node<Program>,
  {
    sceneEntitiesManager,
    wasmInstance,
  }: {
    sceneEntitiesManager: SceneEntities
    wasmInstance: ModuleType
  }
) {
  const updated = ast

  Object.values(sceneEntitiesManager.activeSegments).forEach((segmentGroup) => {
    if (!SEGMENT_BODIES_PLUS_PROFILE_START.includes(segmentGroup?.name)) return
    const nodeMeta = getNodeFromPath<Node<CallExpressionKw>>(
      updated,
      segmentGroup.userData.pathToNode,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(nodeMeta)) return
    const node = nodeMeta.node
    const groupHasCursor = codeBasedSelections.some((selection) => {
      const range = selection?.codeRef?.range
      return (
        range != null && isOverlap(range, topLevelRange(node.start, node.end))
      )
    })

    const color = groupHasCursor
      ? SEGMENT_BLUE
      : segmentGroup?.userData?.baseColor || 0xffffff
    segmentGroup.traverse((child) => {
      if (child instanceof Mesh) child.material.color.set(color)
    })
    // This is only needed if we want the extra segment to be blue when selected, even if it's still hovered
    updateExtraSegments(segmentGroup, 'selected', groupHasCursor)
    updateExtraSegments(segmentGroup, 'hoveringLine', false)

    // TODO if we had access to the xstate context and therefore selections
    // we wouldn't need to set this here,
    // it would be better to treat xstate context as the source of truth instead of having
    // extra redundant state floating around
    segmentGroup.userData.isSelected = groupHasCursor
  })
}

export function updateExtraSegments(
  parent: Object3D | null,
  className: string,
  value: boolean
) {
  const extraSegmentGroup = parent?.getObjectByName(EXTRA_SEGMENT_HANDLE)
  if (extraSegmentGroup) {
    extraSegmentGroup.traverse((child) => {
      if (child instanceof CSS2DObject) {
        child.element.classList.toggle(className, value)
      }
    })
  }
}

function addEngineEntitySelectionCmds(
  selections: SelectionToEngine[],
  systemDeps: {
    engineCommandManager: ConnectionManager
  }
): WebSocketRequest[] {
  if (
    systemDeps.engineCommandManager.connection?.pingIntervalId === undefined
  ) {
    return []
  }
  return [
    {
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_add',
        entities: selections.map(({ id }) => id).filter(isNonNullable),
      },
      cmd_id: uuidv4(),
    },
  ]
}

function resetAndSetEngineEntitySelectionCmds(
  selections: SelectionToEngine[],
  systemDeps: {
    engineCommandManager: ConnectionManager
  }
): WebSocketRequest[] {
  if (
    systemDeps.engineCommandManager.connection?.pingIntervalId === undefined
  ) {
    return []
  }
  return [
    {
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_clear',
      },
      cmd_id: uuidv4(),
    },
    {
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_add',
        entities: selections.map(({ id }) => id).filter(isNonNullable),
      },
      cmd_id: uuidv4(),
    },
  ]
}

function setEngineEntitySelectionV2(
  entityReferences: EntityReference[],
  systemDeps: {
    engineCommandManager: ConnectionManager
  }
): WebSocketRequest[] {
  if (
    systemDeps.engineCommandManager.connection?.pingIntervalId === undefined
  ) {
    return []
  }
  return [
    {
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_entity',
        entities: entityReferences,
      },
      cmd_id: uuidv4(),
    },
  ]
}

function getEngineEntityIdForSelection(
  selection: Selection,
  artifactGraph: ArtifactGraph
): string | undefined {
  if (selection.engineEntityId) {
    return selection.engineEntityId
  }

  const entityRef = selection.entityRef
  if (entityRef) {
    switch (entityRef.type) {
      case 'solid3d':
        return entityRef.solid3d_id
      case 'solid2d':
        return entityRef.solid2d_id
      case 'face':
        return entityRef.face_id
      case 'plane':
        return entityRef.plane_id
      case 'solid2d_edge':
        return entityRef.edge_id
      case 'segment':
        return entityRef.segment_id
    }
  }

  return resolveToCodeRef(selection, artifactGraph)?.artifact?.id
}

function getQueryEntityTypeWithPointData(
  res: unknown
): QueryEntityTypeWithPoint | undefined {
  if (!isModelingResponse(res)) return undefined
  const mr = res.resp.data.modeling_response
  return mr.type === 'query_entity_type_with_point' ? mr.data : undefined
}

type QueryEntityTypeWithPointEvent =
  | (QueryEntityTypeWithPoint & { entity_id?: string })
  | { data: QueryEntityTypeWithPoint & { entity_id?: string } }

function getQueryEntityTypeWithPointEventData(
  engineEvent: QueryEntityTypeWithPointEvent | undefined
): (QueryEntityTypeWithPoint & { entity_id?: string }) | undefined {
  if (!engineEvent) return undefined
  if ('data' in engineEvent) return engineEvent.data
  return engineEvent
}

/**
 * Is the selection a single cursor in a sketch pipe expression chain?
 */
export function isSketchPipe(
  selectionRanges: Selections,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph
) {
  if (!isSingleCursorInPipe(selectionRanges, ast)) return false
  return isCursorInSketchCommandRange(artifactGraph, selectionRanges)
}

// This accounts for non-geometry selections under "other"
export type ResolvedSelectionType = CommandSelectionType | 'other'
export type SelectionCountsByType = Map<ResolvedSelectionType, number>

/**
 * In the future, I'd like this function to properly return the type of each selected entity based on
 * its code source range, so that we can show something like "0 objects" or "1 face" or "1 line, 2 edges",
 * and then validate the selection in CommandBarSelectionInput.tsx and show the proper label.
 * @param selection
 * @returns
 */
export function getSelectionCountByType(
  ast: Node<Program>,
  selection?: Selections,
  artifactGraph?: ArtifactGraph
): SelectionCountsByType | 'none' {
  const selectionsByType: SelectionCountsByType = new Map()
  const graphSelections = selection?.graphSelections ?? []
  const otherSelections = selection?.otherSelections ?? []

  if (!selection || (!graphSelections.length && !otherSelections.length))
    return 'none'

  function incrementOrInitializeSelectionType(type: ResolvedSelectionType) {
    const count = selectionsByType.get(type) || 0
    selectionsByType.set(type, count + 1)
  }

  function getArtifactById(id: string): Artifact | undefined {
    if (!artifactGraph) return undefined
    return (
      artifactGraph.get(id) ??
      artifactGraph.get(String(id)) ??
      [...artifactGraph.values()].find(
        (artifact) => artifact.id === id || String(artifact.id) === String(id)
      )
    )
  }

  function incrementArtifactSelectionType(artifact: Artifact): boolean {
    if (artifact.type === 'helix') {
      incrementOrInitializeSelectionType('helix')
      return true
    }
    if (artifact.type === 'path' && artifact.subType === 'region') {
      incrementOrInitializeSelectionType('pathRegion')
      return true
    }
    if (artifact.type === 'path') {
      incrementOrInitializeSelectionType('path')
      return true
    }
    if (artifact.type === 'sweep') {
      incrementOrInitializeSelectionType('sweep')
      return true
    }
    if (artifact.type === 'solid2d') {
      incrementOrInitializeSelectionType('solid2d')
      return true
    }
    return false
  }

  otherSelections.forEach((sel) => {
    if (typeof sel === 'string') {
      incrementOrInitializeSelectionType('other')
    } else if (isEngineRegionSelection(sel)) {
      incrementOrInitializeSelectionType('engineRegion')
    } else if ('name' in sel) {
      incrementOrInitializeSelectionType('plane')
    } else if (sel.type === 'enginePrimitive' && sel.primitiveType === 'face') {
      incrementOrInitializeSelectionType('enginePrimitiveFace')
    } else if (sel.type === 'enginePrimitive' && sel.primitiveType === 'edge') {
      incrementOrInitializeSelectionType('enginePrimitiveEdge')
    } else {
      incrementOrInitializeSelectionType('other')
    }
  })

  graphSelections.forEach((v2Selection) => {
    const inlineArtifact = (
      v2Selection as Selection & {
        artifact?: Artifact
      }
    ).artifact

    if (v2Selection.entityRef) {
      // solid2d_edge first: may be helix or segment curve.
      if (v2Selection.entityRef.type === 'solid2d_edge') {
        const artifact = getArtifactById(v2Selection.entityRef.edge_id)
        if (artifact?.type === 'helix') {
          incrementOrInitializeSelectionType('helix')
        } else {
          incrementOrInitializeSelectionType('segment')
        }
      } else if (
        v2Selection.entityRef.type === 'edge' ||
        v2Selection.entityRef.type === 'segment'
      ) {
        // All other edge-like refs: show as "edges"
        incrementOrInitializeSelectionType('segment')
      } else if (v2Selection.entityRef.type === 'vertex') {
        incrementOrInitializeSelectionType('other')
      } else if (v2Selection.entityRef.type === 'face') {
        incrementOrInitializeSelectionType('wall')
      } else if (v2Selection.entityRef.type === 'plane') {
        incrementOrInitializeSelectionType('plane')
      } else if (v2Selection.entityRef.type === 'solid2d') {
        const artifact = getArtifactById(v2Selection.entityRef.solid2d_id)
        if (!artifact || !incrementArtifactSelectionType(artifact)) {
          incrementOrInitializeSelectionType('solid2d')
        }
      } else if (v2Selection.entityRef.type === 'solid3d') {
        const artifact = getArtifactById(v2Selection.entityRef.solid3d_id)
        if (!artifact || !incrementArtifactSelectionType(artifact)) {
          incrementOrInitializeSelectionType('path')
        }
      }
    } else if (inlineArtifact?.type === 'helix') {
      incrementOrInitializeSelectionType('helix')
    } else if (
      inlineArtifact?.type === 'path' &&
      inlineArtifact.subType === 'region'
    ) {
      incrementOrInitializeSelectionType('pathRegion')
    } else if (inlineArtifact?.type === 'path') {
      incrementOrInitializeSelectionType('path')
    } else if (
      v2Selection.codeRef &&
      ast &&
      'body' in ast &&
      isSingleCursorInPipe(selection, ast)
    ) {
      incrementOrInitializeSelectionType('segment')
    } else if (v2Selection.codeRef && artifactGraph) {
      // Selection may have codeRef only (e.g. feature tree click when getArtifactFromRange failed).
      const artifact = getArtifactFromRange(
        v2Selection.codeRef.range,
        artifactGraph
      )
      if (!artifact || !incrementArtifactSelectionType(artifact)) {
        incrementOrInitializeSelectionType('other')
      }
    } else {
      incrementOrInitializeSelectionType('other')
    }
  })

  return selectionsByType
}

export function getSelectionTypeDisplayText(
  ast: Node<Program>,
  selection?: Selections,
  artifactGraph?: ArtifactGraph
): string | null {
  const selectionsByType = getSelectionCountByType(
    ast,
    selection,
    artifactGraph
  )
  if (selectionsByType === 'none') return null

  const semanticSelectionsByType = [...selectionsByType.entries()].reduce(
    (semanticSelectionsByType, [type, count]) => {
      const semanticType =
        type === 'other' ? undefined : getSemanticEntityForSelectionType(type)
      const displayType = semanticType ?? type
      semanticSelectionsByType.set(
        displayType,
        (semanticSelectionsByType.get(displayType) || 0) + count
      )
      return semanticSelectionsByType
    },
    new Map<string, number>()
  )

  return [...semanticSelectionsByType.entries()]
    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
    .join(', ')
}

export function canSubmitSelectionArg(
  selectionsByType: 'none' | Map<ResolvedSelectionType, number>,
  argument: CommandArgument<unknown> & {
    inputType: 'selection' | 'selectionMixed'
  }
) {
  return (
    selectionsByType !== 'none' &&
    [...selectionsByType.entries()].every(([type, count]) => {
      const isAllowedType = argument.selectionTypes.includes(
        type as Artifact['type']
      )
      return (
        isAllowedType &&
        (!argument.multiple ? count < 2 && count > 0 : count > 0)
      )
    })
  )
}

/**
 * Find the index of the last range where range.start < targetStart. When there
 * are ranges with equal start positions just before the targetStart, the first
 * one is returned. The returned index can be used as a starting point for
 * linear search of overlapping ranges.
 *
 * @param index The sorted array of ranges to search through
 * @param targetStart The start position to compare against
 * @returns The index of the last range where range[0] < targetStart
 */
export function findLastRangeStartingBefore(
  index: ArtifactIndex,
  targetStart: number
): number {
  if (index.length === 0) {
    return 0
  }

  let left = 0
  let right = index.length - 1
  let lastValidIndex = 0

  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2)
    const midRange = index[mid].range

    if (midRange[0] < targetStart) {
      // This range starts before our selection, look in right half for later ones
      lastValidIndex = mid
      left = mid + 1
    } else {
      // This range starts at or after our selection, look in left half
      right = mid - 1
    }
  }

  // We may have passed the correct index. Consider what happens when there are
  // duplicates. We found the last one, but earlier ones need to be checked too.
  let resultIndex = lastValidIndex
  let resultRange = index[resultIndex].range
  for (let i = lastValidIndex - 1; i >= 0; i--) {
    const range = index[i].range
    if (range[0] === resultRange[0]) {
      resultIndex = i
      resultRange = range
    } else {
      break
    }
  }

  return resultIndex
}

/**
 * Runs in O(n) time.
 * TODO: update ArtifactIndex to be an [interval tree](https://en.wikipedia.org/wiki/Interval_tree#cite_note-Schmidt2009-2),
 * then make this run sub-linear by using that to query for overlaps.
 */
function findOverlappingArtifactsFromIndex(
  selection: Selection,
  index: ArtifactIndex
): ArtifactEntry[] {
  const range = selection.codeRef?.range
  if (!range) {
    console.warn('Selection missing code reference range')
    return []
  }

  const selectionRange = range
  const results: ArtifactEntry[] = []

  for (let i = 0; i < index.length; i++) {
    const { range, entry } = index[i]
    if (isOverlap(range, selectionRange)) {
      results.push(entry)
    }
  }

  return results
}

function getBestCandidates(
  entries: ArtifactEntry[],
  artifactGraph: ArtifactGraph
): ArtifactEntry[] {
  if (!entries.length) {
    return []
  }

  const overlappingRegions = entries.filter(
    (entry) =>
      entry.artifact.type === 'path' && entry.artifact.subType === 'region'
  )
  if (overlappingRegions.length) {
    return overlappingRegions
  }

  const overlappingSegments = entries.filter(
    (entry) => entry.artifact.type === 'segment'
  )
  if (overlappingSegments.length) {
    return overlappingSegments
  }

  const sketchBlock = entries.find(
    (entry) => entry.artifact.type === 'sketchBlock'
  )
  if (sketchBlock) {
    return [sketchBlock]
  }

  for (const entry of entries) {
    // Handle paths and their solid2d references
    if (entry.artifact.type === 'path') {
      const solid2dId = entry.artifact.solid2dId
      if (!solid2dId) {
        return [entry]
      }
      const solid2d = artifactGraph.get(solid2dId)
      if (solid2d?.type === 'solid2d') {
        return [{ id: solid2dId, artifact: solid2d }]
      }
      continue
    }

    // Other valid artifact types
    if (
      ['plane', 'cap', 'wall', 'sweep', 'pattern'].includes(entry.artifact.type)
    ) {
      return [entry]
    }
  }
  return []
}

function createSelectionToEngine(
  selection: Selection,
  candidateId?: ArtifactId
): SelectionToEngine {
  const codeRef = selection.codeRef
  if (!codeRef?.range) {
    return { range: defaultSourceRange() }
  }
  return {
    ...(candidateId && { id: candidateId }),
    range: codeRef.range,
  }
}

function getEngineEntityIdsForSelection(selection: Selection): ArtifactId[] {
  if (selection.engineEntityId) {
    return [selection.engineEntityId]
  }

  const artifact = selection.artifact
  if (!artifact?.id) {
    return []
  }

  if (artifact.type !== 'pattern') {
    return [artifact.id]
  }

  return [
    ...new Set([
      ...artifact.copyIds,
      ...artifact.copyFaceIds,
      ...artifact.copyEdgeIds,
    ]),
  ]
}

export function codeToIdSelections(
  selections: Selection[],
  artifactGraph: ArtifactGraph,
  artifactIndex: ArtifactIndex
): SelectionToEngine[] {
  if (!selections?.length) {
    return []
  }

  if (!artifactGraph) {
    console.warn('Artifact graph is missing or empty')
    return selections.map((selection) => createSelectionToEngine(selection))
  }

  return selections
    .flatMap((selection): SelectionToEngine[] => {
      if (!selection) {
        console.warn('Null or undefined selection encountered')
        return []
      }

      const resolved = resolveToCodeRef(selection, artifactGraph)
      if (resolved?.artifact?.id) {
        const selectionWithArtifact = {
          ...selection,
          artifact: resolved.artifact,
        }
        const engineIds = getEngineEntityIdsForSelection(selectionWithArtifact)
        return engineIds.length
          ? engineIds.map((id) => createSelectionToEngine(selection, id))
          : [createSelectionToEngine(selection, resolved.artifact.id)]
      }

      // Find matching artifacts by code range overlap
      const overlappingEntries = findOverlappingArtifactsFromIndex(
        selection,
        artifactIndex
      )
      const bestCandidates = getBestCandidates(
        overlappingEntries,
        artifactGraph
      )
      if (bestCandidates.length) {
        return bestCandidates.flatMap((entry) => {
          const engineIds = getEngineEntityIdsForSelection({
            ...selection,
            artifact: entry.artifact,
          })
          return engineIds.length
            ? engineIds.map((id) => createSelectionToEngine(selection, id))
            : [createSelectionToEngine(selection, entry.id)]
        })
      }

      return [createSelectionToEngine(selection)]
    })
    .filter(isNonNullable)
}

export async function sendQueryEntityTypeWithPoint(
  e: React.MouseEvent<HTMLDivElement, MouseEvent>,
  videoRef: HTMLVideoElement,
  systemDeps: {
    engineCommandManager: ConnectionManager
  }
) {
  const { x, y } = getNormalisedCoordinates(
    e,
    videoRef,
    systemDeps.engineCommandManager.streamDimensions
  )
  let res = await systemDeps.engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'query_entity_type_with_point',
      selected_at_window: { x, y },
      selection_type: 'add',
    },
    cmd_id: uuidv4(),
  })
  if (!res) {
    console.warn('No response')
    return undefined
  }

  if (isArray(res)) {
    res = res[0]
  }
  return getQueryEntityTypeWithPointData(res)
}

/** Query entity at point using scene element for coordinates (e.g. renderer.domElement). Used when handling double-click from scene onClick. */
export async function sendQueryEntityTypeWithPointFromSceneClick(
  mouseEvent: MouseEvent,
  elementForRect: { getBoundingClientRect(): DOMRect },
  engineCommandManager: ConnectionManager
) {
  const { x, y } = getNormalisedCoordinates(
    mouseEvent as PointerEvent,
    elementForRect as HTMLVideoElement,
    engineCommandManager.streamDimensions
  )
  let res = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'query_entity_type_with_point',
      selected_at_window: { x, y },
      selection_type: 'add',
    },
    cmd_id: uuidv4(),
  })
  if (!res) return undefined
  if (isArray(res)) res = res[0]
  return getQueryEntityTypeWithPointData(res)
}

/** Handle double-click in scene (onClick path): query entity, set selection, send Enter sketch. Call when args.mouseEvent.detail === 2 in idle. */
export async function tryEnterSketchOnDoubleClickFromScene(
  args: OnClickCallbackArgs,
  elementForRect: { getBoundingClientRect(): DOMRect },
  deps: {
    engineCommandManager: ConnectionManager
    kclManager: { artifactGraph: ArtifactGraph }
    sceneInfra: SceneInfra
  }
): Promise<void> {
  if (args?.mouseEvent?.detail !== 2 || args.mouseEvent.which !== 1) return
  if (deps.sceneInfra.camControls.wasDragging === true) return

  const result = await sendQueryEntityTypeWithPointFromSceneClick(
    args.mouseEvent,
    elementForRect,
    deps.engineCommandManager
  )
  if (!result) return

  let entityId: string | undefined = (result as { entity_id?: string })
    .entity_id
  if (!entityId && (result as { reference?: unknown }).reference) {
    const entityRef = normalizeEntityReference(
      (result as { reference: unknown }).reference
    )
    if (entityRef) {
      if (entityRef.type === 'plane') entityId = entityRef.plane_id
      else if (entityRef.type === 'face') entityId = entityRef.face_id
      else if (entityRef.type === 'solid2d') entityId = entityRef.solid2d_id
      else if (entityRef.type === 'solid3d') entityId = entityRef.solid3d_id
      else if (entityRef.type === 'solid2d_edge') entityId = entityRef.edge_id
      else if (entityRef.type === 'segment') entityId = entityRef.segment_id
      else if (entityRef.type === 'region') entityId = entityRef.region_id
      else if (entityRef.type === 'edge' && entityRef.side_faces.length > 0)
        entityId = entityRef.side_faces[0]
      else if (entityRef.type === 'vertex' && entityRef.side_faces.length > 0)
        entityId = entityRef.side_faces[0]
    }
  }
  if (!entityId) return

  const artifactResult = getArtifactOfTypes(
    { key: entityId, types: ['path', 'solid2d', 'segment', 'helix'] },
    deps.kclManager.artifactGraph
  )
  if (err(artifactResult)) return

  const artifact = artifactResult
  let entityRef: EntityReference | undefined = artifactToEntityRef(
    artifact.type,
    entityId,
    artifact.type === 'segment'
      ? (artifact as { pathId: string }).pathId
      : undefined
  )
  if (!entityRef) {
    if (artifact.type === 'path')
      entityRef = { type: 'solid2d', solid2d_id: artifact.id }
    else if (artifact.type === 'helix')
      entityRef = { type: 'solid2d_edge', edge_id: artifact.id }
  }
  if (!entityRef) return

  const codeRef = getCodeRefsByArtifactId(
    entityId,
    deps.kclManager.artifactGraph
  )?.[0]
  deps.sceneInfra.modelingSend({
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection: { entityRef, codeRef },
    },
  })
  deps.sceneInfra.modelingSend({ type: 'Enter sketch' })
}

export function updateSelections(
  pathToNodeMap: PathToNodeMap,
  prevSelectionRanges: Selections,
  ast: Program | Error,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): Selections | Error {
  if (err(ast)) return ast

  const newSelections = Object.entries(pathToNodeMap)
    .map(([index, pathToNode]): Selection | undefined => {
      const previousV2 = prevSelectionRanges.graphSelections[Number(index)]
      const previousResolved =
        previousV2 != null ? resolveToCodeRef(previousV2, artifactGraph) : null
      const nodeMeta = getNodeFromPath<Expr>(ast, pathToNode, wasmInstance)
      if (err(nodeMeta)) return undefined
      const node = nodeMeta.node
      let artifact: Artifact | null = null
      let artifactId: string | undefined
      for (const [id, a] of artifactGraph) {
        if (previousResolved?.artifact?.type === a.type) {
          const codeRefs = getCodeRefsByArtifactId(id, artifactGraph)
          if (!codeRefs) continue
          if (
            JSON.stringify(codeRefs[0].pathToNode) ===
            JSON.stringify(pathToNode)
          ) {
            artifact = a
            artifactId = id
            break
          }
        }
      }
      if (!artifact || artifactId == null) return undefined
      const codeRef = {
        range: topLevelRange(node.start, node.end),
        pathToNode: pathToNode,
      }
      const pathId =
        artifact.type === 'segment'
          ? (artifact as { pathId: string }).pathId
          : undefined
      const entityRef = artifactToEntityRef(artifact.type, artifactId, pathId)
      return { entityRef, codeRef }
    })
    .filter((x?: Selection) => x !== undefined)

  const pathToNodeBasedSelections: Selection[] = []
  for (const pathToNode of Object.values(pathToNodeMap)) {
    const node = getNodeFromPath<Expr>(ast, pathToNode, wasmInstance)
    if (err(node)) return node
    pathToNodeBasedSelections.push({
      codeRef: {
        range: topLevelRange(node.node.start, node.node.end),
        pathToNode: pathToNode,
      },
    })
  }

  return {
    graphSelections:
      newSelections.length >= pathToNodeBasedSelections.length
        ? newSelections
        : pathToNodeBasedSelections,
    otherSelections: prevSelectionRanges.otherSelections,
  }
}

const semanticEntityNames: {
  [key: string]: Array<CommandSelectionType | 'defaultPlane'>
} = {
  face: ['wall', 'cap', 'primitiveFace', 'enginePrimitiveFace'],
  profile: ['solid2d'],
  region: ['pathRegion', 'engineRegion'],
  edge: [
    'segment',
    'sweepEdge',
    'edgeCutEdge',
    'primitiveEdge',
    'enginePrimitiveEdge',
  ],
  point: [],
  plane: ['defaultPlane'],
}

function getSemanticEntityForSelectionType(
  selectionType: CommandSelectionType | 'defaultPlane'
): string | undefined {
  for (const [entity, entityTypes] of Object.entries(semanticEntityNames)) {
    if (entityTypes.includes(selectionType)) {
      return entity
    }
  }
}

/** Convert selections to a human-readable format */
export function getSemanticSelectionType(
  selectionType: CommandSelectionType[]
) {
  const semanticSelectionType = new Set<string>()
  for (const type of selectionType) {
    const semanticType = getSemanticEntityForSelectionType(type)
    if (semanticType) {
      semanticSelectionType.add(semanticType)
    }
  }

  return Array.from(semanticSelectionType)
}

export function getDefaultSketchPlaneData(
  defaultPlaneId: string,
  systemDeps: {
    rustContext: RustContext
    sceneInfra: SceneInfra
  }
): Error | false | DefaultPlane {
  const { sceneInfra, rustContext } = systemDeps
  const defaultPlanes = rustContext.defaultPlanes
  if (!defaultPlanes) {
    return new Error('No default planes defined in rustContext')
  }

  if (
    ![
      defaultPlanes.xy,
      defaultPlanes.xz,
      defaultPlanes.yz,
      defaultPlanes.negXy,
      defaultPlanes.negXz,
      defaultPlanes.negYz,
    ].includes(defaultPlaneId)
  ) {
    // Supplied defaultPlaneId is not a valid default plane id
    return false
  }

  const camVector = sceneInfra.camControls.camera.position
    .clone()
    .sub(sceneInfra.camControls.target)

  // TODO can we get this information from rust land when it creates the default planes?
  // maybe returned from make_default_planes (src/wasm-lib/src/wasm.rs)
  let zAxis: [number, number, number] = [0, 0, 1]
  let yAxis: [number, number, number] = [0, 1, 0]

  if (defaultPlanes?.xy === defaultPlaneId) {
    zAxis = [0, 0, 1]
    yAxis = [0, 1, 0]
    if (camVector.z < 0) {
      zAxis = [0, 0, -1]
      defaultPlaneId = defaultPlanes?.negXy || ''
    }
  } else if (defaultPlanes?.yz === defaultPlaneId) {
    zAxis = [1, 0, 0]
    yAxis = [0, 0, 1]
    if (camVector.x < 0) {
      zAxis = [-1, 0, 0]
      defaultPlaneId = defaultPlanes?.negYz || ''
    }
  } else if (defaultPlanes?.xz === defaultPlaneId) {
    zAxis = [0, 1, 0]
    yAxis = [0, 0, 1]
    defaultPlaneId = defaultPlanes?.negXz || ''
    if (camVector.y < 0) {
      zAxis = [0, -1, 0]
      defaultPlaneId = defaultPlanes?.xz || ''
    }
  }

  const defaultPlaneStrMap: Record<string, DefaultPlaneStr> = {
    [defaultPlanes.xy]: 'XY',
    [defaultPlanes.xz]: 'XZ',
    [defaultPlanes.yz]: 'YZ',
    [defaultPlanes.negXy]: '-XY',
    [defaultPlanes.negXz]: '-XZ',
    [defaultPlanes.negYz]: '-YZ',
  }

  return {
    type: 'defaultPlane',
    planeId: defaultPlaneId,
    plane: defaultPlaneStrMap[defaultPlaneId],
    zAxis,
    yAxis,
  }
}

export function isDefaultPlaneSelection(
  selection: Selections['otherSelections'][number]
): selection is DefaultPlaneSelection {
  return (
    typeof selection === 'object' && selection !== null && 'name' in selection
  )
}

export function getSelectedDefaultPlane(selectionRanges: Selections) {
  return selectionRanges.otherSelections.find(isDefaultPlaneSelection)
}

const defaultPlaneDataByName: Record<
  PlaneName,
  Omit<DefaultPlane, 'type' | 'planeId'>
> = {
  xy: { plane: 'XY', zAxis: [0, 0, 1], yAxis: [0, 1, 0] },
  negXy: { plane: '-XY', zAxis: [0, 0, -1], yAxis: [0, 1, 0] },
  xz: { plane: 'XZ', zAxis: [0, -1, 0], yAxis: [0, 0, 1] },
  negXz: { plane: '-XZ', zAxis: [0, 1, 0], yAxis: [0, 0, 1] },
  yz: { plane: 'YZ', zAxis: [1, 0, 0], yAxis: [0, 0, 1] },
  negYz: { plane: '-YZ', zAxis: [-1, 0, 0], yAxis: [0, 0, 1] },
}

export async function getPlaneDataFromSketchBlock(
  sketchBlock: Extract<Artifact, { type: 'sketchBlock' }>,
  artifactGraph: ArtifactGraph,
  systemDeps: {
    rustContext: RustContext
    sceneInfra: SceneInfra
    sceneEntitiesManager: SceneEntities
    ast: Node<Program>
    execState: ExecState
    wasmInstance: ModuleType
  }
): Promise<DefaultPlane | OffsetPlane | ExtrudeFacePlane | null> {
  // Similar logic to selectSketchPlane but for a sketchBlock artifact.
  if (sketchBlock.standardPlane && systemDeps.rustContext.defaultPlanes) {
    return {
      type: 'defaultPlane',
      planeId: systemDeps.rustContext.defaultPlanes[sketchBlock.standardPlane],
      ...defaultPlaneDataByName[sketchBlock.standardPlane],
    }
  }

  if (!sketchBlock.planeId) {
    return null
  }

  const artifact = artifactGraph.get(sketchBlock.planeId)
  const offsetResult = getStableOffsetPlaneData(artifact, {
    execState: systemDeps.execState,
    sceneInfra: systemDeps.sceneInfra,
    sketchBlock,
  })
  if (!isErr(offsetResult) && offsetResult) {
    return offsetResult
  }

  const sweepFaceSelected = await selectionBodyFace(
    sketchBlock.planeId,
    artifactGraph,
    systemDeps.ast,
    systemDeps.execState,
    {
      wasmInstance: systemDeps.wasmInstance,
      rustContext: systemDeps.rustContext,
      sceneInfra: systemDeps.sceneInfra,
      sceneEntitiesManager: systemDeps.sceneEntitiesManager,
    }
  )
  if (sweepFaceSelected) {
    return sweepFaceSelected
  }

  return null
}

export function selectDefaultSketchPlane(
  defaultPlaneId: string,
  systemDeps: {
    sceneInfra: SceneInfra
    rustContext: RustContext
  }
): Error | boolean {
  const { sceneInfra } = systemDeps
  const result = getDefaultSketchPlaneData(defaultPlaneId, systemDeps)
  if (err(result) || result === false) return result
  sceneInfra.modelingSend({
    type: 'Select sketch plane',
    data: result,
  })
  return true
}

// Uses the executed sketch `on` plane so editing an offset-plane sketch is
// independent of camera-facing scene data.
export function getStableOffsetPlaneData(
  artifact: Artifact | undefined,
  systemDeps: {
    execState: ExecState
    sceneInfra: SceneInfra
    sketchBlock?: Extract<Artifact, { type: 'sketchBlock' }>
  }
): Error | false | OffsetPlane {
  if (artifact?.type !== 'plane') {
    return false
  }

  const planeInfo = systemDeps.sketchBlock?.planeInfo

  if (!planeInfo) {
    return false
  }

  return {
    type: 'offsetPlane',
    zAxis: [planeInfo.zAxis.x, planeInfo.zAxis.y, planeInfo.zAxis.z],
    yAxis: [planeInfo.yAxis.x, planeInfo.yAxis.y, planeInfo.yAxis.z],
    position: [
      planeInfo.origin.x / systemDeps.sceneInfra.baseUnitMultiplier,
      planeInfo.origin.y / systemDeps.sceneInfra.baseUnitMultiplier,
      planeInfo.origin.z / systemDeps.sceneInfra.baseUnitMultiplier,
    ],
    planeId: artifact.id,
    pathToNode: artifact.codeRef.pathToNode,
    negated: false,
  }
}

// Uses engine sketch-mode plane data so selecting a new offset plane can keep
// the current camera-facing side.
export async function getOffsetSketchPlaneData(
  artifact: Artifact | undefined,
  systemDeps: {
    sceneInfra: SceneInfra
    sceneEntitiesManager: SceneEntities
  }
): Promise<Error | false | OffsetPlane> {
  const { sceneInfra } = systemDeps
  if (artifact?.type !== 'plane') {
    return new Error(
      `Invalid artifact type for offset sketch plane selection: ${artifact?.type}`
    )
  }
  const planeId = artifact.id
  try {
    const planeInfo =
      await systemDeps.sceneEntitiesManager.getFaceDetails(planeId)

    // Apply camera-based orientation logic similar to default planes
    let zAxis: [number, number, number] = [
      planeInfo.z_axis.x,
      planeInfo.z_axis.y,
      planeInfo.z_axis.z,
    ]
    let yAxis: [number, number, number] = [
      planeInfo.y_axis.x,
      planeInfo.y_axis.y,
      planeInfo.y_axis.z,
    ]

    // Get camera vector to determine which side of the plane we're viewing from
    const camVector = sceneInfra.camControls.camera.position
      .clone()
      .sub(sceneInfra.camControls.target)

    // Determine the canonical (absolute) plane orientation
    const absZAxis: [number, number, number] = [
      Math.abs(zAxis[0]),
      Math.abs(zAxis[1]),
      Math.abs(zAxis[2]),
    ]

    // Find the dominant axis (like default planes do)
    const maxComponent = Math.max(...absZAxis)
    const dominantAxisIndex = absZAxis.indexOf(maxComponent)

    // Check camera position against canonical orientation (like default planes)
    const cameraComponents = [camVector.x, camVector.y, camVector.z]
    let negated = cameraComponents[dominantAxisIndex] < 0
    if (dominantAxisIndex === 1) {
      // offset of the XZ is being weird, not sure if this is a camera bug
      negated = !negated
    }
    return {
      type: 'offsetPlane',
      zAxis,
      yAxis,
      position: [
        planeInfo.origin.x,
        planeInfo.origin.y,
        planeInfo.origin.z,
      ].map((num) => num / sceneInfra.baseUnitMultiplier) as [
        number,
        number,
        number,
      ],
      planeId,
      pathToNode: artifact.codeRef.pathToNode,
      negated,
    }
  } catch {
    return new Error('Error getting face details')
  }
}

export async function selectOffsetSketchPlane(
  artifact: Artifact | undefined,
  systemDeps: {
    sceneInfra: SceneInfra
    sceneEntitiesManager: SceneEntities
  }
): Promise<Error | boolean> {
  const { sceneInfra } = systemDeps
  const result = await getOffsetSketchPlaneData(artifact, systemDeps)
  if (isErr(result) || result === false) return result

  try {
    sceneInfra.modelingSend({
      type: 'Select sketch plane',
      data: result,
    })
  } catch (err) {
    console.error(err)
    return false
  }
  return true
}

export async function selectionBodyFace(
  planeOrFaceId: ArtifactId,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  execState: ExecState,
  systemDeps: {
    sceneInfra: SceneInfra
    rustContext: RustContext
    sceneEntitiesManager: SceneEntities
    wasmInstance: ModuleType
  }
): Promise<ExtrudeFacePlane | undefined> {
  const { sceneInfra } = systemDeps
  const defaultSketchPlaneSelected = selectDefaultSketchPlane(
    planeOrFaceId,
    systemDeps
  )
  if (!isErr(defaultSketchPlaneSelected) && defaultSketchPlaneSelected) {
    return
  }

  const artifact = artifactGraph.get(planeOrFaceId)
  const offsetPlaneSelected = await selectOffsetSketchPlane(
    artifact,
    systemDeps
  )
  if (!isErr(offsetPlaneSelected) && offsetPlaneSelected) {
    return
  }

  // Artifact is likely an sweep face
  const faceId = planeOrFaceId
  const extrusion = getSweepFromSuspectedSweepSurface(faceId, artifactGraph)
  if (!err(extrusion)) {
    const maybeImportNode = getNodeFromPath<ImportStatement>(
      ast,
      extrusion.codeRef.pathToNode,
      systemDeps.wasmInstance,
      ['ImportStatement']
    )
    if (
      !err(maybeImportNode) &&
      maybeImportNode.node &&
      maybeImportNode.node.type === 'ImportStatement'
    ) {
      if (maybeImportNode.node.path.type === 'Kcl') {
        showSketchOnImportToast(maybeImportNode.node.path.filename)
      } else if (maybeImportNode.node.path.type === 'Foreign') {
        showSketchOnImportToast(maybeImportNode.node.path.path)
      } else if (maybeImportNode.node.path.type === 'Std') {
        toast.error("Can't sketch on this face.")
      } else {
        // force tsc error if more cases are added
        const _exhaustiveCheck: never = maybeImportNode.node.path
      }
    }
  }

  if (
    artifact?.type !== 'cap' &&
    artifact?.type !== 'wall' &&
    !(artifact?.type === 'edgeCut' && artifact.subType === 'chamfer')
  )
    return

  const codeRef =
    artifact.type === 'cap'
      ? getCapCodeRef(artifact, artifactGraph)
      : artifact.type === 'wall'
        ? getWallCodeRef(artifact, artifactGraph)
        : artifact.codeRef

  const faceInfo = await systemDeps.sceneEntitiesManager.getFaceDetails(faceId)
  if (!faceInfo?.origin || !faceInfo?.z_axis || !faceInfo?.y_axis) return
  const { z_axis, y_axis, origin } = faceInfo
  const sketchPathToNode = err(codeRef) ? [] : codeRef.pathToNode

  const edgeCutMeta = getEdgeCutMeta(
    artifact,
    ast,
    artifactGraph,
    systemDeps.wasmInstance
  )
  const _faceInfo: ExtrudeFacePlane['faceInfo'] = edgeCutMeta
    ? edgeCutMeta
    : artifact.type === 'cap'
      ? {
          type: 'cap',
          subType: artifact.subType,
        }
      : { type: 'wall' }

  if (err(extrusion)) {
    return Promise.reject(
      new Error(`Extrusion is not a valid artifact: ${extrusion}`)
    )
  }

  const children = findAllChildrenAndOrderByPlaceInCode(
    { type: 'sweep', ...extrusion },
    artifactGraph
  )
  const lastChildVariable = getLastVariable(
    children,
    ast,
    systemDeps.wasmInstance,
    ['sweep', 'compositeSolid']
  )
  const extrudePathToNode =
    lastChildVariable && !err(lastChildVariable)
      ? lastChildVariable.pathToNode
      : []

  return {
    type: 'extrudeFace',
    zAxis: [z_axis.x, z_axis.y, z_axis.z],
    yAxis: [y_axis.x, y_axis.y, y_axis.z],
    position: [origin.x, origin.y, origin.z].map(
      (num) => num / sceneInfra.baseUnitMultiplier
    ) as [number, number, number],
    sketchPathToNode,
    extrudePathToNode,
    faceInfo: _faceInfo,
    faceId: faceId,
  }
}

export function selectAllInCurrentSketch(
  artifactGraph: ArtifactGraph,
  sceneEntitiesManager: SceneEntities
): Selections {
  const graphSelections: Selection[] = []

  Object.keys(sceneEntitiesManager.activeSegments).forEach((pathToNodeStr) => {
    for (const [artifactId, artifact] of artifactGraph) {
      if (!['path', 'segment'].includes(artifact.type)) continue
      const codeRefs = getCodeRefsByArtifactId(artifactId, artifactGraph)
      if (!codeRefs?.length) continue
      if (JSON.stringify(codeRefs[0].pathToNode) !== pathToNodeStr) continue
      graphSelections.push({
        entityRef: artifactToEntityRef(
          artifact.type,
          artifactId,
          artifact.type === 'segment'
            ? (artifact as { pathId: string }).pathId
            : undefined
        ),
        codeRef: codeRefs[0],
      })
      break
    }
  })

  return {
    graphSelections,
    otherSelections: [],
  }
}

/**
 * Get code references from an EntityReference by traversing the artifact graph.
 * For edges: finds the two faces, then finds their corresponding wall/cap artifacts,
 * then finds the segments those walls correspond to.
 * For faces: finds the wall/cap artifact and its corresponding segment.
 * For vertices: similar traversal through faces.
 */
export function getCodeRefsFromEntityReference(
  entityRef: EntityReference,
  artifactGraph: ArtifactGraph
): Array<{ range: SourceRange }> | null {
  const codeRefs: Array<{ range: SourceRange }> = []

  if (entityRef.type === 'segment' && entityRef.segment_id) {
    const segmentRefs = getCodeRefsByArtifactId(
      entityRef.segment_id,
      artifactGraph
    )
    if (segmentRefs && segmentRefs.length > 0) {
      codeRefs.push({ range: segmentRefs[0].range })
    }
  } else if (entityRef.type === 'solid2d' && entityRef.solid2d_id) {
    // For solid2d, get the codeRef directly from the artifact
    const solid2dArtifact = artifactGraph.get(entityRef.solid2d_id)
    if (!solid2dArtifact || solid2dArtifact.type !== 'solid2d') {
      return null
    }
    const codeRefsForSolid2d = getCodeRefsByArtifactId(
      entityRef.solid2d_id,
      artifactGraph
    )
    if (codeRefsForSolid2d && codeRefsForSolid2d.length > 0) {
      codeRefs.push({ range: codeRefsForSolid2d[0].range })
    }
  } else if (entityRef.type === 'solid3d' && entityRef.solid3d_id) {
    // For solid3d, get the codeRef directly from the artifact
    const solid3dArtifact = artifactGraph.get(entityRef.solid3d_id)
    if (
      !solid3dArtifact ||
      (solid3dArtifact.type !== 'sweep' &&
        solid3dArtifact.type !== 'compositeSolid')
    ) {
      return null
    }
    const codeRefsForSolid3d = getCodeRefsByArtifactId(
      entityRef.solid3d_id,
      artifactGraph
    )
    if (codeRefsForSolid3d && codeRefsForSolid3d.length > 0) {
      codeRefs.push({ range: codeRefsForSolid3d[0].range })
    }
  } else if (entityRef.type === 'face' && entityRef.face_id) {
    // For faces, find the wall/cap artifact and traverse to segment
    const faceArtifact = artifactGraph.get(entityRef.face_id)
    if (!faceArtifact) {
      return null
    }

    // Wall artifacts have segId pointing to the segment
    if (faceArtifact.type === 'wall' && faceArtifact.segId) {
      const segArtifact = getArtifactOfTypes(
        { key: faceArtifact.segId, types: ['segment'] },
        artifactGraph
      )
      if (!err(segArtifact) && segArtifact.codeRef) {
        codeRefs.push({ range: segArtifact.codeRef.range })
      }
      // Also get the extrude (sweep) codeRef, like getCodeRefsByArtifactId does
      const extrusion = getSweepFromSuspectedSweepSurface(
        entityRef.face_id,
        artifactGraph
      )
      if (!err(extrusion) && extrusion.codeRef) {
        codeRefs.push({ range: extrusion.codeRef.range })
      }
    }
    // Cap artifacts - get both the cap codeRef and the extrude
    else if (faceArtifact.type === 'cap') {
      const capCodeRef = getCapCodeRef(faceArtifact, artifactGraph)
      if (!err(capCodeRef)) {
        codeRefs.push({ range: capCodeRef.range })
      }
      // Also get the extrude (sweep) codeRef
      const extrusion = getSweepFromSuspectedSweepSurface(
        entityRef.face_id,
        artifactGraph
      )
      if (!err(extrusion) && extrusion.codeRef) {
        codeRefs.push({ range: extrusion.codeRef.range })
      }
    }
  } else if (entityRef.type === 'solid2d_edge' && entityRef.edge_id) {
    // edge_id may be a helix artifact (we represent helix as solid2d_edge for engine 1:1)
    const edgeArtifact = artifactGraph.get(entityRef.edge_id)
    if (edgeArtifact?.type === 'helix') {
      const refs = getCodeRefsByArtifactId(entityRef.edge_id, artifactGraph)
      if (refs?.length) codeRefs.push({ range: refs[0].range })
    }
    // Solid2D edge ids normally map directly to segment artifacts. Prefer the
    // exact segment before falling back to broader path/profile ranges.
    const segmentArtifact = artifactGraph.get(entityRef.edge_id)
    if (
      segmentArtifact &&
      segmentArtifact.type === 'segment' &&
      segmentArtifact.codeRef
    ) {
      codeRefs.push(segmentArtifact.codeRef)
    }
    // For Solid2D edges (segment curves), the edge_id is the curve UUID
    // We need to find which segment this curve belongs to
    // Search through all paths with solid2dId to find the matching segment
    for (const [_pathId, pathArtifact] of artifactGraph.entries()) {
      if (codeRefs.length > 0) {
        break
      }
      if (pathArtifact.type === 'path' && pathArtifact.solid2dId) {
        // Check all segments in this path
        if (pathArtifact.segIds) {
          for (const segId of pathArtifact.segIds) {
            const segArtifact = artifactGraph.get(segId)
            if (
              segArtifact &&
              segArtifact.type === 'segment' &&
              segArtifact.codeRef
            ) {
              // For now, we'll highlight the segment if the edgeId matches
              // In the future, we could match the curve UUID more precisely
              // But for Solid2D edges, highlighting the whole profile is acceptable
              codeRefs.push({ range: segArtifact.codeRef.range })
            }
          }
        }
        // Also check if the edgeId matches the path or solid2d ID
        const solid2d = artifactGraph.get(pathArtifact.solid2dId)
        if (solid2d && solid2d.type === 'solid2d') {
          const solid2dCodeRef = getSolid2dCodeRef(solid2d, artifactGraph)
          if (!err(solid2dCodeRef)) {
            codeRefs.push({ range: solid2dCodeRef.range })
          }
        }
        break // Found the path, no need to continue
      }
    }
  } else if (
    entityRef.type === 'edge' &&
    entityRef.side_faces &&
    entityRef.side_faces.length >= 1
  ) {
    // For edges, find segments from side_faces and end_faces
    // Handle both Solid3D (2+ faces) and Solid2D (1 face) cases
    const faceIds = [...entityRef.side_faces]
    // Also include end faces
    if (entityRef.end_faces && entityRef.end_faces.length > 0) {
      faceIds.push(...entityRef.end_faces)
    }
    const seenSegments = new Set<string>()

    for (const faceId of faceIds) {
      const faceArtifact = artifactGraph.get(faceId)
      if (!faceArtifact) {
        continue
      }

      // For Solid2D: face is directly a solid2d artifact
      if (faceArtifact.type === 'solid2d') {
        // Get codeRef from the solid2d artifact
        const solid2dCodeRefs = getCodeRefsByArtifactId(faceId, artifactGraph)
        if (solid2dCodeRefs && solid2dCodeRefs.length > 0) {
          codeRefs.push({ range: solid2dCodeRefs[0].range })
        }
        // If we have an index, we could potentially highlight the specific curve/segment
        // but for now, highlighting the whole profile is acceptable
      }
      // Wall artifacts have segId pointing to the segment
      else if (faceArtifact.type === 'wall' && faceArtifact.segId) {
        if (!seenSegments.has(faceArtifact.segId)) {
          seenSegments.add(faceArtifact.segId)
          const segArtifact = getArtifactOfTypes(
            { key: faceArtifact.segId, types: ['segment'] },
            artifactGraph
          )
          if (!err(segArtifact) && segArtifact.codeRef) {
            codeRefs.push({ range: segArtifact.codeRef.range })
          }
        }
        // For edges, don't include the extrude - only highlight the segments
        // (The extrude highlighting is only for face hover, not edge hover)
      }
      // Cap artifacts - for edges, only highlight the cap, not the extrude
      else if (faceArtifact.type === 'cap') {
        const capCodeRef = getCapCodeRef(faceArtifact, artifactGraph)
        if (!err(capCodeRef)) {
          codeRefs.push({ range: capCodeRef.range })
        }
        // For edges, don't include the extrude - only highlight the cap
        // (The extrude highlighting is only for face hover, not edge hover)
      }
    }
  } else if (
    entityRef.type === 'vertex' &&
    entityRef.side_faces &&
    entityRef.side_faces.length >= 3
  ) {
    // For vertices, find segments from all adjacent faces (typically 3+)
    const faceIds = [...entityRef.side_faces]
    const seenSegments = new Set<string>()

    for (const faceId of faceIds) {
      const faceArtifact = artifactGraph.get(faceId)
      if (!faceArtifact) {
        continue
      }

      if (faceArtifact.type === 'wall' && faceArtifact.segId) {
        if (!seenSegments.has(faceArtifact.segId)) {
          seenSegments.add(faceArtifact.segId)
          const segArtifact = getArtifactOfTypes(
            { key: faceArtifact.segId, types: ['segment'] },
            artifactGraph
          )
          if (!err(segArtifact) && segArtifact.codeRef) {
            codeRefs.push({ range: segArtifact.codeRef.range })
          }
        }
        // For vertices (like edges), don't include the extrude - only highlight the segments
        // (The extrude highlighting is only for face hover, not vertex hover)
      } else if (faceArtifact.type === 'cap') {
        const capCodeRef = getCapCodeRef(faceArtifact, artifactGraph)
        if (!err(capCodeRef)) {
          codeRefs.push({ range: capCodeRef.range })
        }
        // For vertices (like edges), don't include the extrude - only highlight the cap
        // (The extrude highlighting is only for face hover, not vertex hover)
      }
    }
  }

  return codeRefs.length > 0 ? codeRefs : null
}

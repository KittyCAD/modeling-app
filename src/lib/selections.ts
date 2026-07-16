import type { SelectionRange } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import type {
  EntityGetPrimitiveIndex,
  OkModelingCmdResponse,
  Point2d,
  RegionGetResolvableIntersectionInfo,
  WebSocketRequest,
} from '@kittycad/lib'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { Object3D } from 'three'
import { Mesh } from 'three'

import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { PlaneName } from '@rust/kcl-lib/bindings/PlaneName'

import {
  EXTRA_SEGMENT_HANDLE,
  SEGMENT_BLUE,
  SEGMENT_BODIES_PLUS_PROFILE_START,
  getParentGroup,
} from '@src/clientSideScene/sceneConstants'
import { AXIS_GROUP, X_AXIS } from '@src/clientSideScene/sceneUtils'
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
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { defaultSourceRange } from '@src/lang/sourceRange'
import type { Artifact, ArtifactId } from '@src/lang/std/artifactGraph'

import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { showSketchOnImportToast } from '@src/components/SketchOnImportToast'
import { showUnsupportedSelectionToast } from '@src/components/ToastUnsupportedSelection'
import type { KclManager } from '@src/lang/KclManager'
import {
  getArtifactOfTypes,
  getCapCodeRef,
  getCodeRefsByArtifactId,
  getOriginalSegmentArtifact,
  getPatternArtifactForCopyId,
  getPatternSelectionIndex,
  getSketchBlockForArtifact,
  getSketchBlockForPathArtifact,
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
import { err, isErr, reportRejection } from '@src/lib/trap'
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
  OffsetPlane,
} from '@src/machines/modelingSharedTypes'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'
import toast from 'react-hot-toast'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

export const X_AXIS_UUID = 'ad792545-7fd3-482a-a602-a93924e3055b'
export const Y_AXIS_UUID = '680fd157-266f-4b8a-984f-cdf46b8bdf01'

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
  if (queryPointResponse.type !== 'region_get_query_point') return null
  return queryPointResponse.data.query_point
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

export async function getPrimitiveSelectionForEntity(
  entityId: string,
  engineCommandManager: ConnectionManager
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
  if (primitiveIndexResponse.type !== 'entity_get_primitive_index') return null

  const entityGetPrimitiveIndex: EntityGetPrimitiveIndex =
    primitiveIndexResponse.data

  const parentEntityId = await getParentEntityIdForEntity(
    entityId,
    engineCommandManager
  )

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
  const patternArtifact = getPatternArtifactForCopyId(
    parentEntityId,
    artifactGraph
  )
  if (patternArtifact && !lookUpPatternCopies) {
    return null
  }
  const parentArtifact = patternArtifact ?? artifactGraph.get(parentEntityId)
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
      key: selection.artifact.consumedEdgeId,
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
  if (graphSelection?.artifact?.type !== 'wall') {
    return null
  }

  const sourceSurfaceArtifact = getSweepArtifactFromSelection(
    graphSelection,
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
  if (!graphSelection) {
    return null
  }

  const edgeArtifact = getTaggableEdgeArtifact(graphSelection, artifactGraph)
  if (!edgeArtifact || edgeArtifact.type === 'sweepEdge') {
    return null
  }

  const sourceSurfaceArtifact = getSweepArtifactFromSelection(
    {
      ...graphSelection,
      artifact: edgeArtifact,
    },
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
  if (!graphSelection) {
    return null
  }

  const edgeArtifact = getTaggableEdgeArtifact(graphSelection, artifactGraph)
  if (!edgeArtifact || edgeArtifact.type !== 'sweepEdge') {
    return null
  }

  const sourceSurfaceArtifact = getSweepArtifactFromSelection(
    {
      ...graphSelection,
      artifact: edgeArtifact,
    },
    artifactGraph
  )
  if (err(sourceSurfaceArtifact)) {
    return null
  }

  const tagResult = modifyAstWithTagsForSelection(
    kclManager.ast,
    {
      ...graphSelection,
      artifact: edgeArtifact,
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
      engineCommandManager
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
  selection: Selections['otherSelections'][number]
): selection is EnginePrimitiveSelection {
  return (
    typeof selection === 'object' &&
    'type' in selection &&
    selection.type === 'enginePrimitive'
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

export async function getEventForSelectWithPoint(
  { data }: Extract<OkModelingCmdResponse, { type: 'select_with_point' }>,
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
  const { ast, artifactGraph } = kclManager
  if (!data?.entity_id) {
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
    }
  }
  if ([X_AXIS_UUID, Y_AXIS_UUID].includes(data.entity_id)) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'axisSelection',
        selection: X_AXIS_UUID === data.entity_id ? 'x-axis' : 'y-axis',
      },
    }
  }

  // Check for default plane selection
  const foundDefaultPlane =
    rustContext.defaultPlanes !== null &&
    Object.entries(rustContext.defaultPlanes).find(
      ([, plane]) => plane === data.entity_id
    )
  if (foundDefaultPlane) {
    return {
      type: 'Set selection',
      data: {
        selectionType: 'defaultPlaneSelection',
        selection: {
          name: foundDefaultPlane[0] as DefaultPlaneStr,
          id: data.entity_id,
        },
      },
    }
  }

  const selectedEngineEntityId = data.entity_id
  const _artifact =
    getPatternArtifactForCopyId(selectedEngineEntityId, artifactGraph) ??
    artifactGraph.get(selectedEngineEntityId)
  if (!_artifact) {
    // if there's no artifact but there is a data.entity_id, it means we don't recognize the engine entity

    // we first check if it's a region
    const regionSelection = await getEngineRegionSelectionFromEntity(
      data.entity_id,
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

    // or we build a primitive selection to be used as fallback for downstream operations
    const primitiveSelection = await getPrimitiveSelectionForEntity(
      data.entity_id,
      engineCommandManager
    )
    if (primitiveSelection !== null) {
      return {
        type: 'Set selection',
        data: {
          selectionType: 'enginePrimitiveSelection',
          selection: primitiveSelection,
        },
      }
    }
    // if no entity_id, we should still return an empty singleCodeCursor to plug into the selection logic
    // (i.e. if the user is holding shift they can keep selecting)
    // TODO: understand if there are any cases left that can hit this.
    showUnsupportedSelectionToast()
    return {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor' },
    }
  }
  const codeRefs = getCodeRefsByArtifactId(_artifact.id, artifactGraph)
  if (_artifact && codeRefs) {
    let bodyEngineEntityId = selectedEngineEntityId
    let patternIndex: number | undefined
    if (_artifact.type === 'pattern') {
      const selectedArtifact = artifactGraph.get(selectedEngineEntityId)
      let materializedBodyId: ArtifactId | undefined
      if (
        selectedArtifact?.type === 'wall' ||
        selectedArtifact?.type === 'cap' ||
        selectedArtifact?.type === 'sweepEdge'
      ) {
        materializedBodyId = selectedArtifact.sweepId
      } else if (
        selectedArtifact?.type === 'primitiveFace' ||
        selectedArtifact?.type === 'primitiveEdge'
      ) {
        materializedBodyId = selectedArtifact.solidId
      }

      if (
        materializedBodyId &&
        _artifact.copyIds.includes(materializedBodyId)
      ) {
        bodyEngineEntityId = materializedBodyId
      } else if (
        !_artifact.copyIds.includes(selectedEngineEntityId) &&
        (_artifact.copyFaceIds.includes(selectedEngineEntityId) ||
          _artifact.copyEdgeIds.includes(selectedEngineEntityId))
      ) {
        const parentEntityId = await getParentEntityIdForEntity(
          selectedEngineEntityId,
          engineCommandManager
        )
        if (parentEntityId) {
          bodyEngineEntityId = parentEntityId
        }
      }

      const resolvedPatternIndex = getPatternSelectionIndex({
        artifact: _artifact,
        codeRef: codeRefs[0],
        engineEntityId: bodyEngineEntityId,
      })
      if (!(resolvedPatternIndex instanceof Error)) {
        patternIndex = resolvedPatternIndex
      }
    }
    return {
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: {
          artifact: _artifact,
          codeRef: codeRefs[0],
          engineEntityId: bodyEngineEntityId,
          ...(patternIndex !== undefined ? { patternIndex } : {}),
        },
      },
    }
  }
  return null
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
  return {
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection: {
        artifact,
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

  selections.graphSelections.forEach((selection) => {
    const engineIds = getEngineEntityIdsForSelection(selection)
    engineIds.forEach((id) => {
      const range =
        getCodeRefsByArtifactId(
          selection.artifact?.id || '',
          artifactGraph
        )?.[0]?.range || defaultSourceRange()
      selectionToEngine.push({
        id,
        range,
      })
    })
  })
  selections.otherSelections.forEach((s) => {
    if (isEnginePrimitiveSelection(s)) {
      selectionToEngine.push({
        id: s.entityId,
        range: defaultSourceRange(),
      })
      return
    }
    if (isEngineRegionSelection(s)) {
      selectionToEngine.push({
        id: s.id,
        range: defaultSourceRange(),
      })
      return
    }
    if (isDefaultPlaneSelection(s)) {
      selectionToEngine.push({
        id: s.id,
        range: defaultSourceRange(),
      })
    }
  })
  const engineEvents: WebSocketRequest[] = resetAndSetEngineEntitySelectionCmds(
    selectionToEngine,
    systemDeps
  )
  selections.graphSelections.forEach(({ codeRef }) => {
    if (codeRef.range?.[1]) {
      const safeEnd = Math.min(codeRef.range[1], code.length)
      ranges.push(EditorSelection.cursor(safeEnd))
    }
  })
  if (ranges.length)
    return {
      engineEvents,
      codeMirrorSelection: EditorSelection.create(
        ranges,
        selections.graphSelections.length - 1
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
  const codeBasedSelections: Selections['graphSelections'] =
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
  const selections: Selection[] = []
  for (const { id, range } of idBasedSelections) {
    if (!id) {
      const pathToNode = getNodePathFromSourceRange(ast, range)
      const invalidPathToNode =
        pathToNode.length === 1 &&
        pathToNode[0][0] === 'body' &&
        pathToNode[0][1] === ''
      if (invalidPathToNode) {
        console.warn('Could not find valid pathToNode, found:', pathToNode)
        continue
      }
      selections.push({
        codeRef: {
          range,
          pathToNode,
        },
      })
      continue
    }
    const artifact = artifactGraph.get(id)
    const codeRefs = getCodeRefsByArtifactId(id, artifactGraph)
    if (artifact && codeRefs) {
      selections.push({ artifact, codeRef: codeRefs[0] })
    } else if (codeRefs) {
      selections.push({ codeRef: codeRefs[0] })
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
          graphSelections: selections,
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
  codeBasedSelections: Selection[],
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
      return isOverlap(
        selection?.codeRef?.range,
        topLevelRange(node.start, node.end)
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
  selection?: Selections
): SelectionCountsByType | 'none' {
  const selectionsByType: SelectionCountsByType = new Map()
  if (
    !selection ||
    (!selection.graphSelections.length && !selection.otherSelections.length)
  )
    return 'none'

  function incrementOrInitializeSelectionType(type: ResolvedSelectionType) {
    const count = selectionsByType.get(type) || 0
    selectionsByType.set(type, count + 1)
  }

  selection.otherSelections.forEach((selection) => {
    if (typeof selection === 'string') {
      incrementOrInitializeSelectionType('other')
    } else if (isEngineRegionSelection(selection)) {
      incrementOrInitializeSelectionType('engineRegion')
    } else if (isDefaultPlaneSelection(selection)) {
      incrementOrInitializeSelectionType('plane')
    } else if (
      selection.type === 'enginePrimitive' &&
      selection.primitiveType === 'face'
    ) {
      incrementOrInitializeSelectionType('enginePrimitiveFace')
    } else if (
      selection.type === 'enginePrimitive' &&
      selection.primitiveType === 'edge'
    ) {
      incrementOrInitializeSelectionType('enginePrimitiveEdge')
    } else {
      incrementOrInitializeSelectionType('other')
    }
  })

  selection.graphSelections.forEach((graphSelection) => {
    if (!graphSelection.artifact) {
      /**
       * TODO: remove this heuristic-based selection type detection.
       * Currently, if you've created a sketch and have not left sketch mode,
       * the selection will be a segment selection with no artifact.
       * This is because the mock execution does not update the artifact graph.
       * Once we move the artifactGraph creation to WASM, we can remove this,
       * as the artifactGraph will always be up-to-date.
       */
      if (isSingleCursorInPipe(selection, ast)) {
        incrementOrInitializeSelectionType('segment')
        return
      } else {
        console.warn(
          'Selection is outside of a sketch but has no artifact. Sketch segment selections are the only kind that can have a valid selection with no artifact.',
          JSON.stringify(graphSelection)
        )
        incrementOrInitializeSelectionType('other')
        return
      }
    }
    // Intercept subtypes here. Would have to think of a better way to scale this
    if (
      graphSelection.artifact.type === 'path' &&
      graphSelection.artifact.subType === 'region'
    ) {
      incrementOrInitializeSelectionType('pathRegion')
      return
    }
    incrementOrInitializeSelectionType(graphSelection.artifact.type)
  })

  return selectionsByType
}

export function getSelectionTypeDisplayText(
  ast: Node<Program>,
  selection?: Selections
): string | null {
  const selectionsByType = getSelectionCountByType(ast, selection)
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
      const foundIndex = argument.selectionTypes.findIndex((s) => s === type)
      return (
        foundIndex !== -1 &&
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
  if (!selection.codeRef?.range) {
    console.warn('Selection missing code reference range')
    return []
  }

  const selectionRange = selection.codeRef.range
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
  return {
    ...(candidateId && { id: candidateId }),
    range: selection.codeRef.range,
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

      // Direct artifact case
      if (selection.artifact?.id) {
        const engineIds = getEngineEntityIdsForSelection(selection)
        return engineIds.length
          ? engineIds.map((id) => createSelectionToEngine(selection, id))
          : [createSelectionToEngine(selection)]
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

export async function sendSelectEventToEngine(
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
      type: 'select_with_point',
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
  const singleRes = res
  if (isModelingResponse(singleRes)) {
    const mr = singleRes.resp.data.modeling_response
    if (mr.type === 'select_with_point') return mr.data
  }
  return { entity_id: '' }
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
      const previousSelection =
        prevSelectionRanges.graphSelections[Number(index)]
      const nodeMeta = getNodeFromPath<Expr>(ast, pathToNode, wasmInstance)
      if (err(nodeMeta)) return undefined
      const node = nodeMeta.node
      let artifact: Artifact | null = null
      for (const [id, a] of artifactGraph) {
        if (previousSelection?.artifact?.type === a.type) {
          const codeRefs = getCodeRefsByArtifactId(id, artifactGraph)
          if (!codeRefs) continue
          if (
            JSON.stringify(codeRefs[0].pathToNode) ===
            JSON.stringify(pathToNode)
          ) {
            artifact = a
            break
          }
        }
      }
      if (!artifact) return undefined
      return {
        artifact: artifact,
        codeRef: {
          range: topLevelRange(node.start, node.end),
          pathToNode: pathToNode,
        },
      }
    })
    .filter((x?: Selection) => x !== undefined)

  // for when there is no artifact (sketch mode since mock execute does not update artifactGraph)
  const pathToNodeBasedSelections: Selections['graphSelections'] = []
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

// Uses engine sketch-mode plane data so offset-plane selection can keep the current camera-facing side.
// The returned value depends on current camera view, ie. when viewing the back side zAxis will be flipped
// due to getFaceDetails().
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

export async function selectSketchPlane(
  planeOrFaceId: string | undefined,
  useSketchSolveMode: boolean | undefined,
  kclManager?: KclManager
) {
  try {
    if (!kclManager) return
    if (!planeOrFaceId) return

    if (useSketchSolveMode) {
      kclManager.sceneInfra.modelingSend({
        type: 'Select sketch solve plane',
        data: planeOrFaceId,
      })
      return
    }

    const defaultSketchPlaneSelected = selectDefaultSketchPlane(planeOrFaceId, {
      sceneInfra: kclManager.sceneInfra,
      rustContext: kclManager.rustContext,
    })
    if (!err(defaultSketchPlaneSelected) && defaultSketchPlaneSelected) {
      return
    }

    const artifact = kclManager.artifactGraph.get(planeOrFaceId)
    const offsetPlaneSelected = await selectOffsetSketchPlane(artifact, {
      sceneInfra: kclManager.sceneInfra,
      sceneEntitiesManager: kclManager.sceneEntitiesManager,
    })
    if (!err(offsetPlaneSelected) && offsetPlaneSelected) {
      return
    }

    const sweepFaceSelected = await selectionBodyFace(
      planeOrFaceId,
      kclManager.artifactGraph,
      kclManager.ast,
      kclManager.execState,
      {
        rustContext: kclManager.rustContext,
        sceneInfra: kclManager.sceneInfra,
        sceneEntitiesManager: kclManager.sceneEntitiesManager,
        wasmInstance: await kclManager.wasmInstancePromise,
      }
    )
    if (sweepFaceSelected) {
      kclManager.sceneInfra.modelingSend({
        type: 'Select sketch plane',
        data: sweepFaceSelected,
      })
    }
  } catch (err) {
    reportRejection(err)
  }
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

  Object.keys(sceneEntitiesManager.activeSegments).forEach((pathToNode) => {
    const artifact = artifactGraph
      .values()
      .find(
        (g) =>
          'codeRef' in g && JSON.stringify(g.codeRef.pathToNode) === pathToNode
      )
    if (artifact && ['path', 'segment'].includes(artifact.type)) {
      const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
      if (codeRefs?.length) {
        graphSelections.push({ artifact, codeRef: codeRefs[0] })
      }
    }
  })

  return {
    graphSelections,
    otherSelections: [],
  }
}

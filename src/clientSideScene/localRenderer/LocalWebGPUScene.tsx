import type { GetSketchModePlane } from '@kittycad/lib'
import { EnvMapLoader } from '@src/clientSideScene/localRenderer/EnvMapLoader'
import { HDR_ENV_MAP_URL } from '@src/clientSideScene/localRenderer/maps'
import { registerLocalSelectionCommandProvider } from '@src/clientSideScene/localSelectionCommandProxy'
import type {
  WebGpuTrimPrimitiveState,
  WebGpuTrimResources,
} from '@src/clientSideScene/webgpuTrim'
import type { KclExecutionDoneDetail } from '@src/lang/KclManager'
import { KclManagerEvents } from '@src/lang/KclManager'
import type { ArtifactGraph, PathToNode, SourceRange } from '@src/lang/wasm'
import { pathToNodeFromRustNodePath } from '@src/lang/wasm'
import { useSingletons } from '@src/lib/boot'
import {
  SKETCH_HIGHLIGHT_COLOR,
  SKETCH_SELECTION_COLOR,
} from '@src/lib/constants'
import { EngineDebugger } from '@src/lib/debugger'
import type {
  RenderPacket,
  RenderPacketBodyMaterial,
  RenderPacketEdge,
  RenderPacketPrimitive,
  RenderPacketRegion,
  RenderPacketSketchSegment,
} from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import { useEffect, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  Line,
  LineBasicMaterial,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three'

const WEBGPU_PORT_POC_STORAGE_KEY = 'webgpu-port-poc'
const WEBGPU_PORT_DEBUG_STORAGE_KEY = 'webgpu-port-debug'
const WEBGPU_PORT_LOG_PREFIX = '[WEBGPU_POC]'
const WEBGPU_TRIMMING_ENABLED = true
const GLTF_METERS_TO_ENGINE_MILLIMETERS = 1000
const ENGINE_MILLIMETERS_TO_GLTF_METERS = 1 / GLTF_METERS_TO_ENGINE_MILLIMETERS
const ENGINE_DEFAULT_SURFACE_COLOR = new Color(0.9, 0.9, 0.9)
const ENGINE_DEFAULT_METALNESS = 0.6
const ENGINE_DEFAULT_ROUGHNESS = 0.4
const HOVER_COLOR = new Color(SKETCH_HIGHLIGHT_COLOR)
const SELECTED_COLOR = new Color(SKETCH_SELECTION_COLOR)
const previewMaterialBaseColors = new WeakMap<Material, Color>()
const EDGE_RAYCAST_THRESHOLD_GLTF_METERS = 0.001

function shouldEnableLocalWebGpuPreview() {
  return localStorage.getItem(WEBGPU_PORT_POC_STORAGE_KEY) !== 'false'
}

function shouldDebugLocalWebGpuPreview() {
  return localStorage.getItem(WEBGPU_PORT_DEBUG_STORAGE_KEY) === 'true'
}

function logLocalWebGpuPreview(message: string, metadata?: unknown) {
  EngineDebugger.addLog({
    label: 'LocalWebGPUScene',
    message,
    metadata,
  })

  const shouldPrintToConsole =
    shouldDebugLocalWebGpuPreview() ||
    message === 'preview initialization failed' ||
    message === 'device request failed' ||
    message === 'render packet unavailable; keeping stream active' ||
    message === 'local sketch mode plane missing for request' ||
    message === 'local sketch mode plane derivation failed' ||
    message === 'local sketch mode plane mesh missing'

  if (shouldPrintToConsole) {
    console.info(
      `${WEBGPU_PORT_LOG_PREFIX}[LocalWebGPUScene]`,
      message,
      metadata ?? ''
    )
  }
}

function buildRenderPacketModel(
  packet: RenderPacket,
  trimResources: WebGpuTrimResources | null
) {
  const root = new Group()
  const primitiveByObject = new WeakMap<Object3D, RenderPacketPrimitive>()
  const edgeByObject = new WeakMap<Object3D, RenderPacketEdge>()
  const sketchByObject = new WeakMap<Object3D, RenderPacketSketchSegment>()
  const regionByObject = new WeakMap<Object3D, RenderPacketRegion>()

  packet.primitives.forEach((primitive, primitiveOffset) => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(primitive.positions), 3)
    )
    if (primitive.normals.length === primitive.positions.length) {
      geometry.setAttribute(
        'normal',
        new BufferAttribute(new Float32Array(primitive.normals), 3)
      )
    }
    if (primitive.uvs.length / 2 === primitive.positions.length / 3) {
      geometry.setAttribute(
        'uv',
        new BufferAttribute(new Float32Array(primitive.uvs), 2)
      )
    }
    geometry.setIndex(
      new BufferAttribute(new Uint32Array(primitive.indices), 1)
    )

    const mesh = new Mesh(geometry)
    mesh.name = `mesh_0_${primitive.primitiveIndex ?? primitiveOffset}`
    mesh.userData.gltfPrimitiveExtras = {
      KITTYCAD: {
        object_id: primitive.objectId,
        body_id: primitive.bodyId,
        face_id: primitive.faceId,
        face_index: primitive.faceIndex,
        primitive_index: primitive.primitiveIndex,
      } satisfies PacketPrimitiveUserData['KITTYCAD'],
    } satisfies PacketPrimitiveUserData
    mesh.userData.kittycadPrimitiveExtras =
      mesh.userData.gltfPrimitiveExtras.KITTYCAD
    mesh.userData.kittycadTrimLoops = primitive.trimLoops
    mesh.userData.kittycadTrimState =
      trimResources?.primitiveStates[primitiveOffset] ?? null
    primitiveByObject.set(mesh, primitive)
    root.add(mesh)
  })

  packet.edges.forEach((edge: RenderPacketEdge) => {
    if (edge.positions.length < 6) {
      return
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(edge.positions), 3)
    )

    const line = new Line(
      geometry,
      new LineBasicMaterial({
        color: 0xf2f3f5,
        transparent: true,
        opacity: 0.95,
      })
    )
    line.name = `edge_${edge.edgeIndex}`
    line.userData.kittycadEdgeExtras = {
      object_id: edge.objectId,
      body_id: edge.bodyId,
      edge_id: edge.edgeId,
      edge_index: edge.edgeIndex,
    } satisfies KittycadEdgeExtras
    line.renderOrder = 2
    edgeByObject.set(line, edge)
    root.add(line)
  })

  packet.sketches.forEach((segment) => {
    if (segment.positions.length < 6) {
      return
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(segment.positions), 3)
    )

    const line = new Line(
      geometry,
      new LineBasicMaterial({
        color: 0xf2f3f5,
        transparent: true,
        opacity: 0.95,
      })
    )
    line.name = `sketch_${segment.sketchId}_${segment.holeIndex ?? 'path'}_${segment.segmentIndex}`
    line.userData.kittycadSketchExtras = {
      sketch_id: segment.sketchId,
      segment_id: segment.segmentId ?? null,
      segment_index: segment.segmentIndex,
      hole_index: segment.holeIndex ?? null,
      closed: segment.closed,
      source_range: segment.sourceRange ?? null,
      node_path: segment.nodePath
        ? pathToNodeFromRustNodePath(segment.nodePath)
        : null,
    } satisfies KittycadSketchExtras
    line.renderOrder = 3
    sketchByObject.set(line, segment)
    root.add(line)
  })

  packet.regions.forEach((region, regionIndex) => {
    const geometry = buildRegionGeometry(region)
    if (!geometry) {
      return
    }

    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
      })
    )
    mesh.name = `region_${region.regionId}_${regionIndex}`
    mesh.userData.kittycadRegionExtras = {
      sketch_id: region.sketchId,
      region_id: region.regionId,
      parent_id: region.parentId,
      query_point: region.queryPoint,
    } satisfies KittycadRegionExtras
    mesh.renderOrder = 3
    regionByObject.set(mesh, region)
    root.add(mesh)
  })

  return {
    model: root,
    parserState: {
      primitiveByObject,
      edgeByObject,
      sketchByObject,
      regionByObject,
    } satisfies RenderPacketParserState,
  }
}

function disposeMaterial(material: Material) {
  for (const value of Object.values(material)) {
    if (
      value &&
      typeof value === 'object' &&
      'dispose' in value &&
      typeof (value as { dispose?: unknown }).dispose === 'function'
    ) {
      ;(value as { dispose: () => void }).dispose()
    }
  }

  material.dispose()
}

function disposeObject3D(root: Object3D) {
  root.traverse((object) => {
    if ('geometry' in object && object.geometry) {
      ;(object.geometry as { dispose: () => void }).dispose()
    }

    if ('material' in object && object.material) {
      const materials = (
        isArray(object.material) ? object.material : [object.material]
      ) as Material[]
      materials.forEach(disposeMaterial)
    }
  })
}

function prepareLoadedModelForPreview(
  root: Object3D,
  trimResources: WebGpuTrimResources | null,
  bodyMaterialById: ReadonlyMap<string, RenderPacketBodyMaterial>
) {
  let meshCount = 0
  let materialCount = 0
  const materialTypes = new Set<string>()

  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    object.frustumCulled = false

    if (!(object instanceof Mesh)) {
      return
    }

    meshCount += 1
    if (!object.geometry.getAttribute('normal')) {
      object.geometry.computeVertexNormals()
    }
    const materials = (
      isArray(object.material) ? object.material : [object.material]
    ) as Material[]
    const trimState = (object.userData?.kittycadTrimState ??
      null) as WebGpuTrimPrimitiveState | null
    const primitiveExtras = isKittycadPrimitiveExtras(
      object.userData?.kittycadPrimitiveExtras
    )
      ? object.userData.kittycadPrimitiveExtras
      : null
    const bodyMaterial = primitiveExtras
      ? bodyMaterialById.get(primitiveExtras.body_id)
      : undefined
    const opacity = bodyMaterial
      ? Math.min(1, Math.max(0, bodyMaterial.baseColor.a))
      : 1
    const previewMaterials = materials.map((material) => {
      const materialParameters = {
        color: bodyMaterial
          ? new Color(
              bodyMaterial.baseColor.r,
              bodyMaterial.baseColor.g,
              bodyMaterial.baseColor.b
            )
          : ENGINE_DEFAULT_SURFACE_COLOR,
        metalness: bodyMaterial?.metalness ?? ENGINE_DEFAULT_METALNESS,
        roughness: bodyMaterial?.roughness ?? ENGINE_DEFAULT_ROUGHNESS,
        opacity,
        transparent: opacity < 1,
        depthWrite: opacity >= 1,
        side: FrontSide,
      }
      const previewMaterial =
        trimState && trimResources
          ? trimResources.createMaterial(trimState, materialParameters)
          : new MeshStandardMaterial(materialParameters)
      previewMaterialBaseColors.set(
        previewMaterial,
        previewMaterial.color.clone()
      )
      materialCount += 1
      materialTypes.add(material.type)
      disposeMaterial(material)
      return previewMaterial
    })
    object.material = isArray(object.material)
      ? previewMaterials
      : previewMaterials[0]
  })

  return {
    meshCount,
    materialCount,
    materialTypes: Array.from(materialTypes.values()),
  }
}

type PreviewSurfaceMaterial = Material & { color: Color }

function getPreviewMaterials(mesh: Mesh): PreviewSurfaceMaterial[] {
  const materials = isArray(mesh.material) ? mesh.material : [mesh.material]
  return materials.filter(
    (material): material is PreviewSurfaceMaterial =>
      'color' in material && material.color instanceof Color
  )
}

type PreviewAssociation = {
  type?: string
  index?: number
  [key: string]: unknown
}

type GltfParserJson = {
  meshes?: Array<{
    extras?: unknown
    primitives?: Array<{
      extras?: unknown
    }>
  }>
  nodes?: Array<{
    extras?: unknown
    mesh?: number
    name?: string
  }>
}

type GltfParserState = {
  associations: Map<unknown, unknown> | null
  json: GltfParserJson | null
}

type RenderPacketParserState = {
  primitiveByObject: WeakMap<Object3D, RenderPacketPrimitive>
  edgeByObject: WeakMap<Object3D, RenderPacketEdge>
  sketchByObject: WeakMap<Object3D, RenderPacketSketchSegment>
  regionByObject: WeakMap<Object3D, RenderPacketRegion>
}

type KittycadPrimitiveExtras = {
  object_id: string
  body_id: string
  face_id: string
  face_index: number
  primitive_index: number
}

type KittycadEdgeExtras = {
  object_id: string
  body_id: string
  edge_id: string
  edge_index: number
}

type KittycadSketchExtras = {
  sketch_id: string
  segment_id: string | null
  segment_index: number
  hole_index: number | null
  closed: boolean
  source_range: SourceRange | null
  node_path: PathToNode | null
}

type KittycadRegionExtras = {
  sketch_id: string
  region_id: string
  parent_id: string
  query_point: { x: number; y: number }
}

type RenderPacketTrimLoopSummary = {
  positions: number[]
}

function pointInTrimLoop(
  point: { x: number; y: number },
  loop: RenderPacketTrimLoopSummary
) {
  const { positions } = loop
  if (positions.length < 6) {
    return false
  }

  let inside = false
  let previousIndex = positions.length - 2
  for (
    let currentIndex = 0;
    currentIndex < positions.length;
    currentIndex += 2
  ) {
    const xi = positions[currentIndex]
    const yi = positions[currentIndex + 1]
    const xj = positions[previousIndex]
    const yj = positions[previousIndex + 1]

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-12) + xi

    if (intersects) {
      inside = !inside
    }

    previousIndex = currentIndex
  }

  return inside
}

function isUvInsideTrimLoops(
  uv: { x: number; y: number } | null | undefined,
  trimLoops: RenderPacketTrimLoopSummary[] | null | undefined
) {
  if (!uv || !trimLoops || trimLoops.length === 0) {
    return true
  }

  let inside = false
  for (const loop of trimLoops) {
    if (pointInTrimLoop(uv, loop)) {
      inside = !inside
    }
  }

  return inside
}

function unpackRegionLoop(loop: { positions: number[] }) {
  const points: Vector2[] = []
  for (let index = 0; index <= loop.positions.length - 2; index += 2) {
    points.push(new Vector2(loop.positions[index], loop.positions[index + 1]))
  }
  return points
}

function buildRegionGeometry(region: RenderPacketRegion) {
  const contour = unpackRegionLoop(region.outerLoop)
  if (contour.length < 3) {
    return null
  }

  const holes = region.holeLoops
    .map(unpackRegionLoop)
    .filter((hole) => hole.length >= 3)

  const normalizedContour = ShapeUtils.isClockWise(contour)
    ? [...contour].reverse()
    : contour
  const normalizedHoles = holes.map((hole) =>
    ShapeUtils.isClockWise(hole) ? hole : [...hole].reverse()
  )

  const faces = ShapeUtils.triangulateShape(normalizedContour, normalizedHoles)
  if (faces.length === 0) {
    return null
  }

  const points = [...normalizedContour, ...normalizedHoles.flat()]
  const origin = new Vector3(
    region.planeOrigin.x,
    region.planeOrigin.y,
    region.planeOrigin.z
  )
  const xAxis = new Vector3(
    region.planeXAxis.x,
    region.planeXAxis.y,
    region.planeXAxis.z
  )
  const yAxis = new Vector3(
    region.planeYAxis.x,
    region.planeYAxis.y,
    region.planeYAxis.z
  )

  const positions = new Float32Array(points.length * 3)
  points.forEach((point, pointIndex) => {
    const worldPoint = origin
      .clone()
      .addScaledVector(xAxis, point.x)
      .addScaledVector(yAxis, point.y)
    const offset = pointIndex * 3
    positions[offset] = worldPoint.x
    positions[offset + 1] = worldPoint.y
    positions[offset + 2] = worldPoint.z
  })

  const indices = new Uint32Array(faces.length * 3)
  faces.forEach((face, faceIndex) => {
    const offset = faceIndex * 3
    indices[offset] = face[0]
    indices[offset + 1] = face[1]
    indices[offset + 2] = face[2]
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  return geometry
}

type ResolvedSelectionEntity = {
  entityId: string
  parentEntityId: string
  primitiveIndex: number
  entityType: 'face' | 'edge' | 'region'
}

type PacketPrimitiveUserData = {
  KITTYCAD: KittycadPrimitiveExtras
}

function toPoint3d(vector: Vector3) {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  }
}

function convertEngineWorldVectorToGltfWorld(
  vector: Vector3,
  scale = 1
): Vector3 {
  return new Vector3(vector.x * scale, vector.z * scale, -vector.y * scale)
}

type PreviewLighting = {
  cameraDirectionalLight: DirectionalLight
}

function createPreviewLighting(scene: Scene): PreviewLighting {
  const cameraDirectionalLight = new DirectionalLight(0xffffff, 0.25)
  scene.add(cameraDirectionalLight, cameraDirectionalLight.target)

  return {
    cameraDirectionalLight,
  }
}

function updatePreviewLighting(
  lighting: PreviewLighting,
  camera: PerspectiveCamera | OrthographicCamera,
  target: Vector3
) {
  lighting.cameraDirectionalLight.position.copy(camera.position)
  lighting.cameraDirectionalLight.target.position.copy(target)
}

function scalePoint3d(point: GetSketchModePlane['origin'], scale: number) {
  return {
    x: point.x * scale,
    y: point.y * scale,
    z: point.z * scale,
  }
}

function summarizeSketchModePlane(plane: GetSketchModePlane | null) {
  if (!plane) {
    return null
  }

  return {
    origin: [plane.origin.x, plane.origin.y, plane.origin.z],
    xAxis: [plane.x_axis.x, plane.x_axis.y, plane.x_axis.z],
    yAxis: [plane.y_axis.x, plane.y_axis.y, plane.y_axis.z],
    zAxis: [plane.z_axis.x, plane.z_axis.y, plane.z_axis.z],
  }
}

function summarizeMeshWorldGeometry(mesh: Mesh) {
  mesh.updateWorldMatrix(true, false)

  const positionAttribute = mesh.geometry.getAttribute('position')
  if (!positionAttribute || positionAttribute.count < 3) {
    return {
      meshWorldPosition: new Vector3().setFromMatrixPosition(mesh.matrixWorld),
      firstTriangleWorld: null,
    }
  }

  const indexAttribute = mesh.geometry.index
  const a = new Vector3()
    .fromBufferAttribute(
      positionAttribute,
      indexAttribute ? indexAttribute.getX(0) : 0
    )
    .applyMatrix4(mesh.matrixWorld)
  const b = new Vector3()
    .fromBufferAttribute(
      positionAttribute,
      indexAttribute ? indexAttribute.getX(1) : 1
    )
    .applyMatrix4(mesh.matrixWorld)
  const c = new Vector3()
    .fromBufferAttribute(
      positionAttribute,
      indexAttribute ? indexAttribute.getX(2) : 2
    )
    .applyMatrix4(mesh.matrixWorld)

  return {
    meshWorldPosition: new Vector3().setFromMatrixPosition(mesh.matrixWorld),
    indexed: Boolean(indexAttribute),
    firstTriangleWorld: [a.toArray(), b.toArray(), c.toArray()],
  }
}

function deriveSketchModePlaneFromMesh(
  mesh: Mesh,
  camera: PerspectiveCamera | OrthographicCamera | null
): GetSketchModePlane | null {
  mesh.updateWorldMatrix(true, false)

  const positionAttribute = mesh.geometry.getAttribute('position')
  if (!positionAttribute || positionAttribute.count < 3) {
    return null
  }
  const indexAttribute = mesh.geometry.index

  const centroid = new Vector3()
  const first = new Vector3()
  const second = new Vector3()
  const third = new Vector3()
  const edgeA = new Vector3()
  const edgeB = new Vector3()
  const normal = new Vector3()
  const yAxis = new Vector3()
  const xAxis = new Vector3()
  const viewDirection = new Vector3()
  const epsilon = 1e-10

  const referencedVertexIndices = indexAttribute
    ? Array.from({ length: indexAttribute.count }, (_, arrayIndex) =>
        indexAttribute.getX(arrayIndex)
      )
    : Array.from(
        { length: positionAttribute.count },
        (_, arrayIndex) => arrayIndex
      )

  if (referencedVertexIndices.length < 3) {
    return null
  }

  for (const vertexIndex of referencedVertexIndices) {
    centroid.add(
      first
        .fromBufferAttribute(positionAttribute, vertexIndex)
        .applyMatrix4(mesh.matrixWorld)
    )
  }
  centroid.multiplyScalar(1 / referencedVertexIndices.length)

  let foundNormal = false
  for (
    let referencedIndex = 0;
    referencedIndex <= referencedVertexIndices.length - 3;
    referencedIndex += 3
  ) {
    first
      .fromBufferAttribute(
        positionAttribute,
        referencedVertexIndices[referencedIndex]
      )
      .applyMatrix4(mesh.matrixWorld)
    second
      .fromBufferAttribute(
        positionAttribute,
        referencedVertexIndices[referencedIndex + 1]
      )
      .applyMatrix4(mesh.matrixWorld)
    third
      .fromBufferAttribute(
        positionAttribute,
        referencedVertexIndices[referencedIndex + 2]
      )
      .applyMatrix4(mesh.matrixWorld)

    edgeA.subVectors(second, first)
    edgeB.subVectors(third, first)
    normal.crossVectors(edgeA, edgeB)
    if (normal.lengthSq() > epsilon) {
      normal.normalize()
      foundNormal = true
      break
    }
  }

  if (!foundNormal) {
    return null
  }

  if (camera) {
    viewDirection.subVectors(camera.position, centroid)
    if (viewDirection.lengthSq() > epsilon && normal.dot(viewDirection) < 0) {
      normal.negate()
    }
    yAxis.copy(camera.up)
  } else {
    yAxis.set(0, 1, 0)
  }

  yAxis.projectOnPlane(normal)
  if (yAxis.lengthSq() <= epsilon) {
    yAxis.set(0, 0, 1).projectOnPlane(normal)
  }
  if (yAxis.lengthSq() <= epsilon) {
    yAxis.set(1, 0, 0).projectOnPlane(normal)
  }
  if (yAxis.lengthSq() <= epsilon) {
    return null
  }

  yAxis.normalize()
  xAxis.crossVectors(yAxis, normal).normalize()
  yAxis.crossVectors(normal, xAxis).normalize()

  return {
    origin: scalePoint3d(
      toPoint3d(centroid),
      GLTF_METERS_TO_ENGINE_MILLIMETERS
    ),
    x_axis: toPoint3d(xAxis),
    y_axis: toPoint3d(yAxis),
    z_axis: toPoint3d(normal),
  }
}

function summarizeAssociation(association: unknown) {
  if (!association || typeof association !== 'object') {
    return null
  }

  return Object.fromEntries(
    Object.entries(association as Record<string, unknown>).filter(
      ([, value]) =>
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    )
  )
}

function getNumericAssociationIndex(
  association: PreviewAssociation | null,
  key: 'meshes' | 'nodes' | 'primitives'
) {
  const value = association?.[key]
  return typeof value === 'number' ? value : null
}

function summarizeExtras(extras: unknown) {
  if (!extras || typeof extras !== 'object') {
    return null
  }

  return extras
}

function getPickedObjectMetadata(
  object: Object3D,
  parserState: GltfParserState | RenderPacketParserState | null
) {
  const primitiveExtrasFromUserData =
    object.userData?.gltfPrimitiveExtras &&
    typeof object.userData.gltfPrimitiveExtras === 'object' &&
    'KITTYCAD' in object.userData.gltfPrimitiveExtras
      ? object.userData.gltfPrimitiveExtras
      : null
  const kittycadPrimitiveExtrasFromUserData = isKittycadPrimitiveExtras(
    object.userData?.kittycadPrimitiveExtras
  )
    ? object.userData.kittycadPrimitiveExtras
    : null

  if (parserState && 'primitiveByObject' in parserState) {
    const primitive = parserState.primitiveByObject.get(object) ?? null
    const edge = parserState.edgeByObject.get(object) ?? null
    const sketch = parserState.sketchByObject.get(object) ?? null
    const region = parserState.regionByObject.get(object) ?? null
    return {
      association: primitive
        ? {
            meshes: 0,
            primitives: primitive.primitiveIndex,
          }
        : edge
          ? {
              edges: edge.edgeIndex,
            }
          : sketch
            ? {
                sketches: sketch.segmentIndex,
              }
            : region
              ? {
                  regions: region.regionId,
                }
              : null,
      primitiveExtras: primitiveExtrasFromUserData,
      meshExtras: null,
      nodeExtras: null,
      nodeIndex: null,
      kittycadPrimitiveExtras: kittycadPrimitiveExtrasFromUserData,
      kittycadEdgeExtras: isKittycadEdgeExtras(
        object.userData?.kittycadEdgeExtras
      )
        ? object.userData.kittycadEdgeExtras
        : edge
          ? {
              object_id: edge.objectId,
              body_id: edge.bodyId,
              edge_id: edge.edgeId,
              edge_index: edge.edgeIndex,
            }
          : null,
      kittycadSketchExtras: object.userData?.kittycadSketchExtras ?? null,
      kittycadRegionExtras: object.userData?.kittycadRegionExtras ?? null,
    }
  }

  const association = summarizeAssociation(
    parserState?.associations?.get(object) ?? null
  )
  const meshIndex = getNumericAssociationIndex(association, 'meshes')
  const primitiveIndex = getNumericAssociationIndex(association, 'primitives')
  const primitiveExtras =
    meshIndex !== null && primitiveIndex !== null
      ? summarizeExtras(
          parserState?.json?.meshes?.[meshIndex]?.primitives?.[primitiveIndex]
            ?.extras ?? null
        )
      : null
  const meshExtras =
    meshIndex !== null
      ? summarizeExtras(parserState?.json?.meshes?.[meshIndex]?.extras ?? null)
      : null

  let nodeExtras: unknown = null
  let nodeIndex: number | null = null
  let current: Object3D | null = object
  while (current && nodeExtras === null) {
    const currentAssociation = summarizeAssociation(
      parserState?.associations?.get(current) ?? null
    )
    nodeIndex = getNumericAssociationIndex(currentAssociation, 'nodes')
    if (nodeIndex !== null) {
      nodeExtras = summarizeExtras(
        parserState?.json?.nodes?.[nodeIndex]?.extras
      )
    }
    current = current.parent
  }

  const kittycadPrimitiveExtras =
    kittycadPrimitiveExtrasFromUserData ??
    (primitiveExtras &&
    typeof primitiveExtras === 'object' &&
    'KITTYCAD' in primitiveExtras
      ? (primitiveExtras as Record<string, unknown>).KITTYCAD
      : null)

  return {
    association,
    primitiveExtras: primitiveExtras ?? primitiveExtrasFromUserData,
    meshExtras,
    nodeExtras,
    nodeIndex,
    kittycadPrimitiveExtras,
    kittycadEdgeExtras: isKittycadEdgeExtras(
      object.userData?.kittycadEdgeExtras
    )
      ? object.userData.kittycadEdgeExtras
      : null,
    kittycadSketchExtras: object.userData?.kittycadSketchExtras ?? null,
    kittycadRegionExtras: object.userData?.kittycadRegionExtras ?? null,
  }
}

function isKittycadPrimitiveExtras(
  value: unknown
): value is KittycadPrimitiveExtras {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as KittycadPrimitiveExtras).object_id === 'string' &&
    typeof (value as KittycadPrimitiveExtras).body_id === 'string' &&
    typeof (value as KittycadPrimitiveExtras).face_id === 'string' &&
    typeof (value as KittycadPrimitiveExtras).face_index === 'number' &&
    typeof (value as KittycadPrimitiveExtras).primitive_index === 'number'
  )
}

function isKittycadEdgeExtras(value: unknown): value is KittycadEdgeExtras {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as KittycadEdgeExtras).object_id === 'string' &&
    typeof (value as KittycadEdgeExtras).body_id === 'string' &&
    typeof (value as KittycadEdgeExtras).edge_id === 'string' &&
    typeof (value as KittycadEdgeExtras).edge_index === 'number'
  )
}

function isKittycadRegionExtras(value: unknown): value is KittycadRegionExtras {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as KittycadRegionExtras).sketch_id === 'string' &&
    typeof (value as KittycadRegionExtras).region_id === 'string' &&
    typeof (value as KittycadRegionExtras).parent_id === 'string' &&
    !!(value as KittycadRegionExtras).query_point &&
    typeof (value as KittycadRegionExtras).query_point.x === 'number' &&
    typeof (value as KittycadRegionExtras).query_point.y === 'number'
  )
}

function resolveSelectionEntityFromPrimitiveExtras(
  extras: KittycadPrimitiveExtras,
  artifactGraph: ArtifactGraph
): ResolvedSelectionEntity {
  const directArtifact = artifactGraph.get(extras.face_id)
  if (directArtifact) {
    if (directArtifact.type === 'primitiveFace') {
      return {
        entityId: directArtifact.id,
        parentEntityId: directArtifact.solidId,
        primitiveIndex: extras.primitive_index,
        entityType: 'face',
      }
    }

    if (
      directArtifact.type === 'wall' ||
      directArtifact.type === 'cap' ||
      directArtifact.type === 'edgeCut'
    ) {
      return {
        entityId: directArtifact.id,
        parentEntityId:
          'sweepId' in directArtifact &&
          typeof directArtifact.sweepId === 'string'
            ? directArtifact.sweepId
            : extras.object_id,
        primitiveIndex: extras.primitive_index,
        entityType: 'face',
      }
    }

    return {
      entityId: directArtifact.id,
      parentEntityId: extras.object_id,
      primitiveIndex: extras.primitive_index,
      entityType: 'face',
    }
  }

  const objectArtifact = artifactGraph.get(extras.object_id)
  const sweepArtifact =
    objectArtifact?.type === 'sweep'
      ? objectArtifact
      : objectArtifact?.type === 'path' && objectArtifact.sweepId
        ? artifactGraph.get(objectArtifact.sweepId)
        : null

  if (sweepArtifact?.type === 'sweep') {
    const surfaceEntityId =
      sweepArtifact.surfaceIds[extras.primitive_index] ??
      sweepArtifact.surfaceIds[extras.face_index]
    if (surfaceEntityId) {
      return {
        entityId: surfaceEntityId,
        parentEntityId: sweepArtifact.id,
        primitiveIndex: extras.primitive_index,
        entityType: 'face',
      }
    }
  }

  return {
    entityId: extras.face_id,
    parentEntityId: extras.object_id,
    primitiveIndex: extras.primitive_index,
    entityType: 'face',
  }
}

function resolveSelectionEntityFromEdgeExtras(
  extras: KittycadEdgeExtras,
  artifactGraph: ArtifactGraph
): ResolvedSelectionEntity {
  const directArtifact = artifactGraph.get(extras.edge_id)
  if (
    directArtifact?.type === 'primitiveEdge' ||
    directArtifact?.type === 'sweepEdge'
  ) {
    return {
      entityId: directArtifact.id,
      parentEntityId:
        directArtifact.type === 'primitiveEdge'
          ? directArtifact.solidId
          : directArtifact.sweepId,
      primitiveIndex: extras.edge_index,
      entityType: 'edge',
    }
  }

  return {
    entityId: extras.edge_id,
    parentEntityId: extras.object_id,
    primitiveIndex: extras.edge_index,
    entityType: 'edge',
  }
}

function isKittycadSketchExtras(value: unknown): value is KittycadSketchExtras {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as KittycadSketchExtras).sketch_id === 'string' &&
    ((value as KittycadSketchExtras).segment_id === null ||
      typeof (value as KittycadSketchExtras).segment_id === 'string') &&
    typeof (value as KittycadSketchExtras).segment_index === 'number' &&
    ((value as KittycadSketchExtras).hole_index === null ||
      typeof (value as KittycadSketchExtras).hole_index === 'number') &&
    typeof (value as KittycadSketchExtras).closed === 'boolean' &&
    ((value as KittycadSketchExtras).source_range === null ||
      isArray((value as KittycadSketchExtras).source_range)) &&
    ((value as KittycadSketchExtras).node_path === null ||
      isArray((value as KittycadSketchExtras).node_path))
  )
}

function resolveSelectionEntityFromSketchExtras(
  extras: KittycadSketchExtras,
  artifactGraph: ArtifactGraph
): ResolvedSelectionEntity | null {
  if (extras.node_path) {
    const artifactEntry = [...artifactGraph].find(([, artifact]) => {
      return (
        artifact.type === 'segment' &&
        JSON.stringify(artifact.codeRef.pathToNode) ===
          JSON.stringify(extras.node_path)
      )
    })
    if (artifactEntry?.[1].type === 'segment') {
      const artifact = artifactEntry[1]
      return {
        entityId: artifact.id,
        parentEntityId: artifact.pathId,
        primitiveIndex: extras.segment_index,
        entityType: 'edge',
      }
    }
  }

  if (extras.segment_id) {
    const artifact = artifactGraph.get(extras.segment_id)
    if (artifact?.type === 'segment') {
      return {
        entityId: artifact.id,
        parentEntityId: artifact.pathId,
        primitiveIndex: extras.segment_index,
        entityType: 'edge',
      }
    }
  }

  return null
}

function resolveSelectionEntityFromRegionExtras(
  extras: KittycadRegionExtras
): ResolvedSelectionEntity {
  return {
    entityId: extras.region_id,
    parentEntityId: extras.parent_id,
    primitiveIndex: -1,
    entityType: 'region',
  }
}

function setMeshHighlight(
  mesh: Mesh | null,
  mode: 'base' | 'hover' | 'selected'
) {
  if (!mesh) {
    return
  }

  const regionExtras = isKittycadRegionExtras(
    mesh.userData?.kittycadRegionExtras
  )
    ? mesh.userData.kittycadRegionExtras
    : null
  if (regionExtras) {
    const material =
      mesh.material instanceof MeshBasicMaterial ? mesh.material : null
    if (!material) {
      return
    }

    if (mode === 'selected') {
      material.color.copy(SELECTED_COLOR)
      material.opacity = 0.34
    } else if (mode === 'hover') {
      material.color.copy(HOVER_COLOR)
      material.opacity = 0.22
    } else {
      material.color.set(0xffffff)
      material.opacity = 0
    }
    material.needsUpdate = true
    return
  }

  for (const material of getPreviewMaterials(mesh)) {
    const nextColor =
      previewMaterialBaseColors.get(material)?.clone() ??
      ENGINE_DEFAULT_SURFACE_COLOR.clone()
    if (mode === 'selected') {
      nextColor.lerp(SELECTED_COLOR, 0.72)
    } else if (mode === 'hover') {
      nextColor.lerp(HOVER_COLOR, 0.5)
    }
    material.color.copy(nextColor)
  }
}

function setLineHighlight(
  line: Line | null,
  mode: 'base' | 'hover' | 'selected'
) {
  if (!line || !(line.material instanceof LineBasicMaterial)) {
    return
  }

  const nextColor = new Color('#f2f3f5')
  if (mode === 'selected') {
    nextColor.copy(SELECTED_COLOR)
  } else if (mode === 'hover') {
    nextColor.copy(HOVER_COLOR)
  }

  line.material.color.copy(nextColor)
  line.material.opacity = mode === 'base' ? 0.95 : 1
}

function summarizePickedObject(
  object: Object3D,
  parserState: GltfParserState | RenderPacketParserState | null,
  resolvedSelectionEntity: ResolvedSelectionEntity | null = null
) {
  const parentChain: string[] = []
  const associationChain: Array<PreviewAssociation | null> = []
  const associations =
    parserState && 'associations' in parserState
      ? parserState.associations
      : null
  let current: Object3D | null = object
  while (current && parentChain.length < 4) {
    parentChain.push(current.name || current.type)
    associationChain.push(
      summarizeAssociation(associations?.get(current) ?? null)
    )
    current = current.parent
  }

  const metadata = getPickedObjectMetadata(object, parserState)
  const userDataEntries = Object.entries(object.userData ?? {}).filter(
    ([, value]) =>
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
  )

  return {
    type: object.type,
    name: object.name || null,
    parentChain,
    association: metadata.association,
    associationChain,
    primitiveExtras: metadata.primitiveExtras,
    meshExtras: metadata.meshExtras,
    nodeExtras: metadata.nodeExtras,
    nodeIndex: metadata.nodeIndex,
    kittycadPrimitiveExtras: metadata.kittycadPrimitiveExtras,
    kittycadEdgeExtras: metadata.kittycadEdgeExtras,
    kittycadRegionExtras: metadata.kittycadRegionExtras,
    resolvedSelectionEntity,
    userData: Object.fromEntries(userDataEntries),
    userDataKeys: Object.keys(object.userData ?? {}),
  }
}

export const LocalWebGPUScene = ({
  backgroundColor,
  onVisibilityChange,
  onExportReady,
  forceHide = false,
  commandProxyEnabled = true,
}: {
  backgroundColor: string
  onVisibilityChange: (isVisible: boolean) => void
  onExportReady?: (exportScene: (() => Promise<void>) | null) => void
  forceHide?: boolean
  commandProxyEnabled?: boolean
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { kclManager } = useSingletons()
  const forceHideRef = useRef(forceHide)
  const commandProxyEnabledRef = useRef(commandProxyEnabled)
  const isVisibleRef = useRef(false)

  useEffect(() => {
    forceHideRef.current = forceHide
    const container = containerRef.current
    if (!container) {
      return
    }

    container.style.opacity =
      isVisibleRef.current && !forceHideRef.current ? '1' : '0'
  }, [forceHide])

  useEffect(() => {
    commandProxyEnabledRef.current = commandProxyEnabled
  }, [commandProxyEnabled])

  useEffect(() => {
    if (!shouldEnableLocalWebGpuPreview()) {
      logLocalWebGpuPreview('preview disabled by localStorage flag')
      onVisibilityChange(false)
      return
    }

    const container = containerRef.current
    if (!container) {
      logLocalWebGpuPreview('preview container missing during mount')
      return
    }

    logLocalWebGpuPreview('mounting preview component')
    container.style.opacity = '0'

    let disposed = false
    let animationFrameId = -1
    let resizeObserver: ResizeObserver | null = null
    let currentModel: Object3D | null = null
    let currentTrimResources: WebGpuTrimResources | null = null
    let previewLighting: PreviewLighting | null = null
    let currentRefreshId = 0
    let isVisible = false
    let pendingRefreshRequest = false
    let refreshModel: (() => Promise<void>) | null = null
    let previewCamera: PerspectiveCamera | OrthographicCamera | null = null
    const previewTarget = new Vector3()
    let hoveredObject: Object3D | null = null
    let selectedObjects = new Set<Object3D>()
    let selectionEntityIdToObject = new Map<string, Object3D>()
    let parserState: GltfParserState | RenderPacketParserState | null = null
    let activeSketchModePlane: GetSketchModePlane | null = null
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    let requestRender: (() => void) | null = null

    const getResolvedSelectionEntity = (object: Object3D | null) => {
      if (!object) {
        return null
      }

      const metadata = getPickedObjectMetadata(object, parserState)
      const extras = isKittycadPrimitiveExtras(metadata.kittycadPrimitiveExtras)
        ? metadata.kittycadPrimitiveExtras
        : null
      if (extras) {
        return resolveSelectionEntityFromPrimitiveExtras(
          extras,
          kclManager.artifactGraph
        )
      }

      const edgeExtras = isKittycadEdgeExtras(metadata.kittycadEdgeExtras)
        ? metadata.kittycadEdgeExtras
        : null
      if (edgeExtras) {
        return resolveSelectionEntityFromEdgeExtras(
          edgeExtras,
          kclManager.artifactGraph
        )
      }

      const sketchExtras = isKittycadSketchExtras(metadata.kittycadSketchExtras)
        ? metadata.kittycadSketchExtras
        : null
      if (sketchExtras) {
        return resolveSelectionEntityFromSketchExtras(
          sketchExtras,
          kclManager.artifactGraph
        )
      }

      const regionExtras = isKittycadRegionExtras(metadata.kittycadRegionExtras)
        ? metadata.kittycadRegionExtras
        : null
      if (regionExtras) {
        return resolveSelectionEntityFromRegionExtras(regionExtras)
      }

      return null
    }

    const setVisible = (nextVisible: boolean) => {
      if (isVisible === nextVisible) {
        return
      }

      isVisible = nextVisible
      isVisibleRef.current = nextVisible
      container.style.opacity = nextVisible && !forceHideRef.current ? '1' : '0'
      logLocalWebGpuPreview('preview visibility changed', {
        isVisible: nextVisible,
      })
      onVisibilityChange(nextVisible)
      requestRender?.()
    }

    const convertedSharedPosition = new Vector3()
    const convertedSharedTarget = new Vector3()
    const convertedSharedUp = new Vector3()
    const syncPreviewCameraFromShared = () => {
      const sharedCamera = kclManager.sceneInfra.camControls.camera
      const sharedTarget = kclManager.sceneInfra.camControls.target
      if (!previewCamera) {
        return
      }

      convertedSharedPosition.copy(
        convertEngineWorldVectorToGltfWorld(
          sharedCamera.position,
          ENGINE_MILLIMETERS_TO_GLTF_METERS
        )
      )
      convertedSharedTarget.copy(
        convertEngineWorldVectorToGltfWorld(
          sharedTarget,
          ENGINE_MILLIMETERS_TO_GLTF_METERS
        )
      )
      convertedSharedUp.copy(
        convertEngineWorldVectorToGltfWorld(sharedCamera.up)
      )

      if (
        sharedCamera instanceof PerspectiveCamera &&
        !(previewCamera instanceof PerspectiveCamera)
      ) {
        previewCamera = new PerspectiveCamera()
      } else if (
        sharedCamera instanceof OrthographicCamera &&
        !(previewCamera instanceof OrthographicCamera)
      ) {
        previewCamera = new OrthographicCamera()
      }

      previewCamera.layers.mask = sharedCamera.layers.mask
      previewCamera.position.copy(convertedSharedPosition)
      previewCamera.up.copy(convertedSharedUp)
      previewCamera.near = Math.max(
        sharedCamera.near * ENGINE_MILLIMETERS_TO_GLTF_METERS,
        0.0001
      )
      previewCamera.far = Math.max(
        sharedCamera.far * ENGINE_MILLIMETERS_TO_GLTF_METERS,
        previewCamera.near + 0.0001
      )
      previewTarget.copy(convertedSharedTarget)

      if (
        sharedCamera instanceof PerspectiveCamera &&
        previewCamera instanceof PerspectiveCamera
      ) {
        previewCamera.fov = sharedCamera.fov
        previewCamera.aspect =
          Math.max(container.clientWidth, 1) /
          Math.max(container.clientHeight, 1)
      } else if (
        sharedCamera instanceof OrthographicCamera &&
        previewCamera instanceof OrthographicCamera
      ) {
        previewCamera.left =
          sharedCamera.left * ENGINE_MILLIMETERS_TO_GLTF_METERS
        previewCamera.right =
          sharedCamera.right * ENGINE_MILLIMETERS_TO_GLTF_METERS
        previewCamera.top = sharedCamera.top * ENGINE_MILLIMETERS_TO_GLTF_METERS
        previewCamera.bottom =
          sharedCamera.bottom * ENGINE_MILLIMETERS_TO_GLTF_METERS
        previewCamera.zoom = sharedCamera.zoom
      }

      previewCamera.lookAt(previewTarget)
      previewCamera.updateProjectionMatrix()
      previewCamera.updateMatrixWorld(true)
      if (previewLighting) {
        updatePreviewLighting(previewLighting, previewCamera, previewTarget)
      }
      requestRender?.()
    }

    const requestRefresh = () => {
      if (refreshModel) {
        void refreshModel()
        return
      }

      pendingRefreshRequest = true
      logLocalWebGpuPreview('refresh requested before renderer initialization')
    }

    const onExecutionDone = (event: Event) => {
      const { detail } = event as CustomEvent<KclExecutionDoneDetail>
      logLocalWebGpuPreview('received execution-done event', detail)
      if (!detail.successful) {
        return
      }

      requestRefresh()
    }

    const applyObjectState = (object: Object3D | null) => {
      if (!object) {
        return
      }

      const mode = selectedObjects.has(object)
        ? 'selected'
        : object === hoveredObject
          ? 'hover'
          : 'base'
      if (object instanceof Mesh) {
        setMeshHighlight(object, mode)
      } else if (object instanceof Line) {
        setLineHighlight(object, mode)
      }
      requestRender?.()
    }

    const clearHover = () => {
      if (!hoveredObject) {
        return
      }

      const previousHoveredObject = hoveredObject
      hoveredObject = null
      applyObjectState(previousHoveredObject)
    }

    const pickRenderableFromWindowCoordinates = ({
      x,
      y,
      streamWidth,
      streamHeight,
    }: {
      x: number
      y: number
      streamWidth: number
      streamHeight: number
    }) => {
      if (
        !isVisible ||
        !previewCamera ||
        !currentModel ||
        streamWidth <= 0 ||
        streamHeight <= 0
      ) {
        return null
      }

      pointer.x = (x / streamWidth) * 2 - 1
      pointer.y = -(y / streamHeight) * 2 + 1
      raycaster.setFromCamera(pointer, previewCamera)

      raycaster.params.Line = {
        ...(raycaster.params.Line ?? {}),
        // Keep edge picking tight so faces remain easy to select.
        threshold: EDGE_RAYCAST_THRESHOLD_GLTF_METERS,
      }

      return raycaster
        .intersectObject(currentModel, true)
        .find((intersection) => {
          if (intersection.object instanceof Line) {
            return true
          }

          if (!(intersection.object instanceof Mesh)) {
            return false
          }

          if (!WEBGPU_TRIMMING_ENABLED) {
            return true
          }

          const primitive =
            parserState && 'primitiveByObject' in parserState
              ? (parserState.primitiveByObject.get(intersection.object) ?? null)
              : null

          return isUvInsideTrimLoops(
            intersection.uv
              ? { x: intersection.uv.x, y: intersection.uv.y }
              : null,
            primitive?.trimLoops ?? null
          )
        })
    }

    const updateHoverFromIntersection = (
      intersection:
        | {
            distance?: number
            point?: Vector3
            object?: Object3D
          }
        | null
        | undefined
    ) => {
      const nextHoveredObject = intersection?.object ?? null
      if (nextHoveredObject === hoveredObject) {
        return
      }

      const previousHoveredObject = hoveredObject
      hoveredObject = null
      applyObjectState(previousHoveredObject)
      if (!nextHoveredObject) {
        return
      }

      hoveredObject = nextHoveredObject
      applyObjectState(hoveredObject)
      const resolvedSelectionEntity =
        getResolvedSelectionEntity(nextHoveredObject)
      logLocalWebGpuPreview('local hover changed', {
        distance: intersection?.distance,
        point: intersection?.point?.toArray(),
        ...summarizePickedObject(
          nextHoveredObject,
          parserState,
          resolvedSelectionEntity
        ),
      })
    }

    const updateSelectedMeshes = ({
      nextSelectedMeshes,
      selectionSummary,
    }: {
      nextSelectedMeshes: Set<Object3D>
      selectionSummary: unknown
    }) => {
      if (
        nextSelectedMeshes.size === selectedObjects.size &&
        [...nextSelectedMeshes].every((mesh) => selectedObjects.has(mesh))
      ) {
        return
      }

      const previousSelectedMeshes = [...selectedObjects]
      selectedObjects = nextSelectedMeshes
      previousSelectedMeshes.forEach(applyObjectState)
      applyObjectState(hoveredObject)
      selectedObjects.forEach(applyObjectState)
      ;(
        window as typeof window & { __WEBGPU_POC_SELECTION__?: unknown }
      ).__WEBGPU_POC_SELECTION__ = selectionSummary

      logLocalWebGpuPreview('local selection changed', {
        selection: selectionSummary,
      })
    }

    kclManager.addEventListener(KclManagerEvents.ExecutionDone, onExecutionDone)

    const initialize = async () => {
      logLocalWebGpuPreview('initializing preview renderer')
      const [{ default: WebGPURenderer }, { createWebGpuTrimResources }] =
        await Promise.all([
          import('three/src/renderers/webgpu/WebGPURenderer.js'),
          import('@src/clientSideScene/webgpuTrim'),
        ])

      if (disposed) {
        logLocalWebGpuPreview(
          'preview disposed before initialization completed'
        )
        return
      }

      const hasNavigatorGpu =
        typeof navigator !== 'undefined' && !!navigator.gpu
      logLocalWebGpuPreview('navigator.gpu availability checked', {
        isSecureContext: window.isSecureContext,
        hasNavigatorGpu,
      })
      if (!hasNavigatorGpu) {
        setVisible(false)
        return
      }

      const adapter = await navigator.gpu.requestAdapter()
      logLocalWebGpuPreview('default adapter request completed', {
        adapterFound: Boolean(adapter),
        adapterInfo: adapter?.info
          ? {
              vendor: adapter.info.vendor,
              architecture: adapter.info.architecture,
              description: adapter.info.description,
            }
          : null,
      })
      if (!adapter) {
        const [highPerformanceAdapter, lowPowerAdapter] = await Promise.all([
          navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }),
          navigator.gpu.requestAdapter({ powerPreference: 'low-power' }),
        ])
        logLocalWebGpuPreview('fallback adapter requests completed', {
          highPerformanceAdapterFound: Boolean(highPerformanceAdapter),
          lowPowerAdapterFound: Boolean(lowPowerAdapter),
        })
        setVisible(false)
        return
      }

      let device: GPUDevice
      try {
        device = await adapter.requestDevice()
      } catch (error) {
        logLocalWebGpuPreview('device request failed', {
          error,
          adapterInfo: adapter.info
            ? {
                vendor: adapter.info.vendor,
                architecture: adapter.info.architecture,
                description: adapter.info.description,
              }
            : null,
          adapterFeatures: Array.from(adapter.features.values()),
        })
        reportRejection(error)
        setVisible(false)
        return
      }
      logLocalWebGpuPreview('device request completed', {
        label: device.label,
      })

      logLocalWebGpuPreview('creating WebGPU renderer')
      const renderer = new WebGPURenderer({
        antialias: true,
        alpha: false,
        device,
      })
      logLocalWebGpuPreview('renderer created')
      logLocalWebGpuPreview('initializing renderer backend')
      await renderer.init()
      if (disposed) {
        logLocalWebGpuPreview(
          'preview disposed before renderer backend initialization completed'
        )
        renderer.dispose()
        return
      }
      logLocalWebGpuPreview('renderer backend initialized')
      renderer.toneMapping = NeutralToneMapping
      renderer.toneMappingExposure = 1
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.domElement.className =
        'absolute inset-0 z-20 h-full w-full pointer-events-none'
      container.appendChild(renderer.domElement)
      logLocalWebGpuPreview('renderer attached to DOM', {
        width: container.clientWidth,
        height: container.clientHeight,
      })

      const scene = new Scene()
      scene.background = new Color(backgroundColor)
      const envMapLoader = new EnvMapLoader(renderer, device)
      const hdrEnvMapUrl = HDR_ENV_MAP_URL?.trim()
      if (hdrEnvMapUrl) {
        try {
          await envMapLoader.loadHdr(scene, hdrEnvMapUrl)
          logLocalWebGpuPreview('HDR environment loaded', {
            url: hdrEnvMapUrl,
          })
        } catch (error) {
          logLocalWebGpuPreview(
            'HDR environment unavailable; using procedural fallback',
            { url: hdrEnvMapUrl, error }
          )
          await envMapLoader.loadDefault(scene)
        }
      } else {
        await envMapLoader.loadDefault(scene)
      }
      if (disposed) {
        envMapLoader.dispose()
        renderer.dispose()
        return
      }
      previewLighting = createPreviewLighting(scene)

      const exportCurrentScene = async () => {
        if (!currentModel) {
          logLocalWebGpuPreview('GLB export skipped; no current model')
          return
        }

        const modelToExport = currentModel
        const trimStates = new Map<Object3D, unknown>()
        modelToExport.traverse((object) => {
          if ('kittycadTrimState' in object.userData) {
            trimStates.set(object, object.userData.kittycadTrimState)
            delete object.userData.kittycadTrimState
          }
        })

        try {
          modelToExport.updateMatrixWorld(true)
          const { GLTFExporter } = await import(
            'three/examples/jsm/exporters/GLTFExporter.js'
          )
          const exporter = new GLTFExporter()
          const result = await exporter.parseAsync(modelToExport, {
            binary: true,
            onlyVisible: true,
          })
          if (!(result instanceof ArrayBuffer)) {
            throw new Error('GLTFExporter did not produce a binary GLB')
          }

          const blob = new Blob([result], { type: 'model/gltf-binary' })
          const downloadUrl = URL.createObjectURL(blob)
          const downloadLink = document.createElement('a')
          const timestamp = new Date().toISOString().replaceAll(':', '-')
          downloadLink.href = downloadUrl
          downloadLink.download = `render-packet-scene-${timestamp}.glb`
          downloadLink.style.display = 'none'
          document.body.appendChild(downloadLink)
          downloadLink.click()
          downloadLink.remove()
          window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)

          logLocalWebGpuPreview('current Three.js scene exported as GLB', {
            bytes: result.byteLength,
            filename: downloadLink.download,
          })
        } finally {
          trimStates.forEach((trimState, object) => {
            object.userData.kittycadTrimState = trimState
          })
        }
      }
      onExportReady?.(exportCurrentScene)

      const sharedCamera = kclManager.sceneInfra.camControls.camera
      const sharedTarget = kclManager.sceneInfra.camControls.target
      if (sharedCamera instanceof PerspectiveCamera) {
        previewCamera = sharedCamera.clone()
        previewCamera.aspect =
          Math.max(container.clientWidth, 1) /
          Math.max(container.clientHeight, 1)
      } else if (sharedCamera instanceof OrthographicCamera) {
        previewCamera = sharedCamera.clone()
      } else {
        previewCamera = new PerspectiveCamera(45, 1, 0.01, 1000)
      }
      previewCamera.layers.mask = sharedCamera.layers.mask
      previewTarget.copy(sharedTarget)
      logLocalWebGpuPreview('preview camera created', {
        cameraType: previewCamera.type,
        cameraPosition: previewCamera.position.toArray(),
        target: previewTarget.toArray(),
        layerMask: previewCamera.layers.mask,
      })
      const unregisterSharedCameraListener =
        kclManager.sceneInfra.camControls.cameraChange.add(() => {
          syncPreviewCameraFromShared()
        })

      requestRender = () => {
        if (disposed || !previewCamera || animationFrameId !== -1) {
          return
        }

        animationFrameId = requestAnimationFrame(() => {
          animationFrameId = -1
          if (disposed || !previewCamera) {
            return
          }

          renderer.render(scene, previewCamera)
        })
      }

      const resize = () => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (width === 0 || height === 0) {
          return
        }
        renderer.setSize(width, height, false)
        if (previewCamera instanceof PerspectiveCamera) {
          previewCamera.aspect = width / height
          previewCamera.updateProjectionMatrix()
        } else {
          syncPreviewCameraFromShared()
        }
        requestRender?.()
      }

      const unregisterLocalSelectionProvider =
        registerLocalSelectionCommandProvider({
          isActive: () => isVisible,
          handleCommand: async (command, { streamDimensions }) => {
            if (command.type !== 'modeling_cmd_req') {
              return null
            }

            const { cmd, cmd_id } = command
            switch (cmd.type) {
              case 'highlight_set_entity': {
                if (!commandProxyEnabledRef.current) {
                  return null
                }
                const intersection = pickRenderableFromWindowCoordinates({
                  x: cmd.selected_at_window.x,
                  y: cmd.selected_at_window.y,
                  streamWidth: streamDimensions.width,
                  streamHeight: streamDimensions.height,
                })
                updateHoverFromIntersection(intersection)
                const object = intersection?.object ?? null
                const resolvedSelectionEntity =
                  getResolvedSelectionEntity(object)
                return {
                  unreliableModelingResponse: {
                    type: 'highlight_set_entity',
                    data: {
                      entity_id: resolvedSelectionEntity?.entityId ?? '',
                      sequence: 'sequence' in cmd ? cmd.sequence : undefined,
                    },
                  },
                }
              }
              case 'select_with_point': {
                if (!commandProxyEnabledRef.current) {
                  return null
                }
                const intersection = pickRenderableFromWindowCoordinates({
                  x: cmd.selected_at_window.x,
                  y: cmd.selected_at_window.y,
                  streamWidth: streamDimensions.width,
                  streamHeight: streamDimensions.height,
                })
                const object = intersection?.object ?? null
                const resolvedSelectionEntity =
                  getResolvedSelectionEntity(object)
                const modelingResponse = {
                  type: 'select_with_point',
                  data: {
                    entity_id: resolvedSelectionEntity?.entityId ?? '',
                  },
                }
                return {
                  modelingResponse,
                  websocketResponse: {
                    success: true,
                    request_id: cmd_id,
                    resp: {
                      type: 'modeling',
                      data: {
                        modeling_response: modelingResponse,
                      },
                    },
                  } as never,
                }
              }
              case 'entity_get_parent_id': {
                if (!commandProxyEnabledRef.current) {
                  return null
                }
                const object =
                  selectionEntityIdToObject.get(cmd.entity_id) ?? null
                const metadata = object
                  ? getPickedObjectMetadata(object, parserState)
                  : null
                const primitiveExtras = isKittycadPrimitiveExtras(
                  metadata?.kittycadPrimitiveExtras
                )
                  ? metadata.kittycadPrimitiveExtras
                  : null
                const edgeExtras = isKittycadEdgeExtras(
                  metadata?.kittycadEdgeExtras
                )
                  ? metadata.kittycadEdgeExtras
                  : null
                const resolvedSelectionEntity =
                  getResolvedSelectionEntity(object)
                const modelingResponse = {
                  type: 'entity_get_parent_id',
                  data: {
                    entity_id:
                      resolvedSelectionEntity?.parentEntityId ??
                      primitiveExtras?.object_id ??
                      edgeExtras?.object_id ??
                      '',
                  },
                }
                return {
                  websocketResponse: {
                    success: true,
                    request_id: cmd_id,
                    resp: {
                      type: 'modeling',
                      data: {
                        modeling_response: modelingResponse,
                      },
                    },
                  } as never,
                }
              }
              case 'entity_get_primitive_index': {
                if (!commandProxyEnabledRef.current) {
                  return null
                }
                const object =
                  selectionEntityIdToObject.get(cmd.entity_id) ?? null
                const metadata = object
                  ? getPickedObjectMetadata(object, parserState)
                  : null
                const primitiveExtras = isKittycadPrimitiveExtras(
                  metadata?.kittycadPrimitiveExtras
                )
                  ? metadata.kittycadPrimitiveExtras
                  : null
                const edgeExtras = isKittycadEdgeExtras(
                  metadata?.kittycadEdgeExtras
                )
                  ? metadata.kittycadEdgeExtras
                  : null
                const resolvedSelectionEntity =
                  getResolvedSelectionEntity(object)
                const modelingResponse = {
                  type: 'entity_get_primitive_index',
                  data: {
                    entity_type: resolvedSelectionEntity?.entityType ?? 'face',
                    primitive_index:
                      resolvedSelectionEntity?.primitiveIndex ??
                      primitiveExtras?.primitive_index ??
                      edgeExtras?.edge_index ??
                      -1,
                  },
                }
                return {
                  websocketResponse: {
                    success: true,
                    request_id: cmd_id,
                    resp: {
                      type: 'modeling',
                      data: {
                        modeling_response: modelingResponse,
                      },
                    },
                  } as never,
                }
              }
              case 'region_get_query_point': {
                if (!commandProxyEnabledRef.current) {
                  return null
                }
                const object =
                  selectionEntityIdToObject.get(cmd.region_id) ?? null
                const metadata = object
                  ? getPickedObjectMetadata(object, parserState)
                  : null
                const regionExtras = isKittycadRegionExtras(
                  metadata?.kittycadRegionExtras
                )
                  ? metadata.kittycadRegionExtras
                  : null
                const modelingResponse = {
                  type: 'region_get_query_point',
                  data: {
                    query_point: regionExtras?.query_point ?? { x: 0, y: 0 },
                  },
                }
                return {
                  websocketResponse: {
                    success: true,
                    request_id: cmd_id,
                    resp: {
                      type: 'modeling',
                      data: {
                        modeling_response: modelingResponse,
                      },
                    },
                  } as never,
                }
              }
              case 'select_clear': {
                if (!commandProxyEnabledRef.current) {
                  return null
                }
                updateSelectedMeshes({
                  nextSelectedMeshes: new Set<Object3D>(),
                  selectionSummary: null,
                })
                return { websocketResponse: null }
              }
              case 'select_add': {
                if (!commandProxyEnabledRef.current) {
                  return null
                }
                const nextSelectedMeshes = new Set<Object3D>()
                for (const entityId of cmd.entities) {
                  const object = selectionEntityIdToObject.get(entityId)
                  if (object) {
                    nextSelectedMeshes.add(object)
                  }
                }
                const firstSelectedMesh =
                  nextSelectedMeshes.values().next().value ?? null
                const resolvedSelectionEntity =
                  getResolvedSelectionEntity(firstSelectedMesh)
                const selectionSummary = firstSelectedMesh
                  ? summarizePickedObject(
                      firstSelectedMesh,
                      parserState,
                      resolvedSelectionEntity
                    )
                  : null
                updateSelectedMeshes({
                  nextSelectedMeshes,
                  selectionSummary,
                })
                return { websocketResponse: null }
              }
              case 'enable_sketch_mode': {
                const mesh =
                  selectionEntityIdToObject.get(cmd.entity_id) ?? null
                if (!mesh) {
                  logLocalWebGpuPreview(
                    'local sketch mode plane mesh missing',
                    {
                      entityId: cmd.entity_id,
                      knownSelectionEntityIds: Array.from(
                        selectionEntityIdToObject.keys()
                      ).slice(0, 20),
                    }
                  )
                  return null
                }
                if (!(mesh instanceof Mesh)) {
                  logLocalWebGpuPreview(
                    'local sketch mode plane derivation failed',
                    {
                      entityId: cmd.entity_id,
                      meshName: mesh.name || null,
                      meshType: mesh.type,
                      reason: 'selected entity is not a face mesh',
                    }
                  )
                  return null
                }
                activeSketchModePlane = deriveSketchModePlaneFromMesh(
                  mesh,
                  kclManager.sceneInfra.camControls.camera
                )
                if (!activeSketchModePlane) {
                  logLocalWebGpuPreview(
                    'local sketch mode plane derivation failed',
                    {
                      entityId: cmd.entity_id,
                      meshName: mesh.name || null,
                      meshType: mesh.type,
                      metadata: summarizePickedObject(
                        mesh,
                        parserState,
                        getResolvedSelectionEntity(mesh)
                      ),
                    }
                  )
                  return null
                }
                logLocalWebGpuPreview('local sketch mode plane prepared', {
                  entityId: cmd.entity_id,
                  meshName: mesh.name || null,
                  meshDebug: {
                    ...summarizeMeshWorldGeometry(mesh),
                    metadata: summarizePickedObject(
                      mesh,
                      parserState,
                      getResolvedSelectionEntity(mesh)
                    ),
                  },
                  plane: summarizeSketchModePlane(activeSketchModePlane),
                })
                const modelingResponse = {
                  type: 'enable_sketch_mode',
                  data: {},
                }
                return {
                  modelingResponse,
                  websocketResponse: {
                    success: true,
                    request_id: cmd_id,
                    resp: {
                      type: 'modeling',
                      data: {
                        modeling_response: modelingResponse,
                      },
                    },
                  } as never,
                }
              }
              case 'get_sketch_mode_plane': {
                if (!activeSketchModePlane) {
                  logLocalWebGpuPreview(
                    'local sketch mode plane missing for request'
                  )
                  return null
                }
                logLocalWebGpuPreview('local sketch mode plane requested', {
                  plane: summarizeSketchModePlane(activeSketchModePlane),
                })
                const modelingResponse = {
                  type: 'get_sketch_mode_plane',
                  data: activeSketchModePlane,
                }
                return {
                  modelingResponse,
                  websocketResponse: {
                    success: true,
                    request_id: cmd_id,
                    resp: {
                      type: 'modeling',
                      data: {
                        modeling_response: modelingResponse,
                      },
                    },
                  } as never,
                }
              }
              case 'sketch_mode_disable': {
                logLocalWebGpuPreview('local sketch mode disabled', {
                  plane: summarizeSketchModePlane(activeSketchModePlane),
                })
                activeSketchModePlane = null
                const modelingResponse = {
                  type: 'sketch_mode_disable',
                  data: {},
                }
                return {
                  modelingResponse,
                  websocketResponse: {
                    success: true,
                    request_id: cmd_id,
                    resp: {
                      type: 'modeling',
                      data: {
                        modeling_response: modelingResponse,
                      },
                    },
                  } as never,
                }
              }
              default:
                return null
            }
          },
        })

      resize()
      syncPreviewCameraFromShared()
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(container)

      const clearModel = () => {
        if (currentModel) {
          scene.remove(currentModel)
          disposeObject3D(currentModel)
          currentModel = null
        }

        currentTrimResources?.dispose(renderer)
        currentTrimResources = null
        selectionEntityIdToObject.clear()
        requestRender?.()
      }

      const hydrateCurrentModelMetadata = () => {
        if (!currentModel) {
          selectionEntityIdToObject.clear()
          return
        }

        selectionEntityIdToObject = new Map<string, Object3D>()
        currentModel.traverse((object) => {
          object.layers.mask = previewCamera?.layers.mask ?? object.layers.mask

          if (!(object instanceof Mesh) && !(object instanceof Line)) {
            return
          }

          const metadata = getPickedObjectMetadata(object, parserState)
          if (object instanceof Mesh && metadata.primitiveExtras) {
            object.userData.gltfPrimitiveExtras = metadata.primitiveExtras
          }
          if (object instanceof Mesh && metadata.kittycadPrimitiveExtras) {
            object.userData.kittycadPrimitiveExtras =
              metadata.kittycadPrimitiveExtras
            if (isKittycadPrimitiveExtras(metadata.kittycadPrimitiveExtras)) {
              const resolvedSelectionEntity =
                resolveSelectionEntityFromPrimitiveExtras(
                  metadata.kittycadPrimitiveExtras,
                  kclManager.artifactGraph
                )
              object.userData.kittycadSelectionEntityId =
                resolvedSelectionEntity.entityId
              object.userData.kittycadParentEntityId =
                resolvedSelectionEntity.parentEntityId
              object.userData.kittycadPrimitiveIndex =
                resolvedSelectionEntity.primitiveIndex
              selectionEntityIdToObject.set(
                resolvedSelectionEntity.entityId,
                object
              )
              selectionEntityIdToObject.set(
                metadata.kittycadPrimitiveExtras.face_id,
                object
              )
            }
          }
          if (object instanceof Line && metadata.kittycadEdgeExtras) {
            object.userData.kittycadEdgeExtras = metadata.kittycadEdgeExtras
            if (isKittycadEdgeExtras(metadata.kittycadEdgeExtras)) {
              const resolvedSelectionEntity =
                resolveSelectionEntityFromEdgeExtras(
                  metadata.kittycadEdgeExtras,
                  kclManager.artifactGraph
                )
              object.userData.kittycadSelectionEntityId =
                resolvedSelectionEntity.entityId
              object.userData.kittycadParentEntityId =
                resolvedSelectionEntity.parentEntityId
              object.userData.kittycadPrimitiveIndex =
                resolvedSelectionEntity.primitiveIndex
              selectionEntityIdToObject.set(
                resolvedSelectionEntity.entityId,
                object
              )
              selectionEntityIdToObject.set(
                metadata.kittycadEdgeExtras.edge_id,
                object
              )
            }
          }
          if (object instanceof Line && metadata.kittycadSketchExtras) {
            object.userData.kittycadSketchExtras = metadata.kittycadSketchExtras
            if (isKittycadSketchExtras(metadata.kittycadSketchExtras)) {
              const resolvedSelectionEntity =
                resolveSelectionEntityFromSketchExtras(
                  metadata.kittycadSketchExtras,
                  kclManager.artifactGraph
                )
              if (resolvedSelectionEntity) {
                object.userData.kittycadSelectionEntityId =
                  resolvedSelectionEntity.entityId
                object.userData.kittycadParentEntityId =
                  resolvedSelectionEntity.parentEntityId
                object.userData.kittycadPrimitiveIndex =
                  resolvedSelectionEntity.primitiveIndex
                selectionEntityIdToObject.set(
                  resolvedSelectionEntity.entityId,
                  object
                )
              }
            }
          }
          if (object instanceof Mesh && metadata.kittycadRegionExtras) {
            object.userData.kittycadRegionExtras = metadata.kittycadRegionExtras
            if (isKittycadRegionExtras(metadata.kittycadRegionExtras)) {
              const resolvedSelectionEntity =
                resolveSelectionEntityFromRegionExtras(
                  metadata.kittycadRegionExtras
                )
              object.userData.kittycadSelectionEntityId =
                resolvedSelectionEntity.entityId
              object.userData.kittycadParentEntityId =
                resolvedSelectionEntity.parentEntityId
              object.userData.kittycadPrimitiveIndex =
                resolvedSelectionEntity.primitiveIndex
              selectionEntityIdToObject.set(
                resolvedSelectionEntity.entityId,
                object
              )
            }
          }
        })
      }
      requestRender()
      logLocalWebGpuPreview('render mode set to on-demand')

      refreshModel = async () => {
        const refreshId = ++currentRefreshId
        logLocalWebGpuPreview('starting model refresh', {
          refreshId,
          hasLastSuccessfulCode: Boolean(kclManager.lastSuccessfulCode),
        })
        await kclManager.rustContext.waitForAllEngineModelingCommands()

        if (disposed || refreshId !== currentRefreshId) {
          logLocalWebGpuPreview('dropping stale refresh after engine wait', {
            disposed,
            refreshId,
            currentRefreshId,
          })
          return
        }

        const exportSettings = jsAppSettings(
          kclManager.rustContext.settingsActor
        )
        let renderPacket: RenderPacket | undefined
        const maxRenderPacketAttempts = 3
        for (let attempt = 1; attempt <= maxRenderPacketAttempts; attempt++) {
          renderPacket =
            await kclManager.rustContext.exportRenderPacket(exportSettings)

          if (disposed || refreshId !== currentRefreshId) {
            logLocalWebGpuPreview('dropping stale refresh result', {
              disposed,
              refreshId,
              currentRefreshId,
            })
            return
          }

          if (
            renderPacket &&
            (renderPacket.primitives.length > 0 ||
              renderPacket.edges.length > 0)
          ) {
            break
          }

          if (attempt < maxRenderPacketAttempts) {
            logLocalWebGpuPreview('render packet unavailable, retrying', {
              refreshId,
              attempt,
              maxRenderPacketAttempts,
            })
            await new Promise((resolve) => window.setTimeout(resolve, 150))
          }
        }

        if (disposed || refreshId !== currentRefreshId) {
          logLocalWebGpuPreview('dropping stale refresh result', {
            disposed,
            refreshId,
            currentRefreshId,
          })
          return
        }

        if (
          renderPacket &&
          (renderPacket.primitives.length > 0 || renderPacket.edges.length > 0)
        ) {
          clearModel()
          currentTrimResources = WEBGPU_TRIMMING_ENABLED
            ? createWebGpuTrimResources(renderPacket.primitives)
            : null
          const packetModel = buildRenderPacketModel(
            renderPacket,
            currentTrimResources
          )
          const bodyMaterialById = new Map(
            (renderPacket.bodyMaterials ?? []).map((material) => [
              material.bodyId,
              material,
            ])
          )
          currentModel = packetModel.model
          parserState = packetModel.parserState
          hydrateCurrentModelMetadata()
          scene.add(currentModel)
          const loadedModelStats = prepareLoadedModelForPreview(
            currentModel,
            currentTrimResources,
            bodyMaterialById
          )
          if (loadedModelStats.meshCount === 0) {
            clearModel()
            setVisible(false)
            return
          }
          logLocalWebGpuPreview('render packet applied to scene', {
            refreshId,
            primitiveCount: renderPacket.primitives.length,
            edgeCount: renderPacket.edges.length,
            bodyMaterialCount: bodyMaterialById.size,
            meshCount: loadedModelStats.meshCount,
            trimmingEnabled: WEBGPU_TRIMMING_ENABLED,
            trimTriangleCount: currentTrimResources?.triangleCount ?? 0,
          })
          syncPreviewCameraFromShared()
          setVisible(true)
          requestRender?.()
          return
        }

        logLocalWebGpuPreview(
          'render packet unavailable; keeping stream active',
          {
            refreshId,
          }
        )
        clearModel()
        setVisible(false)
        requestRender?.()
      }

      if (kclManager.lastSuccessfulCode) {
        await refreshModel()
      } else if (pendingRefreshRequest) {
        pendingRefreshRequest = false
        await refreshModel()
      }

      return () => {
        logLocalWebGpuPreview('cleaning up preview renderer')
        onExportReady?.(null)
        kclManager.removeEventListener(
          KclManagerEvents.ExecutionDone,
          onExecutionDone
        )
        unregisterLocalSelectionProvider()
        clearHover()
        const previousSelectedObjects = [...selectedObjects]
        selectedObjects.clear()
        previousSelectedObjects.forEach(applyObjectState)
        clearModel()
        resizeObserver?.disconnect()
        unregisterSharedCameraListener()
        if (animationFrameId !== -1) {
          cancelAnimationFrame(animationFrameId)
        }
        requestRender = null
        previewLighting = null
        envMapLoader.dispose()
        renderer.dispose()
      }
    }

    let cleanup: (() => void) | undefined

    void initialize()
      .then((returnedCleanup) => {
        cleanup = returnedCleanup
      })
      .catch((error) => {
        logLocalWebGpuPreview('preview initialization failed', { error })
        console.error('[LocalWebGPUScene] preview initialization failed', error)
        reportRejection(error)
      })

    return () => {
      disposed = true
      logLocalWebGpuPreview('effect cleanup')
      setVisible(false)
      refreshModel = null
      onExportReady?.(null)
      cleanup?.()
    }
  }, [backgroundColor, kclManager, onExportReady, onVisibilityChange])

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-20 h-full w-full transition-opacity duration-200 opacity-0"
    />
  )
}

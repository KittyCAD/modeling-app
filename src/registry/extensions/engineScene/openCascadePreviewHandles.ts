import type {
  Command,
  KclCommandValue,
  OpenCascadePreviewHandleConfig,
  OpenCascadePreviewHandleState,
} from '@src/lib/commandTypes'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import {
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type Camera,
  type Intersection,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

export const OPEN_CASCADE_PREVIEW_HANDLE_ROOT =
  'OPEN_CASCADE_PREVIEW_HANDLE_ROOT'

const HANDLE_LENGTH_PX = 72
const HANDLE_HEAD_RADIUS_PX = 7
const HANDLE_HEAD_LENGTH_PX = 18
const HANDLE_HIT_RADIUS_PX = 16
const HANDLE_LABEL_OFFSET_PX = 22
const HANDLE_STEM_WIDTH_PX = 4
const DEBUG_HANDLE_COLOR = 0xff00ff

export type OpenCascadePreviewHandleUserData = {
  openCascadePreviewHandle: true
  argumentName: string
  kind: OpenCascadePreviewHandleConfig['kind']
  axis: [number, number, number]
  min?: number
}

export type OpenCascadePreviewHandleDragState = {
  handle: OpenCascadePreviewHandleUserData
  object: Object3D
  startClient: Vector2
  startValue: number
  screenAxis: Vector2
  sceneScale: number
}

export function rebuildOpenCascadePreviewHandleRoot({
  root,
  previewRoot,
  command,
  context,
  handleState,
  camera,
  resolvedTheme,
  getClientSceneScaleFactor,
}: {
  root: Group
  previewRoot: Group
  command: Command | undefined
  context: CommandBarContext
  handleState?: OpenCascadePreviewHandleState
  camera: Camera
  resolvedTheme: 'light' | 'dark'
  getClientSceneScaleFactor(target?: Mesh | Group | null): number
}) {
  disposeOpenCascadePreviewHandles(root)
  const args = previewHandleArgs(context, handleState)
  const configs = visiblePreviewHandleConfigs(command, args, handleState)
  if (configs.length === 0 || previewRoot.children.length === 0) {
    return
  }

  const bounds = new Box3().setFromObject(previewRoot)
  if (bounds.isEmpty()) {
    return
  }

  const center = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const themeHandleColor = resolvedTheme === 'dark' ? 0xf5f0e8 : 0x141414

  configs.forEach((config, index) => {
    const axis = axisForConfig(
      config,
      args,
      fallbackAxisForConfig(config, size)
    )
    if (config.direction === 'negative') {
      axis.multiplyScalar(-1)
    }
    const anchor = anchorForHandle(config, center, size, axis, index)
    const currentValue = numericArgumentValue(args[config.argumentName])
    const handle = makePreviewHandle({
      config,
      axis,
      anchor,
      label: config.label || config.argumentName,
      value: currentValue,
      color: config.color ?? themeHandleColor,
    })
    root.add(handle)
    updatePreviewHandleScale(handle, getClientSceneScaleFactor)
    orientLabelToCamera(handle, camera)
  })
}

export function rebuildOpenCascadePreviewHandleDebugRoot({
  root,
  previewRoot,
  camera,
  getClientSceneScaleFactor,
}: {
  root: Group
  previewRoot: Group
  camera: Camera
  getClientSceneScaleFactor(target?: Mesh | Group | null): number
}) {
  rebuildOpenCascadePreviewHandleRoot({
    root,
    previewRoot,
    command: undefined,
    context: {
      argumentsToSubmit: {},
      previewArgumentsToSubmit: {},
    } as CommandBarContext,
    handleState: {
      handles: [
        {
          kind: 'linearDistance',
          argumentName: 'length',
          label: 'DEBUG',
          fallbackAxis: 'smallestExtent',
          color: DEBUG_HANDLE_COLOR,
        },
      ],
      argumentsToSubmit: { length: 8 },
    },
    camera,
    resolvedTheme: 'light',
    getClientSceneScaleFactor,
  })
}

export function updateOpenCascadePreviewHandleScale(
  root: Group,
  getClientSceneScaleFactor: (target?: Mesh | Group | null) => number,
  camera: Camera
) {
  root.traverse((object) => {
    if (
      object instanceof Group &&
      object.userData.openCascadePreviewHandle === true
    ) {
      updatePreviewHandleScale(object, getClientSceneScaleFactor)
      orientLabelToCamera(object, camera)
    }
  })
}

export function findOpenCascadePreviewHandleIntersection(
  intersections: Intersection[]
) {
  for (const intersection of intersections) {
    const handleObject = findPreviewHandleObject(intersection.object)
    if (handleObject) {
      return handleObject
    }
  }
  return undefined
}

export function startOpenCascadePreviewHandleDrag({
  object,
  event,
  camera,
  getClientSceneScaleFactor,
  currentValue,
}: {
  object: Object3D
  event: MouseEvent
  camera: Camera
  getClientSceneScaleFactor(target?: Mesh | Group | null): number
  currentValue: number
}): OpenCascadePreviewHandleDragState | undefined {
  const userData = object.userData as Partial<OpenCascadePreviewHandleUserData>
  if (userData.openCascadePreviewHandle !== true || !userData.argumentName) {
    return undefined
  }
  const axis = new Vector3(...(userData.axis || [1, 0, 0])).normalize()
  const origin = object.getWorldPosition(new Vector3())
  const screenOrigin = projectToScreen(origin, camera)
  const screenTip = projectToScreen(origin.clone().add(axis), camera)
  const screenAxis = screenTip.sub(screenOrigin)
  if (screenAxis.lengthSq() < 1e-8) {
    screenAxis.set(1, 0)
  } else {
    screenAxis.normalize()
  }
  return {
    handle: userData as OpenCascadePreviewHandleUserData,
    object,
    startClient: new Vector2(event.clientX, event.clientY),
    startValue: currentValue,
    screenAxis,
    sceneScale: getClientSceneScaleFactor(object as Group),
  }
}

export function valueForOpenCascadePreviewHandleDrag(
  drag: OpenCascadePreviewHandleDragState,
  event: MouseEvent
) {
  const delta = new Vector2(event.clientX, event.clientY)
    .sub(drag.startClient)
    .dot(drag.screenAxis)
  const next =
    drag.handle.kind === 'angle'
      ? drag.startValue + delta * 0.5
      : drag.handle.kind === 'count'
        ? Math.round(drag.startValue + delta / 24)
        : drag.startValue + delta * drag.sceneScale
  return drag.handle.min === undefined ? next : Math.max(drag.handle.min, next)
}

export function disposeOpenCascadePreviewHandles(root: Group) {
  root.traverse((object) => {
    if (
      object instanceof Mesh ||
      object instanceof LineSegments ||
      object instanceof Line2
    ) {
      object.geometry.dispose()
      const material = object.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else {
        material.dispose()
      }
    }
  })
  root.clear()
}

function visiblePreviewHandleConfigs(
  command: Command | undefined,
  args: Record<string, unknown>,
  handleState?: OpenCascadePreviewHandleState
) {
  return (
    handleState?.handles ||
    command?.openCascadePreviewHandles ||
    []
  ).filter((config) => {
    if (!config.visibleWhenArgument) {
      return true
    }
    const value = args[config.visibleWhenArgument]
    return value !== undefined && value !== null && value !== ''
  })
}

function previewHandleArgs(
  context: CommandBarContext,
  handleState?: OpenCascadePreviewHandleState
) {
  return (
    handleState?.argumentsToSubmit || {
      ...context.argumentsToSubmit,
      ...context.previewArgumentsToSubmit,
    }
  )
}

function makePreviewHandle({
  config,
  axis,
  anchor,
  label,
  value,
  color,
}: {
  config: OpenCascadePreviewHandleConfig
  axis: Vector3
  anchor: Vector3
  label: string
  value: number | undefined
  color: number
}) {
  const group = new Group()
  group.name = `${OPEN_CASCADE_PREVIEW_HANDLE_ROOT}:${config.argumentName}`
  group.position.copy(anchor)
  group.quaternion.copy(
    new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), axis.normalize())
  )
  group.userData.openCascadeFixedScreenScale = true
  group.userData.openCascadePreviewHandle = true
  group.userData.argumentName = config.argumentName
  group.userData.kind = config.kind
  group.userData.axis = axis.toArray()
  group.userData.min = config.min

  if (config.kind === 'angle') {
    group.add(makeArcLine(color), makeArrowHead(color, HANDLE_LENGTH_PX))
  } else if (config.kind !== 'count') {
    group.add(makeArrowLine(color), makeArrowHead(color, HANDLE_LENGTH_PX))
  }

  const hit = new Mesh(
    new SphereGeometry(HANDLE_HIT_RADIUS_PX, 20, 10),
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.001,
      depthTest: false,
      depthWrite: false,
    })
  )
  hit.position.x = config.kind === 'count' ? 0 : HANDLE_LENGTH_PX
  hit.userData.openCascadePreviewHandle = true
  hit.userData.argumentName = config.argumentName
  hit.userData.kind = config.kind
  hit.userData.axis = axis.toArray()
  hit.userData.min = config.min
  group.add(hit)

  group.add(
    makeHandleLabel(
      `${label}${value === undefined ? '' : ` ${formatHandleValue(value, config.kind)}`}`,
      color
    )
  )
  return group
}

function makeArrowLine(color: number) {
  const line = makeFatLine([0, 0, 0, HANDLE_LENGTH_PX, 0, 0], color)
  line.name = `${OPEN_CASCADE_PREVIEW_HANDLE_ROOT}:stem`
  line.renderOrder = 95
  return line
}

function makeArcLine(color: number) {
  const points: number[] = []
  const radius = HANDLE_LENGTH_PX * 0.72
  const start = -Math.PI / 5
  const end = Math.PI / 3
  for (let index = 0; index < 18; index += 1) {
    const a0 = start + ((end - start) * index) / 18
    const a1 = start + ((end - start) * (index + 1)) / 18
    points.push(
      Math.cos(a0) * radius,
      Math.sin(a0) * radius,
      0,
      Math.cos(a1) * radius,
      Math.sin(a1) * radius,
      0
    )
  }
  const line = makeFatLine(points, color)
  line.name = `${OPEN_CASCADE_PREVIEW_HANDLE_ROOT}:stem`
  line.renderOrder = 95
  return line
}

function makeFatLine(points: number[], color: number) {
  const geometry = new LineGeometry()
  geometry.setPositions(points)
  const material = new LineMaterial({
    color,
    linewidth: HANDLE_STEM_WIDTH_PX,
    worldUnits: false,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  })
  material.resolution.set(window.innerWidth || 1, window.innerHeight || 1)
  const line = new Line2(geometry, material)
  line.computeLineDistances()
  return line
}

function makeArrowHead(color: number, x: number) {
  const cone = new Mesh(
    new ConeGeometry(HANDLE_HEAD_RADIUS_PX, HANDLE_HEAD_LENGTH_PX, 24),
    new MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    })
  )
  cone.position.x = x
  cone.rotateZ(-Math.PI / 2)
  cone.renderOrder = 95
  return cone
}

function makeHandleLabel(text: string, color: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = '700 42px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = colorString(color, 0.92)
    ctx.fillText(text, 14, canvas.height / 2)
  }
  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  const label = new Mesh(
    new BufferGeometry(),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    })
  )
  label.geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        HANDLE_LENGTH_PX + HANDLE_LABEL_OFFSET_PX,
        -14,
        0,
        HANDLE_LENGTH_PX + HANDLE_LABEL_OFFSET_PX + 128,
        -14,
        0,
        HANDLE_LENGTH_PX + HANDLE_LABEL_OFFSET_PX + 128,
        18,
        0,
        HANDLE_LENGTH_PX + HANDLE_LABEL_OFFSET_PX,
        18,
        0,
      ],
      3
    )
  )
  label.geometry.setAttribute(
    'uv',
    new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)
  )
  label.geometry.setIndex([0, 1, 2, 0, 2, 3])
  label.name = `${OPEN_CASCADE_PREVIEW_HANDLE_ROOT}:label`
  label.userData.openCascadePreviewHandleLabel = true
  label.renderOrder = 96
  return label
}

function updatePreviewHandleScale(
  object: Group,
  getClientSceneScaleFactor: (target?: Mesh | Group | null) => number
) {
  object.scale.setScalar(getClientSceneScaleFactor(object))
}

function orientLabelToCamera(group: Group, camera: Camera) {
  const label = group.children.find(
    (child) => child.userData.openCascadePreviewHandleLabel === true
  )
  if (!label) {
    return
  }
  label.quaternion.copy(camera.quaternion)
}

function findPreviewHandleObject(
  object: Object3D | null
): Object3D | undefined {
  let current: Object3D | null = object
  while (current) {
    if (current.userData.openCascadePreviewHandle === true) {
      return current
    }
    current = current.parent
  }
  return undefined
}

function anchorForHandle(
  config: OpenCascadePreviewHandleConfig,
  center: Vector3,
  size: Vector3,
  axis: Vector3,
  index: number
) {
  if (config.kind === 'count') {
    return center
      .clone()
      .add(new Vector3(0, 0, Math.max(size.x, size.y, size.z) * 0.6))
  }
  const halfExtent =
    Math.abs(axis.x) * size.x * 0.5 +
    Math.abs(axis.y) * size.y * 0.5 +
    Math.abs(axis.z) * size.z * 0.5
  const offset = halfExtent + Math.max(size.x, size.y, size.z, 1) * 0.08
  return center
    .clone()
    .add(axis.clone().multiplyScalar(offset))
    .add(new Vector3(0, 0, index * 0.01))
}

function axisForConfig(
  config: OpenCascadePreviewHandleConfig,
  args: Record<string, unknown>,
  fallbackAxis: Vector3
) {
  if (config.axisArgumentName) {
    const axis = axisFromArgument(args[config.axisArgumentName])
    if (axis) {
      return axis
    }
  }
  if (config.kind === 'edgeOffset') {
    return new Vector3(1, 1, 1).normalize()
  }
  if (config.kind === 'angle') {
    return new Vector3(0, 0, 1)
  }
  return fallbackAxis.clone()
}

function fallbackAxisForConfig(
  config: OpenCascadePreviewHandleConfig,
  size: Vector3
) {
  return config.fallbackAxis === 'smallestExtent'
    ? smallestNonZeroAxis(size)
    : dominantAxis(size)
}

function axisFromArgument(value: unknown) {
  if (value === 'X') return new Vector3(1, 0, 0)
  if (value === 'Y') return new Vector3(0, 1, 0)
  if (value === 'Z') return new Vector3(0, 0, 1)
  if (typeof value === 'object' && value && 'valueText' in value) {
    const text = String((value as KclCommandValue).valueText).trim()
    if (text === '[1, 0, 0]') return new Vector3(1, 0, 0)
    if (text === '[0, 1, 0]') return new Vector3(0, 1, 0)
    if (text === '[0, 0, 1]') return new Vector3(0, 0, 1)
  }
  return undefined
}

function dominantAxis(size: Vector3) {
  if (size.x >= size.y && size.x >= size.z) return new Vector3(1, 0, 0)
  if (size.y >= size.x && size.y >= size.z) return new Vector3(0, 1, 0)
  return new Vector3(0, 0, 1)
}

function smallestNonZeroAxis(size: Vector3) {
  const extents = [
    { axis: new Vector3(1, 0, 0), size: Math.abs(size.x) },
    { axis: new Vector3(0, 1, 0), size: Math.abs(size.y) },
    { axis: new Vector3(0, 0, 1), size: Math.abs(size.z) },
  ].filter((entry) => entry.size > 1e-6)
  extents.sort((left, right) => left.size - right.size)
  return extents[0]?.axis.clone() ?? new Vector3(1, 0, 0)
}

function numericArgumentValue(value: unknown) {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'object' && value && 'valueCalculated' in value) {
    const parsed = Number.parseFloat(
      String((value as KclCommandValue).valueCalculated)
    )
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof value === 'object' && value && 'valueText' in value) {
    const parsed = Number.parseFloat(
      String((value as KclCommandValue).valueText)
    )
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function formatHandleValue(
  value: number,
  kind: OpenCascadePreviewHandleConfig['kind']
) {
  if (kind === 'count') {
    return String(Math.max(1, Math.round(value)))
  }
  const rounded = Math.round(value * 100) / 100
  return kind === 'angle' ? `${rounded}deg` : String(rounded)
}

function projectToScreen(point: Vector3, camera: Camera) {
  const projected = point.clone().project(camera)
  return new Vector2(projected.x, projected.y)
}

function colorString(color: number, alpha: number) {
  const c = new Color(color)
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(
    c.b * 255
  )}, ${alpha})`
}

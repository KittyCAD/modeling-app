import { Coords2d } from 'lang/std/sketch'
import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CurvePath,
  EllipseCurve,
  ExtrudeGeometry,
  Group,
  LineCurve3,
  Mesh,
  MeshBasicMaterial,
  NormalBufferAttributes,
  Points,
  PointsMaterial,
  Shape,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { PathToNode, SketchGroup, getTangentialArcToInfo } from 'lang/wasm'
import {
  EXTRA_SEGMENT_HANDLE,
  EXTRA_SEGMENT_OFFSET_PX,
  HIDE_HOVER_SEGMENT_LENGTH,
  HIDE_SEGMENT_LENGTH,
  PROFILE_START,
  SEGMENT_WIDTH_PX,
  STRAIGHT_SEGMENT,
  STRAIGHT_SEGMENT_BODY,
  STRAIGHT_SEGMENT_DASH,
  TANGENTIAL_ARC_TO_SEGMENT,
  TANGENTIAL_ARC_TO_SEGMENT_BODY,
  TANGENTIAL_ARC_TO__SEGMENT_DASH,
  getParentGroup,
} from './sceneEntities'
import { getTangentPointFromPreviousArc } from 'lib/utils2d'
import {
  ARROWHEAD,
  SceneInfra,
  SEGMENT_LENGTH_LABEL,
  SEGMENT_LENGTH_LABEL_OFFSET_PX,
  SEGMENT_LENGTH_LABEL_TEXT,
} from './sceneInfra'
import { Themes, getThemeColorForThreeJs } from 'lib/theme'
import { normaliseAngle, roundOff } from 'lib/utils'
import { SegmentOverlayPayload } from 'machines/modelingMachine'

interface CreateSegmentArgs {
  from: Coords2d
  to: Coords2d
  prevSegment: SketchGroup['value'][number]
  id: string
  pathToNode: PathToNode
  isDraftSegment?: boolean
  scale?: number
  callExpName: string
  texture: Texture
  theme: Themes
  isSelected?: boolean
  sceneInfra: SceneInfra
}

interface UpdateSegmentArgs {
  from: [number, number]
  to: [number, number]
  prevSegment: SketchGroup['value'][number]
  group: Group
  sceneInfra: SceneInfra
  scale?: number
}

interface CreateSegmentResult {
  group: Group
  callback: () => SegmentOverlayPayload | null
}
interface SegmentUtils {
  create: (args: CreateSegmentArgs) => CreateSegmentResult
  update: (args: UpdateSegmentArgs) => CreateSegmentResult['callback']
}

class StraightSegment implements SegmentUtils {
  constructor() {
    this.create = this.create.bind(this)
    this.update = this.update.bind(this)
  }
  create({
    from,
    to,
    id,
    pathToNode,
    isDraftSegment,
    scale = 1,
    callExpName,
    texture,
    theme,
    isSelected = false,
    sceneInfra,
    prevSegment,
  }: CreateSegmentArgs): CreateSegmentResult {
    const segmentGroup = new Group()

    const shape = new Shape()
    shape.moveTo(0, (-SEGMENT_WIDTH_PX / 2) * scale)
    shape.lineTo(0, (SEGMENT_WIDTH_PX / 2) * scale)

    let geometry
    if (isDraftSegment) {
      geometry = dashedStraight(from, to, shape, scale)
    } else {
      const line = new LineCurve3(
        new Vector3(from[0], from[1], 0),
        new Vector3(to[0], to[1], 0)
      )

      geometry = new ExtrudeGeometry(shape, {
        steps: 2,
        bevelEnabled: false,
        extrudePath: line,
      })
    }

    const baseColor =
      callExpName === 'close' ? 0x444444 : getThemeColorForThreeJs(theme)
    const color = isSelected ? 0x0000ff : baseColor
    const body = new MeshBasicMaterial({ color })
    const mesh = new Mesh(geometry, body)
    mesh.userData.type = isDraftSegment
      ? STRAIGHT_SEGMENT_DASH
      : STRAIGHT_SEGMENT_BODY
    mesh.name = STRAIGHT_SEGMENT_BODY

    segmentGroup.userData = {
      type: STRAIGHT_SEGMENT,
      id,
      from,
      to,
      pathToNode,
      isSelected,
      callExpName,
      baseColor,
    }
    segmentGroup.name = STRAIGHT_SEGMENT
    segmentGroup.add(mesh)

    const length = Math.sqrt(
      Math.pow(to[0] - from[0], 2) + Math.pow(to[1] - from[1], 2)
    )
    const pxLength = length / scale
    const shouldHide = pxLength < HIDE_SEGMENT_LENGTH

    // All segment types get an extra segment handle,
    // Which is a little plus sign that appears at the origin of the segment
    // and can be dragged to insert a new segment
    const extraSegmentGroup = createExtraSegmentHandle(scale, texture, theme)
    const directionVector = new Vector2(
      to[0] - from[0],
      to[1] - from[1]
    ).normalize()
    const offsetFromBase = directionVector.multiplyScalar(
      EXTRA_SEGMENT_OFFSET_PX * scale
    )
    extraSegmentGroup.position.set(
      from[0] + offsetFromBase.x,
      from[1] + offsetFromBase.y,
      0
    )
    extraSegmentGroup.visible = !shouldHide
    segmentGroup.add(extraSegmentGroup)

    // Segment decorators that only apply to non-close segments
    if (callExpName !== 'close') {
      // an arrowhead that appears at the end of the segment
      const arrowGroup = createArrowhead(scale, theme, color)
      arrowGroup.position.set(to[0], to[1], 0)
      const dir = new Vector3()
        .subVectors(
          new Vector3(to[0], to[1], 0),
          new Vector3(from[0], from[1], 0)
        )
        .normalize()
      arrowGroup.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      arrowGroup.visible = !shouldHide
      segmentGroup.add(arrowGroup)

      // A length indicator that appears at the midpoint of the segment
      const lengthIndicatorGroup = createLengthIndicator({
        from,
        to,
        scale,
        length,
      })
      segmentGroup.add(lengthIndicatorGroup)
    }

    return {
      group: segmentGroup,
      callback: this.update({
        prevSegment,
        from,
        to,
        group: segmentGroup,
        scale,
        sceneInfra,
      }),
    }
  }

  update({
    from,
    to,
    group,
    scale = 1,
    sceneInfra,
  }: UpdateSegmentArgs): () => SegmentOverlayPayload | null {
    group.userData.from = from
    group.userData.to = to
    const shape = new Shape()
    shape.moveTo(0, (-SEGMENT_WIDTH_PX / 2) * scale) // The width of the line in px (2.4px in this case)
    shape.lineTo(0, (SEGMENT_WIDTH_PX / 2) * scale)
    const arrowGroup = group.getObjectByName(ARROWHEAD) as Group
    const labelGroup = group.getObjectByName(SEGMENT_LENGTH_LABEL) as Group

    const length = Math.sqrt(
      Math.pow(to[0] - from[0], 2) + Math.pow(to[1] - from[1], 2)
    )

    const pxLength = length / scale
    const shouldHideIdle = pxLength < HIDE_SEGMENT_LENGTH
    const shouldHideHover = pxLength < HIDE_HOVER_SEGMENT_LENGTH

    const hoveredParent =
      sceneInfra.hoveredObject &&
      getParentGroup(sceneInfra.hoveredObject, [STRAIGHT_SEGMENT])
    let isHandlesVisible = !shouldHideIdle
    if (hoveredParent && hoveredParent?.uuid === group?.uuid) {
      isHandlesVisible = !shouldHideHover
    }

    if (arrowGroup) {
      arrowGroup.position.set(to[0], to[1], 0)

      const dir = new Vector3()
        .subVectors(
          new Vector3(to[0], to[1], 0),
          new Vector3(from[0], from[1], 0)
        )
        .normalize()
      arrowGroup.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      arrowGroup.scale.set(scale, scale, scale)
      arrowGroup.visible = isHandlesVisible
    }

    const extraSegmentGroup = group.getObjectByName(EXTRA_SEGMENT_HANDLE)
    if (extraSegmentGroup) {
      const offsetFromBase = new Vector2(to[0] - from[0], to[1] - from[1])
        .normalize()
        .multiplyScalar(EXTRA_SEGMENT_OFFSET_PX * scale)
      extraSegmentGroup.position.set(
        from[0] + offsetFromBase.x,
        from[1] + offsetFromBase.y,
        0
      )
      extraSegmentGroup.scale.set(scale, scale, scale)
      extraSegmentGroup.visible = isHandlesVisible
    }

    if (labelGroup) {
      const labelWrapper = labelGroup.getObjectByName(
        SEGMENT_LENGTH_LABEL_TEXT
      ) as CSS2DObject
      const labelWrapperElem = labelWrapper.element as HTMLDivElement
      const label = labelWrapperElem.children[0] as HTMLParagraphElement
      label.innerText = `${roundOff(length)}`
      label.classList.add(SEGMENT_LENGTH_LABEL_TEXT)
      const slope = (to[1] - from[1]) / (to[0] - from[0])
      let slopeAngle = ((Math.atan(slope) * 180) / Math.PI) * -1
      label.style.setProperty('--degree', `${slopeAngle}deg`)
      label.style.setProperty('--x', `0px`)
      label.style.setProperty('--y', `0px`)
      labelWrapper.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 0)
      labelGroup.visible = isHandlesVisible
    }

    const straightSegmentBody = group.children.find(
      (child) => child.userData.type === STRAIGHT_SEGMENT_BODY
    ) as Mesh
    if (straightSegmentBody) {
      const line = new LineCurve3(
        new Vector3(from[0], from[1], 0),
        new Vector3(to[0], to[1], 0)
      )
      straightSegmentBody.geometry = new ExtrudeGeometry(shape, {
        steps: 2,
        bevelEnabled: false,
        extrudePath: line,
      })
    }
    const straightSegmentBodyDashed = group.children.find(
      (child) => child.userData.type === STRAIGHT_SEGMENT_DASH
    ) as Mesh
    if (straightSegmentBodyDashed) {
      straightSegmentBodyDashed.geometry = dashedStraight(
        from,
        to,
        shape,
        scale
      )
    }
    return () =>
      sceneInfra.updateOverlayDetails({
        arrowGroup,
        group,
        isHandlesVisible,
        from,
        to,
      })
  }
}

class TangentialArcToSegment implements SegmentUtils {
  constructor() {
    this.create = this.create.bind(this)
    this.update = this.update.bind(this)
  }
  create({
    prevSegment,
    from,
    to,
    id,
    pathToNode,
    isDraftSegment,
    scale = 1,
    texture,
    theme,
    isSelected,
    sceneInfra,
  }: CreateSegmentArgs): CreateSegmentResult {
    const group = new Group()

    const previousPoint =
      prevSegment?.type === 'TangentialArcTo'
        ? getTangentPointFromPreviousArc(
            prevSegment.center,
            prevSegment.ccw,
            prevSegment.to
          )
        : prevSegment.from

    const { center, radius, startAngle, endAngle, ccw, arcLength } =
      getTangentialArcToInfo({
        arcStartPoint: from,
        arcEndPoint: to,
        tanPreviousPoint: previousPoint,
        obtuse: true,
      })

    const geometry = createArcGeometry({
      center,
      radius,
      startAngle,
      endAngle,
      ccw,
      isDashed: isDraftSegment,
      scale,
    })

    const baseColor = getThemeColorForThreeJs(theme)
    const color = isSelected ? 0x0000ff : baseColor
    const body = new MeshBasicMaterial({ color })
    const mesh = new Mesh(geometry, body)
    const meshName = isDraftSegment
      ? TANGENTIAL_ARC_TO__SEGMENT_DASH
      : TANGENTIAL_ARC_TO_SEGMENT_BODY
    mesh.userData.type = meshName
    mesh.name = meshName

    group.userData = {
      type: TANGENTIAL_ARC_TO_SEGMENT,
      id,
      from,
      to,
      prevSegment,
      pathToNode,
      isSelected,
      baseColor,
    }
    group.name = TANGENTIAL_ARC_TO_SEGMENT

    const arrowGroup = createArrowhead(scale, theme, color)
    arrowGroup.position.set(to[0], to[1], 0)
    const arrowheadAngle = endAngle + (Math.PI / 2) * (ccw ? 1 : -1)
    arrowGroup.quaternion.setFromUnitVectors(
      new Vector3(0, 1, 0),
      new Vector3(Math.cos(arrowheadAngle), Math.sin(arrowheadAngle), 0)
    )
    const pxLength = arcLength / scale
    const shouldHide = pxLength < HIDE_SEGMENT_LENGTH
    arrowGroup.visible = !shouldHide

    const extraSegmentGroup = createExtraSegmentHandle(scale, texture, theme)
    const circumferenceInPx = (2 * Math.PI * radius) / scale
    const extraSegmentAngleDelta =
      (EXTRA_SEGMENT_OFFSET_PX / circumferenceInPx) * Math.PI * 2
    const extraSegmentAngle =
      startAngle + (ccw ? 1 : -1) * extraSegmentAngleDelta
    const extraSegmentOffset = new Vector2(
      Math.cos(extraSegmentAngle) * radius,
      Math.sin(extraSegmentAngle) * radius
    )
    extraSegmentGroup.position.set(
      center[0] + extraSegmentOffset.x,
      center[1] + extraSegmentOffset.y,
      0
    )

    extraSegmentGroup.visible = !shouldHide

    group.add(mesh, arrowGroup, extraSegmentGroup)

    return {
      group,
      callback: this.update({
        prevSegment,
        from,
        to,
        group,
        scale,
        sceneInfra,
      }),
    }
  }

  update({
    prevSegment,
    from,
    to,
    group,
    scale = 1,
    sceneInfra,
  }: UpdateSegmentArgs): () => SegmentOverlayPayload | null {
    group.userData.from = from
    group.userData.to = to
    group.userData.prevSegment = prevSegment
    const arrowGroup = group.getObjectByName(ARROWHEAD) as Group
    const extraSegmentGroup = group.getObjectByName(EXTRA_SEGMENT_HANDLE)

    const previousPoint =
      prevSegment?.type === 'TangentialArcTo'
        ? getTangentPointFromPreviousArc(
            prevSegment.center,
            prevSegment.ccw,
            prevSegment.to
          )
        : prevSegment.from

    const arcInfo = getTangentialArcToInfo({
      arcStartPoint: from,
      arcEndPoint: to,
      tanPreviousPoint: previousPoint,
      obtuse: true,
    })

    const pxLength = arcInfo.arcLength / scale
    const shouldHideIdle = pxLength < HIDE_SEGMENT_LENGTH
    const shouldHideHover = pxLength < HIDE_HOVER_SEGMENT_LENGTH

    const hoveredParent =
      sceneInfra?.hoveredObject &&
      getParentGroup(sceneInfra.hoveredObject, [TANGENTIAL_ARC_TO_SEGMENT])
    let isHandlesVisible = !shouldHideIdle
    if (hoveredParent && hoveredParent?.uuid === group?.uuid) {
      isHandlesVisible = !shouldHideHover
    }

    if (arrowGroup) {
      arrowGroup.position.set(to[0], to[1], 0)

      const arrowheadAngle =
        arcInfo.endAngle + (Math.PI / 2) * (arcInfo.ccw ? 1 : -1)
      arrowGroup.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(Math.cos(arrowheadAngle), Math.sin(arrowheadAngle), 0)
      )
      arrowGroup.scale.set(scale, scale, scale)
      arrowGroup.visible = isHandlesVisible
    }

    if (extraSegmentGroup) {
      const circumferenceInPx = (2 * Math.PI * arcInfo.radius) / scale
      const extraSegmentAngleDelta =
        (EXTRA_SEGMENT_OFFSET_PX / circumferenceInPx) * Math.PI * 2
      const extraSegmentAngle =
        arcInfo.startAngle + (arcInfo.ccw ? 1 : -1) * extraSegmentAngleDelta
      const extraSegmentOffset = new Vector2(
        Math.cos(extraSegmentAngle) * arcInfo.radius,
        Math.sin(extraSegmentAngle) * arcInfo.radius
      )
      extraSegmentGroup.position.set(
        arcInfo.center[0] + extraSegmentOffset.x,
        arcInfo.center[1] + extraSegmentOffset.y,
        0
      )
      extraSegmentGroup.scale.set(scale, scale, scale)
      extraSegmentGroup.visible = isHandlesVisible
    }

    const tangentialArcToSegmentBody = group.children.find(
      (child) => child.userData.type === TANGENTIAL_ARC_TO_SEGMENT_BODY
    ) as Mesh

    if (tangentialArcToSegmentBody) {
      const newGeo = createArcGeometry({ ...arcInfo, scale })
      tangentialArcToSegmentBody.geometry = newGeo
    }
    const tangentialArcToSegmentBodyDashed = group.getObjectByName(
      TANGENTIAL_ARC_TO__SEGMENT_DASH
    )
    if (tangentialArcToSegmentBodyDashed instanceof Mesh) {
      tangentialArcToSegmentBodyDashed.geometry = createArcGeometry({
        ...arcInfo,
        isDashed: true,
        scale,
      })
    }
    const angle = normaliseAngle(
      (arcInfo.endAngle * 180) / Math.PI + (arcInfo.ccw ? 90 : -90)
    )
    return () =>
      sceneInfra.updateOverlayDetails({
        arrowGroup,
        group,
        isHandlesVisible,
        from,
        to,
        angle,
      })
  }
}

export function createProfileStartHandle({
  from,
  id,
  pathToNode,
  scale = 1,
  theme,
  isSelected,
}: {
  from: Coords2d
  id: string
  pathToNode: PathToNode
  scale?: number
  theme: Themes
  isSelected?: boolean
}) {
  const group = new Group()

  const geometry = new BoxGeometry(12, 12, 12) // in pixels scaled later
  const baseColor = getThemeColorForThreeJs(theme)
  const color = isSelected ? 0x0000ff : baseColor
  const body = new MeshBasicMaterial({ color })
  const mesh = new Mesh(geometry, body)

  group.add(mesh)

  group.userData = {
    type: PROFILE_START,
    id,
    from,
    pathToNode,
    isSelected,
    baseColor,
  }
  group.name = PROFILE_START
  group.position.set(from[0], from[1], 0)
  group.scale.set(scale, scale, scale)
  return group
}

function createArrowhead(scale = 1, theme: Themes, color?: number): Group {
  const baseColor = getThemeColorForThreeJs(theme)
  const arrowMaterial = new MeshBasicMaterial({
    color: color || baseColor,
  })
  // specify the size of the geometry in pixels (i.e. cone height = 20px, cone radius = 4.5px)
  // we'll scale the group to the correct size later to match these sizes in screen space
  const arrowheadMesh = new Mesh(new ConeGeometry(4.5, 20, 12), arrowMaterial)
  arrowheadMesh.position.set(0, -9, 0)
  const sphereMesh = new Mesh(new SphereGeometry(4, 12, 12), arrowMaterial)

  const arrowGroup = new Group()
  arrowGroup.userData.type = ARROWHEAD
  arrowGroup.name = ARROWHEAD
  arrowGroup.add(arrowheadMesh, sphereMesh)
  arrowGroup.lookAt(new Vector3(0, 1, 0))
  arrowGroup.scale.set(scale, scale, scale)
  return arrowGroup
}

function createExtraSegmentHandle(
  scale: number,
  texture: Texture,
  theme: Themes
): Group {
  const particleMaterial = new PointsMaterial({
    size: 12, // in pixels
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
  })
  const mat = new MeshBasicMaterial({
    transparent: true,
    color: getThemeColorForThreeJs(theme),
    opacity: 0,
  })
  const particleGeometry = new BufferGeometry().setFromPoints([
    new Vector3(0, 0, 0),
  ])
  const sphereMesh = new Mesh(new SphereGeometry(6, 12, 12), mat) // sphere radius in pixels
  const particle = new Points(particleGeometry, particleMaterial)
  particle.userData.ignoreColorChange = true
  particle.userData.type = EXTRA_SEGMENT_HANDLE

  const extraSegmentGroup = new Group()
  extraSegmentGroup.userData.type = EXTRA_SEGMENT_HANDLE
  extraSegmentGroup.name = EXTRA_SEGMENT_HANDLE
  extraSegmentGroup.add(sphereMesh)
  extraSegmentGroup.add(particle)
  extraSegmentGroup.scale.set(scale, scale, scale)
  return extraSegmentGroup
}

/**
 * Creates a group containing a CSS2DObject with the length of the segment
 */
function createLengthIndicator({
  from,
  to,
  scale,
  length,
}: {
  from: Coords2d
  to: Coords2d
  scale: number
  length: number
}) {
  const lengthIndicatorGroup = new Group()
  lengthIndicatorGroup.name = SEGMENT_LENGTH_LABEL

  // Make the elements
  const lengthIndicatorText = document.createElement('p')
  lengthIndicatorText.classList.add(SEGMENT_LENGTH_LABEL_TEXT)
  lengthIndicatorText.innerText = roundOff(length).toString()
  const lengthIndicatorWrapper = document.createElement('div')

  // Style the elements
  lengthIndicatorWrapper.style.position = 'absolute'
  lengthIndicatorWrapper.appendChild(lengthIndicatorText)
  const cssObject = new CSS2DObject(lengthIndicatorWrapper)
  cssObject.name = SEGMENT_LENGTH_LABEL_TEXT

  // Position the elements based on the line's heading
  const offsetFromMidpoint = new Vector2(to[0] - from[0], to[1] - from[1])
    .normalize()
    .rotateAround(new Vector2(0, 0), -Math.PI / 2)
    .multiplyScalar(SEGMENT_LENGTH_LABEL_OFFSET_PX * scale)
  lengthIndicatorText.style.setProperty('--x', `${offsetFromMidpoint.x}px`)
  lengthIndicatorText.style.setProperty('--y', `${offsetFromMidpoint.y}px`)
  lengthIndicatorGroup.add(cssObject)
  return lengthIndicatorGroup
}

export function createArcGeometry({
  center,
  radius,
  startAngle,
  endAngle,
  ccw,
  isDashed = false,
  scale = 1,
}: {
  center: Coords2d
  radius: number
  startAngle: number
  endAngle: number
  ccw: boolean
  isDashed?: boolean
  scale?: number
}): BufferGeometry {
  const dashSizePx = 18 * scale
  const gapSizePx = 18 * scale
  const arcStart = new EllipseCurve(
    center[0],
    center[1],
    radius,
    radius,
    startAngle,
    endAngle,
    !ccw,
    0
  )
  const arcEnd = new EllipseCurve(
    center[0],
    center[1],
    radius,
    radius,
    endAngle,
    startAngle,
    ccw,
    0
  )
  const shape = new Shape()
  shape.moveTo(0, (-SEGMENT_WIDTH_PX / 2) * scale)
  shape.lineTo(0, (SEGMENT_WIDTH_PX / 2) * scale) // The width of the line

  if (!isDashed) {
    const points = arcStart.getPoints(50)
    const path = new CurvePath<Vector3>()
    path.add(new CatmullRomCurve3(points.map((p) => new Vector3(p.x, p.y, 0))))

    return new ExtrudeGeometry(shape, {
      steps: 100,
      bevelEnabled: false,
      extrudePath: path,
    })
  }

  const length = arcStart.getLength()
  const totalDashes = length / (dashSizePx + gapSizePx) // rounding makes the dashes jittery since the new dash is suddenly appears instead of growing into place
  const dashesAtEachEnd = Math.min(100, totalDashes / 2) // Assuming we want 50 dashes total, 25 at each end

  const dashGeometries = []

  // Function to create a dash at a specific t value (0 to 1 along the curve)
  const createDashAt = (t: number, curve: EllipseCurve) => {
    const startVec = curve.getPoint(t)
    const endVec = curve.getPoint(Math.min(0.5, t + dashSizePx / length))
    const midVec = curve.getPoint(Math.min(0.5, t + dashSizePx / length / 2))
    const dashCurve = new CurvePath<Vector3>()
    dashCurve.add(
      new CatmullRomCurve3([
        new Vector3(startVec.x, startVec.y, 0),
        new Vector3(midVec.x, midVec.y, 0),
        new Vector3(endVec.x, endVec.y, 0),
      ])
    )
    return new ExtrudeGeometry(shape, {
      steps: 3,
      bevelEnabled: false,
      extrudePath: dashCurve,
    })
  }

  // Create dashes at the start of the arc
  for (let i = 0; i < dashesAtEachEnd; i++) {
    const t = i / totalDashes
    dashGeometries.push(createDashAt(t, arcStart))
    dashGeometries.push(createDashAt(t, arcEnd))
  }

  // fill in the remaining arc
  const remainingArcLength =
    length - dashesAtEachEnd * 2 * (dashSizePx + gapSizePx)
  if (remainingArcLength > 0) {
    const remainingArcStartT = dashesAtEachEnd / totalDashes
    const remainingArcEndT = 1 - remainingArcStartT
    const centerVec = new Vector2(center[0], center[1])
    const remainingArcStartVec = arcStart.getPoint(remainingArcStartT)
    const remainingArcEndVec = arcStart.getPoint(remainingArcEndT)
    const remainingArcCurve = new EllipseCurve(
      arcStart.aX,
      arcStart.aY,
      arcStart.xRadius,
      arcStart.yRadius,
      new Vector2().subVectors(centerVec, remainingArcStartVec).angle() +
        Math.PI,
      new Vector2().subVectors(centerVec, remainingArcEndVec).angle() + Math.PI,
      !ccw
    )
    const remainingArcPoints = remainingArcCurve.getPoints(50)
    const remainingArcPath = new CurvePath<Vector3>()
    remainingArcPath.add(
      new CatmullRomCurve3(
        remainingArcPoints.map((p) => new Vector3(p.x, p.y, 0))
      )
    )
    const remainingArcGeometry = new ExtrudeGeometry(shape, {
      steps: 50,
      bevelEnabled: false,
      extrudePath: remainingArcPath,
    })
    dashGeometries.push(remainingArcGeometry)
  }

  const geo = dashGeometries.length
    ? mergeGeometries(dashGeometries)
    : new BufferGeometry()
  geo.userData.type = 'dashed'
  return geo
}

export function dashedStraight(
  from: Coords2d,
  to: Coords2d,
  shape: Shape,
  scale = 1
): BufferGeometry<NormalBufferAttributes> {
  const dashSize = 18 * scale
  const gapSize = 18 * scale // TODO: gapSize is not respected
  const dashLine = new LineCurve3(
    new Vector3(from[0], from[1], 0),
    new Vector3(to[0], to[1], 0)
  )
  const length = dashLine.getLength()
  const numberOfPoints = (length / (dashSize + gapSize)) * 2
  const startOfLine = new Vector3(from[0], from[1], 0)
  const endOfLine = new Vector3(to[0], to[1], 0)
  const dashGeometries = []
  const dashComponent = (xOrY: number, pointIndex: number) =>
    ((to[xOrY] - from[xOrY]) / numberOfPoints) * pointIndex + from[xOrY]
  for (let i = 0; i < numberOfPoints; i += 2) {
    const dashStart = new Vector3(dashComponent(0, i), dashComponent(1, i), 0)
    let dashEnd = new Vector3(
      dashComponent(0, i + 1),
      dashComponent(1, i + 1),
      0
    )
    if (startOfLine.distanceTo(dashEnd) > startOfLine.distanceTo(endOfLine))
      dashEnd = endOfLine

    if (dashEnd) {
      const dashCurve = new LineCurve3(dashStart, dashEnd)
      const dashGeometry = new ExtrudeGeometry(shape, {
        steps: 1,
        bevelEnabled: false,
        extrudePath: dashCurve,
      })
      dashGeometries.push(dashGeometry)
    }
  }
  const geo = dashGeometries.length
    ? mergeGeometries(dashGeometries)
    : new BufferGeometry()
  geo.userData.type = 'dashed'
  return geo
}

export const segmentUtils = {
  straight: new StraightSegment(),
  tangentialArcTo: new TangentialArcToSegment(),
} as const

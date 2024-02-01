import { Coords2d } from 'lang/std/sketch'
import {
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
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PathToNode, SketchGroup, getTangentialArcToInfo } from 'lang/wasm'
import {
  ARROWHEAD,
  STRAIGHT_SEGMENT,
  STRAIGHT_SEGMENT_BODY,
  STRAIGHT_SEGMENT_DASH,
  TANGENTIAL_ARC_TO_SEGMENT,
  TANGENTIAL_ARC_TO_SEGMENT_BODY,
  TANGENTIAL_ARC_TO__SEGMENT_DASH,
} from './clientSideScene'
import { getTangentPointFromPreviousArc } from 'lib/utils2d'

export function straightSegment({
  from,
  to,
  id,
  pathToNode,
  isDraftSegment,
}: {
  from: Coords2d
  to: Coords2d
  id: string
  pathToNode: PathToNode
  isDraftSegment?: boolean
}): Group {
  const group = new Group()

  const shape = new Shape()
  shape.moveTo(0, -0.08)
  shape.lineTo(0, 0.08) // The width of the line

  let geometry
  if (isDraftSegment) {
    geometry = dashedStraight(from, to, shape)
  } else {
    const line = new LineCurve3(
      new Vector3(from[0], from[1], 0),
      new Vector3(to[0], to[1], 0)
    )

    geometry = new ExtrudeGeometry(shape, {
      steps: 100,
      bevelEnabled: false,
      extrudePath: line,
    })
  }

  const body = new MeshBasicMaterial({ color: 0xffffff })
  const arrowMaterial = new MeshBasicMaterial({ color: 0xffffff })
  const mesh = new Mesh(geometry, body)
  mesh.userData.type = isDraftSegment
    ? STRAIGHT_SEGMENT_DASH
    : STRAIGHT_SEGMENT_BODY

  group.userData = {
    type: STRAIGHT_SEGMENT,
    id,
    from,
    to,
    pathToNode,
    isSelected: false,
  }

  const arrowheadMesh = new Mesh(new ConeGeometry(0.3, 0.9, 16), arrowMaterial)
  arrowheadMesh.position.set(0, -0.35, 0)
  const sphereMesh = new Mesh(new SphereGeometry(0.3, 16, 16), arrowMaterial)

  const arrowGroup = new Group()
  arrowGroup.userData.type = ARROWHEAD
  arrowGroup.add(arrowheadMesh)
  arrowGroup.add(sphereMesh)
  arrowGroup.lookAt(new Vector3(0, 1, 0))
  arrowGroup.position.set(to[0], to[1], 0)
  const dir = new Vector3()
    .subVectors(new Vector3(to[0], to[1], 0), new Vector3(from[0], from[1], 0))
    .normalize()
  arrowGroup.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)

  group.add(mesh, arrowGroup)

  return group
}

export function tangentialArcToSegment({
  prevSegment,
  from,
  to,
  id,
  pathToNode,
  isDraftSegment,
}: {
  prevSegment: SketchGroup['value'][number]
  from: Coords2d
  to: Coords2d
  id: string
  pathToNode: PathToNode
  isDraftSegment?: boolean
}): Group {
  const group = new Group()

  const previousPoint =
    prevSegment?.type === 'tangentialArcTo'
      ? getTangentPointFromPreviousArc(
          prevSegment.center,
          prevSegment.ccw,
          prevSegment.to
        )
      : prevSegment.from

  const { center, radius, startAngle, endAngle, ccw } = getTangentialArcToInfo({
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
  })

  const body = new MeshBasicMaterial({ color: 0xffffff })
  const arrowMaterial = new MeshBasicMaterial({ color: 0xffffff })
  const mesh = new Mesh(geometry, body)
  mesh.userData.type = isDraftSegment
    ? TANGENTIAL_ARC_TO__SEGMENT_DASH
    : TANGENTIAL_ARC_TO_SEGMENT_BODY

  group.userData = {
    type: TANGENTIAL_ARC_TO_SEGMENT,
    id,
    from,
    to,
    pathToNode,
    isSelected: false,
  }

  const arrowheadMesh = new Mesh(new ConeGeometry(0.3, 0.9, 16), arrowMaterial)
  arrowheadMesh.position.set(0, -0.35, 0)
  const sphereMesh = new Mesh(new SphereGeometry(0.3, 16, 16), arrowMaterial)

  const arrowGroup = new Group()
  arrowGroup.userData.type = ARROWHEAD
  arrowGroup.add(arrowheadMesh)
  arrowGroup.add(sphereMesh)
  arrowGroup.lookAt(new Vector3(0, 1, 0))
  arrowGroup.position.set(to[0], to[1], 0)
  const arrowheadAngle = endAngle + (Math.PI / 2) * (ccw ? 1 : -1)
  arrowGroup.quaternion.setFromUnitVectors(
    new Vector3(0, 1, 0),
    new Vector3(Math.cos(arrowheadAngle), Math.sin(arrowheadAngle), 0)
  )

  group.add(mesh, arrowGroup)

  return group
}

export function createArcGeometry({
  center,
  radius,
  startAngle,
  endAngle,
  ccw,
  isDashed = false,
}: {
  center: Coords2d
  radius: number
  startAngle: number
  endAngle: number
  ccw: boolean
  isDashed?: boolean
}): BufferGeometry {
  const dashSize = 1.2
  const gapSize = 1.2
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
  shape.moveTo(0, -0.08)
  shape.lineTo(0, 0.08) // The width of the line

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
  const totalDashes = length / (dashSize + gapSize) // rounding makes the dashes jittery since the new dash is suddenly appears instead of growing into place
  const dashesAtEachEnd = Math.min(100, totalDashes / 2) // Assuming we want 50 dashes total, 25 at each end

  const dashGeometries = []

  // Function to create a dash at a specific t value (0 to 1 along the curve)
  const createDashAt = (t: number, curve: EllipseCurve) => {
    const startVec = curve.getPoint(t)
    const endVec = curve.getPoint(Math.min(0.5, t + dashSize / length))
    const midVec = curve.getPoint(Math.min(0.5, t + dashSize / length / 2))
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
  const remainingArcLength = length - dashesAtEachEnd * 2 * (dashSize + gapSize)
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
  shape: Shape
): BufferGeometry<NormalBufferAttributes> {
  const dashSize = 1.2
  const gapSize = 1.2 // todo: gabSize is not respected
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

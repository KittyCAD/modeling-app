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
  LineBasicMaterial,
  LineDashedMaterial,
  Line,
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
import { PathToNode, Sketch, getTangentialArcToInfo } from 'lang/wasm'
import {
  CIRCLE_CENTER_HANDLE,
  CIRCLE_SEGMENT,
  CIRCLE_SEGMENT_BODY,
  CIRCLE_SEGMENT_DASH,
  CIRCLE_THREE_POINT_HANDLE1,
  CIRCLE_THREE_POINT_HANDLE2,
  CIRCLE_THREE_POINT_HANDLE3,
  CIRCLE_THREE_POINT_SEGMENT,
  CIRCLE_THREE_POINT_SEGMENT_BODY,
  CIRCLE_THREE_POINT_SEGMENT_DASH,
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
  ARC_SEGMENT,
  ARC_SEGMENT_BODY,
  ARC_SEGMENT_DASH,
  ARC_ANGLE_END,
  getParentGroup,
  ARC_CENTER_TO_FROM,
  ARC_CENTER_TO_TO,
  ARC_ANGLE_REFERENCE_LINE,
  THREE_POINT_ARC_SEGMENT,
  THREE_POINT_ARC_SEGMENT_BODY,
  THREE_POINT_ARC_SEGMENT_DASH,
  THREE_POINT_ARC_HANDLE2,
  THREE_POINT_ARC_HANDLE3,
  DRAFT_DASHED_LINE,
} from './sceneEntities'
import { getTangentPointFromPreviousArc } from 'lib/utils2d'
import {
  ARROWHEAD,
  DRAFT_POINT,
  SceneInfra,
  SEGMENT_LENGTH_LABEL,
  SEGMENT_LENGTH_LABEL_OFFSET_PX,
  SEGMENT_LENGTH_LABEL_TEXT,
} from './sceneInfra'
import { Themes, getThemeColorForThreeJs } from 'lib/theme'
import { isClockwise, normaliseAngle, roundOff } from 'lib/utils'
import {
  SegmentOverlay,
  SegmentOverlayPayload,
  SegmentOverlays,
} from 'machines/modelingMachine'
import { SegmentInputs } from 'lang/std/stdTypes'
import { err } from 'lib/trap'
import { sceneInfra } from 'lib/singletons'
import { Selections } from 'lib/selections'
import { calculate_circle_from_3_points } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { commandBarActor } from 'machines/commandBarMachine'

interface CreateSegmentArgs {
  input: SegmentInputs
  prevSegment: Sketch['paths'][number]
  id: string
  pathToNode: PathToNode
  isDraftSegment?: boolean
  scale?: number
  callExpName: string
  texture: Texture
  theme: Themes
  isSelected?: boolean
  sceneInfra: SceneInfra
  selection?: Selections
}

interface UpdateSegmentArgs {
  input: SegmentInputs
  prevSegment: Sketch['paths'][number]
  group: Group
  sceneInfra: SceneInfra
  scale?: number
}

interface CreateSegmentResult {
  group: Group
  updateOverlaysCallback: () => SegmentOverlayPayload | null
}

export interface SegmentUtils {
  /**
   * the init is responsible for adding all of the correct entities to the group with important details like `mesh.name = ...`
   * as these act like handles later
   *
   * It's **Not** responsible for doing all calculations to size and position the entities as this would be duplicated in the update function
   * Which should instead be called at the end of the init function
   */
  init: (args: CreateSegmentArgs) => CreateSegmentResult | Error
  /**
   * The update function is responsible for updating the group with the correct size and position of the entities
   * It should be called at the end of the init function and return a callback that can be used to update the overlay
   *
   * It returns a callback for updating the overlays, this is so the overlays do not have to update at the same pace threeJs does
   * This is useful for performance reasons
   */
  update: (
    args: UpdateSegmentArgs
  ) => CreateSegmentResult['updateOverlaysCallback'] | Error
}

class StraightSegment implements SegmentUtils {
  init: SegmentUtils['init'] = ({
    input,
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
    selection,
  }) => {
    if (input.type !== 'straight-segment')
      return new Error('Invalid segment type')
    const { from, to } = input
    const baseColor =
      callExpName === 'close' ? 0x444444 : getThemeColorForThreeJs(theme)
    const color = isSelected ? 0x0000ff : baseColor
    const meshType = isDraftSegment
      ? STRAIGHT_SEGMENT_DASH
      : STRAIGHT_SEGMENT_BODY

    const segmentGroup = new Group()
    const shape = new Shape()
    const line = new LineCurve3(
      new Vector3(from[0], from[1], 0),
      new Vector3(to[0], to[1], 0)
    )
    const geometry = new ExtrudeGeometry(shape, {
      steps: 2,
      bevelEnabled: false,
      extrudePath: line,
    })
    const body = new MeshBasicMaterial({ color })
    const mesh = new Mesh(geometry, body)

    mesh.userData.type = meshType
    mesh.name = meshType
    segmentGroup.name = STRAIGHT_SEGMENT
    segmentGroup.userData = {
      type: STRAIGHT_SEGMENT,
      draft: isDraftSegment,
      id,
      from,
      to,
      pathToNode,
      isSelected,
      callExpName,
      baseColor,
      selection,
    }

    // All segment types get an extra segment handle,
    // Which is a little plus sign that appears at the origin of the segment
    // and can be dragged to insert a new segment
    const extraSegmentGroup = createExtraSegmentHandle(scale, texture, theme)

    // Segment decorators that only apply to non-close segments
    if (callExpName !== 'close') {
      // an arrowhead that appears at the end of the segment
      const arrowGroup = createArrowhead(scale, theme, color)
      // A length indicator that appears at the midpoint of the segment
      const lengthIndicatorGroup = createLengthIndicator({
        from,
        to,
        scale,
      })
      segmentGroup.add(arrowGroup)
      segmentGroup.add(lengthIndicatorGroup)
    }

    segmentGroup.add(mesh, extraSegmentGroup)
    let updateOverlaysCallback = this.update({
      prevSegment,
      input,
      group: segmentGroup,
      scale,
      sceneInfra,
    })
    if (err(updateOverlaysCallback)) return updateOverlaysCallback

    return {
      group: segmentGroup,
      updateOverlaysCallback,
    }
  }

  update: SegmentUtils['update'] = ({
    input,
    group,
    scale = 1,
    sceneInfra,
  }) => {
    if (input.type !== 'straight-segment')
      return new Error('Invalid segment type')
    const { from, to } = input
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
        handle: arrowGroup,
        group,
        isHandlesVisible,
        from,
        to,
        hasThreeDotMenu: true,
      })
  }
}

class TangentialArcToSegment implements SegmentUtils {
  init: SegmentUtils['init'] = ({
    prevSegment,
    input,
    id,
    pathToNode,
    isDraftSegment,
    scale = 1,
    texture,
    theme,
    isSelected,
    sceneInfra,
  }) => {
    if (input.type !== 'straight-segment')
      return new Error('Invalid segment type')
    const { from, to } = input
    const meshName = isDraftSegment
      ? TANGENTIAL_ARC_TO__SEGMENT_DASH
      : TANGENTIAL_ARC_TO_SEGMENT_BODY

    const group = new Group()
    const geometry = createArcGeometry({
      center: [0, 0],
      radius: 1,
      startAngle: 0,
      endAngle: 1,
      ccw: true,
      isDashed: isDraftSegment,
      scale,
    })
    const baseColor = getThemeColorForThreeJs(theme)
    const color = isSelected ? 0x0000ff : baseColor
    const body = new MeshBasicMaterial({ color })
    const mesh = new Mesh(geometry, body)
    const arrowGroup = createArrowhead(scale, theme, color)
    const extraSegmentGroup = createExtraSegmentHandle(scale, texture, theme)

    group.name = TANGENTIAL_ARC_TO_SEGMENT
    mesh.userData.type = meshName
    mesh.name = meshName
    group.userData = {
      type: TANGENTIAL_ARC_TO_SEGMENT,
      draft: isDraftSegment,
      id,
      from,
      to,
      prevSegment,
      pathToNode,
      isSelected,
      baseColor,
    }

    group.add(mesh, arrowGroup, extraSegmentGroup)
    const updateOverlaysCallback = this.update({
      prevSegment,
      input,
      group,
      scale,
      sceneInfra,
    })
    if (err(updateOverlaysCallback)) return updateOverlaysCallback

    return {
      group,
      updateOverlaysCallback,
    }
  }

  update: SegmentUtils['update'] = ({
    prevSegment,
    input,
    group,
    scale = 1,
    sceneInfra,
  }) => {
    if (input.type !== 'straight-segment')
      return new Error('Invalid segment type')
    const { from, to } = input
    group.userData.from = from
    group.userData.to = to
    group.userData.prevSegment = prevSegment
    const arrowGroup = group.getObjectByName(ARROWHEAD) as Group
    const extraSegmentGroup = group.getObjectByName(EXTRA_SEGMENT_HANDLE)

    let previousPoint = prevSegment.from
    if (prevSegment?.type === 'TangentialArcTo') {
      previousPoint = getTangentPointFromPreviousArc(
        prevSegment.center,
        prevSegment.ccw,
        prevSegment.to
      )
    } else if (prevSegment?.type === 'ArcThreePoint') {
      const arcDetails = calculate_circle_from_3_points(
        prevSegment.p1[0],
        prevSegment.p1[1],
        prevSegment.p2[0],
        prevSegment.p2[1],
        prevSegment.p3[0],
        prevSegment.p3[1]
      )
      previousPoint = getTangentPointFromPreviousArc(
        [arcDetails.center_x, arcDetails.center_y],
        !isClockwise([prevSegment.p1, prevSegment.p2, prevSegment.p3]),
        prevSegment.p3
      )
    }

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
        handle: arrowGroup,
        group,
        isHandlesVisible,
        from,
        to,
        angle,
        hasThreeDotMenu: true,
      })
  }
}

class CircleSegment implements SegmentUtils {
  init: SegmentUtils['init'] = ({
    prevSegment,
    input,
    id,
    pathToNode,
    isDraftSegment,
    scale = 1,
    theme,
    isSelected,
    sceneInfra,
  }) => {
    if (input.type !== 'arc-segment') {
      return new Error('Invalid segment type')
    }
    const { from, center, radius } = input
    const baseColor = getThemeColorForThreeJs(theme)
    const color = isSelected ? 0x0000ff : baseColor

    const group = new Group()
    const geometry = createArcGeometry({
      center,
      radius,
      startAngle: 0,
      endAngle: Math.PI * 2,
      ccw: true,
      isDashed: isDraftSegment,
      scale,
    })
    const mat = new MeshBasicMaterial({ color })
    const arcMesh = new Mesh(geometry, mat)
    const meshType = isDraftSegment ? CIRCLE_SEGMENT_DASH : CIRCLE_SEGMENT_BODY
    const arrowGroup = createArrowhead(scale, theme, color)
    const circleCenterGroup = createCircleCenterHandle(scale, theme, color)
    // A radius indicator that appears from the center to the perimeter
    const radiusIndicatorGroup = createLengthIndicator({
      from: center,
      to: [center[0] + radius, center[1]],
      scale,
    })

    arcMesh.userData.type = meshType
    arcMesh.name = meshType
    group.userData = {
      type: CIRCLE_SEGMENT,
      draft: isDraftSegment,
      id,
      from,
      radius,
      center,
      ccw: true,
      prevSegment,
      pathToNode,
      isSelected,
      baseColor,
    }
    group.name = CIRCLE_SEGMENT

    group.add(arcMesh, arrowGroup, circleCenterGroup, radiusIndicatorGroup)
    const updateOverlaysCallback = this.update({
      prevSegment,
      input,
      group,
      scale,
      sceneInfra,
    })
    if (err(updateOverlaysCallback)) return updateOverlaysCallback

    return {
      group,
      updateOverlaysCallback,
    }
  }
  update: SegmentUtils['update'] = ({
    prevSegment,
    input,
    group,
    scale = 1,
    sceneInfra,
  }) => {
    if (input.type !== 'arc-segment') {
      return new Error('Invalid segment type')
    }
    const { from, center, radius } = input
    group.userData.from = from
    group.userData.center = center
    group.userData.radius = radius
    group.userData.prevSegment = prevSegment
    const arrowGroup = group.getObjectByName(ARROWHEAD) as Group
    const radiusLengthIndicator = group.getObjectByName(
      SEGMENT_LENGTH_LABEL
    ) as Group
    const circleCenterHandle = group.getObjectByName(
      CIRCLE_CENTER_HANDLE
    ) as Group

    const pxLength = (2 * radius * Math.PI) / scale
    const shouldHideIdle = pxLength < HIDE_SEGMENT_LENGTH
    const shouldHideHover = pxLength < HIDE_HOVER_SEGMENT_LENGTH

    const hoveredParent =
      sceneInfra.hoveredObject &&
      getParentGroup(sceneInfra.hoveredObject, [CIRCLE_SEGMENT])
    let isHandlesVisible = !shouldHideIdle
    if (hoveredParent && hoveredParent?.uuid === group?.uuid) {
      isHandlesVisible = !shouldHideHover
    }

    if (arrowGroup) {
      // The arrowhead is placed at the perimeter of the circle,
      // pointing up and to the right
      const arrowPoint = {
        x: center[0] + Math.cos(Math.PI / 4) * radius,
        y: center[1] + Math.sin(Math.PI / 4) * radius,
      }

      arrowGroup.position.set(arrowPoint.x, arrowPoint.y, 0)

      const arrowheadAngle = Math.PI / 4
      arrowGroup.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(Math.cos(arrowheadAngle), Math.sin(arrowheadAngle), 0)
      )
      arrowGroup.scale.set(scale, scale, scale)
      arrowGroup.visible = isHandlesVisible
    }

    if (radiusLengthIndicator) {
      // The radius indicator is placed halfway between the center and the start angle point
      const indicatorPoint = {
        x:
          center[0] +
          (Math.cos(Math.atan2(from[1] - center[1], from[0] - center[0])) *
            radius) /
            2,
        y:
          center[1] +
          (Math.sin(Math.atan2(from[1] - center[1], from[0] - center[0])) *
            radius) /
            2,
      }
      const labelWrapper = radiusLengthIndicator.getObjectByName(
        SEGMENT_LENGTH_LABEL_TEXT
      ) as CSS2DObject
      const labelWrapperElem = labelWrapper.element as HTMLDivElement
      const label = labelWrapperElem.children[0] as HTMLParagraphElement
      label.innerText = `${roundOff(radius)}`
      label.classList.add(SEGMENT_LENGTH_LABEL_TEXT)

      // Calculate the angle for the label
      const labelAngle =
        (Math.atan2(from[1] - center[1], from[0] - center[0]) * 180) / Math.PI
      label.style.setProperty('--degree', `${labelAngle}deg`)
      label.style.setProperty('--x', `0px`)
      label.style.setProperty('--y', `0px`)
      labelWrapper.position.set(indicatorPoint.x, indicatorPoint.y, 0)
      radiusLengthIndicator.visible = isHandlesVisible
    }

    if (circleCenterHandle) {
      circleCenterHandle.position.set(center[0], center[1], 0)
      circleCenterHandle.scale.set(scale, scale, scale)
      circleCenterHandle.visible = isHandlesVisible
    }

    const circleSegmentBody = group.children.find(
      (child) => child.userData.type === CIRCLE_SEGMENT_BODY
    ) as Mesh

    if (circleSegmentBody) {
      const newGeo = createArcGeometry({
        radius,
        center,
        startAngle: 0,
        endAngle: Math.PI * 2,
        ccw: true,
        scale,
      })
      circleSegmentBody.geometry = newGeo
    }
    const circleSegmentBodyDashed = group.getObjectByName(CIRCLE_SEGMENT_DASH)
    if (circleSegmentBodyDashed instanceof Mesh) {
      // consider throttling the whole updateTangentialArcToSegment
      // if there are more perf considerations going forward
      circleSegmentBodyDashed.geometry = createArcGeometry({
        center,
        radius,
        ccw: true,
        // make the start end where the handle is
        startAngle: Math.PI * 0.25,
        endAngle: Math.PI * 2.25,
        isDashed: true,
        scale,
      })
    }
    return () =>
      sceneInfra.updateOverlayDetails({
        handle: arrowGroup,
        group,
        isHandlesVisible,
        from: from,
        to: [center[0], center[1]],
        angle: Math.PI / 4,
        hasThreeDotMenu: true,
      })
  }
}

class CircleThreePointSegment implements SegmentUtils {
  init: SegmentUtils['init'] = ({
    input,
    id,
    pathToNode,
    isDraftSegment,
    scale = 1,
    theme,
    isSelected = false,
    sceneInfra,
    prevSegment,
  }) => {
    if (input.type !== 'circle-three-point-segment') {
      return new Error('Invalid segment type')
    }
    const { p1, p2, p3 } = input
    const { center_x, center_y, radius } = calculate_circle_from_3_points(
      p1[0],
      p1[1],
      p2[0],
      p2[1],
      p3[0],
      p3[1]
    )
    const center: [number, number] = [center_x, center_y]
    const baseColor = getThemeColorForThreeJs(theme)
    const color = isSelected ? 0x0000ff : baseColor

    const group = new Group()
    const geometry = createArcGeometry({
      center,
      radius,
      startAngle: 0,
      endAngle: Math.PI * 2,
      ccw: true,
      isDashed: isDraftSegment,
      scale,
    })
    const mat = new MeshBasicMaterial({ color })
    const arcMesh = new Mesh(geometry, mat)
    const meshType = isDraftSegment
      ? CIRCLE_THREE_POINT_SEGMENT_DASH
      : CIRCLE_THREE_POINT_SEGMENT_BODY
    const handle1 = createCircleThreePointHandle(
      scale,
      theme,
      CIRCLE_THREE_POINT_HANDLE1,
      color
    )
    const handle2 = createCircleThreePointHandle(
      scale,
      theme,
      CIRCLE_THREE_POINT_HANDLE2,
      color
    )
    const handle3 = createCircleThreePointHandle(
      scale,
      theme,
      CIRCLE_THREE_POINT_HANDLE3,
      color
    )

    arcMesh.userData.type = meshType
    arcMesh.name = meshType
    group.userData = {
      type: CIRCLE_THREE_POINT_SEGMENT,
      draft: isDraftSegment,
      id,
      p1,
      p2,
      p3,
      ccw: true,
      prevSegment,
      pathToNode,
      isSelected,
      baseColor,
    }
    group.name = CIRCLE_THREE_POINT_SEGMENT

    group.add(arcMesh, handle1, handle2, handle3)
    const updateOverlaysCallback = this.update({
      prevSegment,
      input,
      group,
      scale,
      sceneInfra,
    })
    if (err(updateOverlaysCallback)) return updateOverlaysCallback

    return {
      group,
      updateOverlaysCallback,
    }
  }
  update: SegmentUtils['update'] = ({
    input,
    group,
    scale = 1,
    sceneInfra,
  }) => {
    if (input.type !== 'circle-three-point-segment') {
      return new Error('Invalid segment type')
    }
    const { p1, p2, p3 } = input
    group.userData.p1 = p1
    group.userData.p2 = p2
    group.userData.p3 = p3
    const { center_x, center_y, radius } = calculate_circle_from_3_points(
      p1[0],
      p1[1],
      p2[0],
      p2[1],
      p3[0],
      p3[1]
    )
    const center: [number, number] = [center_x, center_y]
    const points = [p1, p2, p3]
    const handles = [
      CIRCLE_THREE_POINT_HANDLE1,
      CIRCLE_THREE_POINT_HANDLE2,
      CIRCLE_THREE_POINT_HANDLE3,
    ].map((handle) => group.getObjectByName(handle) as Group)
    handles.forEach((handle, i) => {
      const point = points[i]
      if (handle && point) {
        handle.position.set(point[0], point[1], 0)
        handle.scale.set(scale, scale, scale)
        handle.visible = true
      }
    })

    const pxLength = (2 * radius * Math.PI) / scale
    const shouldHideIdle = pxLength < HIDE_SEGMENT_LENGTH
    const shouldHideHover = pxLength < HIDE_HOVER_SEGMENT_LENGTH

    const hoveredParent =
      sceneInfra.hoveredObject &&
      getParentGroup(sceneInfra.hoveredObject, [CIRCLE_SEGMENT])
    let isHandlesVisible = !shouldHideIdle
    if (hoveredParent && hoveredParent?.uuid === group?.uuid) {
      isHandlesVisible = !shouldHideHover
    }

    const circleSegmentBody = group.children.find(
      (child) => child.userData.type === CIRCLE_THREE_POINT_SEGMENT_BODY
    ) as Mesh

    if (circleSegmentBody) {
      const newGeo = createArcGeometry({
        radius,
        center,
        startAngle: 0,
        endAngle: Math.PI * 2,
        ccw: true,
        scale,
      })
      circleSegmentBody.geometry = newGeo
    }
    const circleSegmentBodyDashed = group.getObjectByName(
      CIRCLE_THREE_POINT_SEGMENT_DASH
    )
    if (circleSegmentBodyDashed instanceof Mesh) {
      // consider throttling the whole updateTangentialArcToSegment
      // if there are more perf considerations going forward
      circleSegmentBodyDashed.geometry = createArcGeometry({
        center,
        radius,
        ccw: true,
        // make the start end where the handle is
        startAngle: Math.PI * 0.25,
        endAngle: Math.PI * 2.25,
        isDashed: true,
        scale,
      })
    }
    return () => {
      const overlays: SegmentOverlays = {}
      const points = [p1, p2, p3]
      const overlayDetails = handles.map((handle, index) => {
        const currentPoint = points[index]
        const angle = Math.atan2(
          currentPoint[1] - center[1],
          currentPoint[0] - center[0]
        )
        return sceneInfra.updateOverlayDetails({
          handle,
          group,
          isHandlesVisible,
          from: [0, 0],
          to: [center[0], center[1]],
          angle: angle,
          hasThreeDotMenu: index === 0,
        })
      })
      const segmentOverlays: SegmentOverlay[] = []
      overlayDetails.forEach((payload, index) => {
        if (payload?.type === 'set-one') {
          overlays[payload.pathToNodeString] = payload.seg
          segmentOverlays.push({
            ...payload.seg[0],
            filterValue: index === 0 ? 'p1' : index === 1 ? 'p2' : 'p3',
          })
        }
      })
      const segmentOverlayPayload: SegmentOverlayPayload = {
        type: 'set-one',
        pathToNodeString:
          overlayDetails[0]?.type === 'set-one'
            ? overlayDetails[0].pathToNodeString
            : '',
        seg: segmentOverlays,
      }
      return segmentOverlayPayload
    }
  }
}

class ArcSegment implements SegmentUtils {
  init: SegmentUtils['init'] = ({
    prevSegment,
    input,
    id,
    pathToNode,
    isDraftSegment,
    scale = 1,
    theme,
    isSelected,
    sceneInfra,
  }) => {
    if (input.type !== 'arc-segment') {
      return new Error('Invalid segment type')
    }
    const { from, to, center, radius, ccw } = input
    const baseColor = getThemeColorForThreeJs(theme)
    const color = isSelected ? 0x0000ff : baseColor

    // Calculate start and end angles
    const startAngle = Math.atan2(from[1] - center[1], from[0] - center[0])
    const endAngle = Math.atan2(to[1] - center[1], to[0] - center[0])

    const group = new Group()
    const geometry = createArcGeometry({
      center,
      radius,
      startAngle,
      endAngle,
      ccw,
      isDashed: isDraftSegment,
      scale,
    })
    const mat = new MeshBasicMaterial({ color })
    const arcMesh = new Mesh(geometry, mat)
    const meshType = isDraftSegment ? ARC_SEGMENT_DASH : ARC_SEGMENT_BODY

    // Create handles for the arc

    const endAngleHandle = createArrowhead(scale, theme, color)
    endAngleHandle.name = ARC_ANGLE_END
    endAngleHandle.userData.type = ARC_ANGLE_END

    const circleCenterGroup = createCircleCenterHandle(scale, theme, color)

    // A radius indicator that appears from the center to the perimeter
    const radiusIndicatorGroup = createLengthIndicator({
      from: center,
      to: from,
      scale,
    })

    // Create a line from the center to the 'to' point
    const centerToFromLine = createLine({
      from: center,
      to: from,
      scale,
      color: 0xaaaaaa, // Light gray color for the line
    })
    centerToFromLine.name = ARC_CENTER_TO_FROM
    const centerToToLine = createLine({
      from: center,
      to,
      scale,
      color: 0xaaaaaa, // Light gray color for the line
    })
    centerToToLine.name = ARC_CENTER_TO_TO
    const angleReferenceLine = createLine({
      // from: center,
      from: [center[0] + 28 * scale, center[1]],
      to: [center[0] + 32 * scale, center[1]],
      scale,
      color: 0xaaaaaa, // Light gray color for the line
    })
    angleReferenceLine.name = ARC_ANGLE_REFERENCE_LINE

    // Create a curved line with an arrow to indicate the angle
    const angleIndicator = createAngleIndicator({
      center,
      radius: radius / 2, // Half the radius for the indicator
      startAngle: 0,
      endAngle,
      scale,
      color: 0xaaaaaa, // Red color for the angle indicator
    }) as Line
    angleIndicator.name = 'angleIndicator'

    // Create a new angle indicator for the end angle
    const endAngleIndicator = createAngleIndicator({
      center,
      radius: radius / 2, // Half the radius for the indicator
      startAngle: 0,
      endAngle: (endAngle * Math.PI) / 180,
      scale,
      color: 0xaaaaaa, // Green color for the end angle indicator
    }) as Line
    endAngleIndicator.name = 'endAngleIndicator'

    // Create a length indicator for the end angle
    const endAngleLengthIndicator = createLengthIndicator({
      from: center,
      to: [
        center[0] + Math.cos(endAngle) * radius,
        center[1] + Math.sin(endAngle) * radius,
      ],
      scale,
    })
    endAngleLengthIndicator.name = 'endAngleLengthIndicator'

    arcMesh.userData.type = meshType
    arcMesh.name = meshType
    group.userData = {
      type: ARC_SEGMENT,
      draft: isDraftSegment,
      id,
      from,
      to,
      radius,
      center,
      ccw,
      prevSegment,
      pathToNode,
      isSelected,
      baseColor,
    }
    group.name = ARC_SEGMENT

    group.add(
      arcMesh,
      endAngleHandle,
      circleCenterGroup,
      radiusIndicatorGroup,
      centerToFromLine,
      centerToToLine,
      angleReferenceLine,
      angleIndicator,
      endAngleIndicator,
      endAngleLengthIndicator
    )
    const updateOverlaysCallback = this.update({
      prevSegment,
      input,
      group,
      scale,
      sceneInfra,
    })
    if (err(updateOverlaysCallback)) return updateOverlaysCallback

    return {
      group,
      updateOverlaysCallback,
    }
  }

  update: SegmentUtils['update'] = ({
    prevSegment,
    input,
    group,
    scale = 1,
    sceneInfra,
  }) => {
    if (input.type !== 'arc-segment') {
      return new Error('Invalid segment type')
    }
    const { from, to, center, radius, ccw } = input
    group.userData.from = from
    group.userData.to = to
    group.userData.center = center
    group.userData.radius = radius
    group.userData.ccw = ccw
    group.userData.prevSegment = prevSegment

    // Calculate start and end angles
    const startAngle = Math.atan2(from[1] - center[1], from[0] - center[0])
    const endAngle = Math.atan2(to[1] - center[1], to[0] - center[0])

    // Normalize the angle to -180 to 180 degrees
    // const normalizedStartAngle = ((startAngle * 180 / Math.PI) + 180) % 360 - 180
    const normalizedStartAngle = normaliseAngle((startAngle * 180) / Math.PI)
    const normalizedEndAngle = (((endAngle * 180) / Math.PI + 180) % 360) - 180

    const endAngleHandle = group.getObjectByName(ARC_ANGLE_END) as Group
    const radiusLengthIndicator = group.getObjectByName(
      SEGMENT_LENGTH_LABEL
    ) as Group
    const circleCenterHandle = group.getObjectByName(
      CIRCLE_CENTER_HANDLE
    ) as Group

    // Calculate arc length
    let arcAngle = endAngle - startAngle
    if (ccw && arcAngle > 0) arcAngle = arcAngle - 2 * Math.PI
    if (!ccw && arcAngle < 0) arcAngle = arcAngle + 2 * Math.PI

    const arcLength = Math.abs(arcAngle) * radius
    const pxLength = arcLength / scale
    const shouldHideIdle = pxLength < HIDE_SEGMENT_LENGTH
    const shouldHideHover = pxLength < HIDE_HOVER_SEGMENT_LENGTH

    const hoveredParent =
      sceneInfra.hoveredObject &&
      getParentGroup(sceneInfra.hoveredObject, [ARC_SEGMENT])
    let isHandlesVisible = !shouldHideIdle
    if (hoveredParent && hoveredParent?.uuid === group?.uuid) {
      isHandlesVisible = !shouldHideHover
    }

    if (endAngleHandle) {
      endAngleHandle.position.set(to[0], to[1], 0)

      const tangentAngle = endAngle + (Math.PI / 2) * (ccw ? 1 : -1)
      endAngleHandle.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(Math.cos(tangentAngle), Math.sin(tangentAngle), 0)
      )
      endAngleHandle.scale.set(scale, scale, scale)
      endAngleHandle.visible = isHandlesVisible
    }

    if (radiusLengthIndicator) {
      // The radius indicator is placed halfway between the center and the start angle point
      const indicatorPoint = {
        x: center[0] + (Math.cos(startAngle) * radius) / 2,
        y: center[1] + (Math.sin(startAngle) * radius) / 2,
      }
      const labelWrapper = radiusLengthIndicator.getObjectByName(
        SEGMENT_LENGTH_LABEL_TEXT
      ) as CSS2DObject
      const labelWrapperElem = labelWrapper.element as HTMLDivElement
      const label = labelWrapperElem.children[0] as HTMLParagraphElement
      label.innerText = `R:${roundOff(radius)}${'\n'}A:${roundOff(
        roundOff((startAngle * 180) / Math.PI)
      )}`
      label.classList.add(SEGMENT_LENGTH_LABEL_TEXT)

      // Calculate the angle for the label
      label.style.setProperty('--degree', `-${startAngle}rad`)
      label.style.setProperty('--x', `0px`)
      label.style.setProperty('--y', `0px`)
      labelWrapper.position.set(indicatorPoint.x, indicatorPoint.y, 0)
      radiusLengthIndicator.visible = isHandlesVisible
    }

    if (circleCenterHandle) {
      circleCenterHandle.position.set(center[0], center[1], 0)
      circleCenterHandle.scale.set(scale, scale, scale)
      circleCenterHandle.visible = isHandlesVisible
    }

    const arcSegmentBody = group.children.find(
      (child) => child.userData.type === ARC_SEGMENT_BODY
    ) as Mesh

    if (arcSegmentBody) {
      const newGeo = createArcGeometry({
        radius,
        center,
        startAngle,
        endAngle,
        ccw,
        scale,
      })
      arcSegmentBody.geometry = newGeo
    }

    const arcSegmentBodyDashed = group.getObjectByName(ARC_SEGMENT_DASH)
    if (arcSegmentBodyDashed instanceof Mesh) {
      arcSegmentBodyDashed.geometry = createArcGeometry({
        center,
        radius,
        startAngle,
        endAngle,
        ccw,
        isDashed: true,
        scale,
      })
    }

    const centerToFromLine = group.getObjectByName(ARC_CENTER_TO_FROM) as Line
    if (centerToFromLine) {
      updateLine(centerToFromLine, { from: center, to: from, scale })
      centerToFromLine.visible = isHandlesVisible
    }
    const centerToToLine = group.getObjectByName(ARC_CENTER_TO_TO) as Line
    if (centerToToLine) {
      updateLine(centerToToLine, { from: center, to, scale })
      centerToToLine.visible = isHandlesVisible
    }
    const angleReferenceLine = group.getObjectByName(
      ARC_ANGLE_REFERENCE_LINE
    ) as Line
    if (angleReferenceLine) {
      updateLine(angleReferenceLine, {
        from: center,
        to: [center[0] + 34 * scale, center[1]],
        scale,
      })
      angleReferenceLine.visible = isHandlesVisible
    }

    const angleIndicator = group.getObjectByName('angleIndicator') as Line
    if (angleIndicator) {
      updateAngleIndicator(angleIndicator, {
        center,
        radiusPx: 20,
        startAngle: 0,
        endAngle: (normalizedStartAngle * Math.PI) / 180,
        scale,
      })
      angleIndicator.visible = isHandlesVisible
    }

    const endAngleIndicator = group.getObjectByName('endAngleIndicator') as Line
    if (endAngleIndicator) {
      updateAngleIndicator(endAngleIndicator, {
        center,
        radiusPx: 30,
        startAngle: 0,
        endAngle: (normalizedEndAngle * Math.PI) / 180,
        scale,
      })
      endAngleIndicator.visible = isHandlesVisible
    }

    const endAngleLengthIndicator = group.getObjectByName(
      'endAngleLengthIndicator'
    ) as Group
    if (endAngleLengthIndicator) {
      const labelWrapper = endAngleLengthIndicator.getObjectByName(
        SEGMENT_LENGTH_LABEL_TEXT
      ) as CSS2DObject
      const labelWrapperElem = labelWrapper.element as HTMLDivElement
      const label = labelWrapperElem.children[0] as HTMLParagraphElement
      label.innerText = `A:${roundOff(normalizedEndAngle)}`
      label.classList.add(SEGMENT_LENGTH_LABEL_TEXT)

      // Position the label
      const indicatorPoint = {
        x: center[0] + (Math.cos(endAngle) * radius) / 2,
        y: center[1] + (Math.sin(endAngle) * radius) / 2,
      }
      labelWrapper.position.set(indicatorPoint.x, indicatorPoint.y, 0)
      endAngleLengthIndicator.visible = isHandlesVisible
    }

    return () =>
      sceneInfra.updateOverlayDetails({
        handle: endAngleHandle,
        group,
        isHandlesVisible,
        from,
        to,
        angle: endAngle + (Math.PI / 2) * (ccw ? 1 : -1),
        hasThreeDotMenu: true,
      })
  }
}

class ThreePointArcSegment implements SegmentUtils {
  init: SegmentUtils['init'] = ({
    input,
    id,
    pathToNode,
    isDraftSegment,
    scale = 1,
    theme,
    isSelected = false,
    sceneInfra,
    prevSegment,
  }) => {
    if (input.type !== 'circle-three-point-segment') {
      return new Error('Invalid segment type')
    }
    const { p1, p2, p3 } = input
    const { center_x, center_y, radius } = calculate_circle_from_3_points(
      p1[0],
      p1[1],
      p2[0],
      p2[1],
      p3[0],
      p3[1]
    )
    const center: [number, number] = [center_x, center_y]
    const baseColor = getThemeColorForThreeJs(theme)
    const color = isSelected ? 0x0000ff : baseColor

    // Calculate start and end angles
    const startAngle = Math.atan2(p1[1] - center[1], p1[0] - center[0])
    const endAngle = Math.atan2(p3[1] - center[1], p3[0] - center[0])

    const group = new Group()
    const geometry = createArcGeometry({
      center,
      radius,
      startAngle,
      endAngle,
      ccw: !isClockwise([p1, p2, p3]),
      isDashed: isDraftSegment,
      scale,
    })
    const mat = new MeshBasicMaterial({ color })
    const arcMesh = new Mesh(geometry, mat)
    const meshType = isDraftSegment
      ? THREE_POINT_ARC_SEGMENT_DASH
      : THREE_POINT_ARC_SEGMENT_BODY

    // Create handles for p2 and p3 using createCircleThreePointHandle
    const p2Handle = createCircleThreePointHandle(
      scale,
      theme,
      THREE_POINT_ARC_HANDLE2,
      color
    )
    p2Handle.position.set(p2[0], p2[1], 0)

    const p3Handle = createCircleThreePointHandle(
      scale,
      theme,
      THREE_POINT_ARC_HANDLE3,
      color
    )
    p3Handle.position.set(p3[0], p3[1], 0)

    arcMesh.userData.type = meshType
    arcMesh.name = meshType
    group.userData = {
      type: THREE_POINT_ARC_SEGMENT,
      draft: isDraftSegment,
      id,
      from: p1,
      to: p3,
      p1,
      p2,
      p3,
      radius,
      center,
      ccw: false,
      prevSegment,
      pathToNode,
      isSelected,
      baseColor,
    }
    group.name = THREE_POINT_ARC_SEGMENT

    group.add(arcMesh, p2Handle, p3Handle)
    const updateOverlaysCallback = this.update({
      prevSegment,
      input,
      group,
      scale,
      sceneInfra,
    })
    if (err(updateOverlaysCallback)) return updateOverlaysCallback

    return {
      group,
      updateOverlaysCallback,
    }
  }

  update: SegmentUtils['update'] = ({
    prevSegment,
    input,
    group,
    scale = 1,
    sceneInfra,
  }) => {
    if (input.type !== 'circle-three-point-segment') {
      return new Error('Invalid segment type')
    }
    const { p1, p2, p3 } = input
    const { center_x, center_y, radius } = calculate_circle_from_3_points(
      p1[0],
      p1[1],
      p2[0],
      p2[1],
      p3[0],
      p3[1]
    )
    const center: [number, number] = [center_x, center_y]
    group.userData.from = p1
    group.userData.to = p3
    group.userData.p1 = p1
    group.userData.p2 = p2
    group.userData.p3 = p3
    group.userData.center = center
    group.userData.radius = radius
    group.userData.prevSegment = prevSegment

    // Calculate start and end angles
    const startAngle = Math.atan2(p1[1] - center[1], p1[0] - center[0])
    const endAngle = Math.atan2(p3[1] - center[1], p3[0] - center[0])

    const p2Handle = group.getObjectByName(THREE_POINT_ARC_HANDLE2) as Group
    const p3Handle = group.getObjectByName(THREE_POINT_ARC_HANDLE3) as Group

    const arcSegmentBody = group.children.find(
      (child) => child.userData.type === THREE_POINT_ARC_SEGMENT_BODY
    ) as Mesh

    if (arcSegmentBody) {
      const newGeo = createArcGeometry({
        radius,
        center,
        startAngle,
        endAngle,
        ccw: !isClockwise([p1, p2, p3]),
        scale,
      })
      arcSegmentBody.geometry = newGeo
    }

    const arcSegmentBodyDashed = group.getObjectByName(
      THREE_POINT_ARC_SEGMENT_DASH
    )
    if (arcSegmentBodyDashed instanceof Mesh) {
      arcSegmentBodyDashed.geometry = createArcGeometry({
        center,
        radius,
        startAngle,
        endAngle,
        ccw: !isClockwise([p1, p2, p3]),
        isDashed: true,
        scale,
      })
    }

    if (p2Handle) {
      p2Handle.position.set(p2[0], p2[1], 0)
      p2Handle.scale.set(scale, scale, scale)
      p2Handle.visible = true
    }

    if (p3Handle) {
      p3Handle.position.set(p3[0], p3[1], 0)
      p3Handle.scale.set(scale, scale, scale)
      p3Handle.visible = true
    }

    return () => {
      const overlays: SegmentOverlays = {}
      const overlayDetails = [p2Handle, p3Handle].map((handle, index) =>
        sceneInfra.updateOverlayDetails({
          handle: handle,
          group,
          isHandlesVisible: true,
          from: p1,
          to: p3,
          angle: endAngle + Math.PI / 2,
          hasThreeDotMenu: true,
        })
      )
      const segmentOverlays: SegmentOverlay[] = []

      overlayDetails.forEach((payload, index) => {
        if (payload?.type === 'set-one') {
          overlays[payload.pathToNodeString] = payload.seg
          // Add filterValue: 'interior' for p2 and 'end' for p3
          segmentOverlays.push({
            ...payload.seg[0],
            filterValue: index === 0 ? 'interior' : 'end',
          })
        }
      })

      const segmentOverlayPayload: SegmentOverlayPayload = {
        type: 'set-one',
        pathToNodeString:
          overlayDetails[0]?.type === 'set-one'
            ? overlayDetails[0].pathToNodeString
            : '',
        seg: segmentOverlays,
      }
      return segmentOverlayPayload
    }
  }
}

export function createProfileStartHandle({
  from,
  isDraft = false,
  scale = 1,
  theme,
  isSelected,
  size = 12,
  ...rest
}: {
  from: Coords2d
  scale?: number
  theme: Themes
  isSelected?: boolean
  size?: number
} & (
  | { isDraft: true }
  | { isDraft: false; id: string; pathToNode: PathToNode }
)) {
  const group = new Group()

  const geometry = new BoxGeometry(size, size, size) // in pixels scaled later
  const baseColor = getThemeColorForThreeJs(theme)
  const color = isSelected ? 0x0000ff : baseColor
  const body = new MeshBasicMaterial({ color })
  const mesh = new Mesh(geometry, body)

  group.add(mesh)

  group.userData = {
    type: PROFILE_START,
    from,
    isSelected,
    baseColor,
    ...rest,
  }
  group.name = isDraft ? DRAFT_POINT : PROFILE_START
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
function createCircleCenterHandle(
  scale = 1,
  theme: Themes,
  color?: number
): Group {
  const circleCenterGroup = new Group()

  const geometry = new BoxGeometry(12, 12, 12) // in pixels scaled later
  const baseColor = getThemeColorForThreeJs(theme)
  const body = new MeshBasicMaterial({ color })
  const mesh = new Mesh(geometry, body)

  circleCenterGroup.add(mesh)

  circleCenterGroup.userData = {
    type: CIRCLE_CENTER_HANDLE,
    baseColor,
  }
  circleCenterGroup.name = CIRCLE_CENTER_HANDLE
  circleCenterGroup.scale.set(scale, scale, scale)
  return circleCenterGroup
}
function createCircleThreePointHandle(
  scale = 1,
  theme: Themes,
  name: string,
  color?: number
): Group {
  const circleCenterGroup = new Group()

  const geometry = new BoxGeometry(12, 12, 12) // in pixels scaled later
  const baseColor = getThemeColorForThreeJs(theme)
  const body = new MeshBasicMaterial({ color })
  const mesh = new Mesh(geometry, body)

  circleCenterGroup.add(mesh)

  circleCenterGroup.userData = {
    type: name,
    baseColor,
  }
  circleCenterGroup.name = name
  circleCenterGroup.scale.set(scale, scale, scale)
  return circleCenterGroup
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
  length = 0.1,
}: {
  from: Coords2d
  to: Coords2d
  scale: number
  length?: number
}) {
  const lengthIndicatorGroup = new Group()
  lengthIndicatorGroup.name = SEGMENT_LENGTH_LABEL

  // Make the elements
  const lengthIndicatorText = document.createElement('p')
  lengthIndicatorText.classList.add(SEGMENT_LENGTH_LABEL_TEXT)
  lengthIndicatorText.innerText = roundOff(length).toString()
  const lengthIndicatorWrapper = document.createElement('div')

  // Double click workflow
  lengthIndicatorWrapper.ondblclick = () => {
    const selection = lengthIndicatorGroup.parent?.userData.selection
    if (!selection) {
      console.error('Unable to dimension segment when clicking the label.')
      return
    }
    sceneInfra.modelingSend({
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: selection.graphSelections[0],
      },
    })

    // Command Bar
    commandBarActor.send({
      type: 'Find and select command',
      data: {
        name: 'Constrain length',
        groupId: 'modeling',
        argDefaultValues: {
          selection,
        },
      },
    })
  }

  // Style the elements
  lengthIndicatorWrapper.style.position = 'absolute'
  lengthIndicatorWrapper.style.pointerEvents = 'auto'
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
      steps: 1,
      bevelEnabled: false,
      extrudePath: new CatmullRomCurve3(
        remainingArcPoints.map((p) => new Vector3(p.x, p.y, 0))
      ),
    })
    dashGeometries.push(remainingArcGeometry)
  }

  const geo = dashGeometries.length
    ? mergeGeometries(dashGeometries)
    : new BufferGeometry()
  geo.userData.type = 'dashed'
  return geo
}

// (lee) The above is much more complex than necessary.
// I've derived the new code from:
// https://threejs.org/docs/#api/en/extras/curves/EllipseCurve
// I'm not sure why it wasn't done like this in the first place?
// I don't touch the code above because it may break something else.
export function createCircleGeometry({
  center,
  radius,
  color,
  isDashed = false,
  scale = 1,
}: {
  center: Coords2d
  radius: number
  color: number
  isDashed?: boolean
  scale?: number
}): Line {
  const circle = new EllipseCurve(
    center[0],
    center[1],
    radius,
    radius,
    0,
    Math.PI * 2,
    true,
    scale
  )
  const points = circle.getPoints(75) // just enough points to not see edges.
  const geometry = new BufferGeometry().setFromPoints(points)
  const material = !isDashed
    ? new LineBasicMaterial({ color })
    : new LineDashedMaterial({
        color,
        scale,
        dashSize: 6,
        gapSize: 6,
      })
  const line = new Line(geometry, material)
  line.computeLineDistances()
  return line
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
function createLine({
  from,
  to,
  scale,
  color,
}: {
  from: [number, number]
  to: [number, number]
  scale: number
  color: number
}): Line {
  // Implementation for creating a line
  const lineGeometry = new BufferGeometry().setFromPoints([
    new Vector3(from[0], from[1], 0),
    new Vector3(to[0], to[1], 0),
  ])
  const lineMaterial = new LineBasicMaterial({ color })
  return new Line(lineGeometry, lineMaterial)
}

function updateLine(
  line: Line,
  {
    from,
    to,
    scale,
  }: { from: [number, number]; to: [number, number]; scale: number }
) {
  // Implementation for updating a line
  const points = [
    new Vector3(from[0], from[1], 0),
    new Vector3(to[0], to[1], 0),
  ]
  line.geometry.setFromPoints(points)
}

function createAngleIndicator({
  center,
  radius,
  startAngle,
  endAngle,
  scale,
  color,
}: {
  center: [number, number]
  radius: number
  startAngle: number
  endAngle: number
  scale: number
  color: number
}): Line {
  // Implementation for creating an angle indicator
  const curve = new EllipseCurve(
    center[0],
    center[1],
    radius,
    radius,
    startAngle,
    endAngle,
    false,
    0
  )
  const points = curve.getPoints(50)
  const geometry = new BufferGeometry().setFromPoints(points)
  const material = new LineBasicMaterial({ color })
  return new Line(geometry, material)
}

function updateAngleIndicator(
  angleIndicator: Line,
  {
    center,
    radiusPx,
    startAngle,
    endAngle,
    scale,
  }: {
    center: [number, number]
    radiusPx: number
    startAngle: number
    endAngle: number
    scale: number
  }
) {
  // Implementation for updating an angle indicator

  const curve = new EllipseCurve(
    center[0],
    center[1],
    radiusPx * scale,
    radiusPx * scale,
    startAngle,
    endAngle,
    endAngle < startAngle,
    0
  )
  const points = curve.getPoints(50)
  angleIndicator.geometry.setFromPoints(points)
}

export const segmentUtils = {
  straight: new StraightSegment(),
  tangentialArcTo: new TangentialArcToSegment(),
  circle: new CircleSegment(),
  circleThreePoint: new CircleThreePointSegment(),
  arc: new ArcSegment(),
  threePointArc: new ThreePointArcSegment(),
} as const

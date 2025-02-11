import {
  BoxGeometry,
  DoubleSide,
  Group,
  Intersection,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Object3DEventMap,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  Scene,
  Vector2,
  Vector3,
} from 'three'
import {
  ANGLE_SNAP_THRESHOLD_DEGREES,
  ARROWHEAD,
  AXIS_GROUP,
  DRAFT_POINT,
  DRAFT_POINT_GROUP,
  getSceneScale,
  INTERSECTION_PLANE_LAYER,
  OnClickCallbackArgs,
  OnMouseEnterLeaveArgs,
  RAYCASTABLE_PLANE,
  SKETCH_GROUP_SEGMENTS,
  SKETCH_LAYER,
  X_AXIS,
  Y_AXIS,
} from './sceneInfra'
import { isQuaternionVertical, quaternionFromUpNForward } from './helpers'
import {
  CallExpression,
  parse,
  Path,
  PathToNode,
  PipeExpression,
  Program,
  ProgramMemory,
  recast,
  Sketch,
  VariableDeclaration,
  VariableDeclarator,
  sketchFromKclValue,
  defaultSourceRange,
  sourceRangeFromRust,
  resultIsOk,
  SourceRange,
  topLevelRange,
  CallExpressionKw,
} from 'lang/wasm'
import {
  engineCommandManager,
  kclManager,
  sceneInfra,
  codeManager,
  editorManager,
} from 'lib/singletons'
import { getNodeFromPath } from 'lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { executeAst, ToolTip } from 'lang/langHelpers'
import {
  createProfileStartHandle,
  SegmentUtils,
  segmentUtils,
} from './segments'
import {
  addCallExpressionsToPipe,
  addCloseToPipe,
  addNewSketchLn,
  changeSketchArguments,
  updateStartProfileAtArgs,
} from 'lang/std/sketch'
import { isArray, isOverlap, roundOff } from 'lib/utils'
import {
  createArrayExpression,
  createCallExpressionStdLib,
  createIdentifier,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createNodeFromExprSnippet,
  createObjectExpression,
  createPipeExpression,
  createPipeSubstitution,
  createVariableDeclaration,
  findUniqueName,
  getInsertIndex,
  insertNewStartProfileAt,
  updateSketchNodePathsWithInsertIndex,
} from 'lang/modifyAst'
import { Selections, getEventForSegmentSelection } from 'lib/selections'
import { createGridHelper, orthoScale, perspScale } from './helpers'
import { Models } from '@kittycad/lib'
import { uuidv4 } from 'lib/utils'
import {
  SegmentOverlayPayload,
  SketchDetails,
  SketchDetailsUpdate,
  SketchTool,
} from 'machines/modelingMachine'
import { EngineCommandManager } from 'lang/std/engineConnection'
import {
  getRectangleCallExpressions,
  updateRectangleSketch,
  updateCenterRectangleSketch,
} from 'lib/rectangleTool'
import { getThemeColorForThreeJs, Themes } from 'lib/theme'
import { err, reportRejection, trap } from 'lib/trap'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Point3d } from 'wasm-lib/kcl/bindings/Point3d'
import { SegmentInputs } from 'lang/std/stdTypes'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { radToDeg } from 'three/src/math/MathUtils'
import toast from 'react-hot-toast'
import { getArtifactFromRange, codeRefFromRange } from 'lang/std/artifactGraph'

type DraftSegment = 'line' | 'tangentialArcTo'

export const EXTRA_SEGMENT_HANDLE = 'extraSegmentHandle'
export const EXTRA_SEGMENT_OFFSET_PX = 8
export const PROFILE_START = 'profile-start'
export const STRAIGHT_SEGMENT = 'straight-segment'
export const STRAIGHT_SEGMENT_BODY = 'straight-segment-body'
export const STRAIGHT_SEGMENT_DASH = 'straight-segment-body-dashed'
export const TANGENTIAL_ARC_TO__SEGMENT_DASH =
  'tangential-arc-to-segment-body-dashed'
export const TANGENTIAL_ARC_TO_SEGMENT = 'tangential-arc-to-segment'
export const TANGENTIAL_ARC_TO_SEGMENT_BODY = 'tangential-arc-to-segment-body'
export const CIRCLE_THREE_POINT_SEGMENT = 'circle-three-point-segment'
export const CIRCLE_THREE_POINT_SEGMENT_BODY = 'circle-segment-body'
export const CIRCLE_THREE_POINT_SEGMENT_DASH =
  'circle-three-point-segment-body-dashed'
export const CIRCLE_THREE_POINT_HANDLE1 = 'circle-three-point-handle1'
export const CIRCLE_THREE_POINT_HANDLE2 = 'circle-three-point-handle2'
export const CIRCLE_THREE_POINT_HANDLE3 = 'circle-three-point-handle3'
export const CIRCLE_SEGMENT = 'circle-segment'
export const CIRCLE_SEGMENT_BODY = 'circle-segment-body'
export const CIRCLE_SEGMENT_DASH = 'circle-segment-body-dashed'
export const CIRCLE_CENTER_HANDLE = 'circle-center-handle'
export const SEGMENT_WIDTH_PX = 1.6
export const HIDE_SEGMENT_LENGTH = 75 // in pixels
export const HIDE_HOVER_SEGMENT_LENGTH = 60 // in pixels
export const SEGMENT_BODIES = [
  STRAIGHT_SEGMENT,
  TANGENTIAL_ARC_TO_SEGMENT,
  CIRCLE_SEGMENT,
  CIRCLE_THREE_POINT_SEGMENT,
]
export const SEGMENT_BODIES_PLUS_PROFILE_START = [
  ...SEGMENT_BODIES,
  PROFILE_START,
]

type Vec3Array = [number, number, number]

// This singleton Class is responsible for all of the things the user sees and interacts with.
// That mostly mean sketch elements.
// Cameras, controls, raycasters, etc are handled by sceneInfra
export class SceneEntities {
  engineCommandManager: EngineCommandManager
  scene: Scene
  sceneProgramMemory: ProgramMemory = ProgramMemory.empty()
  activeSegments: { [key: string]: Group } = {}
  intersectionPlane: Mesh | null = null
  axisGroup: Group | null = null
  draftPointGroups: Group[] = []
  currentSketchQuaternion: Quaternion | null = null
  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager
    this.scene = sceneInfra?.scene
    sceneInfra?.camControls.subscribeToCamChange(this.onCamChange)
    window.addEventListener('resize', this.onWindowResize)
    this.createIntersectionPlane()
  }

  onWindowResize = () => {
    this.onCamChange()
  }
  onCamChange = () => {
    const orthoFactor = orthoScale(sceneInfra.camControls.camera)
    const callbacks: (() => SegmentOverlayPayload | null)[] = []
    Object.values(this.activeSegments).forEach((segment, index) => {
      const factor =
        (sceneInfra.camControls.camera instanceof OrthographicCamera
          ? orthoFactor
          : perspScale(sceneInfra.camControls.camera, segment)) /
        sceneInfra._baseUnitMultiplier
      let input: SegmentInputs = {
        type: 'straight-segment',
        from: segment.userData.from,
        to: segment.userData.to,
      }
      let update: SegmentUtils['update'] | null = null
      if (
        segment.userData.from &&
        segment.userData.to &&
        segment.userData.type === STRAIGHT_SEGMENT
      ) {
        update = segmentUtils.straight.update
      }
      if (
        segment.userData.from &&
        segment.userData.to &&
        segment.userData.prevSegment &&
        segment.userData.type === TANGENTIAL_ARC_TO_SEGMENT
      ) {
        update = segmentUtils.tangentialArcTo.update
      }
      if (
        segment.userData.from &&
        segment.userData.center &&
        segment.userData.radius &&
        segment.userData.type === CIRCLE_SEGMENT
      ) {
        update = segmentUtils.circle.update
        input = {
          type: 'arc-segment',
          from: segment.userData.from,
          center: segment.userData.center,
          radius: segment.userData.radius,
        }
      }
      if (
        segment.userData.p1 &&
        segment.userData.p2 &&
        segment.userData.p3 &&
        segment.userData.type === CIRCLE_THREE_POINT_SEGMENT
      ) {
        update = segmentUtils.circleThreePoint.update
        input = {
          type: 'circle-three-point-segment',
          p1: segment.userData.p1,
          p2: segment.userData.p2,
          p3: segment.userData.p3,
        }
      }

      const callBack = update?.({
        prevSegment: segment.userData.prevSegment,
        input,
        group: segment,
        scale: factor,
        sceneInfra,
      })
      callBack && !err(callBack) && callbacks.push(callBack)
      if (segment.name === PROFILE_START) {
        segment.scale.set(factor, factor, factor)
      }
    })
    if (this.axisGroup) {
      const factor =
        sceneInfra.camControls.camera instanceof OrthographicCamera
          ? orthoFactor
          : perspScale(sceneInfra.camControls.camera, this.axisGroup)
      const x = this.axisGroup.getObjectByName(X_AXIS)
      x?.scale.set(1, factor / sceneInfra._baseUnitMultiplier, 1)
      const y = this.axisGroup.getObjectByName(Y_AXIS)
      y?.scale.set(factor / sceneInfra._baseUnitMultiplier, 1, 1)
    }
    sceneInfra.overlayCallbacks(callbacks)
  }

  createIntersectionPlane() {
    if (sceneInfra.scene.getObjectByName(RAYCASTABLE_PLANE)) {
      console.warn('createIntersectionPlane called when it already exists')
      return
    }
    const hundredM = 100_0000
    const planeGeometry = new PlaneGeometry(hundredM, hundredM)
    const planeMaterial = new MeshBasicMaterial({
      color: 0xff0000,
      side: DoubleSide,
      transparent: true,
      opacity: 0.5,
    })
    this.intersectionPlane = new Mesh(planeGeometry, planeMaterial)
    this.intersectionPlane.userData = { type: RAYCASTABLE_PLANE }
    this.intersectionPlane.name = RAYCASTABLE_PLANE
    this.intersectionPlane.layers.set(INTERSECTION_PLANE_LAYER)
    this.scene.add(this.intersectionPlane)
  }
  createSketchAxis(
    sketchPathToNode: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchPosition?: [number, number, number]
  ) {
    const orthoFactor = orthoScale(sceneInfra.camControls.camera)
    const baseXColor = 0x000055
    const baseYColor = 0x550000
    const axisPixelWidth = 1.6
    const xAxisGeometry = new BoxGeometry(100000, axisPixelWidth, 0.01)
    const yAxisGeometry = new BoxGeometry(axisPixelWidth, 100000, 0.01)
    const xAxisMaterial = new MeshBasicMaterial({
      color: baseXColor,
      depthTest: false,
    })
    const yAxisMaterial = new MeshBasicMaterial({
      color: baseYColor,
      depthTest: false,
    })
    const xAxisMesh = new Mesh(xAxisGeometry, xAxisMaterial)
    const yAxisMesh = new Mesh(yAxisGeometry, yAxisMaterial)
    xAxisMesh.renderOrder = -2
    yAxisMesh.renderOrder = -1
    xAxisMesh.userData = {
      type: X_AXIS,
      baseColor: baseXColor,
      isSelected: false,
    }
    yAxisMesh.userData = {
      type: Y_AXIS,
      baseColor: baseYColor,
      isSelected: false,
    }
    xAxisMesh.name = X_AXIS
    yAxisMesh.name = Y_AXIS

    this.axisGroup = new Group()
    const gridHelper = createGridHelper({ size: 100, divisions: 10 })
    gridHelper.position.z = -0.01
    gridHelper.renderOrder = -3 // is this working?
    gridHelper.name = 'gridHelper'
    const sceneScale = getSceneScale(
      sceneInfra.camControls.camera,
      sceneInfra.camControls.target
    )
    gridHelper.scale.set(sceneScale, sceneScale, sceneScale)

    const factor =
      sceneInfra.camControls.camera instanceof OrthographicCamera
        ? orthoFactor
        : perspScale(sceneInfra.camControls.camera, this.axisGroup)
    xAxisMesh?.scale.set(1, factor / sceneInfra._baseUnitMultiplier, 1)
    yAxisMesh?.scale.set(factor / sceneInfra._baseUnitMultiplier, 1, 1)

    this.axisGroup.add(xAxisMesh, yAxisMesh, gridHelper)
    this.currentSketchQuaternion &&
      this.axisGroup.setRotationFromQuaternion(this.currentSketchQuaternion)

    this.axisGroup.userData = { type: AXIS_GROUP }
    this.axisGroup.name = AXIS_GROUP
    this.axisGroup.layers.set(SKETCH_LAYER)
    this.axisGroup.traverse((child) => {
      child.layers.set(SKETCH_LAYER)
    })

    const quat = quaternionFromUpNForward(
      new Vector3(...up),
      new Vector3(...forward)
    )
    this.axisGroup.setRotationFromQuaternion(quat)
    sketchPosition && this.axisGroup.position.set(...sketchPosition)
    this.scene.add(this.axisGroup)
  }
  getDraftPoint() {
    return this.scene.getObjectByName(DRAFT_POINT)
  }
  createDraftPoint({ point, group }: { point: Vector2; group: Group }) {
    const dummy = new Mesh()
    dummy.position.set(0, 0, 0)
    const scale = sceneInfra.getClientSceneScaleFactor(dummy)

    const draftPoint = createProfileStartHandle({
      isDraft: true,
      from: [point.x, point.y],
      scale,
      theme: sceneInfra._theme,
      // default is 12, this makes the draft point pop a bit more,
      // especially when snapping to the startProfileAt handle as it's it was the exact same size
      size: 16,
    })
    draftPoint.layers.set(SKETCH_LAYER)
    group.add(draftPoint)
  }

  removeDraftPoint() {
    const draftPoint = this.getDraftPoint()
    if (draftPoint) draftPoint.removeFromParent()
  }

  setupNoPointsListener({
    sketchDetails,
    afterClick,
    currentTool,
  }: {
    sketchDetails: SketchDetails
    currentTool: SketchTool
    afterClick: (
      args: OnClickCallbackArgs,
      updatedPaths: {
        sketchNodePaths: PathToNode[]
        sketchEntryNodePath: PathToNode
      }
    ) => void
  }) {
    // TODO: Consolidate shared logic between this and setupSketch
    // Which should just fire when the sketch mode is entered,
    // instead of in these two separate XState states.

    const draftPointGroup = new Group()
    this.draftPointGroups.push(draftPointGroup)
    draftPointGroup.name = DRAFT_POINT_GROUP
    sketchDetails.origin &&
      draftPointGroup.position.set(...sketchDetails.origin)
    if (!(sketchDetails.yAxis && sketchDetails)) {
      console.error('No sketch quaternion or sketch details found')
      return
    }
    this.currentSketchQuaternion = quaternionFromUpNForward(
      new Vector3(...sketchDetails.yAxis),
      new Vector3(...sketchDetails.zAxis)
    )
    draftPointGroup.setRotationFromQuaternion(this.currentSketchQuaternion)
    this.scene.add(draftPointGroup)

    const quaternion = quaternionFromUpNForward(
      new Vector3(...sketchDetails.yAxis),
      new Vector3(...sketchDetails.zAxis)
    )

    // Position the click raycast plane
    this.intersectionPlane!.setRotationFromQuaternion(quaternion)
    this.intersectionPlane!.position.copy(
      new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
    )
    sceneInfra.setCallbacks({
      onMove: (args) => {
        if (!args.intersects.length) return
        const axisIntersection = args.intersects.find(
          (sceneObject) =>
            sceneObject.object.name === X_AXIS ||
            sceneObject.object.name === Y_AXIS
        )

        const arrowHead = getParentGroup(args.intersects[0].object, [ARROWHEAD])
        const parent = getParentGroup(
          args.intersects[0].object,
          SEGMENT_BODIES_PLUS_PROFILE_START
        )
        if (
          !axisIntersection &&
          !(
            parent?.userData?.isLastInProfile &&
            (arrowHead || parent?.name === PROFILE_START)
          )
        )
          return
        const { intersectionPoint } = args
        // We're hovering over an axis, so we should show a draft point
        const snappedPoint = intersectionPoint.twoD.clone()
        if (axisIntersection?.object.name === X_AXIS) {
          snappedPoint.setComponent(1, 0)
        } else if (axisIntersection?.object.name === X_AXIS) {
          snappedPoint.setComponent(0, 0)
        } else if (arrowHead) {
          snappedPoint.set(arrowHead.position.x, arrowHead.position.y)
        } else if (parent?.name === PROFILE_START) {
          snappedPoint.set(parent.position.x, parent.position.y)
        }
        // Either create a new one or update the existing one
        const draftPoint = this.getDraftPoint()

        if (!draftPoint) {
          this.createDraftPoint({
            point: snappedPoint,
            group: draftPointGroup,
          })
        } else {
          // Ignore if there are huge jumps in the mouse position,
          // that is likely a strange behavior
          if (
            draftPoint.position.distanceTo(
              new Vector3(snappedPoint.x, snappedPoint.y, 0)
            ) > 100
          ) {
            return
          }
          draftPoint.position.set(snappedPoint.x, snappedPoint.y, 0)
        }
      },
      onMouseLeave: () => {
        this.removeDraftPoint()
      },
      onClick: async (args) => {
        this.removeDraftPoint()
        if (!args) return
        // If there is a valid camera interaction that matches, do that instead
        const interaction = sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        if (args.mouseEvent.which !== 1) return
        const { intersectionPoint } = args
        if (!intersectionPoint?.twoD || !sketchDetails?.sketchEntryNodePath)
          return

        const parent = getParentGroup(
          args?.intersects?.[0]?.object,
          SEGMENT_BODIES_PLUS_PROFILE_START
        )
        if (parent?.userData?.isLastInProfile) {
          afterClick(args, {
            sketchNodePaths: sketchDetails.sketchNodePaths,
            sketchEntryNodePath: parent.userData.pathToNode,
          })
          return
        } else if (currentTool === 'tangentialArc') {
          toast.error(
            'Tangential Arc must continue an existing profile, please click on the last segment of the profile'
          )
          return
        }

        // Snap to either or both axes
        // if the click intersects their meshes
        const yAxisIntersection = args.intersects.find(
          (sceneObject) => sceneObject.object.name === Y_AXIS
        )
        const xAxisIntersection = args.intersects.find(
          (sceneObject) => sceneObject.object.name === X_AXIS
        )

        const snappedClickPoint = {
          x: yAxisIntersection ? 0 : intersectionPoint.twoD.x,
          y: xAxisIntersection ? 0 : intersectionPoint.twoD.y,
        }

        const inserted = insertNewStartProfileAt(
          kclManager.ast,
          sketchDetails.sketchEntryNodePath,
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          [snappedClickPoint.x, snappedClickPoint.y],
          'end'
        )

        if (trap(inserted)) return
        const { modifiedAst } = inserted

        await kclManager.updateAst(modifiedAst, false)

        this.scene.remove(draftPointGroup)

        // Now perform the caller-specified action
        afterClick(args, {
          sketchNodePaths: inserted.updatedSketchNodePaths,
          sketchEntryNodePath: inserted.updatedEntryNodePath,
        })
      },
    })
  }

  async setupSketch({
    sketchEntryNodePath,
    sketchNodePaths,
    forward,
    up,
    position,
    maybeModdedAst,
    draftExpressionsIndices,
    selectionRanges,
  }: {
    sketchEntryNodePath: PathToNode
    sketchNodePaths: PathToNode[]
    maybeModdedAst: Node<Program>
    draftExpressionsIndices?: { start: number; end: number }
    forward: [number, number, number]
    up: [number, number, number]
    position?: [number, number, number]
    selectionRanges?: Selections
  }): Promise<{
    truncatedAst: Node<Program>
    programMemoryOverride: ProgramMemory
    variableDeclarationName: string
  }> {
    this.createIntersectionPlane()

    const prepared = this.prepareTruncatedMemoryAndAst(
      sketchNodePaths,
      maybeModdedAst
    )
    if (err(prepared)) return Promise.reject(prepared)
    const { truncatedAst, programMemoryOverride, variableDeclarationName } =
      prepared

    const { execState } = await executeAst({
      ast: truncatedAst,
      engineCommandManager: this.engineCommandManager,
      // We make sure to send an empty program memory to denote we mean mock mode.
      programMemoryOverride,
    })
    const programMemory = execState.memory
    const sketchesInfo = getSketchesInfo({
      sketchNodePaths,
      ast: maybeModdedAst,
      programMemory,
    })

    this.sceneProgramMemory = programMemory
    const group = new Group()
    position && group.position.set(...position)
    group.userData = {
      type: SKETCH_GROUP_SEGMENTS,
      pathToNode: sketchEntryNodePath,
    }
    const dummy = new Mesh()
    // TODO: When we actually have sketch positions and rotations we can use them here.
    dummy.position.set(0, 0, 0)
    const scale = sceneInfra.getClientSceneScaleFactor(dummy)

    const callbacks: (() => SegmentOverlayPayload | null)[] = []

    for (const sketchInfo of sketchesInfo) {
      const { sketch } = sketchInfo
      const segPathToNode = getNodePathFromSourceRange(
        maybeModdedAst,
        sourceRangeFromRust(sketch.start.__geoMeta.sourceRange)
      )
      if (
        ['Circle', 'CircleThreePoint'].includes(sketch?.paths?.[0]?.type) ===
        false
      ) {
        const _profileStart = createProfileStartHandle({
          from: sketch.start.from,
          id: sketch.start.__geoMeta.id,
          pathToNode: segPathToNode,
          scale,
          theme: sceneInfra._theme,
          isDraft: false,
        })
        _profileStart.layers.set(SKETCH_LAYER)
        _profileStart.traverse((child) => {
          child.layers.set(SKETCH_LAYER)
        })
        if (!sketch.paths.length) {
          _profileStart.userData.isLastInProfile = true
        }
        group.add(_profileStart)
        this.activeSegments[JSON.stringify(segPathToNode)] = _profileStart
      }
      sketch.paths.forEach((segment, index) => {
        const isLastInProfile =
          index === sketch.paths.length - 1 && segment.type !== 'Circle'
        let segPathToNode = getNodePathFromSourceRange(
          maybeModdedAst,
          sourceRangeFromRust(segment.__geoMeta.sourceRange)
        )
        if (
          draftExpressionsIndices &&
          (sketch.paths[index - 1] || sketch.start)
        ) {
          const previousSegment = sketch.paths[index - 1] || sketch.start
          const previousSegmentPathToNode = getNodePathFromSourceRange(
            maybeModdedAst,
            sourceRangeFromRust(previousSegment.__geoMeta.sourceRange)
          )
          const bodyIndex = previousSegmentPathToNode[1][0]
          segPathToNode = getNodePathFromSourceRange(
            truncatedAst,
            sourceRangeFromRust(segment.__geoMeta.sourceRange)
          )
          segPathToNode[1][0] = bodyIndex
        }
        const isDraftSegment =
          draftExpressionsIndices &&
          index <= draftExpressionsIndices.end &&
          index >= draftExpressionsIndices.start &&
          // the following line is not robust to sketches defined within a function
          sketchInfo.pathToNode[1][0] === sketchEntryNodePath[1][0]
        const isSelected = selectionRanges?.graphSelections.some((selection) =>
          isOverlap(
            selection?.codeRef?.range,
            sourceRangeFromRust(segment.__geoMeta.sourceRange)
          )
        )

        let seg: Group
        const _node1 = getNodeFromPath<Node<CallExpression | CallExpressionKw>>(
          maybeModdedAst,
          segPathToNode,
          ['CallExpression', 'CallExpressionKw']
        )
        if (err(_node1)) return
        const callExpName = _node1.node?.callee?.name

        const initSegment =
          segment.type === 'TangentialArcTo'
            ? segmentUtils.tangentialArcTo.init
            : segment.type === 'Circle'
            ? segmentUtils.circle.init
            : segment.type === 'CircleThreePoint'
            ? segmentUtils.circleThreePoint.init
            : segmentUtils.straight.init
        const input: SegmentInputs =
          segment.type === 'Circle'
            ? {
                type: 'arc-segment',
                from: segment.from,
                center: segment.center,
                radius: segment.radius,
              }
            : segment.type === 'CircleThreePoint'
            ? {
                type: 'circle-three-point-segment',
                p1: segment.p1,
                p2: segment.p2,
                p3: segment.p3,
              }
            : {
                type: 'straight-segment',
                from: segment.from,
                to: segment.to,
              }
        const startRange = _node1.node.start
        const endRange = _node1.node.end
        const sourceRange: SourceRange = [startRange, endRange, 0]
        const selection: Selections = computeSelectionFromSourceRangeAndAST(
          sourceRange,
          maybeModdedAst
        )
        const result = initSegment({
          prevSegment: sketch.paths[index - 1],
          callExpName,
          input,
          id: segment.__geoMeta.id,
          pathToNode: segPathToNode,
          isDraftSegment,
          scale,
          texture: sceneInfra.extraSegmentTexture,
          theme: sceneInfra._theme,
          isSelected,
          sceneInfra,
          selection,
        })
        if (err(result)) return
        const { group: _group, updateOverlaysCallback } = result
        seg = _group
        if (isLastInProfile) {
          seg.userData.isLastInProfile = true
        }
        callbacks.push(updateOverlaysCallback)
        seg.layers.set(SKETCH_LAYER)
        seg.traverse((child) => {
          child.layers.set(SKETCH_LAYER)
        })

        group.add(seg)
        this.activeSegments[JSON.stringify(segPathToNode)] = seg
      })
    }

    this.currentSketchQuaternion = quaternionFromUpNForward(
      new Vector3(...up),
      new Vector3(...forward)
    )
    group.setRotationFromQuaternion(this.currentSketchQuaternion)
    this.intersectionPlane &&
      this.intersectionPlane.setRotationFromQuaternion(
        this.currentSketchQuaternion
      )
    this.intersectionPlane &&
      position &&
      this.intersectionPlane.position.set(...position)
    this.scene.add(group)
    sceneInfra.camControls.enableRotate = false
    sceneInfra.overlayCallbacks(callbacks)

    return {
      truncatedAst,
      programMemoryOverride,
      variableDeclarationName,
    }
  }
  updateAstAndRejigSketch = async (
    sketchEntryNodePath: PathToNode,
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    modifiedAst: Node<Program> | Error,
    forward: [number, number, number],
    up: [number, number, number],
    origin: [number, number, number]
  ) => {
    if (trap(modifiedAst)) return Promise.reject(modifiedAst)
    const nextAst = await kclManager.updateAst(modifiedAst, false)
    this.tearDownSketch({ removeAxis: false })
    sceneInfra.resetMouseListeners()
    await this.setupSketch({
      sketchEntryNodePath,
      sketchNodePaths,
      forward,
      up,
      position: origin,
      maybeModdedAst: nextAst.newAst,
    })
    this.setupSketchIdleCallbacks({
      forward,
      up,
      position: origin,
      sketchEntryNodePath,
      sketchNodePaths,
      planeNodePath,
    })
    return nextAst
  }
  setupDraftSegment = async (
    sketchEntryNodePath: PathToNode,
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    origin: [number, number, number],
    segmentName: 'line' | 'tangentialArcTo' = 'line',
    shouldTearDown = true
  ) => {
    const _ast = structuredClone(kclManager.ast)

    const _node1 = getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchEntryNodePath || [],
      'VariableDeclaration'
    )
    if (trap(_node1)) return Promise.reject(_node1)
    const variableDeclarationName = _node1.node?.declaration.id?.name || ''

    const sg = sketchFromKclValue(
      kclManager.programMemory.get(variableDeclarationName),
      variableDeclarationName
    )
    if (err(sg)) return Promise.reject(sg)
    const lastSeg = sg?.paths?.slice(-1)[0] || sg.start

    const index = sg.paths.length // because we've added a new segment that's not in the memory yet, no need for `-1`
    const mod = addNewSketchLn({
      node: _ast,
      programMemory: kclManager.programMemory,
      input: {
        type: 'straight-segment',
        to: lastSeg.to,
        from: lastSeg.to,
      },
      fnName: segmentName,
      pathToNode: sketchEntryNodePath,
    })
    if (trap(mod)) return Promise.reject(mod)
    const pResult = parse(recast(mod.modifiedAst))
    if (trap(pResult) || !resultIsOk(pResult)) return Promise.reject(pResult)
    const modifiedAst = pResult.program

    const draftExpressionsIndices = { start: index, end: index }

    if (shouldTearDown) this.tearDownSketch({ removeAxis: false })
    sceneInfra.resetMouseListeners()

    const { truncatedAst, programMemoryOverride } = await this.setupSketch({
      sketchEntryNodePath,
      sketchNodePaths,
      forward,
      up,
      position: origin,
      maybeModdedAst: modifiedAst,
      draftExpressionsIndices,
    })
    sceneInfra.setCallbacks({
      onClick: async (args) => {
        if (!args) return
        // If there is a valid camera interaction that matches, do that instead
        const interaction = sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        if (args.mouseEvent.which !== 1) return

        const { intersectionPoint } = args
        let intersection2d = intersectionPoint?.twoD
        const intersectsProfileStart = args.intersects
          .map(({ object }) => getParentGroup(object, [PROFILE_START]))
          .find(isGroupStartProfileForCurrentProfile(sketchEntryNodePath))

        let modifiedAst: Program | Error = structuredClone(kclManager.ast)

        const sketch = sketchFromPathToNode({
          pathToNode: sketchEntryNodePath,
          ast: kclManager.ast,
          programMemory: kclManager.programMemory,
        })
        if (err(sketch)) return Promise.reject(sketch)
        if (!sketch) return Promise.reject(new Error('No sketch found'))

        // Snapping logic for the profile start handle
        if (intersectsProfileStart) {
          const lastSegment = sketch.paths.slice(-1)[0]
          const originCoords = createArrayExpression([
            createCallExpressionStdLib('profileStartX', [
              createPipeSubstitution(),
            ]),
            createCallExpressionStdLib('profileStartY', [
              createPipeSubstitution(),
            ]),
          ])
          modifiedAst = addCallExpressionsToPipe({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            pathToNode: sketchEntryNodePath,
            expressions: [
              lastSegment.type === 'TangentialArcTo'
                ? createCallExpressionStdLib('tangentialArcTo', [
                    originCoords,
                    createPipeSubstitution(),
                  ])
                : createCallExpressionStdLibKw('line', null, [
                    createLabeledArg('endAbsolute', originCoords),
                  ]),
            ],
          })
          if (trap(modifiedAst)) return Promise.reject(modifiedAst)
          modifiedAst = addCloseToPipe({
            node: modifiedAst,
            programMemory: kclManager.programMemory,
            pathToNode: sketchEntryNodePath,
          })
          if (trap(modifiedAst)) return Promise.reject(modifiedAst)
        } else if (intersection2d) {
          const intersectsYAxis = args.intersects.find(
            (sceneObject) => sceneObject.object.name === Y_AXIS
          )
          const intersectsXAxis = args.intersects.find(
            (sceneObject) => sceneObject.object.name === X_AXIS
          )

          const lastSegment = sketch.paths.slice(-1)[0] || sketch.start
          const snappedPoint = {
            x: intersectsYAxis ? 0 : intersection2d.x,
            y: intersectsXAxis ? 0 : intersection2d.y,
          }
          // Get the angle between the previous segment (or sketch start)'s end and this one's
          const angle = Math.atan2(
            snappedPoint.y - lastSegment.to[1],
            snappedPoint.x - lastSegment.to[0]
          )

          const isHorizontal =
            radToDeg(Math.abs(angle)) < ANGLE_SNAP_THRESHOLD_DEGREES ||
            Math.abs(radToDeg(Math.abs(angle) - Math.PI)) <
              ANGLE_SNAP_THRESHOLD_DEGREES
          const isVertical =
            Math.abs(radToDeg(Math.abs(angle) - Math.PI / 2)) <
            ANGLE_SNAP_THRESHOLD_DEGREES

          let resolvedFunctionName: ToolTip = 'line'

          // This might need to become its own function if we want more
          // case-based logic for different segment types
          if (
            (lastSegment.type === 'TangentialArcTo' &&
              segmentName !== 'line') ||
            segmentName === 'tangentialArcTo'
          ) {
            resolvedFunctionName = 'tangentialArcTo'
          } else if (isHorizontal) {
            // If the angle between is 0 or 180 degrees (+/- the snapping angle), make the line an xLine
            resolvedFunctionName = 'xLine'
          } else if (isVertical) {
            // If the angle between is 90 or 270 degrees (+/- the snapping angle), make the line a yLine
            resolvedFunctionName = 'yLine'
          } else if (snappedPoint.x === 0 || snappedPoint.y === 0) {
            // We consider a point placed on axes or origin to be absolute
            resolvedFunctionName = 'lineTo'
          }

          const tmp = addNewSketchLn({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            input: {
              type: 'straight-segment',
              from: [lastSegment.to[0], lastSegment.to[1]],
              to: [snappedPoint.x, snappedPoint.y],
            },
            fnName: resolvedFunctionName,
            pathToNode: sketchEntryNodePath,
          })
          if (trap(tmp)) return Promise.reject(tmp)
          modifiedAst = tmp.modifiedAst
          if (trap(modifiedAst)) return Promise.reject(modifiedAst)
        } else {
          // return early as we didn't modify the ast
          return
        }

        await kclManager.executeAstMock(modifiedAst)

        if (intersectsProfileStart) {
          sceneInfra.modelingSend({ type: 'Close sketch' })
        } else {
          await this.setupDraftSegment(
            sketchEntryNodePath,
            sketchNodePaths,
            planeNodePath,
            forward,
            up,
            origin,
            segmentName
          )
        }

        await codeManager.updateEditorWithAstAndWriteToFile(modifiedAst)
      },
      onMove: (args) => {
        const expressionIndex = Number(sketchEntryNodePath[1][0])
        const activeSegmentsInCorrectExpression = Object.values(
          this.activeSegments
        ).filter((seg) => {
          return seg.userData.pathToNode[1][0] === expressionIndex
        })
        const object =
          activeSegmentsInCorrectExpression[
            activeSegmentsInCorrectExpression.length - 1
          ]
        this.onDragSegment({
          intersection2d: args.intersectionPoint.twoD,
          object,
          intersects: args.intersects,
          sketchNodePaths,
          sketchEntryNodePath,
          planeNodePath,
          draftInfo: {
            truncatedAst,
            programMemoryOverride,
            variableDeclarationName,
          },
        })
      },
    })
  }
  setupDraftRectangle = async (
    sketchEntryNodePath: PathToNode,
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    rectangleOrigin: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(kclManager.ast)

    const varDec = getNodeFromPath<VariableDeclarator>(
      _ast,
      planeNodePath,
      'VariableDeclarator'
    )

    if (err(varDec)) return varDec
    if (varDec.node.type !== 'VariableDeclarator') return new Error('not a var')

    const varName = findUniqueName(_ast, 'profile')

    // first create just the variable declaration, as that's
    // all we want the user to see in the editor
    const tag = findUniqueName(_ast, 'rectangleSegmentA')
    const newDeclaration = createVariableDeclaration(
      varName,
      createCallExpressionStdLib('startProfileAt', [
        createArrayExpression([
          createLiteral(roundOff(rectangleOrigin[0])),
          createLiteral(roundOff(rectangleOrigin[1])),
        ]),
        createIdentifier(varDec.node.id.name),
      ])
    )

    const insertIndex = getInsertIndex(sketchNodePaths, planeNodePath, 'end')

    _ast.body.splice(insertIndex, 0, newDeclaration)
    const { updatedEntryNodePath, updatedSketchNodePaths } =
      updateSketchNodePathsWithInsertIndex({
        insertIndex,
        insertType: 'end',
        sketchNodePaths,
      })

    const pResult = parse(recast(_ast))
    if (trap(pResult) || !resultIsOk(pResult)) return Promise.reject(pResult)
    _ast = pResult.program

    // do a quick mock execution to get the program memory up-to-date
    await kclManager.executeAstMock(_ast)

    const justCreatedNode = getNodeFromPath<VariableDeclaration>(
      _ast,
      updatedEntryNodePath,
      'VariableDeclaration'
    )

    if (trap(justCreatedNode)) return Promise.reject(justCreatedNode)
    const startProfileAt = justCreatedNode.node?.declaration
    // than add the rest of the profile so we can "animate" it
    // as draft segments
    startProfileAt.init = createPipeExpression([
      startProfileAt?.init,
      ...getRectangleCallExpressions(rectangleOrigin, tag),
    ])

    const code = recast(_ast)
    const _recastAst = parse(code)
    if (trap(_recastAst) || !resultIsOk(_recastAst))
      return Promise.reject(_recastAst)
    _ast = _recastAst.program

    const { programMemoryOverride, truncatedAst } = await this.setupSketch({
      sketchEntryNodePath: updatedEntryNodePath,
      sketchNodePaths: updatedSketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 3 },
    })

    sceneInfra.setCallbacks({
      onMove: async (args) => {
        // Update the width and height of the draft rectangle

        const nodePathWithCorrectedIndexForTruncatedAst =
          structuredClone(updatedEntryNodePath)
        nodePathWithCorrectedIndexForTruncatedAst[1][0] =
          Number(nodePathWithCorrectedIndexForTruncatedAst[1][0]) -
          Number(planeNodePath[1][0]) -
          1

        const _node = getNodeFromPath<VariableDeclaration>(
          truncatedAst,
          nodePathWithCorrectedIndexForTruncatedAst,
          'VariableDeclaration'
        )
        if (trap(_node)) return Promise.reject(_node)
        const sketchInit = _node.node?.declaration.init

        const x = (args.intersectionPoint.twoD.x || 0) - rectangleOrigin[0]
        const y = (args.intersectionPoint.twoD.y || 0) - rectangleOrigin[1]

        if (sketchInit.type === 'PipeExpression') {
          updateRectangleSketch(sketchInit, x, y, tag)
        }

        const { execState } = await executeAst({
          ast: truncatedAst,
          engineCommandManager: this.engineCommandManager,
          // We make sure to send an empty program memory to denote we mean mock mode.
          programMemoryOverride,
        })
        const programMemory = execState.memory
        this.sceneProgramMemory = programMemory
        const sketch = sketchFromKclValue(programMemory.get(varName), varName)
        if (err(sketch)) return Promise.reject(sketch)
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(sceneInfra.camControls.camera)

        const varDecIndex = Number(updatedEntryNodePath[1][0])

        this.updateSegment(
          sketch.start,
          0,
          varDecIndex,
          _ast,
          orthoFactor,
          sketch
        )
        sgPaths.forEach((seg, index) =>
          this.updateSegment(seg, index, varDecIndex, _ast, orthoFactor, sketch)
        )
      },
      onClick: async (args) => {
        // If there is a valid camera interaction that matches, do that instead
        const interaction = sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        // Commit the rectangle to the full AST/code and return to sketch.idle
        const cornerPoint = args.intersectionPoint?.twoD
        if (!cornerPoint || args.mouseEvent.button !== 0) return

        const x = roundOff((cornerPoint.x || 0) - rectangleOrigin[0])
        const y = roundOff((cornerPoint.y || 0) - rectangleOrigin[1])

        const _node = getNodeFromPath<VariableDeclaration>(
          _ast,
          updatedEntryNodePath,
          'VariableDeclaration'
        )
        if (trap(_node)) return
        const sketchInit = _node.node?.declaration.init

        if (sketchInit.type !== 'PipeExpression') {
          return
        }

        updateRectangleSketch(sketchInit, x, y, tag)

        const newCode = recast(_ast)
        const pResult = parse(newCode)
        if (trap(pResult) || !resultIsOk(pResult))
          return Promise.reject(pResult)
        _ast = pResult.program

        // Update the primary AST and unequip the rectangle tool
        await kclManager.executeAstMock(_ast)
        sceneInfra.modelingSend({ type: 'Finish rectangle' })

        // lee: I had this at the bottom of the function, but it's
        // possible sketchFromKclValue "fails" when sketching on a face,
        // and this couldn't wouldn't run.
        await codeManager.updateEditorWithAstAndWriteToFile(_ast)
      },
    })
    return { updatedEntryNodePath, updatedSketchNodePaths }
  }
  setupDraftCenterRectangle = async (
    sketchEntryNodePath: PathToNode,
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    rectangleOrigin: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(kclManager.ast)

    const varDec = getNodeFromPath<VariableDeclarator>(
      _ast,
      planeNodePath,
      'VariableDeclarator'
    )

    if (err(varDec)) return varDec
    if (varDec.node.type !== 'VariableDeclarator') return new Error('not a var')

    const varName = findUniqueName(_ast, 'profile')
    // first create just the variable declaration, as that's
    // all we want the user to see in the editor
    const tag = findUniqueName(_ast, 'rectangleSegmentA')
    const newDeclaration = createVariableDeclaration(
      varName,
      createCallExpressionStdLib('startProfileAt', [
        createArrayExpression([
          createLiteral(roundOff(rectangleOrigin[0])),
          createLiteral(roundOff(rectangleOrigin[1])),
        ]),
        createIdentifier(varDec.node.id.name),
      ])
    )
    const insertIndex = getInsertIndex(sketchNodePaths, planeNodePath, 'end')

    _ast.body.splice(insertIndex, 0, newDeclaration)
    const { updatedEntryNodePath, updatedSketchNodePaths } =
      updateSketchNodePathsWithInsertIndex({
        insertIndex,
        insertType: 'end',
        sketchNodePaths,
      })

    let __recastAst = parse(recast(_ast))
    if (trap(__recastAst) || !resultIsOk(__recastAst))
      return Promise.reject(__recastAst)
    _ast = __recastAst.program

    // do a quick mock execution to get the program memory up-to-date
    await kclManager.executeAstMock(_ast)

    const justCreatedNode = getNodeFromPath<VariableDeclaration>(
      _ast,
      updatedEntryNodePath,
      'VariableDeclaration'
    )

    if (trap(justCreatedNode)) return Promise.reject(justCreatedNode)
    const startProfileAt = justCreatedNode.node?.declaration
    // than add the rest of the profile so we can "animate" it
    // as draft segments
    startProfileAt.init = createPipeExpression([
      startProfileAt?.init,
      ...getRectangleCallExpressions(rectangleOrigin, tag),
    ])
    const code = recast(_ast)
    __recastAst = parse(code)
    if (trap(__recastAst) || !resultIsOk(__recastAst))
      return Promise.reject(__recastAst)
    _ast = __recastAst.program

    const { programMemoryOverride, truncatedAst } = await this.setupSketch({
      sketchEntryNodePath: updatedEntryNodePath,
      sketchNodePaths: updatedSketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 3 },
    })

    sceneInfra.setCallbacks({
      onMove: async (args) => {
        // Update the width and height of the draft rectangle

        const nodePathWithCorrectedIndexForTruncatedAst =
          structuredClone(updatedEntryNodePath)
        nodePathWithCorrectedIndexForTruncatedAst[1][0] =
          Number(nodePathWithCorrectedIndexForTruncatedAst[1][0]) -
          Number(planeNodePath[1][0]) -
          1

        const _node = getNodeFromPath<VariableDeclaration>(
          truncatedAst,
          nodePathWithCorrectedIndexForTruncatedAst,
          'VariableDeclaration'
        )
        if (trap(_node)) return Promise.reject(_node)
        const sketchInit = _node.node?.declaration.init

        const x = (args.intersectionPoint.twoD.x || 0) - rectangleOrigin[0]
        const y = (args.intersectionPoint.twoD.y || 0) - rectangleOrigin[1]

        if (sketchInit.type === 'PipeExpression') {
          updateCenterRectangleSketch(
            sketchInit,
            x,
            y,
            tag,
            rectangleOrigin[0],
            rectangleOrigin[1]
          )
        }

        const { execState } = await executeAst({
          ast: truncatedAst,
          engineCommandManager: this.engineCommandManager,
          // We make sure to send an empty program memory to denote we mean mock mode.
          programMemoryOverride,
        })
        const programMemory = execState.memory
        this.sceneProgramMemory = programMemory
        const sketch = sketchFromKclValue(programMemory.get(varName), varName)
        if (err(sketch)) return Promise.reject(sketch)
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(sceneInfra.camControls.camera)

        const varDecIndex = Number(updatedEntryNodePath[1][0])

        this.updateSegment(
          sketch.start,
          0,
          varDecIndex,
          _ast,
          orthoFactor,
          sketch
        )
        sgPaths.forEach((seg, index) =>
          this.updateSegment(seg, index, varDecIndex, _ast, orthoFactor, sketch)
        )
      },
      onClick: async (args) => {
        // If there is a valid camera interaction that matches, do that instead
        const interaction = sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        // Commit the rectangle to the full AST/code and return to sketch.idle
        const cornerPoint = args.intersectionPoint?.twoD
        if (!cornerPoint || args.mouseEvent.button !== 0) return

        const x = roundOff((cornerPoint.x || 0) - rectangleOrigin[0])
        const y = roundOff((cornerPoint.y || 0) - rectangleOrigin[1])

        const _node = getNodeFromPath<VariableDeclaration>(
          _ast,
          updatedEntryNodePath,
          'VariableDeclaration'
        )
        if (trap(_node)) return
        const sketchInit = _node.node?.declaration.init

        if (sketchInit.type === 'PipeExpression') {
          updateCenterRectangleSketch(
            sketchInit,
            x,
            y,
            tag,
            rectangleOrigin[0],
            rectangleOrigin[1]
          )

          const pResult = parse(recast(_ast))
          if (trap(pResult) || !resultIsOk(pResult))
            return Promise.reject(pResult)
          _ast = pResult.program

          // Update the primary AST and unequip the rectangle tool
          await kclManager.executeAstMock(_ast)
          sceneInfra.modelingSend({ type: 'Finish center rectangle' })

          // lee: I had this at the bottom of the function, but it's
          // possible sketchFromKclValue "fails" when sketching on a face,
          // and this couldn't wouldn't run.
          await codeManager.updateEditorWithAstAndWriteToFile(_ast)
        }
      },
    })
    return { updatedEntryNodePath, updatedSketchNodePaths }
  }
  setupDraftCircleThreePoint = async (
    sketchEntryNodePath: PathToNode,
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    point1: [x: number, y: number],
    point2: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(kclManager.ast)

    const varDec = getNodeFromPath<VariableDeclarator>(
      _ast,
      planeNodePath,
      'VariableDeclarator'
    )

    if (err(varDec)) return varDec
    if (varDec.node.type !== 'VariableDeclarator') return new Error('not a var')

    const varName = findUniqueName(_ast, 'profile')

    const thirdPointCloseToWhereUserLastClicked = `[${roundOff(
      point2[0] + 0.1,
      2
    )}, ${roundOff(point2[1] + 0.1, 2)}]`
    const newExpression = createNodeFromExprSnippet`${varName} = circleThreePoint(
  ${varDec.node.id.name},
  p1 = [${roundOff(point1[0], 2)}, ${roundOff(point1[1], 2)}],
  p2 = [${roundOff(point2[0], 2)}, ${roundOff(point2[1], 2)}],
  p3 = ${thirdPointCloseToWhereUserLastClicked},
)`
    if (err(newExpression)) return newExpression
    const insertIndex = getInsertIndex(sketchNodePaths, planeNodePath, 'end')

    _ast.body.splice(insertIndex, 0, newExpression)
    const { updatedEntryNodePath, updatedSketchNodePaths } =
      updateSketchNodePathsWithInsertIndex({
        insertIndex,
        insertType: 'end',
        sketchNodePaths,
      })

    const pResult = parse(recast(_ast))
    if (trap(pResult) || !resultIsOk(pResult)) return Promise.reject(pResult)
    _ast = pResult.program

    // do a quick mock execution to get the program memory up-to-date
    await kclManager.executeAstMock(_ast)

    const { programMemoryOverride, truncatedAst } = await this.setupSketch({
      sketchEntryNodePath: updatedEntryNodePath,
      sketchNodePaths: updatedSketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 0 },
    })

    sceneInfra.setCallbacks({
      onMove: async (args) => {
        const firstProfileIndex = Number(updatedSketchNodePaths[0][1][0])
        const nodePathWithCorrectedIndexForTruncatedAst =
          structuredClone(updatedEntryNodePath)

        nodePathWithCorrectedIndexForTruncatedAst[1][0] =
          Number(nodePathWithCorrectedIndexForTruncatedAst[1][0]) -
          firstProfileIndex
        const _node = getNodeFromPath<VariableDeclaration>(
          truncatedAst,
          nodePathWithCorrectedIndexForTruncatedAst,
          'VariableDeclaration'
        )
        let modded = structuredClone(truncatedAst)
        if (trap(_node)) return
        const sketchInit = _node.node.declaration.init

        if (sketchInit.type === 'CallExpressionKw') {
          const moddedResult = changeSketchArguments(
            modded,
            kclManager.programMemory,
            {
              type: 'path',
              pathToNode: nodePathWithCorrectedIndexForTruncatedAst,
            },
            {
              type: 'circle-three-point-segment',
              p1: [point1[0], point1[1]],
              p2: [point2[0], point2[1]],
              p3: [
                args.intersectionPoint.twoD.x,
                args.intersectionPoint.twoD.y,
              ],
            }
          )
          if (err(moddedResult)) return
          modded = moddedResult.modifiedAst
        }

        const { execState } = await executeAst({
          ast: modded,
          engineCommandManager: this.engineCommandManager,
          // We make sure to send an empty program memory to denote we mean mock mode.
          programMemoryOverride,
        })
        const programMemory = execState.memory
        this.sceneProgramMemory = programMemory
        const sketch = sketchFromKclValue(programMemory.get(varName), varName)
        if (err(sketch)) return
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(sceneInfra.camControls.camera)

        const varDecIndex = Number(updatedEntryNodePath[1][0])

        this.updateSegment(
          sketch.start,
          0,
          varDecIndex,
          _ast,
          orthoFactor,
          sketch
        )
        sgPaths.forEach((seg, index) =>
          this.updateSegment(seg, index, varDecIndex, _ast, orthoFactor, sketch)
        )
      },
      onClick: async (args) => {
        // If there is a valid camera interaction that matches, do that instead
        const interaction = sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        // Commit the rectangle to the full AST/code and return to sketch.idle
        const cornerPoint = args.intersectionPoint?.twoD
        if (!cornerPoint || args.mouseEvent.button !== 0) return

        const _node = getNodeFromPath<VariableDeclaration>(
          _ast,
          updatedEntryNodePath || [],
          'VariableDeclaration'
        )
        if (trap(_node)) return
        const sketchInit = _node.node?.declaration.init

        let modded = structuredClone(_ast)
        if (sketchInit.type === 'CallExpressionKw') {
          const moddedResult = changeSketchArguments(
            modded,
            kclManager.programMemory,
            {
              type: 'path',
              pathToNode: updatedEntryNodePath,
            },
            {
              type: 'circle-three-point-segment',
              p1: [point1[0], point1[1]],
              p2: [point2[0], point2[1]],
              p3: [cornerPoint.x || 0, cornerPoint.y || 0],
            }
          )
          if (err(moddedResult)) return
          modded = moddedResult.modifiedAst

          const newCode = recast(modded)
          if (err(newCode)) return
          const pResult = parse(newCode)
          if (trap(pResult) || !resultIsOk(pResult))
            return Promise.reject(pResult)
          _ast = pResult.program

          // Update the primary AST and unequip the rectangle tool
          await kclManager.executeAstMock(_ast)
          sceneInfra.modelingSend({ type: 'Finish circle three point' })
          await codeManager.updateEditorWithAstAndWriteToFile(_ast)
        }
      },
    })
    return { updatedEntryNodePath, updatedSketchNodePaths }
  }
  setupDraftCircle = async (
    sketchEntryNodePath: PathToNode,
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    circleCenter: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(kclManager.ast)

    const varDec = getNodeFromPath<VariableDeclarator>(
      _ast,
      planeNodePath,
      'VariableDeclarator'
    )

    if (err(varDec)) return varDec
    if (varDec.node.type !== 'VariableDeclarator') return new Error('not a var')

    const varName = findUniqueName(_ast, 'profile')
    const newExpression = createVariableDeclaration(
      varName,
      createCallExpressionStdLib('circle', [
        createObjectExpression({
          center: createArrayExpression([
            createLiteral(roundOff(circleCenter[0])),
            createLiteral(roundOff(circleCenter[1])),
          ]),
          radius: createLiteral(1),
        }),
        createIdentifier(varDec.node.id.name),
      ])
    )

    const insertIndex = getInsertIndex(sketchNodePaths, planeNodePath, 'end')

    _ast.body.splice(insertIndex, 0, newExpression)
    const { updatedEntryNodePath, updatedSketchNodePaths } =
      updateSketchNodePathsWithInsertIndex({
        insertIndex,
        insertType: 'end',
        sketchNodePaths,
      })

    const pResult = parse(recast(_ast))
    if (trap(pResult) || !resultIsOk(pResult)) return Promise.reject(pResult)
    _ast = pResult.program

    // do a quick mock execution to get the program memory up-to-date
    await kclManager.executeAstMock(_ast)

    const { programMemoryOverride, truncatedAst } = await this.setupSketch({
      sketchEntryNodePath: updatedEntryNodePath,
      sketchNodePaths: updatedSketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 0 },
    })

    sceneInfra.setCallbacks({
      onMove: async (args) => {
        const nodePathWithCorrectedIndexForTruncatedAst =
          structuredClone(updatedEntryNodePath)
        nodePathWithCorrectedIndexForTruncatedAst[1][0] =
          Number(nodePathWithCorrectedIndexForTruncatedAst[1][0]) -
          Number(planeNodePath[1][0]) -
          1
        const _node = getNodeFromPath<VariableDeclaration>(
          truncatedAst,
          nodePathWithCorrectedIndexForTruncatedAst,
          'VariableDeclaration'
        )
        let modded = structuredClone(truncatedAst)
        if (trap(_node)) return
        const sketchInit = _node.node.declaration.init

        const x = (args.intersectionPoint.twoD.x || 0) - circleCenter[0]
        const y = (args.intersectionPoint.twoD.y || 0) - circleCenter[1]

        if (sketchInit.type === 'CallExpression') {
          const moddedResult = changeSketchArguments(
            modded,
            kclManager.programMemory,
            {
              type: 'path',
              pathToNode: nodePathWithCorrectedIndexForTruncatedAst,
            },
            {
              type: 'arc-segment',
              center: circleCenter,
              radius: Math.sqrt(x ** 2 + y ** 2),
              from: circleCenter,
            }
          )
          if (err(moddedResult)) return
          modded = moddedResult.modifiedAst
        }

        const { execState } = await executeAst({
          ast: modded,
          engineCommandManager: this.engineCommandManager,
          // We make sure to send an empty program memory to denote we mean mock mode.
          programMemoryOverride,
        })
        const programMemory = execState.memory
        this.sceneProgramMemory = programMemory
        const sketch = sketchFromKclValue(programMemory.get(varName), varName)
        if (err(sketch)) return
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(sceneInfra.camControls.camera)

        const varDecIndex = Number(updatedEntryNodePath[1][0])

        this.updateSegment(
          sketch.start,
          0,
          varDecIndex,
          _ast,
          orthoFactor,
          sketch
        )
        sgPaths.forEach((seg, index) =>
          this.updateSegment(seg, index, varDecIndex, _ast, orthoFactor, sketch)
        )
      },
      onClick: async (args) => {
        // If there is a valid camera interaction that matches, do that instead
        const interaction = sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        // Commit the rectangle to the full AST/code and return to sketch.idle
        const cornerPoint = args.intersectionPoint?.twoD
        if (!cornerPoint || args.mouseEvent.button !== 0) return

        const x = roundOff((cornerPoint.x || 0) - circleCenter[0])
        const y = roundOff((cornerPoint.y || 0) - circleCenter[1])

        const _node = getNodeFromPath<VariableDeclaration>(
          _ast,
          updatedEntryNodePath || [],
          'VariableDeclaration'
        )
        if (trap(_node)) return
        const sketchInit = _node.node?.declaration.init

        let modded = structuredClone(_ast)
        if (sketchInit.type === 'CallExpression') {
          const moddedResult = changeSketchArguments(
            modded,
            kclManager.programMemory,
            {
              type: 'path',
              pathToNode: updatedEntryNodePath,
            },
            {
              type: 'arc-segment',
              center: circleCenter,
              radius: Math.sqrt(x ** 2 + y ** 2),
              from: circleCenter,
            }
          )
          if (err(moddedResult)) return
          modded = moddedResult.modifiedAst

          const newCode = recast(modded)
          if (err(newCode)) return
          const pResult = parse(newCode)
          if (trap(pResult) || !resultIsOk(pResult))
            return Promise.reject(pResult)
          _ast = pResult.program

          // Update the primary AST and unequip the rectangle tool
          await kclManager.executeAstMock(_ast)
          sceneInfra.modelingSend({ type: 'Finish circle' })
          await codeManager.updateEditorWithAstAndWriteToFile(_ast)
        }
      },
    })
    return { updatedEntryNodePath, updatedSketchNodePaths }
  }
  setupSketchIdleCallbacks = ({
    sketchEntryNodePath,
    sketchNodePaths,
    planeNodePath,
    up,
    forward,
    position,
  }: {
    sketchEntryNodePath: PathToNode
    sketchNodePaths: PathToNode[]
    planeNodePath: PathToNode
    forward: [number, number, number]
    up: [number, number, number]
    position?: [number, number, number]
  }) => {
    let addingNewSegmentStatus: 'nothing' | 'pending' | 'added' = 'nothing'
    sceneInfra.setCallbacks({
      onDragEnd: async () => {
        if (addingNewSegmentStatus !== 'nothing') {
          this.tearDownSketch({ removeAxis: false })
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.setupSketch({
            sketchEntryNodePath,
            sketchNodePaths,
            maybeModdedAst: kclManager.ast,
            up,
            forward,
            position,
          })
          // setting up the callbacks again resets value in closures
          this.setupSketchIdleCallbacks({
            sketchEntryNodePath,
            sketchNodePaths,
            planeNodePath,
            up,
            forward,
            position,
          })
          await codeManager.writeToFile()
        }
      },
      onDrag: async ({
        selected,
        intersectionPoint,
        mouseEvent,
        intersects,
      }) => {
        if (mouseEvent.which !== 1) return

        const group = getParentGroup(selected, [EXTRA_SEGMENT_HANDLE])
        if (group?.name === EXTRA_SEGMENT_HANDLE) {
          const segGroup = getParentGroup(selected)
          const pathToNode: PathToNode = segGroup?.userData?.pathToNode
          const pathToNodeIndex = pathToNode.findIndex(
            (x) => x[1] === 'PipeExpression'
          )

          const sketch = sketchFromPathToNode({
            pathToNode,
            ast: kclManager.ast,
            programMemory: kclManager.programMemory,
          })
          if (trap(sketch)) return
          if (!sketch) {
            trap(new Error('sketch not found'))
            return
          }

          const pipeIndex = pathToNode[pathToNodeIndex + 1][0] as number
          if (addingNewSegmentStatus === 'nothing') {
            const prevSegment = sketch.paths[pipeIndex - 2]
            const mod = addNewSketchLn({
              node: kclManager.ast,
              programMemory: kclManager.programMemory,
              input: {
                type: 'straight-segment',
                to: [intersectionPoint.twoD.x, intersectionPoint.twoD.y],
                from: prevSegment.from,
              },
              // TODO assuming it's always a straight segments being added
              // as this is easiest, and we'll need to add "tabbing" behavior
              // to support other segment types
              fnName: 'line',
              pathToNode: pathToNode,
              spliceBetween: true,
            })
            addingNewSegmentStatus = 'pending'
            if (trap(mod)) return

            await kclManager.executeAstMock(mod.modifiedAst)
            this.tearDownSketch({ removeAxis: false })
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.setupSketch({
              sketchEntryNodePath: pathToNode,
              sketchNodePaths,
              maybeModdedAst: kclManager.ast,
              up,
              forward,
              position,
            })
            addingNewSegmentStatus = 'added'
          } else if (addingNewSegmentStatus === 'added') {
            const pathToNodeForNewSegment = pathToNode.slice(0, pathToNodeIndex)
            pathToNodeForNewSegment.push([pipeIndex - 2, 'index'])
            this.onDragSegment({
              sketchNodePaths,
              sketchEntryNodePath: pathToNodeForNewSegment,
              planeNodePath,
              object: selected,
              intersection2d: intersectionPoint.twoD,
              intersects,
            })
          }
          return
        }

        this.onDragSegment({
          object: selected,
          intersection2d: intersectionPoint.twoD,
          planeNodePath,
          intersects,
          sketchNodePaths,
          sketchEntryNodePath,
        })
      },
      onMove: () => {},
      onClick: (args) => {
        // If there is a valid camera interaction that matches, do that instead
        const interaction = sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        if (args?.mouseEvent.which !== 1) return
        if (!args || !args.selected) {
          sceneInfra.modelingSend({
            type: 'Set selection',
            data: {
              selectionType: 'singleCodeCursor',
            },
          })
          return
        }
        const { selected } = args
        const event = getEventForSegmentSelection(selected)
        if (!event) return
        sceneInfra.modelingSend(event)
      },
      ...this.mouseEnterLeaveCallbacks(),
    })
  }
  prepareTruncatedMemoryAndAst = (
    sketchNodePaths: PathToNode[],
    ast?: Node<Program>,
    draftSegment?: DraftSegment
  ) =>
    prepareTruncatedMemoryAndAst(
      sketchNodePaths,
      ast || kclManager.ast,
      kclManager.lastSuccessfulProgramMemory,
      draftSegment
    )
  onDragSegment({
    object,
    intersection2d: _intersection2d,
    sketchEntryNodePath,
    sketchNodePaths,
    planeNodePath,
    draftInfo,
    intersects,
  }: {
    object: any
    intersection2d: Vector2
    sketchEntryNodePath: PathToNode
    sketchNodePaths: PathToNode[]
    planeNodePath: PathToNode
    intersects: Intersection<Object3D<Object3DEventMap>>[]
    draftInfo?: {
      truncatedAst: Node<Program>
      programMemoryOverride: ProgramMemory
      variableDeclarationName: string
    }
  }) {
    const intersectsProfileStart =
      draftInfo &&
      intersects
        .map(({ object }) => getParentGroup(object, [PROFILE_START]))
        .find(isGroupStartProfileForCurrentProfile(sketchEntryNodePath))
    const intersection2d = intersectsProfileStart
      ? new Vector2(
          intersectsProfileStart.position.x,
          intersectsProfileStart.position.y
        )
      : _intersection2d

    const intersectsYAxis = intersects.find(
      (sceneObject) => sceneObject.object.name === Y_AXIS
    )
    const intersectsXAxis = intersects.find(
      (sceneObject) => sceneObject.object.name === X_AXIS
    )

    const snappedPoint = new Vector2(
      intersectsYAxis ? 0 : intersection2d.x,
      intersectsXAxis ? 0 : intersection2d.y
    )

    const group = getParentGroup(object, SEGMENT_BODIES_PLUS_PROFILE_START)
    const subGroup = getParentGroup(object, [
      ARROWHEAD,
      CIRCLE_CENTER_HANDLE,
      CIRCLE_THREE_POINT_HANDLE1,
      CIRCLE_THREE_POINT_HANDLE2,
      CIRCLE_THREE_POINT_HANDLE3,
    ])
    if (!group) return
    const pathToNode: PathToNode = structuredClone(group.userData.pathToNode)
    const varDecIndex = pathToNode[1][0]
    if (typeof varDecIndex !== 'number') {
      console.error(
        `Expected varDecIndex to be a number, but found: ${typeof varDecIndex} ${varDecIndex}`
      )
      return
    }

    const from: [number, number] = [
      group.userData?.from?.[0],
      group.userData?.from?.[1],
    ]
    const dragTo: [number, number] = [snappedPoint.x, snappedPoint.y]
    let modifiedAst = draftInfo ? draftInfo.truncatedAst : { ...kclManager.ast }

    const nodePathWithCorrectedIndexForTruncatedAst =
      structuredClone(pathToNode)
    nodePathWithCorrectedIndexForTruncatedAst[1][0] =
      Number(nodePathWithCorrectedIndexForTruncatedAst[1][0]) -
      Number(sketchNodePaths[0][1][0])

    const _node = getNodeFromPath<Node<CallExpression | CallExpressionKw>>(
      modifiedAst,
      draftInfo ? nodePathWithCorrectedIndexForTruncatedAst : pathToNode,
      ['CallExpression', 'CallExpressionKw']
    )
    if (trap(_node)) return
    const node = _node.node

    if (node.type !== 'CallExpression' && node.type !== 'CallExpressionKw')
      return

    let modded:
      | {
          modifiedAst: Node<Program>
          pathToNode: PathToNode
        }
      | Error

    const getChangeSketchInput = (): SegmentInputs => {
      if (
        group.name === CIRCLE_SEGMENT &&
        // !subGroup treats grabbing the outer circumference of the circle
        // as a drag of the center handle
        (!subGroup || subGroup?.name === ARROWHEAD)
      )
        return {
          type: 'arc-segment',
          from,
          center: group.userData.center,
          // distance between the center and the drag point
          radius: Math.sqrt(
            (group.userData.center[0] - dragTo[0]) ** 2 +
              (group.userData.center[1] - dragTo[1]) ** 2
          ),
        }
      if (
        group.name === CIRCLE_SEGMENT &&
        subGroup?.name === CIRCLE_CENTER_HANDLE
      )
        return {
          type: 'arc-segment',
          from,
          center: dragTo,
          radius: group.userData.radius,
        }
      if (
        subGroup?.name &&
        [
          CIRCLE_THREE_POINT_HANDLE1,
          CIRCLE_THREE_POINT_HANDLE2,
          CIRCLE_THREE_POINT_HANDLE3,
        ].includes(subGroup?.name)
      ) {
        const input: SegmentInputs = {
          type: 'circle-three-point-segment',
          p1: group.userData.p1,
          p2: group.userData.p2,
          p3: group.userData.p3,
        }
        if (subGroup?.name === CIRCLE_THREE_POINT_HANDLE1) {
          input.p1 = dragTo
        } else if (subGroup?.name === CIRCLE_THREE_POINT_HANDLE2) {
          input.p2 = dragTo
        } else if (subGroup?.name === CIRCLE_THREE_POINT_HANDLE3) {
          input.p3 = dragTo
        }
        return input
      }

      // straight segment is the default
      return {
        type: 'straight-segment',
        from,
        to: dragTo,
      }
    }

    if (group.name === PROFILE_START) {
      modded = updateStartProfileAtArgs({
        node: modifiedAst,
        pathToNode,
        input: {
          type: 'straight-segment',
          to: dragTo,
          from,
        },
        previousProgramMemory: kclManager.programMemory,
      })
    } else {
      modded = changeSketchArguments(
        modifiedAst,
        kclManager.programMemory,
        {
          type: 'sourceRange',
          sourceRange: topLevelRange(node.start, node.end),
        },
        getChangeSketchInput()
      )
    }
    if (trap(modded)) return

    modifiedAst = modded.modifiedAst
    const info = draftInfo
      ? draftInfo
      : this.prepareTruncatedMemoryAndAst(sketchNodePaths || [], modifiedAst)
    if (trap(info, { suppress: true })) return
    const { truncatedAst, programMemoryOverride } = info
    ;(async () => {
      const code = recast(modifiedAst)
      if (trap(code)) return
      if (!draftInfo)
        // don't want to mod the user's code yet as they have't committed to the change yet
        // plus this would be the truncated ast being recast, it would be wrong
        codeManager.updateCodeEditor(code)
      const { execState } = await executeAst({
        ast: truncatedAst,
        engineCommandManager: this.engineCommandManager,
        // We make sure to send an empty program memory to denote we mean mock mode.
        programMemoryOverride,
      })
      const programMemory = execState.memory
      this.sceneProgramMemory = programMemory
      const sketchesInfo = getSketchesInfo({
        sketchNodePaths,
        ast: truncatedAst,
        programMemory,
      })
      const callBacks: (() => SegmentOverlayPayload | null)[] = []
      for (const sketchInfo of sketchesInfo) {
        const { sketch, pathToNode: _pathToNode } = sketchInfo
        const varDecIndex = Number(_pathToNode[1][0])

        if (!sketch) return

        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(sceneInfra.camControls.camera)

        this.updateSegment(
          sketch.start,
          0,
          varDecIndex,
          modifiedAst,
          orthoFactor,
          sketch
        )

        callBacks.push(
          ...sgPaths.map((group, index) =>
            this.updateSegment(
              group,
              index,
              varDecIndex,
              modifiedAst,
              orthoFactor,
              sketch
            )
          )
        )
      }
      sceneInfra.overlayCallbacks(callBacks)
    })().catch(reportRejection)
  }

  /**
   * Update the THREEjs sketch entities with new segment data
   * mapping them back to the AST
   * @param segment
   * @param index
   * @param varDecIndex
   * @param modifiedAst
   * @param orthoFactor
   * @param sketch
   */
  updateSegment = (
    segment: Path | Sketch['start'],
    index: number,
    varDecIndex: number,
    modifiedAst: Program,
    orthoFactor: number,
    sketch: Sketch
  ): (() => SegmentOverlayPayload | null) => {
    const segPathToNode = getNodePathFromSourceRange(
      modifiedAst,
      sourceRangeFromRust(segment.__geoMeta.sourceRange)
    )
    const sgPaths = sketch.paths
    const originalPathToNodeStr = JSON.stringify(segPathToNode)
    segPathToNode[1][0] = varDecIndex
    const pathToNodeStr = JSON.stringify(segPathToNode)
    // more hacks to hopefully be solved by proper pathToNode info in memory/sketch segments
    const group =
      this.activeSegments[pathToNodeStr] ||
      this.activeSegments[originalPathToNodeStr]
    const type = group?.userData?.type
    const factor =
      (sceneInfra.camControls.camera instanceof OrthographicCamera
        ? orthoFactor
        : perspScale(sceneInfra.camControls.camera, group)) /
      sceneInfra._baseUnitMultiplier
    let input: SegmentInputs = {
      type: 'straight-segment',
      from: segment.from,
      to: segment.to,
    }
    let update: SegmentUtils['update'] | null = null
    if (type === TANGENTIAL_ARC_TO_SEGMENT) {
      update = segmentUtils.tangentialArcTo.update
    } else if (type === STRAIGHT_SEGMENT) {
      update = segmentUtils.straight.update
    } else if (
      type === CIRCLE_SEGMENT &&
      'type' in segment &&
      segment.type === 'Circle'
    ) {
      update = segmentUtils.circle.update
      input = {
        type: 'arc-segment',
        from: segment.from,
        center: segment.center,
        radius: segment.radius,
      }
    } else if (
      type === CIRCLE_THREE_POINT_SEGMENT &&
      'type' in segment &&
      segment.type === 'CircleThreePoint'
    ) {
      update = segmentUtils.circleThreePoint.update
      input = {
        type: 'circle-three-point-segment',
        p1: segment.p1,
        p2: segment.p2,
        p3: segment.p3,
      }
    }
    const callBack =
      update &&
      !err(update) &&
      update({
        input,
        group,
        scale: factor,
        prevSegment: sgPaths[index - 1],
        sceneInfra,
      })
    if (callBack && !err(callBack)) return callBack

    if (type === PROFILE_START) {
      group.position.set(segment.from[0], segment.from[1], 0)
      group.scale.set(factor, factor, factor)
    }
    return () => null
  }

  /**
   * Update the base color of each of the THREEjs meshes
   * that represent each of the sketch segments, to get the
   * latest value from `sceneInfra._theme`
   */
  updateSegmentBaseColor(newColor: Themes.Light | Themes.Dark) {
    const newColorThreeJs = getThemeColorForThreeJs(newColor)
    Object.values(this.activeSegments).forEach((group) => {
      group.userData.baseColor = newColorThreeJs
      group.traverse((child) => {
        if (
          child instanceof Mesh &&
          child.material instanceof MeshBasicMaterial
        ) {
          child.material.color.set(newColorThreeJs)
        }
      })
    })
  }
  removeSketchGrid() {
    if (this.axisGroup) this.scene.remove(this.axisGroup)
  }
  tearDownSketch({ removeAxis = true }: { removeAxis?: boolean }) {
    // Remove all draft groups
    this.draftPointGroups.forEach((draftPointGroup) => {
      this.scene.remove(draftPointGroup)
    })

    // Remove all sketch tools

    if (this.axisGroup && removeAxis) this.scene.remove(this.axisGroup)
    const sketchSegments = this.scene.children.find(
      ({ userData }) => userData?.type === SKETCH_GROUP_SEGMENTS
    )
    if (sketchSegments) {
      // We have to manually remove the CSS2DObjects
      // as they don't get removed when the group is removed
      sketchSegments.traverse((object) => {
        if (object instanceof CSS2DObject) {
          object.element.remove()
          object.remove()
        }
      })
      this.scene.remove(sketchSegments)
    }
    sceneInfra.camControls.enableRotate = true
    this.activeSegments = {}
  }
  mouseEnterLeaveCallbacks() {
    return {
      onMouseEnter: ({ selected, dragSelected }: OnMouseEnterLeaveArgs) => {
        if ([X_AXIS, Y_AXIS].includes(selected?.userData?.type)) {
          const obj = selected as Mesh
          const mat = obj.material as MeshBasicMaterial
          mat.color.set(obj.userData.baseColor)
          mat.color.offsetHSL(0, 0, 0.5)
        }
        const parent = getParentGroup(
          selected,
          SEGMENT_BODIES_PLUS_PROFILE_START
        )
        if (parent?.userData?.pathToNode) {
          const pResult = parse(recast(kclManager.ast))
          if (trap(pResult) || !resultIsOk(pResult))
            return Promise.reject(pResult)
          const updatedAst = pResult.program
          const _node = getNodeFromPath<
            Node<CallExpression | CallExpressionKw>
          >(updatedAst, parent.userData.pathToNode, [
            'CallExpressionKw',
            'CallExpression',
          ])
          if (trap(_node, { suppress: true })) return
          const node = _node.node
          editorManager.setHighlightRange([topLevelRange(node.start, node.end)])
          const yellow = 0xffff00
          colorSegment(selected, yellow)
          const extraSegmentGroup = parent.getObjectByName(EXTRA_SEGMENT_HANDLE)
          if (extraSegmentGroup) {
            extraSegmentGroup.traverse((child) => {
              if (child instanceof Points || child instanceof Mesh) {
                child.material.opacity = dragSelected ? 0 : 1
              }
            })
          }
          const orthoFactor = orthoScale(sceneInfra.camControls.camera)

          let input: SegmentInputs = {
            type: 'straight-segment',
            from: parent.userData.from,
            to: parent.userData.to,
          }
          const factor =
            (sceneInfra.camControls.camera instanceof OrthographicCamera
              ? orthoFactor
              : perspScale(sceneInfra.camControls.camera, parent)) /
            sceneInfra._baseUnitMultiplier
          let update: SegmentUtils['update'] | null = null
          if (parent.name === STRAIGHT_SEGMENT) {
            update = segmentUtils.straight.update
          } else if (parent.name === TANGENTIAL_ARC_TO_SEGMENT) {
            update = segmentUtils.tangentialArcTo.update
            input = {
              type: 'arc-segment',
              from: parent.userData.from,
              radius: parent.userData.radius,
              center: parent.userData.center,
            }
          }
          update &&
            update({
              prevSegment: parent.userData.prevSegment,
              input,
              group: parent,
              scale: factor,
              sceneInfra,
            })
          return
        }
        editorManager.setHighlightRange([defaultSourceRange()])
      },
      onMouseLeave: ({ selected, ...rest }: OnMouseEnterLeaveArgs) => {
        editorManager.setHighlightRange([defaultSourceRange()])
        const parent = getParentGroup(
          selected,
          SEGMENT_BODIES_PLUS_PROFILE_START
        )
        if (parent) {
          const orthoFactor = orthoScale(sceneInfra.camControls.camera)

          let input: SegmentInputs = {
            type: 'straight-segment',
            from: parent.userData.from,
            to: parent.userData.to,
          }
          const factor =
            (sceneInfra.camControls.camera instanceof OrthographicCamera
              ? orthoFactor
              : perspScale(sceneInfra.camControls.camera, parent)) /
            sceneInfra._baseUnitMultiplier
          let update: SegmentUtils['update'] | null = null
          if (parent.name === STRAIGHT_SEGMENT) {
            update = segmentUtils.straight.update
          } else if (parent.name === TANGENTIAL_ARC_TO_SEGMENT) {
            update = segmentUtils.tangentialArcTo.update
            input = {
              type: 'arc-segment',
              from: parent.userData.from,
              radius: parent.userData.radius,
              center: parent.userData.center,
            }
          }
          update &&
            update({
              prevSegment: parent.userData.prevSegment,
              input,
              group: parent,
              scale: factor,
              sceneInfra,
            })
        }
        const isSelected = parent?.userData?.isSelected
        colorSegment(
          selected,
          isSelected
            ? 0x0000ff
            : parent?.userData?.baseColor ||
                getThemeColorForThreeJs(sceneInfra._theme)
        )
        const extraSegmentGroup = parent?.getObjectByName(EXTRA_SEGMENT_HANDLE)
        if (extraSegmentGroup) {
          extraSegmentGroup.traverse((child) => {
            if (child instanceof Points || child instanceof Mesh) {
              child.material.opacity = 0
            }
          })
        }
        if ([X_AXIS, Y_AXIS].includes(selected?.userData?.type)) {
          const obj = selected as Mesh
          const mat = obj.material as MeshBasicMaterial
          mat.color.set(obj.userData.baseColor)
          if (obj.userData.isSelected) mat.color.offsetHSL(0, 0, 0.2)
        }
      },
    }
  }
  resetOverlays() {
    sceneInfra.modelingSend({
      type: 'Set Segment Overlays',
      data: {
        type: 'clear',
      },
    })
  }
}

// calculations/pure-functions/easy to test so no excuse not to

function prepareTruncatedMemoryAndAst(
  sketchNodePaths: PathToNode[],
  ast: Node<Program>,
  programMemory: ProgramMemory,
  draftSegment?: DraftSegment
):
  | {
      truncatedAst: Node<Program>
      programMemoryOverride: ProgramMemory
      // can I remove the below?
      variableDeclarationName: string
    }
  | Error {
  const bodyStartIndex = Number(sketchNodePaths?.[0]?.[1]?.[0]) || 0
  const bodyEndIndex =
    Number(sketchNodePaths[sketchNodePaths.length - 1]?.[1]?.[0]) ||
    ast.body.length
  const _ast = structuredClone(ast)

  const _node = getNodeFromPath<Node<VariableDeclaration>>(
    _ast,
    sketchNodePaths[0] || [],
    'VariableDeclaration'
  )
  if (err(_node)) return _node
  const variableDeclarationName = _node.node?.declaration?.id?.name || ''
  const sg = sketchFromKclValue(
    programMemory.get(variableDeclarationName),
    variableDeclarationName
  )
  if (err(sg)) return sg
  const lastSeg = sg?.paths.slice(-1)[0]
  if (draftSegment) {
    // truncatedAst needs to setup with another segment at the end
    let newSegment
    if (draftSegment === 'line') {
      newSegment = createCallExpressionStdLibKw('line', null, [
        createLabeledArg(
          'end',
          createArrayExpression([createLiteral(0), createLiteral(0)])
        ),
      ])
    } else {
      newSegment = createCallExpressionStdLib('tangentialArcTo', [
        createArrayExpression([
          createLiteral(lastSeg.to[0]),
          createLiteral(lastSeg.to[1]),
        ]),
        createPipeSubstitution(),
      ])
    }
    ;(
      (_ast.body[bodyStartIndex] as VariableDeclaration).declaration
        .init as PipeExpression
    ).body.push(newSegment)
    // update source ranges to section we just added.
    // hacks like this wouldn't be needed if the AST put pathToNode info in memory/sketch segments
    const pResult = parse(recast(_ast)) // get source ranges correct since unfortunately we still rely on them
    if (trap(pResult) || !resultIsOk(pResult))
      return Error('Unexpected compilation error')
    const updatedSrcRangeAst = pResult.program

    const lastPipeItem = (
      (updatedSrcRangeAst.body[bodyStartIndex] as VariableDeclaration)
        .declaration.init as PipeExpression
    ).body.slice(-1)[0]

    ;(
      (_ast.body[bodyStartIndex] as VariableDeclaration).declaration
        .init as PipeExpression
    ).body.slice(-1)[0].start = lastPipeItem.start

    _ast.end = lastPipeItem.end
    const varDec = _ast.body[bodyStartIndex] as Node<VariableDeclaration>
    varDec.end = lastPipeItem.end
    const declarator = varDec.declaration
    declarator.end = lastPipeItem.end
    const init = declarator.init as Node<PipeExpression>
    init.end = lastPipeItem.end
    init.body.slice(-1)[0].end = lastPipeItem.end
  }
  const truncatedAst: Node<Program> = {
    ..._ast,
    body: structuredClone(_ast.body.slice(bodyStartIndex, bodyEndIndex + 1)),
  }

  // Grab all the TagDeclarators and TagIdentifiers from memory.
  let start = _node.node.start
  const programMemoryOverride = programMemory.filterVariables(true, (value) => {
    if (
      !('__meta' in value) ||
      value.__meta === undefined ||
      value.__meta.length === 0 ||
      value.__meta[0].sourceRange === undefined
    ) {
      return false
    }

    if (value.__meta[0].sourceRange[0] >= start) {
      // We only want things before our start point.
      return false
    }

    return value.type === 'TagIdentifier'
  })
  if (err(programMemoryOverride)) return programMemoryOverride

  for (let i = 0; i < bodyStartIndex; i++) {
    const node = _ast.body[i]
    if (node.type !== 'VariableDeclaration') {
      continue
    }
    const name = node.declaration.id.name
    const memoryItem = programMemory.get(name)
    if (!memoryItem) {
      continue
    }
    const error = programMemoryOverride.set(name, structuredClone(memoryItem))
    if (err(error)) return error
  }
  return {
    truncatedAst,
    programMemoryOverride,
    variableDeclarationName,
  }
}

export function getParentGroup(
  object: any,
  stopAt: string[] = SEGMENT_BODIES
): Group | null {
  if (stopAt.includes(object?.userData?.type)) {
    return object
  } else if (object?.parent) {
    return getParentGroup(object.parent, stopAt)
  }
  return null
}

export function sketchFromPathToNode({
  pathToNode,
  ast,
  programMemory,
}: {
  pathToNode: PathToNode
  ast: Program
  programMemory: ProgramMemory
}): Sketch | null | Error {
  const _varDec = getNodeFromPath<VariableDeclarator>(
    kclManager.ast,
    pathToNode,
    'VariableDeclarator'
  )
  if (err(_varDec)) return _varDec
  const varDec = _varDec.node
  const result = programMemory.get(varDec?.id?.name || '')
  if (result?.type === 'Solid') {
    return result.value.sketch
  }
  const sg = sketchFromKclValue(result, varDec?.id?.name)
  if (err(sg)) {
    return null
  }
  return sg
}

function colorSegment(object: any, color: number) {
  const segmentHead = getParentGroup(object, [ARROWHEAD, PROFILE_START])
  if (segmentHead) {
    segmentHead.traverse((child) => {
      if (child instanceof Mesh) {
        child.material.color.set(color)
      }
    })
    return
  }
  const straightSegmentBody = getParentGroup(object, SEGMENT_BODIES)
  if (straightSegmentBody) {
    straightSegmentBody.traverse((child) => {
      if (child instanceof Mesh && !child.userData.ignoreColorChange) {
        child.material.color.set(color)
      }
    })
    return
  }
}

export function getSketchQuaternion(
  sketchPathToNode: PathToNode,
  sketchNormalBackUp: [number, number, number] | null
): Quaternion | Error {
  const sketch = sketchFromPathToNode({
    pathToNode: sketchPathToNode,
    ast: kclManager.ast,
    programMemory: kclManager.programMemory,
  })
  if (err(sketch)) return sketch
  const zAxis = sketch?.on.zAxis || sketchNormalBackUp
  if (!zAxis) return Error('Sketch zAxis not found')

  return getQuaternionFromZAxis(massageFormats(zAxis))
}
export async function getSketchOrientationDetails(
  sketchEntryNodePath: PathToNode
): Promise<{
  quat: Quaternion
  sketchDetails: Omit<
    SketchDetails & { faceId?: string },
    'sketchNodePaths' | 'sketchEntryNodePath' | 'planeNodePath'
  >
}> {
  const sketch = sketchFromPathToNode({
    pathToNode: sketchEntryNodePath,
    ast: kclManager.ast,
    programMemory: kclManager.programMemory,
  })
  if (err(sketch)) return Promise.reject(sketch)
  if (!sketch) return Promise.reject('sketch not found')

  if (sketch.on.type === 'plane') {
    const zAxis = sketch?.on.zAxis
    return {
      quat: getQuaternionFromZAxis(massageFormats(zAxis)),
      sketchDetails: {
        zAxis: [zAxis.x, zAxis.y, zAxis.z],
        yAxis: [sketch.on.yAxis.x, sketch.on.yAxis.y, sketch.on.yAxis.z],
        origin: [0, 0, 0],
        faceId: sketch.on.id,
      },
    }
  }

  if (sketch.on.type === 'face') {
    const faceInfo = await getFaceDetails(sketch.on.id)

    if (!faceInfo?.origin || !faceInfo?.z_axis || !faceInfo?.y_axis)
      return Promise.reject('face info')
    const { z_axis, y_axis, origin } = faceInfo
    const quaternion = quaternionFromUpNForward(
      new Vector3(y_axis.x, y_axis.y, y_axis.z),
      new Vector3(z_axis.x, z_axis.y, z_axis.z)
    )
    return {
      quat: quaternion,
      sketchDetails: {
        zAxis: [z_axis.x, z_axis.y, z_axis.z],
        yAxis: [y_axis.x, y_axis.y, y_axis.z],
        origin: [origin.x, origin.y, origin.z],
        faceId: sketch.on.id,
      },
    }
  }
  return Promise.reject(
    'sketch.on.type not recognized, has a new type been added?'
  )
}

/**
 * Retrieves orientation details for a given entity representing a face (brep face or default plane).
 * This function asynchronously fetches and returns the origin, x-axis, y-axis, and z-axis details
 * for a specified entity ID. It is primarily used to obtain the orientation of a face in the scene,
 * which is essential for calculating the correct positioning and alignment of the client side sketch.
 *
 * @param  entityId - The ID of the entity for which orientation details are being fetched.
 * @returns A promise that resolves with the orientation details of the face.
 */
export async function getFaceDetails(
  entityId: string
): Promise<Models['GetSketchModePlane_type']> {
  // TODO mode engine connection to allow batching returns and batch the following
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'enable_sketch_mode',
      adjust_camera: false,
      animated: false,
      ortho: false,
      entity_id: entityId,
    },
  })
  const resp = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: { type: 'get_sketch_mode_plane' },
  })
  const faceInfo =
    resp?.success &&
    resp?.resp.type === 'modeling' &&
    resp?.resp?.data?.modeling_response?.type === 'get_sketch_mode_plane'
      ? resp?.resp?.data?.modeling_response.data
      : ({} as Models['GetSketchModePlane_type'])
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: { type: 'sketch_mode_disable' },
  })
  return faceInfo
}

export function getQuaternionFromZAxis(zAxis: Vector3): Quaternion {
  const dummyCam = new PerspectiveCamera()
  dummyCam.up.set(0, 0, 1)
  dummyCam.position.copy(zAxis)
  dummyCam.lookAt(0, 0, 0)
  dummyCam.updateMatrix()
  const quaternion = dummyCam.quaternion.clone()

  const isVert = isQuaternionVertical(quaternion)

  // because vertical quaternions are a gimbal lock, for the orbit controls
  // it's best to set them explicitly to the vertical position with a known good camera up
  if (isVert && zAxis.z < 0) {
    quaternion.set(0, 1, 0, 0)
  } else if (isVert) {
    quaternion.set(0, 0, 0, 1)
  }
  return quaternion
}

function massageFormats(a: Vec3Array | Point3d): Vector3 {
  return isArray(a) ? new Vector3(a[0], a[1], a[2]) : new Vector3(a.x, a.y, a.z)
}

function getSketchesInfo({
  sketchNodePaths,
  ast,
  programMemory,
}: {
  sketchNodePaths: PathToNode[]
  ast: Node<Program>
  programMemory: ProgramMemory
}): {
  sketch: Sketch
  pathToNode: PathToNode
}[] {
  const sketchesInfo: {
    sketch: Sketch
    pathToNode: PathToNode
  }[] = []
  for (const path of sketchNodePaths) {
    const sketch = sketchFromPathToNode({
      pathToNode: path,
      ast,
      programMemory,
    })
    if (err(sketch)) continue
    if (!sketch) continue
    sketchesInfo.push({
      sketch,
      pathToNode: path,
    })
  }
  return sketchesInfo
}
/**
 * Given a SourceRange [x,y,boolean] create a Selections object which contains
 * graphSelections with the artifact and codeRef.
 * This can be passed to 'Set selection' to internally set the selection of the
 * modelingMachine from code.
 */
function computeSelectionFromSourceRangeAndAST(
  sourceRange: SourceRange,
  ast: Node<Program>
): Selections {
  const artifactGraph = engineCommandManager.artifactGraph
  const artifact = getArtifactFromRange(sourceRange, artifactGraph) || undefined
  const selection: Selections = {
    graphSelections: [
      {
        artifact,
        codeRef: codeRefFromRange(sourceRange, ast),
      },
    ],
    otherSelections: [],
  }
  return selection
}

function isGroupStartProfileForCurrentProfile(sketchEntryNodePath: PathToNode) {
  return (group: Group<Object3DEventMap> | null) => {
    if (group?.name !== PROFILE_START) return false
    const groupExpressionIndex = Number(group.userData.pathToNode[1][0])
    const isProfileStartOfCurrentExpr =
      groupExpressionIndex === sketchEntryNodePath[1][0]
    return isProfileStartOfCurrentExpr
  }
}

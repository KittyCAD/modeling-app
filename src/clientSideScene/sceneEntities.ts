import toast from 'react-hot-toast'
import type {
  Intersection,
  Object3D,
  Object3DEventMap,
  Quaternion,
} from 'three'

import {
  BoxGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LineCurve3,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { radToDeg } from 'three/src/math/MathUtils'

import type { Models } from '@kittycad/lib/dist/types/src'
import type { CallExpressionKw } from '@rust/kcl-lib/bindings/CallExpressionKw'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Path } from '@rust/kcl-lib/bindings/Path'
import type { PipeExpression } from '@rust/kcl-lib/bindings/PipeExpression'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { Sketch } from '@rust/kcl-lib/bindings/Sketch'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import type { VariableDeclaration } from '@rust/kcl-lib/bindings/VariableDeclaration'
import type { VariableDeclarator } from '@rust/kcl-lib/bindings/VariableDeclarator'
import type { SafeArray } from '@src/lib/utils'
import { getAngle, getLength, uuidv4 } from '@src/lib/utils'

import {
  createGridHelper,
  isQuaternionVertical,
  orthoScale,
  perspScale,
  quaternionFromUpNForward,
} from '@src/clientSideScene/helpers'
import {
  ARC_ANGLE_END,
  ARC_SEGMENT,
  ARC_SEGMENT_TYPES,
  CIRCLE_CENTER_HANDLE,
  CIRCLE_SEGMENT,
  CIRCLE_THREE_POINT_HANDLE1,
  CIRCLE_THREE_POINT_HANDLE2,
  CIRCLE_THREE_POINT_HANDLE3,
  CIRCLE_THREE_POINT_SEGMENT,
  DRAFT_DASHED_LINE,
  EXTRA_SEGMENT_HANDLE,
  PROFILE_START,
  SEGMENT_BODIES,
  SEGMENT_BODIES_PLUS_PROFILE_START,
  SEGMENT_WIDTH_PX,
  STRAIGHT_SEGMENT,
  STRAIGHT_SEGMENT_DASH,
  TANGENTIAL_ARC_TO_SEGMENT,
  THREE_POINT_ARC_HANDLE2,
  THREE_POINT_ARC_HANDLE3,
  THREE_POINT_ARC_SEGMENT,
  getParentGroup,
} from '@src/clientSideScene/sceneConstants'
import type {
  OnClickCallbackArgs,
  OnMouseEnterLeaveArgs,
  SceneInfra,
} from '@src/clientSideScene/sceneInfra'

import {
  ANGLE_SNAP_THRESHOLD_DEGREES,
  ARROWHEAD,
  AXIS_GROUP,
  DRAFT_POINT,
  DRAFT_POINT_GROUP,
  INTERSECTION_PLANE_LAYER,
  RAYCASTABLE_PLANE,
  SKETCH_GROUP_SEGMENTS,
  SKETCH_LAYER,
  X_AXIS,
  Y_AXIS,
  getSceneScale,
} from '@src/clientSideScene/sceneUtils'
import type { SegmentUtils } from '@src/clientSideScene/segments'
import {
  createProfileStartHandle,
  dashedStraight,
  getTanPreviousPoint,
  segmentUtils,
} from '@src/clientSideScene/segments'
import type EditorManager from '@src/editor/manager'
import type { KclManager } from '@src/lang/KclSingleton'
import type CodeManager from '@src/lang/codeManager'
import { ARG_END, ARG_AT, ARG_END_ABSOLUTE } from '@src/lang/constants'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createPipeExpression,
  createPipeSubstitution,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import type { ToolTip } from '@src/lang/langHelpers'
import { executeAstMock } from '@src/lang/langHelpers'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  createNodeFromExprSnippet,
  getInsertIndex,
  insertNewStartProfileAt,
  mutateKwArgOnly,
  updateSketchNodePathsWithInsertIndex,
} from '@src/lang/modifyAst'
import { mutateAstWithTagForSketchSegment } from '@src/lang/modifyAst/addEdgeTreatment'
import {
  getNodeFromPath,
  getPathNormalisedForTruncatedAst,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  codeRefFromRange,
  getArtifactFromRange,
} from '@src/lang/std/artifactGraph'
import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import type { Coords2d } from '@src/lang/std/sketch'
import {
  addCallExpressionsToPipe,
  addCloseToPipe,
  addNewSketchLn,
  changeSketchArguments,
  updateStartProfileAtArgs,
} from '@src/lang/std/sketch'
import type { SegmentInputs } from '@src/lang/std/stdTypes'
import { crossProduct, topLevelRange } from '@src/lang/util'
import type { PathToNode, VariableMap } from '@src/lang/wasm'
import {
  defaultSourceRange,
  getTangentialArcToInfo,
  parse,
  recast,
  resultIsOk,
  sketchFromKclValue,
  sourceRangeFromRust,
} from '@src/lang/wasm'
import { EXECUTION_TYPE_MOCK } from '@src/lib/constants'
import {
  getRectangleCallExpressions,
  updateCenterRectangleSketch,
  updateRectangleSketch,
} from '@src/lib/rectangleTool'
import type RustContext from '@src/lib/rustContext'
import type { Selections } from '@src/lib/selections'
import { getEventForSegmentSelection } from '@src/lib/selections'
import type { Themes } from '@src/lib/theme'
import { getThemeColorForThreeJs } from '@src/lib/theme'
import { err, reportRejection, trap } from '@src/lib/trap'
import { isArray, isOverlap, roundOff } from '@src/lib/utils'
import { closestPointOnRay, deg2Rad } from '@src/lib/utils2d'
import type {
  SegmentOverlayPayload,
  SketchDetails,
  SketchDetailsUpdate,
  SketchTool,
} from '@src/machines/modelingMachine'
import { calculateIntersectionOfTwoLines } from 'sketch-helpers'

type DraftSegment = 'line' | 'tangentialArc'

type Vec3Array = [number, number, number]

// This singleton Class is responsible for all of the things the user sees and interacts with.
// That mostly mean sketch elements.
// Cameras, controls, raycasters, etc are handled by sceneInfra
export class SceneEntities {
  readonly engineCommandManager: EngineCommandManager
  readonly sceneInfra: SceneInfra
  readonly editorManager: EditorManager
  readonly codeManager: CodeManager
  readonly kclManager: KclManager
  readonly rustContext: RustContext
  activeSegments: { [key: string]: Group } = {}
  readonly intersectionPlane: Mesh
  axisGroup: Group | null = null
  draftPointGroups: Group[] = []
  currentSketchQuaternion: Quaternion | null = null

  constructor(
    engineCommandManager: EngineCommandManager,
    sceneInfra: SceneInfra,
    editorManager: EditorManager,
    codeManager: CodeManager,
    kclManager: KclManager,
    rustContext: RustContext
  ) {
    this.engineCommandManager = engineCommandManager
    this.sceneInfra = sceneInfra
    this.editorManager = editorManager
    this.codeManager = codeManager
    this.kclManager = kclManager
    this.rustContext = rustContext
    this.intersectionPlane = SceneEntities.createIntersectionPlane(
      this.sceneInfra
    )
    this.sceneInfra.camControls.subscribeToCamChange(this.onCamChange)
    window.addEventListener('resize', this.onWindowResize)
  }

  onWindowResize = () => {
    this.onCamChange()
  }
  onCamChange = () => {
    const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)
    const callbacks: (() => SegmentOverlayPayload | null)[] = []
    Object.values(this.activeSegments).forEach((segment, _index) => {
      const factor =
        (this.sceneInfra.camControls.camera instanceof OrthographicCamera
          ? orthoFactor
          : perspScale(this.sceneInfra.camControls.camera, segment)) /
        this.sceneInfra._baseUnitMultiplier
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
        update = segmentUtils.tangentialArc.update
      }
      if (
        segment.userData &&
        segment.userData.from &&
        segment.userData.center &&
        segment.userData.radius &&
        segment.userData.type === CIRCLE_SEGMENT
      ) {
        update = segmentUtils.circle.update
        input = {
          type: 'arc-segment',
          from: segment.userData.from,
          to: segment.userData.from,
          center: segment.userData.center,
          radius: segment.userData.radius,
          ccw: true,
        }
      }
      if (
        segment.userData &&
        segment.userData.from &&
        segment.userData.center &&
        segment.userData.radius &&
        segment.userData.to &&
        segment.userData.type === ARC_SEGMENT
      ) {
        update = segmentUtils.arc.update
        input = {
          type: 'arc-segment',
          from: segment.userData.from,
          to: segment.userData.to,
          center: segment.userData.center,
          radius: segment.userData.radius,
          ccw: segment.userData.ccw,
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
      if (
        segment.userData &&
        segment.userData.from &&
        segment.userData.center &&
        segment.userData.radius &&
        segment.userData.to &&
        segment.userData.type === THREE_POINT_ARC_SEGMENT
      ) {
        update = segmentUtils.threePointArc.update
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
        sceneInfra: this.sceneInfra,
      })
      callBack && !err(callBack) && callbacks.push(callBack)
      if (segment.name === PROFILE_START) {
        segment.scale.set(factor, factor, factor)
        const startProfileCallBack: () => SegmentOverlayPayload | null = () => {
          return this.sceneInfra.updateOverlayDetails({
            handle: segment,
            group: segment,
            isHandlesVisible: true,
            from: segment.userData.from,
            to: segment.userData.to,
            hasThreeDotMenu: false,
          })
        }

        callbacks.push(startProfileCallBack)
      }
    })
    if (this.axisGroup) {
      const factor =
        this.sceneInfra.camControls.camera instanceof OrthographicCamera
          ? orthoFactor
          : perspScale(this.sceneInfra.camControls.camera, this.axisGroup)
      const x = this.axisGroup.getObjectByName(X_AXIS)
      x?.scale.set(1, factor / this.sceneInfra._baseUnitMultiplier, 1)
      const y = this.axisGroup.getObjectByName(Y_AXIS)
      y?.scale.set(factor / this.sceneInfra._baseUnitMultiplier, 1, 1)
    }
    this.sceneInfra.overlayCallbacks(callbacks)
  }

  private static createIntersectionPlane(sceneInfra: SceneInfra) {
    const hundredM = 100_0000
    const planeGeometry = new PlaneGeometry(hundredM, hundredM)
    const planeMaterial = new MeshBasicMaterial({
      color: 0xff0000,
      side: DoubleSide,
      transparent: true,
      opacity: 0.5,
    })
    const intersectionPlane = new Mesh(planeGeometry, planeMaterial)
    intersectionPlane.userData = { type: RAYCASTABLE_PLANE }
    intersectionPlane.name = RAYCASTABLE_PLANE
    intersectionPlane.layers.set(INTERSECTION_PLANE_LAYER)
    sceneInfra.scene.add(intersectionPlane)
    return intersectionPlane
  }

  createSketchAxis(
    forward: [number, number, number],
    up: [number, number, number],
    sketchPosition?: [number, number, number]
  ) {
    const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)
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

    // This makes sure axis lines are picked after segment lines in case of overlapping
    xAxisMesh.position.z = -0.1
    yAxisMesh.position.z = -0.1

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
      this.sceneInfra.camControls.camera,
      this.sceneInfra.camControls.target
    )
    gridHelper.scale.set(sceneScale, sceneScale, sceneScale)

    const factor =
      this.sceneInfra.camControls.camera instanceof OrthographicCamera
        ? orthoFactor
        : perspScale(this.sceneInfra.camControls.camera, this.axisGroup)
    xAxisMesh?.scale.set(1, factor / this.sceneInfra._baseUnitMultiplier, 1)
    yAxisMesh?.scale.set(factor / this.sceneInfra._baseUnitMultiplier, 1, 1)

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
    this.sceneInfra.scene.add(this.axisGroup)
  }

  getDraftPoint() {
    return this.sceneInfra.scene.getObjectByName(DRAFT_POINT)
  }

  createDraftPoint({
    point,
    origin,
    yAxis,
    zAxis,
  }: {
    point: Vector2
    origin: SketchDetails['origin']
    yAxis: SketchDetails['yAxis']
    zAxis: SketchDetails['zAxis']
  }) {
    const draftPointGroup = new Group()
    this.draftPointGroups.push(draftPointGroup)
    draftPointGroup.name = DRAFT_POINT_GROUP
    origin && draftPointGroup.position.set(...origin)
    if (!yAxis) {
      console.error('No sketch quaternion or sketch details found')
      return
    }
    const currentSketchQuaternion = quaternionFromUpNForward(
      new Vector3(...yAxis),
      new Vector3(...zAxis)
    )
    draftPointGroup.setRotationFromQuaternion(currentSketchQuaternion)
    this.sceneInfra.scene.add(draftPointGroup)
    const dummy = new Mesh()
    dummy.position.set(0, 0, 0)
    const scale = this.sceneInfra.getClientSceneScaleFactor(dummy)

    const draftPoint = createProfileStartHandle({
      isDraft: true,
      from: [point.x, point.y],
      scale,
      theme: this.sceneInfra._theme,
      // default is 12, this makes the draft point pop a bit more,
      // especially when snapping to the startProfile handle as it's it was the exact same size
      size: 16,
    })
    draftPoint.layers.set(SKETCH_LAYER)
    draftPointGroup.add(draftPoint)
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
    this.currentSketchQuaternion = quaternionFromUpNForward(
      new Vector3(...sketchDetails.yAxis),
      new Vector3(...sketchDetails.zAxis)
    )

    const quaternion = quaternionFromUpNForward(
      new Vector3(...sketchDetails.yAxis),
      new Vector3(...sketchDetails.zAxis)
    )

    // Position the click raycast plane
    this.intersectionPlane.setRotationFromQuaternion(quaternion)
    this.intersectionPlane.position.copy(
      new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
    )
    this.sceneInfra.setCallbacks({
      onMove: (args) => {
        if (!args.intersects.length) return
        const axisIntersection = args.intersects.find(
          (sceneObject) =>
            sceneObject.object.name === X_AXIS ||
            sceneObject.object.name === Y_AXIS
        )

        const arrowHead = getParentGroup(args.intersects[0].object, [
          ARROWHEAD,
          ARC_ANGLE_END,
          THREE_POINT_ARC_HANDLE3,
        ])
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
        let intersectsXY = { x: false, y: false }
        args.intersects.forEach((intersect) => {
          const parent = getParentGroup(intersect.object, [X_AXIS, Y_AXIS])
          if (parent?.name === X_AXIS) {
            intersectsXY.x = true
          } else if (parent?.name === Y_AXIS) {
            intersectsXY.y = true
          }
        })
        if (intersectsXY.x && intersectsXY.y) {
          snappedPoint.setComponent(0, 0)
          snappedPoint.setComponent(1, 0)
        } else if (intersectsXY.x) {
          snappedPoint.setComponent(1, 0)
        } else if (intersectsXY.y) {
          snappedPoint.setComponent(0, 0)
        } else if (arrowHead) {
          snappedPoint.set(arrowHead.position.x, arrowHead.position.y)
        } else if (parent?.name === PROFILE_START) {
          snappedPoint.set(parent.position.x, parent.position.y)
        }

        this.positionDraftPoint({
          snappedPoint,
          origin: sketchDetails.origin,
          yAxis: sketchDetails.yAxis,
          zAxis: sketchDetails.zAxis,
        })
      },
      onMouseLeave: () => {
        this.removeDraftPoint()
      },
      onClick: async (args) => {
        this.removeDraftPoint()
        if (!args) return
        // If there is a valid camera interaction that matches, do that instead
        const interaction = this.sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        if (args.mouseEvent.which !== 1) return
        const { intersectionPoint } = args
        if (!intersectionPoint?.twoD) return

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
          this.kclManager.ast,
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          [snappedClickPoint.x, snappedClickPoint.y],
          'end'
        )

        if (trap(inserted)) return
        const { modifiedAst } = inserted

        await this.kclManager.updateAst(modifiedAst, false)

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
    variableDeclarationName: string
  }> {
    const prepared = this.prepareTruncatedAst(sketchNodePaths, maybeModdedAst)
    if (err(prepared)) {
      this.tearDownSketch({ removeAxis: false })
      return Promise.reject(prepared)
    }
    const { truncatedAst, variableDeclarationName } = prepared

    const { execState } = await executeAstMock({
      ast: truncatedAst,
      rustContext: this.rustContext,
    })
    const sketchesInfo = getSketchesInfo({
      sketchNodePaths,
      variables: execState.variables,
      kclManager: this.kclManager,
    })

    const group = new Group()
    position && group.position.set(...position)
    group.userData = {
      type: SKETCH_GROUP_SEGMENTS,
      pathToNode: sketchEntryNodePath,
    }
    const dummy = new Mesh()
    // TODO: When we actually have sketch positions and rotations we can use them here.
    dummy.position.set(0, 0, 0)
    const scale = this.sceneInfra.getClientSceneScaleFactor(dummy)

    const callbacks: (() => SegmentOverlayPayload | null)[] = []
    this.sceneInfra.pauseRendering()
    this.tearDownSketch({ removeAxis: false })

    for (const sketchInfo of sketchesInfo) {
      const { sketch } = sketchInfo
      const segPathToNode = getNodePathFromSourceRange(
        maybeModdedAst,
        sourceRangeFromRust(sketch.start.__geoMeta.sourceRange)
      )
      if (!['Circle', 'CircleThreePoint'].includes(sketch?.paths?.[0]?.type)) {
        const _profileStart = createProfileStartHandle({
          from: sketch.start.from,
          id: sketch.start.__geoMeta.id,
          pathToNode: segPathToNode,
          scale,
          theme: this.sceneInfra._theme,
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
        const startProfileCallBack: () => SegmentOverlayPayload | null = () => {
          return this.sceneInfra.updateOverlayDetails({
            handle: _profileStart,
            group: _profileStart,
            isHandlesVisible: true,
            from: sketch.start.from,
            to: sketch.start.to,
            hasThreeDotMenu: true,
          })
        }

        callbacks.push(startProfileCallBack)
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
        const _node1 = getNodeFromPath<Node<CallExpressionKw>>(
          maybeModdedAst,
          segPathToNode,
          ['CallExpressionKw']
        )
        if (err(_node1)) {
          this.tearDownSketch({ removeAxis: false })
          this.sceneInfra.resumeRendering()
          return
        }
        const callExpName = _node1.node?.callee?.name.name

        const initSegment =
          segment.type === 'TangentialArcTo'
            ? segmentUtils.tangentialArc.init
            : segment.type === 'Circle'
              ? segmentUtils.circle.init
              : segment.type === 'Arc'
                ? segmentUtils.arc.init
                : segment.type === 'CircleThreePoint'
                  ? segmentUtils.circleThreePoint.init
                  : segment.type === 'ArcThreePoint'
                    ? segmentUtils.threePointArc.init
                    : segmentUtils.straight.init
        const input: SegmentInputs =
          segment.type === 'Circle'
            ? {
                type: 'arc-segment',
                from: segment.from,
                to: segment.from,
                ccw: true,
                center: segment.center,
                radius: segment.radius,
              }
            : segment.type === 'CircleThreePoint' ||
                segment.type === 'ArcThreePoint'
              ? {
                  type: 'circle-three-point-segment',
                  p1: segment.p1,
                  p2: segment.p2,
                  p3: segment.p3,
                }
              : segment.type === 'Arc'
                ? {
                    type: 'arc-segment',
                    from: segment.from,
                    center: segment.center,
                    to: segment.to,
                    ccw: segment.ccw,
                    radius: segment.radius,
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
          maybeModdedAst,
          this.kclManager
        )
        const result = initSegment({
          prevSegment: sketch.paths[index - 1],
          callExpName,
          input,
          id: segment.__geoMeta.id,
          pathToNode: segPathToNode,
          isDraftSegment,
          scale,
          texture: this.sceneInfra.extraSegmentTexture,
          theme: this.sceneInfra._theme,
          isSelected,
          sceneInfra: this.sceneInfra,
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
    this.intersectionPlane.setRotationFromQuaternion(
      this.currentSketchQuaternion
    )
    position && this.intersectionPlane.position.set(...position)
    this.sceneInfra.scene.add(group)

    this.sceneInfra.resumeRendering()

    this.sceneInfra.camControls.enableRotate = false
    this.sceneInfra.overlayCallbacks(callbacks)

    return {
      truncatedAst,
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
    const nextAst = await this.kclManager.updateAst(modifiedAst, false)
    this.sceneInfra.resetMouseListeners()
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
  didIntersectProfileStart = (
    args: OnClickCallbackArgs,
    nodePath: PathToNode
  ) => {
    return args.intersects
      .map(({ object }) => getParentGroup(object, [PROFILE_START]))
      .find(isGroupStartProfileForCurrentProfile(nodePath))
  }
  setupDraftSegment = async (
    sketchEntryNodePath: PathToNode,
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    origin: [number, number, number],
    segmentName: 'line' | 'tangentialArc' = 'line'
  ) => {
    const _ast = structuredClone(this.kclManager.ast)

    const _node1 = getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchEntryNodePath || [],
      'VariableDeclaration'
    )
    if (trap(_node1)) return Promise.reject(_node1)
    const variableDeclarationName = _node1.node?.declaration.id?.name || ''

    const sg = sketchFromKclValue(
      this.kclManager.variables[variableDeclarationName],
      variableDeclarationName
    )
    if (err(sg)) return Promise.reject(sg)
    const lastSeg = sg?.paths?.slice(-1)[0] || sg.start

    const index = sg.paths.length // because we've added a new segment that's not in the memory yet, no need for `.length -1`
    const mod = addNewSketchLn({
      node: _ast,
      variables: this.kclManager.variables,
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

    this.sceneInfra.resetMouseListeners()

    const { truncatedAst } = await this.setupSketch({
      sketchEntryNodePath,
      sketchNodePaths,
      forward,
      up,
      position: origin,
      maybeModdedAst: modifiedAst,
      draftExpressionsIndices,
    }).catch(() => {
      return { truncatedAst: modifiedAst }
    })
    this.sceneInfra.setCallbacks({
      onClick: async (args) => {
        if (!args) return
        // If there is a valid camera interaction that matches, do that instead
        const interaction = this.sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        if (args.mouseEvent.which !== 1) return

        const { intersectionPoint } = args
        let intersection2d = intersectionPoint?.twoD
        const intersectsProfileStart = this.didIntersectProfileStart(
          args,
          sketchEntryNodePath
        )

        let modifiedAst: Node<Program> | Error = structuredClone(
          this.kclManager.ast
        )

        const sketch = sketchFromPathToNode({
          pathToNode: sketchEntryNodePath,
          variables: this.kclManager.variables,
          kclManager: this.kclManager,
        })
        if (err(sketch)) return Promise.reject(sketch)
        if (!sketch) return Promise.reject(new Error('No sketch found'))

        // Snapping logic for the profile start handle
        if (intersectsProfileStart) {
          const originCoords = createArrayExpression([
            createCallExpressionStdLibKw(
              'profileStartX',
              createPipeSubstitution(),
              []
            ),
            createCallExpressionStdLibKw(
              'profileStartY',
              createPipeSubstitution(),
              []
            ),
          ])

          modifiedAst = addCallExpressionsToPipe({
            node: this.kclManager.ast,
            variables: this.kclManager.variables,
            pathToNode: sketchEntryNodePath,
            expressions: [
              segmentName === 'tangentialArc'
                ? createCallExpressionStdLibKw('tangentialArc', null, [
                    createLabeledArg(ARG_END_ABSOLUTE, originCoords),
                  ])
                : createCallExpressionStdLibKw('line', null, [
                    createLabeledArg(ARG_END_ABSOLUTE, originCoords),
                  ]),
            ],
          })
          if (trap(modifiedAst)) return Promise.reject(modifiedAst)
          modifiedAst = addCloseToPipe({
            node: modifiedAst,
            variables: this.kclManager.variables,
            pathToNode: sketchEntryNodePath,
          })
          if (trap(modifiedAst)) return Promise.reject(modifiedAst)
        } else if (intersection2d) {
          const lastSegment = sketch.paths.slice(-1)[0] || sketch.start

          let {
            snappedPoint,
            snappedToTangent,
            intersectsXAxis,
            intersectsYAxis,
            negativeTangentDirection,
          } = this.getSnappedDragPoint(
            intersection2d,
            args.intersects,
            args.mouseEvent,
            Object.values(this.activeSegments).at(-1)
          )

          // Get the angle between the previous segment (or sketch start)'s end and this one's
          const angle = Math.atan2(
            snappedPoint[1] - lastSegment.to[1],
            snappedPoint[0] - lastSegment.to[0]
          )

          const isHorizontal =
            radToDeg(Math.abs(angle)) < ANGLE_SNAP_THRESHOLD_DEGREES ||
            Math.abs(radToDeg(Math.abs(angle) - Math.PI)) <
              ANGLE_SNAP_THRESHOLD_DEGREES
          const isVertical =
            Math.abs(radToDeg(Math.abs(angle) - Math.PI / 2)) <
            ANGLE_SNAP_THRESHOLD_DEGREES

          let resolvedFunctionName: ToolTip = 'line'
          const snaps = {
            previousArcTag: '',
            negativeTangentDirection,
            xAxis: !!intersectsXAxis,
            yAxis: !!intersectsYAxis,
          }

          // This might need to become its own function if we want more
          // case-based logic for different segment types
          if (
            (lastSegment.type === 'TangentialArc' && segmentName !== 'line') ||
            segmentName === 'tangentialArc'
          ) {
            resolvedFunctionName = 'tangentialArc'
          } else if (snappedToTangent) {
            // Generate tag for previous arc segment and use it for the angle of angledLine:
            //   |> tangentialArc(endAbsolute = [5, -10], tag = $arc001)
            //   |> angledLine(angle = tangentToEnd(arc001), length = 12)

            const previousSegmentPathToNode = getNodePathFromSourceRange(
              modifiedAst,
              sourceRangeFromRust(lastSegment.__geoMeta.sourceRange)
            )
            const taggedAstResult = mutateAstWithTagForSketchSegment(
              modifiedAst,
              previousSegmentPathToNode
            )
            if (trap(taggedAstResult)) return Promise.reject(taggedAstResult)

            modifiedAst = taggedAstResult.modifiedAst
            snaps.previousArcTag = taggedAstResult.tag
            resolvedFunctionName = 'angledLine'
          } else if (isHorizontal) {
            // If the angle between is 0 or 180 degrees (+/- the snapping angle), make the line an xLine
            resolvedFunctionName = 'xLine'
          } else if (isVertical) {
            // If the angle between is 90 or 270 degrees (+/- the snapping angle), make the line a yLine
            resolvedFunctionName = 'yLine'
          } else if (snappedPoint[0] === 0 || snappedPoint[1] === 0) {
            // We consider a point placed on axes or origin to be absolute
            resolvedFunctionName = 'lineTo'
          }

          const tmp = addNewSketchLn({
            node: modifiedAst,
            variables: this.kclManager.variables,
            input: {
              type: 'straight-segment',
              from: [lastSegment.to[0], lastSegment.to[1]],
              to: [snappedPoint[0], snappedPoint[1]],
            },
            fnName: resolvedFunctionName,
            pathToNode: sketchEntryNodePath,
            snaps,
          })
          if (trap(tmp)) return Promise.reject(tmp)
          modifiedAst = tmp.modifiedAst
          if (trap(modifiedAst)) return Promise.reject(modifiedAst)
        } else {
          // return early as we didn't modify the ast
          return
        }

        await updateModelingState(modifiedAst, EXECUTION_TYPE_MOCK, {
          kclManager: this.kclManager,
          editorManager: this.editorManager,
          codeManager: this.codeManager,
        })

        if (intersectsProfileStart) {
          this.sceneInfra.modelingSend({ type: 'Close sketch' })
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
          draftInfo: {
            truncatedAst,
            variableDeclarationName,
          },
          mouseEvent: args.mouseEvent,
        })
      },
    })
  }
  setupDraftRectangle = async (
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    rectangleOrigin: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(this.kclManager.ast)

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
      createCallExpressionStdLibKw(
        'startProfile',
        createLocalName(varDec.node.id.name),
        [
          createLabeledArg(
            ARG_AT,
            createArrayExpression([
              createLiteral(roundOff(rectangleOrigin[0])),
              createLiteral(roundOff(rectangleOrigin[1])),
            ])
          ),
        ]
      )
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
    const didReParse = await this.kclManager.executeAstMock(_ast)
    if (err(didReParse)) return didReParse

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
      ...getRectangleCallExpressions(tag),
    ])

    const code = recast(_ast)
    const _recastAst = parse(code)
    if (trap(_recastAst) || !resultIsOk(_recastAst))
      return Promise.reject(_recastAst)
    _ast = _recastAst.program

    const { truncatedAst } = await this.setupSketch({
      sketchEntryNodePath: updatedEntryNodePath,
      sketchNodePaths: updatedSketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 3 },
    })

    this.sceneInfra.setCallbacks({
      onMove: async (args) => {
        // Update the width and height of the draft rectangle

        const nodePathWithCorrectedIndexForTruncatedAst =
          getPathNormalisedForTruncatedAst(
            updatedEntryNodePath,
            updatedSketchNodePaths
          )

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

        const { execState } = await executeAstMock({
          ast: truncatedAst,
          rustContext: this.rustContext,
        })
        const sketch = sketchFromKclValue(execState.variables[varName], varName)
        if (err(sketch)) return Promise.reject(sketch)
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

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

        const { intersectionPoint } = args
        if (!intersectionPoint?.twoD) return
        const { snappedPoint, isSnapped } = this.getSnappedDragPoint(
          intersectionPoint.twoD,
          args.intersects,
          args.mouseEvent
        )
        if (isSnapped) {
          this.positionDraftPoint({
            snappedPoint: new Vector2(...snappedPoint),
            origin: sketchOrigin,
            yAxis: forward,
            zAxis: up,
          })
        } else {
          this.removeDraftPoint()
        }
      },
      onClick: async (args) => {
        // If there is a valid camera interaction that matches, do that instead
        const interaction = this.sceneInfra.camControls.getInteractionType(
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
        //
        // lee: I had this at the bottom of the function, but it's
        // possible sketchFromKclValue "fails" when sketching on a face,
        // and this couldn't wouldn't run.
        await updateModelingState(_ast, EXECUTION_TYPE_MOCK, {
          kclManager: this.kclManager,
          editorManager: this.editorManager,
          codeManager: this.codeManager,
        })
        this.sceneInfra.modelingSend({ type: 'Finish rectangle' })
      },
    })
    return {
      updatedEntryNodePath,
      updatedSketchNodePaths,
      expressionIndexToDelete: insertIndex,
    }
  }
  setupDraftCenterRectangle = async (
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    rectangleOrigin: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(this.kclManager.ast)

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
      createCallExpressionStdLibKw(
        'startProfile',
        createLocalName(varDec.node.id.name),
        [
          createLabeledArg(
            ARG_AT,
            createArrayExpression([
              createLiteral(roundOff(rectangleOrigin[0])),
              createLiteral(roundOff(rectangleOrigin[1])),
            ])
          ),
        ]
      )
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
    await this.kclManager.executeAstMock(_ast)

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
      ...getRectangleCallExpressions(tag),
    ])
    const code = recast(_ast)
    __recastAst = parse(code)
    if (trap(__recastAst) || !resultIsOk(__recastAst))
      return Promise.reject(__recastAst)
    _ast = __recastAst.program

    const { truncatedAst } = await this.setupSketch({
      sketchEntryNodePath: updatedEntryNodePath,
      sketchNodePaths: updatedSketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 3 },
    })

    this.sceneInfra.setCallbacks({
      onMove: async (args) => {
        // Update the width and height of the draft rectangle

        const nodePathWithCorrectedIndexForTruncatedAst =
          getPathNormalisedForTruncatedAst(
            updatedEntryNodePath,
            updatedSketchNodePaths
          )

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
          const maybeError = updateCenterRectangleSketch(
            sketchInit,
            x,
            y,
            tag,
            rectangleOrigin[0],
            rectangleOrigin[1]
          )
          if (err(maybeError)) {
            return Promise.reject(maybeError)
          }
        }

        const { execState } = await executeAstMock({
          ast: truncatedAst,
          rustContext: this.rustContext,
        })
        const sketch = sketchFromKclValue(execState.variables[varName], varName)
        if (err(sketch)) return Promise.reject(sketch)
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

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
        const interaction = this.sceneInfra.camControls.getInteractionType(
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
          const maybeError = updateCenterRectangleSketch(
            sketchInit,
            x,
            y,
            tag,
            rectangleOrigin[0],
            rectangleOrigin[1]
          )
          if (err(maybeError)) {
            return Promise.reject(maybeError)
          }

          const pResult = parse(recast(_ast))
          if (trap(pResult) || !resultIsOk(pResult))
            return Promise.reject(pResult)
          _ast = pResult.program

          // Update the primary AST and unequip the rectangle tool
          //
          // lee: I had this at the bottom of the function, but it's
          // possible sketchFromKclValue "fails" when sketching on a face,
          // and this couldn't wouldn't run.
          await updateModelingState(_ast, EXECUTION_TYPE_MOCK, {
            kclManager: this.kclManager,
            editorManager: this.editorManager,
            codeManager: this.codeManager,
          })
          this.sceneInfra.modelingSend({ type: 'Finish center rectangle' })
        }
      },
    })
    return {
      updatedEntryNodePath,
      updatedSketchNodePaths,
      expressionIndexToDelete: insertIndex,
    }
  }
  setupDraftCircleThreePoint = async (
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    point1: [x: number, y: number],
    point2: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(this.kclManager.ast)

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
    const didReParse = await this.kclManager.executeAstMock(_ast)
    if (err(didReParse)) return didReParse

    const { truncatedAst } = await this.setupSketch({
      sketchEntryNodePath: updatedEntryNodePath,
      sketchNodePaths: updatedSketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 0 },
    })

    this.sceneInfra.setCallbacks({
      onMove: async (args) => {
        const nodePathWithCorrectedIndexForTruncatedAst =
          getPathNormalisedForTruncatedAst(
            updatedEntryNodePath,
            updatedSketchNodePaths
          )
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
            this.kclManager.variables,
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

        const { execState } = await executeAstMock({
          ast: modded,
          rustContext: this.rustContext,
        })
        const sketch = sketchFromKclValue(execState.variables[varName], varName)
        if (err(sketch)) return
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

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
        const interaction = this.sceneInfra.camControls.getInteractionType(
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
            this.kclManager.variables,
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
          await updateModelingState(_ast, EXECUTION_TYPE_MOCK, {
            kclManager: this.kclManager,
            editorManager: this.editorManager,
            codeManager: this.codeManager,
          })
          this.sceneInfra.modelingSend({ type: 'Finish circle three point' })
        }
      },
    })
    return {
      updatedEntryNodePath,
      updatedSketchNodePaths,
      expressionIndexToDelete: insertIndex,
    }
  }
  setupDraftArc = async (
    sketchEntryNodePath: PathToNode,
    sketchNodePaths: PathToNode[],
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    center: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(this.kclManager.ast)

    const _node1 = getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchEntryNodePath || [],
      'VariableDeclaration'
    )
    if (trap(_node1)) return Promise.reject(_node1)
    const variableDeclarationName = _node1.node?.declaration.id?.name || ''

    const sg = sketchFromKclValue(
      this.kclManager.variables[variableDeclarationName],
      variableDeclarationName
    )
    if (err(sg)) return Promise.reject(sg)
    const lastSeg = sg?.paths?.slice(-1)[0] || sg.start

    // Calculate a default center point and radius based on the last segment's endpoint
    const from: [number, number] = [lastSeg.to[0], lastSeg.to[1]]
    const radius = Math.sqrt(
      (center[0] - from[0]) ** 2 + (center[1] - from[1]) ** 2
    )
    const startAngle = Math.atan2(from[1] - center[1], from[0] - center[0])
    const endAngle = startAngle + Math.PI / 180 // arbitrary 1 degree arc as starting default
    const to: [number, number] = [
      center[0] + radius * Math.cos(endAngle),
      center[1] + radius * Math.sin(endAngle),
    ]

    // Use addNewSketchLn to append an arc to the existing sketch
    const mod = addNewSketchLn({
      node: _ast,
      variables: this.kclManager.variables,
      input: {
        type: 'arc-segment',
        from,
        to,
        center,
        radius,
        ccw: true,
      },
      fnName: 'arc' as ToolTip,
      pathToNode: sketchEntryNodePath,
    })

    if (trap(mod)) return Promise.reject(mod)
    const pResult = parse(recast(mod.modifiedAst))
    if (trap(pResult) || !resultIsOk(pResult)) return Promise.reject(pResult)
    _ast = pResult.program

    // do a quick mock execution to get the program memory up-to-date
    const didReParse = await this.kclManager.executeAstMock(_ast)
    if (err(didReParse)) return didReParse

    const index = sg.paths.length // because we've added a new segment that's not in the memory yet
    const draftExpressionsIndices = { start: index, end: index }

    this.sceneInfra.resetMouseListeners()

    const { truncatedAst } = await this.setupSketch({
      sketchEntryNodePath,
      sketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices,
    })

    this.sceneInfra.setCallbacks({
      onMove: async (args) => {
        const nodePathWithCorrectedIndexForTruncatedAst =
          getPathNormalisedForTruncatedAst(mod.pathToNode, sketchNodePaths)
        const _node = getNodeFromPath<VariableDeclaration>(
          truncatedAst,
          nodePathWithCorrectedIndexForTruncatedAst,
          'VariableDeclaration'
        )
        let modded = structuredClone(truncatedAst)
        if (trap(_node)) return
        const sketchInit = _node.node.declaration.init

        if (sketchInit.type === 'PipeExpression') {
          // Calculate end angle based on mouse position
          const endAngle = Math.atan2(
            args.intersectionPoint.twoD.y - center[1],
            args.intersectionPoint.twoD.x - center[0]
          )

          // Calculate the new 'to' point using the existing radius and the new end angle
          const newTo: [number, number] = [
            center[0] + radius * Math.cos(endAngle),
            center[1] + radius * Math.sin(endAngle),
          ]

          const moddedResult = changeSketchArguments(
            modded,
            this.kclManager.variables,
            {
              type: 'path',
              pathToNode: nodePathWithCorrectedIndexForTruncatedAst,
            },
            {
              type: 'arc-segment',
              from: lastSeg.to,
              to: newTo,
              center: center,
              radius: radius,
              ccw: true,
            }
          )
          if (err(moddedResult)) return
          modded = moddedResult.modifiedAst
        }
        const { execState } = await executeAstMock({
          ast: modded,
          rustContext: this.rustContext,
        })
        const sketch = sketchFromKclValue(
          execState.variables[variableDeclarationName],
          variableDeclarationName
        )
        if (err(sketch)) return
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

        const varDecIndex = Number(sketchEntryNodePath[1][0])

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
        const interaction = this.sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        // Commit the arc to the full AST/code and return to sketch.idle
        const mousePoint = args.intersectionPoint?.twoD
        if (!mousePoint || args.mouseEvent.button !== 0) return

        const _node = getNodeFromPath<VariableDeclaration>(
          _ast,
          sketchEntryNodePath || [],
          'VariableDeclaration'
        )
        if (trap(_node)) return
        const sketchInit = _node.node?.declaration.init

        let modded = structuredClone(_ast)
        if (sketchInit.type === 'PipeExpression') {
          // Calculate end angle based on final mouse position
          const endAngle = Math.atan2(
            mousePoint.y - center[1],
            mousePoint.x - center[0]
          )

          // Calculate the final 'to' point using the existing radius and the final end angle
          const finalTo: [number, number] = [
            center[0] + radius * Math.cos(endAngle),
            center[1] + radius * Math.sin(endAngle),
          ]

          const moddedResult = changeSketchArguments(
            modded,
            this.kclManager.variables,
            {
              type: 'path',
              pathToNode: mod.pathToNode,
            },
            {
              type: 'arc-segment',
              from: lastSeg.to,
              to: finalTo,
              center: center,
              radius: radius,
              ccw: true,
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

          // Update the primary AST and unequip the arc tool
          await updateModelingState(_ast, EXECUTION_TYPE_MOCK, {
            kclManager: this.kclManager,
            editorManager: this.editorManager,
            codeManager: this.codeManager,
          })
          this.sceneInfra.modelingSend({ type: 'Finish arc' })
        }
      },
    })
    return {
      updatedEntryNodePath: sketchEntryNodePath,
      updatedSketchNodePaths: sketchNodePaths,
      expressionIndexToDelete: -1, // No need to delete any expression
    }
  }
  setupDraftArcThreePoint = async (
    sketchEntryNodePath: PathToNode,
    sketchNodePaths: PathToNode[],
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    p2: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(this.kclManager.ast)

    const _node1 = getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchEntryNodePath || [],
      'VariableDeclaration'
    )
    if (trap(_node1)) return Promise.reject(_node1)
    const variableDeclarationName = _node1.node?.declaration.id?.name || ''

    const sg = sketchFromKclValue(
      this.kclManager.variables[variableDeclarationName],
      variableDeclarationName
    )
    if (err(sg)) return Promise.reject(sg)
    const lastSeg = sg?.paths?.slice(-1)[0] || sg.start

    // Calculate a default center point and radius based on the last segment's endpoint
    const p1: [number, number] = [lastSeg.to[0], lastSeg.to[1]]
    const p3: [number, number] = [p2[0] + 0.1, p2[1] + 0.1]

    // Use addNewSketchLn to append an arc to the existing sketch
    const mod = addNewSketchLn({
      node: _ast,
      variables: this.kclManager.variables,
      input: {
        type: 'circle-three-point-segment',
        p1,
        p2,
        p3,
      },
      fnName: 'arcTo',
      pathToNode: sketchEntryNodePath,
    })

    if (trap(mod)) return Promise.reject(mod)
    const pResult = parse(recast(mod.modifiedAst))
    if (trap(pResult) || !resultIsOk(pResult)) return Promise.reject(pResult)
    _ast = pResult.program

    // do a quick mock execution to get the program memory up-to-date
    const didReParse = await this.kclManager.executeAstMock(_ast)
    if (err(didReParse)) return didReParse

    const index = sg.paths.length // because we've added a new segment that's not in the memory yet
    const draftExpressionsIndices = { start: index, end: index }

    // Get the insertion index from the modified path
    const insertIndex = Number(mod.pathToNode[1][0])

    this.sceneInfra.resetMouseListeners()

    const { truncatedAst } = await this.setupSketch({
      sketchEntryNodePath,
      sketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices,
    })

    const doNotSnapAsThreePointArcIsTheOnlySegment = sg.paths.length === 0

    this.sceneInfra.setCallbacks({
      onMove: async (args) => {
        const nodePathWithCorrectedIndexForTruncatedAst =
          getPathNormalisedForTruncatedAst(mod.pathToNode, sketchNodePaths)
        const _node = getNodeFromPath<VariableDeclaration>(
          truncatedAst,
          nodePathWithCorrectedIndexForTruncatedAst,
          'VariableDeclaration'
        )
        let modded = structuredClone(truncatedAst)
        if (trap(_node)) return
        const sketchInit = _node.node.declaration.init

        const maybeSnapToAxis = this.getSnappedDragPoint(
          args.intersectionPoint.twoD,
          args.intersects,
          args.mouseEvent
        ).snappedPoint

        const maybeSnapToProfileStart = doNotSnapAsThreePointArcIsTheOnlySegment
          ? new Vector2(...maybeSnapToAxis)
          : this.maybeSnapProfileStartIntersect2d({
              sketchEntryNodePath,
              intersects: args.intersects,
              intersection2d: new Vector2(...maybeSnapToAxis),
            })

        if (sketchInit.type === 'PipeExpression') {
          const moddedResult = changeSketchArguments(
            modded,
            this.kclManager.variables,
            {
              type: 'path',
              pathToNode: nodePathWithCorrectedIndexForTruncatedAst,
            },
            {
              type: 'circle-three-point-segment',
              p1,
              p2,
              p3: [maybeSnapToProfileStart.x, maybeSnapToProfileStart.y],
            }
          )
          if (err(moddedResult)) return
          modded = moddedResult.modifiedAst
        }
        const { execState } = await executeAstMock({
          ast: modded,
          rustContext: this.rustContext,
        })
        const sketch = sketchFromKclValue(
          execState.variables[variableDeclarationName],
          variableDeclarationName
        )
        if (err(sketch)) return
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

        const varDecIndex = Number(sketchEntryNodePath[1][0])

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
        const interaction = this.sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        // Commit the arc to the full AST/code and return to sketch.idle
        const mousePoint = args.intersectionPoint?.twoD
        if (!mousePoint || args.mouseEvent.button !== 0) return

        const _node = getNodeFromPath<VariableDeclaration>(
          _ast,
          sketchEntryNodePath || [],
          'VariableDeclaration'
        )
        if (trap(_node)) return
        const sketchInit = _node.node?.declaration.init

        let modded = structuredClone(_ast)

        const intersectsProfileStart =
          !doNotSnapAsThreePointArcIsTheOnlySegment &&
          this.didIntersectProfileStart(args, sketchEntryNodePath)
        if (sketchInit.type === 'PipeExpression' && args.intersectionPoint) {
          // Calculate end angle based on final mouse position

          const moddedResult = changeSketchArguments(
            modded,
            this.kclManager.variables,
            {
              type: 'path',
              pathToNode: mod.pathToNode,
            },
            {
              type: 'circle-three-point-segment',
              p1,
              p2,
              p3: this.getSnappedDragPoint(
                args.intersectionPoint.twoD,
                args.intersects,
                args.mouseEvent
              ).snappedPoint,
            }
          )
          if (err(moddedResult)) return
          modded = moddedResult.modifiedAst
          if (intersectsProfileStart) {
            const originCoords = createArrayExpression([
              createCallExpressionStdLibKw(
                'profileStartX',
                createPipeSubstitution(),
                []
              ),
              createCallExpressionStdLibKw(
                'profileStartY',
                createPipeSubstitution(),
                []
              ),
            ])

            const arcToCallExp = getNodeFromPath<CallExpressionKw>(
              modded,
              mod.pathToNode,
              'CallExpressionKw'
            )
            if (err(arcToCallExp)) return
            mutateKwArgOnly(ARG_END_ABSOLUTE, arcToCallExp.node, originCoords)

            const moddedResult = addCloseToPipe({
              node: modded,
              variables: this.kclManager.variables,
              pathToNode: sketchEntryNodePath,
            })
            if (err(moddedResult)) return
            modded = moddedResult
          }

          const newCode = recast(modded)
          if (err(newCode)) return
          const pResult = parse(newCode)
          if (trap(pResult) || !resultIsOk(pResult))
            return Promise.reject(pResult)
          _ast = pResult.program

          // Update the primary AST and unequip the arc tool
          await updateModelingState(_ast, EXECUTION_TYPE_MOCK, {
            kclManager: this.kclManager,
            editorManager: this.editorManager,
            codeManager: this.codeManager,
          })
          if (intersectsProfileStart) {
            this.sceneInfra.modelingSend({ type: 'Close sketch' })
          } else {
            this.sceneInfra.modelingSend({ type: 'Finish arc' })
          }
        }
      },
    })
    return {
      updatedEntryNodePath: mod.pathToNode,
      updatedSketchNodePaths: sketchNodePaths,
      expressionIndexToDelete: insertIndex, // Return the insertion index so it can be deleted if needed
    }
  }
  setupDraftCircle = async (
    sketchNodePaths: PathToNode[],
    planeNodePath: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    circleCenter: [x: number, y: number]
  ): Promise<SketchDetailsUpdate | Error> => {
    let _ast = structuredClone(this.kclManager.ast)

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
      createCallExpressionStdLibKw(
        'circle',
        createLocalName(varDec.node.id.name),
        [
          createLabeledArg(
            'center',
            createArrayExpression([
              createLiteral(roundOff(circleCenter[0])),
              createLiteral(roundOff(circleCenter[1])),
            ])
          ),
          createLabeledArg('radius', createLiteral(1)),
        ]
      )
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
    const didReParse = await this.kclManager.executeAstMock(_ast)
    if (err(didReParse)) return didReParse

    const { truncatedAst } = await this.setupSketch({
      sketchEntryNodePath: updatedEntryNodePath,
      sketchNodePaths: updatedSketchNodePaths,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 0 },
    })

    this.sceneInfra.setCallbacks({
      onMove: async (args) => {
        const nodePathWithCorrectedIndexForTruncatedAst =
          getPathNormalisedForTruncatedAst(
            updatedEntryNodePath,
            updatedSketchNodePaths
          )
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

        if (sketchInit.type === 'CallExpressionKw') {
          const moddedResult = changeSketchArguments(
            modded,
            this.kclManager.variables,
            {
              type: 'path',
              pathToNode: nodePathWithCorrectedIndexForTruncatedAst,
            },
            {
              type: 'arc-segment',
              center: circleCenter,
              radius: Math.sqrt(x ** 2 + y ** 2),
              from: circleCenter,
              to: circleCenter, // Same as from for a full circle
              ccw: true,
            }
          )
          if (err(moddedResult)) {
            return
          }
          modded = moddedResult.modifiedAst
        }

        const { execState } = await executeAstMock({
          ast: modded,
          rustContext: this.rustContext,
        })
        const sketch = sketchFromKclValue(execState.variables[varName], varName)
        if (err(sketch)) return
        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

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
        const interaction = this.sceneInfra.camControls.getInteractionType(
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
        if (sketchInit.type === 'CallExpressionKw') {
          const moddedResult = changeSketchArguments(
            modded,
            this.kclManager.variables,
            {
              type: 'path',
              pathToNode: updatedEntryNodePath,
            },
            {
              type: 'arc-segment',
              center: circleCenter,
              radius: Math.sqrt(x ** 2 + y ** 2),
              from: circleCenter,
              to: circleCenter, // Same as from for a full circle
              ccw: true,
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
          await updateModelingState(_ast, EXECUTION_TYPE_MOCK, {
            kclManager: this.kclManager,
            editorManager: this.editorManager,
            codeManager: this.codeManager,
          })
          this.sceneInfra.modelingSend({ type: 'Finish circle' })
        }
      },
    })
    return {
      updatedEntryNodePath,
      updatedSketchNodePaths,
      expressionIndexToDelete: insertIndex,
    }
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
    this.sceneInfra.setCallbacks({
      onDragEnd: async () => {
        if (addingNewSegmentStatus !== 'nothing') {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.setupSketch({
            sketchEntryNodePath,
            sketchNodePaths,
            maybeModdedAst: this.kclManager.ast,
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
          await this.codeManager.writeToFile()
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
            variables: this.kclManager.variables,
            kclManager: this.kclManager,
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
              node: this.kclManager.ast,
              variables: this.kclManager.variables,
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

            const didReParse = await this.kclManager.executeAstMock(
              mod.modifiedAst
            )
            if (err(didReParse)) return
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.setupSketch({
              sketchEntryNodePath: pathToNode,
              sketchNodePaths,
              maybeModdedAst: this.kclManager.ast,
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
              object: selected,
              intersection2d: intersectionPoint.twoD,
              intersects,
              mouseEvent: mouseEvent,
            })
          }
          return
        }

        this.onDragSegment({
          object: selected,
          intersection2d: intersectionPoint.twoD,
          intersects,
          sketchNodePaths,
          sketchEntryNodePath,
          mouseEvent: mouseEvent,
        })
      },
      onMove: () => {},
      onClick: (args) => {
        // If there is a valid camera interaction that matches, do that instead
        const interaction = this.sceneInfra.camControls.getInteractionType(
          args.mouseEvent
        )
        if (interaction !== 'none') return
        if (args?.mouseEvent.which !== 1) return
        if (!args || !args.selected) {
          this.sceneInfra.modelingSend({
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
        this.sceneInfra.modelingSend(event)
      },
      ...this.mouseEnterLeaveCallbacks(),
    })
  }
  prepareTruncatedAst = (
    sketchNodePaths: PathToNode[],
    ast?: Node<Program>,
    draftSegment?: DraftSegment
  ) =>
    prepareTruncatedAst(
      sketchNodePaths,
      ast || this.kclManager.ast,
      this.kclManager.lastSuccessfulVariables,
      draftSegment
    )

  getSnappedDragPoint(
    pos: Vector2,
    intersects: Intersection<Object3D<Object3DEventMap>>[],
    mouseEvent: MouseEvent,
    // During draft segment mouse move:
    //  - the  three.js object currently being dragged: the new draft segment or existing segment (may not be the last in activeSegments)
    // When placing the draft segment::
    // - the last segment in activeSegments
    currentObject?: Object3D | Group
  ) {
    let snappedPoint: Coords2d = [pos.x, pos.y]

    const intersectsYAxis = intersects.find(
      (sceneObject) => sceneObject.object.name === Y_AXIS
    )
    const intersectsXAxis = intersects.find(
      (sceneObject) => sceneObject.object.name === X_AXIS
    )

    // Snap to previous segment's tangent direction when drawing a straight segment
    let snappedToTangent = false
    let negativeTangentDirection = false

    const disableTangentSnapping = mouseEvent.ctrlKey || mouseEvent.altKey
    const forceDirectionSnapping = mouseEvent.shiftKey
    if (!disableTangentSnapping) {
      const segments: SafeArray<Group> = Object.values(this.activeSegments) // Using the order in the object feels wrong
      const currentIndex =
        currentObject instanceof Group ? segments.indexOf(currentObject) : -1
      const current = segments[currentIndex]
      if (
        current?.userData.type === STRAIGHT_SEGMENT &&
        // This draft check is not strictly necessary currently, but we only want
        // to snap when drawing a new segment, this makes that more robust.
        current?.userData.draft
      ) {
        const prev = segments[currentIndex - 1]
        if (prev && ARC_SEGMENT_TYPES.includes(prev.userData.type)) {
          const snapDirection = findTangentDirection(prev)
          if (snapDirection) {
            const SNAP_TOLERANCE_PIXELS = 8 * window.devicePixelRatio
            const SNAP_MIN_DISTANCE_PIXELS = 10 * window.devicePixelRatio
            const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

            // See if snapDirection intersects with any of the axes
            if (intersectsXAxis || intersectsYAxis) {
              let intersectionPoint: Coords2d | undefined
              if (intersectsXAxis && intersectsYAxis) {
                // Current mouse position intersects with both axes (origin) -> that has precedence over tangent so we snap to the origin.
                intersectionPoint = [0, 0]
              } else {
                // Intersects only one axis
                const axisLine: [Coords2d, Coords2d] = intersectsXAxis
                  ? [
                      [0, 0],
                      [1, 0],
                    ]
                  : [
                      [0, 0],
                      [0, 1],
                    ]
                // See if that axis line intersects with the tangent direction
                // Note: this includes both positive and negative tangent directions as it just checks 2 lines.
                intersectionPoint = calculateIntersectionOfTwoLines({
                  line1: axisLine,
                  line2Angle: getAngle([0, 0], snapDirection),
                  line2Point: current.userData.from,
                })
              }

              // If yes, see if that intersection point is within tolerance and if yes snap to it.
              if (
                intersectionPoint &&
                getLength(intersectionPoint, snappedPoint) / orthoFactor <
                  SNAP_TOLERANCE_PIXELS
              ) {
                snappedPoint = intersectionPoint
                snappedToTangent = true
              }
            }
            if (!snappedToTangent) {
              // Otherwise, try to snap to the tangent direction, in both positive and negative directions
              const { closestPoint, t } = closestPointOnRay(
                prev.userData.to,
                snapDirection,
                snappedPoint,
                true
              )
              if (
                forceDirectionSnapping ||
                (this.sceneInfra.screenSpaceDistance(
                  closestPoint,
                  snappedPoint
                ) < SNAP_TOLERANCE_PIXELS &&
                  // We only want to snap to the tangent direction if the mouse has moved enough to avoid quick jumps
                  // at the beginning of the drag
                  this.sceneInfra.screenSpaceDistance(
                    current.userData.from,
                    current.userData.to
                  ) > SNAP_MIN_DISTANCE_PIXELS)
              ) {
                snappedPoint = closestPoint
                snappedToTangent = true
                negativeTangentDirection = t < 0
              }
            }
          }
        }
      }
    }

    // Snap to the main axes if there was no snapping to tangent direction
    if (!snappedToTangent) {
      snappedPoint = [
        intersectsYAxis ? 0 : snappedPoint[0],
        intersectsXAxis ? 0 : snappedPoint[1],
      ]
    }

    return {
      isSnapped: !!(intersectsYAxis || intersectsXAxis || snappedToTangent),
      snappedToTangent,
      negativeTangentDirection,
      snappedPoint,
      intersectsXAxis,
      intersectsYAxis,
    }
  }

  positionDraftPoint({
    origin,
    yAxis,
    zAxis,
    snappedPoint,
  }: {
    origin: SketchDetails['origin']
    yAxis: SketchDetails['yAxis']
    zAxis: SketchDetails['zAxis']
    snappedPoint: Vector2
  }) {
    const draftPoint = this.getDraftPoint()
    if (!draftPoint) {
      this.createDraftPoint({
        point: snappedPoint,
        origin,
        yAxis,
        zAxis,
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
  }

  maybeSnapProfileStartIntersect2d({
    sketchEntryNodePath,
    intersects,
    intersection2d: _intersection2d,
  }: {
    sketchEntryNodePath: PathToNode
    intersects: Intersection<Object3D<Object3DEventMap>>[]
    intersection2d: Vector2
  }) {
    const intersectsProfileStart = intersects
      .map(({ object }) => getParentGroup(object, [PROFILE_START]))
      .find(isGroupStartProfileForCurrentProfile(sketchEntryNodePath))
    const intersection2d = intersectsProfileStart
      ? new Vector2(
          intersectsProfileStart.position.x,
          intersectsProfileStart.position.y
        )
      : _intersection2d
    return intersection2d
  }

  onDragSegment({
    object,
    intersection2d: _intersection2d,
    sketchEntryNodePath,
    sketchNodePaths,
    draftInfo,
    intersects,
    mouseEvent,
  }: {
    object: Object3D<Object3DEventMap>
    intersection2d: Vector2
    sketchEntryNodePath: PathToNode
    sketchNodePaths: PathToNode[]
    intersects: Intersection<Object3D<Object3DEventMap>>[]
    draftInfo?: {
      truncatedAst: Node<Program>
      variableDeclarationName: string
    }
    mouseEvent: MouseEvent
  }) {
    const intersection2d = this.maybeSnapProfileStartIntersect2d({
      sketchEntryNodePath,
      intersects,
      intersection2d: _intersection2d,
    })

    const group = getParentGroup(object, SEGMENT_BODIES_PLUS_PROFILE_START)
    const subGroup = getParentGroup(object, [
      ARROWHEAD,
      CIRCLE_CENTER_HANDLE,
      CIRCLE_THREE_POINT_HANDLE1,
      CIRCLE_THREE_POINT_HANDLE2,
      CIRCLE_THREE_POINT_HANDLE3,
      THREE_POINT_ARC_HANDLE2,
      THREE_POINT_ARC_HANDLE3,
      ARC_ANGLE_END,
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
    const { snappedPoint: dragTo, snappedToTangent } = this.getSnappedDragPoint(
      intersection2d,
      intersects,
      mouseEvent,
      object
    )
    let modifiedAst = draftInfo
      ? draftInfo.truncatedAst
      : { ...this.kclManager.ast }

    const nodePathWithCorrectedIndexForTruncatedAst =
      getPathNormalisedForTruncatedAst(pathToNode, sketchNodePaths)

    const _node = getNodeFromPath<Node<CallExpressionKw>>(
      modifiedAst,
      draftInfo ? nodePathWithCorrectedIndexForTruncatedAst : pathToNode,
      ['CallExpressionKw']
    )
    if (trap(_node)) return
    const node = _node.node

    if (node.type !== 'CallExpressionKw') return

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
          to: from, // Same as from for a full circle
          center: group.userData.center,
          // distance between the center and the drag point
          radius: Math.sqrt(
            (group.userData.center[0] - dragTo[0]) ** 2 +
              (group.userData.center[1] - dragTo[1]) ** 2
          ),
          ccw: true,
        }
      if (
        group.name === CIRCLE_SEGMENT &&
        subGroup?.name === CIRCLE_CENTER_HANDLE
      )
        return {
          type: 'arc-segment',
          from,
          to: from, // Same as from for a full circle
          center: dragTo,
          radius: group.userData.radius,
          ccw: true,
        }

      // Handle ARC_SEGMENT with center handle
      if (
        group.name === ARC_SEGMENT &&
        subGroup?.name === CIRCLE_CENTER_HANDLE
      ) {
        // the user is dragging the circle's center, but the values they updating the arc's radius and start angle
        // we need to calculate what the radius should be and a new to point that respects the endAngle
        const newCenter = dragTo
        const radius = Math.sqrt(
          (newCenter[0] - group.userData.from[0]) ** 2 +
            (newCenter[1] - group.userData.from[1]) ** 2
        )
        const endAngle = Math.atan2(
          group.userData.to[1] - group.userData.center[1],
          group.userData.to[0] - group.userData.center[0]
        )
        const newTo: [number, number] = [
          newCenter[0] + radius * Math.cos(endAngle),
          newCenter[1] + radius * Math.sin(endAngle),
        ]
        return {
          type: 'arc-segment',
          from: group.userData.from,
          to: newTo,
          center: newCenter,
          radius,
          ccw: group.userData.ccw,
        }
      }
      // Handle ARC_SEGMENT with end angle handle
      if (group.name === ARC_SEGMENT && subGroup?.name === ARC_ANGLE_END) {
        // Calculate the angle from center to drag point
        const center = group.userData.center
        const endAngle = Math.atan2(
          dragTo[1] - center[1],
          dragTo[0] - center[0]
        )

        // Calculate the point on the arc at the given angle and radius
        const radius = group.userData.radius
        const toPoint: [number, number] = [
          center[0] + radius * Math.cos(endAngle),
          center[1] + radius * Math.sin(endAngle),
        ]

        return {
          type: 'arc-segment',
          from: group.userData.from,
          to: toPoint,
          center: center,
          radius: radius,
          ccw: group.userData.ccw,
        }
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
      if (
        subGroup?.name &&
        [THREE_POINT_ARC_HANDLE2, THREE_POINT_ARC_HANDLE3].includes(
          subGroup?.name
        )
      ) {
        const input: SegmentInputs = {
          type: 'circle-three-point-segment',
          p1: group.userData.p1,
          p2: group.userData.p2,
          p3: group.userData.p3,
        }
        if (subGroup?.name === THREE_POINT_ARC_HANDLE2) {
          input.p2 = dragTo
        } else if (subGroup?.name === THREE_POINT_ARC_HANDLE3) {
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
        variables: this.kclManager.variables,
      })
    } else {
      modded = changeSketchArguments(
        modifiedAst,
        this.kclManager.variables,
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
      : this.prepareTruncatedAst(sketchNodePaths || [], modifiedAst)
    if (trap(info, { suppress: true })) return
    const { truncatedAst } = info
    ;(async () => {
      const code = recast(modifiedAst)
      if (trap(code)) return
      if (!draftInfo)
        // don't want to mod the user's code yet as they have't committed to the change yet
        // plus this would be the truncated ast being recast, it would be wrong
        this.codeManager.updateCodeEditor(code)
      const { execState } = await executeAstMock({
        ast: truncatedAst,
        rustContext: this.rustContext,
      })
      const variables = execState.variables
      const sketchesInfo = getSketchesInfo({
        sketchNodePaths,
        variables,
        kclManager: this.kclManager,
      })
      const callbacks: (() => SegmentOverlayPayload | null)[] = []
      for (const sketchInfo of sketchesInfo) {
        const { sketch, pathToNode: _pathToNode } = sketchInfo
        const varDecIndex = Number(_pathToNode[1][0])

        if (!sketch) return

        const sgPaths = sketch.paths
        const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

        this.updateSegment(
          sketch.start,
          0,
          varDecIndex,
          modifiedAst,
          orthoFactor,
          sketch,
          snappedToTangent
        )

        const startProfileCallBack: () => SegmentOverlayPayload | null = () => {
          return this.sceneInfra.updateOverlayDetails({
            handle: group,
            group: group,
            isHandlesVisible: true,
            from: sketch.start.from,
            to: sketch.start.to,
            hasThreeDotMenu: true,
          })
        }
        callbacks.push(startProfileCallBack)

        callbacks.push(
          ...sgPaths.map((group, index) =>
            this.updateSegment(
              group,
              index,
              varDecIndex,
              modifiedAst,
              orthoFactor,
              sketch,
              snappedToTangent
            )
          )
        )
      }
      this.sceneInfra.overlayCallbacks(callbacks)
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
   * @param snappedToTangent if currently drawn draft segment is snapping to previous arc tangent
   */
  updateSegment = (
    segment: Path | Sketch['start'],
    index: number,
    varDecIndex: number,
    modifiedAst: Program,
    orthoFactor: number,
    sketch: Sketch,
    snappedToTangent: boolean = false
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
      (this.sceneInfra.camControls.camera instanceof OrthographicCamera
        ? orthoFactor
        : perspScale(this.sceneInfra.camControls.camera, group)) /
      this.sceneInfra._baseUnitMultiplier
    let input: SegmentInputs = {
      type: 'straight-segment',
      from: segment.from,
      to: segment.to,
      snap: snappedToTangent,
    }
    let update: SegmentUtils['update'] | null = null
    if (type === TANGENTIAL_ARC_TO_SEGMENT) {
      update = segmentUtils.tangentialArc.update
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
        to: segment.from, // Use from as to for full circles
        center: segment.center,
        radius: segment.radius,
        ccw: true,
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
    } else if (
      type === ARC_SEGMENT &&
      'type' in segment &&
      segment.type === 'Arc'
    ) {
      update = segmentUtils.arc.update
      input = {
        type: 'arc-segment',
        from: segment.from,
        to: segment.to,
        center: segment.center,
        radius: segment.radius,
        ccw: segment.ccw,
      }
    } else if (
      type === THREE_POINT_ARC_SEGMENT &&
      'type' in segment &&
      segment.type === 'ArcThreePoint'
    ) {
      update = segmentUtils.threePointArc.update
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
        sceneInfra: this.sceneInfra,
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
    if (this.axisGroup) this.sceneInfra.scene.remove(this.axisGroup)
  }

  tearDownSketch({ removeAxis = true }: { removeAxis?: boolean }) {
    // Remove all draft groups
    this.draftPointGroups.forEach((draftPointGroup) => {
      this.sceneInfra.scene.remove(draftPointGroup)
    })

    // Remove all sketch tools

    if (this.axisGroup && removeAxis)
      this.sceneInfra.scene.remove(this.axisGroup)
    const sketchSegments = this.sceneInfra.scene.children.find(
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
      this.sceneInfra.scene.remove(sketchSegments)
    }
    this.sceneInfra.camControls.enableRotate = true
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
          const pResult = parse(recast(this.kclManager.ast))
          if (trap(pResult) || !resultIsOk(pResult))
            return Promise.reject(pResult)
          const updatedAst = pResult.program
          const _node = getNodeFromPath<Node<CallExpressionKw>>(
            updatedAst,
            parent.userData.pathToNode,
            ['CallExpressionKw']
          )
          if (trap(_node, { suppress: true })) return
          const node = _node.node
          this.editorManager.setHighlightRange([
            topLevelRange(node.start, node.end),
          ])
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
          const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

          let input: SegmentInputs = {
            type: 'straight-segment',
            from: parent.userData.from,
            to: parent.userData.to,
          }
          const factor =
            (this.sceneInfra.camControls.camera instanceof OrthographicCamera
              ? orthoFactor
              : perspScale(this.sceneInfra.camControls.camera, parent)) /
            this.sceneInfra._baseUnitMultiplier
          let update: SegmentUtils['update'] | null = null
          if (parent.name === STRAIGHT_SEGMENT) {
            update = segmentUtils.straight.update
          } else if (parent.name === TANGENTIAL_ARC_TO_SEGMENT) {
            update = segmentUtils.tangentialArc.update
            input = {
              type: 'arc-segment',
              from: parent.userData.from,
              to: parent.userData.to,
              radius: parent.userData.radius,
              center: parent.userData.center,
              ccw:
                parent.userData.ccw !== undefined ? parent.userData.ccw : true,
            }
          } else if (parent.name === CIRCLE_SEGMENT) {
            update = segmentUtils.circle.update
            input = {
              type: 'arc-segment',
              from: parent.userData.from,
              to: parent.userData.to,
              radius: parent.userData.radius,
              center: parent.userData.center,
              ccw:
                parent.userData.ccw !== undefined ? parent.userData.ccw : true,
            }
          } else if (parent.name === ARC_SEGMENT) {
            update = segmentUtils.arc.update
            input = {
              type: 'arc-segment',
              from: parent.userData.from,
              to: parent.userData.to,
              radius: parent.userData.radius,
              center: parent.userData.center,
              ccw:
                parent.userData.ccw !== undefined ? parent.userData.ccw : true,
            }
          } else if (parent.name === THREE_POINT_ARC_SEGMENT) {
            update = segmentUtils.threePointArc.update
            input = {
              type: 'circle-three-point-segment',
              p1: parent.userData.p1,
              p2: parent.userData.p2,
              p3: parent.userData.p3,
            }
          }

          update &&
            update({
              prevSegment: parent.userData.prevSegment,
              input,
              group: parent,
              scale: factor,
              sceneInfra: this.sceneInfra,
            })
          return
        }
        this.editorManager.setHighlightRange([defaultSourceRange()])
      },
      onMouseLeave: ({ selected }: OnMouseEnterLeaveArgs) => {
        this.editorManager.setHighlightRange([defaultSourceRange()])
        const parent = getParentGroup(
          selected,
          SEGMENT_BODIES_PLUS_PROFILE_START
        )
        if (parent) {
          const orthoFactor = orthoScale(this.sceneInfra.camControls.camera)

          let input: SegmentInputs = {
            type: 'straight-segment',
            from: parent.userData.from,
            to: parent.userData.to,
          }
          const factor =
            (this.sceneInfra.camControls.camera instanceof OrthographicCamera
              ? orthoFactor
              : perspScale(this.sceneInfra.camControls.camera, parent)) /
            this.sceneInfra._baseUnitMultiplier
          let update: SegmentUtils['update'] | null = null
          if (parent.name === STRAIGHT_SEGMENT) {
            update = segmentUtils.straight.update
          } else if (parent.name === TANGENTIAL_ARC_TO_SEGMENT) {
            update = segmentUtils.tangentialArc.update
            input = {
              type: 'arc-segment',
              from: parent.userData.from,
              to: parent.userData.to,
              radius: parent.userData.radius,
              center: parent.userData.center,
              ccw:
                parent.userData.ccw !== undefined ? parent.userData.ccw : true,
            }
          } else if (parent.name === CIRCLE_SEGMENT) {
            update = segmentUtils.circle.update
            input = {
              type: 'arc-segment',
              from: parent.userData.from,
              to: parent.userData.to,
              radius: parent.userData.radius,
              center: parent.userData.center,
              ccw:
                parent.userData.ccw !== undefined ? parent.userData.ccw : true,
            }
          } else if (parent.name === ARC_SEGMENT) {
            update = segmentUtils.arc.update
            input = {
              type: 'arc-segment',
              from: parent.userData.from,
              to: parent.userData.to,
              radius: parent.userData.radius,
              center: parent.userData.center,
              ccw:
                parent.userData.ccw !== undefined ? parent.userData.ccw : true,
            }
          } else if (parent.name === THREE_POINT_ARC_SEGMENT) {
            update = segmentUtils.threePointArc.update
            input = {
              type: 'circle-three-point-segment',
              p1: parent.userData.p1,
              p2: parent.userData.p2,
              p3: parent.userData.p3,
            }
          }

          update &&
            update({
              prevSegment: parent.userData.prevSegment,
              input,
              group: parent,
              scale: factor,
              sceneInfra: this.sceneInfra,
            })
        }
        const isSelected = parent?.userData?.isSelected
        colorSegment(
          selected,
          isSelected
            ? 0x0000ff
            : parent?.userData?.baseColor ||
                getThemeColorForThreeJs(this.sceneInfra._theme)
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
    this.sceneInfra.modelingSend({
      type: 'Set Segment Overlays',
      data: {
        type: 'clear',
      },
    })
  }

  async getSketchOrientationDetails(sketch: Sketch): Promise<{
    quat: Quaternion
    sketchDetails: Omit<
      SketchDetails & { faceId?: string },
      'sketchNodePaths' | 'sketchEntryNodePath' | 'planeNodePath'
    >
  }> {
    if (sketch.on.type === 'plane') {
      const zAxis = crossProduct(sketch?.on.xAxis, sketch?.on.yAxis)
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
    const faceInfo = await this.getFaceDetails(sketch.on.id)

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

  /**
   * Retrieves orientation details for a given entity representing a face (brep face or default plane).
   * This function asynchronously fetches and returns the origin, x-axis, y-axis, and z-axis details
   * for a specified entity ID. It is primarily used to obtain the orientation of a face in the scene,
   * which is essential for calculating the correct positioning and alignment of the client side sketch.
   *
   * @param  entityId - The ID of the entity for which orientation details are being fetched.
   * @returns A promise that resolves with the orientation details of the face.
   */
  async getFaceDetails(
    entityId: string
  ): Promise<Models['GetSketchModePlane_type']> {
    // TODO mode engine connection to allow batching returns and batch the following
    await this.engineCommandManager.sendSceneCommand({
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
    let resp = await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'get_sketch_mode_plane' },
    })

    if (!resp) {
      return Promise.reject('no response')
    }

    if (isArray(resp)) {
      resp = resp[0]
    }

    const faceInfo =
      resp?.success &&
      resp?.resp.type === 'modeling' &&
      resp?.resp?.data?.modeling_response?.type === 'get_sketch_mode_plane'
        ? resp?.resp?.data?.modeling_response.data
        : ({} as Models['GetSketchModePlane_type'])
    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'sketch_mode_disable' },
    })
    return faceInfo
  }

  drawDashedLine({ from, to }: { from: Coords2d; to: Coords2d }) {
    const baseColor = getThemeColorForThreeJs(this.sceneInfra._theme)
    const color = baseColor
    const meshType = STRAIGHT_SEGMENT_DASH

    const segmentGroup = new Group()
    const shape = new Shape()
    shape.moveTo(0, -5) // The width of the line in px (2.4px in this case)
    shape.lineTo(0, 5)
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
    segmentGroup.name = DRAFT_DASHED_LINE
    segmentGroup.userData = {
      type: DRAFT_DASHED_LINE,
      from,
      to,
    }

    segmentGroup.add(mesh)
    segmentGroup.layers.set(SKETCH_LAYER)
    segmentGroup.traverse((child) => {
      child.layers.set(SKETCH_LAYER)
    })
    if (this.currentSketchQuaternion) {
      segmentGroup.setRotationFromQuaternion(this.currentSketchQuaternion)
    }
    return {
      group: segmentGroup,
      updater: (group: Group, to: Coords2d, orthoFactor: number) => {
        const scale =
          (this.sceneInfra.camControls.camera instanceof OrthographicCamera
            ? orthoFactor
            : perspScale(this.sceneInfra.camControls.camera, group)) /
          this.sceneInfra._baseUnitMultiplier
        const from = group.userData.from

        const shape = new Shape()
        shape.moveTo(0, (-SEGMENT_WIDTH_PX / 2) * scale) // The width of the line in px (2.4px in this case)
        shape.lineTo(0, (SEGMENT_WIDTH_PX / 2) * scale)

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
      },
    }
  }
}

// calculations/pure-functions/easy to test so no excuse not to

function prepareTruncatedAst(
  sketchNodePaths: PathToNode[],
  ast: Node<Program>,
  variables: VariableMap,
  draftSegment?: DraftSegment
):
  | {
      truncatedAst: Node<Program>
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
    variables[variableDeclarationName],
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
          ARG_END,
          createArrayExpression([createLiteral(0), createLiteral(0)])
        ),
      ])
    } else {
      newSegment = createCallExpressionStdLibKw('tangentialArc', null, [
        createLabeledArg(
          ARG_END_ABSOLUTE,
          createArrayExpression([
            createLiteral(lastSeg.to[0]),
            createLiteral(lastSeg.to[1]),
          ])
        ),
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

  return {
    truncatedAst,
    variableDeclarationName,
  }
}

function sketchFromPathToNode({
  pathToNode,
  variables,
  kclManager,
}: {
  pathToNode: PathToNode
  variables: VariableMap
  kclManager: KclManager
}): Sketch | null | Error {
  const _varDec = getNodeFromPath<VariableDeclarator>(
    kclManager.ast,
    pathToNode,
    'VariableDeclarator'
  )
  if (err(_varDec)) return _varDec
  const varDec = _varDec.node
  const result = variables[varDec?.id?.name || '']
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
  sketchNormalBackUp: [number, number, number] | null,
  kclManager: KclManager
): Quaternion | Error {
  const sketch = sketchFromPathToNode({
    pathToNode: sketchPathToNode,
    variables: kclManager.variables,
    kclManager,
  })
  if (err(sketch)) return sketch
  const zAxis =
    sketch?.on.xAxis && sketch?.on.yAxis
      ? crossProduct(sketch?.on.xAxis, sketch?.on.yAxis)
      : sketchNormalBackUp
  if (!zAxis) return Error('Sketch zAxis not found')

  return getQuaternionFromZAxis(massageFormats(zAxis))
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

function massageFormats(
  a: Vec3Array | { x: number; y: number; z: number }
): Vector3 {
  return isArray(a) ? new Vector3(a[0], a[1], a[2]) : new Vector3(a.x, a.y, a.z)
}

function getSketchesInfo({
  sketchNodePaths,
  variables,
  kclManager,
}: {
  sketchNodePaths: PathToNode[]
  variables: VariableMap
  kclManager: KclManager
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
      variables,
      kclManager,
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
  ast: Node<Program>,
  kclManager: KclManager
): Selections {
  const artifactGraph = kclManager.artifactGraph
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

// Returns the 2D tangent direction vector at the end of the segmentGroup if it's an arc.
function findTangentDirection(segmentGroup: Group) {
  let tangentDirection: Coords2d | undefined
  if (segmentGroup.userData.type === TANGENTIAL_ARC_TO_SEGMENT) {
    const prevSegment = segmentGroup.userData.prevSegment
    const arcInfo = getTangentialArcToInfo({
      arcStartPoint: segmentGroup.userData.from,
      arcEndPoint: segmentGroup.userData.to,
      tanPreviousPoint: getTanPreviousPoint(prevSegment),
      obtuse: true,
    })
    const tangentAngle =
      arcInfo.endAngle + (Math.PI / 2) * (arcInfo.ccw ? 1 : -1)
    tangentDirection = [Math.cos(tangentAngle), Math.sin(tangentAngle)]
  } else if (
    segmentGroup.userData.type === ARC_SEGMENT ||
    segmentGroup.userData.type === THREE_POINT_ARC_SEGMENT
  ) {
    const tangentAngle =
      deg2Rad(
        getAngle(segmentGroup.userData.center, segmentGroup.userData.to)
      ) +
      (Math.PI / 2) * (segmentGroup.userData.ccw ? 1 : -1)
    tangentDirection = [Math.cos(tangentAngle), Math.sin(tangentAngle)]
  } else {
    console.warn(
      'Unsupported segment type for tangent direction calculation: ',
      segmentGroup.userData.type
    )
  }
  return tangentDirection
}

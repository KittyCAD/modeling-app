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
  ARROWHEAD,
  AXIS_GROUP,
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
  Solid,
  VariableDeclaration,
  VariableDeclarator,
  sketchFromKclValue,
} from 'lang/wasm'
import {
  engineCommandManager,
  kclManager,
  sceneInfra,
  codeManager,
  editorManager,
} from 'lib/singletons'
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import { executeAst } from 'lang/langHelpers'
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
  addStartProfileAt,
  createArrayExpression,
  createCallExpressionStdLib,
  createLiteral,
  createObjectExpression,
  createPipeExpression,
  createPipeSubstitution,
  findUniqueName,
} from 'lang/modifyAst'
import { Selections, getEventForSegmentSelection } from 'lib/selections'
import { createGridHelper, orthoScale, perspScale } from './helpers'
import { Models } from '@kittycad/lib'
import { uuidv4 } from 'lib/utils'
import { SegmentOverlayPayload, SketchDetails } from 'machines/modelingMachine'
import { EngineCommandManager } from 'lang/std/engineConnection'
import {
  getRectangleCallExpressions,
  updateRectangleSketch,
} from 'lib/rectangleTool'
import { getThemeColorForThreeJs, Themes } from 'lib/theme'
import { err, reportRejection, trap } from 'lib/trap'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Point3d } from 'wasm-lib/kcl/bindings/Point3d'
import { SegmentInputs } from 'lang/std/stdTypes'

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
  currentSketchQuaternion: Quaternion | null = null
  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager
    this.scene = sceneInfra?.scene
    sceneInfra?.camControls.subscribeToCamChange(this.onCamChange)
    window.addEventListener('resize', this.onWindowResize)
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
      // this.removeIntersectionPlane()
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
  removeIntersectionPlane() {
    const intersectionPlane = this.scene.getObjectByName(RAYCASTABLE_PLANE)
    if (intersectionPlane) this.scene.remove(intersectionPlane)
  }

  setupNoPointsListener({
    sketchDetails,
    afterClick,
  }: {
    sketchDetails: SketchDetails
    afterClick: (args: OnClickCallbackArgs) => void
  }) {
    // Create a THREEjs plane to raycast clicks onto
    this.createIntersectionPlane()
    const quaternion = quaternionFromUpNForward(
      new Vector3(...sketchDetails.yAxis),
      new Vector3(...sketchDetails.zAxis)
    )

    // Position the click raycast plane
    if (this.intersectionPlane) {
      this.intersectionPlane.setRotationFromQuaternion(quaternion)
      this.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )
    }
    sceneInfra.setCallbacks({
      onClick: async (args) => {
        if (!args) return
        if (args.mouseEvent.which !== 1) return
        const { intersectionPoint } = args
        if (!intersectionPoint?.twoD || !sketchDetails?.sketchPathToNode) return
        const addStartProfileAtRes = addStartProfileAt(
          kclManager.ast,
          sketchDetails.sketchPathToNode,
          [intersectionPoint.twoD.x, intersectionPoint.twoD.y]
        )

        if (trap(addStartProfileAtRes)) return
        const { modifiedAst } = addStartProfileAtRes

        await kclManager.updateAst(modifiedAst, false)
        this.removeIntersectionPlane()

        // Now perform the caller-specified action
        afterClick(args)
      },
    })
  }

  async setupSketch({
    sketchPathToNode,
    forward,
    up,
    position,
    maybeModdedAst,
    draftExpressionsIndices,
    selectionRanges,
  }: {
    sketchPathToNode: PathToNode
    maybeModdedAst: Program
    draftExpressionsIndices?: { start: number; end: number }
    forward: [number, number, number]
    up: [number, number, number]
    position?: [number, number, number]
    selectionRanges?: Selections
  }): Promise<{
    truncatedAst: Program
    programMemoryOverride: ProgramMemory
    sketch: Sketch
    variableDeclarationName: string
  }> {
    this.createIntersectionPlane()

    const prepared = this.prepareTruncatedMemoryAndAst(
      sketchPathToNode || [],
      maybeModdedAst
    )
    if (err(prepared)) return Promise.reject(prepared)
    const { truncatedAst, programMemoryOverride, variableDeclarationName } =
      prepared

    const { execState } = await executeAst({
      ast: truncatedAst,
      useFakeExecutor: true,
      engineCommandManager: this.engineCommandManager,
      programMemoryOverride,
      idGenerator: kclManager.execState.idGenerator,
    })
    const programMemory = execState.memory
    const sketch = sketchFromPathToNode({
      pathToNode: sketchPathToNode,
      ast: maybeModdedAst,
      programMemory,
    })
    if (err(sketch)) return Promise.reject(sketch)
    if (!sketch) return Promise.reject('sketch not found')

    if (!isArray(sketch?.value))
      return {
        truncatedAst,
        programMemoryOverride,
        sketch,
        variableDeclarationName,
      }
    this.sceneProgramMemory = programMemory
    const group = new Group()
    position && group.position.set(...position)
    group.userData = {
      type: SKETCH_GROUP_SEGMENTS,
      pathToNode: sketchPathToNode,
    }
    const dummy = new Mesh()
    // TODO: When we actually have sketch positions and rotations we can use them here.
    dummy.position.set(0, 0, 0)
    const orthoFactor = orthoScale(sceneInfra.camControls.camera)
    const factor =
      (sceneInfra.camControls.camera instanceof OrthographicCamera
        ? orthoFactor
        : perspScale(sceneInfra.camControls.camera, dummy)) /
      sceneInfra._baseUnitMultiplier

    const segPathToNode = getNodePathFromSourceRange(
      maybeModdedAst,
      sketch.start.__geoMeta.sourceRange
    )
    if (sketch?.value?.[0]?.type !== 'Circle') {
      const _profileStart = createProfileStartHandle({
        from: sketch.start.from,
        id: sketch.start.__geoMeta.id,
        pathToNode: segPathToNode,
        scale: factor,
        theme: sceneInfra._theme,
      })
      _profileStart.layers.set(SKETCH_LAYER)
      _profileStart.traverse((child) => {
        child.layers.set(SKETCH_LAYER)
      })
      group.add(_profileStart)
      this.activeSegments[JSON.stringify(segPathToNode)] = _profileStart
    }
    const callbacks: (() => SegmentOverlayPayload | null)[] = []
    sketch.value.forEach((segment, index) => {
      let segPathToNode = getNodePathFromSourceRange(
        maybeModdedAst,
        segment.__geoMeta.sourceRange
      )
      if (
        draftExpressionsIndices &&
        (sketch.value[index - 1] || sketch.start)
      ) {
        const previousSegment = sketch.value[index - 1] || sketch.start
        const previousSegmentPathToNode = getNodePathFromSourceRange(
          maybeModdedAst,
          previousSegment.__geoMeta.sourceRange
        )
        const bodyIndex = previousSegmentPathToNode[1][0]
        segPathToNode = getNodePathFromSourceRange(
          truncatedAst,
          segment.__geoMeta.sourceRange
        )
        segPathToNode[1][0] = bodyIndex
      }
      const isDraftSegment =
        draftExpressionsIndices &&
        index <= draftExpressionsIndices.end &&
        index >= draftExpressionsIndices.start
      const isSelected = selectionRanges?.codeBasedSelections.some(
        (selection) => {
          return isOverlap(selection.range, segment.__geoMeta.sourceRange)
        }
      )

      let seg: Group
      const _node1 = getNodeFromPath<CallExpression>(
        maybeModdedAst,
        segPathToNode,
        'CallExpression'
      )
      if (err(_node1)) return
      const callExpName = _node1.node?.callee?.name

      const initSegment =
        segment.type === 'TangentialArcTo'
          ? segmentUtils.tangentialArcTo.init
          : segment.type === 'Circle'
          ? segmentUtils.circle.init
          : segmentUtils.straight.init
      const input: SegmentInputs =
        segment.type === 'Circle'
          ? {
              type: 'arc-segment',
              from: segment.from,
              center: segment.center,
              radius: segment.radius,
            }
          : {
              type: 'straight-segment',
              from: segment.from,
              to: segment.to,
            }
      const result = initSegment({
        prevSegment: sketch.value[index - 1],
        callExpName,
        input,
        id: segment.__geoMeta.id,
        pathToNode: segPathToNode,
        isDraftSegment,
        scale: factor,
        texture: sceneInfra.extraSegmentTexture,
        theme: sceneInfra._theme,
        isSelected,
        sceneInfra,
      })
      if (err(result)) return
      const { group: _group, updateOverlaysCallback } = result
      seg = _group
      callbacks.push(updateOverlaysCallback)
      seg.layers.set(SKETCH_LAYER)
      seg.traverse((child) => {
        child.layers.set(SKETCH_LAYER)
      })

      group.add(seg)
      this.activeSegments[JSON.stringify(segPathToNode)] = seg
    })

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
      sketch,
      variableDeclarationName,
    }
  }
  updateAstAndRejigSketch = async (
    sketchPathToNode: PathToNode,
    modifiedAst: Program | Error,
    forward: [number, number, number],
    up: [number, number, number],
    origin: [number, number, number]
  ) => {
    if (err(modifiedAst)) return modifiedAst

    const nextAst = await kclManager.updateAst(modifiedAst, false)
    await this.tearDownSketch({ removeAxis: false })
    sceneInfra.resetMouseListeners()
    await this.setupSketch({
      sketchPathToNode,
      forward,
      up,
      position: origin,
      maybeModdedAst: nextAst.newAst,
    })
    this.setupSketchIdleCallbacks({
      forward,
      up,
      position: origin,
      pathToNode: sketchPathToNode,
    })
    return nextAst
  }
  setUpDraftSegment = async (
    sketchPathToNode: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    origin: [number, number, number],
    segmentName: 'line' | 'tangentialArcTo' = 'line',
    shouldTearDown = true
  ) => {
    const _ast = structuredClone(kclManager.ast)

    const _node1 = getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchPathToNode || [],
      'VariableDeclaration'
    )
    if (trap(_node1)) return Promise.reject(_node1)
    const variableDeclarationName =
      _node1.node?.declarations?.[0]?.id?.name || ''

    const sg = sketchFromKclValue(
      kclManager.programMemory.get(variableDeclarationName),
      variableDeclarationName
    )
    if (err(sg)) return Promise.reject(sg)
    const lastSeg = sg?.value?.slice(-1)[0] || sg.start

    const index = sg.value.length // because we've added a new segment that's not in the memory yet, no need for `-1`
    const mod = addNewSketchLn({
      node: _ast,
      programMemory: kclManager.programMemory,
      input: {
        type: 'straight-segment',
        to: lastSeg.to,
        from: lastSeg.to,
      },
      fnName: segmentName,
      pathToNode: sketchPathToNode,
    })
    if (trap(mod)) return Promise.reject(mod)
    const modifiedAst = parse(recast(mod.modifiedAst))
    if (trap(modifiedAst)) return Promise.reject(modifiedAst)

    const draftExpressionsIndices = { start: index, end: index }

    if (shouldTearDown) await this.tearDownSketch({ removeAxis: false })
    sceneInfra.resetMouseListeners()

    const { truncatedAst, programMemoryOverride, sketch } =
      await this.setupSketch({
        sketchPathToNode,
        forward,
        up,
        position: origin,
        maybeModdedAst: modifiedAst,
        draftExpressionsIndices,
      })
    sceneInfra.setCallbacks({
      onClick: async (args) => {
        if (!args) return
        if (args.mouseEvent.which !== 1) return
        const { intersectionPoint } = args
        let intersection2d = intersectionPoint?.twoD
        const profileStart = args.intersects
          .map(({ object }) => getParentGroup(object, [PROFILE_START]))
          .find((a) => a?.name === PROFILE_START)

        let modifiedAst
        if (profileStart) {
          const lastSegment = sketch.value.slice(-1)[0]
          modifiedAst = addCallExpressionsToPipe({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            pathToNode: sketchPathToNode,
            expressions: [
              createCallExpressionStdLib(
                lastSegment.type === 'TangentialArcTo'
                  ? 'tangentialArcTo'
                  : 'lineTo',
                [
                  createArrayExpression([
                    createCallExpressionStdLib('profileStartX', [
                      createPipeSubstitution(),
                    ]),
                    createCallExpressionStdLib('profileStartY', [
                      createPipeSubstitution(),
                    ]),
                  ]),
                  createPipeSubstitution(),
                ]
              ),
            ],
          })
          if (trap(modifiedAst)) return Promise.reject(modifiedAst)
          modifiedAst = addCloseToPipe({
            node: modifiedAst,
            programMemory: kclManager.programMemory,
            pathToNode: sketchPathToNode,
          })
          if (trap(modifiedAst)) return Promise.reject(modifiedAst)
        } else if (intersection2d) {
          const lastSegment = sketch.value.slice(-1)[0]
          const tmp = addNewSketchLn({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            input: {
              type: 'straight-segment',
              from: [lastSegment.to[0], lastSegment.to[1]],
              to: [intersection2d.x, intersection2d.y],
            },
            fnName:
              lastSegment.type === 'TangentialArcTo'
                ? 'tangentialArcTo'
                : 'line',
            pathToNode: sketchPathToNode,
          })
          if (trap(tmp)) return Promise.reject(tmp)
          modifiedAst = tmp.modifiedAst
          if (trap(modifiedAst)) return Promise.reject(modifiedAst)
        } else {
          // return early as we didn't modify the ast
          return
        }

        await kclManager.executeAstMock(modifiedAst)
        if (profileStart) {
          sceneInfra.modelingSend({ type: 'CancelSketch' })
        } else {
          await this.setUpDraftSegment(
            sketchPathToNode,
            forward,
            up,
            origin,
            segmentName
          )
        }
      },
      onMove: (args) => {
        this.onDragSegment({
          intersection2d: args.intersectionPoint.twoD,
          object: Object.values(this.activeSegments).slice(-1)[0],
          intersects: args.intersects,
          sketchPathToNode,
          draftInfo: {
            truncatedAst,
            programMemoryOverride,
            variableDeclarationName,
          },
        })
      },
      ...this.mouseEnterLeaveCallbacks(),
    })
  }
  setupDraftRectangle = async (
    sketchPathToNode: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    rectangleOrigin: [x: number, y: number]
  ) => {
    let _ast = structuredClone(kclManager.ast)

    const _node1 = getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchPathToNode || [],
      'VariableDeclaration'
    )
    if (trap(_node1)) return Promise.reject(_node1)
    const variableDeclarationName =
      _node1.node?.declarations?.[0]?.id?.name || ''
    const startSketchOn = _node1.node?.declarations
    const startSketchOnInit = startSketchOn?.[0]?.init

    const tags: [string, string, string] = [
      findUniqueName(_ast, 'rectangleSegmentA'),
      findUniqueName(_ast, 'rectangleSegmentB'),
      findUniqueName(_ast, 'rectangleSegmentC'),
    ]

    startSketchOn[0].init = createPipeExpression([
      startSketchOnInit,
      ...getRectangleCallExpressions(rectangleOrigin, tags),
    ])

    let _recastAst = parse(recast(_ast))
    if (trap(_recastAst)) return Promise.reject(_recastAst)
    _ast = _recastAst

    const { programMemoryOverride, truncatedAst } = await this.setupSketch({
      sketchPathToNode,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 3 },
    })

    sceneInfra.setCallbacks({
      onMove: async (args) => {
        // Update the width and height of the draft rectangle
        const pathToNodeTwo = structuredClone(sketchPathToNode)
        pathToNodeTwo[1][0] = 0

        const _node = getNodeFromPath<VariableDeclaration>(
          truncatedAst,
          pathToNodeTwo || [],
          'VariableDeclaration'
        )
        if (trap(_node)) return Promise.reject(_node)
        const sketchInit = _node.node?.declarations?.[0]?.init

        const x = (args.intersectionPoint.twoD.x || 0) - rectangleOrigin[0]
        const y = (args.intersectionPoint.twoD.y || 0) - rectangleOrigin[1]

        if (sketchInit.type === 'PipeExpression') {
          updateRectangleSketch(sketchInit, x, y, tags[0])
        }

        const { execState } = await executeAst({
          ast: truncatedAst,
          useFakeExecutor: true,
          engineCommandManager: this.engineCommandManager,
          programMemoryOverride,
          idGenerator: kclManager.execState.idGenerator,
        })
        const programMemory = execState.memory
        this.sceneProgramMemory = programMemory
        const sketch = sketchFromKclValue(
          programMemory.get(variableDeclarationName),
          variableDeclarationName
        )
        if (err(sketch)) return Promise.reject(sketch)
        const sgPaths = sketch.value
        const orthoFactor = orthoScale(sceneInfra.camControls.camera)

        this.updateSegment(sketch.start, 0, 0, _ast, orthoFactor, sketch)
        sgPaths.forEach((seg, index) =>
          this.updateSegment(seg, index, 0, _ast, orthoFactor, sketch)
        )
      },
      onClick: async (args) => {
        // Commit the rectangle to the full AST/code and return to sketch.idle
        const cornerPoint = args.intersectionPoint?.twoD
        if (!cornerPoint || args.mouseEvent.button !== 0) return

        const x = roundOff((cornerPoint.x || 0) - rectangleOrigin[0])
        const y = roundOff((cornerPoint.y || 0) - rectangleOrigin[1])

        const _node = getNodeFromPath<VariableDeclaration>(
          _ast,
          sketchPathToNode || [],
          'VariableDeclaration'
        )
        if (trap(_node)) return
        const sketchInit = _node.node?.declarations?.[0]?.init

        if (sketchInit.type === 'PipeExpression') {
          updateRectangleSketch(sketchInit, x, y, tags[0])

          let _recastAst = parse(recast(_ast))
          if (trap(_recastAst)) return
          _ast = _recastAst

          // Update the primary AST and unequip the rectangle tool
          await kclManager.executeAstMock(_ast)
          sceneInfra.modelingSend({ type: 'Finish rectangle' })

          const { execState } = await executeAst({
            ast: _ast,
            useFakeExecutor: true,
            engineCommandManager: this.engineCommandManager,
            programMemoryOverride,
            idGenerator: kclManager.execState.idGenerator,
          })
          const programMemory = execState.memory

          // Prepare to update the THREEjs scene
          this.sceneProgramMemory = programMemory
          const sketch = sketchFromKclValue(
            programMemory.get(variableDeclarationName),
            variableDeclarationName
          )
          if (err(sketch)) return
          const sgPaths = sketch.value
          const orthoFactor = orthoScale(sceneInfra.camControls.camera)

          // Update the starting segment of the THREEjs scene
          this.updateSegment(sketch.start, 0, 0, _ast, orthoFactor, sketch)
          // Update the rest of the segments of the THREEjs scene
          sgPaths.forEach((seg, index) =>
            this.updateSegment(seg, index, 0, _ast, orthoFactor, sketch)
          )
        }
      },
    })
  }
  setupDraftCircle = async (
    sketchPathToNode: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    circleCenter: [x: number, y: number]
  ) => {
    let _ast = structuredClone(kclManager.ast)

    const _node1 = getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchPathToNode || [],
      'VariableDeclaration'
    )
    if (trap(_node1)) return Promise.reject(_node1)
    const variableDeclarationName =
      _node1.node?.declarations?.[0]?.id?.name || ''
    const startSketchOn = _node1.node?.declarations
    const startSketchOnInit = startSketchOn?.[0]?.init

    startSketchOn[0].init = createPipeExpression([
      startSketchOnInit,
      createCallExpressionStdLib('circle', [
        createObjectExpression({
          center: createArrayExpression([
            createLiteral(roundOff(circleCenter[0])),
            createLiteral(roundOff(circleCenter[1])),
          ]),
          radius: createLiteral(1),
        }),
        createPipeSubstitution(),
      ]),
    ])

    let _recastAst = parse(recast(_ast))
    if (trap(_recastAst)) return Promise.reject(_recastAst)
    _ast = _recastAst

    // do a quick mock execution to get the program memory up-to-date
    await kclManager.executeAstMock(_ast)

    const { programMemoryOverride, truncatedAst } = await this.setupSketch({
      sketchPathToNode,
      forward,
      up,
      position: sketchOrigin,
      maybeModdedAst: _ast,
      draftExpressionsIndices: { start: 0, end: 0 },
    })

    sceneInfra.setCallbacks({
      onMove: async (args) => {
        const pathToNodeTwo = structuredClone(sketchPathToNode)
        pathToNodeTwo[1][0] = 0

        const _node = getNodeFromPath<VariableDeclaration>(
          truncatedAst,
          pathToNodeTwo || [],
          'VariableDeclaration'
        )
        let modded = structuredClone(truncatedAst)
        if (trap(_node)) return
        const sketchInit = _node.node?.declarations?.[0]?.init

        const x = (args.intersectionPoint.twoD.x || 0) - circleCenter[0]
        const y = (args.intersectionPoint.twoD.y || 0) - circleCenter[1]

        if (sketchInit.type === 'PipeExpression') {
          const moddedResult = changeSketchArguments(
            modded,
            kclManager.programMemory,
            {
              type: 'path',
              pathToNode: [
                ..._node.deepPath,
                ['body', 'PipeExpression'],
                [1, 'index'],
              ],
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
          useFakeExecutor: true,
          engineCommandManager: this.engineCommandManager,
          programMemoryOverride,
          idGenerator: kclManager.execState.idGenerator,
        })
        const programMemory = execState.memory
        this.sceneProgramMemory = programMemory
        const sketch = sketchFromKclValue(
          programMemory.get(variableDeclarationName),
          variableDeclarationName
        )
        if (err(sketch)) return
        const sgPaths = sketch.value
        const orthoFactor = orthoScale(sceneInfra.camControls.camera)

        this.updateSegment(sketch.start, 0, 0, _ast, orthoFactor, sketch)
        sgPaths.forEach((seg, index) =>
          this.updateSegment(seg, index, 0, _ast, orthoFactor, sketch)
        )
      },
      onClick: async (args) => {
        // Commit the rectangle to the full AST/code and return to sketch.idle
        const cornerPoint = args.intersectionPoint?.twoD
        if (!cornerPoint || args.mouseEvent.button !== 0) return

        const x = roundOff((cornerPoint.x || 0) - circleCenter[0])
        const y = roundOff((cornerPoint.y || 0) - circleCenter[1])

        const _node = getNodeFromPath<VariableDeclaration>(
          _ast,
          sketchPathToNode || [],
          'VariableDeclaration'
        )
        if (trap(_node)) return
        const sketchInit = _node.node?.declarations?.[0]?.init

        let modded = structuredClone(_ast)
        if (sketchInit.type === 'PipeExpression') {
          const moddedResult = changeSketchArguments(
            modded,
            kclManager.programMemory,
            {
              type: 'path',
              pathToNode: [
                ..._node.deepPath,
                ['body', 'PipeExpression'],
                [1, 'index'],
              ],
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

          let _recastAst = parse(recast(modded))
          if (trap(_recastAst)) return Promise.reject(_recastAst)
          _ast = _recastAst

          // Update the primary AST and unequip the rectangle tool
          await kclManager.executeAstMock(_ast)
          sceneInfra.modelingSend({ type: 'Finish circle' })
        }
      },
    })
  }
  setupSketchIdleCallbacks = ({
    pathToNode,
    up,
    forward,
    position,
  }: {
    pathToNode: PathToNode
    forward: [number, number, number]
    up: [number, number, number]
    position?: [number, number, number]
  }) => {
    let addingNewSegmentStatus: 'nothing' | 'pending' | 'added' = 'nothing'
    sceneInfra.setCallbacks({
      onDragEnd: async () => {
        if (addingNewSegmentStatus !== 'nothing') {
          await this.tearDownSketch({ removeAxis: false })
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.setupSketch({
            sketchPathToNode: pathToNode,
            maybeModdedAst: kclManager.ast,
            up,
            forward,
            position,
          })
          // setting up the callbacks again resets value in closures
          this.setupSketchIdleCallbacks({
            pathToNode,
            up,
            forward,
            position,
          })
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
            const prevSegment = sketch.value[pipeIndex - 2]
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
            await this.tearDownSketch({ removeAxis: false })
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.setupSketch({
              sketchPathToNode: pathToNode,
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
              sketchPathToNode: pathToNodeForNewSegment,
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
          intersects,
          sketchPathToNode: pathToNode,
        })
      },
      onMove: () => {},
      onClick: (args) => {
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
    sketchPathToNode: PathToNode,
    ast?: Program,
    draftSegment?: DraftSegment
  ) =>
    prepareTruncatedMemoryAndAst(
      sketchPathToNode,
      ast || kclManager.ast,
      kclManager.lastSuccessfulProgramMemory,
      draftSegment
    )
  onDragSegment({
    object,
    intersection2d: _intersection2d,
    sketchPathToNode,
    draftInfo,
    intersects,
  }: {
    object: any
    intersection2d: Vector2
    sketchPathToNode: PathToNode
    intersects: Intersection<Object3D<Object3DEventMap>>[]
    draftInfo?: {
      truncatedAst: Program
      programMemoryOverride: ProgramMemory
      variableDeclarationName: string
    }
  }) {
    const profileStart =
      draftInfo &&
      intersects
        .map(({ object }) => getParentGroup(object, [PROFILE_START]))
        .find((a) => a?.name === PROFILE_START)
    const intersection2d = profileStart
      ? new Vector2(profileStart.position.x, profileStart.position.y)
      : _intersection2d

    const group = getParentGroup(object, SEGMENT_BODIES_PLUS_PROFILE_START)
    const subGroup = getParentGroup(object, [ARROWHEAD, CIRCLE_CENTER_HANDLE])
    if (!group) return
    const pathToNode: PathToNode = structuredClone(group.userData.pathToNode)
    const varDecIndex = pathToNode[1][0]
    if (typeof varDecIndex !== 'number') {
      console.error(
        `Expected varDecIndex to be a number, but found: ${typeof varDecIndex} ${varDecIndex}`
      )
      return
    }
    if (draftInfo) {
      pathToNode[1][0] = 0
    }

    const from: [number, number] = [
      group.userData.from[0],
      group.userData.from[1],
    ]
    const dragTo: [number, number] = [intersection2d.x, intersection2d.y]
    let modifiedAst = draftInfo ? draftInfo.truncatedAst : { ...kclManager.ast }

    const _node = getNodeFromPath<CallExpression>(
      modifiedAst,
      pathToNode,
      'CallExpression'
    )
    if (trap(_node)) return
    const node = _node.node

    if (node.type !== 'CallExpression') return

    let modded:
      | {
          modifiedAst: Program
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
          sourceRange: [node.start, node.end],
        },
        getChangeSketchInput()
      )
    }
    if (trap(modded)) return

    modifiedAst = modded.modifiedAst
    const info = draftInfo
      ? draftInfo
      : this.prepareTruncatedMemoryAndAst(pathToNode || [])
    if (trap(info, { suppress: true })) return
    const { truncatedAst, programMemoryOverride, variableDeclarationName } =
      info
    ;(async () => {
      const code = recast(modifiedAst)
      if (trap(code)) return
      if (!draftInfo)
        // don't want to mod the user's code yet as they have't committed to the change yet
        // plus this would be the truncated ast being recast, it would be wrong
        codeManager.updateCodeEditor(code)
      const { execState } = await executeAst({
        ast: truncatedAst,
        useFakeExecutor: true,
        engineCommandManager: this.engineCommandManager,
        programMemoryOverride,
        idGenerator: kclManager.execState.idGenerator,
      })
      const programMemory = execState.memory
      this.sceneProgramMemory = programMemory

      const maybeSketch = programMemory.get(variableDeclarationName)
      let sketch = undefined
      const sg = sketchFromKclValue(maybeSketch, variableDeclarationName)
      if (!err(sg)) {
        sketch = sg
      } else if ((maybeSketch as Solid).sketch) {
        sketch = (maybeSketch as Solid).sketch
      }
      if (!sketch) return

      const sgPaths = sketch.value
      const orthoFactor = orthoScale(sceneInfra.camControls.camera)

      this.updateSegment(
        sketch.start,
        0,
        varDecIndex,
        modifiedAst,
        orthoFactor,
        sketch
      )

      const callBacks = sgPaths.map((group, index) =>
        this.updateSegment(
          group,
          index,
          varDecIndex,
          modifiedAst,
          orthoFactor,
          sketch
        )
      )
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
      segment.__geoMeta.sourceRange
    )
    const sgPaths = sketch.value
    const originalPathToNodeStr = JSON.stringify(segPathToNode)
    segPathToNode[1][0] = varDecIndex
    const pathToNodeStr = JSON.stringify(segPathToNode)
    // more hacks to hopefully be solved by proper pathToNode info in memory/sketch segments
    const group =
      this.activeSegments[pathToNodeStr] ||
      this.activeSegments[originalPathToNodeStr]
    // const prevSegment = sketch.slice(index - 1)[0]
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
  private _tearDownSketch(
    callDepth = 0,
    resolve: (val: unknown) => void,
    reject: () => void,
    { removeAxis = true }: { removeAxis?: boolean }
  ) {
    if (this.intersectionPlane) this.scene.remove(this.intersectionPlane)
    if (this.axisGroup && removeAxis) this.scene.remove(this.axisGroup)
    const sketchSegments = this.scene.children.find(
      ({ userData }) => userData?.type === SKETCH_GROUP_SEGMENTS
    )
    let shouldResolve = false
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
      shouldResolve = true
    } else {
      const delay = 100
      const maxTimeRetries = 3000 // 3 seconds
      const maxCalls = maxTimeRetries / delay
      if (callDepth < maxCalls) {
        setTimeout(() => {
          this._tearDownSketch(callDepth + 1, resolve, reject, { removeAxis })
        }, delay)
      } else {
        resolve(true)
      }
    }
    sceneInfra.camControls.enableRotate = true
    this.activeSegments = {}
    // maybe should reset onMove etc handlers
    if (shouldResolve) resolve(true)
  }
  async tearDownSketch({
    removeAxis = true,
  }: {
    removeAxis?: boolean
  } = {}) {
    // I think promisifying this is mostly a side effect of not having
    // "setupSketch" correctly capture a promise when it's done
    // so we're effectively waiting for to be finished setting up the scene just to tear it down
    // TODO is to fix that
    return new Promise((resolve, reject) => {
      this._tearDownSketch(0, resolve, reject, { removeAxis })
    })
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
          const updatedAst = parse(recast(kclManager.ast))
          if (trap(updatedAst)) return
          const _node = getNodeFromPath<CallExpression>(
            updatedAst,
            parent.userData.pathToNode,
            'CallExpression'
          )
          if (trap(_node, { suppress: true })) return
          const node = _node.node
          editorManager.setHighlightRange([[node.start, node.end]])
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
        editorManager.setHighlightRange([[0, 0]])
      },
      onMouseLeave: ({ selected, ...rest }: OnMouseEnterLeaveArgs) => {
        editorManager.setHighlightRange([[0, 0]])
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

export type DefaultPlaneStr = 'XY' | 'XZ' | 'YZ' | '-XY' | '-XZ' | '-YZ'

// calculations/pure-functions/easy to test so no excuse not to

function prepareTruncatedMemoryAndAst(
  sketchPathToNode: PathToNode,
  ast: Program,
  programMemory: ProgramMemory,
  draftSegment?: DraftSegment
):
  | {
      truncatedAst: Program
      programMemoryOverride: ProgramMemory
      variableDeclarationName: string
    }
  | Error {
  const bodyIndex = Number(sketchPathToNode?.[1]?.[0]) || 0
  const _ast = structuredClone(ast)

  const _node = getNodeFromPath<VariableDeclaration>(
    _ast,
    sketchPathToNode || [],
    'VariableDeclaration'
  )
  if (err(_node)) return _node
  const variableDeclarationName = _node.node?.declarations?.[0]?.id?.name || ''
  const sg = sketchFromKclValue(
    programMemory.get(variableDeclarationName),
    variableDeclarationName
  )
  if (err(sg)) return sg
  const lastSeg = sg?.value.slice(-1)[0]
  if (draftSegment) {
    // truncatedAst needs to setup with another segment at the end
    let newSegment
    if (draftSegment === 'line') {
      newSegment = createCallExpressionStdLib('line', [
        createArrayExpression([createLiteral(0), createLiteral(0)]),
        createPipeSubstitution(),
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
      (_ast.body[bodyIndex] as VariableDeclaration).declarations[0]
        .init as PipeExpression
    ).body.push(newSegment)
    // update source ranges to section we just added.
    // hacks like this wouldn't be needed if the AST put pathToNode info in memory/sketch segments
    const updatedSrcRangeAst = parse(recast(_ast)) // get source ranges correct since unfortunately we still rely on them
    if (err(updatedSrcRangeAst)) return updatedSrcRangeAst

    const lastPipeItem = (
      (updatedSrcRangeAst.body[bodyIndex] as VariableDeclaration)
        .declarations[0].init as PipeExpression
    ).body.slice(-1)[0]

    ;(
      (_ast.body[bodyIndex] as VariableDeclaration).declarations[0]
        .init as PipeExpression
    ).body.slice(-1)[0].start = lastPipeItem.start

    _ast.end = lastPipeItem.end
    const varDec = _ast.body[bodyIndex] as VariableDeclaration
    varDec.end = lastPipeItem.end
    const declarator = varDec.declarations[0]
    declarator.end = lastPipeItem.end
    const init = declarator.init as PipeExpression
    init.end = lastPipeItem.end
    init.body.slice(-1)[0].end = lastPipeItem.end
  }
  const truncatedAst: Program = {
    ..._ast,
    body: [structuredClone(_ast.body[bodyIndex])],
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

  for (let i = 0; i < bodyIndex; i++) {
    const node = _ast.body[i]
    if (node.type !== 'VariableDeclaration') {
      continue
    }
    const name = node.declarations[0].id.name
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
    return result.sketch
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
  sketchPathToNode: PathToNode
): Promise<{
  quat: Quaternion
  sketchDetails: SketchDetails & { faceId?: string }
}> {
  const sketch = sketchFromPathToNode({
    pathToNode: sketchPathToNode,
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
        sketchPathToNode,
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
        sketchPathToNode,
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

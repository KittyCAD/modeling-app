import {
  BoxGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Intersection,
  LineCurve3,
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
  Shape,
  Vector2,
  Vector3,
} from 'three'
import {
  ARROWHEAD,
  AXIS_GROUP,
  DEFAULT_PLANES,
  DefaultPlane,
  defaultPlaneColor,
  getSceneScale,
  INTERSECTION_PLANE_LAYER,
  OnMouseEnterLeaveArgs,
  RAYCASTABLE_PLANE,
  SKETCH_GROUP_SEGMENTS,
  SKETCH_LAYER,
  X_AXIS,
  XZ_PLANE,
  Y_AXIS,
  YZ_PLANE,
} from './sceneInfra'
import { isQuaternionVertical, quaternionFromUpNForward } from './helpers'
import {
  CallExpression,
  getTangentialArcToInfo,
  parse,
  Path,
  PathToNode,
  PipeExpression,
  Program,
  ProgramMemory,
  programMemoryInit,
  recast,
  SketchGroup,
  VariableDeclaration,
  VariableDeclarator,
} from 'lang/wasm'
import {
  engineCommandManager,
  kclManager,
  sceneInfra,
  codeManager,
  editorManager,
} from 'lib/singletons'
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import { executeAst, useStore } from 'useStore'
import {
  createArcGeometry,
  dashedStraight,
  profileStart,
  straightSegment,
  tangentialArcToSegment,
} from './segments'
import {
  addCallExpressionsToPipe,
  addCloseToPipe,
  addNewSketchLn,
  changeSketchArguments,
  updateStartProfileAtArgs,
} from 'lang/std/sketch'
import { normaliseAngle, roundOff, throttle } from 'lib/utils'
import {
  createArrayExpression,
  createCallExpressionStdLib,
  createLiteral,
  createPipeExpression,
  createPipeSubstitution,
  findUniqueName,
} from 'lang/modifyAst'
import {
  getEventForSegmentSelection,
  sendSelectEventToEngine,
} from 'lib/selections'
import { getTangentPointFromPreviousArc } from 'lib/utils2d'
import { createGridHelper, orthoScale, perspScale } from './helpers'
import { Models } from '@kittycad/lib'
import { uuidv4 } from 'lib/utils'
import { SegmentOverlayPayload, SketchDetails } from 'machines/modelingMachine'
import { EngineCommandManager } from 'lang/std/engineConnection'
import {
  getRectangleCallExpressions,
  updateRectangleSketch,
} from 'lib/rectangleTool'
import { getThemeColorForThreeJs } from 'lib/theme'

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
export const SEGMENT_WIDTH_PX = 1.6
export const HIDE_SEGMENT_LENGTH = 75 // in pixels
export const HIDE_HOVER_SEGMENT_LENGTH = 60 // in pixels

// This singleton Class is responsible for all of the things the user sees and interacts with.
// That mostly mean sketch elements.
// Cameras, controls, raycasters, etc are handled by sceneInfra
export class SceneEntities {
  engineCommandManager: EngineCommandManager
  scene: Scene
  sceneProgramMemory: ProgramMemory = { root: {}, return: null }
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
      if (
        segment.userData.from &&
        segment.userData.to &&
        segment.userData.type === STRAIGHT_SEGMENT
      ) {
        callbacks.push(
          this.updateStraightSegment({
            from: segment.userData.from,
            to: segment.userData.to,
            group: segment,
            scale: factor,
          })
        )
      }

      if (
        segment.userData.from &&
        segment.userData.to &&
        segment.userData.prevSegment &&
        segment.userData.type === TANGENTIAL_ARC_TO_SEGMENT
      ) {
        callbacks.push(
          this.updateTangentialArcToSegment({
            prevSegment: segment.userData.prevSegment,
            from: segment.userData.from,
            to: segment.userData.to,
            group: segment,
            scale: factor,
          })
        )
      }
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
  removeIntersectionPlane() {
    const intersectionPlane = this.scene.getObjectByName(RAYCASTABLE_PLANE)
    if (intersectionPlane) this.scene.remove(intersectionPlane)
  }

  async setupSketch({
    sketchPathToNode,
    forward,
    up,
    position,
    maybeModdedAst,
    draftExpressionsIndices,
  }: {
    sketchPathToNode: PathToNode
    maybeModdedAst: Program
    draftExpressionsIndices?: { start: number; end: number }
    forward: [number, number, number]
    up: [number, number, number]
    position?: [number, number, number]
  }): Promise<{
    truncatedAst: Program
    programMemoryOverride: ProgramMemory
    sketchGroup: SketchGroup
    variableDeclarationName: string
  }> {
    this.createIntersectionPlane()

    const { truncatedAst, programMemoryOverride, variableDeclarationName } =
      this.prepareTruncatedMemoryAndAst(sketchPathToNode || [], maybeModdedAst)
    const { programMemory } = await executeAst({
      ast: truncatedAst,
      useFakeExecutor: true,
      engineCommandManager: this.engineCommandManager,
      programMemoryOverride,
    })
    const sketchGroup = sketchGroupFromPathToNode({
      pathToNode: sketchPathToNode,
      ast: maybeModdedAst,
      programMemory,
    })
    if (!Array.isArray(sketchGroup?.value))
      return {
        truncatedAst,
        programMemoryOverride,
        sketchGroup,
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
    dummy.position.set(
      sketchGroup.position[0],
      sketchGroup.position[1],
      sketchGroup.position[2]
    )
    const orthoFactor = orthoScale(sceneInfra.camControls.camera)
    const factor =
      (sceneInfra.camControls.camera instanceof OrthographicCamera
        ? orthoFactor
        : perspScale(sceneInfra.camControls.camera, dummy)) /
      sceneInfra._baseUnitMultiplier

    const segPathToNode = getNodePathFromSourceRange(
      maybeModdedAst,
      sketchGroup.start.__geoMeta.sourceRange
    )
    const _profileStart = profileStart({
      from: sketchGroup.start.from,
      id: sketchGroup.start.__geoMeta.id,
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
    const callbacks: (() => SegmentOverlayPayload | null)[] = []
    sketchGroup.value.forEach((segment, index) => {
      let segPathToNode = getNodePathFromSourceRange(
        maybeModdedAst,
        segment.__geoMeta.sourceRange
      )
      if (
        draftExpressionsIndices &&
        (sketchGroup.value[index - 1] || sketchGroup.start)
      ) {
        const previousSegment =
          sketchGroup.value[index - 1] || sketchGroup.start
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
      let seg
      const callExpName = getNodeFromPath<CallExpression>(
        maybeModdedAst,
        segPathToNode,
        'CallExpression'
      )?.node?.callee?.name
      if (segment.type === 'TangentialArcTo') {
        seg = tangentialArcToSegment({
          prevSegment: sketchGroup.value[index - 1],
          from: segment.from,
          to: segment.to,
          id: segment.__geoMeta.id,
          pathToNode: segPathToNode,
          isDraftSegment,
          scale: factor,
          texture: sceneInfra.extraSegmentTexture,
          theme: sceneInfra._theme,
        })
        callbacks.push(
          this.updateTangentialArcToSegment({
            prevSegment: sketchGroup.value[index - 1],
            from: segment.from,
            to: segment.to,
            group: seg,
            scale: factor,
          })
        )
      } else {
        seg = straightSegment({
          from: segment.from,
          to: segment.to,
          id: segment.__geoMeta.id,
          pathToNode: segPathToNode,
          isDraftSegment,
          scale: factor,
          callExpName,
          texture: sceneInfra.extraSegmentTexture,
          theme: sceneInfra._theme,
        })
        callbacks.push(
          this.updateStraightSegment({
            from: segment.from,
            to: segment.to,
            group: seg,
            scale: factor,
          })
        )
      }
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
      sketchGroup,
      variableDeclarationName,
    }
  }
  updateAstAndRejigSketch = async (
    sketchPathToNode: PathToNode,
    modifiedAst: Program,
    forward: [number, number, number],
    up: [number, number, number],
    origin: [number, number, number]
  ) => {
    await kclManager.updateAst(modifiedAst, false)
    await this.tearDownSketch({ removeAxis: false })
    sceneInfra.resetMouseListeners()
    await this.setupSketch({
      sketchPathToNode,
      forward,
      up,
      position: origin,
      maybeModdedAst: kclManager.ast,
    })
    this.setupSketchIdleCallbacks({
      forward,
      up,
      position: origin,
      pathToNode: sketchPathToNode,
    })
  }
  setUpDraftSegment = async (
    sketchPathToNode: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    origin: [number, number, number],
    segmentName: 'line' | 'tangentialArcTo' = 'line',
    shouldTearDown = true
  ) => {
    const _ast = JSON.parse(JSON.stringify(kclManager.ast))

    const variableDeclarationName =
      getNodeFromPath<VariableDeclaration>(
        _ast,
        sketchPathToNode || [],
        'VariableDeclaration'
      )?.node?.declarations?.[0]?.id?.name || ''
    const sg = kclManager.programMemory.root[
      variableDeclarationName
    ] as SketchGroup
    const lastSeg = sg.value.slice(-1)[0] || sg.start

    const index = sg.value.length // because we've added a new segment that's not in the memory yet, no need for `-1`

    const mod = addNewSketchLn({
      node: _ast,
      programMemory: kclManager.programMemory,
      to: [lastSeg.to[0], lastSeg.to[1]],
      from: [lastSeg.to[0], lastSeg.to[1]],
      fnName: segmentName,
      pathToNode: sketchPathToNode,
    })
    const modifiedAst = parse(recast(mod.modifiedAst))

    const draftExpressionsIndices = { start: index, end: index }

    if (shouldTearDown) await this.tearDownSketch({ removeAxis: false })
    sceneInfra.resetMouseListeners()
    const { truncatedAst, programMemoryOverride, sketchGroup } =
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
          const lastSegment = sketchGroup.value.slice(-1)[0]
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
          modifiedAst = addCloseToPipe({
            node: modifiedAst,
            programMemory: kclManager.programMemory,
            pathToNode: sketchPathToNode,
          })
        } else if (intersection2d) {
          const lastSegment = sketchGroup.value.slice(-1)[0]
          modifiedAst = addNewSketchLn({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            to: [intersection2d.x, intersection2d.y],
            from: [lastSegment.to[0], lastSegment.to[1]],
            fnName:
              lastSegment.type === 'TangentialArcTo'
                ? 'tangentialArcTo'
                : 'line',
            pathToNode: sketchPathToNode,
          }).modifiedAst
        } else {
          // return early as we didn't modify the ast
          return
        }

        await kclManager.executeAstMock(modifiedAst)
        if (profileStart) {
          sceneInfra.modelingSend({ type: 'CancelSketch' })
        } else {
          this.setUpDraftSegment(
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
  setupRectangleOriginListener = () => {
    sceneInfra.setCallbacks({
      onClick: (args) => {
        const twoD = args.intersectionPoint?.twoD
        if (!twoD) {
          console.warn(`This click didn't have a 2D intersection`, args)
          return
        }
        sceneInfra.modelingSend({
          type: 'Add rectangle origin',
          data: [twoD.x, twoD.y],
        })
      },
    })
  }
  setupDraftRectangle = async (
    sketchPathToNode: PathToNode,
    forward: [number, number, number],
    up: [number, number, number],
    sketchOrigin: [number, number, number],
    rectangleOrigin: [x: number, y: number]
  ) => {
    let _ast = JSON.parse(JSON.stringify(kclManager.ast))

    const variableDeclarationName =
      getNodeFromPath<VariableDeclaration>(
        _ast,
        sketchPathToNode || [],
        'VariableDeclaration'
      )?.node?.declarations?.[0]?.id?.name || ''

    const tags: [string, string, string] = [
      findUniqueName(_ast, 'rectangleSegmentA'),
      findUniqueName(_ast, 'rectangleSegmentB'),
      findUniqueName(_ast, 'rectangleSegmentC'),
    ]

    const startSketchOn = getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchPathToNode || [],
      'VariableDeclaration'
    )?.node?.declarations

    const startSketchOnInit = startSketchOn?.[0]?.init
    startSketchOn[0].init = createPipeExpression([
      startSketchOnInit,
      ...getRectangleCallExpressions(rectangleOrigin, tags),
    ])

    _ast = parse(recast(_ast))

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
        const pathToNodeTwo = JSON.parse(JSON.stringify(sketchPathToNode))
        pathToNodeTwo[1][0] = 0

        const sketchInit = getNodeFromPath<VariableDeclaration>(
          truncatedAst,
          pathToNodeTwo || [],
          'VariableDeclaration'
        )?.node?.declarations?.[0]?.init

        const x = (args.intersectionPoint.twoD.x || 0) - rectangleOrigin[0]
        const y = (args.intersectionPoint.twoD.y || 0) - rectangleOrigin[1]

        if (sketchInit.type === 'PipeExpression') {
          updateRectangleSketch(sketchInit, x, y, tags[0])
        }

        const { programMemory } = await executeAst({
          ast: truncatedAst,
          useFakeExecutor: true,
          engineCommandManager: this.engineCommandManager,
          programMemoryOverride,
        })
        this.sceneProgramMemory = programMemory
        const sketchGroup = programMemory.root[
          variableDeclarationName
        ] as SketchGroup
        const sgPaths = sketchGroup.value
        const orthoFactor = orthoScale(sceneInfra.camControls.camera)

        this.updateSegment(
          sketchGroup.start,
          0,
          0,
          _ast,
          orthoFactor,
          sketchGroup
        )
        sgPaths.forEach((seg, index) =>
          this.updateSegment(seg, index, 0, _ast, orthoFactor, sketchGroup)
        )
      },
      onClick: async (args) => {
        // Commit the rectangle to the full AST/code and return to sketch.idle
        const cornerPoint = args.intersectionPoint?.twoD
        if (!cornerPoint || args.mouseEvent.button !== 0) return

        const x = roundOff((cornerPoint.x || 0) - rectangleOrigin[0])
        const y = roundOff((cornerPoint.y || 0) - rectangleOrigin[1])

        const sketchInit = getNodeFromPath<VariableDeclaration>(
          _ast,
          sketchPathToNode || [],
          'VariableDeclaration'
        )?.node?.declarations?.[0]?.init

        if (sketchInit.type === 'PipeExpression') {
          updateRectangleSketch(sketchInit, x, y, tags[0])

          _ast = parse(recast(_ast))

          console.log('onClick', {
            sketchInit: sketchInit,
            _ast,
            x,
            y,
            truncatedAst,
          })

          // Update the primary AST and unequip the rectangle tool
          await kclManager.executeAstMock(_ast)
          sceneInfra.modelingSend({ type: 'CancelSketch' })

          const { programMemory } = await executeAst({
            ast: _ast,
            useFakeExecutor: true,
            engineCommandManager: this.engineCommandManager,
            programMemoryOverride,
          })

          // Prepare to update the THREEjs scene
          this.sceneProgramMemory = programMemory
          const sketchGroup = programMemory.root[
            variableDeclarationName
          ] as SketchGroup
          const sgPaths = sketchGroup.value
          const orthoFactor = orthoScale(sceneInfra.camControls.camera)

          // Update the starting segment of the THREEjs scene
          this.updateSegment(
            sketchGroup.start,
            0,
            0,
            _ast,
            orthoFactor,
            sketchGroup
          )
          // Update the rest of the segments of the THREEjs scene
          sgPaths.forEach((seg, index) =>
            this.updateSegment(seg, index, 0, _ast, orthoFactor, sketchGroup)
          )
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

          const sketchGroup = sketchGroupFromPathToNode({
            pathToNode,
            ast: kclManager.ast,
            programMemory: kclManager.programMemory,
          })

          const pipeIndex = pathToNode[pathToNodeIndex + 1][0] as number
          if (addingNewSegmentStatus === 'nothing') {
            const prevSegment = sketchGroup.value[pipeIndex - 2]
            const mod = addNewSketchLn({
              node: kclManager.ast,
              programMemory: kclManager.programMemory,
              to: [intersectionPoint.twoD.x, intersectionPoint.twoD.y],
              from: [prevSegment.from[0], prevSegment.from[1]],
              // TODO assuming it's always a straight segments being added
              // as this is easiest, and we'll need to add "tabbing" behavior
              // to support other segment types
              fnName: 'line',
              pathToNode: pathToNode,
              spliceBetween: true,
            })
            addingNewSegmentStatus = 'pending'
            await kclManager.executeAstMock(mod.modifiedAst)
            await this.tearDownSketch({ removeAxis: false })
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
      kclManager.programMemory,
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

    const group = getParentGroup(object, [
      STRAIGHT_SEGMENT,
      TANGENTIAL_ARC_TO_SEGMENT,
      PROFILE_START,
    ])
    if (!group) return
    const pathToNode: PathToNode = JSON.parse(
      JSON.stringify(group.userData.pathToNode)
    )
    const varDecIndex = JSON.parse(JSON.stringify(pathToNode[1][0]))
    if (draftInfo) {
      pathToNode[1][0] = 0
    }

    const from: [number, number] = [
      group.userData.from[0],
      group.userData.from[1],
    ]
    const to: [number, number] = [intersection2d.x, intersection2d.y]
    let modifiedAst = draftInfo ? draftInfo.truncatedAst : { ...kclManager.ast }

    const node = getNodeFromPath<CallExpression>(
      modifiedAst,
      pathToNode,
      'CallExpression'
    ).node
    if (node.type !== 'CallExpression') return

    let modded: {
      modifiedAst: Program
      pathToNode: PathToNode
    }
    if (group.name === PROFILE_START) {
      modded = updateStartProfileAtArgs({
        node: modifiedAst,
        pathToNode,
        to,
        from,
        previousProgramMemory: kclManager.programMemory,
      })
    } else {
      modded = changeSketchArguments(
        modifiedAst,
        kclManager.programMemory,
        [node.start, node.end],
        to,
        from
      )
    }

    modifiedAst = modded.modifiedAst
    const { truncatedAst, programMemoryOverride, variableDeclarationName } =
      draftInfo
        ? draftInfo
        : this.prepareTruncatedMemoryAndAst(sketchPathToNode || [])
    ;(async () => {
      const code = recast(modifiedAst)
      if (!draftInfo)
        // don't want to mod the user's code yet as they have't committed to the change yet
        // plus this would be the truncated ast being recast, it would be wrong
        codeManager.updateCodeEditor(code)
      const { programMemory } = await executeAst({
        ast: truncatedAst,
        useFakeExecutor: true,
        engineCommandManager: this.engineCommandManager,
        programMemoryOverride,
      })
      this.sceneProgramMemory = programMemory
      const sketchGroup = programMemory.root[
        variableDeclarationName
      ] as SketchGroup
      const sgPaths = sketchGroup.value
      const orthoFactor = orthoScale(sceneInfra.camControls.camera)

      this.updateSegment(
        sketchGroup.start,
        0,
        varDecIndex,
        modifiedAst,
        orthoFactor,
        sketchGroup
      )

      const callBacks = sgPaths.map((group, index) =>
        this.updateSegment(
          group,
          index,
          varDecIndex,
          modifiedAst,
          orthoFactor,
          sketchGroup
        )
      )
      sceneInfra.overlayCallbacks(callBacks)
    })()
  }

  /**
   * Update the THREEjs sketch entities with new segment data
   * mapping them back to the AST
   * @param segment
   * @param index
   * @param varDecIndex
   * @param modifiedAst
   * @param orthoFactor
   * @param sketchGroup
   */
  updateSegment = (
    segment: Path | SketchGroup['start'],
    index: number,
    varDecIndex: number,
    modifiedAst: Program,
    orthoFactor: number,
    sketchGroup: SketchGroup
  ): (() => SegmentOverlayPayload | null) => {
    const segPathToNode = getNodePathFromSourceRange(
      modifiedAst,
      segment.__geoMeta.sourceRange
    )
    const sgPaths = sketchGroup.value
    const originalPathToNodeStr = JSON.stringify(segPathToNode)
    segPathToNode[1][0] = varDecIndex
    const pathToNodeStr = JSON.stringify(segPathToNode)
    // more hacks to hopefully be solved by proper pathToNode info in memory/sketchGroup segments
    const group =
      this.activeSegments[pathToNodeStr] ||
      this.activeSegments[originalPathToNodeStr]
    // const prevSegment = sketchGroup.slice(index - 1)[0]
    const type = group?.userData?.type
    const factor =
      (sceneInfra.camControls.camera instanceof OrthographicCamera
        ? orthoFactor
        : perspScale(sceneInfra.camControls.camera, group)) /
      sceneInfra._baseUnitMultiplier
    if (type === TANGENTIAL_ARC_TO_SEGMENT) {
      return this.updateTangentialArcToSegment({
        prevSegment: sgPaths[index - 1],
        from: segment.from,
        to: segment.to,
        group: group,
        scale: factor,
      })
    } else if (type === STRAIGHT_SEGMENT) {
      return this.updateStraightSegment({
        from: segment.from,
        to: segment.to,
        group,
        scale: factor,
      })
    } else if (type === PROFILE_START) {
      group.position.set(segment.from[0], segment.from[1], 0)
      group.scale.set(factor, factor, factor)
    }
    return () => null
  }

  updateTangentialArcToSegment({
    prevSegment,
    from,
    to,
    group,
    scale = 1,
  }: {
    prevSegment: SketchGroup['value'][number]
    from: [number, number]
    to: [number, number]
    group: Group
    scale?: number
  }): () => SegmentOverlayPayload | null {
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
      sceneInfra.hoveredObject &&
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
    const tangentialArcToSegmentBodyDashed = group.children.find(
      (child) => child.userData.type === TANGENTIAL_ARC_TO__SEGMENT_DASH
    ) as Mesh
    if (tangentialArcToSegmentBodyDashed) {
      // consider throttling the whole updateTangentialArcToSegment
      // if there are more perf considerations going forward
      this.throttledUpdateDashedArcGeo({
        ...arcInfo,
        mesh: tangentialArcToSegmentBodyDashed,
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
  throttledUpdateDashedArcGeo = throttle(
    (
      args: Parameters<typeof createArcGeometry>[0] & {
        mesh: Mesh
        scale: number
      }
    ) => (args.mesh.geometry = createArcGeometry(args)),
    1000 / 30
  )
  updateStraightSegment({
    from,
    to,
    group,
    scale = 1,
  }: {
    from: [number, number]
    to: [number, number]
    group: Group
    scale?: number
  }): () => SegmentOverlayPayload | null {
    group.userData.from = from
    group.userData.to = to
    const shape = new Shape()
    shape.moveTo(0, (-SEGMENT_WIDTH_PX / 2) * scale) // The width of the line in px (2.4px in this case)
    shape.lineTo(0, (SEGMENT_WIDTH_PX / 2) * scale)
    const arrowGroup = group.getObjectByName(ARROWHEAD) as Group

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
  async animateAfterSketch() {
    // if (isReducedMotion()) {
    //   sceneInfra.camControls.usePerspectiveCamera()
    //   return
    // }
    await sceneInfra.camControls.animateToPerspective()
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
        reject()
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
  setupDefaultPlaneHover() {
    sceneInfra.setCallbacks({
      onMouseEnter: ({ selected }) => {
        if (!(selected instanceof Mesh && selected.parent)) return
        if (selected.parent.userData.type !== DEFAULT_PLANES) return
        const type: DefaultPlane = selected.userData.type
        selected.material.color = defaultPlaneColor(type, 0.5, 1)
      },
      onMouseLeave: ({ selected }) => {
        if (!(selected instanceof Mesh && selected.parent)) return
        if (selected.parent.userData.type !== DEFAULT_PLANES) return
        const type: DefaultPlane = selected.userData.type
        selected.material.color = defaultPlaneColor(type)
      },
      onClick: async (args) => {
        const checkExtrudeFaceClick = async (): Promise<
          ['face' | 'plane' | 'other', string]
        > => {
          const { streamDimensions } = useStore.getState()
          const { entity_id } = await sendSelectEventToEngine(
            args?.mouseEvent,
            document.getElementById('video-stream') as HTMLVideoElement,
            streamDimensions
          )
          if (!entity_id) return ['other', '']
          if (
            engineCommandManager.defaultPlanes?.xy === entity_id ||
            engineCommandManager.defaultPlanes?.xz === entity_id ||
            engineCommandManager.defaultPlanes?.yz === entity_id
          ) {
            return ['plane', entity_id]
          }
          const artifact = this.engineCommandManager.artifactMap[entity_id]
          const parent = this.engineCommandManager.artifactMap?.[artifact?.parentId || '']
          console.log('(parent as any)?.extrusions[0]', (parent as any)?.extrusions[0], (parent as any)?.extrusions)
          const extrusions = this.engineCommandManager.artifactMap?.[(parent as any)?.extrusions[0] || '']
          console.log('artifact', artifact, parent, extrusions)

          if (artifact?.commandType !== 'solid3d_get_extrusion_face_info')
            return ['other', entity_id]

          const faceInfo = await getFaceDetails(entity_id)
          if (!faceInfo?.origin || !faceInfo?.z_axis || !faceInfo?.y_axis)
            return ['other', entity_id]
          const { z_axis, y_axis, origin } = faceInfo
          const pathToNode = getNodePathFromSourceRange(
            kclManager.ast,
            artifact.range
          )
          const otherPathToNode = extrusions?.range ? getNodePathFromSourceRange(
            kclManager.ast,
            extrusions.range
          ) : []

          sceneInfra.modelingSend({
            type: 'Select default plane',
            data: {
              type: 'extrudeFace',
              zAxis: [z_axis.x, z_axis.y, z_axis.z],
              yAxis: [y_axis.x, y_axis.y, y_axis.z],
              position: [origin.x, origin.y, origin.z].map(
                (num) => num / sceneInfra._baseUnitMultiplier
              ) as [number, number, number],
              extrudeSegmentPathToNode: pathToNode,
              otherPathToNode,
              cap:
                artifact?.additionalData?.type === 'cap'
                  ? artifact.additionalData.info
                  : 'none',
              faceId: entity_id,
            },
          })
          return ['face', entity_id]
        }

        const faceResult = await checkExtrudeFaceClick()
        console.log('faceResult', faceResult)
        if (faceResult[0] === 'face') return

        if (!args || !args.intersects?.[0]) return
        if (args.mouseEvent.which !== 1) return
        const { intersects } = args
        const type = intersects?.[0].object.name || ''
        const posNorm = Number(intersects?.[0]?.normal?.z) > 0
        let planeString: DefaultPlaneStr = posNorm ? 'XY' : '-XY'
        let zAxis: [number, number, number] = posNorm ? [0, 0, 1] : [0, 0, -1]
        let yAxis: [number, number, number] = [0, 1, 0]
        if (type === YZ_PLANE) {
          planeString = posNorm ? 'YZ' : '-YZ'
          zAxis = posNorm ? [1, 0, 0] : [-1, 0, 0]
          yAxis = [0, 0, 1]
        } else if (type === XZ_PLANE) {
          planeString = posNorm ? '-XZ' : 'XZ'
          zAxis = posNorm ? [0, 1, 0] : [0, -1, 0]
          yAxis = [0, 0, 1]
        }
        sceneInfra.modelingSend({
          type: 'Select default plane',
          data: {
            type: 'defaultPlane',
            plane: planeString,
            zAxis,
            yAxis,
            planeId: faceResult[1],
          },
        })
      },
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
        const parent = getParentGroup(selected, [
          STRAIGHT_SEGMENT,
          TANGENTIAL_ARC_TO_SEGMENT,
          PROFILE_START,
        ])
        if (parent?.userData?.pathToNode) {
          const updatedAst = parse(recast(kclManager.ast))
          const node = getNodeFromPath<CallExpression>(
            updatedAst,
            parent.userData.pathToNode,
            'CallExpression'
          ).node
          editorManager.setHighlightRange([node.start, node.end])
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

          const factor =
            (sceneInfra.camControls.camera instanceof OrthographicCamera
              ? orthoFactor
              : perspScale(sceneInfra.camControls.camera, parent)) /
            sceneInfra._baseUnitMultiplier
          if (parent.name === STRAIGHT_SEGMENT) {
            this.updateStraightSegment({
              from: parent.userData.from,
              to: parent.userData.to,
              group: parent,
              scale: factor,
            })
          } else if (parent.name === TANGENTIAL_ARC_TO_SEGMENT) {
            this.updateTangentialArcToSegment({
              prevSegment: parent.userData.prevSegment,
              from: parent.userData.from,
              to: parent.userData.to,
              group: parent,
              scale: factor,
            })
          }
          return
        }
        editorManager.setHighlightRange([0, 0])
      },
      onMouseLeave: ({ selected, ...rest }: OnMouseEnterLeaveArgs) => {
        editorManager.setHighlightRange([0, 0])
        const parent = getParentGroup(selected, [
          STRAIGHT_SEGMENT,
          TANGENTIAL_ARC_TO_SEGMENT,
          PROFILE_START,
        ])
        if (parent) {
          const orthoFactor = orthoScale(sceneInfra.camControls.camera)

          const factor =
            (sceneInfra.camControls.camera instanceof OrthographicCamera
              ? orthoFactor
              : perspScale(sceneInfra.camControls.camera, parent)) /
            sceneInfra._baseUnitMultiplier
          if (parent.name === STRAIGHT_SEGMENT) {
            this.updateStraightSegment({
              from: parent.userData.from,
              to: parent.userData.to,
              group: parent,
              scale: factor,
            })
          } else if (parent.name === TANGENTIAL_ARC_TO_SEGMENT) {
            this.updateTangentialArcToSegment({
              prevSegment: parent.userData.prevSegment,
              from: parent.userData.from,
              to: parent.userData.to,
              group: parent,
              scale: factor,
            })
          }
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
): {
  truncatedAst: Program
  programMemoryOverride: ProgramMemory
  variableDeclarationName: string
} {
  const bodyIndex = Number(sketchPathToNode?.[1]?.[0]) || 0
  const _ast = JSON.parse(JSON.stringify(ast))

  const variableDeclarationName =
    getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchPathToNode || [],
      'VariableDeclaration'
    )?.node?.declarations?.[0]?.id?.name || ''
  const lastSeg = (
    programMemory.root[variableDeclarationName] as SketchGroup
  ).value.slice(-1)[0]
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
    // hacks like this wouldn't be needed if the AST put pathToNode info in memory/sketchGroup segments
    const updatedSrcRangeAst = parse(recast(_ast)) // get source ranges correct since unfortunately we still rely on them
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
    body: [JSON.parse(JSON.stringify(_ast.body[bodyIndex]))],
  }
  const programMemoryOverride: ProgramMemory = programMemoryInit()
  for (let i = 0; i < bodyIndex; i++) {
    const node = _ast.body[i]
    if (node.type !== 'VariableDeclaration') {
      continue
    }
    const name = node.declarations[0].id.name
    // const memoryItem = kclManager.programMemory.root[name]
    const memoryItem = programMemory.root[name]
    if (!memoryItem) {
      continue
    }
    programMemoryOverride.root[name] = JSON.parse(JSON.stringify(memoryItem))
  }
  return {
    truncatedAst,
    programMemoryOverride,
    variableDeclarationName,
  }
}

export function getParentGroup(
  object: any,
  stopAt: string[] = [STRAIGHT_SEGMENT, TANGENTIAL_ARC_TO_SEGMENT]
): Group | null {
  if (stopAt.includes(object?.userData?.type)) {
    return object
  } else if (object?.parent) {
    return getParentGroup(object.parent, stopAt)
  }
  return null
}

export function sketchGroupFromPathToNode({
  pathToNode,
  ast,
  programMemory,
}: {
  pathToNode: PathToNode
  ast: Program
  programMemory: ProgramMemory
}): SketchGroup {
  const varDec = getNodeFromPath<VariableDeclarator>(
    kclManager.ast,
    pathToNode,
    'VariableDeclarator'
  ).node
  return programMemory.root[varDec?.id?.name || ''] as SketchGroup
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
  const straightSegmentBody = getParentGroup(object, [
    STRAIGHT_SEGMENT,
    TANGENTIAL_ARC_TO_SEGMENT,
  ])
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
): Quaternion {
  const sketchGroup = sketchGroupFromPathToNode({
    pathToNode: sketchPathToNode,
    ast: kclManager.ast,
    programMemory: kclManager.programMemory,
  })
  const zAxis = sketchGroup?.zAxis || sketchNormalBackUp
  return getQuaternionFromZAxis(massageFormats(zAxis))
}
export async function getSketchOrientationDetails(
  sketchPathToNode: PathToNode
): Promise<{
  quat: Quaternion
  sketchDetails: SketchDetails & { faceId?: string }
}> {
  const sketchGroup = sketchGroupFromPathToNode({
    pathToNode: sketchPathToNode,
    ast: kclManager.ast,
    programMemory: kclManager.programMemory,
  })
  if (sketchGroup.on.type === 'plane') {
    const zAxis = sketchGroup?.zAxis
    return {
      quat: getQuaternionFromZAxis(massageFormats(zAxis)),
      sketchDetails: {
        sketchPathToNode,
        zAxis: [zAxis.x, zAxis.y, zAxis.z],
        yAxis: [sketchGroup.yAxis.x, sketchGroup.yAxis.y, sketchGroup.yAxis.z],
        origin: [0, 0, 0],
        faceId: sketchGroup.on.id,
      },
    }
  }
  if (sketchGroup.on.type === 'face') {
    const faceInfo = await getFaceDetails(sketchGroup.on.faceId)

    if (!faceInfo?.origin || !faceInfo?.z_axis || !faceInfo?.y_axis)
      throw new Error('faceInfo')
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
        faceId: sketchGroup.on.faceId,
      },
    }
  }
  throw new Error(
    'sketchGroup.on.type not recognized, has a new type been added?'
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
async function getFaceDetails(
  entityId: string
): Promise<Models['FaceIsPlanar_type']> {
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
  // TODO change typing to get_sketch_mode_plane once lib is updated
  const faceInfo: Models['FaceIsPlanar_type'] = (
    await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'get_sketch_mode_plane' },
    })
  )?.data?.data
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

function massageFormats(a: any): Vector3 {
  return Array.isArray(a)
    ? new Vector3(a[0], a[1], a[2])
    : new Vector3(a.x, a.y, a.z)
}

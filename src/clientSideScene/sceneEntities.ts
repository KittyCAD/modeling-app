import {
  BoxGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LineCurve3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
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
  isQuaternionVertical,
  RAYCASTABLE_PLANE,
  sceneInfra,
  SKETCH_GROUP_SEGMENTS,
  SKETCH_LAYER,
  X_AXIS,
  XZ_PLANE,
  Y_AXIS,
  YZ_PLANE,
} from './sceneInfra'
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
import { kclManager } from 'lang/KclSingleton'
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import { executeAst } from 'useStore'
import { engineCommandManager } from 'lang/std/engineConnection'
import {
  createArcGeometry,
  dashedStraight,
  straightSegment,
  tangentialArcToSegment,
} from './segments'
import {
  addCloseToPipe,
  addNewSketchLn,
  changeSketchArguments,
  compareVec2Epsilon2,
} from 'lang/std/sketch'
import { isReducedMotion, throttle } from 'lib/utils'
import {
  createArrayExpression,
  createCallExpressionStdLib,
  createLiteral,
  createPipeSubstitution,
} from 'lang/modifyAst'
import { getEventForSegmentSelection } from 'lib/selections'
import { getTangentPointFromPreviousArc } from 'lib/utils2d'
import { createGridHelper, orthoScale, perspScale } from './helpers'

type DraftSegment = 'line' | 'tangentialArcTo'

export const STRAIGHT_SEGMENT = 'straight-segment'
export const STRAIGHT_SEGMENT_BODY = 'straight-segment-body'
export const STRAIGHT_SEGMENT_DASH = 'straight-segment-body-dashed'
export const TANGENTIAL_ARC_TO_SEGMENT = 'tangential-arc-to-segment'
export const TANGENTIAL_ARC_TO_SEGMENT_BODY = 'tangential-arc-to-segment-body'
export const TANGENTIAL_ARC_TO__SEGMENT_DASH =
  'tangential-arc-to-segment-body-dashed'

// This singleton Class is responsible for all of the things the user sees and interacts with.
// That mostly mean sketch elements.
// Cameras, controls, raycasters, etc are handled by sceneInfra
class SceneEntities {
  scene: Scene
  sceneProgramMemory: ProgramMemory = { root: {}, return: null }
  activeSegments: { [key: string]: Group } = {}
  intersectionPlane: Mesh | null = null
  axisGroup: Group | null = null
  currentSketchQuaternion: Quaternion | null = null
  constructor() {
    this.scene = sceneInfra?.scene
    sceneInfra?.setOnCamChange(this.onCamChange)
  }

  onCamChange = () => {
    const orthoFactor = orthoScale(sceneInfra.camera)

    Object.values(this.activeSegments).forEach((segment) => {
      const factor =
        sceneInfra.camera instanceof OrthographicCamera
          ? orthoFactor
          : perspScale(sceneInfra.camera, segment)
      if (
        segment.userData.from &&
        segment.userData.to &&
        segment.userData.type === STRAIGHT_SEGMENT
      ) {
        this.updateStraightSegment({
          from: segment.userData.from,
          to: segment.userData.to,
          group: segment,
          scale: factor,
        })
      }

      if (
        segment.userData.from &&
        segment.userData.to &&
        segment.userData.prevSegment &&
        segment.userData.type === TANGENTIAL_ARC_TO_SEGMENT
      ) {
        this.updateTangentialArcToSegment({
          prevSegment: segment.userData.prevSegment,
          from: segment.userData.from,
          to: segment.userData.to,
          group: segment,
          scale: factor,
        })
      }
    })
    if (this.axisGroup) {
      const factor =
        sceneInfra.camera instanceof OrthographicCamera
          ? orthoFactor
          : perspScale(sceneInfra.camera, this.axisGroup)
      const x = this.axisGroup.getObjectByName(X_AXIS)
      x?.scale.set(1, factor, 1)
      const y = this.axisGroup.getObjectByName(Y_AXIS)
      y?.scale.set(factor, 1, 1)
    }
  }

  createIntersectionPlane() {
    const planeGeometry = new PlaneGeometry(100000, 100000)
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
  createSketchAxis(sketchPathToNode: PathToNode) {
    const baseXColor = 0x000055
    const baseYColor = 0x550000
    const xAxisGeometry = new BoxGeometry(100000, 0.3, 0.01)
    const yAxisGeometry = new BoxGeometry(0.3, 100000, 0.01)
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
    gridHelper.renderOrder = -3 // is this working?
    gridHelper.name = 'gridHelper'
    const sceneScale = getSceneScale(
      sceneInfra.camera,
      sceneInfra.controls.target
    )
    gridHelper.scale.set(sceneScale, sceneScale, sceneScale)
    this.axisGroup.add(xAxisMesh, yAxisMesh, gridHelper)
    this.currentSketchQuaternion &&
      this.axisGroup.setRotationFromQuaternion(this.currentSketchQuaternion)

    this.axisGroup.userData = { type: AXIS_GROUP }
    this.axisGroup.name = AXIS_GROUP
    this.axisGroup.layers.set(SKETCH_LAYER)
    this.axisGroup.traverse((child) => {
      child.layers.set(SKETCH_LAYER)
    })

    const quat = quaternionFromSketchGroup(
      sketchGroupFromPathToNode({
        pathToNode: sketchPathToNode,
        ast: kclManager.ast,
        programMemory: kclManager.programMemory,
      })
    )
    this.axisGroup.setRotationFromQuaternion(quat)
    this.scene.add(this.axisGroup)
  }
  removeIntersectionPlane() {
    const intersectionPlane = this.scene.getObjectByName(RAYCASTABLE_PLANE)
    if (intersectionPlane) this.scene.remove(intersectionPlane)
  }

  async setupSketch({
    sketchPathToNode,
    ast,
    // is draft line assumes the last segment is a draft line, and mods it as the user moves the mouse
    draftSegment,
  }: {
    sketchPathToNode: PathToNode
    ast?: Program
    draftSegment?: DraftSegment
  }) {
    this.createIntersectionPlane()

    const { truncatedAst, programMemoryOverride, variableDeclarationName } =
      this.prepareTruncatedMemoryAndAst(
        sketchPathToNode || [],
        kclManager.ast,
        draftSegment
      )
    const { programMemory } = await executeAst({
      ast: truncatedAst,
      useFakeExecutor: true,
      engineCommandManager,
      programMemoryOverride,
    })
    const sketchGroup = sketchGroupFromPathToNode({
      pathToNode: sketchPathToNode,
      ast: kclManager.ast,
      programMemory,
    })
    if (!Array.isArray(sketchGroup?.value)) return
    this.sceneProgramMemory = programMemory
    const group = new Group()
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
    const orthoFactor = orthoScale(sceneInfra.camera)
    const factor =
      sceneInfra.camera instanceof OrthographicCamera
        ? orthoFactor
        : perspScale(sceneInfra.camera, dummy)
    sketchGroup.value.forEach((segment, index) => {
      let segPathToNode = getNodePathFromSourceRange(
        draftSegment ? truncatedAst : kclManager.ast,
        segment.__geoMeta.sourceRange
      )
      const isDraftSegment =
        draftSegment && index === sketchGroup.value.length - 1
      let seg
      if (segment.type === 'TangentialArcTo') {
        seg = tangentialArcToSegment({
          prevSegment: sketchGroup.value[index - 1],
          from: segment.from,
          to: segment.to,
          id: segment.__geoMeta.id,
          pathToNode: segPathToNode,
          isDraftSegment,
          scale: factor,
        })
      } else {
        seg = straightSegment({
          from: segment.from,
          to: segment.to,
          id: segment.__geoMeta.id,
          pathToNode: segPathToNode,
          isDraftSegment,
          scale: factor,
        })
      }
      seg.layers.set(SKETCH_LAYER)
      seg.traverse((child) => {
        child.layers.set(SKETCH_LAYER)
      })

      group.add(seg)
      this.activeSegments[JSON.stringify(segPathToNode)] = seg
    })

    this.currentSketchQuaternion = quaternionFromSketchGroup(sketchGroup)
    group.setRotationFromQuaternion(this.currentSketchQuaternion)
    this.intersectionPlane &&
      this.intersectionPlane.setRotationFromQuaternion(
        this.currentSketchQuaternion
      )

    this.scene.add(group)
    if (!draftSegment) {
      sceneInfra.setCallbacks({
        onDrag: (args) => {
          this.onDragSegment({
            ...args,
            sketchPathToNode,
          })
        },
        onMove: () => {},
        onClick: (args) => {
          if (!args || !args.object) {
            sceneInfra.modelingSend({
              type: 'Set selection',
              data: {
                selectionType: 'singleCodeCursor',
              },
            })
            return
          }
          const { object } = args
          const event = getEventForSegmentSelection(object)
          if (!event) return
          sceneInfra.modelingSend(event)
        },
        onMouseEnter: ({ object }) => {
          // TODO change the color of the segment to yellow?
          // Give a few pixels grace around each of the segments
          // for hover.
          if ([X_AXIS, Y_AXIS].includes(object?.userData?.type)) {
            const obj = object as Mesh
            const mat = obj.material as MeshBasicMaterial
            mat.color.set(obj.userData.baseColor)
            mat.color.offsetHSL(0, 0, 0.5)
          }
          const parent = getParentGroup(object)
          if (parent?.userData?.pathToNode) {
            const updatedAst = parse(recast(kclManager.ast))
            const node = getNodeFromPath<CallExpression>(
              updatedAst,
              parent.userData.pathToNode,
              'CallExpression'
            ).node
            sceneInfra.highlightCallback([node.start, node.end])
            const yellow = 0xffff00
            colorSegment(object, yellow)
            return
          }
          sceneInfra.highlightCallback([0, 0])
        },
        onMouseLeave: ({ object }) => {
          sceneInfra.highlightCallback([0, 0])
          const parent = getParentGroup(object)
          const isSelected = parent?.userData?.isSelected
          colorSegment(object, isSelected ? 0x0000ff : 0xffffff)
          if ([X_AXIS, Y_AXIS].includes(object?.userData?.type)) {
            const obj = object as Mesh
            const mat = obj.material as MeshBasicMaterial
            mat.color.set(obj.userData.baseColor)
            if (obj.userData.isSelected) mat.color.offsetHSL(0, 0, 0.2)
          }
        },
      })
    } else {
      sceneInfra.setCallbacks({
        onDrag: () => {},
        onClick: async (args) => {
          if (!args) return
          const { intersection2d } = args
          if (!intersection2d) return

          const firstSeg = sketchGroup.value[0]
          const isClosingSketch = compareVec2Epsilon2(
            firstSeg.from,
            [intersection2d.x, intersection2d.y],
            1
          )
          let modifiedAst
          if (isClosingSketch) {
            // TODO close needs a better UX
            modifiedAst = addCloseToPipe({
              node: kclManager.ast,
              programMemory: kclManager.programMemory,
              pathToNode: sketchPathToNode,
            })
          } else {
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
          }

          kclManager.executeAstMock(modifiedAst, { updates: 'code' })
          await this.tearDownSketch({ removeAxis: false })
          this.setupSketch({ sketchPathToNode, draftSegment })
        },
        onMove: (args) => {
          this.onDragSegment({
            ...args,
            object: Object.values(this.activeSegments).slice(-1)[0],
            sketchPathToNode,
            draftInfo: {
              draftSegment,
              truncatedAst,
              programMemoryOverride,
              variableDeclarationName,
            },
          })
        },
      })
    }
    sceneInfra.controls.enableRotate = false
  }
  updateAstAndRejigSketch = async (
    sketchPathToNode: PathToNode,
    modifiedAst: Program
  ) => {
    await kclManager.updateAst(modifiedAst, false)
    await this.tearDownSketch({ removeAxis: false })
    this.setupSketch({ sketchPathToNode })
  }
  setUpDraftArc = async (sketchPathToNode: PathToNode) => {
    await this.tearDownSketch({ removeAxis: false })
    await new Promise((resolve) => setTimeout(resolve, 100))
    this.setupSketch({ sketchPathToNode, draftSegment: 'tangentialArcTo' })
  }
  setUpDraftLine = async (sketchPathToNode: PathToNode) => {
    await this.tearDownSketch({ removeAxis: false })
    await new Promise((resolve) => setTimeout(resolve, 100))
    this.setupSketch({ sketchPathToNode, draftSegment: 'line' })
  }
  onDraftLineMouseMove = () => {}
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
    event,
    intersectPoint,
    intersection2d,
    sketchPathToNode,
    draftInfo,
  }: {
    object: any
    event: any
    intersectPoint: Vector3
    intersection2d: Vector2
    sketchPathToNode: PathToNode
    draftInfo?: {
      draftSegment: DraftSegment
      truncatedAst: Program
      programMemoryOverride: ProgramMemory
      variableDeclarationName: string
    }
  }) {
    const group = getParentGroup(object)
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

    const modded = changeSketchArguments(
      modifiedAst,
      kclManager.programMemory,
      [node.start, node.end],
      to,
      from
    )
    modifiedAst = modded.modifiedAst
    const { truncatedAst, programMemoryOverride, variableDeclarationName } =
      draftInfo
        ? draftInfo
        : this.prepareTruncatedMemoryAndAst(sketchPathToNode || [])
    ;(async () => {
      const code = recast(modifiedAst)
      if (!draftInfo)
        // don't want to mode the user's code yet as they have't committed to the change yet
        // plus this would be the truncated ast being recast, it would be wrong
        kclManager.setCode(code, false)
      const { programMemory } = await executeAst({
        ast: truncatedAst,
        useFakeExecutor: true,
        engineCommandManager: engineCommandManager,
        programMemoryOverride,
      })
      this.sceneProgramMemory = programMemory
      const sketchGroup = programMemory.root[variableDeclarationName]
        .value as Path[]
      const orthoFactor = orthoScale(sceneInfra.camera)
      sketchGroup.forEach((segment, index) => {
        const segPathToNode = getNodePathFromSourceRange(
          modifiedAst,
          segment.__geoMeta.sourceRange
        )
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
          sceneInfra.camera instanceof OrthographicCamera
            ? orthoFactor
            : perspScale(sceneInfra.camera, group)
        if (type === TANGENTIAL_ARC_TO_SEGMENT) {
          this.updateTangentialArcToSegment({
            prevSegment: sketchGroup[index - 1],
            from: segment.from,
            to: segment.to,
            group: group,
            scale: factor,
          })
        } else if (type === STRAIGHT_SEGMENT) {
          this.updateStraightSegment({
            from: segment.from,
            to: segment.to,
            group: group,
            scale: factor,
          })
        }
      })
    })()
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
  }) {
    group.userData.from = from
    group.userData.to = to
    group.userData.prevSegment = prevSegment
    const arrowGroup = group.children.find(
      (child) => child.userData.type === ARROWHEAD
    ) as Group

    arrowGroup.position.set(to[0], to[1], 0)

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

    const arrowheadAngle =
      arcInfo.endAngle + (Math.PI / 2) * (arcInfo.ccw ? 1 : -1)
    arrowGroup.quaternion.setFromUnitVectors(
      new Vector3(0, 1, 0),
      new Vector3(Math.cos(arrowheadAngle), Math.sin(arrowheadAngle), 0)
    )
    arrowGroup.scale.set(scale, scale, scale)

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
  }) {
    group.userData.from = from
    group.userData.to = to
    const shape = new Shape()
    shape.moveTo(0, -0.08 * scale)
    shape.lineTo(0, 0.08 * scale) // The width of the line
    const arrowGroup = group.children.find(
      (child) => child.userData.type === ARROWHEAD
    ) as Group

    arrowGroup.position.set(to[0], to[1], 0)

    const dir = new Vector3()
      .subVectors(
        new Vector3(to[0], to[1], 0),
        new Vector3(from[0], from[1], 0)
      )
      .normalize()
    arrowGroup.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
    arrowGroup.scale.set(scale, scale, scale)

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
  }
  async animateAfterSketch() {
    if (isReducedMotion()) {
      sceneInfra.usePerspectiveCamera()
    } else {
      await sceneInfra.animateToPerspective()
    }
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
    sceneInfra.controls.enableRotate = true
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
      onMouseEnter: ({ object }) => {
        if (object.parent.userData.type !== DEFAULT_PLANES) return
        const type: DefaultPlane = object.userData.type
        object.material.color = defaultPlaneColor(type, 0.5, 1)
      },
      onMouseLeave: ({ object }) => {
        if (object.parent.userData.type !== DEFAULT_PLANES) return
        const type: DefaultPlane = object.userData.type
        object.material.color = defaultPlaneColor(type)
      },
      onClick: (args) => {
        if (!args || !args.object) return
        const { object, intersection } = args
        const type = object?.userData?.type || ''
        const posNorm = Number(intersection.normal?.z) > 0
        let planeString: DefaultPlaneStr = posNorm ? 'XY' : '-XY'
        let normal: [number, number, number] = posNorm ? [0, 0, 1] : [0, 0, -1]
        if (type === YZ_PLANE) {
          planeString = posNorm ? 'YZ' : '-YZ'
          normal = posNorm ? [1, 0, 0] : [-1, 0, 0]
        } else if (type === XZ_PLANE) {
          planeString = posNorm ? 'XZ' : '-XZ'
          normal = posNorm ? [0, 1, 0] : [0, -1, 0]
        }
        sceneInfra.modelingSend({
          type: 'Select default plane',
          data: {
            plane: planeString,
            normal,
          },
        })
      },
    })
  }
}

export type DefaultPlaneStr = 'XY' | 'XZ' | 'YZ' | '-XY' | '-XZ' | '-YZ'

export const sceneEntitiesManager = new SceneEntities()

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

export function quaternionFromSketchGroup(
  sketchGroup: SketchGroup
): Quaternion {
  // TODO figure what is happening in the executor that it's some times returning
  // [x,y,z] and sometimes {x,y,z}
  if (!sketchGroup?.zAxis) {
    // sometimes sketchGroup is undefined,
    // I don't quiet understand the circumstances yet
    // and it's very intermittent so leaving this here for now
    console.log('no zAxis', sketchGroup)
    console.trace('no zAxis')
  }
  const zAxisVec = massageFormats(sketchGroup?.zAxis)
  const yAxisVec = massageFormats(sketchGroup?.yAxis)
  const xAxisVec = new Vector3().crossVectors(yAxisVec, zAxisVec).normalize()

  let yAxisVecNormalized = yAxisVec.clone().normalize()
  let zAxisVecNormalized = zAxisVec.clone().normalize()

  let rotationMatrix = new Matrix4()
  rotationMatrix.makeBasis(xAxisVec, yAxisVecNormalized, zAxisVecNormalized)
  return new Quaternion().setFromRotationMatrix(rotationMatrix)
}

function colorSegment(object: any, color: number) {
  const arrowHead = getParentGroup(object, [ARROWHEAD])
  if (arrowHead) {
    arrowHead.traverse((child) => {
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
      if (child instanceof Mesh) {
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
  const dummyCam = new PerspectiveCamera()
  dummyCam.up.set(0, 0, 1)
  const _zAxis = massageFormats(zAxis)
  dummyCam.position.copy(_zAxis)
  dummyCam.lookAt(0, 0, 0)
  dummyCam.updateMatrix()
  const quaternion = dummyCam.quaternion.clone()

  const isVert = isQuaternionVertical(quaternion)

  // because vertical quaternions are a gimbal lock, for the orbit controls
  // it's best to set them explicitly to the vertical position with a known good camera up
  if (isVert && _zAxis.z < 0) {
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

import {
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LineCurve3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import {
  DEFAULT_PLANES,
  DefaultPlane,
  defaultPlaneColor,
  INTERSECTION_PLANE_LAYER,
  RAYCASTABLE_PLANE,
  setupSingleton,
  SKETCH_LAYER,
  XZ_PLANE,
  YZ_PLANE,
} from './setup'
import {
  CallExpression,
  getTangentialArcToInfo,
  parse,
  Path,
  PathToNode,
  PipeExpression,
  Program,
  ProgramMemory,
  recast,
  SketchGroup,
  VariableDeclaration,
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
  Coords2d,
  addNewSketchLn,
  changeSketchArguments,
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

type DraftSegment = 'line' | 'tangentialArcTo'

const SKETCH_GROUP_SEGMENTS = 'sketch-group-segments'
export const STRAIGHT_SEGMENT = 'straight-segment'
export const STRAIGHT_SEGMENT_BODY = 'straight-segment-body'
export const STRAIGHT_SEGMENT_DASH = 'straight-segment-body-dashed'
export const TANGENTIAL_ARC_TO_SEGMENT = 'tangential-arc-to-segment'
export const TANGENTIAL_ARC_TO_SEGMENT_BODY = 'tangential-arc-to-segment-body'
export const TANGENTIAL_ARC_TO__SEGMENT_DASH =
  'tangential-arc-to-segment-body-dashed'
export const ARROWHEAD = 'arrowhead'

class ClientSideScene {
  scene: Scene
  sceneProgramMemory: ProgramMemory = { root: {}, return: null }
  activeSegments: { [key: string]: Group } = {}
  intersectionPlane: Mesh | null = null
  constructor() {
    this.scene = setupSingleton?.scene
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
    this.intersectionPlane.layers.set(INTERSECTION_PLANE_LAYER)
    this.scene.add(this.intersectionPlane)
  }
  removeIntersectionPlane() {
    const intersectionPlane = this.scene.children.find(
      ({ userData }) => userData?.type === RAYCASTABLE_PLANE
    )
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
    this.sceneProgramMemory = programMemory
    const sketchGroup = programMemory.root[
      variableDeclarationName
    ] as SketchGroup
    const group = new Group()
    group.userData = {
      type: SKETCH_GROUP_SEGMENTS,
      pathToNode: sketchPathToNode,
    }
    sketchGroup.value.forEach((segment, index) => {
      let segPathToNode = getNodePathFromSourceRange(
        draftSegment ? truncatedAst : kclManager.ast,
        segment.__geoMeta.sourceRange
      )
      const isDraftSegment =
        draftSegment && index === sketchGroup.value.length - 1
      let seg
      if (segment.type === 'tangentialArcTo') {
        seg = tangentialArcToSegment({
          prevSegment: sketchGroup.value[index - 1],
          from: segment.from,
          to: segment.to,
          id: segment.__geoMeta.id,
          pathToNode: segPathToNode,
          isDraftSegment,
        })
      } else {
        seg = straightSegment({
          from: segment.from,
          to: segment.to,
          id: segment.__geoMeta.id,
          pathToNode: segPathToNode,
          isDraftSegment,
        })
      }
      seg.layers.set(SKETCH_LAYER)
      seg.traverse((child) => {
        child.layers.set(SKETCH_LAYER)
      })

      group.add(seg)
      this.activeSegments[JSON.stringify(segPathToNode)] = seg
    })

    const quaternion = quaternionFromSketchGroup(sketchGroup)
    group.setRotationFromQuaternion(quaternion)
    this.intersectionPlane &&
      this.intersectionPlane.setRotationFromQuaternion(quaternion)

    this.scene.add(group)
    if (!draftSegment) {
      setupSingleton.setCallbacks({
        onDrag: (args) => {
          this.onDragSegment({
            ...args,
            sketchPathToNode,
          })
        },
        onMove: () => {},
        onClick: (args) => {
          if (!args) {
            setupSingleton.modelingSend({
              type: 'Set selection',
              data: {
                selectionType: 'singleCodeCursor',
              },
            })
            return
          }
          const { object } = args
          const event = getEventForSegmentSelection(
            getParentGroup(object)?.userData?.pathToNode
          )
          if (!event) return
          setupSingleton.modelingSend(event)
        },
        onMouseEnter: ({ object }) => {
          // TODO change the color of the segment to yellow?
          // Give a few pixels grace around each of the segments
          // for hover.
          const parent = getParentGroup(object)
          if (parent?.userData?.pathToNode) {
            const updatedAst = parse(recast(kclManager.ast))
            const node = getNodeFromPath<CallExpression>(
              updatedAst,
              parent.userData.pathToNode,
              'CallExpression'
            ).node
            setupSingleton.highlightCallback([node.start, node.end])
            const yellow = 0xffff00
            colorSegment(object, yellow)
            return
          }
          setupSingleton.highlightCallback([0, 0])
        },
        onMouseLeave: ({ object }) => {
          setupSingleton.highlightCallback([0, 0])
          const parent = getParentGroup(object)
          const isSelected = parent?.userData?.isSelected
          colorSegment(object, isSelected ? 0x0000ff : 0xffffff)
        },
      })
    } else {
      setupSingleton.setCallbacks({
        onDrag: () => {},
        onClick: async (args) => {
          if (!args) return
          const { intersection2d } = args
          if (!intersection2d) return
          const lastSegment = sketchGroup.value.slice(-1)[0]
          const newSketchLn = addNewSketchLn({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            to: [intersection2d.x, intersection2d.y],
            from: [lastSegment.to[0], lastSegment.to[1]],
            fnName:
              lastSegment.type === 'tangentialArcTo'
                ? 'tangentialArcTo'
                : 'line',
            pathToNode: sketchPathToNode,
          })
          const _modifiedAst = newSketchLn.modifiedAst
          kclManager.executeAstMock(_modifiedAst, { updates: 'code' })
          await this.tearDownSketch()
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
    setupSingleton.controls.enableRotate = false
  }
  updateAstAndRejigSketch = async (
    sketchPathToNode: PathToNode,
    modifiedAst: Program
  ) => {
    await kclManager.updateAst(modifiedAst, false)
    await this.tearDownSketch()
    this.setupSketch({ sketchPathToNode })
  }
  setUpDraftArc = async (sketchPathToNode: PathToNode) => {
    await this.tearDownSketch()
    await new Promise((resolve) => setTimeout(resolve, 100))
    this.setupSketch({ sketchPathToNode, draftSegment: 'tangentialArcTo' })
  }
  setUpDraftLine = async (sketchPathToNode: PathToNode) => {
    await this.tearDownSketch()
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
        const { type } = group.userData
        if (type === TANGENTIAL_ARC_TO_SEGMENT) {
          this.updateTangentialArcToSegment({
            prevSegment: sketchGroup[index - 1],
            from: segment.from,
            to: segment.to,
            group: group,
          })
        } else if (type === STRAIGHT_SEGMENT) {
          this.updateStraightSegment({
            from: segment.from,
            to: segment.to,
            group: group,
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
  }: {
    prevSegment: SketchGroup['value'][number]
    from: [number, number]
    to: [number, number]
    group: Group
  }) {
    const arrowGroup = group.children.find(
      (child) => child.userData.type === ARROWHEAD
    ) as Group

    arrowGroup.position.set(to[0], to[1], 0)

    const previousPoint =
      prevSegment?.type === 'tangentialArcTo'
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

    const tangentialArcToSegmentBody = group.children.find(
      (child) => child.userData.type === TANGENTIAL_ARC_TO_SEGMENT_BODY
    ) as Mesh

    if (tangentialArcToSegmentBody) {
      const newGeo = createArcGeometry(arcInfo)
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
      })
    }
  }
  throttledUpdateDashedArcGeo = throttle(
    (args: Parameters<typeof createArcGeometry>[0] & { mesh: Mesh }) =>
      (args.mesh.geometry = createArcGeometry(args)),
    1000 / 30
  )
  updateStraightSegment({
    from,
    to,
    group,
  }: {
    from: [number, number]
    to: [number, number]
    group: Group
  }) {
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

    const straightSegmentBody = group.children.find(
      (child) => child.userData.type === STRAIGHT_SEGMENT_BODY
    ) as Mesh
    if (straightSegmentBody) {
      const line = new LineCurve3(
        new Vector3(from[0], from[1], 0),
        new Vector3(to[0], to[1], 0)
      )
      straightSegmentBody.geometry = new ExtrudeGeometry(
        (straightSegmentBody.geometry as ExtrudeGeometry).parameters.shapes,
        {
          steps: 100,
          bevelEnabled: false,
          extrudePath: line,
        }
      )
    }
    const straightSegmentBodyDashed = group.children.find(
      (child) => child.userData.type === STRAIGHT_SEGMENT_DASH
    ) as Mesh
    if (straightSegmentBodyDashed) {
      const shape = new Shape()
      shape.moveTo(0, -0.08)
      shape.lineTo(0, 0.08) // The width of the line
      straightSegmentBodyDashed.geometry = dashedStraight(from, to, shape)
    }
  }
  async animateAfterSketch() {
    if (isReducedMotion()) {
      setupSingleton.usePerspectiveCamera()
    } else {
      await setupSingleton.animateToPerspective()
    }
  }
  private _tearDownSketch(
    callDepth = 0,
    resolve: (val: unknown) => void,
    reject: () => void
  ) {
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
          this._tearDownSketch(callDepth + 1, resolve, reject)
        }, delay)
      } else {
        reject()
      }
    }
    if (this.intersectionPlane) this.scene.remove(this.intersectionPlane)
    setupSingleton.controls.enableRotate = true
    this.activeSegments = {}
    // maybe should reset onMove etc handlers
    if (shouldResolve) resolve(true)
  }
  async tearDownSketch() {
    // I think promisifying this is mostly a side effect of not having
    // "setupSketch" correctly capture a promise when it's done
    // so we're effectively waiting for to be finished setting up the scene just to tear it down
    // TODO is to fix that
    return new Promise((resolve, reject) => {
      this._tearDownSketch(0, resolve, reject)
    })
  }
  setupDefaultPlaneHover() {
    setupSingleton.setCallbacks({
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
        if (!args) return
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
        setupSingleton.modelingSend({
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

export const clientSideScene = new ClientSideScene()

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
  const programMemoryOverride: ProgramMemory = {
    root: {},
    return: null,
  }
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

function getParentGroup(
  object: any,
  stopAt: string[] = [STRAIGHT_SEGMENT, TANGENTIAL_ARC_TO_SEGMENT]
): Group | null {
  if (stopAt.includes(object?.userData?.type)) {
    return object
  } else if (object.parent) {
    return getParentGroup(object.parent, stopAt)
  }
  return null
}

export function quaternionFromSketchGroup(
  sketchGroup: SketchGroup
): Quaternion {
  // TODO figure what is happening in the executor that it's some times returning
  // [x,y,z] and sometimes {x,y,z}
  const massageFormats = (a: any): Vector3 =>
    Array.isArray(a)
      ? new Vector3(a[0], a[1], a[2])
      : new Vector3(a.x, a.y, a.z)
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

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
import { INTERSECTION_PLANE_LAYER, SKETCH_LAYER, setupSingleton } from './setup'
import {
  CallExpression,
  Path,
  PathToNode,
  PipeExpression,
  Program,
  ProgramMemory,
  SketchGroup,
  VariableDeclaration,
  parse,
  recast,
} from 'lang/wasm'
import { kclManager } from 'lang/KclSingleton'
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import { executeAst } from 'useStore'
import { engineCommandManager } from 'lang/std/engineConnection'
import { dashed, straightSegment } from './segments'
import { changeSketchArguments } from 'lang/std/sketch'
import { isReducedMotion } from 'lib/utils'
import {
  createArrayExpression,
  createCallExpressionStdLib,
  createLiteral,
  createPipeSubstitution,
} from 'lang/modifyAst'

type DraftSegment = 'line' | 'tangentialArcTo'

class ClientSideScene {
  scene: Scene
  sceneProgramMemory: ProgramMemory = { root: {}, return: null }
  activeSegments: { [key: string]: Group } = {}
  intersectionPlane: Mesh | null = null
  constructor() {
    this.scene = setupSingleton?.scene
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
    const planeGeometry = new PlaneGeometry(100000, 100000)
    const planeMaterial = new MeshBasicMaterial({
      color: 0xff0000,
      side: DoubleSide,
      transparent: true,
      opacity: 0.5,
    })
    this.intersectionPlane = new Mesh(planeGeometry, planeMaterial)
    this.intersectionPlane.userData = { type: 'raycastable-plane' }
    this.intersectionPlane.layers.set(INTERSECTION_PLANE_LAYER)
    this.scene.add(this.intersectionPlane)

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
    sketchGroup.value.forEach((segment, index) => {
      let segPathToNode = getNodePathFromSourceRange(
        draftSegment ? truncatedAst : kclManager.ast,
        segment.__geoMeta.sourceRange
      )
      const isDraftSegment =
        draftSegment && index === sketchGroup.value.length - 1
      if (isDraftSegment) {
        // hacks like this are still needed because we rely on source ranges
        // if we stored pathToNode info memory/sketchGroup segments this would not be needed
        const prevSegPath = getNodePathFromSourceRange(
          kclManager.ast,
          sketchGroup.value[index - 1].__geoMeta.sourceRange
        )
        const pipeBodyIndex = Number(prevSegPath[prevSegPath.length - 1][0])
        prevSegPath[prevSegPath.length - 1][0] = pipeBodyIndex + 1
        segPathToNode = prevSegPath
      }
      const seg = straightSegment({
        from: segment.from,
        to: segment.to,
        id: segment.__geoMeta.id,
        pathToNode: segPathToNode,
        isDraftSegment,
      })
      seg.layers.set(SKETCH_LAYER)
      seg.traverse((child) => {
        child.layers.set(SKETCH_LAYER)
      })

      group.add(seg)
      this.activeSegments[JSON.stringify(segPathToNode)] = seg
    })
    const zAxisVec = new Vector3(...sketchGroup.zAxis)
    const yAxisVec = new Vector3(...sketchGroup.yAxis)
    const xAxisVec = new Vector3().crossVectors(yAxisVec, zAxisVec).normalize()

    let yAxisVecNormalized = yAxisVec.clone().normalize()
    let zAxisVecNormalized = zAxisVec.clone().normalize()

    let rotationMatrix = new Matrix4()
    rotationMatrix.makeBasis(xAxisVec, yAxisVecNormalized, zAxisVecNormalized)
    const quaternion = new Quaternion().setFromRotationMatrix(rotationMatrix)
    group.setRotationFromQuaternion(quaternion)
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
      })
    } else {
      setupSingleton.setCallbacks({
        onDrag: () => {},
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
  setUpDraftLine = async (sketchPathToNode: PathToNode) => {
    await this.tearDownSketch() // todo remove animation part of tearDownSketch
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
        segPathToNode[1][0] = varDecIndex
        const pathToNodeStr = JSON.stringify(segPathToNode)
        const group = this.activeSegments[pathToNodeStr]
        // const prevSegment = sketchGroup.slice(index - 1)[0]
        const { type, from, to } = group.userData
        // if (type === 'tangentialArcTo') {
        //   sketchCanvasHelper.updateTangentialArcToSegment({
        //     prevSegment,
        //     from: segment.from,
        //     to: segment.to,
        //     group: group,
        //   })
        // } else
        if (type === 'straight-segment') {
          this.updateStraightSegment({
            from: segment.from,
            to: segment.to,
            group: group,
          })
        }
      })
    })()
  }
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
      (child) => child.userData.type === 'arrowhead'
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
      (child) => child.userData.type === 'straight-segment-body'
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
      (child) => child.userData.type === 'straight-segment-body-dashed'
    ) as Mesh
    if (straightSegmentBodyDashed) {
      const shape = new Shape()
      shape.moveTo(0, -0.08)
      shape.lineTo(0, 0.08) // The width of the line
      straightSegmentBodyDashed.geometry = dashed(from, to, shape)
    }
  }
  async animateAfterSketch() {
    if (isReducedMotion()) {
      setupSingleton.usePerspectiveCamera()
    } else {
      await setupSingleton.animateToPerspective()
    }
  }
  async tearDownSketch() {
    const aChild = Object.values(this.activeSegments)[0]
    if (aChild && aChild.parent) {
      this.scene.remove(aChild.parent)
    }
    if (this.intersectionPlane) this.scene.remove(this.intersectionPlane)
    setupSingleton.controls.enableRotate = true
  }
}

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
  if (draftSegment === 'line') {
    // truncatedAst needs to setup with another segment at the end
    const newSegment = createCallExpressionStdLib('line', [
      createArrayExpression([createLiteral(0), createLiteral(0)]),
      createPipeSubstitution(),
    ])
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
  const variableDeclarationName =
    getNodeFromPath<VariableDeclaration>(
      _ast,
      sketchPathToNode || [],
      'VariableDeclaration'
    )?.node?.declarations?.[0]?.id?.name || ''
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

function getParentGroup(object: any): Group | null {
  if (['straight-segment'].includes(object.userData.type)) {
    return object
  } else if (object.parent) {
    return getParentGroup(object.parent)
  }
  return null
}

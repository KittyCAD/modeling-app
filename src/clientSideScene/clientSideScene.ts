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
  Vector2,
  Vector3,
} from 'three'
import { INTERSECTION_PLANE_LAYER, SKETCH_LAYER, setupSingleton } from './setup'
import {
  CallExpression,
  Path,
  PathToNode,
  Program,
  ProgramMemory,
  SketchGroup,
  VariableDeclaration,
  recast,
} from 'lang/wasm'
import { kclManager } from 'lang/KclSingleton'
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import { executeAst } from 'useStore'
import { engineCommandManager } from 'lang/std/engineConnection'
import { straightSegment } from './segments'
import { changeSketchArguments } from 'lang/std/sketch'

class ClientSideScene {
  scene: Scene
  sceneProgramMemory: ProgramMemory = { root: {}, return: null }
  activeSegments: { [key: string]: Group } = {}
  intersectionPlane: Mesh | null = null
  constructor() {
    this.scene = setupSingleton?.scene
  }

  async setupSketch(sketchPathToNode: PathToNode, ast?: Program) {
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
      this.prepareTruncatedMemoryAndAst(sketchPathToNode || [])
    const { programMemory } = await executeAst({
      ast: truncatedAst,
      useFakeExecutor: true,
      engineCommandManager,
      defaultPlanes: kclManager.defaultPlanes,
      programMemoryOverride,
    })
    this.sceneProgramMemory = programMemory
    const sketchGroup = programMemory.root[
      variableDeclarationName
    ] as SketchGroup
    const group = new Group()
    sketchGroup.value.forEach((segment, index) => {
      const segPathToNode = getNodePathFromSourceRange(
        kclManager.ast,
        segment.__geoMeta.sourceRange
      )
      const seg = straightSegment({
        from: segment.from,
        to: segment.to,
        id: segment.__geoMeta.id,
        pathToNode: segPathToNode,
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

    this.scene.add(group)
    setupSingleton.setOnDragCallback((args) => {
      this.onDragSegment({
        ...args,
        sketchPathToNode,
      })
    })
  }
  prepareTruncatedMemoryAndAst = (
    sketchPathToNode: PathToNode,
    ast?: Program
  ) =>
    prepareTruncatedMemoryAndAst(
      sketchPathToNode,
      ast || kclManager.ast,
      kclManager.programMemory
    )
  onDragSegment({
    object,
    event,
    intersectPoint,
    intersection2d,
    sketchPathToNode,
  }: {
    object: any
    event: any
    intersectPoint: Vector3
    intersection2d: Vector2
    sketchPathToNode: PathToNode
  }) {
    const group = getParentGroup(object)
    if (!group) return
    const pathToNode: PathToNode = group.userData.pathToNode
    console.log('dragging', object, event, intersectPoint, intersection2d)

    const from: [number, number] = [
      group.userData.from[0],
      group.userData.from[1],
    ]
    const to: [number, number] = [intersection2d.x, intersection2d.y]
    let modifiedAst = { ...kclManager.ast }

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
      this.prepareTruncatedMemoryAndAst(sketchPathToNode || [])
    ;(async () => {
      const code = recast(modifiedAst)
      kclManager.setCode(code, false)
      const { programMemory } = await executeAst({
        ast: truncatedAst,
        useFakeExecutor: true,
        engineCommandManager: engineCommandManager,
        defaultPlanes: kclManager.defaultPlanes,
        programMemoryOverride,
      })
      this.sceneProgramMemory = programMemory
      const sketchGroup = programMemory.root[variableDeclarationName]
        .value as Path[]
      sketchGroup.forEach((segment, index) => {
        const segPathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          segment.__geoMeta.sourceRange
        )
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
    // group: paper.Group
  }) {
    console.log('okay just need to update it', from, to, group)
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
  tearDownSketch() {
    Object.values(this.activeSegments).forEach((seg) => {
      this.scene.remove(seg)
    })
    if (this.intersectionPlane) this.scene.remove(this.intersectionPlane)
  }
}

export const clientSideScene = new ClientSideScene()

// calculations/pure-functions/easy to test so no excuse not to

function prepareTruncatedMemoryAndAst(
  sketchPathToNode: PathToNode,
  ast: Program,
  programMemory: ProgramMemory
): {
  truncatedAst: Program
  programMemoryOverride: ProgramMemory
  variableDeclarationName: string
} {
  const bodyIndex = Number(sketchPathToNode?.[1]?.[0]) || 0
  const _ast = ast
  // const _ast = ast || kclManager.ast
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

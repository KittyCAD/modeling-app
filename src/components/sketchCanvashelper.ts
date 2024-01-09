import paper from 'paper'
import {
  PathToNode,
  ProgramMemory,
  Program,
  VariableDeclaration,
  Path,
  SketchGroup,
  CallExpression,
  recast,
} from 'lang/wasm'
import { useModelingContext } from 'hooks/useModelingContext'
import { kclManager } from 'lang/KclSingleton'
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import {
  addNewSketchLn,
  changeSketchArguments,
  compareVec2Epsilon,
} from 'lang/std/sketch'
import { executeAst } from 'useStore'
import { engineCommandManager } from 'lang/std/engineConnection'
import {
  getTangentPointFromPreviousArc,
  getTangentialArcToInfo,
} from 'lib/utils2d'

const triangleLength = 1.9
const triangleWidth = 0.9
const offset = 0

type SendType = ReturnType<typeof useModelingContext>['send']

interface NodePathToPaperGroupMap {
  [key: string]: {
    pathToNode: PathToNode
    group: paper.Group
    type: 'tangentialArcTo' | 'line'
  }
}

class SketchCanvasHelper {
  canvasProgramMemory: ProgramMemory = { root: {}, return: null }
  draftLine: paper.Group
  draftArc: paper.Group
  updateStraightSegment({
    from: _from,
    to: _to,
    group,
  }: {
    from: [number, number]
    to: [number, number]
    group: paper.Group
  }) {
    const from: [number, number] = [_from[0], -_from[1]]
    const to: [number, number] = [_to[0], -_to[1]]
    const direction = new paper.Point(to).subtract(from).normalize(1)

    const path = (group.children as any).body as paper.Path
    const head = (group.children as any).head as paper.Path
    const dot = (group.children as any).dot as paper.Path

    const origin = new paper.Point(0, 0)

    // figure out previous direction in order to rotate the head the correct amount
    const prevFrom = path.segments[0]
    const prevTo = path.segments[path.segments.length - 1]
    const prevDirection = new paper.Point(prevTo.point)
      .subtract(prevFrom.point)
      .normalize(1)
    head.rotate(-prevDirection.angle + 90, origin)
    head.position = new paper.Point(0, -triangleLength / 2 - offset)
    head.rotate(direction.angle - 90, origin)

    dot.position = new paper.Point(...to)

    head.translate(new paper.Point(...to).subtract(origin))
    path.segments[0].point = new paper.Point(...from)
    path.segments[1].point = new paper.Point(...to)
  }
  drawStraightSegment({
    from: _from,
    to: _to,
    pathToNode,
    isDraft = false,
    color = 'white',
  }: {
    from: [number, number]
    to: [number, number]
    pathToNode: PathToNode
    isDraft?: boolean
    color?: string
  }): {
    group: paper.Group
    pathToNode: PathToNode
    type: 'line'
  } {
    const from: [number, number] = [_from[0], -_from[1]]
    const to: [number, number] = [_to[0], -_to[1]]

    const path = new paper.Path({
      segments: [from, to],
      strokeColor: color,
    })
    path.strokeWidth = 0.1
    if (isDraft) {
      const dashLength = 0.755
      path.dashArray = [dashLength / 2, dashLength / 2]
    }

    path.name = 'body'
    const direction = new paper.Point(to).subtract(from).normalize(1)

    const radius = 0.35
    const dot = new paper.Path.Circle({
      center: to,
      radius,
      fillColor: color,
    })
    dot.name = 'dot'

    const group = new paper.Group([path, dot])

    if (!isDraft) {
      const triangleCenter = new paper.Point(0, 0)
      const triangle = new paper.Path([
        triangleCenter.add(
          new paper.Point(-triangleWidth / 2, -triangleLength - offset)
        ),
        triangleCenter.add(new paper.Point(0, -offset)),
        triangleCenter.add(
          new paper.Point(triangleWidth / 2, -triangleLength - offset)
        ),
      ])
      triangle.rotate(direction.angle - 90, new paper.Point(0, 0))
      const target = new paper.Point(...to)
      triangle.translate(target.subtract(triangleCenter))
      triangle.fillColor = new paper.Color(color)
      triangle.name = 'head'
      group.addChild(triangle)
    }

    return {
      group,
      pathToNode,
      type: 'line',
    }
  }
  drawTangentialArcToSegment({
    prevSegment,
    from: _from,
    to: _to,
    pathToNode,
    isDraft = false,
    color = 'white',
  }: {
    prevSegment: SketchGroup['value'][number]
    from: [number, number]
    to: [number, number]
    pathToNode: PathToNode
    isDraft?: boolean
    color?: string
  }): {
    group: paper.Group
    pathToNode: PathToNode
    type: 'tangentialArcTo'
  } {
    const previousPoint =
      prevSegment?.type === 'tangentialArcTo'
        ? getTangentPointFromPreviousArc(
            prevSegment.center,
            prevSegment.ccw,
            prevSegment.to
          )
        : prevSegment.from
    const from: [number, number] = [_from[0], -_from[1]]
    const to: [number, number] = [_to[0], -_to[1]]
    const {
      arcMidPoint: [midX, midY],
    } = getTangentialArcToInfo({
      arcStartPoint: _from,
      arcEndPoint: _to,
      tanPreviousPoint: previousPoint,
      obtuse: true,
    })

    const path = new paper.Path({
      segments: [from],
      strokeColor: color,
    })
    path.arcTo([midX, -midY], to)
    path.strokeWidth = 0.1
    if (isDraft) {
      const dashLength = 0.755
      path.dashArray = [dashLength / 2, dashLength / 2]
    }

    path.name = 'body'
    const direction = new paper.Point(to).subtract(from).normalize(1)

    const radius = 0.35
    const dot = new paper.Path.Circle({
      center: to,
      radius,
      fillColor: color,
    })
    dot.name = 'dot'

    const group = new paper.Group([path, dot])

    if (!isDraft) {
      const triangleCenter = new paper.Point(0, 0)
      const triangle = new paper.Path([
        triangleCenter.add(
          new paper.Point(-triangleWidth / 2, -triangleLength - offset)
        ),
        triangleCenter.add(new paper.Point(0, -offset)),
        triangleCenter.add(
          new paper.Point(triangleWidth / 2, -triangleLength - offset)
        ),
      ])
      triangle.rotate(direction.angle - 90, new paper.Point(0, 0))
      const target = new paper.Point(...to)
      triangle.translate(target.subtract(triangleCenter))
      triangle.fillColor = new paper.Color(color)
      triangle.name = 'head'
      group.addChild(triangle)
    }

    return {
      group,
      pathToNode,
      type: 'tangentialArcTo',
    }
  }
  updateTangentialArcToSegment({
    prevSegment,
    from: _from,
    to: _to,
    group,
  }: {
    prevSegment: SketchGroup['value'][number]
    from: [number, number]
    to: [number, number]
    group: paper.Group
  }) {
    const from: [number, number] = [_from[0], -_from[1]]
    const to: [number, number] = [_to[0], -_to[1]]
    const tanPreviousPoint =
      prevSegment.type === 'tangentialArcTo'
        ? getTangentPointFromPreviousArc(
            prevSegment.center,
            prevSegment.ccw,
            prevSegment.to
          )
        : prevSegment.from
    const {
      arcMidPoint: [midX, midY],
    } = getTangentialArcToInfo({
      arcStartPoint: _from,
      arcEndPoint: _to,
      tanPreviousPoint,
      obtuse: true,
    })
    const direction = new paper.Point(to).subtract(from).normalize(1)

    const path = (group.children as any).body as paper.Path
    path.segments = [new paper.Segment(new paper.Point(...from))]
    path.arcTo([midX, -midY], to)

    const head = (group.children as any).head as paper.Path
    const dot = (group.children as any).dot as paper.Path

    const origin = new paper.Point(0, 0)

    // figure out previous direction in order to rotate the head the correct amount
    const prevFrom = path.segments[0]
    const prevTo = path.segments[path.segments.length - 1]
    const prevDirection = new paper.Point(prevTo.point)
      .subtract(prevFrom.point)
      .normalize(1)
    head.rotate(-prevDirection.angle + 90, origin)
    head.position = new paper.Point(0, -triangleLength / 2 - offset)
    head.rotate(direction.angle - 90, origin)

    dot.position = new paper.Point(...to)

    head.translate(new paper.Point(...to).subtract(origin))
  }

  modelingSend: SendType = (() => {}) as any
  setSend(send: SendType) {
    this.modelingSend = send
  }
  constructor() {
    this.draftLine = {} as paper.Group
    this.draftArc = {} as paper.Group
  }

  prepareTruncatedMemoryAndAst(
    sketchPathToNode: PathToNode,
    ast?: Program
  ): {
    truncatedAst: Program
    programMemoryOverride: ProgramMemory
    variableDeclarationName: string
  } {
    const bodyIndex = Number(sketchPathToNode?.[1]?.[0]) || 0
    const _ast = ast || kclManager.ast
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
      const memoryItem = kclManager.programMemory.root[name]
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
  getSketchGroupFromNodePath(sketchPathToNode: PathToNode): SketchGroup {
    const variableDeclarationName =
      getNodeFromPath<VariableDeclaration>(
        kclManager.ast,
        sketchPathToNode || [],
        'VariableDeclaration'
      )?.node?.declarations?.[0]?.id?.name || ''
    return kclManager.programMemory.root[variableDeclarationName] as SketchGroup
  }

  addDraftLine(sketchPathToNode: PathToNode, shouldHide = true) {
    const sketchGroup = this.getSketchGroupFromNodePath(sketchPathToNode).value
    const finalLocation = sketchGroup[sketchGroup.length - 1].to
    const newLine = this.drawStraightSegment({
      from: finalLocation,
      to: finalLocation,
      pathToNode: sketchPathToNode,
      isDraft: true,
      color: shouldHide ? '#FFFFFF00' : 'white',
    })
    this.draftLine = newLine.group
    return newLine.group
  }
  addDraftArc(sketchPathToNode: PathToNode, shouldHide = true) {
    const sketchGroup = this.getSketchGroupFromNodePath(sketchPathToNode).value
    const lastSeg = sketchGroup[sketchGroup.length - 1]
    const finalLocation = lastSeg.to
    const draftArc = this.drawTangentialArcToSegment({
      prevSegment: lastSeg,
      from: finalLocation,
      to: finalLocation,
      pathToNode: sketchPathToNode,
      isDraft: true,
      color: shouldHide ? '#FFFFFF00' : 'white',
    })
    this.draftArc = draftArc.group
    return draftArc.group
  }
  async addNewStraightSegment(
    sketchPathToNode: PathToNode,
    newPoint: [number, number]
  ) {
    const sketchGroup = this.getSketchGroupFromNodePath(sketchPathToNode).value
    const startPathCoord = sketchGroup[0].from
    const thing = (this.draftLine.children as any).body as paper.Path
    const thing2 = thing.segments[0].point
    const lastCoord: [number, number] = [thing2.x, -thing2.y]
    const isClose = compareVec2Epsilon(startPathCoord, newPoint)
    let _modifiedAst: Program
    if (!isClose) {
      const newSketchLn = addNewSketchLn({
        node: kclManager.ast,
        programMemory: kclManager.programMemory,
        to: newPoint,
        from: lastCoord,
        fnName: 'line',
        // fnName: tool === 'sketch_line' ? 'line' : 'tangentialArcTo',
        pathToNode: sketchPathToNode,
      })
      await kclManager.executeAstMock(newSketchLn.modifiedAst, {
        updates: 'code',
      })
      paper.project.clear()
      this.setupPaperSketch(sketchPathToNode)
      this.addDraftLine(sketchPathToNode, false)
    }
  }
  async addNewTangentialArcSegment(
    sketchPathToNode: PathToNode,
    newPoint: [number, number]
  ) {
    const sketchGroup = this.getSketchGroupFromNodePath(sketchPathToNode).value
    const startPathCoord = sketchGroup[0].from
    const thing = (this.draftLine.children as any).body as paper.Path
    const thing2 = thing.segments[0].point
    const lastCoord: [number, number] = [thing2.x, -thing2.y]
    const isClose = compareVec2Epsilon(startPathCoord, newPoint)
    let _modifiedAst: Program
    if (!isClose) {
      const newSketchLn = addNewSketchLn({
        node: kclManager.ast,
        programMemory: kclManager.programMemory,
        to: newPoint,
        from: lastCoord,
        fnName: 'tangentialArcTo',
        // fnName: tool === 'sketch_line' ? 'line' : 'tangentialArcTo',
        pathToNode: sketchPathToNode,
      })
      await kclManager.executeAstMock(newSketchLn.modifiedAst, {
        updates: 'code',
      })
      paper.project.clear()
      this.setupPaperSketch(sketchPathToNode)
      this.addDraftLine(sketchPathToNode, false)
      this.addDraftArc(sketchPathToNode, false)
    }
  }
  async setupPaperSketch(sketchPathToNode: PathToNode, ast?: Program) {
    const { truncatedAst, programMemoryOverride, variableDeclarationName } =
      sketchCanvasHelper.prepareTruncatedMemoryAndAst(sketchPathToNode || [])
    const { programMemory } = await executeAst({
      ast: truncatedAst,
      useFakeExecutor: true,
      engineCommandManager: engineCommandManager,
      defaultPlanes: kclManager.defaultPlanes,
      programMemoryOverride,
    })
    const sketchGroup = programMemory.root[variableDeclarationName]
      .value as Path[]
    const nodePathToPaperGroupMap: NodePathToPaperGroupMap = {}
    sketchGroup.forEach((segment, index) => {
      const prevSegment = sketchGroup.slice(index - 1)[0]
      const seg =
        segment.type === 'tangentialArcTo'
          ? sketchCanvasHelper.drawTangentialArcToSegment({
              prevSegment,
              from: segment.from,
              to: segment.to,
              pathToNode: getNodePathFromSourceRange(
                kclManager.ast,
                segment.__geoMeta.sourceRange
              ),
            })
          : sketchCanvasHelper.drawStraightSegment({
              from: segment.from,
              to: segment.to,
              pathToNode: getNodePathFromSourceRange(
                kclManager.ast,
                segment.__geoMeta.sourceRange
              ),
            })
      nodePathToPaperGroupMap[JSON.stringify(seg.pathToNode)] = seg
    })
    Object.values(nodePathToPaperGroupMap).forEach(({ group, pathToNode }) => {
      const head = (group.children as any).head as paper.Path
      const body = (group.children as any).body as paper.Path
      head.onMouseDrag = (event: paper.MouseEvent) => {
        const to: [number, number] = [event.point.x, -event.point.y]
        const fromPoint = body.segments[0].point
        const from: [number, number] = [fromPoint.x, -fromPoint.y]
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
          sketchCanvasHelper.prepareTruncatedMemoryAndAst(
            sketchPathToNode || []
          )
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
          const sketchGroup = programMemory.root[variableDeclarationName]
            .value as Path[]
          sketchGroup.forEach((segment, index) => {
            const segPathToNode = getNodePathFromSourceRange(
              kclManager.ast,
              segment.__geoMeta.sourceRange
            )
            const pathToNodeStr = JSON.stringify(segPathToNode)
            const { group, type } = nodePathToPaperGroupMap[pathToNodeStr]
            const prevSegment = sketchGroup.slice(index - 1)[0]
            if (type === 'tangentialArcTo') {
              sketchCanvasHelper.updateTangentialArcToSegment({
                // previousPoint: prevSegment.from,
                prevSegment,
                from: segment.from,
                to: segment.to,
                group: group,
              })
            } else {
              sketchCanvasHelper.updateStraightSegment({
                from: segment.from,
                to: segment.to,
                group: group,
              })
            }
          })
          const path = (sketchCanvasHelper.draftLine.children as any)
            .body as paper.Path
          const dot = (sketchCanvasHelper.draftLine.children as any)
            .dot as paper.Path
          const lastPoint = sketchGroup[sketchGroup.length - 1].to
          const paperPoint = new paper.Point([lastPoint[0], -lastPoint[1]])
          path.segments[0].point = paperPoint
          path.segments[1].point = paperPoint
          dot.position = paperPoint
        })()
      }
    })
  }
  updateDraftLine(point: paper.Point) {
    const draftLine = this.draftLine
    const path = (draftLine.children as any).body as paper.Path
    const dot = (draftLine.children as any).dot as paper.Path
    path.segments[1].point = point
    dot.position = point
  }
  updateDraftArc(point: paper.Point, sketchPathToNode: any) {
    const draftArc = this.draftArc
    const path = (draftArc.children as any).body as paper.Path
    const dot = (draftArc.children as any).dot as paper.Path
    dot.position = point

    const sketchGroup = sketchCanvasHelper.getSketchGroupFromNodePath(
      sketchPathToNode || []
    ).value

    const lastSeg = sketchGroup[sketchGroup.length - 1]
    const tangentPoint =
      lastSeg.type === 'tangentialArcTo'
        ? getTangentPointFromPreviousArc(
            lastSeg.center,
            lastSeg.ccw,
            lastSeg.to
          )
        : lastSeg.from

    const {
      arcMidPoint: [midX, midY],
    } = getTangentialArcToInfo({
      arcStartPoint: lastSeg.to,
      arcEndPoint: [point.x, -point.y],
      tanPreviousPoint: tangentPoint,
      obtuse: true,
    })

    const from: [number, number] = [lastSeg.to[0], -lastSeg.to[1]]
    path.segments = [new paper.Segment(new paper.Point(...from))]
    path.arcTo([midX, -midY], point)
  }
}

export const sketchCanvasHelper = new SketchCanvasHelper()

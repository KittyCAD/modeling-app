import { setup } from 'xstate'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three'

// Trim tool draws an ephemeral polyline during an area-select drag.
// At drag end the preview is removed – no sketch entities are created (yet).

const TOOL_ID = 'Trim tool'

// Helper to calculate intersection point of two line segments
// Returns null if they don't intersect, or the intersection point [x, y]
function lineSegmentIntersection(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): [number, number] | null {
  const [x1, y1] = p1
  const [x2, y2] = p2
  const [x3, y3] = p3
  const [x4, y4] = p4

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denom) < 1e-10) {
    // Lines are parallel
    return null
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom

  // Check if intersection is within both segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    const x = x1 + t * (x2 - x1)
    const y = y1 + t * (y2 - y1)
    return [x, y]
  }

  return null
}

// Helper to get point coordinates from sceneGraph
function getPointCoords(
  pointId: number,
  objects: Array<any>
): [number, number] | null {
  const point = objects[pointId]
  if (
    point?.kind?.type !== 'Segment' ||
    point?.kind?.segment?.type !== 'Point'
  ) {
    return null
  }
  return [
    point.kind.segment.position.x.value,
    point.kind.segment.position.y.value,
  ]
}

type ToolEvents = BaseToolEvent

export const machine = setup({
  types: {
    context: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sceneGraphDelta?: SceneGraphDelta
    },
    events: {} as ToolEvents,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sceneGraphDelta?: SceneGraphDelta
    },
  },
  actions: {
    'add area select listener': ({ context }) => {
      const scene = context.sceneInfra.scene
      let currentLine: Line | null = null
      let points: Vector3[] = []
      let lastPoint2D: [number, number] | null = null

      const pxThreshold = 5

      // Helper to get pixel distance between two world-space points
      const distancePx = (a: [number, number], b: [number, number]) =>
        context.sceneInfra.screenSpaceDistance(a, b)

      context.sceneInfra.setCallbacks({
        onAreaSelectStart: ({ startPoint }) => {
          if (!startPoint?.twoD) return
          // Store the starting point but don't create the Line yet (needs at least 2 points)
          points = [
            new Vector3(startPoint.twoD.x, startPoint.twoD.y, 0),
          ] as Vector3[]
          lastPoint2D = [startPoint.twoD.x, startPoint.twoD.y]
        },
        onAreaSelect: ({ currentPoint }) => {
          if (!currentPoint?.twoD || !lastPoint2D) return
          const { x, y } = currentPoint.twoD
          const distance = distancePx(lastPoint2D, [x, y])
          if (distance >= pxThreshold) {
            points.push(new Vector3(x, y, 0))

            // Create the Line when we have at least 2 points
            if (!currentLine && points.length >= 2) {
              const geom = new BufferGeometry().setFromPoints(points)
              const mat = new LineBasicMaterial({ color: 0xff8800 })
              currentLine = new Line(geom, mat)
              currentLine.name = 'trim-tool-preview'
              scene.add(currentLine)
            } else if (currentLine) {
              // Update existing line: dispose old geometry and create new one
              // (setFromPoints doesn't resize buffers, so we need a fresh geometry)
              const oldGeom = currentLine.geometry
              const newGeom = new BufferGeometry().setFromPoints(points)
              currentLine.geometry = newGeom
              oldGeom.dispose()
            }

            lastPoint2D = [x, y]
          }
        },
        onAreaSelectEnd: () => {
          // Find intersections with existing line segments
          const intersections: Array<{
            location: [number, number]
            segmentId: number
          }> = []

          if (context.sceneGraphDelta && points.length >= 2) {
            const objects = context.sceneGraphDelta.new_graph.objects

            // Find all line segments in the sceneGraph
            for (let segmentId = 0; segmentId < objects.length; segmentId++) {
              const obj = objects[segmentId]
              if (
                obj?.kind?.type === 'Segment' &&
                obj.kind.segment.type === 'Line'
              ) {
                const startPoint = getPointCoords(
                  obj.kind.segment.start,
                  objects
                )
                const endPoint = getPointCoords(obj.kind.segment.end, objects)

                if (startPoint && endPoint) {
                  // Check each segment of the drawn polyline against this line
                  for (let i = 0; i < points.length - 1; i++) {
                    const p1: [number, number] = [points[i].x, points[i].y]
                    const p2: [number, number] = [
                      points[i + 1].x,
                      points[i + 1].y,
                    ]

                    const intersection = lineSegmentIntersection(
                      p1,
                      p2,
                      startPoint,
                      endPoint
                    )

                    if (intersection) {
                      intersections.push({
                        location: intersection,
                        segmentId,
                      })
                    }
                  }
                }
              }
            }
          }

          console.log('Intersections:', intersections)

          if (currentLine) {
            scene.remove(currentLine)
            currentLine.geometry.dispose()
            ;(currentLine.material as LineBasicMaterial).dispose()
            currentLine = null
            points = []
            lastPoint2D = null
          }
        },
      })
    },
    'remove area select listener': ({ context }) => {
      context.sceneInfra.setCallbacks({
        onAreaSelectStart: () => {},
        onAreaSelect: () => {},
        onAreaSelectEnd: () => {},
      })
    },
  },
}).createMachine({
  context: ({ input }) => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sceneGraphDelta: input.sceneGraphDelta,
  }),
  id: TOOL_ID,
  initial: 'active',
  on: {
    unequip: {
      target: '#Trim tool.unequipping',
    },
    escape: {
      target: '#Trim tool.unequipping',
    },
  },
  states: {
    active: {
      entry: 'add area select listener',
    },
    unequipping: {
      type: 'final',
      entry: 'remove area select listener',
    },
  },
})

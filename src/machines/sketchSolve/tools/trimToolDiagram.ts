import { setup } from 'xstate'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { Vector3, Group } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { createOnAreaSelectEndCallback } from '@src/machines/sketchSolve/tools/trimToolImpl'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'

// Trim tool draws an ephemeral polyline during an area-select drag.
// At drag end the preview is removed – no sketch entities are created (yet).
const TOOL_ID = 'Trim tool'

type ToolEvents = BaseToolEvent

export const machine = setup({
  types: {
    context: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
      sceneGraphDelta?: SceneGraphDelta
    },
    events: {} as ToolEvents,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
      sceneGraphDelta?: SceneGraphDelta
    },
  },
  actions: {
    'add area select listener': ({ context, self }) => {
      const scene = context.sceneInfra.scene
      let currentLine: Line2 | null = null
      let points: Vector3[] = []
      let lastPoint2D: [number, number] | null = null

      const pxThreshold = 5

      // Helper to get the sketch solve group which has the correct plane orientation
      // Retrieved dynamically in case it's created after the tool is equipped
      const getSketchSolveGroup = (): Group | null => {
        const obj = scene.getObjectByName(SKETCH_SOLVE_GROUP)
        return obj instanceof Group ? obj : null
      }

      // Helper to get pixel distance between two world-space points
      const distancePx = (a: [number, number], b: [number, number]) =>
        context.sceneInfra.screenSpaceDistance(a, b)

      context.sceneInfra.setCallbacks({
        onAreaSelectStart: ({ startPoint }) => {
          if (!startPoint?.twoD) return
          // Store the starting point but don't create the Line yet (needs at least 2 points)
          points = [new Vector3(startPoint.twoD.x, startPoint.twoD.y, 0)]
          lastPoint2D = [startPoint.twoD.x, startPoint.twoD.y]
        },
        onAreaSelect: ({ currentPoint }) => {
          if (!currentPoint?.twoD || !lastPoint2D) return
          const { x, y } = currentPoint.twoD
          const distance = distancePx(lastPoint2D, [x, y])
          if (distance >= pxThreshold) {
            points.push(new Vector3(x, y, 0))

            // Create the Line2 when we have at least 2 points
            if (!currentLine && points.length >= 2) {
              const positions: number[] = []
              for (const point of points) {
                positions.push(point.x, point.y, point.z)
              }
              const geom = new LineGeometry()
              geom.setPositions(positions)
              const mat = new LineMaterial({
                color: 0xff8800,
                linewidth: 2 * window.devicePixelRatio,
              })
              currentLine = new Line2(geom, mat)
              currentLine.name = 'trim-tool-preview'
              // Add to sketchSolveGroup if available (for correct plane orientation),
              // otherwise fall back to scene (for backwards compatibility)
              const sketchSolveGroup = getSketchSolveGroup()
              if (sketchSolveGroup) {
                sketchSolveGroup.add(currentLine)
              } else {
                scene.add(currentLine)
              }
            } else if (currentLine) {
              // Update existing line: dispose old geometry and create new one
              const positions: number[] = []
              for (const point of points) {
                positions.push(point.x, point.y, point.z)
              }
              const oldGeom = currentLine.geometry
              const newGeom = new LineGeometry()
              newGeom.setPositions(positions)
              currentLine.geometry = newGeom
              oldGeom.dispose()
            }

            lastPoint2D = [x, y]
          }
        },
        onAreaSelectEnd: async () => {
          const onAreaSelectEndHandler = createOnAreaSelectEndCallback({
            getContextData: () => {
              // current context must be got at at execution time, else it will be stale in the closure
              const currentSnapshot = self.getSnapshot()
              const currentContext = currentSnapshot?.context

              // Try to get the most up-to-date sceneGraphDelta
              // Priority: 1) Parent's sketchExecOutcome (most recent), 2) Current machine context, 3) Captured context (stale)
              let sceneGraphDelta: SceneGraphDelta | undefined

              try {
                const parentSnapshot = self._parent?.getSnapshot()

                if (
                  parentSnapshot?.context?.sketchExecOutcome?.sceneGraphDelta
                ) {
                  sceneGraphDelta =
                    parentSnapshot.context.sketchExecOutcome.sceneGraphDelta
                } else if (currentContext?.sceneGraphDelta) {
                  sceneGraphDelta = currentContext.sceneGraphDelta
                } else if (context.sceneGraphDelta) {
                  sceneGraphDelta = context.sceneGraphDelta
                }
              } catch (e) {
                console.error('[TRIM] Error accessing context:', e)
                // Fall back to captured context
                sceneGraphDelta = context.sceneGraphDelta
              }

              return {
                sceneGraphDelta,
                sketchId: context.sketchId,
                rustContext: context.rustContext,
              }
            },
            onNewSketchOutcome: (outcome) => {
              self._parent?.send({
                type: 'update sketch outcome',
                data: outcome,
              })
            },
          })

          // Convert Vector3[] to Coords2d[] for the trim flow
          await onAreaSelectEndHandler(points.map((p) => [p.x, p.y]))

          // Clean up the preview line
          if (currentLine) {
            // Remove from the group it was added to
            const sketchSolveGroup = getSketchSolveGroup()
            if (
              sketchSolveGroup &&
              sketchSolveGroup.children.includes(currentLine)
            ) {
              sketchSolveGroup.remove(currentLine)
            } else {
              scene.remove(currentLine)
            }
            currentLine.geometry.dispose()
            currentLine.material.dispose()
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
    sketchId: input.sketchId,
    sceneGraphDelta: input.sceneGraphDelta,
  }),
  id: TOOL_ID,
  initial: 'active',
  on: {
    unequip: {
      target: '#Trim tool.unequipping',
    },
  },
  states: {
    active: {
      entry: 'add area select listener',
      on: {
        escape: {
          target: '#Trim tool.unequipping',
          description: 'ESC unequips the tool',
        },
      },
    },
    unequipping: {
      type: 'final',
      entry: 'remove area select listener',
    },
  },
})

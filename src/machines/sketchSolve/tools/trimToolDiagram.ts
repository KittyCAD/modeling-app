import { assign, setup } from 'xstate'

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

type ToolEvents =
  | BaseToolEvent
  | { type: 'reset trim state'; startPoint: [number, number] }
  | { type: 'add trim point'; point: [number, number]; points: Vector3[] }
  | { type: 'set trim line'; line: Line2 }
  | { type: 'clear trim state' }

export const machine = setup({
  types: {
    context: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
      sceneGraphDelta?: SceneGraphDelta
      trimPoints: Vector3[]
      trimIsCancelled: boolean
      trimLastPoint2D: [number, number] | null
      trimCurrentLine: Line2 | null
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
  guards: {
    'has active trim line': ({ context }) => {
      const scene = context.sceneInfra.scene
      const sketchSolveGroup = scene.getObjectByName(SKETCH_SOLVE_GROUP)
      const groupToSearch =
        sketchSolveGroup instanceof Group ? sketchSolveGroup : scene
      const trimLine = groupToSearch.getObjectByName('trim-tool-preview')
      return trimLine instanceof Line2
    },
  },
  actions: {
    'cancel trim line': assign(({ context }) => {
      const scene = context.sceneInfra.scene
      const sketchSolveGroup = scene.getObjectByName(SKETCH_SOLVE_GROUP)

      // Remove the visual line if it exists
      if (context.trimCurrentLine) {
        if (
          sketchSolveGroup &&
          sketchSolveGroup.children.includes(context.trimCurrentLine)
        ) {
          sketchSolveGroup.remove(context.trimCurrentLine)
        } else {
          scene.remove(context.trimCurrentLine)
        }
        context.trimCurrentLine.geometry.dispose()
        context.trimCurrentLine.material.dispose()
      } else {
        // Fallback: try to find the line by name
        const groupToSearch =
          sketchSolveGroup instanceof Group ? sketchSolveGroup : scene
        const trimLine = groupToSearch.getObjectByName('trim-tool-preview')
        if (trimLine instanceof Line2) {
          if (
            sketchSolveGroup &&
            sketchSolveGroup.children.includes(trimLine)
          ) {
            sketchSolveGroup.remove(trimLine)
          } else if (scene.children.includes(trimLine)) {
            scene.remove(trimLine)
          } else if (trimLine.parent) {
            trimLine.parent.remove(trimLine)
          }
          trimLine.geometry.dispose()
          trimLine.material.dispose()
        }
      }

      // Clear points and set cancellation flag
      return {
        trimPoints: [],
        trimIsCancelled: true,
        trimLastPoint2D: null,
        trimCurrentLine: null,
      }
    }),
    'add area select listener': ({ context, self }) => {
      const scene = context.sceneInfra.scene
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
          // Reset cancellation flag and initialize points in context
          self.send({
            type: 'reset trim state',
            startPoint: [startPoint.twoD.x, startPoint.twoD.y],
          })
        },
        onAreaSelect: ({ currentPoint }) => {
          if (!currentPoint?.twoD) return
          // Get current state from snapshot
          const snapshot = self.getSnapshot()
          const currentContext = snapshot.context

          // Don't add points if trim was cancelled
          if (currentContext.trimIsCancelled) return
          if (!currentContext.trimLastPoint2D) return

          const { x, y } = currentPoint.twoD
          const distance = distancePx(currentContext.trimLastPoint2D, [x, y])
          if (distance >= pxThreshold) {
            // Add point to context
            const newPoints = [
              ...currentContext.trimPoints,
              new Vector3(x, y, 0),
            ]
            self.send({
              type: 'add trim point',
              point: [x, y],
              points: newPoints,
            })

            // Get fresh snapshot after sending event to check for line
            const updatedSnapshot = self.getSnapshot()
            const updatedContext = updatedSnapshot.context

            // Update or create the line
            const sketchSolveGroup = getSketchSolveGroup()
            if (!updatedContext.trimCurrentLine && newPoints.length >= 2) {
              // Create new line
              const positions: number[] = []
              for (const point of newPoints) {
                positions.push(point.x, point.y, point.z)
              }
              const geom = new LineGeometry()
              geom.setPositions(positions)
              const mat = new LineMaterial({
                color: 0xff8800,
                linewidth: 2 * window.devicePixelRatio,
              })
              const line = new Line2(geom, mat)
              line.name = 'trim-tool-preview'
              if (sketchSolveGroup) {
                sketchSolveGroup.add(line)
              } else {
                scene.add(line)
              }
              self.send({
                type: 'set trim line',
                line,
              })
            } else if (updatedContext.trimCurrentLine) {
              // Update existing line
              const positions: number[] = []
              for (const point of newPoints) {
                positions.push(point.x, point.y, point.z)
              }
              const oldGeom = updatedContext.trimCurrentLine.geometry
              const newGeom = new LineGeometry()
              newGeom.setPositions(positions)
              updatedContext.trimCurrentLine.geometry = newGeom
              oldGeom.dispose()
            }
          }
        },
        onAreaSelectEnd: async () => {
          // Get current state from snapshot
          const snapshot = self.getSnapshot()
          const currentContext = snapshot.context

          // If trim was cancelled or points were cleared, don't perform trim
          if (
            currentContext.trimIsCancelled ||
            currentContext.trimPoints.length === 0
          ) {
            // Clean up the preview line
            if (currentContext.trimCurrentLine) {
              const scene = currentContext.sceneInfra.scene
              const sketchSolveGroup = scene.getObjectByName(SKETCH_SOLVE_GROUP)
              if (
                sketchSolveGroup &&
                sketchSolveGroup.children.includes(
                  currentContext.trimCurrentLine
                )
              ) {
                sketchSolveGroup.remove(currentContext.trimCurrentLine)
              } else {
                scene.remove(currentContext.trimCurrentLine)
              }
              currentContext.trimCurrentLine.geometry.dispose()
              currentContext.trimCurrentLine.material.dispose()
            }
            self.send({
              type: 'clear trim state',
            })
            return
          }

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
          await onAreaSelectEndHandler(
            currentContext.trimPoints.map((p) => [p.x, p.y])
          )

          // Clean up the preview line
          if (currentContext.trimCurrentLine) {
            const scene = currentContext.sceneInfra.scene
            const sketchSolveGroup = scene.getObjectByName(SKETCH_SOLVE_GROUP)
            if (
              sketchSolveGroup &&
              sketchSolveGroup.children.includes(currentContext.trimCurrentLine)
            ) {
              sketchSolveGroup.remove(currentContext.trimCurrentLine)
            } else {
              scene.remove(currentContext.trimCurrentLine)
            }
            currentContext.trimCurrentLine.geometry.dispose()
            currentContext.trimCurrentLine.material.dispose()
          }

          // Clear state after trim completes
          self.send({
            type: 'clear trim state',
          })
        },
      })
    },
    'reset trim state': assign(({ event }) => {
      if (event.type !== 'reset trim state') return {}
      const [x, y] = event.startPoint
      return {
        trimPoints: [new Vector3(x, y, 0)],
        trimIsCancelled: false,
        trimLastPoint2D: [x, y],
        trimCurrentLine: null,
      }
    }),
    'add trim point': assign(({ event }) => {
      if (event.type !== 'add trim point') return {}
      const [x, y] = event.point
      return {
        trimPoints: event.points,
        trimLastPoint2D: [x, y],
      }
    }),
    'set trim line': assign(({ event }) => {
      if (event.type !== 'set trim line') return {}
      return {
        trimCurrentLine: event.line,
      }
    }),
    'clear trim state': assign(() => ({
      trimPoints: [],
      trimIsCancelled: false,
      trimLastPoint2D: null,
      trimCurrentLine: null,
    })),
    'remove area select listener': ({ context }) => {
      context.sceneInfra.setCallbacks({
        onAreaSelectStart: () => {},
        onAreaSelect: () => {},
        onAreaSelectEnd: () => {},
      })

      // Clean up any existing trim preview line when the tool is unequipped
      if (context.trimCurrentLine) {
        const scene = context.sceneInfra.scene
        const sketchSolveGroup = scene.getObjectByName(SKETCH_SOLVE_GROUP)
        if (
          sketchSolveGroup &&
          sketchSolveGroup.children.includes(context.trimCurrentLine)
        ) {
          sketchSolveGroup.remove(context.trimCurrentLine)
        } else {
          scene.remove(context.trimCurrentLine)
        }
        context.trimCurrentLine.geometry.dispose()
        context.trimCurrentLine.material.dispose()
      } else {
        // Fallback: manually find and remove the line
        const scene = context.sceneInfra.scene
        const sketchSolveGroup = scene.getObjectByName(SKETCH_SOLVE_GROUP)
        const groupToSearch =
          sketchSolveGroup instanceof Group ? sketchSolveGroup : scene

        const trimLine = groupToSearch.getObjectByName('trim-tool-preview')
        if (trimLine instanceof Line2) {
          if (
            sketchSolveGroup &&
            sketchSolveGroup.children.includes(trimLine)
          ) {
            sketchSolveGroup.remove(trimLine)
          } else if (scene.children.includes(trimLine)) {
            scene.remove(trimLine)
          } else if (trimLine.parent) {
            trimLine.parent.remove(trimLine)
          }
          trimLine.geometry.dispose()
          trimLine.material.dispose()
        }
      }
    },
  },
}).createMachine({
  context: ({ input }) => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId,
    sceneGraphDelta: input.sceneGraphDelta,
    trimPoints: [],
    trimIsCancelled: false,
    trimLastPoint2D: null,
    trimCurrentLine: null,
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
        'reset trim state': {
          actions: 'reset trim state',
        },
        'add trim point': {
          actions: 'add trim point',
        },
        'set trim line': {
          actions: 'set trim line',
        },
        'clear trim state': {
          actions: 'clear trim state',
        },
        escape: [
          {
            guard: 'has active trim line',
            actions: 'cancel trim line',
            description: 'ESC cancels the trim line if one is being drawn',
          },
          {
            target: '#Trim tool.unequipping',
            description: 'ESC unequips the tool if no trim line is active',
          },
        ],
      },
    },
    unequipping: {
      type: 'final',
      entry: 'remove area select listener',
    },
  },
})

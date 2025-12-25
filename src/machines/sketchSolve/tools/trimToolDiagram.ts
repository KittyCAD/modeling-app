import { setup } from 'xstate'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three'
import {
  createOnAreaSelectEndCallback,
  executeTrimStrategy,
} from '@src/machines/sketchSolve/tools/trimUtils'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'

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
        onAreaSelectEnd: async () => {
          const onAreaSelectEndHandler = createOnAreaSelectEndCallback({
            getContextData: () => {
              // CRITICAL FIX: Get current context at execution time, not the stale captured context
              // The 'context' variable in the closure is stale because it was captured when the
              // callback was set up. We need to get the current context from the machine snapshot.
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
            executeTrimStrategy: async ({
              strategy,
              rustContext,
              sketchId,
              objects,
            }) => {
              if (strategy instanceof Error) {
                return strategy
              }
              return executeTrimStrategy({
                strategy,
                rustContext,
                sketchId,
                objects,
              })
            },
            onNewSketchOutcome: (outcome) => {
              self._parent?.send({
                type: 'update sketch outcome',
                data: outcome,
              })
            },
            getJsAppSettings: async () => {
              return await jsAppSettings(context.rustContext.settingsActor)
            },
          })

          // Convert Vector3[] to Coords2d[] for the trim flow
          await onAreaSelectEndHandler(points.map((p) => [p.x, p.y]))

          // Clean up the preview line
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
    sketchId: input.sketchId,
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

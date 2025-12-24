import { setup } from 'xstate'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three'
import {
  executeTrimStrategy,
  getNextTrimCoords,
  getTrimSpawnTerminations,
  trimStrategy,
} from '@src/machines/sketchSolve/tools/trimUtils'
import type { Coords2d } from '@src/lang/util'
import { rustContext } from '@src/lib/singletons'

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
          try {
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

              if (parentSnapshot?.context?.sketchExecOutcome?.sceneGraphDelta) {
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

            if (!sceneGraphDelta) {
              console.error('[TRIM] ERROR: No sceneGraphDelta available!')
              return
            }

            // Convert Vector3[] to Coords2d[] for the new trim flow
            const trimPoints: Coords2d[] = points.map((p) => [p.x, p.y])

            let objects = sceneGraphDelta.new_graph.objects

            // New trim flow: getNextTrimCoords -> getTrimSpawnTerminations -> TrimStrategy
            let startIndex = 0
            let iterationCount = 0
            const maxIterations = 100

            while (
              startIndex < trimPoints.length - 1 &&
              iterationCount < maxIterations
            ) {
              iterationCount++

              const nextTrimResult = getNextTrimCoords({
                points: trimPoints,
                startIndex,
                objects,
              })

              if (nextTrimResult.type === 'noTrimSpawn') {
                const oldStartIndex = startIndex
                startIndex = nextTrimResult.nextIndex

                // Fail-safe: if nextIndex didn't advance, force it to advance
                if (startIndex <= oldStartIndex) {
                  startIndex = oldStartIndex + 1
                }
                continue
              }

              // Found a trim spawn, get terminations
              const terminations = getTrimSpawnTerminations({
                trimSpawnSegId: nextTrimResult.trimSpawnSegId,
                trimSpawnCoords: trimPoints,
                objects,
              })

              if (terminations instanceof Error) {
                console.error('Error getting trim terminations:', terminations)
                const oldStartIndex = startIndex
                startIndex = nextTrimResult.nextIndex

                // Fail-safe: if nextIndex didn't advance, force it to advance
                if (startIndex <= oldStartIndex) {
                  startIndex = oldStartIndex + 1
                }
                continue
              }

              // Get the trim spawn segment
              const trimSpawnSegment = objects[nextTrimResult.trimSpawnSegId]
              if (!trimSpawnSegment) {
                console.error(
                  'Trim spawn segment not found:',
                  nextTrimResult.trimSpawnSegId
                )
                const oldStartIndex = startIndex
                startIndex = nextTrimResult.nextIndex

                // Fail-safe: if nextIndex didn't advance, force it to advance
                if (startIndex <= oldStartIndex) {
                  startIndex = oldStartIndex + 1
                }
                continue
              }

              // Get trim strategy
              const strategy = trimStrategy({
                trimSpawnId: nextTrimResult.trimSpawnSegId,
                trimSpawnSegment,
                leftSide: terminations.leftSide,
                rightSide: terminations.rightSide,
                objects,
              })
              if (strategy instanceof Error) {
                console.error('Error determining trim strategy:', strategy)
                const oldStartIndex = startIndex
                startIndex = nextTrimResult.nextIndex

                // Fail-safe: if nextIndex didn't advance, force it to advance
                if (startIndex <= oldStartIndex) {
                  startIndex = oldStartIndex + 1
                }
                continue
              }
              const yo = await executeTrimStrategy({
                strategy,
                rustContext,
                sketchId: context.sketchId,
                objects,
              })

              if (yo instanceof Error) {
                console.error('[TRIM] Error executing trim strategy:', yo)
              } else {
                // CRITICAL FIX: Update objects array from result for subsequent operations
                // This ensures that if there are multiple trim operations in the same drag,
                // or if invalidates_ids is true, we use the fresh objects
                objects = yo.sceneGraphDelta.new_graph.objects

                // Send result to parent to update sketchExecOutcome for subsequent trims
                self._parent?.send({
                  type: 'update sketch outcome',
                  data: yo,
                })
              }

              // Log the trim strategy for sanity checking
              console.log('Trim Strategy:', strategy)

              // Move to next segment
              const oldStartIndex = startIndex
              startIndex = nextTrimResult.nextIndex

              // Fail-safe: if nextIndex didn't advance, force it to advance
              if (startIndex <= oldStartIndex) {
                startIndex = oldStartIndex + 1
              }
            }

            if (iterationCount >= maxIterations) {
              console.error(
                `ERROR: Reached max iterations (${maxIterations}). Breaking loop to prevent infinite loop.`
              )
            }
          } catch (error) {
            console.error('[TRIM] Exception in onAreaSelectEnd:', error)
            return
          }

          // TODO: Remove old processTrimOperations call once new flow is fully implemented
          // const result = await processTrimOperations({
          //   points,
          //   initialSceneGraph: context.sceneGraphDelta,
          //   rustContext: context.rustContext,
          //   sketchId: context.sketchId,
          // })

          // if (result) {
          //   // Send the final result to parent to update sketch outcome
          //   self._parent?.send({
          //     type: 'update sketch outcome',
          //     data: {
          //       kclSource: result.kclSource,
          //       sceneGraphDelta: result.sceneGraphDelta,
          //     },
          //   })
          // }

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

import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type RustContext from '@src/lib/rustContext'
import {
  isSketchSolveErrorOutput,
  toastSketchSolveError,
} from '@src/machines/sketchSolve/sketchSolveErrors'
import type {
  SketchSolveMachineEvent,
  ToolInput,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { AssignArgs, ProvidedActor } from 'xstate'
import { assertEvent, assign, createMachine, fromPromise, setup } from 'xstate'

import type { Coords2d } from '@src/lang/util'
import { isPointSegment } from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { SnapTarget } from '@src/machines/sketchSolve/snapping'
import {
  MIN_DRAFT_GEOMETRY_DELTA_MM,
  hasCrossedDraftGeometryThreshold,
} from '@src/machines/sketchSolve/tools/draftGeometryPolicy'
import type { RectDraftIds } from '@src/machines/sketchSolve/tools/rectUtils'
import {
  createDraftRectangle,
  getAngledRectangleWidth,
  getSeededAngledRectangleThirdPoint,
  updateDraftRectangleAligned,
  updateDraftRectangleAngled,
} from '@src/machines/sketchSolve/tools/rectUtils'
import {
  clearToolSnappingState,
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'

export const RECTANGLE_TOOL_ID = 'Rectangle tool'
export const ADDING_FIRST_POINT = `xstate.done.actor.0.${RECTANGLE_TOOL_ID}.adding first point`
export type RectOriginMode = 'corner' | 'center' | 'angled'
export type RectToolEvent =
  | BaseToolEvent
  | { type: 'finalize' }
  | {
      type: 'set second point'
      data: Coords2d
    }
  | {
      type: typeof ADDING_FIRST_POINT
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        draft: RectDraftIds
      }
    }

type RectToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  firstPointId?: number
  draft?: RectDraftIds
  origin: Coords2d
  originSnapTarget?: SnapTarget
  secondPoint?: Coords2d
  rectOriginMode: RectOriginMode
}

type RectToolAssignArgs<TActor extends ProvidedActor = any> = AssignArgs<
  RectToolContext,
  RectToolEvent,
  RectToolEvent,
  TActor
>

function getRectSnappingExcludedPointIds(
  currentSketchObjects: Array<ApiObject | undefined | null>,
  draft?: RectDraftIds
): number[] {
  if (!draft) {
    return []
  }

  return draft.segmentIds.filter((id) =>
    isPointSegment(currentSketchObjects[id])
  )
}

// Rectangle previews are seeded on the first click, then only replaced with
// user-driven geometry once the next anchor is far enough away to keep the
// solver out of a degenerate overlapping state. This matches the shared
// multi-click draft policy in draftGeometryPolicy.ts for future polygon-like tools.
function canPreviewAlignedRectangle(
  origin: Coords2d,
  point: Coords2d
): boolean {
  return hasCrossedDraftGeometryThreshold(origin, point)
}

function canCommitAlignedRectangle(
  mode: RectOriginMode,
  origin: Coords2d,
  point: Coords2d
): boolean {
  const width = Math.abs(point[0] - origin[0]) * (mode === 'center' ? 2 : 1)
  const height = Math.abs(point[1] - origin[1]) * (mode === 'center' ? 2 : 1)
  return (
    width >= MIN_DRAFT_GEOMETRY_DELTA_MM &&
    height >= MIN_DRAFT_GEOMETRY_DELTA_MM
  )
}

function canPreviewAngledRectangleSecondPoint(
  origin: Coords2d,
  point: Coords2d
): boolean {
  return hasCrossedDraftGeometryThreshold(origin, point)
}

function canPreviewAngledRectangleThirdPoint(
  origin: Coords2d,
  secondPoint: Coords2d,
  thirdPoint: Coords2d
): boolean {
  return (
    Math.abs(
      getAngledRectangleWidth({
        p1: origin,
        p2: secondPoint,
        p3: thirdPoint,
      })
    ) >= MIN_DRAFT_GEOMETRY_DELTA_MM
  )
}

export const machine = setup({
  types: {
    context: {} as RectToolContext,
    events: {} as RectToolEvent,
    input: {} as ToolInput,
  },
  guards: {
    'invoke output has error': ({ event }) =>
      'output' in event && isSketchSolveErrorOutput(event.output),
  },
  actions: {
    'add first point listener': ({ self, context }) => {
      context.sceneInfra.setCallbacks({
        onMove: (args) => {
          const twoD = args?.intersectionPoint?.twoD
          if (!twoD) {
            clearToolSnappingState({
              self,
              sceneInfra: context.sceneInfra,
            })
            return
          }

          const snappingCandidate = getBestSnappingCandidate({
            self,
            sceneInfra: context.sceneInfra,
            sketchId: context.sketchId,
            mousePosition: [twoD.x, twoD.y],
            mouseEvent: args.mouseEvent,
          })
          sendHoveredSnappingCandidate(self, snappingCandidate)
          updateToolSnappingPreview({
            sceneInfra: context.sceneInfra,
            target: snappingCandidate,
          })
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (!twoD) return
          const mousePosition: Coords2d = [twoD.x, twoD.y]
          const snappingCandidate = getBestSnappingCandidate({
            self,
            sceneInfra: context.sceneInfra,
            sketchId: context.sketchId,
            mousePosition,
            mouseEvent: args.mouseEvent,
          })
          const [x, y] = snappingCandidate?.position ?? mousePosition
          self.send({
            type: 'add point',
            data: [x, y],
            snapTarget: snappingCandidate?.target,
          })
        },
      })
    },
    'add second point listener': ({ self, context }) => {
      let isEditInProgress = false
      context.sceneInfra.setCallbacks({
        onMove: async (args) => {
          if (!args || !context.draft) return
          const twoD = args.intersectionPoint?.twoD
          if (!twoD) {
            clearToolSnappingState({
              self,
              sceneInfra: context.sceneInfra,
            })
            return
          }

          const snappingCandidate = getBestSnappingCandidate({
            self,
            sceneInfra: context.sceneInfra,
            sketchId: context.sketchId,
            mousePosition: [twoD.x, twoD.y],
            mouseEvent: args.mouseEvent,
            getExcludedPointIds: (currentSketchObjects) =>
              getRectSnappingExcludedPointIds(
                currentSketchObjects,
                context.draft
              ),
          })
          sendHoveredSnappingCandidate(self, snappingCandidate)
          updateToolSnappingPreview({
            sceneInfra: context.sceneInfra,
            target: snappingCandidate,
          })
          const candidatePoint = snappingCandidate?.position ?? [twoD.x, twoD.y]

          if (!isEditInProgress) {
            try {
              let result: {
                kclSource: SourceDelta
                sceneGraphDelta: SceneGraphDelta
              } | null = null
              let suppressExecOutcomeIssues = false

              if (context.rectOriginMode === 'angled') {
                if (
                  canPreviewAngledRectangleSecondPoint(
                    context.origin,
                    candidatePoint
                  )
                ) {
                  isEditInProgress = true
                  result = await updateDraftRectangleAngled({
                    rustContext: context.rustContext,
                    kclManager: context.kclManager,
                    sketchId: context.sketchId,
                    draft: context.draft,
                    p1: context.origin,
                    p2: candidatePoint,
                    // Keep a tiny non-zero width until the third click exists so
                    // the preview remains non-degenerate during the second-point drag.
                    p3: getSeededAngledRectangleThirdPoint(
                      context.origin,
                      candidatePoint
                    ),
                  })
                }
              } else {
                const start = context.origin
                const end = candidatePoint

                if (canPreviewAlignedRectangle(start, end)) {
                  suppressExecOutcomeIssues = !canCommitAlignedRectangle(
                    context.rectOriginMode,
                    start,
                    end
                  )
                  isEditInProgress = true
                  const min: Coords2d = [
                    Math.min(start[0], end[0]),
                    Math.min(start[1], end[1]),
                  ]
                  const max: Coords2d = [
                    Math.max(start[0], end[0]),
                    Math.max(start[1], end[1]),
                  ]

                  if (context.rectOriginMode === 'center') {
                    const size = [max[0] - min[0], max[1] - min[1]]
                    min[0] = start[0] - size[0]
                    min[1] = start[1] - size[1]
                    max[0] = min[0] + size[0] * 2
                    max[1] = min[1] + size[1] * 2
                  }

                  result = await updateDraftRectangleAligned({
                    rustContext: context.rustContext,
                    kclManager: context.kclManager,
                    sketchId: context.sketchId,
                    draft: context.draft,
                    rect: { min, max },
                  })
                }
              }

              if (!result) {
                return
              }

              const sendData: SketchSolveMachineEvent = {
                type: 'update sketch outcome',
                data: {
                  sourceDelta: result.kclSource,
                  sceneGraphDelta: result.sceneGraphDelta,
                  suppressExecOutcomeIssues,
                  writeToDisk: false,
                },
              }
              self._parent?.send(sendData)
              await new Promise((resolve) => requestAnimationFrame(resolve))
            } catch (err) {
              console.error('failed to edit segment', err)
              toastSketchSolveError(err)
            } finally {
              isEditInProgress = false
            }
          }
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (!twoD) return
          const mousePosition: Coords2d = [twoD.x, twoD.y]
          const snappingCandidate = getBestSnappingCandidate({
            self,
            sceneInfra: context.sceneInfra,
            sketchId: context.sketchId,
            mousePosition,
            mouseEvent: args.mouseEvent,
            getExcludedPointIds: (currentSketchObjects) =>
              getRectSnappingExcludedPointIds(
                currentSketchObjects,
                context.draft
              ),
          })
          const [x, y] = snappingCandidate?.position ?? mousePosition
          const nextPoint: Coords2d = [x, y]

          if (context.rectOriginMode === 'angled') {
            if (
              !canPreviewAngledRectangleSecondPoint(context.origin, nextPoint)
            ) {
              return
            }
            self.send({
              type: 'set second point',
              data: nextPoint,
            })
          } else {
            if (
              !canCommitAlignedRectangle(
                context.rectOriginMode,
                context.origin,
                nextPoint
              )
            ) {
              return
            }
            self.send({
              type: 'finalize',
            })
          }
        },
      })
    },
    'add third point listener': ({ self, context }) => {
      let isEditInProgress = false
      context.sceneInfra.setCallbacks({
        onMove: async (args) => {
          if (!args || !context.draft || !context.secondPoint) return
          const twoD = args.intersectionPoint?.twoD
          if (!twoD) {
            clearToolSnappingState({
              self,
              sceneInfra: context.sceneInfra,
            })
            return
          }

          const snappingCandidate = getBestSnappingCandidate({
            self,
            sceneInfra: context.sceneInfra,
            sketchId: context.sketchId,
            mousePosition: [twoD.x, twoD.y],
            mouseEvent: args.mouseEvent,
            getExcludedPointIds: (currentSketchObjects) =>
              getRectSnappingExcludedPointIds(
                currentSketchObjects,
                context.draft
              ),
          })
          sendHoveredSnappingCandidate(self, snappingCandidate)
          updateToolSnappingPreview({
            sceneInfra: context.sceneInfra,
            target: snappingCandidate,
          })
          const candidatePoint = snappingCandidate?.position ?? [twoD.x, twoD.y]

          if (!isEditInProgress) {
            try {
              if (
                !canPreviewAngledRectangleThirdPoint(
                  context.origin,
                  context.secondPoint,
                  candidatePoint
                )
              ) {
                return
              }

              isEditInProgress = true
              const result = await updateDraftRectangleAngled({
                rustContext: context.rustContext,
                kclManager: context.kclManager,
                sketchId: context.sketchId,
                draft: context.draft,
                p1: context.origin,
                p2: context.secondPoint,
                p3: candidatePoint,
              })

              const sendData: SketchSolveMachineEvent = {
                type: 'update sketch outcome',
                data: {
                  sourceDelta: result.kclSource,
                  sceneGraphDelta: result.sceneGraphDelta,
                  writeToDisk: false,
                },
              }
              self._parent?.send(sendData)
              await new Promise((resolve) => requestAnimationFrame(resolve))
            } catch (err) {
              console.error('failed to edit segment', err)
              toastSketchSolveError(err)
            } finally {
              isEditInProgress = false
            }
          }
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (!twoD) return
          const mousePosition: Coords2d = [twoD.x, twoD.y]
          const snappingCandidate = getBestSnappingCandidate({
            self,
            sceneInfra: context.sceneInfra,
            sketchId: context.sketchId,
            mousePosition,
            mouseEvent: args.mouseEvent,
            getExcludedPointIds: (currentSketchObjects) =>
              getRectSnappingExcludedPointIds(
                currentSketchObjects,
                context.draft
              ),
          })
          const [x, y] = snappingCandidate?.position ?? mousePosition
          const nextPoint: Coords2d = [x, y]
          if (
            context.secondPoint &&
            !canPreviewAngledRectangleThirdPoint(
              context.origin,
              context.secondPoint,
              nextPoint
            )
          ) {
            return
          }
          self.send({
            type: 'finalize',
          })
        },
      })
    },
    'send result to parent': assign(({ event, self }: RectToolAssignArgs) => {
      if (event.type !== ADDING_FIRST_POINT) {
        return {}
      }

      const output = event.output

      const sendData: SketchSolveMachineEvent = {
        type: 'set draft entities',
        data: {
          segmentIds: output.draft.segmentIds,
          constraintIds: output.draft.constraintIds,
        },
      }
      self._parent?.send(sendData)

      return {
        draft: output.draft,
      }
    }),
    'delete draft entities': ({ self }) => {
      const sendData: SketchSolveMachineEvent = {
        type: 'delete draft entities',
      }
      self._parent?.send(sendData)
    },
    'remove point listener': ({ context, self }) => {
      clearToolSnappingState({
        self,
        sceneInfra: context.sceneInfra,
      })
      context.sceneInfra.setCallbacks({
        onClick: () => {},
        onMove: () => {},
      })
    },
    'toast sketch solve error': ({ event }) => {
      toastSketchSolveError(event)
    },
    'persist current sketch outcome': ({ self }) => {
      const sketchExecOutcome =
        self._parent?.getSnapshot()?.context?.sketchExecOutcome
      if (!sketchExecOutcome) {
        return
      }

      self._parent?.send({
        type: 'update sketch outcome',
        data: {
          sourceDelta: sketchExecOutcome.sourceDelta,
          sceneGraphDelta: sketchExecOutcome.sceneGraphDelta,
        },
      })
    },
  },
  actors: {
    modAndSolveFirstClick: fromPromise(
      async ({
        input,
      }: {
        input: {
          pointData: [number, number]
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
          origin: [number, number]
          snapTarget?: SnapTarget
          rectOriginMode: RectOriginMode
        }
      }) => {
        const {
          rustContext,
          kclManager,
          sketchId,
          rectOriginMode,
          snapTarget,
        } = input

        try {
          const result = await createDraftRectangle({
            rustContext,
            kclManager,
            sketchId,
            mode: rectOriginMode,
            origin: input.origin,
            snapTarget,
          })

          return result
        } catch (error) {
          console.error('Failed to add point segment:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
    askUserForDimensionValues: createMachine({
      /* ... */
    }),
  },
}).createMachine({
  context: ({ input }) => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId,
    origin: [0, 0],
    originSnapTarget: undefined,
    rectOriginMode: (input.toolVariant ?? 'corner') as RectOriginMode,
  }),
  id: RECTANGLE_TOOL_ID,
  initial: 'awaiting first point',
  on: {
    unequip: {
      target: `#${RECTANGLE_TOOL_ID}.unequipping`,
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
    escape: {
      target: `#${RECTANGLE_TOOL_ID}.unequipping`,
      description: 'ESC unequips the tool',
    },
  },
  description:
    'Creates a rectangle from user clicks: corner/center use two points, angled uses three points.',
  states: {
    'awaiting first point': {
      entry: 'add first point listener',
      on: {
        'add point': {
          actions: assign(({ event }) => {
            return {
              origin: event.data,
              originSnapTarget: event.snapTarget,
            }
          }),
          target: 'adding first point',
        },
      },
    },
    'adding first point': {
      invoke: {
        src: 'modAndSolveFirstClick',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            pointData: event.data,
            origin: context.origin,
            snapTarget: context.originSnapTarget,
            rectOriginMode: context.rectOriginMode,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: [
          {
            guard: 'invoke output has error',
            target: 'awaiting first point',
            actions: 'toast sketch solve error',
          },
          {
            actions: 'send result to parent',
            target: 'awaiting second point',
          },
        ],
        onError: {
          target: 'awaiting first point',
          actions: 'toast sketch solve error',
        },
      },
    },
    'awaiting second point': {
      on: {
        // 'add point': {
        //   target: 'Confirming dimensions',
        // },
        finalize: {
          actions: [
            'persist current sketch outcome',
            ({ self }) => {
              const sendData: SketchSolveMachineEvent = {
                type: 'clear draft entities',
              }
              self._parent?.send(sendData)
            },
            assign({
              origin: [0, 0],
              originSnapTarget: undefined,
              secondPoint: undefined,
              draft: undefined,
            }),
          ],
          target: 'awaiting first point',
        },
        'set second point': {
          guard: ({ context, event }) => {
            if (context.rectOriginMode !== 'angled') return false
            if (event.type !== 'set second point') return false
            return canPreviewAngledRectangleSecondPoint(
              context.origin,
              event.data
            )
          },
          actions: assign(({ event }) => {
            if (event.type !== 'set second point') return {}
            return {
              secondPoint: event.data,
            }
          }),
          target: 'awaiting third point',
        },
        escape: {
          target: 'delete draft entities',
        },
      },
      entry: 'add second point listener',
      exit: 'remove point listener',
    },
    'awaiting third point': {
      on: {
        finalize: {
          actions: [
            'persist current sketch outcome',
            ({ self }) => {
              const sendData: SketchSolveMachineEvent = {
                type: 'clear draft entities',
              }
              self._parent?.send(sendData)
            },
            assign({
              origin: [0, 0],
              originSnapTarget: undefined,
              secondPoint: undefined,
              draft: undefined,
            }),
          ],
          target: 'awaiting first point',
        },
        escape: {
          target: 'delete draft entities',
        },
      },
      entry: 'add third point listener',
      exit: 'remove point listener',
    },
    'delete draft entities': {
      entry: ({ self }) => {
        const sendData: SketchSolveMachineEvent = {
          type: 'delete draft entities',
        }
        self._parent?.send(sendData)
      },
      always: {
        target: 'awaiting first point',
        actions: assign({
          origin: [0, 0],
          originSnapTarget: undefined,
          secondPoint: undefined,
          draft: undefined,
        }),
      },
    },
    // 'Confirming dimensions': {
    //   invoke: {
    //     input: {},
    //     onDone: {
    //       target: 'unequipping',
    //     },
    //     onError: {
    //       target: 'unequipping',
    //     },
    //     src: 'askUserForDimensionValues',
    //   },
    //   description:
    //     'Show the user form fields for the width and height of the rectangle, allowing them to input values directly. This will add dimension-type constraints for either of the fields that are filled out.',
    // },
    unequipping: {
      type: 'final',
      entry: 'remove point listener',
      description: 'Any teardown logic should go here.',
    },
  },
})

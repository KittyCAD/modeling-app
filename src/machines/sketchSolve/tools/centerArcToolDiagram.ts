import { assertEvent, assign, fromPromise, setup } from 'xstate'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclManager } from '@src/lang/KclManager'
import {
  type ToolEvents,
  type ToolContext,
  type TOOL_ID,
  type SHOWING_RADIUS_PREVIEW,
  type ANIMATING_ARC,
  showRadiusPreviewListener,
  animateArcEndPointListener,
  addPointListener,
  removePointListener,
  sendResultToParent,
  createArcActor,
  finalizeArcActor,
  storeCreatedArcResult,
} from '@src/machines/sketchSolve/tools/centerArcToolImpl'

// This might seem a bit redundant, but this xstate visualizer stops working
// when I use TOOL_ID and constants directly when they're imported.
export const toolId: typeof TOOL_ID = 'Center arc tool'
export const showingRadiusPreview: typeof SHOWING_RADIUS_PREVIEW =
  'Showing radius preview'
export const animatingArc: typeof ANIMATING_ARC = 'Animating arc'

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
    },
  },
  actions: {
    'show radius preview listener': showRadiusPreviewListener,
    'animate arc end point listener': animateArcEndPointListener,
    'add point listener': addPointListener,
    'remove point listener': removePointListener,
    'send result to parent': assign(sendResultToParent),
    'store created arc result': assign(storeCreatedArcResult),
  },
  actors: {
    createArc: fromPromise(createArcActor),
    finalizeArc: fromPromise(finalizeArcActor),
  },
}).createMachine({
  context: ({ input }): ToolContext => ({
    centerPointId: undefined,
    centerPoint: undefined,
    arcId: undefined,
    arcEndPointId: undefined,
    arcStartPoint: undefined,
    arcCcw: undefined,
    sceneGraphDelta: {} as SceneGraphDelta,
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId || 0,
  }),
  id: toolId,
  initial: 'ready for center click',
  on: {
    unequip: {
      target: `#Center arc tool.unequipping`,
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
  },
  description: 'Creates an arc by center and two endpoints',
  states: {
    'ready for center click': {
      entry: 'add point listener',
      on: {
        'add point': {
          target: showingRadiusPreview,
          guard: ({ event }) => {
            if (event.type !== 'add point') return false
            return 'clickNumber' in event
              ? event.clickNumber === 1 || !event.clickNumber
              : true
          },
          actions: assign(({ event }) => {
            assertEvent(event, 'add point')
            // Just store the center point coordinate, don't create a point segment
            return {
              centerPoint: event.data,
            }
          }),
        },
        escape: {
          target: 'unequipping',
          description: 'ESC in ready state unequips the tool',
        },
      },
    },

    [showingRadiusPreview]: {
      entry: 'show radius preview listener',
      exit: 'remove point listener',
      on: {
        'add point': {
          target: 'Creating arc',
          guard: ({ event }) => {
            if (event.type !== 'add point') return false
            return 'clickNumber' in event ? event.clickNumber === 2 : false
          },
        },
        escape: {
          target: 'unequipping',
          // No draft entities to clean up yet (only center point stored, no segments created)
        },
      },
    },

    'Creating arc': {
      invoke: {
        src: 'createArc',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          if (!context.centerPoint) {
            return {
              error: 'Center point not set',
            }
          }
          return {
            centerPoint: context.centerPoint,
            startPoint: event.data,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: animatingArc,
          actions: ['send result to parent', 'store created arc result'],
        },
        onError: showingRadiusPreview,
      },
    },

    [animatingArc]: {
      entry: 'animate arc end point listener',
      exit: 'remove point listener',
      on: {
        'update arc ccw': {
          actions: assign(({ event }) => {
            if (event.type !== 'update arc ccw') return {}
            return {
              arcCcw: event.data,
            }
          }),
        },
        'add point': {
          target: 'Finalizing arc',
          guard: ({ event }) => {
            if (event.type !== 'add point') return false
            return 'clickNumber' in event ? event.clickNumber === 3 : false
          },
        },
        escape: {
          target: 'unequipping',
          actions: ({ self }) => {
            // Delete draft entities when escaping during animation
            self._parent?.send({ type: 'delete draft entities' })
          },
        },
        unequip: {
          target: 'unequipping',
          actions: ({ self }) => {
            // Delete draft entities when unequipping during animation
            self._parent?.send({ type: 'delete draft entities' })
          },
        },
      },
    },

    'Finalizing arc': {
      invoke: {
        src: 'finalizeArc',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          if (
            !context.arcId ||
            !context.centerPoint ||
            !context.sceneGraphDelta
          ) {
            return {
              error: 'Arc ID, center point, or scene graph not set',
            }
          }
          return {
            arcId: context.arcId,
            centerPoint: context.centerPoint,
            endPoint: event.data,
            sceneGraphDelta: context.sceneGraphDelta,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
            arcCcw: context.arcCcw,
          }
        },
        onDone: {
          target: 'ready for center click',
          actions: [
            'send result to parent',
            ({ self }) => {
              // Clear draft entities after finalization (arc is now committed)
              self._parent?.send({ type: 'clear draft entities' })
            },
            assign({
              // Clear context values for the next arc
              centerPoint: undefined,
              centerPointId: undefined,
              arcId: undefined,
              arcEndPointId: undefined,
              arcStartPoint: undefined,
              arcCcw: undefined,
            }),
          ],
        },
        onError: animatingArc,
      },
    },

    unequipping: {
      type: 'final',
      entry: [
        'remove point listener',
        ({ self }) => {
          // Clear draft entities when unequipping normally
          self._parent?.send({ type: 'clear draft entities' })
        },
      ],
      description: 'Any teardown logic should go here.',
    },
  },
})

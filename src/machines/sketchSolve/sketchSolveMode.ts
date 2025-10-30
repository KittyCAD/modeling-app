import {
  assertEvent,
  assign,
  createMachine,
  sendParent,
  sendTo,
  setup,
} from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { SetSelections } from '@src/machines/modelingSharedTypes'
import { machine as centerRectTool } from '@src/machines/sketchSolve/tools/centerRectTool'
import { machine as dimensionTool } from '@src/machines/sketchSolve/tools/dimensionTool'
import { machine as pointTool } from '@src/machines/sketchSolve/tools/pointTool'
import type {
  SceneGraphDelta,
  SketchExecOutcome,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { codeManager, rustContext, sceneInfra } from '@src/lib/singletons'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import { OrthographicCamera } from 'three'
import { orthoScale, perspScale } from '@src/clientSideScene/helpers'
import { getParentGroup } from '@src/clientSideScene/sceneConstants'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'

let selectedIds: Array<number> = []

const equipTools = Object.freeze({
  centerRectTool,
  dimensionTool,
  pointTool,
})

const CHILD_TOOL_ID = 'child tool'
const CHILD_TOOL_DONE_EVENT = `xstate.done.actor.${CHILD_TOOL_ID}`

export type EquipTool = keyof typeof equipTools

// Type for the spawn function used in XState setup actions
// This provides better type safety by constraining the actor parameter to valid tool names
// and ensuring the return type matches the specific tool actor
type SpawnToolActor = <K extends EquipTool>(
  src: K,
  options?: { id?: string }
) => ActorRefFrom<(typeof equipTools)[K]>

export type SketchSolveMachineEvent =
  | { type: 'exit' }
  | { type: 'update selection'; data?: SetSelections }
  | { type: 'unequip tool' }
  | { type: 'equip tool'; data: { tool: EquipTool } }
  | { type: 'coincident' }
  | { type: typeof CHILD_TOOL_DONE_EVENT }
  | {
      type: 'update sketch outcome'
      data: {
        kclSource: SourceDelta
        sketchExecOutcome: SketchExecOutcome
        sceneGraphDelta: SceneGraphDelta
      }
    }

type SketchSolveContext = {
  sketchSolveToolName: EquipTool | null
  pendingToolName?: EquipTool
  sketchExecOutcome?: {
    kclSource: SourceDelta
    sketchExecOutcome: SketchExecOutcome
  }
}

export const sketchSolveMachine = setup({
  types: {
    context: {} as SketchSolveContext,
    events: {} as SketchSolveMachineEvent,
  },
  actions: {
    callbacks: ({ self }) => {
      // set up onDrag listener
      let doingStuff = false
      sceneInfra.setCallbacks({
        onDrag: async (hey) => {
          if (doingStuff) {
            return
          }
          console.log('dragging in sketch mode', hey)
          const group = getParentGroup(hey.selected, ['point'])
          console.log('group?', group)
          doingStuff = true
          const result = await rustContext
            .editSegment(
              0,
              0,
              Number(group?.name) || 0,
              {
                type: 'Point',
                position: {
                  x: {
                    type: 'Number',
                    value: roundOff(hey.intersectionPoint.twoD.x),
                    units: 'Mm',
                  },
                  y: {
                    type: 'Number',
                    value: roundOff(hey.intersectionPoint.twoD.y),
                    units: 'Mm',
                  },
                },
              },
              await jsAppSettings()
            )
            .catch((err) => {
              console.error('failed to edit segment', err)
            })
          doingStuff = false
          console.log('edited segment successfully', result)
          // send event
          if (result) {
            self.send({
              type: 'update sketch outcome',
              data: result,
            })
          }
        },
        onClick: async (hey) => {
          console.log('clicking in sketch mode', hey)
          const group = getParentGroup(hey.selected, ['point'])
          if (group) {
            selectedIds.push(Number(group?.name))
            selectedIds = Array.from(new Set(selectedIds))
          } else {
            selectedIds = []
          }
          console.log('pushing', selectedIds)
        },
      })
    },
    'send unequip to tool': sendTo(CHILD_TOOL_ID, { type: 'unequip' }),
    'send update selection to equipped tool': sendTo(CHILD_TOOL_ID, {
      type: 'update selection',
    }),
    'send updated selection to move tool': sendTo('moveTool', {
      type: 'update selection',
    }),
    'store pending tool': assign(({ event }) => {
      assertEvent(event, 'equip tool')
      return { pendingToolName: event.data.tool }
    }),
    'send tool equipped to parent': sendParent(({ context }) => ({
      type: 'sketch solve tool changed',
      data: { tool: context.sketchSolveToolName },
    })),
    'send tool unequipped to parent': sendParent({
      type: 'sketch solve tool changed',
      data: { tool: null },
    }),
    'update sketch outcome': assign(({ event }) => {
      assertEvent(event, 'update sketch outcome')
      codeManager.updateCodeEditor(event.data.kclSource.text)
      console.log('sketch outcome updated:', event.data)
      const sceneGraphDelta = event.data.sceneGraphDelta
      const orthoFactor = orthoScale(sceneInfra.camControls.camera)
      const factor =
        sceneInfra.camControls.camera instanceof OrthographicCamera
          ? orthoFactor
          : orthoFactor
      sceneInfra.baseUnitMultiplier
      sceneGraphDelta.new_objects.forEach((objId) => {
        const obj = sceneGraphDelta.new_graph.objects[objId] as any
        if (obj?.kind.type === 'Point') {
          // console.log('hmm what?', obj)
          ;(async () => {
            console.log('yo made it here')
            segmentUtilsMap.PointSegment.init({
              input: {
                type: 'point',
                position: [
                  obj.kind.position.x.value,
                  obj.kind.position.y.value,
                ],
                freedom: obj.kind.freedom,
              },
              theme: sceneInfra.theme,
              scale: factor,
              id: objId,
            })
              .then((group) => {
                console.log('adding to scene', group)
                sceneInfra.scene.add(group)
              })
              .catch(() => {
                console.error('Failed to init PointSegment for object', objId)
              })
          })().catch(() => {
            console.error('Failed to init PointSegment for object', objId)
          })
        }
      })
      sceneGraphDelta.new_graph.objects.forEach((obj) => {
        const objj = obj as any
        if (sceneGraphDelta.new_objects.includes(objj.id)) {
          return
        }
        if (objj.kind.type === 'Point') {
          const group = sceneInfra.scene.getObjectByName(String(objj.id))
          console.log('updating point segment', objj, group)
          if (!group) {
            console.error(
              'No group found in scene for PointSegment with id',
              objj.id
            )
            return
          }
          segmentUtilsMap.PointSegment.update({
            input: {
              type: 'point',
              position: [
                objj.kind.position.x.value,
                objj.kind.position.y.value,
              ],
              freedom: objj.kind.freedom,
            },
            theme: sceneInfra.theme,
            scale: factor,
            id: objj.id,
            group,
          })
            ?.then(() => {
              console.log('updated point segment', objj.id)
            })
            .catch(() => {
              console.error('Failed to update PointSegment for object', objj.id)
            })
        }
      })
      return { sketchExecOutcome: event.data }
    }),
    'spawn tool': assign(({ event, spawn, context }) => {
      // Determine which tool to spawn based on event type
      let nameOfToolToSpawn: EquipTool

      if (event.type === 'equip tool') {
        nameOfToolToSpawn = event.data.tool
      } else if (
        event.type === CHILD_TOOL_DONE_EVENT &&
        context.pendingToolName
      ) {
        nameOfToolToSpawn = context.pendingToolName
      } else {
        console.error('Cannot determine tool to spawn')
        return {}
      }
      // this type-annotation informs spawn tool of the association between the EquipTools type and the machines in equipTools
      // It's not an type assertion. TS still checks that _spawn is assignable to SpawnToolActor.
      const typedSpawn: SpawnToolActor = spawn
      typedSpawn(nameOfToolToSpawn, { id: CHILD_TOOL_ID })

      return {
        sketchSolveToolName: nameOfToolToSpawn,
        pendingToolName: undefined, // Clear the pending tool after spawning
      }
    }),
  },
  actors: {
    moveToolActor: createMachine({
      /* ... */
    }),
    ...equipTools,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAIwB2ABwBWAHTyAbAGZFAFiXyOAJg0BOADQgAnolkrpHQwe1rFz59I0BfD+bSZcBEnIqGnoAVz4IAEMMClgwYjAsDBFRTh4kEAEhZLEJKQRZY1lVWWk1YzV5A3ltDg1tcysEAFoDI2UDWQ4lNWk5A0Uqz28QX2x8IjIKalo6cKiYvFh0cbxCUOxCAFswNIks4VyM-OkBg2VjU40a6-ljF0VGxFbpY2Uug0ubTp07rx8Vv5JkEZmFRGAAI6hZh8PAYQgkPYZA45cTHRDaRQqGoDWROeocWRqBqWZ5GaTKDS9eQ2eTyaSDUraf6jQETQLTELKLaEIKRUQQJbxRIYOgQMRgZTMUSkQjobm8sAAFQRxCR-EEhzRoBOnwpGipPw42jkZlJBTUykGBjUxMG3Q0xpZYyBHOCtAVfIFQoSSQYACd-YR-co+MRogAzYNbT3K1XqzKa1F5GSfc72KrU2R47QDJ4IU7aVQ2+nlS4uDinZ1sgJTd2SnlewVxX2iyHQ2HwxHcfZJlIpgt2ZSE+7GeQaapFLHyfMGdyqQbGOqVNqKG3Vvzsuug5ShISiKBw1VzcFQmFH7vpDXZfvogvG+SUsp49RdA3E-NaItY4y-3Mm20nRGF0txBLk92lQ8u2IBgz07eMe2RPsjh1RAigpT46m0XQTFkG01HzbQFHeLFZA0BQ6kUeppA3VZgU5D1YAAd1YXBIIvGDGFgDBoklcVwWUSIkmDZQExRW9UIQIpzjuCp9ExJdygI81iUfBk8InKi1AUOdaNdbdwNPDs+HY6C6C4niYmUfjJSE+EQzE5DtUkGRjWKNpjGua5pHzV4KW0-QJzURwqiKLwRlEEJ4AyEDazA2hexvFCXIQYLh0KRQxwnO4bEGfNmkyylf2zPFjDabzsL00CGIbRU8H5ZthSSRKtQHcj3LKvCGTUBw83NOxzh0pdyo4RRCSquKat3fcoNVFrkzvEwVGqcl1GqHRHnNR1HzXIkDSxTFFAm+j62UZjWJwUy5qQpLnPyT5vzK21LgNExpBnFTOmUbCaXqeoDEJYLjrdHcmGEA95oklLpF0S0iO07QTGMJxylkfNf2LSo3J-f95GBgyPVCIyYRMg8OMh5LdXI5RXl6SpMp6sp8wO945EUBlFEKKp2fCjwgA */
  context: (): SketchSolveContext => ({
    sketchSolveToolName: null,
  }),

  id: 'Sketch Solve Mode',
  initial: 'move and select',

  on: {
    exit: {
      target: '#Sketch Solve Mode.exiting',
      actions: ['send unequip to tool', 'send tool unequipped to parent'],
      description:
        'the outside world can request that sketch mode exit, but it needs to handle its own teardown first.',
    },
    'update selection': {
      actions: [
        'send update selection to equipped tool',
        'send updated selection to move tool',
      ],
      description:
        'sketch mode consumes the current selection from its source of truth (currently modelingMachine). Whenever it receives',
    },
    'update sketch outcome': {
      actions: 'update sketch outcome',
      description:
        'Updates the sketch execution outcome in the context when tools complete operations',
    },
    'unequip tool': {
      actions: 'send unequip to tool',
    },
    coincident: {
      actions: async ({ self }) => {
        console.log('coincident called - implement me!')
        const result = await rustContext.addConstraint(
          0,
          0,
          {
            type: 'Coincident',
            points: selectedIds,
          },
          await jsAppSettings()
        )
        console.log('added coincident constraint:', result)
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
  },

  states: {
    'move and select': {
      entry: [() => console.log('entered sketch mode'), 'callbacks'],
      on: {
        'equip tool': {
          target: 'using tool',
          actions: 'store pending tool',
        },
      },
      invoke: {
        id: 'moveTool',
        input: {},
        onDone: {
          target: 'exiting',
        },
        onError: {
          target: 'exiting',
        },
        src: 'moveToolActor',
      },
      description:
        'The base state of sketch mode is to all the user to move around the scene and select geometry.',
    },

    'using tool': {
      on: {
        'unequip tool': {
          target: 'unequipping tool',
          actions: ['send unequip to tool'],
          reenter: true,
        },

        'equip tool': {
          target: 'switching tool',
          actions: ['send unequip to tool', 'store pending tool'],
        },
      },

      description:
        'Tools are workflows that create or modify geometry in the sketch scene after conditions are met. Some, like the Dimension, Center Rectangle, and Tangent tools, are finite, which they signal by reaching a final state. Some, like the Spline tool, appear to be infinite. In these cases, it is up to the tool Actor to receive whatever signal (such as the Esc key for Spline) necessary to reach a final state and unequip itself.\n\nTools can request to be unequipped from the outside by a "unequip tool" event sent to the sketch machine. This will sendTo the toolInvoker actor.',

      entry: ['spawn tool', 'send tool equipped to parent'],
    },

    'switching tool': {
      on: {
        [CHILD_TOOL_DONE_EVENT]: {
          target: 'using tool',
          actions: [
            () => console.log('switched tools with xstate.done.actor.tool'),
          ],
        },
      },

      description:
        'Intermediate state while the current tool is cleaning up before spawning a new tool.',

      exit: [() => console.log('exiting switching tool')],
    },

    exiting: {
      type: 'final',
      description: 'Place any teardown code here.',
    },

    'unequipping tool': {
      on: {
        [CHILD_TOOL_DONE_EVENT]: {
          target: 'move and select',
          actions: ['send tool unequipped to parent'],
        },
      },

      description: `Intermediate state, same as the "switching tool" state, but for unequip`,
    },
  },

  entry: 'callbacks',
})

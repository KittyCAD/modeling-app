import { PathToNode } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { DefaultPlanes } from 'lang/std/engineConnectionManagerUtils'
import { isReducedMotion } from 'lang/util'
import { Axis, Selection, Selections } from 'useStore'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'hooks/useAppMode'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { kclManager } from 'lang/KclSinglton'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogBMNAHQBWGgEYAbNICc0gCzTJAdkU0xAGhABPRAFpFgueIAca1UoDMY1WMVWAvk51oMOfCOwRMYAgDKYOwABLBYYOSc3LQMSCAsbNE88QIIZtIiknKKZoIaNJr2NKo6+giStiLW9rUSgmKSUi5u6Fh4UN6+-gAicBFRISx47LG8iRxcKaBpBtZmphpW82qKcmqSZYiSlSJmZqo7ZmILgtLC1i0g7u1ePn4EfeF+g5AwY-ETybyz1nLWIgaslUcgagkkxmk2j0hkUikB2Wkqho1nywn2l1c1zank6916-ReoRIfGwsA+zFYk24P0MqhMgLEZ0a80c0nmWwQRnh4IUyNRxhoBzMVxuuK6DyCRKGqBGFISVO+qUMNVE6lB8mOVisSM58wB5xoSMUYlBchOglFOI6Ev8UsioTeYHlXymtK51mkZhEchR1houSaSLEUM5YjEAMEJij0hR5t9citHht+MCA2JpPJ9HGirdyq5skWmih+wcDWyYc9IhRNH+XoaEZMSdueO6aelADMSJQXbmafm5qa9odBCCpCGdnDOfTREaIebw7HcmJm+LUwBRXDsMAAJzCAGtguQABa9pJ5maIWQ+2uqBbWOGqhacgzZVQiRylw4qTRnVcpttN23PdYEPdgTyoSQ4kpc9+0vBBDhEVRUQUDRwTjJkXz+D8H3+fY0J2S0sTFACHnXABHABXbAmBCMA+HYHdKIwM9qWmfghFHQETEaVRkRkOQFDDPIPz4s1FFsX0-n-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-hKdNjsE4dt-NJTAL1seBgGTZH9JoX8WNsNoLWjkQESIdq7UWRTebGylvugDR+Qihd1gMpfF6eEf1URQhBHkS6p3iE726OdlGtgxDdVyGNfa317sbXqecdYklbzZZoT9gRUhTASD5CGS5yhw2GHDKIWunp6w5GQkRCjbbAtbNeSIHomK4eRJkBtStYkDhwnUJIgMewWMhk2sIAMqzutEOJ+4nL9DGGFPYZTzSyh3wBkCiiYwEIahJcMKOEWnn5jyH9PzGHeTNGH18SLoQhx-sR0MpJRZnoXwK-EErsWquIzq9obs9gOu1o8fEMZKyqOlCm69B+c6EkoT1n04Tm0xCSf84+V8wXnWbN9bWkpvy6EUK9SkPPfGF09g7HOPsCwDg1BzYD14AVBqHfp8-pazak1bURQjJkewjXDSlgfAmtFNG-AO5DeIekDgIxmkWbW-7ldlgyDip6BvGAhNRFM2J8okfYElDVAFM4ZxcgLPRwhQjpojSFEX4ULnDlOj58b6JzNDvMOmEOMXMNMhkLBwjccPyBx+9ekhzntZfL22dtct2RbRaFOLwBBf6tJHaxlAQNtg6kxpRxjBRwu9JABNghC95hy0sMDZcM34Ioch9cVBwxBIGcjQ7Jc9OgjNggm9P8p93QPpAQ1hF97AIQXEOM9s+pTRxopFXFTsCD2BR9kg00zMj9EFU9ZFhA+J2QTRNN4QYMkR3p8hocWDX0RAD9J8s4FMZcw5ot1A1gbVl8jgRDix+J6QNAW08CNkRA0BwscsHdwQqxzQMJYlQQk9ygVA-JpcHB2QvQBYTsXAgA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: {
      guiMode: 'default',
      selection: [] as string[],
      defaultPlanes: new DefaultPlanes(engineCommandManager) as DefaultPlanes,
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      sketchPathToNode: null as PathToNode | null, // maybe too specific, and we should have a generic pathToNode, but being specific seems less risky when I'm not sure
    },

    schema: {
      events: {} as
        | { type: 'Deselect all' }
        | { type: 'Deselect edge'; data: Selection & { type: 'edge' } }
        | { type: 'Deselect axis'; data: Axis }
        | {
            type: 'Deselect segment'
            data: Selection & { type: 'line' | 'arc' }
          }
        | { type: 'Deselect face'; data: Selection & { type: 'face' } }
        | {
            type: 'Deselect point'
            data: Selection & { type: 'point' | 'line-end' | 'line-mid' }
          }
        | { type: 'Equip extrude' }
        | { type: 'Equip fillet' }
        | { type: 'Enter sketch' }
        | { type: 'Select all'; data: Selection & { type: 'all ' } }
        | { type: 'Select edge'; data: Selection & { type: 'edge' } }
        | { type: 'Select axis'; data: Axis }
        | { type: 'Select segment'; data: Selection & { type: 'line' | 'arc' } }
        | { type: 'Select face'; data: Selection & { type: 'face' } }
        | { type: 'Set selection'; data: Selections }
        | {
            type: 'Select point'
            data: Selection & { type: 'point' | 'line-end' | 'line-mid' }
          }
        | { type: 'Sketch no face' }
        | { type: 'Toggle gui mode' }
        | { type: 'Cancel' }
        | { type: 'CancelSketch' }
        | { type: 'Add point'; data: { x: number; y: number }[] }
        | { type: 'Equip tool' }
        | { type: 'Equip move tool' }
        | { type: 'Set radius' }
        | { type: 'Make segment horizontal' }
        | { type: 'Make segment vertical' }
        | { type: 'Complete line' }
        | { type: 'Set distance' }
        | { type: 'Equip new tool' }
        | { type: 'Set Default Planes'; data: DefaultPlanes }
        | { type: 'update_code'; data: string },
    },

    states: {
      idle: {
        on: {
          'Set selection': {
            target: 'idle',
            internal: true,
            actions: 'Set selection',
          },
          'Deselect point': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from code-based selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains point',
          },

          'Deselect edge': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from code-based selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains edge',
          },

          'Deselect axis': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from other selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains axis',
          },

          'Select point': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to code-based selection',
              'Update code selection cursors',
              // 'Engine: add highlight',
            ],
          },

          'Select edge': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to code-based selection',
              'Update code selection cursors',
              // 'Engine: add highlight',
            ],
          },

          'Select axis': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to other selection',
              // 'Engine: add highlight',
            ],
          },

          'Select face': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to code-based selection',
              'Update code selection cursors',
              // 'Engine: add highlight',
            ],
          },

          'Enter sketch': [
            {
              target: 'Sketch',
              cond: 'Selection is one face',
              actions: [
                'sketch mode enabled',
                'edit mode enter',
                'set sketchPathToNode',
              ],
            },
            'Sketch no face',
          ],

          'Equip extrude': [
            {
              target: 'Extrude',
              cond: 'Selection is empty',
            },
            {
              target: 'Extrude',
              cond: 'Selection is one face',
            },
          ],

          'Deselect face': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from code-based selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains face',
          },

          'Select all': {
            target: 'idle',
            internal: true,
            actions: 'Add to code-based selection',
          },

          'Deselect all': {
            target: 'idle',
            internal: true,
            actions: [
              'Clear selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection is not empty',
          },

          'Equip fillet': [
            {
              target: 'Fillet',
              cond: 'Selection is empty',
            },
            {
              target: 'Fillet',
              cond: 'Selection is one or more edges',
            },
          ],
        },
      },

      Sketch: {
        states: {
          SketchIdle: {
            on: {
              'Select point': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Select segment': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect point': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Selection contains point',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect segment': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Selection contains line',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Make segment vertical': {
                cond: 'Can make selection vertical',
                target: 'SketchIdle',
                internal: true,
                actions: ['Make selection vertical'],
              },

              'Make segment horizontal': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can make selection horizontal',
                actions: ['Make selection horizontal'],
              },

              'Equip tool': {
                target: 'Line Tool',
                actions: 'set tool line',
              },

              'Equip move tool': 'Move Tool',
            },

            entry: 'equip select',
          },

          'Line Tool': {
            states: {
              Done: {
                type: 'final',
              },

              'Point Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    actions: ['AST start new sketch'],
                  },
                },
              },

              'Segment Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    internal: true,
                    actions: ['AST add line segment'],
                  },

                  'Complete line': {
                    target: 'Done',
                    actions: ['Modify AST', 'Update code selection cursors'],
                  },

                  'Equip new tool': {
                    target: 'Segment Added',
                    internal: true,
                    actions: 'set tool',
                  },
                },
              },

              Init: {
                always: [
                  {
                    target: 'Segment Added',
                    cond: 'is editing existing sketch',
                  },
                  'No Points',
                ],
              },

              'No Points': {
                on: {
                  'Add point': 'Point Added',
                },
              },
            },

            // invoke: [
            //   {
            //     src: 'createLine',
            //     id: 'Create line',
            //     onDone: 'SketchIdle',
            //   },
            // ],
            initial: 'Init',

            on: {
              'Equip move tool': 'Move Tool',
            },
          },

          'Move Tool': {
            entry: 'set tool move',
          },
        },

        initial: 'SketchIdle',

        on: {
          CancelSketch: '.SketchIdle',
        },

        exit: 'sketch exit execute',
      },

      Extrude: {
        states: {
          Idle: {
            on: {
              'Select face': 'Selection Ready',
            },
          },
          'Selection Ready': {
            on: {
              'Set distance': 'Ready',
            },
          },
          Ready: {},
        },

        initial: 'Idle',

        on: {
          'Equip extrude': [
            {
              target: '.Selection Ready',
              cond: 'Selection is one face',
            },
            '.Idle',
          ],
        },

        invoke: {
          src: 'createExtrude',
          id: 'Create extrude',
          onDone: {
            target: 'idle',
            actions: ['Modify AST', 'Clear selection'],
          },
        },
      },

      'Sketch no face': {
        on: {
          'Select face': {
            target: 'Sketch',
            actions: [
              'sketch mode enabled',
              'hide default planes',
              'reset sketchPathToNode',
              'create path',
            ],
          },
        },

        entry: 'show default planes',
      },

      Fillet: {
        states: {
          Idle: {
            on: {
              'Select edge': 'Selection Ready',
            },
          },
          'Selection Ready': {
            on: {
              'Set radius': 'Ready',

              'Select edge': {
                target: 'Selection Ready',
                internal: true,
              },
            },
          },
          Ready: {},
        },

        initial: 'Ready',

        on: {
          'Equip fillet': [
            {
              target: '.Selection Ready',
              cond: 'Selection is one or more edges',
            },
            '.Idle',
          ],
        },

        invoke: {
          src: 'createFillet',
          id: 'Create fillet',
          onDone: {
            target: 'idle',
            actions: ['Modify AST', 'Clear selection'],
          },
        },
      },
    },

    initial: 'idle',

    on: {
      Cancel: {
        target: 'idle',
        // TODO what if we're existing extrude equiped, should these actions still be fired?
        // mabye cancel needs to have a guard for if else logic?
        actions: [
          'edit_mode_exit',
          'default_camera_disable_sketch_mode',
          'reset sketchPathToNode',
        ],
      },
    },
  },
  {
    guards: {
      'is editing existing sketch': ({ sketchPathToNode }) =>
        !!sketchPathToNode,
    },
    actions: {
      'Set selection': assign({
        selectionRanges: (_, event) => event.data,
      }),
      'Add to code-based selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          codeBasedSelections: [
            ...selectionRanges.codeBasedSelections,
            event.data,
          ],
        }),
      }),
      'Add to other selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          otherSelections: [...selectionRanges.otherSelections, event.data],
        }),
      }),
      'Remove from code-based selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          codeBasedSelections: [
            ...selectionRanges.codeBasedSelections,
            event.data,
          ],
        }),
      }),
      'Remove from other selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          otherSelections: [...selectionRanges.otherSelections, event.data],
        }),
      }),
      'Clear selection': assign({
        selectionRanges: () => ({
          otherSelections: [],
          codeBasedSelections: [],
        }),
      }),
      'sketch mode enabled': ({ defaultPlanes }) => {
        // TODO we're always assuming that they want to sketch on the xy plane!
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'sketch_mode_enable',
            plane_id: defaultPlanes.xy,
            ortho: true,
            animated: !isReducedMotion(),
          },
        })
      },
      'edit mode enter': ({ selectionRanges }) => {
        const pathId = isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          selectionRanges
        )
        pathId &&
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'edit_mode_enter',
              target: pathId,
            },
          })
      },
      'hide default planes': ({ defaultPlanes }) => {
        defaultPlanes.hidePlanes()
      },
      edit_mode_exit: () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'edit_mode_exit' },
        }),
      default_camera_disable_sketch_mode: () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'default_camera_disable_sketch_mode' },
        }),
      'reset sketchPathToNode': assign({ sketchPathToNode: null }),
      'set sketchPathToNode': assign({
        sketchPathToNode: ({ selectionRanges }) => {
          const sourceRange = selectionRanges.codeBasedSelections[0].range
          return getNodePathFromSourceRange(kclManager.ast, sourceRange)
        },
      }),
      'set tool line': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'sketch_line',
          },
        }),
      'equip select': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'select',
          },
        }),
      'set tool move': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'move',
          },
        }),
    },
  }
)

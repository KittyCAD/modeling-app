import { Program } from 'lang/abstractSyntaxTreeTypes'
import { ProgramMemory } from 'lang/executor'
import { engineCommandManager } from 'lang/std/engineConnection'
import { DefaultPlanes } from 'lang/std/engineConnectionManagerUtils'
import { isReducedMotion } from 'lang/util'
import { Axis, Selection, Selections } from 'useStore'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'hooks/useAppMode'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AFgCMAOgBMogOwyAzAE5hNABw0ZAVlGKANCACeQyQDZh4zTMWj5GmqfnDN8gL4v9aDDnzjsETGAEAMpg7AAEsFhg5JzctAxIICxssTyJAgiqkuLqMpKK8jImWpL5wvpGCNLiwooORTZmqq7uIJ5YeFC+-oEAInBRMWEseOzxvMkcXGmgGYLyqoo1GiYLsrWyohWIojY5qjK7qpqLppI0LR7oHT5+AQT9kQFDkDDjiZOpvHNK8lKaJmKdU00mEpk02wQInM0kUxQukjBamabiuXk63Xuj0G4RIfGwsHezFYU243yEeSWkhBJm0C2ERQWkOhUh08PkiPOB1UqLa128XTugRCz3CI1wY3oExJX3SQkKNHEMlqpkUxyKRWKkIWfxM52KTjqihOkl57QFmOFOLCrzARKSMum5Kh8hMqnEigutmEqlENGKAIhhkQmmcUnypRMF2NnsUZv5GKFwWteIJ9s+TrlUMBSxUgdUxzB2j0wYQzhM4guNAKbupzny8fRtx6ydFYQAZiRKOnHWSs-NNEsDqJJFYaKIAbthOVS3lFf7RLVQwCaD7NI2boKWwBRCVgABOEQA1qFyAALHspTOzRCAj3VmSLRzCBWLZk6GQ1R-q0QmP00jcLSTXd2APY9TwvUQEmJK8+xvBBDhqRFHFpLIDnyLZS0EMwlV9TQNFqQ4zF2QDEx3ABHABXbAmBtPh2H3SiMEvUkZn4RBSk-UpjVkGRxxMRQ4UhE0vysMp5EHaNSObe5tyomi6IYpi7Sg6VYLYjJpAkVRVmkX1HzVasTEhVZFQKNQtD1MxKWkrcsQGNtO27KUPl7DT5QKcRATEAFFDkMFlRkd8-PEWxckWXi-Nsy1W2iXFMEwFjZXg+Y7xof0xDqBZ1HySFFi4gEJMXbQwThaKk2xNsSASpLr3Yl0Qq0acTk0adrAZZkJMVHQ1B9Q5qT1URyoo6jaPbbAEtCWq4PqyRHFC0RfR0H1V2NSxIWsJY1X-Pi6gE01WnNMjZPksaJoCMZVNc9TnWWnIo1kATFrEHT5A2zyoyIv9VDET7oqCE92HPYgyEoRKXJg1jbskAt-nkRc512UcZ0qQQTgrPyHy9R8+v+wHz3EAGIIASRGhTvDAMJ2FQVBwegh0bqzCdSnEEcxEKDlOYnTqrA9Lq6jkRdAQuPGIMJ-Gz1J+4RTi4ZUFGab3IQT0-knU5BICtR30WLzHG0Mx4enX0TFFoGz3FkmWxloZIigABbMAJUV51rAkVcXxoEFNmnFGhDdJUQVDA4Th9MEhsOhMfCJs2LbNqW+gc2XxUlemMxmjIdMVQc4Vaw1LALHmlldQE5p04sDVNgno-PeOHkTm2wHtx2U7UqGs2OCQBYUMx8OcLJmTpBb8nHWxZHXCOmy6avzen2vkBIE8Ikbh2JTCAA3A9OHIarnaZ0Nc1HT0nAExw3tnIdPeQjkCicIpK5niW54XynbZX8Iz1QfdsAAL24dgd4hgzNu8EJxghyCcG+K5xzNE6n8eQroXyFEWuWP899xAABk8CUwACo00wAQCA3AwC+FwGvVAJ5xBEH3GAEgoEwgU13iA-WXllBOH4qsH6QZUZFg9AWZQ-EdITkuHySescCaYNwDgvB4gAByqAwgAAV5YSlgAQAAghACAcsFaALTkrHQrUaiLBrMLZoJZUb4SWDYasrUBb2GnGgiRUjabiCUaMMIGiMAQHUZo7RTtdFuWdJGTQHpqTGnSsqHSWosKWNZrYY0Ko+KImEI4rBYRcEuJCE3VenjIA+K0cnRhs1Byq0sIiSxAJ8oD2rHEmxiT7EpInpuMR5snHpOkVkt+HjNF5KIKgO2TALqUwYQExm8FRx-lZvhWkCxeo6U6rUKZQd0qelWLURpaJmnbnooxDABCiEkLIRQqhNC6FgB2cpIpGR6SVmNPkUMElBIGm1KscBVhDiyDmnqKKTSLTbKUnsuSo1FK7LtKM4B9U1RbVHK1CyzQkYmUQtSF8+EFDSG0AdTZfyLmAtOiCy5V1IbJXqsUCsWQ+IXAnHqAaiKJDIsKHkPIPobDRX+aC8QtdrbhCcmC1OgT26DimVoPyhx4mtUhI+DGjhfx6kks+VlOLiFcumGEAASjQiABhkzhAgASf+FBeWt2JRkNmfxFzHFKCuCMEqdKVgcMcV0RkflYoxNPMIuB5E8tikMHlVyQyPiVIUUyixaS0kwqjCspgdAjg5H6AoSgNkiOaQAMXOqEfZkjDnkOISc2hlNxqTRbtdCFmlBI1BKRsAEMNxWlj9LaucdQcqBi0NFVNhaCBAoUgWi6frlYBtQvnP8etxyQj9LzQRoZpxunStoVtab2Adrxd2qahKgHGtvLaxcCMcZmJHKOjQQ4-yTuENO1cMg52Fo5Vba0tpe35SkD6KJRQ9pulHc9Ssuw-TFGrQcC9F1CY4hVeqkgmrtVhH3CB7AlFCTgvXQgEcRQPT4SUDYV0yTjK1vfeOXY-o8jHF-b8jEbb-3Ku4GqjVWquU2mgIa4tcHdi8yUPhaQnJDiqFHfcvm6hY1KCjNSNwrQPUYHgIkI6+AjV1TmHIAq4IbA-UZOxrCvp3TBusNWMoJxhoBAk+nYwVjzKe0vs0OQBxIRlCkMUZaK0QSInvjppW3HQlyAQb3BYkhmQKAkNY6wqxATrHHi6qOEsWnx3s7dWwipRw2HWULSwvsoTIpqFOoolgdCmFXKkyR7TaZhaZha1mxpZmpayNoZkBtdbVl+gmylmXnGYFkfItxKjcsgM9N1Qr6hivUnDfKPYThAwnqNvDX8tXsv1d6EQlrs01MLRHMGjCChmTTk-OoAKkZZn8VGxk+rTXwi5IgFNzSv4-hwnhgsT0fpfxcN638frtJBs+mGybQjQWxZtO2wB7Je2ekHbo5JjiJ6JDwP9G6AS-oCjXZdH10M92zCPd2M9wLXQ2XKUO7eGGORRzpXhlWmlpZywBxfGYccIr+MveR4qq92m-u6YQohMprVnBGhszakJbo5CrF-BFV0CqAVKsA2R4Dmq0fwbsEqMQZwmjwJrZUOQQ5JJRlXM0bHvP2VC8qES-78HMpKl2NnVqv4FDmMQI+NnBxGRc+sDz8nLT3Weq7GAEXpgKzwKyJjPyKH3NYV2F5XiQsrCTkKH+0IIuOGszEAyHdnuNpOFCke4oWgq2I6TRaYjoQqeO5p0rZ9D7lDGZKgJSHuxlDgMNH1E9dZg-sAA6KIDFGRdjrJToeB5wOd6zfT9Ssnt4SfJUM6lPRH53iHVw3l8VJFocmVLUal8WjjmBnT3plD4BMuCAA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,

    context: {
      guiMode: 'default',
      selection: [] as string[],
      ast: null as Program | null,
      defaultPlanes: new DefaultPlanes(engineCommandManager) as DefaultPlanes,
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      programMemory: { root: {}, return: null } as ProgramMemory,
      // TODO: migrate engineCommandManager from useStore
      // engineCommandManager?: EngineCommandManager
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
        | { type: 'Add point' }
        | { type: 'Equip line tool' }
        | { type: 'Set radius' }
        | { type: 'Make segment horizontal' }
        | { type: 'Make segment vertical' }
        | { type: 'Complete line' }
        | { type: 'Set distance' }
        | { type: 'Set Default Planes'; data: DefaultPlanes },
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
              actions: ['sketch mode enabled', 'edit mode enter'],
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
              'Equip line tool': 'Line Tool',

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
            },
          },

          'Line Tool': {
            states: {
              'No Points': {
                on: {
                  'Add point': {
                    target: 'Point Added',
                    actions: ['Modify AST', 'Update code selection cursors'],
                  },
                },
              },

              Done: {
                type: 'final',
              },

              'Point Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    actions: ['Modify AST', 'Update code selection cursors'],
                  },
                },
              },

              'Segment Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    internal: true,
                    actions: ['Modify AST', 'Update code selection cursors'],
                  },

                  'Complete line': {
                    target: 'Done',
                    actions: ['Modify AST', 'Update code selection cursors'],
                  },
                },
              },
            },

            initial: 'No Points',

            invoke: {
              src: 'createLine',
              id: 'Create line',
              onDone: 'SketchIdle',
            },
          },
        },

        initial: 'SketchIdle',

        on: {
          Cancel: '.SketchIdle',
        },

        // invoke: {
        //   src: 'createSketch',
        //   id: 'Create sketch',
        //   onDone: 'idle',
        // },
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
            actions: ['sketch mode enabled', 'hide default planes'],
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
      Cancel: '.idle',
    },
  },
  {
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
    },
  }
)

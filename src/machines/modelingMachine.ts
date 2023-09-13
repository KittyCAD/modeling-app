import { Program } from 'lang/abstractSyntaxTreeTypes'
import { ProgramMemory } from 'lang/executor'
import { Axis, Selection, Selections } from 'useStore'
import { assign, createMachine } from 'xstate'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AFgCMAOgBMogOwyAzAE5hNABw0ZAVlGKANCACeQyQDZh4zTMWj5GmqfnDN8gL4v9aDDnzjsETGAEAMpg7AAEsFhg5JzctAxIICxssTyJAgiimuZOkqqSMjRqipKKcvpGCIKiqibiwrVqkjSiwpJiCm4e6Fh4UL7+gQAicFExYSx47PG8yRxcaaAZgvKqivUaJquywtYyohWIojbiqqr7NZprps2u7iCevT5+AQQjkQHjkDAziXOpvGWSnkUk0JhMVkkmmkbRMmkOVWE5mkighNHk7WaZzu3S8fQGr3eY3CJD42Fgv2YrHm3EBQhkpVBpm0q2EMi2qgRImROjRGLaahkqi6Dx63n6L0CIU+4UmuGm9Fm1IB6SE8kK4hku1MilUlgh4JkCNWIJMzQhThKiiukhFj3FBKlxLC3zAlKSyoWdKq8hMqnEinRtgaohoELB8MMiE0zikpUkpnR1sDijtYvxkuCztJ5Pd-y9qqq4PWKgjZ2yUJ0COcdXRNEUvvyMYxqfu9ozgyzMrCADMSJQ857aYWVpp1udRAVA1kTMckQiGTRxGHWtaYyYaA1NGm8c9OwBReVgABOEQA1qFyAALQcpAtLRBagNOIW7RuqRxcmz+hob-ItNoOhxUVdwlA8j1PWAL3Ya8qFEBIqTvYcHwQBll1sDRdhMZRRD9eQuTWKQVDkK5Wm0GMZB3J4wNefcAEcAFdsCYF0+HYY8GIwW8aUWfhEATGQ42tWRClwxRUWrfJ6jkK1hHkMckyoh1M3opiWLANiOK4+ClSQ3iMmkCRagxGpZDWdQJKjBAtiXBtBTBUw2VKJSO0JUZuz7AdFT+Id9LVBtxHBMQwTKLUCjZL8ynEWx1CFPYrEott0z3V5pWiElMEwbiVRQlZwWXMMxBKVZ1FKBE1kEqEtm0JxWlKEwXJS4Z3PSsISEy7L7z4n0oq0JErmyXZWiNKzRyXHQ1AafYqukRqaMCVTmN7bBMtCTrkO6yRHGi0ydAaTc1xGyprHWXVQ0sesdVtJLQMdAhFpYnsVoCaYdJ8vTvT204N1kbCajEYyEXE00NFw2dVDEDdEtxajxCCaDrwICBuDAXxcAAN1QC9xCIY8wBIdgwHPS8b28xCeO9VZBODaxVCyPIIS1BE5zjFQij9cSamUOa4YRq9iDISgsrJj0PsLSczlBeRhuaY5wq5K46jKetCnkdUIfOHn4ZJ8QAEkD0YpbvCJ9hUFQYWENFinxehSRxEnMR1QxZ2si5dVTvky65FacF0S1vm9c7NLxjlBVLfzDaMkDEEwS50plAKNQv0IrZarMaWkTphqbth7WYKvQPUudSIoAAWzAeV1r8hBrAkTc5JoaFZFaedRr9TVoRjc4rgaNpRH9nX9bcj5WtDqvvUaCxxLhfrrSFTlRvd6LwTNVY4V5LUB-zwvmpH8YS-LyuRYj6u9QkEo5F9JxG9WSQFZOaXShaWxZG3HOHTz68d4IZASAvCIwBlwruEdGJ5ODkHauPG2Y56hTk3CFRw+ErJWFOI3doatSiOH1FvL+Q9Ai-3-gfYBYQryoGPNgAAXtwdgkDj6+U+hWU4VwGxOA3C0D8bsQRq3TuqS4vpZw4ILgAGTwETAAKmbTASMUZo0xtjXG+NCZhGNlAlCWRcKBWUNfMGrJIyVBEFCAMZxlAtD9LOZwgjxAiNwOIyR4gAByqAwgAAVUBTFgAQAAghACAEw3FH3DvQ8W1ochrAbCvNQSgFb1ntrYEJF97BIksdY2x5txCuKmGEbxGAIBeJ8X4qYqjNrMgDFCa0RQtS1AhNE9YNh6zZASe0YQyTRFhAkWkkIQD5RZJ8ZAPJvix50LFihMpMdLDtE0PUjmR0hCTNqXEhpicmktJsW0uxnTD7hGyX0ogqBS5MBekTFRQzrYjPZBILIYZnDqA1iYN2ux7YxiuEUQMqdubv3xPuTSnFAjIxsbIrGqMFEEyJhpdiPyikZFZMua0pRmxjlREzKyvoQR6gSscBkvpSjQxArDL54KMD3UNupb5XETk5W6rqU6BRsiCg-HLBEEIJBQjkpMhQ0htDXRhg6fFWkFrEtYgSt0b1yYUoyAaU4id0QzgTGCRl+xQRyTkAUdodNgLth8Lyn539g7hE8m6clXUMh6lqZYMc3sFnCAXLUAMjgwZlPREkj5mrSWo11QsMIAAlfGEADBZnCBAckNCKAGsCcM7qDsQStD1LKjc8ZrW1gcHqX09ZsI4o1f0T+V4wi4CcfqrsrV9WQsQMIDcy5WiCmOM3TcMyfR232B0P6ZwV5gh5gAMWeqEaR-y8ByKBXjEFy1Vph10qcza4l6hjkcNYByeorVWVDDaxcJRSoRi0O2zt7AiVqSHS9YtNchSBQGkKWcWCWjMw0OOcxg0-RFG0Bu4d26lpPWHXBMNY7xU2taMNV8H5rB3wXZe76WQb3qBrQ+l6OrnSun3RVIizaDQlHBAvSoxwIbluOGGBkepNbOv6B24dcNiQeu9SQX1-qwjHjI9gBiFJDWRyOAUJWkylA2CxUiO5C7-oYdDBCPIVx03JXw5uojMoSM+r9bql00BQ2jrFUcWQ6wlCTOkJifYKHGPWlteoEySg41v3uLmjA8BEgZrk0a+kcgmTr1ZOyVYBEzCaj2uEtNuE37ctcmAczDGqiMh0BhSZ0IPxyHOAiUoyImVaPULbZpeHeYk286fdEpTL5mEC7fLkchqaomqhoLUVLLF4MS59DCUh9jTrEKWyw879EsvqBx9klgdCJlix5nwWarGtPaZgYr4sY322tKsRu6nKxcnTlIDkpRJzsmTCs1JmAHFOIyfKEzoqLOZEDONQb0WRvaDdicJwEZS2Z2lrhObay0lDBRr1kZ1glynYcE0PYSD9FIkEuoNoDIk1FDO3FjrKSLsLeW1s3pEAbubVwiCVE0tVjTlMXotUB31zZDMA0U72c2uZoDgD7rRGukg5yeDgypaJBqzDGY15DYEc+iR0d1H9LfuY-EFqjARPEBmn9PkQo0qHJVWrOqe20hwZ5AxB+VruKeWup3mz1CCrxnZGcFaW21rNCBXOHZ3CawbAY4l58qX7ruBeokzL0MGotSTjNGYD88kauPhQSasMRQ0dFHVUJ5nUvSO+pN0VJzWRxLZFwgoPQyC9Rq7kFsTX1hfSCJzXm-sXn3ofv4jGKeZQ0tyXMuUReII0EMjKPyBO7ndc+AIy9GXHJ7aVZC2j-9QMnCajyPkWWUfsIQdCNLxP8nULYSIsoYLNVsLU+OMoJhlopqlqhEXjN4hS-t4N7gI3ZHKhrZ86buodMGwYjy6nIf3G71olkO0FWbf2DiE98vq2XfWhKCkDUDEWosIJlt5kPfjcD8MhUGUNwbggA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,

    context: {
      guiMode: 'default',
      selection: [] as string[],
      ast: null as Program | null,
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      programMemory: { root: {}, pendingMemory: {} } as ProgramMemory,
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
        | { type: 'Set distance' },
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
          Idle: {
            on: {
              'Equip line tool': 'Line Tool',

              'Select point': {
                target: 'Idle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Select segment': {
                target: 'Idle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect point': {
                target: 'Idle',
                internal: true,
                cond: 'Selection contains point',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect segment': {
                target: 'Idle',
                internal: true,
                cond: 'Selection contains line',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Make segment vertical': {
                cond: 'Can make selection vertical',
                target: 'Idle',
                internal: true,
                actions: ['Make selection vertical'],
              },

              'Make segment horizontal': {
                target: 'Idle',
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
              onDone: 'Idle',
            },
          },
        },

        initial: 'Idle',

        on: {
          Cancel: '.Idle',
        },

        invoke: {
          src: 'createSketch',
          id: 'Create sketch',
          onDone: 'idle',
        },
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
          'Select face': 'Sketch',
        },
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
    },
  }
)

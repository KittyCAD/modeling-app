import { Program } from 'lang/abstractSyntaxTreeTypes'
import { ProgramMemory } from 'lang/executor'
import { Selections } from 'useStore'
import { createMachine } from 'xstate'

export const modelingMachine = createMachine({
  /** @xstate-layout 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-aFIc5o5z4g-B+X092uE-4yj1ERVF251lUUtLBJCaM6YMhZl5hogWcXzFcOwZAJL0LMx1hE+idEzR7KZO5sVMEyxCr2ZYy9Mr2i4GBMvaEqrEAavvwKCnUMa8tTYnujGy6IW2uZhkCsU4-I3lvjG3XTKZhZlHDXqrXUUMTyMzW5YQCg4HPFO2f5MuW2tASFM-W68zq1jIskdTRojN1BFW7htnZBN+V-MqJ5qF79x2p2MKibEyx5LvapisLQnHfsAn+-5AV-yttghcl-VVAClDc3h59pHP3VSo5izjHFeKZRgC26rMRH9wQXnSCoOMdKXIyAKNRaCF4lo9d6Bm90W2EKkVLZI8t9gpJWVOtTSwYYfOclKg5wXBq7udrB4GEaZgjS7obA4rLSlAQpOOMpsESFdXtt5SEIHgqQcSy8+D9DzSJ3olPIhB1aqzxIkkReYEZ4Lf6vEBju3hD9ppn2BqXcChIQXCRblR1dlvdqE5-74DQA */
  id: 'Modeling',

  tsTypes: {} as import('./modelingMachine.typegen').Typegen0,

  context: {
    guiMode: 'default',
    selection: [] as string[],
    ast: null as Program | null,
    selectionRanges: {
      otherSelections: [],
      codeBasedSelections: [],
    } as Selections,
    programMemory: { root: {}, pendingMemory: {} } as ProgramMemory,
  },

  states: {
    idle: {
      on: {
        'Deselect point': {
          target: 'idle',
          internal: true,
          actions: 'Remove from selection',
          cond: 'Selection contains point',
        },

        'Deselect edge': {
          target: 'idle',
          internal: true,
          actions: 'Remove from selection',
          cond: 'Selection contains edge',
        },

        'Select point': {
          target: 'idle',
          internal: true,
          actions: 'Add to selection',
        },

        'Select edge': {
          target: 'idle',
          internal: true,
          actions: 'Add to selection',
        },

        'Select face': {
          target: 'idle',
          internal: true,
          actions: 'Add to selection',
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
          actions: 'Remove from selection',
          cond: 'Selection contains face',
        },

        'Select all': {
          target: 'idle',
          internal: true,
          actions: 'Add to selection',
        },

        'Deselect all': {
          target: 'idle',
          internal: true,
          actions: 'Remove from selection',
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
            'Equip Line Tool': 'Line Tool',

            'Select Point': {
              target: 'Idle',
              internal: true,
            },

            'Select Line': {
              target: 'Idle',
              internal: true,
            },

            'Make line horizontal': {
              target: 'Idle',
              internal: true,
              cond: 'Can make selection horizontal',
              actions: [
                'Make selected line horizontal',
                'Update code selection cursors',
              ],
            },

            'Deselect point': {
              target: 'Idle',
              internal: true,
              cond: 'Selection contains point',
            },

            'Deselect line': {
              target: 'Idle',
              internal: true,
              cond: 'Selection contains line',
            },

            'Make segment vertical': {
              cond: 'Can make selection vertical',
              target: 'Idle',
              internal: true,
            },
          },
        },

        'Line Tool': {
          states: {
            'No Points': {
              on: {
                'Add Point': 'Point Added',
              },
            },

            Done: {
              type: 'final',
            },

            'Point Added': {
              on: {
                'Add Point': 'Segment Added',
              },
            },

            'Segment Added': {
              on: {
                'Add Point': {
                  target: 'Segment Added',
                  internal: true,
                },

                'Complete Line': 'Done',
              },
            },
          },

          initial: 'No Points',

          invoke: {
            src: 'createLine',
            id: 'Create line',
            onDone: 'Idle',
            onError: 'Idle',
          },
        },

        Extrude: {
          states: {
            Idle: {
              on: {
                'Select Face': 'Selection Ready',
              },
            },

            'Selection Ready': {
              on: {
                'Set Distance': 'Ready',
              },
            },

            Ready: {},
          },

          initial: 'Idle',

          on: {
            'Equip Extrude Tool': [
              {
                target: '.Selection Ready',
                cond: 'Selection is one face',
              },
              '.Idle',
            ],
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
        onError: 'idle',
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
      },
    },
  },

  initial: 'idle',

  on: {
    Cancel: '.idle',
  },
})

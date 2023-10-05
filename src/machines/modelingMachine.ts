import { PathToNode } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { DefaultPlanes } from 'lang/std/engineConnectionManagerUtils'
import { isReducedMotion, updateCursors } from 'lang/util'
import { Axis, Selection, Selections } from 'useStore'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'hooks/useAppMode'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { kclManager } from 'lang/KclSinglton'
import { ConstraintType } from 'lang/std/sketchcombos'
import {
  horzVertInfo,
  applyConstraintHorzVert,
} from 'components/Toolbar/HorzVert'
import {
  applyConstraintHorzVertAlign,
  horzVertDistanceInfo,
} from 'components/Toolbar/SetHorzVertDistance'
import { angleBetweenInfo } from 'components/Toolbar/SetAngleBetween'
import { setAngleLengthInfo } from 'components/Toolbar/setAngleLength'
import {
  applyConstraintEqualLength,
  setEqualLengthInfo,
} from 'components/Toolbar/EqualLength'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

const constraintActions: ConstraintType[] = ['vertical', 'horizontal']

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogAsAJgA0IAJ6IAjAGYaAVgB0gwQE5Zm2dOkAOYQtkBfI+LQYc+JdgiYwBAMph2AAlhYw5Tt1oMkIFjZvHn8BBEEFXSUabQMANlk1AHZBRKTxKQRpYTjpJTikyI043TVpAsETM3QsPChrW3sAETgPLxcWPHZfXkCOLhDQMNk45QUaJN0J1QUFQSmFDJk5KJy1OLjUueFhNWEqkHNaqxs7Ahb3O3bIGB7-PuDeYY3oybkkmkFRwSTkpayaNJBEpdAktoC9mV9qZDjVLPVTs1WldXCQ+NhYHdmKx+twnohZElhEpCjQyXthElRiM4v9SnkIkTFCUtsYYUd4Q0zk4UR1UF0sQEcY9QkJFEpyr8NNI1KUkuVaZIhMIaCopkltHt5Do2dULHUufYeZ5XDcwIKHgN8eEaFF5qlSqC5n8lQhNsD3bppBM5HNBNIDhyDYjHG1UejMfResKraLwrJiXEaBo9uMZTQ4mp-nMojLymoFMIgQoSrrYfqTo1Q7yAGYkSgWmN4uOCW35MkiEbyDSA-5U2Qg9bSSJJkqFXSBuHBqsAUVw7DAACc3ABrZzkAAWjaCsaGiAKA4mMVkkUmlN0i1dwgT+Q18gvCh0KUpk4rCNn86Xq-XW+kfmxO7Nnuboaq8x6nvokyXpk2QRCSCh7BEXrXuMcSvsc75nDOACOACu2BMC4YB8Owi64Rg264oM-D7qBeibIC6gJhEsh0hmShFrIPxFpEvEKOhnIhjh+GEcRpHkeaf7RoB1FhAeEqgq2QIaMILF0iWJK+h8hQaPx7JTpWZwXGGLh1g2Ub3E2skEh8+QJpBiSnl8-zakohLFIkIj6JmAnTtyJkkJgmCUSKwH+gOOyjJMIhkrM0GICqwJ7HEqm6KosgXt60J6hhhrnMiJouIFwUWQBVHWhlDKbLo7k0EW5R0nkhZkjEej+l8MS+YZ9jCQRpnYEFzghbuNFupm8GJIk9WFKxrqMkohiUrMySJLKaH6W+eW9YRNYDXY3RSZZMnWhsagTSm02GNmbYxJSlLSFSKW-GWQZWA4a7sJuxBkJQmDvT+w1AaNBjaEosqlCetpqMkV2ut6RISqMTrCFM9JJF19T-Z9G5KFjm4AJJVsa7SdPOgPWQguybCSuwZbKLXDukrqPSCESUoSqQiLMGO4x9m68z+hP+by7hQAAtmAZOlUKx1xlTwJEhojoM4qmQJMShRbLo8pTT8PN4zjBtC0ilyFaT3TS5aQNhLsRbwSjU1U72rrjMCCzaKO2s1frfOG77xv5ab7SixLUv-jL5Vy2Uh5paC2QylTLkI4kw6o+o+ifOtOWcgbAvYwH20uOwqCoCV4dWxT-oPRKcipwkBYiP8ZRxIjGbgzk2giD7P55wTs54X1YuoAAbmARcl2X0mR2FQJJK88qa0kmtZnDOiqj8NW5Be6ipt32O9xuAdOK4QfBOTFWAgOIw7BeSZkvoTflK38o-I+to6Hv-NG1WyAkGubhgHFpLVwo9FycHIIFc+ctdBTDBsmPQNJ9BpVVjIXYc8WKgkSDEfQ6hP5+0Fj-P+Y8Q7AJcBuVAi5sAAC9uDsEgZbKy1oUbU00Oof0yYPgGEEP8HQBZ8jQzmC1FU6x0YbVyrnb+ZwiDcFgKREgeAyEUOobQwKLgIAYjoRQc0DDZbAQdmdD4Ss5DJllLNGC+hlC5HmNeDKoIyh6WzgaCR-sqzSNwLIxc8jcAuFAeA1R6jZE-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-QMMTAYQECMB4B-B-UW0SiNNYkNNYipQYFVBchCwcEeZERVjK5QdEMMwqRkh3dUgeEuwJRdhyQ9AvRUgntVkfxjimEW8wYYFdIoYYYalKZCRBxN1NgKgOxMUfkwB3io4YEwYyhlJHolk8CARNCUZNZCs6pWFR1g1MAoSwpNQvjU1CxNQ9B-hUgNZD0RgYoTwyh9DYDc4g1x0Q0mh5NcT7UzwwY7kEgokiTUNlBEgEgaRPg6oOcO96TQMQ0KMq0Z0IBWSwh1BnDfhHNdhCt1DmYch8heDUosttYNcJCxTCMJ0w1SFq1ZSajtABwB09BoYIhYp7l5kNT1Z5htT5QsTGTb1wN2BTT4wCgCSEIiS8wQC1TVQdh1gkwTxDA-RXSiNSNyMDV2Aljt8SivhZQm8uIGd7EH41S6jeDuMqSb86Ssk0BBUb0vTVBUh8gpgc8WNQieFbQW5kgapeJVB0yBN4tdMxNAlqsPsvSuI5gJRxk0wvZNAkS9A7YsDHNqSdj1gZswE5tKtOzFsscezkyVAsDwjX5HxNgRtPgOIDwh1UYMwYDXMXs3t9dlyvQOJtZ5RxgUgRgYcdgOIsCiQLt4YChOdekeduy48d8uJNCMwK8UhqUYZFddgFoll1hARshwZl8i9ITvySidB9Aq8itx869e1QQGV0o9BthbQYKY9fC4LEyKZKUogShRyWU6p3dT8mo0pni44uNllYD79V8uj2jsjMgiLrQHp1hM80lZhVDZ5QCm9mysCUo25z0DDO8V8FMsiP8vSix90455TRwSwLwhKaoRKMwVRMwJKCyfx4DED6xCK+iSjG8gQMxmVEoNhaUYJhF4JUxARQi7pmj9ovTEKFZbCok1DHDMgEwGQloE5IJXkXK0jjY3Kkwf1GRWwSx1BL5SSNJmVnQEiPDFAQqfDWLuBX8Oi3Kao54ChuCSwuEIqNC54HoGjdCxC0qlBZKOKTKKY0k3YaVFSVVRh7lQjSracuJGjKq5igA */
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
      sketchEnginePathId: '' as string,
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
        | { type: 'Complete line' }
        | { type: 'Set distance' }
        | { type: 'Equip new tool' }
        | { type: 'Set Default Planes'; data: DefaultPlanes }
        | { type: 'update_code'; data: string }
        | { type: 'Make segment horizontal' }
        | { type: 'Make segment vertical' }
        | { type: 'Constrain horizontal distance' }
        | { type: 'Constrain vertical distance' }
        | { type: 'Constrain angle' }
        | { type: 'Constrain horizontally align' }
        | { type: 'Constrain vertically align' }
        | { type: 'Constrain length' }
        | { type: 'Constrain equal length' },
      // ,
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

              'Equip tool': {
                target: 'Line Tool',
                actions: 'set tool line',
              },

              'Equip move tool': 'Move Tool',

              'Set selection': {
                target: 'SketchIdle',
                internal: true,
                actions: 'Set selection',
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

              'Constrain horizontal distance': {
                target: 'Horizontal distance modal',
                cond: 'Can constrain horizontal distance',
              },
              'Constrain vertical distance': {
                target: 'Vertical distance modal',
                cond: 'Can constrain vertical distance',
              },
              'Constrain angle': {
                target: 'Angle modal',
                cond: 'Can constrain angle',
              },
              'Constrain length': {
                target: 'Length modal',
                cond: 'Can constrain length',
              },
              'Constrain horizontally align': {
                cond: 'Can constrain horizontally align',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain horizontally align'],
              },
              'Constrain vertically align': {
                cond: 'Can constrain vertically align',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain vertically align'],
              },
              'Constrain equal length': {
                cond: 'Can constrain equal length',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain equal length'],
              },
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

          'Horizontal distance modal': {
            invoke: {
              src: 'Get horizontal info',
              id: 'get-horizontal-info',
              onDone: 'SketchIdle',
              onError: 'SketchIdle',
            },
          },
          'Vertical distance modal': {
            invoke: {
              src: 'Get vertical info',
              id: 'get-vertical-info',
              onDone: 'SketchIdle',
              onError: 'SketchIdle',
            },
          },
          'Angle modal': {
            invoke: {
              src: 'Get angle info',
              id: 'get-angle-info',
              onDone: 'SketchIdle',
              onError: 'SketchIdle',
            },
          },
          'Length modal': {
            invoke: {
              src: 'Get length info',
              id: 'get-length-info',
              onDone: 'SketchIdle',
              onError: 'SketchIdle',
            },
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
              'reset sketchPathToNode',
              'create path',
            ],
          },
        },

        entry: 'show default planes',
        exit: 'hide default planes',
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
      'Can make selection horizontal': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'horizontal').enabled,
      'Can make selection vertical': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'vertical').enabled,
      'Can constrain horizontal distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertical distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setVertDistance' })
          .enabled,
      'Can constrain angle': ({ selectionRanges }) =>
        angleBetweenInfo({ selectionRanges }).enabled,
      'Can constrain length': ({ selectionRanges }) =>
        setAngleLengthInfo({ selectionRanges }).enabled,
      'Can constrain horizontally align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertically align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain equal length': ({ selectionRanges }) =>
        setEqualLengthInfo({ selectionRanges }).enabled,
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
      'reset sketchPathToNode': assign({
        sketchPathToNode: null,
        sketchEnginePathId: '',
      }),
      'set sketchPathToNode': assign(({ selectionRanges }) => {
        const sourceRange = selectionRanges.codeBasedSelections[0].range
        const sketchPathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          sourceRange
        )
        const sketchEnginePathId =
          isCursorInSketchCommandRange(
            engineCommandManager.artifactMap,
            selectionRanges
          ) || ''
        return {
          sketchPathToNode,
          sketchEnginePathId,
        }
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
      'Make selection horizontal': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Make selection vertical': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Constrain horizontally align': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        kclManager.updateAst(modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Constrain vertically align': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        kclManager.updateAst(modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Constrain equal length': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintEqualLength({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
    },
  }
)

import { PathToNode } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { DefaultPlanes } from 'lang/std/engineConnectionManagerUtils'
import { isReducedMotion } from 'lang/util'
import { Axis, Selection, SelectionRangeTypeMap, Selections } from 'useStore'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'hooks/useAppMode'
import {
  doesPipeHave,
  getNodePathFromSourceRange,
  hasExtrudeSketchGroup,
} from 'lang/queryAst'
import { kclManager } from 'lang/KclSinglton'
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
import { extrudeSketch } from 'lang/modifyAst'
import { getNodeFromPath } from '../lang/queryAst'
import { CallExpression, PipeExpression } from '../lang/wasm'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export type SetSelections =
  | {
      selectionType: 'singleCodeCursor'
      selection?: Selection
    }
  | {
      selectionType: 'otherSelection'
      selection: Axis
    }
  | {
      selectionType: 'completeSelection'
      selection: Selections
    }
  | {
      selectionType: 'mirrorCodeMirrorSelections'
      selection: Selections
    }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogAsAJgA0IAJ6IAjAGYaAVgB0gwQE5Zm2dOkAOYQtkBfI+LQYc+JdgiYwBAMph2AAlhYw5Tt1oMkIFjZvHn8BBEEFXSUabQMANlk1AHZBRKTxKQRpYTjpJTikyI043TVpAsETM3QsPChrW3sAETgPLxcWPHZfXkCOLhDQMNk45QUaJN0J1QUFQSmFDJk5KJy1OLjUueFhNWEqkHNaqxs7Ahb3O3bIGB7-PuDeYY3oybkkmkFRwSTkpayaNJBEpdAktoC9mV9qZDjVLPVTs1WldXCQ+NhYHdmKx+twnohZElhEpCjQyXthElRiM4v9SnkIkTFCUtsYYUd4Q0zk4UR1UF0sQEcY9QkJFEpyr8NNI1KUkuVaZIhMIaCopkltHt5Do2dULHUufYeZ5XDcwIKHgN8eEaFF5qlSqC5n8lQhNsD3bppBM5HNBNIDhyDYjHG1UejMfResKraLwrJiXEaBo9uMZTQ4mp-nMojLymoFMIgQoSrrYfqTo1Q7yAGYkSgWmN4uOCW35MkiEbyDSA-5U2Qg9bSSJJkqFXSBuHBqsAUVw7DAACc3ABrZzkAAWjaCsaGMmSwJyn0JlMM5TErp2eV0GuT+iLih+cUnFYRs-nS9X6630j82J3zZ7m6ugDm8yTejQwheosroiKqY5pF83pEtCerHG+ZwXGGLh1g2Ub3E2gz8ASHz5Am+gagWN5fP82pKISxSJCI+iZi+6GGtWJouCQmCYNuuJEWE-oDjsoyTHBiizP8KrAnscTCPaDoKN6qHluxIZYbyPF8fh-4Cdasheiomwgb8kE6IqmRGYWZIxHo-pfDEbGciGYB8Owi4AK4YC4XRgPO-EikB6jEnI8myD8sy7BEgj-MON5KGoyTURFIFepU7JTpWZxuR53lgL5H4Bb+0YAYJQhlIO7pFiqgLejBmRAkZhLegkey2vMqlBlYDhruwm7EGQlCYL136BbuxEIAY2iJbopSyOMpTJIYcUTKFoxOlBtplEkzkGqN-UbkoB2bgAklWxrtJ0AW6UKZXWrsmwkrshmyrZw7pK6VJxCCESUoSqQiLMe09X1m7HWDG7ndy2HuFAAC2-ndLdlqAZNj3AkSGiOu9lmIAkxKFFsN5yHsPwg-UJ1HVT0NIpcXHXcjf53fpca7EWJKFiBFLrL2rrjMCCzaKON4gRTEPfhLh20+cyJcXDiM3czqPlVNZQDh1oLZDKj20US9FlJEHWyjJz6Za+UvgzTs4AI6edgTAuOwqCoDpyuEda-rSEkEpyPFbXbP8ZQ-eUGayix2giOLVOW1Dtv2478OoAAbgVzuu+NaNCUCPsTPKRNJETWaujo3oqJMIx6M6qbR5Dscy04rj014AyZ6r2oDiMOy6CWtn6EH5QSkm8qRd6XoBub7Ex9bZzICQa5uGACNIy4qeLpw5A8W3D1zaqajJnoNL6LoNEl7sPsRIZbUxPo6i15LM-2HPC8KyvG6oIu2AAF7cOwW8ox7NmoJgSaHUP6ZMHwDCxRLjKZQmYCytjJCqdYu1J6cmnpDGWRBuCwA8iQPALh36fx-vOHiLgIAYj-hQc0AD7pAP9PRDUxZC4OVPo1HuqpdigiHBqEYJ976HXrlWbBuBcGLnwbgVeS4N5kIobgoaND3Z0KAlBEsSgoJ8PHDEZMeMshEh9lSDUUx1DDiLBlNC6C66P2IDgvBBCyBQDsNvNmPYSRAg2BEb2rZUhxSHEoNMhcIrykkgoARVtMHCNseIghdh8DsC3LQ1mKiyb5HWDMH0cxpDSQmBrbIuQRgKH3jXNB+0rERLOCIsREjCEf2-r-bSEhuI4CgLgZxKie7EkiJ1OQj1NgNRkIglQ6gShJllEmeYYTqblPsJUuxki14yN4o0ni2AWltPRtwiUhSiyzDJNSOK4w1AklSAkD4cxIKgkmUIipUTqlgDtmQ2JUB4nrLCFBEC6ivbDhKAWHQ0DGq5GBF0lYIgqQqSuQAGTwAVAAKi7TABAZx2wdi4JOqcnbwteUIGK9FyIxHknseqQdEgShPB8A88xCiQuhS4OFrslAAAV+TzhcAAQQgBgCABB2UQD5AKRJQVJqHKiJMEoKoT46AvJkD4A58wpCfEmeQoSSmg0llC3AsL4XHSXorVwPLIDco5XypWpUklCtAdEAsSUjY3nkv8eSyhUgyiJAoIkPcUjUo1bSrVThl4sv1Vy7B8MmB2AXC4SwijTWCrCFFTh8wyTzSpFK-G+8JTSgKPKQw5i1KWLVTSulmBtV+r1Ryg1SKE4uA1QAdwxRnAVE0Y0JkTMOQli1EjJoQDZdRiggSSrAZ8T1mr6WnVwBwAgWLwg-AZB8X4OQFqlzpOKaY8hNRQOBiqymdd1VDsLSOsdVASoEWUZNGYDJSiGDUF8YQC0+xQQNgkHUgJCgGEHd6+lAA5VALgmVdFgIa3ljMJ2dWJNoMkw4ySFzmrekOXxhZlDgiMK5rKq34NcEQuppDMDkMoQowqNZUAEAgNwMA1hcDJ1QGuJQMB2AAFp0MkL-pgGjeB8MTsMspaIDpnWqEvQYOKJMQQOsg-MWYpQkMoY4DU4h9SsNyKoZQPDBGlyLg-koENJB2D4cXPDKjzg6O1IYzxZjuBWP1qzgSHueR5R6CLAtSCsx-kyBAsCRQMRdkJgzIkcTqGpHr2wJvWTOHqGKcI8R0j5HKPUZows-zRmWOoDYz3H6CZMz6PkgYdYcUUg+w85e0xC1z7eckzFgL2H5HBfiwQZTqn1OaY-jpqLJW4smYS2Z9uSX6JrDSzsQpuj8xHP0Mmf04zRllm6puyWyGfMOLsCFojGrwsUZI1FmbYBjOmaUWa4YoIByOjmIWTYwdPqZFqlES99nIjzo+BODdsclBTck6tkL1XFxqcwBprTDW9OrfW61zb0aLOjHooCQwXoDDusc1kdYRzsiaAUpCfQ6wiuuCefEubYW8AReW3p1HG5fuJfktELhnxvbB10NJd4rx5BMnATnZH4b-LPI3M9xcKnXu1c+7p2juP8dtYMqCRMyQqReg1KkQo2TL35BQqoYc4wK6TMrV+3CRpsLK4neKvIRSVQqiTJBWQ-xWyyrBOJfsJYNjixIBJzg+BF4ogGKGJuYZW587jDoDMiUIrDhlMJAsfWSzKHMgtUoPbn3i03J4FcdRbcmntxO2XUQExhUzKoksHbvk+0pHIJ8GYpjm9u+H8gkebfN2COOw9ekAdZFmHAocZQCzXqpHFCIdoOyeexoyEwMJcA1HgP4cbUaG2IBo7omjyhkjWt5sOUDmxxaIgH+Z8IhOL0ZipOBME+uS5dglLsckeh0qaEmfP1WCkPnhw0ItJKhQN8ncJIOeK16FK-DmmbCxpSH7TKPw9cOiUyhAmSBsWdY7GQCYH6KCImbIJBUBV9AtT-FsTUWaK1QsTUPQA3BMEkEPECdtBIMbLKCbQRbdN9QtJoYjWAoCV1fQRKPpBII2JA29ZQRIbAjYT4SCX4aArVH9f1UtCAUgk9AsZQX4K9XYCA3IaDfIWDE-KkSIeUNg+lX1XVNlLgngxtOQNNbQJaCIMkKSL6HIMQgmSlDaaQ27GOAggtJQPddgJQoQEYH2WURA69PMcnbQzhXpNzQwP0GQwtT9b9ZldgXvCvQfRfWUEEUBSkX4e-UQzYB9TMIEFURDIwuuNAdFGAo9LbbFVIfIKYWBfeCYV1VaUERKCuSIP0UItQenejGTMreTAqeLSwhACKWYEkeUdKUYGUAsfjL4fxOaYZQyArUYenJrQLcrBTGolIyvCKTMFQfeE+S9QoZSTYLLT4dRAoQkJo20HPenJ7EY-whfVKYkXmG8DQFYwOEudYDWAoHtRPA45VV-VVQRB7FHRnNHLYlmMYn4AxCKVsb2Iow2CXPINzQ+RIFqLqXA2ORXHCesMAWo9YEVOzPQOvcYO1WCCYA2E+HRN3IsC3K3KPEvCaFWa0aiSg67bZaCAoA5BKS-FKeYQyIEMPDcCPbEp3NGPE13bQR1TaQwVzIEa-GQSIEDKkT4VsEkhSTvIwIAA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: {
      guiMode: 'default',
      selection: [] as string[],
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      selectionRangeTypeMap: {} as SelectionRangeTypeMap,
      sketchPathToNode: null as PathToNode | null, // maybe too specific, and we should have a generic pathToNode, but being specific seems less risky when I'm not sure
      sketchEnginePathId: '' as string,
      sketchPlaneId: '' as string,
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
        | { type: 'Enter sketch' }
        | { type: 'Select all'; data: Selection & { type: 'all ' } }
        | { type: 'Select edge'; data: Selection & { type: 'edge' } }
        | { type: 'Select axis'; data: Axis }
        | { type: 'Select segment'; data: Selection & { type: 'line' | 'arc' } }
        | { type: 'Select face'; data: Selection & { type: 'face' } }
        | { type: 'Set selection'; data: SetSelections }
        | {
            type: 'Select point'
            data: Selection & { type: 'point' | 'line-end' | 'line-mid' }
          }
        | { type: 'Sketch no face' }
        | { type: 'Toggle gui mode' }
        | { type: 'Cancel' }
        | { type: 'CancelSketch' }
        | {
            type: 'Add point'
            data: {
              coords: { x: number; y: number }[]
              axis: 'xy' | 'xz' | 'yz' | '-xy' | '-xz' | '-yz' | null
            }
          }
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
        | { type: 'Constrain equal length' }
        | { type: 'extrude intent' },
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

          'extrude intent': [
            {
              target: 'awaiting selection',
              cond: 'has no selection',
            },
            {
              target: 'idle',
              cond: 'has valid extrude selection',
              internal: true,
              actions: 'AST extrude',
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
                target: 'Await horizontal distance info',
                cond: 'Can constrain horizontal distance',
              },

              'Constrain vertical distance': {
                target: 'Await vertical distance info',
                cond: 'Can constrain vertical distance',
              },

              'Constrain angle': {
                target: 'Await angle info',
                cond: 'Can constrain angle',
              },

              'Constrain length': {
                target: 'Await length info',
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

          'Await horizontal distance info': {
            invoke: {
              src: 'Get horizontal info',
              id: 'get-horizontal-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await vertical distance info': {
            invoke: {
              src: 'Get vertical info',
              id: 'get-vertical-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await angle info': {
            invoke: {
              src: 'Get angle info',
              id: 'get-angle-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await length info': {
            invoke: {
              src: 'Get length info',
              id: 'get-length-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
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

      'awaiting selection': {
        on: {
          'Set selection': {
            target: 'checking selection',
            actions: 'Set selection',
          },
        },
      },

      'checking selection': {
        always: [
          {
            target: 'idle',
            cond: 'has valid extrude selection',
            actions: 'AST extrude',
          },
          {
            target: 'idle',
            actions: 'toast extrude failed',
          },
        ],
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
      'has no selection': ({ selectionRanges }) => {
        if (selectionRanges?.codeBasedSelections?.length < 1) return true
        const selection = selectionRanges?.codeBasedSelections?.[0] || {}

        return (
          selectionRanges.codeBasedSelections.length === 1 &&
          !hasExtrudeSketchGroup({
            ast: kclManager.ast,
            programMemory: kclManager.programMemory,
            selection,
          })
        )
      },
      'has valid extrude selection': ({ selectionRanges }) => {
        if (selectionRanges.codeBasedSelections.length !== 1) return false
        const isSketchPipe = isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          selectionRanges
        )
        const common = {
          selection: selectionRanges.codeBasedSelections[0],
          ast: kclManager.ast,
        }
        const hasClose = doesPipeHave({ calleeName: 'close', ...common })
        const hasExtrude = doesPipeHave({ calleeName: 'extrude', ...common })
        return !!isSketchPipe && hasClose && !hasExtrude
      },
    },
    actions: {
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
      'sketch mode enabled': ({ sketchPlaneId }) => {
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'sketch_mode_enable',
            plane_id: sketchPlaneId,
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
      'hide default planes': ({}) => {
        kclManager.hidePlanes()
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
        sketchPlaneId: '',
      }),
      'set sketchPathToNode': assign(({ selectionRanges }) => {
        const sourceRange = selectionRanges.codeBasedSelections[0].range
        const sketchPathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          sourceRange
        )
        const pipeExpression = getNodeFromPath<PipeExpression>(
          kclManager.ast,
          sketchPathToNode,
          'PipeExpression'
        ).node
        if (pipeExpression.type !== 'PipeExpression') return {}
        const sketchCallExpression = pipeExpression.body.find(
          (e) =>
            e.type === 'CallExpression' && e.callee.name === 'startSketchOn'
        ) as CallExpression
        if (!sketchCallExpression) return {}
        const firstArg = sketchCallExpression.arguments[0]
        let planeId = ''
        if (firstArg.type === 'Literal' && firstArg.value) {
          const planeStrCleaned = firstArg.value
            .toString()
            .toLowerCase()
            .replace('-', '')
          if (
            planeStrCleaned === 'xy' ||
            planeStrCleaned === 'xz' ||
            planeStrCleaned === 'yz'
          ) {
            planeId = kclManager.getPlaneId(planeStrCleaned)
          }
        }

        const sketchEnginePathId =
          isCursorInSketchCommandRange(
            engineCommandManager.artifactMap,
            selectionRanges
          ) || ''
        return {
          sketchPathToNode,
          sketchEnginePathId,
          sketchPlaneId: planeId,
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
      'AST extrude': ({ selectionRanges }) => {
        const pathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          selectionRanges.codeBasedSelections[0].range
        )
        const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
          kclManager.ast,
          pathToNode
        )
        // TODO not handling focusPath correctly I think
        kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
      },
    },
  }
)

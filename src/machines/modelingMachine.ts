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
import { horzVertDistanceInfo } from 'components/Toolbar/SetHorzVertDistance'
import { angleBetweenInfo } from 'components/Toolbar/SetAngleBetween'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

const constraintActions: ConstraintType[] = ['vertical', 'horizontal']

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogAsAJgA0IAJ6IAjAGYaAVgB0gwQE5Zm2dOkAOYQtkBfI+LQYc+JdgiYwBAMph2AAlhYw5Tt1oMkIFjZvHn8BBEEFXSUabQMANlk1AHZBRKTxKQRpYTjpJTikyI043TVpAsETM3QsPChrW3sAETgPLxcWPHZfXkCOLhDQMNk45QUaJN0J1QUFQSmFDJk5KJy1OLjUueFhNWEqkHNaqxs7Ahb3O3bIGB7-PuDeYY3oybkkmkFRwSTkpayaNJBEpdAktoC9mV9qZDjVLPVTs1WldXCQ+NhYHdmKx+twnohZElhEpCjQyXthElRiM4v9SnkIkTFCUtsYYUd4Q0zk4UR1UF0sQEcY9QkJFEpyr8NNI1KUkuVaZIhMIaCopkltHt5Do2dULHUufYeZ5XDcwIKHgN8eEaFF5qlSqC5n8lQhNsD3bppBM5HNBNIDhyDYjHG1UejMfResKraLwrJiXEaBo9uMZTQ4mp-nMojLymoFMIgQoSrrYfqTo1Q7yAGYkSgWmN4uOCW35MkiEbyDSA-5U2Qg9bSSJJkqFXSBuHBqsAUVw7DAACc3ABrZzkAAWjaCsaGiAKA4mMVkkUmlN0i1dwgT+Q18gvCh0KUpk4rCNn86Xq-XW+kfmxO7Nnuboaq8x6nvokyXpk2QRCSCh7BEXrXuMcSvsc75nDOACOACu2BMC4YB8Owi64Rg264oM-D7qBeibIC6gJhEsh0hmShFrIPxFpEvEKOhnIhjh+GEcRpHkeaf7RoB1FhAeEqgq2QIaMILF0iWJK+h8hQaPx7JTpWZwXGGLh1g2Ub3E2skEh8+QJpBiSnl8-zakohLFIkIj6JmAnTtyJkkJgmCUSKwH+gOOyjJMIhkrM0GICqwJ7HEqm6KosgXt60J6hhhrnMiJouIFwUWQBVHWhlDKbLo7k0EW5R0nkhZkjEej+l8MS+YZ9jCQRpnYEFzghbuNFupm8GJIk9WFKxrqMkohiUrMySJLKaH6W+eW9YRNYDXY3RSZZMnWhsagTSm02GNmbYxJSlLSFSKW-GWQZWA4a7sJuxBkJQmDvT+w1AaNBjaEosqlCetpqMkV2ut6RISqMTrCFM9JJF19T-Z9G5KFjm4AJJVsa7SdPOgPWQguybCSuwZbKLXDukrqPSCESUoSqQiLMGO4x9m68z+hP+by7hQAAtmAZOlUKx1xlTwJEhojoM4qmQJMShRbLo8pTT8PN4zjBtC0ilyFaT3TS5aQNhLsRbwSjU1U72rrjMCCzaKO2s1frfOG77xv5ab7SixLUv-jL5Vy2Uh5paC2QylTLkI4kw6o+o+ifOtOWcgbAvYwHyAkGubhgOLkuuAAbkunDkIF5PWijUxg8meg0voaWqzIuxJCohigokMT6OoPs-nnBNVoXxch+XLgbqgi7YAAXtw7B15bVkN4pblcWo-rJh8BiCP8OgFvk0NzC1KrrOjG25bnRuznhfXsKgqAleHVsU-6D0SnIqcJAWEQ-wyhxERhmcGORtAiBHtjMeG4A7bRcGLVAVcXAvzfvXFsQIe4THlJrJImssxwx0KqH4NVcgXnUKmGB-MH7+VcEHYImDgLagHCMHYF4kxkn0MA8oYD5Q-EfLaHQNC-aCyrEQbgsBSIkDwLPeeS8V6BRcBADEq8KDmnXrLYCDsoiyiJFxC86wSxHzhuoUBMRPi3RVLMHYoi4EB0kbgaRi5ZG4BcFXRcNdlGqOkT9TRH8N5ywfAtXIcwdC7FlJSY+iRcz6HWLdTQ+h7F0PsE4lxbiir4DsMw4GewoiahPBlGIpZ4pZAQnkIEWVOz1U0PYgAMngMALgAAqr9MAEEQcg1B6D37SUjmFCIwJNAoxKbbb0ZSUwSkJJSfeqhtZ6WzgaXOjTcDNLaW-JQAAFfk84XAAEEIAYAgAQQ5EA+QCi0QM0a4xZQklBBnNKES+wxERskVQj1LGLPLHfX2ShVnrPabjUuodXBnMgKco5Fyw79NCjc7u9ySgZlwQoFIZSUrEkLAmEGuwZTawaU01pQKnBlz2eCk5kixZMH2s0ywATYUjTCM6M6iRNjYOyLFf4JQzqZm0F7eYnw9gErWUSzZJLQUHKORCxBayADuaD2m5KZR7DiYI0rQ1TGIF2w4VCAnVLMVaqRhWAs2fjXAHACBKqED8Bk2lkonh0NINiyhpjyE1Ifbmt8c5-IBaKzASgzUWqoIdMqcKwgzAZKUQwu8Uonj7CjNy6xtByEBIUAwxq-VKAAHKoBcDsrosBIXnPNla8I+hiTaDJMOMkBDdC6HjaAoECR8xAhVCMexAAJBRy95w+LUf4pB6BAoEAgNwMA1hcAV1QGuJQMB2AAFo54Lx7avTA868A1lQKWjK8x8ioopGikYpiYKLRBMmVGuwRCFE7d2pRmAVH9o0YOiAw6lyLnnkoalJB2CbsXGLWdzhF23t7WujdW6rlhoJOqtyBhtY6APNoY+8wXU5FuQWVSIxvmvUxn8gAatXbAtd72+PUZQZ9w7R1rInVOmdc752eO8aB3Am7t0hKTPMSBJ9NBIZ-hqUYnEDVqE6l65ZeGCNEYfX4p9yCX0dLfR+r9P757-rowxwjgV13MfA4E7Ro0MqzHbBx5tMpuNw0JKqa8-GgRHpvkst6fz9nZOaTJijY7qPTvHXRsgUA7CaZYxBxlUHcgLUSRER8MpO5ZASFEfdqEEIYrrfYxzPnnNDrk4ud9i5P2YG-b+lTgHvO+bA6xlKYNhy5FTTKMpw49j5FbNDco2C0g8xnCRMiGAR1ubwDR8dRBFxgG-c0sS7X6VHWuXJUCR5NAQXPNVrieQDCIQiFV-JLW2sSU6U-US62KIBetl3eQurFAEMSmsLVmRd55BqvMj2Ko5CVBE1YVr4kOuIOGxJYNOnxsHdIbFE7nwzt0jtradKGVcjNuyj8zkz2RsBqJiZMyo3Q2Bai4WBSrdBPykiEDvIIPzPlHiO2x79QYcSWBSiAYLgABKA2IASFDK4Ej-jS0RZ7noJNrYeLY9dO3beqRqQJCrROYncCXC4FzYj6shVEelp4lEX4mY6rrCmDW4+VWQS7GWu3HiPMABie1nCdao91jzSg+sDYXP1QaFsvuQYQPKUBpI6qgkUF8LiwCND5GvCUpGXNbNQ4NPr63m2RJW-2iz68GtNjRsiMmEsTqXZUlvDNdQOR9Cor1wb9gIe+q7Wt59hl+2siR5JNHxyUwCy5H+GFsGS0mIGHC4oTP1u4fC0KmaFnJQYuMntLvVsyZq8Gb2IQhMswSFYYMvUIP+1ycmkpzTkgdOGcuFcao3CkZbco5VG2cHOwm2diIZkVFoCCgp+Sun-32GlDT+cLPrw8-af0+JqaaASOI5270I+aIXpAQlEboYMpQsPIU-EsGZf0JNEwGEcXDAeAfwbDQvCmedSLedZQZIDVTyOtOPX4HmREBA60L4TFAeAoTMB3LiWaGCLsCUXYckPQL0VIF6SfOBPAuWeYAccGXSKGGGcghKQkQcVOHICYe6B7OzHDUeVJZgnRcGMGMoZSR6X4aJOGCYUBFGTWDlOqTQYQgPezUeX1DZTACQ0aVIGUMGKNdDTUPQavSkZuB6D4coDQoTLOLQ0Q2BXQoFJoMdAwplQoCxY7JtY7eUeNZQVlPlHIFGX0DNPQ7ZXZMFKVCATwoQAsZQX4Ag3FFUKvZmHIOrdWeYKkU8AMEXFZQlSI8VGecleIhAQwOQCUaUUoXecYRQMpIkE-N3VKXIuDCIoFQNdgco-nHuWUAsMwvMetDIizKmJME8AA1QDozZHNPNaI2A5HIvL4O5GqLiSkX4fghtLIj2MoGKInEQuBJQNAVBPQno9KfIKYFbGtVFY+W0UBZIGqXiVQdYtQG9ZdO9STUjVLWTcoriQwNyIxGIDUUkJmGCVPGDOqGIVIH0YTA43OfDLxdTYjR9MjFzfQsbO3LiEoUvbWSxAwdnSLd4D0eJVFQEHICoJLJzcjdExYimQxVUEsWYEoFKVsDQ4+BCDWDMeQFUeJQkBgzaUnDAconQfQI7VFJkEQTMc7fcUEBaNKTDNFMoL0NbF7cdY2YUksKIEoPQSkCrIsBIHHOU0HOOCHFU2HZ-B-RfTIWk60B6dYDiIAsLCvbBIHKIa7EQBwtI3eM0snBfOncoosFUEEXIdQEsDMTUspXnd06glKcBTQq-A2MXCXesMAcoy7CUVsTYO6TOTYY+K+eCVMQEVFO6ZvfaYUtqUvFiAsCvePFyO2K9P0ITOtKKUs2-dUjElHcocUT4VFVsExITOQQfUBBs+vMfCZVs9gO-YIanR-YUmqHuAoF3EsQ+JMQAghCUAhQwVPP-DPEXG-Scv0609-LfIEN2HQH4XeBZUYNctnTcneNPAwG+EwIAA */
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
        | { type: 'Make segment horizontal' }
        | { type: 'Make segment vertical' }
        | { type: 'Complete line' }
        | { type: 'Set distance' }
        | { type: 'Equip new tool' }
        | { type: 'Set Default Planes'; data: DefaultPlanes }
        | { type: 'update_code'; data: string }
        | { type: 'Constrain horizontal distance' }
        | { type: 'Constrain vertical distance' }
        | { type: 'Constrain angle' },
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

              'Set selection': {
                target: 'SketchIdle',
                internal: true,
                actions: 'Set selection',
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
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain angle': ({ selectionRanges }) =>
        angleBetweenInfo({ selectionRanges }).enabled,
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
    },
  }
)

import { PathToNode } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { DefaultPlanes } from 'lang/std/engineConnectionManagerUtils'
import { isReducedMotion, updateCursors } from 'lang/util'
import { Axis, Selection, Selections } from 'useStore'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'hooks/useAppMode'
import {
  doesPipeHave,
  getNodePathFromSourceRange,
  hasExtrudeSketchGroup,
} from 'lang/queryAst'
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
import { extrudeSketch } from 'lang/modifyAst'
import { getNodeFromPath } from '../lang/queryAst'
import { CallExpression, PipeExpression } from '../lang/wasm'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

const constraintActions: ConstraintType[] = ['vertical', 'horizontal']

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogAsAJgA0IAJ6IAjAGYaAVgB0gwQE5Zm2dOkAOYQtkBfI+LQYc+JdgiYwBAMph2AAlhYw5Tt1oMkIFjZvHn8BBEEFXSUabQMANlk1AHZBRKTxKQRpYTjpJTikyI043TVpAsETM3QsPChrW3sAETgPLxcWPHZfXkCOLhDQMNk45QUaJN0J1QUFQSmFDJk5KJy1OLjUueFhNWEqkHNaqxs7Ahb3O3bIGB7-PuDeYY3oybkkmkFRwSTkpayaNJBEpdAktoC9mV9qZDjVLPVTs1WldXCQ+NhYHdmKx+twnohZElhEpCjQyXthElRiM4v9SnkIkTFCUtsYYUd4Q0zk4UR1UF0sQEcY9QkJFEpyr8NNI1KUkuVaZIhMIaCopkltHt5Do2dULHUufYeZ5XDcwIKHgN8eEaFF5qlSqC5n8lQhNsD3bppBM5HNBNIDhyDYjHG1UejMfResKraLwrJiXEaBo9uMZTQ4mp-nMojLymoFMIgQoSrrYfqTo1Q7yAGYkSgWmN4uOCW35MkiEbyDSA-5U2Qg9bSSJJkqFXSBuHBqsAUVw7DAACc3ABrZzkAAWjaCsaGiAKA4mMVkkUmlN0i1dwgT+Q18gvCh0KUpk4rCNn86Xq-XW+kfmxO7Nnubq6AObzJN6NDCF6l6ZCIqpjmkXzekS0J6sc75nBcYYuHWDZRvcTaDPwBIfPkCb6BqBa6CkiqZNqSiEsUiQiPomavhhhrViaLgkJgmDbrixFhP6A47KMkzwYosz-CqwJ7HEwj2g6j5QRxnIhthvJ8QJBEAUJ1qyF6KibKBvxQTodGIMZhZkjEej+l8MTqdOZxgHw7CLgArhgLhdGA86CSKwHqMSciKbIPyzLsESCP8w40UoajJDRqTzEZQIuZWbked5vn+YFf7RoBwlCGUg7ukWKqAt6sEyPMeSEt6CR7La8xoeWnEOGu7CbsQZCUJg3U-kFu4kQgBjaEluilCetrJYUsjxRMYWjE60HzdISRZfUw29RuSh7ZuACSVbGu0nSBXpQoldauybCSuxGbKdnDukrpUnEIIRJShJpQYCg7YdPWbsDP6ndyOHuFAAC2AXdNdlpAeN93AkSGiOq9VlujehRbDRch7D8QNHQdpMQ0ilw8ZdCP-jdBlxrsRYkoWoEUusvauuMwILNoo40aBJMg2TwsU+cyI8dDcNXXTSOlRNZSHro8y5EWkLY4SxKJAlbWynJcRCz+YP7WLM4AI5edgTAuOwqCoLpstEda-pbRKcgJS12z-GUX3lBmspsdoIiG-txsnbOFtWy4MOoAAbmANt2w7xUMyFQJJK88p40keNZq6OjeiokwjHozqpiHoPk2dzhuGGAyjcjwyAgOIw7BeSZkvo3vlBKSbylF3pegG7JTlYpNhxuYvICQa617D8MuPHi6cOQfEN-L0FTElyZ6DS+jK9j2TJCohigokMT6OoFci+DVbT7PUsLxuqCLtgABe3DsGviNO4zoLApodQ-pkwfAMHFfOMplCZgLK2MkKp1jbRHm+CeE8xZEG4LATyJA8AuGfq-D+84+IuAgBiL+FBzQ-1un-RIJJkwZW7LKJa+d9BQKBPoTQM1MzDmvqgqs6DcCYMXNg3Ai8lwryISQzBA0KGOyocBaCJYlDQRGDRSIMRkyHyJBnKkGopjqGHEWSoSCurC14WcfhgjhG8XwHYded1ITRH9OMKCcxAQxHiq1R6fpVBwMLAbYxnJx5V3MRgrBOC7D4HYFuShqcUZamiNeDaUwvQ-FkjVJQswCg5EpBsX4HUgxj1McE+wFiwkiLwe-T+OkJC8RwFAXAdi-6FgycrfQch7qbDqlkWBKh1AlCTLKJM8weHFOIKEoROCl7iP4jUvi2B6mNPkaCNQEoFB7GHM46k8VxgrJSF2D4rjoL+PQoEopos+HjKsWAC2RCIlQCiYslGM0xIu2HCUAsOhwGZHKECFpollY5O9Pk0eu1TEABk8AJwACpJwIObS21sY7x0TvbR5IlYqMQojERS6zFDexoe8SkIDVCqJ4RC3A0Kk5KAAAr8nnC4AAghADAEACBMogHyAUMTgrjR2VESYJQVTKx0GID6MRe7JFUJ9dRgMAkGnHuSyl9tDpgHnvS9lkA2XMs5TLFOPKwiGEitEAsyU1E0UUv8RSyhUgyiJAoIkF4UhkshS4GFyqnBqtcBq1l6CYZMDsAuFwlgZF6rGga2ySj5idw0FSUVmRMyqhlHzHOw5IrOopa6qlHrpZeuZZq+FUcKUAHcUXJ0InI3lCZEzDnWeMNmcbEARpVI+F2Sk1CtiMSc+V4KXVuswEoY6uAOAEDRUIH4DIPh5ISI+HQdJxTTHkJqMBsx01Kv7YO4dVAirltieix8aoCwsQil0h1jF1jaDkICQoBhV2ZuVQAOVQC4WlXRYBao5TTUd4R9Ba0gsOMkOcZp9hyBKL4fMyjwRGDwhlRbsGuAqQQr+mBiGkOkX5XANZUAEAgNwMA1hcCx1QGuJQMB2AAFoENVMwGRvAmGv1GXUIxKY-tIFcPiqCLW7a25fCUkCMsBTQVGxg3B3BL9KmEOQ5IshlB0OYYIEuRcL8lD+pIOwTDi4YYkecBRsTiG+I0Yw6gejF5VSfCmFtXIVJIjsd+bkOhgJm2FDUNB2DHBRHL2wKvSTqHyGyawzhil+HCPEdI2RqZnn9O0aM9ysNBJ26MTWFoxSBh1jxRSBnBMyYnHXkLMkFzInwteZQ1I3zUX5OLkU4uZTmBVPqc06FwrkXDPGcUQmTMSWdhrMPtAkE8D-RDIGfxkFKDhNubIFAOwfnsO4aC0RvDoXxt2AM3RmLjc4uKSUZNL0ZIDGUg8SUXuiQchUlSCUfLY2bEJzKwppTKm1Mv3q9pxbYBlvRdkbu9bA4Eg5xLMlyk71vkUk23MJ8+9fjndcHcqJU2At4bwMF+b2mocble8ZpMjFfuJDKPalIaTCj5C2g5NaSZh5dsKUJ1zkOAr3I3FNm7VW7t1a0+R5HqPVvyyMrkBJTltYdkimkzQSjygngKESDYsqyeCf2i4XAT68JGhwvLr9RZQRnuyL8SUnw8WukSAOL4BM9henWK2RBkulAkEp3UWuKIBihlcFTLw9d2fWh0BmJKkVhwylEgWQ+JZlAWRPKURQW1CxA03J4FcVuHfBBHc7uMGyogJnCpmBRJYG1ZBLBnSkcgfj8wzMczqnJw-kEj-ga3Jpbdbve-qmQswoFDjKAWa8VJ4oRDtB2DMuvlb2pMDCWXGB4D+AE6GtbCAyPYzI8oZIC0EwfCBZKoGiIR-yx4xk8+BR2vC9SPFLsEpdjkj0CkzQ19l93XStNWadaFqGFkoSQcb1oo6A+SM85dhT+MwDklMoQJki5L2ADmQCYL6aCPGbIOBQBW9Ptd-EKTUaaE1QsTUPQf4VIYkA5coVmPQJ-AvATFBRVO9ftJoXDaA3lM8JKTpadBYa8YDZQRIBIGkLXSkZzOVcnUOPAvtGlOlXNFlYgkSAsZQX4HjXYMA3IYDL6TYBIJSc1U8UnQvbtI2NgrNVVHNRlPNCAHgxtbQAcJNPQZKCIMkGSD6EDcQhMeYKzAmSAqlDddgdQ+MAoOAtZBAvMXQYDVUHYdYJME8QwP0Cwh9J9F9ecQffSGvcITMKIUCSKf7bHLuQwsQsDfMIEFUKDZgqXUGNAZFKAndYI1QVIfIczE1ADe1ZaVXFKQPP0SIiHUTfBKjYraTK7QzGwyKOYCUW0RQQEAWTQAArINpbeHjE8AOPpCoxrbzErGTKLBor4FZdQXWKKR8TYNLT4JRA8FNZJDMCcZIkbSnaxCbOozDcY4yEA+UcYPZQ+IHffVCAwFCAoCo5HPzcYqkaIVWP6D5ZILpFUXYDJPJDmEVAOa+GXOXesMAGw9YflOaHQyBDMdPE3M9ZWDRV3IsIGC3ODKPOuZGOWa0VKMgj4C8Q3N5TohKDOBaVKSKUCFJMPDcCPZEm3VE3+YCd2a1daQwVovjbZfQRiKkT4VsGCRSIxEwIAA */
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
        | { type: 'Set selection'; data: Selections }
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
              onDone: 'SketchIdle',
              onError: 'SketchIdle',
            },
          },
          'Await vertical distance info': {
            invoke: {
              src: 'Get vertical info',
              id: 'get-vertical-info',
              onDone: 'SketchIdle',
              onError: 'SketchIdle',
            },
          },
          'Await angle info': {
            invoke: {
              src: 'Get angle info',
              id: 'get-angle-info',
              onDone: 'SketchIdle',
              onError: 'SketchIdle',
            },
          },
          'Await length info': {
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
      'sketch mode enabled': ({ defaultPlanes, sketchPlaneId }) => {
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
        sketchPlaneId: '',
      }),
      'set sketchPathToNode': assign(({ selectionRanges, defaultPlanes }) => {
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
        if (pipeExpression.type !== 'PipeExpression') return /// bad bad bad
        const sketchCallExpression = pipeExpression.body.find(
          (e) =>
            e.type === 'CallExpression' && e.callee.name === 'startSketchOn'
        ) as CallExpression
        if (!sketchCallExpression) return // also bad bad bad
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
            planeId = defaultPlanes.getPlaneId(planeStrCleaned)
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
      'Make selection horizontal': ({ defaultPlanes, selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(defaultPlanes.planes, modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Make selection vertical': ({ defaultPlanes, selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(defaultPlanes.planes, modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Constrain horizontally align': ({ defaultPlanes, selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        kclManager.updateAst(defaultPlanes.planes, modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Constrain vertically align': ({ defaultPlanes, selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        kclManager.updateAst(defaultPlanes.planes, modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Constrain equal length': ({ defaultPlanes, selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintEqualLength({
          selectionRanges,
        })
        kclManager.updateAst(defaultPlanes.planes, modifiedAst, true, {
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

import { PathToNode, VariableDeclarator } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import {
  Axis,
  Selection,
  SelectionRangeTypeMap,
  Selections,
} from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { isCursorInSketchCommandRange } from 'lang/util'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { kclManager } from 'lang/KclSingleton'
import {
  horzVertInfo,
  applyConstraintHorzVert,
} from 'components/Toolbar/HorzVert'
import {
  applyConstraintHorzVertAlign,
  horzVertDistanceInfo,
} from 'components/Toolbar/SetHorzVertDistance'
import { angleBetweenInfo } from 'components/Toolbar/SetAngleBetween'
import { angleLengthInfo } from 'components/Toolbar/setAngleLength'
import {
  applyConstraintEqualLength,
  setEqualLengthInfo,
} from 'components/Toolbar/EqualLength'
import { addStartProfileAt, extrudeSketch } from 'lang/modifyAst'
import { getNodeFromPath } from '../lang/queryAst'
import { CallExpression, PipeExpression } from '../lang/wasm'
import {
  applyConstraintEqualAngle,
  equalAngleInfo,
} from 'components/Toolbar/EqualAngle'
import {
  applyRemoveConstrainingValues,
  removeConstrainingValuesInfo,
} from 'components/Toolbar/RemoveConstrainingValues'
import { intersectInfo } from 'components/Toolbar/Intersect'
import {
  absDistanceInfo,
  applyConstraintAxisAlign,
} from 'components/Toolbar/SetAbsDistance'
import { Models } from '@kittycad/lib/dist/types/src'
import { ModelingCommandSchema } from 'lib/commandBarConfigs/modelingCommandConfig'
import {
  DefaultPlaneStr,
  sceneEntitiesManager,
  quaternionFromSketchGroup,
  sketchGroupFromPathToNode,
} from 'clientSideScene/sceneEntities'
import { sceneInfra } from 'clientSideScene/sceneInfra'

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

export type ModelingMachineEvent =
  | {
      type: 'Enter sketch'
      data?: {
        forceNewSketch?: boolean
      }
    }
  | {
      type: 'Select default plane'
      data: { plane: DefaultPlaneStr; normal: [number, number, number] }
    }
  | { type: 'Set selection'; data: SetSelections }
  | { type: 'Sketch no face' }
  | { type: 'Toggle gui mode' }
  | { type: 'Cancel' }
  | { type: 'CancelSketch' }
  | { type: 'Add start point' }
  | { type: 'Make segment horizontal' }
  | { type: 'Make segment vertical' }
  | { type: 'Constrain horizontal distance' }
  | { type: 'Constrain ABS X' }
  | { type: 'Constrain ABS Y' }
  | { type: 'Constrain vertical distance' }
  | { type: 'Constrain angle' }
  | { type: 'Constrain perpendicular distance' }
  | { type: 'Constrain horizontally align' }
  | { type: 'Constrain vertically align' }
  | { type: 'Constrain snap to X' }
  | { type: 'Constrain snap to Y' }
  | { type: 'Constrain length' }
  | { type: 'Constrain equal length' }
  | { type: 'Constrain parallel' }
  | { type: 'Constrain remove constraints' }
  | { type: 'Re-execute' }
  | { type: 'Export'; data: ModelingCommandSchema['Export'] }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Equip Line tool' }
  | { type: 'Equip tangential arc to' }
  | {
      type: 'done.invoke.animate-to-face'
      data: {
        sketchPathToNode: PathToNode
        sketchNormalBackUp: [number, number, number] | null
      }
    }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AdgCsAZgB04gEyjhADnEA2GgoUAWJQBoQAT0QBGGuICckmoZkbTM42YWKAvk91oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBFtpGhlxDRphGg1ZURlhXQMEcRLDSVF5UwV84XEK8Rc3dCw8KElsCEwwHz9A4NCuXAjeGI5B3kTBLWFJDWV5hVSZZTrlBUKjS1FZiUrDeWVDasaQdxb8ds7ugFFcdjAAJ0CAaz9yAAthqNG4iaF07bCNLiRYlGiZUyZDbFYQzfIaLSQ5Sw0TGZQnM6eNodLoEW73J6wV7sD5UQyRZisMbcP4IQRrGiSdRmfIqUxrCrQlbKcoQ4RHDTWUx5DHNLGXXHXPjsB4AVwwX0psXGCSEEhmCJW4IWq3E0KscyZphspiswg0og0sNFHlakm8xI+xDIlEwDren3oIypv1VCEMRx5xnNWjUJlMsn1RzKAfUAfElgUogUNvObXdJPe9sd7wAklcegEgl0BuEvd8fSrQIlDOayhVhByk1Z5vqIRZBTRRBHLXIk6nxRmPtmPfnccgSK8+lAALZgO7+ABuj045BImEV0UrNL9VlNkiOMk0jc0qQK+iMGkMUgT4LkEnySg0A7tQ6zb7H3QnU6Cs-nAXeVAHmwAAvbh2HXTcfirfgjHhSRVAUVRUTNZEZH1cQA3KC0skMFZjAqGQXwuN8R0zT9iG4WAZRIPB-EA4CwLudd-AgbBqJdMAoO3eJqzgy0OzSGgqnSU11GhNJ2QsCpRHBC1TWvYj0xzMiPgoogqJoujlweVcWLYjiKC48slWpXjYP9ZYFEkYUj1RZQrzUQUJNZcprAFWEgWUS0lNU98c3UzSHlo3B-AAQQAIW8fwAA1uOVHc+MspNZnEMRDBsTCZFsPULwQbKBOFZFFlSbtagaVxTjFV8VI-AsNNwajgroyLooATXiszaSsFLrDsZQ5H2byBuhBN1EkIEZLwtQQ180i6txBqmpC-wyCgLpOt9JLrxyaQlGqJNFFrUwJNkuFk3kFFkVMUxhDm2qAvqoKVq6fB2E9CktwS8yaxKGYVFEVRTVkTDRAkw5rMbY1joRJRkXuj0-MCxqtNCphHnR3A2PIWVMBIJ4DIgozNpgmsZCPWYbqyjJAxoZQJIUDKJsMKpbqBBErVEBHMyRp6Uea0KGNA8D10wPRVpwKAhhMr6ut3ZYZCZZMtAkC0MhWfV7MkArjyBMQVgqppbRIh7Rz55btJXbA10wMWJewKWScSiyzXMHIj2EYU8LMVF9QG7Zk1uqo1myxxDaq43lMRhbuiW1HAlwEgmH8dhUFip2fqMTCpGWEE1Fu6ozAk7JFfJwH5mQxxye54cY8o-mVtgRPk9T-wOpl6Dnd+68LEbTDYTS4wNAkjKZktKvu1rOYchr-yzcW566LAABHWUWNeqB3oz7rsqkVErU9rI8nVfVakZHITHBLthtMWfeYXhu6KYfHReoDueO62QZiWfDu3SKf9QRm-qUQ4N1MhqC5pVTENVo6PQfhbUKDwwAzlQMufw5BF53FgNveWWgEIGkBkeK8yZcpFCOJhCweFbDZDBEhIiUDqom1gfPboAAlMAggwB8BCLKe4ODtp1CkNeFmCY0ic19nldQit0ipGRBXOGhg7512uKvbAycAAyeAwAp1QKgDc79vrdQUFJCQKgTSq3EpIuovJ2ZlzmChJRcCbiqJbmtf82AWL43IDo-hFl+rWRBIDTC3lFCCKjJYCaaxkKhM1M+Bhkc-KSDCgAd1ogBICwtmKYFYuxImlB-B4AAGaoAIBAbgYB2i4EXKgV4kgYDsEEELJiEFMCCCKagXxiQhIaFmNPYStQboDwklecwSYjxpCoXIeG8S0yJJSWk+iGTmn6VyZxApuBikEEeA8ICkgmB43YMUh4M46l+EaUskWrT2mdMQEJbYAYETxgtEeW6EkQSK2yHTcEdR8iHDvvMjgS4rY2xyYZfJ7TSnlMqdU2p9TBA6T0lcjZHSDFyyShMxW14jomGRCzfILklBMjEHIOwpQgT-NSYChF1sVlgu0RC7Zuz9kkEOUBE5cLqU2zacim5+UspMi7GIU0YhNAuUFAeYaqQQQHSUBShZrVYrrM2WU3AFS8AwoqXCkgAAjWAgg+DcuKbyiZPJGwyDvHIOo6w8rZQGgeDIV4HKyAGrUOVgKFUxSVSUxlDw9kHKOeys5Oq9UGuuairafj+6pWlXUSE48JKmh5Fa7ymFsjmlvjMwcKkAUBAVW1L1kLVXQpqZqoNurBB6ENSiz6ndM58rwtIBsFRbBAItKNOmGpWayRIV2OJRtZmkRzeFKKbcC0+r9SygNpyGnBorVW41UazwrC8isR1o08I9LpuyAag00r0P7VmxGQ61pdALSqtVVSS3TsECejhYaa0fz9BM-6lhrzHxuhIoo94eQRi7K+ioSFrSZpgTzY9+BT0MoeDs31zLWXHOvbe+d4bSa3MwpDbIPUrD51rKdWsB431ZDkF2ZYd1gNMNA5SgIG93pnqheqq9cLqPvCQw+wxT7QapUklec05r8U2o5BYA2tYVC1isG6qj85N7vDHVBpl-q2XXqYyx70bH0XBIPN85MeFjzoX4+K+Y1hjGcyuuJ-w6MHiY2xrjfGoK8n0uRYWi9Grr3mcs9bazDxBCE04spisqm-EKxsiQ6wO6Q5gxtdUbYg85jeQ-Za0zrn5xWbxgTVZRkZPQYnXBwNDTEtY3cylrzaXKC+dMhGrpgXhRKBC+TMLElPLSH5DF7stkJB300aqnRejCx9BLHEY15q3ZYaOJkI4eRSG3NugeKrwlDOIX3RHAdKkOvaNTt1lRso1EpzcXcDx2SvE+OQ13W5sIen7DMOCdQrN6Z5TZtGxQsJhLojI1HHmK2uuYEkLmXAHACADZUEyQJI3jRyBOnlNYZQ0jGIu2lT2aR2taI+19n77A-vkhU2igLQJeRHg3Vh5QYOiiwjdisCQthAaQi7Ajzra3Pu4DZeuHrxYQj9aO3W6wtRpBHkZnQjI5cuRWgmleTmjNHmYWp6t3Rn2AByacAAKqA8DsFgAQMKEAICBAgrpMziu7jGvmD0uNsXBSLAclyAnqUg5ZEUPtCXSPZf+AV0rlXpAjL6NY5jmsmhzAmCh4NlWliicRJsKA0oR4Vh32+793lxgG0qyyCoYjwlh55SsCUWYcjlhfOWFeSPKO0ce-K5sVERphLZBWOaywKeyHZTKIoVWhwc8RmewekDw4AAqO3OCeIeN41OTP+is8Lyh-KA1zAE6UMKBMthsr6nckyDdleMoAbvp3-A7ie995KRtrb73af64RKlTISZhR0100UY0pqgRpHkNqOYpHW-keHLKLGacOK6TfAAeVwI54ttSwreDt6CAv5lKCDv7sBf7SzD7Hb+ggwZ4mAWhl6KBQh5TdjWTNgAZYrmKzz+D07+CFIkCUA9B9asRgAEG4wBDMqqq8qCAZTmCBImAoTmgSAsxchyA2Qh4ZSqBWANi+RkDYAzgsqtA6JmZ4yqq-70a1L8GCH3CCCpyCAEGUC8oVxuQrDsiQgJiqDnhFApqNaeyyQ7r9Qt6LbijSFCH4AiFUHdC+BFiD6DDGol6MwVCqDIhdhJjyDQiezny2C1BqElBrB9omF2hmGcAWGtxcK5LCFEgegSGXpSE-YyEcLyHRGZjKGKAIQjJsgGa3Q3ZFCCjbA84iJ1C1CaApgvYSg3B8AsC6Q0F2CKzyCkoppAh5zV5GABgzBaj5HGKMxRIuCVT04YDwBRDQL4AY5F50iLBlC5ChKISlETZ0gCSg7CrWB0z7zhwjHYhXBjEj70h4KAyHwggWjHjQhxjlBjTnZp6WAZqP6vYfDbEwHsjWTx44pJ7GijRSB0y3gHBpTULXFBFP5zzkRbF+ae5Zw3TawOSMxpSRZ1BRjJDXhpSpDVCmgommZNKXK2ZrLtL3F1qBhPEZAFz8g1CpBvLJAAi3jzA+GKLlGDqUZAq6Q0rZLebpbYkgnjFHDVASrghvoqC14uSyQWDuSi7zAVDUk3FzJ0kepeo4lGIRgWBKB7i8nGDCQJoUIWjFTcGVwLYbESnyojr5qsllYj5HDJB5CaBoYlztreTaz3jyBoHImma3rSlsnGnGLbBag0IOB5ARinRqBMhQ7OGZADR1CmZMbOlGkwEmnnyMHeSMzN6tj8YA6ewsyODXTqnrGMK3FZhDp5bJY2bMngrIoym7hJimrsiySngh4lD1aMzMxVCTwNjsh2607Fnor2C9wlBJg2DqBrDQiAznxjYrB0L8hmDNlS7I4cCtl+L7BlCZCdmWhVBITWo6HwnzDpBzAXZzB-E6mkR77jn07HLrhTldI2AagDzZRhiyDn6IC4SUyh5ZRISyBjl6KSAO5O5YLHm3IWg5wKlaD2BpAax5RmrayMzxhHCNh-l56TkumRldjj5qwrEghmAZRRi1mxigUJhjZlHimkRr4wC7ab46Kfn5TKwTReS8mHQ3Rth5AQlIQchHw8F3wgFv5a4QE5jf7EXabmC7Aqyk7VaE6ICWg8hzB4oWj7Glk4F4GKFgDEVTDsGqwsyqDFHsjXkID+yzABiMG9rVbYX-FtAhHCGtxWGcXjTTHHTeR2CWCqUOSzlTwOTAzBIZkJIGVhFpwRHURRE5gmVwiwhIQmCewDTXijSNi8j2CLDmhAimhxIuBAA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: {
      guiMode: 'default',
      tool: null as Models['SceneToolType_type'] | null,
      selection: [] as string[],
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      selectionRangeTypeMap: {} as SelectionRangeTypeMap,
      sketchPathToNode: null as PathToNode | null, // maybe too specific, and we should have a generic pathToNode, but being specific seems less risky when I'm not sure
      sketchEnginePathId: '' as string,
      sketchPlaneId: '' as string,
      sketchNormalBackUp: null as null | [number, number, number],
      moveDescs: [] as MoveDesc[],
    },

    schema: {
      events: {} as ModelingMachineEvent,
    },

    states: {
      idle: {
        on: {
          'Set selection': {
            target: 'idle',
            internal: true,
            actions: 'Set selection',
          },

          'Enter sketch': [
            {
              target: 'animating to existing sketch',
              cond: 'Selection is on face',
              actions: ['set sketch metadata'],
            },
            'Sketch no face',
          ],

          Extrude: {
            target: 'idle',
            cond: 'has valid extrude selection',
            actions: ['AST extrude'],
            internal: true,
          },

          Export: {
            target: 'idle',
            internal: true,
            cond: 'Has exportable geometry',
            actions: 'Engine export',
          },
        },

        entry: 'reset client scene mouse handlers',
      },

      Sketch: {
        states: {
          SketchIdle: {
            on: {
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

              'Constrain ABS X': {
                target: 'Await ABS X info',
                cond: 'Can constrain ABS X',
              },

              'Constrain ABS Y': {
                target: 'Await ABS Y info',
                cond: 'Can constrain ABS Y',
              },

              'Constrain angle': {
                target: 'Await angle info',
                cond: 'Can constrain angle',
              },

              'Constrain length': {
                target: 'Await length info',
                cond: 'Can constrain length',
              },

              'Constrain perpendicular distance': {
                target: 'Await perpendicular distance info',
                cond: 'Can constrain perpendicular distance',
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

              'Constrain snap to X': {
                cond: 'Can constrain snap to X',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain snap to X'],
              },

              'Constrain snap to Y': {
                cond: 'Can constrain snap to Y',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain snap to Y'],
              },

              'Constrain equal length': {
                cond: 'Can constrain equal length',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain equal length'],
              },

              'Constrain parallel': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can canstrain parallel',
                actions: ['Constrain parallel'],
              },

              'Constrain remove constraints': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can constrain remove constraints',
                actions: ['Constrain remove constraints'],
              },

              'Re-execute': {
                target: 'SketchIdle',
                internal: true,
                actions: ['set sketchMetadata from pathToNode'],
              },

              'Equip Line tool': 'Line tool',

              'Equip tangential arc to': {
                target: 'Tangential arc to',
                cond: 'is editing existing sketch',
              },
            },

            entry: 'setup client side sketch segments',
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

          'Await ABS X info': {
            invoke: {
              src: 'Get ABS X info',
              id: 'get-abs-x-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await ABS Y info': {
            invoke: {
              src: 'Get ABS Y info',
              id: 'get-abs-y-info',
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

          'Await perpendicular distance info': {
            invoke: {
              src: 'Get perpendicular distance info',
              id: 'get-perpendicular-distance-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Line tool': {
            exit: [],

            on: {
              'Set selection': {
                target: 'Line tool',
                description: `This is just here to stop one of the higher level "Set selections" firing when we are just trying to set the IDE code without triggering a full engine-execute`,
                internal: true,
              },

              'Equip tangential arc to': {
                target: 'Tangential arc to',
                cond: 'is editing existing sketch',
              },
            },

            states: {
              Init: {
                always: [
                  {
                    target: 'normal',
                    cond: 'is editing existing sketch',
                    actions: 'set up draft line',
                  },
                  'No Points',
                ],
              },

              normal: {
                on: {
                  'Set selection': {
                    target: 'normal',
                    internal: true,
                  },
                },
              },

              'No Points': {
                entry: 'setup noPoints onClick listener',

                on: {
                  'Add start point': {
                    target: 'normal',
                    actions: 'set up draft line without teardown',
                  },

                  Cancel: '#Modeling.Sketch.undo startSketchOn',
                },
              },
            },

            initial: 'Init',
          },

          Init: {
            always: [
              {
                target: 'SketchIdle',
                cond: 'is editing existing sketch',
              },
              'Line tool',
            ],
          },

          'Tangential arc to': {
            entry: 'set up draft arc',

            on: {
              'Set selection': {
                target: 'Tangential arc to',
                internal: true,
              },

              'Equip Line tool': 'Line tool',
            },
          },

          'undo startSketchOn': {
            invoke: {
              src: 'AST-undo-startSketchOn',
              id: 'AST-undo-startSketchOn',
              onDone: '#Modeling.idle',
            },
          },
        },

        initial: 'Init',

        on: {
          CancelSketch: '.SketchIdle',
        },

        exit: [
          'sketch exit execute',
          'animate after sketch',
          'tear down client sketch',
          'remove sketch grid',
        ],

        entry: ['add axis n grid', 'conditionally equip line tool'],
      },

      'Sketch no face': {
        entry: 'show default planes',

        exit: 'hide default planes',
        on: {
          'Select default plane': {
            target: 'animating to plane',
            actions: ['reset sketch metadata'],
          },
        },
      },

      'animating to plane': {
        invoke: {
          src: 'animate-to-face',
          id: 'animate-to-face',
          onDone: {
            target: 'Sketch',
            actions: 'set new sketch metadata',
          },
        },

        on: {
          'Set selection': {
            target: 'animating to plane',
            internal: true,
          },
        },
      },

      'animating to existing sketch': {
        invoke: [
          {
            src: 'animate-to-sketch',
            id: 'animate-to-sketch',
            onDone: 'Sketch',
          },
        ],
      },

      'animating to plane (copy)': {},
      'animating to plane (copy) (copy)': {},
    },

    initial: 'idle',

    on: {
      Cancel: {
        target: 'idle',
        // TODO what if we're existing extrude equipped, should these actions still be fired?
        // maybe cancel needs to have a guard for if else logic?
        actions: ['reset sketch metadata'],
      },

      'Set selection': {
        target: '#Modeling',
        internal: true,
        actions: 'Set selection',
      },
    },
  },
  {
    guards: {
      'is editing existing sketch': ({ sketchPathToNode }) => {
        // should check that the variable declaration is a pipeExpression
        // and that the pipeExpression contains a "startProfileAt" callExpression
        if (!sketchPathToNode) return false
        const variableDeclaration = getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          sketchPathToNode,
          'VariableDeclarator'
        ).node
        if (variableDeclaration.type !== 'VariableDeclarator') return false
        const pipeExpression = variableDeclaration.init
        if (pipeExpression.type !== 'PipeExpression') return false
        const hasStartProfileAt = pipeExpression.body.some(
          (item) =>
            item.type === 'CallExpression' &&
            item.callee.name === 'startProfileAt'
        )
        return hasStartProfileAt && pipeExpression.body.length > 2
      },
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
      'Can constrain ABS X': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'xAbs' }).enabled,
      'Can constrain ABS Y': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'yAbs' }).enabled,
      'Can constrain angle': ({ selectionRanges }) =>
        angleBetweenInfo({ selectionRanges }).enabled ||
        angleLengthInfo({ selectionRanges, angleOrLength: 'setAngle' }).enabled,
      'Can constrain length': ({ selectionRanges }) =>
        angleLengthInfo({ selectionRanges }).enabled,
      'Can constrain perpendicular distance': ({ selectionRanges }) =>
        intersectInfo({ selectionRanges }).enabled,
      'Can constrain horizontally align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertically align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain snap to X': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'snapToXAxis' }).enabled,
      'Can constrain snap to Y': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'snapToYAxis' }).enabled,
      'Can constrain equal length': ({ selectionRanges }) =>
        setEqualLengthInfo({ selectionRanges }).enabled,
      'Can canstrain parallel': ({ selectionRanges }) =>
        equalAngleInfo({ selectionRanges }).enabled,
      'Can constrain remove constraints': ({ selectionRanges }) =>
        removeConstrainingValuesInfo({ selectionRanges }).enabled,
    },
    // end guards
    actions: {
      'set sketchMetadata from pathToNode': assign(({ sketchPathToNode }) => {
        if (!sketchPathToNode) return {}
        return getSketchMetadataFromPathToNode(sketchPathToNode)
      }),
      'hide default planes': () => {
        sceneInfra.removeDefaultPlanes()
        kclManager.hidePlanes()
      },
      'reset sketch metadata': assign({
        sketchPathToNode: null,
        sketchEnginePathId: '',
        sketchPlaneId: '',
      }),
      'set sketch metadata': assign(({ selectionRanges }) => {
        const sourceRange = selectionRanges.codeBasedSelections[0].range
        const sketchPathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          sourceRange
        )
        return getSketchMetadataFromPathToNode(
          sketchPathToNode,
          selectionRanges
        )
      }),
      'set new sketch metadata': assign((_, { data }) => data),
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Make selection vertical': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain horizontally align': ({
        selectionRanges,
        sketchPathToNode,
      }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain vertically align': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to X': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to Y': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain equal length': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain parallel': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain remove constraints': ({
        selectionRanges,
        sketchPathToNode,
      }) => {
        const { modifiedAst } = applyRemoveConstrainingValues({
          selectionRanges,
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'AST extrude': (_, event) => {
        if (!event.data) return
        const { selection, distance } = event.data
        let ast = kclManager.ast
        if (
          'variableName' in distance &&
          distance.variableName &&
          distance.insertIndex !== undefined
        ) {
          console.log('adding variable!', distance)
          const newBody = [...ast.body]
          newBody.splice(
            distance.insertIndex,
            0,
            distance.variableDeclarationAst
          )
          ast.body = newBody
        }
        const pathToNode = getNodePathFromSourceRange(
          ast,
          selection.codeBasedSelections[0].range
        )
        const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
          ast,
          pathToNode,
          true,
          'variableName' in distance
            ? distance.variableIdentifierAst
            : distance.valueAst
        )
        // TODO not handling focusPath correctly I think
        kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
      },
      'conditionally equip line tool': (_, { type }) => {
        if (type === 'done.invoke.animate-to-face') {
          sceneInfra.modelingSend('Equip Line tool')
        }
      },
      'setup client side sketch segments': ({ sketchPathToNode }, { type }) => {
        if (Object.keys(sceneEntitiesManager.activeSegments).length > 0) {
          sceneEntitiesManager
            .tearDownSketch({ removeAxis: false })
            .then(() => {
              sceneEntitiesManager.setupSketch({
                sketchPathToNode: sketchPathToNode || [],
              })
            })
        } else {
          sceneEntitiesManager.setupSketch({
            sketchPathToNode: sketchPathToNode || [],
          })
        }
      },
      'animate after sketch': () => {
        sceneEntitiesManager.animateAfterSketch()
      },
      'tear down client sketch': () => {
        if (sceneEntitiesManager.activeSegments) {
          sceneEntitiesManager.tearDownSketch({ removeAxis: false })
        }
      },
      'remove sketch grid': () => sceneEntitiesManager.removeSketchGrid(),
      'set up draft line': ({ sketchPathToNode }) => {
        sceneEntitiesManager.setUpDraftLine(sketchPathToNode || [])
      },
      'set up draft arc': ({ sketchPathToNode }) => {
        sceneEntitiesManager.setUpDraftArc(sketchPathToNode || [])
      },
      'set up draft line without teardown': ({ sketchPathToNode }) =>
        sceneEntitiesManager.setupSketch({
          sketchPathToNode: sketchPathToNode || [],
          draftSegment: 'line',
        }),
      'show default planes': () => {
        sceneInfra.showDefaultPlanes()
        sceneEntitiesManager.setupDefaultPlaneHover()
        kclManager.showPlanes()
      },
      'setup noPoints onClick listener': ({ sketchPathToNode }) => {
        sceneEntitiesManager.createIntersectionPlane()
        const sketchGroup = sketchGroupFromPathToNode({
          pathToNode: sketchPathToNode || [],
          ast: kclManager.ast,
          programMemory: kclManager.programMemory,
        })
        const quaternion = quaternionFromSketchGroup(sketchGroup)
        sceneEntitiesManager.intersectionPlane &&
          sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
            quaternion
          )
        sceneInfra.setCallbacks({
          onClick: async (args) => {
            if (!args) return
            if (args.event.which !== 1) return
            const { intersection2d } = args
            if (!intersection2d || !sketchPathToNode) return
            const { modifiedAst } = addStartProfileAt(
              kclManager.ast,
              sketchPathToNode,
              [intersection2d.x, intersection2d.y]
            )
            await kclManager.updateAst(modifiedAst, false)
            sceneEntitiesManager.removeIntersectionPlane()
            sceneInfra.modelingSend('Add start point')
          },
        })
      },
      'add axis n grid': ({ sketchPathToNode }) =>
        sceneEntitiesManager.createSketchAxis(sketchPathToNode || []),
      'reset client scene mouse handlers': () => {
        // when not in sketch mode we don't need any mouse listeners
        // (note the orbit controls are always active though)
        sceneInfra.resetMouseListeners()
      },
    },
    // end actions
  }
)

function getSketchMetadataFromPathToNode(
  pathToNode: PathToNode,
  selectionRanges?: Selections
) {
  const pipeExpression = getNodeFromPath<PipeExpression>(
    kclManager.ast,
    pathToNode,
    'PipeExpression'
  ).node
  if (pipeExpression.type !== 'PipeExpression') return {}
  const sketchCallExpression = pipeExpression.body.find(
    (e) => e.type === 'CallExpression' && e.callee.name === 'startSketchOn'
  ) as CallExpression
  if (!sketchCallExpression) return {}

  let sketchEnginePathId: string
  if (selectionRanges) {
    sketchEnginePathId =
      isCursorInSketchCommandRange(
        engineCommandManager.artifactMap,
        selectionRanges
      ) || ''
  } else {
    const _selectionRanges: Selections = {
      otherSelections: [],
      codeBasedSelections: [
        { range: [pipeExpression.start, pipeExpression.end], type: 'default' },
      ],
    }
    sketchEnginePathId =
      isCursorInSketchCommandRange(
        engineCommandManager.artifactMap,
        _selectionRanges
      ) || ''
  }
  return {
    sketchPathToNode: pathToNode,
    sketchEnginePathId,
  }
}

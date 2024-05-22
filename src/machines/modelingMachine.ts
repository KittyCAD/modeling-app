import { PathToNode, VariableDeclarator } from 'lang/wasm'
import { Axis, Selection, Selections } from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import {
  kclManager,
  sceneInfra,
  sceneEntitiesManager,
  engineCommandManager,
  editorManager,
} from 'lib/singletons'
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
import { DefaultPlaneStr } from 'clientSideScene/sceneEntities'
import { Vector3 } from 'three'
import { quaternionFromUpNForward } from 'clientSideScene/helpers'
import { uuidv4 } from 'lib/utils'

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

export type MouseState =
  | {
      type: 'idle'
    }
  | {
      type: 'isHovering'
      on: any
    }
  | {
      type: 'isDragging'
      on: any
    }

export interface SketchDetails {
  sketchPathToNode: PathToNode
  zAxis: [number, number, number]
  yAxis: [number, number, number]
  origin: [number, number, number]
}

export type ModelingMachineEvent =
  | {
      type: 'Enter sketch'
      data?: {
        forceNewSketch?: boolean
      }
    }
  | { type: 'Sketch On Face' }
  | {
      type: 'Select default plane'
      data: {
        zAxis: [number, number, number]
        yAxis: [number, number, number]
      } & (
        | {
            type: 'defaultPlane'
            plane: DefaultPlaneStr
            planeId: string
          }
        | {
            type: 'extrudeFace'
            position: [number, number, number]
            extrudeSegmentPathToNode: PathToNode
            otherPathToNode: PathToNode
            cap: 'start' | 'end' | 'none'
            faceId: string
          }
      )
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
  | { type: 'Equip rectangle tool' }
  | {
      type: 'Add rectangle origin'
      data: [x: number, y: number]
    }
  | {
      type: 'done.invoke.animate-to-face' | 'done.invoke.animate-to-sketch'
      data: SketchDetails
    }
  | { type: 'Set mouse state'; data: MouseState }
  | {
      type: 'code edit during sketch'
    }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AdgCsAZgB04gEyjhADnEA2GgoUAWJQBoQAT0QBGGuICckmoZkbTM42YWKAvk91oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEFTU2VJYWFxDUNDbPFxCQ1dAwQZO0lDW3EcuQzlBRoNFzd0LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5JTJVUNNBUNlLQ05YsQsjQWNLVE5Yw0aZXFmkHc2-ElsCEwwAgBRXBGAJ0CAaz9yAAsxqITOK8WYyZTCCpg1JaKw5cFFfSIGSmXYaLKyPI0UwKZSmC5XTxQW73R4vd5fH7-QyRZisSbcEFCaw0STZRaiNTiNQ0YRbBAnGSSWzCZSiKz1QziFbKfGtQnEh7PPjsN69DAA2mxKaMpKieSSZE0US40QaUQrPk5DkGnEKFIcmz7QyyjztBWkvgsN7sDXROnAhJM9Q25llXIo818jKGBZiLKihoyYRml3XIneb7sP7EMiUTAZym+oHawMIHI4io8-YNBpmWSWpYx8srSWWBTm1PygtZ36Sbt-ACSJIIyBI30CYCgXTAr38ADcwN7sOQSJgi-6SzMjMimwoZJoRZoaEnLXlpDQL3IJEmlE1XJc5W7+73n0PFaPx0EpzOAr9UG9sAAL24IY13ocYNwZUsrGTBY1FUMUYPBGRLWqGNTXkSwzmMPUZE7J9Mz+PtCN+N9HiIbhYBVEg8H8P8AOA15V38CBsCo3NRnAwFIOmfht1NCwNi5bEslMJYFD5GQzDSI09QvM0xMlfCbmfYjKTI4hKOo2iFyXFdMBYtihgoTiaT9LUoK3MswQUIVDnbVZsjUDZJKTKRDmyA8MjBU1lPTEi1J7DSKNwKi3ho3B-AAQQAIW8fwAA11ws3jEisdtWXEMRw2qZEpMk0wBMK8EGmPURTEyc57wJAjKUCwdhxCsKIuiuL-AATWS+lUu3DLrDsZQjmNY0UMRBAuWDYQrzFVRHH2Pz6pfEjgq08LaLIKAHi6gMrMlNFpCUPd20UQxhFMSSOQhORjoyY0zoqhbVNfRrVpah58HYf4uM1bqdUlLLpFFVQxNkapREk5QlnSXFsjO6sVGER6AuexUmu0yKmEXTHcFY8hekwEgPlY9iTO2zc+Os-dWRSXKTiWVRlEklZdmESo7W8-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-g3SUAeA6umu-g2SgOeSEBeAfCtS2QXs6gjY+47aWI4iQSjgaQEgjQEuFUxisC-guAScwyJAlAPgwQoQLEYAlB+MoWBMHqLKggdgu4KItOz2na82iAg0aQKwUkaI90IoNgC0ZA2AXQwwYBic-gqqHqu+SWUykh0hIwggicgglBlALKeou4Y+WKv8PIFuVMuUtC+4FUWg72gWRIqhMh+ADc-gnCRkYBsAJEShUm8ydh6hmhbhhYN+5MiQnsFghWZ0KwpoX6f6UMxcP+qQ6gvm1hR6QWcCQUw4GCGAThrEAQEAvQAEDhfhPYCeWQiKVSYgnme492wYkSkoVo1Q2Ih6E8kq7h6ROikA9yOReRUAFIhRARn8RgxRFQ+wbae41y+w92o86QU0UkAh9Qwizi5ADwZAgQ-yjwCe2QuwCEeo5yuQEgNSRgaGFgpwxg2chyhmFw5BGA8AUQqSUAnOgRQgDQMYsg8gSgs0ywexZYlqci9ahUkaOypwC0dwDwdxfRSQaw9+4IBymg5oXM1iKwpiag-8ZhlgXajRPaPYIJ9scRrIx0XK+86efKyIQoECPKmQWgZUzifMmJf0Jw6clhdO0JYRDYKIgxVgW6+QKe62jCUqIWDyDEEKMWAycWoy1J0EtorI+yigrMSYe8U+rKtg0gZoXIpwuISYzoNhTCp6Wq8qQpQ6opu06g8aqglgBQKgO4rk1ox4nkuQK2YoxGA6Oa0K+p8sdoUgnIVgICg0zmZOWmIC4ed0OIWEpc4qaJwmvYp6A6F6GyzpaUdovO+4aISw+cf6pwXshceoJqhpqJNxmpvJ4GepXut+u6CwypaIDghwd2fKHItkOc7YxoPIg0BQRm1m4m0ZhZ9xZYFej2w0KwnpxcEM+OZ0bMIocMesDWWMTWA20W2WiqTp7ZoJSwOGF21ZJwEe+QkkJ06QbMw8GZqQDuTOMZSI9gHc+Q7YNg6g9Qb+8J1ODQra+wWIiRoZyRkgg+TOLOHAh5pQ-8MYPIp5po2ItoFuCpqwP6US9ao82ZG2TCr5IOzO5BQKq4n51gFUrI3chotYZQUY9SEelQUe+4ZwIZOZqkMFsuTuLurwVxeWHZhC6cSguQnKoMZwUYg0NoOQNReBMIBeH585Ri4SewpozIUoZguQDY8JzYaGbYHYGpqkHeh2Xex2p2qASF5oP8GKGwo8YINploqZewFU5UjgPIKQhFUFqkp+a+QwG+JE2+n5qwsSEgg8es+6yIb+Ex3xhCAZxo-+AO+ZB5PFxSEgaQaw8gZocYSZjMZCbGB0p0EYwh9QCiSRm2REAB8BwBB+IWrhIQ3AWuGCbwHqbwylmg-F66oVZuGs9amUaw2U7FZgXlgBQOGOoBDhiBvEhixSkMaQeQUINgrMdop4-8gqKwQhdFF4D00lJEZBFBVBYAn57B+QCw5oka-Unmx4fIXM6cI0cadQdYEh2OahshScCh01fl0EZwQoIo4FhU0ppwJhMktqIog8E08VT5thu19hXRchzhVErhJENlKFZRL2x4uQdRcp+4LIJcFezIOI+48xix0cKxNldY3sGwKQU0aIeU2lp1qQ+8l0VCLgLgQAA */
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
      sketchDetails: {
        sketchPathToNode: [],
        zAxis: [0, 0, 1],
        yAxis: [0, 1, 0],
        origin: [0, 0, 0],
      } as null | SketchDetails,
      sketchPlaneId: '' as string,
      sketchEnginePathId: '' as string,
      moveDescs: [] as MoveDesc[],
      mouseState: { type: 'idle' } as MouseState,
    },

    schema: {
      events: {} as ModelingMachineEvent,
    },

    states: {
      idle: {
        on: {
          'Enter sketch': [
            {
              target: 'animating to existing sketch',
              cond: 'Selection is on face',
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

              'Equip rectangle tool': {
                target: 'Rectangle tool',
                cond: 'Sketch is empty',
              },

              'code edit during sketch': 'clean slate',
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
              'Equip tangential arc to': {
                target: 'Tangential arc to',
                cond: 'is editing existing sketch',
              },

              'Equip rectangle tool': {
                target: 'Rectangle tool',
                cond: 'Sketch is empty',
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

              normal: {},

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

          'Rectangle tool': {
            entry: ['listen for rectangle origin'],

            states: {
              'Awaiting second corner': {},

              'Awaiting origin': {
                on: {
                  'Add rectangle origin': {
                    target: 'Awaiting second corner',
                    actions: 'set up draft rectangle',
                  },
                },
              },
            },

            initial: 'Awaiting origin',
          },

          'clean slate': {
            always: 'SketchIdle',
          },
        },

        initial: 'Init',

        on: {
          CancelSketch: '.SketchIdle',
          'code edit during sketch': '.clean slate',
        },

        exit: [
          'sketch exit execute',
          'animate after sketch',
          'tear down client sketch',
          'remove sketch grid',
          'engineToClient cam sync direction',
        ],

        entry: [
          'add axis n grid',
          'conditionally equip line tool',
          'clientToEngine cam sync direction',
        ],
      },

      'Sketch no face': {
        entry: ['show default planes', 'set selection filter to faces only'],

        exit: ['hide default planes', 'set selection filter to defaults'],
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
      },

      'animating to existing sketch': {
        invoke: [
          {
            src: 'animate-to-sketch',
            id: 'animate-to-sketch',
            onDone: {
              target: 'Sketch',
              actions: 'set new sketch metadata',
            },
          },
        ],
      },
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
        internal: true,
        actions: 'Set selection',
      },

      'Set mouse state': {
        internal: true,
        actions: 'Set mouse state',
      },
    },
  },
  {
    guards: {
      'is editing existing sketch': ({ sketchDetails }) => {
        // should check that the variable declaration is a pipeExpression
        // and that the pipeExpression contains a "startProfileAt" callExpression
        if (!sketchDetails?.sketchPathToNode) return false
        const variableDeclaration = getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          sketchDetails.sketchPathToNode,
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
      'set sketchMetadata from pathToNode': assign(({ sketchDetails }) => {
        if (!sketchDetails?.sketchPathToNode || !sketchDetails) return {}
        return {
          sketchDetails: {
            ...sketchDetails,
            sketchPathToNode: sketchDetails.sketchPathToNode,
          },
        }
      }),
      'hide default planes': () => {
        sceneInfra.removeDefaultPlanes()
        kclManager.hidePlanes()
      },
      'reset sketch metadata': assign({
        sketchDetails: null,
        sketchEnginePathId: '',
        sketchPlaneId: '',
      }),
      'set new sketch metadata': assign((_, { data }) => ({
        sketchDetails: data,
      })),
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchPathToNode,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Make selection vertical': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain horizontally align': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain vertically align': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain snap to X': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain snap to Y': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain equal length': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain parallel': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain remove constraints': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyRemoveConstrainingValues({
          selectionRanges,
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'AST extrude': async (_, event) => {
        if (!event.data) return
        const { selection, distance } = event.data
        let ast = kclManager.ast
        if (
          'variableName' in distance &&
          distance.variableName &&
          distance.insertIndex !== undefined
        ) {
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
        const selections = await kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
        if (selections) {
          editorManager.selectRange(selections)
        }
      },
      'conditionally equip line tool': (_, { type }) => {
        if (type === 'done.invoke.animate-to-face') {
          sceneInfra.modelingSend('Equip Line tool')
        }
      },
      'setup client side sketch segments': ({ sketchDetails }) => {
        if (!sketchDetails) return
        ;(async () => {
          if (Object.keys(sceneEntitiesManager.activeSegments).length > 0) {
            await sceneEntitiesManager.tearDownSketch({ removeAxis: false })
          }
          sceneInfra.resetMouseListeners()
          await sceneEntitiesManager.setupSketch({
            sketchPathToNode: sketchDetails?.sketchPathToNode || [],
            forward: sketchDetails.zAxis,
            up: sketchDetails.yAxis,
            position: sketchDetails.origin,
            maybeModdedAst: kclManager.ast,
          })
          sceneInfra.resetMouseListeners()
          sceneEntitiesManager.setupSketchIdleCallbacks({
            pathToNode: sketchDetails?.sketchPathToNode || [],
            forward: sketchDetails.zAxis,
            up: sketchDetails.yAxis,
            position: sketchDetails.origin,
          })
        })()
      },
      'animate after sketch': () => {
        engineCommandManager
          .sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'sketch_mode_disable',
            },
          })
          .then(async () => {
            // there doesn't appear to be an animation, but if there was one we could add a wait here

            await engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'default_camera_set_perspective',
              },
            })
            sceneInfra.camControls.syncDirection = 'engineToClient'
            await engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'default_camera_set_perspective',
              },
            })
            const center = { x: 0, y: 0, z: 0 }
            const camPos = sceneInfra.camControls.camera.position
            if (camPos.x === 0 && camPos.y === 0) {
              // looking straight up or down is going to cause issues with the engine
              // tweaking the center to be a little off center
              // TODO come up with a proper fix
              center.y = 0.05
            }
            await engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'default_camera_look_at',
                center,
                vantage: sceneInfra.camControls.camera.position,
                up: { x: 0, y: 0, z: 1 },
              },
            })
            await engineCommandManager.sendSceneCommand({
              // CameraControls subscribes to default_camera_get_settings response events
              // firing this at connection ensure the camera's are synced initially
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'default_camera_get_settings',
              },
            })
          })
      },
      'tear down client sketch': () => {
        if (sceneEntitiesManager.activeSegments) {
          sceneEntitiesManager.tearDownSketch({ removeAxis: false })
        }
      },
      'remove sketch grid': () => sceneEntitiesManager.removeSketchGrid(),
      'set up draft line': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setUpDraftSegment(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'line'
        )
      },
      'set up draft arc': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setUpDraftSegment(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'tangentialArcTo'
        )
      },
      'listen for rectangle origin': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setupRectangleOriginListener()
      },
      'set up draft rectangle': ({ sketchDetails }, { data }) => {
        if (!sketchDetails || !data) return
        sceneEntitiesManager.setupDraftRectangle(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          data
        )
      },
      'set up draft line without teardown': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setUpDraftSegment(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'line',
          false
        )
      },
      'show default planes': () => {
        sceneInfra.showDefaultPlanes()
        sceneEntitiesManager.setupDefaultPlaneHover()
        kclManager.showPlanes()
      },
      'setup noPoints onClick listener': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.createIntersectionPlane()
        const quaternion = quaternionFromUpNForward(
          new Vector3(...sketchDetails.yAxis),
          new Vector3(...sketchDetails.zAxis)
        )
        sceneEntitiesManager.intersectionPlane &&
          sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
            quaternion
          )
        sceneEntitiesManager.intersectionPlane &&
          sceneEntitiesManager.intersectionPlane.position.copy(
            new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
          )
        sceneInfra.setCallbacks({
          onClick: async (args) => {
            if (!args) return
            if (args.mouseEvent.which !== 1) return
            const { intersectionPoint } = args
            if (!intersectionPoint?.twoD || !sketchDetails?.sketchPathToNode)
              return
            const { modifiedAst } = addStartProfileAt(
              kclManager.ast,
              sketchDetails.sketchPathToNode,
              [intersectionPoint.twoD.x, intersectionPoint.twoD.y]
            )
            await kclManager.updateAst(modifiedAst, false)
            sceneEntitiesManager.removeIntersectionPlane()
            sceneInfra.modelingSend('Add start point')
          },
        })
      },
      'add axis n grid': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.createSketchAxis(
          sketchDetails.sketchPathToNode || [],
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'reset client scene mouse handlers': () => {
        // when not in sketch mode we don't need any mouse listeners
        // (note the orbit controls are always active though)
        sceneInfra.resetMouseListeners()
      },
      'clientToEngine cam sync direction': () => {
        sceneInfra.camControls.syncDirection = 'clientToEngine'
      },
      'engineToClient cam sync direction': () => {
        sceneInfra.camControls.syncDirection = 'engineToClient'
      },
      'set selection filter to faces only': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_selection_filter',
            filter: ['face', 'plane'],
          },
        }),
      'set selection filter to defaults': () =>
        kclManager.defaultSelectionFilter(),
    },
    // end actions
  }
)

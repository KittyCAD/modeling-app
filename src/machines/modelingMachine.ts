import { PathToNode, VariableDeclarator } from 'lang/wasm'
import { Axis, Selection, Selections } from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import {
  kclManager,
  sceneInfra,
  sceneEntitiesManager,
  engineCommandManager,
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
import { v4 as uuidv4 } from 'uuid'

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
          }
        | {
            type: 'extrudeFace'
            position: [number, number, number]
            extrudeSegmentPathToNode: PathToNode
            cap: 'start' | 'end' | 'none'
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
  | {
      type: 'done.invoke.animate-to-face' | 'done.invoke.animate-to-sketch'
      data: SketchDetails
    }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AdgCsAZgB04gEyjhADnEA2GgoUAWJQBoQAT0QBGGuICckmoZkbTM42YWKAvk91oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBFtpGhlxDRphGg1ZURlhXQMEcRLDSVF5UwV84XEK8Rc3dCw8KElsCEwwAgBRXHYwACdAgGs-cgALCN4Yji540ETBGWVhSStlU2UtK0NDVY1CxBlTDUkcnOtDcRoqzcaQdxb8ds7uvoHh2DH2SapDSLMVhzbi8JbWGjnfaWURqG4KTJHBAZGSSWzCZSiDYKa445QPJ6eNodLq9PjsQYAVww0yisziYKEFTWJxook2og0ohxSL2sMkMgUygUplMsJsGg0hgJzSJr1JPT4LEG7FpQNi80ZCGW6gF1RRdgl3KRwmEZVWEg0mIR+S5Mo8rUk3h+k2IZEomGd4ym9BmwIZCSMhiF60ykoRCLMsl5wbKe3Uexuwe59uebS9vwmTpdEwAkm8CMgSGNAmAoABbMD9fwANyGnHIJEwaui-s1gYQVlMceqmgxmlSBX0RilUhuNFS9XySg0qblGcm2e9+dJRZLQQrVYCE1Qg2wAC9uOwmy36e3FkZbZJVEK2Xt8qsZLzxHtylysvsX2y8nPHQus-+K7dEQ3CwBSJB4P4O57oe-RNv4EDYGB7pgKebagh2VichYGhpLcM7duoSJpFsFgVLC2SiN21y-i8-5LpmQHEKB4GQXWKrYI2mAIUhx4UKhvp0uhCz8JewponkChYtsxiaE+w4IDI+RSHkUp9qaKycrR6Y5gxkxMSBuBgYMEG4P4ACCABC3j+AAGmhGoYRenaCqI5ziGIhg2C+JxpMRYpnGKqwIpOpi1A0riPLKf66YBBaGcZpkWdZ-gAJoOSCImJFYUkCrh+xyIY7LsvJRTwgokjCHIFTQo4kraXpAE5gZLEmZBZBQF0GUBs51w5NISi9vIOLCKYxGwiy3LyKa7KjWFDX0XFpIJaxZldPg7A+oCraOVlRglGsKjsrc1xpEVxHKMGlWbFKo3hiowgLbFzXxa1SVMEMH24Ih5CUpgJDDIhyH8d156iS5grnKKPkZMGqjKMROJnGaVRhVVkoaGIT3eo1LVGatUG7geR5Npgej+E22BQLgoNOeDGyolJmhSeknI0Mo4i8tJApiup+TsiU2OZrjr3421ZnsQ2pPk5T1O03tLmje5gqjdJZhYryyhyOUIqjUK1RVLUQuLktwFvZBsC4CQTD+OwqB2fLWrXNcAocxGYXVGYxHZKiSnssoAdso4SnG01y6i4lFtWzbdtpY7mEvlImQc4YpoecYhwKYaaycsHVGp1aOShyLy3m2ZYAAI6UvB61QJt8e9ScKleaaYVsnIHm8rUkI5CYE5spi9yRYSMU46bzFi+9AOk9QgnqplTuyGsqQrC+VHpAXvKmB5FilJdoqZGoojF+PK3i-4gxgOWqB1v45Bl+wsAN-T1gVZd1glZoRU6ApwYvhY+xbDZBKGoLWJ8XqkgAEpgEEGAPgIRKQDGftlOoUhriqCwsydkSItjKHKGjOoOITgZ3AeHBUVdsA2wADJ4DALbVAqBmxzx2gvTCIo8ESBUDYMU6QiIKSUG5Ca1g-ZWixNKYe0U6LPTIe8ChMcOpbmwPBAG5B6HIOOPsCq4gpIp0xIoVBMZLDXVvMNdIhdi7mQAO4QW3ETWCx5uJAz4pQfweAABmqACAQG4GAdouAayoDGJIGA7BBDQWJnBTAgh3GoHUYpG4ZxJTbFuLUUUadiJSnMFJQUZ1NhyFWBY6xHBCYwRJo43iKFXG4A8QQIYgxdySCYP9dgHjBjlmCX4MJdiynROqbE5hZ46aJDwm5PYkpExckFGFYi2jUTZHZhOOoD5xFNAdFInGVibG1nrJxeCTjKkxK8T4vxASgkhMEJLXZUSYlxLOqia4ih7CrEMOiYigopCODyHka4L4qqFK2ZcriPFgYuMOXUhpTSSAtN3O085gKmy9I8bcnykgETyHzmITQbzcLrEHqkbRvYlD-OKVZGytkqk1O8bgXxeBTm+POSQAARrAQQfBEX9O2oMhWuTroyAnH7Qh-ktbrAyFKbYsgtZGwkWsnSGyikBFJXZClnjwWDEac01psLOlMpZWym5AzhJajOmsHIBK6imDZFofy+xpDckxF+TGNhiUKpSqlZVRzqUnMCfS7VzLBB6HZcim1dR0VUSbsILkSIbirChiKWE3IbhaWlWmRqkhNkktde61V6qoWao6aEnV-rA0Gt2ka35FgHweRWBzMVUb9hnHZrgv2DyZDOopvgLo7qqU0v8d6-NggOpdGLZyw1HZjUpETF80UGss4VDwdvNklgip2tNG2wddCwWDHqWqyF0K2n9vXcOv0pax0vgqlkKUgorBqG7EOIohU1iTqyHIduBTk3zl0umgItdNpduObSvt5yf0TCPUJE9zkzpuUuGYW6uFBwXVyuzUotRLpmlbe+0ewsv3+GA1mrdEKNUwv7cB0D88ergx5cYEw3JNGY1KscbYqIA6v1OGIGa+IMPrKw-K-wH1BhfR+n9AGwLnEbr6R6ntdL+18YE5xITgxBD7P4qRlh5HhkrFRLzWQVolLCjkIjbW6crSYmnR3NtMmqyCf+oDCp-E8PbpzXurVoSLPfTk9ZxTtnKAqa5UajTEklDWC1isaoohiKmkOmaYzVExRmc47K4WNDqX0MYb0ORtsFH9CUdxFRaiS2sIg6aM4RUzATnUKjBGCk0buQ8o4LIWxi5JboXbRhkhcy4A4AQW5aQ8GDSxAiU4cgxoKWFGUNIIpSseVGmkRrtCUuYDax19gXWATHoKxR-IqJYRXpknyzYJolZWlQbYdkFq2SzeSy1hbAA5e2AAFVAeBH4EHMhACAgRjwql449-otyA6BQHlRXCCJthIgDuYHIYU26KEGhd5rDCbv3Z+890g-EmEjvA-TTQ5gTDjb5acJmCgTRGJsPvUogoObF3a51uJxgbVaHkCYVQeRbiZyKFYEo5xVha3hqkGSVOlsrYx+t7Kd5UUWotUdvllg2eXm7JVFmVoNjeQ46slN9EAAqmXODKMGKou2aXKSUP8E1+bf3JTuUyFJMU7N6NJCtJVKqaRGfsytI9eLqbKTfXtshFU-4ADyuAJNeqCeZbwGvBBe+8YIX37AA803y2p-a2jyjKWopKOoagkTckhFsF5ahMbaIOqHfwuB7ZuJIJQHwwRQgITABXv6ARIXUricsV8wZThTa0AcMUYOVioo5zkOaGInUe7INgcsULWj0N4-9alweANBPH5PgYgg7aCAr5QOJNV1gIkUPMleiIRuQx8iAqZEb1ANWX1P-AM+4G8Wn98b0C-e1L46yvmB6+n+ZjiVrNyfP8gqgioh87cz1rxVhtEthytMYFAXBIoy8MB4AogR58A1sk9tQEQyhch9EbxmZOZf5xIld1Ah88l0M1c5QSQwA0CwYlhtgKpZowptEuQ+wkQExyh4QSsOdLBTBQ5qChlEAoDzgpIsgVB25Wdxo3I88LVuR8dMgaIPdFoIEqCwMRcRwTAeYI1ptNBKgidf4XlitL1o0DoTAIpyDMNFxsNwl7E9kvMxMPE+CFY4YKpJQUlHArBTRUgZlkhWZxxwd8gVkooZVU1sN4VykQU7DUAHCnZ1B7lVBLBUEtZuw3l+RUg1IvIA4ao21FVyUYkoi2Ft4LAlAuwVA7AJxht71t4yguRgoMFmdqgsjM1ciVD0CO8ttBQchgwfYo12Y3I-YsEqgDY10O0Ii8jeo41rxxxTUqg8ht5xo1BUVxs51k5nc21cMmiyMaCjARQe5qNrQXkVAA4LoVBKpuxDZVhTgBZzNPpLN3NhMlNQU+lRisd2QTjMQC9sgtgShwscRKoXlrdl1RpVdAj1ddJTcrsnjhl7ALBwopIbB1BhRs8fjt4gDUhbhNJTDgSP0cYwSEdFsOAISNEsRoSShYSBiESRtkh9ga0jtJch4zCuNFwcTWsy82kmwCTFIbATU05WRIwlJicqipDychRZA4d5tJBbt-AHsnskCNj+COSJA9QXwdhccVB8CigMRfYcRExgwR8cQBd8TmjNjOw2RzBthOQIQi9uxZdOxYx1hgwtSkwmZi4td8BFFdd9dIjDS5S5BNBHdV4tZhDRReR25XYhRhRGcsQ5Bi4o8fdPs48cxA92TNFzAJBc4BYE0Ths8HcldbAuRZodES8y9-BN9lDZSFZlgMhUUJU2NMYC8wsFIuQzh40ztjBW5VIr938b8oAZ9m9SzVMjTPw0QMRJcxQ0N2Y+88ETB1AMRc54R3d6S2hr9OBb9Y578wJH8cwkywpKp-ZGdDQXxbBEZIRA5tiIQhRBQ4CnAgA */
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
          'engineToClient cam sync direction',
        ],

        entry: ['add axis n grid', 'conditionally equip line tool'],
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

        entry: 'clientToEngine cam sync direction',
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

        entry: 'clientToEngine cam sync direction',
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
        target: '#Modeling',
        internal: true,
        actions: 'Set selection',
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
      'AST extrude': (_, event) => {
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
        sceneEntitiesManager.animateAfterSketch()
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
            filter: ['face'],
          },
        }),
      'set selection filter to defaults': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_selection_filter',
            filter: ['face', 'edge', 'solid2d'],
          },
        }),
    },
    // end actions
  }
)

import {
  PathToNode,
  SketchGroup,
  VariableDeclaration,
  VariableDeclarator,
} from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { isReducedMotion } from 'lib/utils'
import {
  Axis,
  Selection,
  SelectionRangeTypeMap,
  Selections,
} from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
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
import {
  addStartProfileAt,
  extrudeSketch,
  startSketchOnDefault,
} from 'lang/modifyAst'
import { getNodeFromPath } from '../lang/queryAst'
import { CallExpression, PipeExpression } from '../lang/wasm'
import { getConstraintLevelFromSourceRange } from 'lang/std/sketchcombos'
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
  clientSideScene,
  quaternionFromSketchGroup,
} from 'clientSideScene/clientSideScene'
import { isQuaternionVertical, setupSingleton } from 'clientSideScene/setup'
import { PerspectiveCamera } from 'three'

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
  | { type: 'Enter sketch' }
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
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Equip Line tool 3' }
  | { type: 'Equip tangential arc to 3' }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDsAJgCMAOlEBmABxTRAVgAsggGwyZqhQBoQAT0TThNcYICcg0WdGaZCmgsEBfJ7rQYc+AgGUw7AASwWGDknNy0DEggLGxhPFECCKJKChIyZjRSxlJmMoIOZroGCPJKZuJlSjRmGVk2Ki5u6Fh4UOLYEJhgPn6BwaFcuBG8MRyDvImiDqriCsJzUqpLWZmCRYY2M6LCGlJKUiKqlY0g7i347Z3dAKK47GAAToEA1n7kABbDUaNxExs2s3UNGESiOVQcMnWCHySnEMjK1TEOSm0hOZ08bQ6XQIt3uT1gr3YHyookizFYY24f2hcgqNEEKjUNH2NSUULMR3ENBk8wZ1lkKSUaOaGMu2OufHYDwArhgvuTYuMEoZhDkuXY1JptoJBMooaJNpIdmZlHYQQozMKPK1xN5CR9iGRKJg7W9PvQRhTfsqkrY4RqlIpdZoHOyDaZVDVtYHqqkrec2q6ie9bfb3gBJK49AJBLoDcIe75epWgRJiGgzQNKEHyA3Caxs-RCVTCcRacw6mRWYRqS2uU4im1Jj6pt2Z7HIEivPpQAC2YDu-gAbo9OOQSJh5dFi1SfVZBFJxByDYHROZKsJ9clDya65GRMCK-HRcOU6-x91J9OgnOFwF3qgDzYAAXtw7AbluPwlvwhgmoI4iyOouSqNyqo6E2STMq2VhAlI9LAmYILPkOaajsmH7ENwsBSiQeD+ABQGgXcG7+BA2DUU6YCQTu8SlrBex0vyvY1BW6HFGIKEVLkVgKFIqTKGexEXK+ZEfBRRBUTRdErg8a4sWxHEUFxhYKpSvEwUkZhlAhOHmPYKGWGJiDZPBHLqOYSwclZzj9uiJFuqpGZZhpuDUQ8tG4P4ACCABC3j+AAGtxiq7nxllaHCzJ7D2HI5VIUI9lYCGsny9TAqoSmJqR77BZp4V0bF8UAJrJWZ1I4QobbciJsgVvsawYTssmSOoIJaDQBoiD5TTWsp1VpupdURf4ZBQF0rXemlxiqqY9kKGC8hLJeg2FaYE09sIRyEfWlWBYFi2hVpkVdPg7DumS24peZZYTfBB41pGFh4TsBWyIeYhiNsciHBVvmDnNAU1diIVhctTCPOjuBseQ0qYCQTwGeBRkbdBkwZDIcJLMk5XqCohSDY45SiC2FqXczeSqNNA6zVViMLbVj31ZFDEgWBG6YHoK04FAQwmZ9bV7lZnWqIsnbwtyDL6mNR6glZ1hLDINBPnDPN3Uj3Qo09y6rtg66YBLUvYDLJOpRZOGtpDZ54QamjzPqckzCC1RG9swhhykt0qeblGC8tsC4CQTD+OwqCJS732wRyXLVlMIIHvkKv6jqrYc5qzKpNUXN+Qjyb3QLqN0fHifJ6nLVy1BrtkyacLKKodZZI4yT6nkFNWLkPYB-kwiR-NY711bYAAI7SixL1QG96ftRYgdmHh-1GyIoj6qCEjctTyQmobsMzQmZv88jS10Uw+Pi9Q7c8dSxjVJliL2BoGgpH1EseCtNLrZVZAoBQM8+ZzwfrHOiDwwCzlQCufw5BH53FgJvRW8hir0jKDqXKeoMKKD7m2IEYg8iqlVNfbmt8o7326AAJTAAAWjAHwEI0p7jYK2pkTq1hgSqgPEInsUI+6tijIsQRDlFjQNrtHa4y9sBJwADJ4DAC3VAmB-BSF4RZeQFZZjMl1BkTmYIrw8jhPkAUl0eyZCkPIkcijlFJyJjAO42AWL43IC3XR+jEhZF3lyMQB5mYiDmE5JIZQKYHkNrIVUPJZBOJTFFAA7rRf8gFRbMR0YTTi-g8AADNUAEAgNwMA7RcBLlQK8cQMB2CsJFkxcCmBWHFNQAE5yuRYRdiyAcFCZQjj5UGvUcQ9ZIE2ArOzSBKTxDpMyfRbJLT9LsSJpQQpuASkEEeA8QC4gmB43YCUh4s56l+CacssWbSOldIQPWOwFQuyqkIrnNQA1xLJErHICZ5orBzIWRwa2ulbarMMhsjpZSKlVJqXUhprCdJ6RuVszp78vqfxqK2ewoIEl1EhINZkFN5DninvtCaAKMlAsRaCvJayCmQt2fsw5JBjmATOfC6ldt2korufWYJZ55h5GZKhEQBUjYzBQjyCwOx6RnlEBSxZjVEqbO2eU3AlS8CwsqfCkgAAjWArC+DcpKbymo8EoZyAmjYfaHznKHFmHIA0Rh7D7QVUCpVCUVWlMZQ8A5RyTnsouXqg1RrblooVltM1P9LDJEgbJKJl1DaZWkHTCwZ4ZBuoCEqpqXqoXqphbU7VQb9WsL0Ma1FH0O4Z3uTUGYIhBUHCsosRQBVHU62ZoKXUSg5CZuinFfwOaGUPD2b65lrLTnnMacG0t5bTUWGKkoUEqR5BZE0AVQiFNUhoUsPsQ29Je2rS6LmtVGrqmFsnaww9bCw2Vo-j6PlIDOYcnkCCXe+LxJ1AQmEjkhL6xV3hrzWugKAhXtzT6v1LKA0XqvbO8Nm0LJ8vKPhE0Fo7Aj3fc5HYEhIEti0MkCZtDq6AZHMB-wa83rHuhZq898LyPvFg7e9F96aidXMNdbI1h0gYfuYu8o9lzrzCrKiE29DSKkbo2B4dTL-VsovXRhjnomORqzqCSwIYpB7AtCM8SVRzUOHqIsHkDhe3oweJjbGuN8asTpUZSj+bqNwouaZ8zttLMPFYfkoyCmixKYQ02hC8xFAgg5pGVQBUFDpDhMkZmF8ZKghMxjBcFm8YExsxClFOypOjpkxO+FzmkuuZSx5tL16eVwdJt0-YAX5LBbUKF8LgYouBj7mUOLhGAN3XUeqrROipDZj6HmOIdzF3MkymUbayhCJhZIdIQ83blA2LsK1qBImXykS65olO2jdE4lccnVaf4vE6J8X4vR5XO6IEWAcCoMXBB2C0IsKJ15Ym9VxUkjNq3-K1w2z13R4h0y4A4AQO5exrAVFw-UWSeQW0YW8pIZrGRlApBVn2G+a2Ao-a271-7gP2DA9JIpiNBjFhYoi6CZYRmKz6mZOUCJUPy6qmZnMzHqBtuHlwGyjc-XcwhCG+d6tBwuxnSmDqfadYoSaD+ijtQyIDhzGZxo37h4AByqcAAKqA8DsFgAQKKEAICBHArpfwLAtcg6spWaZ+Q5VmkbMUKYKgKi6gWA4BwKRp6fZriOAHQO7nMxqOMlHabxWanZJyH2U0ygmgmo4z3xGUw+7xySRjRPJgHlhJ5KwzyGTuWp2HCoixF26nbLWOZAAVA7njvEPF8SnHbvgcz9D5yn+DiRAx3YqBFnYOfBV28MBFzdgpXepH1uXyvnBq+19Tn1pR0oVH+BZ2z4bWEndkpp6Ly6x8NNtgtEMlWOweQpP8Bz-wRSSCUB6IN1iYAz+4wCMy9VfvQfjOMJGbkRtMjcnZBaBCDhSh4SqEGRcH7A5wwHgCiCI0J1b0QE5kPGkEdQW3UE0ATU0CPH5Bj1-jKFuixDACgIqwQC7FY1VH2DrHey1m-imAUjkDkC0A9zRy+w+DwIuySDw0DxyGDwrFDwwgOFhFawHhZBsCsiFDjzvlgVwJ81T2clQmzkMSmj3WOmKGulMHhENmrFAUIl7WaWuWs3BU0Q6SYOrUEwpkNju1Eh1F1FtXuVIWULYxw0UhEJUlI05TBXWT0JRQMM-n2ixUTSrHOjuzFWSHB3chVgiwsFyF7Q9S9Q8PvUcDmyj0cDDnyA0AKkjE6nSCskNnJm7V1AiP7UHXcIkOgPuQSLhBNHmDck40sJ2HrHIR5DmFa15Ha1NkcMpRA3wCPX0MKPwN5AEQ5GhzAVSCOAKgnkDy0BdQ-zmH-WaLE1aLIwXHXneCiK6OYN5BMB1EyF3lpjkkWAKiqAkGINGkHg0FmQcJmMWXyyxkKys083SxKWiK2lknNRVg01wxY2ZAay2BZmUF-XmAV26yx10XuIMR2FhHrCsGrEmPUChHyHgjAVyFklkDyGrD+M21Z2x0TyBMCQ0w9msCsnmB7ChNh05jbBsHrAhmBHJxRKV3EA51OQ3ExMuy7B3jfSOAexhHZDwmKmlWkF+grFj3oK9xTEX2x1V38A1y13ANMiKO2JMDEGlQ0HDiOEsId3ghUEgUukxR5APDmQxOWOrS9hMFyG5CW3hDEVh0yFMH6VDiW0ZjH3wEO0n1OwZJKDCS5AODuxyHcm2H1AROFw0HpHMDBKPxPzP0oGdKmGuzMLMT6nF1hzmCPB1DwhQlu2EJcCAA */
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
              target: 'Sketch',
              cond: 'Selection is one face',
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
        },
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
                actions: [
                  'set sketchMetadata from pathToNode',
                  'sketch mode enabled',
                  'edit mode enter',
                ],
              },

              'Equip Line tool 3': 'Line tool 3',

              'Equip tangential arc to 3': {
                target: 'Tangential arc to 3',
                cond: 'is editing existing sketch',
              },
            },

            entry: ['equip select'],
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

          'Line tool 3': {
            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

            on: {
              'Set selection': {
                target: 'Line tool 3',
                description: `This is just here to stop one of the higher level "Set selections" firing when we are just trying to set the IDE code without triggering a full engine-execute`,
                internal: true,
              },

              'Equip tangential arc to 3': {
                target: 'Tangential arc to 3',
                cond: 'is editing existing sketch',
              },
            },

            states: {
              Init: {
                always: [
                  {
                    target: 'normal',
                    cond: 'is editing existing sketch',
                    actions: 'set up draft line 2',
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
              'Line tool 3',
            ],
          },

          'Tangential arc to 3': {
            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

            entry: 'set up draft arc 2',

            on: {
              'Set selection': {
                target: 'Tangential arc to 3',
                internal: true,
              },

              'Equip Line tool 3': 'Line tool 3',
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
        ],

        entry: [
          'setup client side sketch segments',
          'setup client side sketch camera',
        ],
      },

      'Sketch no face': {
        entry: 'show default planes',

        exit: 'hide default planes',
        on: {
          'Select default plane': {
            target: 'Sketch.SketchIdle',
            actions: [
              'reset sketch metadata',
              'AST startSketchOn default plane',
            ],
          },
        },
      },
    },

    initial: 'idle',

    on: {
      Cancel: {
        target: 'idle',
        // TODO what if we're existing extrude equipped, should these actions still be fired?
        // maybe cancel needs to have a guard for if else logic?
        actions: [
          'edit_mode_exit',
          'default_camera_disable_sketch_mode',
          'reset sketch metadata',
        ],
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
      'set sketchMetadata from pathToNode': assign(({ sketchPathToNode }) => {
        if (!sketchPathToNode) return {}
        return getSketchMetadataFromPathToNode(sketchPathToNode)
      }),
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
      'hide default planes': () => setupSingleton.removeDefaultPlanes(),
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
      'equip select': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'select',
          },
        }),
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        clientSideScene.updateAstAndRejigSketch(
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
        clientSideScene.updateAstAndRejigSketch(
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
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain vertically align': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to X': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to Y': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain equal length': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain parallel': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
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
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'AST extrude': (_, event) => {
        if (!event.data) return
        const { selection, distance } = event.data
        const pathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          selection.codeBasedSelections[0].range
        )
        const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
          kclManager.ast,
          pathToNode,
          true,
          distance
        )
        // TODO not handling focusPath correctly I think
        kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
      },
      'setup client side sketch camera': ({
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const variableDeclarationName =
          getNodeFromPath<VariableDeclaration>(
            kclManager.ast,
            sketchPathToNode || [],
            'VariableDeclaration'
          )?.node?.declarations?.[0]?.id?.name || ''
        const sketchQuaternion = kclManager.programMemory.root[
          variableDeclarationName
        ] as SketchGroup

        const zAxis = sketchQuaternion?.zAxis || sketchNormalBackUp

        const dummyCam = new PerspectiveCamera()
        dummyCam.up.set(0, 0, 1)
        dummyCam.position.set(
          ...(sketchQuaternion?.zAxis || sketchNormalBackUp)
        )
        dummyCam.lookAt(0, 0, 0)
        dummyCam.updateMatrix()
        const quaternion = dummyCam.quaternion.clone()

        const isVert = isQuaternionVertical(quaternion)

        // because vertical quaternions are a gimbal lock, for the orbit controls
        // it's best to set them explicitly to the vertical position with a known good camera up
        if (isVert && zAxis[2] < 0) {
          quaternion.set(0, 1, 0, 0)
        } else if (isVert) {
          quaternion.set(0, 0, 0, 1)
        }

        setupSingleton.tweenCameraToQuaternion(quaternion)
      },
      'setup client side sketch segments': ({ sketchPathToNode }, { type }) => {
        if (type !== 'Select default plane') {
          clientSideScene.setupSketch({
            sketchPathToNode: sketchPathToNode || [],
          })
        } else {
          setupSingleton.modelingSend('Equip Line tool 3')
        }
      },
      'animate after sketch': () => {
        clientSideScene.animateAfterSketch()
      },
      'tear down client sketch': () => {
        clientSideScene.tearDownSketch()
      },
      'set up draft line 2': ({ sketchPathToNode }) => {
        clientSideScene.setUpDraftLine(sketchPathToNode || [])
      },
      'set up draft arc 2': ({ sketchPathToNode }) => {
        clientSideScene.setUpDraftArc(sketchPathToNode || [])
      },
      'set up draft line without teardown': ({ sketchPathToNode }) =>
        clientSideScene.setupSketch({
          sketchPathToNode: sketchPathToNode || [],
          draftSegment: 'line',
        }),
      'show default planes': () => {
        setupSingleton.showDefaultPlanes()
        clientSideScene.setupDefaultPlaneHover()
      },
      'AST startSketchOn default plane': assign(
        (_, { data: { plane, normal } }) => {
          const { modifiedAst, pathToNode } = startSketchOnDefault(
            kclManager.ast,
            plane
          )
          kclManager.updateAst(modifiedAst, false)
          return {
            sketchPathToNode: pathToNode,
            sketchNormalBackUp: normal,
          }
        }
      ),
      'setup noPoints onClick listener': ({ sketchPathToNode }) => {
        clientSideScene.createIntersectionPlane()
        setTimeout(() => {
          // TODO this time out is needed because 'kclManager.updateAst(modifiedAst, false)' in 'AST startSketchOn default plane'
          // is async and we need time for the ast to have updated.
          // it's very annoying that you can't have async actions in xstate and have to invoke things and have all this extra
          // cruft in the diagram just to handle the occasional wait
          const varDec = getNodeFromPath<VariableDeclarator>(
            kclManager.ast,
            sketchPathToNode || [],
            'VariableDeclarator'
          ).node
          const sketchGroup = kclManager.programMemory.root[
            varDec.id.name
          ] as SketchGroup
          const quaternion = quaternionFromSketchGroup(sketchGroup)
          clientSideScene.intersectionPlane &&
            clientSideScene.intersectionPlane.setRotationFromQuaternion(
              quaternion
            )

          setupSingleton.setCallbacks({
            onClick: async (args) => {
              if (!args) return
              const { intersection2d } = args
              if (!intersection2d || !sketchPathToNode) return
              const { modifiedAst } = addStartProfileAt(
                kclManager.ast,
                sketchPathToNode,
                [intersection2d.x, intersection2d.y]
              )
              await kclManager.updateAst(modifiedAst, false)
              clientSideScene.removeIntersectionPlane()
              setupSingleton.modelingSend('Add start point')
            },
          })
        }, 200)
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

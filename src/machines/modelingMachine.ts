import { PathToNode, VariableDeclarator } from 'lang/wasm'
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
  clientSideScene,
  quaternionFromSketchGroup,
  sketchGroupFromPathToNode,
} from 'clientSideScene/clientSideScene'
import { setupSingleton } from 'clientSideScene/setup'

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
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAJhoA6YQHYaMgKwA2AIwAWAJzCRAGhABPRIpHiAHItU1FR2cMWyr8gL73taDDnwEAymHYACWFjByTm5aBiQQFjZgnnCBBEUbWTFJYVllQVkTeWVleVVtPQRBeVlVMRscxWE1SVVZR2d0LDwoMWwITDBPbz8AoK5cUN5IjgHeOJKkkrzheSNzapplAv0LeXLZGnklGlS8+UEGkBdm-DaOroBRXHYwACc-AGtvcgALIfCR6PHESUVJMR5VR-ZSSIyiZSpFYIaTKMRGaSqCy1azKcFHE5uVrtToEa63B6wZ7sN5URRhZisUbcH5FcFiWSCJHySSSSHpJTQ1TZcpLZTmBRzdSHJzHJpY864y58dh3ACuGA+lKiY1iiCMgiMEn+ykykk2JmE0ISRnWNhoYPNthomQx4paYg8xLexDIlEwTpe73owyp3zVCGE1TKjJt6VMqRsxoNyRs1UUu3kqXqosxDs9JNejudrwAkhdur5-J1+iEfZ8-arQHFqgixDazDkUrVcsaMmV5DRBIItgmcsUHKn7WcM29s1787jkCRnr0oABbMA3HwAN3unHIJEwSoilZpAY0aUBDchtSUaPkxrZxm5uqssj+82Udtc6Zz48zk6609n-gXS98V5UDubAAC9uHYLcdy+Kt+EQDRNXrQR-hkIM0SMfJdH0A4yhUaxkIyNIrGEF9TlaUcswor9iG4WBZRIPAfCAkDwJuLcfAgbA6LdMBoL3GJq3g5CAVyNIllUUElhtaEpA0QFZFMHsLAyRRSIlCiPzeaiiFo+jGLXO4N3YzjuIoXjy2VakBLgwNu2EMRBH1CSWUZURLywwNO0Uco3JUTZFG2KQ1LfL1NLzAsdNwOi7gY3AfAAQQAIQ8HwAA0+JVfdBNstF4U7HYlkEZQVGhER6VsQxgU2RytmCkd3yoiLdJixikpSgBNDKrNpDRcu2e9JCTVkwVK4r1hEUwTG7ZDirq8iGpzbTmtinwyCgTouv9bLFnWeYZmKMwewtGSNThSxNgtNEEmBOawrCpaor0uLOnwdhvQpXdMusmt+XEMEESWap+zmGTnIckojFBbZhWfIdX3q0LGtxSLopWph7nR3BOPIOVMBIB4TMgszNtgmthCRMR1EWfUDFUcFBFKvCHICkQ2XQptbo0pGuhRp6mOAsCIK3TAdFWnAoEGCzPu6g8RHWYQTEyJYHysIxjUhwR4Sp1ldVMTtYcaeH5sRxamselq4oMozMBFsXsAlkmsps3r7PO4FcgVhTJGNOpNbWINIYtTV0k5haJzN1HGNgXASCYHx2FQNLHe+oTBsBU1GxoQ7O29jyNDyeEgyzg4e1mdRQ5N8PkeWqOY7jhOfE6qWYKdmtHPWNQJKqSGqfcwpqn1cpddsbI1hsCvM3uiO+bAABHOV2JeqA3uTnqMnWVRHIRK7JEctIZJtLVExSYF5m5QdDbIu7uZo820fx4XqGb-i17MMQcgfWZpAqzD+9mOEkx1CRH8BSNoL5iiNtfU21c76MTuGAecqA1w+HIDXG4sBV6yyqEhWwCkmRJjVnnGwWolDdn8g+NEIpL7qTDp+AsAAlMAABaMAfBAhyluJg7aY0GTWlSEVOYrJjSiDKJvaGu8kQIQnmOG+lx57YDjgAGTwGAeOqBUDbmfl9Hq3JREKwOOkBEdR-jGjDEhOoCknzbDyNIyi0CrjyPrmtAC2B2L43IGorhNkRDIXhDQBEX8gQPmNJCMoxRqrWjBOkFM1CQqT3igAdwYoBAWrFIKYA4lxImlAfB4AAGaoAIBAbgYA2i4BXKgZ4YgYDsCYcxQWbFMBMPyagLxcRuwsjynUJYlgRG-3gmyESahUgKzEWkWxYhEnJP5ixIWGTCY8VybgApBB7h3GAmIJgeN2AFLuPOap3g6mpLmc05ZrStEy2yh0rUjJ9RbF1GyBIyw86IkBDVI6rJiETKmRwVc65sCbnmVkxZLSiklLKRUqpNSmFWwBVuU5BS2lCD3gyTsZg0i1Bms8-uShvKggCiYSw+o8gGwgVfDSPzfCwsBZk0yOTQVrI2VskgOzgL7OhdS+FLSkVFHbhIBWlhIRGKTDJBQZRBqiAmlUOYChvlJN+W1NKSyVnFNwKUvAkLSnQpIAAI1gEwvgCLzkfRbinXl8xyiWCzrvEo0goweTKuK4okMlAPl2LqOV0zFWpWVYUxldxNnbN2eyw5ur9WGu5Rcra3jNTGDFWCaQsw8iyFKtUTWFj-EK3JioJMnqFXJUbr6sFaqIWVK1aGvVTCdBGp5d2WoyR-qgOKmoPuyK6j1l9vMHsbI8F5t8Iq9qRb-WBpZcGg5tSw1VprVG0myKLW6iDhoKJJdRoU2sVnUw+pBqqD7atfAnQi2qvVeUst46mFrU6NOk1L8AzdgtSkSEPZHKiGbCdSGDIy49iMPMWYMSyU0NCpSvd61VEMruOsgNzLWV7LPRe5hkbr3aNvZqeyVQUgaAQuYIqJ0cjJCzqoAj7t1CkrTAjeJ8rfBLzeoe8FGrT3Qqo68K9vokNXK3vCWwaJ1CmhEDkUqCx5Lu2kKaBMm9d2MaHeBplQa2VnsY8xisrGY31qsEVVy8xSjYvgsCcQqQMIRhkP8Kh-64ljiA+jO4mNsa43xrS7JoGznFuPZqs9FmrMAps3cJhCyzIKcstG9pcsHImGKsCIqT4jQOrjJTFkGEDgaF7rutzS5rN4wJsCsykmIMjugyG2pyWsYebS95jLlA-PSwC8i2YwWVCbvC4DRmSwYtgm5D4xLcNyXvmUWqtRGjCy9BLNEWtsl4QqQMMpd20IkxwhRBoDCu85AkeHMbSe3XVEJz63IuUCj47OJuK4jJ7jPEztbkIDUAIHxAk7Lscw+o2w2iQrsHU3YCOSAmWt3rmAxC5lwBwAgtbkLrH1I5fU5MnL7w8oRiQpogxgmyHTSE72VGfe+799g-3yQscuTGqw78LBB1dfyRkpjgQMgTOCeYgd1B-tIytscH2NtfdwGyrc-XiyBCGyds1hF7IoeyBocwZghEeQSP8SmlDBTJiziRDrAHVvI8Z2IAAconAACqgPA7BYAEHihACAfhIKGR8CwTXtaUhajKvqXU-I1hclJ12JMswu2HlUrL0zWYft-Z5S+0R-jagIiM8haMSh6zZBtA+F1SgZexLI2OT36OySIexzWBISQCKEbZlUBmIulBhJMKyTIBozDgNp3dAAKntzgbi7geITmzvonOk+VaKHkP2qJGz4U2LnQoNgC7FQVjUTUFiJkV-wC46vtfClbZ2wz9Rmim+zpb7YByCxUJzHyvdpIXYntshezdN3sfXg+GZz4PJJBKDdEGxxMAZ-ca+GZWqnlSI4Rdg04R3IcwtMIF9gyXIfIRAKCqy3RkDYDzgsotBqLG54xqpOalpVIgFgG3BMIJxMJn6UA8oBQqDHiaj6gKQuzZ6FAWKUx+7Xa1a5Cu4x6tAIHgH4CQEP5dBeBFgN4DAYFkIMjrzWAWjkx1CtoIAIhJC7yiBd7dq1jAG-aIEQENysJZIQFEheiwF0bwHiEsrMIoFyGZgYGAI4IajVTRKbzQhsj2QSTCjniZCDiijM4YDwDhC05Y7N4jZSAyBgIqDCiRb9wpDJDqCmDnx2Qjy3Q4hgB2GL7NocZ4HSpDS5Bf5VBZw+QPrVTQw7oH506vBBGnaBhdjeRmBGIB67zISKClSdgSBUxZxEQBRzATLcypFmrVBJjpy1D+IYSiTbDRimDJBKQAGMiZAYS7r1JpLGSlYOYFJVE6K+Kmj8i7zghcZuEDKtFdwLZMgDiQy7qcpAp0qDGoDDEHgSRJCZDIT+LZCQxoaiqsiAi+TXRZxojR4maH6TIUYJQFo+otKbHbQ8EMhbBoSgiQhBi8EAFlA2gTQULKy2C7oDq+rPHOxEHGJ2DMgTTd5tquzWB0yCEiCzC7pwZgmKbJ7aalD1iMgGCWAJglD5F5wagdyiCex2Q3ZvZJF3RAYSZPGYn2E-7gjrqbwqDfoEHaY8iaiHHXiaidFJYYwpZFa2Y+b0pnLgk1jqC6Z6xdhez+IppRYxGA4CrfqC7Gal4aSz4aKSlCBlHvy3h7SibzbQiknsFKDghSTMhI49aK7x66lFCogGkHG9hZwmki6C7JBDS74GKVA2nrZz5iDM57JbgOnrziBmCAyhZAzFCmLkwdqzAC7Pr6z+ko4q4+Dq6a7WH+aL6OQ9ixijyTBFwGDGgJhJDpC5A9xupW4TL2mMmL7WByRbAElIibB4LRj+KxhWDFSJjJgj6V4HarQ15qJhkHHlB1C7y0wohbBtj1qmibB0zkxqDFy2LH6JxoGBH1lpEHBmjuzzBsxNiEKEG46EYGBJrFGJGUFiDUGcC0ENz0EOlVBSDvxOFOEzBfFciMhvKhhDSOGlBiGgE0FQCQHSF0SyE5iPmpB-QyAWJqDPYGFNbWq5CsgEbSoiiOBAA */
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

              'Equip Line tool': 'Line tool',

              'Equip tangential arc to': {
                target: 'Tangential arc to',
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

          'Line tool': {
            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

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
            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

            entry: 'set up draft arc',

            on: {
              'Set selection': {
                target: 'Tangential arc to',
                internal: true,
              },

              'Equip Line tool': 'Line tool',
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

        entry: ['add axis n grid', 'setup client side sketch segments'],
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
      // TODO figure out why data isn't typed with sketchPathToNode and sketchNormalBackUp
      'set new sketch metadata': assign((_, { data }) => data),
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
      'setup client side sketch segments': ({ sketchPathToNode }, { type }) => {
        if (type !== 'done.invoke.animate-to-face') {
          clientSideScene.setupSketch({
            sketchPathToNode: sketchPathToNode || [],
          })
        } else {
          setupSingleton.modelingSend('Equip Line tool')
        }
      },
      'animate after sketch': () => {
        clientSideScene.animateAfterSketch()
      },
      'tear down client sketch': () =>
        clientSideScene.tearDownSketch({ removeAxis: false }),
      'remove sketch grid': () => clientSideScene.removeSketchGrid(),
      'set up draft line': ({ sketchPathToNode }) => {
        clientSideScene.setUpDraftLine(sketchPathToNode || [])
      },
      'set up draft arc': ({ sketchPathToNode }) => {
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
      'setup noPoints onClick listener': ({ sketchPathToNode }) => {
        clientSideScene.createIntersectionPlane()
        const sketchGroup = sketchGroupFromPathToNode({
          pathToNode: sketchPathToNode || [],
          ast: kclManager.ast,
          programMemory: kclManager.programMemory,
        })
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
      },
      'add axis n grid': ({ sketchPathToNode }) =>
        clientSideScene.createSketchAxis(sketchPathToNode || []),
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

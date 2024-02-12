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
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMARhoA6GgE4A7COEBWGoIBMswQBoQAT0TDBANn1j9NAByTlw08tODTAFlMBfJ5rQYc+AgGUw7AASwWGDknNy0DEggLGxhPFECCMIK8mLSyvL2gvKmwvr29vqSmjoIBvKSYgoFwsr2MpLyLm7oWHhQYtgQmGA+foHBoVy4EbwxHMO8ifryqTNFyvqmNLX2NPYlulZGCjSGohlF+oLNIO5t+J3dvQCiuOxgAE6BANZ+5AAWo1HjcVOI0mE0mMkhkwns0ms6wymwQ0nWYlM8MkVmkFnB1lO508HS6PQIdwez1gb3YnyowkizFYE24-zK1jE8kEKP00mk9jqBmEsMk+Sq6zWCkM5mUJ1cZ1aOKu+JufHYjwArhhvtTYpMEohbKYxJYOTlpIpcspYclTDtFJDdrMaDksVL2mJvKTPsQyJRMM73l96GMaX9NQhlHVKszbVlhBZ5ApTUa0go6gd9BkmhLsY6vWSPk6XR8AJLXPoBII9IbhX0-f0a0CJOpIiQVQXpNGFU3ZSomQSCPaiAoGfT2jwZ3M570F-HIEhvAZQAC2YHu-gAbk9OOQSJhVdEq3TA2LMsZbZJOWj9Bj9KaOeJzPlZhlAct7IOLh1M59R1nx71J9OgnOFwEHyoI82AAF7cOwG5br81b8IgYp2BIIjwjQwaOOYprHJU4KWCI2SZPIwbPtKb7ZqRX7ENwsAKiQeD+EBIHgfcG7+BA2DUe6YDQTu8Q1vByFiIUmTrMe8JrPIsKqGKxjRpI3ZWNkwjEcO3ofp8FFEFRNF0SujxrixbEcRQXEVmqtK8XBQZdsoYiCIax5ssyyh7JJJjCFUzlnvYih5Mm0jKZcpFqfmhaabg1GPLRuD+AAggAQt4-gABrcequ58VZjiIiYZ40Osgj2OCsIqIyswqFIhpKPCA5pg6gUjuRoVaZFdHxYlACaqXmfSYpZYYhHyNIfnsqYxWFUYKiRrkXYiIVAWvg1uYac1UX+GQUA9F1AYZXUeyInsFgGJISh5dIkm2PYiI2jQHK5JG-m1UO9WqY1+JhRFq09Pg7A+lS25pRZtZrOIkJItCBRZEskkObZMwOENCwFfNwXBct4XadFTBPFjuBseQiqYCQzyGZBxlbbBtbKCiYgWLthp6JI1gaNoQg4bZeQqBy6EFA9LRPQtL1LU16MtdFDFgRBG6YFoa04FAIymf93V7ioRg2Aoj6DYRo0s0kDiCIitPst5kYmE+j0vijr29O9GPLqu2Drpg0uy9g8vk+llm9TZpizDIhQ2NGZ265GzJVOawYODddhZMjQXW5RIurbAuAkEw-jsKgyUe4D-FDcY5rHWsx0GDdklHYiwZSMc3aLBYceLWOwsfXRKdpxnWedYrMGe7WdlGPUx61A4tMXrrdSGlUJuzPk2wKA3gtN29K10WAACOiosV9UA-TnPXZEYcmQrdQJ2Zkkm2jqqFslTkLVzVfOW-HQvL0ndFMETUvUN3PH78dgneXSGyW0zJijj0WJdZMjQUSAmjLaB+kp+ZWxfjbFe0VHhgFnKgFc-hyBoPYLAPeKtahIVmNGFkyYdalEsDkYwehsgrEGo4cUj8SKN0-IWAASmAAAtGAPgIRFQPCITtcaTIbQZAKksdkppnKVDkoYGQLJahdgXlmVGhYbgb2wOnAAMngMAHdUCbh-gDHqfJ5E2GOFkJEjQgSmnDEhRo0ZHyGCKGo98CctGKh0RndaAFsAsSJuQDuIjLIqBEPtJEiwhqgkGqaTklRyhKBtJCLIqZWEqXUTFAA7rRQCwEJbMUwKxdipNKD+DwAAM1QAQCA3AwCdFwEuVAbwxAwHYDw8WTFIKYB4dU1AYTEhdjZNlRo6xfZyLAdQjkwIChRhsAozIHjsy5PyfRQpPSDJlM4pU3ANSCBPEeMBMQTBCbsBqY8Wc7S-BdM2ZLPpAyhlCAMDqZklVbwcmSBsceyJjB2ROjdWBzgLZsNUmsjg9s9KO22UZCpAy6kNKaS0tpHSeG6X0o8-ZgzTHKwyl2Se8gTDHUyGiWaPzqFnnchCPIuRfaGiKObTJz1sl5MhRimFJSSa7IRUck5ZySAXOAtctFHKnb9Oxc8so-ddQ2F9pyWxyZJJEsqENZyk1ahLCJSssQEKAhtWSnsg59TcCNLwCixpaKSAACNYA8L4BKmpUquzLHDooJRMx4Qxl1iVVVrzCgKHhHUDJiCn4jj1bFBKhreWPGOY8U55zLkituTau1Dqnm4u2uEuw14VXH2vkUCSPquQ0xtNYawKIA46ojQa9qRrakmrNc01plqU22p4VoR1OK-o91ztKtEaRQZwMKvUMepQuyNAkI0HN3Z9R6GrWy-VUa60xrjQmwVSabmdNTR2rtzqc2CUtBEtJNcxrUzcVIe6g13Ggqye+CN60ej1sRaa5FLat08MfbwjNPbf6BhdSDOoYoqrOWbOdBwTI67dlMMsRYIb0wsvvYuta+An2rv5Ym4VH6v17szRTF5jJajpDFAhFYBVzoFDSFIUEoIOQWCZaGsFrL1nbx+s+xtb7UW3NYx8XDv6zH-rsjqX2mRRTmhUAUYqKwbIzH9vCc0og5ILpYwuHeHxn18vjQKoVVyP08b436AT+K7Khl6k5ZYFQKXwRkOIDI5hIzORWLIZTkKsaPBxnjAmRNSlwsMQijj5r31orcx5x2XnHg8O5cZAzlYjPZsWLZXIhUlGOGhMVBMNM2Q3giaPFzAQQsLk84TYmOzjIadjRhjdWHgvY0K2F4rkXSuUBi2ZLNwzVaJfBPdAqj4TQ+t7JlyEfIcvBgQQhgW6j9GmqMZgIsAxSxxGdVJREik9AKX9rCZMl00TBjsEovKyzb2IezFNwxmdjEEm0enUmMB7iBJKcE0JeHe5CFsMCa9oITCoSc0W0oehbRIVQkCLILIZA6tOzNsQeZcAcAIPuvIaR3mGlvhUc+usaO6gjqoc09QHDKHBwYyH0PYcUn43i7NhFBJWGjmeYSzIHEyCZKIctZhi4ZAJ9N87mAxC4GFRuObJYQiLee32-CNk7AQOA5GIFppkjAmPLYIlyYbT1yOxN98EOudiAAHJZwAAqoDwAQggMUIAQECJBPS-gWBG+dekHUJVDTeSFOaXkjOlDJkWMsCJ0YdXE-YHDkXPUbryLMGiJEp8RCxjPBIfIICT1nnx2rlG-u4eUkM+T2syRUh4Ro1zFRmFIydfZDkI0x0xt1XV9mAAKv4u7QTHghMzgLwYwuydtaEEUA2tRwRF1wpaaPlRCo2HqLIcwswdW1-wAEhvTfaneN8Zr1AxjnUzBz9JvKXucptgBydPUIPaMrP8Lz-wVSSCUD6At1iYAz8E3y4TU1UrK1IQszRwoSwrMIGnUyQogoVBEu1mRjIGwFnEFXaA7mtwf16AC2bTaWANAIeB4Uzh4TP0oClTyHBEPDsENGjG9mZlKGcRpjDy+y6wDSAJhwQPAMzkgLIF6F8GLFb2GHQK7FSGZCJUsBuipkaDHS1EnlkGciPU4McHIJALAPwAgP4TKXAJJG9BfSbQtTEHgMFV4WQJkKzHQKgVIUVyUHSTklhA5BsmPEOi8hyBqglF5wwHgCiHGwzw7yDGTCnVkGzyUFUC7EknSDSFpiOlHTDHg0rxlDAFsPwwQBHSulwM1T8kKE-1qCkA8nSG8g9yKEkBWSCJeyDCUHcmOlsQjzUGSGKhMF1FHlQlrj5D8KQWfiXkCNi0z3ggDgLjRDMHMCEkMFjCL1kDIxTGyBg2SOTyCgjW6QeR83KT82xVSL7SpkiRx2jmsEcAsHcKLyHnaJZH7AcDyyhUxSGJ5VGOqLsKpm8iZFsGZ3yAcCI2VXZGME8mSGlwVyT2ZSr11WQwNSSnrTGPMSJSZD2DQghE5FG2KgyEqFtEmiYXWDITWNrReJ2OCKplmFLQTCKA5j1GKhZB9ksEZn4JUEWDWK-QhNayhOgQbDwl9lEBmB5HHlsAHmckDmsm+15kYzvVWWQx4xxKVl2O-2sAvTkgxFsGhn5DsBOKvDsDYLWIK1xnq28yi3hW2NxLSKpmcl1FNhSSBDMF+1ZliJEEoRg2WEjBYTpOOzECX2MVeP-V8kEj5FS1ykZhkFhHJKZAMFUDyFKOvQ5zO2X2539yNPxUsEulHXNMU3MGDj+xWFVWGkhgKhqGdMh15yuQ3A9PCSJXEGOnBgcz7B4KSFQgBIsGTG7DskWHWAjK11138ANyNysOlNF3aPjFnjXyrj0FlwByyEKBHkGhukOzuJTxh3YFjKz2kj2CJJREUHIVjDMHjEIkKmvhTEnzr04Fnw7i7M7yylDicJZB2xchDhM2yndQrXqGriPxP1QKqLLPpGOB2H9mWC5h5ioUQEaEMNBD0EWAWDkREMoPEOoIFVNTnKSGDDmTyh-IOiAz6wILDmODDD8lUCPCfLEKgAkL4CkPELUM+A-NqEUCoykFmHqGB3wIBARAqkKHZFvMWHFBcCAA */
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
                actions: ['set sketchMetadata from pathToNode'],
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
      'hide default planes': () => setupSingleton.removeDefaultPlanes(),
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

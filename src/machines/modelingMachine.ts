import { PathToNode, SketchGroup, VariableDeclaration } from 'lang/wasm'
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
import { extrudeSketch } from 'lang/modifyAst'
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
import { clientSideScene } from 'clientSideScene/clientSideScene'
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
  | { type: 'Select default plane'; data: { planeId: string } }
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
        coords: Models['Point2d_type'][]
        axis: 'xy' | 'xz' | 'yz' | '-xy' | '-xz' | '-yz' | null
        segmentId?: string
      }
    }
  | { type: 'Equip line tool'; data: Models['SceneToolType_type'] }
  | { type: 'Equip tangential arc tool'; data: Models['SceneToolType_type'] }
  | { type: 'Equip move tool' }
  | { type: 'Set radius' }
  | { type: 'Complete line' }
  | { type: 'Set distance' }
  | { type: 'Equip new tool' }
  | { type: 'update_code'; data: string }
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
  | { type: 'Equip Line tool 2' }
  | { type: 'Equip Line tool 3' }
  | { type: 'Equip tangential arc to 2' }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz4CAZTDsABLCwwck5uWgYkEBY2EJ4IgQRpZWFpcQVLe1V7SwVbYUttPQRBRMtxZUtlGkt0wVVpBTMnF3QsPChxbAhMMC8ff0Dgrlww3iiOId54pIVxe2lVYSNLDUFlgv1VAxSDUWE0wQM0ww0mkFdW-A6unoAROAG-Fjx2EYixmMmhA2FJGlEFP7KJLCZQA4TrBLSRTiTaWAwGZQiNRWVSnc7udqdboEO4BbrBXyQGCvZiscbcT5FeGzf5Q2zKb5mNa6fQ0RKpIyI4RsyxWeZoloYq7Y3EPXwkPjYWAkyJkj5xITmcS7OxVCyib4HAwQo5lMSZRYNESOZxnQVtYU9bz4x6oZ4y94TBUISo-Y7VYrZZaGbUsl2ZMoA0Se1SCNlQgVuC1Yq1iolgB1yp2gKY0GagxFpBSM5mFBHKcT5hTSP5QkHKaSRi6Y669G3iyXS+ijJMU52I1SFqqrBY8mgGfJ+kEzaTWAfCOpJQ4m5pRy4xutBPwAMxIlET0WT-EQlRmBjsagOYcsYekEI1glScOke33h12CirQoXAFFcOwwAAnfwAax85AACw3clYhTfREgMcRvRLeRs3seQIRsUorAZP4dhvSxhCfaNazfD9v1gP92EAqhpHCUlNzbMCEGnZVi29OxVGLcE-TUGhCxyVYNC2P4LGw+da1FetV3XZs3lbUDtyKWxC1qBR1FWPZuIhU9xGME8ljUeSB34mtsWtJdxUwTBgPlaiK0vCxvn+NiaGEeyIUyAteQMVQM0zZIaFRU10RwkV7nrEhjNMrd4kUFIGVBdSvNkX1CmLSRMjsYoGgg+xdMtAgXz4dhPwAVwwEKqKk1K1JydJMlsYwpEQoEfnVNMbEMeYtgyzwiMA4gyEoTB2v-ICxIokDKRsSpZjUbkNBoSp5lECEKkvXYpGSBYoUw0Q2o6gDxD64iAIASVrAyCSed8isk+J6mqKCbHMKQSyMFjClBdipvqVYGlEEtlE2-qdq2w79LFAIoAAWzAM7BtlSiLv0NJSmsUQ7uKfskRUhlC3KTY0nszI4V+vb-v6wHbgCwzTpeKHHWKy6FEWKCK1GqaLEc+plUYzYUf7f5Hx881Ll2wCib2kmcTJgkQfByHyOh4bnXqUEYWDUcdisawnsQbMYWzcoS2sEtloJoXBYO3CAEc8uwJhfHcMBfHYVBUBMqmJMpYxjHEQwpAUJQqmSBEVIaK9slpBEbDyI3tpN0WXwtq3fFB1AADc7Ydp3zrd4t2L948oSqCodRk0xeSRvJYO82dq2F42AaOvo8SXIYM-lioJH3JHjB9Q44sQDV2PmOn+xPBYvsrPm53aE3q9N7FkBIP9+jBiG-BTz9OHIILm+o+ob09kFHtDUEfbmv1ZArMo6m+fc6eKLDx6rqfo9rOeF8l5ffAA1BP2wAAvbh2E3i7GGI1RDZEkACHs8IDhWA1gkLIhYdjyDqEoW8G175CkfrXbERBuCwFyiQPAH8v6-3-kFXwEApQAIoAmIBctt6ly7JzcOUg2SszEFBe8blIooN5pXDBW1p6ixwbgPBn4CG4F8KvdeZCKF4O6jQmW1NYYJFAexZIxRgyLAgj3BAmQRBlGMLuf4Vgfa8LNBPaegjazCNEeI3wABBAAQp4XwAANLeUl6j9igssJQhx-bBgUI5L6kEciqkqMUAcOxI5WOwbg-BhCnEuIAJoeNpt4gEbkGiIn3IoVQjlB6yRyLsLYQJonoItJg4m1j4liMIWQKA3Q0lwwRAzCs3Jyh03bo5WEnsvoAhsK5CcM5zEPwEU-OJIiEkSO6PgdgA1FGu3lnTGYvIy4G1hMGRyih2KHE2BWTCdkDAxImT0Gx0zfBMC-Fc3AFDyB5UwCQb8siqGiUWcA+WKpZh5E5LUCwh5HJiEgkYYodRgxsi+icrBZzal2M-t-P+74gqYB0EZbAUBhi0LMp4-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-BuTuQeSeXIXeMoFXKNN8MLK2IQqQuZRQs-AfScOoR-KGj3N0RskkDjJd1jwDkTKUm1kjXLQnD33guuQhmQseWeXQrtk7O7MDJFJDOCLws4oIu4uIt4rItlgovUCDilQREZDDHooZKkGQgaAHBYqyQ9OyL91u0f1Y0736BtCbkjIDFqG7FWHghZj9F5C23KBUDkBBGgTNwMtUFv3jnAPkzZ0U1dVY3Y3hAgumhxxyVDGmghD2GTPsHugNC03ZP5hyO2i8sgJ8ugMMu8C7weFMqHPiDF3svMEUFsFMXpL8yqBhHAr8RkKsAG10qnmSs4CgL8vcsZ1KzcoCpnNVNLz0OsCSL9FcjSzDBnyUi2GqEjl8FwDdREljHrAwFXAeUeEeQc0zTclKGMwVlHGyWF1Yl3gNSvLpgHgKtcuY2cyMu7xiFc0NBukRC0wOB9hKoQECSgi8lxWsAqnKVNAmowHgAiAk13OS2PEkBkDkH3T7QOwfQJXKu7RKEOQsHEwSstD+vWwZB3Ssp2AHBCRUEEBFSME9isDsB6pgqK09P6kRuUUMEw2ml7CmhmnUAhAfQVmVCBEqGDB7G5D+AgxJlJpGl5EsjBKhHkHHR0L8wDDFwFvCgKtvPhqnn9ydi5oaxTOVBCzcj2GeqxqHEWm22sAmjBGmlT3uxuC8LluonLACyQSVNTP7VYnUEkFLkqkyG+Dyz1upyz2e3pwgCNv72A0n3kAnDB3aRj2r3khVHhlqFkHsidrG3l1p0V0gA9qmHVw4R7SVJ9uVK0lSFrzTA9DqBvHiosWluhwDw4Ljp3HsFeiVumFVoDv0JLGyXSN8TguKz+hlrGwz18BdvYG+vIuSxyW2Biigo9B0TTqDrr1LspTsjkPN2LpS28QHCUBgRMy8nPCUHKtATnqsExpqrvIETwJh0UPYCnvaQLFnow3sjYkrz8wBBtpzSigrDsjhrzu3pALYOv0sI4E-jfTnUfRX1qzAAPqPiH2WBVBgXqHmhsEZvnLUJHRUAnt3pfrfsJBqzfV-t-IoqBA1HKqd2PFOMQnglSDjLZpvjSBgfu1bsXWQa7qRonB+AzD0Q1EN12EQjtyvHqEPkwgnAjEbsJgfNCKKLQoWIwqiKnod2zjZEGpBRvBvDYXDzpiQI0GqElofr+gfMBPmNeT4uWKEYiWVD0SREWFViFt0XDHIKmln3UArFbJ5L5M0fZARAoIHiyXPpVJPGJzsErTBRIwsd9KsZQeSzcnZDTD62MGVuLAMaYmtqhGI0MGuOSB0q3qUaeLbMaXUbcOsYkFHCF3uiOH7GnNemMD+GvHkEaE4dyOmK3O8YoeUT8ZSDhHuI7mWFBG2TARN1in2swPYsQrEvuW4r4bUfKZkt8eMCpMNDDDcxUAZEBWGJBTTEiQkYbuJpuwf2OtUCEen3TvoIcrUGVNoiBAvRvGyRT2KaSuZwatSqaqEe5CiuyEUAzC1xQNDQrC+grGLCcnPziYWYS2cynpSh+HsmKHkAHAqC1oA3QdcghSYPRulUOfGsmrXHIf6fWxkOVAPSulHG5Fchjz+DUmyEqGvGoLHicCAA */
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
              actions: ['set sketch metadata'],
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

              'Equip line tool': {
                target: 'Line Tool',
                actions: 'set segment tool',
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

              'Equip tangential arc tool': {
                target: 'Line Tool',
                cond: 'is editing existing sketch',
                actions: 'set segment tool',
              },

              'Equip Line tool 2': 'Line tool 2',
              'Equip tangential arc to 2': 'tangential arc to 2',
              'Equip Line tool 3': 'Line tool 3',
            },

            entry: ['equip select'],
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

                  'Equip tangential arc tool': {
                    target: 'Segment Added',
                    internal: true,
                    actions: 'set segment tool',
                  },

                  'Equip line tool': {
                    target: 'Segment Added',
                    internal: true,
                    actions: 'set segment tool',
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
              'Re-execute': {
                target: 'Line Tool',
                internal: true,
                actions: [
                  'set sketchMetadata from pathToNode',
                  'sketch mode enabled',
                  'edit mode enter',
                ],
              },
            },
          },

          'Move Tool': {
            entry: 'set tool move',

            on: {
              'Set selection': {
                target: 'Move Tool',
                internal: true,
                actions: 'Set selection',
              },

              'Re-execute': {
                target: 'Move Tool',
                internal: true,
                actions: [
                  'set sketchMetadata from pathToNode',
                  'sketch mode enabled',
                  'edit mode enter',
                ],
              },

              'Equip line tool': {
                target: 'Line Tool',
                actions: 'set segment tool',
              },

              'Equip tangential arc tool': {
                target: 'Line Tool',
                actions: 'set segment tool',
                cond: 'is editing existing sketch',
              },
            },

            states: {
              'Move init': {
                always: [
                  {
                    target: 'Move without re-execute',
                    cond: 'can move',
                  },
                  {
                    target: 'Move with execute',
                    cond: 'can move with execute',
                  },
                  'No move',
                ],
              },
              'Move without re-execute': {
                entry: 'set move desc',
              },
              'Move with execute': {
                entry: 'set move desc',
              },
              'No move': {
                entry: 'set move desc',
              },
            },

            initial: 'Move init',
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

          'Line tool 2': {
            exit: [
              'hide draft line',
              'clear paper project',
              'setup paper sketch',
              'initialise draft line',
              'initialise draft arc',
            ],

            on: {
              'Set selection': {
                target: 'Line tool 2',
                internal: true,
              },

              'Equip tangential arc to 2': 'tangential arc to 2',
            },

            entry: 'set up draft line',
          },

          'tangential arc to 2': {
            on: {
              'Set selection': {
                target: 'tangential arc to 2',
                internal: true,
              },

              'Equip Line tool 2': 'Line tool 2',
            },

            exit: [
              'hide draft line',
              'clear paper project',
              'setup paper sketch',
              'initialise draft arc',
              'initialise draft line',
            ],

            entry: 'set up draft arc',
          },

          'Line tool 3': {
            entry: 'set up draft line 2',

            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

            on: {
              'Set selection': {
                target: 'Line tool 3',
                internal: true,
              },
            },
          },
        },

        initial: 'SketchIdle',

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
              'set default plane id',
              'sketch mode enabled',
              'create path',
              'setup paper sketch',
              'initialise draft line',
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
      // 'has no selection': ({ selectionRanges }) => {
      //   if (selectionRanges?.codeBasedSelections?.length < 1) return true
      //   const selection = selectionRanges?.codeBasedSelections?.[0] || {}

      //   return (
      //     selectionRanges.codeBasedSelections.length === 1 &&
      //     !hasExtrudeSketchGroup({
      //       ast: kclManager.ast,
      //       programMemory: kclManager.programMemory,
      //       selection,
      //     })
      //   )
      // },
      'can move': ({ selectionRanges }) =>
        // todo check all cursors are also in the right sketch
        selectionRanges.codeBasedSelections.every(
          (selection) =>
            getConstraintLevelFromSourceRange(selection.range, kclManager.ast)
              .level === 'free'
        ),
      'can move with execute': ({ selectionRanges }) =>
        // todo check all cursors are also in the right sketch
        selectionRanges.codeBasedSelections.every((selection) =>
          ['partial', 'free'].includes(
            getConstraintLevelFromSourceRange(selection.range, kclManager.ast)
              .level
          )
        ),
    },
    // end guards
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
      'hide default planes': () => {
        // kclManager.hidePlanes()
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
      'set segment tool': assign((_, { data: tool }) => {
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool,
          },
        })
        return { tool }
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
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true)
      },
      'Make selection vertical': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain horizontally align': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain vertically align': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain snap to X': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain snap to Y': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain equal length': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain parallel': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain remove constraints': ({ selectionRanges }) => {
        const { modifiedAst } = applyRemoveConstrainingValues({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true)
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
      'set default plane id': assign({
        sketchPlaneId: (_, { data }) => data.planeId,
      }),
      'set move desc': assign({
        moveDescs: ({ selectionRanges }) =>
          selectionRanges.codeBasedSelections
            .map((selection) =>
              getConstraintLevelFromSourceRange(selection.range, kclManager.ast)
            )
            .filter(({ level }) => level === 'full')
            .map(({ range }) => ({
              snippet: kclManager.code.slice(range[0], range[1]),
              line: kclManager.code.slice(0, range[0]).split('\n').length,
            })),
      }),
      'setup paper sketch': async ({ sketchPathToNode }) => {
        // sketchCanvasHelper.setupPaperSketch(sketchPathToNode || [])
      },
      'setup client side sketch camera': ({ sketchPathToNode }) => {
        const variableDeclarationName =
          getNodeFromPath<VariableDeclaration>(
            kclManager.ast,
            sketchPathToNode || [],
            'VariableDeclaration'
          )?.node?.declarations?.[0]?.id?.name || ''
        const sketchQuaternion = kclManager.programMemory.root[
          variableDeclarationName
        ] as SketchGroup

        const dummyCam = new PerspectiveCamera()
        dummyCam.up.set(0, 0, 1)
        dummyCam.position.set(...sketchQuaternion.zAxis)
        dummyCam.lookAt(0, 0, 0)
        dummyCam.updateMatrix()
        const quaternion = dummyCam.quaternion.clone()

        const isVert = isQuaternionVertical(quaternion)

        // because vertical quaternions are a gimbal lock, for the orbit controls
        // it's best to set them explicitly to the vertical position with a known good camera up
        if (isVert && sketchQuaternion.zAxis[2] < 0) {
          quaternion.set(0, 1, 0, 0)
        } else if (isVert) {
          quaternion.set(0, 0, 0, 1)
        }

        setupSingleton.tweenCameraToQuaternion(quaternion)
      },
      'setup client side sketch segments': ({ sketchPathToNode }) => {
        clientSideScene.setupSketch({
          sketchPathToNode: sketchPathToNode || [],
        })
      },
      'initialise draft line': ({ sketchPathToNode }) => {},
      // sketchCanvasHelper.addDraftLine(sketchPathToNode || []),
      'initialise draft arc': ({ sketchPathToNode }) => {},
      // sketchCanvasHelper.addDraftArc(sketchPathToNode || []),
      // 'tear down paper sketch': () => {
      //   paper.project.clear()
      // },
      'animate after sketch': () => {
        clientSideScene.animateAfterSketch()
      },
      'tear down client sketch': () => {
        clientSideScene.tearDownSketch()
      },
      'set up draft line': ({ sketchPathToNode }) => {},
      'set up draft line 2': ({ sketchPathToNode }) => {
        clientSideScene.setUpDraftLine(sketchPathToNode || [])
      },
      'set up draft arc': ({ sketchPathToNode }) => {},
      'hide draft line': () => {},
      'clear paper project': () => {},
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
  // const firstArg = sketchCallExpression.arguments[0]
  let planeId = ''
  // if (firstArg.type === 'Literal' && firstArg.value) {
  // const planeStrCleaned = firstArg.value
  //   .toString()
  //   .toLowerCase()
  //   .replace('-', '')
  // if (
  //   planeStrCleaned === 'xy' ||
  //   planeStrCleaned === 'xz' ||
  //   planeStrCleaned === 'yz'
  // ) {
  //   planeId = kclManager.getPlaneId(planeStrCleaned)
  // }
  // }

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
  console.log('returning:', {
    sketchPathToNode: pathToNode,
    sketchEnginePathId,
    sketchPlaneId: planeId,
  })
  return {
    sketchPathToNode: pathToNode,
    sketchEnginePathId,
    sketchPlaneId: planeId,
  }
}

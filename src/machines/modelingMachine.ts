import { PathToNode } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { isReducedMotion } from 'lang/util'
import {
  Axis,
  Selection,
  SelectionRangeTypeMap,
  Selections,
} from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'lang/util'
import {
  doesPipeHaveCallExp,
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
  | { type: 'Equip tangential arc tool2'; data: Models['SceneToolType_type'] }
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
  | { type: 'extrude intent' }
  | { type: 'Re-execute' }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz5x2CJjAEAymDsAASwWGDknNy0DEggLGyRPLECCAYW4gaWogrZllaC0sLC2noI0qoG0uLyUpkFqsqZwk4u6Fh4UJ7evgAicGERQSx47NG88RxcSaApggbCkjTZS8rKRcoKNMW6+tKK4hWWBgbKImpWqi0gru0eXj4EfaE+g5AwY7ETibyzx+JLCj2tkawjMWRK+ho0mU4gURlOwiheWsl2c1za7k6916-RewRIfGwsA+zFYk24PyE5nEokRdjy6nmcwMEIQCms4jW5i2BgUCMcaJumK6DwCeKGqBGJLiZO+yUQyi24kMokslgKlnZokMLJ2CDUNE5m1EGtUgiheyuQo6It8YvCwTeYGlXymlP1NAURtO7LhoPBepOMKDgKWe1BymkVoxNux-gG+MJxPo41lbvl+sEqgyNHVeUR0ksNEyrNBXsLhkswlU0OEvIFrTcse68fFADMSJQXWmKRnFV6DHY1HNzeqoazREZYUdCnDizlhApo027i2AKK4dhgABOIQA1oFyAALbsJdMzXaR8SWRqRm9AwQB0pm4OF2nzKuaqTKZe3LHrzcd33Q8T2kGJSTPXsL1SJQaUBLJpDsVRAW2UoDQyHJHw0SolgsX9hTjJ4EyCDsuxTT4e2mfgqUNIxkPUR9F2w1lzSqYx1SMG96MyfDm1FYiSEwTBT3JKiUkjQQDgqMQ+VUOwilQxA5JhPI0g2VZFGERDUUbP9bUeXEHSCQThPIiDRPdRQqlvJRVRoGtDFZQFJDkuwCj5aFBwbdEV3-B4wD4dhtwAVwwIIRjATcRLlaDlDyZU5hfWlqxvUFWVnCQ1WyDQVCUQEf0FGNV38wKQrCiKorA1NILEhUOXZIMa1c2QtnSjY2O1YtHzkvkFB0ny9L8A92GPYgyEoTAhpA6Lz2ohA5MKGk1CORRNhRVR0rkA4CnsyMtlEWxvOtDwppGo9xFO48AEkW3tQZhiisyZRq90a1pDJpEBQFsu-RTUkRA5ZzrJQiwUZpCt8i7huPKGQJu-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-YEjnbGZFB-FONxgb2zVmoLmMqbU1jRaLmhJ743s3M94Gp7T8y66qSDlhFmRUoHa85FQWqf4j5KiuUfDYKH+DFWZ+qxnr3WfqeqED8phABeYTbOOIUon2yH79oNcqNSOR1T7O2falxAB3ChwR0W0MgZgBhTCNFZ7bKgAgEBuBgE8LgfOqADziBgOwe9a-TFTAe9PAZ-VjRCKoYbXzIEM2ScPDThBoInJCI-M5SfeWc-S-KhYBDFOhO-D5R-MAl-HcbcYBcQVrEgdgZ-bcZGP-QIQAnAm-QSUA3AcAvPaCHafbWkT6LINQDuPDKlZaOKRnZCJiU-C-DgJRY+bAU+fAh-FhJ-F-N-STT-b-X-f-e9dlGQ5gogiA3MaoL8UWAHMwQHeaGsBYCoSMDYNULMFecQrArQ2Q+-dRBQogggEgsgigqg4BWgjQxwnQ1g1ACAxCf4Y4KQROeoVqGOGwSSdYPHBoPKNeZPRVTAyQ1JbxRQ1-d-VQn-D-DQkgAAI1gHvT4BYLYKX08zKWLQ40h09EqFNnZFiPyD2AuHMDWHsLSI8QyLcI8O3HINeW8JoLoIAMKOKNKN0PYLmgKCdxXmOELByD6gdxjnDyWh6TVEDTLQ6Iay6LSUyOUI-zwDULyPoNGPvR0DKKCMmNmC2kqCZCLzCIETVFDwWJMMJy0ii27jsVSO2PSUyN6P6MoOoN8JOKKLOIuOCPY2Z1FSMDSCxyEBO05Dj1LzKR4mSIwIkPxHwB8D2OyMONyOGPvSaR8HBKuKECqLrArANnMCzDhPmg2C9A1EfE2EKCOFBC2OMixJ9h6O3FIL6K8KBIJKJIfQmIqMslkAWCODikh0+hiL6Q2EWAaFDhajUjQOix7m+K9kijTSPBxJULxPUPoNTQWRJNFPz1kGzDqC321HUlNluMRIsBPRblzCXDRPVIxM1PmR1O5N5IBMGOBIAKNKPBNNl3bxXy2jmDkHmHmE2QEVMH+HeLhBqEwg+OrXiQ1IeW3AeVwCeReTeWcM+S5MCKyL1K-3xI0IzKzJzNeW3HvQIJYWDLpzl3hM7xrGsG4ULBWjBTrAtnsHhHX2J1ExTxhnTPuUeRkNzPeXkMoD+J5M8IGIFPLNHOzPHOrNrKnOFMCNY2NUBjbNYnWNpPUE9B7JHDWCOAHPhVJ2PCCFwHdVIjtGIgwA7BeWCAoMkx1T2EH1zEQjoj4OhFpOtmLUnAUikD2ELDThIAxI6EHjxCmFN2godGHlJLKGLCgKLGiUaBOHFPFROB7OsKMK7TTmPHCD3CgvN1gvfMXgODrDC3MAjT7VKFFWzHUkVEjNDU7kHPECIvIBIvwHgoiHItbw5lDJBWDHqGGzijRyWIYrWGt1WW2TyGrnsnr291e29mQ0DhDKDxXx3Ur3hAXBtRsF43mFjzsDBirGwVRI4vlmn2k1e2YRgE3Hgzv0Q3Uu21NJ0TVENBvG4Lx3WJvCMolLpCwjODjycDRBvIwHgFiHOU0uX1HAw1pXyzV3UFMPvQlNVDVBMMQn7DSDTmxFiu1kaGJQT0nAQnhFpL2CnHKCLC-NFj-JTJMzOgKvdH3QkA0CsCMFFi-IsF4xhGLGMTUG0kJ3lXQMRWum6Gaq5nmP1SV2yG0iOHShlRpB2mLDNEHE1AF2q0mp0W2UNEUBBBhPdzEBYh5kyDJnWDNjMBGrVNM2mxnx6Hf22rmmQTjn7LMBakBA5yYoBWjVhOV02tmzFyS2ewgCetmAsD0R4N5EVG-VBU10klor+XkClLVABvizq0ewW0gDBqEEywjjNkQmSjSA5wRoqCRpUCLFRtdNuvTyp3YBxvmk6uqDRzrESjMGOv-WMC4Q4ksTmAOmus+LJ1h0sxFyCCBvYCirby0o6vQQsF6nZAdMfBJppDJpiL10sOUsFwZoNmtwqCExvG-WLEWsH0GsZ21CyhUE1pnyb2z21tsCqE031tWDJsG11j1jek4ijIaAFtTJhhsss0zzPw4CARfRnV93k39zAAZp71ogaC0lKrrGrHL3drVs1AnlVMFr9rn2trnyDoWSCD9xfSjsbNDJ72zB6kiTvhrFDgHz0VyFwUgM+g2Cttm1FqY2jvsEV0lK5CUFDQ1wYornMUuollOF5AnxurTPdKALwPzMIMCIZvB3+ShEThai2GkDwybgjzfBSgOwzt9vOg1P8LkJcOnKIIXtDnQQNFVEngrn7qUhlM5AsWyFsMDSTysrdKwPSK8UUPPqLDU0fCWFtyskGzGw-VXj6hyEqDrHZPSN2LPpLulrbjgjyGlWhE+pjnWI+jCzCwVqSPfq+PdKFJ-oQeX0OA-VBjeirHQefFWENCak2UaH5vYovKHIPvdMDOIaltId5AkGOFOGdp1BML2V5ElR4Rkuyz3sauHPdIrLHOeWrNntcPnpIdHmMXjKPV5HsgaFMO4yzUhRy1nCP0ZWvNvM7GLq4e1iOC9FCShHZELEuzvo9AkCZPyUqG0mYYVQgsv1IqHixi1ndByBUlDk9G2WQlFXov0CYmvFdxyg2CskkY8C4p4qgD4u9X8YzHKHSGos1BtUQSVv7UXGzHFPHxTmyTCocCAA */
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
              actions: [
                'set sketch metadata',
                'sketch mode enabled',
                'edit mode enter',
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

              'Equip line tool': {
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

              'Equip tangential arc tool2': {
                target: 'Line Tool',
                cond: 'is editing existing sketch',
                actions: 'set tool line',
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

                  'Equip tangential arc tool2': {
                    target: 'Segment Added',
                    internal: true,
                    actions: 'set tool line',
                  },

                  'Equip line tool': {
                    target: 'Segment Added',
                    internal: true,
                    actions: 'set tool line',
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
                actions: 'set tool line',
              },

              'Equip tangential arc tool2': {
                target: 'Line Tool',
                actions: 'set tool line',
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
              'Move without re-execute': {},
              'Move with execute': {},
              'No move': {},
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
        },

        initial: 'SketchIdle',

        on: {
          CancelSketch: '.SketchIdle',
        },

        exit: 'sketch exit execute',
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
            ],
          },
        },
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
        // TODO what if we're existing extrude equipped, should these actions still be fired?
        // maybe cancel needs to have a guard for if else logic?
        actions: [
          'edit_mode_exit',
          'default_camera_disable_sketch_mode',
          'reset sketch metadata',
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
        const hasClose = doesPipeHaveCallExp({ calleeName: 'close', ...common })
        const hasExtrude = doesPipeHaveCallExp({
          calleeName: 'extrude',
          ...common,
        })
        return !!isSketchPipe && hasClose && !hasExtrude
      },
      'can move': ({ selectionRanges }) =>
        // todo check all cursors are also in the right sketch
        selectionRanges.codeBasedSelections.every(
          (selection) =>
            getConstraintLevelFromSourceRange(
              selection.range,
              kclManager.ast
            ) === 'free'
        ),
      'can move with execute': ({ selectionRanges }) =>
        // todo check all cursors are also in the right sketch
        selectionRanges.codeBasedSelections.every((selection) =>
          ['partial', 'free'].includes(
            getConstraintLevelFromSourceRange(selection.range, kclManager.ast)
          )
        ),
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
      'set tool line': assign((_, { data: tool }) => {
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
      'set default plane id': assign({
        sketchPlaneId: (_, { data }) => data.planeId,
      }),
    },
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

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

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

const constraintActions: ConstraintType[] = ['vertical', 'horizontal']

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogAsAJgA0IAJ6IAjAGYaAVgB0gwQE5Zm2dOkAOYQtkBfI+LQYc+JdgiYwBAMph2AAlhYw5Tt1oMkIFjZvHn8BBEEFXSUabQMANlk1AHZBRKTxKQRpYTjpJTikyI043TVpAsETM3QsPChrW3sAETgPLxcWPHZfXkCOLhDQMNk45QUaJN0J1QUFQSmFDJk5KJy1OLjUueFhNWEqkHNaqxs7Ahb3O3bIGB7-PuDeYY3oybkkmkFRwSTkpayaNJBEpdAktoC9mV9qZDjVLPVTs1WldXCQ+NhYHdmKx+twnohZElhEpCjQyXthElRiM4v9SnkIkTFCUtsYYUd4Q0zk4UR1UF0sQEcY9QkJFEpyr8NNI1KUkuVaZIhMIaCopkltHt5Do2dULHUufYeZ5XDcwIKHgN8eEaFF5qlSqC5n8lQhNsD3bppBM5HNBNIDhyDYjHG1UejMfResKraLwrJiXEaBo9uMZTQ4mp-nMojLymoFMIgQoSrrYfqTo1Q7yAGYkSgWmN4uOCW35MkiEbyDSA-5U2Qg9bSSJJkqFXSBuHBqsAUVw7DAACc3ABrZzkAAWjaCsaGiAKA4mMVkkUmlN0i1dwgT+Q18gvCh0KUpk4rCNn86Xq-XW+kfmxO7Nnuboaq8x6nvokyXpk2QRCSCh7BEXrXuMcSvsc75nDOACOACu2BMC4YB8Owi64Rg264oM-CIF6qqaMmw6FpmJbSH2oE7MOMQahqyRJOhnIhjh+GEcRpHkeaf7RoB1FhF6cTRGotqJLsszSOkroXnk3olLMraFl8ZZBpWZwXGGLh1g2Ub3E2skEh8+QJpBiSnl8-zakohLFIkIj6JmAnTty5kkJgmCUSKwH+gOOyjJMIhkrM0GICqwJ7HEwj2g6j40NCeoYYa5zIiaLghWF1kAVR1qyF6KibLoXk5ToiqZDVhZkjEej+l8MQBSZ9jCQRFnYKFzjhbuNFupm8GJCpT6GP8jJKIYlKzMkiSymh7JTn1BADYRNbDXY3RSTZMnWhsajTSmRbqfNrrjFEMSUpS6kbJSGi9Zh9hiWRGAuF0YDzmNQETeoxJyOlsg-LMuwRII-zDroSRKGoyRI6k8zVUCn0FT9En-Z+QMnRVEWg2Ug7ukWKqAt6SVZPMeSEjpKm2vMuXlvlDhruwm7EGQlCYFzP7A3ZCAGNoKO6KUJ62qjhSyAjEzg6MTrCFM9L8Vtb5KELPMbjr3ObgAklWxrtJ0QPlUKZ1xrsmwkrs1Wyu1w4aZkVIKboESUoSGMGAoOO65uBs-ibQW8u4UAALaA90VuWiDYR28CRIaI6LvNfuN6FFsSNyIhmt5ZyQf6yXYdIpcxUW3H-7W5Vtt7HkhRqypdu9vdnwgoo2ijkj9WB4bpeD+XhWV+0kcx5btcJ6LuxyNEXugtkMp2+5RKeWUkSs7KKWbUXBolyHesj3tLjsKgqBldPtnWv66kSnIiMJAWIj-GUCnlBmsp+doIgDz+R9jazjwoNKOqAABuYAz4XyvtJeukUgTIwmPKHOSQc5ZldDob0KhJgjD0M6VM-89aAI3CPJwrgx7BBFlVQEA4Rg7AvEmMk+g37lAlEmeU0NvRegDFrTmg8SEj2QCQNcbgwDR1ji4SBi5ODkBCtQ22UtVRKTKPVDY+gvaZyyLsZGERqrPxiPodQRDg5lyrMI0RE9JEblQIubAAAvbg7B5Hxxvoo+2mh1D+mTB8Aw8NMEymUJmF+7UVTrELhzYuAizFnCINwWApESB4BcDYuxjj5whRcBADEziKDmlcTbYCLdLofDTnIZMsoFaYP0EEoE+hNBS0zMOExQ9Q5VjibgBJi4km4CkUuWRmTskJP5vk6+hSJpqxLEoFuY4t7di0epSkJIDxTHUMOIslQ+FRIATE+wHSuk9JKvgOwCiimQmiP6cYOU5iAhiAjPYqoiR+lUGSAwOQWmCPafExJyS7D4HYFuAp8CJlamiNeNWtpbSIP+CqHQS0SxEnSh7X47NjL1EPrs4g3zunJNSQ4pxpUJAlRwFAXApyJkXmJJENmcg7abDpkCMkKh1AlCTBtT4E4tkH2icPL5nSfm9OkQM0KRKQrYFJeSpOoJLrDkbrMMk1IEbjBKakBIHwblqz3pE7lOzeWxOxYcsAeFMl-KgACyVyUpbRTvsOEoBYdD+JgrkYE1KVgiCpN6VF210UCIADJ4CgQAFRgbtEBhEwGQOgZfC14Q4aeScjEdKjdFBv0SBKQklIfGqCRgHLlVhD7+twEGmBSgAAK-J5wuAAIIQAwBAAgNaIB8gFEC0mYRlVREmCUFUXsdBiFdB8Ac+YUg-A2DERQHzC3FsvjrcRk9XCNsgA22tzap5wLbYgQwUNFIIQLOrKk-bMjpWUKkGUTyiQXhSJOgNLhg0zqcBIyti761xKjkwI6UDLCjPXeNdtbVpnzGYRoA9-xMyqhlD3NBw4obXqLbektD753VtrUu0+RaADuUbYGnWBe2hMiZZVFgeipbMKppmKCBH2rxnxYPTswEoI2uAOAEBjaoeUOCJhpRPFguk4ppjyE1H42YtH4MzsY8xqgxM64btjY+NUBYfKQzphejeCQdSAmbrm-e+a-U3rvfRgAcqgFw5auiwGXU26urH9DEm0GSLiyCpZ9hyBKQy+YgQqhGB8qt6GkmuDxek5xmAsk5JGQTGsqACAQG4GAawuBwGoDXEoGA7AAC0AWCWYFS3gCLMbqrqE8lML+gSmkI1BLZtQIg1ZfAykCIy3qSFKB835lJtj8UZOC0M3JlBwuRaXIuWxSh30kHYBFxcUdkvOHS21wLIVsu4Fy6239BILyqg5Rp3IVJIhlaBPkb0PZsiKEKGobzvmOB9JkdgORnXQt5N61FmLcWEtJZS6loVV25s5dQHlxhnk1hEgPQYdYCMUjIwTMmS5KEdGnZa+967IXhl3a+wQfrg3hujdsRN17cPPsLe+0txOK2pkJkzAD9KQOFnBJBGE-0SZuofTzT6gBzXztkCgHYe70Wi1PcS7F17bO7DzcW2M3DK30rTPFnRQEhZKT3JKOwlSBRNgjE5dppnxCWeomOVA5HqPFxDcwCNsbWOpsC7AEL-HIuZP6IHGqwob0dhoPuTsCXcwnwaN+DD87pqAWc8e3gZ7fOps+43Bbn7SZPIlmfpvNBjrkoTFqfKTRI5ARe9cCH+7euDdG8x5NtLIew8E9FvovIOVuqJG9J8KGMLjzTPKCeAoiLRg4xnCRX69guexYD7zpQRBFxgBG1AvGFEi-WlpcCLqMR-S-EiCeBG-s6+jGvJVj1my1dKFb+JDAoaRJETbxJGN2QXPi3lLkZMpXXTrDGK2VGGNNjkhb-v7fp9h+SSt8t+m4wQRMVj7TjhdJ6p2xNAV4tIwRH8t9YsyFzJLJv0cMZN1JCgSRNAD0UhyhHw6RrwJQAdgCVQMp3lGcN8n9YszZggXAAAlAfCACQUMVwLrEZGNMJR5S5XIHYKGDQOkeQFQR3FuFUEoW0FpFwXAYzGA6sYqGAhgxGEkdYJSO2IrCYBGQJanAsBCDRIjHGAAMUOmcAe2527ySz7wHwXCGhGhrh-UJwQFP3gleVBEUEMjjwQFRlt2vETRVhEAUAiTRSUE0JMJ30GgOhMMP3BWWT0T3WTFYmzCpFvHljBm7XcI0K0PYF8P2gSMk3f3MOyGznpRcimALFyAWlmBRhWnUATDUlpniJMIY1NnMjNEPxKCiDmHcPtEq1bGTHyOUD2HQRKMfDKIIO8KOlnRRAGHIMoOoPIRcG6WyVwkjDSNnmYT23JyBE2GXwiIUkb0MBiJqQ8Iaz6OcAGJNCGIoJICoNEOuGgFgJJg-3wVLzonKA0QvDn3uiLCiJLAzX9HWHq21hIDO04HwDEUGO4BoL+P2J8FHzjB0AzBRihmHBlCilyKVVGDBV9FKAo2bhxk3E8BXDqCBK8AGBY1BOAiYiiATAhkzEmRLEPRkARWmXlChipAzCmA2DRI3AxKxMoVxNSLMNFiYiCSHDKALGvCpARiQhUA7AzBmi9jiIOCEIwHgH8DRU5OtFSy0VS3aKKyfCRWmBLBxkRAVJbHF0MCUiV2SHr1SARi7AlF2HJD0C9FSA+P4R-F1KKUxklmlgejljukyAFMHE-kiHqmqh4g+V2UdJBSlhRjKCBGSA2BRTdhkAmAUjVhzkOxyk8RE302DLCFPUullALH5M1D0AWk4PqmvAKAVWqjVlTJLSaBi3TM3TPBRnpQSC3kLCqXdgMFU00DHVbHegrJnVMyfRQwgBrPCGUKkJqznl4LYgHRc02ASAyiRhVnlB7Po0Q0kWfSHMMHnggz0FvyuVmGc1WMMjnK2zziXIYyY3YCHNVWRmzIQmbLzF0Gc1VB2HWCTBPEMD9FPKMxMwrXYFlIuPMK+FlBBE8UpF+ERgpIsOnLcyaXii8wIMPjQEjTTLgI-1UFSHyCmECSUgTxjIBFBBRlwUiD9FApO3goEU11azSUywR26x1zxyHKhjmAlEhTTD7mQLKyeKUhqxPG-hZTTwu2FRorCy+wYsApUCUi9hXzUk2BB07hyB4iT0hRKH4rN161EpqgTPlHGBSBGGd2JEtKJB2GyipC2O1kPgoozxEpQvMNpIUgzAyJSHtWSDplwMuncMhCTD7W-nAPbyHPd2mUMFP32wvyPS9iWhpLQW7BGFTwIM33b0qLsD8tJOmWQJzGXkfBbNokwIKHehKC3Jyh8okj2JxO4GGKOMyH-K5L5K7lbABw0XUFwvqmUUdweTPXtEKowCUEOKoKHJ2FUBUDkCq3VnGF0s0k4IpBRQhBSC9gEKEIsnrDACHMq20lbCWKZC+BkswTCXglTGlwBy9W1h2IvOsq5M6mCINK3lyMnMyG0DBxyHeiRj5KpHKP6PLiSr40ZH0k2CUjkHyIUndWdC6PBK021SsCOuKtIO6oquk0uPqmRgKBsPJLmCTDpncORgQPWLSk2Jet2Kht6qBGBB4R+EqxzVGFRrQSwOiKxoMFMvyi+L81ZLDHGhnmtHRnrI+AvD2C9ARSVSRjDMmB0sxhtKZJZN+LZJBhZrBO0BPVVkMEUEBFNMwUiFszpJeW5vSk2RMCAA */
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
      'Constrain horizontally align': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        kclManager.updateAst(modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Constrain vertically align': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        kclManager.updateAst(modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Constrain equal length': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintEqualLength({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true, {
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

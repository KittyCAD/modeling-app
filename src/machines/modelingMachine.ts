import { PathToNode } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { isReducedMotion } from 'lang/util'
import { Axis, Selection, SelectionRangeTypeMap, Selections } from 'useStore'
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
import { setAngleLengthInfo } from 'components/Toolbar/setAngleLength'
import {
  applyConstraintEqualLength,
  setEqualLengthInfo,
} from 'components/Toolbar/EqualLength'
import { extrudeSketch } from 'lang/modifyAst'
import { getNodeFromPath } from '../lang/queryAst'
import { CallExpression, PipeExpression } from '../lang/wasm'
import { getConstraintLevelFromSourceRange } from 'lang/std/sketchcombos'

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

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz5x2CJjAEAymDsAASwWGDknNy0DEggLGyRPLECCMrCCuL20qrCRpYagvnaegjZBtLiBqLploIGCtZVyk4u6Fh4UJ7evgAicGERQSx47NG88RxcSaApdcKSNKIKi8ppwsrLwsX60oriqgaWBgbKImpWqi0gru0eXj4EfaE+g5AwY7ETibyzx5lLu1sygM61ERV0+ho0mU4gURlOwihlis2SuN3cnXuvX6L2CJD42FgH2YrEm3B+QnM4mqdhoyPUILqBm2CAaFTS5houQUCMczmubQxXQeAVxQ1QI2JcVJ32SiGUXPEhjBtWklgaokMzIhqVUNHEG0WgjVqkEUN2aMFHWFvlF4WCbzAUq+UwpqRoGQ2pwacPW4JKJxhgYU0kWu3Wymklrc1qx-gGeIJRPo4xlrrlqUEqkqdMKOSRNEOLPWGTVhkswlU0O5fNaMbu3XjYoAZiRKM60+SMwqMgY7Go6mbalCWaIjLCjtJ0n36tUFNHbpjGwBRXDsMAAJxCAGtAuQABYdhLpmY7SPiSzAyOXwGFUQs01BtXVEEV9VSZr89Gxldrzc7vdD2kGISWPLtTwQepBGpEN8lDGhVBDLYdTUfVZzvYFQ3MS4vytBsHieBMglbdsU0+Ttpn4Sk0KzBR1EKdING1EozQqYxajyNQ6MOBchTjO1BhITBMCPMlKJSSNoIsEEllQrlhGQko9RhZEDFUL1vWEUMcLrRcbUeHF7SCISRLI0CxLdRR2ROJQwQQ2RmMQENJD1OxjR5aE+1rAV6yXB4wD4dgNwAVwwIIRjANdRNlCDlGRJU6kfapK0vdYWSnBQJEsfJMtODYrM-XS+MbAKgtCsBwr-KLgNTMDxPlawJ0DKtXNkLl0o2NjNULPMPQ2HSfL0vxd3YA9iDIShMGGwDopPKjSg0fUaDURFFoVbJ7x1S9oOSmQcl2CtRF461ptG-dxFOg8AElGwE4JhiiszpTqt1pB9C8NA8plynVFlyn1EMzVfdTrAU46PEu87IZukUiNCKAAFtItGJ6XXA+a3vVD6vV2Y41IQlkzAMakLCnD0K0jK9wc6SGLpG67G0IsUHpRkDnosjM3oUi91SsRYjmUywWRUDJRFEY0PXzdQrGpunALls6YexZ4jPhpHHrZtH6tKHkJHkLJ1AUGpsofQxxBEWpxayCXFFl2noZXABHYLsCYIJ2FQVBTM1ijLK5Njp20wtPMEUc+yVRC4vgpZlqjXDfIVg9E-3JWCGXZ3XaCBHUAANwqj2vdm9HZg9NjpPUZbIykFkKYNTD1nsGycjt+modb1OAmCFWIimIvtbVMwczF4wtXqRyEDHfVsiNwtahyTU46Kk7W+T1PkBIXcQjARHkaCPON04cghL716kKVdYjErEWFEy9LoXZKsQT7I3jWEFv5Ydh5183tXd-3VANzYAAF7cHYMfVGvtOZggyOkewqkjBqQrOlOBlQqjyCrEoacR145DRXp-XwRBuCwCCiQPAQR-6AJAWuISQQICEjARQJ0ECXpQOqJULm+QVArFvjqcsMIDg2UwRsdIhVBpCntu3RshDcDEI3KQ3Ae9NyHxoXQ4hE0mE+xYRBGwlh9QpQOp5awdR0piAqOLLS5g0HmlEd+CGeDJEPGkbI+Rxl8A+BPpzOEKk+wOT6nYHk6VNgGkOLkUJOQ1jvzOqvKRRCSFkJ8Pgdgh5mEc20UbDIN4GjHAKopfQjQLzLAVCIrkdE344PEfYwCqcnFxIURQ4BoCTI6GMjgKAuAPHaKWMTJQCFzBZIOEbdK6kYSRg0EsRCdhLyWEiUnfBxBYlyLIfvZRwlmlCWwG0jpGNljQQVMCKohZzBiHSiIHasg1DIhEFpOEMy25VJiTI2pQQwDOxoQkqASStkpDejYA0voqg5HKFOLQvC0gwK0sOPs1g3K3PEAAGTwBVAAKp7TAacM5u2znnd2qKvlCEUDA8ZCk1TpE8qOJQSouQ9SnMIfIGhYUItwMi1F4gAAKEo1xBAAIIQAwBAAgPKIDiklCkmK80zTAnNg0dIUg1JqFWMWKESoThQkyn6I2UgGWIqCCir2F1t7q2CIKyAAreXCo1rVVJ4rEIVEOJlLyZpCz1EJqaA0Bx1JPx+dJLVTKdUsoCDvTlxr+WEIRkwHw64gjuA0ZasVsxgQSBnsPMFyJcmpBvkqXKozlpWDij65leqA2Gu5byk16cXZuyZQAdxxYXUVc1ZgV32G9MeCEjhHGFm9JU2Uq5yGlTYvCNMV6MoLZgcQV1cAcAIHihA6k1T-CuZqXIVc-r2EyPUMQmokJ2AMPmv1eqJ1TqoDVciWj5qmmypkS5cClAghBSUSsxNCglJSosRYu7ynL3liO-dY6AByqAgjspGLAU1QqWYzoZJYC8G0wSvuRMWdSSoim6N0a-TKsK0DYt1WizuW9cS93rcXIQxwsq1DNAcFQtLFijjSAaOoO7VSZRULCrlVbSHBHqVQsBmBaH0PUZVZsqACAQG4GATwuAc6oF3OIGA7AAC0XHGmYHk3gITkGljzEQsiTUxpgXHHSku2EZpjBuX7NMz9dj5ZsY4+QgBDTqG8dUQwyggnhObg3AA8Q4aSDsCExuBGsnAiKfs9xoSqncDqaI9rQ28xDrS0aEbS86UqgZFVdCcw4Z1isfYxwRRB9sBHyc-xxhbmRNiYk1JmTcn5PLMK+FtTqANO6MkOYeVtE4TGBMY1RCzHTOImfDl2zdWit8bUaVxrBAPNeZ835gBgWasjYa5Fpr0W3TqBa2IdS6kOtGE2iUYFO0b7i2MHCOktQht5bIFAHwZXRNMsq9J8TNXrs+Ai1FzRVqUgbdLKcbKUEpxVkCZWC8HplrLFHh6S7eI3EVUm9Njc3nMC+f8wt4Lr2wDvdW59uNiANvQYvuqdtHqpyBN2Fe2QNhKfGiONDqNkUPn7juxVvAVXnvBfeUkrHzXibqErApDQm7VDpXVBUZaHoTgWHzBsOnnOmfw43J5xHs3UdBYU3L7na2MwbeJttKs+QFSxzTWqPYKrG7yCfkoW5QRcCAZIraIiGBWzBUwPdZHTKZ3ZDipICsb1rw8mBKHFCU4YNQjqEbae5hvK2M6CQXLnB8D4ftFMeMXcEyEZxw2yE5RqS6LHDyY4kZSe8OXdSPsGx1T2svPOSznQDzhG3B0JPPduDTq19o0Z+xl0cgOL0kxak-mrHNAxyMst6-kEb4n7uiRp0nvMrj0olNKjGgrhodUwIhagqkOwqj2VTRg4GjH5O4gsOjpP7nOHk72Bt8z8RhAFt9Ti2ktPXR0JkF-EODOBUxo-sDoTrTU-X9c-bFPAI9OfdmBfEWeYXYAeSxNkBDXhbIAnPIQoaECmGWWvY-QAnDYAy-I9VQW-bWEQDNfpYwdSRuewO+FrMebdEMGAvkfkW3DAeAWIGPWNLPe-OkSQGQOQRQFQdQe9RAeTOLFUOoGwTUb-EMWWLEdgu-YEbMKQXRKoQ4TUeEIPA7QcCOXROkN6EMU4aPQdZOWQ-uQ4bMHNVaPZKEdQFkZyJLU7WQMEIweQWFfBYw16S5fYJkMPeQQoKoGuPULvKQHwkMKPP-XBb9bVHDNw7XA4EwS5WlaoLMCwQQ2dM0SoHtfaI4ZQm+PdHAnoMTaIiCYwNI3IJ-EMVVBkRDaCZ9f6WlKwK3TA2mH9HA4DINUtCAQo89NDc2ThXKHwk4fbRASsIMFDG+EEdYCwXI-1A1XeYNToxtcOODCmfZIcRDEYrkSvcY84KYg9K-eYvHV+H3U0BIqQKXFI65fYC9FQFQU4OkD9JeKzKJZollADIDDldgFg+fDgg4SVU4H6U0aeOENYyoFDOkLIRiTDC-X9fY+-YwLKQFMwBNMQmuNIy8HxOKc7QsOnJTRzMbFzS-ITGEi9JaGwARDBWlTfA7Q4PRXIXrUJKEEEOnJbYrcbVzRrIk7-akQcKEHNbIZaExDYTwrSQ4RKKweoOnDHNzDk35PUJwsEhEJQQJRYTIEWBEewOoCsWXBnJJKU09L7PHIvD6d8dBCFXIEXEQTINtZKaoPUQ-QwyGG3O3NsMAGEo4UWEQVVawCsQsYXFCZUwoHkO4tqKsWWOPDjJvafOaLWN0XKC8A5JLG1UokxTKHmJYAofKPQsffcBvCM9PdGaMzmKXSQE4UXQ2OKQoZM7MWQCxREFVOiSE7DFlQA0A9gGE-guLBEpicWcod-EZYEHQynEGe4sRL9KJbApsqEqtDgf+YKYIDcTHAKcIWcl0vUyA6oFScg8oDBG09Q7PPsmcLSRCWwcUxoleccvVQAqcnUxc8gZctsl8BYJYBoR8Y0QY0oDac2A6BUD1cogw--M8qEnA14rFFcr4u-YwMQK9WlBoIGaEX0g7XQ+jWccoQoHtJwJwIAA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: {
      guiMode: 'default',
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
              coords: { x: number; y: number }[]
              axis: 'xy' | 'xz' | 'yz' | '-xy' | '-xz' | '-yz' | null
              segmentId?: string
            }
          }
        | { type: 'Equip line tool' }
        | { type: 'Equip tangential arc tool' }
        | { type: 'Equip move tool' }
        | { type: 'Set radius' }
        | { type: 'Complete line' }
        | { type: 'Set distance' }
        | { type: 'Equip new tool' }
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
                actions: 'set tool',
              },

              'Equip tangential arc tool': {
                target: 'TangentialArc Tool',
                actions: 'set tool tangential arc',
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

          'TangentialArc Tool': {
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
                    actions: ['AST add tangential arc segment'],
                  },

                  'Complete line': {
                    target: 'Done',
                    actions: ['Modify AST', 'Update code selection cursors'],
                  },

                  'Equip new tool': {
                    target: 'Segment Added',
                    internal: true,
                    actions: 'set tool tangential arc',
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

            on: {
              'Set selection': {
                target: 'Move Tool',
                internal: true,
                actions: 'Set selection',
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
            target: 'Sketch',
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
        // TODO what if we're existing extrude equiped, should these actions still be fired?
        // mabye cancel needs to have a guard for if else logic?
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
      'hide default planes': ({}) => {
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
        const pipeExpression = getNodeFromPath<PipeExpression>(
          kclManager.ast,
          sketchPathToNode,
          'PipeExpression'
        ).node
        if (pipeExpression.type !== 'PipeExpression') return {}
        const sketchCallExpression = pipeExpression.body.find(
          (e) =>
            e.type === 'CallExpression' && e.callee.name === 'startSketchOn'
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

        console.log('planeId', planeId)

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
      'set tool': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'sketch_line',
          },
        }),
      'set tool tangential arc': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'sketch_tangential_arc',
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
      'set default plane id': assign({
        sketchPlaneId: (_, { data }) => data.planeId,
      }),
    },
  }
)

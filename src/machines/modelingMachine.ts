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
import { setAngleLengthInfo } from 'components/Toolbar/setAngleLength'
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
        coords: { x: number; y: number }[]
        axis: 'xy' | 'xz' | 'yz' | '-xy' | '-xz' | '-yz' | null
        segmentId?: string
      }
    }
  | { type: 'Equip tool' }
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
  | { type: 'Constrain perpendicular distance' }
  | { type: 'Constrain horizontally align' }
  | { type: 'Constrain vertically align' }
  | { type: 'Constrain length' }
  | { type: 'Constrain equal length' }
  | { type: 'Constrain parallel' }
  | { type: 'Constrain remove constraints' }
  | { type: 'extrude intent' }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz5x2CJjAEAymDsAASwWGDknNy0DEggLGyRPLECCMrCCuL20qrCRpYagvnaegjZBtLiBqLploIGCtZVyk4u6Fh4UJ7evgAicGERQSx47NG88RxcSaApdcKSNKIKi8ppwsrLwsX60oriqgaWBgbKImpWqi0gru0eXj4EfaE+g5AwY7ETibyzx5lLu1sygM61ERV0+ho0mU4gURlOwihlis2SuN3cnXuvX6L2CJD42FgH2YrEm3B+QnM4mqdhoyPUILqBm2CAaFTS5houQUCMczmubQxXQeAVxQ1QI2JcVJ32SiGUXPEhjBtWklgaokMzIhqVUNHEG0WgjVqkEUN2aMFHWFvlF4WCbzAUq+UwpqRoGQ2pwacPW4JKJxhgYU0kWu3Wymklrc1qx-gGeIJRPo4xlrrlqUEqkqdMKOSRNEOLPWGTVhkswlU0O5fNaMbu3XjYoAZiRKM60+SMwqMgY7Go6mbalCWaIjLCjtJ0n36tUFNHbpjGwBRXDsMAAJxCAGtAuQABYdhLpmY7SPiSzAyOXwGFUQs01BtXVEEV9VSZr89Gxldrzc7vdD2kGISWPLtTwQepBGpEN8lDGhVBDLYdTUfVZzvYFQ3MS4vytBsHieBMglbdsU0+Ttpn4Sk0KzBR1EKdING1EozQqYxajyNQ6MOBchTjO1BhITBMCPMlKJSSNoIsEEllQrlhGQko9RhZEDFUL1vWEUMcLrRcbUeHF7SCISRLI0CxLdRR2ROJQwQQ2RmMQENJD1OxjR5aE+1rAV6yXB4wD4dgNwAVwwIIRjANdRNlCDlGRJU6kfapK0vdYWSnBQJEsfJMtODYrM-XS+MbAKgtCsBwr-KLgNTMDxPlawJ0DKtXNkLl0o2NjNULPMPQ2HSfL0vxd3YA9iDIShMGGwDopPKjSg0fUaDURFFoVbJ7x1S9oOSmQcl2CtRF461ptG-dxFOg8AElGwE4JhiiszpTqt1pB9C8NA8plynVFlyn1EMzVfdTrAU46PEu87IZukUiNCKAAFtItGJ6XXA+a3vVD6vV2Y41IQlkzAMakLCnD0K0jK9wc6SGLpG67G0IsUHpRkDnosjM3oUi91SsRYjmUywWRUDJRFEY0PXzdQrGpunALls6YexZ4jPhpHHrZtH6tKHkJHkLJ1AUGpsofQxxBEWpxayCXFFl2noZXABHYLsCYIJ2FQVBTM1ijLK5Njp20wtPMEUc+yVRC4vgpZlqjXDfIVg9E-3JWCGXZ3XaCBHUAANwqj2vdm9HZg9NjpPUZbIykFkKYNTD1nsGycjt+modb1OAmCFWIimIvtbVMwczF4wtXqRyEDHfVsiNwtahyTU46Kk7W+T1PkBIXcQjARHkaCPON04cghL716kKVdYjErEWFEy9LoXZKsQT7I3jWEFv5Ydh5183tXd-3VANzYAAF7cHYMfVGvtOZggyOkewqkjBqQrOlOBlQqjyCrEoacR145DRXp-XwRBuCwCCiQPAQR-6AJAWuISQQICEjARQJ0ECXpQOqJIawHl0hMizOlfI8xsrqTBHZD084cFCntu3RshDcDEI3KQ3Ae9NyHxoXQ4hE0mE+xYRBGwlh9SIlNEoRQvMFDpRfgacohhIyS0jO-M6q8pFEJIWQsgUAfAn05nCFS8g6j2AOPSIWOo9SZSVBWBSthMpiykLYpO+DiCOLkWQnw+B2CHmYRzbRRsMig2hCI0MwhLymyxrYPI5g5zZEKoNcReDJEPGkbI+RQxNxMEinQ8gwVMAkC3KohhpFNHpIxjSTIGweRV0LMtRSiBTSXkqNyMW8kBzRLboBVOdSnEKIocA0BJkdDGRwFAXA7jtFLGJkoBC5gGhqXqBM0o6kYSRg0EsRCdhLyWEWfY2p8SGn72UcJHZQlsD7MORjZY0EFTAiqIWcwYh0oiB2rINQyIRBaThG82JqyEkKLAM7GhSSoApKBSkN6NgDS+iqDkCxaUdTVhgVpYcfZrBuVRTUghnyyFME6SZagaSYrAsRDzVYZZVjqACSULU8wpxmGROsLMhQDBMuWQ4mRayggbjANnPOQRyCsrXMmPpPLCVi2zOkNQ3oRBIhMVShSlgEpG0RO+coYs3kABk8AVQACqe0wGnDObt1X509QSoQigYGPIUmqdInlRxKCVFyHqU58liwqd+CGK8XW4HdZ68QAAFCUa4ggAEEIAYAgAQQtEBxSSm5XNEuwJzYNHSFINSJqtA6kRBUSxUJMp+ltd5ZNNNU2uqCB6r2F1t7q2CGWyApai0Vo1rVfpsxEIVEOJlLyZpCz1EJqaA0Bx1JPyJdJZ1g7h2YFHTvPNk6S2EIRkwHw64gjuA0fO-VQhgQSBnsPNIDQciExvkqXK9zlpWDike9NQ7M0BHPROotU704uzdumgA7u7ANVbi5CArvsN6Y8EJHCOMLN6ISbxaV2PWpNeF+3yzTRmkdV1cAcAIIGhA6k1T-CRZqXIVc-r2EyFcsWRLESFlAzR09dGGNUBquRLR80pnWrpKaOBSgQQtpKJWYmhQuRGz5rYMcwnwMjoAHKoCCDmkYsBp3lpZkxhk1rrDqDBCleTxZ1JKgVPkukWRGJvLQBqk98Yu4Jl7mh7WTIsq1DNAcFQ7nNolA0PMU4fZZ7uXFuRhOtMfMifEBlyq4nguWXc9SLMBxp66OhMgv4hwZwKmNKcS83nc6Zey3gcTknzIvoQCLcVxpLzmHqNYZEd8rCSDyIUaEFMZZiOXvLbLJ6ssNZy+wRjqg9XVqEOkDIFzTTmGq15O+ujKhwiQqXXYFpJspvlvmxDpDggbKoWAzAtD6HqMqs2VABAIDcDAJ4XAOdUC7nEDAdgABaW7WzMBA7wK96zdF+FvkpjfTkMX9DZWtUsdUCFBOmkMG8y713yEAM2dQh73TnuQ7e5uDcADxC3pIOwV7G4EYA8CCDgnd2hIQ9wFDvLGZEIHFQYUU4dJqt1F4eUD61QwRQXFscHHV2OCKIPtgI+xOnuMJe29j76bvu-f+4DoH3ylfs7J9D+QB2UtVinBxUx44QwWBqycaE4tZd44N8rx7ai1dk4IBTqnNO6cAMZ3r13RvOeoBNzCJFfNkRfpF1Sui2ZtIRs1KpW2Z3KN2Nx-LlxPh1fvc+9rv7X29fZ7ABzrnK30PMaUBtxExxbAekONcqsdRYRNGWBseopxe0UeTuITPeJ8A569z7jc1OOn+4Z0z4HJey9h+5xBSO+ochzHVJVkQ489T5EyIiP0Eb9Hd7SyvfvD7Ip4v3LnzXX28A66L8z3FKTZ8m+JuqE0+SLCXg3wceYtIrDHFUhE53eXe-c-YfDcSnUfP3enQPO-U-B-Y3efGTWySoOKG+bKGwKsaFQJCwI1bKYEG+SFLSAaPtXvY-ZpDcZpXAVpdpTpd3HpCqL3S-AvXXZnMgigqgjpDcIHEnRhR-BAlIQ2GEVaI2IwTUNQDfNzc2PqNIYcNtQA+6JpFpJXagrpVXSgXPEfMfWnKAqfIHVgxQtpDgrg1Q0veAivbWAQhYJYXIEeMQh8EQPWKQ-JM0WQtPZOIIXAYzEiW0IiDAVsdpe6DpdNJjcpa1fJZFa8EZIwQmKcC8UMXGI2aecwA-PSEgOXTgfALeXEKYfzTI+0ILMw16YOakXRMcHkY4SMKcdKTjakPsDYdUVdS8URJeDwA8cIbcDoXInubgRjPg-Qe5fYTjDkA4M5KotSElVYc0HxGxVw1o8gdojI7uRIRjVrdmdre+IMY0CuDQdUYEEVPoqQSoXYaQxFD0BCJwfkDwjAeAWIPtZ9VbDrOkSQGQOQRQFQdQFTRAIHfhaBHkfJI2RHbBZovyMAO4yvYEI1DTKoQ4TUeEUOKlQcCOXROkN6EMLvRZUE-uQ4bMIDVaMFKEdQFkZyI2WoQGYk8seVRWboDE16RFfYJkKEbxWVJHBAZEJfBSRkkMJI1LXBKjY9T1aknnA4EwRFBNKQbAj45jM0SoXA+QJEiwJIvTWbHoT7AUiCYwKU3IcWJdTtBkZzaCSEvJZEdUZIqpXksDWbUzC9GDCAVUmTXRfU-IRQAoeQE4ZkysIMNzeokEdYCwRUiDMdXeS9W0xdcOBzCmcFIcZzD0rkL0hSc4P02jejdgYMyZV+dhU0UUordSYsQjO3WoPKQXI4BM09IzEzXNdga4tre4g4WtBLE0TYm+ced05AmMjzV+TKerXzfkqTBdINMWC8clMwN9OoaQGuIbD-TTasHKJoypKbOxGbTNJrJMlMjrFaAczjJiaXUcqlQsO5YEZE2QEIuVVw9LebWbbLRDDgf+YKYIVVIHAKcIG8kEns9rYwdYAchUcoDBaoU0crPcmcQgzKQsGc4g08rskdC8q8oIB8tpdcFct84mIQ79FQY0Zk2QdQc2A6BUPdEMewTszLUsv1eCiXTIN8BoIGaEVQO+P9BLVdA6XAuQ-HShMHWg0nUPFcgxWzXRLSZacoLSWPUVfIbMXnJ5H-TCRi4PFXD3NQsnDi6rakOkdYSsGeEQUxccixPsIRNTbk00jPNI4yQfeg9il86s-onRMQLSMwaWC1JSERGoj0FQEk-JV5E8o-fS4A9XOS2QC8KQOkF8EMbcpSR+EmC5WwUMU4IgnvWmUghQygpQjg1iz3YyqsyvLbDIFQWoqEKQHTOwsXJ+avDvfjHSucg8dwzwtsZ8lK7WI4UWM1TGcNQsKilCRYc2HYukCxeyWWVI67DoxYuaLWN0XKC8CFYkpdTUqo4JbKJYAofKVE2WWY+YqATonlAazmbA4bFAjaHkWoPY0odIBPKcGwWvHsHCJwIAA */
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
      'Can constrain perpendicular distance': ({ selectionRanges }) =>
        intersectInfo({ selectionRanges }).enabled,
      'Can constrain horizontally align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertically align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
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
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true)
      },
      'Make selection vertical': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain horizontally align': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain vertically align': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain equal length': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintEqualLength({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain parallel': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintEqualAngle({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain remove constraints': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyRemoveConstrainingValues({
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

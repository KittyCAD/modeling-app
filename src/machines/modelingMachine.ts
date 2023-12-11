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
import { ModelingCommandsArgs } from 'lib/commandSchemas/modelingCommandSchema'

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
  | { type: 'Extrude'; data: ModelingCommandsArgs['Extrude'] }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz5x2CJjAEAymDsAASwWGDknNy0DEggLGyRPLECCMrCCuL20qrCRpYagvnaegjZBtLiBqLploIGCtZVyk4u6Fh4UJ7evgAicGERQSx47NG88RxcSaApdcKSNKIKi8ppwsrLwsX60oriqgaWBgbKImpWqi0gru0eXj4EfaE+g5AwY7ETibyzx5lLu1sygM61ERV0+ho0mU4gURlOwihlis2SuN3cnXuvX6L2CJD42FgH2YrEm3B+QnM4mqdhoyPUILqBm2CAaFTS5houQUCMczmubQxXQeAVxQ1QI2JcVJ32SiGUXPEhjBtWklgaokMzIhqVUNHEG0WgjVqkEUN2aMFHWFvlF4WCbzAUq+UwpqRoGQ2pwacPW4JKJxhgYU0kWu3Wymklrc1qx-gGeIJRPo4xlrrlqUEqkqdMKOSRNEOLPWGTVhkswlU0O5fNaMbu3XjYoAZiRKM60+SMwqMgY7Go6mbalCWaIjLCjtJ0n36tUFNHbpjGwBRXDsMAAJxCAGtAuQABYdhLpmY7SPiSzAyOXwGFUQs01BtXVEEV9VSZr89Gxldrzc7vdD2kGISWPLtTwQepBGpEN8lDGhVBDLYdTUfVZzvYFQ3MS4vytBsHieBMglbdsU0+Ttpn4Sk0KzBR1EKdING1EozQqYxajyNQ6MOBchTjO1BhITBMCPMlKJSSNoIsEEllQrlhGQko9RhZEDFUL1vWEUMcLrRcbUeHF7SCISRLI0CxLdRR2ROJQwQQ2RmMQENJD1OxjR5aE+1rAV6yXB5lz4dgNwAVwwUTZQgnl5jHBoaCvSxaUEFlqwqQtETNOpIyrXjrT8Xd2APYgyEoTA8sA8KTyo0oNH1OL8xqhVsnvHVL2g6opC0nJdgrUQco8MqCv3cQBoPABJRsBOCYY1wq8CqukBpLAvGxzCkUMjEU+VlmpRqlHVMxQ0-XShRGobTvGkUiNCKAAFswBmszpTA8T9EW5bRFW41CzOFkVAMSplFUhoFL1I4+s6U7hvysbG0IsVptGR6XTmlIFtyC9IxsMwFQsB8FupOxpK+wslnnXDfKhwDKcGi7sWeIzrruh6QKeiyMwWjZ9lEY0jnMSxrE21l-sQk5rDpWQuREcHqYPGX91pghlwAR2C7AmCCdhUFQUyWeRl6EDNLTxBEOFtMLTykp1Md9WyHkxcWZZI2lyHzpXFW1aCG7UAANzADWtZ11Nnssj02Ok9Q4sjKQWQrGFVnKdZ7BsnJnehs604VgJgnpiIplm-W1TMHMPuMLV6kchBraVRDEUOLMxFkVOqddh5kBIXcQjAW77uCX2N04cghPzt0FqnJV1g2x8FGn5qSlkc81EMXIPTW4Qm8GuWFbbjvGZ7oJ91QDdsAAL24dgh6RiiR7BDJ0nsVSjDUitkvvyoqnkKslGnXryb0l2M8bEQbgsAgokDwPvQ+J8z5CSCBAQk58KBOkvsHdmH15h9gOMadqrE8ZiAvLOdSV4v5k2OrlNOm9AHANAeAvuA8YFwJAcVJBusr6oISpIXYNgRDlGBBXPUIgDTGB7EsKw08SE+T-uQluvggG4BARuMBuAggAEEABCfgggAA1h7s2WP9fmSw6gKC0u-BQD5NT-QULYfsWRDhVHXrLaRxAqEKPAWojRABNHREEFqFlhAhDSdR7B0QfMYmiViXzQmBD-Uh-UpEAIeLI+RijjL4B8N4+acIVKrCnHFd8fZZ6IGkktGwvibBqUrN5b8cTm4JJkS4lJPh8DsEPMgtmPjjEZGRMIVUXIDj5EtkpRQaFuLXkRLkBx6dAIKySdQpRTBNwLNwHA8gwVMAkC3AwhBpEWEoJ8TSTIPT4RZgsAOB8Yh-pGGNFWbmUJNSTIoYkhp4CD5H1PmuEyOhjI4CgLgDJqMliWLNOoRCRwDjGOSoQg0WMRHLDpIDB5TjZmuKUbQ7Ag9hJfKEtgX5-zXr2ANHFY4tgqg5EKaUEQbV54XBEFpOEiK6nOLkXMkIuASDq01lovFpRbL7FpUcSs9szE6hWvqFQfNNTpAVIoBl0zKHMpRay9l-sgheLaRFTJxhMgbFDJWKxArLDJSseg2w3DgT8zBr-E68S5VPIVSksAKsYFNKgC07lo8JAbBBKS3Ish1jJTSLfLSw4+z2yqXhCGNqabyuSeApgGyTLUHVZVVGYSLyXmvFE9QhqRXHHmFOMw3TTimktbEyNtTbX1PteAjcYAva+yCOQZ5a5ky7PafND62YpXqUUCIJEwq54KRKYoBSdJjHlA+rK6NDwABKYAAC0YA+DhGCuud1ESlT2E1B9cdNhVAsnKPqTCPoqwcTBA8gAMngP2AAVAOit3bq3rX7TW2tuXyGnpIERCk1TpE8qOJQm7a7GiHR9I6EjrVUyvbgW99652LuXastdyaUZCDimhMZVjjEkuLEtOkHoQTAzsU7K1ZCoPXqCHe7W4gAAKEo1wqIgBgCABBlFMfFJKFD+szTAmNsDYxdR1KEOLFCJUJwoTGsBsYqQl6KNUcwMNLuTNghseY6x9jCN32IQqIcKxXkzSFnqCyAcBoDjqW9aPaSsmYOUYDop7uDHVOQGcTdJgPh1xBHcMwoO7bZjRNhIiEugbunGc-QtDQkYgRWARaRmpG9oOweowEBzKmmPOeVqrdWMGADu-s31ccshHfYC1y4ISOEcX6+M1Q3i0rsYG4Hqnlvi3Juzo1cAcAINy9Sap-i0slScKcB6CWFmw5qJCdgDDWcSwptrHWqDAR8xqlIJa8PIgyuqOYWgdSVn+oULkxirCLEWJN2LTXZYJds9RgAcqgIIdGRiwHUxADjzNFspqKWOJa1h1BgkFXSfd231JKgVD0-DIGrEPLQA2+T8Zs4JjzgVjMTIJD83kAheEoPyUaHmKcPshZVRWJUJDn202CDwaXSu5DbaltCB5NBLhe24TLDqKOfGGwRZ2ErBYA4xPod2ah37PAc3EcQREOw7m0lbYJWhC-P4djCzSuhIUBrEa5biAF5dhTGuhfsE6wt8ieyqoqGMUqHmZhwXWGRMlbIS1ciFEKNCWOVhefTfVyToIOvOuqGp+9g26QMgNDUsYdSSd7DW-YeXcbIZOHhoppDZR2WwHBFeVAj5mBYHwKYR73AzZUAEAgNwMAnhcDe1QLucQMB2DzpT+88+mB514Fz117imQSbGmOPYaceNnJjj7AdDQ+RS0QbIxvBPSeIFvOgenrZWfG9583BuQ+4g3MkHYLnjcN0K+BGr5A2vQkG859QM3g4lQNDcyzN6zUW2lJK4vFIOiCIeR04eWPjgQQ0UYoz4wxB2fc-58L8XqXuXpXvOh-vvnPs3vIJUOqLsBYMahoA+HFNFNPGYOUIoMDC-onm-mAdPpnj-nPgQAvkvivmvofJviATgQfk3iLlVIhCoMbB3iGHSGpFWILK5DCA7NxMruaGvKdmrq-ipuolor-nngXjBoAWXkXiASQAAEawDzp8BUFH40HLZKAZAnJZiRaFDlDmJA6SzibehSx8Hx5YGCEaKaIiGEEbiL4bjL7rKkEb5b5V6yHyGKEQEqFFJqHpqoQ-r-Y5pKRVAZDqDhaaiHTmCYHj7uKqqWFiFF54BAFSHb4uHzo6BKGQEo6GCLCyT5AKQDqeFWDQo3KBoRIxLD5xaywCEqJCEeKWFEG2EkHr7kFJFyEpFpEeEIB0G3z6o9IlbmDyAPjdIXh0TTwVK2AVgRFv5kBQA+AxEAHxGSFOHzpTE+BtE+6oYdFeGmwci+Ifx5EdHuSwinCrSGBTjWATF4hpKC6H5WE2F2Gr6NGLHLELruFrH6yIQKj7CBiIhxRNQqAPjZqZAHBghqC5ApzGHkKVEuotKzHiHzHAHb5Qn7irFvbrF0H6LIgWLwpSoPjxwXhjjrC7BNBnDnGeb3Sur7i1HWHEH2EPEgGInIkG6+aeFaod71B2BiIdQ4lxRfoNzG6O6WAkkLIbhLIrJrIbJf7bJXF-6xESHwlV5Ckinopikbjzoz6IIMnmQ04dGyQcJZIginAK7nJWL7A8iHCFh9IbClGNb8GmFDCLL3SinrKbJ4GUCUm3ENFkGLEKkOlKlOmqkunPGH5dY6l0onD6lmgnDnKFAmnmrmmViWmTJBC4C3YkS2hEQYCthrJTTrIwburqS24Vgcxqg8jAiDLyhjxiyEnGK2x9Hgyw6dy4gI6vEjxpAVCxRZj3xWJcj+FCCO4GiXh0gJRZgcw-z8jJkYDwCxCNYoncZ0iSAyByC9pqAIE6jzqGDZiKCrDVCqgNyGDSxYgzlujAhdp7ZVCHAWIqBlkUrjg252DWDTxK6x6SKASHnsyHDZh1SBYKiNTqAsjzrVCZAJxqQKjcwY5Toww+Cvk+JrZ8od67DyDaHkrIj6g5BSAIUhh9Eq5x7kIXbyZQW0FAmSBrY9LVAnLqQPhmiwj4k5BcQ251BTaa7iA9CF74WzC3KSDvzaYSYMjFimjGwJSHo9KiJPmQbNY2bya0b0apbMasVFJDn8XcxWKnDyAnDkrxkAzdkjEKTnAMUSXJbKaMYyWMlakX76i-axy8JDi8VBgg7qi+jrAWC6WtbtbsCyX7FjxCVi6kXc7X6IB0r7AlqXmrBDgnZlpq64V2Y3Z3ZSWTmam+4HC8a44mjXIjHWUaWg5DlTgQ7glUwa54XGW+7yAfQXg5CqXRJ1DSAxyUVWAqCVgdTVm8FhWQx5X87u465uUqA5AlW5DYzvw6EioK4GjAjiyyDZCAyhVlFnZDQtXUYa7ZYcAHyrpBC1oIaU5gAdXVAqQh7lCfzVCmiy5xzDUgg1kjYu6MVzULVBAU5IbrUFXrHGDoyBbTxranA2DW7qDGzdQ4zAhMEiUj6ywzUKZRXPobV4J0g9INARnQgA5zwLSehGJjjdT8xYXPmj62k15T4Smz6H5uUlq1RQgGZXJTiDY6isEwg5AHbRKAyXgkk4FY34E413VvHSrUj8JnC5Ckrkp6iyAXhCJcjm7qAkZNUQm2lREWFz642Rg2W1W2zqQhKk11zGzWLwQ3IhgTXWkmGRHVEiGS3QiZAzxSDmCBpvWk10QSB1YAh94-pWmq6a2TGXE61M1ujdbm1DmMgLRix8JFbcy2BghoHiokmImO1xWomYz4LoElz5AbAUXqgEyVgOTVl+2Cn2nLK+nilqmukS1O0ZimhLDGw1j2A5AqDAjnKnCVBo5KAnHBqJnJnERti3Uh36xHAZDcyIge2-qFgw3yiLD8U8jMESzZROAOBAA */
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

          Extrude: {
            target: 'idle',
            cond: 'has valid extrude selection',
            actions: ['AST extrude'],
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
      'has valid extrude selection': ({ selectionRanges }) => {
        // A user can begin extruding if they either have 1+ faces selected or nothing selected
        // TODO: I believe this guard only allows for extruding a single face at a time
        if (selectionRanges.codeBasedSelections.length < 1) return false
        const isSketchPipe = isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          selectionRanges
        )

        if (!isSketchPipe) return true

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
        console.log('AST extrude', { selection, distance })
        const pathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          selection[0].range
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

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
import { sketchCanvasHelper } from 'components/sketchCanvashelper'
import paper from 'paper'

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
  | { type: 'Equip tangential arc to 2' }

export type MoveDesc = { line: number; snippet: string }

interface NodePathToPaperGroupMap {
  [key: string]: {
    pathToNode: PathToNode
    group: paper.Group
  }
}

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz4CAZTDsABLCwwck5uWgYkEBY2EJ4IgQRpZWFpcQVLe1V7SwVbYUttPQRBRMtxZUtlGkt0wVVpBTMnF3QsPChxbAhMMC8ff0Dgrlww3iiOId54pIVxe2lVYSNLDUFlgv1VAxSDUWE0wQM0ww0mkFdW-A6unoAROAG-Fjx2EYixmMmhA2FJGlEFP7KJLCZQA4TrBLSRTiTaWAwGZQiNRWVSnc7udqdboEO4BbrBXyQGCvZiscbcT5FeGzf5Q2zKb5mNa6fQ0RKpIyI4RsyxWeZoloYq7Y3EPXwkPjYWAkyJkj5xITmcS7OxVCyib4HAwQo5lMSZRYNESOZxnQVtYU9bz4x6oZ4y94TBUISo-Y7VYrZZaGbUsl2ZMoA0Se1SCNlQgVuC1Yq1iolgB1yp2gKY0GagxFpBSM5mFBHKcT5hTSP5QkHKaSRi6Y669G3iyXS+ijJMU52I1SFqqrBY8mgGfJ+kEzaTWAfCOpJQ4m5pRy4xutBPwAMxIlET0WT-EQlRmBjsagOYcsYekEI1glScOke33h12CirQoXAFFcOwwAAnfwAax85AACw3clYhTfREgMcRvRLeRs3seQIRsUorAZP4dhvSxhCfaNazfD9v1gP92EAqhpHCUlNzbMCEGnZVi29OxVGLcE-TUGhCxyVYNC2P4LGw+da1FetV3XZs3lbUDtyKWxC1qBR1FWPZuIhU9xGME8ljUeSB34mtsWtJdxUwTBgPlaiK0vCxvn+NiaGEeyIUyAteQMVQM0zZIaFRU10RwkV7nrEhjNMrd4kUFIGVBdSvNkX1CmLSRMjsYoGgg+xdMtAgXz4dhPwAVwwEKqKk1K1JydJMlsYwpEQoEfnVNMbEMeYtgyzwiMA4gyEoTB2v-ICxIokDKRsSpZjUbkNBoSp5lECEKkvXYpGSBYoUw0Q2o6gDxD64iAIASVrAyCSed8isk+J6mqKCbHMKQSyMFjClBdipvqVYGlEEtlE2-qdq2w79LFAIoAAWzAM7BtlSiLv0NJSmsUQ7uKfskRUhlC3KTY0nszI4V+vb-v6wHbgCwzTpeKHHWKy6FEWKCK1GqaLEc+plUYzYUf7f5Hx881Ll2wCib2kmcTJgkQfByHyOh4bnXqUEYWDUcdisawnsQbMYWzcoS2sEtloJoXBYO3CAEc8uwJhfHcMBfHYVBUBMqmJMpKwQVSRI1AqCxuwhCtO2yaa6jqeSXJnM053aE3hcA0WXwtq3fFB1AADc7Ydp3zspMMEtqTZ1Gmisar9TCCyBLYQXsBF5Kwvmo9j7aTdF7w-DxJchmz+WKgkfckeMH1DjixANXY+Y6f7E8Fi+yt6+rRvG9F5ASD-fowYhvx08-ThyCCrvqPqG9xBvBkRFDUEFByRDEgiupvn3Onijr2d55j5va2X1fJY33wANQT9sAAC9uDsD3i7GGI1RDZEkACHs8IDju0QlkQsOx5ChxENmDac8hRvwBrWIg3BYC5RIHgX+-8gEgKCr4CAUpQEUATOAuWB8kY-H3JzGw9lTyszEFBe8blIpKD2EbJueDsQENwEQz8JDcC+C3jvKhNCiHdQYTLamsMEhQPYskYowZFgQWHggTIIgyjGF3P8Kwl9eYvxwVtRe+DCHENIQAQQAEKeF8AADX3lJeo-YoLLCUIcZIqCFCOS+pBHIqpKjFAHDsYRdixEOKkc4txvgACa3jaZ+IBG5BoiJ9yKFUI5Ceskci7C2BXLB1iLS4OJvYiRjiZFkCgN0TJcMEQM2LtNbIiw-iOVhMfL6AIbCuQnBHXyAtbHv0SQ05JMjuj4HYANVRrt5Z0xmLyPIKMJwDmDI5RQ7FDibArJhOyBh4nTJ6OIyR0jfBMC-Pc3ANDyB5UwCQb8ii6GiRWRA+WKpZh5E5PnNyoZHJiEgkYYodRgxsi+hc0RVykm3L-gA4B74gqYB0EZbAUBhiMLMj4-4ESwzqCYnCbGGsEj8LKEzeSAIqjlHhXUmZNzSFyOwLvYyWKgo4rxT8phPjYFlGmvCWwqsxCIWNMqWQ3tQz2XqOc7BNSpkIuIEi0hsBcAkGtg7TxbSEhKAkHKwFE5rB2FCX6W67EVDmG9HsaJVjI6vxVcyxFszbmau1fbVA6T9XvQkNNYsdkmJQO+IOQo9RdiFiqosBk1R8ZKsmX9S5ar3WkLABbKhCyoBLL9cWCQoJ753S2CfWqexJDJBPP2KoJZ0qJuji6kW9TWUyKYO8jF1B8WhThtyfxQJRxe3UOG-Q8I3QgigQsDsqxFXVKTYTFN1zGm+E-GAFO6dfDkHVe+Js-KCWXSRp2e1blFAiB5BaiN9lShQjptyHpWwkZMqbdiAASmAAAtGAPgQQ8ofjzUjY+9gvpIzpveopfoeJlC2FmOoGkoGPrjubS2Ormkb2wFQ955BvVZy7TTRAvYEYnjFTeBYCFWLzCggCNQ8x6goiqU6mxybVUJyQ74AAMngDOjtMC+FUPqqy7FTnBLLHZM8foZ6FnqGIcwZgDzjP5g2xjrqsqJ2Q-gVD6HPyYd1bxnD6iLAThgTeQ4xZaiIi0H6S+Rq8ggiYvCXkP160L3Y7gO2AAVLjymWNrs49h3d3aiiKBmGIWula9gQXPEoAD3IjA3jyEjBzs6FOE2c25jzr6P1fpeb+3Tbt1nCvkj6Qwus5qWu+KkUw5h-jxu8olpzHHfDuaduIAACnad8vgnEQAwBAAgnWIB3La5TPzuGijLGQtNPIUIvIif9vIExiQvqwfCfElLDWuM7TAOvdrfXIC9a6wN+0OX2y3WVKGAuhhsbmcKCoUoaYZOLC2NkBWK36uNcwBtrbfgds9YIaDJg3QPw2w4-qoEdgUFSZPD05I-sAxJFBBUS+D80x0YmUloWq23sfall9rru3mNJzoTAd8aHuMYaw87Yb6iKyuWPioSobJvZXZHaUeQWxFAIlhasF7Lm1tNe8J9jruOev4+trbcnIPRydkfl5KBmjBCOS2DSWzDPzE1fo8qv6GP1v7VwBwAg+r5DJFSJfRYx59xqAhMtNSBx7DVzknExzMctdNZ13r0ilOc7yBSOkGF1QzvFn9uW74sDPpuUI9z1LTWAByPrWvPFgHt-rFMDe2E7JV-4IJ7yjkD5BXcRc7sVFBPEtA663u9Dbg8TuR3qJagkB6ElnI8h9LE0kEx+5J4pWDAl9Xc6hYl8j5gAg6XP3fuyx750ihESDPkOkbMsCDFDMDMr4NFhNjF7TgPzzScxeZwpy2X55ktiQWmqZxEd23Lnlb1yZYLCdgnmfj3tH21++88HyL+2KHicaa01xiX+5jcHAMgYRKBM4IAaA-DX5IzlJQIiDr6l7rYv54Bu7V5SQYIjhQZJBd7vRIJT5wgVDpDWahhphwED7iCIG67sD65kT74CphRRTKirAngGxIw7CUoyqXiIjZCuQBxyAkGv5kEb6+BIGUFUCqDj415iA-DyB2TcgiBsJXyWpWRqTqAm7zAHATiOqo4LxOIADuJCfgKKFC6K3GnyyiQhuAy4qABAEA3AYAHQuAqcqAf44gMA7Ab6hhaKoCmAb6eAlhfG2ksw3MMSBSt4rMCUGo5uQG5Qoa8Suh+hZCqKlCJhtCZhvhVhX4n4-84g-2JA7Alhn4oMLhPg7h5CnhQUPhFhqA-hmw0aZgaCRaiQrMuBUg8kXIDQRosRehHAsiX48iyRSi9C5hlh1hth9hjhzhrhb67KnKFRfhKB8QTEc2A4JmFgOQpgjkE2dEn0bOl8mEnR8R0xCiKRgxaRBAGRWROReR-8hRkxhx3haR-hKgak8IjUVQrkdQlKSUBYfwl8nMFQ4YD+WhMccR3Rri7iHiQxVhNhLmYxThdhkxJAAARrAG+nwLMVUfMXhkoDMPnKZjYNOqJoUKSt8VIBzpmLAY7rYiCV9qkhCacecZ+NkW8lcQUUUW4UiSiWiQ8ZiYYtiX2gaJ5LyMOoYjsDMOoJGjPNNOYPsaCakmkpCSMTCXgOMfCcURyW+joOiY8XXoYH8DZMsPZOeliVYDStCtMGUijvJtoV0TSe4vKfSZ+JkYyZcfkTcWqciRqVqTyYsUFuVJNpgqGPLn6CiD8NkExNmNPFUICVacCTaeKPgN0AqdCXYcqXCWyW+s0t0F6eIVJD6RyIkGIL4mgkaYYilKkIiHdM1JNjKX4JmXbA6U6Uybka6emXWdmTQXuliWNMckkAeLNCoP0lArMJsFAhNKMjWTbBDDmgBEmaMamRMcUdmksu2eJAfrmYEv4uKfuBUPao5BXFBBqCCFCDsFyN3kCVSXGUuTOQ2RccyS2ZMVeSuUNJ2bycYCgv2PSpYstHudNJILsF9CoMWOUJYBOfcp+I8s8q8u8tQscZQLOUqQ4WmZMWBRBRylBZ+G+qYfQk+bLC+SoQWMkDrIyGGAiGCjkNrHGtWhOKCJaQ3LGfEShRDJBW8h8rBfWZUWcY6bec2dcemYxU8mhSxZhWxThWom7DZJIAqgyCCCRaASRshA0AOFRbkrRc6prvVrvjxuXv0DaFXjmQsdmJeNVLErSGmMKUfmpGKnZOUFOCBZSX9ITupqTppt6lpa3DpR3KEN6cWCkC0TkFZOOhKpavYKGdYHCGGGZQgsIr4LgD6iJLGPWBgKuK8o8G8i5n6mHpIJhArKOHkkYP7EfGaseXTOPOYHJnRbYo5V-s5T-lpe-qtppTpvpXhovnVLNIYIRaAWCH+QiKaiGgqhHuTnVSph-mptVeKC5dpnxtEcqLapnt7EpDqHZD1UkCiDkJJk4KaLFRgPABEKjh2f5seJIDIHICemoBoBCG+j6MfEYK0WOCoDZhlDGAdSNgyIeqsNzLsoYCoEGRGkeMfFYHYNYJfIkPIMIi9eooYLyONL2FNDNOoJdf8CgiegiAsG5H8HZbVrUk+mABDSNLyJZFqGyPIDPjsPNAGAsFICTfmufINW9njRPklMKsGPfLyA0JhDqCkIEjeAzukAOExHTetjcLYQzYfkYGVIGZUBWMCIHqwnsKjPFhqHzYLU1nHttkLqLagRuSHKsPILasDTnlBGmMGlKXJOVWpclq9utvztjoLt1prVMKOJeDxHCNNHZBpIbbPibXUYsSre9q7uwA7UILkszeofzezZSr2WUNYIoLsJsFGd8H7eIDHr4GrewLtc+YdWIMhMkLlWjdop7cbaDuzUCJoTGbYi-vTaubQUIMYHXgsAiNxCzYSZrDsMfAOlAkhMUKOHwZjuQRwEHUUBNFBA3WYAyM3Ugh0hXDWrIPMOUDOo-gvJXQgYIToRwH-D+suu+iPllrjdXS+dVARrYEKWoDsCVhGnYNsAOgOLUNFv8L3SveumvUsoSJlj+nvZnSNqYgWuOBdqGI0ZarIL3FmBeKMvIGeeXX9MvdHj6t5oPepJBDPBOMcOOqRYoWzBeN0geqOqpQxoTNSQkUYV4TBQMXBWkYPaGOkIEVNqjE-DeNwgWAsHTG5CedUBAxVX9AQ3cSQ18uxZYRQ9EqdvBCCA9pVhsbIFBKYtZeYOoBWBOWCZ4pCQI+yAiA9ePLkmBkSTfZZZfYxDYMWAveeZw3GQo-aZUco98ZZlINJmFufcaRINerSObvKrgxrvg3GXWUo-vf5m5DYMfDUJqFdA9IOa9MYBjWzjahOVeV45-XpozLwoFv3MsKCPstArkHUIYCVTEfZe4wxQ8kxYJdBVhWQ+Y94yNqGEjXIUoBkFIBXGClPpCmmDEjeD3Tk+jhpVxjxhQ2Fu3dWiwUPA5EOIYMqBONjNmLdBUPElVZwN-q5aoN0xoMfEkPMGyPJKsC3QgMsBEg9McnJABdFbFb4PFYPXCDMLoqs2FdFpozuH8GpNkJUNeCWHUJtQ4EAA */
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
      NodePathToPaperGroupMap: {} as NodePathToPaperGroupMap,
      // draftLine: {} as paper.Group,
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
                'setup paper sketch',
                'initialise draft line',
                'initialise draft arc',
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
        },

        initial: 'SketchIdle',

        on: {
          CancelSketch: '.SketchIdle',
        },

        exit: ['sketch exit execute', 'tear down paper sketch'],
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
        sketchCanvasHelper.setupPaperSketch(sketchPathToNode || [])
      },
      'initialise draft line': ({ sketchPathToNode }) =>
        sketchCanvasHelper.addDraftLine(sketchPathToNode || []),
      'initialise draft arc': ({ sketchPathToNode }) =>
        sketchCanvasHelper.addDraftArc(sketchPathToNode || []),
      'tear down paper sketch': () => {
        paper.project.clear()
      },
      'set up draft line': () => {
        const path = (sketchCanvasHelper.draftLine.children as any)
          .body as paper.Path
        const dot = (sketchCanvasHelper.draftLine.children as any)
          .dot as paper.Path
        const white = new paper.Color('white')
        path.strokeColor = white
        dot.fillColor = white
      },
      'set up draft arc': () => {
        const path = (sketchCanvasHelper.draftArc.children as any)
          .body as paper.Path
        const dot = (sketchCanvasHelper.draftArc.children as any)
          .dot as paper.Path
        const center = (sketchCanvasHelper.draftArc.children as any)
          .center as paper.Path
        const white = new paper.Color('white')
        path.strokeColor = white
        dot.fillColor = white
        center.fillColor = white
      },
      'hide draft line': () => {
        const path = (sketchCanvasHelper.draftLine.children as any)
          .body as paper.Path
        const dot = (sketchCanvasHelper.draftLine.children as any)
          .dot as paper.Path
        const transparent = new paper.Color('#FFFFFF00')
        path.strokeColor = transparent
        dot.fillColor = transparent
        const point = path.segments[0].point.clone()
        path.segments[1].point = point
        dot.position = point
      },
      'clear paper project': () => paper.project.clear(),
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

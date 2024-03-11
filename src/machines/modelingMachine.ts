import { PathToNode, VariableDeclarator } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { Axis, Selection, Selections } from 'lib/selections'
import { assign, createMachine } from 'xstate'
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
  sceneEntitiesManager,
  quaternionFromSketchGroup,
  sketchGroupFromPathToNode,
  getQuaternionFromZAxis,
} from 'clientSideScene/sceneEntities'
import { sceneInfra } from 'clientSideScene/sceneInfra'
import { Vector3 } from 'three'

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
  | {
      type: 'Enter sketch'
      data?: {
        forceNewSketch?: boolean
      }
    }
  | { type: 'Sketch On Face' }
  | {
      type: 'Select default plane'
      data: {
        zAxis: [number, number, number]
        yAxis: [number, number, number]
      } & (
        | {
            type: 'defaultPlane'
            plane: DefaultPlaneStr
          }
        | {
            type: 'extrudeFace'
            position: [number, number, number]
            extrudeSegmentPathToNode: PathToNode
          }
      )
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
  | { type: 'Export'; data: ModelingCommandSchema['Export'] }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Equip Line tool' }
  | { type: 'Equip tangential arc to' }
  | {
      type:
        | 'done.invoke.animate-to-face'
        | 'done.invoke.animate-to-face2'
        | 'done.invoke.animate-to-sketch'
      data: {
        sketchPathToNode: PathToNode
        sketchNormalBackUp: [number, number, number] | null
        sketchPosition: [number, number, number]
      }
    }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AdgCsAZgB04gEyjhADnEA2GgoUAWJQBoQAT0QBGGuICckmoZkbTM42YWKAvk91oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBFtpGhlxDRphGg1ZURlhXQMEcRLDSVF5UwV84XEK8Rc3dCw8KElsCEwwHz9A4NCuXAjeGI5B3kTBLWFJDWV5hVSZZTrlBUKjS1FZiUrDeWVDasaQdxb8ds7ugFFcdjAAJ0CAaz9yAAthqNG4iaFlmZWZSmZRaKyGQzKYQaDYIGSmDSzdKyDSGcQ0KrAk5nTxtDpdAi3e5PWCvdgfKiGSLMVhjbh-BCCaw0WaQrZqdGLAr6RAZGSSWzCZSiIEKNFi5TY5q4y4E658dgPACuGC+NNi4wSQgqM3hNFEwNEGlEYthENELJkCjWplMFpsGlRUo8rVlNz4LAe7DV0Vpvy1jKtCkkVuZMjsDpNsOEwjKUIkcxNqWhomd5zxVx8ZI+-gA8rh-AAxEiUH0-TWgSZ2CyGY3hmg0ZTWarcorqfnojTwsXqJvHVynaWu7zZ97EMiUTAjt6fegjP0V-hGI7KSTGaFaNQmUyyM1HMoQ9QQ9FHE1pmXT8nvSSXj4ASUzvgCQS6A3Cc++C-pAcM0LKOrWE0RWWZQzUycxshkfUdyNOQFFTAccWHUcb1HB8CWQEhXj6KAAFswDufwADdHk4cgSEwMsv3iSsjHhA9qk0IVNGTM1USkdEGzkCR8iUDRz2QmdUJndDukw7CgjwgiAneVAHmwAAvbh2AoqiNW-WiECsaFJFUa19QhfIoRkM1xAhcpjSySEzP1PIBIuW9r0c0TiG4WBFRIPB-Fk+SlLuCj-AgbB3InMA1LpGily0uREUg9EqnSUwjnWHk4TMVdbItbJRCStF7LaRzhKvFyiDcjyvJIr1sHIzBAuClSKDCj91QihlRQFPJ4MhVE1C7WFw1qcprCODQY2EZYjXyoqPmm94SrKh5PILABBAAhbx-AADXC-1NKseCkTEWsdysWxxH6u1ETtKFFlSHLagaRChwclDnMzUrcHcxavLWjaAE0dsXRJ9u2aw7CbEUDQNEzUs5YNxoqEU9I3KbCregkPq+pb-DIKAukBjSorRHJpCURj5DFYRTH6i1dSAsaDSp0xhFR160Pehbsa6fB2FnalfXUyLgZKGYVANDE0TSfZ+sOeHgVRKnHSUKFWaE9Hukx8qCyYR4ddwILyCVTASCeIKQsagmhboq1ZltMzmRXRt+rFRFYyqZnxsdUaEKaF0XrV9mMc5ryfMU5SKMwPQcZwKAhmagXWp-ZZ+XgzR4PSI1G3O1L9khEM7SY8axBWR7ffTWbZvmz6teI0jqojqOKOwWPLba-JzByK0qaRswRTNCHygUZnMWqKpalVq9K456vvoLWBcBIJh-HYVAttbn8zKkZZxEWIfFDSanUqgrsQzkeZ5n1Rxwwnmb1dcmfsfnxfl9XgH4-LQnhbRCwhTMmNxFjNkfqtYZhGivjlX8cwcg3ycoHDWwcCxgAAI5KgCtzKAvN157XhFIEUo0qZZDyBIVsRhagshyCYBs+phRYien7AqbMRLTyxl5JgJsI7UHftRNqsgZhLBWPsHcCsYQ5x3Hw0ohxbSZDUD7Qc9CK5301rPfwDwwC4VQCRfw5AEHsFgFgomzZdJWGNH2VEJps5FCOGZGswJj4lDUE2GBU8CQACUwCCDAHwEISp7j6OFhINcKhLDcXkAaWEIJVz3VqCaU6xh+J0PLmjOBhIUHYCXgAGTwGAF+qBKJcMFm1IekSSigltAmdQsIlDbFpmDGKwoIROLvtcVJS8GowDuNgAKJtyAvz8YgcGwYd4GjMsKRQdQLHLksJIZiqgKbpCgU45aAB3TyMk5Jh38rVM2DVKD+DwAAM1QAQCA3AwDtFwERVArxJAwHYIIUOfkVKYEEAc1AfS0rZFmFAjEtRbT-36qicw8FQwjNsIzRZKyODeXWY8gK2zQp7NwIcggjwHhyUkEwY27BDkPFwjcvw9yYXh2ea895aR9RrlrKiYmnVmb9R3vybIjYGx1CMoYCFqza5VRqnVc2uzXnHNOecy51zbmCEqmRCiLykVvPyYnTSUt+RokUPYKEhhBT9StFIRwRC7ClHGhyqFEr65bPqgigVqL0WYpINiuSeKxXGpqtKw5ZL7aSEWKEpKYhNCapPpCcWaR2zqFLnIxJKFlmct+ltRFyKTm4DOXgEVZyxUkAAEawEEHwZ1sr+YfytmlPOQooJLF2ClIo8ImxrgyKiUEsgmzjwSRecNkKAhRs2jGo5lqHgYqxTi+1BK00ZqzaSuVu0opSxmDkHeVTTD6i0BdPOdRrQSDidCUwhrW3rX8H9Dtgr43Cqucmgd6bBB6Gza6xdOoKi2DEcaWE6IoS2yHhacxc6N3+CjTui1Dw0Xdutba3F+K7mDtPee0dQN+l-wsEZABIF0iQnvd1CwwJ5jhhFLB99uMui7rjQmi5h6gOCCw+4kdubuEBgnSkY8RCymGBpgaAU6ILTmhNFCFmjbBKTwjVC4ju6u09ptX2wjxGwNkYKRRsy8Nsj7SsGoL1NNfyUrqFkOQ+oATvvQbzHDQrE0EbFZp94on5ziYVWZbYnczDCKgvkGWB0s5-xUL+KwGmCIYPeHxn9Vre12sIwZozn4TPjpGWuFlMS1ijRhuW0E-JUNaARGIGMBp306weHrA2RsTa8p2dkgVuGD2ioJSltL1UMsPEEPCxq-mWpjsSOGStBcURNmWNUUQzs5DSFjHMYUZS5AhqQv7LjLb-BFYIul42pszWNQ87+gTAH+13JG-rEr43yuTcoFVhONX+nJw6koawTW1hyH6mNDrtZ5g5TtL1pxmT405MwD0Z8-Q4hkqgh3WTRxMinjSBdQEBcMTNj0jIa7WS7spKVGk5euNpKdNqt03p4HP79JjIifYZgGzqHdqBVKHskQAMcFkEEwPbsr1yZIO8uAOAEBeyod1QyPsIjkIfIoawyiBp3LOgBVM0hE+ySTzAZOKfsCp1SYz8rx35H5BaK03VZPAmjFTWYKwJBguBA2WR-WGFCRu7z1ApPcB2oog9vor5nsI-zdYQasgjzWmZAaLHzPRrTNRN7F27F2UcYGzNbXd3JAADlV4AAVUB4F0QQZaEAICBBUl6Ybwe7hkvmFdahOUuyLFBLCeYHczAEMyMGhQPOff+-8EHkPsBxyNTyWJsXwNNAQVkAyjEWgTRlsQFZW2kjShWhWE48nlP3nGDzk3rIQS8iN7NGkKQcwi2qFUMsJ0HvNeT170LykVettaQMu62ds65iyAbLWcfSVpnpzmECGwKgnEABUocdK6Q8HpK8jcvhCKbtfEG4RNnMMCJQdp4rhiZ3RKiO6t1MWrWBUPngvhXNfvgNDnfg-kcs0uDhkiDnzgno6EiLnjlBaE2OEnMNMuNGkPIA2KCCrJAYVEqPrKvCFF6I5PmHunhkmpIMtN4JfoIBQScoINQewLQXHG-ojlpCUMGHkL8hCI6HUGoLCEmAKJIr1LUEoAAjAv4Prv4PsiWN0L4CboFGAKoUbAENavGu8kyOZEcAiJzloFCDYK1qlE2KuGKGkDkEzEKDYIocoaoZQE-k9oMO8kKJSuFhIGYDvocLCA6IxiUHYHtnaL-FNGQNgLhDaq0C-MNsbPGvQflmcjEXEfcIICvIIG4U1HwfmhUAxLnkyksJkBnjbPbPYlaMzFoBAWXDKBkfEfgIkfoeob0M-m+LwaLuvhLpSnIIzsjCIkUGAoEtDMYFnDUNERTpkQkSvP4J4vVAkaSDOKkbptck0VkTkSsVeO8gPJYMPMYGKOBPbogJJrpKoLOhiEaDlFsNMbETajrioWoWsfhhsTMY8dkagLkWoTIHsWoNMjlDUHMOGFBKcUkI2OUJyJYCoEPNWvcZkU8XkR4Sbl4WbgyExgKDuJoJYQQWfJUlMpCFfF1uYvIC4AOPrhgPAFEBrj0e-oIIsGULkGMnpGnBMoyIsO6tJl1ONIaBUFNPiGAHSfwYIKCEIVCMzDvMaExJUmKFCWoKjlYCeOumQaOMKfmiCMGEPiYLMq9sMYgKuIaGnvIOqo2ONCqQ0ZxrfHAuqW1BkFvLUVzpoJUC3lpOqijqiOSiXMPn1s9IvjNNxmsr5MSlluajKraT+NaFqRkMzI4NpCpvSskBnJxJnvkO7paZ7teIGVypKqanyjluGQFtXkYO2GuKoDCRIJ-nRkfKptBqiC7OdiKO+m2h2hGXtEPFIByKdCoHYA2AAXCCdDsDdKoGyCaEDqqUJNmZ+q2UWeviYZLlaDkB9n1LDI2KDCEmIFUKPJhvgNhq8m2UTM+rpJxFOlUHkDuDTACdUEMuLEWnUC5jzO5vubOe-iYeQiYFDGKDuOfDLDTlTOqo4BKSYr6fIoVNmYtmNplhVvyoWdVq+fBKuFTMKL1NkCCCUMdnKW7PBElDqIThOZPN7nzgebVvYD-IIUaFuWsJIaoCGM7ixN-kcQXnzgLhwMRf0rnGRUMjYL2K6bYmWSsI6CsIERaaGk2lrigbrvzvrrihRGxXCDYJOv-HqIsLIJFq3lMjYB3vbNaLIExZJX7oHnHronJdYAElqrWMcfXisNGJWtLseEcE4WKD3oLnJcYDlLpMaF2PaT-gfjnPuJSkeGiJYKnFfjfpwHAS-CZSaK7LyT2fBEzGBHkCGGsAsEQcBOrn6RXOwVQdHtwaOPmK5TaFCWAsMuYvCJIXgafrYMaIzAhS4avHkXJUyCULpGOakF2NFqkMEYNGfBWjUEJSBeXJsXMavG0YVVIMzKrribLhURlNOkKGApyOxhmW0MNS0fMYse5MsWqS+fweqjMMXKMqkLWGZLYM7CyBfEPO1Q4laAic0VAK0ckdkgABTaJMB6AACUTVYgHEcgLJagbJ96nIyGESaGyq45K1kga1D18xbR-gr1qA71H18Nb1n131ASzJysANWg7J8ykuQJYhaIaIdod19wiRjVu1+aAFukpl-5WBVglSaw8plMe89a7GLgQAA */
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
      sketchPathToNode: null as PathToNode | null, // maybe too specific, and we should have a generic pathToNode, but being specific seems less risky when I'm not sure
      sketchEnginePathId: '' as string,
      sketchPlaneId: '' as string,
      sketchNormalBackUp: null as null | [number, number, number],
      sketchPosition: [0, 0, 0] as [number, number, number],
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
              cond: 'Selection is on face',
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

          Export: {
            target: 'idle',
            internal: true,
            cond: 'Has exportable geometry',
            actions: 'Engine export',
          },

          'Sketch On Face': {
            target: 'animate to face',
            actions: 'set sketch metadata',
          },
        },

        entry: 'reset client scene mouse handlers',
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

            entry: 'setup client side sketch segments',
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
            exit: [],

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

                  Cancel: '#Modeling.Sketch.undo startSketchOn',
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
            entry: 'set up draft arc',

            on: {
              'Set selection': {
                target: 'Tangential arc to',
                internal: true,
              },

              'Equip Line tool': 'Line tool',
            },
          },

          'undo startSketchOn': {
            invoke: {
              src: 'AST-undo-startSketchOn',
              id: 'AST-undo-startSketchOn',
              onDone: '#Modeling.idle',
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
          'engineToClient cam sync direction',
        ],

        entry: ['add axis n grid', 'conditionally equip line tool'],
      },

      'Sketch no face': {
        entry: 'show default planes',

        exit: 'hide default planes',
        on: {
          'Select default plane': {
            target: 'animating to plane',
            actions: ['reset sketch metadata'],
          },

          'Set selection': {
            target: 'Sketch no face',
            internal: true,
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

        entry: 'clientToEngine cam sync direction',
      },

      'animating to existing sketch': {
        invoke: [
          {
            src: 'animate-to-sketch',
            id: 'animate-to-sketch',
            onDone: {
              target: 'Sketch',
              actions: 'set new sketch metadata',
            },
          },
        ],

        entry: 'clientToEngine cam sync direction',
      },

      'animating to plane (copy)': {},
      'animating to plane (copy) (copy)': {},

      'animate to face': {
        entry: 'clientToEngine cam sync direction',

        invoke: {
          src: 'animate-to-face2',
          id: 'animate-to-face2',
          onDone: {
            target: 'Sketch',
            actions: 'set new sketch metadata',
          },
        },

        on: {
          'Set selection': {
            target: 'animate to face',
            internal: true,
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
      'hide default planes': () => {
        sceneInfra.removeDefaultPlanes()
        kclManager.hidePlanes()
      },
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
      'set new sketch metadata': assign((_, { data }) => data),
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({
        selectionRanges,
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst,
          sketchNormalBackUp || undefined
        )
      },
      'Make selection vertical': ({
        selectionRanges,
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst,
          sketchNormalBackUp || undefined
        )
      },
      'Constrain horizontally align': ({
        selectionRanges,
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst,
          sketchNormalBackUp || undefined
        )
      },
      'Constrain vertically align': ({
        selectionRanges,
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst,
          sketchNormalBackUp || undefined
        )
      },
      'Constrain snap to X': ({
        selectionRanges,
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst,
          sketchNormalBackUp || undefined
        )
      },
      'Constrain snap to Y': ({
        selectionRanges,
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst,
          sketchNormalBackUp || undefined
        )
      },
      'Constrain equal length': ({
        selectionRanges,
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst,
          sketchNormalBackUp || undefined
        )
      },
      'Constrain parallel': ({
        selectionRanges,
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst,
          sketchNormalBackUp || undefined
        )
      },
      'Constrain remove constraints': ({
        selectionRanges,
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const { modifiedAst } = applyRemoveConstrainingValues({
          selectionRanges,
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst,
          sketchNormalBackUp || undefined
        )
      },
      'AST extrude': (_, event) => {
        if (!event.data) return
        const { selection, distance } = event.data
        let ast = kclManager.ast
        if (
          'variableName' in distance &&
          distance.variableName &&
          distance.insertIndex !== undefined
        ) {
          const newBody = [...ast.body]
          newBody.splice(
            distance.insertIndex,
            0,
            distance.variableDeclarationAst
          )
          ast.body = newBody
        }
        const pathToNode = getNodePathFromSourceRange(
          ast,
          selection.codeBasedSelections[0].range
        )
        const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
          ast,
          pathToNode,
          true,
          'variableName' in distance
            ? distance.variableIdentifierAst
            : distance.valueAst
        )
        // TODO not handling focusPath correctly I think
        kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
      },
      'conditionally equip line tool': (_, { type }) => {
        if (
          type === 'done.invoke.animate-to-face' ||
          type === 'done.invoke.animate-to-face2'
        ) {
          sceneInfra.modelingSend('Equip Line tool')
        }
      },
      'setup client side sketch segments': ({
        sketchPathToNode,
        sketchNormalBackUp,
        sketchPosition,
      }) => {
        if (Object.keys(sceneEntitiesManager.activeSegments).length > 0) {
          sceneEntitiesManager
            .tearDownSketch({ removeAxis: false })
            .then(() => {
              sceneEntitiesManager.setupSketch({
                sketchPathToNode: sketchPathToNode || [],
                normal: sketchNormalBackUp || undefined,
                position: sketchPosition,
              })
            })
        } else {
          sceneEntitiesManager.setupSketch({
            sketchPathToNode: sketchPathToNode || [],
            normal: sketchNormalBackUp || undefined,
            position: sketchPosition,
          })
        }
      },
      'animate after sketch': () => {
        sceneEntitiesManager.animateAfterSketch()
      },
      'tear down client sketch': () => {
        if (sceneEntitiesManager.activeSegments) {
          sceneEntitiesManager.tearDownSketch({ removeAxis: false })
        }
      },
      'remove sketch grid': () => sceneEntitiesManager.removeSketchGrid(),
      'set up draft line': ({ sketchPathToNode }) => {
        sceneEntitiesManager.setUpDraftLine(sketchPathToNode || [])
      },
      'set up draft arc': ({ sketchPathToNode }) => {
        sceneEntitiesManager.setUpDraftArc(sketchPathToNode || [])
      },
      'set up draft line without teardown': ({
        sketchPathToNode,
        sketchNormalBackUp,
        sketchPosition,
      }) =>
        sceneEntitiesManager.setupSketch({
          sketchPathToNode: sketchPathToNode || [],
          draftSegment: 'line',
          normal: sketchNormalBackUp || undefined,
          position: sketchPosition,
        }),
      'show default planes': () => {
        sceneInfra.showDefaultPlanes()
        sceneEntitiesManager.setupDefaultPlaneHover()
        kclManager.showPlanes()
      },
      'setup noPoints onClick listener': ({
        sketchPathToNode,
        sketchNormalBackUp,
        sketchPosition,
      }) => {
        sceneEntitiesManager.createIntersectionPlane()
        const sketchGroup = sketchGroupFromPathToNode({
          pathToNode: sketchPathToNode || [],
          ast: kclManager.ast,
          programMemory: kclManager.programMemory,
        })
        const quaternion = sketchNormalBackUp
          ? getQuaternionFromZAxis(new Vector3(...sketchNormalBackUp))
          : quaternionFromSketchGroup(sketchGroup)
        sceneEntitiesManager.intersectionPlane &&
          sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
            quaternion
          )
        sceneEntitiesManager.intersectionPlane &&
          sceneEntitiesManager.intersectionPlane.position.copy(
            new Vector3(...sketchPosition)
          )
        sceneInfra.setCallbacks({
          onClick: async (args) => {
            if (!args) return
            if (args.mouseEvent.which !== 1) return
            const { intersectionPoint } = args
            if (!intersectionPoint?.twoD || !sketchPathToNode) return
            const { modifiedAst } = addStartProfileAt(
              kclManager.ast,
              sketchPathToNode,
              [intersectionPoint.twoD.x, intersectionPoint.twoD.y]
            )
            await kclManager.updateAst(modifiedAst, false)
            sceneEntitiesManager.removeIntersectionPlane()
            sceneInfra.modelingSend('Add start point')
          },
        })
      },
      'add axis n grid': ({
        sketchPathToNode,
        sketchNormalBackUp,
        sketchPosition,
      }) => {
        sceneEntitiesManager.createSketchAxis(
          sketchPathToNode || [],
          sketchNormalBackUp,
          sketchPosition
        )
      },
      'reset client scene mouse handlers': () => {
        // when not in sketch mode we don't need any mouse listeners
        // (note the orbit controls are always active though)
        sceneInfra.resetMouseListeners()
      },
      'clientToEngine cam sync direction': () => {
        sceneInfra.camControls.syncDirection = 'clientToEngine'
      },
      'engineToClient cam sync direction': () => {
        sceneInfra.camControls.syncDirection = 'engineToClient'
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

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
import { ModelingCommandSchema } from 'lib/commandBarConfigs/modelingCommandConfig'

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
  | { type: 'Re-execute' }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz4CAZTDsABLCwwck5uWgYkEBY2EJ4IgQRpZWFpcQVLe1V7SwVbYUttPQRBRMtxZUtlGkt0wVVpBTMnF3QsPChxbAhMMC8ff0Dgrlww3iiOId54pIVxe2lVYSNLDUFlgv1VAxSDUWE0wQM0ww0mkFdW-A6unoAROAG-Fjx2EYixmMmhA2FJGlEFP7KJLCZQA4TrBLSRTiTaWAwGZQiNRWVSnc7udqdboEO4BbrBXyQGCvZiscbcT5FeGzf5Q2zKb5mNa6fQ0RKpIyI4RsyxWeZoloYq7Y3EPXwkPjYWAkyJkj5xITmcS7OxVCyib4HAwQo5lMSZRYNESOZxnQVtYU9bz4x6oZ4y94TBUISo-Y7VYrZZaGbUsl2ZMoA0Se1SCNlQgVuC1Yq1iolgB1yp2gKY0GagxFpBSM5mFBHKcT5hTSP5QkHKaSRi6Y669G3iyXS+ijJMU52I1SFqqrBY8mgGfJ+kEzaTWAfCOpJQ4m5pRy4xutBPwAMxIlET0WT-EQlRmBjsagOYcsYekEI1glScOke33h12CirQoXAFFcOwwAAnfwAax85AACw3clYhTfREhSCoEVHCtjFWUQIVDAstmWRY8jyBQpGUJ9o1rN8P2-WA-3YQCqGkcJSU3NswIQadlWLb07FUYtwT9NQaELHJ4IZEtzFRU10VwkV7nrVd12bN5W1A7cilsQtagUdRVj2DRfUKU9xGME8ljURSBxw+da2tJdxUwTBgPlGjYJhTYxAaTIaGEJzEJoAteQMVQM0zZIaH42dq0tHERJMkgzIsrd4kUFIGVBLTfNkNTEGLSQHLmBpEn3GczTnGtsRfPh2E-ABXDBwuomT0s0nJ0kyWxjCkCFEiSGzbGLURDHmLYDPaTxiMA4gyEoTBev-ICJMokDKRsSpZjUbkNFctl1AhCpL12KRkgWKFLDEbrxBGkiAP2vqAIASSMsUnnfMrpPiepqnEaxRHMKQSyMVjClBDiFvqVYGna1y9oOwDjtG87sWMgkAigABbMBrvG2UqNu-Q0lKJ6XuKfskQhFQDELcpNjSJzMjhIGTtBw7wduYKCSul5Ecdcq7sw-GKlkDQFosRD6mVJjNix-t-kfATzUuYGjol6mgrxEzobhhGKKRybnXqUEYWDUcdisawPqS-HmIRawqlkRyRHJ0bKcA6WXwARyK7AmF8dhUFQczGakykw2STTbxLTItgZQRz33cR5gaY2-gBCsLcOq2zrw+3Hd8GHUAANzAZ3XfdpWmZRoo0xSWpNnUVyKwav0doLIEthBewEUU4RY5BqWLr8WXBlCD3kamioJH3Z7jB9Q5EoQDUOPD7kB1qMRZGbyWTul5ASD-fpYfhvwM8-ThyFCm6ppYsOQXepCFDPhC-VkCsyjqb590w4om9FnL4-jpeV8z+WN98ADUE-bAABe3B2B727irGiNhsiSABD2eEBwrB6wSFkQsOx5B1CULeUQ88361iINwWAhUSB4B-n-QBwDQq+AgFKEBFAExgMsjJGwuwuwCxsE5U8PMxCPXvJ5GKGCRb+SFBLHB2I8G4AIZ+IhuBfBbx3hQqhBDBp0Nzp7VWoh0iSChDYEQgd4QuREGUYwu5-hWDPgI7KAVhGt1EfgwhxCACCAAhTwvgAAa+9VYAjZssJQhxkioIUIhdq+MciqkqMUAcOxsHWJ6GIiRUjfBOJcQATQ8RArxqRfJeQOPYRSiFMIcSMDkXYgcGRYOfpYimMTiC2MkcQsgUBuhpMYdmNyQIbyuWyIsP4iFYRh3agCGwHkJxZUEuLKpi9cG1ISd0fA7AxoqJ7p4vYj0FgnhLBOAcwZEKKEKXpCsO1HIGGiZMmx4i7HSKYF+K5uAqHkCKpgEg34FE0PEos8BjCVSzDyJyYunlQyITEPjIwxQ6jBjZO1E5YMpnnLqdI3+-8gHvlCpgHQplsBQGGPQiK+h-ghLDOoZicIiaIPmECMo00TEAiqOUKFVMYXxOIbI7Au8zJotChirF7yGEs3sGUVy8JbDazEI1Y0yor4ohEMkbMdLrYMouf4XAJAnYuzcc0lmxgYRSrhBOSOgTL7PQ4iocw3o9jhPMWMnqEzoVnMZdI2ASqVWoF8Kk7FzNUaatcsWRyzF1HfEHIUeozCdj2EWAyaoZMKlCOtfS21CqwD2wobMqA8z1WoxsIGO+L0tg3i0JfaYkhkgnn7CbOwoyxZWsttUuJCqmBPJRdQN1+d6jckehUA5TV1ABv0PCN0IJ1ELA7KsY5UaLRWNObE6ZxDPxgFThnXw5Ap3vibNynFCRnqdjNZ5RQIgeT6sDU5UoUJMLci6VsZ6sqE7YgAEpgAALRgD4EEIqH400JGKWHew7VnqsxsKoCEWwOI8SzHUbS6jsEABk8CZwACrZwIHbB2Ts52Zxdm7N98gz6SBMU5UcewMrniUJ+qej88jPWwqO8ZlsoO4Fg-B29D6n33NfU2r2i0CZ4ZyJhIVEI8izHSNmPYO1Ikx0o5WuONG6Nu3EAABTtO+RJEAMAQAIPYpTvh6YYYFVVHaD8PJqCBLxtkYcERshyCCLpUhIPQd8HB6T3h14KbU8p1T6nNOsedApbY2Rx7yDsPCfdO5Qw3303feo8xNjWdo7Z7O+0wCOb8M5yANSYZMG6B+Xw7hlEtiWTRPGEgCmD2mLyRBoIRw5HafSKwtKxOv0kzF+z8WFaJaU8lxDydaMAHcs7oY83l0uMJ6gj18nCOEuNeajnZskY9VcotScwOIU6uAOAEDfZ5UcNIpXtTDTeADfL+zcYGR0-sc2GsLaWytsiq73UIFDA9NUYY-oHBBLxzYml0h7F1X8P4I7BFjopvVuzC2AByzq5PPFgK5iAGn5MM2u-ndQA5HrzGejtKwapXsFkSI5dINQbw5GwWgedQPejtweEMDDgq21+YFkkdIF9CgaB+Iifc-Z1lcQo39qjccifzYIAxx9z6WPw69kafp8gBOHHrueXmoJDZ2AnBYSLtXhG87O+INXeBLt9ZkiIDRwYLBbCJWyPNgb+zArhP2cJiRVic4sdGy2augca-TpnLX7BVvkRyx8yKoI3SejMETawvJGrzFKIsVYqwSggisIT136vNfLY91QVQIvPN7BmGkDyxhPL13sKHjRI8WKFy0eWl+wj7GdaIX4BFZDkWYEodQpRvg8DLlQAQCA3AwAdFwGnVAf5xAwHYHe2vSKQGYDva31Aa29KzCFhEzKt4ebJQ1PuMw01liRq5+JkGlfq8kMReQhvLzm9T4IF+T8f9xBpZIOwNvn4YaD58CP0hY-QqT9wG3mfb2dhmDQVmxIHmRER6KQRSLkBoI0bBPfDgGRL8ORY-JvWhFvT-dvTvWjHvPvAfIfO9ZlVlD-L-HXeIZieQQsbIKECwczDQFyZqYWMwLYRQYmKAqvGA3A+RRAygZAtvc-T8S-T8a-R5O-P+R-bA1gifKfGfFQTSeEQuKoDyOoRBByAsKOPSW3cMJ+bfV+aAxLZxNxTg1ArvDA-vbvbAkgAAI1gDvT4HwOn0IMQGIJmGLlqArGDGvCCU8m+QOEqEzHNhVwpi0MSR0NcT0O4N4P4Nv3v2EOfzMIsKsPENsNuyUBmGqHYlwzVG7Vux2BmHUCDXahLEDyYP3ySRdWCLQO7zwEwOMKiPMLvR0GsIkIkDHD+H+HKHWkCwSKsApTBWmGKXKQ0Ir2YO0JSWCIvyvxv0EIfyf2H2iJqLqPiPsOgXUTyCG3MHkEQhK0ekUjPmGVsB2gKJgIaW6BKIMPKKMMmLvQOPvTiLTxonmOzESFnhgQUh2V5iNBeg6iWL2L8AuOGJ4NGIEIiLOIuNmOuJkmYhmk2CBG5FchRxUF6XUVmE2HUTmmGU+My3hhTQAiOPQJOKwOf2TXmWBO9x5TsN8TbWyP3AqDNUQhrkeg1BBChF-yRFRPxMxLPxGL4LGIBOwJZMJMkly1BKUH7jvGpTMQ2mpNcmw1nhUGLHKEsFRKuU-BuTuQeSeUb0USQLP1KMMNxOHwVKVJZRVM-DvRP1oV5ImmJNu2aM0VaUZDDAREBRyBhAaAHBLQnFBF6Pt3+0tn8L1PhmVMeWeXYLdxQJCL+PCKELON9NuQNIDONKDLNOVgtPUAaGtIRFtKt0BVWCdPDVdM8gJ18NGl8FwGdTEljHrAwFXAeUeEeVozfTJXDx2jVlHAaCDghHLmRzZAOEwnDhWKcFNGLIwHgAiEtSJLXWPEkBkDkB3TUCoL9DvUME7EUCBHKB9WDHHD2hjFHJuwZE3VWCFi2UMBUGDkviPDDnRxNjPhtzL0qVGi3ObQHE7Fcl7AWkqBRwhDvWYX7BvFvnsAzH0gLLjhiTvN7mC1DGkKhHkGHQZ0QF5A4gWCkEgraiQlOyB2AudENxMF5D112D+VNzsLDFSFX06mzz2B8L6IBxs2dxuC7zQry3BUkFQWYhLHqER1e0vD3MAzyFMWvIdwk0oti3Byc1awgFotBJqHe2DAq0goRGgoQDdIJhxy2KcmRBQtiwc2a0U2U1Esik2G+h2irgZCMCqExwUowkExjz8k9O5xBkB1iwu3YG0vwpvEkCwrIykCVzwrkt5gsEj0RCBGPF+ysp3yOlsuk1B18EEvYCHPNLXQhPxhZ1HFDHDmzBMtMzyCqDmBUjj2J2zkcqKGMAaIWBkrKQODPErgIqsEjyQhbUrAApBid1i0Tw4DypUAWFWTDVUjXLKrNwRDKAZBNlkHrMCstVfgaukzV06w4F-hfV8BnUYyFzABat2DclzyNyDRGUaitz6rvE2lCUOGyvmxd3nUmvmUJCYxfUWr5J90VEWF+GFiwsRBsFD3UE0m2kqE8kOBLB4q9J53j2d3CpQyWq4SqAwmLUDn-UvnqHTC7I1G2mSNRNHyPzVNeWDLbzyruw4jsChH83kBvF2z9HkILAWEwg+o0HhrqqOn8NEORtPxQPRvCWVEyHkBBEWG1lksyFkEeiMUckD3UFE3Iu9IGICJcSCKn3pvZARBUF2rzIhsKFhHYtsDZCYhsGLGGorU0KFqKOST0PFqUPPikHMGmCeoJsUgkGPVpDX1ww9JGv6P32+LFquqTOcLDhqE1HujejhO+mMD+GvHkEaApvEH8JZJ1sdtiorEgiKWKW4jaLuxmFyDqEMG7L9XlOuT9JjNVJNI4Idpipu1DH+F9mnAyCwgZEBWAJBTTAiTxrlIpqLJLLXEupzvzjhDjt3XdsOQ8jbL+HewaFkNNjqD7IcCAA */
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

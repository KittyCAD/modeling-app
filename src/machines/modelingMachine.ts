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

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz4CAZTDsABLCwwck5uWgYkEBY2EJ4IgQRpZWFpcQVLe1V7SwVbYUttPQRBRMtxZUtlGkt0wVVpBTMnF3QsPChxbAhMMC8ff0Dgrlww3iiOId54pIVxe2lVYSNLDUFlgv1VAxSDUWE0wQM0ww0mkFdW-A6unoAROAG-Fjx2EYixmMmhA2FJGlEFP7KJLCZQA4TrBLSRTiTaWAwGZQiNRWVSnc7udqdboEO4BbrBXyQGCvZiscbcT5FeGzf5Q2zKb5mNa6fQ0RKpIyI4RsyxWeZoloYq7Y3EPXwkPjYWAkyJkj5xITmcS7OxVCyib4HAwQo5lMSZRYNESOZxnQVtYU9bz4x6oZ4y94TBUISo-Y7VYrZZaGbUsl2ZMoA0Se1SCNlQgVuC1Yq1iolgB1yp2gKY0GagxFpBSM5mFBHKcT5hTSP5QkHKaSRi6Y669G3iyXS+ijJMU52I1SFqqrBY8mgGfJ+kEzaTWAfCOpJQ4m5pRy4xutBPwAMxIlET0WT-EQlRmBjsagOYcsYekEI1glScOke33h12CirQoXAFFcOwwAAnfwAax85AACw3clYhTfREhSCoEVHCtjFWUQIVDAstmWRY8jyBQpGUJ9o1rN8P2-WA-3YQCqGkcJSU3NswIQadlWLb07FUYtwT9NQaELHJ4IZEtzFRU10VwkV7nrVd12bN5W1A7cilsQtagUdRVj2DRfUKU9xGME8ljURSBxw+da2tJdxUwTBgPlGjYJhTYxAaTIaGEJzEJoAteQMVQM0zZIaH42dq0tHERJMkgzIsrd4kUFIGVBLTfNkNTEGLSQHLmBpEn3GczTnGtsRfPh2E-ABXDBwuomT0s0nJ0kyWxjCkCFEiSGzbGLURDHmLYDPaTxiMA4gyEoTBev-ICJMokDKRsSpZjUbkNFctl1AhCpL12KRkgWKFLDEbrxBGkiAP2vqAIASSMsUnnfMrpPiepqnEaxRHMKQSyMVjClBDiFvqVYGna1y9oOwDjtG87sWMgkAigABbMBrvG2UqNu-Q0lKJ6XuKfskQhFQDELcpNjSJzMjhIGTtBw7wduYKCSul5Ecdcq7sw-GKlkDQFosRD6mVJjNix-t-kfATzUuYGjol6mgrxEzobhhGKKRybnXqUEYWDUcdisawPqS-HmIRawqlkRyRHJ0bKcA6WXwARyK7AmF8dwwF8dhUFQczGakykrGS+FgwndQ1BgiEK07bJXLqOpFN5UQLcOq2zrw+3Hd8GHUAAN1d93PZuykw2S2pNnUVyKwav0doLIEthBewEUU4QE5BqWLr8WXBlCb3kamioJH3Z7jB9Q5EoQDUOPmTD+xPBZ2srUWcqTpPpeQEg-36WH4b8bPP04chQvz1WWPEG8GREJCFEvhC-VkCsyjqb590w4om4XgKJeX2tV-X+Wt98ADUCfmwAAL24OwA+3cVY0RsNkSQAIezwgOFYPWCQsiFh2PIGOIhszxzfkKD+rdsREG4LAQqJA8D-0ASAsBoVfAQClOAigCZIGWRkjYXYXYBY2CcqeHmYhHr3k8jFJQexm6SxOtLYhuBSGfnIbgXwO8960PoaQwazClZMxRgkUQ6RJBQhsCILYDJR6ZBEGUYwu5-h+0vmIz+RCSFkIoQAQQAEKeF8AADUPtAgEbNlhKEOMkDBChELtXxjkVUlRigDh2LYwhPQpEyLkb4Vx7iACa3i2G+NSL5LyBx7CKUQlPeSORdhGIZLg-y+CKbxOIA42RFCyBQG6JklmCJHpAhvK5bIiw-iIVhCfdqAIbAeQnFlQS4sakSNrIkxx8juj4HYGNDRPsj57EegsE8JYJwDmDIhRQHFDibArDtRyBg4nTPsdIuZvgmBfjubgeh5AiqYBIN+FRjDxIrJ7qrFUsw8icmLp5UMiExD4yMMUOowY2TtQuWDGZ9TkkAKAaA98oVMA6FMtgKAwwWERX0P8cJYZ1DMThETFB8wgRlGmlYgEVRyhwqpgi65DT5GKOwPvMymLQrYtxd8qBWT7BlFcgHIWs9GrGmVLfFEIhkjZkZdbZlSSKGwFwCQJ27tPGtNRsYGEsq4QTmNmmRqz0OIqHMN6PYUSRZVItAQy5CTEUqrVRq1AvgMl4uZjqiQrliyOWYjo74g5Cj1A4TsewiwGTVDJngu1Uz4VXOVfIsA9taELKgEs7VCQ2qBkfi9LYp9GrTEkMkE8-YTZ2HGWLHq8amWJpuUwN56LqCeq0fUbkj0KgnKauoYN+h4RuhBDohYHZVjnNjZMy2tTZmst8J+MAGds6+HIE698TZ+WsLus9TsVrPKKBEDyEJN8nKlChJhbkPStjPQVcnbEAAlMAABaMAfAghFQ-Fm0NEgSxD2eqzGwqgIRbA4jxLMdRtI6JvTbVOGqmlb2wLQt55A3Yey9hu-FCBezoxPLYWuCx5Bh3mI9AEIcY4okqdld+FMAAyeBXYABVUMEDtg7J2i6c6oazfIS+kgrFOVHHsDK54lAn0ctjG8eRnrYQnTWy2tHcAMaYw+59r7nkftbb7TC6Y0wPy2EbGwjVvipFMOYf40a-KUeqXJujvhGOe3EAABTtO+FJEAMAQAIE4tztznMM3Q16ooyxSiZCSNYYljkzxsXkOYxI7UINhNsfJxT9nvCbxc159znnvP0yzRWZ6ypQwl0METLQfoVClDTGYM5KFiwNESzZuzmB9pgDS34DLkA6kwyYN0D8zs6O5cqIc74z0Tw9OSGHAMSRQQVEvk-NMFGJmycTkl2zqHmutdc5lljadGEwHfAhzA4pPzIdzmhlsPyrLFZPioQbiQrClZDQOTSBwz0IhhaserCnVspZawrNrbmOvbadi7FDecNPtlHJ2Z+vkdE6PsIhLYNJDZsjMIpCzi2l4rca+IU6uAOAEC4zIVIl9FjHn3GoCEG1nuZXrgpWJMnMcNbW7j-HZF-NaPkMUR6fxjy8gUpFz66zvjwP+p5HDn3ktNYAHJuqc88WAWWIA+ftODmixhfIFb-SCe8o4w6LGFSR3c5QgQ2ss3Gy2aAl2Nd6O3B4QwuMB07fIXynI8h9L9BoH4iJ9zT2KFxaTtrJ2J0t5LggymX1vvU+zguRpBnyHSNmeBo8hmBmR-6iwmxbEh++5gZjMG+tfdO7lvTs1ahAkLmoB7iBPfmMk89RYOjzYM4-tn63QO3Zwf24h47oOzuSQuzJCs+5icHB4hhFQ55mpcmWPXnYJ5X6B6WyDVva3s94FZ6rmSIhdHBgsFsUlKPGr9nBXCfsUTEirAD2boPy+s6S-EGvvH7ACfkXOwKyKoI3SejMETawvJGrzClCk6jYlAghWBZ53454P6QHr7P5UCqDR7OjYIzBpAeTGCeT1zw43yjiHKJ5dLFj6JVqLwfxOIADu5CfgyK1CaKh2HyaivgeAy4qABAEA3AYAHQuAmcqAf44gMA7Aj6VBqK4CmAj6jBqAWazEmwswQs0SmUt4PMyUGo5O7UGgQW46i+S8ZBFBlCKKNCtBDC9BYhBAX4n4gC4g3WJA7ATBn4MMvBPgAhVCQhoUohuATBEhekhYnMmCeaiQPMiIj0UgikXIDQRotiWhHACiX4Si+hqiTCDBrhzBrBCmHBXBPBfBj67KnKLhbhm+8QzE0WA4xYxcOQpgLkzUwsZgWwigxMYR5BERmRyiBhcRRhJhZhFhVhgCth6RDRIhYh7hKgmk8IaYJYZKdQKCDkBYfwl8AsFQ4YC+1+S+R04RbWbini8RTBLBbBKR3B7B6RJAAARrAI+nwNkeIbkYgPkTMMXGXgYteKEp5P8qPq5PuvMRjiQXUSse4h4uscwa0Z+OYa8h0TYXYfwQcUcScX0ecZhkoDMNUOxPxmqH2phjsDMOoF+qbD-rUdoaku6j8ZsckXgKkbsfYWCY+joKcf0RIGOH8P8OUOtEeoUJIaUOHNNHsKUgttWpoR8SkqsWkniX8QCZYdYV0SSYcWSRSVCZcXAjonkPUNrARn6CiD8NkMxNmLPFUK8Zye8doU0t0HiUkewYSTsSCY+rqU+pCYgTRFKdmIkGIPUPYApPsrzEaC9B1LKViREWafyZ+KYf8e0cKSaWaRKZaTJMxDNMckkAePMMGFXphr2rMJsDonNKMh6X4OmksvqVsUaWkfYemQBMGW-puhcQEp2mifuBUFaohDXI9BqCCFCDsFyFfm8RTMsc7PDBmgBN6b6YKUCSKfwXmQWf3u-sWbqkMYcHYJfM-OMZUAWGIHaSoMWOUJYKmbcvcvDE8i8m8nQk0ZQJmQSZwcaekXcp+A8hua8p+I+nQUwoORNEWZhrSXotmAyCCGGAiKCjkDCA0AOOWhOKCBycQS2dyceaeRypue8jua7C0T6W0YCQGUeWuY8qBeeZeRBTecrHeeoA0I+QiIyK+bGfhsFl+ekPuL+TkGIr4LgG6mJLGPWBgKuC8o8K8gpp+mLpIDtGrKOA0GfIRsqSWPWZhJPOYCaKaJRRgPABEItoWRhseJIDIHIPumoBoBCI+okBPEYGkDyJkGWKbhjjGFJQFgyDuqsELLsoYCoIIBKkYCfFYHYNYJfBfkQVRqNPpW2gOJ2FHPNDOUtNfIUI+hOOgooKcrxDtNYFBtcC5b3KGHqkMVCJznCD5YgLyBxAsFIJzm1EhBLjnhFUgQ5MKsGI-LyA0DtDqCkAEmqIYOHOUOoQsYzl9tjjcGwdlVZIglVKGCoK5LaSgsCIWHsNjFJhqMRZldjnLulgDhAE1VviWdHKsPIBanZXrmzGmP6q5LvkoENWtqln9ptpABNVMKOJeMBqfq6NpAtdzmCCFqtY5VZstkzvZizuwLtUIJ5NpvlYsIVeUF1R2uUGersJsBqd8OtfZjLr4CNewOJbedJWIMFskJxQsFtBZWxPrgnmXJVl2jpVqRTCvp7I9UUMYFSQsAiKpPlQLolVYB0nkHSccDSRAVbqvjAU-jjSoAsBspGkTS9kfu0jXCbLIJSjGhoS3pAdjtnqQRwAAu+nOk+hHmpmAIzbsG5BgfvqGmMhzdXAyP2JtBEocDTffsLaLYSKpu+jLUOXefVPjPNJfHzoiAZtgeoJpNtJUJ5IcD+trVAcDexrLfwhqV6K+XdgATxt7jkFUdGk2RjZbK2YIXodubEbuWITjaGLonYFCHYBCjeDeHwgWAsJhI7aoRUCuT0VHZ8pBQkXHVEgVg6SCIsNrAlZhuGI9BYo5D-sHPPPzYBdiasd8bHcbRhp5OyAiCoBrc9YBoqQOJeOrmyExDYMWNVc2WHdyTiXyZ3RDQFj3ZMVfFIOYNMNbYyYpN+ooLSOTvxv+U5YnK2V6Yvehd3XlifDUJqPdG9P0nJMGLYIGrFY0M3q3REXmT8SXbIAItUYPMsKCPsrArkHUIYAJYGiucBeuUhVuVeTHcXV3cvcYFcYaGGLUFhAyKCv4RCmmNEqncue-aNBRVRWuEbUvVonCDMIHGyEcKch5GHH8JpNkJUNeCWHUE4E4EAA */
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

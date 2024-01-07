import {
  Path,
  PathToNode,
  Program,
  ProgramMemory,
  VariableDeclaration,
  recast,
} from 'lang/wasm'
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
import { sketchCanvasHelper } from 'components/SketchCanvas'
import { executeAst } from 'useStore'
import paper from 'paper'
import { changeSketchArguments } from 'lang/std/sketch'

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
  | {
      type: 'Drag Segment Head'
      data: {
        pathToNode: PathToNode
        from: [number, number]
        to: [number, number]
      }
    }
  | { type: 'Equip Line tool 2' }

export type MoveDesc = { line: number; snippet: string }

interface NodePathToPaperGroupMap {
  [key: string]: {
    pathToNode: PathToNode
    group: paper.Group
  }
}

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz4CAZTDsABLCwwck5uWgYkEBY2EJ4IgQRpZWFpcQVLe1V7SwVbYUttPQRBRMtxZUtlGkt0wVVpBTMnF3QsPChxbAhMMC8ff0Dgrlww3iiOId54pIVxe2lVYSNLDUFlgv1VAxSDUWE0wQM0ww0mkFdW-A6unoAROAG-Fjx2EYixmMmhA2FJGlEFP7KJLCZQA4TrBLSRTiTaWAwGZQiNRWVSnc7udqdboEO4BbrBXyQGCvZiscbcT5FeGzf5Q2zKb5mNa6fQ0RKpIyI4RsyxWeZoloYq7Y3EPXwkPjYWAkyJkj5xITmcS7OxVCyib4HAwQo5lMSZRYNESOZxnQVtYU9bz4x6oZ4y94TBUISo-Y7VYrZZaGbUsl2ZMoA0Se1SCNlQgVuC1Yq1iolgB1yp2gKY0GagxFpBSM5mFBHKcT5hTSP5QkHKaSRi6Y669G3iyXS+ijJMU52I1SFqqrBY8mgGfJ+kEzaTWAfCOpJQ4m5pRy4xutBPwAMxIlET0WT-EQlRmBjsagOYcsYekEI1glScOke33h12CirQoXAFFcOwwAAnfwAax85AACw3clYhTfREhSCoEVHCtjFWUQIVDAstmWRY8jyBQpGUJ9o1rN8P2-WA-3YQCqGkcJSU3NswIQadlWLb07FUYtwT9NQaELHJ4IZEtzFRU10VwkV7nrVd12bN5W1A7cilsQtagUdRVj2DRfUKU9xGME8ljURSBxw+da2tJdxUwTBgPlGjYJhTYxAaTIaGEJzEJoAteQMVQM0zZIaH42dq0tHERJMkgzIsrd4kUFIGVBLTfNkNTEGLSQHLmBpEn3GczTnGtsRfPh2E-ABXDBwuomT0s0nJ0kyWxjCkCFEiSGzbGLURDHmLYDPaTxiMA4gyEoTBev-ICJMokDKRsSpZjUbkNFctl1AhCpL12KRkgWKFLDEbrxBGkiAP2vqAIASSMsUnnfMrpPiepqnEaxRHMKQSyMVjClBDiFvqVYGna1y9oOwDjtG87sWMgkAigABbMBrvG2UqNu-Q0lKJ6XuKfskQhFQDELcpNjSJzMjhIGTtBw7wduYKCSul5Ecdcq7sw-GKlkDQFosRD6mVJjNix-t-kfATzUuYGjol6mgrxEzobhhGKKRybnXqUEYWDUcdisawPqS-HmIRawqlkRyRHJ0bKcA6WXwARyK7AmF8dwwF8dhUFQczGakykrBBVImqsZFuwhCtO2yVy6jqRT3KywTxYpqW8Ptx3fBh1AADdXfdz2bspMNktqTZ1FcisGr9HaCyBLYQXsBFFOEC3Dqts6Lr8WXBlCb3kamioJH3Z7jB9Q5EoQDUOPmTD+xPBZ2srUWcpblvpeQEg-36WH4b8LPP04chQrz1WWPEG8GREJCFEvhC-VkCsyjqb590w4pG4XgKJeX2tV-X+Wt98ADUCfmwAAL24OwA+3cVY0RsNkSQAIezwgOH7RqWRCw7HkNHEQ2ZRBNxBknbERBuCwEKiQPA-9AEgLAaFXwEApTgIoAmSBlkZI2F2F2AWNgnKnh5mIR695PIxSUHsXBksTrS0IbgYhn5SG4F8DvPe1DaHEMGowpWTMUYJFEOkSQUIbAiC2AyUemQRBlGMLuf4VhL4i38kKD++CegSKkTI3wABBAAQp4XwAANQ+0CARs2WEoQ4yR0EKEQu1fGORVSVGKAOHYIjP4EKISQsh7jPEAE1fEsP8akXyXkDj2EUohKe8kci7AMQyHBb9bGJzEbWRxKTZFkCgN0LJLMESPSBDeVy2RFh-EQrCE+7UAQ2A8hOOOYseq1LBvU5J0iyHdHwOwMaaifZHz2I9BYJ4SwTgHMGRCigOKHE2BWHajkDAJPscQOZzimBfjubgWh5AiqYBIN+JR9DxKrJ7qrFUsw8iciLp5UMiExD4yMMUOowY2TtUuXUpJkjGnkKAaA98oVMA6FMtgKAwwmERX0P8SJYZ1DMThETPWCQBFlGmhYgEVRyhwpmQipxZD5HYH3mZTFoVsW4u+VA7J9gyiuXhLYbWYhGrGmVLfFEIhkjZkZVTWZiL5myNgLgEgTt3beLaajYwMJZVwgnMbNMjVnocRUOYb0ewYnWOyu-aZirmVIrVRqt2qBfCZLxczXVEhXLFkcsxLR3xByFHqGwnY9hFgMmqGTapFo7HwocTcshYB7bUMWVAZZOqEhtUDI-F6WxT6NWmJIZIJ5+wmzsBMxeCamVJuVbct56LqBeo0fUbkj0KinMDloxq8I3Qgi0QsDsqwLlxoTpbK5DSVW+E-GAdOWdfDkGTe+JsfLmF3Wep2a1nlFAiB5GEm+TlShQkwtyXpWxnoKutrWAASmAAAtGAPgQQiofmzWGiQJYh7PVZjYVQEItgcR4lmOo2ktHXtbnlFOmrmlb2wNQt55A3W51bb7c9nbjD9hvAseQod5iPQBGoeY9QURVJsfGh1N6RTSKgL4bwm93y+AABJgBIBAbNFhFKEdBHsdI5SVolkDHsLW+40LYXHVMy2AAZPArsAAqHtMAEDtg7J2C7s5KezfIS+kgLFOVHCJhk54lAn0ctjG8eRnoSYoxO5usncAKaUwQe9T6X3PPfWh50zENm7gflsI2Ng+0-EwpzdQaNeQJIc05z24gAAKdomMuIgBgCABBksQF8PTbTyxSiZCSNYYljkzxsXkKYxI7VwMRKi3J3winYsMYVn4DLkB0spay4lhm678UulYcqUMxdDBEy0H6FQpQ0xmHOShYsDQauObq0p-aYBGPNZS61whMMmDdA-M7OT2agR2DQWILRf0DOhwDEkUEFRL5PzTORu1NSZO1fq5gJbK3XFrbS6p1O9CYDvgQ5gcUn5kM5y9t171vWPInxUJUNkagKh9tKPILYigEQwtWHNmLr3Gt-xa19mDu35ug-26OTsz9fJaK0fYRCWwaSGzhxYvyD3KNPfmy98Qp1cAcAINpmQqRL6LGPPuNQEINqaQKWGI8ht7vxyk-Z57i3Ofc7IuDjR8hiiPT+MeXkCkSufQ2d8eB-1PInhl5Mpe0WFuxYAHLuoS88WAbXMvZa8zRLDnZzC-pBPeUcodFhCqI7ucoQJbWy6XmgRdL3ejtweEMbTIrMPEs5HkfpfoNA-ERPuaexQuI2eZ3ZkGEescucfc+19nnVf5yNEM+Q6RszwNHsMwM9OA0WE2AkovVvlPfadi7FDYOWw-KsgF2atQgQFzUCNwo6fTFWeeosE7r9bNy8L5nYvPe3Zwf+4h4H-eSf7n5wcHiGEVDnmalyZY8+dgniX-nlfR1O-s873gZXruZJYJHFsBoYgVC-RQYiPhCodIdCUMNMDvNfLvcQZ-LndgHnciQfflSKWKZUVYbZRyZ6HYClW+S8REbIDyMOOQcAyPRbaA5XVQSvZ0EQNheQRybkfRXyHIRqCwfGWoYWTaA4CcUPc3D+FxAAd1IT8AARRSoUBw+RUV8DwGXFQAIAgG4DAA6FwAzlQD-HEBgHYAfSEMoTRUwAfUkNQE4z0lmCFliUylvB5mSg1GF3ag0FyzHWXyXj4IEORS0PAVELoXEL0IIC-E-EAXEC2xIHYCkM-BhlUJ8A0IoVRVcN0NwCkIMM2ELE5gwXzUSB5gAJ2kUF3WtSNASUcI4DkS-AUTcOUQYQkJiOkNkMcwUKUJULUIfTZQ5WiNiLf3iGYjKwHGLCLhyFMBcmamFjMBR0vh2hyP4LyPqMUXcJKM8O8N8P8MCMARCNqLGJ0L0IMJUE0nhDTBLDJTqApQcgLD+EvgFgqHDFvzDx4JGOaw8W8VKKkJkLkKqOUPkNqJIAACNYAH0+BGj9DmjEBWiZgi4x89FrxwlPJ-kj9XI91TjuCKZcjLjPEvEbjpDpjPw-DXk5jgjQj1DXj3jPiVifiEA-jO12IDM1QQ1fidgZh1BP1TYzAmcziYSLjXErj0lES7jKi8BqiniwjsSH0dAvjViJAxw-h-hyh1pD1ChmIrBqUoVpgykzca0GSnC0kPVWTkTUSAigiFjuS3jeT+T8TCSVIdprBsFQxBBEJeQfhshmJsxZ4qgoSFTLZYTxR8BuhWSKj5COTHjMSH1mlug9SKCaJCTsxEgxB6h7AFIDleYjQXoOo8h557DzinDfTXYpjPwfCUTZjNTvTkz-SECN1fiGgOITkkgDx5hgwp9fj1BxtNgtE5oxlhinCM1lk3T7jPSaiwimyAJczJIh8ZJWiAkqT9wKhrVEJq5HoNQQQoQdguQ896THTGTOzVS0yZi0SszajOzuyJp8yCSlB+47w6UrENpRzXI9NQyVBixyhLAGy8i7lPwHknkXk3kaEJjKAWz2TFCvTajbz7z2VHzPwH0xCGFNzlZtzwsCw5UERGQwwERQUcgYQGgBwK0JxQR5T7V5ynDvz4YHzXl3kXyUyyivDlyMzVz5jvTMLHlfycKAK8LgL1FfYRSdFswGQQRoKKyCSpA8sEL0gxNPIcgRFfBcB3UxJYx6wMBVwXlHhXlHMP0TdJAdo1ZRwGgz58NLSSwpzMJJ5zBq00Lm4rkN9LdQdfBVBONNgOIzkQkyxitzxZBCx20t1JsISnBTRBKMB4AIhZc8yetjxJAZA5A901ANAIQH0fQT4jBqpLzjt29JNLRPKIcGRt1VghY9lDAVAzSb4jwT4rA7BjSLz5ARFYq20BxOxI55pKhKgyygr-g0FFBYosqkhFBINqYCre5Qx9UNioR1c4Rr5CheQiyuF1c2okJMcu9mrKCHIhVgxH5eQGgdodQUgglOFPJj1eRZzoTWcsdxAbg5DRrh8jAqpTSyqQyKVgRCw9hsZrMNRuLhr2d7cktPsdr38gkYR5hVh5BLVjS-c2Y0wA1XJgxWjrrFscc7rUsHqphRxLwgM4RFo8gDhPrNcwR8s-qlAAbYsld2BQahBeKJqOCiqZrjqO1yhT1dhTKdpvgUbXtbdfBbr2A3KtyvKxA8tkhFKFgto0r9cvrA8Jsu0uCHTm5H8lMMaihjBBSFgERVJJq9d9Yv1RxLNb5LVULHs+aICn8ICX90aezEChA5pNko1xaDhJaEh+wq4GQTZZB5hyg7C79w9laSCIDeCOAAE31Z1S93M30wBBb6p0ZlhSS1AdhurWQ2RbKxwZ5uQKSiCNrO97bmyy8PN3aNbtyzEJBo0QkLBig2Kzb+4swLwxl5BVrebV9iCbd3UNMPag0pUcNjhB0YKb5o5lQjAekt1+0FaWdm4nTNDIjxjijXy9DBbQxtE7AoQ7AIUbwbweECwFhMJPJpzqg86dKQYnSljnyu78KpDe6Yl+twyQRFhtZ-aCTwxHozFHJaT1AKxry4Trie746etPJ2QEQVBNpFJQQAM-RYRLwsM2QmIbBixLa5zW7GTlSWTL66aIcb79ir4pBzBpggsX7FIv1FBaRhcDNm6C8jonTkzES16bAT4ahNR7o3oBk5JgxbAg0OrGhorEy8jFygGQLr6KxIIwqyluJxTfi-o+YJwEoNKg0z6st7ksLKKnzALu6yje7jB-jDRJdcNq5QUACIU0xYkR6rzyGToBKhK1w47gGNE4QZhgxuQ8GzkPJQ4-hNJshKhrwSw6hhrDLVA16HoZakIsg0wySx41j76bwtFqhaz54nAgA */
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
      draftLine: {} as paper.Group,
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

              'Drag Segment Head': {
                target: 'SketchIdle',
                internal: true,
                actions: 'update for drag',
              },

              'Equip Line tool 2': {
                target: 'Line tool 2',
                actions: 'set up draft line',
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
            exit: 'hide draft line',
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
        const { truncatedAst, programMemoryOverride, variableDeclarationName } =
          sketchCanvasHelper.prepareTruncatedMemoryAndAst(
            sketchPathToNode || []
          )
        const { programMemory } = await executeAst({
          ast: truncatedAst,
          useFakeExecutor: true,
          engineCommandManager: engineCommandManager,
          defaultPlanes: kclManager.defaultPlanes,
          programMemoryOverride,
        })
        const sketchGroup = programMemory.root[variableDeclarationName]
          .value as Path[]
        const nodePathToPaperGroupMap: NodePathToPaperGroupMap = {}
        sketchGroup.forEach((segment) => {
          const yo = sketchCanvasHelper.drawStraightSegment({
            from: segment.from,
            to: segment.to,
            pathToNode: getNodePathFromSourceRange(
              kclManager.ast,
              segment.__geoMeta.sourceRange
            ),
          })
          nodePathToPaperGroupMap[JSON.stringify(yo.pathToNode)] = yo
        })
        Object.values(nodePathToPaperGroupMap).forEach(
          ({ group, pathToNode }) => {
            const head = (group.children as any).head as paper.Path
            const body = (group.children as any).body as paper.Path
            head.onMouseDrag = (event: paper.MouseEvent) => {
              const to: [number, number] = [event.point.x, -event.point.y]
              const fromPoint = body.segments[0].point
              sketchCanvasHelper.modelingSend({
                type: 'Drag Segment Head',
                data: {
                  pathToNode,
                  to,
                  from: [fromPoint.x, -fromPoint.y],
                },
              })
            }
          }
        )

        // TODO, less hack way of keeping this for later
        ;(window as any).nodePathToPaperGroupMap = nodePathToPaperGroupMap
      },
      'initialise draft line': assign({
        draftLine: ({ sketchPathToNode }) =>
          sketchCanvasHelper.addDraftLine(sketchPathToNode || []).group,
      }),
      'update for drag': async (
        { sketchPathToNode },
        { data: { pathToNode, to, from } }
      ) => {
        let modifiedAst = { ...kclManager.ast }
        const node = getNodeFromPath<CallExpression>(
          modifiedAst,
          pathToNode,
          'CallExpression'
        ).node
        const modded = changeSketchArguments(
          modifiedAst,
          kclManager.programMemory,
          [node.start, node.end],
          to,
          from
        )
        modifiedAst = modded.modifiedAst
        const { truncatedAst, programMemoryOverride, variableDeclarationName } =
          sketchCanvasHelper.prepareTruncatedMemoryAndAst(
            sketchPathToNode || []
          )
        const code = recast(modifiedAst)
        kclManager.setCode(code, false)
        const { programMemory } = await executeAst({
          ast: truncatedAst,
          useFakeExecutor: true,
          engineCommandManager: engineCommandManager,
          defaultPlanes: kclManager.defaultPlanes,
          programMemoryOverride,
        })
        const sketchGroup = programMemory.root[variableDeclarationName]
          .value as Path[]
        sketchGroup.forEach((segment) => {
          const segPathToNode = getNodePathFromSourceRange(
            kclManager.ast,
            segment.__geoMeta.sourceRange
          )
          const pathToNodeStr = JSON.stringify(segPathToNode)
          const nodePathToPaperGroupMap: NodePathToPaperGroupMap = (
            window as any
          ).nodePathToPaperGroupMap
          const { group } = nodePathToPaperGroupMap[pathToNodeStr]

          sketchCanvasHelper.updateStraightSegment({
            from: segment.from,
            to: segment.to,
            group: group,
          })
        })
      },
      'tear down paper sketch': () => {
        paper.project.clear()
      },
      'set up draft line': ({ draftLine }) => {
        const path = (draftLine.children as any).body as paper.Path
        const dot = (draftLine.children as any).dot as paper.Path
        const white = new paper.Color('white')
        path.strokeColor = white
        dot.fillColor = white
      },
      'hide draft line': ({ draftLine }) => {
        const path = (draftLine.children as any).body as paper.Path
        const dot = (draftLine.children as any).dot as paper.Path
        const transparent = new paper.Color('#FFFFFF00')
        path.strokeColor = transparent
        dot.fillColor = transparent
        const point = path.segments[0].point.clone()
        path.segments[1].point = point
        dot.position = point
      },
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

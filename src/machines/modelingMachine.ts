import {
  PathToNode,
  SketchGroup,
  VariableDeclaration,
  VariableDeclarator,
} from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { isReducedMotion } from 'lib/utils'
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
import {
  addStartProfileAt,
  extrudeSketch,
  startSketchOnDefault,
} from 'lang/modifyAst'
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
import {
  DefaultPlaneStr,
  clientSideScene,
  quaternionFromSketchGroup,
} from 'clientSideScene/clientSideScene'
import { isQuaternionVertical, setupSingleton } from 'clientSideScene/setup'
import { PerspectiveCamera } from 'three'

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
  | {
      type: 'Select default plane'
      data: { plane: DefaultPlaneStr; normal: [number, number, number] }
    }
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
  | { type: 'Add start point' }
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
  | { type: 'Equip Line tool 3' }
  | { type: 'Equip tangential arc to 2' }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz4CAZTDsABLCwwck5uWgYkEBY2EJ4IgQRpZWFpcQVLe1V7SwVbYUttPQRBRMtxZUtlGkt0wVVpBTMnF3QsPChxbAhMMC8ff0Dgrlww3iiOId54pIVxe2lVYSNLDUFlgv1VAxSDUWE0wQM0ww0mkFdW-A6unoAROAG-Fjx2EYixmMmhA2FJGlEFP7KJLCZQA4TrBLSRTiTaWAwGZQiNRWVSnc7udqdboEO4BbrBXyQGCvZiscbcT5FeGzf5Q2zKb5mNa6fQ0RKpIyI4RsyxWeZoloYq7Y3EPXwkPjYWAkyJkj5xITmcS7OxVCyib4HAwQo5lMSZRYNESOZxnQVtYU9bz4x6oZ4y94TBUISo-Y7VYrZZaGbUsl2ZMoA0Se1SCNlQgVuC1Yq1iolgB1yp2gKY0GagxFpBSM5mFBHKcT5hTSP5QkHKaSRi6Y669G3iyXS+ijJMU52I1SFqqrBY8mgGfJ+kEzaTWAfCOpJQ4m5pRy4xutBPwAMxIlET0WT-EQlRmBjsagOYcsYekEI1glScOke33h12CirQoXAFFcOwwAAnfwAax85AACw3clYhTfREgMcRvRLeRs3seQIRsUorAZP4dhvSxhCfaNazfD9v1gP92EAqhpHCUlNzbMCEGnZVi29OxVGLcE-TUGhCxyVYNC2P4LGw+da1FetV3XZs3lbUDtyKWxC1qBR1FWPZuIhU9xGME8ljUeSB34mtsWtJdxUwTBgPlaiK0vCxvn+NiaGEeyIUyAteQMVQM0zZIaFRU10RwkV7nrEhjNMrd4kUFIGVBdSvNkX1CmLSRMjsYoGgg+xdMtAgXz4dhPwAVwwEKqKk1K1JydJMlsYwpEQoEfnVNMbEMeYtgyzwiMA4gyEoTB2v-ICxIokDKXqQ5UgUUwbwffcWMKawUg1ap5g0EtMMrHzzUuPriIA8RtsAgBJWsDIJJ53yKyT4gNGZzEPeZ7Lcv4ISimEB0ZHJEkMbzZ2rPaOt2-aAKO-SxQCKAAFswHOwbZUoy7EGu5U3NDe6J0qUQVPKcQbE47IK2sEE2v+v7+uB24AsMs6Xhhx1iqutkfg0DUAUOUEFjihG6hhKwB1EUcdmDeEif6kmdrJnEKYJMHIeh8jYeG50kokP5li8nYkkyDmEAUGZmOvZZaTkYWdtFw7cIARzy7AmF8dwwF8dhUFQEyaYkylFEwqC+bSNQQXmVQVJyMorBUdJuR1mxjcA02gYtq2bfB1AADd7cd52LspSpPdc+SGgZLYxEERC7NKBoAWyf37H+KOAf+8XvD8PElyGDPFZLSCKzURFZHmawtD9DVO2sg36PUHSNrndpAZj8XkBIP9+ghqG-BTz9OHIILW+o0dgygrZPqQ8o1EQxJLzWlrlkyTWa5n2s54X6Xl98ADUE-bAAC9uHYTfXbhkbMIkIoQ42R9zyREMXNQ2M4QAjDLYFEygb6A3FkQbgsBcokDwM-V+H8v5BV8BAKU38KAJl-grbeJ4CxZzpAOao-ZZoI0MOxco9EpDJD9qIRBddawoNwGgz8GDcC+FXuvPBBC0HdRIXLWm8MEgVFKJ6HYmF+ylnoQgTIxg973jhG9CoHCJ6-Wnkg7hqD0GYIAIIACFPC+AABpbykvzH4AJERqFEHCdQJ5HJ83kdUMw5R6iVE2Jw0mxjeGmMEZY6xABNex8RHFdjSDUFmiIMZ+iYlIbGhw3LfHDOYPRP0hSGK4diHhfCBHinwN0WJCMvKXhVN8fMxR4QBzSeoBabJ1CbHKBYSwwSxahLKZg7o+B2ADSkW7RWbIJDBjcgcaowYvIKEcooSy8xZBMWMJsAwfSzYlJMfwzBTAvxHNwAQ8geVMAkG-GIoholxl-2dKONMHItiBPhA0NxjkxClC+nkTYhgcg7B2bHPZYSDmCJfm-T+74gqYB0EZbAUBhikLMg4ioPwjACx1ruDQiFslQQZHIn0AJ+zAuQfs8pwjsAb2MvCoKiLkX3LIWi1yMIe4LNkNmBYiERCQUeukDpFg3JYX0YU4mRjQWDMEbAXAJAbaO1sdU2RcJZhqBLG5YMtgjCIVEEqQFzMaBJFWvks0k8Y630leE-wsr5WoF8DElFoV9DVCcSCfeoYFh837oUeo-woHZAUosOBZKBlWrAJbPBwyoCjKVTvPlJ4-i1DsOYM8foIIpEapUEoexSWiotEUkJlrwW+CYFc2F1BHV0xqVUVIdheThx1g0VRPoJCs02CoKw6KRUFPzeK4pPRSlWs-GAROKdfDkApc8JsTLUVxJPCkVYgIDbuJBIhRY2xDgxRyB6g4IbsQACUwAAFowB8CCHlD8Sr1E-GsF5UMCyhWpLzPMKC1g5nt0TdsvNW0+2Fp6C+S21sHZkBgO+bAeCrnkAdk7F2M6nVFCNdjZINgqhNq2Esv0igJBqAoWHNMxYTjfqnr+-p2IAPx18AAGTwKnGDvhVBXvxsqMQd6VbWXPOyRIzjizyD5myPd-7APypA8vcDmBxSfigwqhjlaZFuVkGVIMZgxBlyfYgHWpR-jpDpFIVy2QBNZSE1Rmj0Hna+EEEqlQL6I7+N1ZsKwqiKgzE2BeAc8kmLWBvtR3A9sAAqMHDMUdHbR9OsnM5jyQxoDsnStjnjZMqIwsCNT2UUI+Ij5rvN+YC4ek9Z7zmXrC86dSpRFiGkSKCCcqafWVDUv2So-YLB7BLAg9L09Mu+H887cQAAFO075fBmIgBgCABBBsQBLX16mcGq0ul5OxA4BotgqBVqo9G40sjLAHAcXNPaf0i3a51zAe0wBL362NyAo2hsTftIV6iyHdZBlhLo+YKlQySHkIlo+LHemteJgdmDx3Tt+HOyNlB4MmDdA-LbGjSqpAVlSB6oEoY7IYcKKsZy9h3Pe3hNULzJnDuA5lsDobF3yNAaIaBzgEHJOmdgy2B5d2YIwmsNmcoGhoG1TqRNfsCI8l6a-bt4j+38cA+8EDgbJORtk5tnbWnsOoQFjZIa3kxYSx5FUaGH4lX-huOcbIdKv3hc+Y6wDg6uAOAECVThy8hr9weKYn8OyEJuSaYaJhFhORC54+NwTs3FvSLTZka4m3vOmYpaqzueQ2N+zaLDOHdQ3ustdYAHJ2t61Oy742qZW4RJeHWE5uRhkBGpl0YZUiLG9NYXYsEb5oDHYd3ojcHgt1u1JYEWvbrpHhPuYwEJ4SK4qAsG8ncVBpcF+auvSfMAEBy6e89BXA+ZwWcxz1GmnNFz9EYCQB9bdbBsrX5OU-AtAdl2nOn4kGdSXsvYQsFgOzyGyCX-vsxB8WC1EiH74-p6T5N87Y-wn8BRNqcpMYNYdDV0wc4rNrAmI+8EQX9kRQx4QP8D968Acf88B-dW8phlNlQKx4Jks9MIR3Fb9dURAnI3E+JDcTYf8Cd0Dzd2BLcyJ6dmUphjAF1RxZB0g0hJxi5WVUMSw4FjggQUCp9xA6D-dVBF92wGROx0hlgVkchlMT4gQoJsxe5gxahEgb4zEAB3DBPwSFHBGFcTG5CRXwPAZcVAAgCAbgMADoXAJOVAP8cQGAdgI9Qw6Fb+TAI9Cw1AK9PGVIKEe9fccoXPRyAJZneyeofsAFeybQvQjgLBKFXBEwwhMw3wggL8T8V+cQCHEgdgSwz8cGFwnwdw7BTwoKHw3ASw-wiaQMeYHsdVDUEvScDuJQBzYVUceI-QoRL8ERVI8RYhcw6oqwmwnzewxw5w1wo9KlGlKomorAhGaoTsbkBkRQD1eoRycAtSQ+OBRYfjKg6OXQno2Y0RNIoYjIrInIvIgo1+Yo6Y047w3w-wk8bGcwJSQ1NMTpLY-sBJKwcwIMJqboxIyJWxYYyw6w2wiYpwuw6YkgAAI1gCPT4HmL8MWLUXmWxiYiUHDAmh2C8U2EkCUB7lqG5EWGBOBysTBMuM-GyM-FyMuVuKKJKLcIRKRJROePRM7QkBJT5kSHslYUck3VrQVzcW9GrkON2mOJBKpKiXBNGKhLwEmNhNKLZKPR0FRJeMgnMAWCUDcURALkcmJIJUMCSGUyigpIG1lPlMyNpOuMZMKPuNVMRPVM1K5MxPRwZGSGKDki1hRBmGSE1y9UUGTUtJA26BtLGLsKVJhJZKPXDOPU5KkOom5MLEUSMHmHKEUGWS5mMAUXAP+LDMqXthpLpIZPyMdLjITLdOTKkk7VKEd0wjyAmhyB1kciYhSHslcm+ESAcwF1NQMWJmlL8CjVGUjMVIcNjOmNHIAhrOYNnSWM9jFKFSyHqGyEciBBK2UX9j9gsktJnJtKuPpJuMrOnKhmjVnKTPnPg07Q7nQjgnkCSE8TSTWzVwCQOHkjsktKOU-BOTOQuSuXwXOMoHHPGJjKmNKJ-L-OpQAs-CPVMOITnIvxYKWMRDUiHzRkBTei+TSECIrFeWsEwgZG-OOShn-MuWuWApLJGNtLLJPLuLjKgrIpgoovgqoqQqGgXIxLQtJJvDciwrhC+Xh2LHwpKFHDdUT1p3o0b36BtBb1rKumWB+XUERDxgoPMCILchpAjivknG+gHLFSNxC3E1UH-2A0ALA2AOg3oyvTAR2LsjfwBCUC1j2HTHkEYiqFGkoK-2JgpyAPE0g2stMoblkublCC5L4zUikCi01FBG+CIIU0WiIr2GNEJklPED8ssoCpp2kzMvazPxsq5KUHTAmhDLTF2Dcm9UQD03L0wgOD8VJP7N8j2xNnyro0EBkqbkGHCoUp3HDELGSwNAqDZjxRVWTS9UQJTUkoKsvD9wYKt19TKD5n3BvE-PV0QlZmZ2WG5Ga0+M-wMt7SMqktmvoMYN6pdBR0kHVjZyQJ1i1hxkgh1hEE20NVsAmmmvavEFwDuKCk6ubx6uvJmyBF1WVBLGUWATDFR30BCKggsHsHVzTAnH0uaqFx2l8G+t8BEljHrAwFXAuUeEuR81jTchKzWlSjxjWOehvCghLChEOEDO3RnAOpaujjarM0vFT18HT3fFgEz38G-jXmu1lkBqDwRE7ArDYXcoPB1QaFkhEG0jBosHWh8pFjmst3RMMGqFelWAYn7GZiILgM5TyXKCUQjHSrVoDxFpGmDALBx1HGLBUvvGLgsDKHquU2smKHWlNG+owHgAiBRqtqKxrVYRJJWVcSqoQCPVhFBu5FDC1BxxNRRstEDvMlZSkC70WmWpUA3x9SPCxIFRZxEvkBrhTocR7O1vmTBp2EOAhCPXqE7DqB2tDhSyqETs2lRujglTAFLvpnklVWKF4n+EYk0s7BsmcU2AaBREksOx7p3E+iuqigctBE+SHD5W51COiuLHHhVtapFy6xuFsNnoQH2ILHTt104gzGejL3biWn3GDCa2noB25uJ2GyPrMBBrmRbINC8ivoXQr11zFJsGLvSv+y6zFyJwl1fuQq4u9ILGZl9nvThAju7iit5kfyWg0Mfq6zmrfrXIXpxMwpXsKC7gJTmFYWzA+SwaO05ufr9s4vgw1iYTTCQLTDNIj1Lz-t5g4Or0UBEN-0wDfs2C13AI-x1jTHPDqN1Q0DEB4i+n2qTu-0P34bEKUYwPYDfp9N+CihBGyCcqIKUGj0RBEHMEamVuZo7t2hoLQKUZ0I4BfgvV8GHVy3n27ugYYd50kEHnLhWjck0vYnUBWlWBUD02RvbonyUdoJsbscJDywvVcfoaBqMB+HAPpAWGmHirTXsEglH3mFbsyDkT4YJ05uCzfs2qsEbK1V5BzvAg0TVRQnWPVFCbNWnmHKSKMK8KAsGJAt8KPrSd1j+BZjEF1TEHCMWDojFK7MjnStaceM6duWossN6cWBWIns7g6X+C2PZHzkBXlqUrH3MfNVadBJsXlKWd3k3IAQajbLSXHCvCcyqFYc90tNBLlJ6bcZm09U7DSAL20RZxaPklKHeQWBJvug1CLKgAjLeYSbkzEBvWgT5nbWSARHbN3i2Wv25DsAnDbuaaHISJHPPLHKhfli4s9XYl1SyA-K5AOA3Pi1DAZHkjEHqAmm7QOZabxZLVItORYsAoQu6ZGKWY0UMHkAWxoVWKEsgl+RBALIWA+rM1UF6ZPEBZUuxRDOCb7zqNVg1jME4P03Ssyqp2ypAPo16efyzqBBwz8T7xBoqHhAvkUIlJ3tZpMxmqPtWABFqzVFK1vChoSHNeDk1iVrjxvFlfExOo4DfsWQ9frW+G9Z1UNWVAvCRbcXMF3RAedc+u+qKKCjfsDNq2cswhPHsh9ZbUkCGacv3iUCZoUb+3TfZvEBocmzoeJYYasm5g+nEroWqYSBsjltvAejDDUBrnRrtSxqPugWVBEDZCOCUVcmej+DUjxiqH3hihvhwfeZkSAfYmyHw2HFcSIJvxmWKAsAmiSDcScCcCAA */
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
      sketchNormalBackUp: null as null | [number, number, number],
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
              actions: ['set sketch metadata'],
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
              'Equip Line tool 3': 'Line tool 3',
            },

            entry: ['equip select'],
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

          'Line tool 3': {
            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

            on: {
              'Set selection': {
                target: 'Line tool 3',
                description: `This is just here to stop one of the higher level "Set selections" firing when we are just trying to set the IDE code without triggering a full engine-execute`,
                internal: true,
              },
            },

            states: {
              Init: {
                always: [
                  {
                    target: 'normal',
                    cond: 'is editing existing sketch',
                    actions: 'set up draft line 2',
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
              'Line tool 3',
            ],
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
        ],

        entry: [
          'setup client side sketch segments',
          'setup client side sketch camera',
        ],
      },

      'Sketch no face': {
        entry: 'show default planes',

        exit: 'hide default planes',
        on: {
          'Select default plane': {
            target: 'Sketch.SketchIdle',
            actions: [
              'reset sketch metadata',
              'AST startSketchOn default plane',
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
      // 'is editing existing sketch': ({ sketchPathToNode }) =>
      //   !!sketchPathToNode,
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
        return hasStartProfileAt
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
    // end guards
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
      'hide default planes': () => setupSingleton.removeDefaultPlanes(),
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
      'Make selection horizontal': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Make selection vertical': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain horizontally align': ({
        selectionRanges,
        sketchPathToNode,
      }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain vertically align': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to X': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to Y': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain equal length': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain parallel': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain remove constraints': ({
        selectionRanges,
        sketchPathToNode,
      }) => {
        const { modifiedAst } = applyRemoveConstrainingValues({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
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
      // 'set default plane id': assign({
      //   sketchPlaneId: (_, { data }) => data.planeId,
      // }),
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
        // sketchCanvasHelper.setupPaperSketch(sketchPathToNode || [])
      },
      'setup client side sketch camera': ({
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const variableDeclarationName =
          getNodeFromPath<VariableDeclaration>(
            kclManager.ast,
            sketchPathToNode || [],
            'VariableDeclaration'
          )?.node?.declarations?.[0]?.id?.name || ''
        const sketchQuaternion = kclManager.programMemory.root[
          variableDeclarationName
        ] as SketchGroup

        const zAxis = sketchQuaternion?.zAxis || sketchNormalBackUp

        const dummyCam = new PerspectiveCamera()
        dummyCam.up.set(0, 0, 1)
        dummyCam.position.set(
          ...(sketchQuaternion?.zAxis || sketchNormalBackUp)
        )
        dummyCam.lookAt(0, 0, 0)
        dummyCam.updateMatrix()
        const quaternion = dummyCam.quaternion.clone()

        const isVert = isQuaternionVertical(quaternion)

        // because vertical quaternions are a gimbal lock, for the orbit controls
        // it's best to set them explicitly to the vertical position with a known good camera up
        if (isVert && zAxis[2] < 0) {
          quaternion.set(0, 1, 0, 0)
        } else if (isVert) {
          quaternion.set(0, 0, 0, 1)
        }

        setupSingleton.tweenCameraToQuaternion(quaternion)
      },
      'setup client side sketch segments': ({ sketchPathToNode }, { type }) => {
        if (type !== 'Select default plane') {
          clientSideScene.setupSketch({
            sketchPathToNode: sketchPathToNode || [],
          })
        } else {
          setupSingleton.modelingSend('Equip Line tool 3')
        }
      },
      'initialise draft line': ({ sketchPathToNode }) => {},
      // sketchCanvasHelper.addDraftLine(sketchPathToNode || []),
      'initialise draft arc': ({ sketchPathToNode }) => {},
      // sketchCanvasHelper.addDraftArc(sketchPathToNode || []),
      // 'tear down paper sketch': () => {
      //   paper.project.clear()
      // },
      'animate after sketch': () => {
        clientSideScene.animateAfterSketch()
      },
      'tear down client sketch': () => {
        clientSideScene.tearDownSketch()
      },
      'set up draft line': ({ sketchPathToNode }) => {},
      'set up draft line 2': ({ sketchPathToNode }) => {
        clientSideScene.setUpDraftLine(sketchPathToNode || [])
      },
      'set up draft line without teardown': ({ sketchPathToNode }) =>
        clientSideScene.setupSketch({
          sketchPathToNode: sketchPathToNode || [],
          draftSegment: 'line',
        }),
      'set up draft arc': ({ sketchPathToNode }) => {},
      'hide draft line': () => {},
      'clear paper project': () => {},
      'show default planes': () => {
        setupSingleton.showDefaultPlanes()
        clientSideScene.setupDefaultPlaneHover()
      },
      'AST startSketchOn default plane': assign(
        (_, { data: { plane, normal } }) => {
          const { modifiedAst, pathToNode } = startSketchOnDefault(
            kclManager.ast,
            plane
          )
          kclManager.updateAst(modifiedAst, false)
          return {
            sketchPathToNode: pathToNode,
            sketchNormalBackUp: normal,
          }
        }
      ),
      'setup noPoints onClick listener': ({ sketchPathToNode }) => {
        clientSideScene.createIntersectionPlane()
        setTimeout(() => {
          // TODO this time out is needed because 'kclManager.updateAst(modifiedAst, false)' in 'AST startSketchOn default plane'
          // is async and we need time for the ast to have updated.
          // it's very annoying that you can't have async actions in xstate and have to invoke things and have all this extra
          // cruft in the diagram just to handle the occasional wait
          const varDec = getNodeFromPath<VariableDeclarator>(
            kclManager.ast,
            sketchPathToNode || [],
            'VariableDeclarator'
          ).node
          const sketchGroup = kclManager.programMemory.root[
            varDec.id.name
          ] as SketchGroup
          const quaternion = quaternionFromSketchGroup(sketchGroup)
          clientSideScene.intersectionPlane &&
            clientSideScene.intersectionPlane.setRotationFromQuaternion(
              quaternion
            )

          setupSingleton.setCallbacks({
            onClick: async ({ intersection2d }) => {
              if (!intersection2d || !sketchPathToNode) return
              const { modifiedAst } = addStartProfileAt(
                kclManager.ast,
                sketchPathToNode,
                [intersection2d.x, intersection2d.y]
              )
              await kclManager.updateAst(modifiedAst, false)
              clientSideScene.removeIntersectionPlane()
              setupSingleton.modelingSend('Add start point')
            },
          })
        }, 200)
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
  // const firstArg = sketchCallExpression.arguments[0]
  let planeId = ''
  // if (firstArg.type === 'Literal' && firstArg.value) {
  // const planeStrCleaned = firstArg.value
  //   .toString()
  //   .toLowerCase()
  //   .replace('-', '')
  // if (
  //   planeStrCleaned === 'xy' ||
  //   planeStrCleaned === 'xz' ||
  //   planeStrCleaned === 'yz'
  // ) {
  //   planeId = kclManager.getPlaneId(planeStrCleaned)
  // }
  // }

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
    sketchPlaneId: planeId,
  }
}

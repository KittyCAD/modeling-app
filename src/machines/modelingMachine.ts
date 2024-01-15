import { PathToNode } from 'lang/wasm'
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
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz4CAZTDsABLCwwck5uWgYkEBY2EJ4IgQRpZWFpcQVLe1V7SwVbYUttPQRBRMtxZUtlGkt0wVVpBTMnF3QsPChxbAhMMC8ff0Dgrlww3iiOId54pIVxe2lVYSNLDUFlgv1VAxSDUWE0wQM0ww0mkFdW-A6unoAROAG-Fjx2EYixmMmhA2FJGlEFP7KJLCZQA4TrBLSRTiTaWAwGZQiNRWVSnc7udqdboEO4BbrBXyQGCvZiscbcT5FeGzf5Q2zKb5mNa6fQ0RKpIyI4RsyxWeZoloYq7Y3EPXwkPjYWAkyJkj5xITmcS7OxVCyib4HAwQo5lMSZRYNESOZxnQVtYU9bz4x6oZ4y94TBUISo-Y7VYrZZaGbUsl2ZMoA0Se1SCNlQgVuC1Yq1iolgB1yp2gKY0GagxFpBSM5mFBHKcT5hTSP5QkHKaSRi6Y669G3iyXS+ijJMU52I1SFqqrBY8mgGfJ+kEzaTWAfCOpJQ4m5pRy4xutBPwAMxIlET0WT-EQlRmBjsagOYcsYekEI1glScOke33h12CirQoXAFFcOwwAAnfwAax85AACw3clYhTfREgMcRvRLeRs3seQIRsUorAZP4dhvSxhCfaNazfD9v1gP92EAqhpHCUlNzbMCEGnZVi29OxVGLcE-TUGhCxyVYNC2P4LGw+da1FetV3XZs3lbUDtyKWxC1qBR1FWPZuIhU9xGME8ljUeSB34mtsWtJdxUwTBgPlaiK0vCxvn+NiaGEeyIUyAteQMVQM0zZIaFRU10RwkV7nrEhjNMrd4kUFIGVBdSvNkX1CmLSRMjsYoGgg+xdMtAgXz4dhPwAVwwEKqKk1K1JydJMlsYwpEQoEfnVNMbEMeYtgyzwiMA4gyEoTB2v-ICxIokDKRsSpZjUbkNBoSp5lECEKkvXYpGSBYoUw0Q2o6gDxD64iAIASVrAyCSed8isk+J6mqKCbHMKQSyMFjClBdipvqVYGlEEtlE2-qdq2w79LFAIoAAWzAM7BtlSiLv0NJSmsUQ7uKfskRUhlC3KTY0nszI4V+vb-v6wHbgCwzTpeKHHWKy6FEWKCK1GqaLEc+plUYzYUf7f5Hx881Ll2wCib2kmcTJgkQfByHyOh4bnXqUEYWDUcdisawnsQbMYWzcoS2sEtloJoXBYO3CAEc8uwJhfHcMBfHYVBUBMqmJMpYxjHEQwpAUJQqmSBEVIaK9slpBEbDyI3tpN0WXwtq3fFB1AADc7Ydp3zrd4t2L948oSqCodRk0xeSRvJYO82dq2F42AaOvo8SXIYM-lioJH3JHjB9Q44sQDV2PmOn+xPBYvsrPm53aE3q9N7FkBIP9+jBiG-BTz9OHIILm+o+ob09kFHtDUEfbmv1ZArMo6m+fc6eKLDx6rqfo9rOeF8l5ffAA1BP2wAAvbh2E3i7GGI1RDZEkACHs8IDhWA1gkLIhYdjyDqEoW8G175CkfrXbERBuCwFyiQPAH8v6-3-kFXwEApQAIoAmIBctt6ly7JzcOUg2SszEFBe8blIooN5pXDBW1p6ixwbgPBn4CG4F8KvdeZCKF4O6jQmW1NYYJFAexZIxRgyLAgj3BAmQRBlGMLuf4Vgfa8LNBPaegjazCNEeI3wABBAAQp4XwAANLeUl6j9igssJQhx-bBgUI5L6kEciqkqMUAcOxI5WOwbg-BhCnEuIAJoeNpt4gEbkGiIn3IoVQjlB6yRyLsLYQJonoItJg4m1j4liMIWQKA3Q0lwwRAzCs3Jyh03bo5WEnsvoAhsK5CcM5zEPwEU-OJIiEkSO6PgdgA1FGu3lnTGYvIy4G1hMGRyih2KHE2BWTCdkDAxImT0Gx0zfBMC-Fc3AFDyB5UwCQb8siqGiUWcA+WKpZh5E5LUCwh5HJiEgkYYodRgxsi+icrBZzal2M-t-P+74gqYB0EZbAUBhi0LMp4-4oSwzqCYnCbGsD5hAjKEzeSAIqjlChdUyZtjCFSOwBvYyqKgrosxe8uhniIFlGmvCWwqsxCIWNMqM+KIRDJGzLSkWNSpl1IkbAXAJBrYOzcc0hISgJChnsnCCc1g7BBNPkjdiKhzDej2BEsxvkBbjOhcQWFhClUqvtqgXwqSsWhThh7aaWcJzlW+IOQo9RdiFiqosBk1R8YVNtX9U5Dr5V2LABbMhsyoDzI1TvCQoIr53S2DeLQp9piSGSCefsVQSzpRjZPO1dKYWJsIUwJ5yLqCeppnDbkPigSjkSGoUBiF4RuhBKAhYHZVjHOrZY+N5yFW+E-GAROKdfDkEde+JsXLsWXSRp2S1blFAiB5Ea4NurPaKHslULpt0ZWAVFgAJTAAAWjAHwIIeUPyZuKZ7ewX0kaXvMBCHiZQthZjqBpUB16Z49FjpbVVDTl7YDIU88grr05tuUbUXkakynfCyJhb4gcCzwxyMWMOuxo18MqbW2V2JoPxwADJ4FTo7TAvhVAaqsuxQ5-syx2TPH6UehZ6hiHMGYA8IybU1rjfa2jsH8DwcQ5+ZDaq2NocpBYCc4CbyHGLLUREhb4o5BhHkEETF4S8h+pOqeDHcB2wACrMaynHa2i6mOoY3V6l0sgJAHpPOYbSiwAPXVDPu+8Pt5AxOs3Zhz96n0vvue+1TzoDhjTI8wrIN58mnw9kjAcVhNE5AnBOijsbCaRd8PZp24gAAKdp3wOIgBgCABB7ENcubVym7n20ug1CkeyfW2RpDMPpncdk1Lcl5KYzYw4LPFck6Vxj5XmM7TAEvOrLXGvNdaxTDV5R9w0mRAbNkfwVJ1FmNNQwmw-jZmSBFhbFXMDLdW34dbkAHWgyYN0D8NtGMaqlZeNkiDKV5A0LAnsakVh-ZVhZW7NnFuVe8E9+rG2ZP2zg++BDLGkMoedp15R5QyWgmWjUewRhaopAWLq+ycExD1Bh1F+HK2pbPYa69lHttsc7eWPVLI2ZswIhBNszs1RQw2G7LkBYdO4cPf2rgDgBAdtQgLKGTCoGlAMlgZNIzw5wVjmqHfWbliyv3fEDLuXpFceUkZkrvY2Ms65AhIiNRSNyggnehqCokvjcADk3U1eeLATbEA2v2kS+ZQnNIchAhEKUzLz0mJqXUNyGCaYmJ2RiWgJd93eh+AboMUIoepKIjhMqQNn1Jy1AA1sSQCJ-j9mHVYdPyd6eYAIDF59r6EsW-bDThm7cYGgiRgBlQgnDDyFLldiuoz+F-Qz83xzMHvuw7TjjlsHzqJSDJcxFyikpuV96zX5ITIETWEb5nhzKOqEwHRwppTzGds+1KFfOSbkBWwPhPvswh-QHH7Hgbqes+pdxAAC8AzcC8phIkoIVAJxjESw3J5o9sL19kUo0wERT9m8gCm9fAQD2B5cyJV9uUpg6gd0WooRe19wg1WQ8hq9swDhFc4Q6Y0DADgDZccCqBVAu9zIwwCwYJQwuEmIT5g1EhOwpxvgfZ1c0wZsp9KM-p7EAB3AhPweFEhJFFjF5eRLA3AZcVAAgCAbgMADoXAJOVAP8cQGAdgB9JQxFABTAB9PALQ9jbSM7RBH0ewW8VmBKDUfcMwUaZYcjKQkrIWOQhQohBFUhVQyhdQuw7Qr8T8L+cQD7EgdgLQz8UGUwnwCw4hKwoKWwzQ1ABwzYMNMwJBXNRIVmREKCb2PdS1I0GJIIjgSRL8aRcIuRahDQrQnQvQgwowkwswh9JlFlHI+wsAxAJieQQsbIKECwArDQRyaaH4HmMwLYRQHGWo+Q+o-omRCI1oqIggGIuIhIpIr+VI3ojYmwqIhw4fLURqKoVyOoWBJKAsK7bSVYGaG8VY4IpJNxNo7Q3QmzLo4w-Q3okgAAI1gAfT4EGLyOGN0SUBmD+V0xsHHT40KAJUeKkARGmn3X138Lm0CLWOe2cS+J2L2M-HiMeUOJSLSPMJBLBIhPOOhNGNWQqANE8l5AoN0R2BmHUBDVHmmnMHePqM+OSW+I6L+LwG6MBPSJpIfR0EhIuIkDHD+Bsi5z2AKSsHJTBWmGKTQT-wETqIJJSRFJJLJMSOSOOKlNBJlLlIZNhPAVATyHqFVgQj9BRB+GyCYmzBHj9gFL8AaW6BFN+P0PFIBKpIfT9MfXpI4KkkZI5ESBpwgTkm2TZiNDumagdJ9PFHwH9OJM-FiNJIOLNNDPDOtKjPiCYjGn2SSAPFmhUB6VAVmE2FAQmiGQzLTXmQDM6ODJ6PSLbIAhLPwM3RGL8R8W5PIOmGG10TKSgg1FdwOAh0kIk0sX1JtghnTQAiNNzP2PJMLN6N7P7PEjX2jK1QQX7CpVMWWkckqALDEBpxUGLHKEsAzKuU-BuTuQeSeXIS2MoA7LFMMJDN6OfNfOZXfM-AfTUOoX3KGkHN0RskkEdPV0dwDhdKUm1kjXLQnAHyfOuQhjfMeWeS-LthzLzJNIpPNPMMApwuArwrAoIsgtlmgvUCDilQREZDDCQpRKkGQgaAHHQqyR1JxMNwW2X1Y2z36BtCbhtIDFqG7FWHghZj9F5F63KBUDkBBGgRiUv3k0x0U1dREu8BzweAktLJGPsiUvMEUFsFMWRMQHSGQivL8XoKsCKwEpNl8FwDdREljHrAwFXAeUeEeRs0zTclKGMwVlHGyVJ1Yl3gNShH8QHnMo0rR04Bv10tUHn3oyEuY1Y3Yx2Efx5g0CEOsGzAA3UDUjDDryUi2GqEl2ErSovySox3FB0uUxytaQ6QBxyVDGmghD2DdNcNBV40WDvlNHcowHgAiAkwHI82PEkBkDkH3T7QnIfVHCVyBEqCjVpERHE35j0jACmq6wZB3Vkp2AHBCRUEEBFSME9isDsCKvvPC0sy2n2uUUMEw2ml7CmhmnUAhGWu8Q0G7VBEGVciMAgxJmepGl5EsiuKhHkHHQEJsoDAp1hvCnMoXJ2sEth3u3BqS3dOVD2F0z2C8i2SHEWnsnbmpRV3sk9yWxuD0OxvXzqmVCQTZI9P7VYlKuEwnF4jr2C2psqz9zWxZwgHpsL2A2r3kAnEu3aQd3j3khVHhlqFkCpser+iNyWwRyZyR0gBFqmC5w4R7TZIlvZK0lSETzTA9DqBvGxMXKszuyW1N3YB1pGzDDxqUDckJoUhluEJLGyW8N8UfJVvm0xqWx918AFvYHGqgo8xyW2BilvI9B0RNrlqT3sBTzBEYKxoPIIJ3AenGLdswhMy8nPCUBhCZH1Rih2GtvRv-0wON2YI4Cds8xBDzow3sjYljxsoBEkA0B1jVwNm2osRrrP0qwANkI4E-jfTnUfXb3iz2qzugqBB9hL2WBVBgXqHmhsGVCZEdyZEPgzqW1HvHsJDizfTnqjoOsWNLtV2PAmMQnglSEdO5DTG9gDt1Jn1rpDrdRc0bqSAWEDDYmMFcg0RJUVyvHqEPgLrqAHrGRkPxJCOUOsM-JaO-KiMbuV2zjZHKpBRvBvDYWtzphfw0GqDRsHr1LgdOKQdeUItyLQYiWVD0SREWFVnht0XDEgKmnr3UArAzM+NcW+NofZARCgIHiyQ7o5JPHBzsErTBRIx4cJOFNQfno8zcnZDTAK2MHduLBYaYlKqhGI0MDmOSH4ptrIeCPDP4aUa6xUYkFHBJ3uiOH7DrNemMD+GvHkEaEDrxOCN7IsfPuURUZSDhGWI7mWFBG2TAXF1ijpiQmcpMdgeCIotuSoo-PApQZocsf8eMDhMNDDFqA3wZEBXKJBTTEiRwdfpcoETK1qrQdr1NsQOUrUHZNoiBAvRvGyQ908e2k0uv20tv1YzQe5D6uyEUAzF5zf1DQrC+grGLCcknzib2jco8rXDPvoo83oKZqTyOEOVcgdz+DUmyHWvzRiicCcCAA */
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
      'set up draft line': ({ sketchPathToNode }) => {
        const path = (sketchCanvasHelper.draftLine.children as any)
          .body as paper.Path
        const dot = (sketchCanvasHelper.draftLine.children as any)
          .dot as paper.Path
        const white = new paper.Color('white')
        path.strokeColor = white
        dot.fillColor = white
        sketchCanvasHelper.updateDraftLine(
          new paper.Point(0, 0),
          sketchPathToNode || [],
          true
        )
      },
      'set up draft arc': ({ sketchPathToNode }) => {
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
        sketchCanvasHelper.updateDraftArc(
          new paper.Point(0, 0),
          sketchPathToNode || [],
          true
        )
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

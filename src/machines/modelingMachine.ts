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
import { absDistanceInfo } from 'components/Toolbar/SetAbsDistance'

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
  | { type: 'Constrain length' }
  | { type: 'Constrain equal length' }
  | { type: 'Constrain parallel' }
  | { type: 'Constrain remove constraints' }
  | { type: 'extrude intent' }
  | { type: 'Re-execute' }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz5x2CJjAEAymDsAASwWGDknNy0DEggLGyRPLECCMrCCuL20qrCRpYagvnaegjZBtLiBqLploIGCtZVyk4u6Fh4UJ7evgAicGERQSx47NG88RxcSaApdcKSNKIKi8ppwsrLwsX60oriqgaWBgbKImpWqi0gru0eXj4EfaE+g5AwY7ETibyzx5lLu1sygM61ERV0+ho0mU4gURlOwihlis2SuN3cnXuvX6L2CJD42FgH2YrEm3B+QnM4mqdhoyPUILqBm2CAaFTS5houQUCMczmubQxXQeAVxQ1QI2JcVJ32SiGUXPEhjBtWklgaokMzIhqVUNHEG0WgjVqkEUN2aMFHWFvlF4WCbzAUq+UwpqRoGQ2pwacPW4JKJxhgYU0kWu3Wymklrc1qx-gGeIJRPo4xlrrlqUEqkqdMKOSRNEOLPWGTVhkswlU0O5fNaMbu3XjYoAZiRKM60+SMwqMgY7Go6mbalCWaIjLCjtJ0n36tUFNHbpjGwBRXDsMAAJxCAGtAuQABYdhLpmY7SPiSzAyOXwGFUQs01BtXVEEV9VSZr89Gxldrzc7vdD2kGISWPLtTwQepBGpEN8lDGhVBDLYdTUfVZzvYFQ3MS4vytBsHieBMglbdsU0+Ttpn4Sk0KzBR1EKdING1EozQqYxajyNQ6MOBchTjO1BhITBMCPMlKJSSNoIsEEllQrlhGQko9RhZEDFUL1vWEUMcLrRcbUeHF7SCISRLI0CxLdRR2ROJQwQQ2RmMQENJD1OxjR5aE+1rAV6yXB4wD4dgNwAVwwIIRjANdRNlCDlGRJU6kfapK0vdYWSnBQJEsfJMtODYrM-XS+MbAKgtCsBwr-KLgNTMDxPlawJ0DKtXNkLl0o2NjNULPMPQ2HSfL0vxd3YA9iDIShMGGwDopPKjSg0fUaDURFFoVbJ7x1S9oOSmQcl2CtRF461ptG-dxFOg8AElGwE4JhiiszpTqt1pAaSwLxscwpFDIxFPlZZqXWpR1TMUNCsGoVLvO6GbpFIjQigABbSLRiel1wPmt7ss+0RvuNHq0p1FQDEqOKDgaBS9SOY6PGhi6RuuxtCLFB60ZA56LIzN7cgvSMbDMBULAfN7qTsaSCcLJZ51w3yGcA+Wzrh7FniMxGUcejmMfq0oeQyei1SqKxrH+1lScQk5rDpNqpGEWnOnp2GVwAR2C7AmCCdhUFQUytYoyyuTY6dtMLTzBFHPslUQuL4KWZao1lobGZh5PlYIZdXfdoIkdQAA3CqvZ92bMdmD02Ok9RlsjKQWQrGFVnKdZ7BsnJ7cVg92-3NOAmCVWIimYudbVMwczx4wtXqRyEDHfVsgURFDizMRZDbx3U8bZASF3EIwGR1GgnzjdOHIITB9epClXWP7HwUW-NpKWRzzUQxcg9H67cTqHk87tPN+39X977lQBubAAAvbg7BT7o39tzMEGR0j2FUkYNSFZ0qIMqFUeQVYlDTiOp-E638nYPCINwWAQUSB4CCEAkB4C1xCSCBAQkkCKBOmgS9WB1RJDWA8ukJkWZ0r5HmNldSYI7IehlkVAhCsiG+BIbgMhG4KG4APpuY+9DGFkImqwv27CII2EsPqREpolCKHVIhdK89oKYUMJGD06kE6SLpoQ9exDSHkMoQAQQAEJ+CCAADTPtzZYpN1RAmOMsZuD4PwTmMMIWouRLyWFXs4wCac5EKKUUEbxviACagS9HBOpI0S8BxVhuQfOEjBOQhx3jVMk6RLjZFuMUZQsgUAfD5KxnCFS8g6j2AOPSSwD4PQSDVApMQIy8ZSHqWdH+jZ0nuOUT4fA7BDxsK5gU9In0tI9hDFyS8It1RizyOYOc2QIbficQ01J8zmmZKYJuB5uBGHkGCpgEgW4NHMNIjojZWMaSZA2DyauhZlqm1NJeSo3I8byQHDMjuMjiB3ModQsBECTI6GMjgKAuBOkpBsHCWEZp1CISOBTU25z64CyWIhOwiT4Upxua4+RiyVFH2wCfYSmKhLYBxXi-QywrHLWOLYI2Yh0oiB2o-C4IgtJwgZXM5lGTKFgFdvQ5ZUBVn8t1jYA0voxXlCnFoHU1Z4FaWHH2K29gFWIoWS05RTAPkmWoOsmKXTEQXkvNeaEagwTpWOPMI1YIcinAhQYG1jSkUsvtUEDcYAc75yCOQZFa5ky-LdfivG2Z0hqG9CIJECh0oKQ+rseeiJ3zlDxhGplvgABKYAAC0AVwjBXXNqt6eMlT2E1HjeelbVAsnKPqTCPoqwcTBAqgAMngCqAAVb2mB06Zw9gmguC7tXyFvpIGlCkxkhmBKOJQXaF7GmLXjC5eEHbf2nbgOdC6CD1qbXwFtbbXVzVLgqMme6lgTKnnEzIBjfSU0OCcBxkMpGzJvXen24gAAKEo1xZIgBgCABAPHIfFJKN9JchDCvEKY9IUg1K5uNSUREFQbFQkyn6Mt3lLlXoVlBoI86YMBD3oh9DKG0MYbZhuxCFRDiZS8maQs9QWQDgNAcdSIJyghmklOmdzGF0XV3hrYInHIBIqRkwHw64gjuG0bVP5sxgQSHnosUQKgag5HE1ujtqwbDLSsHFBTt6lOsdU-vDTqGM5uw9regA7p7dd2GdZZlsPsN6k8EJHCOCydySpsrVzkJTC9ct6ZMZY5gcQV1cAcAINq+xH0jQKU1Lkaug77CZHqGITUSE7DhvwVcyDimss5by+wArNVyK6PmhC4ryIzSFCUCCUjiBKyk0KFyeeVhFiLEa44hjLW3NtYAHKoCCPBkYsBuMQEw5rIzGbEAMg+tYdQYIUp0gHTqSsMJoT7LpFkRiCq0CJqy-GXuCYB6hcsiKz18gELwjiYsUcaQDR9MLKqTKKgXt52g4ux9zbXmvvTe+oQPJoI2HkIB+okSdR1b1RbOwlYLAHFh295Tr2Kp4Hyxu4H1IswHDngY6EaC-ggcLAqY0pxLzk-h+IKnlVafdfMkdhAKh54JWHuYeo1hkTpWyB9XIhRCjQjrlYPn7nsuC5p51qgqhUc4fF+kDIDQ1LGHUs3ewCuDGVDhPVkMuwLRNaWx3DxAWKHBFRbQyBmAGFMK0ZVZsqACAQG4GATwuBc6oF3OIGA7AG3e-RZgBteBg+FbokIt8kYgWcnvvobKH0ljqgQoiBCxoFvgea27j3HAqHALRXQv3XzA9p5D5uDcwDxA6ZIOwYPG4kZx8CInhvPuhKp9wOnn7GZEIHAwYUU4dIud1AEeUC8UywRQUs8cBV7vPdsrUc3gPLCg8h7D7eyP0fY-x4bYfQ-E+p+G51oheQdvLPPynBxCx445Omk8jnyzXfWvYIO-DldRY-SgU-AgDvLvHvPvYBQfG-UAzlB-VADPFQfDKmAxZENIEbCxCwLtHIEMTUVSRQIA-fbJfxKA8-CPPAK-CPG-EgAAI1gAbT4FQPQIyGNCnBUHFizH4R1BDWzAswYjHD6Vbhd07nED3zr0oL8SgJgI3G73eXgIHyHwT2YNYPYLb04IvCUGrmxxRGuyUjinNgrCMHUhEHMDSyTgVhkPUx8SCByWoPD0vxjwYOH00IbR0A4Onwghfyyi5EQjHABDegqRHgRGRGynuw10kPpnsKyUcOcLb2gI3E7yULgP70QM8JYO8N8KfzdBf3gTxnLChERDLQfA0BhAa1A3SCSnILrzaR8BcIvzoPcPUIbSaMbR0L8L6yUFNwXiqDsDhFQUEN2FJjhA0GWA2HqFODo0vSkISK6IULSNgJUKyI6K6PyMOzRwQGjn1GqVfBGL+inmpgkC5C5DinSCnHLwaOCA1VWRaNoKj3aJvweP3G2J62M2OxGz0JNDiQsEvFOIOHmFpCsGOFUkyjwUW0WOAP00ik1X3BWPSOUN7w2LeIRNWU+NF12ICLJnVHehsCrHFUENJy4SBNvili0gGno1hP3weQ3CeReTeQ+X900RPxSJoLcOv2HwZKZI5RZI3AbRbxYWxM5jF3UB5AWB-SME1DUFOIVHmDNGBTiTNHIzuKGEeUimZPeU+QgOp0n3b1WIyPWIQI6L5O1IFN1OFP1LFO1kKNkmlL7XHnlIfCsPwz6jSGHHVLiOTiCFwA2xIltCIgwFbDeXuneVvXbXUiVwrDemvGBSMHEynE+ihDqHnjnnMHmLlhIGAI6B3lxCmA+wLPtG+wKO5lDiKXmx5GOH5gpXK2pD7A2AJLHEvAkSr06APHCG3HzL7kSAK16PxUjAkByEDDEAOAQnz1KFyGzA0nND6UjDbi7PIB7PwBLP7m4C63LL0Rz0qGNErg0FBiLBNTSGgnKCs2EWVIQicH5ADIwHgFiHox2KNyHEkBkDkEUBUHUDGwQAbUMGzGwLegYgMXf0r1pKxGfJ1mBGzSmyqEOE1HhHDhNUHCjgMWtlvmhHkAZUgtekOGEJWhWGWihHUBZAbU4QVBNlDGo3hGrSVm6Bwu5kG32CZDTN6SOCnORAOIUl6SsizJsK-kY1awXQYv8IOBMEGziWqEZ3UjdLQiSzGWXw1Fc35x6HDxEvmmMDNEkEwX4yowZGLFNHwwMSHQBPVGzNsOW35y2w42Q0gHUpSFm2gjvEUAKHkBOCnNuzJn2VvhBHWAsGUq1xU3Y3U1sogHsqEAnKKTiQjGOCHAMqDEVIJN8vOACra1yw4HCr2NPS4VNEkqkFJx-LlX2AhRUBUEXxpl9MEpW2U3W02wQ3YAfJxKN1KVJlOHKEGznjhHiq8uBwMVPUyk1yy0yvkE7WRHKyYm32kFrisD5j7CQklTVHbNpPpkFzax1w62GpWgvFHMFkwXKDZ3rmBGtlkHOQqphJWrh0CsFwCw4CAVbVjUbSR1bTAGGuqBUkt3KGwWqFNAOoNCOpBEzMLCWoWIuopxg2utuqCCevXFet5lWlvkG1OBsAV3UHwwOiFmBD2XMoEtmVWpqo21XVhvOLfAaDNHKDUAVy3TaqEwOiSw1KTybzZO+QNOD0yuMVOwMS0mFSnHGIESpFn1pTBMwg1OQPAPZMgLbzZq5zFjrkrHMxEHwNO0NT7FEQm34ogxrwoMcPkMlq+IlN3IsOOBOs9KQqUi0jYlqDHA-FsBh0qtmQSMoOSMNKluhH+E31lWcx-NKUDTUiIyiOmI1OWN1qauf2HKVAu2qGhFOXMUEPEUbI9BUFqHnmyg1PeNPxdoqArCHBfEdwfCrFJnMDN1sHBizA1ItOeStNZJFIludr1txOMC4KOvWikFsCnNNDXxk36JmJKPVuryRIDOIjbBerrqNyOAyEs3IzZArELGMPlEWCMp5DpENXsjblzM917K+0xntIzFygvCGOTv41yCnIyiyhygKHyn3SXP3G7I3sLK3pgT0TJPK3VA2h5FqCGRNTqKVB5ppBODsRvIcCAA */
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
        // TODO what if we're existing extrude equipped, should these actions still be fired?
        // maybe cancel needs to have a guard for if else logic?
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
      'Can constrain ABS X': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'xAbs' }).enabled,
      'Can constrain ABS Y': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'yAbs' }).enabled,
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

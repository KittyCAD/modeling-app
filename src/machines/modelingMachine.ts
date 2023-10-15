import { PathToNode } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { isReducedMotion } from 'lang/util'
import { Axis, Selection, SelectionRangeTypeMap, Selections } from 'useStore'
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

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz5x2CJjAEAymDsAASwWGDknNy0DEggLGyRPLECCMrCCuL20qrCRpYagvnaegjZBtLiBqLploIGCtZVyk4u6Fh4UJ7evgAicGERQSx47NG88RxcSaApdcKSNKIKi8ppwsrLwsX60oriqgaWBgbKImpWqi0gru0eXj4EfaE+g5AwY7ETibyzx5lLu1sygM61ERV0+ho0mU4gURlOwihlis2SuN3cnXuvX6L2CJD42FgH2YrEm3B+QnM4mqdhoyPUILqBm2CAaFTS5houQUCMczmubQxXQeAVxQ1QI2JcVJ32SiGUXPEhjBtWklgaokMzIhqVUNHEG0WgjVqkEUN2aMFHWFvlF4WCbzAUq+UwpqRoGQ2pwacPW4JKJxhgYU0kWu3Wymklrc1qx-gGeIJRPo4xlrrlqUEqkqdMKOSRNEOLPWGTVhkswlU0O5fNaMbu3XjYoAZiRKM60+SMwqMgY7Go6mbalCWaIjLCjtJ0n36tUFNHbpjGwBRXDsMAAJxCAGtAuQABYdhLpmY7SPiSzAyOXwGFUQs01BtXVEEV9VSZr89Gxldrzc7vdD2kGISWPLtTwQepBGpEN8lDGhVBDLYdTUfVZzvYFQ3MS4vytBsHieBMglbdsU0+Ttpn4Sk0KzBR1EKdING1EozQqYxajyNQ6MOBchTjO1BhITBMCPMlKJSSNoIsEEllQrlhGQko9RhZEDFUL1vWEUMcLrRcbUeHF7SCISRLI0CxLdRR2ROJQwQQ2RmMQENJD1OxjR5aE+1rAV6yXB4wD4dgNwAVwwIIRjANdRNlCDlGRJU6kfapK0vdYWSnBQJEsfJMtODYrM-XS+MbAKgtCsBwr-KLgNTMDxPlawJ0DKtXNkLl0o2NjNULPMPQ2HSfL0vxd3YA9iDIShMGGwDopPKjSg0fUaDURFFoVbJ7x1S9oOSmQcl2CtRF461ptG-dxFOg8AElGwE4JhiiszpTqt1pB9C8NA8plynVFlyn1EMzVfdTrAU46PEu87IZukUiNCKAAFtItGJ6XXA+a3vVD6vV2Y41IQlkzAMakLCnD0K0jK9wc6SGLpG67G0IsUHpRkDnosjM3oUi91SsRYjmUywWRUDJRFEY0PXzdQrGpunALls6YexZ4jPhpHHrZtH6tKHkJHkLJ1AUGpsofQxxBEWpxayCXFFl2noZXABHYLsCYIJ2FQVBTM1ijLK5Njp20wtPMEUc+yVRC4vgpZlqjXDfIVg9E-3JWCGXZ3XaCBHUAANwqj2vdm9HZg9NjpPUZbIykFkKYNTD1nsGycjt+modb1OAmCFWIimIvtbVMwczF4wtXqRyEDHfVsiNwtahyTU46Kk7W+T1PkBIXcQjARHkaCPON04cghL716kKVdYjErEWFEy9LoXZKsQT7I3jWEFv5Ydh5183tXd-3VANzYAAF7cHYMfVGvtOZggyOkewqkjBqQrOlOBlQqjyCrEoacR145DRXp-XwRBuCwCCiQPAQR-6AJAWuISQQICEjARQJ0ECXpQOqJIOidRNQMU1IpfQyxoLyCOEbUMXF1LvzOqvRshDcDEI3KQ3Ae9NyHxoXQ4hE0mE+xYRBGwlh9RxT5g0DkdQtA6kMMsWEHo6iXgsAiQqg0hT23blIohJCyFkCgD4E+nM4QqVNDfdIdElDZHStYGE6wGTqSRIcOx34IZ4KcQ8aRsj5FBB8Pgdgh5mEc20UbDIujcjHFOIcKom0lIIWJlyOoCFhC6LsCccRSd8HEBcXIshFDgGgJMjoYyOAoC4C8dopYxMlAIXMA0NS9ReGlHUjCSMGgliITsJeSwDS26AVTkk1xCj97KOEt0oS2A+kDIxvwg0y1ji2CqPPdKIgdqyDUMiEQWk4SrMkYklpKSwDOxoWkqAGTjkpDejYA0vorm5FkGlUxaQYFaWHH2awblXlNM2a0hRTASByOEtQLJMV5oWFNBeOpRglCCKqOlOilRspVzkA0KQ84cEOJXgAGTwBVAAKp7TAacM5u2znnd2nKAVCEUDAhZCk1TpE8qOJQSouQ9SnDUsWMS8I02ZayoIHKvbiAAAoSjXEEAAghADAEACBGogOKSUOK5ol2BObWlL81JqFWMWKESoThQkyn6I2UhXkstwOyzlF1t7q2COayAZrjWWo1rVbJ81aIVEOJlLyZpCz1EJgStQTqn5Aukn69VmrMDBp3vq8NprCEIyYD4dcqTWVCoQCoKosJVri2hciKZGxSy5TmctKwcV80Bo1UGgIJaw3GojenF2bsA0AHcBWF2tcXIQFd9hvTHghI4RxhZvSVFSqcNKKYDsDVqq6uAOAEHrepNU-wnk8JOFOP69hMiTLFkCxEhYj1DpPWe9gF6arkS0XiwolhMiPLgUoEEJiSiVmJoULkRs+a2DHJ+wt4gAByqAgi6pGLASNFqWaXrHCB6w6gwQpTpKoYs6klQKhqXSLIjFXloH5YW+MXcEy90XdrJkWVahmgOCoOjpTEAaHmEUupqpMoqCY7nY9RbmMVTwOe+tFt9Ti2ktPXR0JkF-GKYWBUxpTiXhkyxoNCnKrKf-eZXFswNjzF2APcw9RrDIjvlYSQeRCjQgpjLBly95bmdQ+ZpTv6qCqE0XG2YASmqmnMAZryd9dGVDhEhUuDnvKxNVfLA1M7SHBHaVQsBmBaH0PUZVZsqACAQG4GATwuAc6oF3OIGA7AAC0BXOmYFa3gCrhGjb7CkLHNqVioN8Oo7okQFywRmEQq8nLeXyEAI6dQ4rqiGGUHK5VzcG4AHiCrSQdgFWNwI2a4EdrS3CtCW67gXrXG3SG3mMiER6gpz1AsOlJYEg6S7CM4gsW9Kl5xOy7ljgiiD7YCPqt0rjDNtVZq3VhrTWWutZ2RDq7PXUCEaS1IH6kYGS+g+3Yc2P0zRpFWEUubIPgio8hyVtRMOMcEG27t-bh2AEneRzT9HN3Md3YzOobHiEaTiyBOPGwcJzY1Pvmg4cb8-NA4kfN0H7ifCw+qwGhHjXavI5V2Aa7t2Is2cQAL0siwxzHDNCoOoITygXhDDM83fVsGA6y4rqnxl8Cq8Z8zjce3MAHaOxzs7uv9e88Nza43KpJBYRqVHSOodTH0ndacXYcIVjGEpwt35GS1fw7wIj7XZ3s-7lD1j4mppdE5AjDUqZeokv3MLHSTUyJMqZ9B8X2HPu-cB-Z6dtrxfS984ggL4muik0VhFScBPZTB5cNNGaI22ULCrKCLgTDJFbREQwK2YKmB7r+4DfW7IcVJAVjeteHkwJp-yinBeUMuNhFC9NLLEgVOOhb1xFMNjH-7ScfD0u0oYOakXRMcHkQpCFdKXIGESeDYdUZNS8AHexa0A8cIbcd-buRIC9IfDGOZAbQMMQA4UZSAtSEFVYc0KpSMWWFA8gNA-AH-HubgP9f-fuSmSoY0CuDQdUYEIWKFKQSoH7GpMDZYAaTLZON5AhD5MhDcMAPlCqcgSQtcZMZg16MWbMdIZ1RQEQJEBQSAmpBKH1OkI2coMWJwfkNfDAeAWITLWNI3BtOkSQGQOQTQtQDQFkVrQoc2OwMQdUE4LSPmOXF3G0GwiPVIEgqQMfIjTUeEa-UoQcCOWpawG+aEeQVZYIgA8sbMXtVaBUdadQQmUsPdNSCwF8ZEJFBJMANI-uR5fYJkKEeQUlYTBAZEfUKveoqycwaTeXV3JOf1OTSo+7A4EwR5RVKQfFUbBAU0NCPdSvY4KvEQlVMQ3or9ItHoGrfojMYwM0DzdTEMT1BkKjARMfUMGpKwJQFDINbDUtcdCAdY4fCbc2fIRQAoeQE4RoysIMWjOAkEcJeYhOWmJY1DEdUNQ1a424+NQg4AmvVYC3OkKjD4rkL4hSc4c479DgMElIU0W-E4i2aoLMGxYsHdCwQoK3VYIcAwFEotDDLDPVdgSw6zEIg4O1IpE0dgm+ced4yoT4+jV+VvLosQwLTldE4VMWC8HIV44EcWcoGudzS8LyTg2QZUEzOTcQYLH9IUhtFaUUqApiSU6QHTWZYEb7BUkGckvk2mAUrVczGdDgf+YKYIaQ1rAKcIO0iogDSLSkdYUUhUcoDBaoU0fUuuGcPwzKQsRA0Q802TZYlUyM60nPJ08gF09U4wXIBYJYBoR8Y0Ro2QdQc2A6BUdSeoUMDLBYiM0zLVKk2QpM6oL7N8BoIGaESjUxN6T0OoZNA6KlNvfLC7TrOndbRTHndUvxYjXYqpGwc4D7bKSoPtF+aEMg5VP4leJXanJRNHKHenDbDHQcgzakWkWwHkOkU4dKGSTwiDcoWQTkZ3JAhXJOJcj3DxfsirLc4FGwKEOwWwdyPUxPM2UMZYfMysMEDPM0xc93DvTct02wq9CobaNSdg9aHkB8Suf4Yw00Asg4FfNfYiNsV0+kgAoRakLQzGCVQsRskoBUPWLgukM8+yF-N-OgjAuaLWN0XKC8KoD0E4pCMlUxRiHmT7PKJQEMecvSag2gqAeg3FRizmfFDzOKe3WSWoHgkoDKbMCFGwRED1OiUwhwIAA */
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
      events: {} as
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
        | { type: 'extrude intent' },
      // ,
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
      'hide default planes': ({}) => {
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

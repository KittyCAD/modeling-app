import { PathToNode, VariableDeclarator } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import {
  Axis,
  Selection,
  SelectionRangeTypeMap,
  Selections,
} from 'lib/selections'
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
} from 'clientSideScene/sceneEntities'
import { sceneInfra } from 'clientSideScene/sceneInfra'

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
  | { type: 'Enter sketch' }
  | {
      type: 'Select default plane'
      data: { plane: DefaultPlaneStr; normal: [number, number, number] }
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
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Equip Line tool' }
  | { type: 'Equip tangential arc to' }
  | {
      type: 'done.invoke.animate-to-face'
      data: {
        sketchPathToNode: PathToNode
        sketchNormalBackUp: [number, number, number] | null
      }
    }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AdgCsAZgB04gEyjhADnEA2GgoUAWJQBoQAT0QBGGuICckmoZkbTM42YWKAvk91oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBFtpGhlxDRphGg1ZURlhXQMEcRLDSVF5UwV84XEK8Rc3dCw8KElsCEwwHz9A4NCuXAjeGI5B3kTBDOFJYWVlQ2UlY3UrQsQFUQVy0Q00w3FLGVNTBtcQdxb8ds7ugFFcdjAAJ0CAaz9yAAthqNG4iZCdKiWZpcQKEyHTKmTLrYrCGb5DRaGHKBGiYzKRoXZqeNodLoEB5PV6wD7sb5UQyRZisMbcQEIQRLGiSdRmfIqUxLCpw5QqcrQ4SGTTWUx5bGXPE3Ql3PjsZ4AVwwv1psXGCSEMjkkhkNFE-MNBxo4vEcM22wqOQxikMKwUktxrUk3nJ32IZEomFdnx+9BGdIBmoQdoUykkxmEyIhELMsjhobKoYUdsOIq2jo8zp9FK+LrdXwAkrcegEgl0BuF-X9AxrQIlDHspPzRKYbAsttYzfojCYZBYaEs5uCaCZuZmrm0c99877i4TkCQPn0oABbMCPfwANxenHIJEwquitYZwaspiT1U0c00qQKPZDGgOKVHcgk+SUGgn0uned-8+6RdlyCNcNwCL5UGebAAC9uHYA8j3+Ot+CMJFJFUMN9TtfI0RkBNxDtcoNHkSx+WMCoZG-bMC1nXMAOIbhYAVEg8H8CCoNgx4D38CBsCYz0wEQk94nrVDdgsJsTU-C91DhNJuQsCpRFHYiLwOKjrl-WjvnoohGOY1id2ePduN4-iKEE6s1XpESUJDGQlkkcUZE2RYnzUPY5M5cprBFDQEWEBzdg0qcaP-Es9NwJjnhY3B-AAQQAIW8fwAA0hPVU9RPszZJByMRG1Oc80jk8UNCcg1FFfVtajOJos00sKC10-SYtYpKUoATQymzGSsXLrDsZQ5EMA0DTwh9DnUUElMWNQoy-c4pWo31tKLCLWti-wyCgLoeqDbKDhyaQlCveQU2EUw5OUxEtnkdE0ROYQQrWtaWqigy4q6fB2D9Glj0y2yGxKGYVANE0Dn2UQ5IWbY5jbQxLujFRnqWp1GtW8LCUi6KtqYF58dwXjyEVTASFeMz4Is-bkIbbVthsIrrEsTDlDklNyuFKpTARaxkTEF6tKx7occ+tjIJguCD0wPRtpwKAhisgHerPBz+wtLQJGIjJ+QTDFw2OLZ-MCsR+TqnEGtCzHmo2j62rioyTMwGW5ewBWaayuyrEuvLZEccVFjMDEE2GkEth5qolmORxzeWjHcze23cdY2BcBIJh-HYVA0o9oGjAIqQHJHBQeeqMw5OyfttQNeZVC2QLKLRy3XuFhi7a21P08z7PuqVpDPeB59MjIhFxGFbI5MbGZdkcOQLyjZQckFpq5yTsWwAAR0VbjvqgX7c7644pAxY2ef1OQx4TWpWRyExR31ZQDVMZfrdX7HNtYphyel6g++EvrZAzFSEXUapwnxRgTKcIBpQFgnEyGoUQL8E6t1FvbfwzwwCrlQDufw5AP6PFgAfVWWh0JWGIsNTQo0dAPhFARCwixbDZBKGoYaSCZytwAEpgEEGAPgIRFRPCIYdOoUgDiGFOKkdIYhg4PnUP2dIqQ0S1yUAsNhf4bayi3tgDOAAZPAYBu6oEPH-QGfVUSCnqLYMQ1CiiBXDMiAi2o1CKPHE3ScLcNH3C0RnKmMBHjYG4uTcg3chF2SGtscEBoCKP0UCIhMxgyg3jrrE5Ei81GSHigAdxYuBCWnF4KYB4nxKmlB-B4AAGaoAIBAbgYB2i4C3KgD4kgYDsEEOxSWXFMCCAqagUJiQ0jZDyhoReJpahPVqHJJ85hNguX2MoWwlV0lZJyeLDiUtCmUwEmU3AlSCAvGeJBSQTAybsEqc8VcLS-DtLyRsnpuy+kmJVtlQZII7TIlTMRFyPM5Lgn7NkQco46g4UMMs7JHBty7mwPuTZxTtm9OqbU+pjTmmtMEI7aFB57mVP6YgfY-YDi2hMGicR+QvJKDZGIOQdhSiBTBasjFMKinmVKQig5RyTkkDOZBS5aLGVYt6bihA+K2T6jEPPI2Xk9gRkfqoNIcj2T0ohR1NKOy9k1NwHUvAKK6lopIAAI1gIIPg2LHn-X7nnYV0TZjDVfBfLYpVhoRgyE+Reshhq1CVQEFVqU1VVPZc8Y5pzzm8uuQao1JrBVPIOmEgiMwcjgiUK2fUWhSqLGkFsR+BFshRmfm4n8NEVnKuSv4TqfrEWauRU03VYbDWCD0KaoV8yM3yAqLYKBxE4SHDRHlbmyktiHGCvmlaCci3epLWWtlzxDmBs5dyi5Vy2nhvrY26NtM8VxosDhMeDl+Suq7W5CwCz5jV0JY3eq7itJju2vgLo5aNVaoadWxdggdpdFXea-+wZ9ig0sAcPIrYA7XQNE5Qdf6KhhgRF6m9u0DFTpnUGrlIaX1vu4VGz9pjv0EThtkfqVg1Dz2uojCM-6shyHPmiaDu9fr3qRdq59aLqNfA-QGTDLyCIghyPJcBew7ww1yoOWlKhEZWCoxuPeXxy0BsQ-O0NbSmMsZrGx2N6bjAmC2Isa8E0igOWlSelE-l7oGmg-jZ4hNiak3JsykpcGHkVsfTql9pnzPQss88QQWyLKKesjGgZasKpKGsMNBy1RoYPjmSCMejZ5iAYA7HdGVtR3goCM5jcFmyYUzhRZKT06OXBp5U5gmaXXMZY81lyg3nla+bxf58UgWRnaijmFnTAVpDChGY-E4cX0l6M1YYzApY+gVjiE2vU5gnx6hFJkdMJVws8wjHVk01hMLVB6-o-rRJvGZx2mBAJhSgkhLXQPPFCJyqjTMKOdQ3M2YPh5vGkGjgsiuIvQW1avWDFZyMZIQsuAOAEFGxIaQ3aITpn8pfB8JL0Il0uhzfUjhQXDvjjOd7-Xvu-fYP96krHnlhJctsE4NhFDKT9ioOE8MnKNgcHUbkpo1t9c+5gSQuAeUHkG+WEII2juWuW-j1suxhTQ7DGTmEGbSULL-XaPNL2R3I-WwzyQAA5bOAAFVAeB2CwAIPFCAEBAjwWMv4Fg6um3zHKjCMabYXKDg0HyBZvsI5ZEUKddJP2-tCoSfYzYWQVDnxNDbmhYI8pKIcoC3TCPpdI7zK7jHVIMM44bFhNkMIYQjNkKORsCZjiJM2OkBYunThYkR4lmcAAVHb-jAnPGCVnNn-ROdx+q8K4a5gFlKFNEt44menxsjcnqSwxEMxF9emX-Au3K-V6qXcLbKOGcm+RL7TImxxSDm04gNs4ZeZpBItbyjQ+tKKiJtnfixlfwAHlcD2arc0+K3gS+CAPzUwQx-2Bn8Vg39dIYoQVQWhiem+o4RGyzALRhguRkJPhqL+DM7+DlIkCUA9DDY8RgAwGkwpZkyapCqCCFQnTE4YiIzEQERXQQ46htjcjRZHAVCowR5tBkDYCrhcqtDdyG5oHdAPpX51I0F0FPCCBZyCAwGUBCoVCXiL4ArAKwhEERJWDMLfJRjqAvQcH0H4CMGcqaq17DaDBNqBQkbUqtgYQQIPgzwRh1DDRqb8g1ByG-acEMFZz+C8LFIMFki+iX70bNLyFcE8EOG5gCGPykKcgnDahpAIhwhPiRZ5AQiLx2ANaaB04faoBfZK7+Cq7q6a6kAWTGLv7HbCpja9piCHA5CIwmBwinDqziKKATbupVAuDnDM4YDwBRBxxQDY6N6CAg7SByCxIYSaA2JCDiQQjTI8x6gORIyIJD4EhgCNEf7MgkKVQ8zgjETXjmgpjlBTTnaSGWBS4WyXoFjjEZHcgMxe7Eq+5thdr9gLKVCHBRaOD8jpLCzbGWoHAnC6iLwphjyhZ1DxLJAHBjypDVAXi-HQYdL5KmTla2aVK3F9RhgMwZClzCg1CpC-LJDAhQjzBWLh4bGvZJYMpQpMqeasoPJglnhyIyrp4iLN6GBeTKRbpPgcwxYYjQY+p+r4mHQlxSBqCOIF52CjiEE6ZFR5SVSYRzSdh0kToMlKbx5GAlz9ihF5G9Gr7FCDggjVwUGthyLrH1GvTXqoYik+Yf4ijijoRQgJpVB5CnDXRqBsjyoVCqBzBb5iY-SSa9KMlewlw3zqaPwpgF7zAwwCiXTiKXFDFXF76FrJaG5FZEwlZWY4kgmoCOkNibAb7cjKS3jtglByS2izC+mtijSVCF5UGvQz6xGYAxl4r2AWC1SbA2DqBLAAGLGnB3Y1AlC7ColqlaT5lfbR5FnCqjRlCZAlDllVAQl8gfHzDpCp4p4LLRGo7M4XIHgdlijxqjzHDOKyCylZBlDtjiKlAuSmETny7xGJEEKznzCIinCyCNgZDQg3a2IIhsh-IUTuqKDnpoky5R7o4dnkQt7azMzghmAZ40IihJgigpjGjpgOiBmrQj5+KcDj7dyzmAG8yGguSVBcm9h5CPFhg8hZC-7DG5n76H567kwv4Fjn5vkLDxp6gLCEqSEAFbDoSXYqAxa3zYVPmR6QHZx8FjGilNF7BhzpDiKqB1CXTDR8g6hPj2D9paB+zmG0EKFQBKHMEkVSA8zi42DyD4aXmIDDThgmDqBzAzxTSUHMXUEWEyWMG2FMT2FbGcU6mOC6gIiYRjzcg0pdpzCCj2AQhRiBQXiLQuBAA */
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

          'Enter sketch': [
            {
              target: 'animating to existing sketch',
              cond: 'Selection is one face',
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
        },
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
            exit: [
              // 'tear down client sketch',
              // 'setup client side sketch segments',
            ],

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
      },

      'animating to existing sketch': {
        invoke: [
          {
            src: 'animate-to-sketch',
            id: 'animate-to-sketch',
            onDone: 'Sketch',
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
      'Make selection horizontal': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        sceneEntitiesManager.updateAstAndRejigSketch(
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
        sceneEntitiesManager.updateAstAndRejigSketch(
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
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain vertically align': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to X': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to Y': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain equal length': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain parallel': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        sceneEntitiesManager.updateAstAndRejigSketch(
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
        sceneEntitiesManager.updateAstAndRejigSketch(
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
      'conditionally equip line tool': (_, { type }) => {
        if (type === 'done.invoke.animate-to-face') {
          sceneInfra.modelingSend('Equip Line tool')
        }
      },
      'setup client side sketch segments': ({ sketchPathToNode }, { type }) => {
        if (Object.keys(sceneEntitiesManager.activeSegments).length > 0) {
          sceneEntitiesManager
            .tearDownSketch({ removeAxis: false })
            .then(() => {
              sceneEntitiesManager.setupSketch({
                sketchPathToNode: sketchPathToNode || [],
              })
            })
        } else {
          sceneEntitiesManager.setupSketch({
            sketchPathToNode: sketchPathToNode || [],
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
      'set up draft line without teardown': ({ sketchPathToNode }) =>
        sceneEntitiesManager.setupSketch({
          sketchPathToNode: sketchPathToNode || [],
          draftSegment: 'line',
        }),
      'show default planes': () => {
        sceneInfra.showDefaultPlanes()
        sceneEntitiesManager.setupDefaultPlaneHover()
        kclManager.showPlanes()
      },
      'setup noPoints onClick listener': ({ sketchPathToNode }) => {
        sceneEntitiesManager.createIntersectionPlane()
        const sketchGroup = sketchGroupFromPathToNode({
          pathToNode: sketchPathToNode || [],
          ast: kclManager.ast,
          programMemory: kclManager.programMemory,
        })
        const quaternion = quaternionFromSketchGroup(sketchGroup)
        sceneEntitiesManager.intersectionPlane &&
          sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
            quaternion
          )
        sceneInfra.setCallbacks({
          onClick: async (args) => {
            if (!args) return
            const { intersection2d } = args
            if (!intersection2d || !sketchPathToNode) return
            const { modifiedAst } = addStartProfileAt(
              kclManager.ast,
              sketchPathToNode,
              [intersection2d.x, intersection2d.y]
            )
            await kclManager.updateAst(modifiedAst, false)
            sceneEntitiesManager.removeIntersectionPlane()
            sceneInfra.modelingSend('Add start point')
          },
        })
      },
      'add axis n grid': ({ sketchPathToNode }) =>
        sceneEntitiesManager.createSketchAxis(sketchPathToNode || []),
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

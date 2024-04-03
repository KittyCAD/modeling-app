import { PathToNode, VariableDeclarator } from 'lang/wasm'
import { Axis, Selection, Selections } from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import {
  kclManager,
  sceneInfra,
  sceneEntitiesManager,
  engineCommandManager,
} from 'lib/singletons'
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
import { DefaultPlaneStr } from 'clientSideScene/sceneEntities'
import { Vector3 } from 'three'
import { quaternionFromUpNForward } from 'clientSideScene/helpers'
import { uuidv4 } from 'lib/utils'

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

export interface SketchDetails {
  sketchPathToNode: PathToNode
  zAxis: [number, number, number]
  yAxis: [number, number, number]
  origin: [number, number, number]
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
            cap: 'start' | 'end' | 'none'
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
  | { type: 'Equip rectangle tool' }
  | {
      type: 'Add rectangle origin'
      data: [x: number, y: number]
    }
  | {
      type: 'done.invoke.animate-to-face' | 'done.invoke.animate-to-sketch'
      data: SketchDetails
    }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AdgCsAZgB04gEyjhADnEA2GgoUAWJQBoQAT0QBGGuICckmoZkbTM42YWKAvk91oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBFtpGhlxDRphGg1ZURlhXQMEcRLDSVF5UwV84XEK8Rc3dCw8KElsCEwwHz9A4NCuXAjeGI5B3kTBLWFJDWV5hVSZZTrlBUKjS1FZiUrDeWVDasaQdxb8ds7ugFFcdjAAJ0CAaz9yAAthqNG4iaFlmZWZSmZRaKyGQzKYQaDYIGSmDSzdKyDSGcQ0KrAk5nTxtDpdAi3e5PWCvdgfKiGSLMVhjbh-BCCaw0WaQrZqdGLAr6RAZGSSWzCZSiIEKNFi5TY5q4y4E658dgPACuGC+NNi4wSQgqM3hNFEwNEGlEYthENELJkCjWplMFpsGlRUo8rVlNz4LAe7DV0Vpvy1jKtCkkVuZMjsDpNsOEwjKUIkcxNqWhomd5za3jJH2IZEomEzb0+9BGfs1oESEOtkmM0K0ahMplkZqOZUrYrRlgUJrTMoL5Pekj7HwAklcegEgl0BuFi99S-SA4ZoWUdWsTSLlsozZlzNkZPrG0a5F2e66hwPz6OCcgSK8+lAALZgO7+ABuj045BImB9PzL-CMeFW2qTQhU0ZMzVRKR0RoVJ6nyJQNFPC5z0HLN3ivbobzvIJH2fAJ3lQB5sAAL24dhv1-ed4nLQDoUkVRrX1CF8ihGQzXECFymNLJIU4-U8mQjN0LQwtMOIbhYEVEg8H8QjiLIu5v38CBsCk3MwCojUF1ohArCNCwNDSDFENMI51h5OEzGUCwKgtbJRDMtEhNE-tXJHMciEk6TZPfL1sC-TAVLUiiKE02d1TpGiAL05ZgztK0RVBYxNHYyzw1qcprCODQY2EZYjRc1DL087yHhk3B-AAQQAIW8fwAA0tKihkrC7JExEMGxOPhNJYXhAy7ShRY4NMWoGlcU5pTPESSoJLzcCk8rZNq+qAE1mv9XS2u2aw7GUOR9mFA7YU5YN8rstlHEdIrZvQ8SFqWir-DIKAuk2-8K2RaQlBA+QxWEUx+otXV1zyg1AbG27C3cjDSsWnzKq6fB2CLalfW06KvvEGYVANDE0TSfZ+sOc7gVRQHHSUKFobcubukexH-CYR4WdwVTyCVTASCeVT1LCj6dJiqwrVmW0eoyI5VC3dKxURWMqjG-LHVy1NJpxGaYfpiSEeWyr5NI8jv0wPQXpwKAhgijGWsXZZ+S7TQu3SI0aBWM0kpDO1QPysQVgmpoXRQu6xPhp7fI-ALjdN79sAtwWsbo8wcitQGkrMEUzQO7YTTGzFqiqWpaY+WGHrK57YFwEgmH8dhUEa+PWs4qRlnERYFDG6ozH6vcQzkeZ5n1RxwyLi97tDpmK6rmu642q2-yFr60QsIVOJjHHjBhdKupmI0h8cpc5hyEeS-HvX-DAABHJVlORqBUYb23G3KbfAayPIJG5Iol3RJETFg-VjqmGPtrRmZ8mA82NtQOe1FG75AsOGFY+xGwU03l-RsMwTCcUOLaTIag1YB3TLDE+80y6yQeGAB8qB3z+HIKQu4sAH7bWsMGQ41gDRWlRCacQZolBlEsMCfcOROQHWAWPAkAAlMAggwB8BCEqe4jDhZ1CkGiVQ+kdQGlhCCGyjk14misGZbIoiQ5yivtgauAAZPAYBp6oB-NAzGrV246JKKCW0CZ1CwiUNnTIe05CJghMY-s4lrhmOrqFGAdxsDKR5uQaeijEh2DkLMDEB4JDpDdpZFK5g5ASGlpifU-spqB2EjDKqAB3GSBEiKGyUkFPmoVKD+DwAAM1QAQCA3AwDtFwK+VArxJAwHYIIA2ikKKYEEK01ACTEDGURI6UEGJai2jXv1VE5guyhiwbYCGx8KlVLkjUsZykGkaWabgNpBBHgPCIpIJg3N2BtIeA+QZfgRlHKNhMqZMyrL6mrF1VEaJjRWjGv1Vu-Jsiu1gnUVihg9mVI4G+COgVgr8yaVMjpXSel9IGUMwQflPzfkmRc6ZDiba6SJvyNEih7BQkMIKfqVopCOHfnYUo+V4UHIJZHepIUzkYuubc+5JBHlEReXi7lgViVtJ+ZSyQix5D7zEJoRlRlqzHVSK3ECShOWItWo1c5lzOm4G6XgHF3S8UkAAEawEEHwaVpL0bzwTlZSEkghT7iWLsCyRR4QHWrBkVEoJZAHULuraaQcykIoCPqhqhr2mCoeHch5TzxVvOtba+13yyVbRikTGYQj1B1FMPqLQ-UzI2TqNaCQG9oRAPDSUoh+y9V1X8GteNmKTXYv6Ra9NNrBB6AdbKrB0gNGOXhDjY0p1XYFsVhaLhpbdUxtbe2gVDwblJuFaK55rzhkZoHUOnNn1Zmr3gSvfK8x0iQlOpCRErttHhhFDjGQS6Xr4C6B241prek9t3YIV6XRD1OpgQGfNKQIQwscnaQwwMDQCnRBac0JooTCFfQBmxa6N3JpFamv96GgMlkcaBzi51shtSsGoMyn9ZkikBGieQcF9QAlfbfVGn6sVmt-Xi1j7wCNziIxSzi2xk5mBQfufIJN2qu3ZSoJcVgWPPjvu8DtibsPbrTcMnjfHIq5sSSO4wJh9FrFymlX1oJ+TzGYQiMQMYDSvpZg8NmHMuY81RY0jDJLO3fvNX+hzTmAouYeIIU5YVtPW107Mu2AouHWAOnFOQ-VqjbHXnMYU7i5BFI1pGtyzaAh+efM57mvM+VhRU+uoVKaxW+dZgVgLRXgslcoGF51DIEH8i9iiOLawEvpTytIWMqWoPv0yxG0pbkrEmtsZgccfQpxxFlfuJOFGjiZCOHkbh6UxrVi9hiZhjEX0NsIahCbNja52MJGEmur18LRKCrE+JR6F6zMBjZKo29shmBxo2LRigUmcS0MKC9Rxj4nam5IYcuAOAEAWyoeVrcRSLARHIIGlk1hlDSO3MwJgYy2BG42471iwcQ6h5SYDAm835H5BaK0t6KPAmjIDWYKwJA7OBLBfBxSjsiVB2dzAkhcBiu-DNycIR5uPZddYTKsh1BS2ZAaGWRRQQzGXKrOWUE4WHd7NzwnvPJAADk64AAVUB4HYLAAgVUIAQECBRL0zMTd3FlfMREJaDSOSMosUEsJ5hJzMK-TIRaFAg516gOx+ujcO7NzmMK9iyfkuFpoXcshwUYi0CaH1iBeJi2waUK0Kxj7E-YND8XrV+GzC7FkFQTHU9mjSFIOYHrpapGSgXyHRfSeEfjxWZi8qS0lrmLIWCXVa9mXdU7OYQJuqSk15rNyAAVa7USYkPDibXYX-Qxdx4i3CA65hgRKDtOiWw8Ja+onlbez1XUKhB5n9l4uC-8A3eX6v9poSlTmP8Dz0PsfO-b+WI6X+RQRyC0E6SyBEGyGMcMOoLIV2BvY+JUdmOudSL0c8AAeVwC827QGSqm8Dn0EAQM6UEGQPYDQMti32PT0hKGDDyGWQhEdDqDUFhCTAFGwTUFylbhKFQ1vzGw+H8AF38BaRIEoB6DmxUjAEEK5jy25hNR+SZC4iOARBxmhGtDrVEG92WHPzSByEhiFBsBHj4LrkEOEN8AnA30GB+SFH+WM3SRwQn1hAdHgxKDsCUAGhXhcjIGwAfBFVaGnmZmkO6C-SwO6Q8K8PuEEFrkECMPCnIKewQAqGAgD0hSWEyHUODB6hKFSHbmUJvwIRlBCO8PwF8OFRNXXzm3MJL1A3yn+TkGR0YmhCYK0GrFWDsFghWBqHcMh1CJ8NrnPj4BCh8NJELEwM4wGXyLCIiMGP7B+SzngVDTeyNGfRvRYShFbhBHUGsxyM5y1xhkkVCHQzB1yx8JqSgDwAIEN25iaWOLwFlV0XlRpTikUNygVyMFyjJnnX+kWHaO4KIW1jfw-3IT2PfVO2-wW0ykBnzmyF0PUDUKyTsGVzmGsxBEsFsxcEmgFwwHgCiCyygF-woMEEWDKFyEUCr3UC0A2yKHxMtAqHcXAk0CvRcnxDAFxNiMEFBGoKhDGlbmNFAi8TFHKE5H2HSMsHrVyNnw+GZJdTWPLwYyrzyBr0sgwR9zyGNByAcgqCCQ8i6AlNagyGbjGlylsE0EqAzz0npURC6isHRD9krzxy5yjQOVGU+Tc35RJW1MXGtGDEdCWUcCsBjFSDBWSGdhgh93yA11FLvwHFyyRX8hRRC3RVdP4y7yMHUCpVUEsGUV3xg3SjkBZFSFRDlnmHiNfVjXjTdO2kxwsF4QnQOgMxR19UbDKGNGGjUVUBNAO3DJ4MjOjWqhXVLMTO3wUKpw4RIz3GnWFF7jsjECqHzjQyBL7J0woIUO2BWFgiESqDyG+3SgtGDE7i7Hxg9TqAUxRmUymTLITxLT+zdzFEbH7hJlh0BnpUcA5KbNtO2Jy27Py3Zjq1czjI8zaTPIrC7AgJBG3MDRBBKH6hpXdUfP3h1BBGD0m15wAtmXsGXioKNGnLWCYNUFZE2TSxbnpQQuBLD0L2QrhH2D4XGi7BsHUCwtR2SEhBWAWSxwRKIrBwF2eW-DIusC21ylqD1EWFkFM0z0sGz3pVz2tFkDYt1wN38GN1N0xIXNiLYWbl4TBBMDSEySKA9RDHbDRCOChLDK2LFIHFIv7MXIPAYhVOZA4LMlQSMBbH+Rlw7DW02OxKIQf0iU4Gf2nm4pNAwXBSMjmGWC6meL0ldmXJsCnMcB3FsHgMQJtx5hIPQnQLIshHbn5N3gNCrVkDrMQCNBsgn1sGNAhiAv0P4KiLIqZBKAYjbLzP-3E3sMyj7j9RqBWEbA6M8IKKgCKP8LSpWAFCFH7ztFjH3DCoOhshMHUCFF3k5C4I7MkDGO6LrhkX6MKMmPFPMtiPpWV3lwYwjE4lsESxZAHnbjzLUAOjctGyIV2IiQ-SQq2olzySsvkB4hrU9w4nhGkGP2DSbmb2Pluv2N10OPWpCG4Gt1oQeBNQeD8s0BepTDEBHLCqQRZByCVxFH0oPwBtFyBu-0kBBp6quOiha1A0OEKsJnJjGgUMgn2HlTFDFCZVrK4JcCAA */
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
      sketchDetails: {
        sketchPathToNode: [],
        zAxis: [0, 0, 1],
        yAxis: [0, 1, 0],
        origin: [0, 0, 0],
      } as null | SketchDetails,
      sketchPlaneId: '' as string,
      sketchEnginePathId: '' as string,
      moveDescs: [] as MoveDesc[],
    },

    schema: {
      events: {} as ModelingMachineEvent,
    },

    states: {
      idle: {
        on: {
          'Enter sketch': [
            {
              target: 'animating to existing sketch',
              cond: 'Selection is on face',
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
        },

        entry: 'reset client scene mouse handlers',
      },

      Sketch: {
        states: {
          SketchIdle: {
            on: {
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

              'Equip rectangle tool': ['Rectangle tool', 'Rectangle tool'],
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

              normal: {},

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

          'Rectangle tool': {
            entry: ['listen for rectangle origin'],
            states: {
              'Awaiting second corner': {},

              'Awaiting origin': {
                on: {
                  'Add rectangle origin': {
                    target: 'Awaiting second corner',
                    actions: 'set up draft rectangle',
                  },
                },
              },
            },

            initial: 'Awaiting origin',
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
        entry: ['show default planes', 'set selection filter to faces only'],

        exit: ['hide default planes', 'set selection filter to defaults'],
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
        internal: true,
        actions: 'Set selection',
      },
    },
  },
  {
    guards: {
      'is editing existing sketch': ({ sketchDetails }) => {
        // should check that the variable declaration is a pipeExpression
        // and that the pipeExpression contains a "startProfileAt" callExpression
        if (!sketchDetails?.sketchPathToNode) return false
        const variableDeclaration = getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          sketchDetails.sketchPathToNode,
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
      'set sketchMetadata from pathToNode': assign(({ sketchDetails }) => {
        if (!sketchDetails?.sketchPathToNode || !sketchDetails) return {}
        return {
          sketchDetails: {
            ...sketchDetails,
            sketchPathToNode: sketchDetails.sketchPathToNode,
          },
        }
      }),
      'hide default planes': () => {
        sceneInfra.removeDefaultPlanes()
        kclManager.hidePlanes()
      },
      'reset sketch metadata': assign({
        sketchDetails: null,
        sketchEnginePathId: '',
        sketchPlaneId: '',
      }),
      'set new sketch metadata': assign((_, { data }) => ({
        sketchDetails: data,
      })),
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchPathToNode,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Make selection vertical': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain horizontally align': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain vertically align': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain snap to X': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain snap to Y': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain equal length': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain parallel': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
      },
      'Constrain remove constraints': ({ selectionRanges, sketchDetails }) => {
        const { modifiedAst } = applyRemoveConstrainingValues({
          selectionRanges,
        })
        if (!sketchDetails) return
        sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
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
        if (type === 'done.invoke.animate-to-face') {
          sceneInfra.modelingSend('Equip Line tool')
        }
      },
      'setup client side sketch segments': ({ sketchDetails }) => {
        if (!sketchDetails) return
        ;(async () => {
          if (Object.keys(sceneEntitiesManager.activeSegments).length > 0) {
            await sceneEntitiesManager.tearDownSketch({ removeAxis: false })
          }
          sceneInfra.resetMouseListeners()
          await sceneEntitiesManager.setupSketch({
            sketchPathToNode: sketchDetails?.sketchPathToNode || [],
            forward: sketchDetails.zAxis,
            up: sketchDetails.yAxis,
            position: sketchDetails.origin,
            maybeModdedAst: kclManager.ast,
          })
          sceneInfra.resetMouseListeners()
          sceneEntitiesManager.setupSketchIdleCallbacks({
            pathToNode: sketchDetails?.sketchPathToNode || [],
            forward: sketchDetails.zAxis,
            up: sketchDetails.yAxis,
            position: sketchDetails.origin,
          })
        })()
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
      'set up draft line': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setUpDraftSegment(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'line'
        )
      },
      'set up draft arc': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setUpDraftSegment(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'tangentialArcTo'
        )
      },
      'listen for rectangle origin': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setupRectangleOriginListener()
      },
      'set up draft rectangle': ({ sketchDetails }, { data }) => {
        if (!sketchDetails || !data) return
        sceneEntitiesManager.setupDraftRectangle(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          data
        )
      },
      'set up draft line without teardown': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setUpDraftSegment(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'line',
          false
        )
      },
      'show default planes': () => {
        sceneInfra.showDefaultPlanes()
        sceneEntitiesManager.setupDefaultPlaneHover()
        kclManager.showPlanes()
      },
      'setup noPoints onClick listener': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.createIntersectionPlane()
        const quaternion = quaternionFromUpNForward(
          new Vector3(...sketchDetails.yAxis),
          new Vector3(...sketchDetails.zAxis)
        )
        sceneEntitiesManager.intersectionPlane &&
          sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
            quaternion
          )
        sceneEntitiesManager.intersectionPlane &&
          sceneEntitiesManager.intersectionPlane.position.copy(
            new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
          )
        sceneInfra.setCallbacks({
          onClick: async (args) => {
            if (!args) return
            if (args.mouseEvent.which !== 1) return
            const { intersectionPoint } = args
            if (!intersectionPoint?.twoD || !sketchDetails?.sketchPathToNode)
              return
            const { modifiedAst } = addStartProfileAt(
              kclManager.ast,
              sketchDetails.sketchPathToNode,
              [intersectionPoint.twoD.x, intersectionPoint.twoD.y]
            )
            await kclManager.updateAst(modifiedAst, false)
            sceneEntitiesManager.removeIntersectionPlane()
            sceneInfra.modelingSend('Add start point')
          },
        })
      },
      'add axis n grid': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.createSketchAxis(
          sketchDetails.sketchPathToNode || [],
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
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
      'set selection filter to faces only': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_selection_filter',
            filter: ['face'],
          },
        }),
      'set selection filter to defaults': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_selection_filter',
            filter: ['face', 'edge', 'solid2d'],
          },
        }),
    },
    // end actions
  }
)

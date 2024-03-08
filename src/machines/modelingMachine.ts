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
  | {
      type: 'Enter sketch'
      data?: {
        forceNewSketch?: boolean
      }
    }
  | { type: 'Sketch On Face' }
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
  | { type: 'Export'; data: ModelingCommandSchema['Export'] }
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
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AdgCsAZgB04gEyjhADnEA2GgoUAWJQBoQAT0QBGGuICckmoZkbTM42YWKAvk91oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBFtpGhlxDRphGg1ZURlhXQMEcRLDSVF5UwV84XEK8Rc3dCw8KElsCEwwHz9A4NCuXAjeGI5B3kTBLWFJDWV5hVSZZTrlBUKjS1FZiUrDeWVDasaQdxb8ds7ugFFcdjAAJ0CAaz9yAAthqNG4iaFlmZWZSmZRaKyGQzKYQaDYIGSmDSzdKyDSGcQ0KrAk5nTxtDpdAi3e5PWCvdgfKiGSLMVhjbh-BCCaw0WaQrZqdGLAr6RAZGSSWzCZSiIEKNFi5TY5q4y4E658dgPACuGC+NNi4wSQgqM3hNFEwNEGlEYthENELJkCjWplMFpsGlRUo8rVlNz4LAe7DV0Vpvy1jMMpjKGNEINstuqBu5RSFiJBIuBxvh8I0zvObW8ZI+xDIlEwWben3oIz9mtAiQh1skxmhWjUJlMsjNRzKVbFaMsChN6ZlhfJ70k-Y+AEkrj0AkEugNwiXvmX6QHDNCyjq1iaRctlGbMuZsjJ9U2jXJu73XcPBxexwTkCRXn0oABbMB3fwAN0enHIJEwPp+5f4Ix4TbapNCFTRUhjIxUSkdEaFSep8iUNNXFOaVz2zS9MOvbpb3vIInxfAJ3lQB5sAAL24dgfz-Bd4grIDoUkVRrX1CF8ihGQzXECFymNLJIR4-U8jPC4LyHbDxyIbhYEVEg8H8EiyMou4f38CBsFkvMwFojVFwYhArCNCwNDSDFkODdRYTSEELAqC1sjDCEGlQnEMKLCSixw4gZLkhSPy9bBv0wdTNOoigdLndU6XowDDOWBQBTybtIVRNRTOs-IpDyVEwOEYRliNUTM0wzyB286TcFkh55NwfwAEEACFvH8AANXSYoZKxuyRMRDBsHiU3Eay7XjaNFgQ0xahcpoXTE0qryk3yaoUpqWoATQ6-0DO67ZrDsZQ5H2YVDthTlEoK+y2UcR1irKj57veCrltq-wyCgLotoAytkWkJRQPkMVhFMayLV1Dd8rEKFbWEO7xMWglKuq16unwdhi2pX09Nin7xBmFQDQxNE0n2azDgupNlwRLQVFh1z0PmjyEe6JG-LqphHg53ANPIJVMBIJ4NK0iKvv0uKrCtWZbUGjIjlUbceThMVEWEIMFCmgrHQ0MQ4YWyTEZehSlIoqif0wPQ3pwKAhiirHOqXZZ+W7TRu3SI0aBWM1E0keETW1gqoZKXWmf1lnDbqgKvzNi2f2wa3RZxxjzByK1gcTMwRTNQ7thNKbMWqKpamDgdHueqq2cCXASCYfx2FQNqE66nipGWcRFnVxQbOs-cfbkeZ5n1RwZBkYuHuZnzy5WurYCrmu6-8Tbbf-MWfrRCwhR4-K8eMGFFbsbW+KHpzoVBGa0LmkqQ68pbJ9esAAEclTU1GoHRxuHabcp+vyqb9TkPGzS1BZDkEw8F9QnVMKPLC18Da3wUkwAWZtqBLzok3fIFhh4rH2E2VE0IzRNhmCYHihxbSZDUKIKBpcb7IwUg8MAj5UAfn8OQcO7BYDvx2tYRKhxrAGitKiE0w1FZHB4hYSEthsglDUIdSh48ABKYBBBgD4CEJU9wOHizqFINEQZ0RpG1hUQwsJ1D8nSKkKE-clCHFkaHQkj9sA1wADJ4DALXVAqBfwoOxl1dWyhyglFBLaCQWh1iKyUDnTI+05BzBFIYGxMCbj2Lnu9Ii2A1IC3IG4jRiQDqJTbgaYhgMtEtksJIcCqgimOlBJQ+qAB3eSxFSIm1UiFIW4VKD+DwAAM1QAQCA3AwDtFwG+VArxJAwHYIIY2KlqKYEEN01A2TEBmURFUjIU0zAayEUUawQZJDditCTYEfc6azQzI9SQdSGmKSaTMtSbTtKdNwD0ggjwHikUkEwfm7AekPEfOMvwUzbmmzmQspZcJ0TbAhI6ZyyYO7WTbvybIHt4J1A4nE+mF8LlXI4O+T8QV7lhUeQsvpAyhkjLGRMwQkcCWgueYsrx9sDIk35GiRQ9goRBnyJlJQ+yxByDsKUAqNT6m4ppcFUKwsOkkreR8r5JAfmkX+VS8VP55n0vBSy-Z+oxDBjEJoTKpkawnVSG3UCSgRXXLWm1J5Lz+m4EGXgClgyqUkAAEawEEHwdVPTNXELKYdeCw9dihJ2SCVlGRUSn0dkXTF5zxI4oCNa1qtremyoeJ875vzlWAvdZ671YLGXbTiiTGYOQzV1FMPqLQI1ITSBNMKIS2sbCWtxda9aqbSUOvJaMl1uaPWCD0D6hlmNl6JwhXWuo8gKgRjxsaM6Hsy1VDtIPSFKEzl9lKomhqzUF6dvTZmhV2aAWTLzYO4dfrlwYI3gVeY6RIRnVShYYE8xg1spHnGzdHlt3vS6J2+1jrhm9pPYIX9ijC2jtQQGUtKRnJ5DDHaIxe8Kh+KbPqSw+wG35VbQEMD+6HjvIzfKxVfyQNgYvUW76yyeIXWyN1Kwag9WgyvXBrIcg-5Qhw-4F+6N-1kqdcBqlPH3gUcg946DPFtgpzMLg0ykEyY9Q9kKlQy4rBceE-hwjh6SM5smcJ0TpZxPMv9cYEwJpIRgS4nvUE-JX1aARGIfKBouMcweFzHmfMBaSvaa4klAGe2UsBa59zQVPMPEEA8iKBn5xGZLY7JKShrCHQSnIayUZpCqzmMKIJ-8XOcxfB5-mgsiURU03KrNSqQPBYK6ForEWSuUGi9FYtOT4t2kS3MTBUZrKQwy-1eYCH4NnzcozEuziHVuI8ROPo044iaoPMnBjRxMhHDyNs5ZU0aztYxFwliH6N3uTGy4ybmA7FKgcbXFJdw0khQyVkyjK9ln5URPsMw8F1DLoVkUDWSI8aOCyCCSh43XF1w8ZIEcuAOAEHmyofZ+TlsIjkCDRWawyhpHVm9vGwM0hA+O6DzA4PIfsGh1SQzTK4sFXKKkCUqIDzAlhD-WYKwJC2ANFW-UuOJv48kLgJVP5ptThCHNh747rC1GkFaMU1pmQGi+4gUEMwVwGOVjBDFB3RsPWBydyQAA5euAAFVAeA2EEHqhACAgRqJen8CwY3mr5jxnAWGUyixQSwnmMnMwwMsiKH+pzkH7iCd6-8Ib43sBcwRU8WJ8nlZNB7lkIijEWgTShsQAJKWJDShWhWJQiHUPwXGDrcnrIKg-5J7NGkKQcwhTLBRcsJ0n7DsPTz8Tyk0eWubBFPsqtVa5iyHgv1CvwYymuzmECAakpG8a8HAAFSu5wdJDxMl1wF-0YX7eqNwkOuYYESg7TolsPCCvqJ9mpQPJYY0PYp+XxLnP-AqTF-L96dcJJ-gtf4-t46JEmRuwrtOorBEPxfKYeOoLID2avShJUbmeuLSL0C8AAeVwC7UA2dUuW8Bn0ECgP6UEFgPYAQJtg30e0MgTyZxMGNAxB-0yFhDDEShSgqDFDnSCSgX8F538C6RIEoB6Fm3UjAHYL5gCHlQdXBSZF4iOARCxy0ChBsFEHd2WFP30TxhhkCTujIGwEfAVVaDcRt35gdWQIC0GVUPUPuEEDrkEHYMoHBUMRrC5EWAyCWCoJR0lkGikStCmhCRUMhyMM0PnkEO6F8EnDX0GE1Up3YngxBDUDwUViNESjRD4VMxWBqA8LUI0PwC0OUTCk0NJCLD0IEzGUMIVUUVMKyIHHBWzjETzmMDFF3Dl2KCOGYlUHZ1GjDC2DunxD8Mwn8EQP8AADEODIpCDx1BBQQBQTBrB2dtZlwDUwk7Qyk7B9UjgYJnBr9JB8j7gtDzDuh-NciDDPCCiTDUAzC+iZBSiTA+UporQRQN5rBYQq0-EJA1Bg1NADxrAkijCA82C+jXkCNysj1KtVjCiDiNjjiRcGR4Q-FFDqYchgxW4ZDhElMfY3sDRZcMhrRXiCj1jPj-CZshcgiQSAxIUBQmxNBpCCpg0ajFg2w1hNYBtwk6ZUJecMB4AogRsoAycO9GQKSJcikWIXZ1sOSWRbCDxHA8hh5CpWirg2TN8hitByhoZahNA-YoIEB1BVxORXsrB0QgwoFJSiCQREpi8TAKkFtd4ig-FDRgYzVh4LNIFlj4ZQ4dTx00RbQfZQQGDO5dgWxkg0Q8ZqdgJgwbT1cb8Hpt1pkQVvNiV6UHSfE1hZh1lFBVYahUgEVkg3Y4IPd8g1dz540t1RUAhVVWkGtfNIyYsY8jATFjUB8tFt8kMdl2MMFcp+thQRQuNk1U0oylwMcLAlArAmxDpTNkcw1RFjQoRWI2QTR9ssyv0S5t1202ySz2SxD+RkochlsMpFZ0RhRe57JdUTEAzJym9Bwf18A-0Fl2ydp1ZtgVh4Jy0qg8gmxQY1B9l0cUNMhDo6h1MXxX53g5zmtN8xDgEzNhQxRez5gyZYdgY1YhRgZhzhsGYgzDzcybd8tuZasvNItpVizfyiDVsgCEx0psgQQSgesxQyk1YnIdRAdbTSp39A8zyS17B14ShuwbB1A1hqDVAfZURtZrRaxLBTl9zp9JAaKwcW86Kcl9gQxppmKqhrRU8EBjljUVgqk3s5g9yWSLlhKCdec-kfwxLlkbAy0t49RFhZArNYxSkbBM9BprRZB-dtdg9Q87gmSsLRdjQW5uywRRiVA+Sa8fYOwdFHBXTMz1LxJRL5y-zDxmJjRTIMg24zBB9hFWwawjgOxNTnZKE78YBrtH83E9K4Q-Yylb0VALjgYBzO9+QEoFh5A2I5BIDoDLcBY8DMJEC8rrT-FoiClBEj8oi5gmcuVL8RznMqKiwWD64Ni8qmQShmJxzUhTIbMkzFZtYW4+Fw18oVgmw0TOBUifCdCwBWqVgBQhRe87QEyPZZC-ETB1AhRojOR+L1LVjvD650jZJMjMJWrNsoZhQ2N+oeJbA0sWQB51ZZrpErRNrHrtCyBXEAAKFhJgPQAASgmrEFgjkEUFL3UBpjOk5GfRBGSxFDxgnPut2K2qgC0N8P8BhtQDhvhopthoRqRokC5LRp5MxvXMdCXLDGsBXObjtE2vePGvCuwqqGYl4QgrDE3GMRjPuKBg7kOmwxcCcCAA */
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

          'new state 1': {},
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
            onDone: 'Sketch',
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
          onDone: ['Sketch', 'Sketch.new state 1'],

          onError: {
            target: 'animate to face',
            internal: true,
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
        let ast = kclManager.ast
        if (
          'variableName' in distance &&
          distance.variableName &&
          distance.insertIndex !== undefined
        ) {
          console.log('adding variable!', distance)
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
      'add axis n grid': ({ sketchPathToNode }) =>
        sceneEntitiesManager.createSketchAxis(sketchPathToNode || []),
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

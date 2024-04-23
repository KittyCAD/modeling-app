import { PathToNode, VariableDeclarator } from 'lang/wasm'
import { Axis, Selection, Selections } from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import {
  kclManager,
  sceneInfra,
  sceneEntitiesManager,
  engineCommandManager,
  editorManager,
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

export type MouseState =
  | {
      type: 'idle'
    }
  | {
      type: 'isHovering'
      on: any
    }
  | {
      type: 'isDragging'
      on: any
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
            planeId: string
          }
        | {
            type: 'extrudeFace'
            position: [number, number, number]
            extrudeSegmentPathToNode: PathToNode
            cap: 'start' | 'end' | 'none'
            faceId: string
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
  | { type: 'Equip circle tool' }
  | {
      type: 'Add rectangle origin'
      data: [x: number, y: number]
    }
  | {
      type: 'Add circle origin'
      data: [x: number, y: number]
    }
  | {
      type: 'done.invoke.animate-to-face' | 'done.invoke.animate-to-sketch'
      data: SketchDetails
    }
  | { type: 'Set mouse state'; data: MouseState }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AdgCsAZgB04gEyjhADnEA2GgoUAWJQBoQAT0QBGGuICckmoZkbTM42YWKAvk91oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEFTU2VJYWFxDUNDbPFxCQ1dAwQZO0lDW3EcuQzlBRoNFzd0LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5JTJVUNNBUNlLQ05YsQsjQWNLVE5Yw0aZXFmkHc2-ElsCEwwAgBRXBGAJ0CAaz9yAAsxqITOK8WYyZTCCpg1JaKw5cFFfSIGSmXYaLKyPI0UwKZSmC5XTxQW73R4vd5fH7-QyRZisSbcEFCaw0STZRaiNTiNQ0YRbBAnGSSWzCZSiKz1QziFbKfGtQnEh7PPjsN69DAA2mxKaMpKieSSZE0US40QaUQrPk5DkGnEKFIcmz7QyyjztBWkvgsN7sDXROnAhJM9Q25llXIo818jKGBZiLKihoyYRml3XIneb7sP7EMiUTAZym+oHawMIHI4io8-YNBpmWSWpYx8srSWWBTm1PygtZ36Sbt-ACSJIIyBI30CYCgXTAr38ADcwN7sOQSJgi-6SzMjMimwoZJoRZoaEnLXlpDQL3IJEmlE1XJc5W7+73n0PFaPx0EpzOAr9UG9sAAL24IY13ocYNwZUsrGTBY1FUMUYPBGRLWqGNTXkSwzmMPUZE7J9Mz+PtCN+N9HiIbhYBVEg8H8P8AOA15V38CBsCo3NRnAwFIOmfht1NCwNi5bEslMJYFD5GQzDSI09QvM0xMlfCbmfYjKTI4hKOo2iFyXFdMBYtihgoTiaT9LUoK3MswQUIVDnbVZsjUDZJKTKRDmyA8MjBU1lPTEi1J7DSKNwKi3ho3B-AAQQAIW8fwAA11ws3jEisdtWXEMRw2qZEpMk0wBMK8EGmPURTEyc57wJAjKUCwdhxCsKIuiuL-AATWS+lUu3DLrDsZQjmNY0UMRBAuWDYQrzFVRHH2Pz6pfEjgq08LaLIKAHi6gMrMlNFpCUPd20UQxhFMSSOQhORjoyY0zoqhbVNfRrVpah58HYf4uM1bqdUlLLpFFVQxNkapREk5QlnSXFsjO6sVGER6AuexUmu0yKmEXTHcFY8hekwEgPlY9iTO2zc+Os-dWRSXKTiWVRlEklZdmESo7W8-YNDEJG6pR8jXto+igJA1dMD0fxV2wKBcDJyyKfFQV22WQpTVOcRLRmg1Cq8pNjXyHme0WlbQvR+dF04fSxYlnBpdlnrrLOzL9zOmazDFS1BtESRzQq7F6mRRwqpaV0VOR5aXpNtbItgXASCYfx2FQRK7b+6opDBKU1AqvczEkxpBTKY1lGLo1HDKA2iL5zTI5amO44TpPOu+8zfugtOLBFaoMiy45JNyCFTTL8rTo0NYg4fEP-N58PUYFyKwAAR16Zj3qgT6U+g5F3P7s7hCNOQsstTIWTREwLyNIG8Wqx9Q+n9SI+a2imEJ0XqGb4s5bS2QIWPDPDHKrII9LSmABiYaokMUg8jUKICuS176zxrrRN4YAegLn8OQOe7BYAb12tYWykNrAjU0P-HQY0ljVAsKsWwjR8jwTwtfSei0jbDgAEpgEEGAPgIRegjBwfLAoUhJSLGmmIRmY1UhpHKt3c0VgxKNFgcwxUTwl7YHjgAGTwGABuqAwJmQ-vbJYqRvb5DWPaLI6g+RKC9pdfqchR6IQUVXZRvRVEJw2j+bAzFCbkAbnwxIdg5CsixEaQq+RR7qzIVnA0eoVCnD9kaceNVb6GycSo+OyDQgbQeNo3REEUo6jKGIA0xhNDIn2ByCJJQrCWFZAHRMW9MiOJnqSNJ6DsBvHINkxOOi-FImRGkUwJgzQtmPpkI+2RikoilKkMS7YFFRQAO40V-P+YWTEDLE2MpQfweAABmqACAQG4GAW4uA5yoG+JIGA7BBBC0YqBQQezUC9NKFyVEo8TgVTMBVMZY1rCVEkO2fcUkqFyHBPMpZHA6KrPucxTZHEdm4H2QQRcbx-ySCYATdg+y3hdCuX4W5MKRaYEeUi5578eIFK5F7HITo9r2QqpJKUgpGinAvAUJMkMIXLLNnpOFRkEVPMOcc055zLnXMELpC2q5SX7JeSCwUkoTomHBJUE8fz9xSEcIcQ4-1Tr0ODmmJhiyeVSuXPykm2yhWovRZi4YOK8USrNfpWV5K9GUtLAqwFRoxBiTEJoVyGwKhA2PFKI6ShuVQtivFBKiLkVHNwCcvAYqTkSpIAAI1gIIPgrr5XgOhjIS8B9Ix-NSIqk4bI0RgjcpGgI0bEpxoOTat4GKsUOvxTcjNWac1PLzadTKYaCiDMHgVVY0hzSimqI0ZMV9DVdgCiaqNbV2qNuFYm0VFzU0Eq7YIPQuaKX5M9fmgo8g9S2BAcmcGY0uTgmpnaDk5pqV3jnbVQ2i663LtXc21t9r-yOu3Zm3d+73WHqsiCn+nKspgjOGyPk4DdhxOLoXJVBqJ5GtUu+iW+BslCoTUms5m6O2CCyew3tB7W5ga7ueHIHLyqFUMBdY0QpqWWH-hOjItasObS0dat4aKW12uxX+ojJHgN5IoxTEFtk97ZH3NUu0p0Lr9po5hOQ+9wUMPQwuyFARV6fVXXhjd4qCV6d+GJ7ioHJNgydmYWGGxjy8j+fUL2asu4qFOlYTjpmv18dtW24TErTPmZ+jtKzY7jAmBkfULmo0ShgiDUhrQKIxC3RlJp+ddVMOYzeNjXG+NCaGUtTxsla78MpqI9l3Ly58tvEEPCkywWW6hf8dWuyShrCDRspsP5e4vY91HqKe0B9OOVZnHlgmRMBUmR8-xn9QncUVaxmN6rE26tTcoI1-RBTWvawxJ1-2V64sZAhP14udGdWJJvlPQ2GjE05OeK04yMBXieIMt43x5HmtIjOgM5mMm6xnUqYgbOQTqhaFFFNSGCgFG3a0d0zAD2XHpJCE9rpqAemffJi1opdhnJlLNCYBseoFgRdUA51mqwYeaPu841x5B2mdLh+j3JFmJOJC7rsCRYpdVSRmkfVmQTLAgKWI0ESVO7vw8kAOXAHACDyqkmkQ6YoGgojkOdMaEoDTTLMCYDIVRxdM50VLmX7A5fUnE190oSZBQcjk2sapuIoyO3CRIWwxpBlGgNzkyQAA5JOAAFVAeAsEECihACAgxCYBBYMH+VxdOcX3KhsBoaw+TF3MGiX2e9FCHS95Lv3-hA-B9gDmEyLOQtY6MJocwJgpJ7ixAcCxY094xhsBA-I6UzgKOl7Ll5xgx0HD3rEw4DfLRSSkKPEUYI2XxedOl19REe+m6oOb1nlucIxjtME8JhbLAIiqTudI7Z4zihsCoBRAAVdxL2vEdIboj1xsOclx-2JlHk7ZCqnFi8D0e6Qpq873lOEnwUV6BxiTnYm9GfAAHlcBSsjMTkopvAL9BBQCjlBAID2BoCZZMdP4jB8hbJDhMhFJ9gCg1A+RzQWRUhKhnJMglAsoFE2FMlsNDcEdad456cOk0cMcQM2dtgR4hRi41hWNCp5BHMqlAChRp89wppR59wYF59kkiJGDUcWDJB312h-BVkoA8BQ9w9-AMkVDNCAJtDsCeDLcykYwUgA5ZBwRi4GMyFbM-8SFzRkw9wuYFEiAGcuDWDWkDCSNn8cD7ZCkvZcdSkUQCcgcyxaFvYpIAl9g-V9YFDrsiJPDODVD1D8AjCpYdCw8I8ODGcsiTD5UURFckxZMO91A0RgELwDRZDhRGglhYF-BcAk5dkSBKAfBghQgWIwA2j8Zo8CZE0XlBA7BdwpkMhwcZ1DtEBBpFcrB0R7oRQbAFoyBsAuhhgNDE5-A7VE04Dk1CNVj1iRhBBE5BA2jKAXk9Rdx39WVf4eQ08qZcpaF9wKotBockjJBDiNjMitjOEjINDYASI9iCNLkvjjjTjATCxAidRPYLBq0zoVhTQoM4MoZi5aDUh1Bkt3j7wWiMB4AogkkoALdK8kgGgYxZB5AlBZplhIirQDRspOQOtYZUNCT3RiTcCkg1gCDwQvlNBzQuZLEVhjE1B-4nihdYF2T7YMTWRjoVV95R8-ljxvZsQyp2wzRk8ml4EwBJS-oTh05Xizp9wzQESGwUQKhyjXMh9LtGEMMdNoUGJiVCstlit9kdToJbRWRPlFBWYkw95v9XlbBpAzQuRThcQkw58X1FDexMNnULVnTG03Tdp1BFUydJQJBBoxJXJrRjxPJcgzsxRON61Y0nlEz5Y7QpBORZEVBccsQCoKEzQSpFgEI9xCzP0Sy18STDEbcjTqgGgXJr1TgQiRFypkzZ00MMs307T-D2yK8OTDEvYzh5J8hsRDgQELo1BAU689RVAp8CgvMZw15fgEyOy5yt9QdhoVgQFBCIYVB0gxJsQRQ4Y9YRslscYVsCt6srUyVSy0p2w0gfsOQjw298hJITp0g2Zh49Qfs89mcfykR7AO58DTRsRbRyCoYpouRToqSNglIPjVIn9Jcl84LSh-4YweQkKbB1B6g09AzVgYNwlBlR4xzWT8LqdJcWjcVVxiLrAKpWRu5DRawygowak29KgO99wzgWSrsmECLmdfcA8g9Xh8TZygjgybQwcVha8VBIip8bQchJQlgliVgYKjdE0FlI8Rh-BDBuKcQINnJMKzRVh-SGZBIAF0zJLrBu8TdiKcJzA1hTRmQpQzBcgGwhTmwaM2wOw8KAor98APFb8fFE5uKXCLBmUNhZDIZR5LRBy9gKoRzs8rCQCwDI9ICSIYCfL6hzAJBB49ZH1kRyDf9R41UzQ7o-yGCUd-D4duLVBFU1BrdQ1RR1UD9VASdbA7FJRNVmLpLVJlDOq5KMioAJwMEcZ0F-xE03hurrQSl+qFdCCNZcRpBq0YR3dsQpqbSApZrmDvcFrCi8BuqhTtUXZHy7DUIzToxzQXCtBrBEZoq6pUiCiuqTygiRz0gJ17Eh4xFxCzAKh-4vlIdaYPCvD0idMNDwpWJ+htjFL2Burf9-U1gEwppjQ84uZNz9xet0rljfrDZ-rvC1CUbMitC7qgaCkSoYjIYrTT998q9MgDR-ZC1p8yj3jIzkijyWj-BzjtTmbSwRj8gFhzR+aNg1h+a+QuZ04Roy06g6wViZcjjNik4djJaVK-ozghQRRGLCofTTgHiZIw0RRB4JofrhbPidbvjFrfi+B-jMjISewfLeLREIdjxchqhbAmYWQS4t9mQcR9wXAXAgA */
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
      mouseState: { type: 'idle' } as MouseState,
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

              'Equip rectangle tool': {
                target: 'Rectangle tool',
                cond: 'Sketch is empty',
              },

              'Equip circle tool': {
                target: 'Circle tool',
                cond: 'Sketch is empty',
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
              'Equip tangential arc to': {
                target: 'Tangential arc to',
                cond: 'is editing existing sketch',
              },

              'Equip rectangle tool': {
                target: 'Rectangle tool',
                cond: 'Sketch is empty',
              },

              'Equip circle tool': {
                target: 'Circle tool',
                cond: 'Sketch is empty',
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

              'new state 1': {},
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

            on: {
              'Equip circle tool': {
                target: 'Circle tool',
                cond: 'Sketch is empty',
              },
            },
          },

          'Circle tool': {
            entry: ['listen for circle origin'],

            states: {
              'Awaiting radius point': {},
              'Awaiting origin': {
                on: {
                  'Add circle origin': {
                    target: 'Awaiting radius point',
                    actions: 'set up draft circle',
                  },
                },
              },
            },

            initial: 'Awaiting origin',

            on: {
              'Equip rectangle tool': {
                target: 'Rectangle tool',
                cond: 'Sketch is empty',
              },
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
          'engineToClient cam sync direction',
        ],

        entry: [
          'add axis n grid',
          'conditionally equip line tool',
          'clientToEngine cam sync direction',
        ],
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
      'Set mouse state': {
        internal: true,
        actions: 'Set mouse state',
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
      'AST extrude': async (_, event) => {
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
        const selections = await kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
        if (selections) {
          editorManager.selectRange(selections)
        }
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
        engineCommandManager
          .sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'default_camera_disable_sketch_mode',
            },
          })
          .then(async () => {
            // there doesn't appear to be an animation, but if there was one we could add a wait here

            await engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'default_camera_set_perspective',
              },
            })
            sceneInfra.camControls.syncDirection = 'engineToClient'
            await engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'default_camera_set_perspective',
              },
            })
            await engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'default_camera_look_at',
                center: { x: 0, y: 0, z: 0 },
                vantage: sceneInfra.camControls.camera.position,
                up: { x: 0, y: 0, z: 1 },
              },
            })
            await engineCommandManager.sendSceneCommand({
              // CameraControls subscribes to default_camera_get_settings response events
              // firing this at connection ensure the camera's are synced initially
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'default_camera_get_settings',
              },
            })
          })
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
        sceneEntitiesManager.setupOriginListener('rectangle')
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
      'listen for circle origin': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setupOriginListener('circle')
      },
      'set up draft circle': ({ sketchDetails }, { data }) => {
        if (!sketchDetails || !data) return
        sceneEntitiesManager.setupDraftCircle(
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
            filter: ['face', 'plane'],
          },
        }),
      'set selection filter to defaults': () => kclManager.enterEditMode(),
    },
    // end actions
  }
)

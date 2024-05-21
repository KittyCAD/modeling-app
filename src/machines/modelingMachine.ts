import { PathToNode, VariableDeclarator, parse, recast } from 'lang/wasm'
import { Axis, Selection, Selections } from 'lib/selections'
import { assign, createMachine } from 'xstate'
import {
  isNodeSafeToReplacePath,
  getNodePathFromSourceRange,
} from 'lang/queryAst'
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
import { Coords2d } from 'lang/std/sketch'
import { deleteSegment } from 'clientSideScene/ClientSideSceneComp'

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
  | {
      type: 'timeoutEnd'
      pathToNodeString: string
    }

export interface SketchDetails {
  sketchPathToNode: PathToNode
  zAxis: [number, number, number]
  yAxis: [number, number, number]
  origin: [number, number, number]
}

export interface SegmentOverlay {
  windowCoords: Coords2d
  angle: number
  group: any
  pathToNode: PathToNode
  visible: boolean
}

export interface SegmentOverlays {
  [pathToNodeString: string]: SegmentOverlay
}

export type SegmentOverlayPayload =
  | {
      type: 'set-one'
      pathToNodeString: string
      seg: SegmentOverlay
    }
  | {
      type: 'delete-one'
      pathToNodeString: string
    }
  | { type: 'clear' }
  | {
      type: 'set-many'
      overlays: SegmentOverlays
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
  | {
      type: 'Add rectangle origin'
      data: [x: number, y: number]
    }
  | {
      type: 'done.invoke.animate-to-face' | 'done.invoke.animate-to-sketch'
      data: SketchDetails
    }
  | {
      type: 'done.invoke.get-convert-to-variable-info'
      data: PathToNode
    }
  | { type: 'Set mouse state'; data: MouseState }
  | {
      type: 'Set Segment Overlays'
      data: SegmentOverlayPayload
    }
  | {
      type: 'Delete segment'
      data: PathToNode
    }
  | {
      type: 'code edit during sketch'
    }
  | {
      type: 'Convert to variable'
      data: {
        pathToNode: PathToNode
        variableName: string
      }
    }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0AdgCsAZgB04gEyjhADnEA2GgoUAWJQBoQAT0QBGGuICckmoZkbTM42YWKAvk91oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEFTU2VJYWFxDUNDbPFxCQ1dAwQZO0lDW3EcuQzlBRoNFzd0LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5JTJVUNNBUNlLQ05YsQsjQWNLVE5Yw0aZXFmkHc2r07-XygusFwAgHkANzAAJ0wSPVgxqITOK8RI0LYIGgXK6eKCSbAQTBgAgAUWeX0CAGs-OQABYA5isSbcEFCGTKYQVMmpLRWHLkor6RAyUy7DRZWR5GimBTKUxQ1owuEIpGokafTHYvGGSIE2JTElJaw0STZRaiNTiNQ0YTgk4ySS2YTKURWeqGcQrZT8jztIWIlF8difXoYfHRQnAhJCUTySTMmiiXmiDSiFbgnLqv08hQpdU2faGa3XWHw+3IvgsT7sN1A+VexXqKNKsq5Fmh8EZQwLMRZY0NGTCENJwXeLHsXHEMiUTCtyU5j15mZGJZpYyNrRasyycNLKs5dQ5TVLUPN2299s4ggAEWCI0CYAeT2z9HGA+J+bBjIhq-wknXHfIrX8kA4-ggvU+7QlG-7cvPQ4Qc0QwqfZjQtMpA32cEWTSDIyhUMl6gUCQb1he8cTvNtcQASWFAhkBILF90PZ5-A+LNsHIEhMF-Ilpn4IxmTnBQZE0I1NBoBtwzyaQaD4uQJAbJQmlcS4BTXLCMPQ3D7QIoighIgIcVQT8AC9uCGGiT0BM96MSKxGwWNRVBNAzyRkcNqirYN5EsM5jB9GRUMwyUXI3GSkSIbhYCdEg8H8ZS1I06i32wHyu1GbTZTohUrGDCwNk1bkslMJYFHBGQzDSAMfT4kNUvNZz0LcnC8K83AfM+PzcDIr5OCozBQvCihIpld0-z0xj6gNQ5kNWbI1A2DKGykQ5sjYuDjRElobVvYrpLK7zfP8gBBAAhbx-AADVoz0AKsZCVXEMRS2qZlMoy0x4qu8kGk40RTEyc5ROhCTXIW+1ysq6r-HWzaAE1dsHBjANY0Q-Q2VYjkDQMLKvTVC2EASTVURx9iKySSpxDziCWqr-LIKBESB-8QaAqQLXA5DFEMYRTAy9UKTkamMkDOnHox97JJxr7lpqxF8HYPEovamL83NY7pGNVRUtkapRAy5QlnSXlsjp-YlHJTmNyxnm8Z+pgvkN3AIEo3ofnFU3msoEnOtB1iVRSM6ThHU4MpWXZhEqGM4P2DQxG13FdcWiq+YClTsHU55qMwPR-Go7AoFwW3YrJfVkOWQpg1OcRwxRv0romhtA3yQOpO5kPvv88j6pjuOE6TlPxYbcw2VYumUbME1w2UORJFDR7uXqZlHGembkyx4PPv1-zYFwEgmH8dhUG2pv9uqKQyQtNRHpYswMsafUIOUE+TMcMoy6nzyZ5queF6XlfAZF3NSf0jeLCNaoMmO44MtyClgznwerTDQawx5iVmmhTGH1r6h3xjVMAABHXoIUBZQCFmvMmzJRr-zpsIAMchjrhkyMqNkJg+IBmlnyF64k5rQIrtPOBBsSBVUwIiLSbUX523NA2CwZR7IPSyCA8MphJYmGqErFI2o1CiEvjA3GTD-KfDAD0D4-hHyKOeP8Z+ulU5aAWFYEMvdNCGFDLnK8SxqgWFWLYRo+RjJORoZAye8iABKYBBBgD4CEXoIxMH6V6v3M4yECgnxLDqCxJhwZkNEYUUBORhByIYSKZB2BF4ABk8BgAfqgDhp4OqxRjGkCQKgbBXSyOocEShwaM2sBBUBpkkmShxsiVJi8hj4CPNgEKLDyAP38UyOKKouQBnKbWcxJRjAxj9D6FQpwh4BnAa9OhXNml4Vab0NJ-hlGhEJoiHJeSdIFPzGUMQfopkbBZCGEw4YZCWBVCPes2DMhNPcnhR8GBnymwCO+T8+Bvy4gGYBLI4NcghjEGsVicMSjcgUNIIRVkJDe2mhAie81kkKJrg-MiLDukACNiY6OOevQ41YljrCVlyBkJRZDahVGOGMthuRXUvitAA7n5JSEco6aSah0yg-g8AADNUAEAgNwMAcJcBvFQFiSQMB2CCECpHYKmBBDCtQECzKjQVSgJOI9Mwj1MgZWyOYZCUKJG2DZqyjlr5lU8pClbfl2SNUEC+J8FSkgmA-HYCKz4XR5V+CVdy1V6rcAiq1ZqUFYLFwhlYo9DK4EEqnD4gUBsSsbWctqhRBqfKIqCvDaK8VuBJV4BlXKhVgga6UWomGiNRKxYAUylYCox0VgmHJJULiV4yhKEkI4Q4hwJa00cePFsmN2VZurbmp1+bXXus9d64YfqA2VunbWjVkaW0NHkMAsQmhhobAqNLTiFoWLqCWbQqBrlJ2vj+ttAtIqxUSqleWyVlaSB4tgIIPgdbNUNr2iDZtsFe78UIeWHtqR9S5EaP1WQvcXlOLRRO21AR71bUfaKhdnwvU+pXYGxVn7v2-s3QB4GiRm0UjZGegopgAxaEuqsaQoYwLHEbNQsdb0da3rQxtfw-1MPPpLa+2V76g1EcEHoP9W60gFF3Q9Z5IZwSanJI7GM6ozH0czXevjAn52fA9ThpdvqVKrvE1+yT0myOvyZF-Phn8kYnyEcoZT-ULC8jCUcY6o7UXjpvah+O+B9muuLaW6VomCOCD2R40jnDdEnLs0uc0g7YyGAZoGA0UbLCmJYxkbTARouCew7h5dpnIvRas3F4lQHqhwvwdkViVgd60wZrTCoyX8FyAIVrJDfnuMBbQULQToWRMVqDYNnElX8mNpq6Yo6mUWQgLud2koZJDo5y-ioWmVh8v+Am0Vgzi68NlcrRNqbRyZsUYkRUVNoZVhsWhUySFCxe5aBZGIVmVpetcaDjx-whtPjG1NuQc2LC80tWGy+stEXK0A6B2bC2ghZ0tXO9FQDFG049SUNYXua3Ng9pYuDH+oDjSxkIbtuHTxgeg8tmFZ1B3DMlZM-6yLlOTYI5YUjunEVUei3R0yTHhcOS4+HgrHtGQKTE5Pg9K65PvsrJ1pkktByURtKXoTLpPTPh9OXlqumaRuT-zsaIumEzEC72GdULQxpHNLEvkr7Jy9cmq82YvHZHSiaO9QLkrVxdzlciyF7U904LGmNgkjYw2p1AmjkPbrJBzJDYVwBwAgvuVD9otCaBoLI5D0yvGaP0FpRF0eOnTTKcfldO8wIn5P7BU-Smm-z0oDZ9Tqka2sJrvIKx0xVGcCQVreR8VkfL69iv49V8kAAORXgABVQHgdgsACArQgBAQYLCAgsAX1qk+uw6Mwxzw0NY4IT6tzMHgqPSgFAV697kqfs-59aM7C1Q5aPyNGE0OYEwmUWJUozulK8fBKsGwSRfIA6M4S+JPFPIFYwJjA4fBOZQ4KlW5fIXvI0MkFNMkbISA2vevKrS7IwAMKsGMEZUBWlSwalRiVKdIEJeJLA0RL7TjBXIOAAFQ12eG6Ual6Qfhdy2QdwOR332COijwenVF7mglAXSCRkylslOFAUSRH0nl6BNhXnCizHQheFwCEzCzfUkBWm8BYMEGUPFUEDUPYA0OTms24XyDhUOEyAKn2AKDUHBFDGVFSEqEGkyCUGOkvncV2SC1v2rx4y-AjigDwGX1X22RCA932VCLwEwUmWyHBgXBWFYmqD4gTSA0cGKU1CMRSC9hjEvnIERDIECB9SRBgOyF2BMh9HNVyBKRnHNAsFOGMF3kNR20UOKj+w0SxWXhxU-E-XtGK2M3w0rR6LqkEGXirVxUGJi0LV90cGsXNTAK9h9DFxpU1AphsRSFYlRjUDLn8FwBXiFRIEoB8GCFCDfDABOPNk3x+BLSBUEDsGYhZFL2t3Y3WMQF7jSFSPZHZiNBsGcjIGwC6GGC-D6KXRLW0NG0lWBNBJGEmNQEEBOJtisIVB9GYij0aDA21BPwdjOnsXjUbHUCBOT3hPBJXi8Tpy-FgEkmhOhzlThOGA8SmNpL7DRPzF7nBk4gQ0N2DG81czhRPi8NSHUHe2v06JQyzXGKzGxTeBmIJSRBGwZLE0VRlMVSmPlIGMVN5y4QVFOWjUaBN3bSVk+IQFkEqAqFSBlje0MWH1EiOIwHgCiGWSgEb3fySAaCrFkHkE1jUGWDN09IAQoTWFPlEQKBRVdLtDAHdJsySDWFsPJANU0FDH9iqRWH7gRlMQJMsA418x+xxFjLtlFJVGpg7QIWQJ7RMANCVnUADCINMQlKYNHyDhgSLNihOE3ken9lsBTLpgAMmUqF2FyCsBU3yAQMvWcS6IC3tVVXBwFQ1XbPFmjF1S5EUC9gbE60TVsGkBDE1FOF5AbETElP8ynTqhrUamRwXMLSXP2nUGg1UEsAKAQlSmGkjE4nGlyGlxNF23Q0w1vLJhjCkA1CsAYLsAyMuisSMUUEWDPh8yjOnKzXvT0xvIuybyWB3N6jZCWEPmU1OHBggh9DEFhWZF20K0XLQo9IwvBjODynyG5EOFEQZjUH7R-x9FUHQIKF232worfzjIwtISiTrEqBUBPkVnTzpm9iNHVhLgpyNipw51p2thdVQr4u4WQlglSHVA4hAPyAyhpnSG9mASItSBvwOQAoo3sA-hsODFhXqBcIzOL0cEGnqGkLMonygPYAssGRNGsszxsHUHsvzx3NWDOFAjMEaF5Hcu92ryOP9Wom8tKBsCo2-n9AaFkEewQCAMdlALOh5FkGirv2n38DnwX2dLUv1L3KjCt3bTljOArF7ijByHNCWABJWBwI4ESocnMDWGDCVEplSkoMAlnHawXHNEsAzkvjYM6Q4K1x11QESuZgpBMBYg2FATJC-PDHwr2EegemcvZngqvSUJUPX3UMkk0K6vqHMAkEARLjMWZBcMkPiVsBDDZg0t8OiMKyr0WokDSF6sbF3VqzdgsUa2kBWCUFOEtADhPJ1j8JiMCL0NQxpJCG4DX0fE+BLU+B+s0D2HkHBSRSPzzjoyOjWBOhaqUDzIQsxjhq+pisRs5RCM-DCPoj1JOSVjSDyCpGSowu4jmxSIOnSLXKKJKNvnKK6qnH7kuUemsFkFsC2rOBrIIUZhsV23VLlIVMRC6o0v7TyjMXlm7nhjKGVGfNlzLEkSbPzOYJxEOOONOJjMorjKeNQLrGWw2EhU4l1EyBmV7igzqCnFJJBLBP+QhPuPtoqvFgVsekHxsHkE7zxOyjPSNEAQRgUObMkCZM4GDspL4GpP+TZI3C6senSEDBt04lyGqDloJ2VBPh3g-IcQlJcCAA */
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
      segmentOverlays: {} as SegmentOverlays,
      segmentHoverMap: {} as { [pathToNodeString: string]: number },
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

              'code edit during sketch': 'clean slate',

              'Convert to variable': {
                target: 'Await convert to variable',
                cond: 'Can convert to variable',
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

          'clean slate': {
            always: 'SketchIdle',
          },

          'Await convert to variable': {
            invoke: {
              src: 'Get convert to variable info',
              id: 'get-convert-to-variable-info',
              onError: 'SketchIdle',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set sketchDetails',
              },
            },
          },
        },

        initial: 'Init',

        on: {
          CancelSketch: '.SketchIdle',

          'Delete segment': {
            internal: true,
            actions: 'Delete segment',
          },
          'code edit during sketch': '.clean slate',
        },

        exit: [
          'sketch exit execute',
          'animate after sketch',
          'tear down client sketch',
          'remove sketch grid',
          'engineToClient cam sync direction',
          'Reset Segment Overlays',
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
      'Set Segment Overlays': {
        internal: true,
        actions: 'Set Segment Overlays',
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
      'Can convert to variable': (_, { data }) => {
        if (!data) return false
        return isNodeSafeToReplacePath(
          parse(recast(kclManager.ast)),
          data.pathToNode
        ).isSafe
      },
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
              type: 'sketch_mode_disable',
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
            filter: ['face', 'plane'],
          },
        }),
      'set selection filter to defaults': () =>
        kclManager.defaultSelectionFilter(),
      'Delete segment': ({ sketchDetails }, { data: pathToNode }) =>
        deleteSegment({ pathToNode, sketchDetails }),
      'Reset Segment Overlays': () => sceneEntitiesManager.resetOverlays(),
    },
    // end actions
  }
)

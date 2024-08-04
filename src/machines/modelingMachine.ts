import {
  PathToNode,
  VariableDeclaration,
  VariableDeclarator,
  parse,
  recast,
} from 'lang/wasm'
import { Axis, Selection, Selections, updateSelections } from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { SidebarType } from 'components/ModelingSidebar/ModelingPanes'
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
import { deleteFromSelection, extrudeSketch } from 'lang/modifyAst'
import { addFillet } from 'lang/modifyAst/addFillet'
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
import { err, trap } from 'lib/trap'
import { DefaultPlaneStr, getFaceDetails } from 'clientSideScene/sceneEntities'
import { uuidv4 } from 'lib/utils'
import { Coords2d } from 'lang/std/sketch'
import { deleteSegment } from 'clientSideScene/ClientSideSceneComp'
import { executeAst } from 'lang/langHelpers'
import toast from 'react-hot-toast'
import { getExtrusionFromSuspectedPath } from 'lang/std/artifactGraph'

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
      updatedPathToNode?: PathToNode
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

interface Store {
  videoElement?: HTMLVideoElement
  buttonDownInStream: number | undefined
  didDragInStream: boolean
  streamDimensions: { streamWidth: number; streamHeight: number }
  openPanes: SidebarType[]
}

export type SketchTool = 'line' | 'tangentialArc' | 'rectangle' | 'none'

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
            sketchPathToNode: PathToNode
            extrudePathToNode: PathToNode
            cap: 'start' | 'end' | 'none'
            faceId: string
          }
      )
    }
  | {
      type: 'Set selection'
      data: SetSelections
    }
  | {
      type: 'Delete selection'
    }
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
  | { type: 'Constrain remove constraints'; data?: PathToNode }
  | { type: 'Re-execute' }
  | { type: 'Export'; data: ModelingCommandSchema['Export'] }
  | { type: 'Make'; data: ModelingCommandSchema['Make'] }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Fillet'; data?: ModelingCommandSchema['Fillet'] }
  | {
      type: 'Add rectangle origin'
      data: [x: number, y: number]
    }
  | {
      type: 'done.invoke.animate-to-face' | 'done.invoke.animate-to-sketch'
      data: SketchDetails
    }
  | { type: 'Set mouse state'; data: MouseState }
  | { type: 'Set context'; data: Partial<Store> }
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
  | {
      type: 'change tool'
      data: {
        tool: SketchTool
      }
    }
  | { type: 'Finish rectangle' }
  | { type: 'Artifact graph populated' }
  | { type: 'Artifact graph emptied' }

export type MoveDesc = { line: number; snippet: string }

export const PERSIST_MODELING_CONTEXT = 'persistModelingContext'
interface PersistedModelingContext {
  openPanes: Store['openPanes']
}

type PersistedKeys = keyof PersistedModelingContext
export const PersistedValues: PersistedKeys[] = ['openPanes']

export const getPersistedContext = (): Partial<PersistedModelingContext> => {
  const c = (typeof window !== 'undefined' &&
    JSON.parse(localStorage.getItem(PERSIST_MODELING_CONTEXT) || '{}')) || {
    openPanes: ['code'],
  }
  return c
}

export const modelingMachineDefaultContext = {
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
  store: {
    buttonDownInStream: undefined,
    didDragInStream: false,
    streamDimensions: { streamWidth: 1280, streamHeight: 720 },
    openPanes: getPersistedContext().openPanes || ['code'],
  } as Store,
}

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeRJothBpzlsvPDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd6IT4GbG-VoAiTYCCYMAEACiEPhgQA1n5yAALVHRdFvBJCazCOQSRSctQyKS5RRqFTWL6nNTSfnSsS5FRiZT4-7tIkksmUkZw2n0pmKSJo2JTLFJWwLFSOBy7WQ0eZFXEIczWCRqaxyOq81KKAWOJUeFXE0kUx5w3oYZmvI3spJiOQyZ1mZQyeUyRSC4RfXmndKOKRyWUpmqKX1XKCqwMAMWwmFJT3o41ZkZmQnzEjsgoVXPE2TtJS9KmEPNjuZsKbkDmLhID6r4LDhtf1LMNmKjgjEdXSrtENuEihUcjUigz-cUEhqeaUwmsqavE-9aoIABFgiNAsFQlNww3l02kjvytoEzHVNzUUMQMxjcoakvawD0cRRlDUW98Akbw6XYRliDIShMFQnVPyXaZ+EQTM41sJNOTXD1bAzYUFhoYR+x2GN9xoGQkNLXD0IZR9nzAV9QXBed6wI405DzZ0YLEJZ1DHZYZC+eVuQ0cx812Bj6PYlC0Iwu4MH8SAOH8CBejhdptS4-CMUIxIvRdUw9zUBQtAYswe0QaUJHEVJnKyeCRU0zjGS0nUAEl72QEg6X4sEIX8WE52wcgSEwSy2R-L0BVPVN8h3BjnKPApFnlKR1HmZYljY5oCRVQKGWCriwsDCKoqCATYoZVBTIAL3uZLUsbIiEC9K90hUYqdn5SoVAzGwzQPKT9l8mhxyq5VkNq+rGUaskiG4WB2DhEg8H8Drut6zAjOwfasNGOsXi-aziPsE9lHyOTQKcr5TUkZbhr3HYPqaC4-XW7S6tq7biD2g6jtwOL4U4JKLogK6hgoW6Fwjb9Bq9RxPOWa1eWFOUvqWJ092WmgDlyFMArBzaGUh3bcH2w7joAQQAIW8fwAA1+uxmzTidGMk35c0rx3MD7RgqxnRoTkLHsawHCkOmdQZpnobZuGuZ5gBNAXHqG4XTwUXcqdqBbpvtexHIqNZzxKpygb+EGOPpiH72Z1nYf8MgoFJI3jVsvZhVtDYLHyL6O0WCxHVY6SxvVrjNe97W-dJfB2CZO6DSskOBXKXZQNzHcUxK+SZcvbkMik0UChtJQxBToKvcDH2YeOph4R73AUfIXpES1FHrvR4Oo15cSrCkg5yuybQvvyONjBjRvlvUaxW-BsGtZZru4dO7AeohZLMH0f2cCgXAJ-Su3nRFRictdWVwJyIrHGyZaZFEWRt7TjuGdjrxURmfC+yVsDX1vjjGwA41zLBjBobIDEq69isMXHY0E1CLRHP-duO0gFw1gLgEgTB-DsFQHzaBQsTA1EcrmeUB4bRihluIF6GR1BN2FIqVa7sGYAIIfvHWgQSFkIof4Q2edFwF0nj-BYV4Ci1CvPuWMqDEBXjXK2EUsoHD8l2IhXhJZ+H4KhkIv2YAACOvRkr+CzlAHO1CnrmAqLsc8qYdyKIzLGSU8gPF2FgbuPBu905mO7iQQ61ZqBSKxsbL0qgeSXn2FyTIu4vQZmwXA2UJUHAMT7EE0KITfbHThGAHosJbiEPYCiaJD0Q6SVGpXPcdQFZ5gzLISUSjVAUwPCmIshjCQbRMQAJTAIIMAfAQi9BGI4oaMZJDCE0LNbph57SZDGmbLkSSVZ1C5Pkhq95dJ8QMgEYypl8DmUZDM2yTodywQUGOOwwoMzf08m6Gea49EKj2VtEJIDyGUOhOE7AJAABGQcakiVkRoaQWQcoimFFYFhJQbB40wX+FW+wVDfMZgchkAc+IUNQClCFMifw5AVtIGCVMcgHEcjYGiUlXlbkUbIKwat+k1XpuzAA7kdAIR8T5DGRqjG6-g8AADNUAEAgNwMARJcDQlQHSCQMB2CCAFedQQErUAzOqAqUwy9yoqxKnUL6oo0j7hSHuMauQHBYo5aDDWPK+UnU6sfc6l0x6UDFbgSVBB4Rwk6hIJgiJ2CSrhF0FVfh1VusFclLVvqdUkrSoNPVTpyUCm0JyUCmwZY1AWNoBithLzLC7P-Z1hkQGJRsaPNG3rtXStlfKxVyrVWCCrUjBNkrdUTUWLGJyJV5iXlJnZfImQ3TmBdDw4GRiNoVoCB2mtIr0Y+r9QGoNIbhjhsjW2xdmAu1JsxrUqMeqOnmn7TsscIpSb6vgruTkxh-GVRnQMrlvLDJ6z5quqVMrcByrwC2uVbbQWwEEHwA9Pa5ZaEtVkJMY1c0lBghkfGl5VjbmyOW99ARP282-f6uEga4TBtDduqNaqQNgYg8mgaiRqgMVMAslIKsOHKC+i6SQ9gxpiQFFkfkchMMus-frPDv7-0KqVUB6NFH9BUaPZCslP84zqETGNTIZE3IIHsG6VsXHVCClpbmATH7uYSLw+uojm6w2dR3VJkFoGZPasg+URwP8Pp7ivDacUiZPKgRUCkKSqhP5GYCAHUkImm0AYk2RwQoXRmOeo4LdRP9yh2AyHE8w0cZZrkkGXGwZgUwHlsMF-2+AwsNvM8Rrd1nouxdk8JUlqaf45fMJkYwDg3QrMQ1JAcGwajygohw4rdic7hb-c2qLbbhsMjq-deTjXLwMdkMgnR2QvoLPKMtA85orBiRjEN8E9iGRmYIxukj1XJsHZzjN-OKbaOKcWIpn+DFxa7jW-q3+BY8zXlYsVnucI+4DyHuEz1da+INtE+N1t0a-sA8SkDuEgha03Wu9I27SXMieRFPYFMrFZSsZlrISCygqW5llPxh1HsnVYf8DD8EgPh4g9FeVk7FmzsRui7T-ucPh6I+XZQFHMTjTVAx1TOwrFMhMXx4hhQA5Rwk7zHtin-CAAyeACWoCJQQRk+L-lEt1aIOBxUxLuPpfaF0aRuv6La66FaL7OUa1V3+3XmAJAhVwBwAguqKrOi6VbL7FUvgLIWMBN0pwvRLa3krjajv1dEtd+79gnu9T1bR6UGCJ5HK8hNWNeQnIvj7gHI5BZLmrwCgUP-GPzuJAADlKEAAVUB4CqQQdmEAICDHCQEFgTf9cHFPArGoI5tDYMD9kVsUtmLZH2PuCvauq+1-8A3pvsBMLo2JXJhrNlnIJNZV2Neuh7QZDNKKdr9QtA2n-m7j3Vz6Ir0lvkbcsL0yrNsOTPsuxThWCppfhPSeN+p8yGhQVm8l6SWDHGf17HsAWFjHggeQVlyEFH-gABV8UIRgULpwlyB-ktc8V8BY918U8aNthwDTx5QvIXQshRANNzwKgKZQ9eMbQW4o96Zeh+5KFro5xapIRcBG0xtItlV2ZvAkDBBWCZVBAOD2AuCb4EtYlXMDUxIrxip9hr1D9b0XI-MYxnZ-JmCNYRlQhYtnccCddCUCDZtN9thMhg8zB8hAtXQUgNM1NJQdx54rRZRXZqpHVU49C0ZA58CJB50zIgg7h+4Kk4Q-04QCBKx3dYAjsSl9DSsMZCDEtNMG4XEcd+w2EFQbYShcwnQbB1BRQdw1lVB-5vCDCTD-CsMzI3UoA8AW829-A4ifCwsai8AZkkwHB0hZ55QPktNpYSgj9XkjglANBJpI87dPCgoyiEiq8oiroGRIB-BpjfDPcZCQ4xx5FsFJp9gLw88zc5YDwfIDhntxi3ZZ16ZyBSQyBAhQ0yQrljxRpQJ1gB8Ch+jiIiZ4xhQOitxXNitgi-lxFAVTJQVAwId+DJM1V-iEZBAKF20gUQS4tE0e1Cpi13Ns1+R6JxQCg0h71-E3QOwXQ-juAASAV4SwUyQKtLNSM20oS5wYTUA4TgTySBdj0FN5AKgvROwUlloIDtgf4LUF5Cj4IRj7UJjKdU550KlQk4YSkyk+JgiikIQV8wTxNlUxCFSD5BBZTUBYRBANSdYhIzDU9qgRpujHDZAUxeShoLTswp54J6gbQMgiTpTXUzpT5qx9BeCxNAMJB1TCEY03ShVz4e0-N0gbA+MVgyZsinoMdnsDh9wOxdwmCxT+FJT9S-Y91z4vTIc5U-TpT20EZq0PSe1NFzUCgFAXQukjwbRTxUg1hdhVZThnTFTXT3V3Tz5L5IEeCVSfS8zFSAy2ygyZMIEoE1iT0JQXFQJDgSozBwJlApRGhrwNDy8dCJTqd0zgFCykYOyRzuyItVTcyGSNzcACyEptzhyr5pD-8iDSgUVTADhcTm5OtiJy5+9DjsE9UkxmyD4RFSF-k+ZszwTfSjz-TiFSF6SwMQza4Mhi8Th0Uvp45PIqgFl5odhbczjX0qcXVjzfyxFKF9ZAKDzgK9TQLREIL9ASyV5YVN5K5scvovRJBOQlBP4HT4JvzhFLFrELoptCLeyQL8zOL40pse0agkKsgYJ6EFcvF34qYXJXQDhhZn0ML7c1zsLCEadwkz4sBeKos+zNSmBNLIlTCbsby9UetRQOtWJH1Yx0k9weRZArxHB5p0F-4iBcCYB-AkCNdMBVjrzkjXRzQfNTgCiYw1M1EhoqYTx+0ZIkNlhahXL3K+IvLNcqBk8jTTKttRpN4LBbBhQchnkDwwzVBHJYrnIEqddkqfKqBrA-LjYUx1AeRmJloyJRB+QCqor5AYr6EtBRTlLJi6o3KKrvLPcZBarjQf4xIKhsFBRzRWJagdh2qiquqnJ4rVzGR-BcBKFxUSBKAfA3wTkwBtqh4u9EQ-0ZlBAVZyYYICtUgskEVR84w3kSrlojUDEUyyBsAuhhgzJxFN0-0dLlUPqvqRgILtrKAZlRYKhZLChWrvJA8dxFhXECYdxYxTiPDSwgbvrzlxFxlUZAiwYAa5VMaQbYTYAwYIb5zLwMljhlBVA3jNNxBayekOxshHBORNIpwJAGRiQwA69Tq4AW8EowaAgoBDomAjsWAmAgcRgIBzr+xJQ2FvEKytBWUvg6UfNrDcxcZgIOa1QJAYjUBuU+ayABb2YhadqRaxajtSkmBOBIA5bJqFA5kH0FAuN6b4JCpUxYIoCrBCsXBmhNqMB4Aoh0akjjYRBlhx8dhcwSoDh1AMwVYXEshYMcgFRs1dbSQw7jQRBnFGJ6hXa46ENEB2lTBfMpJFFYFky+rxTGQs7J5LQKh79jUqCUgEKcS1JHJzRypY7sVto670oyDWxgrmI6h4ME7WJ8YxwzBaU9MlL0bUzqcNV3TGcV1tV+6cZ5pTA3RsEMhJo+szVOj09eQQrLTis90V761E116bIXRJRJINAVZlALQkV1Ecg0hHJKYIIaVFcUy51qccNv1r7iIRR5FuFqKkM2Nc7gDHCPM561oa66pJShNAH0rkivinCGJZqlgO6X6Gb4kn7vQGFhwq756-6XUDC17UHYkRQnQ3kFZUx9wahBQY55zt6uRtBWUqh9ts4jtKGTK0G+NTAagzAxcB96g1t5QirmLsEdE+lf630XVOd6dgckdV6r6qGQ4FLnR8iUgEEHL6b5KFhV5UgkwK4VJZ8ncTCgHSgpy4497HI6UNN6hIJqhMF+tKh3D4GVc58Kir92BrGrxtA7HFMHH+189OiPacx5pIryd5GHcfHvKJBNqI1koAmRGOTTgshKJuF88McxpH6nY54LG-CF8l8lS0nlpWxuEKISpMhX5D9kMCgFlOrKhb6f8OBrH4J6J0glBHQFQXQDcaI+96I87mIFLkDUDOAbFMD-lrHc8NsyC9x+0XqrTfaKhjBs0PoMk3rq7+FRD2ChhOCwZuDOnYwBxkl+wQJOxcHZRJBVg9MHLrRerSH6ZliwsrGNGox7AEatazAchLrMT7QIJBwOi2wMh8hnmvGNo3m-CAjzkgjuB287gwj4Q5nADpA65RQpIFZAWcj4JpAUhelRA1x1A4G+FoWQhmjYWqjzlWjCJBcvnUkKgdhzx6IMTWlD8Rcp6lhhQ4K0aoXXnKXyjEm5iYjFiYW0WkxTApJ7TZRORjU1bumUgFLXQyZ8T-5LiwBrjYBbjOmxojGKy8xshttnyIqx9jixYkxuMSGBWsLDJaSAhASyTM7Pn0otHJo7BPRX8FYsSYJFgkEFDJYXJ2K-ZtTyljyqlOmtATxE5lZNxcgCg2kRoIyuQOiZWyXzi7WAgcKl6hyo3CrY2FZ438iE6gnctRinKuG1rEH1z1LMySh+HYlo3PIRwi38SS3VlzABw3Q5rVXvnDNq3Ki1KXTc2wFOzr582Y2Rx5BoNOQFBwJun4IFldgE25XYndmyH7W62tyx3dzJ2W3XHDWmKMxRATxcgSXYweTU2Q3jowK8K+ZOn3Wf4cg4l5gcgrSVYbB-W9x6hLxOMbXyWFGt2XS73-z9ZH2J6xiFQZ34CP24k+19wRQLx+QM3MLVLgOWzBLuLLsGR93Y2Z2SquQD9ewSDfEEJRA-M1kb24YDKIlSRMAIP015gw8Y6xIXR0kdhWwqZB0vJbVPHAONZBq8DPLvKAnkF7J87wXEUGUOriqF4Vr+PM2uINqtqdqwBrGLrMo3DzdlhVBH6FJ1x9gEV5rP8xpIW+FiafrKE-r1PXWcYDiIXctRZC1A9GVC0P87BmJ+WLP3dgarP9I+A8b4WwZrHjA+0chhZsglAxJiOLCBwpzPXXQ4J1357ObuaMBja-1g7G3s79hyYZ4Y7OF47Vl4DFhm4FYP77lvOjFOaDajb+bsvUcbzBAdhaGtAQGBQtMNBnl34eXdgkNYUMN-agA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: modelingMachineDefaultContext,

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

          Fillet: {
            target: 'idle',
            cond: 'has valid fillet selection', // TODO: fix selections
            actions: ['AST fillet'],
            internal: true,
          },

          Export: {
            target: 'idle',
            internal: true,
            cond: 'Has exportable geometry',
            actions: 'Engine export',
          },

          Make: {
            target: 'idle',
            internal: true,
            cond: 'Has exportable geometry',
            actions: 'Make',
          },

          'Delete selection': {
            target: 'idle',
            cond: 'has valid selection for deletion',
            actions: ['AST delete selection'],
            internal: true,
          },
        },

        entry: 'reset client scene mouse handlers',

        states: {
          hidePlanes: {
            on: {
              'Artifact graph populated': 'showPlanes',
            },

            entry: 'hide default planes',
          },

          showPlanes: {
            on: {
              'Artifact graph emptied': 'hidePlanes',
            },

            entry: 'show default planes',
          },
        },

        initial: 'hidePlanes',
      },

      Sketch: {
        states: {
          SketchIdle: {
            on: {
              'Make segment vertical': {
                cond: 'Can make selection vertical',
                target: 'Await constrain vertically',
              },

              'Make segment horizontal': {
                cond: 'Can make selection horizontal',
                target: 'Await constrain horizontally',
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
                target: 'Await constrain horizontally align',
              },

              'Constrain vertically align': {
                cond: 'Can constrain vertically align',
                target: 'Await constrain vertically align',
              },

              'Constrain snap to X': {
                cond: 'Can constrain snap to X',
                target: 'Await constrain snap to X',
              },

              'Constrain snap to Y': {
                cond: 'Can constrain snap to Y',
                target: 'Await constrain snap to Y',
              },

              'Constrain equal length': {
                cond: 'Can constrain equal length',
                target: 'Await constrain equal length',
              },

              'Constrain parallel': {
                target: 'Await constrain parallel',
                cond: 'Can canstrain parallel',
              },

              'Constrain remove constraints': {
                cond: 'Can constrain remove constraints',
                target: 'Await constrain remove constraints',
              },

              'Re-execute': {
                target: 'SketchIdle',
                internal: true,
                actions: ['set sketchMetadata from pathToNode'],
              },

              'code edit during sketch': 'clean slate',

              'Convert to variable': {
                target: 'Await convert to variable',
                cond: 'Can convert to variable',
              },

              'change tool': {
                target: 'Change Tool',
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

            states: {
              Init: {
                always: [
                  {
                    target: 'normal',
                    cond: 'has made first point',
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

            on: {
              'change tool': {
                target: 'Change Tool',
              },
            },
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
              'change tool': {
                target: 'Change Tool',
              },
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
              'Awaiting second corner': {
                on: {
                  'Finish rectangle': 'Finished Rectangle',
                },
              },

              'Awaiting origin': {
                on: {
                  'Add rectangle origin': {
                    target: 'Awaiting second corner',
                    actions: 'set up draft rectangle',
                  },
                },
              },

              'Finished Rectangle': {
                always: '#Modeling.Sketch.SketchIdle',
              },
            },

            initial: 'Awaiting origin',

            on: {
              'change tool': {
                target: 'Change Tool',
              },
            },
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
                actions: ['Set selection'],
              },
            },
          },

          'Await constrain remove constraints': {
            invoke: {
              src: 'do-constrain-remove-constraint',
              id: 'do-constrain-remove-constraint',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
            },
          },

          'Await constrain horizontally': {
            invoke: {
              src: 'do-constrain-horizontally',
              id: 'do-constrain-horizontally',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
            },
          },

          'Await constrain vertically': {
            invoke: {
              src: 'do-constrain-vertically',
              id: 'do-constrain-vertically',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
            },
          },

          'Await constrain horizontally align': {
            invoke: {
              src: 'do-constrain-horizontally-align',
              id: 'do-constrain-horizontally-align',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
            },
          },

          'Await constrain vertically align': {
            invoke: {
              src: 'do-constrain-vertically-align',
              id: 'do-constrain-vertically-align',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
            },
          },

          'Await constrain snap to X': {
            invoke: {
              src: 'do-constrain-snap-to-x',
              id: 'do-constrain-snap-to-x',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
            },
          },

          'Await constrain snap to Y': {
            invoke: {
              src: 'do-constrain-snap-to-y',
              id: 'do-constrain-snap-to-y',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
            },
          },

          'Await constrain equal length': {
            invoke: {
              src: 'do-constrain-equal-length',
              id: 'do-constrain-equal-length',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
            },
          },

          'Await constrain parallel': {
            invoke: {
              src: 'do-constrain-parallel',
              id: 'do-constrain-parallel',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
            },
          },

          'Change Tool': {
            always: [
              {
                target: 'SketchIdle',
                cond: 'next is none',
              },
              {
                target: 'Line tool',
                cond: 'next is line',
              },
              {
                target: 'Rectangle tool',
                cond: 'next is rectangle',
              },
              {
                target: 'Tangential arc to',
                cond: 'next is tangential arc',
              },
            ],
          },
        },

        initial: 'Init',

        on: {
          CancelSketch: '.SketchIdle',

          'Delete segment': {
            internal: true,
            actions: ['Delete segment', 'Set sketchDetails'],
          },
          'code edit during sketch': '.clean slate',
        },

        exit: [
          'sketch exit execute',
          'tear down client sketch',
          'remove sketch grid',
          'engineToClient cam sync direction',
          'Reset Segment Overlays',
          'enable copilot',
        ],

        entry: [
          'add axis n grid',
          'conditionally equip line tool',
          'clientToEngine cam sync direction',
        ],
      },

      'Sketch no face': {
        entry: [
          'disable copilot',
          'show default planes',
          'set selection filter to faces only',
        ],

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
              actions: ['disable copilot', 'set new sketch metadata'],
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
        actions: ['reset sketch metadata', 'enable copilot'],
      },

      'Set selection': {
        internal: true,
        actions: 'Set selection',
      },

      'Set mouse state': {
        internal: true,
        actions: 'Set mouse state',
      },
      'Set context': {
        internal: true,
        actions: 'Set context',
      },
      'Set Segment Overlays': {
        internal: true,
        actions: 'Set Segment Overlays',
      },
    },
  },
  {
    guards: {
      'has made first point': ({ sketchDetails }) => {
        if (!sketchDetails?.sketchPathToNode) return false
        const variableDeclaration = getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          sketchDetails.sketchPathToNode,
          'VariableDeclarator'
        )
        if (err(variableDeclaration)) return false
        if (variableDeclaration.node.type !== 'VariableDeclarator') return false
        const pipeExpression = variableDeclaration.node.init
        if (pipeExpression.type !== 'PipeExpression') return false
        const hasStartSketchOn = pipeExpression.body.some(
          (item) =>
            item.type === 'CallExpression' &&
            item.callee.name === 'startSketchOn'
        )
        return hasStartSketchOn && pipeExpression.body.length > 1
      },
      'is editing existing sketch': ({ sketchDetails }) =>
        isEditingExistingSketch({ sketchDetails }),
      'Can make selection horizontal': ({ selectionRanges }) => {
        const info = horzVertInfo(selectionRanges, 'horizontal')
        if (trap(info)) return false
        return info.enabled
      },
      'Can make selection vertical': ({ selectionRanges }) => {
        const info = horzVertInfo(selectionRanges, 'vertical')
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain horizontal distance': ({ selectionRanges }) => {
        const info = horzVertDistanceInfo({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain vertical distance': ({ selectionRanges }) => {
        const info = horzVertDistanceInfo({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain ABS X': ({ selectionRanges }) => {
        const info = absDistanceInfo({ selectionRanges, constraint: 'xAbs' })
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain ABS Y': ({ selectionRanges }) => {
        const info = absDistanceInfo({ selectionRanges, constraint: 'yAbs' })
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain angle': ({ selectionRanges }) => {
        const angleBetween = angleBetweenInfo({ selectionRanges })
        if (trap(angleBetween)) return false
        const angleLength = angleLengthInfo({
          selectionRanges,
          angleOrLength: 'setAngle',
        })
        if (trap(angleLength)) return false
        return angleBetween.enabled || angleLength.enabled
      },
      'Can constrain length': ({ selectionRanges }) => {
        const angleLength = angleLengthInfo({ selectionRanges })
        if (trap(angleLength)) return false
        return angleLength.enabled
      },
      'Can constrain perpendicular distance': ({ selectionRanges }) => {
        const info = intersectInfo({ selectionRanges })
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain horizontally align': ({ selectionRanges }) => {
        const info = horzVertDistanceInfo({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain vertically align': ({ selectionRanges }) => {
        const info = horzVertDistanceInfo({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain snap to X': ({ selectionRanges }) => {
        const info = absDistanceInfo({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain snap to Y': ({ selectionRanges }) => {
        const info = absDistanceInfo({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        if (trap(info)) return false
        return info.enabled
      },
      'Can constrain equal length': ({ selectionRanges }) => {
        const info = setEqualLengthInfo({ selectionRanges })
        if (trap(info)) return false
        return info.enabled
      },
      'Can canstrain parallel': ({ selectionRanges }) => {
        const info = equalAngleInfo({ selectionRanges })
        if (err(info)) return false
        return info.enabled
      },
      'Can constrain remove constraints': ({ selectionRanges }, { data }) => {
        const info = removeConstrainingValuesInfo({
          selectionRanges,
          pathToNodes: data && [data],
        })
        if (trap(info)) return false
        return info.enabled
      },
      'Can convert to variable': (_, { data }) => {
        if (!data) return false
        const ast = parse(recast(kclManager.ast))
        if (err(ast)) return false
        const isSafeRetVal = isNodeSafeToReplacePath(ast, data.pathToNode)
        if (err(isSafeRetVal)) return false
        return isSafeRetVal.isSafe
      },
      'next is tangential arc': ({ sketchDetails }, _, { state }) =>
        (state?.event as any).data.tool === 'tangentialArc' &&
        isEditingExistingSketch({ sketchDetails }),
      'next is rectangle': ({ sketchDetails }, _, { state }) => {
        if ((state?.event as any).data.tool !== 'rectangle') return false
        return canRectangleTool({ sketchDetails })
      },
      'next is line': (_, __, { state }) =>
        (state?.event as any).data.tool === 'line',
      'next is none': (_, __, { state }) =>
        (state?.event as any).data.tool === 'none',
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
      'hide default planes': () => kclManager.hidePlanes(),
      'reset sketch metadata': assign({
        sketchDetails: null,
        sketchEnginePathId: '',
        sketchPlaneId: '',
      }),
      'set new sketch metadata': assign((_, { data }) => ({
        sketchDetails: data,
      })),
      'AST extrude': async ({ store }, event) => {
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
        const extrudeSketchRes = extrudeSketch(
          ast,
          pathToNode,
          false,
          'variableName' in distance
            ? distance.variableIdentifierAst
            : distance.valueAst
        )
        if (trap(extrudeSketchRes)) return
        const { modifiedAst, pathToExtrudeArg } = extrudeSketchRes

        store.videoElement?.pause()
        const updatedAst = await kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
          zoomToFit: true,
          zoomOnRangeAndType: {
            range: selection.codeBasedSelections[0].range,
            type: 'start_path',
          },
        })
        if (!engineCommandManager.engineConnection?.idleMode) {
          store.videoElement?.play().catch((e) => {
            console.warn('Video playing was prevented', e)
          })
        }
        if (updatedAst?.selections) {
          editorManager.selectRange(updatedAst?.selections)
        }
      },
      'AST delete selection': async ({ selectionRanges }) => {
        let ast = kclManager.ast

        const modifiedAst = await deleteFromSelection(
          ast,
          selectionRanges.codeBasedSelections[0],
          kclManager.programMemory,
          getFaceDetails
        )
        if (err(modifiedAst)) return

        const testExecute = await executeAst({
          ast: modifiedAst,
          useFakeExecutor: true,
          engineCommandManager,
        })
        if (testExecute.errors.length) {
          toast.error('Unable to delete part')
          return
        }

        await kclManager.updateAst(modifiedAst, true)
      },
      'AST fillet': async (_, event) => {
        if (!event.data) return

        const { selection, radius } = event.data
        let ast = kclManager.ast

        if (
          'variableName' in radius &&
          radius.variableName &&
          radius.insertIndex !== undefined
        ) {
          const newBody = [...ast.body]
          newBody.splice(radius.insertIndex, 0, radius.variableDeclarationAst)
          ast.body = newBody
        }

        const pathToSegmentNode = getNodePathFromSourceRange(
          ast,
          selection.codeBasedSelections[0].range
        )

        const varDecNode = getNodeFromPath<VariableDeclaration>(
          ast,
          pathToSegmentNode,
          'VariableDeclaration'
        )
        if (err(varDecNode)) return
        const sketchVar = varDecNode.node.declarations[0].id.name
        const sketchGroup = kclManager.programMemory.get(sketchVar)
        if (sketchGroup?.type !== 'SketchGroup') return
        const extrusion = getExtrusionFromSuspectedPath(
          sketchGroup.id,
          engineCommandManager.artifactGraph
        )
        const pathToExtrudeNode = err(extrusion)
          ? []
          : getNodePathFromSourceRange(ast, extrusion.codeRef.range)

        // we assume that there is only one body related to the sketch
        // and apply the fillet to it

        const addFilletResult = addFillet(
          ast,
          pathToSegmentNode,
          pathToExtrudeNode,
          'variableName' in radius
            ? radius.variableIdentifierAst
            : radius.valueAst
        )

        if (trap(addFilletResult)) return
        const { modifiedAst, pathToFilletNode } = addFilletResult

        const updatedAst = await kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToFilletNode,
        })
        if (updatedAst?.selections) {
          editorManager.selectRange(updatedAst?.selections)
        }
      },
      'conditionally equip line tool': (_, { type }) => {
        if (type === 'done.invoke.animate-to-face') {
          sceneInfra.modelingSend({
            type: 'change tool',
            data: { tool: 'line' },
          })
        }
      },
      'setup client side sketch segments': ({
        sketchDetails,
        selectionRanges,
      }) => {
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
            selectionRanges,
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
        sceneEntitiesManager.setupNoPointsListener({
          sketchDetails,
          afterClick: (args) => {
            const twoD = args.intersectionPoint?.twoD
            if (twoD) {
              sceneInfra.modelingSend({
                type: 'Add rectangle origin',
                data: [twoD.x, twoD.y],
              })
            } else {
              console.error('No intersection point found')
            }
          },
        })
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
      'show default planes': () => kclManager.showPlanes(),
      'setup noPoints onClick listener': ({ sketchDetails }) => {
        if (!sketchDetails) return

        sceneEntitiesManager.setupNoPointsListener({
          sketchDetails,
          afterClick: () => sceneInfra.modelingSend('Add start point'),
        })
      },
      'add axis n grid': ({ sketchDetails }) => {
        if (!sketchDetails) return
        if (localStorage.getItem('disableAxis')) return
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
            filter: ['face', 'object'],
          },
        }),
      'set selection filter to defaults': () =>
        kclManager.defaultSelectionFilter(),
      'Delete segment': ({ sketchDetails }, { data: pathToNode }) =>
        deleteSegment({ pathToNode, sketchDetails }),
      'Reset Segment Overlays': () => sceneEntitiesManager.resetOverlays(),
      'Set context': assign({
        store: ({ store }, { data }) => {
          if (data.streamDimensions) {
            sceneInfra._streamDimensions = data.streamDimensions
          }

          const result = {
            ...store,
            ...data,
          }
          const persistedContext: Partial<PersistedModelingContext> = {}
          for (const key of PersistedValues) {
            persistedContext[key] = result[key]
          }
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(
              PERSIST_MODELING_CONTEXT,
              JSON.stringify(persistedContext)
            )
          }
          return result
        },
      }),
    },
    // end actions
    services: {
      'do-constrain-remove-constraint': async (
        { selectionRanges, sketchDetails },
        { data }
      ) => {
        const constraint = applyRemoveConstrainingValues({
          selectionRanges,
          pathToNodes: data && [data],
        })
        if (trap(constraint)) return
        const { pathToNodeMap } = constraint
        if (!sketchDetails) return
        let updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          pathToNodeMap[0],
          constraint.modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        return {
          selectionType: 'completeSelection',
          selection: updateSelections(
            pathToNodeMap,
            selectionRanges,
            updatedAst.newAst
          ),
        }
      },
      'do-constrain-horizontally': async ({
        selectionRanges,
        sketchDetails,
      }) => {
        const constraint = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchPathToNode,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        return {
          selectionType: 'completeSelection',
          selection: updateSelections(
            pathToNodeMap,
            selectionRanges,
            updatedAst.newAst
          ),
        }
      },
      'do-constrain-vertically': async ({ selectionRanges, sketchDetails }) => {
        const constraint = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        return {
          selectionType: 'completeSelection',
          selection: updateSelections(
            pathToNodeMap,
            selectionRanges,
            updatedAst.newAst
          ),
        }
      },
      'do-constrain-horizontally-align': async ({
        selectionRanges,
        sketchDetails,
      }) => {
        const constraint = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        if (trap(constraint)) return
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      },
      'do-constrain-vertically-align': async ({
        selectionRanges,
        sketchDetails,
      }) => {
        const constraint = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        if (trap(constraint)) return
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      },
      'do-constrain-snap-to-x': async ({ selectionRanges, sketchDetails }) => {
        const constraint = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        if (err(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      },
      'do-constrain-snap-to-y': async ({ selectionRanges, sketchDetails }) => {
        const constraint = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      },
      'do-constrain-parallel': async ({ selectionRanges, sketchDetails }) => {
        const constraint = applyConstraintEqualAngle({
          selectionRanges,
        })
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint

        if (!sketchDetails) {
          trap(new Error('No sketch details'))
          return
        }

        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          parse(recast(modifiedAst)),
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      },
      'do-constrain-equal-length': async ({
        selectionRanges,
        sketchDetails,
      }) => {
        const constraint = applyConstraintEqualLength({
          selectionRanges,
        })
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      },
    },
    // end services
  }
)

export function isEditingExistingSketch({
  sketchDetails,
}: {
  sketchDetails: SketchDetails | null
}): boolean {
  // should check that the variable declaration is a pipeExpression
  // and that the pipeExpression contains a "startProfileAt" callExpression
  if (!sketchDetails?.sketchPathToNode) return false
  const variableDeclaration = getNodeFromPath<VariableDeclarator>(
    kclManager.ast,
    sketchDetails.sketchPathToNode,
    'VariableDeclarator'
  )
  if (err(variableDeclaration)) return false
  if (variableDeclaration.node.type !== 'VariableDeclarator') return false
  const pipeExpression = variableDeclaration.node.init
  if (pipeExpression.type !== 'PipeExpression') return false
  const hasStartProfileAt = pipeExpression.body.some(
    (item) =>
      item.type === 'CallExpression' && item.callee.name === 'startProfileAt'
  )
  return hasStartProfileAt && pipeExpression.body.length > 2
}

export function canRectangleTool({
  sketchDetails,
}: {
  sketchDetails: SketchDetails | null
}): boolean {
  const node = getNodeFromPath<VariableDeclaration>(
    kclManager.ast,
    sketchDetails?.sketchPathToNode || [],
    'VariableDeclaration'
  )
  // This should not be returning false, and it should be caught
  // but we need to simulate old behavior to move on.
  if (err(node)) return false
  return node.node?.declarations?.[0]?.init.type !== 'PipeExpression'
}

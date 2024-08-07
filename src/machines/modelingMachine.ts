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
  | { type: 'Text-to-CAD'; data: ModelingCommandSchema['Text-to-CAD'] }
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
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeRJothBpzlsvPDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd6IT4GbG-VoAiTYCCYMAEACiEPhgQA1n5yAALVHRdFvBJCazCOQSRSctQyKS5RRqFTWL6nNTSfnSsS5FRiZT4-7tIkksmUkZw2n0pmKSJo2JTLFJWwLFSOBy7WQ0eZFXEIczWCRqaxyOq81KKAWOJUeFXE0kUx5w3oYZmvI3spJiOQyZ1mZQyeUyRSC4RfXmndKOKRyWUpmqKX1XKCqwMAMWwmFJT3o41ZkZmQnzEjsgoVXPE2TtJS9KmEPNjuZsKbkDmLhID6r4LDhtf1LMNmKjgjEdXSrtENuEihUcjUigz-cUEhqeaUwmsqavE-9aoIyBIdPDDeXTYdTtSIusalj5qy+xfFyaSxvUKh7rKdgqFIt74GWZIACLBCMgTBKEUwvku0z8EIO7lNoCZjqm5qKGIGYxuUNSXj+iiOLR+6waWU4SAyxJgAACoiuBwAQACCc7YAAZiQoT+FAcIkEwDL+CwTC9IiIwQJhGLYbM-aSuIia-loOkyOm9q-nGlrQbmXq0VIKiMfBEiwAyqAAO6cWQPH8ZwwmieJknSWAXRMJwkDKWy76CHu3IKDGYicsB4F5hmvJOqmB5ejQNBWAe1hWd4dLsIyxBkJQmBZTqgWNjhCCZnGthJpya4erYcUHBIqX9jsMb7jQMiZdluVITWYCoaC4LzvWWHGnIebOj+kUWb+NqyF88rcho5j5rswjmE0Fx+nBRU5QyBB3Bg-iQBw-gQL0cLtNqe0lW+ZVei6ph7tpWjrWYPaINKTVrsstRZLRIpdTqEi7YyACS96PnSA1ghC-iwgJ5AkJgt2qYgXoCqeqb5Du62vUeBSLPKM3zMsSydc0BIqqDDIg91DIQ4GUP9UEg1w3Zl0AF73MjqPGl6V7pOB9Q7PylQqBmNhmgekX7P9KVFpTyo7fTdM6ozZJENwsDsBJeD+Bz2DcxCyNndgOv5aMdYvK+aPlfYJ7KPkywpjGyxfKakgKzYe47KRbpA3tat7RrxDa7rJD6wjnBI5gZsWxQVsLhGd2JGZA5zdavLCnKHtLE6e4pTQBy5CmgeMsH4P3lruA63ruD+LxABC3j+AAGnzUYY06MZJvy5pXjuZH2j+VjOjQnIWPY1gODBSvbaWNOVwz1fh-Xjct-4ACanfvt3p4KLuxe1LLEv2vYv4VGs54WQoKTl7TNOhzXdeRw3ZBQKSu-3TUezCraGwLD5A9h2RYFhHQdSWOBSy88SzL2Xs-Neb9-CknwOwJk1sDQqX5gKcouxSK5h3CmCyMgPaXjCqRWwBQZ7LFIg-BBq9a4R31kweErDcAQGwOQeSJAtScITpQb+adXSSCsJFA4ZNsjaA9vkOMxgYwFCLuoDKsDCRLyfow1++tDbGyGNWfQ-hkbYCgLgIR6ML7OhFC1HGIjh69llkTRw2QUp6RtBTLacD1H00QUw9e0cuHI0wAYoxJizH205KYVIgp9y-k5HYDMVg8E7GomoOWI56EaMDC-ZhDdYC4Ekv4dgqB25hK9CYGo2lVD7EyMAkemlBy7gkUoA8cgMneM0TkwI+SmCFOKTvTBi5sFd1cYseKtQrz7ljKQkepEBzqHlPg-kuw1BtPVh09eYAACOvRTaoKgOg0pSYFh1AAkoFIYyMyxklPIHcVUbB4VWSHdZyCmC8MCdQAZKc7ZelUDyS8+wuSZF3F6DMqSByyjAg4dafZHlVyyUg-WcIfKoFhLcBFEIUSfNtvzKaQsSF7hOSIjMshJTjNUIXA8KZFYeLUarTJZIABKYBBBgD4CEXoIxSkRQqJoKWFLDz2kyOBA+XIAUzzqFyWFK9AyHX6idAI51Lr4GuoyQ5j0dxJQUGOOwwoMwuKam6MRa4lkKilT46OvT4a8OwCQAARl-LFo1hkaGkFkHGIphRWDFOfQep41x4RnvsGBNLqZ0vaTKhkH9+pFNQCjR1Qz3w5AntIH8xccgHEMt63slCDVbgKNoPSAp6G8XspHAIOieZx34UMRO-g8CCVQAQCA3AwBElwNCVAdIJAwHYIICtJtMCCHragMJ1QFSmFkWTGh-Y7GICoSBbQ61yW5AcMGv4C94ElrLQbVAXNK3xxrZQOtuAG0EHhHCXdEgmAKQbXCLo3a-B9t3UbStQ6T0jvjUFMqY6nRJoFNoTkpFNgj1-s6FIop+xLHmDGYtpbTr+Njgey2x7T3Nu4m2jtXae2CAQ8jN9DbR2i0WLGO+Fl5iXjzo9fImQ3TmBdIqVRobgZbvg-CGOptq3IeHWeuEF64RXpvbu+92HcODuHYR-YzpzQkYlWOEUedx20V3FFdapx3Hrs8arFjARm6tzbihxtaHW14Ew627DdrYCCD4Phj9ydsVRmqGPLQ+5bRJnAsBkoP4MhNRSKaMcKRsiwe3bp9uBmeN8YE8MW9wnH0WaszZwj61ImLpnhkaTHsXSSHsDFIcWR+StMYyrZjcGdOby3mFozGHO1mdi7ayz+gEuftKokRzcZ1CJnApkKqH0ED2DdK2HL0E5baAKyGorQdtMb1buV7j57L3Xqi0Jh9va4sNfE011Oc69LlEcHpf2e4rw2nFImJqpFoJ1FdOaSVhXF5aZK4Y-ApIKstqq1h2Lj3mXrbs06xN23WzyFovIcwtTPNrkkIQmwZgUzpTXVTcbFdJsfye7N3j83BN3uW4IJHn332JfB+YTIxgHBugFaDiJGwajyhqmloLp09noOe+hkz1XMf04ZI177Cbv16R7qkeQNVdjZDISKJqxdgVWHGjBm7m77ts7C3N-jC32DRdZ+CfZ7OvsjS5y1wtixC16XWv3XcZDx2iFkD8hU+QOq04CKwuE7DOHcMRHw82h7+rccq8zt7va7cO64TwuEghOOJw51rr9OvMhNRFPYFMHVZTKBkUmLGUibR5il2N27xXt2+-BI7gPSHa0o4i0rlX2Gc8cP987oPrvLah5tj97nkfi52A6pkVqCeR4KAHKOVNuZZSjY07S4GAAZPA0bUCxoOpG-A4-Y2jtEOC4m41Uxeq+C6NIkUTm1FEK6cc0ul6j+4r02NEgwa4A4AQUd5NnTkpPnmXk817TCEasRN0pwvSyEC-v1Wh-Z+YFP+fuwJfnqGHs1nOjRDfg-v2OBPzvpCUPuAOL+M-rtleAKAoPQr-sfv-gAHLFLsSoB4DsCwB8QQAQCDC8K24EEQjz6NTTw1AjjaCpJATZCthDxtTZD7AMTf4j5j5YESC4H+D4GEHEGkCJxxqc7h7oyvR-KyCiARTZC6D2gZBmiijE71BaA2j0Jn4X6lKpRyKDxW4NBd4ZhUKth9i7CnBWDFxaGAHAESFgHlTHxNScguy0RLBjhwHmIpTpBUraoTy5CCj0IAAqUaEINqccvC5AvSU+UaWBYS6w3e8o4gz+qWogPW54FQhcb+eWNoYg9CvQHCxSFsc4NMkIuATaL2XuravE3gQRggBRzaggxR7ApRpiG23ye2E640V4xM+w8mShimb0Q2Cgz0sOysmeQcTKoQ2OWBMRM+cR7RxoseCwZ2+QqgvIXePWXWkoO4kiVosom0g+TGkxIQNan8f+Eg2mV0QQdwHCaKcI3EcIBAlY5+tk-gSK0xH28Roon4QojQmkCoZ8JQuYToPs34O4Qqqg9CUxZxT2Ma-+Vxyqz6UAeAJBZBHxsJ-UyJeA3xDg6Q4iCyz+fWs6CAyhBqRwzSJwl40JpxMx8JEgLx5sDIkA-gMJ2Ol+ixXcY4CwU0Ys+wF4nIa+Y8B4r0xczULo9C5ApIZAgQCkZIpSx4QspE6wE8NgOQcUgsqSwoRyW4e2NuaK7abGlq0I1qdqgYnu7aLO2Gtx0cggRSOGpp9qOOBGnJv2hMtgS6BQGq9gnhvWBQaQymdgNyHYEp3BE292NpRpRSVql0ZpZICukWyuS21p3Atp9pJpsZTpdeWCkhpQpw3IRCnYQKKUvplhIEUiooEJzSYxG6S8k2txWiDcSKPQqKDZOSRBFRTOlpXajRbZ9cggzZKKzKfZb8w09e2uW2gsBJ2xsgKYvpqYWYGQGxtE9Qqe1KRx8OtM9Z6KO6e6A6QSnZxm3ZravZ6KT6e5eiQShG0EPhP48gKw+cQJ5ikehuBw+4HYu4eRYZCOEZO5omB5FppmEgp5vib8OGbGAS+iEmcy+croWgl2T55UwOp4qQawuws8pw+pI52iz6uigSwSOAJih5r2J5qAgg2FuA55L6+5DWISbR9hm2eZNQFQCouwwO8oiFpEygUojQ14wxc8GeMu26FF8MEFscQShihF5RgFLOIFjZ4FiM+FWOUlhGU5BwgZSgCoCSXop4YuWgkUOwSYWFO5eSBS0ZbcxFVRwFZFFFTR3SdpZFfA15YUGQyBVJymHs4CTUVQz+MsOwe+gldZv5oF+splPS0ZW8llx51l5FZ5YVDlgg+gEmcibqyiJCMeHsXokgLhtEoq8wtExlIVDcWyOyccbOUVQFclOSLK2yeGbOhGzFqUWQP4lSsolyOQUeb0roBwpw1QhVjZMkby1YWAFVslNlZ5ryEkw14hoBjFY6GcooJOHUxgvsoKe4PIsgV4jgMsiS9CRA0+MA-gQRE+mAHJDFdsl2J4Dgpw8yMYXW0yvYYuPhqgsSL0tQe1B1-Ux1k+VAIB45uZNE5Qt+M8EGwo6pgqT1JG6gUid87135tM+1sR31p1VA1g51SxjSPIbUKUVUog-IeqB4z10NXmv0NZmmwMiN8xyNl+Mg6NUYek40PK9QCYHUtQOwBNJ4UNr1sNhxcOExjI-guAxS7kZIvgpIokGAwk8ktuXEScs1dsggM8Bcd5nq7YzSvpXIcYhqsSKUU6Ky0uZA2AXQwwV00ZC23Eo1XahtxtIwCVItYSvcFQxcl4BKzt7sT+O4iwguyw5ysYKigl1tJtyq0ZrKru1x9Mltragdtt9psA9MDt3Fl4YKxwygVS4o4gKFlKHY2QjgnIVkU4BAQRrKva9pRAvECEYSq4vIT0KQsoqSvc-Yly-YFQ-O6aOM0mLgzQQtGA8AUQfN8txoIgywrBOwuYM0FgHm6MES-41GZG00ro+daoA9K460ZoYiY96gE9XwJKPI0Ee42Ms56gi9pILEbETk3EvdOZDhq4j0LU9QIxBw6geqHVSwpEE8s0Wq-tG5TEaoNkdkjkstl9gyuZggOwToCgy0HU1oMSz92Vml79Y4n9D8y9e8loFQBhNCaRKQmVcY-JmQHqf4e4ZqS9-1Dhn5ZoN1bUdQ7mJhHUPmY4ZgGaqgsg+p-aeiBeR6w6KD90MspgboqSGQYslOHsBOiwSUtgIoQovN4xQlrGilVaNehe763DacLokovJLoxOFoWa4B9QN+RcFE6a6e39sjpWemBmKj6MIoPJwoNGFkXmGW5grYE8O479h26mfNpjU228FjpDjF2pOx60-4Swa0Lo6dvyygH+qYzDoE+pMxXDfj3y346QROV4uY0ogoIC3F-DXI2gshVQ+pcuCTV9-j+WpgNQZgLeqp9QZC8oz1SgOcsoAVJjQV2ebCuelevCHD7uyjiT-MPVzoPsKQywIs4Nnm7UFQEqsgOqFk4gGBvB8JljpQb9YCQjv4hkPWzNxGooZgkU4g+l8zR+9J2h7ASzV42gqzha6zJGXwREPI2cX4b9LShzFxQtd6yMZzlTFQGMAEEJB4tzke4EM8yg6hEiLzfBAhQhGKnz3h5o6UdQFkmQbVSh3mXp+WLUKR+tgVqsJzSztEqU6QSgjoCoLoC+DUCwzURq40PVwRoRnApskRvSSz-O5QFgbF40Kp2DT+zFxgl4EJMYYKWLLTqsDRRRQwJR9MZReLsYA4gK0BuVY4OjCAEKzj40JkNg1oZNQ+Jxnx5xWBzLqUJ4pkZgOQStqUXwMYA4M8-lrFOdmh8NEgbJH2fBiJUAqEtxZBdwDx8IzL+D0gGQJrez4q29tE0gKQVKchhuHjMjS8Trer9Jrr-g2J2EXyGN5oLdEU5G-IAEALFLDDr9GgYsX9njsbtJzr9JjJtkLJcbpIvrSesoW1EKnINCa+BLKQPVro+cboX52LwMUpYAMpsAcpeL4ExyEDeY2QV2pO6MzV48iS-cHLPbwrWep0kZc4xpjptbfTXcAzYsdgnoVCE84o+aYjv43Rg8b0-VnSg5rZ6KRBeLWgV1I4E8m4uQBQxKmp95mtK0qBV768bD+FD7hNkC08r7PsJhFzEOhb21BTDr25RVol8jQSQHT71QL73b4HgqG0KTrNnbPpuYf7yCAH+iklxiKb9me8j7TUI495sSwE5EBLuVqS4gkOkUA+Jbd2wlf5Yl+FpHJiKH1H1QtH2QqQCSeJuQa4vsJZmthHoV3SlqbceLu7POCo95-hvp1rv6Io54l42WS7HHK7AQIlYVlqW8SndDRbqnCg6nOD3IroMS0E21mFcHwVA1JVuyau6CAnIHwnnICglyBLNyygf0jnFgsnDck17ymA5nv68w7+Y91LSr2pkgdGZGyRK60jtZqslNh1yNZzInT099GQ4bSXXFRN3Nv0mX5Ne0gtwtIkYASzitmMBx6+ywqgwLC0641StQbNlh0CVk0dptxS5tDX27e8wp+Q0Eb+vci6QEkUYGJySYOw3RA35+NtQ3x0fAYdyqcdOoSzxgxGOQvVChqdihJQc5WNU85CdEBWLgQAA */
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

          'Text-to-CAD': {
            target: 'idle',
            internal: true,
            actions: 'Submit to Text-to-CAD API',
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

            entry: ['show default planes', 'reset camera position'],
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
      'reset camera position': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_look_at',
            center: { x: 0, y: 0, z: 0 },
            vantage: { x: 0, y: -1250, z: 580 },
            up: { x: 0, y: 0, z: 1 },
          },
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
          // commented out as a part of https://github.com/KittyCAD/modeling-app/issues/3270
          // looking to add back in the future
          // zoomToFit: true,
          // zoomOnRangeAndType: {
          //   range: selection.codeBasedSelections[0].range,
          //   type: 'path',
          // },
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

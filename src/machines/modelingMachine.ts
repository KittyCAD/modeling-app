import { PathToNode, VariableDeclarator, parse, recast } from 'lang/wasm'
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
import {
  addStartProfileAt,
  deleteFromSelection,
  extrudeSketch,
} from 'lang/modifyAst'
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
import { Vector3 } from 'three'
import { quaternionFromUpNForward } from 'clientSideScene/helpers'
import { uuidv4 } from 'lib/utils'
import { Coords2d } from 'lang/std/sketch'
import { deleteSegment } from 'clientSideScene/ClientSideSceneComp'
import { executeAst } from 'lang/langHelpers'
import toast from 'react-hot-toast'

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
  mediaStream?: MediaStream
  buttonDownInStream: number | undefined
  didDragInStream: boolean
  streamDimensions: { streamWidth: number; streamHeight: number }
  openPanes: SidebarType[]
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
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Equip Line tool' }
  | { type: 'Equip tangential arc to' }
  | { type: 'Equip rectangle tool' }
  | { type: 'Equip Circle tool' }
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

export type MoveDesc = { line: number; snippet: string }

export const PERSIST_MODELING_CONTEXT = 'persistModelingContext'
interface PersistedModelingContext {
  openPanes: Store['openPanes']
}

type PersistedKeys = keyof PersistedModelingContext
export const PersistedValues: PersistedKeys[] = ['openPanes']

const persistedContext: Partial<PersistedModelingContext> = (typeof window !==
  'undefined' &&
  JSON.parse(localStorage.getItem(PERSIST_MODELING_CONTEXT) || '{}')) || {
  openPanes: ['code'],
}

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoAWAHQB2GgE4ATLNEAOAKwBGAMyzNAGhABPRFNWaJmscOXyp61aplWAvk-1oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEFlK2l1Gil5UxpreTEpfSMEeTyJYU0reW1hVRTxYRc3dCw8Ql8AgFtUAFcgwPYSdjAI3hiOLnjQROTlGgl5ZUWxDK0ZVVlCxE1VOfXxGlUq2R1NKUaQdxavdv9ybiG+dhGosbjeIuSpcxLZdTF1KqmDTCfSJbbleb2GSacQVZR2c6XTxtPz+XxQDpgXABADyADcwAAnTAkAywZ7MVjjbi8RI0TYIGiI5rIiTYCCYMAEACi2KJgQA1n5yAALCnRKlvBJCeTCL4A4Q6NSadSyMTyBmabQSZQ6PX2CwaM6uC4s1psjlc3lDQmC4Vi9SRSmxCa0mXLCT-UR2HIw2YFQyIZbyCQKKQ1BXwzTwhompHm9mcnmPQndDDi16u6VJKHzWQHRWqMS1dQM9Q++YpXWyHZiNX-ZkeBOW5MsQlPeijSVZqYyxaVvI0Ep-NW1BlSWxlEwWGqzGzFxtXKAWpMAEWCQ0CwVCEwz3Zp2cE8j+oak6qqymLl8LDOUUlkEgyp0vOSHZ9Ui9Z3iF7FFxDIlCYN+9p7i6B69gg5YpBI6RnmIsyzNomgaoGkHqPCMHofCWg0OhtSfuawG-iKBDrpym5BBiWIdk6EpgZM-DGKk8EVFkWrCHkYhiAyxYPg4mSKoo6xVH8BH4BIRF-ncGD+JAHD+BA3SEq0drEaB1IMYkWjFjBXE1NGJSqMIXEMmqwjSJkVQccIVjKmJy6SSKEk-qKACSLbICQQpblR2L+AS7bYOQJCYOpUoQQCvwwdYl7hi+Nhlv8ZgwjQQ4GjYygWPZzn2jlxHuUmnneZRmJ+SKqDKQAXvcIVhT2jGQfOZQ5KIGgAuGmRliq6gSEWDi4eU6T2PI2WOXlbktkQ3CwOwhIkHg-jlVVNWYAp2AzQBwydi8+6aYgAJFo+6owrImV1lhDJHOZBz2KlvHlpoo0uU5jkFVyU24DNc0LQFnDBatEDrQMFBbbRmbgQ1kahocajqMZ6SXihRQlFIZiHP8sUTrKRZPblr2TdNs3zbg-gAIIAELeP4AAadUQ1pCyqJ6pwaHWKqKFUl01pINZyrMaWyKjj1xma4ljfjSYfV9xNk5T-gAJp03tjVqPM6pw1kdg1Bxmo5Mo0hZPYcM5HBuPEeNIpvcQhPfSTZBQJyStupBFjJZlMUOPC96XTsXxZGoE4mHKxzGk0TZi89FtW1LRMLZy+DsGK23OhpztaKc5ja3IWgiaol3COh0iKv895cZlcpm6KUcE59sck0wRIN7ggPkN0JK2oDG0g072YAgsnrHOzyzoaIIKoQsJ62KdguZFx+QfiL4cOZHEvvTbMtLdg1XYiFmAGP4IXYFAuA9xFsohmol7KsWyzlGWwJ5rU+SZEHWqVy9z3R+vP1En9u-74fY+p9IY2AfGIZCd4axw20BoMsHEma1EFqdSop1Ubv2rpLb+JNYC4BIEwfw7BUA02AVpFUZhZTRhyILaw2hLriBDIZGyNkDh3hKOg1e1ta620CLg-BhCFYkP2mQx84YVQTlOOkbi48-hfCLKw9Y6gzzGWFmHJcFsMFry4TLMAABHboIV-DxygInQRjUdC9RkfeNYbEAxFEUTCZmNAUoFiMrIdhn8a7SwWkwEgc1MCclCsnOiqde7IS+EOGy6Efg2GPGWNUXwC6pTsIsBCbjF5qPFh4zBWiFqEjAF0AktwsHsHJEE8GysATwTKJUoyCx-i1D0KhdCKpHxwwULCP0HF3H2itgAJTAIIMAfAQjdCGKYuw-cjLRiBDZYctj9pOKZuAuQ2wLCWHLKHU0S91EcO5Ho7A+CAAyeAwAENQKgQJYNdpp11OZUwFQ6w1gsIsW82xeoZDyIZSwbVun5RbHs7oByCH22otgAxvjyBnNMceLIno5AHCeTORpdiqGQlMKPZBBwVFbIySvLJVp9n4LyaEe2nIzkXOhajEMp16FcW0nYeZjVaienpfDcs+ZYyqK-HinpLZpKnLkgERSyl8CqVFOMw0ulixB3VNYUy-YtRJXLKYVUl5fkTWyb9M5-lfFgoAEaOzKdc0JhwpzoXgusuQUiijIQyCyjI1ZFC6gXlywiPK-lJgBUCog2BCTkDJYQilRr6LOyyGqT0VZRExjlHAguFjBb6XLMeCc6DSYAHd5oBE3tvAYAMgabX8HgAAZqgAgEBuBgDZLgPEqAhQSBgOwQQ2aVqCGLagaFMJJB6WWILbQM9kWIDyKqHUMMRKCSMps+MEdcrpszYtCqW8VprS7pQQtuAS0ECJISCqEgmAknYCWwkHR61+CbQunNIVW3rvbcGkJEEqgHEwnS7SMNBaXQMkdGgohFk2ALqmjN8lfpBQMZ3YGq621lorVWmtdaG2CCA-9K9JaO0Ahgs+dIFQp4JXHgsMwd5DiHHTooka6TuUzoAwEBDIH80gzXRurdO692DEPceuDVHMBIZvVckN2YRIXwOCYX4JhLyXU+TBLOF4YqZX-XOimVNqZ0dLeW3Ala8AwcrXBkgerYCCD4JxlD5lwzyFSoZbYyguYcV0uIOG4Dz5oNI268jsm5YKYgwxwku790sZPY2rTOm9NtpQ18cB0ZMp7DkVzOG5haiJvEGeNJrrp3m1nfJOTCtFOQZU9B2tGnT1+cEAYfTt7woNTHdFhw9gFA6HfLrOUA9nUsJhDjBzSWq4pYCGl+WGX3OeeYxVVjeXtMFaK9xu9pWxGPl-acWU5QvSahs4+RUszNbTZk-JUlpyIPKdU9WnLPnBAbZG12Hj96JswgegR44sDx72HMjoA4uE7AxZTS15eTn1v4DJW5wk26PNMYPf1-bh3AvFfqokES+sZD-AnsZ3UiifaKMwtsGQWQDiyknaLN7yWKOGKxMYkUGXtvZdg6eoxicjs7RO+NuwzMjgl3VG+fOqsv1ansQXWwJHEtY7azjsnBPvu-d6wDo9+2+cU5TiV8HKpzLpEWTGWKSNB3GRDLM+C8T+JGTWwEBuhIm4tzbr45dYHNvXsyzt9T+2dd66CgbwkghQObXF8EyXg7z7Q0ynkDisprB53Hj78wthLA1Cu2xLX-grdYn1+3I3BaBeMa84DuDEfm42-bvbmjlAnflNDW7msHvLAlEqL75GgcA9-BsusGsofXvqOOSp8lmAeSEuBfgUF4K-VQtB-TQd947vwnyLCarOhTJSH1ssFU8EagCXQuguvpzA2N69USkIwMHbz-OZc47Y3wdUtDLMdUdKLBwzLMZh8cpFTS7MtJmvY058N6b4C-BPq-UBo39C-q3wFAwgEiYY-TTsgso1CILQ5Paz4nIN4SCuS4AcAEDQpWQ6jTLoRWphoMhWA9QXh6hOIThf5gH14L6QHQHsCwGOhb4u7FAxLvITzwzGaKjjj3iejlCmAKCuKpQuo4pkbmx374EAByRCAACqgHgCUgQKTBABAP0L4troIdiNCjZDzC4mqAsF+taogDZGAtoFYg6u7LgevhchILwf4AIUIbAP+CDJvpTtvvtJeA+E4heKfvBLUOZqhDID1HWAXCcACCkNilOtzk5FATAeMgNBGv1BUGjlaiflqAwUZqPBEg2DfpHP4UQVQCQRYWQUND1LqPCpYLarhCoWYj1KPqYOsrKGzJyuwY5ubAACogrYhgqrQQpnIP5ApcFv5d7KwlFdrf5qA1hfqK4IBmQWQlDI6pTGQVzxG5TdDNxEIbTtiOQ4i4Bm7E6VqkzeCVGCCTHlqCAzHsBzEnxtFpxaj6yHCoy-B-DgI7BOFFC1BzBKCqg5D5DRhagY7bJjT9Ikqfa6GYASDtYqQLpQB4AiFiH+DEqr5kp-F4CmLdTmQpDlD5iKDcylhNKWAPjVi4T3i2GzjoL+pgBkCBD7pcjjL-CSCtT2BqDHjFhahlgPSPhfrpDUJ9oAhh53DVq-zap4i6paZJhE5qZ7ZwbMm-SCCELwYckGoDIg6jZkEoxMzljiDVbwi0nF5bDHgPiqjMJqhw55BsE+HqLtZFIsnthskilJg9b-beZ8ncAClCnsnKSclinXpwH5iegTiKgay4SYaajbAok2BQRaj8T5BMlYLAn5KoCFLMleLYgmHcm7Z1qbFhl1yCB5IFIDJxm2w0SkFg6u5njmA6DgLoSKIF55FRKSDhhFiWCLDGbngBk5IkzNo7z+IGCLE8kxmoCCApnExnrLR1l7wdq4S9RKA1hqhOJJRdS9lQ6+hyi3ZKBVnhn+S-zAb1mNnRmVqxlYLwZzn-Tdn7G8YnR5glB1j-DoRniXFCLHCeglCLAKBDqPHTl1zzqdm5p7wHw4DHyLkW4rnVkdmLpdmFaAJ7ESkZnkEKAWLDRGROJyiIl2IXGhh6QszwTwgLA3ncLsaPm-mvl7bvnhlrmBQbk-nPl-npnd7kFZk3w2apTKEQX7SiCSAVDsToxHm-CIUyw4J4LarUxoXNmtmrnMVMCCktl8A9lzCMG2DbDtTFh0JvJ9xcRTL3aHCMULTcXaryzsXLktltl4BbG8K8UFY9nmT5CHmvgzgUXFAKjfDRLwSqllHaljS6lqUky6L6KrR87KUSAYXxn2WXp84Ok9QKDzwjij5qBjx2K2Ay47AcSwyyr2Zc46k462Xh6+K7xYDOWuW2yCA+J+IBI9n6wcqj6Gz8THmQRKjzCnDRhnhPZ4ToLP7YkQE-GirgkLGiHiHkC+pVV1WQl-AhhFiCYTi6gWCnRxKWDZkSJiKjyc7lGtYE64BEJFokCUA+DbhCpgDTVtza4kgqamJHjljRRmQVDn7HiKkID6TSCV6Ko9GLLvz+CTX+DTWzWkBmHjLWBlB5DIQ6BQSJKBVMQhhNZtQnTf7qDZRkDYAdCDAqT8JMYqbOUA1A1DBaXXWgwEXKxGwwSCwwzgKiCFGoH2DzDfpYHLC1KjXamQ3A2ir8JDJAwqSwDPQQ3QFQ0DJCkU0gRbkQTwKTYcT3jwhFjTbzb6w2Soy3IXn5DKAuAmiTUYDwBRA+Hw3OwiBKC9TBy81Xj5BUnhKKJ3hHnsTqgJZjXLiJhgCS2HjGRHFy3RgK2MqLA9TZDs3sznaa1WXPR60QRKBj4BxgVhFqh0LUXLDwVyBFinSa7jHmyrz22Qzj55hnj3h1IOB9VNKqiSB-AAgwjlCnBOLeGY7RVzq1m5ox60ZtpB1aRVieg9qj4c4ThDjvpAWGgpRqHelh7sZZ3gbXq51WEPXGxunoqKBGWGRzBDgYzl5AF-X+087ObyaKaN2QQ9WPiZSRSsSy4bDjwvWegTp1DGy1D42p3WU46dYj2pEAXoRAUo0qj759EJ1MyGRQjrDlk21r2Ry6kbZb0S473OplApQha+2KADrFBQU0JqCgVGbbBh58533O4P2Onj5GQlg6BML5wVDSC-CoLBzFjlBh7J5R6G4O7Z0N3b2EV4SGZKAXHLBuGUnjyj4FGqoKJQhTkD1OQtEXKj3HhOIiKHE+2LBWAMgr2YRWAcRB7QjPG4q5TUNfGJG0N2A9RPjTJ1jMP5WCTiazbZH5jIk6EQGTVHohS0N1jBbiKKAGUlDji9luGqis4LDlCr0vGRz8P6H8HSElKqOmCVgT7ynIQ0XjiWYTwPSHkG391RW37gH4EqZpoSGbjqC0MSJThAjTwxjv33jSn6TdFwyoyWDoKCOYMVIIplA3yDiPG-CFl5mYRm04R4SC2UMSDVGt61Ht6QqEK0O1DhIGQH7WTl5lhfpMzGTI2oIZDHDGO8PmwbHTEDCzHPTzGj1wy6i9TbAOGMEe6z1XEDXrI+W3aFGWVX25RvGgmfG0POl76xP5j2CmB5BdRvJKJWAJo1hTLoLLO334E1VQBbjMmNUVQqaEi0PWA8wxjonbPISFnGRdroqzB4RcSnMr7nMb7fEUa-HKT-EMTZ68YBXSB1jGagIImJSKg6jHBon5jISYmFPYm4mwD4mDNIS9Qa2CxPUcwNMQhKBo6+xtJVlar8LWn6qciDPQv8xXis5GyaglBzCrJV6jjuEFOePX0xWBmJkhmnK2VWNJM3LgLItGOnC8x3xNLwWhjtLLKfOiJyU1nnorR7yMtSu3IOORM2TIQn7DMyUypyBVAp0mPvYBCxXIVFD31YOXh4ZKD6tytGtNIaE6h-BGSXgD5VA8McGD3ySxUZ3-xPlHwQvGoRROvSuelejaApCJSCwwS2AKhZA1AZABsVFBs2uBl2vhvHw6vOuMFqjQKnT5V2B726g0Ld1e6WudM5t6kzkKX8LUyMtGQ6gmaZC6i2BGR5FwvJRq6uz+mFM2WBkttELyztvQldsLCCxaz9ueHmDISKIHCe2LBamLPY5zqxXuWOV46JxFuxvrDxvIJwLJvLLbA7N3hAHqtxXpVYDtvSlcSrIaG-BxKygMHBjPjiABUVXNWv40MStQt1YCZFi4S5FpRlj+U6jWJKEH6X1WvmyVWAdfGXP+B1W0O-BMxgfDyQdZAftmBDiMwrKRPX78u5QoefHAuZoqQ66A1+D8j+pBQChYc064cQd-BQfjwCYWJPXlApBEsdOBsTVTUzW63AcQRHiRGzhwvqjK6l2oQPGQgcRKA2CiI6D-XU1E1XOg2rUScOsVJktPM3vI4JvvUHWmrII7Cuz8TCfmiE2cDE1EKk0zTk122SeQzJsdS5DPhyhxbzbmRITqmZThiKILwuBAA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: {
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
        openPanes: persistedContext.openPanes || ['code'],
      } as Store,
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

          'Delete selection': {
            target: 'idle',
            cond: 'has valid selection for deletion',
            actions: ['AST delete selection'],
            internal: true,
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

              'Equip Circle tool': {
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

              'Equip Circle tool': {
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

          'Circle tool': {
            entry: 'listen for circle origin',

            states: {
              'Awaiting origin': {
                on: {
                  'Add circle origin': {
                    target: 'Awaiting perimeter click',
                    actions: 'set up draft circle',
                  },
                },
              },

              'Awaiting perimeter click': {},
            },

            initial: 'Awaiting origin',
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
          Cancel: {
            actions: ['enable copilot'],
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
      'is editing existing sketch': ({ sketchDetails }) => {
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
            item.type === 'CallExpression' &&
            item.callee.name === 'startProfileAt'
        )
        return hasStartProfileAt && pipeExpression.body.length > 2
      },
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

        const updatedAst = await kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
        if (updatedAst?.selections) {
          editorManager.selectRange(updatedAst?.selections)
        }
      },
      'AST delete selection': async ({ sketchDetails, selectionRanges }) => {
        let ast = kclManager.ast

        const getScaledFaceDetails = async (entityId: string) => {
          const faceDetails = await getFaceDetails(entityId)
          if (err(faceDetails)) return {}
          return {
            ...faceDetails,
            origin: {
              x: faceDetails.origin.x / sceneInfra._baseUnitMultiplier,
              y: faceDetails.origin.y / sceneInfra._baseUnitMultiplier,
              z: faceDetails.origin.z / sceneInfra._baseUnitMultiplier,
            },
          }
        }

        const modifiedAst = await deleteFromSelection(
          ast,
          selectionRanges.codeBasedSelections[0],
          kclManager.programMemory,
          getScaledFaceDetails
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
      'conditionally equip line tool': (_, { type }) => {
        if (type === 'done.invoke.animate-to-face') {
          sceneInfra.modelingSend('Equip Line tool')
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
        sceneEntitiesManager.setupRectangleOriginListener()
      },
      'set up draft rectangle': ({ sketchDetails }, { data }) => {
        if (!sketchDetails || !data) return

        sceneEntitiesManager.setupDraftRectangle(data, sketchDetails)
      },
      'listen for circle origin': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setupCircleOriginListener()
      },
      'set up draft circle': ({ sketchDetails }, { data }) => {
        if (!sketchDetails || !data) return
        console.log('setting up draft circle', data)

        sceneEntitiesManager.setupDraftCircle(data, sketchDetails)
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
            const addStartProfileAtRes = addStartProfileAt(
              kclManager.ast,
              sketchDetails.sketchPathToNode,
              [intersectionPoint.twoD.x, intersectionPoint.twoD.y]
            )

            if (trap(addStartProfileAtRes)) return
            const { modifiedAst } = addStartProfileAtRes

            await kclManager.updateAst(modifiedAst, false)
            sceneEntitiesManager.removeIntersectionPlane()
            sceneInfra.modelingSend('Add start point')
          },
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

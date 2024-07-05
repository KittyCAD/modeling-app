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
  videoElement?: HTMLVideoElement
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
      data: 'line' | 'tangentialArc' | 'rectangle' | 'none'
    }
  | { type: 'Finish rectangle' }

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
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoAWAHQB2GgE4ATLNEAOAKwBGAMyzNAGhABPRFNWaJmscOXyp61aplWAvk-1oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEFlK2l1Gil5UxpreTEpfSMEeTyJYU0reW1hVRTxYRc3dCw8Ql8AgFtUAFcgwPYSdjAI3hiOLnjQROTlGgl5ZUWxDK0ZVVlCxE1VOfXxGlUq2R1NKUaQdxavdv9ybiG+dhGosbjeRJpNhBpzy882vz+XxQDpgXABADyADcwAAnTAkAywZ7MVjjbjvRCfQxY37Nf4SbAQTBgAgAUXBcMCAGs-OQABYo6Jot4JITyYRSCTqDk6NSadSyMTyL6abQSZQ6KX2CwaM6uC741qE4mkilDWE0umM9SRVGxCaYpJ5OZidSiOw5TQ5DJfZbyCQKKQ1HlWLTKc14jzKokk8mPWHdDBM16GtlJexcxQHYSyVRiWrqL7qS3zFKSuPiIVmr1XKAqv1kvgsWFPeijFlhqbsxZpk0ldRiIW1L5SWxlEwWGqzGwJ3ME32kgAiwSGgWCoQmIcrGPDgiOEq0nMy9lkUjEiy+cdkEnEWXXsnUks0eX7yu8tPYDOIZEomAv2unBtn1YQPLF8zEFg5qmErryyaCnMNDCJY2wOFIsg0JoZ74BID5XvSBAjiSY5BCCYJlnqzLPpM-DGCYjqKIcyhNjIix6DiCAJlyxzLDKOygSBsH5gh153Bg-iQBw-gQN0sKtFqiFPuieGJFoChlIKKZSMoMhfuaW72BKShWOImQ0By6gsfBl4Mrp2oAJKqgQyAkLS44YeC-gwqW2DkCQmAiayr5aJoyjmEe1h-qBkrCMmwoOnktRNrMiwLDBCp-Oeen0gZiHGX6ZkWehoLWfSqACQAXvcjnOVW+Fvie6jSGICbKNsOjlKByYnqah6HHstg0DQ2lRUqcFsXFXWJaSRDcLA7CwiQeD+Bl2W5ZgvHYINt7DOWLwzmJiBaK13KyQsFV2LJyhfCaqi7q1J75Ns20NO13qdbF8UMr1xADUNI24DZcKcA5U0QDNAwUPN2Ghi+hVaOau6LBVrXyIKphiHtCwOvkLVyAcYptU0l2sddPUmf1uCDcNo0AIIAELeP4AAa+UA+JYoOg4Fg6GaEN-qoe1KGYUEcuI1ryK1yg6V1N30nd2O409-hEyTACaFPLUVJ7mLJjZyEojXQ1R1prh2qy1KRO3najeYCwLQsPXjz1kFAJLS0aEm7IKsxrFBG4ilRWTA9zZWadBCxlWIfMY7Fxs449o0kvg7CMgt+qidb7mSDsdhyX+AqkZRRQcjYaSHIF3OLHYfvakbWMm6LTBwqXuCfeQ3QIpqn2zT9VvhjyhHlIcUHhZksi7S71hmMINSZNzLVNvI+eIYXfrC8Hz3jdgOXgo5mAGP4jnYFAuCN656uOtm5TeTY9jJo1n7mhp0EqJF+sEvzmOT8Xo22W9i-L6v6+b4DJ7CBIv6LA4xyZKBVOK1yhx22MIEo24vaX0VGjQ2t8+r32erAXAJAmD+HYKgMm78qaiHMP-OSCZDw5GdmnA4JV1C2CbDkD0h55RXxigXeB90g6m0CCgtBGD-BS0jjhaOTcKhzAhhA8BFC1xij2nYL+TYEzxx0DsWQY99JMKnqwsAABHbojl-ChygOHbBK0LBzBqBkRMKQeSKGTFIcUpw-x5Gpn+X2F0DY3wDkXFhJcSDDUwCSJyPD-oy1WJIc0WQlDNUbFoZMcYv72BCq1UCWhHH0Kuow1xd93GjVhGALoMJbiIPYMiPxS1rbEVKinfIxiD7JgqjuJQvZ4aHgFCjGBzj-ZGRMgAJTAIIMAfAQjdCGPot8DgDqxi7nVepSYqLpDKvLTk6xwEgV-HQ5p19WkJRMhxMAXFPoBD4gJfAQkGSDIkg6P8h4KFyU5oKZMLUzAZH7uBWM4EmnRWSePZR3BH7oMwVCTx2ASAACNLaFNwjHY4EoMjeSFIKcoJCtiM3ML+Bx3N1iJJWQw95qTSQMnNlsjBqBfF-SKeGLImkJTRgUHsMRcK3x2AdPclqECKp70UXFfGAB3EaARZ7zwGB9L6c1-B4AAGaoAIBAbgYBCS4ChKgWkEgYDsEEDyyaggRWoEGVUDQ39e7hRzpYZmLthQeUgikfIZVsiNlZRIDlXKxqZTnpNaa9dKBCtwKKggcJYSZQkEwBE7BRWwg6AqvwyqHW8scmq91GqQV8NfFqoKOx3Jdy0usPa2g5hd1AnkcBiwDjLNeejAutqeKP3slouu31XXqvFZK6Vsr5WKsEGW96UbRWasqvMKxO1SKzHATDSS1h0jOmWAoCh1qS0BBbRWgVP03Ueq9T6v1gxA3BqbdOzAbaY1EtBSSzt0Lu01E5HIVWadXbchTMKfugCxQTs5TxcWZN51iolbgKVeAG1SqbYC2Agg+Bbo7eUFSpqMgWDKhsF2a4So5HAcscinJR5ONWcW+9ARH2k2fZ62E3rYS+v9aukNSqf1-oA7GlyhUqigW-rGFI3NKEUJZlkcw4h8hWPtjoAtHUi3j0nWLYmXDMOvvfTKuVX7Q3EYMKRndcaKMVDME2ChYH0h2IKGre5EgfZtg3FSuSd67WPolphxduHl0Bsymu8TALf2SfVYBoJ1Vtr5AhjkUUindx2A3DUXsp89M8XNiSQTdaP2icI4IfzXTbNkYKokSjkgvy2ECcQvav4DqJxPPGAUh5TxIYxfpXj4WjPYaXfh8zoXwtSYrLu+NFRUvLHSP3VqzpJlp0OF-A4UoEw-kob5gIOjw6BbffWkLTa+v0gq4tKrsnwHUYqgA+wGQaW8kkC1Q8ZpyhtgcD17RYJdH0kKzhvDK7SsjZ2+HcbUdyMxbk-MOTFRQL00bHtF0ZQrRayPNzaBhbDa8dLrCculdq6eOdVWrZNahNDcbaG37-37KA9hIIStc1zu8Mu4gKo6RdxCmtAKaC9gGM9wsJ5TuOQTCbZy28vLqH-DQ7BADmuwPBU1uM4dszQbQs04rrDmuCPZ2UGR-4o06PgJY+gukZ5qm06yS-gKYnclIzWoADJ4DxagAlBAcX4BVwSzVohonlTbEeWFW4Fjfx-HIBrNhWqK+V98glEhDK4A4AQTVEVHTribAPDQEUvixjmEecpyN3KnEQ0k7j+kldvtt5ge3jv2DO91JVmTV3BRlHcpBDcCg+StlrKOuTphFAJk+1xw2EetfR4AHKYIAAqoDwPkgg+MIAQH6J4gILA6+atsPStbpx24nFPYgTkHl3K-ghtsDc1hebk7D3FUvUeJCV-8DXuvsAbw-UJYn1Hb4-LcisAI4ZmRu5FGahp4UjXtbt2tQ7p3xyQJ90ZtYGDkL-JTLyHDBJSa5NyCv7H+P0mt-pDgqaRWBbQ8iXIv5FCrRzBWIyT7BZAj7WoAAquK4I-yU0ni5A3y6u9IuKUegypwIE5gCYMYCgDKEuxgtQZQ8Mzo1okEOQqg1q3QFcmCs0pYXUEIuAtag2wW8q+M3giBggTBEqggrB7A7BG8UWlMBif4OqbYEM5U6wQorY2q5oCY2msk+QQo1qnSoQBW+KmA2BuB+h+B6Qfu8Y1g64zcKQ5Bb4mkO4f4HcOwagv42hIQ30FsZeNqqGgkDqUAeADeTe-gmSuh+AAWvheA+BdW0gbcMiTyJirYGOGQBwCwgoxwFQIe6KFOcU5AJIZAgQ-qpIxylgJUlhpgMgmkJ4WQgEEMjoGg9MIEtyf4W2dwMqr03yNkfygKfo4OPBYmSqLRj8ggGCzanRQKEW0aHaJQn4oEg8Zy1oEB8KJujYdiNiGgsYGRX2-MvGAxbRnCvyAkXRpIzOpmBGTaOxpYQxqAIxBxYx-OxK1WpwUkFQMg6QphCxCAYoqQchQoWkR4goaKmx102xiCQRWSqAOSLRIsK+XBwmn6EgwhkJ08ggmS2SXSiJpsWEm+0WaOxUpu0KdhFUAo7xR4H4CWNgKYtQJOLyxeWxVO6JosKqC83iBgMJEOUqCJiCYaE0TJS8HaG40gJ4HGSwsMA+RUGO92UEkEaxjYDB0+32dJIJG6S8rJvR8JVx9JeAzar05azJHav4GmsMNgkodSAUOQ5gVgtg2wLUJJResCtJdqGpM84ak0S8K8OA68KpIm8qHJ6SuAXJjqPJkmr8Eh-+2JxQYo9hGgOwywpE8YR8FCKk9Q726hU+oe8pDpip2p70rpwZnpcJPpUJfpSpQZ7pIZWJUh4ZNRewyxG4dgzWwCWgzGh4kohw2wFgzRIJyCqC7RpMeZIWBZSJXZTAlxf6fJXIBusYqRFQyxe0LGu4lQoydgVp1JdpQJCpvpbC3ZnCEsfZ3p6pnJQ5I5BgepfckKI8Kc2OEi2w8wbop8lJKYHZG56imiU0o2u57J+5vp3SGikao2Ha4oDRnca4cuhqkBK4mOoEhwdB1MtpLSKGGZG5TAnii8WA75apggjpggSFXiPiepbWwoTW58MxQCb4QoXIJJEM5oDUIC1qRAOBmu-giBquBhneZo7mYo0iDgymJFgBJRpwZEigO0SgtF9FMAjFzFf+5ZMsigjYpUI8e4ZolKNyh4ApB4ncQlesmRM+EgdFuBTFauVA8goZFZAoTY3IEEjKX4ogOgylfFalgliwWhcp-MulDF+lLFmgxlMszxXIsYtQ8YYurMoFK0cgdlAlwFfkrK-guAmCwqJAlAPgE4uyYAcV1cbeCIb6gy84ZKwoOgMKzhNC7xnIZgzosYZ8eqCicpZA2AHQgwgknCy6b6aF1VtVQwI5cVlAgytML2tS5S5um4VE-cJUpKPaf4ViGxxeLVdVBynCPSX0gksAsUzVjurVXSwxi1j4khMscoZQxE4C2gFC64wVHxBw5pDSaxmQwSmlgJBcOh7hAW+hXhXKC1IQ3AzedwsIb6sIBAAAYngDNHtsEfdb9FJUaN+KcqYNMqIFGY9lRHJA6MdD8X+NMuuK4SER4fPn9Y7rAPSJAP4HdeFs7ltdbOUfMNuDVl3FdVuEBs2UoIjPdohgqDFRgPAFEIWqDXOLGNEpyGIrGTrMmByLuOPhlppB6GLTpIOBza+CIPyUsrzeVPkF8LnN-NaB6JDVUK1JVWmV1FLYDK1CMg-jnKIFLleYioSccBDEsu2c5WsrdKqLreJMQRphxRBDUOBgLdBCDGsFQmuBuLBchjxlToyXygznOuqg7StA1N-M6HGLYFVNoKKSaMNecnkM2ESVthuqHdWtGhHaRYoGTYodzBQuaJpDDJQWuAjA4MKOsGTtrWufpvxhhuHRNknpHcsPMNJGeYJSzO3faH+HYc5v7blmylTgZs+rnYKOKP3GVMpmoCBAoKKBkEEpaWLeuHJNsFtgVs3RdmGf8Q6KVZpEeJBNoGoMlgmTHTzRRP3NYFtqNuPS3QARxirXGGVNaBUS2C7JBapR6JDPNiuXBYHXahznTkDojmHTnQ-bvVBGzMdOmGoBVFUS7HQWUEehVApKRAcNbpHvobnZbYInIHJmuGIjYesNBuAlYrTEnKcFg54dfuwLg3bPMAQ+UEQ92q2GtCmA-g1KFZxquQXHPo9TFUGo5Lg-GJIFQyYsjYeAkaaGfhQhfjkDQ-PovsvuCKzTvRWaSqaNJD+KROkIfFRAbvMLyPxdVJnj-hwBPfVtIB6PaHURzMSUBPOWBJGNBUgSgZwFohgd8rncHstsQaxgQTBj7lPf3L8X-L+FrVpYbEISwQMGwbFBwRPVYl-JyI2PEqfKXVRDEhphkGvQg2DACTSddATaEWXr4yBCVHJB5lkNzNzO8cMo6KcN2h7nGLejbbdW4XocxU9eMAckEC0e9ZlF9b44ARKLYPGLU57O8T-RKCkI0tDfdkPVkRIKUxjY9ZOj4QJH4XhALuGKZSVK3CYH2joPEYY4kWsCkccFVBNXw+PDkWAHkbAAURPR7B2JKCYJkGtvWbYZkI6Hfk2BYG2BvR04AzxOcQEHsaMSSBPdA004Am6G-lk0UJUTuIoGuHIYzJBY+YWaCaibkr6fkhPZKNBieFzDYDUJUVUjUUKcVfRGPji9PPatyXykvMSypVAppBS-nqKTyF3OMyw8cFRZUIy6wsWey6SxrSUM6Dy6aV-M6NBE6BrRaaKwyc6YGW6WvLs-cYDCS0LVUKcB8xyLJEfIQSmH5UjFkFBaqw-Fmc-Jq+vBK-q2KLJGuByEfsAmtKYL+CdC1P3FYja0guwj2bC57TcxoIa5pL+LOXLAXsc-teILKXXfBeC52cG9uaGzA+AhG7JFG+8WPlGG2HRB6E8ss9pcCU+T+a+advSE61Aoa260PpYoQTYqIqILWeIIG9Tshd4lgKG0FLMMjHJHJJBDSpPQdKOr2jGNkNdcUwXK5WJe5bgwAt-PrrYPM2O3WapeFRpVFTFf4B1WALnfOO5N-JE5tAQkXXaDUN-IeEoKzJ8T7DpFNZwDNZgo1Ue5AxWeaGzNYBuDQbTFmj7ocI6CkEml+BBLcwbC+-VZgnNYNAtbFLnf3F2vASeIfodR6x8cDJaFZeSWNWjcDZjf9TjXjWszC1+95Qkme5RTEunC5lRFBF-CkNAzYLDDKy4C4EAA */
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
        (state?.event as any).data === 'tangentialArc' &&
        isEditingExistingSketch({ sketchDetails }),
      'next is rectangle': ({ sketchDetails }, _, { state }) => {
        if ((state?.event as any).data !== 'rectangle') return false
        return canRectangleTool({ sketchDetails })
      },
      'next is line': (_, __, { state }) =>
        (state?.event as any).data === 'line',
      'next is none': (_, __, { state }) =>
        (state?.event as any).data === 'none',
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
        store.videoElement?.play()
        if (updatedAst?.selections) {
          editorManager.selectRange(updatedAst?.selections)
        }
      },
      'AST delete selection': async ({ sketchDetails, selectionRanges }) => {
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
      'conditionally equip line tool': (_, { type }) => {
        if (type === 'done.invoke.animate-to-face') {
          sceneInfra.modelingSend({
            type: 'change tool',
            data: 'line',
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

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
import { applyFilletToSelection } from 'lang/modifyAst/addFillet'
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
import { quaternionFromUpNForward } from 'clientSideScene/helpers'
import { Vector3 } from 'three'

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

export interface Store {
  videoElement?: HTMLVideoElement
  buttonDownInStream: number | undefined
  didDragInStream: boolean
  streamDimensions: { streamWidth: number; streamHeight: number }
  openPanes: SidebarType[]
}

export type SketchTool =
  | 'line'
  | 'tangentialArc'
  | 'rectangle'
  | 'circle'
  | 'none'

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
  | {
      type: 'change tool'
      data: {
        tool: SketchTool
      }
    }
  | { type: 'Finish rectangle' }
  | { type: 'Finish circle' }
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
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeRJothBpzlsvPDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd6IT4GbG-VoAiTYCCYMAEACiEPhgQA1n5yAALVHRdFvBJCazCOQSRSctQyKS5RRqFTWL6nNTSfnSsS5FRiZT4-7tIkksmUkZw2n0pmKSJo2JTLFJWwLFSOBy7WQ0eZFXEIczWCRqaxyOq81KKAWOJUeFXE0kUx5w3oYZmvI3spJiOQyZ1mZQyeUyRSC4RfXmndKOKRyWUpmqKX1XKCqwMAMWwmFJT3o41ZkZmQnzEjsgoVXPE2TtJS9KmEPNjuZsKbkDmLhID6r4LDhtf1LMNmKjgjEdXSrtENuEihUcjUigz-cUEhqeaUwmsqavE-9aoIyBIdPDDeXTYdTtSIusalj5qy+xfFyaSxvUKh7rKdgqFIt74GWZIACLBCMgTBKEUwvku0z8EIO7lNoCZjqm5qKGIGYxuUNSXj+iiOLR+6waWU4EAAKmAjyCOwqCCEQACCCGYRi2GzAqTpmCkspqLKf7pvayj9hU8gFPs+TCOaciMfBEgMsSYAAAqIrgcAELxc7YAAZiQoT+FAcIkEwDL+CwTC9IiIwQIJbLvoI-aSuIia-loQUyLJJS-nGlrQbmXq0VIKiaVOEiwAyqAAO4GWQxmmZwlnWbZ9mOWAXRMJwkCeY2OFJHu3IKDGYicsB4F5hmvJOqmB5ejQNBWAe1iad4dLsIyxBkJQmADTq5VvpVrXci6Np2AqmTGLocm2CB3petYNCurV-WDcNSE1mAqGguC871lhxpyHmzo-vVcW-jashfPKc0iuIuS7Gp3X7TqBB3Bg-iQBw-gQL0cLtNqQ1MnWLyvsJiBermiw5DUYGXoB9oaDV9ghdkKYaGIf0wxIE0wwAkvej50qdYIQv4sJmeQJCYFNiMIF6NjOrUtgpruY7iEe8zOsKNiqKcY7xc0BIquTjJkwdDJU4GNMnUEZ0MylkMAF73Kz7PGjFA6ittXVmEm5irb28iSo4uw0DshPniTCvy8r95ENwsDsHZeD+Nr2B6xCrNg9gPujaMcMGkJRv3dI0lHHU+y2F8thWBUqjzNUW6nK7DKKzqKtkl7uA+37uCM-CnAs5gYcRxQUcLhG02JDFCxupee5ZMoMbW4g1TmjyUEpMBqZrvnheU573u+yQ-u8QAQt4-gABqG1GW3cjkNAHo7O61KF2w7WJbo2sKnJaDsk-u8XxCzxX-hLyvACaG-vlvEifdJIpWD+-cIBTGuU84FBQ7F3sYaWFw-RwXdlPRkd9S7l3npXMgUBSTvxmgKSQwpsimmevVI+pQKLSBurmWoMZsg3yVogh+KD-CknwOwWGzcEZG1toOA4Fg1z-1zGnVIA4BTRW0G9GM1Ci4zzLnPf2TB4SyNwBAbA5BXIkC1IohulBMFt1dAsFMOiFA2DlGKe0Sx8inkLBoTG+MNIy2VLApW8CPaBiQdIyugdg5DGrPofwrNsBQFwFopG9hyhclTLaM+ADSKyFFgqSwSxoJQL+DA0scDb6SOQf7JmNdWaYG8b4-xgTOY2BPOnV06hu6pB7EjYQ-JFi70yOIWQBwYK2OSY4xxtCpGP1gLgey-guJr0KV6WUX8brbXAjaXqRCry72kOBWogpur7k5OI6ezi6H+x6X0gZb9o6LljpvHY5Rli-mNjdc5acrw4NSDtBQqYBTgVWQg9JrjgYAEdeih0YVAZhQzTiSBsEoPMwyXSxgzPuNIFhagOCklnbQTynElw2ZXJgqicnUD2S3DmXpUhzK6ji-YIoYxp0tKjfkygFBcN-AizpGTK5wiKqgWEtxkXsBRJithm8fxmhyIKZQu5ZDCgzEFRS1FqhJi6jY6BJZ2lpMDAAJTAIIdiIRegjCGTuOMxgok-nlAcUiLVZmkRqa6YUqZUgtOlYSVJND7yAxOiDAI4NIb4GhoyP5KMfx1CTPkHaIUZAZm6iePMDgYrfjyDSyRWT+moEZqo7AJAABGGCOVXUOSKVsgo+ZaGUFyIh4tJCOy6gea0ShciRsDIyNBJ0uKoDZqmg575bC-lMN1XYUlVg3SIbyTI6Ryn7hdCOKSk9eKpXngEdx+s67qKGI3fweBzKoAIBAbgYAiS4GhKgOkEgYDsEEJOkOmBBALtQIUweA4cjaH8mOd0adoLcj3FeHeREbojrHaDA9nj66zsoPO3Ai6CDwjhKgOEEgmBuUXXCLoO6-D7pA0HKdx7-2nobV5Sq567oKCWXmWopw73qAqISk+uRPRvvHVXZmocZ2Rz-QBldRl12bu3buwQWSlGsyQ4us9Tt4y8i7IFSBacdgnnKZBR25hB1kdBmx2u36aMnsA3CYDoHwPDEg9BljMmOMnu42YCoZqzCiHdCoITsyFDqAsEseagopMBGfmvWjS76NrrwExtdLGk2wEEHwTjKHWFpqbTsNIdUzypFFHKcUO1JQ4YyLIf5e5Emy3sTqCQo7yP2dXo5xTymwMQZAxp2DnnvO+d05KQoroDhPqvCZkx2g4y-n3LKc2xg1C2afsvfwL8svOcY1u9zhXE1ef0CV1DFVEjVHqDyGppEcVdWguKYZPJrz1WgmeRLdiUkOLS6DezXWFNAZA7ltT+WYN7qK8NnTo3W4DyC3MzINgalETIvaEcJ4LW1HNPVH8fVWkyrgdtgIaDSTddXb15jhX8CkhG-5xt6Gdh213LkbqBwu7TK7qYdQ8x7BrgUJapJf2tvvsB5Dk6+2lOHdU+wdTp3BBA6VZdmHaHxshT2L3CbCo1y5DTmBdIgLsgzaam175zCQcMdc31mnwuGTQ8urD5nMZFhvS0KIe9Vg055k-KpC+l4-5C-BD8xyZOcuU+pyxqXMv4YBbhwrg88gvoaF3NMjICwljKFt53KSeOkubZSwDpycjwSKOUYiNR4cf2k+Q8u0H4vwd7tkXCeRQeVFwkENRxuFuY5M5uxYdIGRsjm3+dMrQToNBZFSA7cCso2vx8T0o5Pcm51G4p3lqDNOa+B7ryH1PYfI4Z-2Vn0owTc-KDNrkHYRfwI8zL4siw8pia-etQ4gAMngGtqA60AwZNWmNdaz2iEkAqewhRxPmgDXJfFpg4pdrHmOVrC+5bL9XzvzAEgKa4A4AQM9ro0jultyt-kSwXwWcCc+QEmAoGQSwk8K+Rkz+r+7+7An+eosuA+BQKQFQ96loIoFKXw7YhGjs0o-YnI189+yWpM0Ba+daEgAAcrGnpKgHgGyiZBABAIMKogECwAwXvnFM6BCpkO1DUlJEASmDyOAk7L+HuCFFAU-rWi-jQf4HQQwbACNI3PWozmNkjFoAsHFJQhrvmKnPaG6AjmYFJFePILIFKvjovilm-h-kMo0osKXqXkFi9HJPYCeNuKCrULFNBJPDYQgVQEgZbnLkjA0hjgeIZrvLGLyBmKcPhPsHYJVvRDUpPCxNWhCAmnXKouQDGpvtvjIYUusO4WUEOGOJzjgcoKeNtPmAAeZjIJPL0AorGhHHOO7JCLgFHmLhuhLrxN4CxIIA0SuoIM0ewK0QEldtiiFCePUGMojoKBoDViUMClNvKNBH3HuCKJPIqqEHTs-rkfgBQaocgeoYArvMcjYLYHYJjAeIGssA4dUP5LETYJsSELOuggcalkTlDEEHcAoiynCEZHCAQJWO-slP4AytsSTgUepOYkcKRMYWuF8PyAsJoKKH6inE8SQT7qTFsa8cDjIR8eOlDPBlAHgEwSweCbiSdMSXgAUVRK2HjJjGatEQYbiqoOYI0utLyM8RCW8bAcCeHAyJAP4DiXTp-uMcaDUMIR2LVLFPVHhufnYIsKROtHFIKnYJPOQKSGQIEG5GSEMvKCbO1LkCYbyFUpzKmAsJjCRGFh1F7htu0n7j8dGgMtCPGkmoGD1jHv1nuk6dXJxNxK6ZDO6fTshtxo4HdEIi6PRDsOKEsAOGWh1DUHNnuG1r6XODGnGkGcmmSAdipi3gVj6dwFkv6axm6dmX3lisaOKk6DRDaKUefI7OKKKA+v2KiTnDUvPlag-r7kTiyl0vQgyj0Myj8XSowZ6V0duoMSOa4oIIOUykqtORXBdEESgSmBet1PkNkNBDisKi6KeFfvevkLhqmcigHPBh4jkvoB0S5hOWulOcinBrrFOrktxoqf+EcrIFbGaTipKCONgjGGpJVief2ZktXOxl4teWDnedxIuSgqxmBbXC+eKVGBNieJkGuKAuFgkkeFyF-KKEyTvCnMBXSmeU+Yerkj4jgP4pBV6RIPeSBbgI+QhuRcNvkmMWoddoPkmJUcXvdlBP2ORG6KYD1DUPMrGEmMRa8lpl4pRX4u0eOW5nRTBQ+dJbkrTlRexUcZxdUOGZyHmPEQWI7hmKEs6KpKEgkpEZJd0r0kwBmavDRbeUpYILBXgEMTZSWXwK+U6PMpkFoFBKmGaTMk6KoPJHmI6CspiQ6b2S5ZXFsrZTsg5YpfRXSm5fZCWfoK+WkEsIQpeEmH2IFWLM6J9iKAKKYlYFZfQmAB8l8vrswolRLslTOVVZ8kelLtxlmEOI7i6O2JsHJAYukAIcEsqTaBVTImitWFgPVZOcpQxYIKinZBNYcSuccRNh3NtBStoGpAqIFebAnCtOSmpJKZPEQFvvsf4CxOvpgGKRxRzK6DsBUAcJ3OYDUksi1LsK2JkOIS6JuFXpFXAiddvhdRvgETdVWQcJKKbJLPIDUL+G9WaJ9aoN9W6L9V2aQQrADWdUDVdVQNYKDVGCmIqbIEtBkPyKft+aRPDZEeoAUMjcdadTAOdZdZ-jIHje+PjE6NDaauIPIKkHDR9VTUjcnHTYDUzVQCoKzZVFRCJrjgKFJOFIeHJBTR9ZkJXmEqKE0KjViejdgHCJqQcXsQzfkche+M9WkJueJRARuYibcfqlJNuMKCkHaW0v9TrXrbAQDkSZDCSe0bxMwbcK7cDtSZpctZxaKLUrRMKPyDdAcAqEAeIK2DkKoHUAeCnRYd7u0kQAHe8R7a6vKiQIov0ECXgAKf7brSmhLYkHYKRM6BKvsJeAeGrvaFoJIPuFYPsDaGePVMdVnXycXclEKZnWXXqcbZLeSqYI4CtNHRkGpIGoqVcjkPmI9o8n9UrP4LgLGrlGSL4KSNZBgJZK5OwYZE3FpRzIINtN5T+ITOXvUMKEQlyHGB7vns9AUHfprRIGQNgF0MMFDAMqpkZFNWuh-V-SMCWZvYUjGFqhAoUKIAsgAtqosLsLjikImD9m-UA9-a6gMuxGHl8UrAA+-e-sA0qlxEMUrOAw4K2F1HyqqZuQrSUNjjyOFLtPIJkDeL8OvRgPAFEN7ifcaCILcf2EFuZgcOoEeMiYnbRG9FFF3ZFVOLwyuD9K2G3bmI9FCjgQKOPcaVkDdLuLUAlGqNpLpBlEZFw5nscauHuYI9Mao6I+fjkIsGWlFmOAoFQrIwY8lGlMY3API95DsMFVoB9AKPYAOoGvY67rsD+M47mKg5Yd2TDD4zNA4C7o4QcM4WfiUKgQnTGOPEoHuIqCvSlnKmAAk23JXktnWXk-VBFmtDuANdzWjIQets7YTuRp+lRj3o3shiU0jHvAg3YCFfxQKHevsM6GpKIInTCl6G1tJQ3r+iet05zIOjwRKsrjUmM0JhUYdatvjHk21hlo5gs2LMchQoUKCqoM9hkxoH5BEvuI4IFE0wTj2elh1ntl0yHdiqTSAteATPeiFAttzHFKsSKDjOoG1jsfM+80bFHa2FBEIt9o2SYgBTC0AiGoKP03rkwobm82Y5xWLDWXczuDvIcMYhk1LMrVZvUI7G6A81YaTH7u3gop3qorMxHouocyKjA6k0TVYIFY9OYg3ehaEhrbE2jQXOQc-gs9VscikFhi6B2o4EBIqW3ZZjUs2eqQU2QdIZdXARwJKxfNIDK-MHKwmEQjhukGmP2MabUKoFITAfievVBqzJK8aQ4VkLYAqLvFJBc4gIYUtvCaYQYmnfaXAuK-iXIQoRCKY-3iteoIWhQotBKHQ4gEec6HNhTcsGuCkL4fAYc3wa2PUEoL-Cjt65zOtLzkoFtLcntBqwrKkfsekaHFkTGgsywyBGUGM47V6EBNoPyyUfkLIBFW-XAgMU0UMC0UrG0Yc1ESAssEoN1HUG2kBLuF-EoAUFtTdEGtyZSRK5C-jeIAOOJHLd3EkyS0YNxRcQtEmGYBkJ2SK1rQXCKSTu7Z8a6t8dwCwXcP8fCC2yrRjs3SKILKwzgWOKYPsJSvcVU0WDWw+y8TsfiTnVAP4EHT+yFKeDFCGgRUAayRMhyduTE+nXAo+7yfifyf3SwUR6SD+z+GSrkDvLYDkIieuGYDkPdkKPVFB0Ow4nrdqbALqYc4tKeGuDUHpVRLKC1FKRCnyNkDuL9NBwSaDGmQEC6WWZR7ux-By8jLkG6AUOnLGSjEw+JJazS3EwrI6aeXOcOaylG5WZvBm+kJERfEQSFN2ssJabRJbBQmePh8Gy0wp6eW014uy4KPZ6ct9VYCFJEjsNyMYbmGFcROaKNZXKpSUDi9inZ7fiTWu6cLzXJJa-SeAeJvuOBHUXJ2ZwxaRcxZ4hRWxUFy3ZEYZ84wUORGpOkCI+E6oEsCV5x0835+V8l7Jf4rVyF2FVfm6wsdUiYNtL1NTZBBid13S9FaeXFXZeyz25qitOLC4Rk7vMiVUCFKc9tEG80z1wEDFYEDZRmS-Ktz-jiqkJt+kwPMKJIFJALBcRaVm6V4t+V81TVZi0Nxlw1266e5zMjXhRQnggssKwR756d6efNeipgKtwOLClnP2-UH83JPMSu6cDkJ6M9d58d6TBjQzVjZK-zosCmIcKiY6BmDMn2vyFjlZm6F13exnT3TIQs+YIqZI9owUME1t4gDGOI9k6JKqwqN3UPc+4Sa6sh2p5VBJnEQYk94jSW+JfGPKCrXFKRPyBL27fBy+4h3nQXdZ5yibfUktp2nz1kALwgNaEVRIZHWuRoLr3idq6R4KSwYPXrZz7vACiTXmJAjFMDyWsJS-XUGuy4-nGvRvVZMU3L7MNUMFmuN1csB1w4K9ExynWs6cCFOBMZ3BOg5wJg7Gn-XH6l0bBnNoOtMzxA5tUBPVKZQu0mFF642g4Qxg4h1g3wDg6+0rAs8YIsNkGPq6K7mQgtgOBTZcaajuDYi4EAA */
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
            actions: ['Submit to Text-to-CAD API'],
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
              {
                target: 'Circle tool',
                cond: 'next is circle',
              },
            ],
          },

          'Circle tool': {
            on: {
              'change tool': 'Change Tool',
            },

            states: {
              'Awaiting origin': {
                on: {
                  'Add circle origin': {
                    target: 'Awaiting Radius',
                    actions: 'set up draft circle',
                  },
                },
              },

              'Awaiting Radius': {
                on: {
                  'Finish circle': 'Finished Circle',
                },
              },

              'Finished Circle': {
                always: '#Modeling.Sketch.SketchIdle',
              },
            },

            initial: 'Awaiting origin',
            entry: 'listen for circle origin',
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
        return canRectangleOrCircleTool({ sketchDetails })
      },
      'next is circle': ({ sketchDetails }, _, { state }) => {
        if ((state?.event as any).data.tool !== 'circle') return false
        return canRectangleOrCircleTool({ sketchDetails })
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
          zoomToFit: true,
          zoomOnRangeAndType: {
            range: selection.codeBasedSelections[0].range,
            type: 'path',
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

        // Extract inputs
        const { selection, radius } = event.data

        // Apply fillet to selection
        const applyFilletToSelectionResult = applyFilletToSelection(
          selection,
          radius
        )
        if (err(applyFilletToSelectionResult))
          return applyFilletToSelectionResult
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
      'listen for circle origin': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.createIntersectionPlane()
        const quaternion = quaternionFromUpNForward(
          new Vector3(...sketchDetails.yAxis),
          new Vector3(...sketchDetails.zAxis)
        )

        // Position the click raycast plane
        if (sceneEntitiesManager.intersectionPlane) {
          sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
            quaternion
          )
          sceneEntitiesManager.intersectionPlane.position.copy(
            new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
          )
        }
        sceneInfra.setCallbacks({
          onClick: async (args) => {
            if (!args) return
            if (args.mouseEvent.which !== 1) return
            const { intersectionPoint } = args
            if (!intersectionPoint?.twoD || !sketchDetails?.sketchPathToNode)
              return
            const twoD = args.intersectionPoint?.twoD
            if (twoD) {
              sceneInfra.modelingSend({
                type: 'Add circle origin',
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
  const hasCircle = pipeExpression.body.some(
    (item) => item.type === 'CallExpression' && item.callee.name === 'circle'
  )
  return (hasStartProfileAt && pipeExpression.body.length > 2) || hasCircle
}

export function canRectangleOrCircleTool({
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

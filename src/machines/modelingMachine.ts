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

export interface Store {
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
  pendingTextToCad: undefined as string | undefined,
}

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeRJothBpzlsvPDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd6IT4GbG-VoAiTYCCYMAEACiEPhgQA1n5yAALVHRdFvBJCazCOQSRSctQyKS5RRqFTWL6nNTSfnSsS5FRiZT4-7tIkksmUkZw2n0pmKSJo2JTLFJWwLFSOBy7WQ0eZFXEIczWCRqaxyOq81KKAWOJUeFXE0kUx5w3oYZmvI3spJiOQyZ1mZQyeUyRSC4RfXmndKOKRyWUpmqKX1XKCqwMAMWwmFJT3o41ZkZmQnzEjsgoVXPE2TtJS9KmEPNjuZsKbkDmLhID6r4LDhtf1LMNmKjgjEdXSrtENuEihUcjUigz-cUEhqeaUwmsqavE-9aoIyBIdPDDeXTYdTtSIusalj5qy+xfFyaSxvUKh7rKdgqFIt74GWZIACLBCMgTBKEUwvku0z8EIO7lNoCZjqm5qKGIGYxuUNSXj+iiOLR+6waWU4EAAKmAjyCOwqCCEQACCCGYRi2GzAqTpmCkspqLKf7pvayj9hU8gFPs+TCOaciMfBEgMsSYAAAqIrgcAELxc7YAAZiQoT+FAcIkEwDL+CwTC9IiIwQIJbLvoI-aSuIia-loQUyLJJS-nGlrQbmXq0VIKiaVOEiwAyqAAO4GWQxmmZwlnWbZ9mOWAXRMJwkCeY2OFJHu3IKDGYicsB4F5hmvJOqmB5ejQNBWAe1iad4dLsIyxBkJQmADTq5VvpVmZxrYSacmuHq2C1BwSN1-Y7DG+40DI-WDcNSE1mAqGguC871lhxpyHmzo-vVcW-jashfPK3IaOY+a7Gp3X7TqBB3Bg-iQBw-gQL0cLtNqQ1MnWLyvsJiBei6ph7oFWhqWYPaINK61rsstRZLRIp-TDEgTTDACS96PnSp1ghC-iwmZ5AkJgU2IwgXoCqeqaqY40G1EeBSLPKj3zMsSx7c0BIqhTjLkwdDLU4GtMnUEZ2MylkMAF73GzHPGl6V7pOB9Q7PylQqBmNhmge9X7ETXVFjLypwfLDKKzqKtkkQ3CwOwdl4P42vYHrEJs2D2AB6NoxwwaQlG-YJ7KPkywpjGyxfKakjOzYe47KRbqkwrHs+8Q-uByQwfM5wrOYFHMcUHHC4RtNiQxQOz3WrywpytnSxOnuXU0AcuQpiXntl-efu4AHQe4P4vEAELeP4AAahtRtzYl-vy5pXjuZH2j+VjOjQnIWPY1gODBrt+u7Ste1TM+VwvS+r-4ACaW-vjvp4KF3KPWoDtrb2nsL+CoaxzxxQUCkSez9GTl1nvPaui8yBQFJL-GaNQ9jCltBsCw+Rs4dkWBYR0u0ljgXivfEsiCp5K2QW-NB-hST4HYLDVuCMk5xVMJaXMO4UxxRkNnS8NVSK2AKDfZYpEEHT0DCgquwcmDwhUbgCA2ByCuRIFqDRTdKDYI7q6SQVh6oHEltkbQ2d8hxmMDGAoI91B9VoYSD29CmFzyUYvUO4chjVn0P4Nm2AoC4EMUjCBzoRSbVUsY4+vYHai0cNkLqIUbTSwuA-Usbj5G+2YTXeEdc2aYACUEkJYSuY2AHPjQU+5fycjsBmKw5RchrgKFJA4I45GMNfp49+sBcD2X8FxDe5SvQmBqIFVQ+xMjEJPv5Qcu5zFKAPBpFxcsn45Irr0lh-TBnDJ-vHRcidt6pMWK1WoV59yxhESfUiA51Dyl2MKHYo8unex6ag4OYAACOvRI5sKgBw0ZSYFh1AAkoFI5yMyxklPIHc81Km7jeS-BReTF5MB0UU6ghy26cy9KoHkl59hckyLuL0GYpJVNlHFBwak+zIqQR8rx-g4RFVQLCW4aL2Aohxdw7e91TbCL3GC4xGZZCSguaoYeB4UwuwyXQ7J3TAwACUwCCHYiEXoIxRk7jSNoc0dQNCiF-BmcQZpZDgUpcIE4zj5WuI2UqskgMTogwCODSG+BoaMmBSjHcHUFBjjsMKU1u11pulMWufkso5V-EyfQ9xPTa5DNQEzHR2ASAACMsG8quicjQ0gsiqRFMKKwYpwGH1PGuPCN99g0LtesnUCbAyMgwSdLiqB2Y5uOe+HIF9pA-lHjkA44Uy29gkWGrcbTZBWDvvWx+jbeKpWrgEHx+sG56KGM3fweBzKoAIBAbgYAiS4GhKgOkEgYDsEEKuiOmBBA7tQOU6oCpTA2MltI-scTECSJAtoNSUrcgODrbGhVT9F3LpDqgXWa7G6bsoNu3Au6CDwjhFBiQTA3K7rhF0C9fhr1QbDmu+9iHH1dq8pVZ9Tpe0Cm0JyUimwT64OdCkUU-YljzBjAg8DoNa6aMjhu2OCGkMHqMse0957L2CF4-XYju6n0W0WLGOBcV5iXgHijfImQ3TmBdIqNZ86ybcYCNJ-j0c4MnQfchuEqG4Tocw1BnDkmTN3offJ-Yzp1JwrXGOEUA8X20V3A1NSpx0kgftQupdoMV5r3XkJvdImj14HE0eyTmbYCCD4LJ0jXDc09pCnGLQ+5bRJktdnX8J5tymjHCkbIXHIsBGixvOLVmbN2eGFhxzeG0sZay-JtSphrUpBvhkdSZWcinnITdAUWR+SrLnVksD9WP5ry-s1hLYmz0pa6xm9L+hetkYqokaoZ91CJnApkea2MED2DdK2JqqhBTDtzHViDjXVuWZQ2hjD7WHO4avd1vbrmDvt2-SFcojgQpFz3FeG04pEzrVItBOoroDVzbCw2wzS2MGkjW4ejbEmuv4FJPtnL3aKNg9bPIWi8hzCzJKDkdcAibBmBTL1YDssDMKyM4EonFmSMta+-Z7Df3BDY7VUD0n5GjshUkDSzIxgHBukPCfeqXd9g1HlItEbL3QYAo4bj0TSXNsi71wyEnl0yfS8vAN2Q2Q6i7GyKIkU61R5kqsDdTj+mFsRYg6b5rn3bPffYB1k34JAVm4lxbqXoOz7HdOMYdQSZdyiJfaIWQ+KFT5F2jrgIKi4RqI0VoxEuizOCcs+to3BOr154L5o7RcJBACebub+GuXyeZHWiKewKZdrRqu1LSiygB25mkjnpyqjwSF-r7Bsv-OA9teD79yTNfJ91+L430vzfI+t8t6Djvo87C7UyFtZQ2cFADlHMPvMnv5vxoADJ4DbagDtAMGStuTR2p9ogqlixuqmUtXwLoaQquuwtQogro44Xu9+j+H+mAEglMuAHABAT6UszoUqICeYvIL09o1qCwxEbopwXotutq6OnOnsD+RksB8BiB7AyBeoUeh236NEaBWB-Y4ESkoUiA+4A4v41qEOV4AoCgCCFBT+HaEgAAcimnpKgHgNyiZBABAIMDornjIRCF-mtNfDUCONoFJEBNkK2EfNtNkPsAxFAW4iIVQZIf4NIbIbACNM3J2pLowVzBjIStOl2PYroPaBkGaKKIrvUFoDaAgggUgaMt1LYofFng0OfhmJIq2H2LsPHhAsETQXQU4SDlzMAutJyOnLREsGOJwRUl1OkLKoGhfLkIKAgixK2hCOmg3DouQMmq-u-u2o4QwRkesBfvKOINasNqIFdueBUMPAQTNjaGIAgr0OoimjHHOB7JCLgPunjpXkerxN4CxIIJMQeoIDMewHMaEsDnipDq+jdFeGLPsL5t4f5pjNBJnGjOzm7N7mTKqqEGLrAc0fgKIW0TvtHtdpkHgeJCjryOfldhdpKLqvkHmGMWuAgs8Zupgp8RIEZlDEEHcOopynCEZHCAQJWIgclCyiEHCdmukZzAtJ+EKI0P5AqGAiULmE6PnN+DuJkHuPcXGm4rCa8a0YifVlDARlAHgPIYoayi8bzv4LyXgOUiCieHmD+I8tajdl+ggD4WGkcMsicJeDCQSRyc-nATidHAyJAP4OybzsgQcUbGOAsPdJbCpI4JyIAWfAeBjKPBtC6AguQKSGQIEG5GSKMseKbKROsBfDYDkC1CbFJM8uYFuJDmPqiUmsMtCGmpmoGBXiesbpJjGQUpxNxPGZDImeLiRvJiLLYP+gUH6vYIUUGWkIFnYF5o4C6WYYthBumXOMmqmjmVmmSPPkHiHmmdwLXJmVJgme2S3gnD8dUPIBUGMkRA4F1OWSFCBJYqKIycsiyaBj7qDKiZ8ovKyj0ByhuV4nIcmclhIFsXuQvIINueymqqeWghdN8c4dUCbGYv+D+LICmIUamFmBkECbRPUDaBkNGWipBtBresUosYbimeeieWivhsBX4sUvJtBCUT+PICsIPNSeEh3mpBoDNh2LuOMfWWuQENefkizEUvoGBYlhBUelBdsngFJgUnxv4m5vcoPK6FoCjuhVzLTqeKkGsLsLfKcABbRd4gRr4mRYEjgCEhRfjtRdxMRbgDBYRiBXtqUvscScaGOWCQqLsLTvKJxaRMoFKI0NeDcUIQRZjo2YBc5sUhJcEgsYecbjRZufRaRf4qLpJWpe0ZzA+SeI7FWUoAqI0l6BNg6VJM+kmEJZuYEAMkwC2evNJcsceXJdBbskwP2XwAhTVBkHwWqYFtnOQutFUNavbC8jGhzo8VzktvJdFXsiml-AlVRUlYIPJdsTFf2foG5rYoWk4sIt3tnF6JIDkbRFyL+bRJFcyj8n8g3Kbg1UeU5V4uqr8mzIIKbvJjUIVVkD+JMrKNCuNqPJjK6B0p0uZZVZZcJU5JitWFgLNY5clcJYIBinZFdV8SOfeTsF3KKErrtAnrGBSnuDyLIFeLWXchFSdZ7EQG-h8f4CxNqSaepVGICQjqcA8jGBdjcr2K7iUaoHUujLUAghDe-jDS-lQPQXeRkTROUOgTfKxsKMGXJJjUpuoJYnAnjWDRIATVDUTZgMgdYPDe+CmOoDyNtF1PNMaujUjAzTTjjSzSueFmTBzTANDbDVQDIHzZVCFDdBUFJIKP+FRDsKageFjUzT+CzU0Lfh7P4LgCmrlGSL4KSNZBgJZK5LnoZC3F5caIIDfEPMhSWu2MsoUVyHGOGnUl1O+moJpGQNgF0MMFDMMt9kZDdeepHdHSMP2TbeUjGF1RcsKvtVnDgTuIsA7ssJCrGCQeVRIMnTHZ6sMuxGZsiUrInUepXanVxNsUrBnYZZeJSscMoFMuKOIDxTKh2NkDaU0M0FbRgPAFEOVe7SuKkGkJtPUAoOoBYAxr2JyPEaPCpG6LmEAQlGqLPd5D9AYTsLmI9KvV8OKjyNBPlqkKjmXQ8VpDpBgBlEZFPa9RkauCjIvWfSveoKauNksKRBfE9AGg-XGolMlGlK-XAIfZVIIDsE6AoB9LtNaLUgA4NQFSA2OGA5PHAx3JaBUJEdIv0SkP1XGNaVJMAmpOqWzTkvg0jN0ZTkmNtHUKVnJDfBFLmOICvb+DfWPjen4jPlug+gw1zPbKYG6FJBkJbBrtnOYCeDRLyCjW+WPs5sI-BqI2TXii6JKJaS6IrhaKOkwfUGgSPBREOjfqQRVZ7Nzo1rFlox-To+YGcgeN1SbWVi446DuCAzDqFuXW4nY5-O9iRmI88mCWpM+YKN1C6P3QSsoEQamA9qBGPq8Y40cj8cKKKOkArleLvTUIKCQoZVI1yNoNOlUGPn7uk7ikbLNqYDUGYIfoGfUKIvKFjUoH3LKJAebQ2aDCvuomvjoho3zrumEx0s6PnCkMsObHTfTjtBUHUKkEmEIp9MITAa0WI1eLsGQrI7+OFFdvUINaoAIVvd6GbdY9AZQZySEewJs-gjs-lns0pl8ERDyL3F+MAysms1c9qRIFbdhmzJs40xOacABIyQeC8x3uBDfMoAEeYt8wiVYTYRCO-Rk-efxfEb1HUHFJkDtd4RkIsHyDTpULoykRwGE-LukEoI6AqC6N-qtAsBtBGjdB0lUTUZwJHA0cmmI0pOUBYDpVNuaWQzgetcYJeIyTGJSuHWzZsdMUMLMUrPMWE7GAOCSmwcNWOMYwgLKJIKsA9oDdaLLRjgrEafCbATy91CeNFGYDkF7d1F8DGAOJw6JESlBPhT042qazjpyUiZ6iidwIoXcBifCDy5kJKNa6KPVBfPa-aB09ICkLKqIGuInhqcKWaz69yZ6mKdhDU1GALSeKYueDE-KZC4y2OA9MKGqeA6uU8ZqSKZybqclAaV62AKG0mKYPVD+bKJyNIoAd1NILgTYNkBCXUK6e6YvLAF6WE+BKCsg3mNkAasrhjfoQcE0vvFNu6xc4E1Vb2QUi2dmemu2WM6GpbHYJ6JIhfOKG0osBoDdNkIfJjONe-BebuVyqi7m3-FoBViOBfJuLkAUGKqGShYHZ9AIU+ywoI2RWE1++tD+wUG6P+-pS+dIAQRoAeNahU2zdztVdZSUE40bDB5QtfH+-nEeP226LtC6NkGWc9lhzu+dZB-4rZSEtB4bURyhXUsBORP28NVQ-+922jgE700RVZQxfXDZapax9+2OXOzkY0g4PU8m7GDOYHeB8HKlXFce3GJbDkPivMAzvlTYDexBENvYPKGpxOzFS2V-FpxM0Snp+UYUQIdyK6LUtBLWYJXR2dVFZNf8mHhwlJ7BzJ4VpyAoNCv23CsoITO5xYBZxdU9aSJgMe1RvMIQWfSy1q88rq6PCpj0YBuc0J42grSdFzZs3bqjEvRkAm5lwZUbdLQTAV4-RbVbf4DbWI57TzLKL0cXccw4K9OuNMrULUCFpE0a3BM3bHSmvHa29o0bPafkNBAQZnX+kBPVMxmCss9tNW4SBN9XSmrXQHPXTqGI8YIpjkKcK6EAzdF4SUG+ULVfGInRKsi4EAA */
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
            actions: [
              'Add pending text-to-cad prompt',
              'Submit to Text-to-CAD API',
              'Remove pending text-to-cad prompt',
            ],
            cond: 'Has no pending text-to-cad submissions',
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

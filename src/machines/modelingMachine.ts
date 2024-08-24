import {
  PathToNode,
  VariableDeclaration,
  VariableDeclarator,
  parse,
  recast,
  sketchGroupFromKclValue,
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
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeRJothBpzlsvPDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd6IT4GbG-VoAiTYCCYMAEACiEPhgQA1n5yAALVHRdFvBJCazCOQSRSctQyKS5RRqFTWL6nNTSfnSsS5FRiZT4-7tIkksmUkZw2n0pmKSJo2JTLFJWwLFSOBy7WQ0eZFXEIczWCRqaxyOq81KKAWOJUeFXE0kUx5w3oYZmvI3spJiOQyZ1mZQyeUyRSC4RfXmndKOKRyWUpmqKX1XKCqwMAMWwmFJT3o41ZkZmQnzEjsgoVXPE2TtJS9KmEPNjuZsKbkDmLhID6r4LDhtf1LMNmKjgjEdXSrtENuEihUcjUigz-cUEhqeaUwmsqavE-9aoIyBIdPDDeXTYdTtSIusalj5qy+xfFyaSxvUKh7rKdgqFIt74GWZIACLBCMgTBKEUwvku0z8EIO7lNoCZjqm5qKGIGYxuUNSXj+iiOLR+6waWU4EAAKmAjyCOwqCCEQACCCGYRi2GzAqTpmCkspqLKf7pvayj9hU8gFPs+TCOaciMfBEgMsSYAAAqIrgcAELxc7YAAZiQoT+FAcIkEwDL+CwTC9IiIwQIJbLvoI-aSuIia-loQUyLJJS-nGlrQbmXq0VIKiaVOEiwAyqAAO4GWQxmmZwlnWbZ9mOWAXRMJwkCeY2OFJHu3IKDGYicsB4F5hmvJOqmB5ejQNBWAe1iad4dLsIyxBkJQmADTq5VvpVXq7KY6i-sBbpujILUiqe6jZJy2QHvk-WDcNSE1mAqGguC871lhxpyHmzo-vVcW-jashfPK3IaOY+a7Gp3X7TqBB3Bg-iQBw-gQL0cLtNqQ1MnWLyvsJiCkTQkqCvKNEFCkKRfCKcZJsKy00FeSZNBcfpwRNMMSJTjIAJL3o+dKnWCEL+LCZnkCQmBTYjCC7rKFQ5PIPUxUenKmPY-LCAcAp2BpzQEiqNMMtTB0MvTgaMydQRnazKWQwAXvcXM88au41BI-legK1hdbsKgZjY5Q3cYnVE7Rsp-VTysa2SRDcLA7B2Xg-j69gRsQlzYPYIHo2jHDBpCWb5ppNB0ECmYBRE18pqSksamxfYyiul7jKqzqvvEAHQckCH7OcJzmDR7HFDxwuEbTYk5t41JAo0Emshcqt9qYwOea7LUu6yELpcqz797+7ggfB7g-i8QAQt4-gABqm1Gu7qNI8wWCFGd5g7I+1GkqZugeZ79zIs-lzDleL8vterxvW8AJp7++B+SlSL5VqP4agXxKCmBw8Y1KXl-Nofu8syYlmfmXeegY341xDmQKApI-4zV2NyVSOxsho0vDneqZotDQV6rVKST80F+2rivfwpJ8DsFhu3BGZtdgnnmEoeQsgpLaDFCPKwTour91AaRLQxh6Fq1fkwj+Tl4RMHBBAbA5BXIkC1OolulA8FdxqE6EUxFaIo3NroEe+R3pWhRijWUWRH4K2VBTNWKD1YL0USHMOEchjVn0P4Lm2AoC4AMUjUU3Ii4OE+pyKh5EfymG2vsFGKRqikz+OTUsyt3EKKXpg1e9cNFc0wAEoJISwl83AnGXMZgbQFBCgoYevYrBpHyFkTI4hzB7nSYrVxOocmeLycw2AuB7L+C4jvCpu4brpG6qcN07YCgiJKLbAW8o6g3UWvyaociK6DPfiHEZYyJm-wTouJO+9qqmFTHFNSVTczLMQFeEwmyrAkMFLYXZL99n5OBgAR16FHVhUB2FTLevGWMNpzRC1SBmVQcZXZXl3JuUBXy6Y-OYUwbRxTqBnI7rzXcB5WzS13NLEKspcgZlqAsOKKNXQ5APOoJxSDCTZIYVXIZSi4RFVQLCW4XiIQojxVwy5XpLZmG0AtA+u4MxxXKIUWQqYLCkrEGijxgYABKYBBDsRCL0EYUzYwDh-O06iORaIZk6ekVIuRjCXi6oKNVldAYnRBgEcGkN8DQ0ZFMied01ypBRkA+olqsinh3FtYwct+5OsGfXcZqA2baOwCQAARrg4VV194Km5LROWGRUjyAyOKLOFR1IOHsPY1VzjMnuIGYGRk2CTpcVQNzTNFz3ycltjyHYakliJlzC1Nc4bMhaBqPMl0T9eKpVrgEHxxsm66KGK3fweBzKoAIBAbgYAiS4GhKgOkEgYDsEEPOyOmBBBrtQBU2wqQj5jrldkUQ4Cnl2AirIP8tSUx1CnTO0GZ6-HN2XZQVduB10EHhHCVAcIJBMDcuuuEXQj1+FPdB8OC7L1geve2rylVb2SllNLcwRwYxNKeTUSQrpSL0WqPkIsNbkHZOnbOtm8IG5RyXXHUD4Gt1GV3fuw9x7BCFMbph9dN7ummHmBKLITVQpPJ-Lm7qjgdgWGqH1BjrK3HMdBiJjjMdgMnSvRBuEUGYNweGAhpDQm9MXqvRJmZth8i5mWCmaoZHSg5EkFRBU8h9gD1-Sxr+O9uMbt4zuvAAmd1CbTbAQQfAxPYc4Vmzt0ETy22TEG7cHnFPebWK6aTqREEZMY9pv9ARgvb1CyZszsH4PQesyh2L8XEsSaUNIN00LFOKpzi6AjWg1xNXqCjQLoNgvf2q+F-jB7otNdTXF-QrWcMVUSE5hY+5nP9hChs+TCA8jrZ-CkYUCZdyjYq5vfwE3jOQeg3VyzDXkMnua4t+zy3O6vva3uBwdRwqXj3OKZQkS7ZGrKDYM7gT8Ckkm9u6bgmmuQ+1a95LHa8NpfSHYYwVFshJnIWOHkeFeT1Wlq6atLKlZlZY9gqH13TO3Ys+wKzj3BBU8R1htrcZSV1CqEoZqI9cgLCTOBC8V56g-s0+T-pOmAjAvYdDvjkWZtM5lwyJbyPcOrb3KjVQLolhKGgrtvkaQfyiiWLGV02RwfK+qzd8z9XENK-BCClXSPLoo41-Meauuit1TMDnOokgx3EdubIMw4PVFwlUbgdRmjEQ6IM1x4zU2Fdw5PeHyP0etFwkEJx1uqvXfq9fa6VsDrcg2A0BsnOsg0iiGqJssc9RScla05L8ryiI9qI0ZnoDCesM1bp3bxrqeVEd5j9o7P8fc8u-hil1HReg+l5-LUGMOd9wLBr0Wp6Den4ABk8DNtQK2gGDIm0JtbTe7H0h6oROhX+HGNhpAe1qOPJYuQd979P5gCQtNcAcAIBJqB-ajQ8wpEooHmRGxKBEhwywV+b+RkH+X+P+7Af+eo+eK2r6KMiwN0sg0EY4CgxgXwwBiw9q-c5oP0KYsB++raEgAAcomnpKgHgOwLACZBABAIMNogECwIwTeraBUDaLjP2FYCjEBG6OjlGvrm6F6BpmTn0lTLvnAS2p-rQf4PQYwcwaQK3G2mrmgaUBWq2NrqOu7KKF8BkM7FRkAUYmDuLrIWXN-r-lMkqndPkCOLyOoJyBmLehUARPIHYFIeBE-HYUgVQCgdPm7kjPUoOM5goCkEmFkB4R7jGJkGnHfCpk-CxE2hCCmk3NouQAmkfifooRUjbAih2O0nuPJD2IgG6MYjYCpo6C6AKE-L0FHomrHHOMrJCLgJujDsnjurxN4CxIIM0VuoIG0ewB0aEm9gSiFCePUDdFePKIKB9CYQqPjvKNBDGHFPuPFNYVkm4lqqECzh-vkfgJQVoage9ntleNyMeEWj1LbHEXJA-M6P3IyqIMQqdrsXWgccujgmcRIFLlDEEHcFHvynCEZHCAQJWD-slP4NyocQjkUbkJKEInUOnKRHUB5rmAODuF1Ipt1N1CXF8dkj8UcYoQCeVlDGhlAHgCwWwfCb8VDtSXgEicKOKiKFJPuDGAsSYbuKeIRqRMblJD6MSfsSEIyf8dCTHAyJAP4KSQjn-lMWbDznwU5lUG9HUDjHehlhYMfMjLGE-OQKSGQIEG5GSL6vuJbNBDaFtMOGpC1OLLXu7KRLsAqI3r0nsS3ixiCfGhMtCMmmmoGEnnuorkJj6WxpxNxP6ZDIGazuJkqVGLYBbPmETE5tgf2CWvfhEhQg0MRDsTIZ6VTFLvynumxgmkmjGemmSDbndgzg9mGdwPXJGcJgGVWXnqEQXqUOsXdKmZIqoI8ntvIBFMNviYWvKODiCQcqvNyj0HypOfkkwd0fLiGYeiMfOSvIIDObytquuR-BdB2ToUma0jsNSlfqoGuLKvIM6LUDsPkEKETO6S4oWWXMWbud4mhr4sUvoEuRFiuTumuQKqhobAuiUhJsYJbGAssGYtLFYI7HyfyAtPbMYIvhOQKqxhzF+T+bDv+dxG+bgMJmxkUv4g5nGH+FgbRAeCGnJNChULkMfPsAqNoD0k+XWq+WhQBl+YEjgCElhb0RIABZyngEBehueiUsztxZMdoZcbYMOlJPMGYJAlJC+nzPVG1OPNQsKMOKhYJQUoRY3CUlxcEl0cGVFvxbhYBbZmJWUpJRcbzEeVKMYC6LgS6MpXRNyPsBEq7GjCKNpVOYEKMkwOWdvLxX+WZYIHhaMQFc2XwGBZIFkPkCbg8UsDnLqfyacDGA4P3P7r5b8kcoFSciFaZQJVOZFfZM2foA5gsIyjUMKbJnYDnF6ARrkLbBnPYJyDlcwmAACkCo7uwoVYrsVfkjqt1ResrhJsOg0ksETP5KkJYr2DtKeEoMidAUmG6B1UolinZNWFgP1aueZTpYIJtTiucQedJXuHjEyrRJyPYDuB5sdieP2PkNoHgZsTBKKf0kQMfqcf4CxAfpgIqVJXZYKGkCmNoOXiHipparUJbMpHFEYgcI+bWtkp9Sfr9YfsEYDcaPYPfv5F9nUASZqU8dDamWBPDeIE-Cjd9Wjf9VQNYJjVGDYOBf2KKPbGOETHdUGjDTkHDX1hYMVh6XWpTTAD9X9X-jIPTe+PIFJJbETF0qcAgqoFDQOCTTzSaojaVh9V9cLdTX-ioBLZVOYHFDyFkL+PUlYOYLtpkMTQUJidoEFNIU3hLlTEQNgHCEaWcSccLYUQme+OaESusikNLMsMBHfuUL5muA-FeJyPmY7TYSrC7W7VDuSSQJSV6syV0bxKwbcK7e7f4OnRUuBNBM6CSnAkFMYfaKYfyWuIKRyR2LPP4LgImrlGSL4KSNZBgJZK5JwYZG3LZcaIILbE6KKPyMKDavUKPSIaRY5dkA6vkD+JpGQNgF0MMFDBMhZkZLtTuovcvSMM2c3RUqRnwbUIUKIFfHNUYDuIsAQssEdmbgvT-jvavYmuxAZkCWrJvRINvcMNqlxKMWrAfcoILFJJeIWDdPKOKOIOGnfB2NkI4O1b8I3RgPAFEB6X3SuLNcSreQoOoBYJsHJFeJbMYFtG6CjNSg7QLVOGg95D9Jg3MY9LgwQQKNcpnATIKAKG9QWVpDpBgBlEZMg4nJ2auC6LQy5jg+oJajkIsEtUTE9AoBbl8YlMlGlLw3AFQ5VIIDsE6AoB9P3NaPuHg72A+VI8jPiXI+QyxcrGo13FIU4epm5m4QbjaKYEQ-yLkAqOBDGu9d7PImqFY0jGuDVMRibbtLBfg2GkpMil1N0iFODhxYuhPiBlen47offq5gQqKHbKcDnJ9KYNUbyIcKcPRpw0xq3rZt3iukk6dXZY0KqZnEmRRIeCPNdVfRPEsMLLRODpVqFsk6su5TkHUPMGSnFL1uBBUNieFNFKmJ0xdldlhj0+IAOE9KeXmi9PaPYAoK2INl+EHcHeDkcZUwI4eQSZbNkNyZkOPTkOQgUOKt0tLHgbIMyrHc+SrMWVbgc+cp2asuULcijOjFGr+H7nNKmVoAjTNWHsPlHp3rHuU4k3M1U8aIPeljUAgldbemRCPNsfGFkPXrEoRhQR-j09tMw4yrbDuAqF8PUHnP2BRCjCTK-l42XPIf8YET0ymJIG6SS8puSxXZA2eP05lZkPzRY24ky-AY3YhlzD067M6JpTGHI6IOiyUJXd2EkYWg0eY0jSK+-uScoaoYKlK4A6c1yJ6P5CKCYbdKJLLbKLmHUgEYgck61OUDaVJK6OsqoJbcKJRJtDbTtNeGkRkZwFHDkQmsk7LCeDsKRHAubTbUBHYPGH2HeYpjeAyyrMMa0UMO0WrJ0Q62w86AoNEkmCmI4BS-sF4W0-sAVusk-PKX8QS-CwzcoJKMoPME5YIZpRS5ae2J2LmG+jEymxIDW0nX9RSbOkCSENwGwXcOCfCKGwULmvm6267NoAQY4IOI1Ta91GpEK5q-0oO-8YCWnZDDSdhPiljdzc6KAXUpyTyRXXyTsNXfVLXSKcU2KQibW+SVKclLKXu7O6scDcYHKzLP9vaB1DyCdsImXoqP2+7SabAGaQ69JM6IsgxV2Iq0jNizyNVXciTp4y+16aDOGXOOWdGSmlWfMwQ7YIdmOOw-jJmXGGBCkL4S48xTu0Wa3nhXCTynOQKkwfM046cNATkDIxmXJKpIsAUEpXYPmLIv22xTpaHB+SBSUIc9JQ6qeOw-VLsMbqE72NjfjlPERJpX23h2x96WhZZcpx80c-xxp0J9p3dSRFaWYBtkqnFOte+cBaJaUhJXxyDew1BWkjzuRJkMXi1dUXmKkO57pRhf4oZSEr5+pzfUoIFwORaAHrbH+BRlUCxxraZwR2hXlUFeR+lqKMAc+nYLUClSFLk5KokYMxYFF-5ccomt-MV4sKV99hYBVwbruLMUIUoB1CKLII111YCk3MrglwJzfZmJ6JUXzBkGvjuA1NLMIvUI10ddtZgPM2yaLssFeKaymFShbERq49RmYDl83s7VrSdNTT03DdIKIImHcw4KmEOgOCFCknAh1DGBTTnUO62sk37QitBLYLyLyGOiW+l7LU+gVssL94nf8SnaO4e8EngID54YM6OLXqfUBAcKeLbMKDmLEZF-2wnbnR+3gNKbKWT6SOj+aGWglWD0sPyOa4QgeP3ApUtaoPXY3f4M3ckwPUw4Ri6Dff2Q4K9OuPsKPTeacHcjHQLV-ZwF6mvT3Q61YEh05itKRkxUBPVEh-jYW3Kxq8gor0-cDHwK-V6rAGrMk+BfSgviQoDufXtqu8jBjlRhGi4C4EAA */
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
              'awaiting origin': {
                on: {
                  'Add circle origin': {
                    target: 'Finished Circle',
                    actions: 'set up draft circle',
                  },
                },
              },

              'Finished Circle': {},
            },

            initial: 'awaiting origin',
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
        const sketchGroup = sketchGroupFromKclValue(
          kclManager.programMemory.get(sketchVar),
          sketchVar
        )
        if (trap(sketchGroup)) return
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
      'listen for circle origin': ({ sketchDetails }) => {
        if (!sketchDetails) return
        sceneEntitiesManager.setupNoPointsListener({
          sketchDetails,
          afterClick: (args) => {
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

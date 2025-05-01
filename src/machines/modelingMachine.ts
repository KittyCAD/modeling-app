import toast from 'react-hot-toast'
import { Mesh, Vector2, Vector3 } from 'three'
import { assign, fromPromise, setup } from 'xstate'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import { deleteSegment } from '@src/clientSideScene/deleteSegment'
import {
  orthoScale,
  quaternionFromUpNForward,
} from '@src/clientSideScene/helpers'
import { DRAFT_DASHED_LINE } from '@src/clientSideScene/sceneConstants'
import { DRAFT_POINT } from '@src/clientSideScene/sceneUtils'
import { createProfileStartHandle } from '@src/clientSideScene/segments'
import type { MachineManager } from '@src/components/MachineManagerProvider'
import type { ModelingMachineContext } from '@src/components/ModelingMachineProvider'
import type { SidebarType } from '@src/components/ModelingSidebar/ModelingPanes'
import {
  applyConstraintEqualAngle,
  equalAngleInfo,
} from '@src/components/Toolbar/EqualAngle'
import {
  applyConstraintEqualLength,
  setEqualLengthInfo,
} from '@src/components/Toolbar/EqualLength'
import {
  applyConstraintHorzVert,
  horzVertInfo,
} from '@src/components/Toolbar/HorzVert'
import { intersectInfo } from '@src/components/Toolbar/Intersect'
import {
  applyRemoveConstrainingValues,
  removeConstrainingValuesInfo,
} from '@src/components/Toolbar/RemoveConstrainingValues'
import {
  absDistanceInfo,
  applyConstraintAxisAlign,
} from '@src/components/Toolbar/SetAbsDistance'
import { angleBetweenInfo } from '@src/components/Toolbar/SetAngleBetween'
import {
  applyConstraintHorzVertAlign,
  horzVertDistanceInfo,
} from '@src/components/Toolbar/SetHorzVertDistance'
import { angleLengthInfo } from '@src/components/Toolbar/angleLengthInfo'
import { createLiteral, createLocalName } from '@src/lang/create'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  addClone,
  addHelix,
  addOffsetPlane,
  addShell,
  addSweep,
  extrudeSketch,
  insertNamedConstant,
  insertVariableAndOffsetPathToNode,
  loftSketches,
} from '@src/lang/modifyAst'
import type {
  ChamferParameters,
  FilletParameters,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  EdgeTreatmentType,
  applyEdgeTreatmentToSelection,
  getPathToExtrudeForSegmentSelection,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  getAxisExpressionAndIndex,
  revolveSketch,
} from '@src/lang/modifyAst/addRevolve'
import {
  applyIntersectFromTargetOperatorSelections,
  applySubtractFromTargetOperatorSelections,
  applyUnionFromTargetOperatorSelections,
  findAllChildrenAndOrderByPlaceInCode,
  getLastVariable,
} from '@src/lang/modifyAst/boolean'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from '@src/lang/modifyAst/deleteSelection'
import { setAppearance } from '@src/lang/modifyAst/setAppearance'
import {
  setTranslate,
  setRotate,
  insertExpressionNode,
} from '@src/lang/modifyAst/setTransform'
import {
  getNodeFromPath,
  findPipesWithImportAlias,
  findImportNodeAndAlias,
  isNodeSafeToReplacePath,
  stringifyPathToNode,
  updatePathToNodesAfterEdit,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  getFaceCodeRef,
  getPathsFromPlaneArtifact,
} from '@src/lang/std/artifactGraph'
import type { Coords2d } from '@src/lang/std/sketch'
import type {
  Artifact,
  CallExpression,
  CallExpressionKw,
  Expr,
  Literal,
  Name,
  PathToNode,
  PipeExpression,
  VariableDeclaration,
  VariableDeclarator,
} from '@src/lang/wasm'
import { parse, recast, resultIsOk, sketchFromKclValue } from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import type { DefaultPlaneStr } from '@src/lib/planes'
import type {
  Axis,
  DefaultPlaneSelection,
  Selection,
  Selections,
} from '@src/lib/selections'
import { updateSelections } from '@src/lib/selections'
import {
  codeManager,
  editorManager,
  engineCommandManager,
  kclManager,
  sceneEntitiesManager,
  sceneInfra,
} from '@src/lib/singletons'
import type { ToolbarModeName } from '@src/lib/toolbar'
import { err, reportRejection, trap } from '@src/lib/trap'
import { isArray, uuidv4 } from '@src/lib/utils'
import { deleteNodeInExtrudePipe } from '@src/lang/modifyAst/deleteNodeInExtrudePipe'
import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export type SetSelections =
  | {
      selectionType: 'singleCodeCursor'
      selection?: Selection
      scrollIntoView?: boolean
    }
  | {
      selectionType: 'axisSelection'
      selection: Axis
    }
  | {
      selectionType: 'defaultPlaneSelection'
      selection: DefaultPlaneSelection
    }
  | {
      selectionType: 'completeSelection'
      selection: Selections
      updatedSketchEntryNodePath?: PathToNode
      updatedSketchNodePaths?: PathToNode[]
      updatedPlaneNodePath?: PathToNode
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
  // there is no artifactGraph in sketch mode, so this is only used as vital information when entering sketch mode
  // or on full/nonMock execution in sketch mode (manual code edit) as the entry point, as it will be accurate in these situations
  sketchEntryNodePath: PathToNode
  sketchNodePaths: PathToNode[]
  planeNodePath: PathToNode
  zAxis: [number, number, number]
  yAxis: [number, number, number]
  origin: [number, number, number]
  // face id or plane id, both are strings
  animateTargetId?: string
  // this is the expression that was added when as sketch tool was used but not completed
  // i.e first click for the center of the circle, but not the second click for the radius
  // we added a circle to editor, but they bailed out early so we should remove it, set to -1 to ignore
  expressionIndexToDelete?: number
}

export interface SketchDetailsUpdate {
  updatedEntryNodePath: PathToNode
  updatedSketchNodePaths: PathToNode[]
  updatedPlaneNodePath?: PathToNode
  // see comment in SketchDetails
  expressionIndexToDelete: number
}

export interface SegmentOverlay {
  windowCoords: Coords2d
  angle: number
  group: any
  pathToNode: PathToNode
  visible: boolean
  hasThreeDotMenu: boolean
  filterValue?: string
}

export interface SegmentOverlays {
  [pathToNodeString: string]: SegmentOverlay[]
}

export interface EdgeCutInfo {
  type: 'edgeCut'
  tagName: string
  subType: 'base' | 'opposite' | 'adjacent'
}

export interface CapInfo {
  type: 'cap'
  subType: 'start' | 'end'
}

export type ExtrudeFacePlane = {
  type: 'extrudeFace'
  position: [number, number, number]
  sketchPathToNode: PathToNode
  extrudePathToNode: PathToNode
  faceInfo:
    | {
        type: 'wall'
      }
    | CapInfo
    | EdgeCutInfo
  faceId: string
  zAxis: [number, number, number]
  yAxis: [number, number, number]
}

export type DefaultPlane = {
  type: 'defaultPlane'
  plane: DefaultPlaneStr
  planeId: string
  zAxis: [number, number, number]
  yAxis: [number, number, number]
}

export type OffsetPlane = {
  type: 'offsetPlane'
  position: [number, number, number]
  planeId: string
  pathToNode: PathToNode
  zAxis: [number, number, number]
  yAxis: [number, number, number]
}

export type SegmentOverlayPayload =
  | {
      type: 'set-one'
      pathToNodeString: string
      seg: SegmentOverlay[]
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
  openPanes: SidebarType[]
}

export type SketchTool =
  | 'line'
  | 'tangentialArc'
  | 'rectangle'
  | 'center rectangle'
  | 'circle'
  | 'circleThreePoint'
  | 'arc'
  | 'arcThreePoint'
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
      data: DefaultPlane | ExtrudeFacePlane | OffsetPlane
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
  | { type: 'Cancel'; cleanup?: () => void }
  | { type: 'CancelSketch' }
  | {
      type: 'Add start point' | 'Continue existing profile'
      data: {
        sketchNodePaths: PathToNode[]
        sketchEntryNodePath: PathToNode
      }
    }
  | { type: 'Close sketch' }
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
  | {
      type: 'Constrain length'
      data: ModelingCommandSchema['Constrain length']
    }
  | { type: 'Constrain equal length' }
  | { type: 'Constrain parallel' }
  | { type: 'Constrain remove constraints'; data?: PathToNode }
  | {
      type: 'event.parameter.create'
      data: ModelingCommandSchema['event.parameter.create']
    }
  | {
      type: 'event.parameter.edit'
      data: ModelingCommandSchema['event.parameter.edit']
    }
  | { type: 'Export'; data: ModelingCommandSchema['Export'] }
  | {
      type: 'Boolean Subtract'
      data: ModelingCommandSchema['Boolean Subtract']
    }
  | {
      type: 'Boolean Union'
      data: ModelingCommandSchema['Boolean Union']
    }
  | {
      type: 'Boolean Intersect'
      data: ModelingCommandSchema['Boolean Intersect']
    }
  | { type: 'Make'; data: ModelingCommandSchema['Make'] }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Sweep'; data?: ModelingCommandSchema['Sweep'] }
  | { type: 'Loft'; data?: ModelingCommandSchema['Loft'] }
  | { type: 'Shell'; data?: ModelingCommandSchema['Shell'] }
  | { type: 'Revolve'; data?: ModelingCommandSchema['Revolve'] }
  | { type: 'Fillet'; data?: ModelingCommandSchema['Fillet'] }
  | { type: 'Chamfer'; data?: ModelingCommandSchema['Chamfer'] }
  | { type: 'Offset plane'; data: ModelingCommandSchema['Offset plane'] }
  | { type: 'Helix'; data: ModelingCommandSchema['Helix'] }
  | { type: 'Prompt-to-edit'; data: ModelingCommandSchema['Prompt-to-edit'] }
  | {
      type: 'Delete selection'
      data: ModelingCommandSchema['Delete selection']
    }
  | { type: 'Appearance'; data: ModelingCommandSchema['Appearance'] }
  | { type: 'Translate'; data: ModelingCommandSchema['Translate'] }
  | { type: 'Rotate'; data: ModelingCommandSchema['Rotate'] }
  | { type: 'Clone'; data: ModelingCommandSchema['Clone'] }
  | {
      type:
        | 'Add circle origin'
        | 'Add circle center'
        | 'Add center rectangle origin'
        | 'click in scene'
        | 'Add first point'
      data: [x: number, y: number]
    }
  | {
      type: 'Add second point'
      data: {
        p1: [x: number, y: number]
        p2: [x: number, y: number]
      }
    }
  | {
      type: 'xstate.done.actor.animate-to-face'
      output: SketchDetails
    }
  | { type: 'xstate.done.actor.animate-to-sketch'; output: SketchDetails }
  | { type: `xstate.done.actor.do-constrain${string}`; output: SetSelections }
  | {
      type:
        | 'xstate.done.actor.set-up-draft-circle'
        | 'xstate.done.actor.set-up-draft-rectangle'
        | 'xstate.done.actor.set-up-draft-center-rectangle'
        | 'xstate.done.actor.set-up-draft-circle-three-point'
        | 'xstate.done.actor.set-up-draft-arc'
        | 'xstate.done.actor.set-up-draft-arc-three-point'
        | 'xstate.done.actor.split-sketch-pipe-if-needed'
        | 'xstate.done.actor.actor-circle-three-point'
        | 'xstate.done.actor.reeval-node-paths'

      output: SketchDetailsUpdate
    }
  | {
      type: 'xstate.done.actor.setup-client-side-sketch-segments9'
    }
  | { type: 'Set mouse state'; data: MouseState }
  | { type: 'Set context'; data: Partial<Store> }
  | {
      type: 'Set Segment Overlays'
      data: SegmentOverlayPayload
    }
  | {
      type: 'Center camera on selection'
    }
  | {
      type: 'Delete segment'
      data: PathToNode
    }
  | {
      type: 'code edit during sketch'
    }
  | {
      type: 'Constrain with named value'
      data: ModelingCommandSchema['Constrain with named value']
    }
  | {
      type: 'change tool'
      data: {
        tool: SketchTool
      }
    }
  | { type: 'Finish rectangle' }
  | { type: 'Finish center rectangle' }
  | { type: 'Finish circle' }
  | { type: 'Finish circle three point' }
  | { type: 'Finish arc' }
  | { type: 'Artifact graph populated' }
  | { type: 'Artifact graph emptied' }
  | { type: 'Artifact graph initialized' }
  | {
      type: 'Toggle default plane visibility'
      planeId: string
      planeKey: keyof PlaneVisibilityMap
    }
  | {
      type: 'Save default plane visibility'
      planeId: string
      planeKey: keyof PlaneVisibilityMap
    }
  | {
      type: 'Restore default plane visibility'
    }

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

export interface ModelingMachineContext {
  currentMode: ToolbarModeName
  currentTool: SketchTool
  toastId: string | null
  machineManager: MachineManager
  selection: string[]
  selectionRanges: Selections
  sketchDetails: SketchDetails | null
  sketchPlaneId: string
  sketchEnginePathId: string
  moveDescs: MoveDesc[]
  mouseState: MouseState
  segmentOverlays: SegmentOverlays
  segmentHoverMap: { [pathToNodeString: string]: number }
  store: Store
  defaultPlaneVisibility: PlaneVisibilityMap
  savedDefaultPlaneVisibility: PlaneVisibilityMap
  planesInitialized: boolean
}

export type PlaneVisibilityMap = {
  xy: boolean
  xz: boolean
  yz: boolean
}

export const modelingMachineDefaultContext: ModelingMachineContext = {
  currentMode: 'modeling',
  currentTool: 'none',
  toastId: null,
  machineManager: {
    machines: [],
    machineApiIp: null,
    currentMachine: null,
    setCurrentMachine: () => {},
    noMachinesReason: () => undefined,
  },
  selection: [],
  selectionRanges: {
    otherSelections: [],
    graphSelections: [],
  },

  sketchDetails: {
    sketchEntryNodePath: [],
    planeNodePath: [],
    sketchNodePaths: [],
    zAxis: [0, 0, 1],
    yAxis: [0, 1, 0],
    origin: [0, 0, 0],
  },
  sketchPlaneId: '',
  sketchEnginePathId: '',
  moveDescs: [],
  mouseState: { type: 'idle' },
  segmentOverlays: {},
  segmentHoverMap: {},
  store: {
    openPanes: getPersistedContext().openPanes || ['code'],
  },
  defaultPlaneVisibility: {
    xy: true,
    xz: true,
    yz: true,
  },
  // Manually toggled plane visibility is saved and restored when going back to modeling mode
  savedDefaultPlaneVisibility: {
    xy: true,
    xz: true,
    yz: true,
  },
  planesInitialized: false,
}

export const modelingMachine = setup({
  types: {
    context: {} as ModelingMachineContext,
    events: {} as ModelingMachineEvent,
    input: {} as ModelingMachineContext,
  },
  guards: {
    'Selection is on face': () => false,
    'Has exportable geometry': () => false,
    'has valid selection for deletion': () => false,
    'is-error-free': () => false,
    'no kcl errors': () => {
      return !kclManager.hasErrors()
    },
    'is editing existing sketch': ({ context: { sketchDetails } }) =>
      isEditingExistingSketch({ sketchDetails }),
    'Can make selection horizontal': ({ context: { selectionRanges } }) => {
      const info = horzVertInfo(selectionRanges, 'horizontal')
      if (err(info)) return false
      return info.enabled
    },
    'Can make selection vertical': ({ context: { selectionRanges } }) => {
      const info = horzVertInfo(selectionRanges, 'vertical')
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain horizontal distance': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: selectionRanges,
        constraint: 'setHorzDistance',
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain vertical distance': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: selectionRanges,
        constraint: 'setVertDistance',
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain ABS X': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({
        selectionRanges,
        constraint: 'xAbs',
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain ABS Y': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({
        selectionRanges,
        constraint: 'yAbs',
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain angle': ({ context: { selectionRanges } }) => {
      const angleBetween = angleBetweenInfo({
        selectionRanges,
      })
      if (err(angleBetween)) return false
      const angleLength = angleLengthInfo({
        selectionRanges,
        angleOrLength: 'setAngle',
      })
      if (err(angleLength)) return false
      return angleBetween.enabled || angleLength.enabled
    },
    'Can constrain length': ({ context: { selectionRanges } }) => {
      const angleLength = angleLengthInfo({
        selectionRanges,
      })
      if (err(angleLength)) return false
      return angleLength.enabled
    },
    'Can constrain perpendicular distance': ({
      context: { selectionRanges },
    }) => {
      const info = intersectInfo({ selectionRanges })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain horizontally align': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: selectionRanges,
        constraint: 'setHorzDistance',
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain vertically align': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: selectionRanges,
        constraint: 'setHorzDistance',
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain snap to X': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({
        selectionRanges,
        constraint: 'snapToXAxis',
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain snap to Y': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({
        selectionRanges,
        constraint: 'snapToYAxis',
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain equal length': ({ context: { selectionRanges } }) => {
      const info = setEqualLengthInfo({
        selectionRanges,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain parallel': ({ context: { selectionRanges } }) => {
      const info = equalAngleInfo({
        selectionRanges,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain remove constraints': ({
      context: { selectionRanges },
      event,
    }) => {
      if (event.type !== 'Constrain remove constraints') return false
      const info = removeConstrainingValuesInfo({
        selectionRanges,
        pathToNodes: event.data && [event.data],
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can convert to named value': ({ event }) => {
      if (event.type !== 'Constrain with named value') return false
      if (!event.data) return false
      const ast = parse(recast(kclManager.ast))
      if (err(ast) || !ast.program || ast.errors.length > 0) return false
      const isSafeRetVal = isNodeSafeToReplacePath(
        ast.program,

        event.data.currentValue.pathToNode
      )
      if (err(isSafeRetVal)) return false
      return isSafeRetVal.isSafe
    },
    'next is tangential arc': ({ context: { sketchDetails, currentTool } }) =>
      currentTool === 'tangentialArc' &&
      isEditingExistingSketch({ sketchDetails }),

    'next is rectangle': ({ context: { currentTool } }) =>
      currentTool === 'rectangle',
    'next is center rectangle': ({ context: { currentTool } }) =>
      currentTool === 'center rectangle',
    'next is circle': ({ context: { currentTool } }) =>
      currentTool === 'circle',
    'next is circle three point': ({ context: { currentTool } }) =>
      currentTool === 'circleThreePoint',
    'next is circle three point neo': ({ context: { currentTool } }) =>
      currentTool === 'circleThreePoint',
    'next is line': ({ context }) => context.currentTool === 'line',
    'next is none': ({ context }) => context.currentTool === 'none',
    'next is arc': ({ context }) => context.currentTool === 'arc',
    'next is arc three point': ({ context }) =>
      context.currentTool === 'arcThreePoint',
  },
  // end guards
  actions: {
    toastError: ({ event }) => {
      if ('output' in event && event.output instanceof Error) {
        toast.error(event.output.message)
      } else if ('data' in event && event.data instanceof Error) {
        toast.error(event.data.message)
      } else if ('error' in event && event.error instanceof Error) {
        toast.error(event.error.message)
      }
    },
    'assign tool in context': assign({
      currentTool: ({ event }) =>
        event.type === 'change tool' ? event.data.tool || 'none' : 'none',
    }),
    'reset selections': assign({
      selectionRanges: { graphSelections: [], otherSelections: [] },
    }),
    'enter sketching mode': assign({ currentMode: 'sketching' }),
    'enter modeling mode': assign({ currentMode: 'modeling' }),
    'set sketchMetadata from pathToNode': assign(
      ({ context: { sketchDetails } }) => {
        if (!sketchDetails?.sketchEntryNodePath || !sketchDetails) return {}
        return {
          sketchDetails: {
            ...sketchDetails,
            sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
          },
        }
      }
    ),
    'hide default planes': assign({
      defaultPlaneVisibility: () => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        kclManager.hidePlanes()
        return { xy: false, xz: false, yz: false }
      },
    }),
    'reset sketch metadata': assign({
      sketchDetails: null,
      sketchEnginePathId: '',
      sketchPlaneId: '',
    }),
    'reset camera position': () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          center: { x: 0, y: 0, z: 0 },
          vantage: { x: 0, y: -1250, z: 580 },
          up: { x: 0, y: 0, z: 1 },
        },
      })
    },
    'set new sketch metadata': assign(({ event }) => {
      if (
        event.type !== 'xstate.done.actor.animate-to-sketch' &&
        event.type !== 'xstate.done.actor.animate-to-face'
      )
        return {}
      return {
        sketchDetails: event.output,
      }
    }),
    'set selection filter to curves only': () => {
      ;(async () => {
        await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_selection_filter',
            filter: ['curve'],
          },
        })
      })().catch(reportRejection)
    },
    'tear down client sketch': () => {
      sceneEntitiesManager.tearDownSketch({ removeAxis: false })
    },
    'remove sketch grid': () => sceneEntitiesManager.removeSketchGrid(),
    'set up draft line': assign(({ context: { sketchDetails }, event }) => {
      if (!sketchDetails) return {}
      if (event.type !== 'Add start point') return {}

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager
        .setupDraftSegment(
          event.data.sketchEntryNodePath || sketchDetails.sketchEntryNodePath,
          event.data.sketchNodePaths || sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'line'
        )
        .then(() => {
          return codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
        })
      return {
        sketchDetails: {
          ...sketchDetails,
          sketchEntryNodePath: event.data.sketchEntryNodePath,
          sketchNodePaths: event.data.sketchNodePaths,
        },
      }
    }),
    'set up draft arc': assign(({ context: { sketchDetails }, event }) => {
      if (!sketchDetails) return {}
      if (event.type !== 'Continue existing profile') return {}

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager
        .setupDraftSegment(
          event.data.sketchEntryNodePath || sketchDetails.sketchEntryNodePath,
          event.data.sketchNodePaths || sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'tangentialArc'
        )
        .then(() => {
          return codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
        })
      return {
        sketchDetails: {
          ...sketchDetails,
          sketchEntryNodePath: event.data.sketchEntryNodePath,
          sketchNodePaths: event.data.sketchNodePaths,
        },
      }
    }),
    'listen for rectangle origin': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )

      // Position the click raycast plane

      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'click in scene',
              data: sceneEntitiesManager.getSnappedDragPoint(
                twoD,
                args.intersects,
                args.mouseEvent
              ).snappedPoint,
            })
          } else {
            console.error('No intersection point found')
          }
        },
      })
    },

    'listen for center rectangle origin': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )

      // Position the click raycast plane

      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add center rectangle origin',
              data: [twoD.x, twoD.y],
            })
          } else {
            console.error('No intersection point found')
          }
        },
      })
    },

    'listen for circle origin': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )

      // Position the click raycast plane

      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
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
    'listen for circle first point': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )

      // Position the click raycast plane

      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add first point',
              data: [twoD.x, twoD.y],
            })
          } else {
            console.error('No intersection point found')
          }
        },
      })
    },
    'listen for circle second point': ({
      context: { sketchDetails },
      event,
    }) => {
      if (!sketchDetails) return
      if (event.type !== 'Add first point') return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )

      // Position the click raycast plane

      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      const dummy = new Mesh()
      dummy.position.set(0, 0, 0)
      const scale = sceneInfra.getClientSceneScaleFactor(dummy)
      const position = new Vector3(event.data[0], event.data[1], 0)
      position.applyQuaternion(quaternion)
      const draftPoint = createProfileStartHandle({
        isDraft: true,
        from: event.data,
        scale,
        theme: sceneInfra._theme,
      })
      draftPoint.position.copy(position)
      sceneInfra.scene.add(draftPoint)

      sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add second point',
              data: {
                p1: event.data,
                p2: [twoD.x, twoD.y],
              },
            })
          } else {
            console.error('No intersection point found')
          }
        },
      })
    },
    'update sketchDetails': assign(({ event, context }) => {
      if (
        event.type !== 'xstate.done.actor.actor-circle-three-point' &&
        event.type !== 'xstate.done.actor.set-up-draft-circle' &&
        event.type !== 'xstate.done.actor.set-up-draft-arc' &&
        event.type !== 'xstate.done.actor.set-up-draft-arc-three-point' &&
        event.type !== 'xstate.done.actor.set-up-draft-circle-three-point' &&
        event.type !== 'xstate.done.actor.set-up-draft-rectangle' &&
        event.type !== 'xstate.done.actor.set-up-draft-center-rectangle' &&
        event.type !== 'xstate.done.actor.split-sketch-pipe-if-needed' &&
        event.type !== 'xstate.done.actor.reeval-node-paths'
      ) {
        return {}
      }
      if (!context.sketchDetails) return {}
      return {
        sketchDetails: {
          ...context.sketchDetails,
          planeNodePath:
            event.output.updatedPlaneNodePath ||
            context.sketchDetails?.planeNodePath ||
            [],
          sketchEntryNodePath: event.output.updatedEntryNodePath,
          sketchNodePaths: event.output.updatedSketchNodePaths,
          expressionIndexToDelete: event.output.expressionIndexToDelete,
        },
      }
    }),
    'update sketchDetails arc': assign(({ event, context }) => {
      if (event.type !== 'Add start point') return {}
      if (!context.sketchDetails) return {}
      return {
        sketchDetails: {
          ...context.sketchDetails,
          sketchEntryNodePath: event.data.sketchEntryNodePath,
          sketchNodePaths: event.data.sketchNodePaths,
        },
      }
    }),
    'show default planes': assign({
      defaultPlaneVisibility: () => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        kclManager.showPlanes()
        return { xy: true, xz: true, yz: true }
      },
    }),
    'show default planes if no errors': assign({
      defaultPlaneVisibility: ({ context }) => {
        if (!kclManager.hasErrors()) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          kclManager.showPlanes()
          return { xy: true, xz: true, yz: true }
        }
        return { ...context.defaultPlaneVisibility }
      },
    }),
    'setup noPoints onClick listener': ({
      context: { sketchDetails, currentTool },
    }) => {
      if (!sketchDetails) return
      sceneEntitiesManager.setupNoPointsListener({
        sketchDetails,
        currentTool,
        afterClick: (_, data) =>
          sceneInfra.modelingSend(
            currentTool === 'tangentialArc'
              ? { type: 'Continue existing profile', data }
              : currentTool === 'arc'
                ? { type: 'Add start point', data }
                : { type: 'Add start point', data }
          ),
      })
    },
    'add axis n grid': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      if (localStorage.getItem('disableAxis')) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager.createSketchAxis(
        sketchDetails.sketchEntryNodePath || [],
        sketchDetails.zAxis,
        sketchDetails.yAxis,
        sketchDetails.origin
      )

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
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
    /** TODO: this action is hiding unawaited asynchronous code */
    'set selection filter to faces only': () => {
      kclManager.setSelectionFilter(['face', 'object'])
    },
    /** TODO: this action is hiding unawaited asynchronous code */
    'set selection filter to defaults': () => {
      kclManager.defaultSelectionFilter()
    },
    'Delete segment': ({ context: { sketchDetails }, event }) => {
      if (event.type !== 'Delete segment') return
      if (!sketchDetails || !event.data) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      deleteSegment({
        pathToNode: event.data,
        sketchDetails,
      }).then(() => {
        return codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
      })
    },
    'Reset Segment Overlays': () => sceneEntitiesManager.resetOverlays(),
    'Set context': assign({
      store: ({ context: { store }, event }) => {
        if (event.type !== 'Set context') return store
        if (!event.data) return store

        const result = {
          ...store,
          ...event.data,
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
    'remove draft entities': () => {
      const draftPoint = sceneInfra.scene.getObjectByName(DRAFT_POINT)
      if (draftPoint) {
        sceneInfra.scene.remove(draftPoint)
      }
      const draftLine = sceneInfra.scene.getObjectByName(DRAFT_DASHED_LINE)
      if (draftLine) {
        sceneInfra.scene.remove(draftLine)
      }
    },
    'add draft line': ({ event, context }) => {
      if (
        event.type !== 'Add start point' &&
        event.type !== 'xstate.done.actor.setup-client-side-sketch-segments9'
      )
        return

      let sketchEntryNodePath: PathToNode | undefined

      if (event.type === 'Add start point') {
        sketchEntryNodePath = event.data?.sketchEntryNodePath
      } else if (
        event.type === 'xstate.done.actor.setup-client-side-sketch-segments9'
      ) {
        sketchEntryNodePath =
          context.sketchDetails?.sketchNodePaths.slice(-1)[0]
      }
      if (!sketchEntryNodePath) return
      const varDec = getNodeFromPath<VariableDeclaration>(
        kclManager.ast,
        sketchEntryNodePath,
        'VariableDeclaration'
      )
      if (err(varDec)) return
      const varName = varDec.node.declaration.id.name
      const sg = sketchFromKclValue(kclManager.variables[varName], varName)
      if (err(sg)) return
      const lastSegment = sg.paths[sg.paths.length - 1] || sg.start
      const to = lastSegment.to

      const { group, updater } = sceneEntitiesManager.drawDashedLine({
        from: to,
        to: [to[0] + 0.001, to[1] + 0.001],
      })
      sceneInfra.scene.add(group)
      const orthoFactor = orthoScale(sceneInfra.camControls.camera)
      sceneInfra.setCallbacks({
        onMove: (args) => {
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          if (!context.sketchDetails) return
          const { snappedPoint, isSnapped } =
            sceneEntitiesManager.getSnappedDragPoint(
              intersectionPoint.twoD,
              args.intersects,
              args.mouseEvent
            )
          if (isSnapped) {
            sceneEntitiesManager.positionDraftPoint({
              snappedPoint: new Vector2(...snappedPoint),
              origin: context.sketchDetails.origin,
              yAxis: context.sketchDetails.yAxis,
              zAxis: context.sketchDetails.zAxis,
            })
          } else {
            sceneEntitiesManager.removeDraftPoint()
          }
          updater(
            group,
            [intersectionPoint.twoD.x, intersectionPoint.twoD.y],
            orthoFactor
          )
        },
      })
    },
    'reset deleteIndex': assign(({ context: { sketchDetails } }) => {
      if (!sketchDetails) return {}
      return {
        sketchDetails: {
          ...sketchDetails,
          expressionIndexToDelete: -1,
        },
      }
    }),
    'enable copilot': () => {},
    'disable copilot': () => {},
    'Set selection': () => {},
    'Set mouse state': () => {},
    'Set Segment Overlays': () => {},
    'Center camera on selection': () => {},
    'Submit to Text-to-CAD API': () => {},
    'Set sketchDetails': () => {},
    'sketch exit execute': () => {},
    'debug-action': (data) => {
      console.log('re-eval debug-action', data)
    },
    'Toggle default plane visibility': assign(({ context, event }) => {
      if (event.type !== 'Toggle default plane visibility') return {}

      const currentVisibilityMap = context.defaultPlaneVisibility
      const currentVisibility = currentVisibilityMap[event.planeKey]
      const newVisibility = !currentVisibility

      kclManager.engineCommandManager
        .setPlaneHidden(event.planeId, !newVisibility)
        .catch(reportRejection)

      return {
        defaultPlaneVisibility: {
          ...currentVisibilityMap,
          [event.planeKey]: newVisibility,
        },
      }
    }),
    // Saves the default plane visibility to be able to restore when going back from sketch mode
    'Save default plane visibility': assign(({ context, event }) => {
      return {
        savedDefaultPlaneVisibility: {
          ...context.defaultPlaneVisibility,
        },
      }
    }),
    'Restore default plane visibility': assign(({ context }) => {
      for (const planeKey of Object.keys(
        context.savedDefaultPlaneVisibility
      ) as (keyof PlaneVisibilityMap)[]) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        kclManager.setPlaneVisibilityByKey(
          planeKey,
          context.savedDefaultPlaneVisibility[planeKey]
        )
      }

      return {
        defaultPlaneVisibility: {
          ...context.defaultPlaneVisibility,
          ...context.savedDefaultPlaneVisibility,
        },
      }
    }),
    'show sketch error toast': assign(() => {
      // toast message that stays open until closed programmatically
      const toastId = toast.error(
        "Error in kcl script, sketch cannot be drawn until it's fixed",
        { duration: Infinity }
      )
      return {
        toastId,
      }
    }),
    'remove sketch error toast': assign(({ context }) => {
      if (context.toastId) {
        toast.dismiss(context.toastId)
        return { toastId: null }
      }
      return {}
    }),
  },
  // end actions
  actors: {
    'do-constrain-remove-constraint': fromPromise(
      async ({
        input: { selectionRanges, sketchDetails, data },
      }: {
        input: Pick<
          ModelingMachineContext,
          'selectionRanges' | 'sketchDetails'
        > & { data?: PathToNode }
      }) => {
        const constraint = applyRemoveConstrainingValues({
          selectionRanges,
          pathToNodes: data && [data],
        })
        if (trap(constraint)) return
        const { pathToNodeMap } = constraint
        if (!sketchDetails) return
        let updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          pathToNodeMap[0],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          constraint.modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return

        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)

        return {
          selectionType: 'completeSelection',
          selection: updateSelections(
            pathToNodeMap,
            selectionRanges,
            updatedAst.newAst
          ),
        }
      }
    ),
    'do-constrain-horizontally': fromPromise(
      async ({
        input: { selectionRanges, sketchDetails },
      }: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        const constraint = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.variables
        )
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchEntryNodePath,
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)
        return {
          selectionType: 'completeSelection',
          selection: updateSelections(
            pathToNodeMap,
            selectionRanges,
            updatedAst.newAst
          ),
        }
      }
    ),
    'do-constrain-vertically': fromPromise(
      async ({
        input: { selectionRanges, sketchDetails },
      }: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        const constraint = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.variables
        )
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)
        return {
          selectionType: 'completeSelection',
          selection: updateSelections(
            pathToNodeMap,
            selectionRanges,
            updatedAst.newAst
          ),
        }
      }
    ),
    'do-constrain-horizontally-align': fromPromise(
      async ({
        input: { selectionRanges, sketchDetails },
      }: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        const constraint = applyConstraintHorzVertAlign({
          selectionRanges: selectionRanges,
          constraint: 'setVertDistance',
        })
        if (trap(constraint)) return
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      }
    ),
    'do-constrain-vertically-align': fromPromise(
      async ({
        input: { selectionRanges, sketchDetails },
      }: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        const constraint = applyConstraintHorzVertAlign({
          selectionRanges: selectionRanges,
          constraint: 'setHorzDistance',
        })
        if (trap(constraint)) return
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      }
    ),
    'do-constrain-snap-to-x': fromPromise(
      async ({
        input: { selectionRanges, sketchDetails },
      }: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        const constraint = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        if (err(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      }
    ),
    'do-constrain-snap-to-y': fromPromise(
      async ({
        input: { selectionRanges, sketchDetails },
      }: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        const constraint = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      }
    ),
    'do-constrain-parallel': fromPromise(
      async ({
        input: { selectionRanges, sketchDetails },
      }: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        const constraint = applyConstraintEqualAngle({
          selectionRanges,
        })
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint

        if (!sketchDetails) {
          trap(new Error('No sketch details'))
          return
        }

        const recastAst = parse(recast(modifiedAst))
        if (err(recastAst) || !resultIsOk(recastAst)) return

        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          recastAst.program,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)

        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      }
    ),
    'do-constrain-equal-length': fromPromise(
      async ({
        input: { selectionRanges, sketchDetails },
      }: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        const constraint = applyConstraintEqualLength({
          selectionRanges,
        })
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst
        )
        return {
          selectionType: 'completeSelection',
          selection: updatedSelectionRanges,
        }
      }
    ),
    'Get vertical info': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        return {} as SetSelections
      }
    ),
    'Get ABS X info': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        return {} as SetSelections
      }
    ),
    'Get ABS Y info': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        return {} as SetSelections
      }
    ),
    'Get angle info': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        return {} as SetSelections
      }
    ),
    'Get perpendicular distance info': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'selectionRanges' | 'sketchDetails'>
      }) => {
        return {} as SetSelections
      }
    ),
    'AST-undo-startSketchOn': fromPromise(
      async (_: { input: Pick<ModelingMachineContext, 'sketchDetails'> }) => {
        return undefined
      }
    ),
    'animate-to-face': fromPromise(
      async (_: { input?: ExtrudeFacePlane | DefaultPlane | OffsetPlane }) => {
        return {} as ModelingMachineContext['sketchDetails']
      }
    ),
    'animate-to-sketch': fromPromise(
      async (_: { input: Pick<ModelingMachineContext, 'selectionRanges'> }) => {
        return {} as ModelingMachineContext['sketchDetails']
      }
    ),
    'Get horizontal info': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails' | 'selectionRanges'>
      }) => {
        return {} as SetSelections
      }
    ),
    astConstrainLength: fromPromise(
      async (_: {
        input: Pick<
          ModelingMachineContext,
          'sketchDetails' | 'selectionRanges'
        > & {
          lengthValue?: KclCommandValue
        }
      }) => {
        return {} as SetSelections
      }
    ),
    'Apply named value constraint': fromPromise(
      async (_: {
        input: Pick<
          ModelingMachineContext,
          'sketchDetails' | 'selectionRanges'
        > & {
          data?: ModelingCommandSchema['Constrain with named value']
        }
      }) => {
        return {} as SetSelections
      }
    ),
    extrudeAstMod: fromPromise<
      unknown,
      ModelingCommandSchema['Extrude'] | undefined
    >(async ({ input }) => {
      if (!input) return new Error('No input provided')
      const { selection, distance, nodeToEdit } = input
      const isEditing =
        nodeToEdit !== undefined && typeof nodeToEdit[1][0] === 'number'
      let ast = structuredClone(kclManager.ast)
      let extrudeName: string | undefined = undefined

      // If this is an edit flow, first we're going to remove the old extrusion
      if (isEditing) {
        // Extract the plane name from the node to edit
        const extrudeNameNode = getNodeFromPath<VariableDeclaration>(
          ast,
          nodeToEdit,
          'VariableDeclaration'
        )
        if (err(extrudeNameNode)) {
          console.error('Error extracting plane name')
        } else {
          extrudeName = extrudeNameNode.node.declaration.id.name
        }

        // Removing the old extrusion statement
        const newBody = [...ast.body]
        newBody.splice(nodeToEdit[1][0] as number, 1)
        ast.body = newBody
      }

      const pathToNode = getNodePathFromSourceRange(
        ast,
        selection.graphSelections[0]?.codeRef.range
      )
      // Add an extrude statement to the AST
      const extrudeSketchRes = extrudeSketch({
        node: ast,
        pathToNode,
        artifact: selection.graphSelections[0].artifact,
        artifactGraph: kclManager.artifactGraph,
        distance:
          'variableName' in distance
            ? distance.variableIdentifierAst
            : distance.valueAst,
        extrudeName,
      })
      if (err(extrudeSketchRes)) return extrudeSketchRes
      const { modifiedAst, pathToExtrudeArg } = extrudeSketchRes

      // Insert the distance variable if the user has provided a variable name
      if (
        'variableName' in distance &&
        distance.variableName &&
        typeof pathToExtrudeArg[1][0] === 'number'
      ) {
        const insertIndex = Math.min(
          pathToExtrudeArg[1][0],
          distance.insertIndex
        )
        const newBody = [...modifiedAst.body]
        newBody.splice(insertIndex, 0, distance.variableDeclarationAst)
        modifiedAst.body = newBody
        // Since we inserted a new variable, we need to update the path to the extrude argument
        pathToExtrudeArg[1][0]++
      }

      await updateModelingState(
        modifiedAst,
        EXECUTION_TYPE_REAL,
        {
          kclManager,
          editorManager,
          codeManager,
        },
        {
          focusPath: [pathToExtrudeArg],
        }
      )
    }),
    revolveAstMod: fromPromise<
      unknown,
      ModelingCommandSchema['Revolve'] | undefined
    >(async ({ input }) => {
      if (!input) return new Error('No input provided')
      const { nodeToEdit, selection, angle, axis, edge, axisOrEdge } = input
      let ast = kclManager.ast
      let variableName: string | undefined = undefined
      let insertIndex: number | undefined = undefined

      // If this is an edit flow, first we're going to remove the old extrusion
      if (nodeToEdit && typeof nodeToEdit[1][0] === 'number') {
        // Extract the plane name from the node to edit
        const nameNode = getNodeFromPath<VariableDeclaration>(
          ast,
          nodeToEdit,
          'VariableDeclaration'
        )
        if (err(nameNode)) {
          console.error('Error extracting plane name')
        } else {
          variableName = nameNode.node.declaration.id.name
        }

        // Removing the old extrusion statement
        const newBody = [...ast.body]
        newBody.splice(nodeToEdit[1][0], 1)
        ast.body = newBody
        insertIndex = nodeToEdit[1][0]
      }

      if (
        'variableName' in angle &&
        angle.variableName &&
        angle.insertIndex !== undefined
      ) {
        const newBody = [...ast.body]
        newBody.splice(angle.insertIndex, 0, angle.variableDeclarationAst)
        ast.body = newBody
        if (insertIndex) {
          // if editing need to offset that new var
          insertIndex += 1
        }
      }

      // This is the selection of the sketch that will be revolved
      const pathToNode = getNodePathFromSourceRange(
        ast,
        selection.graphSelections[0]?.codeRef.range
      )

      const revolveSketchRes = revolveSketch(
        ast,
        pathToNode,
        'variableName' in angle ? angle.variableIdentifierAst : angle.valueAst,
        axisOrEdge,
        axis,
        edge,
        variableName,
        insertIndex
      )
      if (trap(revolveSketchRes)) return
      const { modifiedAst, pathToRevolveArg } = revolveSketchRes
      await updateModelingState(
        modifiedAst,
        EXECUTION_TYPE_REAL,
        {
          kclManager,
          editorManager,
          codeManager,
        },
        {
          focusPath: [pathToRevolveArg],
        }
      )
    }),
    offsetPlaneAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Offset plane'] | undefined
      }) => {
        if (!input) return new Error('No input provided')
        // Extract inputs
        const ast = kclManager.ast
        const { plane: selection, distance, nodeToEdit } = input

        let insertIndex: number | undefined = undefined
        let planeName: string | undefined = undefined

        // If this is an edit flow, first we're going to remove the old plane
        if (nodeToEdit && typeof nodeToEdit[1][0] === 'number') {
          // Extract the plane name from the node to edit
          const planeNameNode = getNodeFromPath<VariableDeclaration>(
            ast,
            nodeToEdit,
            'VariableDeclaration'
          )
          if (err(planeNameNode)) {
            console.error('Error extracting plane name')
          } else {
            planeName = planeNameNode.node.declaration.id.name
          }

          const newBody = [...ast.body]
          newBody.splice(nodeToEdit[1][0], 1)
          ast.body = newBody
          insertIndex = nodeToEdit[1][0]
        }

        // Extract the default plane from selection
        const plane = selection.otherSelections[0]
        if (!(plane && plane instanceof Object && 'name' in plane))
          return trap('No plane selected')

        // Get the default plane name from the selection
        const offsetPlaneResult = addOffsetPlane({
          node: ast,
          defaultPlane: plane.name,
          offset:
            'variableName' in distance
              ? distance.variableIdentifierAst
              : distance.valueAst,
          insertIndex,
          planeName,
        })

        // Insert the distance variable if the user has provided a variable name
        if (
          'variableName' in distance &&
          distance.variableName &&
          typeof offsetPlaneResult.pathToNode[1][0] === 'number'
        ) {
          const insertIndex = Math.min(
            offsetPlaneResult.pathToNode[1][0],
            distance.insertIndex
          )
          const newBody = [...offsetPlaneResult.modifiedAst.body]
          newBody.splice(insertIndex, 0, distance.variableDeclarationAst)
          offsetPlaneResult.modifiedAst.body = newBody
          // Since we inserted a new variable, we need to update the path to the extrude argument
          offsetPlaneResult.pathToNode[1][0]++
        }

        await updateModelingState(
          offsetPlaneResult.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager,
            editorManager,
            codeManager,
          },
          {
            focusPath: [offsetPlaneResult.pathToNode],
          }
        )
      }
    ),
    helixAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Helix'] | undefined
      }) => {
        if (!input) return new Error('No input provided')
        // Extract inputs
        console.log('input', input)
        const ast = kclManager.ast
        const {
          mode,
          axis,
          edge,
          cylinder,
          revolutions,
          angleStart,
          ccw,
          radius,
          length,
          nodeToEdit,
        } = input

        let opInsertIndex: number | undefined = undefined
        let opVariableName: string | undefined = undefined

        // If this is an edit flow, first we're going to remove the old one
        if (nodeToEdit && typeof nodeToEdit[1][0] === 'number') {
          // Extract the old name from the node to edit
          const oldNode = getNodeFromPath<VariableDeclaration>(
            ast,
            nodeToEdit,
            'VariableDeclaration'
          )
          if (err(oldNode)) {
            console.error('Error extracting plane name')
          } else {
            opVariableName = oldNode.node.declaration.id.name
          }

          const newBody = [...ast.body]
          newBody.splice(nodeToEdit[1][0], 1)
          ast.body = newBody
          opInsertIndex = nodeToEdit[1][0]
        }

        let cylinderDeclarator: VariableDeclarator | undefined
        let axisExpression:
          | Node<CallExpression | CallExpressionKw | Name>
          | Node<Literal>
          | undefined

        if (mode === 'Cylinder') {
          if (
            !(
              cylinder &&
              cylinder.graphSelections[0] &&
              cylinder.graphSelections[0].artifact?.type === 'wall'
            )
          ) {
            return new Error('Cylinder argument not valid')
          }
          const clonedAstForGetExtrude = structuredClone(ast)
          const extrudeLookupResult = getPathToExtrudeForSegmentSelection(
            clonedAstForGetExtrude,
            cylinder.graphSelections[0],
            kclManager.artifactGraph
          )
          if (err(extrudeLookupResult)) {
            return extrudeLookupResult
          }
          const extrudeNode = getNodeFromPath<VariableDeclaration>(
            ast,
            extrudeLookupResult.pathToExtrudeNode,
            'VariableDeclaration'
          )
          if (err(extrudeNode)) {
            return extrudeNode
          }
          cylinderDeclarator = extrudeNode.node.declaration
        } else if (mode === 'Axis' || mode === 'Edge') {
          const getAxisResult = getAxisExpressionAndIndex(mode, axis, edge, ast)
          if (err(getAxisResult)) {
            return getAxisResult
          }
          axisExpression = getAxisResult.generatedAxis
        } else {
          return new Error(
            'Generated axis or cylinder declarator selection is missing.'
          )
        }

        // TODO: figure out if we want to smart insert after the sketch as below
        // *or* after the sweep that consumes the sketch, in which case the below code doesn't work
        // If an axis was selected in KCL, find the max index to insert the revolve command
        // if (axisIndexIfAxis) {
        // opInsertIndex = axisIndexIfAxis + 1
        // }

        for (const v of [revolutions, angleStart, radius, length]) {
          if (v === undefined) {
            continue
          }
          const variable = v as KclCommandValue
          // Insert the variable if it exists
          if ('variableName' in variable && variable.variableName) {
            const newBody = [...ast.body]
            newBody.splice(
              variable.insertIndex,
              0,
              variable.variableDeclarationAst
            )
            ast.body = newBody
          }
        }

        const { modifiedAst, pathToNode } = addHelix({
          node: ast,
          revolutions: valueOrVariable(revolutions),
          angleStart: valueOrVariable(angleStart),
          ccw,
          radius: radius ? valueOrVariable(radius) : undefined,
          axis: axisExpression,
          cylinder: cylinderDeclarator,
          length: length ? valueOrVariable(length) : undefined,
          insertIndex: opInsertIndex,
          variableName: opVariableName,
        })
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager,
            editorManager,
            codeManager,
          },
          {
            focusPath: [pathToNode],
          }
        )
      }
    ),
    sweepAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Sweep'] | undefined
      }) => {
        if (!input) return new Error('No input provided')
        // Extract inputs
        const ast = kclManager.ast
        const { target, trajectory, sectional, nodeToEdit } = input
        let variableName: string | undefined = undefined
        let insertIndex: number | undefined = undefined

        // If this is an edit flow, first we're going to remove the old one
        if (nodeToEdit !== undefined && typeof nodeToEdit[1][0] === 'number') {
          // Extract the plane name from the node to edit
          const variableNode = getNodeFromPath<VariableDeclaration>(
            ast,
            nodeToEdit,
            'VariableDeclaration'
          )

          if (err(variableNode)) {
            console.error('Error extracting name')
          } else {
            variableName = variableNode.node.declaration.id.name
          }

          // Removing the old statement
          const newBody = [...ast.body]
          newBody.splice(nodeToEdit[1][0], 1)
          ast.body = newBody
          insertIndex = nodeToEdit[1][0]
        }

        // Find the target declaration
        const targetNodePath = getNodePathFromSourceRange(
          ast,
          target.graphSelections[0].codeRef.range
        )
        // Gotchas, not sure why
        // - it seems like in some cases we get a list on edit, especially the state that e2e hits
        // - looking for a VariableDeclaration seems more robust than VariableDeclarator
        const targetNode = getNodeFromPath<
          VariableDeclaration | VariableDeclaration[]
        >(ast, targetNodePath, 'VariableDeclaration')
        if (err(targetNode)) {
          return new Error("Couldn't parse profile selection")
        }

        const targetDeclarator = isArray(targetNode.node)
          ? targetNode.node[0].declaration
          : targetNode.node.declaration

        // Find the trajectory (or path) declaration
        const trajectoryNodePath = getNodePathFromSourceRange(
          ast,
          trajectory.graphSelections[0].codeRef.range
        )
        // Also looking for VariableDeclaration for consistency here
        const trajectoryNode = getNodeFromPath<VariableDeclaration>(
          ast,
          trajectoryNodePath,
          'VariableDeclaration'
        )
        if (err(trajectoryNode)) {
          return new Error("Couldn't parse path selection")
        }

        const trajectoryDeclarator = trajectoryNode.node.declaration

        // Perform the sweep
        const { modifiedAst, pathToNode } = addSweep({
          node: ast,
          targetDeclarator,
          trajectoryDeclarator,
          sectional,
          variableName,
          insertIndex,
        })
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager,
            editorManager,
            codeManager,
          },
          {
            focusPath: [pathToNode],
          }
        )
      }
    ),
    loftAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Loft'] | undefined
      }) => {
        if (!input) return new Error('No input provided')
        // Extract inputs
        const ast = kclManager.ast
        const { selection } = input
        const declarators = selection.graphSelections.flatMap((s) => {
          const path = getNodePathFromSourceRange(ast, s?.codeRef.range)
          const nodeFromPath = getNodeFromPath<VariableDeclarator>(
            ast,
            path,
            'VariableDeclarator'
          )
          return err(nodeFromPath) ? [] : nodeFromPath.node
        })

        // TODO: add better validation on selection
        if (!(declarators && declarators.length > 1)) {
          trap('Not enough sketches selected')
        }

        // Perform the loft
        const loftSketchesRes = loftSketches(ast, declarators)
        await updateModelingState(
          loftSketchesRes.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager,
            editorManager,
            codeManager,
          },
          {
            focusPath: [loftSketchesRes.pathToNode],
          }
        )
      }
    ),
    shellAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Shell'] | undefined
      }) => {
        if (!input) {
          return new Error('No input provided')
        }

        // Extract inputs
        const ast = kclManager.ast
        const { selection, thickness, nodeToEdit } = input
        let variableName: string | undefined = undefined
        let insertIndex: number | undefined = undefined

        // If this is an edit flow, first we're going to remove the old extrusion
        if (nodeToEdit && typeof nodeToEdit[1][0] === 'number') {
          // Extract the plane name from the node to edit
          const variableNode = getNodeFromPath<VariableDeclaration>(
            ast,
            nodeToEdit,
            'VariableDeclaration'
          )
          if (err(variableNode)) {
            console.error('Error extracting name')
          } else {
            variableName = variableNode.node.declaration.id.name
          }

          // Removing the old statement
          const newBody = [...ast.body]
          newBody.splice(nodeToEdit[1][0], 1)
          ast.body = newBody
          insertIndex = nodeToEdit[1][0]
        }

        // Turn the selection into the faces list
        const clonedAstForGetExtrude = structuredClone(ast)
        const faces: Expr[] = []
        let pathToExtrudeNode: PathToNode | undefined = undefined
        for (const graphSelection of selection.graphSelections) {
          const extrudeLookupResult = getPathToExtrudeForSegmentSelection(
            clonedAstForGetExtrude,
            graphSelection,
            kclManager.artifactGraph
          )
          if (err(extrudeLookupResult)) {
            return new Error(
              "Couldn't find extrude paths from getPathToExtrudeForSegmentSelection",
              { cause: extrudeLookupResult }
            )
          }

          const extrudeNode = getNodeFromPath<VariableDeclaration>(
            ast,
            extrudeLookupResult.pathToExtrudeNode,
            'VariableDeclaration'
          )
          if (err(extrudeNode)) {
            return new Error("Couldn't find extrude node from selection", {
              cause: extrudeNode,
            })
          }

          const segmentNode = getNodeFromPath<VariableDeclaration>(
            ast,
            extrudeLookupResult.pathToSegmentNode,
            'VariableDeclaration'
          )
          if (err(segmentNode)) {
            return new Error("Couldn't find segment node from selection", {
              cause: segmentNode,
            })
          }

          if (
            extrudeNode.node.declaration.init.type === 'CallExpression' ||
            extrudeNode.node.declaration.init.type === 'CallExpressionKw'
          ) {
            pathToExtrudeNode = extrudeLookupResult.pathToExtrudeNode
          } else if (
            segmentNode.node.declaration.init.type === 'PipeExpression'
          ) {
            pathToExtrudeNode = extrudeLookupResult.pathToSegmentNode
          } else {
            return new Error(
              "Couldn't find extrude node that was either a call expression or a pipe",
              { cause: segmentNode }
            )
          }

          const selectedArtifact = graphSelection.artifact
          if (!selectedArtifact) {
            return new Error('Bad artifact from selection')
          }

          // Check on the selection, and handle the wall vs cap casees
          let expr: Expr
          if (selectedArtifact.type === 'cap') {
            expr = createLiteral(selectedArtifact.subType)
          } else if (selectedArtifact.type === 'wall') {
            const tagResult = mutateAstWithTagForSketchSegment(
              ast,
              extrudeLookupResult.pathToSegmentNode
            )
            if (err(tagResult)) {
              return tagResult
            }

            const { tag } = tagResult
            expr = createLocalName(tag)
          } else {
            return new Error('Artifact is neither a cap nor a wall')
          }

          faces.push(expr)
        }

        if (!pathToExtrudeNode) {
          return new Error('No path to extrude node found')
        }

        const extrudeNode = getNodeFromPath<VariableDeclarator>(
          ast,
          pathToExtrudeNode,
          'VariableDeclarator'
        )
        if (err(extrudeNode)) {
          return new Error("Couldn't find extrude node", {
            cause: extrudeNode,
          })
        }

        // Perform the shell op
        const sweepName = extrudeNode.node.id.name
        const addResult = addShell({
          node: ast,
          sweepName,
          faces: faces,
          thickness:
            'variableName' in thickness
              ? thickness.variableIdentifierAst
              : thickness.valueAst,
          insertIndex,
          variableName,
        })

        // Insert the thickness variable if the user has provided a variable name
        if (
          'variableName' in thickness &&
          thickness.variableName &&
          typeof addResult.pathToNode[1][0] === 'number'
        ) {
          const insertIndex = Math.min(
            addResult.pathToNode[1][0],
            thickness.insertIndex
          )
          const newBody = [...addResult.modifiedAst.body]
          newBody.splice(insertIndex, 0, thickness.variableDeclarationAst)
          addResult.modifiedAst.body = newBody
          // Since we inserted a new variable, we need to update the path to the extrude argument
          addResult.pathToNode[1][0]++
        }

        await updateModelingState(
          addResult.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager,
            editorManager,
            codeManager,
          },
          {
            focusPath: [addResult.pathToNode],
          }
        )
      }
    ),
    filletAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Fillet'] | undefined
      }) => {
        if (!input) {
          return new Error('No input provided')
        }

        // Extract inputs
        const ast = kclManager.ast
        const { nodeToEdit, selection, radius } = input

        // If this is an edit flow, first we're going to remove the old node
        if (nodeToEdit) {
          const oldNodeDeletion = deleteNodeInExtrudePipe(nodeToEdit, ast)
          if (err(oldNodeDeletion)) return oldNodeDeletion
        }

        const parameters: FilletParameters = {
          type: EdgeTreatmentType.Fillet,
          radius,
        }
        const dependencies = {
          kclManager,
          engineCommandManager,
          editorManager,
          codeManager,
        }

        // Apply fillet to selection
        const filletResult = await applyEdgeTreatmentToSelection(
          ast,
          selection,
          parameters,
          dependencies
        )
        if (err(filletResult)) return filletResult
      }
    ),
    'actor.parameter.create': fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['event.parameter.create'] | undefined
      }) => {
        if (!input) return new Error('No input provided')
        const { value } = input
        if (!('variableName' in value)) {
          return new Error('variable name is required')
        }
        const newAst = insertNamedConstant({
          node: kclManager.ast,
          newExpression: value,
        })
        await updateModelingState(newAst, EXECUTION_TYPE_REAL, {
          kclManager,
          editorManager,
          codeManager,
        })
      }
    ),
    'actor.parameter.edit': fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['event.parameter.edit'] | undefined
      }) => {
        if (!input) return new Error('No input provided')
        // Get the variable AST node to edit
        const { nodeToEdit, value } = input
        const newAst = structuredClone(kclManager.ast)
        const variableNode = getNodeFromPath<Node<VariableDeclarator>>(
          newAst,
          nodeToEdit
        )

        if (
          err(variableNode) ||
          variableNode.node.type !== 'VariableDeclarator' ||
          !variableNode.node
        ) {
          return new Error('No variable found, this is a bug')
        }

        // Mutate the variable's value
        variableNode.node.init = value.valueAst

        await updateModelingState(newAst, EXECUTION_TYPE_REAL, {
          codeManager,
          editorManager,
          kclManager,
        })
      }
    ),
    'set-up-draft-circle': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails'> & {
          data: [x: number, y: number]
        }
      }) => {
        return {} as SketchDetailsUpdate
      }
    ),
    'set-up-draft-circle-three-point': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails'> & {
          data: { p1: [x: number, y: number]; p2: [x: number, y: number] }
        }
      }) => {
        return {} as SketchDetailsUpdate
      }
    ),
    'set-up-draft-rectangle': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails'> & {
          data: [x: number, y: number]
        }
      }) => {
        return {} as SketchDetailsUpdate
      }
    ),
    'set-up-draft-center-rectangle': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails'> & {
          data: [x: number, y: number]
        }
      }) => {
        return {} as SketchDetailsUpdate
      }
    ),
    'set-up-draft-arc': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails'> & {
          data: [x: number, y: number]
        }
      }) => {
        return {} as SketchDetailsUpdate
      }
    ),
    'set-up-draft-arc-three-point': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails'> & {
          data: [x: number, y: number]
        }
      }) => {
        return {} as SketchDetailsUpdate
      }
    ),
    'setup-client-side-sketch-segments': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails' | 'selectionRanges'>
      }) => {
        return undefined
      }
    ),
    'split-sketch-pipe-if-needed': fromPromise(
      async (_: { input: Pick<ModelingMachineContext, 'sketchDetails'> }) => {
        return {} as SketchDetailsUpdate
      }
    ),
    chamferAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Chamfer'] | undefined
      }) => {
        if (!input) {
          return new Error('No input provided')
        }

        // Extract inputs
        const ast = kclManager.ast
        const { nodeToEdit, selection, length } = input

        // If this is an edit flow, first we're going to remove the old node
        if (nodeToEdit) {
          const oldNodeDeletion = deleteNodeInExtrudePipe(nodeToEdit, ast)
          if (err(oldNodeDeletion)) return oldNodeDeletion
        }

        const parameters: ChamferParameters = {
          type: EdgeTreatmentType.Chamfer,
          length,
        }
        const dependencies = {
          kclManager,
          engineCommandManager,
          editorManager,
          codeManager,
        }

        // Apply chamfer to selection
        const chamferResult = await applyEdgeTreatmentToSelection(
          ast,
          selection,
          parameters,
          dependencies
        )
        if (err(chamferResult)) return chamferResult
      }
    ),
    'submit-prompt-edit': fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Prompt-to-edit']
      }) => {}
    ),
    deleteSelectionAstMod: fromPromise(
      ({
        input: { selectionRanges },
      }: {
        input: { selectionRanges: Selections }
      }) => {
        return new Promise((resolve, reject) => {
          if (!selectionRanges) {
            reject(new Error(deletionErrorMessage))
          }

          const selection = selectionRanges.graphSelections[0]
          if (!selectionRanges) {
            reject(new Error(deletionErrorMessage))
          }

          deleteSelectionPromise(selection)
            .then((result) => {
              if (err(result)) {
                reject(result)
                return
              }
              resolve(result)
            })
            .catch(reject)
        })
      }
    ),
    appearanceAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Appearance'] | undefined
      }) => {
        if (!input) return new Error('No input provided')
        // Extract inputs
        const ast = kclManager.ast
        const { color, nodeToEdit } = input
        if (!(nodeToEdit && typeof nodeToEdit[1][0] === 'number')) {
          return new Error('Appearance is only an edit flow')
        }

        const result = setAppearance({
          ast,
          nodeToEdit,
          color,
        })

        if (err(result)) {
          return err(result)
        }

        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager,
            editorManager,
            codeManager,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),
    translateAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Translate'] | undefined
      }) => {
        if (!input) return Promise.reject(new Error('No input provided'))
        const ast = kclManager.ast
        const modifiedAst = structuredClone(ast)
        const { x, y, z, nodeToEdit, selection } = input
        let pathToNode = nodeToEdit
        if (!(pathToNode && typeof pathToNode[1][0] === 'number')) {
          if (selection?.graphSelections[0].artifact) {
            const children = findAllChildrenAndOrderByPlaceInCode(
              selection?.graphSelections[0].artifact,
              kclManager.artifactGraph
            )
            const variable = getLastVariable(children, modifiedAst)
            if (!variable) {
              return Promise.reject(
                new Error("Couldn't find corresponding path to node")
              )
            }
            pathToNode = variable.pathToNode
          } else if (selection?.graphSelections[0].codeRef.pathToNode) {
            pathToNode = selection?.graphSelections[0].codeRef.pathToNode
          } else {
            return Promise.reject(
              new Error("Couldn't find corresponding path to node")
            )
          }
        }

        // Look for the last pipe with the import alias and a call to translate, with a fallback to rotate.
        // Otherwise create one
        const importNodeAndAlias = findImportNodeAndAlias(ast, pathToNode)
        if (importNodeAndAlias) {
          const pipes = findPipesWithImportAlias(ast, pathToNode, 'translate')
          const lastPipe = pipes.at(-1)
          if (lastPipe && lastPipe.pathToNode) {
            pathToNode = lastPipe.pathToNode
          } else {
            const otherRelevantPipes = findPipesWithImportAlias(
              ast,
              pathToNode,
              'rotate'
            )
            const lastRelevantPipe = otherRelevantPipes.at(-1)
            if (lastRelevantPipe && lastRelevantPipe.pathToNode) {
              pathToNode = lastRelevantPipe.pathToNode
            } else {
              pathToNode = insertExpressionNode(
                modifiedAst,
                importNodeAndAlias.alias
              )
            }
          }
        }

        insertVariableAndOffsetPathToNode(x, modifiedAst, pathToNode)
        insertVariableAndOffsetPathToNode(y, modifiedAst, pathToNode)
        insertVariableAndOffsetPathToNode(z, modifiedAst, pathToNode)
        const result = setTranslate({
          pathToNode,
          modifiedAst,
          x: valueOrVariable(x),
          y: valueOrVariable(y),
          z: valueOrVariable(z),
        })
        if (err(result)) {
          return Promise.reject(result)
        }

        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager,
            editorManager,
            codeManager,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),
    rotateAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Rotate'] | undefined
      }) => {
        if (!input) return Promise.reject(new Error('No input provided'))
        const ast = kclManager.ast
        const modifiedAst = structuredClone(ast)
        const { roll, pitch, yaw, nodeToEdit, selection } = input
        let pathToNode = nodeToEdit
        if (!(pathToNode && typeof pathToNode[1][0] === 'number')) {
          if (selection?.graphSelections[0].artifact) {
            const children = findAllChildrenAndOrderByPlaceInCode(
              selection?.graphSelections[0].artifact,
              kclManager.artifactGraph
            )
            const variable = getLastVariable(children, modifiedAst)
            if (!variable) {
              return Promise.reject(
                new Error("Couldn't find corresponding path to node")
              )
            }
            pathToNode = variable.pathToNode
          } else if (selection?.graphSelections[0].codeRef.pathToNode) {
            pathToNode = selection?.graphSelections[0].codeRef.pathToNode
          } else {
            return Promise.reject(
              new Error("Couldn't find corresponding path to node")
            )
          }
        }

        // Look for the last pipe with the import alias and a call to rotate, with a fallback to translate.
        // Otherwise create one
        const importNodeAndAlias = findImportNodeAndAlias(ast, pathToNode)
        if (importNodeAndAlias) {
          const pipes = findPipesWithImportAlias(ast, pathToNode, 'rotate')
          const lastPipe = pipes.at(-1)
          if (lastPipe && lastPipe.pathToNode) {
            pathToNode = lastPipe.pathToNode
          } else {
            const otherRelevantPipes = findPipesWithImportAlias(
              ast,
              pathToNode,
              'translate'
            )
            const lastRelevantPipe = otherRelevantPipes.at(-1)
            if (lastRelevantPipe && lastRelevantPipe.pathToNode) {
              pathToNode = lastRelevantPipe.pathToNode
            } else {
              pathToNode = insertExpressionNode(
                modifiedAst,
                importNodeAndAlias.alias
              )
            }
          }
        }

        insertVariableAndOffsetPathToNode(roll, modifiedAst, pathToNode)
        insertVariableAndOffsetPathToNode(pitch, modifiedAst, pathToNode)
        insertVariableAndOffsetPathToNode(yaw, modifiedAst, pathToNode)
        const result = setRotate({
          pathToNode,
          modifiedAst,
          roll: valueOrVariable(roll),
          pitch: valueOrVariable(pitch),
          yaw: valueOrVariable(yaw),
        })
        if (err(result)) {
          return Promise.reject(result)
        }

        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager,
            editorManager,
            codeManager,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),
    cloneAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Clone'] | undefined
      }) => {
        if (!input) return Promise.reject(new Error('No input provided'))
        const ast = kclManager.ast
        const { nodeToEdit, selection, variableName } = input
        let pathToNode = nodeToEdit
        if (!(pathToNode && typeof pathToNode[1][0] === 'number')) {
          if (selection?.graphSelections[0].artifact) {
            const children = findAllChildrenAndOrderByPlaceInCode(
              selection?.graphSelections[0].artifact,
              kclManager.artifactGraph
            )
            const variable = getLastVariable(children, ast)
            if (!variable) {
              return Promise.reject(
                new Error("Couldn't find corresponding path to node")
              )
            }
            pathToNode = variable.pathToNode
          } else if (selection?.graphSelections[0].codeRef.pathToNode) {
            pathToNode = selection?.graphSelections[0].codeRef.pathToNode
          } else {
            return Promise.reject(
              new Error("Couldn't find corresponding path to node")
            )
          }
        }

        const returnEarly = true
        const geometryNode = getNodeFromPath<
          VariableDeclaration | ImportStatement | PipeExpression
        >(
          ast,
          pathToNode,
          ['VariableDeclaration', 'ImportStatement', 'PipeExpression'],
          returnEarly
        )
        if (err(geometryNode)) {
          return Promise.reject(
            new Error("Couldn't find corresponding path to node")
          )
        }

        let geometryName: string | undefined
        if (geometryNode.node.type === 'VariableDeclaration') {
          geometryName = geometryNode.node.declaration.id.name
        } else if (
          geometryNode.node.type === 'ImportStatement' &&
          geometryNode.node.selector.type === 'None' &&
          geometryNode.node.selector.alias
        ) {
          geometryName = geometryNode.node.selector.alias?.name
        } else {
          return Promise.reject(
            new Error("Couldn't find corresponding geometry")
          )
        }

        const result = addClone({
          ast,
          geometryName,
          variableName,
        })
        if (err(result)) {
          return Promise.reject(err(result))
        }

        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager,
            editorManager,
            codeManager,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),
    exportFromEngine: fromPromise(
      async ({}: { input?: ModelingCommandSchema['Export'] }) => {
        return undefined as Error | undefined
      }
    ),
    makeFromEngine: fromPromise(
      async ({}: {
        input?: {
          machineManager: MachineManager
        } & ModelingCommandSchema['Make']
      }) => {
        return undefined as Error | undefined
      }
    ),
    boolSubtractAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Boolean Subtract'] | undefined
      }) => {
        if (!input) {
          return new Error('No input provided')
        }
        const { target, tool } = input
        if (
          !target.graphSelections[0].artifact ||
          !tool.graphSelections[0].artifact
        ) {
          return new Error('No artifact in selections found')
        }
        await applySubtractFromTargetOperatorSelections(
          target.graphSelections[0],
          tool.graphSelections[0],
          {
            kclManager,
            codeManager,
            engineCommandManager,
            editorManager,
          }
        )
      }
    ),
    boolUnionAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Boolean Union'] | undefined
      }) => {
        if (!input) {
          return new Error('No input provided')
        }
        const { solids } = input
        if (!solids.graphSelections[0].artifact) {
          return new Error('No artifact in selections found')
        }
        await applyUnionFromTargetOperatorSelections(solids, {
          kclManager,
          codeManager,
          engineCommandManager,
          editorManager,
        })
      }
    ),
    boolIntersectAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Boolean Union'] | undefined
      }) => {
        if (!input) {
          return new Error('No input provided')
        }
        const { solids } = input
        if (!solids.graphSelections[0].artifact) {
          return new Error('No artifact in selections found')
        }
        await applyIntersectFromTargetOperatorSelections(solids, {
          kclManager,
          codeManager,
          engineCommandManager,
          editorManager,
        })
      }
    ),
    'reeval-node-paths': fromPromise(
      async ({
        input: { sketchDetails },
      }: {
        input: Pick<ModelingMachineContext, 'sketchDetails'>
      }) => {
        const errorMessage =
          'Unable to maintain sketch mode - code changes affected sketch references. Please re-enter.'
        if (!sketchDetails) {
          return Promise.reject(new Error(errorMessage))
        }

        // hasErrors is for parse errors, errors is for runtime errors
        if (kclManager.errors.length > 0 || kclManager.hasErrors()) {
          // if there's an error in the execution, we don't actually want to disable sketch mode
          // instead we'll give the user the chance to fix their error
          return {
            updatedEntryNodePath: sketchDetails.sketchEntryNodePath,
            updatedSketchNodePaths: sketchDetails.sketchNodePaths,
            updatedPlaneNodePath: sketchDetails.planeNodePath,
          }
        }

        const updatedPlaneNodePath = updatePathToNodesAfterEdit(
          kclManager._lastAst,
          kclManager.ast,
          sketchDetails.planeNodePath
        )

        if (err(updatedPlaneNodePath)) {
          return Promise.reject(new Error(errorMessage))
        }
        const maybePlaneArtifact = [...kclManager.artifactGraph.values()].find(
          (artifact) => {
            const codeRef = getFaceCodeRef(artifact)
            if (!codeRef) return false

            return (
              stringifyPathToNode(codeRef.pathToNode) ===
              stringifyPathToNode(updatedPlaneNodePath)
            )
          }
        )
        if (
          !maybePlaneArtifact ||
          (maybePlaneArtifact.type !== 'plane' &&
            maybePlaneArtifact.type !== 'startSketchOnFace')
        ) {
          return Promise.reject(new Error(errorMessage))
        }
        let planeArtifact: Artifact | undefined
        if (maybePlaneArtifact.type === 'plane') {
          planeArtifact = maybePlaneArtifact
        } else {
          const face = kclManager.artifactGraph.get(maybePlaneArtifact.faceId)
          if (face) {
            planeArtifact = face
          }
        }
        if (
          !planeArtifact ||
          (planeArtifact.type !== 'cap' &&
            planeArtifact.type !== 'wall' &&
            planeArtifact.type !== 'plane')
        ) {
          return Promise.reject(new Error(errorMessage))
        }

        const newPaths = getPathsFromPlaneArtifact(
          planeArtifact,
          kclManager.artifactGraph,
          kclManager.ast
        )

        return {
          updatedEntryNodePath: newPaths[0],
          updatedSketchNodePaths: newPaths,
          updatedPlaneNodePath,
        }
      }
    ),
  },
  // end actors
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANmEBmAHQBGAJwBWABwKpSqTQDsUsQBoQAT0QAmdQBYJYmmPVjDh4YsMKZAX2e60GHPgIBlMOwACWCwwck5uWgYkEBY2cJ5ogQRBNRkzOUsFOTFFGhNZQ10DBBkZCXU7Szl5KRMTWxNXd3QsPEI-QIBbVABXYKD2EnYwSN5Yji4E0CSUqSlDCQUTGRpZefV1GWF1IsQxbYkTOS0FDRo5dRpDKTkmkA9W7w6A8m5hvnZR6PH43hnU4QSVYWbYyMQKdQKRy7BDCfLSYTXQzHUQmJQuNz3Fpedr+AJ+KCdMC4QIAeQAbmAAE6YEh6WBfZisCbcP5COaKCTydQXHkydRwjYw44LSz2YQaWw5ex3B444jE4ZUl4kIlUkgBbhBEJhSaMmLM36JdlSSHmVbGZY5NLCBQw040CSImjKUrZFSy7FtAgAFVQUCgmDAAQwADMSD1MIEmLTcMHydg2AAjbA4dh6fU-SZs5LzNGHGgSmTzCG1Wow+SO11bMQmHKVRqYuVtCTYCBBggAURJ1KCAGt-OQABaZw3Z43JZFSQ5g4RqFSGZbImEVMqQyEQyFw+a3Jte-Ct9tgLs95WwAfsYdUKRRJlxcfTIQNcpQ23XflKeyFfSIUTTuQAXMcIXDIThSJ6ngtm2Hadh8VI9Bgo73qyE4iDQjqbLUpiFhYVgmDChhWJIjhXBcci2ks5EQY8UCHh2ABKYDkqgmCUkhLJTPwQiaOo5gXDcCiiMWVjCDCYilAoTrkTYPEVLU1E4nRx4+AA7mAYBMOxRqPsk1S8YWPK1vkyLGN+xTXPsBaLjYeQSiYAoKVBR4EAAMqgoafPQYxjihOmCIogJpFOciGDI1zbDCC6SC6qwmNstaKGijkHtBylDlgmBaQ+XG6SsEjGIWyy1FCKiiT+CCmtc5R5HFTibNs4F7pBKXOQAYqmQaebeBrIZxMzVI66EZLIlz1LYcgEascgSNUshzvYAFWMltGpcQQ6qqG1JZb5OVoZIGw4QKpphbaBGLtN8gSWK7qGMtSkEExioSEwJDqkSSoSOQVJgEMIxed8Pl9dxxYzaFhmmmoxx2uVYhSLaM2lksKiWOCd2rY9JLPa9qr+NSEiQBw21A8k1hrsYORQ3WhFlcUtY8ocSybCsqxfmjzmwSwVJdd5vU5oI1gLFktpw6UlyQmJNUzcWeShYYLrWI2zTNStznICQA5E3z1iSKc1oXLaArLuVoWw4s0nKPsRxQorWLK-dAAiITDNqQa6hE-13hxfNZJIIuXKUcKhXkBH2P+pr1EcpqXLYbMdj6YAfII7CoIIRAAIL25rE5iKbjjkdb6zHPh5WgdOs6gdYxyZBiSs0fdpKhqGwTRrGf3dVmO0zHO+ly+IYKODcMiRRKkiViPTgZIR6ix8eAASrR8FnfkDU6NDFlkxhzPMBEZINQ38bWMdNXXq0AApUqgnRMOwScpwT3MA7zqGIrxcx1POVSUZFxaAk4JhTTnWqNdbYn2cmnJgTAfrqgoG3HmXtn7nHKDnDY-cVj2B0MbTYklazyzrLhRqtdFKrR9NA2AtJhhL12hUQWyJixhXsnUBQGDij5FMIsWcJkAL9xngQeiqBBgUI9j1eBflNALFtCFCE5FNhxSkDCeoSwEZy0ImvAULoeFEEwNwWBj8RFULXlyfkPI4SgTyHIYuLC6y8SWHnSOFhSg8IAEKoBYj9XA+IehJnYOqMIlCZgVEBHFeQSwrHyBpnsIsfErR1A0OCLQTiXFBjIAEAAqrgPUQiO7E35vmLIglZYKPyGJCokksjmOyDUW0CTXHJIAJKnmCL4zJgMtbVC5JoGwctbJojEkoXi-9FxjUIrDGeEghxtjAKfVusACBpy5tgcMYQAhQHVEwIcAQWBMEjL9CAfjuK1EMXFVY1CLbhIqsiMwmhSqmFsJKG2zYWpBgkLAIcqAVJTLIHAWZ8zFmBBWSQNZAQwBX04JAPZuZ9JgnElCdCKx9Y7HKmoNh5w6jbGEFsZ0BCQGKR8BeYcxAyCUEwLiwcI5mlPx0rUKqaJRo8SuGkZhiA1DiRnNUP8aJuS7kIS2Ell4hwEEdp1YMwRCSKnBUsYikIbDorSGicEYlpzoRUJocidZBKmGnsfHFeL+WvAwECiAHAQw9CpG0fspLwU3E0DNOJLobg5A2BNcqKD2HAjhnMVY-I7q8uHBIH1Q5amq3VsKsAoqSQBEpPM8gJBMrkr0UkG4i5yiJSONYPIFQLFMoFGYOYORxL7HliMrVPKdV+p1YGjsasBzajDYEV5pqABebwY2WoyJJFQ9RLCDyRNDYocNER8TCjcI4xYjjetLf6itx4iDcFgN4kgeAAj1uwE2kkMaQyJkGDAy1NKnTHQ0KoS2jKECWl-ui2KjgKiWHHaSstpKp3EFnfOxdkbODRswBuudhKdGe20jlG4VxQYhK2FIsGIck3IPRYJc4FN7n7lov6u9fKH0ztwHO9Ui606OJ8AEAAGq22QQItBzDBhsKwva9gWGmgdE2WR-7iDEDevlSHhwoafRh9xWGcMAE0COlKjhKci1xjliTrGUCphZzH7CYXBu2iHJ3OVQ+hhd7iyCBh-cIv9Cb9ZcmqPUUQi5ERHAInkoEV7iyJXRJq7lB55PlsU+xlTAQgz4HYGS9uLSJxWsdGkeYGhTQQglGc0K6KlFgijrLbYTHfUKY7Ep597jIFUkgbgQ15BtnKkNV+7dcatNMriqKUw0tGEgjkTDOG01si1g5CFbIPJotDhYwGhzaGEtLtQI25tmBMB6ACDG7AUBcA7q2IcHBTDxIqChpFdV0g177BuABdBDWmtsdaxxiN1I30xp631nAg2CPRRdPZYxjh-4Ir7fyQJKMdweo2Mt2L07HOLtgLgAFARk54dbXFRY4kztXFqsZ42+agQTdOHgms937Nxae+4l7b2Pu8dy9lbT33Q4WaleYrYBFljYMRIRfkRwAL1Eh-elrynF1gAAI49HXS5qAbnW3GCBCsKwjqRZhUmsofKaqThLHsMAh5CGJ1Q8e2tpzL11TdeoEjzuTLyKOglLYOGxh+ICjOqBQ4hEQr8ndZsEnyGydte+t0SkLwYfsAZDL4mxUFgqFOFJkEmQCIqGnEwvIh85ymjhPr1jzk9XBnvsa01+BzV8tbda7Iyg7XZF5E64oSxHRogT5kLIVqffNeh2LxdKkODrNe0SCAEaY09A01knMAG1z8nznURQYSxKzXyvscQ7pcKMeLbZ4XpOOzDjU8GZOLFwWhVKDNQTiIQo53tPMLk2wLg4XEIJAX8GmsraPM8vEPQmA1qJCSGZEBtGtlwMxAca-2Ab8EOQHAipBBsAwNfnV1-Q3b4t2IS1lZdMQjllkQsNpIoWDMOJIseyUQMRYQdPKdE-AIDfLfRUXfffPAI-MAE-M-C-bAK-G-MAO-UlB-WtWAF-G8OBPLCqNISSQnBoWQZQOoTNCqKwR0LQbYQqMEbNazbFEtW9B7CAqAkVJ-GZakC+KkZ6chUMDrToJApgc-S-Eka-CZTAvlbA7gl-K3LWdCUGOGBWNFJwIeZ1cxc0awceZEEKZgwXZfNOFSBdOtDrFdLrT9LdSgAIPAIQggPfOMA-BAiQGAG+ZdVdQYTAQQew1AQfSPIEW5DQLceoY9YwS4J0UQHOGVNQwwpfRDEwsw9rTrNdD9LLGw4MPwh6KkPggQoYIQqkEQ9wwQTwrrXw3AIQgI8EJ0ZmObYsSuAiAWM2fIMsU4VPZbJIo1V9bAd9aw79Owyo1ARwuAw-VAY-Eono99CoqoxQicC5ajLQf+JGfYcEcI8QMwCiAUNleYRETo0w7ozbXo9dDIgY7I3gjrfI9gQo4o-wQQKYmNGY-wuYnSC5QEOJB1WwWwLIc7IwaoBYfkYsZXOGcjNvGzIXW9LowILjPDQYhwpwxA+A8YxAkokgJMWAQQPgJ4gIjIcwESdCCwdCZEY9HOKfeQfNK4CUHiW6dvCE5jKEgIGE3DOE4Yi4-gmMAo4Qtwu4tEjErEvwnExVNeNEEEmVCfGGOwV+OSISGwJhRfOTUtBkmE7jFkkY5wpEiYnk9EwQPQbEl4nKC5MocLPNKvKEUTFQcwPMOEVo2oWTOuRIg46E7DAIFU843Iy4jk64rk1E7U3UgU-UpIfQhXSwLXWGYwCEevA5JQWGNRGRPY2k4wx0vrfAIMVUhElw5E7km+NTIMPUjzClA0gCKsAUbWEEAAuPIwFYXiUwf+WoUCcSfWfY5InMrIoYnIvIz0m4rMwQFsvMgg5HP4kKfKTYAJVQ5BMyIwGbMKS4BPLcftToiBHbOnNzM3LPEkNUxEsY4-NOHwH0c-GHQQZc9zfs2XE9THIEDQUoL4wqM0mGKoRYAUJhOYJwU4Gk8E4wxc3rI81c8ndctkq4rsncvc14Ncw84kenY83RQgw0p0PkITOsqOAiUoSQIAgk3CQSKiBMh05IpLFLNLDLfomBNM0Y1wko3C4kfC2kKkQQU4mBPsqCgck9ZYQEKrMKOwdFEsBVAUaQJYUxeoI6bIJso1ci1LXogi2i2wt0jswQ70u4kSyi16Gizdb9ei39RixcEbVi2wISTi8rRwHinHGWASsElgjvW9FyPAPvRJAgHvfAKygfAMxAEdSSOyEUxKTYY9NQcQC8urOFI4KLLC0tCyuMd7RJCQepDgWZCAQvL9LmDZVAPAB+NS088xNQS074tIMKGPSKfzS0nOOwMpVohQZbYK+yzAcK9JdgAlGBWNfM+NSs+oaQR8iRAUHIQSHKi0oOAAjYeKTQEqyy0KliCQXAYQmNYgLRfoc8C1RyhAKrSQCwS4KDcfKgvMdtOWA+ZC1q-qkK-vcq9qdJF5DZC+UMVMY8dMjUxA5uZAiQm+dAmQ4cOQmA9QcFOVAEkxF0AnI4Ty740GCbcEM4a4eIhU8yga3aiQfaxMdZJgY6069sj0mSoo0Q8Q1AyQu6qa2Qrgp68FXeYicxOcK4LQBlSKUqGcOcDlGguwN80yuk31CKqqy1ZXaQZYAafJCOCsiqeYMoYCfNUQSTYqwK29Omgga8Oqwgvzf-UWGDeYGwFa8g8wILLtGTILZbH0XvEkbAddV6cgUKmy9aOywa2qk84mArC6fWJVTYSeSKZi8oDYwE8Sa4QSgW5jVWuy9WzWqkbW5OCqyK1DTgXAEvIFPgTdM1aG9yU67G8EQEC5L6uUiECjCqciacBqKxFQKFEKFWtWzgd2z21AYa0azAca1gYVHVbG+jafVVC2gkla0waaQzK1UKYyG4DO12rOj9LW0K8GvASGo6sOjsc6rcy6-wa6lG266Q9Gh6zGnfYQF6pwQEL3a2OKcpYeC4cwBPZBWvVGJ231F2mAN2tuj2juiGw60Ok6jsf8zsrkq6sQlAtAse+-Sei3aemakKLQQ4XYgCSuHkeO-tf-BfC0EKa4JwZbHoVLVAAYV6dgf1UkXADcjM7c3cwQEBvfa-QYLmKBobGakQEGa4LCZY5EUwMrFhY4JBEDLXFGL1LexrRiMIFsg23W3vA2l6+oI0gw6USsYsJCwjewGTZVYaeyZbahrddTA2iQKEs1RpbgQvV4KkOMKkAgI+9Zb6GhlM0vTzHSbICUH7NeaoAOTKhVF0bnIKHIF0REHOAR0IIR1MsGsRkPCwqAPAGynAcgPsQYoISgOMCOyIphQSNEVYQsU6Y2GFcobWactQHBkyowxDQR2hsGhRyAAIaJlR2Bi6pGm+1Gu+rAh+y3UWxixeySMKOmWWamdm3CMofISgq9WsVY8x5R4RsGkgaKs1CAdUDyAIJRyxs6kizM5uRBsQ5pkgDyQQdplsiOuwM2IKdeOcW82mFmJ0OO0QInHBO07VW9RJupsKhpw1EPfp1p4ZpJ8+hGkQnps-HZm+PZ9TF60EfKMxarUCOoEzM0SwehWGIuYwZbIgRUXsNZqx6y2ymARhmasTacL+584qPGyafS00VKsJkKNEZZ1g5jD508BJixmJsKmxqAM3GR6keRruw69xpUNp1FlR0ugxusfTAhq1eO8aMwHB2QcEVBIG+00tJFwl75sq0Rx0s1OxhxtOaKl4T55Uc51MnljBnJlK+22opYZQUwEeI2cyc4cTQiPnEDd1d5wVlF2pn5oauJwvVlr54l9TZJge1Jm6qQ2-ceocR6nfQwS55YZNNeZlf+WFgiBaoEUQbYQnZm0AyhiQfV5UdlkRzZkMFpwIAl3sYVzp9Uk145vp0N8-QVoZw1oMCOsKc0YCeoPzc4dmh2kg+25VKEC4eFsyxFjVwN+p-l05gV5FyNuG9kw5k-Xpmi+N8N6iyNy561OaEx6OeKTnXifuEJvMOoCJhI0tC-NxIIchKNzc1w76JiR4ka2-F6NzbJo28vZvZnWI+qBu7+9CTYxu2sdFcUfm98xDcd5JMhX6OtgCrkud8kBdloQQZdocVdhi08kQULEc8prQdNOwYUbQ+yKFMEWRDY957gHokPD7fPeJ+9zAEvY11wkgOdeLDjAAORxggAADVi9VGCzAy205miwFweQNB69Ii-HpaYzrgx1fXUMIPMWoOMOi84PjwDnOTEakP2AUOVN0OC9sOWOAiLS6to45tPUzl9hshZsbQJQP8zEhKw2YciWTdgwQLfyLcEPMzkHVOEsk3lP9y1ykrNN1KMh+3z1QpBJxIXRnd6YLhZ7-NgRFx5Ofy2syi0iesNPj8tODzXPvCetqjppKoP66hQJqhl6Fhjg+QSOJOwQnPtP1sHjus9APPECvPQKEu-OZqLlBZthGYrYbJfiKoSPG84RLBzgvimFYvFOfPttet+tBtkuJBUvfzSiLCvCauey9sxW135iQpARHXpb7BVgKtps2kQXjgRIVg7BKu1yNso0avdsBsYH+7XCmudP0vdS6uuu33iZkQDH6VDZ00TH2bZAAImqDYqyP6gHfWGS4unM4dN8PtcMGvVuONr9XsxDk5MTqjaXc0as6FCxXWsguQ9YbRSZMLT3FSkzbvnt3vQqXTnuU5ofcA3uAVb4dSAj-4gQGEKJlg0FgtjtpA2qcI1BzgZRruofFOqcacP0jyEf9PmuqfHijyAjkQZoq75Bh3YZJpRBp9ynCIwiyNpvfyNlsYpcC7lvNPEeDyJdttpdxWdvzEFg0RlXCwrgpQCuMqgQMgVg8wC0T3qbl8iA9b-m-QWI7Cm5hbAX8Hqosv9NsgJzzk5ZFh5xOaVcyeIfb0jeGHTeP0FkZkRbuudJ6gV7o5Fe7ebBIpwznehvZZjEuUDfEMvf9affzf-fDB5ecxg-qzSII47B7ff9LIo8SNpzyJ4-ImWXjfgwU+-fhaxAM+Jws+bew+8+I-EVfto-i+3ey-R3PfK+Ahq+LeqATB6+g-rfQ-c-0EHfaghyi-Xe4-3m++B--e5AR+cpG-x-FwW+p+q4O+5-S+R3gbEXF-ElU-hbhBV+kh1+c-N-J-Ip85d-Y-9+F-veT+a+qB1AL+nLiSuRU8AJCIwmCuyuEgjYltCe5vG+vcvr3xf5m83+CgT-ggGD6jxf+4+AAZFDEQMxmGloFmO82wAe1tWBdP5mVReoTZk0MieQETmOD15CwNtcgsoAkRXcPeiLXAeOxEYYtNQpqexjAz5ZSNmBIrDgXgAjqKI6w7qKsumiyD154Y-OMEDaFOzd9D+vqIgLwI5ZsD6IDTbAH0FxYHV1k5AJQaXVxKf5jIYUc4KsF6RT4eQHaK2OcGsA4C8BHLXVgEEUG2CGuV9ZGrfQtb31H8MBEwJc1O4CgVgFnK2KIF6TUCwmi4GDCOXiS0clBQbRpts1DYvAlBzgu4icxba6Dn678RvFcG1hKBlAhDCJJsDMw5xxuemD0FENsExCtmmLKtjoKcFscvSiNWNs2wGY3wah47GejcCdB1BhkjdcQPXkURQgkYAGU4FCmf7J8wqsAGMBwD9qYtLWGybAJAmcGTDbq9+JgPMIwILJBAcYSAGCky4FUCwRifHBkFYTCgNcs0cQHaiMzu8E+FfaAeVQmFphphoeYcHMIWF1Cuy9wjgPdStarDIEvhUMJsPUgYBdkM1SqChVhhwgIQ0od3MKAOAv0wYEIGDNUFGEm9xhQ9TfLMMKJ0MJex+FwWk1HruDMmngnfOCnsTzVUUVGcaLVnkQDpMqNwOaKcCRTIiq+qI0-OiJ1QBBMRu1a9hfQaFojXB6TAkRjSJEW4SRYTV1AegFh2AqCVWaQPg0vRfgF8NglgW5jnbxVEqdDQgQC3gFdCdYJYJhKZDozyJ2+IGaMpYBQRU1IBTA8oSqPUhqjw01jLliHhOpUg50doqqtwI5G4DXRLARKtjUcAoU7cqxE7nOHkTnQzMpoKwBEWQRKirGQ4VUT6PtHotHRMw0IJIzdFRUYqqY1LG6L9Fwh8o-aMmpWC57lQ6wlgJqqnXt4nAfWjAhQdEJtHBgExgQCtpUJDbNCEh1ouMbaMbFJCb4KQ5oefiUFJxOxGBRsRHQMSVxVE1eeoPInyA+ZLsdZCeDGL7zDi3RrA5Me9nGRUhC83YhRu2OVErjRxz9YwIEibz441AcUHkPIhjxcgrBI6BhKaCXEbj4xCVRMTqzxbpQeBHY58YlR7HD03BGBS1tawtxyAfB00IAo+WHS14rxNRBRIiG7i5BkQnRA+lyM1G7UmG9gBGPxBMZVN2aKIQEJcEJrDQQSiE67shKTFmFxGqDaMC+PdH8tYq1E30UeI2BOgbAqVM0bYE0IsJuQP-UEg2UPZISc6Q1NgZiNaGplW2jjXoi42ezuNcO9VWajYFdyBZEoaxeVogG17-4rU1gPMCEQEmsDYhVQ+IVrR7FNtTmPZD2hHVzirhrAV6BhLhJdwzRagpERmOCHqykTBJ5VNgRRTThJNdxWtCOiH0-AMiYM7VcqDHjMBPlwsQcEDLpNibvizURk7EYPVZH8j8RAEjwTgQUAvVNAZTaVoRHM6hxhQpJVepv3+KdImWKzekshIPE0SNRffNCYC0YT5QKI6qY4MqmFAbxdMXlFySFmLY01GscyT2tVPVEOiKJIeeiemI9HjTDx8A7IPCAAbmJJQJHPIbNWzSE9DIhJMiFiktG+oBpT4rsTVJGkTAnRHWPcWJMFYSTnGrjWADJP8nRR-KJ0NYIRHalmg6MppY7H1Tcl7SGxB09FvpNbGtN269Y9MYlMbZ9jBmWtIcXOyfY0S-RGuc4FvCOBTxQIJwjXOQUkwkdIQvU4wlVO-GviPJ64tzLgO3E0TNB3dPyc-U6QsTbQVwcEOYmsAwg5wNgF8K1L6SK85BzLSEjjP2nDTyJR0hjpuOJk-jNERdJ4ZBWSrEwwpDk8gtrg2ChQGZrEoEEjAKbUxlgMUoaXjM7paD4pHtX8dfTNZo10p3BGQJczSBmYvwrU+wNOPKie5AoFoVqiFgCo1j+pXM76TzLfFaCe6p9adnAySl-iBRaUwkTgTUAdszAYIJQAegUmbAGZoUYFpvGWA3ISJTsgICNQ5EkBKAvgHUIEDDARgowGyVuOChSDyAZoidAAovWo4hwo68UACH-3WD7A7oZAbAJ0CGBmoPsHJOMA1wblNzhgaPRZLJMIJohAoqQY6L5nJIhxqyvVHcLDEKj1z0kXcluWAzbmsd3S9bdjiIU7m-Qe5acvuYxR3BNTjsusKEGkDVwwx+QLEroeQU3hTcEy68x4R9gTjB0xpOqDubPI3mfdLWM9QedoyL7kQj2DMgdHkHhnKJJE5wGeY3ObmQcwG98udOIyflvCuSN8jAm-JLqYNgChwS4PNhGhzhFADMsEFr3JiklUqEIO6OAhjB6AzUCcbxAhG9kpMKF8EDAGnDnQeASRkkKoKYzpkKxOJRgBWZ-kDhaBoW7MxSCQp6zkK4IVC7kQ21oVUKGF7AJhTNRqKsKtcx2WsJwpPTggzAwIGwDWH4XELPyZqb6MxFYjUKTW+iliJSGkWyL4BpodhGouAL-wiS2Ck+QUIJIZBwR50LaUviEVkKQ8JiwxeItXkSAfFZixhegEtSSRS+ZGc8bIA+pnIBkZQK4B-kFBXAXQB-OuJ4u5aNxm4ecz5A13chNx-AHyOMOYpCVyL9owfACG7glRaA7+XOSPMyjarbBE5BvNJbYwyV4hF5fi+oSIVyXNwClYAIpcCPgG1g36w7WwJoAAVFJEUiIacKxJGh0wXF5UlsM0sxbpQcAfABrisuwB8B+lM9GgX4LFDMNTA2OCEPlATzkkNgcqHRaQrNQbK1lcCxGjcu2WAtJIR0PZZbDBhUE3iisuOpelMAVcEySyoIGpA0jOCgVTAR5dqPmrZppEWwI4COmdx5ApOyIdBMCAEWLLdFY00FR0veGgrwVgfNfuorlT5Um8UMcsMbDrLmBjSSuYApcuEUh4tEHkBrvSvYC4rtuOYFemvBVnSC9MTCNAVzj8ZJ5TG82eUqkvRWYsmVWKrkkypZXiycw3lVqn40VZhko5iKa2D-yCwhYihoUGlV4pmErLxeXTHEXqulVGcUqlyDtC82ILDRh4TihaMjCKEVAUlgi0VUED1USqGhRq4JQMrxVJA2ki9TCPyElJN40BhEGcDyAVihRUVB4AFafU6gNcY1-gY1WXgnCndqw5gwCNlLijfwi5FoWQP-FWKHztVZqeNVVTuUiFi1iatRjlHIgzhJsg8DRuvA+V5BpwbxJmHmrySFqQ8PeToJtDkYgyu1PaitXhwiTlBySygPTANG2JnRbA+UTfuiBMhHYO1mLftTi1LWfR1o3a6kIOrklWBDgDS3IHTAhClAzoGEiMQNELAbwr575GXu9DxhfQfo0wjuWEA9LYwb1-BO9b9EHwAkA4OOPGoqyFASk4YToRcB2llSVgFlB4a9bjDfXfRwFhAVdWnOTjskX1UGz6DBsETwCQ1DUVKlwnIxsouKg0CEMsVsgRdHVLYSDR9HvjegQZCG59W9BQ33xKEtMKmDbUPXDoaZl4nKCyliRvgx180SuHdHI14xKN3geDU+qQ10aKNhqQzkmp0hcbdCAwm4HxpyCiYmZj5TCAtKniRraIAK8+JfGvho974zgzxJ0E+Gh0QUggBjXIuy5vwlAsKqPIALqjlA4osMUWNUHKSLqAgum8zZ90M2rrYAxm0zRfHM2WbBlkgKrKRDzg5c5ZiKKFIsGUA8MlUnNDzYKlxguwLGkwZ7k7DAB+BXY8QLdYQUEBVh0Ui0CrDSjChOAQ4cwYuUwk0CuUm6-y51SludjBBctGW1dZ4Fxg5b0t3AfLYxUK2LBit7oS2YescAqLJSiqRQFYDhg1R6t75AFQCkgTYwYEHciBFAm-S9bTygG+YDHMm1IxRlTRLnIHH-hBQI4pGqNc6oW1rblt8G1bUtsoAbbrcc9DiQJDUXbaNeSMJmmEJO3WQPN86NDFOwa5-bL2wwB7TmCqhiJLAViItiNAd75Ai5CUcMsitm1NLnVQOgHaurR2-RQdPXGcH4xhUnQ-8BXcpv-irjWToyjnBrVcu8X8Ir2IMi+AIj6WeqXq4iUCAiN0Kz4A4oYwSIrOUS2atJ4G7Tc6vp1XtV1wukHUzpBGhzykACmwLDHBDXAjRNRUmFCG2KMEtNojZ1Rfm0QNctdhSiXYMoC7YaUEWgYTFQSODUDPwFWTmvkAgEeLNdWiduaut12M6ZFxSg3YsEqBqLXQpjM3fkEBDzR8qBmahHdA5gdYH1IMhOJzHYCtQgt3YTgdvM21lAP8WwOrMLC+pUEFqc9DRkBEpoFMQ9fAKPd6FXWR6w9Mey+HHssqD5HQ5iQDjClSrAEJYFgJmhJAvH2otgd0KtFRoNWIEm5A4MvZ0Ar0eNMuKFQEj+y2AqBYYy0oOM8t+XnAJ4EcjverCL3Lyb2iNXvWAH72D6E9O3HNOik2AO1R8w6JCqdwtCEa8carBMs4hqSw5PE86XUN4BBlJhEkPgW-T4mZX67vVw64SF0lBCbxJsYkGTiPh8bKB9C4gO6FfqSQ36vEb+5fdJX8VP6WIL+6Awhux3qNq9Ec2RLOqUAAHq1dZclrOA-rViDeEBidiAz5kNcEDmANJJMFQMGlm1mbTTccB-kARikNRRmQTTAiERwDiSUg5VVgPw14DiSagz1o-2sqvMpSBKJJlKBhRuQxSU4M73QUbAQSdcy-TweSSJVqQjScPd3okCUH6kSoLQ7QYTS24ieaKDtIoHEEwxSw7rMfLkOzS1huD1+wYgYfS0iaV9PIkQnoYaQWMjDiAMoDLX569xpY61MSD-Gd7iBJ5JfTVJiEXZwBeAguT-ckB14Ih+Qa8GFUHCoIpBVgxcl0BKnPTSZbddsVKIkf5g0ibQxyb4nQQrDKEB45NcOA4FGTjIMAvS+AGIb8iRI5s0KLpHCl3ZDLIQtQfnEiEWqjIXkbyFoyUZkg21YYY66VBUGO5+YpI74WcvZAuANZEjCM5vSzSMznQYQKQdRW2gto1gOQpQp2SviDDrH45eJUoKkGzb-q+0SxfMcogAyicLRPfZjOwUyWcFhRrRmVV5nKRXHpYcKXkJH3B3PlrAlERmOrrsxd5LqMk1sSpE4gyb-0-sN+qoVmiLgLOv+Feq+VVTcNQIl664WwRFzPJ780aZHiNRvhJgMC-TBE+sd5ozRNAm4SREZitqhQCwpgFzZKHTrk9ki1XdIspSIp+FEjwmUUBVhLL-ErUTROsNIAsO2l+Q82Jzgl0IqSUhiwpjkEgkToCRyY9gEOMoRq3FaG624JzkyRZJqmxm3DCoNhDoxwgxIjgBYAVCHwhJioxp50q6VVNtG6DYzc8fSi-zAQSmfukHFWSpQcVhVFUnaUmVoZCmPTgZTmtc1VS2l45ObLIFzSIjoo6wB8KE4qU-LOZwKK5JHuwDNOjxMI8+bhtvGNgVxV4RZADDyGc1Od5KYlKisqdbJCFhTa8R0JGK8qRxjtCqJmXNVXDgCiD20xrKVQNqJH7IiifHR9RrLZAKwTCZ3oAkHhhk6w21DlnTTHOzglEaZ8blUcRQaAo6FnOwNyE5qDm3jvqEc2DRGpFEY0iRonLxCMgfhykAWY7ouGrIwpHcGQa0iuZEa7iT6p1Mc7PTCxwwoQXSVSeckUSyyeQemUbWdr6ne0Cz0ZplNpTNj+x-VaIciDlVNhWS6ZC2L3M3V3qt0+sZE-8-mHnqDJLZx3YdgNvaJYRS4jswk87Uzoa196OdOC+uaLlK56UQWBkcd3dDy0PK8u+yA4d9Y71FQTFwiyxcvNNzMAN56oJIEVzDs6oFsNATkCkhVZfGViCoHhdEvZ1D674z2X+YQsICA4N4gnPLnpFoCp8-KkiFPGsG+skGYDeieg2FOTwXwMKmqHmlJXFAjEI+MTDXrK5KAamHTUc4ZdkQ+Z+eq4KUDqeNj2BeIRwiI0dmEFYyomybZQeuIkbZjpGsjG80N3dbfFZZIXB3pPp8xMFUjKwI+YFbRZCT1xordc4okcBKAb+Yy4LDXQvIMIToyxP5acfLZhV7B7LdcxhJZg-EbdLuBVCDHyQxlJsFTCqyowqFNN4hkbdc5yDZQOoJE43B5u2f8r-ElDzNdVsi26ssQxzEoYFtrydZlcVqTgBXMmY5B5A0gu1tlilbXGjSl1HWLK4ZbbRR0ptQZtIAD2NiGZi5eOEEIbEzOe8y2D1w6Y8JqtvXYUTUmrTVFmjf0PwPFRXCBhHS2XTj-rTVkFdilaD4mGNvqyFYDUMxNAVMMxH+yBzg6bE+JxVt4zusGstWHLYNtUI1YLWCbFQIm15WRiZt4VmxcbJCGIK3IBdy+c9rDinbrGKkWPc6IWC8qDJqj6QcnZImo5gHaO4HI4hAuTlMdYOJeVs3lHxLSQUEKesjtOFUJxRtg1k1RELyNzApUApufMz8ZNU7cQiaCgoB2mEw8qyV3le3IticBIqrhQ5zlskSR4pFLCbnYoL8deKO37IztmxGoAjKTLMeNZD6kEg0UW34uRxd9D1lbPMTI7Q6aO-LDQH5hEQ7RUZa1JyAp2nMfJnbJt0zv9JspRbQu-cxVX2Qf+cUOxZRCrxl2X0ad+blXcMtyws7td2VqdjrDfxpTeamIhvDEQwXEyAdxTvdzh64Ztb7Zr+v7DrCK5XWbCZXIwihaOsO7sOWHgjkXvmBl7wpAtA7xfNlBp+toVe3VFDMItwzM9mbozxp65mhw1dp29yAKwhJJo+YayAvkU1lJd7IvSXEGGku93cj5QWQDUEoIUwc2ERYcoZDUQ-FgbR-W4anzHOEkj7zm5YLFEOWIoTdb9fiNNv0wnH6LtY60YkkOsaAba-gjYgFHE6sIZoSeDRnYHEiPjwb3LfgYicrU+rJQN4sU8VqhZUDpoeQBEXpB-aQg2HvMx4aoMNR9AbzeYIDZ2kJrBJxONZ6QGVe8bvh0Ukj92ZDVxtKDsrpsfuDg0kSVRek1ax1ovTlYMYdH5VTZnNbbGiSwA2V1+mEP8YdIgkABsZnLBc1gsGErx+QY1iT4oiDrYDuoANrWDFh6r7RCWEryKgGEkQoEW+yWwUHH8hqHw9gI8NmE-DnHYDtNoJEid6jlA8iSIjnDBC2QD96wJkf3xZGcF2RnIih73b0jmBUUxgK8n-zN00j4n9IvxoLcT51j1ZTYxp2HbX5Uk0F6hSCRVpLFWD8ou8b61-RbtsPBnj1vmZ6JdEMSSQ-VsuHzgkQLVotLCNYA61V5zAtgXBsofuNxlDOqrT17UCBUFmbOCbknVPPvtEBMIorLCIOE1NtDzZjkdFv244IufcyNZ9juIY44GeXP1zgGSHddikQBMWE4kMoA0BUSLYrAyT2CwC9jGXOVnt8gWW6OyuAY+F4puaOJGgmBQ845iPpOhBPOBO-W4LoF1c72rvj4mTjr6Xi4JtQuPcMRfWLDu7iLBsHe+0nsTk+m7VDr1qOFlCE0UYVlpIpftnDFnHzgaUMUqR5RIgZsuRnl-aWANoaKk8VcoF7B2BNUK+YBIWQJV9c9WciTohrbdc07xijymrEU24UPeS3BCQa9L501x5L+lVsta-5uc5eWuOnBBu8dFEGUxligQZOaR91-7dWdeSVG656wGfJmPy4frxQXrknrlgu4a6+DSNwo21nkB-zbCS2TMvQgNXcJ8urkDbo3A6VCjHMyqYNKxciuQrcE4HuHKlSA0VFKLmcOdBKSmhr0wr5Z+w7GlUS1X9tzPkFBBxnYqUS4ZaeRFPlXkwirEpKH2-rfKvjpyoFl1a4Jt5jZZ0-OxVsHbfAXZnvl1quCGrdhnnZdb+l3pJbFeuXZw7pE5fzjp8vHARmNqvyBOEprgL5namOoiXeXuB3-MomXe+4dqTZmzKaoAU8I1UEZO+EhjH+GtgfTTju0oGY2O-NxSQ83r9l4EnWAysOV4pYoFM0dCDJJQtAoV4h9vcofsb3dX8+ccw9v1KgwEEA+zVg9SsLIGgeyI4AazJywGvckoyZCiIUuE5TzEkrgowo2QX60hxpUYRvnzyslcYRI8ctMZTLr7+wJ6dFbAnSCNKKe2VqArnlq2oFWTnVIkYKEyJFs3z07HDAZnc7bk0tCd5ELm3OrJFGAEo3gjVXYRw3YmV1vaw0a5Dv8igQWwCsCW5P1XQgGJPA60CMnBIM+dmq3YLBnYVexW-z86u6VtLW4zn6tTXUPn+Z6CK1XIIcAyBMHxAEIinfZ6p3LKF4znkNRYdRdRbZSObIArM6uQ4RmKyOowgCtgCgqKv-uy2D-KrIeeyVZJGmQZA2LYDKdtKsVe5HgvBfkgZ2GU3LA55gDVPfaLcGbFhZtno4S0UbzqpdUZRnPVDusqc7VSCR1Uw8bnWxS-AGxx8aLjXaV89FS5JvI71CM6x4rbbymESxtWWLXgVKpR2vKewCuXVUhnPlkKL9ZCOFjqp1SvI6yKEgs-ur1yGpUM5+Hzvwgo5q-UQV1hjhPHy0gk7jZCxmCboN96toGl+nBI-M2EqVH7aaZkFV1NAyKwOrrx-4wpNhPwy4IEjiHA4dpPtVDJBU0LA1NFmGn65JK9jfPNQW-TT5qk1E+baKqOEFMxCjTZcFv2KUAVVKCrBktWWtLW7C4dDrpveYt8DbhN2RiNeUzByRwqoxDQPNl2u7UF4e9+RUULTp5vPnyRn3dYHuxQHpm2ILrNvLc0hKLeZ-BcHyoj5M9EnkR0iKV1WPpKiha926bvYuq3-e5C9pV7E-abKdmjN31WkbUd1Xol5u-O7nPVi3XKml5C0IZxucefDFBwSl2Eyoe+ZPgGc-2sNAuQc+VvFrCxPnltpaX1-ULCL6+wTPqbyz-hB2dw5TB1QJw3-xXILghpRZ6oacP+bkD9+qABL6R+pUYyUKAA4Bi0nsfB4EiLGSQeSRkHphtf8RDHZMYmOQjMMS05rjSBto5g2U6l3XB3-uINDLo1w-P99+chwR5ulXcCHMc6wFE7RZisoFcBXAIAA */
  id: 'Modeling',

  context: ({ input }) => ({
    ...modelingMachineDefaultContext,
    ...input,
  }),

  states: {
    idle: {
      on: {
        'Enter sketch': [
          {
            target: 'animating to existing sketch',
            guard: 'Selection is on face',
          },
          'Sketch no face',
        ],

        Extrude: {
          target: 'Applying extrude',
          reenter: true,
        },

        Revolve: {
          target: 'Applying revolve',
          reenter: true,
        },

        Sweep: {
          target: 'Applying sweep',
          reenter: true,
        },

        Loft: {
          target: 'Applying loft',
          reenter: true,
        },

        Shell: {
          target: 'Applying shell',
          reenter: true,
        },

        Fillet: {
          target: 'Applying fillet',
          reenter: true,
        },

        Chamfer: {
          target: 'Applying chamfer',
          reenter: true,
        },

        'event.parameter.create': {
          target: '#Modeling.parameter.creating',
        },

        'event.parameter.edit': {
          target: '#Modeling.parameter.editing',
        },

        Export: {
          target: 'Exporting',
          guard: 'Has exportable geometry',
        },

        Make: {
          target: 'Making',
          guard: 'Has exportable geometry',
        },

        'Delete selection': {
          target: 'Applying Delete selection',
          guard: 'has valid selection for deletion',
          reenter: true,
        },

        'Text-to-CAD': {
          target: 'idle',
          reenter: false,
          actions: ['Submit to Text-to-CAD API'],
        },

        'Offset plane': {
          target: 'Applying offset plane',
          reenter: true,
        },

        Helix: {
          target: 'Applying helix',
          reenter: true,
        },

        'Prompt-to-edit': 'Applying Prompt-to-edit',

        Appearance: {
          target: 'Applying appearance',
          reenter: true,
        },

        Translate: {
          target: 'Applying translate',
          reenter: true,
        },

        Rotate: {
          target: 'Applying rotate',
          reenter: true,
        },

        Clone: {
          target: 'Applying clone',
          reenter: true,
        },

        'Boolean Subtract': 'Boolean subtracting',
        'Boolean Union': 'Boolean uniting',
        'Boolean Intersect': 'Boolean intersecting',
      },

      entry: 'reset client scene mouse handlers',

      states: {
        hidePlanes: {
          on: {
            'Artifact graph populated': {
              target: 'showPlanes',
              guard: 'no kcl errors',
            },
          },

          entry: 'hide default planes',
        },

        showPlanes: {
          on: {
            'Artifact graph emptied': 'hidePlanes',
          },

          entry: ['show default planes', 'set selection filter to curves only'],
          description: `We want to disable selections and hover highlights here, because users can't do anything with that information until they actually add something to the scene. The planes are just for orientation here.`,
          exit: 'set selection filter to defaults',
        },
      },

      initial: 'hidePlanes',
    },

    Sketch: {
      states: {
        SketchIdle: {
          on: {
            'Make segment vertical': {
              guard: 'Can make selection vertical',
              target: 'Await constrain vertically',
            },

            'Make segment horizontal': {
              guard: 'Can make selection horizontal',
              target: 'Await constrain horizontally',
            },

            'Constrain horizontal distance': {
              target: 'Await horizontal distance info',
              guard: 'Can constrain horizontal distance',
            },

            'Constrain vertical distance': {
              target: 'Await vertical distance info',
              guard: 'Can constrain vertical distance',
            },

            'Constrain ABS X': {
              target: 'Await ABS X info',
              guard: 'Can constrain ABS X',
            },

            'Constrain ABS Y': {
              target: 'Await ABS Y info',
              guard: 'Can constrain ABS Y',
            },

            'Constrain angle': {
              target: 'Await angle info',
              guard: 'Can constrain angle',
            },

            'Constrain length': {
              target: 'Apply length constraint',
              guard: 'Can constrain length',
            },

            'Constrain perpendicular distance': {
              target: 'Await perpendicular distance info',
              guard: 'Can constrain perpendicular distance',
            },

            'Constrain horizontally align': {
              guard: 'Can constrain horizontally align',
              target: 'Await constrain horizontally align',
            },

            'Constrain vertically align': {
              guard: 'Can constrain vertically align',
              target: 'Await constrain vertically align',
            },

            'Constrain snap to X': {
              guard: 'Can constrain snap to X',
              target: 'Await constrain snap to X',
            },

            'Constrain snap to Y': {
              guard: 'Can constrain snap to Y',
              target: 'Await constrain snap to Y',
            },

            'Constrain equal length': {
              guard: 'Can constrain equal length',
              target: 'Await constrain equal length',
            },

            'Constrain parallel': {
              target: 'Await constrain parallel',
              guard: 'Can constrain parallel',
            },

            'Constrain remove constraints': {
              guard: 'Can constrain remove constraints',
              target: 'Await constrain remove constraints',
            },

            'code edit during sketch': 'clean slate',

            'Constrain with named value': {
              target: 'Converting to named value',
              guard: 'Can convert to named value',
            },

            'change tool': {
              target: 'Change Tool',
              reenter: true,
            },
          },

          states: {
            'set up segments': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments3',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
                onDone: [
                  {
                    target: 'scene drawn',
                    guard: 'is-error-free',
                  },
                  {
                    target: 'sketch-can-not-be-drawn',
                    reenter: true,
                  },
                ],
                onError: {
                  target: '#Modeling.idle',
                  reenter: true,
                },
              },
            },

            'scene drawn': {},
            'sketch-can-not-be-drawn': {
              entry: 'show sketch error toast',
              exit: 'remove sketch error toast',
            },
          },

          initial: 'set up segments',
        },

        'Await horizontal distance info': {
          invoke: {
            src: 'Get horizontal info',
            id: 'get-horizontal-info',
            input: ({ context: { selectionRanges, sketchDetails } }) => ({
              selectionRanges,
              sketchDetails,
            }),
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
            input: ({ context: { selectionRanges, sketchDetails } }) => ({
              selectionRanges,
              sketchDetails,
            }),
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
            input: ({ context: { selectionRanges, sketchDetails } }) => ({
              selectionRanges,
              sketchDetails,
            }),
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
            input: ({ context: { selectionRanges, sketchDetails } }) => ({
              selectionRanges,
              sketchDetails,
            }),
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
            input: ({ context: { selectionRanges, sketchDetails } }) => ({
              selectionRanges,
              sketchDetails,
            }),
            onDone: {
              target: 'SketchIdle',
              actions: 'Set selection',
            },
            onError: 'SketchIdle',
          },
        },

        'Apply length constraint': {
          invoke: {
            src: 'astConstrainLength',
            id: 'AST-constrain-length',
            input: ({ context: { selectionRanges, sketchDetails }, event }) => {
              const data =
                event.type === 'Constrain length' ? event.data : undefined
              return {
                selectionRanges,
                sketchDetails,
                lengthValue: data?.length,
              }
            },
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
            input: ({ context: { selectionRanges, sketchDetails } }) => ({
              selectionRanges,
              sketchDetails,
            }),
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
              entry: 'setup noPoints onClick listener',

              on: {
                'Add start point': {
                  target: 'normal',
                  actions: 'set up draft line',
                },

                Cancel: '#Modeling.Sketch.undo startSketchOn',
              },

              exit: 'remove draft entities',
            },

            normal: {
              on: {
                'Close sketch': {
                  target: 'Finish profile',
                  reenter: true,
                },
              },
            },

            'Finish profile': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments7',
                onDone: 'Init',
                onError: 'Init',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },
          },

          initial: 'Init',

          on: {
            'change tool': {
              target: 'Change Tool',
              reenter: true,
            },
          },
        },

        Init: {
          always: [
            {
              target: 'SketchIdle',
              guard: 'is editing existing sketch',
            },
            'Line tool',
          ],
        },

        'Tangential arc to': {
          on: {
            'change tool': {
              target: 'Change Tool',
              reenter: true,
            },
          },

          states: {
            Init: {
              on: {
                'Continue existing profile': {
                  target: 'normal',
                  actions: 'set up draft arc',
                },
              },

              entry: 'setup noPoints onClick listener',
              exit: 'remove draft entities',
            },

            normal: {
              on: {
                'Close sketch': {
                  target: 'Finish profile',
                  reenter: true,
                },
              },
            },

            'Finish profile': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments6',
                onDone: 'Init',
                onError: 'Init',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },
          },

          initial: 'Init',
        },

        'undo startSketchOn': {
          invoke: {
            src: 'AST-undo-startSketchOn',
            id: 'AST-undo-startSketchOn',
            input: ({ context: { sketchDetails } }) => ({ sketchDetails }),
            onDone: {
              target: '#Modeling.idle',
              actions: 'enter modeling mode',
              reenter: true,
            },
          },
        },

        'Rectangle tool': {
          states: {
            'Awaiting second corner': {
              on: {
                'Finish rectangle': {
                  target: 'Finished Rectangle',
                  actions: 'reset deleteIndex',
                },
              },
            },

            'Awaiting origin': {
              on: {
                'click in scene': {
                  target: 'adding draft rectangle',
                  reenter: true,
                },
              },

              entry: 'listen for rectangle origin',
            },

            'Finished Rectangle': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments',
                onDone: 'Awaiting origin',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },

            'adding draft rectangle': {
              invoke: {
                src: 'set-up-draft-rectangle',
                id: 'set-up-draft-rectangle',
                onDone: {
                  target: 'Awaiting second corner',
                  actions: 'update sketchDetails',
                },
                onError: 'Awaiting origin',
                input: ({ context: { sketchDetails }, event }) => {
                  if (event.type !== 'click in scene')
                    return {
                      sketchDetails,
                      data: [0, 0],
                    }
                  return {
                    sketchDetails,
                    data: event.data,
                  }
                },
              },
            },
          },

          initial: 'Awaiting origin',

          on: {
            'change tool': {
              target: 'Change Tool',
              reenter: true,
            },
          },
        },

        'Center Rectangle tool': {
          states: {
            'Awaiting corner': {
              on: {
                'Finish center rectangle': {
                  target: 'Finished Center Rectangle',
                  actions: 'reset deleteIndex',
                },
              },
            },

            'Awaiting origin': {
              on: {
                'Add center rectangle origin': {
                  target: 'add draft center rectangle',
                  reenter: true,
                },
              },

              entry: 'listen for center rectangle origin',
            },

            'Finished Center Rectangle': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments2',
                onDone: 'Awaiting origin',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },

            'add draft center rectangle': {
              invoke: {
                src: 'set-up-draft-center-rectangle',
                id: 'set-up-draft-center-rectangle',
                onDone: {
                  target: 'Awaiting corner',
                  actions: 'update sketchDetails',
                },
                onError: 'Awaiting origin',
                input: ({ context: { sketchDetails }, event }) => {
                  if (event.type !== 'Add center rectangle origin')
                    return {
                      sketchDetails,
                      data: [0, 0],
                    }
                  return {
                    sketchDetails,
                    data: event.data,
                  }
                },
              },
            },
          },

          initial: 'Awaiting origin',

          on: {
            'change tool': {
              target: 'Change Tool',
              reenter: true,
            },
          },
        },

        'clean slate': {
          invoke: {
            src: 'reeval-node-paths',
            id: 'reeval-node-paths',
            input: ({ context: { sketchDetails } }) => ({
              sketchDetails,
            }),

            onDone: {
              target: 'SketchIdle',
              actions: 'update sketchDetails',
            },
            onError: {
              target: '#Modeling.idle',
              actions: 'toastError',
              reenter: true,
            },
          },
        },

        'Converting to named value': {
          invoke: {
            src: 'Apply named value constraint',
            id: 'astConstrainNamedValue',
            input: ({ context: { selectionRanges, sketchDetails }, event }) => {
              if (event.type !== 'Constrain with named value') {
                return {
                  selectionRanges,
                  sketchDetails,
                  data: undefined,
                }
              }
              return {
                selectionRanges,
                sketchDetails,
                data: event.data,
              }
            },
            onError: 'SketchIdle',
            onDone: {
              target: 'SketchIdle',
              actions: 'Set selection',
            },
          },
        },

        'Await constrain remove constraints': {
          invoke: {
            src: 'do-constrain-remove-constraint',
            id: 'do-constrain-remove-constraint',
            input: ({ context: { selectionRanges, sketchDetails }, event }) => {
              return {
                selectionRanges,
                sketchDetails,
                data:
                  event.type === 'Constrain remove constraints'
                    ? event.data
                    : undefined,
              }
            },
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
            input: ({ context: { selectionRanges, sketchDetails } }) => ({
              selectionRanges,
              sketchDetails,
            }),
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
            input: ({ context: { selectionRanges, sketchDetails } }) => ({
              selectionRanges,
              sketchDetails,
            }),
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
            input: ({ context }) => ({
              selectionRanges: context.selectionRanges,
              sketchDetails: context.sketchDetails,
            }),
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
            input: ({ context }) => ({
              selectionRanges: context.selectionRanges,
              sketchDetails: context.sketchDetails,
            }),
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
            input: ({ context }) => ({
              selectionRanges: context.selectionRanges,
              sketchDetails: context.sketchDetails,
            }),
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
            input: ({ context }) => ({
              selectionRanges: context.selectionRanges,
              sketchDetails: context.sketchDetails,
            }),
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
            input: ({ context }) => ({
              selectionRanges: context.selectionRanges,
              sketchDetails: context.sketchDetails,
            }),
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
            input: ({ context }) => ({
              selectionRanges: context.selectionRanges,
              sketchDetails: context.sketchDetails,
            }),
            onDone: {
              target: 'SketchIdle',
              actions: 'Set selection',
            },
          },
        },

        'Change Tool ifs': {
          always: [
            {
              target: 'SketchIdle',
              guard: 'next is none',
            },
            {
              target: 'Line tool',
              guard: 'next is line',
            },
            {
              target: 'Rectangle tool',
              guard: 'next is rectangle',
            },
            {
              target: 'Tangential arc to',
              guard: 'next is tangential arc',
            },
            {
              target: 'Circle tool',
              guard: 'next is circle',
            },
            {
              target: 'Center Rectangle tool',
              guard: 'next is center rectangle',
            },
            {
              target: 'Circle three point tool',
              guard: 'next is circle three point neo',
              reenter: true,
            },
            {
              target: 'Arc tool',
              guard: 'next is arc',
              reenter: true,
            },
            {
              target: 'Arc three point tool',
              guard: 'next is arc three point',
              reenter: true,
            },
          ],
        },

        'Circle tool': {
          on: {
            'change tool': {
              target: 'Change Tool',
              reenter: true,
            },
          },

          states: {
            'Awaiting origin': {
              entry: 'listen for circle origin',

              on: {
                'Add circle origin': {
                  target: 'adding draft circle',
                  reenter: true,
                },
              },
            },

            'Awaiting Radius': {
              on: {
                'Finish circle': {
                  target: 'Finished Circle',
                  actions: 'reset deleteIndex',
                },
              },
            },

            'Finished Circle': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments4',
                onDone: 'Awaiting origin',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },

            'adding draft circle': {
              invoke: {
                src: 'set-up-draft-circle',
                id: 'set-up-draft-circle',
                onDone: {
                  target: 'Awaiting Radius',
                  actions: 'update sketchDetails',
                },
                onError: 'Awaiting origin',
                input: ({ context: { sketchDetails }, event }) => {
                  if (event.type !== 'Add circle origin')
                    return {
                      sketchDetails,
                      data: [0, 0],
                    }
                  return {
                    sketchDetails,
                    data: event.data,
                  }
                },
              },
            },
          },

          initial: 'Awaiting origin',
        },

        'Change Tool': {
          states: {
            'splitting sketch pipe': {
              invoke: {
                src: 'split-sketch-pipe-if-needed',
                id: 'split-sketch-pipe-if-needed',
                onDone: {
                  target: 'setup sketch for tool',
                  actions: 'update sketchDetails',
                },
                onError: '#Modeling.Sketch.SketchIdle',
                input: ({ context: { sketchDetails } }) => ({
                  sketchDetails,
                }),
              },
            },

            'setup sketch for tool': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments',
                onDone: '#Modeling.Sketch.Change Tool ifs',
                onError: '#Modeling.Sketch.SketchIdle',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },
          },

          initial: 'splitting sketch pipe',
          entry: ['assign tool in context', 'reset selections'],
        },
        'Circle three point tool': {
          states: {
            'Awaiting first point': {
              on: {
                'Add first point': 'Awaiting second point',
              },

              entry: 'listen for circle first point',
            },

            'Awaiting second point': {
              on: {
                'Add second point': {
                  target: 'adding draft circle three point',
                  actions: 'remove draft entities',
                },
              },

              entry: 'listen for circle second point',
            },

            'adding draft circle three point': {
              invoke: {
                src: 'set-up-draft-circle-three-point',
                id: 'set-up-draft-circle-three-point',
                onDone: {
                  target: 'Awaiting third point',
                  actions: 'update sketchDetails',
                },
                input: ({ context: { sketchDetails }, event }) => {
                  if (event.type !== 'Add second point')
                    return {
                      sketchDetails,
                      data: { p1: [0, 0], p2: [0, 0] },
                    }
                  return {
                    sketchDetails,
                    data: event.data,
                  }
                },
              },
            },

            'Awaiting third point': {
              on: {
                'Finish circle three point': {
                  target: 'Finished circle three point',
                  actions: 'reset deleteIndex',
                },
              },
            },

            'Finished circle three point': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments5',
                onDone: 'Awaiting first point',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },
          },

          initial: 'Awaiting first point',
          exit: 'remove draft entities',

          on: {
            'change tool': 'Change Tool',
          },
        },

        'Arc tool': {
          states: {
            'Awaiting start point': {
              on: {
                'Add start point': {
                  target: 'Awaiting for circle center',
                  actions: 'update sketchDetails arc',
                },
              },

              entry: 'setup noPoints onClick listener',
              exit: 'remove draft entities',
            },

            'Awaiting for circle center': {
              entry: ['listen for rectangle origin'],

              on: {
                'click in scene': 'Adding draft arc',
              },
            },

            'Adding draft arc': {
              invoke: {
                src: 'set-up-draft-arc',
                id: 'set-up-draft-arc',
                onDone: {
                  target: 'Awaiting endAngle',
                  actions: 'update sketchDetails',
                },
                input: ({ context: { sketchDetails }, event }) => {
                  if (event.type !== 'click in scene')
                    return {
                      sketchDetails,
                      data: [0, 0],
                    }
                  return {
                    sketchDetails,
                    data: event.data,
                  }
                },
              },
            },

            'Awaiting endAngle': {
              on: {
                'Finish arc': 'Finishing arc',
              },
            },

            'Finishing arc': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments8',
                onDone: 'Awaiting start point',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },
          },

          initial: 'Awaiting start point',

          on: {
            'change tool': {
              target: 'Change Tool',
              reenter: true,
            },
          },
        },

        'Arc three point tool': {
          states: {
            'Awaiting start point': {
              on: {
                'Add start point': {
                  target: 'Awaiting for circle center',
                  actions: 'update sketchDetails arc',
                },
              },

              entry: 'setup noPoints onClick listener',
              exit: 'remove draft entities',
            },

            'Awaiting for circle center': {
              on: {
                'click in scene': {
                  target: 'Adding draft arc three point',
                  actions: 'remove draft entities',
                },
              },

              entry: ['listen for rectangle origin', 'add draft line'],
            },

            'Adding draft arc three point': {
              invoke: {
                src: 'set-up-draft-arc-three-point',
                id: 'set-up-draft-arc-three-point',
                onDone: {
                  target: 'Awaiting third point',
                  actions: 'update sketchDetails',
                },
                input: ({ context: { sketchDetails }, event }) => {
                  if (event.type !== 'click in scene')
                    return {
                      sketchDetails,
                      data: [0, 0],
                    }
                  return {
                    sketchDetails,
                    data: event.data,
                  }
                },
              },
            },

            'Awaiting third point': {
              on: {
                'Finish arc': {
                  target: 'Finishing arc',
                  actions: 'reset deleteIndex',
                },

                'Close sketch': 'Finish profile',
              },
            },

            'Finishing arc': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments9',
                onDone: {
                  target: 'Awaiting for circle center',
                  reenter: true,
                },
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },

            'Finish profile': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments10',
                onDone: 'Awaiting start point',
                input: ({ context: { sketchDetails, selectionRanges } }) => ({
                  sketchDetails,
                  selectionRanges,
                }),
              },
            },
          },

          initial: 'Awaiting start point',

          on: {
            'change tool': 'Change Tool',
          },

          exit: 'remove draft entities',
        },
      },

      initial: 'Init',

      on: {
        CancelSketch: '.SketchIdle',

        'Delete segment': {
          reenter: false,
          actions: ['Delete segment', 'Set sketchDetails', 'reset selections'],
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

      entry: ['add axis n grid', 'clientToEngine cam sync direction'],
    },

    'Sketch no face': {
      entry: [
        'disable copilot',
        'show default planes',
        'set selection filter to faces only',
        'enter sketching mode',
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

        input: ({ event }) => {
          if (event.type !== 'Select default plane') return undefined
          return event.data
        },

        onDone: {
          target: 'Sketch',
          actions: 'set new sketch metadata',
        },

        onError: 'Sketch no face',
      },
    },

    'animating to existing sketch': {
      invoke: {
        src: 'animate-to-sketch',
        id: 'animate-to-sketch',

        input: ({ context }) => ({
          selectionRanges: context.selectionRanges,
          sketchDetails: context.sketchDetails,
        }),

        onDone: {
          target: 'Sketch',
          actions: [
            'disable copilot',
            'set new sketch metadata',
            'enter sketching mode',
          ],
        },

        onError: 'idle',
      },
    },

    'Applying extrude': {
      invoke: {
        src: 'extrudeAstMod',
        id: 'extrudeAstMod',
        input: ({ event }) => {
          if (event.type !== 'Extrude') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Applying revolve': {
      invoke: {
        src: 'revolveAstMod',
        id: 'revolveAstMod',
        input: ({ event }) => {
          if (event.type !== 'Revolve') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Applying offset plane': {
      invoke: {
        src: 'offsetPlaneAstMod',
        id: 'offsetPlaneAstMod',
        input: ({ event }) => {
          if (event.type !== 'Offset plane') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Applying helix': {
      invoke: {
        src: 'helixAstMod',
        id: 'helixAstMod',
        input: ({ event }) => {
          if (event.type !== 'Helix') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Applying sweep': {
      invoke: {
        src: 'sweepAstMod',
        id: 'sweepAstMod',
        input: ({ event }) => {
          if (event.type !== 'Sweep') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Applying loft': {
      invoke: {
        src: 'loftAstMod',
        id: 'loftAstMod',
        input: ({ event }) => {
          if (event.type !== 'Loft') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Applying shell': {
      invoke: {
        src: 'shellAstMod',
        id: 'shellAstMod',
        input: ({ event }) => {
          if (event.type !== 'Shell') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Applying fillet': {
      invoke: {
        src: 'filletAstMod',
        id: 'filletAstMod',
        input: ({ event }) => {
          if (event.type !== 'Fillet') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Applying chamfer': {
      invoke: {
        src: 'chamferAstMod',
        id: 'chamferAstMod',
        input: ({ event }) => {
          if (event.type !== 'Chamfer') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    parameter: {
      type: 'parallel',

      states: {
        creating: {
          invoke: {
            src: 'actor.parameter.create',
            id: 'actor.parameter.create',
            input: ({ event }) => {
              if (event.type !== 'event.parameter.create') return undefined
              return event.data
            },
            onDone: ['#Modeling.idle'],
            onError: ['#Modeling.idle'],
          },
        },
        editing: {
          invoke: {
            src: 'actor.parameter.edit',
            id: 'actor.parameter.edit',
            input: ({ event }) => {
              if (event.type !== 'event.parameter.edit') return undefined
              return event.data
            },
            onDone: ['#Modeling.idle'],
            onError: ['#Modeling.idle'],
          },
        },
      },
    },

    'Applying Prompt-to-edit': {
      invoke: {
        src: 'submit-prompt-edit',
        id: 'submit-prompt-edit',

        input: ({ event }) => {
          if (event.type !== 'Prompt-to-edit' || !event.data) {
            return {
              prompt: '',
              selection: { graphSelections: [], otherSelections: [] },
            }
          }
          return event.data
        },

        onDone: 'idle',
        onError: 'idle',
      },
    },

    'Applying Delete selection': {
      invoke: {
        src: 'deleteSelectionAstMod',
        id: 'deleteSelectionAstMod',

        input: ({ event, context }) => {
          return { selectionRanges: context.selectionRanges }
        },

        onDone: 'idle',
        onError: {
          target: 'idle',
          reenter: true,
          actions: ({ event }) => {
            if ('error' in event && err(event.error)) {
              toast.error(event.error.message)
            }
          },
        },
      },
    },

    'Applying appearance': {
      invoke: {
        src: 'appearanceAstMod',
        id: 'appearanceAstMod',
        input: ({ event }) => {
          if (event.type !== 'Appearance') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Applying translate': {
      invoke: {
        src: 'translateAstMod',
        id: 'translateAstMod',
        input: ({ event }) => {
          if (event.type !== 'Translate') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Applying rotate': {
      invoke: {
        src: 'rotateAstMod',
        id: 'rotateAstMod',
        input: ({ event }) => {
          if (event.type !== 'Rotate') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Applying clone': {
      invoke: {
        src: 'cloneAstMod',
        id: 'cloneAstMod',
        input: ({ event }) => {
          if (event.type !== 'Clone') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    Exporting: {
      invoke: {
        src: 'exportFromEngine',
        id: 'exportFromEngine',
        input: ({ event }) => {
          if (event.type !== 'Export') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    Making: {
      invoke: {
        src: 'makeFromEngine',
        id: 'makeFromEngine',
        input: ({ event, context }) => {
          if (event.type !== 'Make' || !context.machineManager) return undefined
          return {
            machineManager: context.machineManager,
            ...event.data,
          }
        },
        onDone: ['idle'],
        onError: ['idle'],
      },
    },

    'Boolean subtracting': {
      invoke: {
        src: 'boolSubtractAstMod',
        id: 'boolSubtractAstMod',
        input: ({ event }) =>
          event.type !== 'Boolean Subtract' ? undefined : event.data,
        onDone: 'idle',
        onError: 'idle',
      },
    },

    'Boolean uniting': {
      invoke: {
        src: 'boolUnionAstMod',
        id: 'boolUnionAstMod',
        input: ({ event }) =>
          event.type !== 'Boolean Union' ? undefined : event.data,
        onDone: 'idle',
        onError: 'idle',
      },
    },

    'Boolean intersecting': {
      invoke: {
        src: 'boolIntersectAstMod',
        id: 'boolIntersectAstMod',
        input: ({ event }) =>
          event.type !== 'Boolean Intersect' ? undefined : event.data,
        onDone: 'idle',
        onError: 'idle',
      },
    },
  },

  initial: 'idle',

  on: {
    Cancel: {
      target: '.idle',
      // TODO what if we're existing extrude equipped, should these actions still be fired?
      // maybe cancel needs to have a guard for if else logic?
      actions: [
        'reset sketch metadata',
        'enable copilot',
        'enter modeling mode',
      ],
    },

    'Set selection': {
      reenter: false,
      actions: 'Set selection',
    },

    'Set mouse state': {
      reenter: false,
      actions: 'Set mouse state',
    },
    'Set context': {
      reenter: false,
      actions: 'Set context',
    },
    'Set Segment Overlays': {
      reenter: false,
      actions: 'Set Segment Overlays',
    },
    'Center camera on selection': {
      reenter: false,
      actions: 'Center camera on selection',
    },
    'Toggle default plane visibility': {
      reenter: false,
      actions: 'Toggle default plane visibility',
    },
  },
})

export function isEditingExistingSketch({
  sketchDetails,
}: {
  sketchDetails: SketchDetails | null
}): boolean {
  // should check that the variable declaration is a pipeExpression
  // and that the pipeExpression contains a "startProfile" callExpression
  if (!sketchDetails?.sketchEntryNodePath) return false
  const variableDeclaration = getNodeFromPath<VariableDeclarator>(
    kclManager.ast,
    sketchDetails.sketchEntryNodePath,
    'VariableDeclarator',
    false,
    true // suppress noise because we know sketchEntryNodePath might not match up to the ast if the user changed the code
    // and is dealt with in `re-eval nodePaths`
  )
  if (variableDeclaration instanceof Error) return false
  if (variableDeclaration.node.type !== 'VariableDeclarator') return false
  const maybePipeExpression = variableDeclaration.node.init
  if (
    (maybePipeExpression.type === 'CallExpression' ||
      maybePipeExpression.type === 'CallExpressionKw') &&
    (maybePipeExpression.callee.name.name === 'startProfile' ||
      maybePipeExpression.callee.name.name === 'circle' ||
      maybePipeExpression.callee.name.name === 'circleThreePoint')
  )
    return true
  if (maybePipeExpression.type !== 'PipeExpression') return false
  const hasStartProfileAt = maybePipeExpression.body.some(
    (item) =>
      item.type === 'CallExpressionKw' &&
      item.callee.name.name === 'startProfile'
  )
  const hasCircle =
    maybePipeExpression.body.some(
      (item) =>
        item.type === 'CallExpressionKw' && item.callee.name.name === 'circle'
    ) ||
    maybePipeExpression.body.some(
      (item) =>
        item.type === 'CallExpressionKw' &&
        item.callee.name.name === 'circleThreePoint'
    )
  return (hasStartProfileAt && maybePipeExpression.body.length > 1) || hasCircle
}

export function pipeHasCircle({
  sketchDetails,
}: {
  sketchDetails: SketchDetails | null
}): boolean {
  if (!sketchDetails?.sketchEntryNodePath) return false
  const variableDeclaration = getNodeFromPath<VariableDeclarator>(
    kclManager.ast,
    sketchDetails.sketchEntryNodePath,
    'VariableDeclarator'
  )
  if (err(variableDeclaration)) return false
  if (variableDeclaration.node.type !== 'VariableDeclarator') return false
  const pipeExpression = variableDeclaration.node.init
  if (pipeExpression.type !== 'PipeExpression') return false
  const hasCircle = pipeExpression.body.some(
    (item) =>
      item.type === 'CallExpressionKw' && item.callee.name.name === 'circle'
  )
  return hasCircle
}

export function canRectangleOrCircleTool({
  sketchDetails,
}: {
  sketchDetails: SketchDetails | null
}): boolean {
  const node = getNodeFromPath<VariableDeclaration>(
    kclManager.ast,
    sketchDetails?.sketchEntryNodePath || [],
    'VariableDeclaration'
  )
  // This should not be returning false, and it should be caught
  // but we need to simulate old behavior to move on.
  if (err(node)) return false
  return node.node?.declaration.init.type !== 'PipeExpression'
}

/** If the sketch contains `close` or `circle` stdlib functions it must be closed */
export function isClosedSketch({
  sketchDetails,
}: {
  sketchDetails: SketchDetails | null
}): boolean {
  const node = getNodeFromPath<VariableDeclaration>(
    kclManager.ast,
    sketchDetails?.sketchEntryNodePath || [],
    'VariableDeclaration'
  )
  // This should not be returning false, and it should be caught
  // but we need to simulate old behavior to move on.
  if (err(node)) return false
  if (node.node?.declaration?.init?.type !== 'PipeExpression') return false
  return node.node.declaration.init.body.some(
    (node) =>
      (node.type === 'CallExpression' || node.type === 'CallExpressionKw') &&
      (node.callee.name.name === 'close' || node.callee.name.name === 'circle')
  )
}

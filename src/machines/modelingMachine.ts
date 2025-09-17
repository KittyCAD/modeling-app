import { sketchSolveMachine } from '@src/machines/sketchSolveMode'
import toast from 'react-hot-toast'
import { Mesh, Vector2, Vector3 } from 'three'
import { assign, fromPromise, setup } from 'xstate'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import type { Point3d } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Plane } from '@rust/kcl-lib/bindings/Plane'
import { letEngineAnimateAndSyncCamAfter } from '@src/clientSideScene/CameraControls'
import { deleteSegment } from '@src/clientSideScene/deleteSegment'
import {
  orthoScale,
  quaternionFromUpNForward,
} from '@src/clientSideScene/helpers'
import { DRAFT_DASHED_LINE } from '@src/clientSideScene/sceneConstants'
import type { OnMoveCallbackArgs } from '@src/clientSideScene/sceneInfra'
import { DRAFT_POINT } from '@src/clientSideScene/sceneUtils'
import { createProfileStartHandle } from '@src/clientSideScene/segments'
import type { MachineManager } from '@src/components/MachineManagerProvider'
import type { ModelingMachineContext } from '@src/components/ModelingMachineProvider'
import type { SidebarId } from '@src/components/ModelingSidebar/ModelingPanes'
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
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  insertNamedConstant,
  replaceValueAtNodePath,
} from '@src/lang/modifyAst'
import type {
  ChamferParameters,
  FilletParameters,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  EdgeTreatmentType,
  editEdgeTreatment,
  modifyAstWithEdgeTreatmentAndTag,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  addIntersect,
  addSubtract,
  addUnion,
} from '@src/lang/modifyAst/boolean'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from '@src/lang/modifyAst/deleteSelection'
import { addOffsetPlane, addShell } from '@src/lang/modifyAst/faces'
import { addHelix } from '@src/lang/modifyAst/geometry'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
} from '@src/lang/modifyAst/sweeps'
import {
  addAppearance,
  addClone,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'
import {
  artifactIsPlaneWithPaths,
  getNodeFromPath,
  isCursorInFunctionDefinition,
  isNodeSafeToReplacePath,
  stringifyPathToNode,
  updatePathToNodesAfterEdit,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  getFaceCodeRef,
  getPathsFromArtifact,
  getPathsFromPlaneArtifact,
  getPlaneFromArtifact,
} from '@src/lang/std/artifactGraph'
import type { Coords2d } from '@src/lang/std/sketch'
import {
  crossProduct,
  isCursorInSketchCommandRange,
  updateSketchDetailsNodePaths,
} from '@src/lang/util'
import type {
  Artifact,
  ArtifactId,
  KclValue,
  PathToNode,
  Program,
  VariableDeclaration,
  VariableDeclarator,
} from '@src/lang/wasm'
import { parse, recast, resultIsOk, sketchFromKclValue } from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { EXECUTION_TYPE_REAL, VALID_PANE_IDS } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import type { DefaultPlaneStr } from '@src/lib/planes'
import type {
  Axis,
  DefaultPlaneSelection,
  Selection,
  Selections,
} from '@src/lib/selections'
import { handleSelectionBatch, updateSelections } from '@src/lib/selections'
import type { Setting } from '@src/lib/settings/initialSettings'
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
import { uuidv4 } from '@src/lib/utils'
import { kclEditorActor } from '@src/machines/kclEditorMachine'

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
  negated: boolean
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
  openPanes: SidebarId[]
  cameraProjection?: Setting<CameraProjectionType>
  useNewSketchMode?: Setting<boolean>
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
      type: 'Select sketch plane'
      data: DefaultPlane | ExtrudeFacePlane | OffsetPlane
    }
  | {
      type: 'Select sketch solve plane'
      data: ArtifactId
    }
  | {
      type: 'Set selection'
      data: SetSelections
    }
  | {
      type: 'Delete selection'
    }
  | { type: 'Sketch no face' }
  | { type: 'Cancel'; cleanup?: () => void }
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
  | { type: 'Scale'; data: ModelingCommandSchema['Scale'] }
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
  const fallbackContextObject = {
    openPanes: isDesktop()
      ? (['feature-tree', 'code', 'files'] satisfies Store['openPanes'])
      : (['feature-tree', 'code'] satisfies Store['openPanes']),
  }

  try {
    const c: Partial<PersistedModelingContext> =
      (typeof window !== 'undefined' &&
        JSON.parse(localStorage.getItem(PERSIST_MODELING_CONTEXT) || '{}')) ||
      fallbackContextObject

    // filter out any invalid IDs at read time
    if (c.openPanes) {
      c.openPanes = c.openPanes.filter((p) => VALID_PANE_IDS.includes(p))
    }
    return c
  } catch (e) {
    console.error(e)
    return fallbackContextObject
  }
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

const NO_INPUT_PROVIDED_MESSAGE = 'No input provided'

export const modelingMachine = setup({
  types: {
    context: {} as ModelingMachineContext,
    events: {} as ModelingMachineEvent,
    input: {} as ModelingMachineContext,
  },
  guards: {
    'should use new sketch mode': ({ context }) => {
      return context.store.useNewSketchMode?.current === true
    },
    'Selection is on face': ({
      context: { selectionRanges },
      event,
    }): boolean => {
      if (event.type !== 'Enter sketch') return false
      if (event.data?.forceNewSketch) return false
      if (artifactIsPlaneWithPaths(selectionRanges)) {
        return true
      } else if (selectionRanges.graphSelections[0]?.artifact) {
        // See if the selection is "close enough" to be coerced to the plane later
        const maybePlane = getPlaneFromArtifact(
          selectionRanges.graphSelections[0].artifact,
          kclManager.artifactGraph
        )
        return !err(maybePlane)
      }
      if (
        isCursorInFunctionDefinition(
          kclManager.ast,
          selectionRanges.graphSelections[0]
        )
      ) {
        return false
      }
      return !!isCursorInSketchCommandRange(
        kclManager.artifactGraph,
        selectionRanges
      )
    },
    'Has exportable geometry': () => false,
    'has valid selection for deletion': () => false,
    'is-error-free': (): boolean => {
      return kclManager.errors.length === 0 && !kclManager.hasErrors()
    },
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

      const pathToNodes = event.data
        ? [event.data]
        : selectionRanges.graphSelections.map(({ codeRef }) => {
            return codeRef.pathToNode
          })
      const info = removeConstrainingValuesInfo(pathToNodes)
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
        console.error(event.output)
        toast.error(event.output.message)
      } else if ('data' in event && event.data instanceof Error) {
        console.error(event.data)
        toast.error(event.data.message)
      } else if ('error' in event && event.error instanceof Error) {
        console.error(event.error)
        toast.error(event.error.message)
      }
    },
    toastErrorAndExitSketch: ({ event }) => {
      if ('output' in event && event.output instanceof Error) {
        console.error(event.output)
        toast.error(event.output.message)
      } else if ('data' in event && event.data instanceof Error) {
        console.error(event.data)
        toast.error(event.data.message)
      } else if ('error' in event && event.error instanceof Error) {
        console.error(event.error)
        toast.error(event.error.message)
      }

      // Clean up the THREE.js sketch scene
      sceneEntitiesManager.tearDownSketch({ removeAxis: false })
      sceneEntitiesManager.removeSketchGrid()
      sceneEntitiesManager.resetOverlays()
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
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails)
        },
        onClick: (args) => {
          sceneEntitiesManager.removeDraftPoint()
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
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails)
        },
        onClick: (args) => {
          sceneEntitiesManager.removeDraftPoint()
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add center rectangle origin',
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
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails)
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add circle origin',
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
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails)
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add first point',
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
        theme: sceneInfra.theme,
      })
      draftPoint.position.copy(position)
      sceneInfra.scene.add(draftPoint)

      sceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails)
        },
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
                p2: sceneEntitiesManager.getSnappedDragPoint(
                  twoD,
                  args.intersects,
                  args.mouseEvent
                ).snappedPoint,
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
          updater(group, snappedPoint, orthoFactor)
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
    'Set selection': assign(
      ({ context: { selectionRanges, sketchDetails }, event }) => {
        // this was needed for ts after adding 'Set selection' action to on done modal events
        const setSelections =
          ('data' in event &&
            typeof event.data === 'object' &&
            'selectionType' in event.data &&
            event.data) ||
          ('output' in event &&
            event.output &&
            'selectionType' in event.output &&
            event.output) ||
          null
        if (!setSelections) return {}

        let selections: Selections = {
          graphSelections: [],
          otherSelections: [],
        }
        if (setSelections.selectionType === 'singleCodeCursor') {
          if (!setSelections.selection && editorManager.isShiftDown) {
            // if the user is holding shift, but they didn't select anything
            // don't nuke their other selections (frustrating to have one bad click ruin your
            // whole selection)
            selections = {
              graphSelections: selectionRanges.graphSelections,
              otherSelections: selectionRanges.otherSelections,
            }
          } else if (!setSelections.selection && !editorManager.isShiftDown) {
            selections = {
              graphSelections: [],
              otherSelections: [],
            }
          } else if (setSelections.selection && !editorManager.isShiftDown) {
            selections = {
              graphSelections: [setSelections.selection],
              otherSelections: [],
            }
          } else if (setSelections.selection && editorManager.isShiftDown) {
            // selecting and deselecting multiple objects

            /**
             * There are two scenarios:
             * 1. General case:
             *    When selecting and deselecting edges,
             *    faces or segment (during sketch edit)
             *    we use its artifact ID to identify the selection
             * 2. Initial sketch setup:
             *    The artifact is not yet created
             *    so we use the codeRef.range
             */

            let updatedSelections: typeof selectionRanges.graphSelections

            // 1. General case: Artifact exists, use its ID
            if (setSelections.selection.artifact?.id) {
              // check if already selected
              const alreadySelected = selectionRanges.graphSelections.some(
                (selection) =>
                  selection.artifact?.id ===
                  setSelections.selection?.artifact?.id
              )
              if (alreadySelected && setSelections.selection?.artifact?.id) {
                // remove it
                updatedSelections = selectionRanges.graphSelections.filter(
                  (selection) =>
                    selection.artifact?.id !==
                    setSelections.selection?.artifact?.id
                )
              } else {
                // add it
                updatedSelections = [
                  ...selectionRanges.graphSelections,
                  setSelections.selection,
                ]
              }
            } else {
              // 2. Initial sketch setup: Artifact not yet created – use codeRef.range
              const selectionRange = JSON.stringify(
                setSelections.selection?.codeRef?.range
              )

              // check if already selected
              const alreadySelected = selectionRanges.graphSelections.some(
                (selection) => {
                  const existingRange = JSON.stringify(selection.codeRef?.range)
                  return existingRange === selectionRange
                }
              )

              if (alreadySelected && setSelections.selection?.codeRef?.range) {
                // remove it
                updatedSelections = selectionRanges.graphSelections.filter(
                  (selection) =>
                    JSON.stringify(selection.codeRef?.range) !== selectionRange
                )
              } else {
                // add it
                updatedSelections = [
                  ...selectionRanges.graphSelections,
                  setSelections.selection,
                ]
              }
            }

            selections = {
              graphSelections: updatedSelections,
              otherSelections: selectionRanges.otherSelections,
            }
          }

          const { engineEvents, codeMirrorSelection, updateSceneObjectColors } =
            handleSelectionBatch({
              selections,
            })
          if (codeMirrorSelection) {
            kclEditorActor.send({
              type: 'setLastSelectionEvent',
              data: {
                codeMirrorSelection,
                scrollIntoView: setSelections.scrollIntoView ?? false,
              },
            })
          }

          // If there are engine commands that need sent off, send them
          // TODO: This should be handled outside of an action as its own
          // actor, so that the system state is more controlled.
          engineEvents &&
            engineEvents.forEach((event) => {
              engineCommandManager
                .sendSceneCommand(event)
                .catch(reportRejection)
            })
          updateSceneObjectColors()

          return {
            selectionRanges: selections,
          }
        }

        if (setSelections.selectionType === 'mirrorCodeMirrorSelections') {
          return {
            selectionRanges: setSelections.selection,
          }
        }

        if (
          setSelections.selectionType === 'axisSelection' ||
          setSelections.selectionType === 'defaultPlaneSelection'
        ) {
          if (editorManager.isShiftDown) {
            selections = {
              graphSelections: selectionRanges.graphSelections,
              otherSelections: [setSelections.selection],
            }
          } else {
            selections = {
              graphSelections: [],
              otherSelections: [setSelections.selection],
            }
          }
          return {
            selectionRanges: selections,
          }
        }

        if (setSelections.selectionType === 'completeSelection') {
          const codeMirrorSelection = editorManager.createEditorSelection(
            setSelections.selection
          )
          kclEditorActor.send({
            type: 'setLastSelectionEvent',
            data: {
              codeMirrorSelection,
              scrollIntoView: false,
            },
          })
          if (!sketchDetails)
            return {
              selectionRanges: setSelections.selection,
            }
          return {
            selectionRanges: setSelections.selection,
            sketchDetails: {
              ...sketchDetails,
              sketchEntryNodePath:
                setSelections.updatedSketchEntryNodePath ||
                sketchDetails?.sketchEntryNodePath ||
                [],
              sketchNodePaths:
                setSelections.updatedSketchNodePaths ||
                sketchDetails?.sketchNodePaths ||
                [],
              planeNodePath:
                setSelections.updatedPlaneNodePath ||
                sketchDetails?.planeNodePath ||
                [],
            },
          }
        }

        return {}
      }
    ),
    'Set mouse state': () => {},
    'Set Segment Overlays': () => {},
    'Center camera on selection': () => {},
    'Submit to Text-to-CAD API': () => {},
    'Set sketchDetails': () => {},
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
    sketchExit: fromPromise(
      async (args: { input: { context: { store: Store } } }) => {
        const store = args.input.context.store

        // When cancelling the sketch mode we should disable sketch mode within the engine.
        await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'sketch_mode_disable' },
        })

        sceneInfra.camControls.syncDirection = 'clientToEngine'

        if (store.cameraProjection?.current === 'perspective') {
          await sceneInfra.camControls.snapToPerspectiveBeforeHandingBackControlToEngine()
        }

        sceneInfra.camControls.syncDirection = 'engineToClient'

        // TODO: Re-evaluate if this pause/play logic is needed.
        store.videoElement?.pause()

        await kclManager
          .executeCode()
          .then(() => {
            if (engineCommandManager.idleMode) return

            store.videoElement?.play().catch((e: Error) => {
              console.warn('Video playing was prevented', e)
            })
          })
          .catch(reportRejection)

        sceneEntitiesManager.tearDownSketch({ removeAxis: false })
        sceneEntitiesManager.removeSketchGrid()
        sceneInfra.camControls.syncDirection = 'engineToClient'
        sceneEntitiesManager.resetOverlays()
      }
    ),
    /* Below are all the do-constrain sketch actors,
     * which aren't using updateModelingState and don't have the 'no kcl errors' guard yet */
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

    /* Below are actors being defined in src/components/ModelingMachineProvider.tsx
     * which aren't using updateModelingState and don't have the 'no kcl errors' guard yet */
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
    'animate-to-sketch-solve': fromPromise(
      async (_: { input: ArtifactId | undefined }) => {
        return {} as any // TODO
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
    'setup-client-side-sketch-segments': fromPromise(
      async ({
        input: { sketchDetails, selectionRanges },
      }: {
        input: {
          sketchDetails: SketchDetails | null
          selectionRanges: Selections
        }
      }) => {
        if (!sketchDetails) return
        if (!sketchDetails.sketchEntryNodePath?.length) return
        sceneInfra.resetMouseListeners()
        await sceneEntitiesManager.setupSketch({
          sketchEntryNodePath: sketchDetails?.sketchEntryNodePath || [],
          sketchNodePaths: sketchDetails.sketchNodePaths,
          forward: sketchDetails.zAxis,
          up: sketchDetails.yAxis,
          position: sketchDetails.origin,
          maybeModdedAst: kclManager.ast,
          selectionRanges,
        })
        sceneInfra.resetMouseListeners()

        sceneEntitiesManager.setupSketchIdleCallbacks({
          sketchEntryNodePath: sketchDetails?.sketchEntryNodePath || [],
          forward: sketchDetails.zAxis,
          up: sketchDetails.yAxis,
          position: sketchDetails.origin,
          sketchNodePaths: sketchDetails.sketchNodePaths,
          planeNodePath: sketchDetails.planeNodePath,
          // We will want to pass sketchTools here
          // to add their interactions
        })

        // We will want to update the context with sketchTools.
        // They'll be used for their .destroy() in tearDownSketch
        return undefined
      }
    ),
    'animate-to-sketch': fromPromise(
      async ({
        input: { selectionRanges },
      }: {
        input: {
          selectionRanges: Selections
        }
      }): Promise<ModelingMachineContext['sketchDetails']> => {
        const artifact = selectionRanges.graphSelections[0].artifact
        const plane = getPlaneFromArtifact(artifact, kclManager.artifactGraph)
        if (err(plane)) return Promise.reject(plane)
        // if the user selected a segment, make sure we enter the right sketch as there can be multiple on a plane
        // but still works if the user selected a plane/face by defaulting to the first path
        const mainPath =
          artifact?.type === 'segment' || artifact?.type === 'solid2d'
            ? artifact?.pathId
            : plane?.pathIds[0]
        let sketch: KclValue | null = null
        let planeVar: Plane | null = null

        for (const variable of Object.values(kclManager.execState.variables)) {
          // find programMemory that matches path artifact
          if (
            variable?.type === 'Sketch' &&
            variable.value.artifactId === mainPath
          ) {
            sketch = variable
            break
          }
          if (
            // if the variable is an sweep, check if the underlying sketch matches the artifact
            variable?.type === 'Solid' &&
            variable.value.sketch.on.type === 'plane' &&
            variable.value.sketch.artifactId === mainPath
          ) {
            sketch = {
              type: 'Sketch',
              value: variable.value.sketch,
            }
            break
          }
          if (variable?.type === 'Plane' && plane.id === variable.value.id) {
            planeVar = variable.value
          }
        }

        if (!sketch || sketch.type !== 'Sketch') {
          if (artifact?.type !== 'plane')
            return Promise.reject(new Error('No sketch'))
          const planeCodeRef = getFaceCodeRef(artifact)
          if (planeVar && planeCodeRef) {
            const toTuple = (point: Point3d): [number, number, number] => [
              point.x,
              point.y,
              point.z,
            ]
            const planPath = getNodePathFromSourceRange(
              kclManager.ast,
              planeCodeRef.range
            )
            await letEngineAnimateAndSyncCamAfter(
              engineCommandManager,
              artifact.id
            )
            const normal = crossProduct(planeVar.xAxis, planeVar.yAxis)
            return {
              sketchEntryNodePath: [],
              planeNodePath: planPath,
              sketchNodePaths: [],
              zAxis: toTuple(normal),
              yAxis: toTuple(planeVar.yAxis),
              origin: toTuple(planeVar.origin),
            }
          }
          return Promise.reject(new Error('No sketch'))
        }
        const info = await sceneEntitiesManager.getSketchOrientationDetails(
          sketch.value
        )
        await letEngineAnimateAndSyncCamAfter(
          engineCommandManager,
          info?.sketchDetails?.faceId || ''
        )

        const sketchArtifact = kclManager.artifactGraph.get(mainPath)
        if (sketchArtifact?.type !== 'path')
          return Promise.reject(new Error('No sketch artifact'))
        const sketchPaths = getPathsFromArtifact({
          artifact: kclManager.artifactGraph.get(plane.id),
          sketchPathToNode: sketchArtifact?.codeRef?.pathToNode,
          artifactGraph: kclManager.artifactGraph,
          ast: kclManager.ast,
        })
        if (err(sketchPaths)) return Promise.reject(sketchPaths)
        let codeRef = getFaceCodeRef(plane)
        if (!codeRef) return Promise.reject(new Error('No plane codeRef'))
        // codeRef.pathToNode is not always populated correctly
        const planeNodePath = getNodePathFromSourceRange(
          kclManager.ast,
          codeRef.range
        )
        return {
          sketchEntryNodePath: sketchArtifact.codeRef.pathToNode || [],
          sketchNodePaths: sketchPaths,
          planeNodePath,
          zAxis: info.sketchDetails.zAxis || null,
          yAxis: info.sketchDetails.yAxis || null,
          origin: info.sketchDetails.origin.map(
            (a) => a / sceneInfra.baseUnitMultiplier
          ) as [number, number, number],
          animateTargetId: info?.sketchDetails?.faceId || '',
        }
      }
    ),
    'Apply named value constraint': fromPromise(
      async ({
        input,
      }: {
        input: Pick<
          ModelingMachineContext,
          'sketchDetails' | 'selectionRanges'
        > & {
          data?: ModelingCommandSchema['Constrain with named value']
        }
      }): Promise<SetSelections> => {
        const { selectionRanges, sketchDetails, data } = input
        if (!sketchDetails) {
          return Promise.reject(new Error('No sketch details'))
        }
        if (!data) {
          return Promise.reject(new Error('No data from command flow'))
        }
        let pResult = parse(recast(kclManager.ast))
        if (trap(pResult) || !resultIsOk(pResult))
          return Promise.reject(new Error('Unexpected compilation error'))
        let parsed = pResult.program

        let result: {
          modifiedAst: Node<Program>
          pathToReplaced: PathToNode | null
          exprInsertIndex: number
        } = {
          modifiedAst: parsed,
          pathToReplaced: null,
          exprInsertIndex: -1,
        }
        // If the user provided a constant name,
        // we need to insert the named constant
        // and then replace the node with the constant's name.
        if ('variableName' in data.namedValue) {
          const astAfterReplacement = replaceValueAtNodePath({
            ast: parsed,
            pathToNode: data.currentValue.pathToNode,
            newExpressionString: data.namedValue.variableName,
          })
          if (trap(astAfterReplacement)) {
            return Promise.reject(astAfterReplacement)
          }
          const parseResultAfterInsertion = parse(
            recast(
              insertNamedConstant({
                node: astAfterReplacement.modifiedAst,
                newExpression: data.namedValue,
              })
            )
          )
          result.exprInsertIndex = data.namedValue.insertIndex

          if (
            trap(parseResultAfterInsertion) ||
            !resultIsOk(parseResultAfterInsertion)
          )
            return Promise.reject(parseResultAfterInsertion)
          result = {
            modifiedAst: parseResultAfterInsertion.program,
            pathToReplaced: astAfterReplacement.pathToReplaced,
            exprInsertIndex: result.exprInsertIndex,
          }
        } else if ('valueText' in data.namedValue) {
          // If they didn't provide a constant name,
          // just replace the node with the value.
          const astAfterReplacement = replaceValueAtNodePath({
            ast: parsed,
            pathToNode: data.currentValue.pathToNode,
            newExpressionString: data.namedValue.valueText,
          })
          if (trap(astAfterReplacement)) {
            return Promise.reject(astAfterReplacement)
          }
          // The `replacer` function returns a pathToNode that assumes
          // an identifier is also being inserted into the AST, creating an off-by-one error.
          // This corrects that error, but TODO we should fix this upstream
          // to avoid this kind of error in the future.
          astAfterReplacement.pathToReplaced[1][0] =
            (astAfterReplacement.pathToReplaced[1][0] as number) - 1
          result = astAfterReplacement
        }

        pResult = parse(recast(result.modifiedAst))
        if (trap(pResult) || !resultIsOk(pResult))
          return Promise.reject(new Error('Unexpected compilation error'))
        parsed = pResult.program

        if (trap(parsed)) return Promise.reject(parsed)
        if (!result.pathToReplaced)
          return Promise.reject(new Error('No path to replaced node'))

        const {
          updatedSketchEntryNodePath,
          updatedSketchNodePaths,
          updatedPlaneNodePath,
        } = updateSketchDetailsNodePaths({
          sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
          sketchNodePaths: sketchDetails.sketchNodePaths,
          planeNodePath: sketchDetails.planeNodePath,
          exprInsertIndex: result.exprInsertIndex,
        })

        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          updatedSketchEntryNodePath,
          updatedSketchNodePaths,
          updatedPlaneNodePath,
          parsed,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin
        )
        if (err(updatedAst)) return Promise.reject(updatedAst)

        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)

        const selection = updateSelections(
          { 0: result.pathToReplaced },
          selectionRanges,
          updatedAst.newAst
        )
        if (err(selection)) return Promise.reject(selection)
        return {
          selectionType: 'completeSelection',
          selection,
          updatedSketchEntryNodePath,
          updatedSketchNodePaths,
          updatedPlaneNodePath,
        }
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
    'split-sketch-pipe-if-needed': fromPromise(
      async (_: { input: Pick<ModelingMachineContext, 'sketchDetails'> }) => {
        return {} as SketchDetailsUpdate
      }
    ),
    'submit-prompt-edit': fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Prompt-to-edit']
      }) => {}
    ),

    /* Below are recent modeling codemods that are using updateModelinState,
     * trigger toastError on Error, and have the 'no kcl errors' guard yet */
    extrudeAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Extrude'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast } = kclManager
        const astResult = addExtrude({
          ast,
          ...input,
        })
        if (err(astResult)) {
          return Promise.reject(new Error("Couldn't add extrude statement"))
        }

        const { modifiedAst, pathToNode } = astResult
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
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast } = kclManager
        const astResult = addSweep({
          ...input,
          ast,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
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
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast } = kclManager
        const astResult = addLoft({ ast, ...input })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
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
    revolveAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Revolve'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast } = kclManager
        const astResult = addRevolve({
          ast,
          ...input,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
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
    offsetPlaneAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Offset plane'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast, artifactGraph, variables } = kclManager
        const astResult = addOffsetPlane({
          ...input,
          ast,
          artifactGraph,
          variables,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
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
    helixAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Helix'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast, artifactGraph } = kclManager
        const astResult = addHelix({
          ...input,
          ast,
          artifactGraph,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
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
    shellAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Shell'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast, artifactGraph } = kclManager
        const astResult = addShell({
          ...input,
          ast,
          artifactGraph,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
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
    filletAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Fillet'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        // Extract inputs
        const ast = kclManager.ast
        let modifiedAst = structuredClone(ast)
        let focusPath: PathToNode[] = []
        const { nodeToEdit, selection, radius } = input

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

        // Apply or edit fillet
        if (nodeToEdit) {
          // Edit existing fillet
          // selection is not the edge treatment itself,
          // but just the first edge in the fillet expression >
          // we need to find the edgeCut artifact
          // and build a new selection from it
          // TODO: this is a bit of a hack, we should be able
          // to get the edgeCut artifact from the selection
          const firstSelection = selection.graphSelections[0]
          const edgeCutArtifact = Array.from(
            kclManager.artifactGraph.values()
          ).find(
            (artifact) =>
              artifact.type === 'edgeCut' &&
              artifact.consumedEdgeId === firstSelection.artifact?.id
          )
          if (!edgeCutArtifact || edgeCutArtifact.type !== 'edgeCut') {
            return Promise.reject(
              new Error(
                'Failed to retrieve edgeCut artifact from sweepEdge selection'
              )
            )
          }
          const edgeTreatmentSelection = {
            artifact: edgeCutArtifact,
            codeRef: edgeCutArtifact.codeRef,
          }

          const editResult = await editEdgeTreatment(
            ast,
            edgeTreatmentSelection,
            parameters
          )
          if (err(editResult)) return Promise.reject(editResult)

          modifiedAst = editResult.modifiedAst
          focusPath = [editResult.pathToEdgeTreatmentNode]
        } else {
          // Apply fillet to selection
          const filletResult = await modifyAstWithEdgeTreatmentAndTag(
            ast,
            selection,
            parameters,
            dependencies
          )
          if (err(filletResult)) return Promise.reject(filletResult)
          modifiedAst = filletResult.modifiedAst
          focusPath = filletResult.pathToEdgeTreatmentNode
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
            focusPath: focusPath,
          }
        )
      }
    ),
    chamferAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Chamfer'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        // Extract inputs
        const ast = kclManager.ast
        let modifiedAst = structuredClone(ast)
        let focusPath: PathToNode[] = []
        const { nodeToEdit, selection, length } = input

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

        // Apply or edit chamfer
        if (nodeToEdit) {
          // Edit existing chamfer
          // selection is not the edge treatment itself,
          // but just the first edge in the chamfer expression >
          // we need to find the edgeCut artifact
          // and build a new selection from it
          // TODO: this is a bit of a hack, we should be able
          // to get the edgeCut artifact from the selection
          const firstSelection = selection.graphSelections[0]
          const edgeCutArtifact = Array.from(
            kclManager.artifactGraph.values()
          ).find(
            (artifact) =>
              artifact.type === 'edgeCut' &&
              artifact.consumedEdgeId === firstSelection.artifact?.id
          )
          if (!edgeCutArtifact || edgeCutArtifact.type !== 'edgeCut') {
            return Promise.reject(
              new Error(
                'Failed to retrieve edgeCut artifact from sweepEdge selection'
              )
            )
          }
          const edgeTreatmentSelection = {
            artifact: edgeCutArtifact,
            codeRef: edgeCutArtifact.codeRef,
          }

          const editResult = await editEdgeTreatment(
            ast,
            edgeTreatmentSelection,
            parameters
          )
          if (err(editResult)) return Promise.reject(editResult)

          modifiedAst = editResult.modifiedAst
          focusPath = [editResult.pathToEdgeTreatmentNode]
        } else {
          // Apply chamfer to selection
          const chamferResult = await modifyAstWithEdgeTreatmentAndTag(
            ast,
            selection,
            parameters,
            dependencies
          )
          if (err(chamferResult)) return Promise.reject(chamferResult)
          modifiedAst = chamferResult.modifiedAst
          focusPath = chamferResult.pathToEdgeTreatmentNode
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
            focusPath: focusPath,
          }
        )
      }
    ),
    'actor.parameter.create': fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['event.parameter.create'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { value } = input
        if (!('variableName' in value)) {
          return Promise.reject(new Error('variable name is required'))
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
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

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
          return Promise.reject(new Error('No variable found, this is a bug'))
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
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = kclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addAppearance({
          ...input,
          ast,
          artifactGraph,
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
    translateAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Translate'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = kclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addTranslate({
          ...input,
          ast,
          artifactGraph,
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
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = kclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addRotate({
          ...input,
          ast,
          artifactGraph,
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
    scaleAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Scale'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = kclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addScale({
          ...input,
          ast,
          artifactGraph,
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
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = kclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addClone({
          ...input,
          ast,
          artifactGraph,
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
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = kclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addSubtract({
          ...input,
          ast,
          artifactGraph,
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
    boolUnionAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Boolean Union'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = kclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addUnion({
          ...input,
          ast,
          artifactGraph,
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
    boolIntersectAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Boolean Union'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = kclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addIntersect({
          ...input,
          ast,
          artifactGraph,
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

    /* Pierre: looks like somewhat of a one-off */
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANmEBmAHQBGAJwBWABwKpSqTQDsUsQBoQAT0QAmdQBYJYmmPVjDh4YsMKZAX2e60GHPgIBlMOwACWCwwck5uWgYkEBY2cJ5ogQRBNRkzOUsFOTFFGhNZQ10DBBkZCXU7Szl5KRMTWxNXd3QsPEI-QIBbVABXYKD2EnYwSN5Yji4E0CSUqSlDCQUTGRpZefV1GWF1IsQxbYkTOS0FDRo5dRpDKTkmkA9W7w6A8m5hvnZR6PH43hnU4QSVYWbYyMQKdQKRy7BDCfLSYTXQzHUQmJQuNz3Fpedr+AJ+KCdMC4QIAeQAbmAAE6YEh6WBfZisCbcP5COaKCTydQXHkydRwjYw44LSz2YQaWw5ex3B444jE4ZUl4kIlUkgBbhBEJhSaMmLM36JdlSSHmVbGZY5NLCBQw040CSImjKUrZFSy7FtAgAFVQUCgmDAAQwADMSD1MIEmLTcMHydg2AAjbA4dh6fU-SZs5LzNGHGgSmTzCG1Wow+SO11bMQmHKVRqYuVtCTYCBBggAURJ1KCAGt-OQABaZw3Z43JZFSQ5g4RqFSGZbImEVMqQyEQyFw+a3Jte-Ct9tgLs95WwAfsYdUKRRJlxcfTIQNcpQ23XflKeyFfSIUTTuQAXMcIXDIThSJ6ngtm2Hadh8VI9Bgo73qyE4iDQjqbLUpiFhYVgmDChhWJIjhXBcci2ks5EQY8UCHh2PgAO5gGATBISyUz8EI1TqEC2zZHUO7GN+xTXPsBaLjYeQSiYArUTidHHgAMqgoafPQYxjihj7JIogJpFOciGDI1zbDCC6SC6qwmNstaKGiclQUeBAAEpgOSqCYJSbFGtpgiaDxOSaLpwjFlYwgwmIpQKE65E2P5FS1A5B7QcepKhqGwTRrGIzqd8mkcTMc48VcOFgo4NwyGZEqSJW1VOBkhHqEltEpQQAASrR8N5D6cTpKxOjQxZZMYczzARGSOuh5wXFo9SGM1Cm+EOWCYN1Wm9YI1SOsYhbLLUUIqOFP4IKa1zlHk1lOJs2zgXukHJU5ABiqZBmpt4GshBVcf16EZLIlxzcux2GKscgSNUshzvYAFWAtrVEEOqqhtSa1fck1XlJc4gCqaxm2gRi5g-IUViu6813TRi1uYqEhMCQ6pEkqEjkFSYBDDl71ZutMzKNFcz1WI87kaUMJWmYWSlJokUKPYt3NPdLVOdTJK0-Tqr+NSEiQBwqM5n5-WRaUg0yeR1h2sdGQbNIgv8xKphyEccNObBLBUm9GmfXr1gLFktpSCF-IaObxQWHU4PFnkRkgxCtZOx2yAkAOuuodYkinNaFy2gKQMiWC06++CWjAVCjby5TrUACIhMM2pBrqES5Xe7F61kkj+4HpRwkZeQEbL4OmvURympcthx8ePpgB8gjsKgghEAAghXyfaWIgsSI45El+sxz4cdoHTrOoHWMcmQYmX8mtQAClSqCdEw7DT7P2vu3lnuoYiPFzAJqxVJRZnFoCJwJhQar0umfLECtFrzyYEwNm6oKAcw9s3d+5xyirw2GVFY9gdDA02NFWsLpTCr0sHLCB5cnI+ngbAWkwxl4bQqD7ZExZjIyTqAoHBxR8imEWLOZEyJqg2DHi5VAgxaGNw+sg3ymgFi2kMhCU2NopCi0cOkKEVwLD8glAoIRPhyAkCDHQmYmhAT5GULjbYEk5Ci0MjxUopolg8msByIRRBMDcEQa-SR9DBpcn5DyOEoE8gO1FnWHiSwN5Dw0eA5sD0OwACFUAeTZrgfEPQkzsHVGEQxQgKgmJCnZUJ8gjohyLOYB2YI6gaELmIIRCSklkACAAVVwHqcRXM0Z+XzFkGWUd6hLCUcdKwjhFgASOJFFE2iKYXycnUoMDSACSp5ghZLaflL21QuRS1sOhayaIIpKB4sAxcgNV6kJiYrIMEghxtjAJfbKsACDzzdtgcMYQAhQHVEwIcAQWBMEjOzCA2TkiaDMKUayqwGHKH2GZZEZhNCHVMNsiopcyHTMubAIcqAGJ3LIHAR5zzXmBA+SQL5AQwB304JAIFKRipgmliDQa5wBQ7GOmobh5w6jbBCqIEGZz9y0R8BeYcxAyCUFWqst+2ki5lC2DLdY-I5oRTrIcSEsKlwgw2AtQVg4hwECrq9YMwRCSKiBUsYikIbABzYeCCK050IqCCnCcE2wZJaqFbq14GAyUQA4CGHoVI2j9h1UCm4mhwaFxdDcQKPIVybB4cCf2cxVj8jdTq4g3BYAZJIHgAIDEODfNwOrCAARyT6J6B4puPlepzCtisYs9RdJLkqoM6SCJTC7I5DyVNl4hwSG1T2+ZTkE4Dm1MakkJbqScD0eKzmayJw3EXOUApFxQ7IrMgKMwcwciRX2IQwW3bhx9vdYO+OidDVgDHYETFAaABebx9EhoyHzcJJDqhImDogf2iIynGRuEcetu5z4tn7YekDQ4T3HiIBmrNObr3YDvSSfRIZEyDAQSGtEPEiorA3EXOsBFTCAJClZRwFRLAHt7WBiD6bcCZvVDmykzzp3IczaKitEiq1JBuFccGKjlhZ0MvyXui70EhRlucHIDtyNHp1VRqDNGYMpPnnEnwAQAAaj7ZBAi0HMIyGxrCQgihYMGGwrhgiyMA8QNSpnAfddJgdTk5O0ezYp5TAQACaGnorKA2BKci1wIVKsiuGrBDt9jsJRecuzoHj0Oeg3RlJZBAxsfaTmUNelqj1B5dZQmBFulAlI8WOy6ImrWYPGBqL4HYvyfiwEIM+B2AjglV4zjFxHRpHmBoexApCwES2GUBwecNhR22FJyjVWnM5tgVSWBuAfXkH+cqH1LG0NNY45+7L+W9oXXYYWAZId-Zg2yLWDkhlshdtKwK2zY2OyOYUwEODCHBiYEwHoAI+jsBQFwOhrYhwCHsMiioY4H6Toy0-oNfYNwALYNGzFm7cXnMTsY-ol7b2cCfY0xZF0Ml-EqI0P-AUBZTlTjZSVoDZWruw8g-DnNsBC1MACDPNTj7rKLEisAkel0jgER3UCAHpw6yRXEDDmT427u05JQz1A7nmeAlloVi15TilGGWPgxEhEFUAQduTMnl2dUVdk9TlJYAACOPQkN1agA1x9xggQrCsBsFEpRhJGEjevOsUKlDWWqML+zcPqsI7puqZ71BVs9RaxKAath-bGBmgKAmoFDiEQE8Y3GPvhwG-9zm1m3RKQvEN+wBkofubrahNIJQHLiF1QIiofOodax2BrXCNPlWOyeuDM-P1Ab8BBp7Y+sN2RlCRuyLyKxx0liOjROPzIWRQ3N6o8ORLwYZ4eSBUZUo4NfOIkMqve08wuR8SxvsZ10T+UVf10eCQmUAg9Hp0aokJIHkQHca2XA7kByX-8DfwQ5AcCKkEGwDAf-d1f-C9e-AvMQENSsLkRQUjLIQsG0MyUOcwLYY2AUG6OwOfC-K-G-UdMAx-Z-PAN-MAD-dgL-H-bAP-AAsAIAnVEAy9WACAm8JBNbE6NIaKI4QyRcWQZQOoXeYoLQS4a2bYXaMEDdUnVFGzPXa7Yg7A2-UAxUB5akG+KkWmGhUMVAKkToEgsg3-Ekf-G5GgntOgvAiAovDpS4R0Qyf2awayAUJwZtYoHkMwCwawOqfhYwKTeeBibNK9DQ+De9TAZjVDSgAIPAdQggJ-OMF-IgiQGAB+B7AIwQMI1AVfAfIEbZDQLceoDhIwEzJ0UQVeAOGwkbC7M-Lwnw+7Pwx7JDJbYI4MZIggJQjQ1QoYdQzQ2I-wQQBIxDTAJI3AdQ1I8EJ0FYdCMEYsY+fDGwEZfIMsU4GfTw7w31BjKdGolDVjUI-o1ACIgg1-VAd-OIwQZY7AadPogYswnMWFYzWaLHIucEHIhAOwWsJ0A5ewLYeYREBYioo4pjWo9YhopolQmMVojQrQg474-RU4lI84icWFQEapC4WwWwLIFlESN9TZYsaPf2KwdhT431JTFTVTDY8IyI4gwgvY4gg4kgJMWAQQPgSE1IjIcwMKdCCwdCZEe4onaAndK4O2U6XEwIfEtTIkrYgElo9gNo0Ezoqkmkuk5Ihku1Y2ZQcQAOHfQZOwT+BKUQMqdhE-SBcrcovE1zNzYU7YqIsk-YqU6kwQPQek6E7SWFGVQWbdfkBwJVFQcwPMOEGY2oCLU-fUxYgUo0k00UoE8UkEjoh+aU60202dSVXqfhR0aqJPQWYwCECKHeRYdhU0O2G0bXCQ8nPXA0wIRLIME0kk6I8kiMwQEs6guUu0+MgCKsZlVeEEQXUfXODQcoSpWoUCcZWSUo-0ioms4MqkZQsUiUqsmsmM5gsPIwACBYYwfkBvGyIZXLA4YyS4cfLcL9TwmBFHC3BrPPTPEkU00k3Y9-eeHwH0b-Q3QQA8xrWM5rOc5YIEDQJ3bZOEKECKKoRYOwm2JwU4PMyLfUvc17e8o8ibE8kMtQ8My86814Y8u84kS3B8mc4vB48pJ0PkPzHs4eXrMEFVCUSwXCGWKiAc2zIsn5akGbObBbIIv4zY08isi0h+KbGi44hbQQX4hBaczxFgxcH7I7YyOwEKEsW1AnFQFXSOHGbIfkqi6bYkWi2kRbNYhBEcsc0Micg4tixSji5Sri1SygXiytWch4vjcNSKWwLUsSwZEsMvKS+oGSqzHXM-RSPAJfRJTAAgBffADylfespIf9aKaSNEG4BxMEMyHCV8s7FYB2U2KTNyuMSXDyCQRZDgR5CAYtFjN2H5VAPAF+Ey9Ch2NQD0pEtIYyYfSKsNJ0y1LIYqj0civXRKvyzACQXAEE-RYgNxfoc8YNAKxAI7SQFw+A4aWsGFfMDrGaQ2MKZy-M3XHtCQZq5K1q56FpDFH5G+UMVMY8cs80mQz-Jgb-XQh+Kgww4cYwhQ9QIFNEKYrYZYF0BVMZGFYZbfUKU4EeU0BK9y5aiQVaxMb5JgTa7axo0c5ozS8MzKHQigvQ063qowu-S6oFCaYiB2OcK4LQNIe422GcOcNEUQnkoCv02zNK9gAgENaPaQZYLaHpQedsz9eYMoYCHdUQQsRQKTEmsmpgvi0yjrZwyWcTeYGwPg+mhPXdaqFQWsCUYQKTH0RfEkbAJDemcgSXbyxGXy5a66rfaA7rCFSsZ3E6cygUWsfkMY64WSxqha2W3y+WxWqkZWmeVKlpUmuTTgXActMlPgFDQNQGlSbapG51deB2MZHUiEYHG4OcLC2oKwFQOlQyGWuWzgW2+21ANqjqry1xVgQ1d1JGizffciGSSsSwYWk6e2N3OcBE9rM2+O62xOwIpWyXX6vAf6ja32jsXa88-a0gw68gyggwuG86hGh-YQa6pwQEbMkuL3LnVlewAKcfdBRQMzaumAG2uuu2huv69an2rajsaC4E9oyG7u46-QwA-uocC6oepG0SQ4d4gCY+HkMO1EcwGWFYQSa4JwKTHoWbKXbK9gMDUkXAJivaiQOCwQT+p-f-QYN2P+r7fq9GYsdeL+bCKEC4fIaxacawWVJPYilNC2w9MB7+yB3+91f+kGjSmC9okB-BiB+mIhnVf+6lIjYLS4MEK4OwOmhAYqxPYea4UwMEKTVyMIYc5fLynymADW2BuoIyaA4waUSsYsXrTTewcLB1P6V1XB3tAR1DJLH6oswNZZbgYtV4KkOMKkAgDe75VmQR-AAxWB7ICPHbYmTucq21F0N3fSHIF0REVefh0ILR0s4R4BgMwNPwqAPAbynAcgPsDYoISgOMf2wQ9hGWNEH+UQYHRwEGTGVeDctQa4LQHxqx7RgJ8xyAAITRmswBju7Qw+6Gk6vu4AwegvTWzkYyWsVcKUewb8oLfIXg0jWsI-fJvxlqiQEgTKwNCAdUVSAISxwZipmIzKUBw68ZkgVSQQaZms-2uwEZfSIaOcL8wZVYWXUO0QUZAhX0vU2zMp6xoZkZn1bvJZyZtZq50hsG8hrQ+Zr-e5h+R5pLTWuNEGMZfIUCOoXLM0SwFhQWHeDw9RiQIgRUXsS5wpzy1WxfcRx8lguseB++-mfaVGgiK4PmJwpNPhNEM5ymcrWF08Up3xoRzywJnwwNIxkxsxpu9a2JpUKZ6lq5nO1xusTLUwTtNJ2FBBuYMzTBcQ4C2zCl9lhF-x2l3R7vEJsJ+eTKl4OF5Ub50sxVmBtF0y7IYyYYpYbzcFGwdhkGDZbfJYblJUvlc5vXKV+FzlxFlK4p4te15UGVnanYuZg6o6mp4+6g0+8+gvQwTWl8nkQaNQAhQyYuwiTswsUQe2cpMily8ltVqlgp2VlKm5kMCZwINl3sDVz1s0yp95xZ3N7-NV1Zx1mxnVoqyy80YCeoDraaavTkDFt+1VFBqTN19NwZn67Nz51Vylwt55wE15kghZri8t-NqkKtjN5LOdbSWw6cSGTxkeGyPFiELkOKLJvMOoWaiVvXH-ZJIIGhIts8mI1mNyCE9qwAumBrQvWttGLEsGQaIo66IyPZVlHZJ0fIUSayLYTeKTY9hpahdmUd8c8Mq90tXo296g+9ocR9tCjpLlQ4aoQffhJc+4tE8id45EL8aGbt7gI47vRnQtIkYtGD8tWZyskgTNW7eLAAOSLQADUy0F24ykhkRXHbQiwFxw2US9hWstMLRTkEpHZoW5MSOoBJcAhyOSmqPjxd6wz2i6P2AGPnNmOKO2PMBy1Uj3SzsR5wdk0lcEB9hshpBjYWaIR-nAM5qyiAyIK7ts9UBc8ELIKC8aP39wH3OFMq2c9qDfP4sCr2NTLuPbEiMjIZZIoXRq8eRwZIQUDNBgRFw5KguEduinsXsvPiCfPbzMvkcMxYH2SwZTpb66hQJqgqpDJ+4+Rw3zO+HoXKL0v6NJ1jjCucuJA8vELwTnsiun2LitdFhtgHEjh2ENV11GTCI4RLBzhEScSmvHOWuUkCu+vUcPsAH26YjuvIKuiqiAiXtqy0dtXkPBvNmI3Bb7BVgDszIJYl1lBjgwoVgMDFuKjlvEcVi1v3tPtOudu-PevDvvuTvub0LuPopTNs48hNyOnWV5BSu7DNgNBb737XvfV3vxd6dGdVNfvZ5lv-86dH5aTBizBcmbYAJmEetgZwQiYM4bQMHk37PBy0fDcgg6dZO3McebzEKMfCf+vTuYSHZJpWEKJlgsFTPFwrYtBchxA1BzgZRUe82WeTczdAj7zOe8fleIT7zUjkRwYWSqb93BY8XRB99unCJsiNgD2ibCyluWfA9kcsB1fbz7fg8Z1+f7Shu0RCJTgJRESrACYnAgQMgX6JItFu21axG-QPJQiMoyaJHkQeIR4tdMtsh9b5gMnB8dMNzyI7PD2FqEYUWo-AiXkHlrwBuJwG1E-SJB42GbAYUzRM+GaY95eU3JWI-gwi+Y-S-DBy+l2E-zpYVFxa+0-CjFh5wm--Fc-rf8-2+AhO+S+yaxBe-epK+B-k-h-EC0gx-ruo5J-w-C-PKu+yaTBl-Ar++k+a-sE0+jgfZx-d+c-9-1b5-Y+qA5BT-EBV+L+h+r+zIT5t+s-m+5tVvna1n7P9S+wgd-ggE-7V9v+qfX-raH-4T8c+VvW1jPwP7R8F+VAdQJAIbQ1QZ885QWFcEE4nREQ7BcJLx35jghJkwAtAU-0P6YCFAOA9klyHwHb4cmxA00HvhJa79gE-sbttgDtqZsRGs-YRtdQBxLpNgVNUZMcHTKFhygc4UCEqW6S6kyWkrAQcex0ZBMFWAaUJgA2VaGN1BmrHQXgH9pLBfsiabDFDyyDpkEBrxMYtlkoj8DBBQzeVjJ2cgjNsAfQZlmtW+TkBDBHHJ8hwyODbQbiUcc4KsH2R74eQklMbkyhQGqC7W-gn6i6wCBEB-BnXA+r617on16m8hB-CYCabGYiM0XMbqIH2RyCcmi4cTJsClhOCNBATG5mM1zYvB0hW3SsqWynbLMH4fg5wTnXhCxsZGVAsxBFFBD5ZV4j3DLA1RoGHo0hzg-tqMzubNCehx7CDuDX3qdEPm07fwSPRuC-tsix2EyByTsiLAVEHISyHSkf6R9aWsAGMBwFdoydT6PybALAgyG3CTqwBJgM8NrKhhBAcYSAFSmK52B2Cg0IbOMjyCmhhQCeCGOIEjSIgvclwjvtcLeH3Ce8w4J4S8OU4TkbhaYM6mfU+GwIkiPwv4RgEBSwNTokgOsP7AwzSg8g2HA4FYV0wQhxM3uSTqAOuEHVUR3yNostQyE+se6MNOprQQaZIcQeaMDRENU5RGZbA85dhhtnKo3BIYpwNlAiLn7siu6nIgINyOEarDx2mQ-kbUxyFCi8hjTWBoQJ9gjF1wNgOwMXSOzSAE+JGL8M-TqH+MhwV7XKvlR5GiMWq11bImP0cDjcKg5mUWGzn3xKAds9uYyM6KXyujmI7o8dAE1cGaiBBmaOMaTX0FJiqQKYlgPlUvrsJr6SgI-LIFw7KIjg+WU0EMkt6wxJOSQhrG6OzHxi5WWgh4aEAMapiMqWVFsbNlTGX04QCDUQLjUrBG9jodYSwNIE0ACxRIMsKMQzhjHBh6xgQBoQsJk6DtlhLousXlRPJtD38HQz5t-n8HTxZxggecf7R8THwQRm8SRiEhKqSwBx9UacbWNjHzjNB9LUjtcipDFp5x3g5uquOjHricxtjYwCYn2BeMI4thWUcPi5BMp-0rCT6tWLmEPi5xG4hcbSxSE-iZxf4zcV63aF8ij6sNXIfQTkCFDCKdhP9AvWsRDE+kiIIqLkGRCeE162or0ai3d4r8vc4MZEmoBKE5BhQX6c6BjT+hYlaJTXeiY2JfEPDCGbY9MT-W7EASrY4gWFJGwYQOEP+3IFgdiSyb8RpaQk5OilUTHci0JM7cJscSiY05YmAQlgqn3zgQglG7uE1sKGNgeleQKZdnOK2n6Honk2k1qvoKaFdC3sdtXkQ-E2FdDqydtf2mvCEj8ghkUPKesUCBz-hagpEBxOCHOzTDe07k58RMG7yKV54Tzcxr5PID+0LgL4GWEqPEwyxhQOQcWILDzjdxZUdEjyY3R8GBola-kqGtkIDb4S8CCga6poDKAksoQNgUCLLHKlrxwQQ-N9FaJcmoC3J9E2camM9EiDPKPo-MECM-DRCHUwoYaNATUDiAbOd1OqehMfFIT0pKIqSZ+MkniTjxtjY7DxlhSShw2e2Aahumtg8hiETKY4PtIQlzSExTYzURoRaFzCDJ5BSJtE1gCmSCpFkI4CFAbzFhCIG0hvuUnvrY5NAH02aU+ITFLic2Pk+up9M-FbjO6k7XcUrQPFXsjxSEy+gnnOCjQb+VgUCJCITzcFWaAnJYCjIwnISdJP0hrAII-FISvx61JWhsxkRhZ1E5mawDCDnBTFIQxwFQPIgbQszDpHo76aJJnFcy2xGdHqtnSukOx+43BZPKuDFkmsgQ-SFptN2WByzEJCslCSy2uTd5mpeMqplkIFGGj4axo2ADIE1pb8NAX4KWfYHqBiygIkE9YHJK2AlEUpwDGaazOSFWyW629c9sxU7qtTHZ7Uo0fQTUC-NQUVAoODYFxhiyjI6DEaMsERSCSUpcnKXK8mPB+A64gQR4UCTiawNHEMUPOPXh6n4wW0dqYBKZhsCWtBoU-KaQWlLkkBKAvgHUFXPdRBAPIueGuWZJ5rukHcigg5u1ghHHRBA8IeNphAwRe4cGLlMgNgE6BDBA0jOSeZ123m7zhghPMuddX6h9ZhYNsEluw1SALB4pO01rMdkmmUxj5e80jlLkPmYjwy780+TPEEDnyyRGTSKCZjBAL1+ED0qAbUDKSCwGEFU90AtD-n7ypck8L2t3lPpHyWkJ86ggAtPoj09IqQRQELC1KmceUQIYBCKFIgkQe5b87BR-Jk6M40FmaPRu6h1F70tCf83BbPHwWwMRABwGSGKBFYyVgcIUCyDYhbJ-oHUC0U+g8E66RZZFLQBAGST0TxBIg1KawOUBWAyR04rCHkjCEEDEJ14cqZhL2UkEyL3Ucin+e0QUWWKlFKiveQ3DoAaK24i4CWCCIqow9igggdJr+1NCrBx8svG4AtGgQxg9AgaSeBkgQixygGkS+CBgHniZoPAQKIYlUC8YOxLeywbnLr2jhdwpeMxWhfJFCUvYIlcEaJewpU5aE4l0SxJewGSWmjwe0oJPNjmNrc4zBwIAaeIHqqFKWwxS8JRgqYgsQMhgypgLUvqU4ChqG6BRI2yq7Aw1Am6QaPh2yDAgelB4PpXoxGUVKsRIysZegB9EUL-sNgYCbFJjY9lkCTpKPAmxCWgVA0biVSJ1zuXsBdlpIyAYVMWX7ArQxMG6uumUAidJ8XjCHCoKKU3Lu8jyrZeGUeXPKgU4geQRYFl4CJ5Ut3RdINMLBGRLMAma5WEsDSsx3InkGJZUxxXjywAUKskWEjMzWQXUU0ZEMDlAVlAWSGQQWHCPemlF1l3eQlXivBXtF2VlIElZAIM4z0nE4IlYKPVFimZ0iNnQUCVAW4uVWVMnFSBlDxCHy7Z8qzKDijjC8rmJSQVeF2X4SKALAZqLQL-1+UD5I2OQUHEXPs6yrNQ6UK-N-NBpjsOFEgFVf4DVXEqkley00WYG6Z1hbAyXYBKg2npnQTW-0VpgytfnAqsV3eZaDgD4Cddo12APgBqtFE5h8wOMAUHbi7gKoCIGGYxcAnkD24bqmKkpVGs6icqtC8axNe6peWaqP+0UNNURg+W6YY2qNQ2aHRIymBpVlqkFQ8OjVeU7ZGKFaEmsKpowtZ44ykRljgJQLrCdK6GCoGIoIl4hEa4tT2pWhlrL8vaodaFyKq9SZ6zCXJK4VM7kiZwjievPICLX9KZO29V6J1yvX+BN1KWCcABDH6SxjggEHqdZH-jyAtM74YBEfihBArel3apMcHlJrWKtCt6p5VWqRomIhor6-NaJSWB4t+hqNTYGkEyBs0WVQGhfJ0GRimM7Z2G3DfesXa9QxImwE1Rli2gChTWiJdeEP3RB8Isc56hlojBw3Ug11BG6kERs457BDkFiXIK0whAixgYbDMcdaHQiyIrKMi0RGAAQD29GY1IBACzDZj3Cj5YQMGmrHk0qElN7MVfGghHjSIpwRSf3sOIxLgwYYfGBldcCk3sxZNGmjWFSEU2swGFa6geTPEBJ2amY2msRJAIpE8k7GByXOaYDsks5JG03FhJvPs4sZhgtmhmPZoQDPxvQds1zepti1Mxn4IaSwg9RSZOELAtgbiTkF5zzl42gSTSS5Si0ya5NcWhLd4DA3DM1N7m1LZrHS3FczN4gSRtLO0xhRRYNQLstuB3jhJSWS6i9QEGvi3x74hPZ+BkLSSdAOAR4m+BSkEDNafNPsOcPtEoihU8crKK6L1qqkul5AEnGVUBtG0LaAFk22rbAGm2zafaC2pbTWrM6SAjs1C32KqiUmsFtVqgZRvagZpMbu8+qDWLXF8aTBfu1cMABXMB3cAuNgQwQFWHyTugfZgmxwK9obz-g9VxiC6MEsw2RqZOf2muMEErlA7atngDWGDvri4BIdLBaHcNzh6MqHYCOpwL3DDTnB2EaOgSKstohWqSUsCNWAgiPkwI4ErGcnTzTHq2BCsiTP9sYHwy-Ku4eamvnWB+0ydOd-OnnbVsV3c7KAgu9Cv7DtG5y9V-SX1blnhC1Aqh+kQeIusA1Y6GcVCM9p1yzQ0Yz2GutGGdGkRF0rAKDf6PrUBZgxbIqZbBKDHl2W6yAYHYYGutt1B63VdSj1ZAN173UAQS4GETJFFg+kykbKbEuN0G3m7l1UzEROBztk3xpNDulNTIkUGXBXCrWTuMohliGyQY-omSHAv9157wOtWhvcMAL3zpQUcVPIJYEIgnBrgwYoYhgyhBUbRCbO4BkBtBn6J8VczadOHvGV3bF0RdGSP8yloC5iBuySwluEIS-pw1Ge4bePp3r2rIO+9afa3vtJwopog09Phg0RDWJ8wH8IEfsHVwAa1lWGtxHGE64-53EJ+kjaV2Kq8hQo-mYusEMARypZYn7KYV2ot0f639tWqAzPsj13aCtr4TIKFS2Dm8rxsuLEpajv2E1IELsDQiprtmTxXY7AR6PNu7C6Cp5musoLtOwQkSAW35CSnYyAh2Ao4Zug8HgeeQ1aD9awqpXwGIOkHb45B9yqvksJ1A8EZrfIAm06aOgeyQLG6Hq1K32dh0iWrCe-l3kDgBDnQIQ7XKj0UiTaWgN9hLTmC9ZXGGwZJgvUtidrIsyhrg2Q0dXqGwAmh7Q5Qcd2boQomwM2pvj-S9Yn1FoCENlhMg2tKYsyE9hdvSSZICDqh4gkmE8o+A0kWaMIF-q1WELJIhYDw-CmsEtpXGm8T8juFigLQQjoHeIxEe9C1aYjHkOI+Edc1JGBqmWi1NZDzD+iaV4oSmpjStDQx+yLlQoykk-oZTCAds8o5gGaSTAajDxacEP0Fo8hX1xzdhkRGCoGG36MMtg7RG6PX4napR7g+O0GPDGIdUGskV5lsis1SgxkbkBFEhBVh-F9uTA4ociyrH8q1IZZJEeLYxFBjiyJUI8dGN74pePvHGJRCUCzHSwvELfGYg3SxxSidxpZIDtsMvNHVrxyE4kb2OQCygQtc3iDFEolRZjACMfjL3ZLZ9t9B4ZBZ-I1GwAiVAQboBgHkWn5CTjC7+qPJJN4qyT9i3YqotaTOKJGLOSoP4qOBHBxxBiySNbE4LyAS4LTdPQSfoUojGcjw+k7nnJNKdNjjqyLNSdk5SnSTsp5RcyccXasQ0UjfdmZk9nHJiBFgYbukeuiWtvGdwODvAGiDnI7tggF+giA7h3Vu4xdTaBHXTVGRt8MjTVKURSi2ns4vicFKdHKjQo946EYxf7HBEz0Lg1A+zilCuQ3JXVVp4dXrFKTg56UoxJnZFSeKQhagrxJEFjDHjrqsUiZ203FFhU15U+fGsyB1hijvgtyJsfE-NWHB3aqZrR6mnCJyyspTQiwPNXyH7H+JGzZ+aQi2YLlMk7EjKW+hwNmgIN-mNQWvdZEwLoo8QOBYUS2bipjmI4sVXkM9XQb8wzYY3E2IuZkKmTMZDEDiA+qlTMNr61hCGG4vECIFCpgFfOko1AgvdQ50hS-MAT0S4BfhIiQQEmGoJLMzzLZlmglwdQ8hHAcIsyPUF6kaBKR2GPhHJVW70U1KyROfTky0wz0+Iv6C4PhmVRhUeCBciHHJV64oWQiaF5NTCQ5BoJcOYVGRl4qMBEVWc6agTB2jkqClCSFF5M1Rc2ZKMKgSDVGsXU7kLkR4UUASPZAV4BBBSxpLi1usd3vFLORySrrtAAhulAQYLTrJlmYRyVhysli8-GQZrrw5e3qguaazu7Yx9gmNKaiPpAphLasyFQ8st3YDoXCI6JLEqRWUD60oumGaaKDCR7WRljDnCojpVmx6V6YZF+opsTn2MpzACUFS-FNe0XKLKQyXsp+C+pJVhGd2nRaCgCQPV202QCsHmKhQNRo2a+dK0MxJpZXZwbEuwGkEe5FwqqgISC5am5AM0bjrk3tEtQCbtVNC+iO7aMgCgVdJZQ8SWeNUT5qIQQ4Qr0uVcjk+Do521LK6PRqsAIoQDKHOJ+hUSYwY8GWRHYFfKyVXKLUqKyiMmYaYQ2C5ELM3nJdIyRIc2ZJeoqAVqr1k6i1ianYWOQ+y75+7Y06cE7i8sFz0LK2svVrp5SG6B17i0uzdC0acmKBW0KDF-4jTQQq8EuDYXusr0QbDtHq7vMwD9WBEkefdldChTroCt0MUBPzntw4GEhltBOo9fRsp1cpW9Ba4dZX6dxIJGuCUIqPXR74f4fSdRJbw-pf0BgNDaBi2aTxl5RpAS2wkFuHGCEj4Pmc-TWAGY0sPIWVtGlyHN5tNpuprGenryXBWhdM7V3uRIA9bHS9GnYwxhoRMb9XruvEJEkNkq760bYbWMQh3FQKK2rmJt7QR9jwBVWzBTR7-sl3F6l0dkvDa0S6CsMdWjb1bIZikI9ZVX7AmF5EqYhry2p4GPSOBYDh6Zu2nWrVRoYsJ8mFsqrnIaoF0rsKAR7iJGR0LZDzMbAeyNlyVmm2NuZWmbgVdm0ugjZF05uxdGOomXcUOB6gQcbtg3ajse2ZOjLakFbcr2NRZAnWNDeL0XCAgocUoNI1vkHuUtG7Ikvo5qGMHnniNSQCaGUHv0Ax-0KgfHM+l96yp-01gVe9K2HtFMrZJTHtrHebvKSKghwUsD6qCR2Bsl6DcJK+fOCpXr7DredvMOLQri02Bd5+1AKXJv2A7c6pttXjyDPF0EQCVaxoGA5zIUkYetc0FkjhAHtpxyCsIg8UDjc5E1wAK0R1fxtciT8nSjux2isGxussUDBIB3TJhprCFKy3qdbS4s8XObnfPEmbksXFMiKqAoJJX8zsJq8MK04JrltCeKW+jPCirb2PKVFb0B3YoODfjLCObrv6cJBxI4EzcuywCIBERi0B7XFHb3FngD3UeCOYSWjnqW-SbaEJ10t+kiKtbWk5BuHyj1bijiB7RWrY2jlBqQOBZbaZILAtfVjm4h12beFj5R1Y-W6fY-HhyHqYE94xY1MahOQosNGkRmPonzPZRxj1k6qZ6Hld++swzrC+9uc3CaPGwlNDB8gj8kJnor3yds9GcbmYp7FZgLGxd0XlgupTQvFhYTanjyCmSlNzm4HLQ4RJyI+5AODgnIkPINFAkjP1w6dVIZ3dhd5BhsbkD6OHWtkBzn92muAmFbGMAvTusyJKJ7QKuEYCMoWV1krFYCsx7WE1ZqYvkBmgRnMs4BvPjMJrGeUVbnZdNZ41sgyxTOL88GGiAcBJohoFNhp2oPgkb2URWrK26-ZfpYWagMaQZBkFfYYZ-7UsAe3BPqFwvA07gn1H0H6t5gnQQ-YEG6DKmDInC0gOtIk3fAhR7xlsnwQ-f8FW214ZUXJnIlOj7JyItuXM+RC72WZmXWbDGSuPZeQO-oxEduQm1mghQRhmzEGFVJxasIoXkhC54iOVtbOLow3NYDDLDGxd9mzhPNeWPFBWSVRRfS-MiNYU6p0RYAehytv1clhVAosQQlk1DiIhw66wS12qJXOjytRPzrZ9xHMCcpFyFVaNqLG-TyjjgsqH+IOfJY1jUZR0puxo5budkZIXKB7mN1e2UKeI4XBVFZThAG3KbXz+Ccm4tnsylZW1TMdGCQlx2D4lrWRC4SMiJ7MWE0dm5DEIj3iK3DYqt5vf0Zdj5xhdtOMcA8OpNzOyifqCJXYRo1syCbmF-UN7dsyc74rpYUm9ZlVXuMHd05PIhbmcJDYtG7ItNGxhP6mzvaWYUu4jmKzN7nM98amKtvcYpezKWN+IFzd2M1bdVSfBYRLfQvEh5b69yy-+olM0JOM+t5A-uqih68lmLCx7qKg9msEgcfOuq4LILU0pqbmx0uxuhv2veA00ilAtCq2Iv0SfJNh9IJcYKLp4HtN8pJKpLPLgfmCC7KNirX1QQBS-42R-7coi9JSQmdlVYybnCbCRETQHZIK1bgtSQdCXhx88lrusZdtRa3mLfJ2IfeT6biSFALAwWxMP1s92UWEmceIls2bKUliquaK2tD3GkZTxim1WThASgeKdgXeFldPK1K2U1Lk8Qf-DMUH1SfDDvrWOGo0rkKYg3DWUYznz1KeHPll9vNn1HqAVRO3bl4LUPDV7VDj0NdupZ+QHJ2h7C-myIvdLAd5R-ypVX6gvOdnEbqXBQLhYtiFhIRBNYSXQ56H5dyPd+nKh9JarOO3CnE6C832iX1a4HQxaZwkbwXiO3V8A86SZPkzbGcu8WsN9KJliK6JCKfVKBESr53dAN8NtDfwvK7nLxKbfHcz8vUrg5pZ2tByp-DxdLRICCNrASFwN1s2V9KA8YoXP5ALdyYnWDeZ3l9xXZttEqQJRFB9Qa72jNu8A0gaQYR79fUqDFwdw+ssSKJlEhwXAx5GEuZqIHkOvIHPimrscwwxzQwWHJAiqRUkhWFjjFqxU+KZQU-JsoWV0ccJXjZIzu44vDZGcB2T9jp7ajLeUT6JPMKTp7qO7XGkkFQ5bQncyQ2LMnu8pzenWPJqUUUUYBSzWi1hmvh0WD4tgBi1hOvFEpSwKgtYd6v7uqUS-kfAuFgZSq0S0ikdxtcNH7G2lCnBzVq2ACMttOZYnQHy8iERiIRI6dMkE2NlygIR8DMdmex5db87ILpu5DR8yD8sATzk81ZwRqPXrchErrfwCdeDXejqfg+Iso9CMCPZze94CFwf3c6qyi4prf-L+2P+s6zCEu7uQNDpTNiiflUunv4bRWut+uXiHNMkboRA3jZqCcCfJNG1reIj6Lfvan35-FF5wiqBvHfR5XuEoEd5E6uf3RBp9+ldPLXBFpeWGBgslbcO2V8MEMa6HbIDLG3Ddb8h9THLE8zm4ATFsCHB2bIoKYy6Gs3RbKtSoRzcpraDW-K9pyCMwUA-ibbOEMM1nBeLIh5hL-FWjzQpuq0oAa31ftHAdBElh1SMr1RVDgSkTV9Qsdjyr9A0Y7XG1TtH1GcttfY4HkFHUBo2GhbuAijZwpQIESNh6nHfUDQcdc9Hx11ofSxmBdkZ4jIcDoI5X4te4AznLErQcIXOB-dVXXgRKAaPzhJf1GsE-A8tYGHTgThRQAywqNRjQQDSOK3XZho-ag3XAmdDLAqRE9DAJ3RTEY73Lp69bPWGBrfEqg0RiPf6C9IK9M+1EcfeNB0kCHhafVr8KvYhy9IxkNIGsQ40BtA5Ri7aRXMCXgV-SR8ovZeW7NE0e2EcQKgWZU4RKRJX3BBLIAhA8dSiDg3uFZA-LFyB2tUaDGp9mYZBBRdkPiB94FoGwyADtfeEFHow7Mv1ddgYetFitO0B0l2QCjTylCNijVzXv90A6cAEh9tbTE2BVSEpG4wnERfQqhZEUUxWMKghpF6Nog7IJkQOJTxm5czWM4xtwYLYIRBNIYcoPqQUke40zEoTLIK8CxuD0mAgXQHaENVBkVuB7N-RLHFlRiAsUx3kGFZUzpNVTFoCytNMO4itEjZTuXYZl5MwCZQ0jDLAOYg6VwFcAgAA */
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
          {
            target: 'Sketch no face',
            guard: 'no kcl errors',
          },
        ],

        Extrude: {
          target: 'Applying extrude',
          reenter: true,
          guard: 'no kcl errors',
        },

        Sweep: {
          target: 'Applying sweep',
          reenter: true,
          guard: 'no kcl errors',
        },

        Loft: {
          target: 'Applying loft',
          reenter: true,
          guard: 'no kcl errors',
        },

        Revolve: {
          target: 'Applying revolve',
          reenter: true,
          guard: 'no kcl errors',
        },

        'Offset plane': {
          target: 'Applying offset plane',
          reenter: true,
          guard: 'no kcl errors',
        },

        Helix: {
          target: 'Applying helix',
          reenter: true,
          guard: 'no kcl errors',
        },

        Shell: {
          target: 'Applying shell',
          reenter: true,
          guard: 'no kcl errors',
        },

        Fillet: {
          target: 'Applying fillet',
          reenter: true,
          guard: 'no kcl errors',
        },

        Chamfer: {
          target: 'Applying chamfer',
          reenter: true,
          guard: 'no kcl errors',
        },

        'event.parameter.create': {
          target: '#Modeling.state:parameter:creating',
          guard: 'no kcl errors',
        },

        'event.parameter.edit': {
          target: '#Modeling.state:parameter:editing',
          guard: 'no kcl errors',
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

        'Prompt-to-edit': 'Applying Prompt-to-edit',

        Appearance: {
          target: 'Applying appearance',
          reenter: true,
          guard: 'no kcl errors',
        },

        Translate: {
          target: 'Applying translate',
          reenter: true,
          guard: 'no kcl errors',
        },

        Rotate: {
          target: 'Applying rotate',
          reenter: true,
          guard: 'no kcl errors',
        },

        Scale: {
          target: 'Applying scale',
          reenter: true,
          guard: 'no kcl errors',
        },

        Clone: {
          target: 'Applying clone',
          reenter: true,
          guard: 'no kcl errors',
        },

        'Boolean Subtract': {
          target: 'Boolean subtracting',
          guard: 'no kcl errors',
        },
        'Boolean Union': {
          target: 'Boolean uniting',
          guard: 'no kcl errors',
        },
        'Boolean Intersect': {
          target: 'Boolean intersecting',
          guard: 'no kcl errors',
        },
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

          entry: ['show default planes'],
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
          invoke: [
            {
              id: 'sketchExit',
              src: 'sketchExit',
              input: ({ context }) => ({ context }),
            },
            {
              src: 'AST-undo-startSketchOn',
              id: 'AST-undo-startSketchOn',
              input: ({ context: { sketchDetails } }) => ({ sketchDetails }),

              onDone: {
                target: '#Modeling.idle',
                actions: 'enter modeling mode',
                reenter: true,
              },

              onError: {
                target: '#Modeling.idle',
                reenter: true,
              },
            },
          ],
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
              actions: 'toastErrorAndExitSketch',
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
        Cancel: '.undo startSketchOn',

        'Delete segment': {
          reenter: false,
          actions: ['Delete segment', 'Set sketchDetails', 'reset selections'],
        },
        'code edit during sketch': '.clean slate',
        'Constrain with named value': {
          target: '.Converting to named value',
          guard: 'Can convert to named value',
        },
      },

      exit: ['enable copilot'],

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
        'Select sketch plane': {
          target: 'animating to plane',
          actions: ['reset sketch metadata'],
          reenter: true,
        },

        'Select sketch solve plane': 'animating to sketch solve mode',
      },
    },

    'animating to plane': {
      invoke: {
        src: 'animate-to-face',
        id: 'animate-to-face',

        input: ({ event }) => {
          if (event.type !== 'Select sketch plane') return undefined
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

    sketchMode: {
      invoke: {
        src: sketchSolveMachine,
        input: ({ context }) => ({
          parentContext: context,
          initialSketchDetails: context.sketchDetails,
        }),
        onDone: {
          target: 'idle',
        },
        onError: {
          target: 'idle',
        },
      },
      description: `Actor defined in separate file`,
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

    'Applying sweep': {
      invoke: {
        src: 'sweepAstMod',
        id: 'sweepAstMod',
        input: ({ event }) => {
          if (event.type !== 'Sweep') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
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
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
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
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
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
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
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
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
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
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'state:parameter:creating': {
      invoke: {
        src: 'actor.parameter.create',
        id: 'actor.parameter.create',
        input: ({ event }) => {
          if (event.type !== 'event.parameter.create') return undefined
          return event.data
        },
        onDone: ['#Modeling.idle'],
        onError: {
          target: '#Modeling.idle',
          actions: 'toastError',
        },
      },
    },

    'state:parameter:editing': {
      invoke: {
        src: 'actor.parameter.edit',
        id: 'actor.parameter.edit',
        input: ({ event }) => {
          if (event.type !== 'event.parameter.edit') return undefined
          return event.data
        },
        onDone: ['#Modeling.idle'],
        onError: {
          target: '#Modeling.idle',
          actions: 'toastError',
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
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
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
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
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
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Applying scale': {
      invoke: {
        src: 'scaleAstMod',
        id: 'scaleAstMod',
        input: ({ event }) => {
          if (event.type !== 'Scale') return undefined
          return event.data
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
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
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Boolean uniting': {
      invoke: {
        src: 'boolUnionAstMod',
        id: 'boolUnionAstMod',
        input: ({ event }) =>
          event.type !== 'Boolean Union' ? undefined : event.data,
        onDone: 'idle',
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Boolean intersecting': {
      invoke: {
        src: 'boolIntersectAstMod',
        id: 'boolIntersectAstMod',
        input: ({ event }) =>
          event.type !== 'Boolean Intersect' ? undefined : event.data,
        onDone: 'idle',
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'animating to sketch solve mode': {
      invoke: {
        src: 'animate-to-sketch-solve',
        onDone: 'sketchMode',
        onError: 'Sketch no face',
        input: ({ event }) => {
          if (event.type !== 'Select sketch solve plane') return undefined
          return event.data
        },
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

function listenForOriginMove(
  args: OnMoveCallbackArgs,
  sketchDetails: SketchDetails
) {
  if (!args) return
  const { intersectionPoint } = args
  if (!intersectionPoint?.twoD) return
  const { snappedPoint, isSnapped } = sceneEntitiesManager.getSnappedDragPoint(
    intersectionPoint.twoD,
    args.intersects,
    args.mouseEvent
  )
  if (isSnapped) {
    sceneEntitiesManager.positionDraftPoint({
      snappedPoint: new Vector2(...snappedPoint),
      origin: sketchDetails.origin,
      yAxis: sketchDetails.yAxis,
      zAxis: sketchDetails.zAxis,
    })
  } else {
    sceneEntitiesManager.removeDraftPoint()
  }
}

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
    maybePipeExpression.type === 'CallExpressionKw' &&
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

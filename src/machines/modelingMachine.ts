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
  insertNamedConstant,
  insertVariableAndOffsetPathToNode,
} from '@src/lang/modifyAst'
import type {
  ChamferParameters,
  FilletParameters,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  EdgeTreatmentType,
  modifyAstWithEdgeTreatmentAndTag,
  editEdgeTreatment,
  getPathToExtrudeForSegmentSelection,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
  getAxisExpressionAndIndex,
} from '@src/lang/modifyAst/addSweep'
import {
  applyIntersectFromTargetOperatorSelections,
  applySubtractFromTargetOperatorSelections,
  applyUnionFromTargetOperatorSelections,
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
  retrievePathToNodeFromTransformSelection,
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
import {
  getFaceCodeRef,
  getPathsFromPlaneArtifact,
} from '@src/lang/std/artifactGraph'
import type { Coords2d } from '@src/lang/std/sketch'
import type {
  Artifact,
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
import { uuidv4 } from '@src/lib/utils'
import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'

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
      type: 'Select sketch plane'
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
      if (!input) return Promise.reject(new Error('No input provided'))
      const { nodeToEdit, sketches, length } = input
      const { ast } = kclManager
      const astResult = addExtrude({
        ast,
        sketches,
        length,
        nodeToEdit,
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
    }),
    sweepAstMod: fromPromise<
      unknown,
      ModelingCommandSchema['Sweep'] | undefined
    >(async ({ input }) => {
      if (!input) return Promise.reject(new Error('No input provided'))
      const { nodeToEdit, sketches, path, sectional } = input
      const { ast } = kclManager
      const astResult = addSweep({
        ast,
        sketches,
        path,
        sectional,
        nodeToEdit,
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
    }),
    loftAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Loft'] | undefined
      }) => {
        if (!input) return Promise.reject(new Error('No input provided'))
        const { sketches } = input
        const { ast } = kclManager
        const astResult = addLoft({ ast, sketches })
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
    revolveAstMod: fromPromise<
      unknown,
      ModelingCommandSchema['Revolve'] | undefined
    >(async ({ input }) => {
      if (!input) return Promise.reject(new Error('No input provided'))
      const { nodeToEdit, sketches, angle, axis, edge, axisOrEdge } = input
      const { ast } = kclManager
      const astResult = addRevolve({
        ast,
        sketches,
        angle,
        axisOrEdge,
        axis,
        edge,
        nodeToEdit,
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
          | Node<CallExpressionKw | Name>
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

          if (extrudeNode.node.declaration.init.type === 'CallExpressionKw') {
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

          // Check on the selection, and handle the wall vs cap cases
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
        let ast = kclManager.ast
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
              new Error('Failed to retrieve edgeCut artifact from sweepEdge selection')
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
          return Promise.reject(new Error('No input provided'))
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
              new Error('Failed to retrieve edgeCut artifact from sweepEdge selection')
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
          const result = retrievePathToNodeFromTransformSelection(
            selection,
            kclManager.artifactGraph,
            ast
          )
          if (err(result)) {
            return Promise.reject(result)
          }

          pathToNode = result
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
          const result = retrievePathToNodeFromTransformSelection(
            selection,
            kclManager.artifactGraph,
            ast
          )
          if (err(result)) {
            return Promise.reject(result)
          }

          pathToNode = result
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
          const result = retrievePathToNodeFromTransformSelection(
            selection,
            kclManager.artifactGraph,
            ast
          )
          if (err(result)) {
            return Promise.reject(result)
          }

          pathToNode = result
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANmEBmAHQBGAJwBWABwKpSqTQDsUsQBoQAT0QAmdQBYJYmmPVjDh4YsMKZAX2e60GHPgIBlMOwACWCwwck5uWgYkEBY2cJ5ogQRBNRkzOUsFOTFFGhNZQ10DBBkZCXU7Szl5KRMTWxNXd3QsPEI-QIBbVABXYKD2EnYwSN5Yji4E0CSUqSlDCQUTGRpZefV1GWF1IsQxbYkTOS0FDRo5dRpDKTkmkA9W7w6A8m5hvnZR6PH43hnU4QSVYWbYyMQKdQKRy7BDCfLSYTXQzHUQmJQuNz3Fpedr+AJ+KCdMC4QIAeQAbmAAE6YEh6WBfZisCbcP5COaKCTydQXHkydRwjYw44LSz2YQaWw5ex3B444jE4ZUl4kIlUkgBbhBEJhSaMmLM36JdlSSHmVbGZY5NLCBQw040CSImjKUrZFSy7FtAgAFVQUCgmDAAQwADMSD1MIEmLTcMHydg2AAjbA4dh6fU-SZs5LzNGHGgSmTzCG1Wow+SO11bMQmHKVRqYuVtCTYCBBggAURJ1KCAGt-OQABaZw3Z43JZFSQ5g4RqFSGZbImEVMqQyEQyFw+a3Jte-Ct9tgLs95WwAfsYdUKRRJlxcfTIQNcpQ23XflKeyFfSIUTTuQAXMcIXDIThSJ6ngtm2Hadh8VI9Bgo73qyE4iDQjqbLUpiFhYVgmDChhWJIjhXBcci2ks5EQY8UCHh2ABKYDkqgmCUkhLJTPwQiaOo5gXDcCiiMWVjCDCYilAoTrkTYPEVLU1E4nRx4+AA7mAYBMOxRqPsk1S8YWPK1vkyLGN+xTXPsBaLjYeQSiYAoKVBR4EAAMqgoafPQYxjihOmCIogJpFOciGDI1zbDCC6SC6qwmNstaKGijkHtBylDlgmBaQ+XG6SsEjGIWyy1FCKiiT+CCmtc5R5HFTibNs4F7pBKXOQAYqmQaebeBrIZxMzVI66EZLIlz1LYcgEascgSNUshzvYAFWMltGpcQQ6qqG1JZb5OVoZIGw4QKpphbaBGLtN8gSWK7qGMtSkEExioSEwJDqkSSoSOQVJgEMIxed8Pl9dxxYzaFhmmmoxx2uVYhSLaM2lksKiWOCd2rY9JLPa9qr+NSEiQBw21A8k1hrsYORQ3WhFlcUtY8ocSybCsqxfmjzmwSwVJdd5vU5oI1gLFktpw6UlyQmJNUzcWeShYYLrWI2zTNStznICQA5E3z1iSKc1oXLaArLuVoWw4s0nKPsRxQorWLK-dAAiITDNqQa6hE-13hxfNZJIIuXKUcKhXkBH2P+pr1EcpqXLYbMdj6YAfII7CoIIRAAIL25rE5iKbjjkdb6zHPh5WgdOs6gdYxyZBiSs0fdpKhqGwTRrGf3dVmO0zHO+ly+IYKODcMiRRKkiViPTgZIR6ix8eAASrR8FnfkDU6NDFlkxhzPMBEZINQ38bWMdNXXq0AApUqgnRMOwScpwT3MA7zqGIrxcx1POVSUZFxaAk4JhTTnWqNdbYn2cmnJgTAfrqgoG3HmXtn7nHKDnDY-cVj2B0MbTYklazyzrLhRqtdFKrR9NA2AtJhhL12hUQWyJixhXsnUBQGDij5FMIsWcJkAL9xngQeiqBBgUI9j1eBflNALFtCFCE5FNhxSkDCeoSwEZy0ImvAULoeFEEwNwWBj8RFULXlyfkPI4SgTyHIYuLC6y8SWHnSOFhSg8IAEKoBYj9XA+IehJnYOqMIlCZgVEBHFeQSwrHyBpnsIsfErR1A0OCLQTiXFBjIAEAAqrgPUQiO7E35vmLIglZYKPyGJCokksjmOyDUW0CTXHJIAJKnmCL4zJgMtbVC5JoGwctbJojEkoXi-9FxjUIrDGeEghxtjAKfVusACBpy5tgcMYQAhQHVEwIcAQWBMEjL9CAfjuK1EMXFVY1CLbhIqsiMwmhSqmFsJKG2zYWpBgkLAIcqAVJTLIHAWZ8zFmBBWSQNZAQwBX04JAPZuZ9JgnElCdCKx9Y7HKmoNh5w6jbGEFsZ0BCQGKR8BeYcxAyCUEwLiwcI5mlPx0rUKqaJRo8SuGkZhiA1DiRnNUP8aJuS7kIS2Ell4hwEEdp1YMwRCSKnBUsYikIbDorSGicEYlpzoRUJocidZBKmGnsfHFeL+WvAwECiAHAQw9CpG0fspLwU3E0DNOJLobg5A2BNcqKD2HAjhnMVY-I7q8vxUQbgsBvEkDwAEFSHB1m4BxhAAI5ISCYB6Doz22kcpzA2FyNeVKApLiHjDOyCJTBxXyFarl2KeU6okD6octTVbq2FWAUVJJo3Uk4OQWNlqQqXMSkcaweQKgWKZQKMwcwcjiX2PLEZWrS2kvLTqqtHY1YDm1PWwIrzTUAC83itvJXopINwXTSBsZYQeSJobFDhoiPiYUbhHGLEcb1ZaK2zuPH63AAb1TBpXdgddJJY0hkTIMGBlqaVOmOhoVQltGUIEtL-dFsVHAVEsHeqdD7nLPtfUG9xlJ5ktswL+gNhKE3CKTTuyeoMQlbCkWDEOi5zAiVAhKbIAF7n7lohW6dpLH3EH9YG4NadHE+ACAADTbbIIEWg5hgw2FYE9ewLDTQOibLI-9xBiEQ3ytjfKOOoe4+43j-GACawnSlR3o4iecCLaZ1jKBUws5j9hMKY3bVjyGOxabfe4sggYCNZJzFawK1R6iiEXIiI4BE8lAng8WRK6JNXcoPE5mdKGuNuYCEGfA7AyXtxaROK1jo0jzA0KaCEEozmhXRUosEUdZbbFU8OdTw5NNJfQxs6kkDcCGvINs5Uhq8MAa3URplcVRSmGlowkEciYZw2mtkWsHIQrZB5DVocdXK2JZfdpgIH6v2DEwJgPQARY3YCgLgQDWxDg4KYeJFQUNIrqukGvfYNwALoMW8thra3kuYebbG3b+2cBHeE9FF09ljGOH-uZpl-JAkox3B6jYL3nNPsa8G2AEamABGToJttcVFjiTB1cWqIXjYjqBJd04eCazw4Sy5pH7iUcAvR6gAIBm+vZWI9j0OkWpXmK2ARZY2DESEX5EcRjt0J1xfvVTxH72mtgAAI49B-alqA6W23GCBCsKwjqRZhUmsofKaqThLHsMAh5LGJfsdW2h4NL11Q7eoCzzuTLyKOglLYOGxh+ICjOqBQ4hEQr8ndZsSnFvqfS+Dd9bolIXg0-YAyB3xNioLBUKcWzIJMgERUNOJheRD5zlNHCYPGnnJ6uDPfY1pr8Dmr5W2612RlB2oY46+0-8GZLHQuCLIVrC-1eL+tfAwZk4sXBaFUoM0TMmRzvaeYXJtgXBwuIQSJvmPLde0eZ5eIeho5FUSEkMyIDaNbLgZiA51-sE34IcgOBFSCDYBgG-Oqb91p37HsQlrKxckUPBrIhYbSRQsGYcSIseyUQMRYQbvFbJ5ZuAITfRdZ-PfA-PAY-MAU-c-S-bAa-W-MAe-UlR-JdWAV-G8OBfrCqNISSYXBoWQZQOoPtCqKwR0LQbYQqMEAdGLEtcXJDSXU-aArfJ-RUGZakC+KkZ6chUMVAKkToFApgC-K-EkG-CZbAvlXAuA1-ePLWdCUGOGBWNFJwbNYoHkAA2JceZEEKVg03FfNOFSINZdMQz9DdHDbrf9SgAIPAUQggffOMQ-JAiQGAG+TbOwwQFw1AYfOvIEW5DQLceoCDYwS4J0UQHOGVLQ0w5fVjCwqwjbGwrbH9Bw-DZw3AVwgQsQ4QoYUQ8Q7w-wQQPw79TAAIvIoI1QicZEcEJ0Zme7YsSuAiAWM2QtfIU4TvF7VIo1T7bAbDXDRw4MQItwhAo-VAE-HwwQIY7DGo0Q4Io4coLQf+JGfYcEKI8QMwCiAUNleYREfoywwYptYYrIv9HIiYgooQmMYosQiQuYhY2NJYuozLClHKC5QEOJB1WwWwLIcHSDaoBYfkYsd3OGKTFTMXM3KdAYwIXTQTXI1w9w5AxAmY5AuYkgJMWAQQPgN44IjIGjNRSwdCUiCDHOafeQEdK4CUHiUXWLWEtTeEgIREgTZE1AB6KkQQoo9gEop48o7E3E-EwIwkxVNeNESEmVSfGGOwV+OSISGwJhJfRzMtFkxEvTDkyYjw9E2YwUnEwQPQAk+onSC5MoCrYdfkBwMSHo8wPMOEQtWoBzOuFI04hEvjJnLU243k-ksom+IUw040j47dIwACF3SwP3WGYwCEMSIuRYJhfPDQG0Bktgpk2rFkjzIMLU1EzwjEv0wQTMrA0Uk0r4sMxYAUbWEEQAp1cyFYXifNWKUCcSfWE4tIwsr07kwo+4vkx4-MwsoMog1nUMkKfKTYAJTQ5BMyIwW7MKS4NvLcM9foiBH7JXdLaPMPEkbUtE6Yk-NOHwH0C-GnQQVcjLQcx3YE5YIEJMsKW5OEKECWHIcs20WGFQUxFMswlI5cvbE89cq3Tc707s30vcg814Dc484kZXU83RYgs0p0Pkcia4IqIUY2UoSQYA9vXCQSKiGE8wt05rKkVrdrTrUY642orc3MvUm+SBAi4kIi2kKkQQbImBAc6CocyDZYQEabG8oSEsBVAUfdPnGWI6bIVso1aiwi4Y4ipipwm4zsu4kQ3suY8S2iyS+ixiq45i4s4MmCjim1cSWwHi6ECbRwAS0xeoYS6ExklfFyPAAfRJAgYcDzOyofEspIa9SSOySUxKTYCDNQcQK8+bOFI4arHC1jGyuMBnFiCQepDgWZCAKNPDLmDZVAPAB+RNNi8xNQO0gEtIMKBjSKArO0nOOwMpQtBQF7cK5yzAaK9JdgAlGBTKVyowIKaQAUQSQE8QAKAqlQfKDXLYDYeKTQCq2yyK6q3AR42NYgLRfoc8C1JqhAabSQCwS4dFDeWsSKRcSSfLA+VCgUSy1M6ykawfaq9qdJF5DZC+UMVMY8HM3U5A5uVAmQm+TAhQ4cJQvg9QcFOVUEkxF0IXI4XygE0GS7cEM4a4JI1UqdSq0aiQU6xMdZJgS666rknkwC3sh6qQtAjA+Q2axQ7fD68FXeYicxOcK4LQBlSKUqGcOcDlOguwd85IstGKuqy1d3aQZYAafJCOGspleYMoYCEdUQGzcq0Kpm2qgga8bSti-LAA0Wc4KMmwGguYH3UdEeFQWsYrF7H0JykkbAH9V6cgBnByvvGAUar6xEC6fWJVTYSeSKXSva5YHyy9ES0WqdbW-vXW-WqkQ25OGq2K59TgXAeNIFPgP9M1RG9ya6wm8EQEC5AG5UiEaTCqciacBqKxV8nOEKLWnWzgL2n21ACQca8QyazRVgYVHVQmpTGfVVG29vJW0waaILK1UKYyG4bOj23OnDA2hnWGvAeGi6yOjsW6nc+6-wR69A2Ql63Gt6-G3fYQL6pwQEfPa2OKcpYeC4cwNvZBRQMEEWqy1jd2mAT2ru72nuuG86iOq6jsAChS0ojG6Qie56nGh-We2Pee+akKLQQ4I4gCSuHkJOs9AAxfC0EKa4JwF7HoNrRnRK9gCtUkXAciu6iQYCwQSB-fG-QYLmOB47eakQEGa4LCDY5EUwcbFhY4JBcjP3FGL1V2tTRiMIds4642pys2+auoUKD-cmciSsYsAiOhKSezZVYaeyF7eh-9TzGG+Es1RpbgKNV4KkOMKkAgc+9Zb6Bh-AIMaOiUHHNeaoAOXKhVPdRcIKHIF0REHOUR0IcRrM465Bt0s1GwqAPABynAcgPsXIoISgOMaOmIphQSNEVYQsU6Y2GFcobWWctQAh-aj8stMRxhxJXus69KKNOJjRm6qYrw++rGye5+nA1+uPKW881eySMKOmWWamHmhAXCMofIag+DWsLYyx9RiR2xkgeKs1CAdUDyAINR6x9JnUke0-VBqQzpkgDyQQXpws6OuwM2IKdeOce8mGFmJ0RO0QRjHBZ07VKdVJlphJtpw1SvUZ7pyZtJlGrs2+iQ5uYZxirpm+E5zzc2zYfKMxGbUCOoULM0SwehWGIuYwF7IgRUXsHZmx+yxy-vVhwp4mSzacf+uYKgxTErK4La-Qj1EyNETZydNTAF08AIYFqquxqws1eRxR5Rvu86rxpUHpqxqZj+jYs7ALEhq1JO8aMwAh2QcEVBCGl0stbFylvFyR+xyvRx5xtOeKl4QF5Ue5rM4VnByFnMCpcRN55QUwEeI2cyc4KzQiI3cjd1f5iV3F6ltJmGlRyAAIXloFw1zzRBwZrJp6uQu-aeocd63fQwc2y8nkdNSwf+dtAiZaoEUQbYYXDmsA2h2rc15Ufl1psVo5wICl3sKV-p7czJ8o8-GNi-CViZy1zRj+-S80YCeofLc4Sp64TkSzMByEYhjF9grF-VyNvZ6N258VnFhNs5+Sh4u+lNkZ259N08TN5p7NuVicOKa1OaMx6OeKXXXifucJvMOoaJxmqdS-NxIIchRNii5A76JiV48au-F6dLAps8hPTq9XBI+qFugB9CPY1ujWrYfOF7Jd5JMhX6Vtn03szdmNaondrAvdocA91i88kQMrMc2prQHtOwYUcxQ4HykdWRXY-57gIYyvDHCNIkKND9+Na1rwkgANVzdDAAOUjQADVY141gi91bQiwFwPWgSHVBp5xhlKpahi0Ymp1n1EOoAGcAgUPTX0Pjwb722JDsP2BcO8ACPUPiO40vMstTSoYbV5N7tPUzl9hsg7sbQJQIQ5Zb1Q2lsWTQK-yqXI9gw9PtNY9MO8z0HjO3NM3DPDyNy0rCM2LkQNAZ8VhQpBJxIXQM96YLhF6CtgRFxRLY2ad0i107DdszOT8LOjzKjttdtgjHzKpf66hQJqh16Fhjg+QPXlOwRAvfz1sXids9AIvkCouwKCu4v5qLlBZthGYrYbIgTTQiTqZ-5ZN-imFcvLOmsYvvs9sDsjtiuJBSu-yKiMiwujS+vZXD2cwTJAR015hlPVhJsbs2lYXjhaNaSOvgvyveu-sEHh6vChvtN5jzjsNdsCzduyPJJ6VDYe0zHKnZAAJWqDY6zf7wHtOCWjVOvkdUdOOBMBvDurO6cpDk48T4vWWh1Zs6FCxfWsguQ9YbRSZsL961S8KvvacfuMc9N-uU40eb9Udb5DSVjBoGEKJlg0EStgdpAchThxA1BzgZR3vdPgu5cFccMTzsfbPhuWfXiTzgjkQZo675A53YZJpRAZ9anCJIjJNNuNyNlsY7dMAOfcebdvt7dB2ZP6gGYtXCwrgpQgScqgQMgVg8xR096DrWMiATbgw-QWJnCm4Ja2HiHqoquAtsgpzzk5ZFh5w+aPcGfkfWOreAgbecMFkZlJapuh2nfo5zFFw7A3eNqzR69xNZzyJmOF2sXA-g+7ew-DB1ecp6gN7o+I44+bA-9LIk+ffjE0-IaM+WGs-Q+JaxA8+3Ko-SJi-0F3fyazAK-ZYq--nM-Els+JaTBm-EAC-6y2-Y+O+7aRye+U+-fzeeWB-beG+qA5BR+EBx-neY-XfS-EUq4vfFve-U-52a+w3l+Q-7eqBhAN+t+i+p-4-9-4Y5-feXb-fa-wX6+r-1Bb-GiuRO8AIhESJg10RBkEbEFHOFh3n7519B+q-BQL-xU4pdHsQAq4A1zEQMx6gs5f+HDH+bYBvaILFiMw3BbHUvql2coCBA5qMZjgsZQsOUDnCgRlAEiN7u-zDZ4Cl2ArQlkK1NROMEGorORmwOlbcC8A0dRRHWHdR1ke0WQWMvDGNxghkylEXAfgPxZSNK89ENptgD6CkskmLwAQVJ0+JJBykjoOWEjFljnBVgvSafDyBUB1BcgFwU-ty1Y66DjWZLZJma10EDdbWj9e1lgUdbOtY8Jgc2o9wFArB3OVsUQL0loGRNFw8tMcvEne5EAnBUbA5hxxjY6ClBHgztjczGY3xyAugyuvCBUTkwO8ygUhhEieaxIcgWgfzB6HiGJD62yQkMI21yHpD+OPZDtjfFTbdtmhS7BejcCdDsNAE8wSErGUURQgkYu6U4FCmgGf8EmsAGMBwEDocdHWGybAJAg8HzDnqD+JgKsKLKhhBAcYSAGCkq4lUCwRiQXBkFYTCgfcs0cQHamCwL8WOH-U2sH2eQbDFhVeYcCsLWGtDfScwtMK9SdbbDIEARPYQcIwC7J5qlUNCrDDvKVw7IEGaRBoTBgQh5a1QaYc8NmFj0t8OqAICUVGoZCz8mNO1lPRfq8Fd84KexEtVRStdjCarMfuelyo3A5opwJFOiOt6YjCRHw9ZHiKYY-D0aWIh+tjQdaki8CFIyJq6lAwCw7ANBabNIGIZwYvwi+RQewPSybtkqqVfEWC1NokC2GkRL3o4CYSmRFM8iXHDPiUDZ5NcYUZUTYyHBqiWAGo2xioI45XUqQAadUZuT4G4i8Bbo+0SSEJqOA0KyeLYg9znDyJzo4WU0FYGiLIJrRA+W0epHdGBBHRgrJYaEFkaJi4qCVNMW1kTH+i4Q+UM9DTUrAi9yodYSwK1VfJu8TgIbFgUtgSFKD0c8Y4ML6KTH1COmTQxIU2IzH7c8yVzTodkIvy6Ck4TYwQC2OjoGJK4qifOOw3kT5BcskOWoKBHkCxjGxdolKg2mTGcCOO6WPAVGhbFaD+63Qm0WuNSr+j+KdYQLJdlsg8h5EDGNNBcGvQMJTQK41UQmJbHOCkmprI8XGJPGbkexJ+TwUKJ8Eii4CcgQIdNGAJtUr0O9W8U0QUSIhu4uQZEP0VPpMMtRVVL6qvQRj8QzGDTSpiiEBCXByaw0SEshMZ6oSEmTogYK9GjDri6qnomBrmI-rREnQNgTKpYGoS6Ex+3If-lCWbIa0UJ+dKKlRLxHfim2SoFxsMXcbI4vGegkMgtRsBZ4isiUbYnSIWoSk7SvIKMmDi5ZbNmSFE4Se00OaNsDaBI65mmwNrR1c4q4awPBgYT4TM8M0WoKREZjggFs5EoSdVSom0U04pzFRvtm9rR1C+n4FkfLUEjCgcg3fWGBViDjkZBJH4+GmalMn-jR6hIwUTk2FF5MyRseBQF9U0A1MlgUIGwHRmoHlRps04cELHxBKdJdJmLdMqhK7Hvi0JgfHUbf0YT5QKI6qY4MqmFAbwP8flNyaVirZpkdODU38a2OEkpjqJSVfcQxMwa0TTxObeEKA3MSSgPWpQhagOip6GQLA5wKwfFNfHNi6JHAiYJXlElOC42SjNAm4w8awBZJQU6KMFROhrBCIvUxPtzn-rA4hqHk1cW+OOmOijJKQkyWNL+mpUzJ-Y8ZgbWHGbtRxdE-0T7nOBbwjgU8UCFcJ9yUEbM1HJYAdMan-TKJU0ncVSD3F0SDx51SyTm1sCsTbQVwcEOYmsAwg5wNgF8N1L6Qx9q+Dg-ST7VxkOj8ZW4xsbuIzGl0ZqFdHNpB26kpcJMoUBmWxKBBIxSmzXFUhzPqlczxpCUl5ElO9oEjx6QEgEX4NgAyBzaaQcLF+G6n2B6gDMoCGmnWDiBSsIVWscgxBlHSeZUVfyZfWRopTJC6Up+plLxrZTYAagR5mYF3qnApU4NLibCFCgwtN4jtMaOzL0mfDxquIkgJQF8A6hAgYYCMFGA2StxwUKQeQDNBTqAFV6iFEOLHXigARAB6wfYHdDIDYBOgQwM1BjnuJxgButc+ucMAJ6LI5JxBNEIFFSDHQ8s1JEOPWUGo7hYYhUGueknbmNzGczcvjnJVfalE25v0TucnO7nS1+e0ojYLrChBpAvcMMfkKxPYaUFN4dgSeXXIblIdGcCcMOpXkdatyp5K8kHo6wXp9zdGSfciOijOSBYgQ3rfLCZBTznzp5V8kOrfKWE6oX2aNJeY-I7nPyRZG-QDv0kuAPYRoc4RQAzLBCG8ihPzHorVIPDgIYwegM1AnG8QIQ12SDEhfBAwBpwA0HgCkVd2lB+5gctYcOYRE3lmMC2kUjkHdAIW7ZiFcEMhZAoub4wBF1C2hegHoUk4EKkUyTMsBh5mBgQxUzqoWjjktheFRCyvN9GYisRyFgzLRSxEpA0L2AdCyEdYl3pxRA2ZJZEEnXEjlCqgh6YLMcB4VfkzU+inRUIoE4SA3Fhi8RRCI349VU+kmNQPkBCE85Sx9KUIhp0FBXAXQ9gxSOoocaNwoCc8gbu5Cbj+APkcYIxSYo345xygBfACNnglRaBIoigf8LakzrqoyJVlBJUKySV4gUlfI0omkubiZKwA2SiRfNVrDf052tgTQHkDyAbSIS5gKcPyDpgZAloOFWpRx3Sg4A+AA3WZdgD4AdK-FEfHSPmCOjBCxQmA0wLzghD5Q281JDYHKmcWEKzUiy+ZU0okIXKVlC9Ogfng1yBwhcO8bHC6ETpwZTA7XKZS4rvlqQNIHgv5UwFuVsMlqA6aRFsCODXoM8eQVTsiHQTAhVF+Cn5UsMBUeK2hlzQFcCram-yLsNgfYKHCoIZ5LyI6LQG7hAKnK+FleLRB5AG7Ur2AWKtZTlA3prwFZzZUgr5UhCKpgln4YZPQIpUaKOOdKtFb6TpUMr-2xMfyntUCYasoymwG7NRjoyFhSsmdUKPyukazLFeHsl5BlDFXpVzykHTQMUv8zf4hloIf1oBF1h-E4lai5FUEA1XCr0aGq3VQ531U1N7AmEfkHKXxWRQKgaFK0grFCiIraI0yr0Xbjqoeyr6nUZ1d5gnCPdqwVgwCPlLijfx85FoWQC1wXyqrvlZys6R1H8AOrSika-wNGuk5MrAk68Y4NUGyDoprBk0AoSTSZgtc8kaqyvI5U6CbQlGHsttR2pLX6CIk5QaksoH8wDQDiZ0SmQ0ANF5VjBw05Brau7XUgC1EhedVSF7XySrAhwbYNYq9brhSgZ0ewK1WtDoQJEBlO6Cr3eh4wvoP0RYa3LCBdlsY56oQpet+jD5QSAcPnCTQ1bIVaY4UJ0IuGsGypKweC2iGetxiPrvol8wgFcokDJzk4dxe9aBs+jgbBEG-QiHBSvSPZmCWQMJbTFNCDQIQGxWyBl2tUHgQNH0e+N6A9kwa71b0BDffEoQWYmZbVTCKtKnhOokgLKQwmMJuDzRK4p6+DWRsNTXqoNVGuDTRoE2EwulZQTjQPBTrlybSjG57lehpnuSaltq8+JfGvgE974HgzxJ0A4CjiL4IKQQHRq6XVc34SgSFfXga51R8ltPUWFWq06qac1HHdTUZpB7aaoNsAXTfpojpGaTNuSyQNNlIh5wauUsxFFCnjLq05xR-RWfEttWCpcYLsKxpMH+5OwwAfgV2PEFXXEFBAVYdFItEmw0owoTgEOHMALlMJNAnlNutmspUccEtzsYIJlpS1QbPAuMDLclu4DZa2KuWxYPlvdBmyIQxW1hQ1EN4Va4YNUarU5tq37YIEUCfDK3Nm3YwYEXW88nDDlGRzFA4IYyMYA6J65A4-8IKBHGI3BrbVAKSBEtpTnCbFt0CSgCtqPbrbIsfjbbfryRjs1ohh26yC2u3GkJV2A3QNC+lXZ3bpuMLfLA0x5AkNPV8iB7uYGRlbhsgU0L7ejh+3PsoN-2p9sMCB0NEIJxvNeCYjsD-4gStTAAlXFslKBFaiOi+AIl0VeFKdv0THessVZ9JDCc+AOGGMEiyzlEFm6wM+Jq0Cqem-CFHQvKgUSFadGO3xYBg-xHABleKk4NcBNFNFSYUIA4swSDWzrnNLwLRC3K7Wa72l4urpdNHQ28hhI1wYOKWIyC-xBIk2Pmj0UR2X5tEi6z6Drvp05RHyr4TIJKS2CS9Zxa2+aMVUCzUI7oHMMQteo9kJxOY7AVqIZu7A8D15q2soBp1vYiQqC2QGgstSXrVqgI9NUpoHr4Dh7vQUGsPcHsj2Xxo9tlYfI6HMT2RQIcsTKiAQfL0EyeRuFVIATujzoKNGTPMvXIHDF7Ogpe7xpVz9WYR7ECzF8nwz3THKU8E8UDMdokBt7vAUGrvWAB7197Y9xMajH7GdomYr0fDR7haHw0C5dWOFZxDUlpyeJA0uobwB7KTCJIfAZ+nxPSr125K+5NkAyBEyuxiR1OY+fxsoGMLiA7ox+pJKfq8T3789Qu4RdfpYi37gDMG53QYIr3T7ZEsfc0R-vIjs0GUVoBaA5CP2JJl2kDU6YQCv2JI0kkwWA0YGnCx95uPIStWs0qZEQPKoHMBsWEIj-6cDySPA0JrAOeKIDmAYg51sf2Mqd0pSBKDZlKBhRuQxSU4F72QUbBIS1c7AyftyJKhGkIejvSfm4P1IlDVjUg+cip65A0U1gxQFIJhilh-WFtEoQOlrAsGFDqVakModAOo1wDiSDQ7Ya0P8HxVOYMoIrUl69xpYNesSD-C9609GiKfTVJiC-bwBogpuAQ0IGN4Ih+Qa8CFUHBoIpBVgBcteBoDrwShuNM8aIyTAZE2hjkAJBghWHUIDwC26nZsqMnGQYA2lERvVdkkiT3ZoUXSOFBe26WcrV6l6AqDWIOqpRnkryd5NMlyOCAZIdA2GEOulQVB7u+WKSO+HnL2QLgi2XI0jLQOc1gs50GECkAUVG8xQ8+f+I5sX4cEQ8YAZY47RoylBUgRbL9bzW6UEMKtywBY4JHAKPouCMBfJssfKTnHpYcKXkBtSqhXIIQW27yqrvizHHnkskxoSQBUicQY1lKf2N-U0KzRNq4gP-BvVOBwrim1eno48NqwI5nkD+FtLgH2H8JBASYLAqM2hPLGhaM0Q1Y6kcDBY7aHDMHGILrImRcu3XewhpRkq1FcjJu0UJNgrIgkrUHROsNIEMNOkxlc4XLgVxIowIOSvJjkEghToCRyY9gEOOoQq35aW624XLmyXlPuGGiRxARhUGwgItU9jgBYAVBHwhJioupj0pqUCIKmZmwS+lN-mAi0H8gs3DzpoACx0Jcu7ZR0wadNJ81nmqqJ0o7WLZYbWJ1gdFHWAPggm1SX5FLBBTXJo92ATp0eJhAXz2Af9fDfZfRmGgZB9Cf+xnnhWUptZVKr0WU9ydEK8n0j5gOSIVCLhrwFUTMxaquD8ZPH3u0NY6rkfsiKIIVoS-NNkArBMIvexUswVTEcDDUIqtjZmn2dnBKJYza3Yo4ig0Cx13OdgbkHzWxPp9asPZhJkXXrmYBcjjGXiEZA-DlJCs93RcPWRhRp5zddQGc-i1dlI0gwfZxeuVjhhQgukakksJchNNcIFEOXd7vOaDPJoDKZsf2B6rRDkQCqpsGyXTMez5526R9TugFPzofn8wy9QZGbPu5ztet6Jn03CixQ4mlsh9RUHrRPr50-a6Z8C25TdD5Q+TWwQsCyPu7uhzAoIHONbAVioXKLedHukedjSnnqgkgV3HOzqgWwfVj5BaIAjJya4GaZ-ciznSosYWz6LggelfROP0XuJp2FYELmdzMifV0+QJgomU3WAIGUDaabAx1TwNeTJGSEBCpqjDpywJcVNKqmbIxJJEZvMixIDrYsQ+zpNLkJL1XBSg1Txsd1QLzq6sbZwTTPpidPeEyMcxxLakKecW7+sASGwNziFAVRZVIcVe-2BKSA0r5-LXkqaTKwXOKIDR1sOUn5RFPTRL2w2aUW8pn2sZSriTeGqazxYLn91LMQEj0UzwKoQY+SWGIasr0iN3u7V-Zu2OyFUt+22l+ozmA5qSQ2UDqCRGtw+aOgEoxuaIouITOsda2WbKqoFdSMetpYOCH1oiicAu4sNUKTOrEr1Y4t2rVElK1SDSvs6p4sgArGkGh7GwgsBcgXCCENj7Wa2T1o6wlYcZCCYTpauAwYhKp0EbB68b+GaFKj0pbQ16Cy-EMOvzW1Zrg8Nga3msLmKgDMH0zZGRklZFJL4TATCmqB+NHrfLcG0kMhPdNLpc1vpkTYWA0o-KyMAttCr2IXZHLaIW5MVdYwPtacq7D4xxu5qFg-KgyEo+kDJ0ALEKJZ+2Wx3OIgLuOaHEjgtZdVr76zIkenpaNvaxkR2gbEArZNUQy99OEeVAFHjTN1Hdb03cIlBwKDWCTdTCDPP5RTxPYnAcKh4XuZ06o9guHJ3bHWdTT2RXbNiNQDGURRwgMIMSP+DBi0CtWUeaRNHo2iww9cw7SCyOwW3lg+r8woAl0H0u6k5Arb62EOzt0OzQ2+1kGZ2xHe5CDYQkN2eyP-wLToRKIVpcux9hO49dfs1d7Oy7cbugC5238UUy13iIbwxEKduEkHdl5A9fudZvKFYE-wSlR07vKeIOmCySkzrpFgOx9yC7z2MejOPTEva2v-1-YF4q4LzieZMd0bdmMEt3Zlzy5FcKZocIPYbsPiR7NBTTpJGsiL5uNZSJ+9bnl5BgTzOluu0oDWJuhwzFMYtixOiLzZ1OZENkUH1gFNw+zu0hs3FBYWxRdliKUld-X4jjaAsNQ1W3UICsQOjkI8kIbsQChKdWEM0IrWIYQpxQXxvM-A5qChtpXibxvd1flsa40CGrNKT9aB0hDsPJpfMtQYaj6Cnm8wv6+oMCDdDhSYY+haQPpb8bvh0UEjk6i4NNb1il2aV02P3AIaSJKovSVA+mlXqqtlMOj6DYDOZuxtdBaVr+tEKCYdIgkH+mZnLGinFQ6Z9QVB8HzrN1BetawJg+aM85LNObRUQXBeLj6BPZhbw6RjiKBE63YTXxFlaE7oQlhVA8iGIjnDBC2QS2c4P5vEIv6SEuRuIsQqNXsuHyjIL8UoLSJoKDYuQRUY4ORkCYi2eWnY1Wb2aod0koO2haCSVvCUb1jGJUE2H3BfHcyNxHD94S6J9F0SerZcI3BImWphaWEawcgUesW6e6Z7WLHp6DNmeSPOHSV4malQXMqdO8mwOwM+XCssIg4HUu52ZjtmHGDnDYw6YmJhrTXjJs1sSZ85bELmrgJOCe0I2CYsJxIZQCdbJmkhB5ahHzmZxNLKt8zCZ5zkkGleBdVDBTc0cSLBMCh5xzETOwsNM96cJMTW-AhF+NKBeihc88RfWO71kTWJlgP+S4KqkUtKzRpnkwK9anRZFS3OoceRMqy5BnoSITgcSAdLmfSN5piYhc1lQAesuX4c2eRHCm-qggVFSgEG8rIhtnTqnYky6Quc94xQxlViKwBtImVyZBIQkSvbeYleGSGhqQg2h+bHPXl14NmSJ8UBRA1MZYiqyYbFrqmcvtXHHHyWkyJtiXawEx53L9Y9dbnFgcsTPA3WIa2vdHSTDWeQA-NsIzZbEunkoDUl15QSuCz8DWp8v725kKso50i8CszNg50+sORB38pLhrBZPDmjjNJcnPEr0rwF1Q5apesCsEcS9MKHRRTt6EwyC5MW6UsOyy3Ts458i84fnSGx+rrt-mKytMd-4uO8OQ4EtO2ZuQymJQC2-LeSMHHDrx2TK6oeJ1Fg8E6yDvSBJVrpoOb2wNXtN57up3SLg+43PGREyT3i12Ncs2ZS02Fm+aBmWYzGP4qFwEdp9189sYqNU3QLwJOsGVYsqZSxQBZkYJiRyQGBATn6QC7xkuyNLbs98129oHGRisVsHcNLMsirULIGgeyNOe05cdGcXc4YyZFiKEubkPjsEP4Z1gd9zg74Rp6ruXnvCm5rcXI-mepiIU7M+wV6RFex36Uye7qthzhX48zzQFAaZJ6SlyNPMZET2Z8qDjhgMyPrcbyXgVjiFTa+dlCshcMbwT-9LF6nHPKwpYU2phYflYJMVZDXeK0nMNoQDElHIdJDVlrqg-Ig7sFgwc2vfLS59tUtKGlQniB4IGCr5KHAdZTQqbtPS5BDgGQag5bGtiI6LlFn1DYYasD9U+XRh8yMAXyjEOcIHFSbQdRDWwBAVOXwEOIGAhCQqPuL42OJjTQqI0UOCHAbzrNR0qLPznG4HLCF554ipPq9nWUne1g1JlJn9VRlH6+vxZP-99qhFFjvs7uKIUA2CFHFc9fc1Ya-rwbp-1-rmFrl9VuWLXhFLpRRvGfSGuXUWfyPVBy93kCHVjrObWRkUFQfUQ4VSNqV6L2T0OAhKC2EqQ0TRydJ0DzRvcoNjOu+9gar1bQCz+Q3fhBRrBqkmjmwo6mDalNrGvjWJrxjkb8A8P6cIj8B9qoZI8mhYExsiwDIV7iO1zZpvc2CaCfdAlVHCAWY5WrrmC3HFKBKqlBVgiO+rbWia07R0nMwAtCs0QolQ8VJp0rStcjFWgzB5wRHWdrm0wILP2OHBIAQ7wC5Qs5YqEIoH8wHEgciOtHRLd++XlE6rLrDdEih3kMYOyefNGgop0C7hgFnrKvYjPT5SB0zTg0funoFgMdeYX9XXbrjAu-X43cLtLyFoSzjc4C+GKOr9V1B75k+P031Jv-o1Q2W6xCWCZR9MFpZ8NPVverDh+m+s8LFpQIjPFN8MDkpr5utzgLRWHADQQO-TBsL9fu-Ikcf7w93yCjWoUH+4F9zuo+DwJEM6gA7gdqrN-HbqEdhsBhij5IOQfh1R2rkwFS7zDc0Ov8uxsOujktSflv7tCth2lgIxdoiRSR9jnuDRQOHVq4FcBAA */
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
        Cancel: '.undo startSketchOn',
        CancelSketch: '.SketchIdle',

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
        'Select sketch plane': {
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

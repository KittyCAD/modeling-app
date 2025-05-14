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
import {
  EXECUTION_TYPE_REAL,
  NO_INPUT_PROVIDED_MESSAGE,
} from '@src/lib/constants'
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
import { isDesktop } from '@src/lib/isDesktop'

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
    openPanes: isDesktop()
      ? (['feature-tree', 'code', 'files'] satisfies Store['openPanes'])
      : (['feature-tree', 'code'] satisfies Store['openPanes']),
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
    /* Below are all the do-constrain sketch actors,
     * which aren't using updateModelingState yet */
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
     * which aren't using updateModelingState yet */
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

    /* Below are recent modeling codemods that are using updateModelinState
     * and trigger toastError on Error */
    extrudeAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Extrude'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

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
    revolveAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Revolve'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

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
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        // Extract inputs
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
            return Promise.reject(new Error('Cylinder argument not valid'))
          }
          const clonedAstForGetExtrude = structuredClone(ast)
          const extrudeLookupResult = getPathToExtrudeForSegmentSelection(
            clonedAstForGetExtrude,
            cylinder.graphSelections[0],
            kclManager.artifactGraph
          )
          if (err(extrudeLookupResult)) {
            return Promise.reject(extrudeLookupResult)
          }
          const extrudeNode = getNodeFromPath<VariableDeclaration>(
            ast,
            extrudeLookupResult.pathToExtrudeNode,
            'VariableDeclaration'
          )
          if (err(extrudeNode)) {
            return Promise.reject(extrudeNode)
          }
          cylinderDeclarator = extrudeNode.node.declaration
        } else if (mode === 'Axis' || mode === 'Edge') {
          const getAxisResult = getAxisExpressionAndIndex(mode, axis, edge, ast)
          if (err(getAxisResult)) {
            return Promise.reject(getAxisResult)
          }
          axisExpression = getAxisResult.generatedAxis
        } else {
          return Promise.reject(
            new Error(
              'Generated axis or cylinder declarator selection is missing.'
            )
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
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
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
            return Promise.reject(
              new Error(
                "Couldn't find extrude paths from getPathToExtrudeForSegmentSelection",
                { cause: extrudeLookupResult }
              )
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
            return Promise.reject(
              new Error("Couldn't find segment node from selection", {
                cause: segmentNode,
              })
            )
          }

          if (extrudeNode.node.declaration.init.type === 'CallExpressionKw') {
            pathToExtrudeNode = extrudeLookupResult.pathToExtrudeNode
          } else if (
            segmentNode.node.declaration.init.type === 'PipeExpression'
          ) {
            pathToExtrudeNode = extrudeLookupResult.pathToSegmentNode
          } else {
            return Promise.reject(
              new Error(
                "Couldn't find extrude node that was either a call expression or a pipe",
                { cause: segmentNode }
              )
            )
          }

          const selectedArtifact = graphSelection.artifact
          if (!selectedArtifact) {
            return Promise.reject(new Error('Bad artifact from selection'))
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
              return Promise.reject(tagResult)
            }

            const { tag } = tagResult
            expr = createLocalName(tag)
          } else {
            return Promise.reject(
              new Error('Artifact is neither a cap nor a wall')
            )
          }

          faces.push(expr)
        }

        if (!pathToExtrudeNode) {
          return Promise.reject(new Error('No path to extrude node found'))
        }

        const extrudeNode = getNodeFromPath<VariableDeclarator>(
          ast,
          pathToExtrudeNode,
          'VariableDeclarator'
        )
        if (err(extrudeNode)) {
          return Promise.reject(
            new Error("Couldn't find extrude node", {
              cause: extrudeNode,
            })
          )
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

        // Extract inputs
        const ast = kclManager.ast
        const { color, nodeToEdit } = input
        if (!(nodeToEdit && typeof nodeToEdit[1][0] === 'number')) {
          return Promise.reject(new Error('Appearance is only an edit flow'))
        }

        const result = setAppearance({
          ast,
          nodeToEdit,
          color,
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
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

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
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

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
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { target, tool } = input
        if (
          !target.graphSelections[0].artifact ||
          !tool.graphSelections[0].artifact
        ) {
          return Promise.reject(new Error('No artifact in selections found'))
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
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { solids } = input
        if (!solids.graphSelections[0].artifact) {
          return Promise.reject(new Error('No artifact in selections found'))
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
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { solids } = input
        if (!solids.graphSelections[0].artifact) {
          return Promise.reject(new Error('No artifact in selections found'))
        }

        await applyIntersectFromTargetOperatorSelections(solids, {
          kclManager,
          codeManager,
          engineCommandManager,
          editorManager,
        })
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANmEBmAHQBGAJwBWABwKpSqTQDsUsQBoQAT0QAmdQBYJYmmPVjDh4YsMKZAX2e60GHPgIBlMOwACWCwwck5uWgYkEBY2cJ5ogQRBNRkzOUsFOTFFGhNZQ10DBBkZCXU7Szl5KRMTWxNXd3QsPEI-QIBbVABXYKD2EnYwSN5Yji4E0CSUqSlDCQUTGRpZefV1GWF1IsQxbYkTOS0FDRo5dRpDKTkmkA9W7w6A8m5hvnZR6PH43hnU4QSVYWbYyMQKdQKRy7BDCfLSYTXQzHUQmJQuNz3Fpedr+AJ+KCdMC4QIAeQAbmAAE6YEh6WBfZisCbcP5COaKCTydQXHkydRwjYw44LSz2YQaWw5ex3B444jE4ZUl4kIlUkgBbhBEJhSaMmLM36JdlSSHmVbGZY5NLCBQw040CSImjKUrZFSy7FtAgAFVQUCgmDAAQwADMSD1MIEmLTcMHydg2AAjbA4dh6fU-SZs5LzNGHGgSmTzCG1Wow+SO11bMQmHKVRqYuVtCTYCBBggAURJ1KCAGt-OQABaZw3Z43JZFSQ5g4RqFSGZbImEVMqQyEQyFw+a3Jte-Ct9tgLs95WwAfsYdUKRRJlxcfTIQNcpQ23XflKeyFfSIUTTuQAXMcIXDIThSJ6ngtm2Hadh8VI9Bgo73qyE4iDQjqbLUpiFhYVgmDChhWJIjhXBcci2ks5EQY8UCHh2ABKYDkqgmCUkhLJTPwQiaOo5gXDcCiiMWVjCDCYilAoTrkTYPEVLU1E4nRx4+AA7mAYBMOxRqPsk1S8YWPK1vkyLGN+xTXPsBaLjYeQSiYAoKVBR4EAAMqgoafPQYxjihOmCIogJpFOciGDI1zbDCC6SC6qwmNstaKGijkHtBylDlgmBaQ+XG6SsEjGIWyy1FCKiiT+CCmtc5R5HFTibNs4F7pBKXOQAYqmQaebeBrIZxMzVI66EZLIlz1LYcgEascgSNUshzvYAFWMltGpcQQ6qqG1JZb5OVoZIGw4QKpphbaBGLtN8gSWK7qGMtSkEExioSEwJDqkSSoSOQVJgEMIxed8Pl9dxxYzaFhmmmoxx2uVYhSLaM2lksKiWOCd2rY9JLPa9qr+NSEiQBw21A8k1hrsYORQ3WhFlcUtY8ocSybCsqxfmjzmwSwVJdd5vU5oI1gLFktpw6UlyQmJNUzcWeShYYLrWI2zTNStznICQA5E3z1iSKc1oXLaArLuVoWw4s0nKPsRxQorWLK-dAAiITDNqQa6hE-13hxfNZJIIuXKUcKhXkBH2P+pr1EcpqXLYbMdj6YAfII7CoIIRAAIL25rE5iKbjjkdb6zHPh5WgdOs6gdYxyZBiSs0fdpKhqGwTRrGf3dVmO0zHO+ly+IYKODcMiRRKkiViPTgZIR6ix8eAASrR8FnfkDU6NDFlkxhzPMBEZINQ38bWMdNXXq0AApUqgnRMOwScpwT3MA7zqGIrxcx1POVSUZFxaAk4JhTTnWqNdbYn2cmnJgTAfrqgoG3HmXtn7nHKDnDY-cVj2B0MbTYklazyzrLhRqtdFKrR9NA2AtJhhL12hUQWyJixhXsnUBQGDij5FMIsWcJkAL9xngQeiqBBgUI9j1eBflNALFtCFCE5FNhxSkDCeoSwEZy0ImvAULoeFEEwNwWBj8RFULXlyfkPI4SgTyHIYuLC6y8SWHnSOFhSg8IAEKoBYj9XA+IehJnYOqMIlCZgVEBHFeQSwrHyBpnsIsfErR1A0OCLQTiXFBjIAEAAqrgPUQiO7E35vmLIglZYKPyGJCokksjmOyDUW0CTXHJIAJKnmCL4zJgMtbVC5JoGwctbJojEkoXi-9FxjUIrDGeEghxtjAKfVusACBpy5tgcMYQAhQHVEwIcAQWBMEjL9CAfjuK1EMXFVY1CLbhIqsiMwmhSqmFsJKG2zYWpBgkLAIcqAVJTLIHAWZ8zFmBBWSQNZAQwBX04JAPZuZ9JgnElCdCKx9Y7HKmoNh5w6jbGEFsZ0BCQGKR8BeYcxAyCUEys0p+OktDoq5LaOcxh+RjTEnWQ4kILlLjlhsO6uLBxDgJTAzAHLLwjhJXopItQqpolGjxK4aRmGIDUOJGc1Q-xom5LuQhLY+X4sdp1YMwRCSKnBUsYikIbDorSGicEYlpzoRUJocidZBKmGnsfHFeKuWvAwECiAHAQw9CpG0fsnLwU3E0DNOJLobg5A2BNcqKD2HAjhnMVY-J2UuuINwWA3iSB4ACCpDg6zcA4wgAEckJBMA9B0Z7bSOU5gbC5GvEVAUlxDxhnZBEpg4r5CDSq7FaqXUSHVUOWpqt1barALqkkRbqScHICWwNIVLmJSONYPIFQLEyoFGYOYORxL7HliMp1PbOV9pdYOjsasBzajHYEV5vqABebwZ2CsrcKjIkkVD1EsIPJE0Nihw0RHxMKNwjjFiOMmw9-aT3HiIGmjNWbr3YDvSSEtIZEyDBgYGsVTpjoaFUJbaVCBLS-3RbFRwFRLCgf5UezlEHU24HTeqLNlJ5nTswMh9NhLy3CKfTKyeoMQlbCkWDEOi5zAiVAhKbIAF7n7lov2yj-LqNQdozB9xadHE+ACAADVnbIIEWg5hgw2FYb9ewLDTQOibLI-9xBiHI8OOTw4FPQfoyptTAQACa2nSlR3E4iecCLaZ1jKBUws5j9hMKk3bWT4HnKKbo5m9xZBAwcayTmINgVqj1FEIuRERwCJ5KBKR4siV0SOtVQeKLx6YtOfiwEIM+B2ACvbi0icQbHRpHmBoU0EIJRnNChShwYIo6y22LZoc9mB1VaU85jZ1JIG4E9eQbZypPVsbQ4+7Kwq4qilMNLRhII5EwzhtNbItYOQhWyDyUb43HNTZq3BhDgxMCYD0AEEt2AoC4HQ1sQ4OCmHiRUFDSK9rpBr32DcAC6CrvRY7LF5TE6mMlue69nAH3tPRRdPZYxjh-7+ZlfyQJKMdwJrZfu8rvboeQeq1m2A+amABGTpp2dcVFjiRx1cWquXjbbqBP904eCaxQ8qzDqn7iacAvp6gdzTPAShyK0a8xWwCLLGwYiQitKALmNuqTmT5OheU9u1msAABHHoSG6tQAa7O4wQIVhWEjSLMKk1lD5TtScJY9hgEPJ12BvXNG4tZpeuqJ71B1ud24xKVetg4bGH4gKM6oFDiERCvyeNmxBdUcm-79x31uiUheCL9gDJQ-E2KgsFQpxQsgkyARFQ04mF5EPnOU0cJ0-yecm64M99vW+vwP6-ls7g3ZGUGGiTkb7T-wZksdC4IshBtbw59v618DBmTixcFoVSgzR8yZHO9p5iUp5JccQ4hBKe+k+N67R5nl4h6HTnVRISQzIgNo1suBmIDmv+wW-ghyA4EVIINgDAAAl1AA0dB-QvMQQNSsLkRQUjLIQsG0SKCwMwcSIseyUQMRYQefCbJ5ZuAIW-C9cAp-F-PAd-MAT-b-X-bAf-QAsAYAzlUAy9WASAm8OBLjCqNISSI4EKRcWQZQOoVdCqKwR0clI-K0ddUrbtMnH3DPXAm-O-MAxUGZakC+KkZ6chUMVAKkToCgpgH-P-EkAAiZeg-lRgogyA4vLWdCUGOGBWNFJwJtYoHkFA2JceZEEKSQr3C-NOFSTNK9LQ+De9FjFbVDSgAIPATQggZ-OMV-MgiQGAG+e7IIwQCI1AdfIfIEW5DQLceoPDYwS4J0UQHOE1Owzw8-WTHwvwgIJIxDYIlDdjcI3ASIlQrQ9QoYTQ7Q+I-wQQGox7FIpotIywicZEcEJ0ZmUHYsSuAiAWM2DtfIU4WfK7Sor1RjKdJDEIho1IqIkgt-VAD-BIwQVY7AZjfozQ9Io4coLQf+JGfYcEPI8QMwCiAUBVeYREJY3wlYydY49Y+omBRo5oqkVQto9gDonQg4o4k41I84wEOJCNWwWwLIXHfDaoBYfkYsaPOGIzGzbXbwj4wIVTdTDTf41AbYmI0gvY8gg4kgJMWAQQPgU4wYprUlHKdwx0ZBCUSwdCUiPDHOffeQbdK4CUHiLXMrb3CjZY-E1zIkrYlotQmMdorQsE7o6k2k+kqEoYnSdwy1NeNETEk1XfGGOwV+OSISGwJhM-SLXtCUgIAk9zYk0k8g8k-Y5UmkwQPQBk84soQbLdfkBwelFQcwPMOEDtWoCLOuCovEm01zNze02U4E0Erom+FUt0j0jUlkgCR0EeJPWGYwCEMSIuRYJhZvDQG0EUqQsUuza0xLIMe06Ix03Y50pM-AIMVMpkoVIwDMxYAUbWEEVAqNcyFYXiNtWKUCcSfWd4qo6s4MGUwE1o+UkExUxMwQKc1stgjbDskKfKTYAJWw5BMyIwYHMKS4KfLcX9JYiBJHc3BrfPA3EkB02IikiQNOHwH0H-EXQQK8xrNcsPZE5YIEEssKW5OEKECWHILs20WGFQUxMsrwioi8l7T8m8rPdgB6WcuUjQxc581814W8j84kC3L83Rdgi5MobYaocia4IqIUY2UoSQdA6fXCQSKiHEiMqoyBKkObBbJbVjUI6cgY+8p0yk7o9izi44pbQQDYmBVcoi9c-DZYQEE7QCoSEsC1AUaQJYUxeoI6bICcr1ES4kLi2kZbX4sImcoE+chMg4-S+bMSoyiSkyug9Uts4i+SkNcSWwZS6EQ7RwdS5XGWbS7E0Ui-FyPAFfRJAgYcRLMKtfNMpIIDSSOyXUxKTYPDNQcQf8i7OFI4EbFi3tEKuMCXFiCQepDgWZCAQtNjLmDZVAPAB+CtWS8xNQQMhEtIMKCTSKTrQMnOOwMpDtBQK7fK6KzACQXARUktYgLRfoc8ANWKxAE7SQCwI-UCEKWsSKRcV9OWA+WigUQK8s4K0Kwq4a9qdJF5DZC+UMVMY8Osh8j-ZuSggwm+Wgkw4cMwpQ9QcFM1VEkxF0WlI4VKhE0Gf7cEM4a4Moy0w9Qaw6iQY6xMdZJgc6y61C8yjCzou6vQqgmg4w6a0w+-N68FXeYicxOcK4LQKVSKUqGcOcJVYQuwGC8o3tEqlCwNaPaQZYAafJCOfsmVeYUiv62cHrRQK7Rmgga8Zy2SjrFA0Wc4HMmwQQuYBPHdEeFQWsHrK7H0KKkkbAJDV6cgCXCKpfGAQ6j6xEC6fWK1TYSeSKVyna5YFKgDHS3Kw9dW5fTW7WqkXW5OYq9JFCxTTgXAMtIFPgFDP1eG9yS6-G8EQEZlIfaFcWRFciacBqKxKCnOEKNWjWzgN2j21AEasazACa1gbVF1fGqzSlW1C26fOW0waabLINUKYyG4dOl2zOljHWiXaGvAWGs6sOjsa6wS3Q-Q6gwwp67Gl63Gx-YQD6pwQEZva2OKcpYeC4cwKfZBRQMEfqx2ijZ2mAV21u929umG060Oi6jsOMiyxctGwezGoA0eocV6ie-GiyQ4V4gCSuHkYzCqVEZeojHcKPJwK7HoebSXSq9gftUkXAAShs8grCwQQB5-AAwYLmMBz7Wa5IdFaca4LCa45EUwA7FhY4JBfjJPFGJNTeuzRiMIKcw6-WqKo21BuoUKGA8mciSsYsAiOhKScLa1YaeyK7Ch1DJLKGiUv1RpbgQtV4KkOMKkAgQ+9Zb6Sh5s5LZrHSbICPevS6AOVqi1F0F3IKHIF0REHOPh0IARms1fYa4R3vAIqAPACKnAcgPsRooISgOMCOgophQSNEVYQsU6Y2GFcobWI8tQTB3a2C3tfhqh8xjuk69KQtCJxRyBuIy+jG4erGkA8ewvY2zkMKOmWWamLmhAXCMofIAQ0jWsW44xhRwRqJkgcqv1CAdUDyAIeR0xq6nYpJ7o7-BpkgDyQQFpqciOuwM2IKdeOcECmGFmJ0CEQSBaOsf+MM51Q9eJ6pxJCQWpz1Xvbppp-phJs+lGnQ5uWBvQrZm+HZpLY2zYfKMxU7UCOoPLM0SwehWGIuYwK7IgRUXsZZsx8KyK5fOhsWn8wLacd+uYfgyzXrK4V9ZwhNEyNEBZg9Cjd508AIL5oap8vEv1CRqRmRzu06lxpUZpkxgZ1B8xHRuZo0jtC4D+8aMwTB2QcEVBMG8M3tJFgl1FoRjFqx31GxiBtOcql4D55UM5ms6xvACOsKMYpYZQUwLMgpzaoLQid3fjeNN5wVlFolxRqG2RyAAIVlz5jVpLRJx85Jh6owm+9JxQx-QwY2v8nkOtSwf+OdAiRaoEUQbYbgtmrAshsbPV5Udlmp-lk5gV5F4VtpskqBz-I5iSxpm+fF6kPpg1oMcVhYEEI4eoDrc4OVgSH7ADaZnB+F6QxFtV-11Z9ZkMGN4Ngl0NpGuc-ZyNrpmNn-QVhNqppN+hhqaQLYAx6OeKJ3XifuQJvMOoUJ+mw9X-NxIIchMN+suI76JiEtQQUaoAl6BrIvAFkvcQaaNeEo+qeuj+tQPIJ0BulWrYfOK7cd5JMhX6Gt9ChUzoud4tTARdloQQFdocNd787JNFQ4aoYfdw-kQiYUCVhO2m8iEKBaN57gI43vBnfNIkQtR9stI1j-EgdNWHZzAAOQLQADUS0y10idGqU60oQ7WkSI1Bp5xhlKpagu0wnD1FNoOoAJcAg4OdXEPjw9m72dDUP2B0P4ssP4PcPS0lHmSkgpxJILto5QdE0zl9hsgQcbQJQIQ5YQNvX0WqicKs9CXc9gxNPlNC9kPyD4G9PnME2dO3zby6rONZLkQNBKUVhQpBJxIXQa96YqWu3NBgRFxdLAgTO7sAiHtEc9BDOJBjP3zeigv0iwLKpX66hlrHCZUvwZpTQ9IMg5OwQfOkK4cISguQuwvcKcunsMxUGLlBZthGYrYbIkSUvHRqZ-5TN4SmFMu-PYMAugikc3sPs8uU4WvcAei2vajntlyUcUH12cwTJAQ615g5PVgjsgc2kQXjhRNBTmuRd4c1iivkd3sIG+6I38us9DivjmMhvOvRvP3xuX1Mj8cVPjz7Bv4AJpABQIRBzX7-61PrTeughadmONNuuLODuxc9Dk46SovaXN0zs6FCxnWsguQ9YbRSZmKgrWKvVPvAfmO3M-veuADadb43TzjBoGEKJlg0FetMdpAchThxAD2wPVvbygUTczd8KGtMf3zjdTcn3Pz0jkQZpK75Bh3YZJpRBKUSnCJcjDNaetPA9EcsAWfcKpfg9iUxvhjNcGZFXCwrgpQkSWqgQMgVg8wd0N6keWWDbgw-QWJwim4Rb6GcHqpSvMtsh9zzk5ZFh5weaY8ZQ1OiATeAgzeWMFkZlRbzuJx6gl7o5Nd7ebA1qzRh99MjyafPfvffeLeA-DAledIQ+hzSII47AHekDLIY+3fjFaPR3EXE-Elk+RaxA0+coM-bfw+c-I-EVWcXfZvZYi+3my-zf-eRaTBq+4qbew-s-0FHeaPBZXe2-4+jf6PO+-fLeqA5A+-EBa-B-FwG+R+q4W-Y-3eHap-S-aGk-u+qBhBF+EBl+s-V-h-Ip85N-C+wOR3wa9+-mD+5-1AT+Q-R5Z8AJCJgnqvEQuCbEqUoLGfB3337l9D+CgN-iMS5Cf8VqP-SKGIgZj1Ajy-8OGG82wDu1vmLEGhn83MYfV-s5QECGzUkzHB8yhYcoHOFAjKAJEb3XfnZiIDoDx2HLPwn6lFa8t+W5ABgSK25ZisSW4IMwHWHjSDll0WQfMvDA9xghSylENARgLRaWMmO9EWptgD6A4sYmLwTgSJ3bIIByktXDHG73OCrBek++HkG+itjnBrA0gxgVE21aFp6BMgkLiayHqPU0mDBDJrABMBZMzMRGJzlbFEC9IyBwTRcNLW3LxJPe6gqGus3qYVsOBdg3bh0xvgNsemsbdQSXXhAqJyYM+ZQHgwiSXNYkOQLQBlg9ChCZB4QuppsyiHqCb28ZC+p02OaNtoh47KejcCPa5FTs4UHkolEWDY4OQMUKFCAKf6rNYAMYDgH7SY630Nk2ASBPYKGGPUQCTACYY5VDCLt1IGAXZCVx6oFgjEauDIKwiA4Scf4FgKgdlmL4P86BM-Z5NMJGF95hw4wyYZxwXKo1phz1O+nMMgQpFFhcYSAGClQaVQ6KsMYCpXDsh4ZpENhMGBCGlrVA+hhtX3roSuHrIOi1DWIca38D3VHBZrOgrfXvqZNUG9iBaqiga7uEjYLCP9K1RuBzRTgSKSEabwGHIi78LqAIPCPMaVDz6qNGkVfVSbmsXBlrLESf1hhXBY02GAWHYEEInZpAODEjF+FPwWCzGQ4OdtVVqrUNfmhtXAfQ1yIu9HATCUyJZnkTN9+MSgXCCgjponCfWYQhrLKJYDyiomcg+kegPTRyi7yfLQtBdSpC2jzRJIR+kwmfp6iqeYSLIaf3OgFZTQVgfIsgilEr4ZR6kO0YEEtGctRhoQMRpGLKoVU4x82SMY-ThD5Rf0VNSsAL3Kh1hLAj3KCg7xOBetaBxo4oaaIjGuioxpbUoUxyDb1DpRZomqneURG3Uah0bRIT-nUFJxwxdBKsRHQMSVxVE+cBhvInyBtZ8ctQUCPIFDH05exkYpgRMBg7jIqQhaKsSoK7oNiwxTY2qo-TUp1gss-2WyDyHkQSZa0FwIDAwlNCziKxwYKsVq1xaxM1B5Y+ceuNbHkEHB19dERayYJyAPBjKewoBjXqnjRiCiREN3FyDIgli+9RkYqKGofV56CMfiAY3KYFMUQgIS4KTWGiYkoJ73GCasytEgMExDogYK9GjDNirOKWCcB4V4jiALksqahAl1P7choBWJMcirWgnZ0iqVo+EVuMrbUg7GxxRxtThcYaD2CRYwss8QNQai0JOpQMryBzI44mWizcUvhO4m1jy2iQ17O7XsHtiTmy5d2hHVzirhrApGBhGhNrzJcBkyVcEJdjwlcSLGMYoFPNjTgJNZG2k8gBHVD6fhyR0tQSMKByBmAiyg2IOPxk4kPiYmfqHWrpK-zo1TWI9H8UQQUAfVNAxTKVoREc6hwAppscEKvxRKdJlJCLSsjBNfEUSFR3vZUW-0YT5QKI9qY4NamFAbwYCaVWyX1gLYVkxscyD2qVItEESnJRE9cSRIGkUSI68IHgqSwqB2tfR+sDdFYBOxDRjB4U28QuOjHMDe8vEsIXG2kZUEHGTjWAKJK8nRRsqJ0NYIB3KiwFSkCud+pjk0BLSep46S0RpKDZt1lpb49pkiPiG1DOxOtHsXO1fYjSSWjnHXlvCOBTxQIQHBPHwRCykclgd0ncQ9L6lrSmODWdAWuIokbjTqOtQZuIjCxXBwQ5iawDCDnA2AXw9UvpJrmOHMtD0XUucfDOrHcSnJKM1cQmM0SF1YRXk9IPLQ3ibCmJdErdkjByZ1cLSVM1Sd1LpkRTYaUUnSe+IHopMnBHInGlyNgAyBjaaQArF+Hqn2B6gRMoCLWnWB0SMUhUwtsVLFmViypVgx8d3RPrTsbqH41kXLLRFPDMRsANQBczMDr1TgRqUGrzNCjAtN4ttMaJTJUnXDRq9IkgJQF8A6hAgYw+Uq41QaCBLQXIBhrUBPyjkLg5NYpuhAEGa5GYrzHEmQGwCdAhgfqBnLHJtn90C5Rc4YLj0WRiTZKaIQKKkGOjtZ+SIcIcvFDETuhCod0SucXJg6S4y5TIutr3OrnA9a5gabnkKI2C6woQaQOPDDH5BOgjI74Ejq8R7npIq5JcyXAnGDq95b6IXEeXQWB630p6jcteIoHnDkR0UZyLLECEdYdYTIFedeYXL7nIzt5QddNCIxTR3CEyh83HifPjkYFGUYoeWtpQ-ropooHhHOM83mJGzaI4CGMHoD9QJxvECEcuRGxQXwQMAacdNB4HBSjEqghjAmQrCYkZSa6BjdNoFI5B3QEFz2ZBXBDQVDyuO+MBhdgtwXoB8FkkQhUnkxy1hSFfA3TN1RrCNVG6OJWhUgt7zfRmIrEdBbOyYgsRKQOC9gHgu+HWJ16cUd1lyWRAf1xIOQqoB+hyzHAaF8FP1FIoUUcc0KVQ+9vIpkVKKVFJ-AMmB0MxqB8gKwaevIklSZFlOgoK4C6Hv51xxFLAxuHgUHkyz3ITcfwB8jjB2KOF2I-aCHwAj14DUWgK-s7iHyyoKe2wXCUFUCVWNgleIQeT-MXLhLm4USsADEtWE8j+BoZAqS4ryC+iMS5gKcPyDphpc4FT5Exb3nSg4A+AIXbpdgD4AVKp65A5vLbkDi0olcEIfKFPn5IbAzUxixBX6n6W9KilnRZZUMvoaSQjoAoMZUgNMA7xmcLoPNpuHmViLOlowtSBpHsGXKmAGyt-gtXXTSItgabaoDXkPapBkQ6CYEEHJbC5KLl6kJgEwvuEHMbldyoPunzMB5A-sNgfYKHH4I14-y26LQFHgwILK6FveLRB5BC6Yr2AYKmSj+SXprwhZY5TgqlUhCWoXFn4YZBQLRUSKmOOKoFQmRxV4r6qP5dKjtW8bnAQpmwIHMJjEyFg+sqdUKLSpEbdL86Msl5BlBZXWcCVlyN9M804LDRh4OQhaMjFToVB-FikP5UEDFWMqL6Yq6VVRJUbFN7AmEADvFF8GIoNVM4Q-IfBnFnLFl60jqP4BC4n1Oohq5RjlAe7VhjBgEVKXFG-jyBdM74erifmFUOr0VTHN1S6tWU6Fo1uK9hZUvBVerAk68Y4ORX2DrxBCKnDBkTSZj1c8kIq3vJFU6CbRpGMsktWWo9WicIk5QfksoAywDRniZ0WwPlFX7ogTIGOItUx0rUCTY1n0daKWupDVrNBVgQ4FktyB0xnupCnPo92tDoQJEHlO6FL3eh4wvoP0EYQfLCBzlsYq6tQuut+jr5USAcZXETS5XUVaY4UJ0LwQ0pxcMg7SldbjH3XfRX5eqzouHOThyld1T6z6C+sEQn9CIToG1PkC4RGYFUqlQaBCGuK2Rjg5gnEo+o+j3xvQMsj9Tureg-r74lCALCTKe6YRSWU8KNEkDlSuEoQDa+aJXGXXfrENnqTdf2tQ1fr0N1GwmNiLKAkaB4CdeKAU3KYLBcNRWAZHNO7UBBz4l8a+Lj3vj2DPEnQDgK+wvggpBAmG7EWVzfhKA02w+arnVHKBxRYYosciqpxyXnKhNsm0TcD3E39rYAkm6TaHTk0KaeRkgeaY-OkSzzv4OcQssrXHGt9hZWqgzZqlxguwTGkwPLk7DAB+BXY8QEdewUEBVh0Ui0I7GKjChOAQ4cwGaIoCsBwwaooi-TY6qY4+bnYwQULQFv7WeBcYIW-zdwHC2yVItiwaLe6C1nPdHApCjtucCYSaBEqGWvatqoBSQJsYMCA+RAigTsZytP5OGKKN9kpakYtgLXuSqPaBCgoEcTVb8oM2db+tPWujX1u62UBBtG7EbUVg8bGRjAeWeECKn-izbrIgmjNLRinYhdztV7YYJtvG7AsOs5TQ-K4oqDyJZA00BKLmS+VtavC2q67Zdv7X-bfod25XjOG8bPKToyBJEiUxQJVxTJeo7zhGrpXNN+E17GWRfAETlLE1H1cRJQLFhyd-YiuXMY4Em4wp1R9kWGO0u1UY7r2-amnbdux3fD3Z2g+rt-1ym+i8EWy6FMYA9wCakdmLLRHGBC6-5tEIOnSNF0aq8hhI1wYOLmIyC-xBIR2HmvMUE0i6hd-atXVjuUWxKeR00V8JkF1JbBReY44bfNG6pZZqEd0DmFoU3UyyE4nMdgK1Fk3dgeWdcobWUGU6nsRI-BbIIIUWoz1VGQEWmjkyt18AHd3oftfbpt1O7L4Lu0KuvkdDmJ7IoETavkAwKgURCxPd3DalQJ3Qz0yG96R-iLkDgY9nQOPXHIA10U0SWgbdsrTmDsMdGcyivBPGwzzaDw+e7wP2uL1gBS95et3cTGEx+x7aPmQDOwwe4WgoNquFVjiWcQ1JRcniDNLqG8AyykwiSHwAvp8QJrtdSa-FcTEsjS6F1mwTeADjEhKct8njZQO4XEB3RZ9SSefV4k30R7LFzInQqvpYjr6H9H6sXV6sT2t7ZE7apQKfvIis0pUVoBaA5Bn2JIJ2gDJcYQBX2JI0kkwb-WJwwbpsCN6a0QABGKSjFiZJNMCIRBv1QHkkMB2jc-rrZv7MAiBsrYzocWlIEoIWUoGFG5DFJTgLvS4HbkxL7BCDc+xokqEaS27C95BCg-Uj4MmNkDMqMvBTwMhjMrYIgmGKWFdYm1Mh66WsNwbv28HqQ-Bp-cjWYXCGGkYhmg8mqSBlBZaovXuNLE2piQf4LvKniMTj7tLZMcDYBog1AYupwGb6nQjAycMIMyJyDcFCIDygVJ-YFgDymhPhDpsNgoNK0K4ExBLs4AvAL3EYaEB68EQ-INeM8qDiCFBAMPBAvoNmW9wZ4SRkmMSJtDHIES5KCsHyQmkZTyWnmpyE8nGQYAyl8AXfXzEiSg5udsKJrR1VrAvgU5KJdYIWFGQvI3kzRoo4IBkjkDYYDa41BUAKb6ZMyIUPgjjnsgXBRsRRkGSAfZo5ZzoBEH7LXpuCWhI6hokWXZgpwbHbaImUoKkEzYXruacqCSJEYtpTjDee1CrLITtmBACCrgjY+UiuPSw4UvINalVCuQQg+ByVH5cbLGwU5nkokzSSpE4hGqq0-sZ+rYVmjrVxASBJeqcE+Xz0nAr4bAhBmeQgFp0fXUajfCTB0FumCJjY6IET2aBNwkiHLFbUYYrHtNkoNOu90jIRc6iq2UygMSKMy7RQR2bsgMfTmYIGUAkfgrbTByZdCuPFTYgKdaPDEOQSCBOgJHJh3djYHJFnDsuTztosUdHcUpGVtLSklTrKgfa8U4aTTriRNP3Y4AWAFQN8ISYqJl1tIxlUigpq03Usc7y7uC-pSbs500CZY6EmXKhp6eVOakeaVzW1KGVtpyssgpFIiOijrAHxITHUjpYgtqxM91kvXdgF6cA3V6T89gS-ewymXiZho96omm3ozPWlrKhlV6Aqb+IRmLT43NeGyTkiFQi4a8C1CTPmqrgPGgkAagdXMZFH7IiiCHT9TbTZAKwTgVeBr1yD2Qyww5gqlE0ZpjnZwSiFM0twqOIoNAUdJznYG5A80SxbxvKiOdWajVtCJaIo5Jl4hGQPw5SLrPMcXBDkYUVeP0+1P2qrnVm7k4+pdTHPT0lEP8KEF0kJESHFETxrhAogy5qd1zkZqtB5TNj+wzVaIciD0b9m+klzfq080abszb1FQWtPetnUAv5hZ6gyLWfMbi5SRPqcy66E3R3ot0PJ7deC62eD5ug21wTLtraCmhX8cpoIHONbAVgMXCLWdduleaLmYBbz1QSQBKEGQMtyVZKsCgtEAR847cJx4OWNgIu71mLntP8wjSDAbnvsKwdXBKDJHwD983jBRHjPF5qcnDpEpBm4cROerhUSedSrlNWDZ79luYgohXA2Acl0j1+tTiWxYhjniaXIUXquClBanzIRRfKD-DRAWRnO6Zi-CFcclIztQOFcRloSka3nZurrBEpEeWqO9IKbWCQmkZMu8NgribWQU5NYEbnFE6o62EaTSrTELiWcnbEKKOU1nUrNViWZKriY1WNz9gXTBIlwbKBlAFqEGPkkp0A5SmlTVpiUI2Z1iK2obDc5yAVQRoJES3e5myWyookNgU4lK7Jl9bqtW2Q1MK6sAIH2scETrRFEBfsiywnODLUCKq2RZpX1OsB-PJI2pB5XBI+UVLYOVkBWYzozOCHFKGkPZKzz9HYtn1dWlfX6rCFpILvDKA9VhCdQWaPuw-DqU5L-GIDHBtLESBTrH16wbq1hvnWNzFQBmMGZsigzesNgYFjYhT1cqPGb1tlnDZrGFp6xarNa0jaX4AdqbaVZGOmzeWPE-skITgrcgcO9oL2ouKdr8eI2c1CwaVQZBWEPaKAZJDplOT1ZOtQcvi-cljgWiLR4cwAgp9s+YDUTSQUEp7fMsGlsIaLDMKFiXnDhzyoA88eZlo2xc1LZFGUBQN9DLqYQ150qFeCHE4E+Ue9CbH3Nbjyeexm2a0S53Num3ljDwJ8w5P+D-SMZcmNOa3QrrHb5v4YfbCd64DYjUB5krV+YP-i6Am31Scgzt6bDHZeync47-SVKReL-53N7r9kaAe2nQiURfSddmrLncbsjdm7vt7kFthCSpUpUBYaBYurEQ62rSkZVHt9wZwaYzbeUOaWCKlRyXnWbCaPIwhq7FgB71OFe5Ljczr2OzsBHUjukd6vmygNHW0AeLqh1GoTn13zmtzZ6M96sQ4UewnbbvY5s1UKl3JHSKzbXj77ieXkGCkv525YSgS4m6DjMUw5W+RLcoZDUSIljrxvUAV3ybhjmLAHZrTcsFijeWf0yK5+vxDS2ZZChhN2wZYMSSXX25bih4gFFk6qjU6dkMKMrZvGIyEb3A5yzWq0GSg9Zpq6LSl1IFbsxU56mvZCG4cMyMrCgz1H0FvN5hr176UmsElk7OFO2a8Dxu+HRSyOjqj4nVrQ8Mv520uZcTpByAHivb5DwButPPSzLWYDHazJ6eUJkF5WtALuBdQ1BPan6hmcsbTcVAJn1BKRPvehzA8liK66EJYJQC50OySQwQGOfHLImvEJ9sHw1QYWmEuExz5h69pTdE6asc6CiOcRJ1thuDUppb0-dJzCLGEMjwnXt9MovKMgvxSgBIwQltiTlFYyR3jSp4ixNH3T6Z0Dhp3FSFIASnuQEhLbmIQIRWedyiDVSEJof9PxZ8Ny4U6JdEUThrZcd3BIkWqhQ3tIMO1ur3lqGMbxAzxcdk+TFozaq61nWLBpOgQUYrS-IODVIed+Ycqizl8cs85uRCtJfE16Rs-ztEPRQOCXklIl8YsJxIqN1fqZitsv2MzJj7cWbN6lyOvrTMq5ySDyt8j8hopuaOJBAmBQ845iPpAutOdfOiqpNv5wM43N8iHWdgYovrEd6yJrERD9FJcFtQaWipnUtSUM5lXEw4owaOFlCBsBiYSBuYoV9VEzUggoYvTk2ec5EYuHIxG5pqqflNDnAX452eRHCmfqghKWSgTB9TO5dv2-UG04oVtI3PO8ehCsIiJoGFBVAXwbrPnhHBldcuHJT5Vx1pJ1qAWPRAFdeCFjifFAUQmcpAYJB6FwvvChrq0QZVclJZKbsl2sDMfIgLrhQR5zoZ5fDjnZnXT5Q17IylnkBALbCLWTYCrhHLwLWg3KUnOtSfh0GrxvCy69plIuEZoVwF+BNh6xOvZx0YUPrARAMIGbywPTdDdFn1u7x5snh9k4VdViNz9QHnDjiO0AZhQrLwxNC6LdJR7JQ7laaO+NdaFnxjAs14C+eUBNKKpLbdkxIcCOnQs3IazEoDhkNvBnbr5a5pKaYvSqXgL6ZosDAnWQ16SJcinrtAuOdqY6iVd-8+RfpXUXK49F-mbMeTNZUv7MZm2iJkGMpjsKhcEuevfDvgP0TSWb3k9d7uyBxkclf7GGQ6zWDgySUHwRsSof135Ly2f+dMfDP+buH14l2cv0FNrMMuFPdI8es1uS+IcyXLXPGMmRCiRLm5AE7BBWGdYw-c4O+FacpWR5W8jZK3CKPlnqYlFMLPsDOmxXpoVoehAHDbvPzN5BtneZ-L3kuoijlzGRBDggpdCb5-125NNxncLP2tBmzBWgvGN4JoBmipTg3n4V-lVGmQhArAUE1mKZFrnifPkS0AMmZmPIApv-DJZ5BJQwNaLVToM0lKClCn-O4IGyqaaBsnWbYLLp-S5Af25wcp5bGtiCbllrnwDRrasBbAmUZpOVugXygUOcI8lH7efm1WwAblFXmXJbCvmDlAsNePknjOkM4JUB-OjFe5Ag90fkgOOaQCFHPkpOhX8A-62Uhm0g0loY30YWKtc92cpxRuu1IJHtTDx-rSlcDgJnEiCb41236aLXgaBYRrA5YY2NPhtxJKhRuvHq9qt7VUhXPlkMinOn0ZJUW1CwI5KSJjwvpKNjG36+l+J6HBXF6baSTJAtQZBktLDKFXz3B84wPoB6kYa54Ibvwgo8qjUWRwyk1TnugGGyylYQ14wkN+AHH9ODx9w+7UCPmGFTHIGk-8NfOzLZGsM0iab4JmmjbT-IE2o4QYzEKEDjBDmAgoGU20KUFWCCactI6fLTtCRMzB20UzSiiVBhWTTEtEnQMVaH0HnBBNS29babah-M4QXNYKlbfd1idDFAGWZ4l2o2-05SE8t03x7vXBNaMsYIdp6SIl+nY+kqKVr3bGp2o7hgrnpqvYl-SpT107T9UTjb9uU8NAquwXSb6m8ZfTQCIdN4fjmNMTh2GDE-DFBBcpXrd8yGn674KyLn02W8VahMx8rBn20ZFSnnnvVhtAQvdeLtrE-TWqB2GByVLXXQVzto1DE7czZ-qX1QABfePxqpTqhSn6+R93x64PAkRfnb90B72i39N-iJS7BjTBnN642TTE8aQF9NWjmiD-kktVTQ-5tL+p+rYgZYCFXcwk8kfYb79UUk+FgxHnAQAA */
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
          },
        ],

        Extrude: {
          target: 'Applying extrude',
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

        Revolve: {
          target: 'Applying revolve',
          reenter: true,
        },

        'Offset plane': {
          target: 'Applying offset plane',
          reenter: true,
        },

        Helix: {
          target: 'Applying helix',
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

        'Boolean Subtract': {
          target: 'Boolean subtracting',
        },
        'Boolean Union': {
          target: 'Boolean uniting',
        },
        'Boolean Intersect': {
          target: 'Boolean intersecting',
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
          invoke: {
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

        onError: {
          target: 'Sketch no face',
          actions: 'toastError',
        },
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
            onError: {
              target: '#Modeling.idle',
              actions: 'toastError',
            },
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
            onError: {
              target: '#Modeling.idle',
              actions: 'toastError',
            },
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

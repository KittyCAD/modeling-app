import toast from 'react-hot-toast'
import { Mesh, Vector2, Vector3 } from 'three'
import { assign, fromPromise, setup } from 'xstate'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import { deleteSegment } from '@src/clientSideScene/ClientSideSceneComp'
import {
  orthoScale,
  quaternionFromUpNForward,
} from '@src/clientSideScene/helpers'
import { DRAFT_DASHED_LINE } from '@src/clientSideScene/sceneConstants'
import { DRAFT_POINT } from '@src/clientSideScene/sceneInfra'
import { createProfileStartHandle } from '@src/clientSideScene/segments'
import type { MachineManager } from '@src/components/MachineManagerProvider'
import type { ModelingMachineContext } from '@src/components/ModelingMachineProvider'
import type { SidebarType } from '@src/components/ModelingSidebar/ModelingPanes'
import { angleLengthInfo } from '@src/components/Toolbar/angleLengthInfo'
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
import { createLiteral, createLocalName } from '@src/lang/create'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  addHelix,
  addOffsetPlane,
  addShell,
  addSweep,
  deleteNodeInExtrudePipe,
  extrudeSketch,
  insertNamedConstant,
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
} from '@src/lang/modifyAst/boolean'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from '@src/lang/modifyAst/deleteSelection'
import { setAppearance } from '@src/lang/modifyAst/setAppearance'
import {
  getNodeFromPath,
  isNodeSafeToReplacePath,
  stringifyPathToNode,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { getPathsFromPlaneArtifact } from '@src/lang/std/artifactGraph'
import type { Coords2d } from '@src/lang/std/sketch'
import type {
  CallExpression,
  CallExpressionKw,
  Expr,
  Literal,
  Name,
  PathToNode,
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
      type: 'add-many'
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
  | { type: 'Re-execute' }
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
  | { type: 'Text-to-CAD'; data: ModelingCommandSchema['Text-to-CAD'] }
  | { type: 'Prompt-to-edit'; data: ModelingCommandSchema['Prompt-to-edit'] }
  | {
      type: 'Delete selection'
      data: ModelingCommandSchema['Delete selection']
    }
  | { type: 'Appearance'; data: ModelingCommandSchema['Appearance'] }
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
}
export const modelingMachineDefaultContext: ModelingMachineContext = {
  currentMode: 'modeling',
  currentTool: 'none',
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
    'no kcl errors': () => {
      return !kclManager.hasErrors()
    },
    'is editing existing sketch': ({ context: { sketchDetails } }) =>
      isEditingExistingSketch({ sketchDetails }),
    'Can make selection horizontal': ({ context: { selectionRanges } }) => {
      const info = horzVertInfo(selectionRanges, 'horizontal')
      if (trap(info)) return false
      return info.enabled
    },
    'Can make selection vertical': ({ context: { selectionRanges } }) => {
      const info = horzVertInfo(selectionRanges, 'vertical')
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain horizontal distance': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: selectionRanges,
        constraint: 'setHorzDistance',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain vertical distance': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: selectionRanges,
        constraint: 'setVertDistance',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain ABS X': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({
        selectionRanges,
        constraint: 'xAbs',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain ABS Y': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({
        selectionRanges,
        constraint: 'yAbs',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain angle': ({ context: { selectionRanges } }) => {
      const angleBetween = angleBetweenInfo({
        selectionRanges,
      })
      if (trap(angleBetween)) return false
      const angleLength = angleLengthInfo({
        selectionRanges,
        angleOrLength: 'setAngle',
      })
      if (trap(angleLength)) return false
      return angleBetween.enabled || angleLength.enabled
    },
    'Can constrain length': ({ context: { selectionRanges } }) => {
      const angleLength = angleLengthInfo({
        selectionRanges,
      })
      if (trap(angleLength)) return false
      return angleLength.enabled
    },
    'Can constrain perpendicular distance': ({
      context: { selectionRanges },
    }) => {
      const info = intersectInfo({ selectionRanges })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain horizontally align': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: selectionRanges,
        constraint: 'setHorzDistance',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain vertically align': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: selectionRanges,
        constraint: 'setHorzDistance',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain snap to X': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({
        selectionRanges,
        constraint: 'snapToXAxis',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain snap to Y': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({
        selectionRanges,
        constraint: 'snapToYAxis',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain equal length': ({ context: { selectionRanges } }) => {
      const info = setEqualLengthInfo({
        selectionRanges,
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can canstrain parallel': ({ context: { selectionRanges } }) => {
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
      if (trap(info)) return false
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
    'hide default planes': () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      kclManager.hidePlanes()
    },
    'reset sketch metadata': assign({
      sketchDetails: null,
      sketchEnginePathId: '',
      sketchPlaneId: '',
    }),
    'reset camera position': () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      kclManager.resetCameraPosition()
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
    'setup client side sketch segments': ({
      context: { sketchDetails, selectionRanges },
    }) => {
      if (!sketchDetails) return
      ;(async () => {
        if (Object.keys(sceneEntitiesManager.activeSegments).length > 0) {
          sceneEntitiesManager.tearDownSketch({ removeAxis: false })
        }
        sceneInfra.resetMouseListeners()
        if (!sketchDetails?.sketchEntryNodePath) return
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
        })
      })().catch(reportRejection)
    },
    'tear down client sketch': () => {
      if (sceneEntitiesManager.activeSegments) {
        sceneEntitiesManager.tearDownSketch({ removeAxis: false })
      }
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
          'tangentialArcTo'
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
              data: sceneEntitiesManager.getSnappedDragPoint({
                intersection2d: twoD,
                intersects: args.intersects,
              }).snappedPoint,
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
        event.type !== 'xstate.done.actor.split-sketch-pipe-if-needed'
      )
        return {}
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
    're-eval nodePaths': assign(({ context: { sketchDetails } }) => {
      if (!sketchDetails) return {}
      const planeArtifact = [...kclManager.artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'plane' &&
          stringifyPathToNode(artifact.codeRef.pathToNode) ===
            stringifyPathToNode(sketchDetails.planeNodePath)
      )
      if (planeArtifact?.type !== 'plane') return {}
      const newPaths = getPathsFromPlaneArtifact(
        planeArtifact,
        kclManager.artifactGraph,
        kclManager.ast
      )
      return {
        sketchDetails: {
          ...sketchDetails,
          sketchNodePaths: newPaths,
          sketchEntryNodePath: newPaths[0] || [],
        },
        selectionRanges: {
          otherSelections: [],
          graphSelections: [],
        },
      }
    }),
    'show default planes': () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      kclManager.showPlanes()
    },
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
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      kclManager.setSelectionFilter(['face', 'object'])
    },
    /** TODO: this action is hiding unawaited asynchronous code */
    'set selection filter to defaults': () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
            sceneEntitiesManager.getSnappedDragPoint({
              intersection2d: intersectionPoint.twoD,
              intersects: args.intersects,
            })
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
    execute: () => {},
    'debug-action': (data) => {
      console.log('re-eval debug-action', data)
    },
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
          zoomToFit: true,
          zoomOnRangeAndType: {
            range: selection.graphSelections[0]?.codeRef.range,
            type: 'path',
          },
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
          zoomToFit: true,
          zoomOnRangeAndType: {
            range: selection.graphSelections[0]?.codeRef.range,
            type: 'path',
          },
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

        const valueOrVariable = (variable: KclCommandValue) => {
          return 'variableName' in variable
            ? variable.variableIdentifierAst
            : variable.valueAst
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
          return new Error("Couldn't find extrude node", { cause: extrudeNode })
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
  },
  // end actors
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEFFGjUVUxoZKTEZMSkLRTVrPUMEDQk5a1FctTFFFRVrWxc3dCw8Ql8AgFtUAFcgwPYSdjAI3hiOLnjQROTFRWtpdQc1Rbk5NWE5EsQZbYkVOqyaOXEz60UxFpB3dq8u-3JuUb52cajJuN45lK2JBz2bZqLIKay6AxGFSKCSOS7WOrGFRSLQ3O6eTp+fy+KDdMC4AIAeQAbmAAE6YEj6WAfZisKbcH5CBZ5CS1ORiDZiNRyYQqDa7BB1JaZYRiUSVay5MVotoY4j40Zkp4kPFkkj+biBYKhaa06L074JZnKKQSezrdQ1FTCCGlfI0CTCaw0JQaHKKKSyjwdCTYCCYMAEACiBPJgQA1n5yAALfVfaZMpIImFW4QpT22IpiQWVNQVKQKQsKPmLa6uW5y33+wMhsPK2BR9ixqiKSJ02KJ43J2wFqpSS48lFi4qQhDGGFiKcLPmc7Rrb33KB+gNB4NvMl9DDxw1d2ZCblm52pNa2YQ8tSC6y8pYyT287Y5ZwV9HV1cEABKYGJqEwpJ3naMt2gicpIUjpjI6iNKI-IqIKjjOhUtSKHeRzcmKciLhiK61t4ADuYBgEwAEMjM-AHmk0g8uIVxbDahZXmICKHOYaSLPY+TWFhb61gAMqgABm7z0BMu5AfuSR5OkGwujY-Lpq6OZjk0iywp6YrcoUMhZCo3H4DhQbeDGWCYCRRoSSBKKwjQDjGNplyiIoV4LI6qjWEOjgNGeenLjWQYAGLYJggbCe2BqAWRcx5HI0iQU+KJKHyV7mOkVgWGcUjmO5Fg+QZxAxqqAnkmZe7kUkjlOjZVzIg44GZVeVjpJoyK1GINlis+rQ+vpfkEN+ioSEwJDqniSoSOQZJgCMYwiZ8YmRYg-IxfRHKCvMAL3pc4qgtk7m5b1-UEoNw2qn45ISJAHAleJZVLYctqrWOIH5rVlRXFYhbZDI+3vuuLBkqFokRUmghyPYTrgdp0JKKswiCpB2lOu5U6XOIzobD9tbICQUbXQtSRgzCVh3ostTXgU8M2I6WgteIVr7JhL5Vj174ACLBKM2qBrq4SzR2pEg9kjoaEU171AONjwxYjpTty2kXEcnWVt1vnvgAKmAbyCOwqCCEQACCrN4yDbUwjyqipBBdSFPBbVmkxMjupkbXaeWXVLnlhICQJQQBEwlK4DNYUJjdczpukQvvcKKTiPBGhLPOCz2JsGxg5jQYABLtHwxvAXkZp2IWNC2FO4i5FeKIvY7NB2Z6PK6UzKt5QACmSqDdEw7Da7rl2A3NwPAc6TV2EUlSFkx6ZXvYkgggiJeFF532Nx7vX60wTBTeqFBB0DAuD5kphWO5Yooe1l5jnehbmpsWS5FcNcN+72F+RIMb+mAzcB3ABAQNwYB+rgH8UZX7v0-mQOAucLL8iWAoDQ5hb6nA0PBBEkh5DZmvE0c8PJ04SFgDGVAeEwGB1gD-P+ACgH-zwQQohEC+bhT3hJeoMgJCo3SpUN69QdhjiTkeGyNkxaOwWGoHB-twGwCMgQgg+sAbYAEiQUI-goDqiYDGfwLAmB9EpKMCAkCyol1hI0I49QUJyBQtpQUGgYSemLk0NINl5BcWXs-Vcg0v6wAzu-KRMi5EKKUSQFR-gwAd04JAXRcwqgxXBK6bQLpUjnC4aURYsgWFKDau5M4ChKi5W8E2WMxAyCUEwDk6McY6Eh3xsYpYcJoS2gaOYAc8FXQxTUJkBCaQiyOGybkmMBB2YhTANqXEiowmLX+AiAcaQciYMlhfYQbIlDXkyvsRYnCuklIIM8DAgSIAcH8BAPoZIOiRhKSMhAVxTGmCyCkVJuQuS5k2FRQEjgXKFEZk-X0xTmwxgkJ82MABJd82MoyDLxASfwpIZHkBIKZMp80kxXGUCw+QiUGj5EaPBKmAIllKFNPkN5ysPa-O+USgFWMcYDKCEMsF+DDkAC8XjQtOffR0dlOSgm2BLZBnpzT2HONeDJKI1lfJ+d00lQYiDcFgOwdUeB-A0uwPSgk0K9nYClQUne-cGFlXFo6VI7Dsjzm0naRAUpi6xW0OKFIxxthCtjCKkpYriCSulSQWVELOBQswCqtV28mXqEkDZME0s2rx2cvkc0ikUpSnBCCW1xLRXvglbgKVMrcD+H1gAIW8P4AAGky62hwijIn2LUZOMgK7pgqNCFC4pTEaHxa+fSRL7VfMdUmlNrq02ZuzQATXzQsFhPIULrC2KY0cpR3K1AyBoU4CJ5IKDjS2-5ibnWpv8GQKAgZ83nkOKCHkkFBxwWUtCdIFh3JQ2LhLJWjblzNpJSu5NLrZWBnwOwUpwc4Xdneswxo8StDE0YsxKc8gwbcldKIa9zNb3dKXTGNtq7O1qPJBvXAOzyCaOGt64YvrYUD0YUcdIU5Gg4rFOPOGyk3oZEaDkeQ6V6iLvvbWdtT603ysVcMYK+h104CgLgP1Vk1hxWhKkRoKF4KNGYa6YumR5C5ELAxhNTGENuvJB66FmAuPQuwLx-N4hDifWRFE4T47EBXBsNfaEZgbAtIWAph1D6O2ytgLgfx-gda5vzY7c095U6NDnXHdQG1+FNDqP+t2BLsJ3sU+K5TabnOufc323DWrEhmfzMO8EYoHBCKcspOmPKOLfuRF6JxHyYOMZi4+tdYAACOfRlUvqgG+-t+ZxT10yuefsCTTNWEifUDSFxuTgjs62hzLG1EnWCtQZL5ltXAaxVccCGgbCFly4k7I6RHZ2FMTkat14RvLqU1VxDk1eikieLF9gNIZulVS7BJ02xqMWCUGDct3CwYxXyOsCUaxFAHbg++L8ghNYhD6KMJlp4I2ZGgperYxqyh6eA4idYhNws3tg7Bx1myBm9z2Qco5jYTk3dDqZzkk4rmujM5yR69pzD6cyvYlEdROT-fg8d2VeEOCqJc3iCA4LoV9A1fzWbqW0ksN5CCNYjURzw04Sw04S1T5bBtaVpt5XosbIKvgAZOtfynMna10Q4o57mLHAstkj4zhWA+ueRd+s8KuoCGxhlXqdk+soP4PAAlUCkMDuQ1AwCYBd2d0qzAggveoH1zkGWgIFAu3jm9idNg5m9dxVcKJaOoMY-t47uVqA6Uu6w+qz3uBvd9TJG3MkriRje7JN0CQQfBAh44+H0vkfif4wRHeWE54Th-HsPyK84IzQDn9dybQce7cO92e67Anqi-bxL2X3+fu8AUIb34QQs-PWt+91HrIsJR6bAy6ceHg4WXoVOBsNYWwp+5+38qt32GPcR-L5X6v7Ba-18bw-sPEf98j4SjXiS7ZBKQTrixsjqC1D5AIyLB367Ldq5pL4+4r7-xr4B7-yN4kAABGsAggfAu+7eH6eGeiZgSwiUQ6DgHItQFaZoRaMkp+J88BAQiBOayBb++eH+X+G+XcOBeBBB-+HeSYc6P6CUDsZg20FcUoBivK48V+S87yauJSEgOeCBWa-gPa7BqB-ugem+fBgg+ghBUejQhwKQlQNoIIWQNByk9cKS2kNctip+zB6a6hmhr+5I7+oin++e3+ehuBBhRhQh3YIhWKVQNcmQzsxgUsZw0gZgVBWgYMt+qu0GyhqhAQG6gYWhZC6BuhvB+AgYgRxBKWJqVm5olq0sUoyuyUVgFQ4s4oX2WgVwzhGRAy7hFenBXh3BWB+RYAhRu8IuJRDQFQYGcOmULS2wyU0hCR2YYWbUmeTczaa8-sXGjWb6F27OBIvuaBgCGBKh3gasggzwGxggqx76-Rt2gxqYhY+w56A4pojEawywvIYMgaYMkGCxMGSxGm-gpx6xjmmxHhHRWi3B+s+xhxsWJx+ITWZxmqAxCAc6VSwGVQs8yIlQjEgWDQtS0cmwtQzhG8ZIKGaGGGyoT+xer+2hORmBm++JhJc+xJggpJ28fRsJFx8JLUG01mRqxgPI5GE6YMiJeQTQJcZgwiyR2e0+fsyG+IRJlIJJqqz+rRbeHBVenRPhPBggNJ0pdJspDJ8p6qzJwurJtgWgHJ56WQ3JvIDUmUsIU4A4TQaE6gi6vEeAOuqAv4muG6rpeuQREkRw2glUqKi2-IIIjSNRNkOQmwdMtaTpLpbmbpmAEgfyuAHAUiEAfOaqAMaiqAeAfchpJOQowm3mTQNM2Y5c3CpwMId49ktoRGCwJWihKRwqzpgccZv4iZyZ7A+S28MKRRcJ7kJhygtoNZvIcmvJpmtUg6mQo6zx8gf2YpzazZXpCZuAPh0KxAmArAFK3SpyNGzCycNcFqUoR6iSxpsILoZOjsIII5MZLZuuCZgUyZeCaibcAkQUQYFJOxwCvsfQTAhxOAioggbAGAgF3SgFYAVKV2cgpyxaCcfILSCRDQOQyC4IpglRKEeKxcygN5S5EgD5qqqiTAL5b5ypXBap35v55A-5BIgF78IFJSYFEFsAUFPpZUbUB8c6CklwW2iepm6kha4cWgtGVQjiDZGOSZKZTK4IVxNojs+Q2gRw3WZy9QIoRQLkMm5yDaWeza4lnZrYvZrJw6zC7SmwmUyg0Ex5vF-p5wqEo+fImlHxyhasnpBI2Ayqw05AcZHp2urZPZ5x+ZNozE7IogVBtQxc4m-wI56gN8qlOQi6Tl2uLlblZIHlOs7ZKZSanAuAgugSfA8pRyhFgkb5O55pLCZgRwt8E+8O70RMpi22dcrsIlEWZWjlzlnASVKVqAEgK5dea5RAG5gwhOXyO55gcyWw4owZbFkE8EqgkgZ45y-ZKy8xhKMG8VMAiVXq7lcZuFeA+Fz5hVtYH56+5Ff52AAFQFvRg1sYDFoKV2wg0F-6sIvIo+NoEh8EGE5oDO8seQII9ZTVShwqq1iorlG1yVW1eFT5BVr5tYgJKpwJZFfgP5J1Z1tFl1MY11iosAd1LFiQTEKEphVQU4oGHIVVSIH154Dgc8lwqI85MGfQqGqAQww07ARKhIuAWxOh-8oJBxdNv8gFwwAMLNfG2NpmEsPeaQfI0IYsdQjS3KQ60c22hYjV6OzaX4oQLRPlXlMAPl0FjQ+YZMoG54Iaa2JqN+ToeQkE94ps-Ii6qt2Gm6OFaRBOIQ3AfOzwZIgcZIBA4Nqik0atPRxVJgsgqQ4+WwaQ58pQd4roLCUEUodszo2kNtIQdtmRd5KhEpRy+e2meAGyOA5AEYJegQlAgcxVMRsg4ENUKQxgZ+A4rkr2o8KQlwKEidft9tPl21j5xkfOttLR7NlJuCCNFFVFXc51dFXy6NBI12+l-lpGbIR5eYTQ+wYBewU5phdSlQ0O+wChf1jZdq3dPRbdJAaZRyEA6oQk-gvtyd752Rn5lCm+iNJ9JAQkggF9LRxVVQsRaQ7k6kmYUsjgEMJYGkdgKUzdl9B9R9+Aeyp9AQL9PRJFqpde-dXc99UDz9Sdr9wtCANoDyLo5V0I8lFl8Jn0AIjstgd4dQjQ9ly1yhRAio4Ye9rdd5mtS50FgiwxOKSgyIZgY58Jl6j1ZgLkc8yIj829GOND9Y-g9DKd8ZadjuRybtHtXtO1T5RdSo59aD-tGDcRBcB6j2LICgQ+ZgLCCwWkgl6Si6YjqjkjDt6dEDmdUA2d+saZTwtDyoMDrddjeAxVRQTo8lL2NomQCIV44grWUoHWcOzy5jLjEj6jDD0j3tkA-gFjdDMTB119R1A9SN1FI9qN49V21g0FcFwxqQKQkE4gtgU8pwAIxgj2RGtQ7xVDwqSTyoVjYDfOD9Z9Kj4YbjqTq+N9iDggyDj9XcnTZIqDLdW6mjJDEas4omsSU4zkrII8VNYInIwjytMGTT0T4zOFh9bTUDzj4j3TQYMNpFCDvsAzv57TwzLjYzl9BTFyhQog4EFw2wPFPDV8s8ddiwdSW96zyhlFU0cWWiQYTKfILKRuGCG2toMt+YkZL1dgVU1tNN1D3As+ED7mPOCTxIAuV9vT6+JAUqzGqaAAcqdBAAAGo4tR4OA95cNzptS8hL0IB3iBVyUnx3xCPmOouqZHIYtkv86YCC5wNw0IMEvsBEudqku86UuCtC70J9kFpUGzowzfXwwugvQwGII0Q6TOFHH-FqNnYDJ6ssZXa919O83GupqoOGvgkbG5nytGlsUsQM7iAcN3Lvbd4imcRMT5DGC6uxZ54F6h4aZmvr4WsQnN7qb6BR7Xhm2FBSWPbgiKWLBR3FYjw2C0Q2D+sbHgo8ueohuHW7HhvHG-4ab76oLQKejKDfVhXcJAjy7mGom2RNDZv6uRucbcbaZs2FvALFv-FN6Z3sZRuCBaY6YYMpj2xnBQQMxDniZXAVAxoggLyyB8itvjaluaY8bdtpNFu6yWudpb55vDujtC1T2d5OtG02C8gvXcMIpWJLQuiCXCi-V-PCppF-HjbxZMBxm5qhu7u2v9tfvdz4Exsp7jF2nPG3tsRsg1xfbghTLYLItvsSkftrpfs-s9p-u9t7sQlAc6wGH75LATyyB1OqCWl5aIyV18gLI4nFxrvVZ1YNZQlvpYf-x9ssbA6Mdh6nFR6IoXjr1VCFDtRvVNBsiQTyWOCtJzmiWLEof7uypDTqhTaYCscSDsdWuKfqbTZnvCG7YW7VvDoXhvOehHAAiXCqBAjVRSjmNa5a1qzxme4+wEDQUIgxSDaGIE0zInkujSAZikzXjihLWRYbO2cDL2e-iOckJ6V+X4zUZufFxkHQRTLIIKC+fZbuQBcyhId2pEChf+DhdeqyJRfWA6fdhxcVAJcediheembaRzIwwLAZcchZcycheen5cOdFfOcyCle+mucVcIlJc1dnJbZpeNejyBc2ftcFeRfOcqC9e3T9fue2CecmZnJHDkF+dNeTfZffK5fTeddOdUBiALeJDlfLdDdrcIrUxbcTfVdTfeUzdddUDCCneLRLeVcrfVdXf1Fjf+fNexW7cSD7ePeHdRdyBveYNd7zLM4OwN3JvOgFyZT9jpiehZAvtaVteg8RfPdSCQ-UZGXZBXBw-FzJtjr6a63XjmCdJA9EDYDJVSPumxjtd3ksOPEcibBj4SHG3MttRzK8iFAoiODZDU2tfUP08Att2O22OHL2Ns2OOu0S+ZEeOnsxdJg5DWl2DPItJTtx7wy-dijLbi3ghHDmNK-WOyMQMfiH3YADCKMd1PDm-DVtTy6mUZfiAODwzm4cgmdHD5Bspm8M84XxN8509B+qfHWUWnVZMo2gWUo3WwAqAFNTgVDk2Qx+9REXy+vWT2llwpxN20-m+tPH37PkDm8R932XMoNl9B-DXQhIqk9GpC888MwvSvbHDcjQyB+S+p27Ml9DOO-h8nPwP17nODNP018Av3XzsS1SgW0ORvNyYRwm8shSaWEPd2fSOwD+wcCZVQDHJfJqLYAbwR87-D2gVMDH+9GyKCCByQChLjv9iHB6qVCOxtTQiKWHimBS6FZDwtciPNoQem-NstvxwDsA9+B-WMEfxP7D8RWo-M-qPSuqX8N44eASLf0IgYAdEGDZQNIS17UcDaFgN5rWlQqkxMkZcbkBvzC5b8B6kA1RLXg1o9tb67ARGlH2RrAUcm8fDGqcnsAghzQmJaeCFiYhMsAqkBNYHUDhwOBTglAjriAJoGo1-A9AxhrAJrzw1mBg9aPsPVj70VOBE9bgQ3UeSn5+SVQAhjRjPKcgk2I4JbN3xToxhJoAyFgDmQ1rM9vKrPDBovF87D4r28HAhiPCai2gUQ9gEDEUGsE65bBhELMo4NTrS99+r5MkFKgiGbEFeCg+nvEIcEEgdy4IH9J6BXZ3g6mPPQxAGlMQfZ+U8sEIW5jCH2DsyYKKITY335BAjifONIZ2SSH1CXaCQ+1uUnV7GCjG1TeoKFTvCCgEWzCZQHXCmToV6mwXcXkH3KF2D2hxfCBlc0H498Kh7Qivkgyr5DNDi5vbWBUI1JVCOhn6CSNHlha5A9U9RLyIMMLL1pw484ILs1UaZF830swpoVL1qHlD6ejQ-Yfb12qT8bBzw-YRkN5C7pjAaFCwI+EGE5AZ45wP0rBCwqF9phTw8IS8NToh8lhfwpEV8MYGIMWBQ9GiuwLj7gUE+YgZPpIHnS2hqoqrMcOVQLiZZBOxNBLnblBqMNnBWtVwfjxeqmBsgpicDAjCZaIh+egIUKjOBsB3D-qdqaRB1TbLRDGamZJoamXTL80-YAIzRvyidAijhMDidyIMPZDzJkU2kUtDaEZGSiEy0o+gb8KNYuMc6c+fOk5iLpytOh3YMYdIELCkZC4IowUCGk2waUWW5gDGEDwlFS9wG+-RYe5TWEXMGSKDdysVW7wYJ9069WCHyKramB6gCXTKGDHHhGjXhlvfftKX1iwNva66ZKsVU5AFg6okgjXtw0hERxchLLFpHDkzEoilGb8CBqGKxGR9cR2TAkYxSkDQU60FPCWO5HAjS0xwNGSsqPgRBFAbA+2f0UyJWHIj4yTDbWm4NRQsJ-Bzza2AxBHG7Q2QdQGuKCGPhrNMeqRWcf8MiHSNpRGZJUTmXlEyirx6QyZvXyYhzpZ0HIT3iOOvawh5ANGcMj7wbFzj9hWYqYBAzNFF8RmVovOgXVgB2jixkmRWEUHTCngiBRDDbDyCkipxpOAAz4ieIxFnipRQYyBgP02qIjKh14tsZXwjGbD3KOwuwXsJzIZCrK1seoA7BMoejNAh+X1qBFPyHiHKb7bCSROqHni3hb6D4asILFRjJmona3JxCyBmAwYgoCCDAiJ7ZCOQ1GP8aeIElSihJb8MkJ8OvF9VNytA4sYRiES7RzYWoscEfADSmVJxUoOCmpJwkaT7yTYo5K2J3ZfkMmrAmPviO0GEiMaagAppRFOAjhrYYodFBZJnAwdvs1mYwJQ0mG8SUq-43CU5Id6Q1iKZEtQZk00HeSx6Ogq7CkHuZNR0ep+DNpsHklf0F2tVeuCFjjT+AVyCg+RIZB1ABAMAciTRH7C-inJkgU6KcBBDogjh6gDUOZBElyCyx4QbxXKGQGwDdARgvLBmqIkDiqdJp000YMBx8T2jDht0cCGyD+DKA4EhQJCspAOAzkx0HoB+BNOTLLTZpaiL+MKxUGisLp00VaQ1MkqzU7KCgTIBMnkjwweQaoryILzFhVBzpU0maeiwZqaw8qEDVGotIekrT8OqNe6qNT+B5AMw4oc8NwxBEAhzAwoBLhniBmXTQZOVCGXUO6S3TvC904GbDN1jwzx2FgAEJIOVy2l0wa3MYixEMTGAy4u0XKF8X0BHJNY0qLcLi22Lr4+Zm4DAPrClTuBoKjoF0ApGtxoJ5YV4WqtHR2woQXQjgMwFzPXgaZeZG4AWaTO4IiyBZ4s9gJLLcHSya4ldTejfHkCKywYAIULOjzVmhTNZyxDOt7F9jXTwEqnQSD7D8A0JjZpsyHrkG2mBDy65NRwHHBiKcgJwIhaCC7O1m2N3ZWIeacc3aKw07p9eH2b7H9kSz0A3AuZFJDEFNJUgCUIJikHNC9Ya4UyVzr8yzzcyjkxkHAHwFU6NzsAfAAOXnM0bCwpxoWJiMVkuAVwgRU4mCMbilBpwxS9ciBq3ObnKCyZ9eaeR3KwGQ8Xes8Cdn3JRADybCwc9YO72dBjza5TcSeXUIIhEQI+J8pgIvOgqSAuGkuJmccBrjJReBnCRlrVUrjcSPYR8wIOfP1lkVz5l8twUNOyGScmI3I8EIxAPx4CT0DgQxAfI-layeZEDDckJFU5IL2A-85efmGEppiOQgXU3OARiLPZ60+QHFFOHjkIL9+qCn+Qg1QXoK1e3YMUGJ3E5JsIyiwbhipFPQlw3oyISuqKOXCfy8EJkCPo3MwC0KWS+ZcUM6MaINA-gikRSjLLNApAsob0WQIDInnwKCcwiqhaP2EWiK8y+MStNbip5Fh+SiwZyKpCfCuhBOBPWKb6E-lQ0QoqnexX4F0UOtxFzSFpApSHSmpoQU8a0h7zOBTik4KuUSnYqCgOLZ53BJxWgtzlLy6FRwo8PHUgjVoKGYoZKODHPR1wywKEUUiEvUUQNme3QIqJ7SxEFKilLih0RJAPxjVy6wmOClKAagDphKJlP4FsCVp1y8l+-UpeSC0XjQCohS8kOUo2mJAvMvWC2ELA6xoQGohjeECeC7z8pcomnUaOdAmhTQ9+i00IB0ROhLKq8Ky6aLolKAxSlg54O4snGgQQhfgeNVIPqJrpxJqcCyrZWdB2WTQQZhACJWqXkQ6wVSDysaLsvBwsUDl2wI5TElPhkcwFZUeYJJksIxIbILSO5WKUWWPKLoOyNZViI+WbKRoiK3uPsqMDXF2JXFBXGPD0AXL7YUKm5bCr9GiUEVY0XuB0B6VoqvlGK6lciuxXjhcV-0kFWcqJUmgSV1y2JOSpsX6RP5rcduJ3GA69wI+fQbAt0A4Aak24wSYHMyowbBzWkVgBCGlkhFD4tpCgQzFLlOCuhYF2EIVXKtFX4dxVbys5pKulVdwCq8qrFUqskABK7YGYN4uRyTyicigG9E3uBGCUiNP5fSM6FzCTrTBVOHgM6L4G5hxBBlJBVLFDiKBjVzgefcOsvRsjf9-Bp+KXOBDIVHJ-VnMIIBGuDXmr68oa0YOGqDXcAo1xRM5LGuPhzEzgEZJNcy3CIAhRi6a4XhMNsUdL1068TeOqkWndqTo28CtXCW5RmltAoU-kKcDLIR1lALKOSupGiT1i1Frslsf2q3iUA6Vq69VEOoMpmhR1Q4hoBkinV7BTUsIOdeBAXW2hcof0fPCircn-xNY-0dgP5DlWhg5e606NSahFBANuFRQa4vDA5HxsU2OKMEVer4CPraVhai6GBpvXPr24r6l0vrhgTp4YYlwfkNan-WFBT1YxGSc6BBC8KJAQKWlViOmlRhYN3QeDcXXHaSAq6b-U8LYEWxqsfpSgbSPfBMpZsxShGrwJBpI1gAyNFG99ZWvfqlMqePIRugFUphDFtWZdA8v1hcAVgVyGAeAFEBvRxLwVWgOgvHDFiGZhuyQG0MmMVoerdxHIdOKprDjlAwYFhENCy03H2gJFtoGxOmDiJVscEb8DADQiU16KQYJ8CoJBENpXKkkybFNlimohaAa4b0NpU3BfhUJCEbiUzUIFyCKS4EH05OEgnLLMQpKaSaiJkgi0rwXEKc8RPgjwhxazkW05QLVVLhhFUI8EQXpVD4QCJfsOSkRi-Hy0eIMAxWwQEIwLBJaEEOJDFPOzQRzxJQWCAVTvRjDFbjGbnULWkGwVNBFKHW3VHbFRnl04E7asUfGnsyBhxtuGsorYBqicMw61WlNdmDyDoxRNI28UrnnbYL4X8beYreq3SD+p2k86bIEPnKCkwOoZDZGM4V-zXbFS3uO7dciMbqAJY9iB+cpHejSBFIs5MsMZv9EodWCyBAHZhvQolzWFM4CuAfno3GIQRli5wogTcK3axFneOspyNKZow7iTLdJCKBPCqzUUIC5ovvQjwA7LgEMU2A5DnQNBkoM-SxY1yfCwQ7c8Cn4sx1UTycCQSOuZH712zm0rkbC0otHIRjqiMePE8USh01KoZtSmGRkjdv+1E7hCli2Is-OF5DgCG-Ye2Geh1RVtEOYvJsrGTvLFb+Q1pOiPBXrjlULEySZjbJkcC5Cae1uu1IuTbo6V7dIIAuQOHPBGIqyt7IKSkiPiG0x0SRX3d8n92p1uq00zAMVqIwxQklQ4bnnr24S2BJtskcInzwaDYU26BY1KZtt11lcHqgpDNU0H4RMskk0kdhFOE-qCVF0geqvYwnVldaRMM268NVvMyWYrM2WBCKttG0SBAa61QsR1Xt2ZQFFT1XbaFMb0NBmEzzeCnM0wpxVWqwNGfVtU72eayu7oFhKjGPiwcHAjej0BXOtmj4LN2+hKm1RBodUuqq5NPV3tYpyxKou2qwgoDEwetqNwGSCGihAw5a4pdqKfY-r32pVy9RFSvYft9IaBRqeqRWLDCqrk9JBxGYuCBgNX3C7UPNBmpeMFp3axcsCMFqvo9AENzYh8EeGVTKaCogeLTO3e-rO4KRZ6kEeerZMp3vV3+c4LkLIBwNraJAjBwSdmO1ANCLs7tckOnuyxVNiyMkQ8rLnLk8lgyZwOsUiwT1CGUmFvICfvxV5B7rSw+ccdsErqKzTONkWCPBPqSyAQG6tRsR3QSZWMg9DC2yFyOhhVtZcjxcCFKBGEbYD1Nh-er33wmLCjmQe1kOhFuQ1ljgg8x0HFEN78o+h+GwAVE2EO-h7dFUV8WsGhxlMCGdcWdcFRGqihAeGhzZikZNFvD5GUh5g4gDjpIo60FZOxGwrPCmBR5QIG8IkY2bJGtDgEiAXoaqNCgYVq42QFOz9KehI5Ci89cfEyjchx5xRzo9szL1NiEmJRrQ0HsqD6ZaqVMDbmwozYFhdaNdQ8FkEibiNSjEgXZgRI6ZRMQjfRqKksFRKV1rEomZyLTNtDywaYdpKQUDwBZkBAgwLLbTXGf6mgbQaEBtR6sPgkMpMMsxra+xy7csZEBMzFnzmxays7t+u0AhQ2DqozZcsbdChxE0h8h9g9HE7EElQDnZRdV2FEzumQgZdW92wfRu9kw0bArAE+K1PwkJOyp22GmCk3rWFDHbR0VVR5rUStBJIw9piNk2mg3Zcmdx-nGk3ScSQD5v+WgWwFcvSgCGJ977UXYGwVQu5viJ7SU8hBWwPGUIOR+BDuLMBugEuVZMU7m0hRRtO2vGPU8cCkpooBp3CKAhZlNDbAH4zoK0+h3cw5oUTA4WIn3LVUjDG9IIR0GYkXbhnvIcO3PBqd9MM0e0AZ8gijBqSo8dsQTbeerME5LZWFVp2rPVi9SnEHTqspQM6amrcIYIQO7kfXFgRWnNOynAM1YmWwqQEJgTbhPwejpDHP6WWYIbTzy5PcfY9u3lBZkag2ZYIg+24+chnBnp0wSuhpjl0eHxk0jlTCXDyIz7cMLaMUM03zqDp9yyhNQ0Q70fgOsVZ0kUjCIbWrb689Mz2OtUOmTjzmwDe3Jc5pNEPW8dkAwdPd8yRi-psl0BTcypMPwlysgg4W3PCJ75xNFjofc3tIe7yryWQUlNElnwkXFMb2ATYmAeekZ98FhpfGC30dNjMIlTNcYw75obU3EhprSNYJw1gigHcDe3Ac8ub6M4MI4CEwoEkhRCuhFZEu9QOnm8NM535T54HgxZAFn8IB8g5AWABRPeNwIbF08AlHyExF9RA+Z0NVWnHFHhLCZcirQIUH54fKxBn6UktO3HbymVIxCGHQRQSCzCB5xKY5JXPLRIOqSP3g2qxmRI2KWgbkJyELACW6LwPR4TZYCCHmdDyQuIXePYBOGzYHWGssnHMmlA8GMIV8eESETx1rL6kgKyIaCutDUM7Q0I2vrqCbAqgLx1JVSOyirjCrzqn1dCefMIj-L8w4MbhequpWg9ZqLIyxrIzw4R4mClbtPG2ibAUrDktK6+aCvCSdJ2V-C-wk-HRyfeWwR2BCP2Cz00TKIM4DXD6v8SBryU-Cgk3NEzD+rTVkUDozq7Ry1uNoRFGMQPJ1q+QtFwQwGKYMnmWDFyIRgOLHXDjYrL2baeeHYg9SKVmE48caJkYZXFRo1266MnLm5nzrAXds7FdhWmFgQ1afOO0Z+vdGjkIE6YSMyD0+c1+Fm2TKYg9HOwCw1TWoF5HUPfX4pgYnZDhcInJU59ySRBJYg4mcWRxjgfMFGjHVr8oTR4km4FYgG5ieiqx5hI1BuTihhOI45EtIDVl+MhB52xYkyMgsd0XJlN6415bNp2AUwNkDeXyJAuQF7ww4d64+Z8vXWarN11xbF2dCjUipCgEqQ2p6k-pVKWWUDFbuJvii+JcwzmwTgBtNCg9JhLI7VSzCbzSgbWdxV1cV32TVriN4Cbpa2uo3rjdECoFwriKWxLbdpUqjQZHLo9g7zt88UEf2ZET-Lc+1Lsjy8N2Bvqn-VqM6KFIxJ9groNO-OMGsQDhruksXWNb-olNDwc51QAQyeb89iYE4W-RhMqsqEnb1d9a3gjlvkAmrEu9YC9lSBz95J1iaOr6MHAohGgVdgCXYd2oV7JLUd-45LQgx+8yw8kurj4xOUErhsu3WqQzTWnta54D2M025FkghkL4vAocVTFxoiwEQeMl5T+xTnFar48dFS3YEKv1LDppIyXFmDGqqBx9pxmGVdPBlSoCc3SYrQ8k549SXjK-dGVtPr3sRfRScLNRA0Nlta+jHW7vIlFc7H4LUnOijAflAhUxY5TRJdQnN0NJz2p4CdrQRlMAchfNKCJmXHB3S0xjS8IAk3Q-IVyps4LDlnR-3-ReGzKJuocYOktTaBXk5yHB8fMIhMBRHD2w3umPAdQtGINLOxKkmm3vQlHPxQSGFYIcpR5kzyYwcKBknOQOQVEL8TCrK0zHfVnagRcFBYe0yLwwZPeShreYug7HWwGcJtH5TeXBVnaqJR48kxmFoQLG15lPG8YoRyRbd+CaqZUKdqulZIFh5BAyDv8zMi8BpamDHUwRRAwle5YysqNA3yoJYq5bJT5Wut5JeQSQK8kygpQyOvdrPFSuWXPK9+7W0QC9FJV1O8g8kwFYffxWgrdb+kTp1XhpX4BenqQZtbyphX1OLJbK4FacrHhGPhV8q01cipYeBZ0IrzWcDfDMCarbjV7OSBGRL2CPs1HMClE1NKgVLwVIgkKdVyHRFgpYlTWWCLxajUEjH-iDeAOsoB7P0gjNwTOYO2ibn420gfE0OSZnoxQN4G2Z2Y702wqM2RuOg0yy3PDF0k5pNGLlE41QAsnsLBEBCxGnHxNzgQ5-srnxPUQPjLgIAA */
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

        'Boolean Subtract': 'Boolean subtracting',
        'Boolean Union': 'Boolean uniting',
        'Boolean Intersect': 'Boolean intersecting',
      },

      entry: 'reset client scene mouse handlers',
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
              guard: 'Can canstrain parallel',
            },

            'Constrain remove constraints': {
              guard: 'Can constrain remove constraints',
              target: 'Await constrain remove constraints',
            },

            'Re-execute': {
              target: 'SketchIdle',
              reenter: false,
              actions: ['set sketchMetadata from pathToNode'],
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

          entry: ['setup client side sketch segments'],
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
          always: 'SketchIdle',
          entry: 're-eval nodePaths',
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
          entry: [
            'assign tool in context',
            'reset selections',
            'tear down client sketch',
          ],
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

      exit: ['sketch exit execute'],
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
  },
})

export function isEditingExistingSketch({
  sketchDetails,
}: {
  sketchDetails: SketchDetails | null
}): boolean {
  // should check that the variable declaration is a pipeExpression
  // and that the pipeExpression contains a "startProfileAt" callExpression
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
    (maybePipeExpression.callee.name.name === 'startProfileAt' ||
      maybePipeExpression.callee.name.name === 'circle' ||
      maybePipeExpression.callee.name.name === 'circleThreePoint')
  )
    return true
  if (maybePipeExpression.type !== 'PipeExpression') return false
  const hasStartProfileAt = maybePipeExpression.body.some(
    (item) =>
      item.type === 'CallExpression' &&
      item.callee.name.name === 'startProfileAt'
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

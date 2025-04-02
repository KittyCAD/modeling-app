import {
  CallExpression,
  CallExpressionKw,
  Expr,
  Literal,
  Name,
  PathToNode,
  VariableDeclaration,
  VariableDeclarator,
  parse,
  recast,
  resultIsOk,
  sketchFromKclValue,
} from 'lang/wasm'
import {
  Axis,
  DefaultPlaneSelection,
  Selections,
  Selection,
  updateSelections,
} from 'lib/selections'
import { assign, fromPromise, setup } from 'xstate'
import { SidebarType } from 'components/ModelingSidebar/ModelingPanes'
import { isNodeSafeToReplacePath, stringifyPathToNode } from 'lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import {
  kclManager,
  sceneInfra,
  sceneEntitiesManager,
  engineCommandManager,
  editorManager,
  codeManager,
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
import { angleLengthInfo } from 'components/Toolbar/angleLengthInfo'
import {
  applyConstraintEqualLength,
  setEqualLengthInfo,
} from 'components/Toolbar/EqualLength'
import {
  getAxisExpressionAndIndex,
  revolveSketch,
} from 'lang/modifyAst/addRevolve'
import {
  addHelix,
  addOffsetPlane,
  addShell,
  addSweep,
  createLiteral,
  createLocalName,
  deleteNodeInExtrudePipe,
  extrudeSketch,
  insertNamedConstant,
  loftSketches,
} from 'lang/modifyAst'
import {
  applyEdgeTreatmentToSelection,
  ChamferParameters,
  EdgeTreatmentType,
  FilletParameters,
  getPathToExtrudeForSegmentSelection,
  mutateAstWithTagForSketchSegment,
} from 'lang/modifyAst/addEdgeTreatment'
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
import { ModelingCommandSchema } from 'lib/commandBarConfigs/modelingCommandConfig'
import { err, reportRejection, trap } from 'lib/trap'
import { DefaultPlaneStr } from 'lib/planes'
import { isArray, uuidv4 } from 'lib/utils'
import { Coords2d } from 'lang/std/sketch'
import { deleteSegment } from 'clientSideScene/ClientSideSceneComp'
import toast from 'react-hot-toast'
import { ToolbarModeName } from 'lib/toolbar'
import { orthoScale, quaternionFromUpNForward } from 'clientSideScene/helpers'
import { Mesh, Vector2, Vector3 } from 'three'
import { MachineManager } from 'components/MachineManagerProvider'
import { KclCommandValue } from 'lib/commandTypes'
import { ModelingMachineContext } from 'components/ModelingMachineProvider'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from 'lang/modifyAst/deleteSelection'
import { getPathsFromPlaneArtifact } from 'lang/std/artifactGraph'
import { createProfileStartHandle } from 'clientSideScene/segments'
import { DRAFT_POINT } from 'clientSideScene/sceneInfra'
import { setAppearance } from 'lang/modifyAst/setAppearance'
import { DRAFT_DASHED_LINE } from 'clientSideScene/sceneEntities'
import { Node } from '@rust/kcl-lib/bindings/Node'
import { updateModelingState } from 'lang/modelingWorkflows'
import { EXECUTION_TYPE_REAL } from 'lib/constants'
import {
  applyIntersectFromTargetOperatorSelections,
  applySubtractFromTargetOperatorSelections,
  applyUnionFromTargetOperatorSelections,
} from 'lang/modifyAst/boolean'

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
      kclManager.setSelectionFilter(['face', 'object'])
    },
    /** TODO: this action is hiding unawaited asynchronous code */
    'set selection filter to defaults': () =>
      kclManager.defaultSelectionFilter(),
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEFFGjUVUxoZKTEZMSkLRTVrPUMEDQk5a1FctTFFFRVrWxc3dCw8Ql8AgFtUAFcgwPYSdjAI3hiOLnjQROTFRWtpdQc1Rbk5NWE5EsQZbYkVOqyaOXEz60UxFpB3dq8u-3JuUb52cajJuN45lK2JBz2bZqLIKay6AxGFSKCSOS7WOrGFRSLQ3O6eTp+fy+KDdMC4AIAeQAbmAAE6YEj6WAfZisKbcH5CBZ5CS1ORiDZiNRyYQqDa7BB1JaZYRiUSVay5MVotoY4j40Zkp4kPFkkj+biBYKhaa06L074JZnKKQSezrdQ1FTCCGlfI0CTCaw0JQaHKKKSyjwdCTYCCYMAEACiBPJgQA1n5yAALfVfaZMpIImFW4QpT22IpiQWVNQVKQKQsKPmLa6uW5y33+wMhsPK2BR9ixqiKSJ02KJ43J2wFqpSS48lFi4qQhDGGFiKcLPmc7Rrb33KB+gNB4NvMl9DDxw1d2ZCUSOzb1VQ0KyZVSCqVyGQScE0BEc21SI7OCvo6urggAJTAxNQmCkjunaMt2IgOLCnL3lUwhDnaiD1HybI3hy4hrFkb6tD6+ArrW3gAO5gGATDAQyMz8EI3JyAC2w5A0ZbWJUV6KPshwPnYLo2hYvKLhiuFBgAMqgABm7z0BMu6gfuSR5MIbKNHUYjWEUjg7GOma3q6Dg2jeRwvl675VjhNZBt4MZYJgpFGtJgjco6jFnuo9QDp6wiCsolwVBYNpaJs2yKLxn61gAYtgmCBmJ7YGiB5FzHZALiKsZyNE0OZji6VymGsWyOFOORyIFxlfkQMaqsJ5JWXuFFJNUFRnFYvLKEUtpXrYki1JoooetYhXLiZBB-oqEhMCQ6p4kqEjkGSYAjGM4mfJJsVCMepjKRyMjKCkdTwQgG22qYhaetC+QyFkvX8QNpIEsNo2qn45ISJAHCVVJ1WCDe+aVDe04vjY+yCjI-KSMi-IaDQDgjud-XriwZKRRJMVJu9NjSOKSiwTypw7fYDRZSkjRFK6ulQ1+yAkFGL1LUkN63id3KcravIIleIIwtkVhKPsenNIZ2F9V+AAiwSjNqga6uE80dmRSPZLejiYxofLKRYV5ipOyiNEcygXD1vNLhdAAqYBvII7CoIIRAAIIC5TSPpjCIL8pUKIDmYo6lCxYiOraajiCySmZDIJO1oSwnCUEARMJSuBzVFCavXM6bUQ+Z4yCC4JXGo7m1bUZ6ZFoXvXsHQYABLtHwttgfFohrNkjELIsV5e464PiJyLEpcXBAAApkqg3RMOwpvm098MLYjYHOtRCz0Q4mR5Ec7lrHJWjmFcp0+WoXeW0wTAzeqFCxwj0uT+IFSnRs6e+2KMhXpsZqA0Tdj2BtXcAEKoABM24NifQAEbsHVKESuNlKhyRtLUF8dhNjigBjXc0ZhHbmBvJzd+n9AxkH8AAVVwHqSW0UT6gORKjKQzoiiNBfIoAGztUZmByLURwBksL636h-L+mCACS9YgjAPwfHKm71uTIRYk0cGNpkQAxRNRcwtgUpSlfnrPiJkJAxn9GAbu0c4AEEtnDbAwkSChH8FAdUTAYz+BYEwPolJRgQBAW9UQkg+T5FUMlAcTF1KOXNIzJQRx9iLBUMXCQsAYyoHwhosgWidGcH0YY4xJBTH+DAAPTgkA7FxW0BUTkjQNiLG2A+dylwzSiHUNyJo2wbyYUrHzCQ3gmyxmIGQSgmBanRjjHwxaSZ6iLFhM6aEtoGjmAHO5ImbJMiOFgvyFEjhzotObDGAgQsIpgG1LiRUaTECWDvHkZSviyk2DgWyJQjFfrpkuPyGZdT5nPAwIkiAHB-AQD6GSDokZWnrIQFcOQk4sgpCUDkTkHJcybGkL7FijgFhJQua0mplyOGk3JssoIqyCT+FJLo8gJBLLtIntJK4yg7zyHRg0fIjR3I2Bbr9JQppnFQrmTC1pcLaxkyjCsvEKKQnPIAF4vExe8q44MnRWE5KCbYA5b7qUKeaew5xGJnCLLS2M9K5mMqDEQbgsBAEkDwP4Dl2BuUEkxQ87AGrGlH3HoQ6qzkW48mOdyLQp0dpSgfNINO7MtosW2AqmMSrYwquIOqzV2q0WcAxZgI1JrD58pKQlMEFhEoaHdogQpjp7DZHMI0Gw9qvU+pjH6tVuANXqm1ZbN+3h-AAA0+V1FTOQ2QsEcinHFaUcE6YKjQk9v5DQBVFG+lmYqvtubioBqLT-EtZaACaVaFh3h5GCxiWwvmJoQMpWoGQwaVDMLyBQ2aB15uHVqn+ZAoCBirbBQ4oIeSA0HCoK80J0gWGUhvB8YrKkfhwgOnNe6C2Bp-oGfA7A2lxw6d2K4VhDgugBVoKwTak1KUkFOeQ31fakLPDu2FQ7v0jvMeSPeuA7nkCsaNcNwxI3YotYkeoZhTBuypWKQssD0qVEnA+nI8huL1DQwyjDhaD06tQFynl4V9D+ExdgKAuAo0ojZB3MwfxGgsXchmgE+QXQX1yIWTjyruM-tReSENmLMDCdE+JqtZ9kQKGRPeaE+T1I5CWPIaEZgbCgoCj299lzP3aaw7AXA8T-BmwrVWtO5pPQbA2ClMwS91AAhSA+VKnotjlmYXxD9u6vO8Z835gLk6yPWUtfQ2EG0W1ewbmsK84h0inVTaBwGKJNO+vS9qsAABHPohq-1QAA1O-M4oeQg1gv2NSHsGp3kQlOC4pSmFVP1ql9DtZ808e1SNdU4VqC5aqhRhDymrikI0Jmr57k03mjSPIde7bGL1cHfN-d2rpq9FJE8G7BIaTrYTghfk6RjCqARBYJQNN3IoWkA4RiEo1iueS72jzaXay-kEMbEIfRRh8rWPZ8GV7RDgi2DtX28H-ngtlRtJL02UtQ7m0Ga5yzR4PKeS8xsbzXtU0+d8pQrp14ArSvacwhwUTmHztkT5l2v2LZ-vhDgZjfN4ggKizFfQzVSzy5t51IOQTL0BiOAGJ47ynCdixVIX3BdfljEe5ZZsALvJXT1hxzolKnUFEctktF6r7AwlvNzy4P2W3wlqgIur9XDDDXciNlB-B4GEqgAgEBuBgD9Lgf8UYJAwCHr7wTghQ+oHNw2jILEFBezTkUGDy6bByQatSq494idvvdx5z33u+MCYNQH41JHg9p4GmSPuZJhrWLD2SboCe-CCGTw31PuAw8Z42j0kE+Q-g4yG0m8EZoBwlO5NoHP2aa-3ODdgUNxHTUh9H+HyPMcY9x+j4nwQW-Q0j7HwzpMCIsiwiKJfOdWNmK+ydNyCUz+tjr695vvT2+hqgezeyyre5IHeXeIwPefe5+l+mK1+6et+3Y9+i+Eo86rqU4zExCaQ7oJ0dgiwv+teY6Fa++YeEeUeJ+qA8e5+JAf8sAggfACBGejQ0g8sXyDgHItQV4pCZo5CGwLoJYdQhB9yxB5apB4e4B-GkB7A0B-eQ8tB9BjBaezBt4yIKINudCVg3BUosIdg4M9GpwN4whAQxB464h5Bx+eAp+chggChgg+gTBSB0kCILB1mlQECDqXB6UfWd4sgQITQvs26buOaEgG+Jhpa-gZhYB7eUhUcUB-GMBA+dhDhyhTh1ULhmkA4og1Q88xgAMpwjoaaHBvkacr6RkVe0KYRIm+AgY5hR+0eVhVBZ+SRNRYAjhQGOK6RTmCC6YcaUoWwbk6UNot4XyyIaMDgWgVwxh1Rx6oBB+beEBcRMhCRNhR6gY7Rx8CusGuMnBeuPO18c+y6Smvk2YUGU44g6+u8hm-gHWAGj2mGB67AFhDRseTRoR3gBsggzwDxeAggtxgGmxG22xqYhY+wj6LkCgTcawywW60qGw+wlxUcwm-x9xwuTxkhneSxshlsHxXxT2fx+InWAJ5qWxy6bskEdmsENg5mS6Lh+YDQ-SwoTUtQ0xe8ZIuG+GhGyowBe+re9RlB1BA+bJHJ2+XJggPJh8GxJJQJRxWgMWzmDqxgPIgxzaN4SwVw2yTQRwiCrJOG+InJlI3JTevJ8xGJ0hsh5+wp+pophp4pxpkpqRHR5GSayI+YgIj6GEsEvIqsL4FJA4WpU46g2aAkeAJu6CBARu+AYZZuaRiQRwGSxSyIO2oMBeKQYG4M+UOOr43aEO7m0KIZMc-m6CEgXCHA2iEAUuJqcM5iqAeAY88uMpsmKaiwmO6g9+HOCEpwMIG0p0-YgZCwU2leIRBZ0ZmAJZuCTxpAh8WKTppJOy6pvIPBDM6mKpnZnoM6mQC6sJXywZoZRZAEEguACRmKxAmArAiKly7yrGt49g9U2gNuN6EqxCiw5wLEe2vIQcwRH6I5+5Y5oUuCwS5ifcwkYUQY-JjR8eEcfQTAXxOAioggbAGACFlyCFYAyK7AsAcg7yyIKMWwKwvkDQOQBS4Iq0acLEziD4ygu5hZpuf5eAxqZiTAwFoFCxsR3eKxUFMF5AcFBICFaiyFrSqF6FmFV5aOWyNoKQlwacdg7krkhwOUrpbGVQusuZFRdKpZTxfKGc3Owx2gqQL4nIslLBqQlwsWp0nyOZxOkO0KGlBArYs5MpYKt4aQl8lC32fIslGS5wG0lm4illQ5H6BsxuBI2Ahqo05ARZEZpUUZv52F1ubIDM4MTUhcim-wH56gmwaclwOQ2aQVUZIVYVZIEVZs45ZZ+anAuAsuiSfATeLyTFIkoFV5GE4lvisgq+O0oGMI-k0CCWp0SkuVwVnAhVxVqAh5x5mAp555rycyV55gckiWfIMCaOj5Hsqgkgtg6YUEaQiwUxX5HmeVMABVYa4VRZEg-5DFQFDVtY4FrxkFfg0FsF2A8FiFbRdOcyQlbKGFwg2FUGsIi5siYoi86kYo1EWQ5gF8eQU+A1+VQ1x1RVp151gF9VIFtYZpWJHF91XFPFQ8L1Al71SKn1sA31sZiASkLEhwuS42uQHIHVSI5ou2wOSkhSruqlIRfQeGqAQwo07AA6hIuAzxAp0eOJnx7NkeCFwwcMvNEmJNHyYqk+4i0I9cdQwy65s6TJ0ChYKlVleZdKv4oQaxo5UVxusVMtDQykCVjE0oucZW3hhQH+sgx0qEJ42aetJGsxv5oRf+FVUA2o3xUuzwZIMcZIBAiNZi00+trRTVJgsgqQK+WwOBGurod46gGaXspC8iLtIQbttRtFnt3uLy-GYmeAEZOA5AEY++gQlAMcTVZwLqpCyIc8xgjqA4R4NMT+klCwn5rNH6rtBtHtodkA-gvdrRAtEF0enFj1z1-Fb1sYH1ioL2Dlb2CANorI+e-IykTQ+wHZu0m5FNAylQmQdgVgmdEd7tudJAFZLyEA6ook-g4d2dYFFBY9QSA+D119JAokgg99BtTVVQqMaQykrkmY+RjgTohYpCYoTm6aJ9D9HtF9dy+ADyN9AQ39I9aN7FveL9Q8b9yDX9WdP9ptwIWuvi0I2gDQ3BCgAIWV+BdQ2S2aRAio4Yw9Z94ZkZMAJti9VMdg0JNNA5zkZgq5y6z6f1smklSkIM9DjDyozDOdxZYRLyAdQdId9FgFVdSod9+DkdMtZgSddgjQ2w7anIjqLho2CwU+V8-l5RIRDD9YQ9mjLDB58jiDhdUAxdlsFZTwUjGjp9tRLjeATVRQToZDf2XENg29EGPWUoL4sEto4KkjtjMjo5Z1Kj5kUuNj6jiTo9t149mNk9vFuNM9MYc9z21gcV0WqEawh94gtgV4t5NEX22pJSZR1SH66TTD9jsjB58DSDH9AQaj4YqDsxWT1hEcggODvTXxUjeDPjcuBCpJ9CqOs48mLobczErI3DhSYIWS8TGTHTST3T79t9-TyogzqNMRmJGDfeoz4zn9xz0zD9cVXyj+ogpCFw2wBeLohYbINgbd-iDQXd2taliq3F38gQ1iQYfKfI3sDijE4IAjHVqwFQvsK9eh2kljLTHm+aW+iDAWEug9xIMuj9lh2TEgJAGqC2P6AAcndBAAAGqEsZ4QS5Q2guFey8jb1FbtT5CJaezOQBJ7XQpYsAE4uc14tS4EuYCy6sUXPxGYNkvsAUsjrUuS70uSuzP8J37VoxZyoZziBaAAwuhuknSnA47kX8vd3V5e2ok6Z3aoAPbfFomwDDNvFi0Os-p4P3ZtFusjr1lzMyk-aOjEq855AniArqQ3iTjqAqZKT5DGDTHeu8ZD7+6GbOvx6uv4lJsGb6AZ6MQf6FAZwGPgiHEvlmhqHcM2CZw2DxtPa6bopZupvR7ps-G4AX4AGhqGbj6SCAxMZ-aQ02YexAha7uHmYQxNDVvNt156qCbXHGb803XWFNvC6D6F1+5Zu2E4AmYy0phmicgWAnbbC2iCNdKSDOx7aFA4V8jjvC61v6ZCYiYbtztP0kuLvutwFCbrtibS2cOasCpezoQg4r1HtauhufMgjCiDlWMe5WsJvaqZZMBFkVoNsSAvsjoIW+YwVmwME5vF7Xz+lbpHvbWjK2jA6yxrRXs6ZwcIfjpIcocHpofxLDz2Hj5LBKS2hpziguKCOqZyxnhOLrBgxa0BWWu14wc-wtZtZhr-E0fmyidw6tbwH-EZ74o8g2oPjpi+xnjZxNDfNRt9JjLg6AshFVGifmK3SrYTXzsusyf4nLYGZrbfvIF0QO7KDHCFCZWHZHAAiXCqBAhXAZr0PRXsMGzoIh7hx2Wm2PheQuG2BVB2bEWFEZiLBP7igV6QeYuBfLLBcAShdOv2WAlL0KTUQTaayxf7ISqUMs4LAb1PipcYuCsZf+BZdhp6K5fWAOfSSFdRduz6NxfqSnQryJfVcpcBfG1Nc5d2UyDtfVSdfFcxc3xLpvnpCVdJeMTDcCt0olSjchctd2UqBTdxmRezc9dlcexHBLDLdDcyjreKqbcxVjc7dUBiD7cbKHcPjdelcLd1AJcOArc1cAtCf1dbfZcPfCDPfL2vfRfHeff7QXfJc3wjd3fbdhdUByBg8KTOX85ThSiSXFvOilsvj9j2yyB1bXfeq3dBdI+5dSBo-36HKKQ2448A7dIgzVdrzNMzaYvYBFWdMTVsOjnYVkWZKbDL50JUJji5BngVDqdTK2iQ30Nc8gse1OM+1+P83uP+0K++PPKuNfv5dUw5C+n4HqcFGTIctowf57ZpB49HDy-c9JPK9D0X3YADDKMAVmLkCa-qvAbSR0L2SuiK2EwlaSLdIchHR6TeW2+K+50D1pOe9IcT3cVPX5PT0oUE3z0qBxVThS-IZWB6R5Hi+xuwhxbmCZlfL-dpeCue9wOX2IOHN9Nx+Wd3XYMwV19fGe+zXQgEoPg0wuwLBwLAqNq5CezbUQd1cbdV-n018+119PBx-oOytXOv0t+4Me928-WZR8gZqAw7VaHi8LzSDgiGNaQgjl9j83cNdNdBJRwcDe3TWxjmLYB7zx-X840oVMCP9tF6KCAxyQCpJbv9hsQeQlQdjgUEOJ2o8Y54dGBtVq4c9AeiPA8rABf639CmD-J-vP2WKYNEBOAV-oJXf57xU8wkb-kRAwC2IZaHkVQntHMzSgLABeDjqtCS4KAzg-yFmoZ1aYX9iynFO-mYh7y-l4+uTRPlPSQqFNimGFd5PYBBDmgGS9gJmlj23ost5IawOoFjjnjotYBG3dgQgMxpcD-APA2itK3NIY12AD1AQcnyEGp80KhNMQZJRBTgxGBNgKoCtVJqnRYQj4ItiOF2yR8c6MYaaMshYB1leBfPDhnryTBm1aYiwFED8zhaODl60lB3C7BfiXxBOFfcfnb38zeCiINZfwbnQd4gUyQGqTIQSHLJS5ch+QvwQSCvLghVCnoOtBtFqDphBQmsSQF2RQgE55Angk3OkN8G1kUU2Qr2rThCDcApcZQp4ur19qDCChvrDVt2FY7pBLgxgdMCUjGQNCX4f1BLHZnIrs8SclfVIQBh8ETDq+CDafsg1n47DOhEwvgc33FIr9PepsToYIGGFNVUg58P9k+CgRLpZ4bIZUvUHnAwCthKQqPmcOGFK8+hOLVRGSCGHdCniodE4QCL2EPDtGIOc9MYH6L4xaIDQ-5KMiyTcgPsVFUnhICIAT9ARkI-uik0Hqr9YRGQ4YRcOMHY0+KZgwSmn2exiBM+wMfDn8j0hZwxwrVcDOnSTh5A3u6+eGnoMCG0VsKK9A6O3FdC59cggoREHJDOBvkSsjgMJoKJGqOMQRPtKspHEhFFCua1ZeEWDyUgbAnQYTazPIACIND2QhyQlKdFqBq5VRwI-Oogx4HkjaixzEutvnLqwcq6XvTookHWHSBCwdGOwLIGZhjg-2lWCykVmQSqC-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-k6Yd5hyw4hS9CwNKh8HSsqW9x+4g8RjqPHj7-xugHAe4X3GSRw5uVYg87vbDLZmAWcxbXyG2isCFBQltQG3gkr7k+1lVeqzDuqt5VXNNV2q+qnqrJWuzbwMEqmezDBD-zCgzgqZA7VixVc-JVjEZf4EWT3RRYWdaYDR2FhgBfAYsOIM0r9FCBCi9aD0IDTlWY5VY06fmadkTK7VWaMauNSLCCDpqk1bq5DimrTWJruAmai6YIBzW1A81pqzYIWoelPM9Wpa7yOWuGWJKfa8SPeLdEPiHTd4+8U1K2tJKgMWyig4norUYh3ws5SscwAA01jYq+IMa8dbOqnX1qD1k6ygPOscpyQl1O2MGi2UOKH8YQ9QWwKkBK52BzoMMfjCcrYnGxYY7AYKLqtDA69zpC6-MJrUSzyBYmJDfIryEgh+I4QZCKUG+r4A-qCV9a79R+r-X9wANoZc3I6DMCgwW6smL7PkXsC6FNAOkdeD-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-dKi-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 */
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

          entry: [
            'show default planes',
            'reset camera position',
            'set selection filter to curves only',
          ],
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

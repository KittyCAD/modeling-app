import {
  Expr,
  PathToNode,
  VariableDeclaration,
  VariableDeclarator,
  parse,
  recast,
  resultIsOk,
} from 'lang/wasm'
import {
  Axis,
  DefaultPlaneSelection,
  Selections,
  Selection,
  updateSelections,
} from 'lib/selections'
import { assign, fromPromise, fromCallback, setup } from 'xstate'
import { SidebarType } from 'components/ModelingSidebar/ModelingPanes'
import { isNodeSafeToReplacePath } from 'lang/queryAst'
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
import { angleLengthInfo } from 'components/Toolbar/setAngleLength'
import {
  applyConstraintEqualLength,
  setEqualLengthInfo,
} from 'components/Toolbar/EqualLength'
import { revolveSketch } from 'lang/modifyAst/addRevolve'
import {
  addHelix,
  addOffsetPlane,
  addShell,
  addSweep,
  createIdentifier,
  createLiteral,
  extrudeSketch,
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
import { uuidv4 } from 'lib/utils'
import { Coords2d } from 'lang/std/sketch'
import { deleteSegment } from 'clientSideScene/ClientSideSceneComp'
import toast from 'react-hot-toast'
import { ToolbarModeName } from 'lib/toolbar'
import { quaternionFromUpNForward } from 'clientSideScene/helpers'
import { Mesh, Vector3 } from 'three'
import { MachineManager } from 'components/MachineManagerProvider'
import { KclCommandValue } from 'lib/commandTypes'
import { ModelingMachineContext } from 'components/ModelingMachineProvider'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from 'lang/modifyAst/deleteSelection'
import {
  getPathsFromPlaneArtifact,
  getSweepFromSuspectedSweepSurface,
} from 'lang/std/artifactGraph'
import { createProfileStartHandle } from 'clientSideScene/segments'
import { DRAFT_POINT } from 'clientSideScene/sceneInfra'
import { setAppearance } from 'lang/modifyAst/setAppearance'

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
  | 'circleThreePointNeo'
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
  | { type: 'Export'; data: ModelingCommandSchema['Export'] }
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
      type: 'Add rectangle origin'
      data: [x: number, y: number]
    }
  | {
      type: 'Add center rectangle origin'
      data: [x: number, y: number]
    }
  | {
      type: 'Add circle origin'
      data: [x: number, y: number]
    }
  | {
      type: 'Add first point'
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
        | 'xstate.done.actor.split-sketch-pipe-if-needed'
        | 'xstate.done.actor.actor-circle-three-point'
      output: SketchDetailsUpdate
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
      currentTool === 'circleThreePointNeo',
    'next is line': ({ context }) => context.currentTool === 'line',
    'next is none': ({ context }) => context.currentTool === 'none',
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
        'data' in event && event.data && 'tool' in event.data
          ? event.data.tool
          : 'none',
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
    'AST revolve': ({ context: { store }, event }) => {
      if (event.type !== 'Revolve') return
      ;(async () => {
        if (!event.data) return
        const { selection, angle, axis, edge, axisOrEdge } = event.data
        let ast = kclManager.ast
        if (
          'variableName' in angle &&
          angle.variableName &&
          angle.insertIndex !== undefined
        ) {
          const newBody = [...ast.body]
          newBody.splice(angle.insertIndex, 0, angle.variableDeclarationAst)
          ast.body = newBody
        }

        // This is the selection of the sketch that will be revolved
        const pathToNode = getNodePathFromSourceRange(
          ast,
          selection.graphSelections[0]?.codeRef.range
        )

        const revolveSketchRes = revolveSketch(
          ast,
          pathToNode,
          'variableName' in angle
            ? angle.variableIdentifierAst
            : angle.valueAst,
          axisOrEdge,
          axis,
          edge,
          engineCommandManager.artifactGraph,
          selection.graphSelections[0]?.artifact
        )
        if (trap(revolveSketchRes)) return
        const { modifiedAst, pathToRevolveArg } = revolveSketchRes

        const updatedAst = await kclManager.updateAst(modifiedAst, true, {
          focusPath: [pathToRevolveArg],
          zoomToFit: true,
          zoomOnRangeAndType: {
            range: selection.graphSelections[0]?.codeRef.range,
            type: 'path',
          },
        })

        await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)

        if (updatedAst?.selections) {
          editorManager.selectRange(updatedAst?.selections)
        }
      })().catch(reportRejection)
    },
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
      if (sceneEntitiesManager.intersectionPlane) {
        sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
          quaternion
        )
        sceneEntitiesManager.intersectionPlane.position.copy(
          new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
        )
      }
      sceneInfra.setCallbacks({
        onClick: (args) => {
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

    'listen for center rectangle origin': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
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
        onClick: (args) => {
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
      if (sceneEntitiesManager.intersectionPlane) {
        sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
          quaternion
        )
        sceneEntitiesManager.intersectionPlane.position.copy(
          new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
        )
      }
      sceneInfra.setCallbacks({
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD || !sketchDetails?.sketchEntryNodePath)
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
    'listen for circle first point': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
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
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD || !sketchDetails?.sketchEntryNodePath)
            return
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
      if (sceneEntitiesManager.intersectionPlane) {
        sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
          quaternion
        )
        sceneEntitiesManager.intersectionPlane.position.copy(
          new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
        )
      }

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
          if (!intersectionPoint?.twoD || !sketchDetails?.sketchEntryNodePath)
            return
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
        event.type !== 'xstate.done.actor.set-up-draft-circle-three-point' &&
        event.type !== 'xstate.done.actor.set-up-draft-rectangle' &&
        event.type !== 'xstate.done.actor.set-up-draft-center-rectangle' &&
        event.type !== 'xstate.done.actor.split-sketch-pipe-if-needed'
      )
        return {}
      if (!context.sketchDetails) return {}
      if (event.output.expressionIndexToDelete >= 0) {
        const _ast = structuredClone(kclManager.ast)
        _ast.body.splice(event.output.expressionIndexToDelete, 1)
      }
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
    're-eval nodePaths': assign(({ context: { sketchDetails } }) => {
      if (!sketchDetails) return {}
      const planeArtifact = [
        ...engineCommandManager.artifactGraph.values(),
      ].find(
        (artifact) =>
          artifact.type === 'plane' &&
          JSON.stringify(artifact.codeRef.pathToNode) ===
            JSON.stringify(sketchDetails.planeNodePath)
      )
      if (planeArtifact?.type !== 'plane') return {}
      const newPaths = getPathsFromPlaneArtifact(
        planeArtifact,
        engineCommandManager.artifactGraph,
        kclManager.ast
      )
      return {
        sketchDetails: {
          ...sketchDetails,
          sketchNodePaths: newPaths,
          sketchEntryNodePath: newPaths[0],
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
    'remove draft point': () => {
      const draftPoint = sceneInfra.scene.getObjectByName(DRAFT_POINT)
      if (draftPoint) {
        sceneInfra.scene.remove(draftPoint)
      }
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
    Make: () => {},
    'enable copilot': () => {},
    'disable copilot': () => {},
    'Set selection': () => {},
    'Set mouse state': () => {},
    'Set Segment Overlays': () => {},
    'Center camera on selection': () => {},
    'Engine export': () => {},
    'Submit to Text-to-CAD API': () => {},
    'Set sketchDetails': () => {},
    'sketch exit execute': () => {},
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
        artifactGraph: engineCommandManager.artifactGraph,
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

      const updatedAst = await kclManager.updateAst(modifiedAst, true, {
        focusPath: [pathToExtrudeArg],
        zoomToFit: true,
        zoomOnRangeAndType: {
          range: selection.graphSelections[0]?.codeRef.range,
          type: 'path',
        },
      })

      await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)

      if (updatedAst?.selections) {
        editorManager.selectRange(updatedAst?.selections)
      }
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

        const updateAstResult = await kclManager.updateAst(
          offsetPlaneResult.modifiedAst,
          true,
          {
            focusPath: [offsetPlaneResult.pathToNode],
          }
        )

        await codeManager.updateEditorWithAstAndWriteToFile(
          updateAstResult.newAst
        )

        if (updateAstResult?.selections) {
          editorManager.selectRange(updateAstResult?.selections)
        }
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
        const ast = kclManager.ast
        const {
          revolutions,
          angleStart,
          counterClockWise,
          radius,
          axis,
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

        for (const variable of [revolutions, angleStart, radius, length]) {
          // Insert the variable if it exists
          if (
            'variableName' in variable &&
            variable.variableName &&
            variable.insertIndex !== undefined
          ) {
            const newBody = [...ast.body]
            newBody.splice(
              variable.insertIndex,
              0,
              variable.variableDeclarationAst
            )
            ast.body = newBody
          }
        }

        const valueOrVariable = (variable: KclCommandValue) =>
          'variableName' in variable
            ? variable.variableIdentifierAst
            : variable.valueAst

        const result = addHelix({
          node: ast,
          revolutions: valueOrVariable(revolutions),
          angleStart: valueOrVariable(angleStart),
          counterClockWise,
          radius: valueOrVariable(radius),
          axis,
          length: valueOrVariable(length),
          insertIndex: opInsertIndex,
          variableName: opVariableName,
        })

        const updateAstResult = await kclManager.updateAst(
          result.modifiedAst,
          true,
          {
            focusPath: [result.pathToNode],
          }
        )

        await codeManager.updateEditorWithAstAndWriteToFile(
          updateAstResult.newAst
        )

        if (updateAstResult?.selections) {
          editorManager.selectRange(updateAstResult?.selections)
        }
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
        const { target, trajectory } = input

        // Find the profile declaration
        const targetNodePath = getNodePathFromSourceRange(
          ast,
          target.graphSelections[0].codeRef.range
        )
        const targetNode = getNodeFromPath<VariableDeclarator>(
          ast,
          targetNodePath,
          'VariableDeclarator'
        )
        if (err(targetNode)) {
          return new Error("Couldn't parse profile selection")
        }
        const targetDeclarator = targetNode.node

        // Find the path declaration
        const trajectoryNodePath = getNodePathFromSourceRange(
          ast,
          trajectory.graphSelections[0].codeRef.range
        )
        const trajectoryNode = getNodeFromPath<VariableDeclarator>(
          ast,
          trajectoryNodePath,
          'VariableDeclarator'
        )
        if (err(trajectoryNode)) {
          return new Error("Couldn't parse path selection")
        }
        const trajectoryDeclarator = trajectoryNode.node

        // Perform the sweep
        const sweepRes = addSweep(ast, targetDeclarator, trajectoryDeclarator)
        const updateAstResult = await kclManager.updateAst(
          sweepRes.modifiedAst,
          true,
          {
            focusPath: [sweepRes.pathToNode],
          }
        )

        await codeManager.updateEditorWithAstAndWriteToFile(
          updateAstResult.newAst
        )

        if (updateAstResult?.selections) {
          editorManager.selectRange(updateAstResult?.selections)
        }
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
        const updateAstResult = await kclManager.updateAst(
          loftSketchesRes.modifiedAst,
          true,
          {
            focusPath: [loftSketchesRes.pathToNode],
          }
        )

        await codeManager.updateEditorWithAstAndWriteToFile(
          updateAstResult.newAst
        )

        if (updateAstResult?.selections) {
          editorManager.selectRange(updateAstResult?.selections)
        }
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
        console.log('input', JSON.stringify(input))
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
          const sweepLookupResult = getSweepFromSuspectedSweepSurface(
            graphSelection.artifact.id,
            engineCommandManager.artifactGraph
          )
          if (err(sweepLookupResult)) {
            const error = Error(
              "Couldn't find sweep from getSweepFromSuspectedSweepSurface"
            )
            console.error(error)
            return error
          }
          const extrudeLookupResult = getPathToExtrudeForSegmentSelection(
            clonedAstForGetExtrude,
            graphSelection,
            engineCommandManager.artifactGraph
          )
          console.log(
            'extrudeLookupResult',
            JSON.stringify(extrudeLookupResult)
          )
          if (err(extrudeLookupResult)) {
            const error = Error(
              "Couldn't find extrude paths from getPathToExtrudeForSegmentSelection"
            )
            console.error(error)
            return error
          }

          // TODO: this assumes the segment is piped directly from the sketch, with no intermediate `VariableDeclarator` between.
          // We must find a technique for these situations that is robust to intermediate declarations
          const extrudeNode = getNodeFromPath<VariableDeclarator>(
            ast,
            extrudeLookupResult.pathToExtrudeNode,
            'VariableDeclarator'
          )
          const segmentNode = getNodeFromPath<VariableDeclarator>(
            ast,
            extrudeLookupResult.pathToSegmentNode,
            'VariableDeclarator'
          )
          console.log('extrudeNode', JSON.stringify(extrudeNode))
          console.log('segmentNode', JSON.stringify(segmentNode))
          if (err(extrudeNode) || err(segmentNode)) {
            const error = new Error("Couldn't find extrude or segment")
            console.error(error)
            return error
          }
          if (
            extrudeNode.node.init.type === 'CallExpression' ||
            extrudeNode.node.init.type === 'CallExpressionKw'
          ) {
            pathToExtrudeNode = extrudeLookupResult.pathToExtrudeNode
          } else if (segmentNode.node.init.type === 'PipeExpression') {
            pathToExtrudeNode = extrudeLookupResult.pathToSegmentNode
          } else {
            const error = Error(
              "Couldn't find extrude node that was either a call expression or a pipe"
            )
            console.error(error)
            return error
          }

          const selectedArtifact = graphSelection.artifact
          if (!selectedArtifact) {
            const error = new Error('Bad artifact')
            console.error(error)
            return error
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
            if (err(tagResult)) return tagResult
            const { tag } = tagResult
            expr = createIdentifier(tag)
          } else {
            const error = new Error('Artifact is neither a cap nor a wall')
            console.error(error)
            return error
          }
          faces.push(expr)
        }

        if (!pathToExtrudeNode) {
          const error = new Error('No extrude found')
          console.error(error)
          return error
        }

        const extrudeNode = getNodeFromPath<VariableDeclarator>(
          ast,
          pathToExtrudeNode,
          'VariableDeclarator'
        )
        if (err(extrudeNode)) {
          console.error(extrudeNode)
          return extrudeNode
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
        if (err(addResult)) {
          console.error(addResult)
          return addResult
        }

        // Insert the distance variable if the user has provided a variable name
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

        const updateAstResult = await kclManager.updateAst(
          addResult.modifiedAst,
          true,
          {
            focusPath: [addResult.pathToNode],
          }
        )

        await codeManager.updateEditorWithAstAndWriteToFile(
          updateAstResult.newAst
        )

        if (updateAstResult?.selections) {
          editorManager.selectRange(updateAstResult?.selections)
        }
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
        const { selection, radius } = input
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
        const { selection, length } = input
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

        const updateAstResult = await kclManager.updateAst(
          result.modifiedAst,
          true,
          {
            focusPath: [result.pathToNode],
          }
        )

        await codeManager.updateEditorWithAstAndWriteToFile(
          updateAstResult.newAst
        )

        if (updateAstResult?.selections) {
          editorManager.selectRange(updateAstResult?.selections)
        }
      }
    ),
  },
  // end actors
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEE1OWEJazVbYRVrRWsxZV0DRC0JGhpZCrkFNRo1ZRc3dCw8Ql8AgFtUAFcgwPYSdjAI3hiOLnjQRMEpKRp02alzOUV5cTU9QwQZMXmxWvMxaxkNGXlGkHcWr3b-cm4hvnYRqLG43mmpKwkVI9m1I4qYSZTZGWwSeyKRTqOTlOTWCwXK6eNp+fy+KAdMC4AIAeQAbmAAE6YEj6WAvZiscbcD5CTJpE5yE71WRiMTA0EIdSSZTsqRHDliWaKJHNFHEbFDIl3EhYokkfzcQLBUITSnRanvKJbQQc6zSKz1GjCOS7FSzPSJGRfRQSRRaOqwxQ0M1qMUeVoSbAQTBgAgAURxxMCAGs-OQABYat4TOlJfJ29QyYQuh22TJiLnwtQSBQKKTVL4qPJiD3XKDe33+oPSsMR6OKSJU2JxhJCazghTWYRSXIpWbCI5c4x29kFRy-OTaerllFVv2Bp5E7oYGNattTIT7KQSYQIjR5IEpDbFBDWVIGmQO1KmsQpuden2LgBKYHxqEwhPXrdp7aSHK5ioJa7Bodg7JyZ58pI8jwkC96dkoziuJc4pPtWPgAO5gGATA-jSkz8NuagqNIKTiIo+zZL2chcvk+Q-OYJF5PYczWI++ALv6AAyqAAGbPPQowbn+W4AUsebwjQNgqKkLoCnRuQGlCXzsvUahnEsHGVs+-reJGWCYPh2piXqsz2uUjhWDYjgOHRULzKoGQKJOORAtpXEEAAYtgmB+oJzaar+hHTMKcjSDIvwposk50eYpFWBYsJLDQGSIihyLoYuRCRnKfHEsZm5EUkoh2qIDhmHMDq9iodFWKRmgWgCuwmhyHm6UuLBEgFwnBfGerwuk1haPuFT5BY1hcpR7JlKkXxWAU+SpO1GHICQ4aFaJxUDTIEK9nkwJLPuGlTcBu1mIm1QaWcyFNJ6nEdQAIsEQwqn6arhEJrwiSF24rHmxz2KIWhmsBU0CpIzk9mcFqzAoK2LgAKmATyCOwqCCEQACCj2bb9AGqHmWhKCcZ05FNkXzFombChywElgj-q4nxfFBAETCkrgwxfS2BH9ampEChVQ55C64hTRoBozlC9jTtUzKMwQAASLR8Hj-XCrudiFqlvy7PeWZnsNpTSbUxjXiDKiKwACkSqAdEw7BoxjkAcOr-4iOCJEnBew1mj2ih0fYkgafRvyKCROQyIzEiRj6YDW5zcAEFj3XYHxJChP4UAKkwkb+CwTDdKSQwQO7pmiJI2RzKosIWr7U0mqR0UuVFqa2DHsCRqgmGJ2Qyep5wGdZznJB5-4YAO5wkDl9tO55mITnVAdsKTVBuS7qIPKZD21QPhlaGcd44bsFGxBkJQmDHw2s+JC6kUQj2GQ7OUkVTVC4X3sC0JnJVskedfU+kYCDPX8mAFUmIpS30QNCSQTdCwXlqJ2aSXJBDHEhgKWoJxTTwj9gAk+Z97gYAnhADg-gIDdCJK0esQDoEIChBpPMDhtAWjqKBNeWw5i5iODaGo2h9wZHwQ2CQgCowAElVrrXAUESBOJ-CEjTuQEgRkeZBT5v+GWQEHDAmvKbZktEoKRVzCsJQw0OTZFFAfe6lZRGRhEQQyMEjFxrXDBArEcju5UIAF4PGUXQqEnZpAXl+OIGwKxarr1khINQVg5hAmon2IRQD7ENicf6Ig3BYDsAVHgfwnjsA+JxMo8h2AskX25oFWMW074ugNAHaa+QLRDmEEHGwPxmSiCMcEpJUYUlALScQTJ2SSC5IUZwJRmASllIoBU3q6ixJQmUPaFYwJYSpmkoHI2B5ok5D9koCoDIel2NsQMjJuAsk5NwP4LGAAhbw-gAAa-jVi7WaSmaSi0Th0S0HaeQsNg4xPKGWKxFY+m9JORhM5FyRlXNufcgAms8s4Px1mug0hyFBZ57AMR-kOIEUcVhHLBY4yFQzLn+DIFAP0zz6h7lSqaFkpjF5xTsHuW8NcDgXiJRC7KZKYX+D9Pgdg0ZVFVPxipSQwpgJmHZJ2VMRQtj5BmjeI4TojpWxBfOWxxLTl8tyUwYkBrcCkPIMXEgMpSHTMoP410aQTGUW7A6V0ETFVmjtKsOYcJhTOrkNyhxurznDNyfkwpAw-L6ApTgKAuBnlQlmsyWWQ4dgyFOkcPMqwAS2oYX61JpLA3krGdgCZmAI3KOwNG55F49wFDghpeqHCYH6jKGihwKyBY5v6Xm6FuTYC4DHv4dGjznmph+H2PFJwlACgVTAgce47CpBiaTDQt1ULWOJTqrtQarm9v7YOxFoqfrxihCOjIBQrAOvEHUOiFRdoxN7MNAELp6garuqC7VPL0l6quWAAAjt0YpgqoDCueSWPMN1Ez0XKC6mBxg0hLBSvYWoEcV2ZSPg4jdvL838qYOa5RfoVGVMPRovk6RfhAhTOofs4MJKpSUA6TIyhKJSA7eIzd5KiST1QISO4X72AUgPX1DRdQ4PXkhHXF0hstjKFND8F+xx4krGvCxklr4wCCBRiEboQx-H3lIvi-s+RZhmK5Oi+0CCFqURhr6zVXp33+owkQ8BrsAgUKofgGhUYaW7WdCwrh7CuQ63tJ2aE8tUz0eUwG7tVzMIcHzn2rEEB5HKO6LM76gmFlHkYhUJjEcmRcmvKkaQJZOzhwFNZ19Wr0MfoIFGSl4D0afjoT2X4KKNJNI0qoaDCBpykQUDwoGF4KJEqxphEZAQQ2+MmZagYMz-B4D4qgAgEBuBgG9LgD84YJAwCdhNopmBBDzdQE1yiBpjCCgKPsTIXX0FpEGwyBExsX2rrfehkbY28moG8ZNqZM3KBzdwAtggxI7ZEgkBzQYC2iQdC234QQu2w0HYB0dgT8ziq5HvBCM4+RTRDmOEOIODofhhWkjaWJzGbNoeEW9shhaJk-fKf9wHy2uZrY26t7bghafKMRwt47JgIJDkXoWDNknECdgROka67IrLTg0sN0bNPiTjOKdNhnh2gdEhB2DkukPocc65-tw7fO7S6y3vsIXBjFWFFMLIWEF0I7TXl+9uFjzGeLeZ6tvAbOYdOxIAAI1gIIPgPPkeEfS2jyc0S5hLFSMyI4xhvnaFMLTCO8TGlPdQzY17CuAgu4eW7jXWvwfsF1z7wQ-vA-B6NyjkyEehzVt9khiwJEWlGwFAaaod5Uw2nkChw+Weqc5+uXc-w8KC8e9Z6gTbHOK+CH0CHvnpFF5AgcEYmyKasWv2icoUJqZjBKCd2Ql3Y-1fA8+9riHn29ew9n-P6vYfUeJFyPXrI9dez7lmBvrYuj5gWk738dQDQQ-AISlP0cfFbSfafG-fAP0BfGvIqJ-RwSVCObQE0acYmOKRhSKL4CwejHkYAilGA8BU-TXc-YvUvGfIguAh-WvRA4waJTsFIHYcwWQBSI2KKUwa8BlYaECDPfvddLGJgDmCNQDYVHjLDPAdgJbCAr3KfVbLGbwRGQQe4CQ3AQQUQkVGghAsXRwV5T5AEZiHkOqXIUdaEBEE4e8H2YbIQktAVbEIDfOFQqLKQs-UHcgq-CQBQpQpwrddQ+w4DeA6pHQ7ICECOcwzWEsU8RVReXMCodYcaEiaSAgg1IkI1E1M1C1UpX7YgpHaQlnWQqAp2FItIotDIwQVXGZaguZWgnQuNZQFYWECaY6L-MXOSImAEYEayE7YFCrWzbPd7Yo7EdI0kTIq1HIwHVwi-EvDwjnQY41UokY8orI8pKotLR-Wo91ZeRonIZouiRTdowCLowUIlbiPAerVAT8GrXKfAc4xrQI-GH2MqKoYaSKDpS3GBZkXcM9MwWSReG6aOCnAfZJU4rmAdC4zACQMRXADgFOCARLMpbqAuVASQuhWGSGJ+WweTWEFo+hVYBKU0TsFMQXTBE4s4sEz8SE6EqQ0gGZAjao7Q88OmCEZYX4Y4RgiwRuKJK7aEEsbISmAE3oynYEskhrCE3AK-ZRYgTAVgaRBxVE6PIaMWX4EiXYNgqTa8JMTre9Nhc0Uk0E0UiQHyaEruAuO2PiXyf0CfAo1bNmboJgZQnAKUQQNgDAZ0hxZ0sAWRPjOQVE2WaQAsedKyXIKaDIO0QsFyE0RjAEcnQUoE3pEE24iEo00pfOJgM0i0wvMgnXDw20+08gR0nEZ0+ON0hsD0r02AH0+4+MYCBQe0XsH4jogJEM9QaQFqKcWSBEJIwE9dKEmEuhLBOdAUScIceWLrD+O0eEWmJyW1CoIlXsqQqgJsekoIhAOte0Y9M0V0X+JQEMqtb+E0YLTsHo57SrYRRGOrHEbAYpc1cgMEq4urckuktYmo7keSSXWQGcW8AERuCXHsJQMwGJAoGJSxWM9dc8m4y868okW89GSkmEs5TgXAFLCePgLI6hNM-iC01E7+d8+o1KaSOwKaUQU7AoVKViAUGwGMk8vos8i8zgKCmC1ACQcUqHSUogaUvoWAOUqs-8WSPIZtDrGWZvKIj4r4IaZfa8a6MIolcCmASCyZG8sEw0vAFM00zCxcK09bOQiQXMh07AJ0l0tTLi0smRdxPjYQVEhEO0ZBMwVIZUxwIipPFMFMZDYUVYNqbs7VWSqUK8hS6CpS5Mk0jC80xcSY9wqHHSvwO0vSgy4s4yoBMssy2ACynisSUrInKwGoRwQkqaO3PaauFYAoXk48zPddboY1VAfoc1dgWxXEXAPIz3LSzbLwwQcq5bZ0gYbqWqmNVK4qdMXaRwFvYCPIQqzZKTBwXcFISiUWedBBIlN8UIUAxM+8m4x8uhFMWEe0KVJuMwaacGaoIna8cwHRbE+akIGbKlRMzwnPahIIFQxLe4IkLmIkbyFSk0jjRaog1E7QKWEiWQM7Y2MaxAUTcKT-HfEaOVPvNdbVBai6sAg06nRCqAJUKhKAPAWExLD6uG8BT7ctPAb6vsaQI8QcTEqEb5HICELc5QWSdSKi0qmG86pax85S40gyRLWGpahqyAm0qKvMgsp2QykshK0yqUfjLQlcnIJQMoQsIxIXZyfLE0WIi0VPfYe+GJM6z6y65mkgOE6hCABUASfwLGzmzS73NmVq+0-WkgASQQY2r63qxIdQFssi4OJYXIaEBWoER+RwDNSI+dDW7G7W3W9zK2w2u2y6zMtw7MiK826K0Op2cO6lB2xAOwBwPaJYeSMweQBtc8WocKAkjQUJLBLs0C7VIgKUEMDmogx8lamANa5O88YXdIV0ZQeQOYIXVvKTZiMzeEdy6EKdIlcu4MGUKurWhGm69zR656161mu4CumURO1LXmF83YewUwbQHktAgoRSWQIrJ2vILhIFQe+e-wUe+G8E66sbahXGtG+qrGOEue4eo2xm6um+-Ghu3YaEQ0dBFKZDa7A5Lat0OwdkOy4+p+s+q6wKtm-wIeusCBrm60yK9gaK-M-SwswW+KqMRK0W6wSy-6Z9BQYEGJPWVpO1KDfsHINSPg6G9DWByul+sei+nWxLeOx+usRehBpqnmp2OOg2p2SgYe22hhpO8W-GT+vTbE1iU0DreycyV0DIUcZ0aoMBuB4Rq65h8hPhthkMDhsK6O6HWOy2vh5Q+eoRzWkR5c-GHILAy7ayYUSueyJZcxZW+wKDZaTy9DfMsAMgQIEuf0fxJ+IJYCU2EsFkES+hZvH4Um4aaTB0Qe7gQtdzQdeLSAJLTAFLTh73EgLJKFLdAAOTlEgAADVksl61EXylJdobBrpMgHByhp1thpo9wQtSxOw3VytqKhTekzlEnkbknCnEt8RSnI6pjS9sn2BcnLkCmEsSn0mymxV4xchkUnUSIW9ccgbthjhdxwlxAjhMhVAGgPHB93sfD2NONuNTmYU+NMntL2rLm8AhGuhCRlDeNjtAl24Lx4Q-kr0oI2iHRmDDxzFZwjnklEbxCosPsvs9sS0bnNs7mv04dcbQ08N9BjsWz-y4k+wboOT14bQgsN5TQ6hkMBTOm4y7EwX7mrkDcYXTbbmMZKXOclci0UXjtF5TAHI-qLZOwKYdgis6gd5F5Uh7wCDKXIWClJtbCy1o1YXVt4XVDEWoWw0S1y8o0erRHFnoRHJIp5BakXKFBToWsUxglxA+w7AAQRWv15EmXi1S1VWZWJA5WotGXFEUWVXy01XLGNX3nmRygSIEQwp3j6EzBHIlAgQ+w6MmMLXVDAg+0mAwTHl7XHXfCd17T0Yg80XdwBQ9YtAbBgQc6I5-pg3KoC7KKo2IWU3434VE36WEWU3nY59WWEo87sr5MKhr19w8xzALCLt9gzgy2t0J4-0AN-DgFaW4Wa35Xf1-19sNC0X5gf4qJ6gFAZIiK00OQZbKIaboR+3yUcMFQ-IsBq2Xn5W928NqAG70dwpSx9w5ZF58h9qEp2R1ALB1BYFqGXthEcoHzEZwS5tWYCB1rCxcx5pIixp8UQzdhGJScNkz06b+Cy7ri66f3Pw-3YAAOlznyGTeFgPjBQPTXsgKYKgoOcDrxYPB7EPwFkPJl040OqBrB1X-xsPDQLFah8OxyiTiPOlprexyPv3f2aOAOZAGOxImOQOI4wOCOoI3JOOYPHA4OaHP2KP-AqPUOAOVBhPipRPcPxO2PTpCazoSPuP5OP3kkv3VqVOBOqAxANPrQgPmO8PX8ppg2ZPSO5P33TzTOlOLP-2qBhAbPga7OxPWPHOoJ54DOuPYP3OaLTPsBoLz7LjatVrRSmtP90gn1bQrtUxwYolCxHR98A5zgQXunYuvHmbEbr7Ub0b76HqSuwC36PXMOVyWo0hzceR4QLF8t55n538hZgIBRB7aurryv3MXwdbsBegZ7VLyBBu6FdhBps6H1F4+ScSbQKabQ1JkMlBQGiu7EiBBvmaoHUm9u4vLSZCuGkGUH+aizXTMHIxsGcRYAVA8HwpQ5F1LI5Z8s2QwMdxpwlVVAoaTPiuTug7SEQ6tHpuTv7XDHyjjGIevHZuTQqnmI2zZJCKsVkomFYRtBa5UpKIBvgeDTmG9bwfBuRnwqDHYdeHrb+GZuG7wIl8OWLBhR8gVvLs8w61nUtzxBePzOL7YAOYOAkaPNUzsADUoeBeBb3SmBRe1N05BAuZIAZ4G76M9gOln3QJmQc6P9xK27zClgUgeekO+eJehfbuC4Zeyf9GdKJehasHpeDUDs+J5ecIMAy5lfIpJVmoWf6gv4uR9gr32QmfDMM0QLSX10zOjeKTczhf-BIca6x3uHLu0GBa4r3SRaHuZB1rSP7Q7AdiI4Chf4TMOQomC-W6TQLAAePPumvO+feaY+4-RTLfL8Y7eaYr0HU+TLPSkrM+L2hXQjmQooSwvgGnCWfhF0mluxWp8fSvhUONwEWBJCa7Eu67ku6emfolY9Ls9lO6U7pPiLEpKGLDp-4bIw5+kTF-x6r73NzSiQslz+cQMbY-Yu7+F+cRvrxAbcLw8gUgAL72zwchCYduC0PEidrH96sp-HCPfwCCX9xg7mO6twESyv8pC1XFUPdSgHykxKNoUJP+WEw4lwIBodutkEGzEx3QO3CQMdxn4QD5+yJORIT2DrI1WGcPE-mfyQFQ9KeRjansoUG5owqBggJAd9WvBkRLYJWP5FyHpjzBz0RrWCPfDAEDoqBUAsrhPT6ZxwiQiAmgVISgZ3B9us-SAfwLp7Ew6Ul6cQObA0BiChQnBVZmcDkyyCdB1Ai-hfUO41cCe8g1gQnwu581k+13Iymny76i0xAz3OdE3GVriBgy--ddmUH3DyAIIlMEqvBwcT+BxSsfTOHpFVAuYwAGcYuOzCTh0JBA+fZPN3mIbrNrs9BXeDsHHBKQOkHkMgNgA6CDBqEg6cHFzHtbVDahQwetsPHmZEY0qYlY0EuzAj58cSu8PMAyhWAs8XQ2QKodCVaH1DKqjQ-0Ho2b7Q4WhgwNTGmw6EBNIY2QIsNJD7AkRUg+WFIHuEig5AI4fYUYZXy9DLCheg6FGGhTgEOJmhUwlYfW1u7yk0gvQtysLE6IjgO2FgCiA9j+Dc9uyVwmYShTuHI1buTfaYhFSuGrCMYrwi9hYGbRPozs9jPIAFhbL0wsglcdbuxG7KCFhC1CFGNklXCnd8i53YkSuAwBYwsk7gVEvMARDrIrAmVa6IGy-6kRbAo1GwNojMAeQCRJaIkcuFJFQjS8lI0kTSPYB0i1+zdJkc5WnBnA2Re8MoAUFYJ9geRUXTiPyP0DX0WYbMAuEnHtb8RWYfgPuFzAlFSj-O2wEOKsB2HUQkMO-ehORFMC3hSwufHsHyJsLaj3MRovUXMJFEeEfRJopOOaPQDrUWu+vSiFUDqCLBr0LoPaGsCTRHkFY+Iz0dQgMg4A+A9rdMdgD4Ahi3eloyDqHETDt5YYoQxVIWEZByomeAiKIR6MJHuZsxmYhYdCOhyNi8xCPaJDYGLGAgjMGzZ+LyEbyMjCSyY0ClqNurYRcIUPCcUwHbF09JUx4bBKWBtEOiMwA1WSEK3CT-ANRlYMcXAOnH+iY6042cZaK9obwkIIQlYLRjoj3gtYXBEsOYDMJ2A6xAo9zNKQEj2s3x7AY8Z63-D7B0gH+dceyCTSDCd8ZQJqAOGyyO4Ux9Y5Gp+IPHQ5Px34xrvjHrzXRKMhYe8OcMUhf1dYd7fuuMNiFrpdxEI9MZgCh6kSkJy9BksX0WDPoSwdQCoMyiNgmhdwLocwL7H+bujoJL4kiYZHgk6UKJtI0MQ3RHTMjgkBYTXuiKNgBJOCwMAOIfw6alViJT-A9lITcEhV-IlE8ptRJe4HAYiow+wCWCDg0Y5u0kYLKsFNDPivRyNDSX4H4m2SvxQk-MT+LEjCg9wkQ44VCAAH452Ca9Z+PRiXEnArJ1CWrB0HygvU3BoU8KVpIWaMdJqQ4YsPROyCZBBhYWf8Ygn2TLo8Ro41MZPVyhhTiQ-EqKcSBildDNOuYTKqoEYkVB8U7IOqGYDS4HhMwYSRSfwWUm2x7Yjsets5ih7dA-cHQDgHwLthTx1MpCHqMhPjC8sNk56UcPeABA7Ad6dqeDKGVEDJQSWSk3KcjQ6kjS02PU5saXlgB9SBpRRYaV1OczrVJA2JVUmmDeIriuxDBAipRSaSWSLg4pDAPACiCZ4XJ20PKnUDOA-VfWJrVBPdNkgFYdwSqV4ozG+nTARyZQGpmqIYnCgAstKe8SsAkwvJ+u3ZXSLHHjimi4A0MoQKIFiLwzOytQJGVBAYT+kGQXwTICTFIGgVsZXcHuHjI+lUSVyggHYB3mphdtKgsuH8hgkjHORXQc1HbgTO6wnBokezQqtJDxSi56E7wg8oASajlB0opdKrPZj9Biylx7LKwJyKD4J4KZa9NSFYOMAJoCC8OFXMsVmyHYtZKyatD9VCZf82RlFYYfyVXjExtxAhIfAbnpzWykctstem3SnQdFjg+raSWJWAiIQQkraYzlX3JZD488buW2aBkhApBZIao2SCuK+Cg1VA-wZvPWU9naowWx+JORNI0RVTO28IaoCVmhCmgFaadPksYER62APKas45mQiZo2yy5CyVQLtHgyLBJ0mcllJDEiL2Nisc3awsITsJCpHCvGAOZvBrksQNIeJa8cyDS6AzFMN6Quf0TIRzFhi5qX2X9i7lszxUv0yzDeIzB9iTE9oeQDEg3h+t1pcQ4RAmUfJizKGwHAMjq2MBliYESUdpAOH-LozWpCnYUvqQvrzk35JYJMHegyAQyme78CWdkFSihyGU0kYBYDzsQvyDSLFWoZgDFm7BAkhmeoJRQH6BtVgdRHYPsxAhbNCJGCiQFgocFvVUy6ZTWd3OKiBkx+9ZSiBYhWAUwLQQWAGmaCBjoK45cFdgGLPzCSznIkYlMDKnfi-DKMWCbHqshkp0VfKFKfyujDfmWYho4gTOfZQdHQgk8oMg5MCCbg7BVFEFein5UYpiK35R1ZPDgV2YpArATnAUO5JCGqoa0yjMgd5XkoaLbFOC5RG-IMHURHAsIbsGHKkyd4jhlGV0B8lzmWK5K1igJQFSYVqUQqYAexWnXmlhtuw4EXKmmkLqr4d45EWOdF16RtVKqCJGqg4jqpiylIDUA2DvjAiuKoIcIe0BvUloxMbAAdJmqKTfmAxpaA-AEN2BSB1RCwROPEoJRkFkCIGigq-hCJCAICeMT1YkG-OshDQ982sIXF1iOoSDakd2YwNoD6XV0YBQverhspNBE5BsdQY4DsL2KExYklgEWN-AuFdM7E8yg0o4NPpqM35YUMzFuRZIBI5ZXY6BaIGyB-ELA5Sj5RIC+VMN6Bmjans-XMZZK2Fjtb1MMLIq58eScsh9LmBPDHVcOQilRvQ1RWvz0VKdQktvnTlENIVcssIhINzbOR6gYWemWHzLon14VFJYbsjSnrrLKV3IDHg+LQLyBLCbIi8GkHozkQ9YUc0lSPTUYLLYByNS5YKvIxJguxfFCakYWYmugiaKQaoPI07LbzP2XKxVd8qYVHczVqK-5SRGrRph+ETPZ2QUB+BOo9Y6KQsPKt+Xkq6BLDcHifUXq2rH20Yl4gtBzpLNm4jGaGDsFNZEovGPjWAH4y1mIRTAzSbvBVFyCBtM0nS9lPRgJLZSOVtDBJkyySaVUUmgzUprbI-7MJ7AYqoxVEuBrcLJI-rf3ldhEUVL45JzS1hxiebgJKWfGLWXm3XJnoGMGKb8r80xFpgV8G9EnDu35QWzw0g6zIMOsGro4su68HsMyWznZy9YqUOdaMmtYosl1ykbjqOvXXqkH4bJU0P3VaiqzC17cgIKKwXWStVWx64dQiAtDOVw4p0ZFMKFKVpQ8SJq0FkPlFbUtbW7rN9VCFVSfr6oHIJzhkGbS-dK4prOXGQIpaWsK2g6B5FWrgQO5-mjGMyRLD-Gx40FWAm9u2thXobo2mGyqvChw1lA8NsgAjTYHba9YCFceVQBdneVktL6ZCUVlO2HYzzINJ2aFV+u3pQRNl8GX4P9WOA7x91VyU9gezwWCqd8VTc9NoC24Chew4MDtr2L-LQgAkj8kBdXz44ocaOYsnVrmCUh3s4YYRLrACAaiXz1Ah9I4DYPBKDKENr3RKK2nGVYoayY-e8OX2XaEk3NPKpQSjTxqERYpaVYEHAkFzasJwroTrg-HvRRQY19QUPvTVobaCL6vK0+mN16Bvz-uRMGuO3WlwNM26fczkdeAPB3sjNdCigfFyTKWrEsjWtFSfOrJ4o4ZwMQeWxM+7uLJySkQuvNG43h8ctFJInmD2RVMD2t2kiWgtB+AhMboiRDZrIskD-UNIcMWWGaEN6Ud3NKm02WUCWijL4MB9fLG0i+ZxFMSAsVQLtuU7G8cA7AU3vEPt6zbotfVQqkdpiK7LTEDTQAhv2DikzXIo2hDqZohLR8zeDffbR1v-DBZuE1UholJrwHLrme1MMoQUJsEuD1BFKmHWlUYKBDsgwQo4BsxYKfxwlx2iaKsEx0sDsd5y6hDfxf7qD-lEkfujKmqijgxBwWCEKwVdBzc5U1O3QbTty3hb4BxqKAf8sKxfDQ41jQNnYAjjRIgUsgJqIVzbkxdnBNO+wRNsRWMDtBWOyQv8vBAFtagLCIxOOq2CRzM2+knrBOjx5kC2tcgjXbQOF2LK5BsXNQfrrVX7gORy6YamaCYnm7zEqa+5W02nUC67BTuikj8pm0O7BdHu3HewsBCdLQ25QZ-CRDEFbDR0MTLHjJFoVxyEhlVDoWLLQRpozsf+XZKbBW6MJVI3I4nRoEzCTCahdQ0tfqP7hizJlkQ-cLihk2pTJAyYK7MumXyjaQRze24VkluoOIJFxiFUuYlkA8EHKZ4d-LopYjLAZYwU9zGKIwBF65dRNfcIK1po-E9ieLReAhFShZ0QIa+lVbqLRBzCt9DU4-ZFF30cgpJXdYEKOiQT1wWIo25SY2K30mESwNQd-JmrBht4X8jZDelNUXgX7Ag043-XpiHBMFCwYbMwCuM-o7Jss+wZWq3LD7KTPxW+pERvXbiQqWIapHQmaDIhirfW9REcdgc2mBBSJeBhqD1mnACJ9kxwa9GQeAo+0EEnzT2cpIcl4HdodTA5mcHCWDCfYN8-aJ1gZD1b5wyk4qUSC30Px9YuBXTFHDqhxpnNTclfE-CgPbSupu0saVvpbJUQGUkK+UWYB3oGg7AF4HPX8g1QuAgAA */
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
          target: 'idle',
          actions: ['AST revolve'],
          reenter: false,
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

        Export: {
          target: 'idle',
          reenter: false,
          guard: 'Has exportable geometry',
          actions: 'Engine export',
        },

        Make: {
          target: 'idle',
          reenter: false,
          guard: 'Has exportable geometry',
          actions: 'Make',
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
                'Add rectangle origin': {
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
                  if (event.type !== 'Add rectangle origin')
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
              on: {
                'Add circle origin': {
                  target: 'adding draft circle',
                  reenter: true,
                },
              },

              entry: 'listen for circle origin',
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
                  actions: 'remove draft point',
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
          exit: 'remove draft point',

          on: {
            'change tool': 'Change Tool',
          },
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
    'VariableDeclarator'
  )
  if (variableDeclaration instanceof Error) return false
  if (variableDeclaration.node.type !== 'VariableDeclarator') return false
  const maybePipeExpression = variableDeclaration.node.init
  if (
    maybePipeExpression.type === 'CallExpression' &&
    (maybePipeExpression.callee.name === 'startProfileAt' ||
      maybePipeExpression.callee.name === 'circle' ||
      maybePipeExpression.callee.name === 'circleThreePoint')
  )
    return true
  if (
    maybePipeExpression.type === 'CallExpressionKw' &&
    (maybePipeExpression.callee.name === 'startProfileAt' ||
      maybePipeExpression.callee.name === 'circleThreePoint')
  )
    return true
  if (maybePipeExpression.type !== 'PipeExpression') return false
  const hasStartProfileAt = maybePipeExpression.body.some(
    (item) =>
      item.type === 'CallExpression' && item.callee.name === 'startProfileAt'
  )
  const hasCircle =
    maybePipeExpression.body.some(
      (item) => item.type === 'CallExpression' && item.callee.name === 'circle'
    ) ||
    maybePipeExpression.body.some(
      (item) =>
        item.type === 'CallExpressionKw' &&
        item.callee.name === 'circleThreePoint'
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
    (item) => item.type === 'CallExpression' && item.callee.name === 'circle'
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
      node.type === 'CallExpression' &&
      (node.callee.name === 'close' || node.callee.name === 'circle')
  )
}

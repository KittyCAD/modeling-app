import { PathToNode, VariableDeclarator, parse, recast } from 'lang/wasm'
import {
  Axis,
  DefaultPlaneSelection,
  Selections,
  Selection,
  updateSelections,
} from 'lib/selections'
import { assign, fromPromise, setup } from 'xstate'
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
import {
  addOffsetPlane,
  deleteFromSelection,
  extrudeSketch,
  loftSketches,
  revolveSketch,
} from 'lang/modifyAst'
import {
  applyEdgeTreatmentToSelection,
  EdgeTreatmentType,
  FilletParameters,
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
import { DefaultPlaneStr, getFaceDetails } from 'clientSideScene/sceneEntities'
import { uuidv4 } from 'lib/utils'
import { Coords2d } from 'lang/std/sketch'
import { deleteSegment } from 'clientSideScene/ClientSideSceneComp'
import { executeAst } from 'lang/langHelpers'
import toast from 'react-hot-toast'
import { ToolbarModeName } from 'lib/toolbar'
import { quaternionFromUpNForward } from 'clientSideScene/helpers'
import { Vector3 } from 'three'
import { MachineManager } from 'components/MachineManagerProvider'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export type SetSelections =
  | {
      selectionType: 'singleCodeCursor'
      selection?: Selection
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
  sketchEntryNodePath: PathToNode
  sketchNodePaths: PathToNode[]
  planeNodePath: PathToNode
  zAxis: [number, number, number]
  yAxis: [number, number, number]
  origin: [number, number, number]
}

export interface SketchDetailsUpdate {
  updatedEntryNodePath: PathToNode
  updatedSketchNodePaths: PathToNode[]
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
  openPanes: SidebarType[]
}

export type SketchTool =
  | 'line'
  | 'tangentialArc'
  | 'rectangle'
  | 'center rectangle'
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
  | { type: 'Cancel' }
  | { type: 'CancelSketch' }
  | {
      type: 'Add start point'
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
  | { type: 'Constrain length' }
  | { type: 'Constrain equal length' }
  | { type: 'Constrain parallel' }
  | { type: 'Constrain remove constraints'; data?: PathToNode }
  | { type: 'Re-execute' }
  | { type: 'Export'; data: ModelingCommandSchema['Export'] }
  | { type: 'Make'; data: ModelingCommandSchema['Make'] }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Loft'; data?: ModelingCommandSchema['Loft'] }
  | { type: 'Revolve'; data?: ModelingCommandSchema['Revolve'] }
  | { type: 'Fillet'; data?: ModelingCommandSchema['Fillet'] }
  | { type: 'Offset plane'; data: ModelingCommandSchema['Offset plane'] }
  | { type: 'Text-to-CAD'; data: ModelingCommandSchema['Text-to-CAD'] }
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
  | { type: 'Finish center rectangle' }
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
    'has valid sweep selection': () => false,
    'has valid loft selection': () => false,
    'has valid edge treatment selection': () => false,
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
    'Can convert to variable': ({ event }) => {
      if (event.type !== 'Convert to variable') return false
      if (!event.data) return false
      const ast = parse(recast(kclManager.ast))
      if (err(ast)) return false
      const isSafeRetVal = isNodeSafeToReplacePath(ast, event.data.pathToNode)
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
    'next is line': ({ context }) => context.currentTool === 'line',
    'next is none': ({ context }) => context.currentTool === 'none',
  },
  // end guards
  actions: {
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
    'AST extrude': ({ context: { store }, event }) => {
      if (event.type !== 'Extrude') return
      ;(async () => {
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
          selection.graphSelections[0]?.codeRef.range
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
      })().catch(reportRejection)
    },
    'AST revolve': ({ context: { store }, event }) => {
      if (event.type !== 'Revolve') return
      ;(async () => {
        if (!event.data) return
        const { selection, angle } = event.data
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
        const pathToNode = getNodePathFromSourceRange(
          ast,
          selection.graphSelections[0]?.codeRef.range
        )
        const revolveSketchRes = revolveSketch(
          ast,
          pathToNode,
          false,
          'variableName' in angle ? angle.variableIdentifierAst : angle.valueAst
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
    'AST delete selection': ({ context: { selectionRanges } }) => {
      ;(async () => {
        let ast = kclManager.ast

        const modifiedAst = await deleteFromSelection(
          ast,
          selectionRanges.graphSelections[0],
          kclManager.programMemory,
          getFaceDetails
        )
        if (err(modifiedAst)) return

        const testExecute = await executeAst({
          ast: modifiedAst,
          idGenerator: kclManager.execState.idGenerator,
          useFakeExecutor: true,
          engineCommandManager,
        })
        if (testExecute.errors.length) {
          toast.error('Unable to delete part')
          return
        }

        await kclManager.updateAst(modifiedAst, true)
        await codeManager.updateEditorWithAstAndWriteToFile(modifiedAst)
      })().catch(reportRejection)
    },
    'AST fillet': ({ event }) => {
      if (event.type !== 'Fillet') return
      if (!event.data) return

      // Extract inputs
      const ast = kclManager.ast
      const { selection, radius } = event.data
      const parameters: FilletParameters = {
        type: EdgeTreatmentType.Fillet,
        radius,
      }

      // Apply fillet to selection
      const applyEdgeTreatmentToSelectionResult = applyEdgeTreatmentToSelection(
        ast,
        selection,
        parameters
      )
      if (err(applyEdgeTreatmentToSelectionResult))
        return applyEdgeTreatmentToSelectionResult

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
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
    'set up draft arc': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager
        .setupDraftSegment(
          sketchDetails.sketchEntryNodePath,
          sketchDetails.sketchNodePaths,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'tangentialArcTo'
        )
        .then(() => {
          return codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
        })
    },
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
    'update sketchDetails': assign(({ event, context }) => {
      if (
        event.type !== 'xstate.done.actor.set-up-draft-circle' &&
        event.type !== 'xstate.done.actor.set-up-draft-rectangle' &&
        event.type !== 'xstate.done.actor.set-up-draft-center-rectangle'
      )
        return {}
      if (!context.sketchDetails) return {}
      return {
        sketchDetails: {
          ...context.sketchDetails,
          planeNodePath: context.sketchDetails?.planeNodePath || [],
          sketchEntryNodePath: event.output.updatedEntryNodePath,
          sketchNodePaths: event.output.updatedSketchNodePaths,
        },
      }
    }),
    'show default planes': () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      kclManager.showPlanes()
    },
    'setup noPoints onClick listener': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      sceneEntitiesManager.setupNoPointsListener({
        sketchDetails,
        afterClick: (_, data) =>
          sceneInfra.modelingSend({ type: 'Add start point', data }),
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
          kclManager.programMemory
        )
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchEntryNodePath,
          sketchDetails.sketchNodePaths,
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
          kclManager.programMemory
        )
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
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

        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          parse(recast(modifiedAst)),
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
    'Get length info': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails' | 'selectionRanges'>
      }) => {
        return {} as SetSelections
      }
    ),
    'Get convert to variable info': fromPromise(
      async (_: {
        input: Pick<
          ModelingMachineContext,
          'sketchDetails' | 'selectionRanges'
        > & {
          data?: {
            variableName: string
            pathToNode: PathToNode
          }
        }
      }) => {
        return {} as SetSelections
      }
    ),
    offsetPlaneAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Offset plane'] | undefined
      }) => {
        if (!input) return new Error('No input provided')
        // Extract inputs
        const ast = kclManager.ast
        const { plane: selection, distance } = input

        // Extract the default plane from selection
        const plane = selection.otherSelections[0]
        if (!(plane && plane instanceof Object && 'name' in plane))
          return trap('No plane selected')

        // Insert the distance variable if it exists
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

        // Get the default plane name from the selection

        const offsetPlaneResult = addOffsetPlane({
          node: ast,
          defaultPlane: plane.name,
          offset:
            'variableName' in distance
              ? distance.variableIdentifierAst
              : distance.valueAst,
        })

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
    'set-up-draft-circle': fromPromise(
      async (_: {
        input: Pick<ModelingMachineContext, 'sketchDetails'> & {
          data: [x: number, y: number]
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
  },
  // end services
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeWZSZCRUxJa1flTCNTWLYIYS2CT2RSKdRyGhZawWc4tS6eDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd5CYHCSFqOQ1NSKWRiMRA0HqSTKblSX48+pKZGtNHEXEjEm3Eg4kkkfzcQLBUJTanRWlvBLbNlfFTWGG2Gi2TkpUGCTkLaypZQ-FRSOQZRQyCWo9oSbAQTBgAgAUTxpMCAGs-OQABZa15TBlJHKKb5qGTCTKc2zAsSg7JqdLO5YulIqRQ5D0eL0+v2B4Ny2Dh9hRqiKSI02JxvUJiEKO35RSs5Z1EEGIxp0zc6HCH5ybQc8tXKDe33+gOPEm9DAxnUdmZCMTZdLgqe7GhqEunUGCtI7UTaeYFLJiedopfVgBKYEJqEwxK37fpnaCPuSa-Pk8xOioCgyJewppLsKb7DIUh2NUz6VsuBAAGLYJgfpPPQ4zbgBu5JPuXxnssNDGGy8IFJeKjmOkORZDIpZIahzSSuh1ariwJL4a22r-tM-B7qokKKGRdrHPYw4lI49SLDQWgzoiNgaIoaH4K+-rICQ4Z-nSImzPukiOipvyiNy0EjggkmAhUqhWFRPzyKoWmLlW-oACLBCMap+hq4QES8RHGWJXxKPCcjGKxNoqJeaiKUaKYxYip7WCmHk6QQAAqYCPII7CoIIRAAILeYZuokUB4kKNobpnnYRqXjIjFaFm9Q8gxJbZV5BD4gAZoNQQBEw5K4KMIVtkZ8a1ZIND2PudhaDYU6goi4LSLI5jKcK-Zun1y4SJGPpgAAChNcAEGV-HYINJChP4UBKkwkb+CwTC9OSIwQFVO6iUkVkVE6WSQRY+TZJeLmQqkCgwrkaa2EdfoSLAkaoAA7pdZDXbdnAPU9L0kG9-hgF0TCcJA-3EYDQHaOky3WC6pbCHCcmIKWnIVBYSXAnaLqptl3gNlGxBkJQmAixG0bTUJs2dqcBSmGaqT1P2RqApemVpKtKYqUCVhyMLouRgQvl4WAarYjKNPhQgShfAULoxeYKVuqCBwSA4kGZm7+RTibMsEHcGBkxAHD+BAvQku0YYy3b8ZtUo0gIkh9lpmz0OQdtaYpvCabzO6nGetp0uNpGEjl1GACSGF6eG1s4ni-jEnd5AkJgieK0acimAoylmNU4jIZeuRJo+kk2FkyxziXFZl6bVem3X1YN1bQQ2y3GOxwAXvcnfdyRbXQt7i3IUsYjKNoRS2SaebT-k+eZ5p88LsvMsfxXq-+kQ3CwOwJUeB-A72wPvPEnco7YAARLKaglYy00SKcL2dg5BmDQWyJKi0NpX0ivYcEjsjSchUEHCuX9a4YT-rgABQDcCt1JJwDumAoEwIoHAwiwkk7mEkMnZS+sHCSVviUY4SZMoplLD8aoGRSFRnIZGH+xB-6AJIMAsqAAhbw-gAAaR9AZtWNNIGwaCBaLWqLoWy9gDxsn7FkOEmQZwyMrtXeRlClG0P8OozRABNXRSCiEVHkLtHIgJnRCO2JtFWVFVKyGQmeRxciFFUJoSouhZAoB+l8dsSCeYXQHFisoY0FgNrggWqcOEZhWIHCfG-F8ziEmuOoco4Bfp8DsFlvAsKXC2SHmUiEtYgJsy2WZqmUwDEzA8n7GeDiFwF6Ljqc4xJbiUkfVJEwXEEdyDfRIHKCOrDKCZIQKcKc0gzzch9nwjmpQUzWGTLsHI7JrLxIWQ05JwDQHgKGLhfQ-hO7YCgLgA5yC8z3OyHkBi8hzHySsOULIp40HmDtECJ5K8XlNLoW3RhndMDfN+f8wFJZJBgWhNkbkRpjCXlUF8VM6g7Q7HmFlGpXp5kourEktFgRcAk38MVbR+L1AVH2I0DI2RykbUcAseEWQpn0oUMimWizGnuNgJypg3LUD+B8XLBB9s2r8sgpJUlMU3Q8g2naHhZjcj7ByMbRli9P7PNZUs4BYAACOvRIEtKgG0-FmUJAcnhA6Bil8YJOiUkPQWjg0Fyu-qi9xTBtlYuoFqzpPcrDfGNMKfYqR7Cpg2lRHh+07A8kqYCaNFDHWKuWSScmqBiS3CdXiKkybOGKyQgtLIQIEWsRUolUNqkIaZCUMCV+Mz37MvlRhD8ggCohF6CMQFcI0i2H0SKI0+wEp30kg-UsxjahWRIbauZS8HX+lDlbSAkdo6x3wPHCu+KU4FjcqWYUZ5LzQiTFU-WtRkKODLS4itGK1Wt22dgEgAAjDJzaFbHydHmKJylwQBpyJcpWAoX3KCspKm1o7anHpZaeyMaSrbFW-Acn4wJvbLB2MQjkOxBnyTtAsKpS0gSqFsE0HDTKl5lUxiogI7yD7MN2UMNh-g8CDVQAQCA3AwDelwF+cMEgYDsEEAJiBmBBDidQGRhiCwf1TlUDOeEkLEAgoqMzLByE7DgniTxvjIDUB70EywkTlAxO4AkwQUkJJHMSHGsMCTJIuhKb8KpxzYDBOaY89pqD1VAY9RAqeKcBxkI2EUBtdQeYlD7iWGaBQxhqmcbtWQuzkcMXYCYS52B7nPPScmnJhTsnlOCHK0wqLEmdOhtyPYJ0mRwS2Ayw4AVi0ZzzEhjFWzvGysMIq5A4T1WtNeZJD5kkfmfqBeC811rnd2sxY6S2kiPVgXwg0ECGEzpLnVH2H61Y9gqLIIPUVo9n9SsBE8domrkm6uybwI1kLKnwOwEEHwXbOncgSEEccDQdpoSgksXmDkpKSy2NOJN+z72tGfaWyttbAXHObdC4D4HoPYsA0SGMyKmUubqX3JsCxi1yhughbY7Q4y0eR3e14rH32GuoEU81on+gSf7eg-FyRjNTwpmMMhKicPOSSGZqsfI6t9iFZRLMuREhXseI0RqrH3nfP+fYBt-7ghBfC44aL8nrl01LDQfCXIbI4dLCTFZ+qTJIJRsPZr7XaS-Tc5k7z-nhP8B+gt6FA7YvweG3kGIrQshil1XEAQ2QcLi5PZ91NgIfuraLYN6to3JuBeh7AOHmacXrfcm9icOoL7gQ2WEdC7aKRWRZisNYdnARPVtID-V37fOmuhe75GMv8sK+IDGa75mVgDo2Dahte8hirO7FTEoCb3u6na+H-r5bhv1v49N8P0f2r4xjJufyVXBx7cbuETFBYqC0wZF2MsEd6ux3cazyskkazcAbK2Ts6BVzXPaLKTQPfvYPFTNZb-dZCrf-QQebNhY-FNQ7dkSES1cEVMZQGEDaM8L4GEOoKZJyViTvL-H-P-ckAAvZYAzzfPXHY3A-ZrKAsg2Aig+AwA2BJAyPcnVAnYG8aoR-bAoZf4CHAZQgwEYgjfJeAAGTwGI1QG-BDkI3wDkNI1J0QQnyBEJXEDdCnB6gTzvhGzQPViWhTAkIzzqRkMmjVW-AkBrlwA4BuggAgEGG2TGlQDwAEkt3HwQB+HBwUAwSSjdEcEuVY22him5GyHtDaniUsJUMwFsPsPYHFjYS7jUPtlQUZ32BdHEDMCRlBEHEhCNBvDhFBWmTf1w0-liOsPiNwHx07mIEwFYA3lNjI10KUhnF2AYjZnn1sh-TQNqBhAYmhBOHiTsIcMBUkhuUojPDdCDRLFaivkWF7kd14Ow3KK40-jGKSObBF28O7SXRSBNHkEyAvDvnMDzB5AsDZHmC3QZXMKXlyiIzxFA2YW2XIDVUUKI2qIOSvmu1qDsFqB5EhhMwQHr1MH7CUAKyfzMHiV6F-3VRgX4mcXxFwFAL73kwHy128FykEDhOk0EERPYGRIBTSPjB0JAlCWNB+Drxv0QDQSTEcHMn3GQhnEe3WOK1kQ-FCBz2qM+OUO+NJM7Cvi0G+BhAQzZlPHUDfSQm+F63sCv0f3iS5JE3STiK1yzzjiCDuF-3rRJEmhJCwjwGgXemrW5JLwOSBFYkWHvFUEOGQhBMyAhHSmyGUBqGhGRkkM-mVJ5JI3iNezjnCygDwEcOcNNJVP90DLwAtMR1MCQgcAyGCS1lsiBBuTZn7GQVOGnA709LIW9JL2qIkGwnsPRkgH8DzNVLRJ+wxMU1Gl6CYEEHIBwBlAJLOgJNNgJLAC3nYCbV2LJyMFyAuJqFiUXTZDCTsgcGvAISPCQhmNfy4g5MrnLP919IkBICcLjggCVEGgCDDJz0rKD1k1GlxPrM3JIG3MEF3PNMFJIjOymKfhh2zXEHyPkEMVUD3Ud0+CVJCHDLVLXIjhvVPO3P8EvIrNoMLwPyPLrPgK3JUxAsg17PULBFp1GQDTQQaiKVsigj9QZzNEsGNDWPnOezISIBlBDCXLiL5JgAFIQvtl+PKGBBLBd3lPohMGyELAQm5HBDUHiRItrDLO-J9PkL9I1JvTuD1NJENOLPekoD4rgvYQjytzpLfIh37FEBSFAkkmhi2gKHqHhUCNZAItLiItkV4tlH4rNNVILP9JvUjNRLKicNuFIrlDkpVFjiDJJJovjBdgZOSwzA7XozpLdG+GX0wJLB2h4qcvMp-ILKLONNLNMrIoEpL33PAMPL8CgsbOwGbLYAwDbJlg7K7NgGsAOWsWZB5BnGpSMSdGhjanSAyj5hhHpOzPuM-gSrlHIoLL-KjhgsctkqSorJ51SrRlCygsApUxktlAvP6vgq8L7IQBZmZBTBOFdkzmEHyIoy5GTlYm0MMo1zqTaqisEpsK6rGt6rMrkuxz3zxyC2GpU1GpgobKcqmospmoUu8INDSAcBsBpU0H3BzBTG+FEHTANkQniUbLADIECB+n9EBQnDPilSPAhh+G1nsHzDYlUEFVZBIO1MAx5UJBA3A2rEGurMH3Gu4AxSKhKnxtjkJtLy0x01Pl2DIkmJOwb22COT9WFWOKnDKMIsz3sxxoYSA2ptAwg39DAv3xuua0Fv4kppawJrFs4MUp8LJWkFzEyh2A5FSDh09x5jKCBr2mxobWAprTrW1NeUbRSpJokHxPNrRSmp6GJAbIbU8LermqGIWAUBSE0O6lfTvimRQuWgiPOznKMv5sjjtvcTU0+WxStr+1tobTCyc3U2xR0xfOh37AyE1mRrOP7G+FUmhB2CiVyCNsrWAW2y+TjsxITrLtwBaxmyYVTuvLFx+AqGdCdCf1PFlzvivj7ghIcFSGh3BVLotoc2TpjpxRwH+SrsUxrotqToixTqF1xQ8tmsQqDTSH9RikzOZmwTviPHSEzqHBERSBHvZQruxR+SntROJvjpKkjpSXrvbixWXuvoZr03UHMFdNqChjvmyBuTdFiUyh0rPG4pzNkW1wfuAWVS5R5S0RntkznvtpgfrOKmBzTr7kWlPCvkTBdDWqGUmJOQwVOEGOhDPqVRVSAy8QQZtvvsTpQblv0E6ymLTMHk1mBFNQYmrzYwcH3CyF-XAcrkgeNtdXdWYWHxoaQdoWnTdR22Hx0yWAkk0HrzOzQRglOD9WtQmT1nT3ZOMqEc-ygboXjSVFwiwEkbodrsEBMcTVSM8s7B6h4TNGccyl6zzR5G9lLF+K7vBDZL5v2qUKotyiEoIDI1T0WEiOUifzNW1nhFMGlwLlqCwQ4z0c1yIECatmCYUJ2LXtovhBhQsGviqB2FpLsnSnidSESc0Koh4oyf8CycwFCesHsZIl+BlJLE0KwWUAyFib2ASaoiSbuVqa+IadCZkBacBjMDPE8bZlUF9mWF6YqfmAGeqZSf8aXnSZGZCaoBUAmcSF7oZJiUAdZkgm1kUiweQXyAhnqGGf5NGaoDED2cQAOYhyOfTjtFObvlYjMn1nql02NB4uwBJHBt5KjC+N9J+JIeb2hF+G0KsEvEf29lBiSjVgwV2vf1aqBZBZXOsqgFcr+WDPsucPICxYjLcqjObsSEQ09uZl2GyFWA0H+sNFTwYldlpTV3WcxeBeXKEvVL4zjjfDXOwH6EkuNNuFJfkvLzmvBEcEBu6aSnj15AMJqE8chPTLhDZikEBe5bVNipLOcKIAldCcpYn2BByVFDNFMiQlKeUFkG9kwQw2WinF0c5eIolc6vXIAp6pJZ1ZocgpPIep9fBotOvgh2AiDUzilNsiWshFUBZMODPHEG1exd5b-I3O9aNYluuuC39egrPPGolZ+JSBuURAMqdEdjpxKHpUZhSAHkHEykcX8FqP8EJn9F8ECgCAwAem+jGiugOWtCSnHDTBqCnCHEEMb2ZAFjo25GNGGTWbDrIGwC6GGDjh5X80mhocXeXZGDltbbCcWsyA5BnBmKSjZtKDZkPFHK8e2sDm9y3ZXZvTXaukuoL0luC3vZ3bQb3ZNbKYVwMwHnYjPBijh1ZACSDQhOZlZmyg-dXfVQKkAM1NNk3fsO3dLzQfrATh-adAPewaikkmMFqFBGMBuUOBwctdyw5YXZQ4fbxZ5Xg4AUQ+DizfoJuo-bQ5Kgw7vR-ZsXSBLAOGZnCKibHMTZVmOCnBGwIOyjKiYHGn0ADOGlGg+mfdvsxNQAU78BxkmjKgAXcH7ccCTDJQRq0BtEuUmSTCRkWkcH48BHnY12k9k-k5GgxHXfFt31fezYkDU6c-YE07AG0-YF06w6XR2DhBsFS1b0Sg5AqFLEs6BFwqsBcGaFqIwHgCiEItybmnKWr0ufSiqRBJuSvl9mpM0EhLLG9y8gy8AjqEwdMO0Fy5HnWs9qUEgiNGAZnhRlk1OgwF89S6lcQpEFPGy6HPq-qDfTzudCZBbyYrAYzy8jRgxmxiul67HzmsEB2BuXd3MCQnh0rc5ktetMkjNFZBnmyEcUq+PkyHKGmPPDmPSyEIK7MBO1ZEuZdbDvHRjT9HO70QHIqGBGFTNEwI9i+dPi1rpTyHpRIOjrm3YNEy0y+-J3ycMRlePBtEcBwUyAh0RCNB2gf3RYqJK0-wrqq1h+i3h4nwnPHBFB3VyB0o2lTD7mPflJhAUjqBIIx0+zJ58KO-ztkFYcLuqDh15kWEqR0I5EcCQjZ91y5zh7dvXrNE3v4M0JQlYlKe7S+ElTVmGRTDsBIJ5Jl76-SNMW9mQyUDdDQTTGKTtFMFnFkCWGZgbcEb5cjm3315W7l6t9GyLiFCHI2nhXiddEtR+Bs0d+1yYJgM2QoOJ7c1d5P0VhOAhyPcBBhAeQXw0GTHUBSFTwOEOkd6qN9M574-IlSEBCSnqBs6I4x6QnCL0JnZm9SYsNkILK2IL-ND9WL59uQnJUwtbrsWZ-jOCNs4xbITz95dqKC07gL5l2F5o2lwCvmoBt5jn3OMWlGMSM58qWZEOGMG6bYzPdLAZh0YNlqDOEd8eOUOeMgTeLVU55wcOdYkyjSmT6I7qnUis+uKGNhPhJcKRNNhRPX+Vz9SWJqggSYsER2ORSIjg1QTkLRi-IvU4inPY8FdwBCxIfgMXOfvsDgxmA3Q1qGeAC0d4dUcWIlPFlqW4DEtHM+pBAbpT9TCgNaqwHptGxMBWAyk7EMvuKHwHTU1SuLfFu5UoFjhjQNiYhMgifLJkUg44EsJyFYjHgdgsA6KiuT1aRhSy5FSgWaGkDIDP6ZHOfvYkWq2B9obIcTgl3YFwCPW-5PFqdTkrKCpiIoATv2HVjPk4IR7Xhk6A34RU+KBAoSpz3-r358gfHQcB0VBAYDvYj3ELhaG6IuCzKbgmwlwLEoUDZe9sa4jchsAZp-i08M9j-WTDYMUyJSZmGEMSpGDCB-LGyuSxEix8SIbIRENbzYipgqIk4OfqkDKqPcqSUg50DkPaocCYqRpfVv4AOpKDYhXlXsMFXNB3g2YSUaGKINdJHMtAYVV7ntQ2aRUIh8RE6t60irmDehnYNipFElw1AAQAyfInYEPCjtlcVJHkGDT9CQ1YA0Ndfr8ARzsQ2odXOfG+hThshRQiuYYfuFLq411UItWmuv3j42DDYsKeoDkDhynA0g+-ZSFRERAkpphQ-CBoY2NrVpHaVsIxt2R+HzBFgiONMLkBL42t84l7ZQCxAVa803uH+AWsbSh5fJURtoDEVPGxFjkxSDPcQKF0kFHdoR+PWEaSNrr0Jn6FI1YcfG0BUj8ONIztHSN+KmAtAhsUsLOySjkNlk5Iy+ivUpHoit00JOwAixhA3YSkNQSQcahlHl0G6L9K+n8mKHIE9E-IpUVkQNR2A968kDIAsGpTJMNA6w3UXQhQZAYtEPwgGjYKvj3ZC4+XZnpj3MCIYCgfWZ0RylgbqovEHovAqXz6yYEFmQydjBDgRB1dbifjYkS9jhGcjRGHqXEF6kjCKiqcFo0lHv2yxhonB8IKvqWFDE2MzGmAD0SBC2Fi9UwMxOflj3KAiJCu3IfYDCFuZBN3BvI+LKWPmC4JdCDEfQgxhMA8hKmKzZJsmx5bfgb+egxYBhgrFJZwiRHFQfXkK798qIg-NkZXENY6srKRA7gXgBv5aAJUgxC7L8HpI5gXyRRcNPUDqHNV6+Gzd1vkMmA3pBWEcfoOeLGElF8RWPIHiUCSb9wKIkwjQAzjnG6sOhCgg1hK3PEoJL4umSwH7XkiLQ4MnIfTqlCiRatHeh4lNsdU9amCM2OrRcchGXF34sGP9OoPkTHCHcmaVEMGMhEbbNtW2nPQQMhgqB1AO6rXDCWey1HSA6g08X4JMizDQdqOnAR9uqhc6c9nQ5mVMFSVXyKSz2ZqZMDUEzCAknIEkpdjRyAz0cpJxA02B4JySnIpxtvfTER1EEPg2IqwQulJxk7YpHOinWSQOOKhMBTM4gcoGUJnASkQRvwPQH6G3JCBHAaQOoZJHFHrcr4egMDKgHYDFQugpmR0ukCMQ-1FobaYcG5UjDsAhAoacKfUGP4ihTwegTGD6DaScxEQegBQX8mykT5zEswUKW3UxGRSqe7jbyalL8kZTEuTgIAA */
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
          target: 'idle',
          guard: 'has valid sweep selection',
          actions: ['AST extrude'],
          reenter: false,
        },

        Revolve: {
          target: 'idle',
          guard: 'has valid sweep selection',
          actions: ['AST revolve'],
          reenter: false,
        },

        Loft: {
          target: 'Applying loft',
          reenter: true,
        },

        Fillet: {
          target: 'idle',
          guard: 'has valid edge treatment selection',
          actions: ['AST fillet'],
          reenter: false,
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
          target: 'idle',
          guard: 'has valid selection for deletion',
          actions: ['AST delete selection'],
          reenter: false,
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
              target: 'Await length info',
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

            'Convert to variable': {
              target: 'Await convert to variable',
              guard: 'Can convert to variable',
            },

            'change tool': {
              target: 'Change Tool',
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

        'Await length info': {
          invoke: {
            src: 'Get length info',
            id: 'get-length-info',
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
                'Close sketch': 'Init',
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
              guard: 'is editing existing sketch',
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
                'Finish rectangle': 'Finished Rectangle',
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
            },
          },
        },

        'Center Rectangle tool': {
          states: {
            'Awaiting corner': {
              on: {
                'Finish center rectangle': 'Finished Center Rectangle',
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
            input: ({ context: { selectionRanges, sketchDetails }, event }) => {
              if (event.type !== 'Convert to variable') {
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

        'Change Tool': {
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
          ],

          entry: ['assign tool in context', 'reset selections'],
        },
        'Circle tool': {
          on: {
            'change tool': 'Change Tool',
          },

          states: {
            'Awaiting origin': {
              on: {
                'Add circle origin': {
                  target: 'adding draft circle',
                  reenter: true,
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
          entry: 'listen for circle origin',
        },
      },

      initial: 'Init',

      on: {
        CancelSketch: '.SketchIdle',

        'Delete segment': {
          reenter: false,
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

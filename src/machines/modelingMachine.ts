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
          kclManager.programMemory
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
          kclManager.programMemory
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

        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeWZSZCRUxJa1flTCNTWLYIYS2CT2RSKdRyGhZawWc4tS6eDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd5CYHCSFqOQ1NSKWRiMRA0HqSTKblSX48+pKZGtNHEXEjEm3Eg4kkkfzcQLBUJTanRWlvBLbNlfFTWGG2Gi2TkpUGCTkLaypZQ-FRSOQZRQyCWo9oSbAQTBgAgAUTxpMCAGs-OQABZa15TBlJHKKb5qGTCTKc2zAsSg7JqdLO5YulIqRQ5D0eL0+v2B4Ny2Dh9hRqiKSI02JxvUJiEKO35RSs5Z1EEGIxp0zc6HCH5ybQc8tXKDe33+gOPEm9DAxnUdmZCMTZdLgqe7GhqEunUGCtI7UTaeYFLJiedopfVgBKYEJqEwxK37fpnaCPuSa-Pk8xOioCgyJewppLsKb7DIUh2NUz6VsuBAAGLYJgfpPPQ4zbgBu5JPuXxnssNDGGy8IFJeKjmOkORZDIpZIahzSSuh1ariwJL4a22r-tM-B7qokKKGRdrHPYw4lI49SLDQWgzoiNgaIoaH4K+-rICQ4Z-nSImzPukiOipvyiNy0EjggkmAhUqhWFRPzyKoWmLlW-oACLBCMap+hq4QES8RHGWJXxKPCcjGKxNoqJeaiKUaKYxYip7WCmHk6QQAAqYCPII7CoIIRAAILeYZuokUB4kKNobpnnYRqXjIjFaFm9Q8gxJbZV5BD4gAZoNQQBEw5K4KMIVtkZ8a1ZIND2PudhaDYU6goi4LSLI5jKcK-Zun1y4SJGPpgAAChNcAEGV-HYINJChP4UBKkwkb+CwTC9OSIwQFVO6iUkVkVE6WSQRY+TZJeLmQqkCgwrkaa2EdfoSLAkaoAA7pdZDXbdnAPU9L0kG9-hgF0TCcJA-3EYDQHaOky3WC6pbCHCcmIKWnIVBYSXAnaLqptl3gNlGxBkJQmAixG0bTUJs2dpyPyLJmdTQsCKTZrZ0Lc8KxyNLsCnC6LkYEL5eFgGq2IyjT4UIEoXwFC6MXmClbqggcEgOJBmau-kU7GzLBB3BgZMQBw-gQL0JLtGGMu2-G6XlL8SUOmYkHCqCKRyNIDFTgxZ7VMzgeNpGEjS6XACSGF6eGVs4ni-jEnd5AkJgCeK0lCz2ItU7ZJliIc3ZOxJotqaNHzRol1G5cm9X1a15bQTW43GMxwAXvcbcdyR-anExSPGmIjhWZemaLKp8wzkabpyNPZcV1G8-+kQ3CwOwSp4P4a-YJveJt5HbA78JZTUErGWmiQDpfEktoXsbIlBD2qPveqWRagFGZppTinptKPwfnPDCr9cDv0-rgJupJOCt0wIA4BFBQGEWEvGfsSwvZwlTNnDQLotYlAKNCRY+4Yo1FdtUJ8WCKw4JNrPGWz9iBvw-iQL+ZUABC3h-AAA0d6A37AxccuxWKsgcMKYQG0tDWAqAcHYHItBuhhPfSRVcCGyJIf4JRKiACaGjIFNUhPsNmSUzBmCSqCWSzIfgcnsCzA41hbG4OkYQ4h8jSFkCgH6DxiB0qmMNm1HkygEQ2W4T1CQGgj5An7ElKQ0T8HVjiXIr+fp8DsFlmAsKjCNAhNkKzZQpZlIJVsjkHkpgzQcMyDOJKFSpEOKITU0hTBSQzNwOHcg30SBynDjQygqS7KFgqI4fITVHw9O4XIX43xciQVSM6KyTQLhiMXLguxT8JnxK-j-P+QxcL6H8G3bAUBcAbKYUmVkogzRIRSrUeiZgvaZSNKkA42R+xjPsVUxxCSyEtzbpgD5Xyfl-JTHBXRtRuSgWQpeHkXwbCnCLICBG5TRELnuXg8ZSLJlONgLgEm-hipqJxQeJCbo7QODWNURKM5Cn7FsPuIEi1xAIoeUyp5pDWXss5e4uW4C7b9gPHvHanCOEHLScpSQSxqjiGUlRAoMrIyxORV-MAABHXoAC6lQAaTi45VgCi1FUCWSCl5jBpEcEhVSGrmZ31pS+O5MTHlTI+ss9F1BVXNM7ikCQMJzyWSUHUPVmzhSQjsPsXYx9CiYOuXSiNlSX7WtISScmqBiS3ErewKkCaGGdyyExDhpxjXHyMdrGKaQjm8z5uCH4FrpEfkEAVEIvQRgbIKPYQpdQ4Q-DMFzD2IqMGIgYiuqiVyUQ3PpfS6RIdLaQAjlHGO+A46l1nfCcoQK6hTiWMuootkUxJmLDUCw3VUgqFHRM5uAROWEmWdgEgAAjFJzaFYkURLw+qqYAmaBfSUViytU2pgOCmcQ7ow1ejLYy-0UYkmW2Kt+DZcVyhRSsNCJ0HbobzGkFYI5GRhSQXcrh8RMsJBlUxvIgILyt5UNWUMWh-g8CDVQAQCA3AwDelwF+cMEgYDsEEAJ-+mBBDidQLO2oXxSVMiLM6DaOwc71CnMCmw3qaUlvDRInjfHv6oA3oJ6hInKBidwBJggpISROYkONYYEmSRdCU34VTTnf6Cc0557TUHqqA0ylORYeilggozFwtJej0iqGUKnfY8KOO3Ls7xiOAHsCUNcyAjzXnpOTTkwp2TynBBlcodFiTOmMh8NyMzcwohDEbR4TzZYrFEunFsfZ0r5DysAOE1VrT3mSS+ZJP5n6QWQtNZa23NrsWmktpg6yAFRc0owjZFm40IqOqckksfPOv7CsHomwEFxajquSdq7JvADXQsqfA7AQQfBtsdckM6VOwJgQ+2Q2kjq0g2QaG5ElBQuRxslae8ol782fN+YC+wNb33BC-f+4DuLANEiZRiuOGE8JwR7J7dw1jXt+Y2AFrC5HDnnuuNe1JmT9XUCKaawT-QRPdvQYS6yMybJmaJf9vkIJ8JDU2BTk5Y0UT7t3Me84tHHOMeLax6tpz62wsC6F-QkXpPAUpp+PZJa1QGJBPTNIRa5pvVI9V8VhzSS-Sc-ezzvnhv8B+mN6FPbovyclk1h6lYGXSjqDveZ+YeizT7lZxHD3lttdLZW4F-XePU+B5mvFs3LppDGmPDAhQgINqOlzhkGPbof2hps3ht3EcnUNK99zz7vPGthdb5GPP8sC9pNZMndQHIub2CSrTtJ4JTEzhhUOJ0De92lubwEXvnPMfLex7jprvf+9qsTmLxYyhnS-BYsYDa9Ru61Cop8VaZxXdcfVzMkkcyFlLJWUAtzaeYtc7q5333FTF-N-crD-QQWbWhffRNfbAoFheoEsYwSSI5M7ARFNE1acI8HaZPMaWZXEd-ckT-NZH-LzTfTPHHbPJrYAvA0Agg8Ar-EBKA4PM3WAx8ZCE+JAswDaDIAUdAiVXsNqWxAAGTwBI1QG-GDkjGIw5TEPbmJwgW2GNDgh6yQIYjagr1smFBzlQztEdHgR2CEJEOkO-AkErlwA4BuggAgEGGWTGlQDwAEhN0HwQDii0ONDsDdChG0FBG7QqGPhSAOGhAcG5AMMmiMMwBMLMPYHFloVkOFycKWA5AqBqFKSNCfTalBFSAWER1EGZjTH0Mf1LgkGENCNI3CNwH1zbmIEwFYCXhNnI0RBzhy3vDtHkCBCzWMAWDYkhmyDMG9lsVMPML+TZkkFECZxchLDNEhzsk6SUi6V+Btydn6MiIIGbDiJJ05ldC9m6RLzhC0B9W1g9VME5CzASKHFsVymIzxFAyoWWXIGkIkKkNKPIyBC+COWo0KFFH3CzjtBTRTB+Euy0TUHOMuM4AAVuOkIiPMMIU4FwF6BPT4C-1jiYF80GhwjoSD1N22DQRTVOFTDalPDFG8NYgvkT2ODsCSju0b040KIuPwBlGuM+RJDuOKgkHKOC0qKIGqIGHrHjjkLtnkG5nBDNAdnEBhQyMUmNAUlJQ8PYypKKy416HmVQGsP4lwXxFwD-w+3ky72428FykEEVOk0EGAVVJNnVL+VTBAmdDhX+P2DPBzGPhTWPCdH3GQmvlsQ-FCFTzCIeLpLCPIwyFMTrwQ30SiizTKW+ConqGOB5CBCXy4mpJnk9JE2SVEOMMe1jiCDuHmXrRJEmhJCwjwCAXemrS9P93RPz3WIQH8XKFomsnxIyCzm0RgWUCZwyCnGs2X1sy42TO9NKO4xR1jgiygDwAsKsNLJTM92HLwA2TMCQkWByNqCNFyCyG8NLCSMWlYyPlPHjOwXlMKN7PLLCIkGwjMPRkgH8EPNTM1J91k1Gl6CYEEHIBwBlGNLOmNJNmNLABXkbVnLNQXOVwOANQ0CznnJsGsRLDtBOF3QTP3KTJCEnLTPCJIEsNjggCVEGgCAnNTxvIALvLCwfPAIwpU2wvLNnLzR5jPzMHtAv1skXXSEniUDD0DQ9IQr7JkIkBQvDkvXQpIEwv8FIuvNIO32z1GgNMfN4swsEEEsgzWPkOrMyFMWkil1ZAJQyMWkY05FyG0GhVGQKJniIBlBDCvM91KN9JgH9L5PjFTCLynHM1UHCTTCzVLAYzhlOG6UtKT30rLkMtrEvLYqPP7IzMvTuDzNJELLPPekoD8pkorIHyrPBE6zYMLCSgFin3tnyBTWQjWm0AVwcFsV8tlH8rLNTOPOCqgBVBjhHI1LKksNuCMrlFisqu+RnKss7Gp0imdA1V2COWhCJMNBSnEEUuEU7NgoPUKuMoCtKv7NPOLIvImrlBMv9G9zwrRj8EIufOwFfLYAwA-Jli-J-NgGsFnNkDzEyjNCQLWkUCzghWolUFUGFMWl3P3TuQWuKsQuPK4sjmIvqpiqmurBWu1MUzEsIskpU2itlGkv+rioP3auOAqBn0cDPByN0FskDIYvkA4W0B5D0rlPGoavevYuMK+rBt+qKtioWwzxEuCzWpU1BuIqfIaqhpKtkscKrLMyyJ2FAjtJYwyLdG+C0tyCQmAk5FsWfLADIECB+n9BvTZCYnCW5FGMBGcpNXSBqHOTPBr1ZGwPrXk3IWkKbhA3AwBo7yBu73Bu4AAyKhKmAxjmNrAEYMxNKD+JVnmEyCUDhydDt36SwwtCHCNRgr3IexR11oAwNtttAwg39GEr1xpqa2zKtuKmayNqjsdviLPDzHzURE1kiTBVsnUlM1EDjPUFWg4jxrVxDuzPlQEprTrSrqmUbVwrNokCNPrpIShp6GJCfIbR033mPlPCdEMS5tRvkjSmTEiVEB+Fgx1rbpRTUzeQxSbq+1bsrXC2c3UwxR0xMBrzOQYmNTqDPhqG+FaPBFkGdCWBnsrVRQoXRX0CXp1JXuZQSWaym0oU3rav21SEjMBWPCyFSFankBTW-TPtzGepXyf0rqvvntvs+RwB+XvsU0fvlTXsiw3sFyxV+Q-tF0dKsHsGhWXI7PogcjZj7DZnVjWEvqfq-k23eVge+Q1MBuXpKlnrwBfrRXeXxzgcwbkrtkyj7vbKihqFOTyU5jMFMVPDaIYkyD7jAe7MKPVxYYVTZSYANtUQQdkyQamWNOUetv+x032EZnJXEG7SQmFVMUMTNFBlsCY0oersVRUeVXUZbuYdXvsd0f0C3skHqFxXL2ETOxhmMa6tL2Rm8oHIc0UbJntUdVxGdVNkYYfpcaodwAnSiY01730dHlSNSERhdHtO1jqE6qND-pdC3VGqDorvCavqYFjVwiwCcc0fbuqaVFqdiLZvkql0hVBX2EBChm1lP0KThFqEXWzlSAKskL9NyhkLExGhWKwcSFOGOQ0EHrdsLSmMUr2ByE2a0vhDG1CaIHGYssme-GmdgBWJbDaf5MsgPn+NgRL2hkRFME2d+G2bHjGakKOaoXulOaoGsB4espiiTEamqEogDREbsjNA2ZFEUJPAvr2YOctg+ZOZWJkD+c7HMEcDVoOFyBdGUKj3WceahZed2fLokX2feama+ZWJUFRZIgw3IiolPDimYktG1iyBzjvBnDdANSQkDpetJfhf8ERcpaoDEBpcBjpcKQZbfVLF2BZfkjdDMl+HcpQhYlkaby4yIGwCZNMpkPMqQvI3pzTEWjPALUsbxbsBzipzMAyHgUyBwxJY1a1fFrKsHMvWnJqrqvICdanKqtarFcSB9gGoHEzR3Wurov5qkcsE2dYn2AKu9aQrCcmEvTfBQuwH6AiuLNuHjY2UgiPqVnEGWBUjBdggGcQLakTDUjje1YTdmvPKsM1erdmf9e2Cnu+AUHhlP3FTWdGK9nJRKWXWUCredf7K4rQp+q9cbfieBoIokoZonfFpzbhHfWvmETTGPgdLzFxMyj1g6kyiHZ1eJtQp4vHfjcpt1yzxppBtnb4vBuzbmcQBWnKBTERBXQQV+AyMynSE6UyglXtBEQdcKLJYmd1anfwvYA2pfLxDfN2p5NLgOobkbRkHIyhHzBFFxJ5ZsDPmUAJdsHvFYjcjeeA-EJjovZC3vMfM2u2vfNg6jHg5lFgCQ-vecJyHKByAaEhiQhsvomZl8OQjH1kBtcpK7PVcA4FY+bPa31jrI-Woo8g5Ux2odpo772XgQ4Y9WIufjBoFBBoHvn8HKP8EJn9F8ECgCAwAem+jGiug2WtCSnHDyKXKHBhA2mMAXLZEJWeeZiFnuzIGwC6GGFjk5QC0micZ8785GF0cM5zeTQ5FPFyzPH7FyGc8aLZgFJyFYhcmylC-88vUC6ugk7INxyy-C6Tsi6Y5lYXLY3j12TOSCVZCSL3v7EhlZky7MLC4C+VIKkRMvSU5C9a+GAdqTqU6i+ZBi7KXTFjLzpKGMHEfMELVJPmH-eE+0iK-a7JgRPfkzJNny+ppCyK4G5KiG7K89hy0iRdDqGUhdA9kYl2GOHM1aNjfuzKiYHGn0CHOGlGg+jy9A4kFQHe78BxkmjKnfncGs8cCTGhVQRhRtCHlKSTCRkWiRsseMGyie5e7e5GgxCC+jp10k9I5+7+-YAB7ACB-YBB6Y6dGS33Ed2ytUsSkSPh9YklWsZw2aHKIwHgCiFgo08AjhAWhTBqHyHhCxZHqEHMHIg0FqCUBxefZRjAG55qnosZYF-SmF6zmO6UALXurNSBPuy8hOjOiJ458rPkpEFPAZ1OFgSF4LcvHVhhyZH8KWEall7RgxmxiuiN-ipN52Fnw6jF9kFQU2FZZyEWA18GThHbZVwA6jHl7pi9tskEEZ-Hu0FSDajaiOT-T9Bj9J3-O9VaXJVzZt+JOdFBlUtSDTB16j7LnV2gaE3oNEy0yz7SV+FM3gIR27SsCjyQQWCyBStkFsD4Z1pocq3r5i0b9KBXQviOSWl6uyo2k5EaP4SLrJ1PB1ue1UVezH76SUqp2VqF7ybpyBF+N7mPiDSsFX81w34xPiInBBm6ZWAnwvHztolFTCTZnL+dB1u9Ib6v6rL6XKHup5AWB5AWTSvA5G5AOU2MPfRwDrXXzf9jevDAJI83dpLBoy6VHIOJBFCxlkIdoVNDrSoLzIaCyyYfu5jgGe8EBkkQpJThY4rRYyXBfsCclT7tJ-gQnMancmKJIVN+zGAZEXFvjcgHAfIT9pJCVhuhYIBce1ktzgplx2Bx5AYuwE34LduB4FeQHwLDYlBuo3wApnOQcCpgnQIRBNmyT86YAx++JV4oum9jChEYfNd9Aq1TAvEeBSxDgGP06T9pqcExHFm6Rt66wlWBwQEIbDqDAk6SVxMEkyWkLGD6gjsPeLlQMRR5VC2WM0IUCBBlBhQAQmAEEJuIhCWSsg4wdRmPwpgohWlbwuoEWBDNbBCRA0CkPpLBDmSqAVkhUSME-95Ks3TosCGhAUpOQU4MFnUDSCSlEqWQBEAxFsSGllSJpdgGqREiw0YMbUNIAU1ohswfY6VCCL8T4ECklmSEViizQ4ENC7YsIUzPdUfQFwZctkEsHmAcAsdzs-PRGOsI+pBVXWFVLMtwCsKhV8yY-Y+JkHSCPhsg4ffcEPAUB7BLEaXRqFTiuFE1wi5VZqtVReHKRyIbUK7DCAVyqDEAuwZkIWhxrgQC0FfCQQeiWrHla2kYC8ktUhHB9loLsWwCXSHhaBmQw2ewEzlKZqtEyZcbESOyPYVVSasVQkV41UBXwHATUIeF0PHBBFqRTGY0AVQJqMiZCLwhykpEBAaQUgdQbkHyHoGnCt0NgVQC+0W6sDSWoo6Gi6z4yxwnhpIF4Viy9g9QYUdgFyDmGdDfAY83SOEUNRFF+UxR6ZW4eCLwAvDsqEkEeOdX2CXdbISIo4oUB-Y5Ax89ooqo6PCK4j5qWojYRKMSKbogQliYwISg9hUQcSBQCkSU12IhjJqGwz6nVVJoQ0QwbIrYfGCvzIimcFoWwGtAyJWAmI6gDVOiwahi0-QktWANLU35HAEaQ1I0H2EzissHAZiCYkaCmEQRKGYdIDCnUz7FjOwiYSQByBnBT8l0qhb2mkAu7dZ3aRYWxtGmrSd1LYijRtJv10RewRB5gHaIrUvADomIPIdBLkXyKV9E2AQCJjXwxQHiNK2g5CFCOXQH0DiPHYwCWDMDgRlIkfTERUwjgRMaGz4qcTBkPFviTxWSUUAAy8ZOgTsRrDMEBI1EQNKmSTRzOvQXqYouGL4r4G+JdjchMoygeiG1ElbgwV0QzcEJuKcTgS8J9DAiUeMDTHgU4MPFcpCBtwXVrS4oUJgoyvr2NVGB4igXOPqgphJ6XhbWLUFHj5Bj4I8IIikDokoohJyqESbOOUDiTx4JdDaDui9iLpYQhwXwcpJtSpN-AveZiURLYmkTu2OwJ0jUDUIchwcJk6ZDUz9D1D4BicG7AuXn5ADMij-eSMWF+IxRBkdgfOMWmAn8tyWxzL5sYM44sgNgSzWbjD3K6UQR4haJhBiPQmAd42YRMfsuTSB5CQct4bFjENgLLBSk7MKEHYH3YJswR7rfKZBTVpv85ROAsFuAMhAe1C4PTHlrVJ1FJsKqKbcOP0EanKRpAYOXTIPFUAWjM6mNV2JjXhx9SZqRZOtv4Abbi1Gp-NSSIBNOD8h5RGhRSD-TdDLkuk4g7KQZVylMjuKLIk9tW3yn2ARuAvOfASWUEZElAaBf4JmkojKRCOhzcUZBPFbVBR4eiabiayvFnwDG6YU8BrFaKAhdO+nQzmP0ECbMEa-41UWpBTC1dIoBTF9saAl5lhvOfXGEhVVy64wx+lo8EKmDcJsIqZYLO0GZDyGZgCUTkFrr52y4kyOu63YmVemj4AzEgIqa+IrRT5PpHAb05kA+DYirBWhKPZ7hinR4fcseMfYqEwH1QQoJcc+VhMLWHB+hMKQgHZBUBSCSQKR3vddiADAyoB2AxULoGkkUpq1mYnqMeHrD0BVVIwcgpIBTzL5GzdMIoU8HoExg+gGknMREHoDxHfJXZD7VGrMH1mezvGHfRMLpLVkqiHZpwPWC4BcBAA */
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
                'Close sketch': 'Init',
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
              reenter: true,
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
              reenter: true,
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

        'Change Tool': {
          invoke: {
            src: 'setup-client-side-sketch-segments',
            id: 'setup-client-side-sketch-segments3',
            onDone: 'Change Tool ifs',
            onError: ['SketchIdle', 'Change Tool ifs'],
            input: ({ context: { sketchDetails, selectionRanges } }) => ({
              sketchDetails,
              selectionRanges,
            }),
          },

          entry: ['assign tool in context', 'reset selections'],
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

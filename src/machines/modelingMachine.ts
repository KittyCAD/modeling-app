import {
  PathToNode,
  ProgramMemory,
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
import { revolveSketch } from 'lang/modifyAst/addRevolve'
import {
  addOffsetPlane,
  deleteFromSelection,
  extrudeSketch,
  loftSketches,
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
import { addShell } from 'lang/modifyAst/addShell'
import { KclCommandValue } from 'lib/commandTypes'

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
  | 'circle3Points'
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
  | { type: 'Loft'; data?: ModelingCommandSchema['Loft'] }
  | { type: 'Shell'; data?: ModelingCommandSchema['Shell'] }
  | { type: 'Revolve'; data?: ModelingCommandSchema['Revolve'] }
  | { type: 'Fillet'; data?: ModelingCommandSchema['Fillet'] }
  | { type: 'Offset plane'; data: ModelingCommandSchema['Offset plane'] }
  | { type: 'Text-to-CAD'; data: ModelingCommandSchema['Text-to-CAD'] }
  | { type: 'Prompt-to-edit'; data: ModelingCommandSchema['Prompt-to-edit'] }
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
  | { type: 'circle3PointsFinished'; cleanup?: () => void }
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
    sketchPathToNode: [],
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
    'has made first point': ({ context }) => {
      if (!context.sketchDetails?.sketchPathToNode) return false
      const variableDeclaration = getNodeFromPath<VariableDeclarator>(
        kclManager.ast,
        context.sketchDetails.sketchPathToNode,
        'VariableDeclarator'
      )
      if (err(variableDeclaration)) return false
      if (variableDeclaration.node.type !== 'VariableDeclarator') return false
      const pipeExpression = variableDeclaration.node.init
      if (pipeExpression.type !== 'PipeExpression') return false
      const hasStartSketchOn = pipeExpression.body.some(
        (item) =>
          item.type === 'CallExpression' && item.callee.name === 'startSketchOn'
      )
      return hasStartSketchOn && pipeExpression.body.length > 1
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

    'next is rectangle': ({ context: { sketchDetails, currentTool } }) =>
      currentTool === 'rectangle' &&
      canRectangleOrCircleTool({ sketchDetails }),
    'next is center rectangle': ({ context: { sketchDetails, currentTool } }) =>
      currentTool === 'center rectangle' &&
      canRectangleOrCircleTool({ sketchDetails }),
    'next is circle': ({ context: { sketchDetails, currentTool } }) =>
      currentTool === 'circle' && canRectangleOrCircleTool({ sketchDetails }),
    'next is circle 3 point': ({ context: { sketchDetails, currentTool } }) =>
      currentTool === 'circle3Points' &&
      canRectangleOrCircleTool({ sketchDetails }),
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
        if (!sketchDetails?.sketchPathToNode || !sketchDetails) return {}
        return {
          sketchDetails: {
            ...sketchDetails,
            sketchPathToNode: sketchDetails.sketchPathToNode,
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
        const { selection, angle, axis } = event.data
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
          false,
          'variableName' in angle
            ? angle.variableIdentifierAst
            : angle.valueAst,
          axis
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
          engineCommandManager,
          // We make sure to send an empty program memory to denote we mean mock mode.
          programMemoryOverride: ProgramMemory.empty(),
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
      })().catch(reportRejection)
    },
    'tear down client sketch': () => {
      if (sceneEntitiesManager.activeSegments) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        sceneEntitiesManager.tearDownSketch({ removeAxis: false })
      }
    },
    'remove sketch grid': () => sceneEntitiesManager.removeSketchGrid(),
    'set up draft line': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager
        .setupDraftSegment(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'line'
        )
        .then(() => {
          return codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
        })
    },
    'set up draft arc': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager
        .setupDraftSegment(
          sketchDetails.sketchPathToNode,
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

    'listen for center rectangle origin': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      // setupNoPointsListener has the code for startProfileAt onClick
      sceneEntitiesManager.setupNoPointsListener({
        sketchDetails,
        afterClick: (args) => {
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
          if (!intersectionPoint?.twoD || !sketchDetails?.sketchPathToNode)
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
    'set up draft rectangle': ({ context: { sketchDetails }, event }) => {
      if (event.type !== 'Add rectangle origin') return
      if (!sketchDetails || !event.data) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager
        .setupDraftRectangle(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          event.data
        )
        .then(() => {
          return codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
        })
    },
    'set up draft center rectangle': ({
      context: { sketchDetails },
      event,
    }) => {
      if (event.type !== 'Add center rectangle origin') return
      if (!sketchDetails || !event.data) return
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager.setupDraftCenterRectangle(
        sketchDetails.sketchPathToNode,
        sketchDetails.zAxis,
        sketchDetails.yAxis,
        sketchDetails.origin,
        event.data
      )
    },
    'set up draft circle': ({ context: { sketchDetails }, event }) => {
      if (event.type !== 'Add circle origin') return
      if (!sketchDetails || !event.data) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager
        .setupDraftCircle(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          event.data
        )
        .then(() => {
          return codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
        })
    },
    entryDraftCircle3Point: ({ context: { sketchDetails }, event }) => {
      if (event.type !== 'change tool') return
      if (event.data?.tool !== 'circle3Points') return
      if (!sketchDetails) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager.entryDraftCircle3Point(
        sketchDetails.sketchPathToNode,
        new Vector3(...sketchDetails.zAxis),
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.origin)
      )
    },
    exitDraftCircle3Point: ({ event }) => {
      if (event.type !== 'circle3PointsFinished' && event.type !== 'Cancel')
        return
      if (!event.cleanup) return
      event.cleanup()
    },
    'set up draft line without teardown': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager
        .setupDraftSegment(
          sketchDetails.sketchPathToNode,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          'line',
          false
        )
        .then(() => {
          return codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
        })
    },
    'show default planes': () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      kclManager.showPlanes()
    },
    'setup noPoints onClick listener': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      sceneEntitiesManager.setupNoPointsListener({
        sketchDetails,
        afterClick: () => sceneInfra.modelingSend({ type: 'Add start point' }),
      })
    },
    'add axis n grid': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      if (localStorage.getItem('disableAxis')) return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager.createSketchAxis(
        sketchDetails.sketchPathToNode || [],
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
          sketchDetails.sketchPathToNode,
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
          sketchDetails.sketchPathToNode || [],
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
          sketchDetails?.sketchPathToNode || [],
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
          sketchDetails?.sketchPathToNode || [],
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
          sketchDetails?.sketchPathToNode || [],
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
          sketchDetails?.sketchPathToNode || [],
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
          sketchDetails?.sketchPathToNode || [],
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
          sketchDetails?.sketchPathToNode || [],
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
        return {} as
          | undefined
          | {
              sketchPathToNode: PathToNode
              zAxis: [number, number, number]
              yAxis: [number, number, number]
              origin: [number, number, number]
            }
      }
    ),
    'animate-to-sketch': fromPromise(
      async (_: { input: Pick<ModelingMachineContext, 'selectionRanges'> }) => {
        return {} as {
          sketchPathToNode: PathToNode
          zAxis: [number, number, number]
          yAxis: [number, number, number]
          origin: [number, number, number]
        }
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
        const { selection, thickness } = input

        // Insert the thickness variable if it exists
        if (
          'variableName' in thickness &&
          thickness.variableName &&
          thickness.insertIndex !== undefined
        ) {
          const newBody = [...ast.body]
          newBody.splice(
            thickness.insertIndex,
            0,
            thickness.variableDeclarationAst
          )
          ast.body = newBody
        }

        // Perform the shell op
        const shellResult = addShell({
          node: ast,
          selection,
          artifactGraph: engineCommandManager.artifactGraph,
          thickness:
            'variableName' in thickness
              ? thickness.variableIdentifierAst
              : thickness.valueAst,
        })
        if (err(shellResult)) {
          return err(shellResult)
        }

        const updateAstResult = await kclManager.updateAst(
          shellResult.modifiedAst,
          true,
          {
            focusPath: [shellResult.pathToNode],
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
    'submit-prompt-edit': fromPromise(
      async ({ input }: { input: ModelingCommandSchema['Prompt-to-edit'] }) => {
        console.log('doing thing', input)
      }
    ),
  },
  // end services
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeWZSZCRUxJa1flTCNTWLYIYS2CT2RSKdRyGhZawWc4tS6eDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd5CYHCSFqOQ1NSKWRiMRA0HqSTKblSX48+pKZGtNHEXEjEm3Eg4kkkfzcQLBUJTanRWlvKIlQQ86zSKwcmjCOS7FTLPSJGQpRQSTkHVkOLL7CWo9oSbAQTBgAgAUTxpMCAGs-OQABZa15TBlJHIO9QyYSZTm2YFiUHZNTpKQKfMKYQqRQ5D0eL0+v2B4Ny2Dh9hRqiKSI02JxhJCMp56xVRSs5Z1EEGIyp0zc6HFsRybQc8tXKDe33+gOPEm9DAxnUdmZCadGuTgqfwtQl06gwVpHaibTzApu+dopfVgBKYEJqEwxK37fpnaS04Or8+TzFaKgKDIF7CmkuxqDscFSHY1SPpWy4EAAMqgABmTz0OM25-rupT5o6WjWI40KZKIRQjgBPwSEyiHKDssjaCh+DPv63iRlgmA-nS0z8IgSxyKRwIUdCZpZKCBpwQxvZMWy9Q1FI7GLlW-oAGLYJgfq4a22q-oJszTl8p7LGa5r2DQBQXio5jpDkWQyKWdrIc0kqodWq4sCS+n4UZ8YGqokKKKZvbHPYw4lI49SLDQWgzoiNgaIoamcQQyAkOG-G6kRwWSD8Vqsr8ojcpBtFhYCFSqFYZo-PIqjpRpBAACLBCMap+hq4R4S8BHGXubLSJkWTGC5nIWBeahxSo1hwYeiI0MCcHNWhAAqYCPII7CoIIRAAIKtblO5CQBIUKNoig1PZMhzRed0LFomb1Dy9klmt1b4lhWFBAETDkrgox9W2AlBdOkg0PY052FoNjFqCiLgtIsjmAlwr9tdn3+gACiSqBdEw7A7XtkAcCdhFnSJYnkamknUTJxYOoxJZKaxqkeZ6HEaRIkY+mAOOA3ABAHX52BYSQoT+FASpMJG-gsEwvTkiMEAU4NSRlRUVpZOBFj5NkF71ZCqQKDCuSprY2MSLAkaoAA7oLZDC6LnAS1LMskHL-hgITnCQOr4PaOkMPWHIGS9nC0WIKWnIVBYM3ApHbJNBcFYcd4DZRsQZCUJgmcRtGIOGWD-4zeUxis-mYXV5slUFF84LOVYvy9rk6UF42kZtR1YBqtiMqB-+5sSPV+Zhwc94Vfq1SSEs+xQ7U4cFPmHdZ93dwYD7EAcP4EC9CS7RhoXQ9EZRZmmy54hUSooKskalsaFDShWuRa+FxIndRgAkmhWXhv3HEeJ-DEjFuQEgfFi6xkpokTI+x0g1GnLIfsuxpx2W5NIBwM1xDIIOBzNOC5P7ryIYXX+1Z-59yCAPYBdtD4AC97gQNPmdTIdhHR1FODDfIgIHpmFHuBI8qQYRHnfl3EhXcyH+iINwWA7AlR4H8LQ7ADC8QQL3tgWRudgYGWgRrTIBRTBP3MHrGoFpEaw3HKoHIsFfhQ1EVGcRP80LSNwLI+RuAQGkk4OAzA6jNEUG0QFUuZ8oaiRsfkMOdQrCIxcsyGyqZloGysvYyMjjIySOIDIuRJAFEHQAELeH8AADWYbA8QZlTy2G5MYcOihEYaFEj8fM4gxp2iyCktJGSXFuJyR4-JhSACapSY7lPSLeOCYVoQ7FBC5Fyiww4CLqByMQWNObp0XF-VJmyulZPcf4MgUA-TDIQJRZm5huTiRTNOGiJQcjqHSGVGy8xsjtLWYQzZnTnG7N6f4P0+B2BFx0QNeMklJBJ1OKyc0M47SI2MA6MO105oaABCoDp2yvmuOyQopgpIcW4B3uQZWJA5Q738ZQY5DTR48gsPYeQELb60XnqJAo6Yw6qGFGINF68dmYr2UolRQxdL6H2TgKAuBjmZDmSWX4YVtDoyzJVIUYzw7ZBVS6OQXLSEYp6Qo0B3iIGYGFRA7AYqJUWFErOBJkz8w1AvMYNIy1lDVDZPSjVbynwfPRdWbpWKPGwFwF7fwu1ilmqUNIREuRajXQyAoRGCVyiqv2LFcE+CUTrLSZ8713yFH+sDcGoZUDgXDwSg6Kw9grTyByCBRG-YFgtLqMtc01c3UEI9cQr1Ujs0eLAAAR16Gov5UAAVmuRlkSZUNVg2AZTFZeDEbAFBWWaSFqc03vPbdy7VvqFbEoNdQQtgVi0zVMLIO6g5wKwWmgcR00JTzLTtJYVF7qvSeo3Vm3lPySS+1QMSW4Xb2BUn3cElhDhRKOA5CkDktR5BQWGislYZhUYIU1RItCb5BBbRCL0EYErHrfATpyMKWRLJG0QqPRBuw7rXWqchpx1ZN59zJgEfeh98DHy7hK6E5RF7NJspaUsRsUwVBsCnO68hlArs8hnddWq306o8fbDg8sA04ggCAiBvRAn9QPWfUQ5QLbqBhIZjQ0cEBmAWFBxCtQx0TJo+ktCUYDl912p+Y5BQIQZkQuBH4ykLyckkFYciUMETZCsB0g69sckBH5Yw3xpKhgBP8HgLCqACAQG4GAb0uAPzhgkDAYm0XVGYEEEl1ArnnKjyhjCUJZgeTmORjsLz+R+yVzCxF3eBXBV+Pi5QRLuBksEFJPjEkEgAbDGSySLouW-CCA6xA4rfXSuAbylTcr5pOP9meakadwk5p6bmiKcwsTEKtci54sBai4taN6-1tLQNMvZYy3lwQersA+Pm8lsr8wKinjMKNSOYUYm9khLU2pXIZycqfVJj+4XTsvZ8V1q7JWBskiGyNlW43JtPbh3Nkrn2HQplsFoJQ11+yIyWBXc0vxVB2iBNOE7u9+nFOuyl27GW8APam8TEgAAjWAgg+DvcW0C7TK3hShRtX8A4r0ZnwgrnNSjFaJ0ttXW26HbWAiM6Kcz5HqPRvsAx5zwQPO+cC9x0t06iRERi6fqmOavZ4kKtuTNNIDQkFhRWW9enGuCn+AGdr1n93UA5ae8bwQ+hBeffKByQnUSrS5BmZJCrCULRlsBDCL3-hGd+6R4N1Aw29cG5D7zsPEfzcwOEglSQ9Q7DmgOOmKGMykamAyPUNkIHoUZ4OX6f36XA-B+m13sApfhdAct5X6QSC6j-CRboRl+xcxITmk3cEFpO-4G7znlHee0djbz5jgf6+h9m5H8tsfJF7fQRT+sR3wkLkVCqjNaycFH2tufcQg6TAAbCsHQC39768DsCpa97s5B4ZYHTeDrSCB3D-64CCA-6ApBKn4V6yAMRaClg6y1BKA36lCqqmBDi7axwoJhaf6Gq-K4hDryzQFyaAG5757o574SDgGQFUG+pwHkHDpl4axW4VzTjozzCIJ1KMqpACjFglg-C9icgyAZ44okh4oEpEokoaLdZ9xI4B4gH97EwyFyGvYKGCCXYBLD6IEW4V5zIe7iAihKCpjTzCQpCiQ2o1CODqBwRhzSG4q4jyHkiKFkoqELY67b4F4MFPZaHuE6GeF6FKFaKGFaaj4mFASEbchVoUTWHET9jSAuocjFgnAuGQ4bLELoR4BOaoCfgEAOb4CFEuacHxjVBhwMTGDgjP7LTzTCB3yjr5AJJ2CAg2CpqSa5Efz5FAxBpFGYASDfy4AcAEBlbiAsgAjjysgwq0TZBfCqAJTFjoz9hsQ5EZr9HlHDGjHjHNgn7GGlAOBfA1DJS15E62S0SyB7CnAgbLQQx2KbEfLbGDGfgSAAByqA-gOMqAABsAIsEAqmmifkCsfxeIrmJYDoix5sN0lozRCxZoo84mr0gIVmL+Kub+fRBRbxwxXxPx4J-6OcASkChx5eJyqYYSaBpYbepwZiCxbCmg0IsgAWcIyuPRGaexgBxyCgkMu2d0tgZoywghMUYcYKtOKy9MLeHSXJExLYRh5J+QCw9kh4OwkcVoD0d0iw48GQ4mdeHS60jmeI2AaixK5AgxJRkYjmuJxyApokh49Qy0bo6wyRSU8ULk4cCUBQGQHSvQ+K3xIJ7Amy+IuAQBd26hYBEBggfpaWgggZwZ4qlRw8KYQEhY5ETS8+22CAFoDojhCGSC4Ep4HSb4oQg+uJlp1pzmpJCpXBTWze3I4OVkUGRsVgjoqgwIIE80nI7JXMvRYiJZ8WhyOxjB6uR8QQ0BqmdwJIQMJIBA2kYxts-gn6pZh+tpMIXGbIwolOkKIpiAUuKMrCpwwoH0zxxCA5ZZVZI5kWR8eeJqeAgJqmy5g53et5UAeAa51QbZKYrIixHINyiA1OFQvYKarIM+3RvZGa55h+uJEg85GiPEqmUFQ5ExSZZ8c00JjgqQ+YVOhstElK56Zojg8wx5EOr+UOYiRAMoIYSF3eVZFZZRNpqFtEgg10XwKQQIxghQQoCJiQ3mDEM0Vuyx1Q9kHSlFtY-gNFw5MOkwrGU5M5c5eA8FtwVFcoT5g+tpUILI5Eooy8xGiqMIDyiIqpDgxYSwolKlElIQz5Ulo5rGr595B0QJyl4lal0F9liZZJGsKUc8s8sSxm4cdkxghlrSJlc04F6aHyYlsollK5Q5MFcFtskA-gUV1FVlg+KFnlVRTMQFWgqwh2OQF4bJmCY6FGkSEmEFHy5AfoZAgQKs-oHGKBjgK8yyQILks+MU7upgCUE6qMKk5VEVxCLiL2rGwaymSVhI6m-oahWWoBEgJAsiPq7iHxCokAAAapNWVmwjUmUCWHUOYCZvDKWtoLkA1I-tYKJdwMNVAIMf4GNaphNZgBpn4XQbvhNnNQtV2stSputY9ZpqDEgccfAhOnbtYqmNyDMvtZCPNDSjTumBniwXsp+j0D+gjb0kSdNRzrGajXgIIEjd+kPtjRCUxWPnNAxLsE1eIaePxpVLYYsFZBkM4fZBsWRX2Q4tJQEITYoreQKgavoGGWzjNTlljV2jNtzTFoamVnCI6BbAcM-GRA9PZPFKIMnjkD+fDV2mdvqkKvzX3hlsLTAc9l4q9rzZLXYcVPMOajsNMpVPZMzITjCAsmYP1WumrqdpzbNkKiKiaqGRjbNfrXJqLfQuLeHsaqasTRXmOAiDkOCA4bCBeBON8ICIaPPveOdaea7bvJzdjp7aHT7cAYLXrXtITYbedkKkbqKh5TWVUTSsiQlKeJUDev+RSdVCkL8JPAOLUKRZieRWzern-nJoEAGkwDdUUjrRGRIP7awbmkwCTPzmVkCI6MCO9DCBElmUZaJOCHYHCKkKyKsizRmuzf3VutPTdQMmPQXRPUXSLdPbPfoJLZDEsKIDCHaKeDWqkOGuhRaDYHSl3RyR8ofZzb2v2r4vAefZjVfQbUA3NvAfPcqS-E1qcCmPZIVXFEOOVG9ECOBOrTAdukqLpFgGA37RAwHUwDuvg9WdEQDevd8C3CTtHmgpVHKgghMrYEsr2KJVaQxetEMRlVXf+Kw0aB0WmHTBHL5jkIsHBPsM8guu5PvZFZwzAP4Nw8UQcXw0RL2IJsmtkEgneGI3PJI3KtkDkLI93azakkQAo33Mo5gBMdYJlfw80s3ohL8CpORHXB1eI-NPBNI4mOFS7RRZY0ozw1QDIPY0RBCrmJOKIOCK9GyHoxI941HS4xw9adYxMSoGE1TPwZCA1GaHCM6CmL5vkCHGsAzUgk1OnQE6k8E2IJk5btk3dLkHk06XBAiaKQ5PeOaFYP2POs7arhRdgCSFVTsfRYo1WccnxcioJftXdFmSxWGuxbUJvRaPUH01iQM0M7RUMVeTJdde5Q+bcIM8MyqIfG+ZXZQ0cXkFXistTu9FoNJIyokqRItMCC3hBKJUc1s+8ezUfC+CQDvP0ApQuZQZ839SXADfYHJE5DYNdDkPSbchGvxU0VTg4FRh85s8OQlQhclaC7wxc+SdHczMoMiuBJIWaIVVkMVS3lDGVSkrdd8e7FxOqExmABLMrP9ELMcixUetUtdLUEnembCsyJHDsNyDKmHCmOlGQNgF0MMEfMGqNkDIQzltK7KyMLPYyxMykAxJkH+RoCWI-rCvafTaWLkDfFK2MWq-K98Yq-6LQTvvrgwaq8MEPrtIIJq+HScp48WOHPwfkKeIeDMqyEJvZG4wbKWGsxxM65wCNd8VtEoWOevMqxltG663tPWCfJ61aMyKaM7mmDyBxaCJxfwtfIiMY-ML-RBR-l-jeT9H9ArELMmxINhL9H4E7EDAdLIu4BKhgksJI-sN-W9GveIaPDODOPWqoGlJsdW4arW62xy87M9Q6wbi239O22AJ2+wN2565OFDfsKoDyHAhBIjLBIYqoGyK05TulDO-oEfJgNhIAb7TlvezhJu9u3U12OHAxAWGqRG1UnGnUJguJpgzOBoJG4uDe3ew+0uwEW9S++wG++gFy2yt+8sL+xFD8DWhCNE0VCqRoLUNeyQbe6xolbpE26R5gIh2rJ64IBFBVt6Qihh9geRCgVCUZoWWB4RzWyRzxGR-a7B5NhR1R8h6OjZGHIx5vcx7YEaNpf63h5x9O0R0fHjATETLPYxuR70Nzl0BwIIEwPjH7OhjvP5PixrCxdkI6PVPNEjA6TCDEg4KPBGmBhxwR4p9x9dSp4Z26xp-x-QW9bAFpzp5oQZ2p4xly06pZ6ZcCHk3UHZ4yvBOGrYu9KB6580LgJcPAFED0Wo2dIIHCJDHBK4yeDgjJDmIsLCHaLSm49jDl7MHUKJHekV06fUKCGgY6Nm4s+oNfNbHzBgOu5l-9UcSIMtKPIV9oEtFLu1THDemkYxECEsHy9bLbA7P17V0IGqXmPq8-PYKB0bJ41gTZOquPCkmtwgKsPxbYvmDM8g8xbCPJKkKkDZLdMirZpIqd9CBkBPnNMtNFzgm0zHNUMyMWC5NUkxJkH4-073adh7QjgliVu95UPxZ6c-twu4ztlqYhEY4BEvCkBntnbDz1vD6ZyCg2ukI4KoKzHqU3QUMCKYBIWaCsrTsdpU1Dwzj7lrkT4N+SZhaWipPPiVDOP96UHMWTdXFRMWFEhnlnszgj5HRjJvTUE2k3VfPaQsm0eoID2vnFZz+C0cZheUJyFCodmjFN6UAnTYEggz-wVO3I+-kR2Qf8pQX+gj3FFZk0UVM48kZHLmF49HjmJ8D2QNRnf9G4fiqEcSgTz4clgj+I1bccIcKG4jNwvMsoIhEjMlB0q8VWe99XEJqi1YR0eaEW3HJg5xXCi9yz6kln9s1ye95Bnn5OIindEXwsVqfar2JgT9iJZXxINX+8elxNhAqdwUEFROhsC3hbUL4BUyZIaya8rb9iQMZefib8f8cPyytICpAoJuS3q1xYHmLSvkG0tRj37X8T-+CBPFNpYCDvxeA3EBc3GqW3FIT34aWUcaaaUM4Mad7M4VPV5oBkU5BFthobmFMs4RciucF+YiGMgGSGB+QEy73JpKNxZQr4SccXEoGKFqL3orMDNFyMWTSrQVs+5-dRhBAkY08b+VoKqEWxG7Jg8EdJGGPgNipfNhiPzEjiEG4CTk88M5YfsgjIHzQKBWBLMs40Tq2BXIFtG9IwOsowVWBezU5ngB4GtlxAsXMTg4SbqAVBEfbKxLeEkEXltmWLJKpJR4EYJ74thNktUAbx4UHI+2VirsA0Zzge+KVOUJJVxLD9tAoGSvBFEIrXRNSD8LsrwXmgHsX+UAhxI4JipSDLyMg39NOVJA-8oYAoDwcvimTx0DKi0EKo4TMoOCLKzgiIbZVkF3lBIuieMLSniHChPBdMZIo4R95mBo81kVPuZXErZC9BilRKqplCGGDiBZ0YoZZ1KGJDvBlUUgee3ZTzRq4QQ0xhmmGY1VYAdVd7k1VG73xt+hYKaJVCog0MqkDge8KBQupZYjasbW6itXuqTUY+kgHYBkGWBLxDuyvOjhykLBgcbIgffxqzw5oa08aKNP9AN117c9LY3wJpmYDsDrZsCfmQqHBEwKcYVg2DAeh7UNQI9Sw3w6GLdE4wmZWKgjC3vCCBCsUbeYw-+n3SzpG0fEUIjobAi+G5NfhE0e6DbQcixJkwsIP4eCK3SQijUFdaEYIyaay04MAVRVDUBqjQxroS6MKLSL2TZ1SCudJkbCKdLXxCwQvRwDsFG7KAdYFoJ4sENSQAMNaJ9YNEUiOGQheCcQ+GGqQA6SBhQleYEcsQh7rNHhR9PZKqO+IDINRJw+EHHxbgmZyIUtVGA8STRNF+RPyKBiA3YKRgRRuTVkd2SbrMRcwzhJYKEj-LzQPR2KMhn6EwAx8liroRCFDCPL5hpo79TuuZBuJwwUmXDIYsPxVK1FOKDRFaJKL8wJMpGSTExn-UGqgsXBBI4SCqm+Apg2Q4OJ1MYDTFcYzA+TfDkIlGHViP4RAWsTkOvJ2U5BBQotOo3yCFRmx8gGaG2KF6Ihg43ZeogiiQR9iKqNYjFtINyESV-m2AfoDwPEY14Wxc4kLAuOqIVBQIQ4OEFMkrZB8NmxzS8voNaGgtDx04+mqeOAoxJzQX5KEApEyJ0t0u-gRlqd1o6-AKge1K7lPDghBs2KHCCNG42Mx3jCE0ba1g22dincSIMdcEM-VSAE4vegHWgRmE7q1QLWMrOVrsPjayJE2hcU7jODGTeZ7UXRXakW21b3hXIqwKZFx1nZ2U62GIW1qBIzDGg8JGRXYItGp5J144PIbfr71kDcTiO11eDqBPq6jcIUSpZrqb28YT5W8oHUQJEnkljleOcY+sZrGnCqSmuk3GZAoAWDu4GsqYGaKFjc48SPOIXYmN52M7KSzJjXcbsVxa60RFeSYBDC5FsCQsOYLgIAA */
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
          actions: ['AST extrude'],
          reenter: false,
        },

        Revolve: {
          target: 'idle',
          actions: ['AST revolve'],
          reenter: false,
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
          target: 'idle',
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

        'Prompt-to-edit': 'Applying Prompt-to-edit',
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
              always: [
                {
                  target: 'normal',
                  guard: 'has made first point',
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

        'Center Rectangle tool': {
          entry: ['listen for center rectangle origin'],

          states: {
            'Awaiting corner': {
              on: {
                'Finish center rectangle': 'Finished Center Rectangle',
              },
            },

            'Awaiting origin': {
              on: {
                'Add center rectangle origin': {
                  target: 'Awaiting corner',
                  // TODO
                  actions: 'set up draft center rectangle',
                },
              },
            },

            'Finished Center Rectangle': {
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
            {
              target: 'circle3PointToolSelect',
              guard: 'next is circle 3 point',
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
                  target: 'Awaiting Radius',
                  actions: 'set up draft circle',
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
          },

          initial: 'Awaiting origin',
          entry: 'listen for circle origin',
        },
        circle3PointToolSelect: {
          on: {
            'change tool': 'Change Tool',
          },

          states: {
            circle3PointsAwaiting: {
              on: {
                circle3PointsFinished: {
                  target: '#Modeling.Sketch.SketchIdle',
                },
              },
            },
          },

          initial: 'circle3PointsAwaiting',
          entry: 'entryDraftCircle3Point',
          exit: 'exitDraftCircle3Point',
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
export function pipeHasCircle({
  sketchDetails,
}: {
  sketchDetails: SketchDetails | null
}): boolean {
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
    sketchDetails?.sketchPathToNode || [],
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
    sketchDetails?.sketchPathToNode || [],
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

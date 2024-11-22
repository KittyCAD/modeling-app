import {
  PathToNode,
  VariableDeclaration,
  VariableDeclarator,
  parse,
  recast,
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
import {
  addOffsetPlane,
  deleteFromSelection,
  extrudeSketch,
  revolveSketch,
} from 'lang/modifyAst'
import { applyFilletToSelection } from 'lang/modifyAst/addFillet'
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
  | { type: 'Constrain length' }
  | { type: 'Constrain equal length' }
  | { type: 'Constrain parallel' }
  | { type: 'Constrain remove constraints'; data?: PathToNode }
  | { type: 'Re-execute' }
  | { type: 'Export'; data: ModelingCommandSchema['Export'] }
  | { type: 'Make'; data: ModelingCommandSchema['Make'] }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
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
    'has valid sweep selection': () => false,
    'has valid fillet selection': () => false,
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

    'next is rectangle': ({ context: { sketchDetails, currentTool } }) =>
      currentTool === 'rectangle' &&
      canRectangleOrCircleTool({ sketchDetails }),
    'next is center rectangle': ({ context: { sketchDetails, currentTool } }) =>
      currentTool === 'center rectangle' &&
      canRectangleOrCircleTool({ sketchDetails }),
    'next is circle': ({ context: { sketchDetails, currentTool } }) =>
      currentTool === 'circle' && canRectangleOrCircleTool({ sketchDetails }),
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

      // Apply fillet to selection
      const applyFilletToSelectionResult = applyFilletToSelection(
        ast,
        selection,
        radius
      )
      if (err(applyFilletToSelectionResult)) return applyFilletToSelectionResult

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)
    },
    'AST offset plane': ({ event }) => {
      if (event.type !== 'Offset plane') return
      if (!event.data) return
      ;(async () => {
        // Extract inputs
        const ast = kclManager.ast
        const { plane: selection, distance } = event.data

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

        console.log('offsetPlaneResult', offsetPlaneResult)

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

        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchPathToNode || [],
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
  },
  // end services
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeWZSZCRUxJa1flTCNTWLYIYS2CT2RSKdRyGhZawWc4tS6eDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd5CYHCSFqOQ1NSKWRiMRA0HqSTKblSX48+pKZGtNHEXEjEm3Eg4kkkfzcQLBUJTanRWlvKIlQQ86zSKwcmjCOS7FTLPSJGQpRQSTkHVkOLL7CWo9oSbAQTBgAgAUTxpMCAGs-OQABZa15TBlJHIO9QyYSZTm2YFiUHZNTpKQKfMKYQqRQ5D0eL0+v2B4Ny2Dh9hRqiKSI02JxhJCMp56xVRSs5Z1EEGIyp0zc6HFsRybQc8tXKDe33+gOPEm9DAxnUdmZCadGuTgqfwtQl06gwVpHaibTzApu+dopfVgBKYEJqEwxK37fpnaS04Or8+TzFaKgKDIF7CmkuxqDscFSHY1SPpWy4EAAYtgmB+k89DjNuf67gBbISKeyxmua9g0AUF4qOY6Q5FkMilnayHNJKqHVquLAkrhrbar+0z8HuqiQoo042OCNT2MOJSOPUiw0FoM6IjYGiKCh+DPv6yAkOGP50kJszTpIPxWqyvyiNykEjgg4mAhUqhWGaPzyKommLlW-oACLBCMap+hq4R4S8BFGSJXxKPCh5WNCoEXmoCkqNYcGHoiNDAnBHnaQQAAqYCPII7CoIIRAAILeQZupEQaokKNoig1HRMjJReLULFomb1DydEltlXkSJGPpgAACuSuBwAQZW8dgABmJChP4UBKkwkb+CwTC9OSIwQFVO7CUkVkVFaWTgRY+TZBeLmQqkCgwrkqa2P1y4SLAkaoAA7mNZCTdNnDzYty0kKt-hgF0TCcJAe2EQdBraOk07JXIGS9nCsmIKWnIVBYiXAqjbJNBcFZad4DZRsQZCUJgpMRtGIVtoZ8aJeUxglgoGT1Bkmy2aW1QVIiBM7AUdQyNlNONpGBC+ThYBqtiMrQ+FCBKF8BTI4e5jJRyNklAcEgOOBGaa-kxZi2Tkt3BgoMQBw-gQL0JLtGGtOK-G0KNaRt3MeImTFqCrJGo9Gg0HaML5Bp7GeiT5sSOLUYAJJobp4ZyzieL+MSM3kCQmCu-+mT7OkNTTrI-a7NOtHctIDiJeIpcHFIZu07H5uJ9Wyey0E8vp+9jsAF73DnedEZkdiOiLOyqPkgJtWY+vgUeqQwkeTcSy3tNt-6RDcLA7BKng-i99gA94jndvYLvlOjPTAmM-n1FGvsBya3CNQWqCth2uOqg5LBvwh6vKM68Jab2IDvPeJAD6Z04NnTA59L4UGvvxWMMNEiZHkKYDK9Q1Z1CsB-ZizJqKpgyhdSigDIzAITmhbeuBd771wP4MqAAhbw-gAAaw8DoFy+BoZKPweTmgyB-DQchvic3EFkKw8w5DkMoZGUBNC6GQIYcw1hABNThaDxBfBnMsOC4loQ7FBMxZiixrCqBivsAxotI7E0XHHChDiFHgPof4MgUA-SaIxu7Ui5huTAkanUZGH8zC5kPBIpYCIsiyKcdQlxyj-B+nwOwOmyCwpuwLqRAopxWSCIQh-YwDpzGNS1olWwKgYmtzibQiBB8mCknqbgG25AtokDlDbBBlAvEIBEfrHkFh7DyBySoD+wpREFHTOYqe3JKkb2qUog+R8T5DGwvoNxOAoC4G6egpM4lrDiW0EpYUF4hTpFZMjKZM44QyNsQuORcjnE1NcdA7AsDMBrJztgTZ2yLCiNnMQgx+YagXmMGkDKyhqhsmGTcomdyHEPPmbUhhsBcDA38MVdhPylDSERLkWojUMgKA-kpco2QLQclwUsWZIDEWuJRWijFGib4oKVpkbFVh7BWnkDkECH9+wLAkXUDK5p8zKGpVQ6siikWgwAI69DPkkqAKSfngn1hzdBqwbAjJ5hc0iNgChiF9rkwmKI7H3NiZK+JdS2k5z9LnZl6T76JVMLIFqg5wKwQSnrd2p4Mp2ksBU25T54UWq3lahhJIwaoGJLccN7AqQOsEm7BwojHAchSByWo8goIkUNSsMwshkyNyDV6ENVTXxgEEAVEIvQRjbPat8HGnJxJZAoldRC+ti67Bao1bkJqOLR2bqGggltZaQFtvbR2+BnYS22dCcoIdtBwmopaUsV0UwVBsILOwhL+1R3sTHYdNDoHotQBnNp2ASAACNPGJrviPTGZixnOiCTkYxGZSKlgyOoeYMk91mrLXM6sUZ3Gy2Kp+bpBQIQZkQuBfhsgLyckkFYfZIcETZCsLIsqH1IEBCWYPOBHShiIP8HgWaqACAQG4GAb0uAPzhgkDAdggh8On0wIIMjqBINMX1iHGEIcLQ-GEB-QERodhwfDrUU2JbB1r2w7hw+qB+4EfgcRygpHcDkYIKSEkSmJBMG2uRkkXRGN+BY0p4+BGOOaa43e6qB0BZfHNPO-s0jUjapKLYCEZgcg5HMAQxCWGcO2xebA1TV8NNaaoxNWj9GaNMcEKFnO1nyPcfmBUU8ZhMhEI5vg3skJkbKAyFyGcYggsKaS4Ri+anZace0ySXTJJ9OGaUyZhLlWUu2bSUm-8iJsUplsFoJQjV+wfyWCzc0vxVB2iBNOcrttVHsMixR6LNG8BxdM8x69sBBB8E62lyQzEgV-AON1Yx8IWbJR7VykO4F5sBEW2w5b9XGvNeGEZtrZntu7f23Z-aiQ+uSGDqmZKvYiFZlsilBSDQS7iUNT1e7jCWH+DUc91bsXUAMYS99-Qv3uv3ocySz9g3cFWlyMY6EAr4T5h5KcQEMJEeLdR3VnTemDPvda5twQOO8f4R60RQHLq7DmgOOmEO76zSmA5kClNM4bGwuDTHeTtt3F+jR9RjHWOvv4D9Lz0K-PCfCmkCXOo-wta6Eh0-b4WreyInBBaRHqvas2Ze2zlrxmudO71wzezAOlLjNENBC0Vg4QQ88-4io9lEpUTgoGhXpalfBYCIqlJ6uYvrcx-FszKfIze9vr7xAfWeFaFLCdWoSgw+F7JaYIcfDMZl0Rzn57rOmvs-YB9rnOe88svjH1lm04jm-sSooApRvHB0Xur2Tk8vTVwsTwp+pJJGnNNae06rEW6vo4z1r5ji-l+vNX4IIjV9u+OoF3x0wLbuQ8scI1UZ5ppBQopeoOC5jEd79xCv8ka-OnO60y3t7dvTnBLD-JpA-b-I-dfRBU-A3P3UxeHcQEUJQVMHWQvJQXMIFGocfE4N-GTA9ZuAAGTwDA1QE-BHUjFA1PQgz+1QULy3U9mMBSnakymE1slqCNCUinwGUBBsGLXj1kyASIImioMwAkHjlwA4AIG43EBZABHzBSjZAtxKGyB0XMBSDUPQO0FkSEJIM-DEIkPYCkJbD5wJz9w9hqFUhFyGxolslkD2FOBTSwQtAATwPuR0JEIkAADkz0RpUA8B40poIAIBBg2kAgWB-DIMSwHQVD7ompLRWDlDJcU1TczAgRRA49Z9FdCDiCPDvD-BfD-DYAKZEF7V8cC87JUxRF6gOQv1Bl5BK8EBptSIGpp8UNrlZFxDJDukFBJALBP4+EzRlgR8eZzEgdZtDVKdnMytXD4VOjDDmwyj-tEB8gFg6JDwhZzQrQ2oWpFh5CMhlAgQHBZFcpQM8RL04E2lyBT1yDKDwNSiTDyiWpzF0hTcMo3R1hUDGjgRFJmJkZODilZFegmkz1L5eIHF8RcBKMNdt8aMypvBcpBAgSqNBBQT2BwStkaDWUUwgJCx9kfhhReFsxDVx4zIxlEIZwMiB18C143xQgncRCbj8BdD7j9dTC0D9kpduRStKIs0rorBHRVBgQQIUpOQYVMiE9m5aTiMPFmSJBldOBp0gg7gmlY0SQJoSQMI8AL41pI06SdckEHiliEBmI6I1U7QeRyVDxhjdYZChiBlzS+oZiY4pT6S7i5Sk8nYLMoA8BAjgjdTpS1cvS8BulmI+ZlAUxzljhlBswx5F4lhWRzc+DxSBCKEXT9SPDMIJC3pIB-A0yZSpDMS3ZkpojHBUgacpl0YelWRvhnDUxUglIzBpj+DqSgEiAZQQw8y1c7jGSYARDOF9RGpIpjApNCghRWDEh+Fmj-58xzBqg6JZE2zaxcyQgAzZT5SnY7g1TSRNSsy1pKAlz-Snd+zthmoGIp5ex1BqhxzC9jBdiUxBkMg-UHcnTm5FzZRly9SZSPD1zp0gzISyogjbh2y5RDz0y-zIMTBoRdhxBkxx8zRjFi4zyrQLzgQUwFzgKPzVyMytTszgi3yOyVyncCzFjaDjTkpIR7BiteF+MEjthy4KhBx6iM1f1ZFyA-QyBAhtp-Q51ZBx4CgS8eR9ElDvEq5dhf0uU7BtB-059m55TY06NSQAgMVCQL1r1qwt86NM8udlToEioSoVLHY1LK1ONuNYzzQygSw6hZz30xwgRhQWo8VchrBEcdLFLT1z1DKb1-QAC28O8EtXLeI9LEtVKvKYC2TSgNhO06IoM+04djFZzIQUp7T7R8gXLw1-BI0egY1lSFk8QiiNKNtkScqkVBBMro1K1ir6E+JDTSLERyLa5HBbBfhTw10eYUgA82QuYtUf00qnkElWMVl3koT09NKGMirw1zNlM2N3luM4RHQHoDgQ49FKySlyg7dqdsh9hkZercqM5FLXlbV9Bhq1tRqaNxq+q8BEt9q3l9BZrRFEIhsLs2RcgGiYQSwskrQYRzEzJpKsi5Mk95LdqBrDr1kvlISCqtLzrcrJrLNprcdPlvlCzeszQHQEQcgpIORYQTliS6JKUn57xnKXz-qFNKqElKt3lQbNljrNczqSpSbLryb4aNkMSSKlY6qvhXQtAeDUx+wigeZixmQUhmrqIBxagmzkyWyKE5L6bkVUUmB3K2FqaYSJAoaSr6UmAgq+BuMgRHRgReow4yhiVkZ+Yd1BjWRGodrpV1b3K1ElbTqVa6aJr1agrbqkbz8LR9YlhRAYQ7RTw+VUgcViyLQbAhlxaqT7lpb0qwA5UFVcQlVJYIaxrHaLrcAq0Y72Mc9tbVilBkLByUw6ILwLQ0ghxrIeogQ7siagFI6U71obVsIsA7bCrk7oamA667U7rvgrBDVmIOQcg+a5JDki59FbA6gmQFyKCmT-BcpSDMBiKaq2bRNrcSwHAeaUZEMchFg4J9hpEDU2Jmz7kiAJ7ezp6yCFj57e9Khx4LS+7yIVrSxJAmDt60bfgZ9w74VD7KCT7Z6qBrBWbe98w9gFAfhjhJN16H6t7DlshEwky36Y4P7J6v6pCZA-7-wclcxJxRBwRuo2QwHN74Id7fNX790D6j7ZZEGqAVAUGBdf1IRXIzQ4RnQUxEN8gEY1guYS53JK6KF4Hj6Z6pCxAqGHMaGHL7BzQ3i4JaK7JbAFh7xzRYpX9ewFzsASQ2LmSezmTulJyNBpzVBqIWoPMhBm1jQ0jwQPV6hfqJS14iBlHVHvyPTfzHZvT-zALyAbHAzHHgy3bbIhlojvqTZLymGHNIKW0YL9FiwzQlGVGuyZ73TcMnYXwSAbZ+gdztTbg3GDTWTyjUZpBe1XVdG5yDHjTZBcwnKlB1D1YGcuGJBrGonZTMztScyanVG57MmjSchcwrIiEmroRLpvHRdvg4JWQdhhR4cw7iGHF-BcAz0AZ-RfBAoAgMB5otowjxoMmfcjTBAy5xwUDahARfgYQClmRUYdhuR9nzE0LXCyBsAuhhgnYMV2cJpG6tKrmbmRggqZnNGUhP1wUZwWro8ClRFDxOr77vZpN96Xnbnp17nVnXdW93cTMIW3nipBAPmvG0EN6LzkZf18hTxDxjFqyrBorXNilFHLmJDXm7mz0CpqsnZ6xaYnmGNEXK1kW6XZ00XEArRmRTREoopxJhzJHGD54fZERfN5gxmzUvICB8RZpZoggVmfpulapej7BEZfbJJCm7cjRlh2ojlDVtYXBmgpmMB4AogqTz7-xBBQ99Y4IagVi3j6hQQRBMhjQZsTm4RHAYHiGvJzWaoglrWck7XTthLlYORvh7ofhRd87no-RBphpvoJoTX1nSKRAMp-XbX0og3EN+xH8mQM0lhGo1Bo2aM3pPp424AfXYYhY8xeElrKKNAroMWK8Rbrl5DyEK3ZhahHWX7HJWYQ4QdgHxV5Flx23vEMhjdkoMpgR4RzGLwrzjpmI+1EJKdPWAN59bZgaqtf9lsR2KiN0REGG3UMwRMdjySDUuYRULGUzYmQtrqz5j8SNOMd35IFgMhNi2YDjWQxtvjLJfZDVZtAsqm5LHtt3WnSLSyHQTQCSRFpxO3IchnSJOZJiBaeRGdkdmcbMn3Cl9ZhRGrJKRV+7thMhAW-GUKrzHd0zH3QPWVWZHR2rdGdXg3f4HQbAS4zR6g+NG847U9KOk3qOFJagRapwwJydIcRc8He6cxPgxTYHZKAbQCv82lwsH2MOqO3YsHIQnKahDhorRloN9kgHNWXD974V3C7in3RVN0HBb8WoWpzRQRUw0g7CHKC3UgahtCci3S5in3M1LPJwSlbOCPGidjQVexy9Mt5yqnTOYmpnjMc4d3hZCF2otrxJ5h4LbImjNA4p7zzFolIuPOYm8iCi8r4uJlpBbX2Y7RctbCLA8xBl8g7REDL3Jb9COAd2QJFJ9lUjFDAveYnNHMu7hZchjjTjOAz5LjT0d39HTIglNAKVOR7OSIoNsTX8e6mv7kkSQShgwTzYISn38TrWJl7cRsDnbIxRPZ-UBOuqI5jPnTCL0yzPVPesIJN6ChTxNiK9CmbwEZaguZzoLRpPxnbvPzom9CfyoA1RlTgjNz1T4vS4XuUpAQp57JQREJTI69qhUvoRC2qnOy1z7Hwe-zYf+TxA6hMhskORAumi4zlJEzZFcfsLdyczcfYeq4A46OERBl-Z6Jkpu6dgiEsD0Klz6eHveP4xBAtjvGp9jQBNPqck1v36MLheYmwfVSYfHuiIaB4qx4yVkLixUL5e4HFe7uvy3SVfCf1eDpNfvGS4zE+NynCtKTAfXyjfge6mcLIxGmXfVyd2reSh5BSx0gRtUieC2PWL2LkUuKn3GrrWA52ZCwLBENJdRMfgHB7wEzeqT1lKQq-RMON7J5OQtAxGFCbKtWhRkYNBRBcCbvZOSb0qyrsq41E388jTb8jQ6GzA7AXNXqRmBmagl4w4APq-ibbYZbFMprBqShRf85HoxEVXmp50VrTg2+WP4QgRBzruJaI6AbR-GbMOA-2-5+vraJ6ICFkxYRO-LbXEN2KaEahIe9p-9-cg3ifZCwTkahHIVXGozQORxWZLh+Agd+t7VZJTTv5n4uEM-OhotTzTIxJGjgHYNa2UAnRnCRDVdjXxH7pVraGKNhLn0OwD4Q4TlAbsSjqDG4GygzXRiuz-5V1t+GAuWjbRwEadl0OwSSELD5RzVC0WCKxClAN5oCABUddOoki46Rg9+bfJ-lANFI9c2QuYBRr+hnAQpseQ-KgbXxrqt0lQ9dTALnx0Sc1-MpwZYD13Lyex9gVoOwloBQGUDuGpDKejPXi5rEGC4IWPBlC4HMNwG+DZ+nvU37v10mIhHduL2DbwR7qmDeuHrSyhVMmmIPUQmbw8agDYCiAX3tsDZC+NzyevMjiEM8Gm98euZRJtgH6A+9jEKQI5qpE5DFgKmjvVAVY1SExN6muFfwKELAA5DbI5geEIHwXaAgQ+dQchJM2mYLRahFvWYL5gqBWUZy94aSPiyHJOUjg-YDQGWDJbXNIW4PaFj9Da6iIpI4IH2q5ykgFJTIgzDMGLScjZREWlLUGHwBpaKlzYO7GcGcn4SgpeCllezl83vAsRVghiA1k4CAA */
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

        Fillet: {
          target: 'idle',
          guard: 'has valid fillet selection', // TODO: fix selections
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
          target: 'idle',
          reenter: false,
          actions: 'AST offset plane',
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

          entry: 'assign tool in context',
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
  return node.node?.declarations?.[0]?.init.type !== 'PipeExpression'
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
  if (node.node?.declarations?.[0]?.init.type !== 'PipeExpression') return false
  return node.node.declarations[0].init.body.some(
    (node) =>
      node.type === 'CallExpression' &&
      (node.callee.name === 'close' || node.callee.name === 'circle')
  )
}

import {
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
  addSweep,
  extrudeSketch,
  loftSketches,
} from 'lang/modifyAst'
import {
  applyEdgeTreatmentToSelection,
  ChamferParameters,
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
import { DefaultPlaneStr } from 'lib/planes'
import { uuidv4 } from 'lib/utils'
import { Coords2d } from 'lang/std/sketch'
import { deleteSegment } from 'clientSideScene/ClientSideSceneComp'
import toast from 'react-hot-toast'
import { ToolbarModeName } from 'lib/toolbar'
import { quaternionFromUpNForward } from 'clientSideScene/helpers'
import { Vector3 } from 'three'
import { MachineManager } from 'components/MachineManagerProvider'
import { addShell } from 'lang/modifyAst/addShell'
import { KclCommandValue } from 'lib/commandTypes'
import { ModelingMachineContext } from 'components/ModelingMachineProvider'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from 'lang/modifyAst/deleteSelection'

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
  // face id or plane id, both are strings
  animateTargetId?: string
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
  | { type: 'Artifact graph populated' }
  | { type: 'Artifact graph emptied' }
  | { type: 'stop-internal' }

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
    'is editing 3-point circle': ({ context: { sketchDetails } }) =>
      isEditing3PointCircle({ sketchDetails }),
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
          false,
          'variableName' in angle
            ? angle.variableIdentifierAst
            : angle.valueAst,
          axisOrEdge,
          axis,
          edge
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
          kclManager.variables
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
          kclManager.variables
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
        shouldPipe: false,
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
        } = input

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
        const { selection, thickness } = input
        const dependencies = {
          kclManager,
          engineCommandManager,
          editorManager,
          codeManager,
        }

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
          dependencies,
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
      async ({ input }: { input: ModelingCommandSchema['Prompt-to-edit'] }) => {
        console.log('doing thing', input)
      }
    ),
    // lee: I REALLY wanted to inline this at the location of the actor invocation
    // but the type checker loses it's fricking mind because the `actors` prop
    // this exists on now doesn't have the correct type if I do that. *agh*.
    actorCircle3Point: fromCallback<
      { type: '' }, // Not used. We receive() no events in this actor.
      SketchDetails | undefined,
      // Doesn't type-check anything for some reason.
      { type: 'stop-internal' } // The 1 event we sendBack().
    >(function ({ sendBack, receive, input: sketchDetails }) {
      // In the wild event we have no sketch details, return immediately,
      // destroying the actor and going back to idle state.
      if (!sketchDetails) return

      const cleanupFn = sceneEntitiesManager.entryDraftCircle3Point(
        // I make it clear that the stop is coming from an internal call
        () => sendBack({ type: 'stop-internal' }),
        sketchDetails.sketchPathToNode,
        new Vector3(...sketchDetails.zAxis),
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.origin)
      )

      // When the state is exited (by anything, even itself), this is run!
      return cleanupFn
    }),
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
  },
  // end actors
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEE1OWEJazVbYRVrRWsxZV0DRC0JGhpZCrkFNRo1ZRc3dCw8Ql8AgFtUAFcgwPYSdjAI3hiOLnjQRMEpKRp02alzOUV5cTU9QwQZMXmxWvMxaxkNGXlGkHcWr3b-cm4hvnYRqLG43mmpKwkVI9m1I4qYSZTZGWwSeyKRTqOTlOTWCwXK6eNp+fy+KAdMC4AIAeQAbmAAE6YEj6WAvZiscbcD5CTJpE5yE71WRiMTA0EIdSSZTsqRHDliWaKJHNFHEbFDIl3EhYokkfzcQLBUITSnRanvKJbQQc6zSKz1GjCOS7FSzPSJGRfRQSRRaOqwxQ0M1qMUeVoSbAQTBgAgAURxxMCAGs-OQABYat4TOlJfJ29QyYQuh22TJiLnwtQSBQKKTVL4qPJiD3XKDe33+oPSsMR6OKSJU2JxhJCazghTWYRSXIpWbCI5c4x29kFRy-OTaerllFVv2Bp5E7oYGNattTIRieF54Q937lNQls5cvlSCEcuqzGid11l1yXcVen2LgBKYHxqEwhPXrdp7ZJDuY7WH2cwWioCgyGeAoXrsag7AhSw2DIc4vtWBAADKoAAZs89CjBuAFbggoFyPaWi5KmUImq6XJ6r8EgMksyg7LI2hofgC7+t4kZYJgf40pM-CIGRFGZI4UIuqIcj0fsMhMT2LHMsKJxSJxlavv6ABi2CYH6+HNpq-7CdMO4KceN7GMy5SdmeKjmHm+SujIeQ2scGncUuLBEoZhEmfGeqqBCijmT2xwIbeZ5DheCJaNOCI2BooqPsi6GLsgJDhoJ2okUFki-BaKRHKI7LQcUCChUCEimkC9jZGI8iqJ5WkEAAIsEQwqn6arhARrxEaZ27MtILqusYrkOhYZ4AheOQIakCJ1BkqGpc+XGtQAKmATyCOwqCCEQACCbU5ZuIlAcFNRKCcDkyDkZ73fMWiZsKHIOSWLUYbiOE4UEARMKSuDDP1LZCYFO6SDQ9g7nYWg2NkXIIvu0iyOYFQCoo9SrU0nobRhAAKRKoB0TDsHtB2QBwZ3ERdYkOhJ1HSXRFUiCWim9iWKnsepa145p1YSJGPpgATQNwAQR2+dgOEkKE-hQAqTCRv4LBMN0pJDBANNDUkpU1RarqQRYfbwmeJoqBCvYKNCjWprYX1+hIsCRqgADuYtkBLUucLL8uKyQyv+GApOcJAOsQ9oeaw9Y1R5KaUUVXkDo1RYAKZD21Qpp53jhuwUbEGQlCYLnDYR4BAKW8YXOFqFtcbEnnYKfuLlWEcPaNTnecFx1BlgCqmJSuXJG22U2SFrHtR3uVurHJIoH7NDaimvCZFdw2BD3BgwcQBw-gQN0RKtPW+fRqDxng4BUkWdbrniNJKhcikBr2xo0NKBauTr6fEil6fACSGFMrhgHliHE-hCTS3ICQAS59Yy00SC6fYeYTg7lkFjXYO57LsmkA4AE4h0G1F5rjCsv9u6RjIQ2QBGUsr9yCIPcBrsj4AC8HgwOHhdF0dh7RDjOLDPsQJHpmDKJBfcxgP5iO-lGShACMJEG4LAdgCo8D+CYdgVhOIYH72wIoouIMjLwN1i6Tspg37mGNkyLMFVbA2lMDHdkdQjjQykRQv+UZqH+nkbgRRyjcAQOJJwaBmBtG6IoPo-yl8R7Q3IvBYUnZUgchnqJVyaRbypmvLHU0OMnz8xkdItxkYPHEAUUokgKijoACFvD+AABocMQeICyx5bDsmsisJGGhyK-ELOIcaNpXQuLyYUuRJTfH+EqdUgAmvUxASCFLTn+K5CcOwuSuVcukWOoihz1AKNktKXEClDKKV4nxZS-FkCgH6GZlUpJMUOPsXIKYdyyWsWYXMqRemgVdAiOQgyCnHNGWc-wfp8DsDPgYwa8YaKSAzmcFIK8kJI1HOkFY90MgAlsCoP55CAXeNKSopgxJCW4F3uQDWJAZS71CZQa5nSyhXjsNEuFj9rECnIp2dMsdVACgfCQ+chz-kjLxWMtRGiBj6X0P4GB2AoC4GuS6dZJYjihW0BjKxWxQrCjzCkaoXLpywl+XzUhAqcVCtOSoyBgSYGYEldK2V8qLDkRnOk0KDpmQNw1eIso9R4TyDOLdQ1fKvQmqoWa-FfjYC4EDv4fatSHVKGkAiRqy9VgrAUEjColt4RukcPqYhOTjXkKOWGsZkbo2xumXAyFV8Kh2isPYC08h8hgSRljeYvShx1FNLXQNBb+VFsFYuE54bg4AEduhaJBVAMFDqUaulddDZYNgWUat1UxGwnYCgmnhc4I1-aGzFqHYCglFLrXUCrQFGtAJTCyHuoOSC8EZq1HtFCY8dQbSWCxXu4NA7TVHuFUCokIdUCEjuMenEFIL2RM4Q4cijhWTAixlYF5GrCwKQKLMQqaMkLYtDe+MAggdohG6EMeVT0fhpwdKFV0JphDmyWGUVBux7qrFabh2Ri4t79ypgEA+R98AnyjPKqElsl49NvOaPI5sUw1RsMyKwdg027qDQc39eHPHgf8G7DgKso1YggBAmB3RwkDUvSPUQls7bqGhDZjQ1guRmHmMvD9y950IRSipysIaOP+ijBc-u+1vzXM7OCDMSxIK-FUmeB0kgrC5Ght8+EVhBlHTdmUgIoq2HBKpQMMJ-g8A4VQAQCA3AwDelwF+cMEgYDk0y5ozAggCuoGCy5Mo0NoTRLMByJGQIDQ7Ai32JD2QUtpb3nV8VITcuUHy7gQrBBiTEyJBIQGgxCtEg6NVvwghxswMa7N5rUHcp01a6aETWM5ipCWD18EZh8j5HMCkpYI30v+KgVonLeiZtzZK8DcrlWys1cEJa7AQS9uFZa3MGqx4zBjUzqFJGCMIRxzjmyacvK+0-oPall7wOgmTc+01+bRJFvLc1mtjbgPce7aaxDu0KZbBaCUKsLGSNQJV1NEcVQNpgQ7me3vCZtSvtFZ+2VvA-3NvkxIAAI1gIIPgYODsQrM8dgUIU0OgUdG9VZ5Qq45BY42xdvb9leaLdj-nVTBeE4W6gJbK32Dk4l4IaXsv5c08O+dRIcUYW1FTDkHsaT1WiVmoacQNt2ShWG9+1TWPRsBAF5MoXxXSt-dQFVwHzvBD6AVxDy29QGdDnHo1VZNE2tVESfdX3fO48W4T1b4nNvSerZtxTrbGes9u6V9Bz3FRJDCjsKaWo6ZoarORqYFYwobLKGnHs9aJuY8vYuX6RPIuU9p9b-gP02f3cINEj36QaCYqVwyEULY+QNA-GXeFE0sd0fG6GRIM3ARF-9zryTu3Dv08b4Ix3iJR3u+FnSFEFgjNGQ3ECRnZFzFTDeUaiPHuhSyYEBklSnTBTAwAzwHYCT1+zF1TzKyOm8E2kEHuDQNwEEGQPBV-w9131kCYi0DyENmXiUED1ImzVMCHFsFsGTgwXgMQOBWxGnRViIPNRxCJzfzJ2bwf3wMIPA1IL4JnW311jiirh3AxjmFQUUCRVV0nBLF+B7AdBn1yUOUf1ViJWxFJXJUpR0Smxf320wNFwqxwMd0JSJGJTMNJCJEEA+zCS307z-133WQKEwUFCUFTCSVIi+HIjQxOEnFOFjir2MOcNMJB3MPxzy1fwb3f3EMBycJcKSLcI8MsL0W8IoJ31Ina1MGo3ZGbUklCNAixmkGZCiOyBiKN1n3v0wjwAC1QG-E3kjH8xjS6NgR8MoNIjkyYmMH3AQnMEyGXifjnT7HSTsDqlAkGXaOBn6O-AkH-lwA4AIBa3EAhAxQtBzGZBP0QF9TzHMGLAxixg4ijznx-lWM6I2K2J2KoCbGKIUIcAUhOESgH0ZzsgqkqFMDOFg0cTNGcTuLaI6PWMwAkAADlUB-ACZUB0DYBJYIADNdFfJVYUScRgsSw7RfVbZbpzQ6MKpYRUllAYozBgQLMVjoTAtYSESkTcT2A0TSAwlBiPioVUwYlaC8gbIzgzRsxuFNAoRZA4sDVBkXiMDrkFAoYchFjbATQRQzwb8xiAQJxpJx9pTtjZT3jTMu8SgEQfhREdhM4LRHp7oFhs0oRUhB9BlNp-McRsAtEKVyB+iei+jGTrk0VyIEk5hagzQ1hQiEp0h2tqgKh4kPMMdo8f5ugSVESsT2AClcRcBbDV9cDJCEyStBBkzUy5V5CoUUwxxCx4RbYBQNAV0ziCgeEsM0FIJjxBkPxQhn8YSvT8AniuTDTfCwjcgx92Q0cslnNzZvhlB1BQJJzWQWiDCi0WzctLkuyH9Y9j4ggiCDN7giRgYiQCBdJtiXZ-AgNWyv9fToRRMTiOQ3RUh1CKpahJARQLAzgBRPpITDl5y2zGTlz0tj4bcZU8B0SDMjyFyl9fyoA8BTzjh7R5MdUIplARTm4ex9x4p5pZhmyQhgKly9ydE+IDN3yv9diiyr4chCTHBexCxOczZbyUgfhwTUxewe9fhBkiApQQw8LFz2y-NOyYSOFdRVgFIvhaT9wH1hQyTEhIsmIMUqhzBjgHImKWKZQ2Kl9PzH9j5Nztzdy8BsK7h5LDz0Ln9fTIQDjcghRdVaMzwCgs0W5UhIRshljXyi1mLgwFK9Kv8YSvzxgBNQL-yjoMTtKnLdLjz2KvLCyhiSikp5454Uk7Nqh7JjA9wfkrAHBbL8079DlHK6xFLMLNKXZIB-B0rWKXLFyCLQqFDsg61QI31VBoZ8gzwDVcF51mNMllNYz7jpFyA-QyBAhNZ-RhNqDHBOxaCOR3NTibkcFdhVDG07BtBmrUqHLuBgcBNY09Ncr8QjN-QV9sCqsSBFFh1fE4S5RIAAA1NalrbhayTsByXNaSkfVMKHAUe6ZNRqawJi+agJY+Jag6gzVazAYzEQ9IsQ9bCQba9gXas5fa-TY6n6kzMGXspNXMRdP3fIDkTVVZaSiEDIR87ndMOIwQkdIDLoUDXG3xNkjMzasrXMoms5QQfGkDAjSm9A06g0fBfqnQ48KTJOcIwA5kFYBCTFW4zze-Iw+mvxHbCVUm+wqrCm6Q0Wm1FrWEe0O2Wod+SiR6BycM0QKoM-aoHGzTKnMWjaiW8mg6YWoHN6oJWWwikiH5CIoqOYR1HYFZJOS6xSC0aETZGknW4g1RX8sVa1W1HAWVcW8XKW4g7bH2rLG1J3AOkK7kwCZGO0b5fIfcKImEcy2shyAvM-DOW8T2oQ17K1CVKVaOoOhwkOoQ02t7CVKOmVGOns4YhEbhBwCoY8KwaiFIaKaqL4I4KeAcZeW-Voww2PVAvOstJgfo2pEuyW426Q0eimOXFrYEe0TID6aEPsWwDNaoGqGxCk+KVYXOkdUe8eyZSeo2qQ0O2e-aTPOWqGUCUQaEG0Y8VtXsRNYi4M44FSfesZMAcdSdWQyME+iQMu8NQjH+hrMghe+YV2z+PilMByWqrVNgsqd6YESCT+oFJgU9fSLAABoB3xQQDBhULB7smG+u10LpNuZnPPLBJOVVFBdzLIB5Gagehy3orizaAY4q2Oq23rC-EsJKu09mjVUsdIBCfYC7TdDyeyg9IgVhmAfwdh7ot4kq+MHsGTXNU0fIAsROIR-IERxCcRu7fQwtaR2R-uBRzAXY6wZRuOnpMfJYI4NSfsaLXRlaMRxOjDJi0x+RjhqgGQaxkiOFXMKEYwa-N6ZkZx+eUR1VVeBxzxvo8x3YlQfxumVQiEX4eqWEWoBCMkoRvsaOVFHmtBZqKRn+GR+JnxsQZJz3VJh6jJuod9HJ2ZZUjZE0ayrGDdJh2c6R7AIkdqrsjsuRn0y2i6cSjQJxQsaS+6aspIKjQ0QS2wM0ESpinpvptylSzyo+MC9MnyjclZkCzZ8C4Z60PfcPLnD6R0FDXfKON1CY2OUKKCZZ3ppSgY9yzgATN8EgXeXoDS-cgQvZ6Gi+Xs+wBCdIRq1YTRpgu8b3DINg50VjR51Zz8rCnKgzIgf5zhuukopOu0H1MZyCPQk0Wq10eq8faq1ITp4x0+fwXAREv2HiVUXjMAWWDWAGcWa5QQDBOxEI5eIEZVaZxCrmnYccXIWObOSEsgbADoQYd6xElbYGABiVqVoYOeul65C0NIY0XFtmgEGo00Pcbm0sO+SPAWxV6Vxa2V8WP623AGjbU15Vy+1Vo5pp+ebIIsd+DIURVZaihTYi7QO5nsTyO1mV4OPgSw1c8hBV7YpVgjS+2AchNVr4JiF0WaNMDkWkkcOdQ4PICTL5fu3JI6BAm1H836f6VWS1g28XXCP6PwT2YGI6RRdweVHBCqoV3mnYbIflnQsofVO81pl8gWgtxA4t6t1lr2K1xve3cQqt-6WtsAet9gRtp1m5RkLW34dJNBGo+CUxVQd1FMDnTyQdotgTTAXCDAithwk9vCedxdqpjsTegcNkEVoSyFk0e82DYwY8acDQCl+cQ9-QY+S9jA63a1pvQGwD699AdlrlJiAsc0+OFpVtcEUQBqD6L95eA9wt-9gTHK-SABnDzACD7WJdwQcKNreJf1591taggk2zRs79jDod7DviXD4Didh3fDwjqDudW8WOCjhD6xdg9IOuD1uj9DyEv94+ImEmMmOenjPD7oKXDoDgfB4mUOQjXePyTF3WDl3cB+DIZGBJaEBHBwMoJNeDUTn9r0CTgTKTtTy+uT1jjIwG2ABTpT8mJgVTmTnjdl5QA0PTzIVpocIz6xRCRNJxVDjQMTx8GljAeAKIY3Lhi6QQWEKGBCRxo8AheiHMdIGEewYy6oC0R2MARL6YIccid9dL+p4ULkWg+0CqkLEqEUIroWEWWduLkhkokQOob1OFPsDL6rpOV9eo5iYEWok4Zrl2d2NrkroQc0vMF6B7SoL982Fxxg28FIV0CeFxGb7kYlsZuKKqmS6ZwQGECSrGdQZSZCdjdxasHbgR-fHIOoALghRpyqY4NIbIJZDkFiF0FK5h+fMbcO+rFI6bJrO71uiSyMyYgRD1USRY6QSCTdHm7tSzuM6RIwvWkH6wwrcH3YPMRwVQLmKk9ugTzIUwXQ19+DPvOIgXGpIXcH26o0SszpHcGY6xFICyCfGiauAvGnmvenrTnk26nvFmk4btS57YF0f0zZeYicsVgWwehfVysHwXq+auCiFeB7dGEapGunTRuYGKdrbgm1Xg0FAQ8DdgXHi8VzGFrDdJpFacPRvPHML4c4Ep9Hoe7IxIslNwrHgXjroxfcSQB2iKCwCwB6VlULXIBQR7luIx-dB4hkgYu72uWTBwaoxY00EcFOFByM1piTPNyl6RR4tymUu7+oSAyEDPivCX5kdneYhg6HWS93ihEvz8ml9bGBHbzsOKxddYcfO217rnCSpnCUuTAZFviQNvl55k5E1E7vjlaQNSfMG0cfGriweb+wdyfpNjSfsv1XkiMCcM4yoEE4iXvISCqylMc0juePzHH+J0zsl0t03p-onbqZgqMrzQeoVMEarJDZd7u02OBIZBkOZJMgMF8gFk7u3Sb1Byn3CooRMDmWYGMRcwyR2mMZWagekyowlu+UEERp2BbrcoqoI4brhFjhzAhXIf3Lpj-GwHKUVy2HEINwA3I25ty3fdBPgI9a1RGC0zexqaQ4LHA7ar6NCoFWeYbF1mUAJUAc2EiGIVGrvelEFx45RFa+Z1RChVVUDH4qBRfChLQJebIscK-gTKmwJwTPxwiBqY4MPlvKOQcguyHYGkiiJyV-KOg78N320BwYe8V+aiKET4ovwu0eQbQOmH2AOCMqhVUQbCXEFgYtyxId-tDF5DuCW4ng8ytCHip9IkqOQTQQn2kT5VnKIgpcuEOCrRCdg9oOIfHVWAd1cw92PPPYFgzpD7+mQnSk4NhJ6DcqWQgwSEOK4H8LoW-WIQKA8FQgvBeAndtymPyopBkfTTqrAG6p3d+q3qZ+PmDLLTRBuJoH4M+wcB3gUgX6BXnNQqxvVzW1LT6oZihrg9dGOwFYP8ATgZAJeCMA0DyjLLftbwM5LQa82Hp41gMhNC3u10BbDFJIBodJuIDuhnYmCMWAqAhAYIiZMMaDFRDLS2AB8eSeQH4DATMB2ARM9mJOGcB+E2Bdg26PihgP+4-whautM2n7XB5wjfhiIyaBHw1QOR5gKSZMDCCREQiRaQPcVCbztTSDq05mEkTASVoYYYqScZNDVBsi7IsRhfDIRQnxFe09aLI6OsSJ+FcjygPI1INFEKF1BxyF2ZjAyMCBRox6saGpEcOD7KEYhCMc0hmiHD74e8IIqqjULR5iih6wtTUeWkRKTI9Rl4WEIaNUbDhrEygZ6E9E1J54xOmwgHgEDtHf0J0wSMgjKPhHAt5Rbqc-u6nXQDVokPqDIBqIIZnpMARw+ZE3SWDQwnyhYGaM-T7qWRKg8MOJmw2T4dDPcDkJ1OMRWhTEYW0WVXK42iYSM7+1oiQGiyeZdlcBm9fvNzQBC+djA+Y0TDsFzT9jryz1Sfh2MRYvM8hUgtgbo17HyAxxiFDNNc0LC3Nx8DzScf8zWb0CJBHzL5h8JkE2MFxKYPsQUCSyvcm4L8cCLC3T47AEWoQiQE0NRb-N5xBUM8UuIvEriQuerViJCCUhNEXE1LWlnLHaEwjAIJHI4DVCHBHE-cS8UIicH4q8Ik0-YOzCKK9BBtdhcrcCZ8JKIAFk6+4e+r2Hpy6tgRPxdQH3VUCo9KwWEiQbGh2hhtsO5CHbo72nCRZxENgFiK917BpA7wbkZYH0IY5HsJB07NEDhJ24kd1AczdiLmnGixwespo0qOLxWjaBWxlYazhIMA6SSyuPXSrneRGr6N98E+L9qIEyTCSsOEg-DjpJ3B6S-W-XQyQoHmCap+sqYAEMlnE6YdJOnncmPZw042TyuaXeyVV0Mkpp4RjaOgsC15guAgAA */
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
          // guard: 'has valid selection for deletion',
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
            {
              target: 'circle3PointToolSelect',
              guard: 'is editing 3-point circle',
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
              reenter: true,
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
          invoke: {
            id: 'actor-circle-3-point',
            input: function ({ context }) {
              if (!context.sketchDetails) return
              return context.sketchDetails
            },
            src: 'actorCircle3Point',
          },
          on: {
            // We still need this action to trigger (legacy code support)
            'change tool': 'Change Tool',
            // On stop event, transition to our usual SketchIdle state
            'stop-internal': {
              target: '#Modeling.Sketch.SketchIdle',
            },
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
export function isEditing3PointCircle({
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
  const hasStartProfileAt = pipeExpression.body.some(
    (item) =>
      item.type === 'CallExpression' && item.callee.name === 'startProfileAt'
  )
  const hasCircle3Point = pipeExpression.body.some(
    (item) =>
      item.type === 'CallExpressionKw' &&
      item.callee.name === 'circleThreePoint'
  )
  return (
    (hasStartProfileAt && pipeExpression.body.length > 2) || hasCircle3Point
  )
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
export function pipeHasCircleThreePoint({
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
    (item) =>
      item.type === 'CallExpression' && item.callee.name === 'circleThreePoint'
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

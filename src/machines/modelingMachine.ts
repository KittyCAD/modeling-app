import {
  PathToNode,
  VariableDeclaration,
  VariableDeclarator,
  parse,
  recast,
} from 'lang/wasm'
import { Axis, Selection, Selections, updateSelections } from 'lib/selections'
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
import { deleteFromSelection, extrudeSketch } from 'lang/modifyAst'
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

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export type SetSelections =
  | {
      selectionType: 'singleCodeCursor'
      selection?: Selection
    }
  | {
      selectionType: 'otherSelection'
      selection: Axis
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

export type ExtrudeFacePlane = {
  type: 'extrudeFace'
  position: [number, number, number]
  sketchPathToNode: PathToNode
  extrudePathToNode: PathToNode
  cap: 'start' | 'end' | 'none'
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
  buttonDownInStream: number | undefined
  didDragInStream: boolean
  streamDimensions: { streamWidth: number; streamHeight: number }
  openPanes: SidebarType[]
}

export type SketchTool = 'line' | 'tangentialArc' | 'rectangle' | 'none'

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
      data: DefaultPlane | ExtrudeFacePlane
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
  | { type: 'Fillet'; data?: ModelingCommandSchema['Fillet'] }
  | { type: 'Text-to-CAD'; data: ModelingCommandSchema['Text-to-CAD'] }
  | {
      type: 'Add rectangle origin'
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
  selection: [],
  selectionRanges: {
    otherSelections: [],
    codeBasedSelections: [],
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
    buttonDownInStream: undefined,
    didDragInStream: false,
    streamDimensions: { streamWidth: 1280, streamHeight: 720 },
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
    'has valid extrude selection': () => false,
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
        selectionRanges,
        constraint: 'setHorzDistance',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain vertical distance': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges,
        constraint: 'setVertDistance',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain ABS X': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({ selectionRanges, constraint: 'xAbs' })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain ABS Y': ({ context: { selectionRanges } }) => {
      const info = absDistanceInfo({ selectionRanges, constraint: 'yAbs' })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain angle': ({ context: { selectionRanges } }) => {
      const angleBetween = angleBetweenInfo({ selectionRanges })
      if (trap(angleBetween)) return false
      const angleLength = angleLengthInfo({
        selectionRanges,
        angleOrLength: 'setAngle',
      })
      if (trap(angleLength)) return false
      return angleBetween.enabled || angleLength.enabled
    },
    'Can constrain length': ({ context: { selectionRanges } }) => {
      const angleLength = angleLengthInfo({ selectionRanges })
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
        selectionRanges,
        constraint: 'setHorzDistance',
      })
      if (trap(info)) return false
      return info.enabled
    },
    'Can constrain vertically align': ({ context: { selectionRanges } }) => {
      const info = horzVertDistanceInfo({
        selectionRanges,
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
      const info = setEqualLengthInfo({ selectionRanges })
      if (trap(info)) return false
      return info.enabled
    },
    'Can canstrain parallel': ({ context: { selectionRanges } }) => {
      const info = equalAngleInfo({ selectionRanges })
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
      currentTool === 'rectangle' && canRectangleTool({ sketchDetails }),
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
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    'hide default planes': () => kclManager.hidePlanes(),
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
          selection.codeBasedSelections[0].range
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

        store.videoElement?.pause()
        const updatedAst = await kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
          zoomToFit: true,
          zoomOnRangeAndType: {
            range: selection.codeBasedSelections[0].range,
            type: 'path',
          },
        })
        if (!engineCommandManager.engineConnection?.idleMode) {
          store.videoElement?.play().catch((e) => {
            console.warn('Video playing was prevented', e)
          })
        }
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
          selectionRanges.codeBasedSelections[0],
          kclManager.programMemory,
          getFaceDetails
        )
        if (err(modifiedAst)) return

        const testExecute = await executeAst({
          ast: modifiedAst,
          useFakeExecutor: true,
          engineCommandManager,
        })
        if (testExecute.errors.length) {
          toast.error('Unable to delete part')
          return
        }

        await kclManager.updateAst(modifiedAst, true)
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
    },
    'conditionally equip line tool': ({ event: { type } }) => {
      if (type === 'xstate.done.actor.animate-to-face') {
        sceneInfra.modelingSend({
          type: 'change tool',
          data: { tool: 'line' },
        })
      }
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
      sceneEntitiesManager.setUpDraftSegment(
        sketchDetails.sketchPathToNode,
        sketchDetails.zAxis,
        sketchDetails.yAxis,
        sketchDetails.origin,
        'line'
      )
    },
    'set up draft arc': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager.setUpDraftSegment(
        sketchDetails.sketchPathToNode,
        sketchDetails.zAxis,
        sketchDetails.yAxis,
        sketchDetails.origin,
        'tangentialArcTo'
      )
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
    'set up draft rectangle': ({ context: { sketchDetails }, event }) => {
      if (event.type !== 'Add rectangle origin') return
      if (!sketchDetails || !event.data) return
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager.setupDraftRectangle(
        sketchDetails.sketchPathToNode,
        sketchDetails.zAxis,
        sketchDetails.yAxis,
        sketchDetails.origin,
        event.data
      )
    },
    'set up draft line without teardown': ({ context: { sketchDetails } }) => {
      if (!sketchDetails) return
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager.setUpDraftSegment(
        sketchDetails.sketchPathToNode,
        sketchDetails.zAxis,
        sketchDetails.yAxis,
        sketchDetails.origin,
        'line',
        false
      )
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
      sceneEntitiesManager.createSketchAxis(
        sketchDetails.sketchPathToNode || [],
        sketchDetails.zAxis,
        sketchDetails.yAxis,
        sketchDetails.origin
      )
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
    'set selection filter to faces only': () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'set_selection_filter',
          filter: ['face', 'object'],
        },
      })
    },
    'set selection filter to defaults': () =>
      kclManager.defaultSelectionFilter(),
    'Delete segment': ({ context: { sketchDetails }, event }) => {
      if (event.type !== 'Delete segment') return
      if (!sketchDetails || !event.data) return
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      deleteSegment({
        pathToNode: event.data,
        sketchDetails,
      })
    },
    'Reset Segment Overlays': () => sceneEntitiesManager.resetOverlays(),
    'Set context': assign({
      store: ({ context: { store }, event }) => {
        if (event.type !== 'Set context') return store
        if (!event.data) return store
        if (event.data.streamDimensions) {
          sceneInfra._streamDimensions = event.data.streamDimensions
        }

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
          selectionRanges,
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
          selectionRanges,
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
      async (_: { input?: ExtrudeFacePlane | DefaultPlane }) => {
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEEpYSkJOUUaOWsxeylrWzk9QwQClQkrVOsZNWExFItnVxB3LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5KkaCWspZfMM+XE1YsQZMQWxNQtxao0ZeRc3dDavTv9ybhG+djGoibjeRJothBpzlsvPDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd6IT4GbG-VoAiTYCCYMAEACiEPhgQA1n5yAALVHRdFvBJCJYLHZKawHczVBxfeySRTmOpqMRyNSZapNC4edpEklkykjOG0+lMxSRNGxKZYpK2BbmWrqcQ0URiJZCkxyGgyYTKfZSK28sT4-6K4mkimPOG9DDM1769lJSUyCQSlTKGQqXKKF3CL6KaoRjKpORieM1RQehX4JU+gBi2EwpKe9HGrJDMyEWYjdhdYkcdsl1iKuIQiljwgkMakchsMmUDjzVyghZVfBYcIrOpZesxocEYjq6XbohoKVFUsUyZUjokNUzSmE1gT57HhO9ZOQJDpQerS9rCBU1gqWjfakH0ay+y+wgKOk3IqComZmLGUhXl6yoEAAIsEIyBMEoRTI+i7TPwQiOuU2hmCOCbRooYjJpK5Q1GevKKI41FStBBY3gQAAqYCPII7CoIIRAAIJwehGKYbMzbvmYKRZhK4YHsmqi9lY2Q5No1jCNGcj0RON4SAyxJgAACoiuBwAQ3GztgABmJChP4UBwiQTAMv4LBML0iIjBA-Fsi+ggHmoEjiDG35aIFDpfN+EYOKJA7dtRUgqGpk4SLADKoAA7npZCGcZnDmZZ1m2fZYBdEwnCQO5NZYUkYFyOkLqZkpgExWBJGdtRBR9lo1H2BaObWHF3h0uwjLEGQlCYH1mqlc+5Upqcix2G+dSOkptjJooBy+cpVhZnIUr2r1-WDQh5ZgMhoLgnOVYYQa22SGobpLOodrLDIXxxlVGjmPWuzKRae2agQdwYP4kAcP4EC9HC7QagNTKVi8T6CYg3a3aYYEBVoylmB2JRqDUvmrsstRZNRaixc0BKKmN0MSJTjIAJKwXedInWCEL+LCJnkCQmATQjXanGkw7LEpjgqOj+6tbY9TqPMQuyL9VM0wy9M+ozx1BKdrNJRDABe9xczzBrdue6SgfUOw45UKjJjYxrSla+xEzQo5k56BaK9T+1K7BRDcLA7A2Xg-ha9gusQlzoPYH7w2jLDuoCYb9iKH2ChLLIxEKLonZGpITtG2BOzp3Kfz5hO7uK8rZI+7gfsB7gbPwpwnOYBHUcUDH87BpNiRRb2W5PQ454SrGXwFPkEhgU7NAHLkw7y4yHuahXxC+-7JCB9xABC3j+AAGgbobdjYpg-jj0bno6TUlLyViRjQSkWPY1gOFBLslwvCue0vVc12vdeb9vABNfeL5D7vnkEoE0tR7ZW07PYb8FQ1gnhihnIu5M3ae3fnTb2K9a7+DIFAUkwCpo1D2KteYrY+T5BHs2XsT9QJ33tPdUCc8GSYK9j6b+q9A6knwOwGGHd4YJxiqYcKA5HSCzsCPM8VUMhWjfAUPuxEWFsK-jg3+Dl4RMHBBAbA5BnIkHVDo1ulAiHd3bJITavI+7tl5JnK++QIzGDbE-J26geqv3HGwlR2Dq5cLrsHUOQwyz6DwTgKAuBTGIzgZGEmB4ZD5GkVmUiORZothcQ6LcMhlHlx8T-QO7NG5c0wCErm2BwmRL5kpUwqQaoaGyMpZ6zUrDlFyKuAoEoDhDmyZ-XJfjAi4Fsv4Diu8KndhMDUAKqh9iZCoVnPyydRQHGWKtZQ3TF69NwbAAZTAhmoH8EA2OC544HwyYsFM19zxSkHI0q+xFezqDjLsVaOwp5rOhqo3xuCwAAEdejhx4VAPhozYwLDqH+JQ252nSVxvIRadgbA4TeVgjhajA5MAMUU6ghzO6827KoPsZ59iAUyKKbsyYJS9izFLBwyluyk3lJ4suPSUWfPUXCAqqBYS3FRRCFE2LBEHzdCbGKsY5BgvMcmWQPlajtlAnaaUw5cweMJEy9ZPoABKYBBCsRCL0EYozHRpG0NGcUhNvzJnNOPWQoEKXCBOO4hlKqME5J9ADY6wMAhgwhvgKGjJgXI0dNKZQA4H6rQtfaXyYrNqrhxlmJVjqKbOuZZXbgBTdlswMdgEgAAjQh-LLonI0NILICSSarSsNYIU58jyrhwk-fY9Li6MqTWqskjJ8HHQ4qgbm+bjkvhyHfaQVjboO1CpW5qxF3xZE3O02QVgX4JvQZqCQ3FkprwCAEvWzcjFDDbv4PAplUAEAgNwMARJcDQlQHSCQMB2CCE3WHTAggD2oAqdUZspgHFCyfjFOoI83xpClCkMCptE6NrQaXDBq711B1QDrLdLdd2UH3bgQ9BB4RwjgxIJgLlD1wi6Devw964Mhy3c+1Dr7e0eXKu+98A74mKQvpsLOJDIzAdsGeZY4hVLKsTcu6DIMCm6PDju6OKG0MnoMuey917b2CCE03cjh633m0WIODOMV5hnhHryd8+RMhipNJc5RAmAgKZE5HJDx0X3obhJhuE2HcNwYI3J8zT6X0qf2JGFSsLVzypgVfHISdqKijqg004Jm10g3-rvcTR7JNnrwDJs9cmc2wEEHwJTlGBEFv7Q6CMWggNZFjDake34k5bjPKsSr2RIswZizvOLtn7OOeGHhlzRG0sZayyp5S1TtBniJipMrKT7BysHOQnGPHF2Qf41FgIMWAFNYS9Jq9KXOvZvS-oHrVGyqJFlA2aUP5fy2HkEKad49xui1HQOOr0Wt77KaxhrDOG2vOcI3err22PO7a7ogWU5RHAOnTmBc8W4hQxl8sRUWdRZUtjuwEfBpJluntW7Jzr+BSQ7Zy32mjDpyh2AyHi8wsyr6rkkGImwEEVm2AR3gzH1mKPNZe05-DH3BBI61T9nH1H9sOgp+YTIxgHBir3FnK0vd9g1DjEpSUoo6cAr4SjqTSW1vs8VwybHF1cd87PNU2Q9SsxZHHVfO15QnbShNfITM02m1OrmzBjXT27Ms7e2zuTGutdw1y3jm+B2HTKVPqKKRH7RBp3kM2fIu1eNLqpqZjRcItG4B0XoxEhjLNiZsyt1X6O71aMT9o3R+i4SCFE23L3cdef-eHAsKedh7SZB2M2LG-3rVHmUFYgcW06f56Tyn4viHM9M+ew5177B2vs974X1PBjS8Z-L9z7XVfSg198iTewNem-KBHgoXsw5shLPArbiDXiAAyeBO2oG7f9BkHbdndrfaISlcYBwZBSDYEKSxTCy6nsL9szsZsz8L979MAJBaZcAOACA30lgIxvwbU6hMwUxZAAI1pCIxVThuwDcHU7c+MqZz8DIQCwCID2AoDtQl89t-sqJIwMh7plJCclIvgpRexvw7Ugdzx4kFBlF8DL9u0JAAA5PZHSVAPAdgWAIyCACAQYAxAIFgEQx-NaR+GoIcbQCUACbIceC+SUbaBSOiGPWbPA4ArtUAgQ-wIQkQsQ0gNuHtHnCgrsdGAlOdbjNsOxRADIY0N8EXeoLQLcZRcAyA0ZLqCoc+KPBoXfZMWwd8aMWMXYU4KwV5PQrxPwkgqgMg73HXRGKeHyO+GpRVJYO0JMZqTqYCWiQ4HIeJd0BI92JiDtCELNZuAxcgXZG-O-IwipdYPfOMcQO1J+MVLIRg+oCoCedArIJZCowA92XoZPPZKOWcRWSEXAY9VHHPM9bibwJiQQSYk9QQGY9gOYiJX7XFYHT9bQ0UeofYEmfo4LDGa7BQVGcDV2fQ+eTVUITnEA5o-AHg6w8gv7BAGvBYaHfIVQFMXfFvLsO+HyQ1QE3YJsVBB4rxZ43dAhT4ldebSGIIO4ZPblOEAyOEAgEsCAxKfwdlF4hnNo+RCoeMRoPyZsALRAAcMBWwEmYWTIEDZRBE14owlE9dSGEjKAPAcQyQ4kxE5HXkvAMkhwdIK0EmLMO1ewTMRgzISNI4JQDQC2bAk-d2dkhnQg-EyOBkSAfwLUpEqAg4w2O0BYN0C2Z0RwBgzsWoWAhMM1C0NxZRcgUkMgQIFyMkUZA8JOIE3Ic06oAoS+RGFMJOCUZ5MUJ2YHOnDEtNYZaETNHNH0bPC9NXOTOMhudiTiRMiGZMrnCjFTCWA8UHYWHGC0KtL-ULeFMVGhW6WM1NBudNXMrNXNMkEfVrcfd7DMxs2cbM+TJMtsivI5ZfVMKqcRQCBwKcis2BB0QDA-eaaKVae4t+d2ePDEvJOudlHoLlDcvxUQxYlXNM69LYvc2uQQbczlLVM83+c6NI0cmwJOKUk7bQDAgokoBMGaIndsaieoLcDIBs1lQOB9IJYpQ8xLY8s9U8nlYjeDR9YpFTUWYCXkcBGKJYZaQoxUwPA4KUGhU4wCzc+uDmIpfQcCtHKCziG8vAeTBuYTYJTze5dC9sLQWVWkrsEnI8DMbsXYZ+CLSoqDebblIC-xEjQJEi0JMpBY1M5LCQaC4S2C0jeC7bUpcpU00MVMCE5sXYEnOMNi4iZQaQPkQ1WwGqBdHA2PeedcnlIiwpYJCS8JMi5Y2SyimCtzYpDnMJfYmwn4oMp8g4aspQZsZMcRI8KeR0q0HYWMAivpLZQZYZHeRyyC5ywQKi3AbY7ZfsvgRCmRdMaUE4OtEeCwc3KoO1O2F5eNcyx41hKy4S-pOKvZABRKmSuSzc9K2yfs-QTzRxEtNxEVDfEebixYVIaiQCP86iaKr5X5f5cEQFBkJqtXFqvxbVKap9DXFTXGC0Y3OpLvEMrsbIHOU0K0HaU4aoCa9RdFGyMsLAeak8ly+Si6zFL4+82w99XuN8UXe0YwfOclMCNqR8xwO2ZpZRIgW-D4-wJiK-TAE07y3mOHKHU4B5OXO+G5DI6UYCVQb8XkDOWoYG0GmAcGyG0gmGg0KicoVQNxCwWwVaHIC1NG9TB6LGgmWE1cjBEGu-CG6-KgawYm0MYcdQPsLQp2U7UQHGWmv0+QBmtGEmXG9mwmqgGQHml8B0baCoCUF0X8CiHYMW9GyW7G5m5tTUfwXAPZbKMkXwUkSyDAcyZyGQ-Sdub43mQQJ+SIlC8tJsFU98owQcdIYwTGp2b9NQOKMgbALoYYSGYZV7AyG6s9YO0OkYfs02ipcMCoX-QoEWmpACQ8AdDTR0QcdUuE2OsOn1YZViSzNEz2aOiQQu+OjibYz2JOgys8ClY4ZQKZc7SQB0BVGhbIG0poZoY2jAeAKICDB2g0EQZYDQ7kW4vkZjD8qpX8eYJ+YNeYVcOKG8Ue5cb6Se+oaeiwWeuk3GUUF0dseQAuHINe5UTSbSNKAyIeyvWwlcZGOJHemKGei1FJJYYicEu0BQWrBIjSRKFKG+uADezyHYd8BQd6e0WQEY-esEj+wK7+ktP+8Yz2UBqacKIIxwEI0QMIrObsUwbQEtZ0HYbaJFdhMAdB7uTo8eBGrQuoUrZqJ+MKENMwA4OAuWfih3EGECizYxRnQ9KhxGO2Y+O1OXC2aXf9CUqiFMRG4cfW+3OPQStzQfPdF9IRrsW6HyS026EXRwO+HTAY78SeMiBSSUOnBrOLDR5ci0lZHqrGsrcwcebImUW6RvCxh7JbdR56n455CEugmUF0C0W6c7fFZQTAhMVQAcHYOnV47x++3xpkn20Qc8AcHGPCahAysVWoIDOdKoBXGapXeJkc2w55KqXIKMevZG+oKROMdGpQVaKlAAyqrxePKfZPIvNPVR5DYpnFQ2TpSMGwGHZYM2GmrOHaCoBaa1CRcQLgwwyGjR88XYRYKefLb8UKUEs4tTADYmc8H9OZggzkpIxZshFZiR9Z9TRgiUlqbBu2MK4-OE92bgwg42-DLmRZswcocROU1cYmMXEoNwy7JepBJZA55Ekwsw3lD5p2ceGnOoGKTIJJTsbaJOAoWUmSTu3kXw4g6xoXaqUUO+ZsW6J-FaNaZ06NbaTpZRaoj42o8OBo3ZDR+QWwXyToyqdYSrACXGYwM8R0dOClQOrhqmTY6YoYWYz2eY6xwcWSDIEskau0E3RAKlZx7aUWWQGAiwNkkIYUz4pli0JOSKMwHIZ2mckoSUWhe0WtBoU4aPVB5dI05HTk0zNEkIbgSQu4bE+EJlzIHyQ1t8K0BhT2hABp6Qd-Earo9QLJIVp47VjkyGrkyYH1UUzCPp3m0lCoUhv82Uv8BU2vVsT+1Uh0fOlm+12N7Uzk3UxKA0h1yhnx3mYcWMUwK0X8rMJacHO0i0aQO1RhbIQEuoV090uuWAL06x+hBBQrNsE1f5jI9Qg4ZpU+baGJ6N6qwSzM2cZswc0kaxgZi2OwYaiIgx2BdpRYOpbQ8+DGM6wOS83cnlUQ6x9qXyIcO+DcXIAoSVY2KbFIH8I4bsS9kSuC0CkoBJ3FB9xhR+F9oZ8I7QaQdA1UgG-J5dhNgIVKmyui4pe9tGsD592syD5qMUH2+0W6bIewDMP92DAD8SlSlNgVEBUDoccBTG+qUiTtkaiUcQKnI6sjtykpTyjDirejyB+pFwrsUQJ8nYZSQcJ2YwQcMj2KnZeK7diNNU5scBQloN5hujEmE8M8MbMYlptc1d6yuT9NABRT2AotlThQNTga+QNTKUEmU8HGKNu1pRmDFDn5P5ZuDXPjx9scwrJSBQaSTt2FZQQmUWFksjh6q6zARTujeYDAgcV-EJ5qWNZx41FeuoEjmWsGjmmLutkm+pFGHet-CtFaD9emzGqWhR3AxkI2k2iyWt4Dse41yZ0SVQBRGoW0koeaapMPRoU0M4BI6u8OvZSOxrkp3xm+RSUWdA8MAbACK0NjMFWMUhlBlp4b4uvZUuv2cuzUDR4wNTMomwXt1u4T+RgWh+aRGiHjFwIAA */
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
          guard: 'has valid extrude selection',
          actions: ['AST extrude'],
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

          entry: ['show default planes', 'reset camera position'],
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

          entry: 'setup client side sketch segments',
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
              actions: ['Set selection'],
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
          ],

          entry: 'assign tool in context',
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

      entry: [
        'add axis n grid',
        'conditionally equip line tool',
        'clientToEngine cam sync direction',
      ],
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
  return hasStartProfileAt && pipeExpression.body.length > 2
}

export function canRectangleTool({
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

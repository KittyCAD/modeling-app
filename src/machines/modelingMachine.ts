import toast from 'react-hot-toast'
import { Mesh, Vector2, Vector3 } from 'three'
import { assign, fromPromise, sendTo, setup } from 'xstate'

import type {
  SetSelections,
  MouseState,
  SegmentOverlayPayload,
  SketchDetails,
  SketchDetailsUpdate,
  ExtrudeFacePlane,
  DefaultPlane,
  OffsetPlane,
  SketchTool,
  PlaneVisibilityMap,
  ModelingMachineContext,
} from '@src/machines/modelingSharedTypes'
import { modelingMachineDefaultContext } from '@src/machines/modelingSharedContext'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { Point3d } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Plane } from '@rust/kcl-lib/bindings/Plane'
import { letEngineAnimateAndSyncCamAfter } from '@src/clientSideScene/CameraControls'
import { deleteSegmentsOrProfiles } from '@src/clientSideScene/deleteSegment'
import {
  orthoScale,
  quaternionFromUpNForward,
} from '@src/clientSideScene/helpers'
import { DRAFT_DASHED_LINE } from '@src/clientSideScene/sceneConstants'
import type {
  OnMoveCallbackArgs,
  SceneInfra,
} from '@src/clientSideScene/sceneInfra'
import { DRAFT_POINT } from '@src/clientSideScene/sceneUtils'
import { createProfileStartHandle } from '@src/clientSideScene/segments'
import type { MachineManager } from '@src/components/MachineManagerProvider'
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
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  insertNamedConstant,
  replaceValueAtNodePath,
} from '@src/lang/modifyAst'
import {
  addIntersect,
  addSubtract,
  addUnion,
} from '@src/lang/modifyAst/boolean'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from '@src/lang/modifyAst/deleteSelection'
import { addOffsetPlane, addShell, addHole } from '@src/lang/modifyAst/faces'
import { addHelix } from '@src/lang/modifyAst/geometry'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
} from '@src/lang/modifyAst/sweeps'
import {
  addPatternCircular3D,
  addPatternLinear3D,
} from '@src/lang/modifyAst/pattern3D'
import { addFlatnessGdt } from '@src/lang/modifyAst/gdt'
import {
  addAppearance,
  addClone,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'
import {
  artifactIsPlaneWithPaths,
  getNodeFromPath,
  isCursorInFunctionDefinition,
  isNodeSafeToReplacePath,
  stringifyPathToNode,
  updatePathToNodesAfterEdit,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  getFaceCodeRef,
  getPathsFromArtifact,
  getPathsFromPlaneArtifact,
  getPlaneFromArtifact,
} from '@src/lang/std/artifactGraph'
import {
  crossProduct,
  isCursorInSketchCommandRange,
  updateSketchDetailsNodePaths,
} from '@src/lang/util'
import type {
  Artifact,
  ArtifactId,
  KclValue,
  PathToNode,
  Program,
  VariableDeclaration,
  VariableDeclarator,
} from '@src/lang/wasm'
import { parse, recast, resultIsOk, sketchFromKclValue } from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  getEventForSegmentSelection,
  handleSelectionBatch,
  updateExtraSegments,
  updateSelections,
} from '@src/lib/selections'
import {
  codeManager,
  editorManager,
  engineCommandManager,
  kclManager,
  rustContext,
  sceneEntitiesManager,
  sceneInfra,
} from '@src/lib/singletons'
import { err, reportRejection, trap } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import { kclEditorActor } from '@src/machines/kclEditorMachine'
import {
  type EquipTool,
  sketchSolveMachine,
} from '@src/machines/sketchSolve/sketchSolveMode'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import type CodeManager from '@src/lang/codeManager'
import type EditorManager from '@src/editor/manager'
import type { KclManager } from '@src/lang/KclSingleton'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type RustContext from '@src/lib/rustContext'
import { addChamfer, addFillet } from '@src/lang/modifyAst/edges'

export type ModelingMachineEvent =
  | {
      type: 'Enter sketch'
      data?: {
        forceNewSketch?: boolean
        keepDefaultPlaneVisibility?: boolean
      }
    }
  | { type: 'Sketch On Face' }
  | {
      type: 'Select sketch plane'
      data: DefaultPlane | ExtrudeFacePlane | OffsetPlane
    }
  | {
      type: 'Select sketch solve plane'
      data: ArtifactId
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
  | {
      type: 'Pattern Circular 3D'
      data: ModelingCommandSchema['Pattern Circular 3D']
    }
  | {
      type: 'Pattern Linear 3D'
      data: ModelingCommandSchema['Pattern Linear 3D']
    }
  | { type: 'Make'; data: ModelingCommandSchema['Make'] }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Sweep'; data?: ModelingCommandSchema['Sweep'] }
  | { type: 'Loft'; data?: ModelingCommandSchema['Loft'] }
  | { type: 'Shell'; data?: ModelingCommandSchema['Shell'] }
  | { type: 'Hole'; data?: ModelingCommandSchema['Hole'] }
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
  | {
      type: 'Update sketch details'
      data: Partial<SketchDetails>
    }
  | { type: 'Appearance'; data: ModelingCommandSchema['Appearance'] }
  | { type: 'Translate'; data: ModelingCommandSchema['Translate'] }
  | { type: 'Rotate'; data: ModelingCommandSchema['Rotate'] }
  | { type: 'Scale'; data: ModelingCommandSchema['Scale'] }
  | { type: 'Clone'; data: ModelingCommandSchema['Clone'] }
  | { type: 'GDT Flatness'; data: ModelingCommandSchema['GDT Flatness'] }
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
  | {
      type: 'Set Segment Overlays'
      data: SegmentOverlayPayload
    }
  | {
      type: 'Center camera on selection'
    }
  | {
      type: 'Delete segments'
      data: PathToNode[]
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
  | {
      type: 'equip tool'
      data: { tool: EquipTool }
    }
  | {
      type:
        | 'coincident'
        | 'LinesEqualLength'
        | 'Vertical'
        | 'Horizontal'
        | 'Parallel'
        | 'Distance'
    }
  | { type: 'unequip tool' }
  | {
      type: 'sketch solve tool changed'
      data: { tool: EquipTool | null }
    }
  | { type: 'delete selected' }

const NO_INPUT_PROVIDED_MESSAGE = 'No input provided'

export const modelingMachine = setup({
  types: {
    context: {} as ModelingMachineContext,
    events: {} as ModelingMachineEvent,
    input: {} as ModelingMachineContext,
  },
  guards: {
    'should use new sketch mode': ({ context }) => {
      return context.store.useNewSketchMode?.current === true
    },
    'Selection is on face': ({
      context: { selectionRanges, kclManager: providedKclManager },
      event,
    }): boolean => {
      if (event.type !== 'Enter sketch') return false
      if (event.data?.forceNewSketch) return false
      const theKclManager = providedKclManager ? providedKclManager : kclManager
      if (artifactIsPlaneWithPaths(selectionRanges)) {
        return true
      } else if (selectionRanges.graphSelections[0]?.artifact) {
        // See if the selection is "close enough" to be coerced to the plane later
        const maybePlane = getPlaneFromArtifact(
          selectionRanges.graphSelections[0].artifact,
          theKclManager.artifactGraph
        )
        return !err(maybePlane)
      }
      if (
        isCursorInFunctionDefinition(
          theKclManager.ast,
          selectionRanges.graphSelections[0]
        )
      ) {
        return false
      }
      return !!isCursorInSketchCommandRange(
        theKclManager.artifactGraph,
        selectionRanges
      )
    },
    'Has exportable geometry': () => false,
    'has valid selection for deletion': () => false,
    // TODO: figure out if we really need this one, was separate from 'no kcl errors'
    'is-error-free': ({ context }): boolean => {
      const theKclManager = context.kclManager ? context.kclManager : kclManager
      return theKclManager.errors.length === 0 && !theKclManager.hasErrors()
    },
    'is editing existing sketch': ({
      context: { sketchDetails, kclManager: providedKclManager },
    }) => {
      const theKclManager = providedKclManager ? providedKclManager : kclManager
      return isEditingExistingSketch({
        sketchDetails,
        kclManager: theKclManager,
      })
    },
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
    'Can constrain angle': ({
      context: { selectionRanges, kclManager: providedKclManager },
    }) => {
      const angleBetween = angleBetweenInfo({
        selectionRanges,
      })
      if (err(angleBetween)) return false
      const theKclManager = providedKclManager ? providedKclManager : kclManager
      const angleLength = angleLengthInfo({
        selectionRanges,
        angleOrLength: 'setAngle',
        kclManager: theKclManager,
      })
      if (err(angleLength)) return false
      return angleBetween.enabled || angleLength.enabled
    },
    'Can constrain length': ({
      context: { selectionRanges, kclManager: providedKclManager },
    }) => {
      const theKclManager = providedKclManager ? providedKclManager : kclManager
      const angleLength = angleLengthInfo({
        selectionRanges,
        kclManager: theKclManager,
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
      context: {
        selectionRanges,
        kclManager: providedKclManager,
        wasmInstance,
      },
      event,
    }) => {
      if (event.type !== 'Constrain remove constraints') return false

      const pathToNodes = event.data
        ? [event.data]
        : selectionRanges.graphSelections.map(({ codeRef }) => {
            return codeRef.pathToNode
          })
      const info = removeConstrainingValuesInfo(
        pathToNodes,
        providedKclManager,
        wasmInstance
      )
      if (err(info)) return false
      return info.enabled
    },
    'Can convert to named value': ({ context, event }) => {
      if (event.type !== 'Constrain with named value') return false
      if (!event.data) return false

      const theKclManager = context.kclManager ? context.kclManager : kclManager
      const wasmInstance = context.wasmInstance

      const ast = parse(recast(theKclManager.ast, wasmInstance), wasmInstance)
      if (err(ast) || !ast.program || ast.errors.length > 0) return false
      const isSafeRetVal = isNodeSafeToReplacePath(
        ast.program,

        event.data.currentValue.pathToNode
      )
      if (err(isSafeRetVal)) return false
      return isSafeRetVal.isSafe
    },
    'next is tangential arc': ({
      context: { sketchDetails, currentTool, kclManager: providedKclManager },
    }) => {
      const theKclManager = providedKclManager ? providedKclManager : kclManager
      return (
        currentTool === 'tangentialArc' &&
        isEditingExistingSketch({ sketchDetails, kclManager: theKclManager })
      )
    },
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
        console.error(event.output)
        toast.error(event.output.message)
      } else if ('data' in event && event.data instanceof Error) {
        console.error(event.data)
        toast.error(event.data.message)
      } else if ('error' in event && event.error instanceof Error) {
        console.error(event.error)
        toast.error(event.error.message)
      }
    },
    toastErrorAndExitSketch: ({ event, context }) => {
      if ('output' in event && event.output instanceof Error) {
        console.error(event.output)
        toast.error(event.output.message)
      } else if ('data' in event && event.data instanceof Error) {
        console.error(event.data)
        toast.error(event.data.message)
      } else if ('error' in event && event.error instanceof Error) {
        console.error(event.error)
        toast.error(event.error.message)
      }

      const theSceneEntitiesManager = context.sceneEntitiesManager
        ? context.sceneEntitiesManager
        : sceneEntitiesManager
      // Clean up the THREE.js sketch scene
      theSceneEntitiesManager.tearDownSketch({ removeAxis: false })
      theSceneEntitiesManager.removeSketchGrid()
      theSceneEntitiesManager.resetOverlays()
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
      defaultPlaneVisibility: ({ context }) => {
        const theKclManager = context.kclManager
          ? context.kclManager
          : kclManager
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        theKclManager.hidePlanes()
        return { xy: false, xz: false, yz: false }
      },
    }),
    'reset sketch metadata': assign({
      sketchDetails: null,
      sketchEnginePathId: '',
      sketchPlaneId: '',
    }),
    'reset camera position': (context) => {
      const theEngineCommandManager = context.context.engineCommandManager
        ? context.context.engineCommandManager
        : engineCommandManager
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      theEngineCommandManager.sendSceneCommand({
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
    'set up draft line': assign(
      ({
        context: {
          sketchDetails,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          kclManager: providedKclManager,
          wasmInstance,
        },
        event,
      }) => {
        if (!sketchDetails) return {}
        if (event.type !== 'Add start point') return {}
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const theKclManager = providedKclManager
          ? providedKclManager
          : kclManager

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        theSceneEntitiesManager
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
            const theCodeManager = providedCodeManager
              ? providedCodeManager
              : codeManager
            return theCodeManager.updateEditorWithAstAndWriteToFile(
              theKclManager.ast,
              undefined,
              wasmInstance
            )
          })
        return {
          sketchDetails: {
            ...sketchDetails,
            sketchEntryNodePath: event.data.sketchEntryNodePath,
            sketchNodePaths: event.data.sketchNodePaths,
          },
        }
      }
    ),
    'set up draft arc': assign(
      ({
        context: {
          sketchDetails,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          kclManager: providedKclManager,
          wasmInstance,
        },
        event,
      }) => {
        if (!sketchDetails) return {}
        if (event.type !== 'Continue existing profile') return {}
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const theKclManager = providedKclManager
          ? providedKclManager
          : kclManager

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        theSceneEntitiesManager
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
            const theCodeManager = providedCodeManager
              ? providedCodeManager
              : codeManager
            return theCodeManager.updateEditorWithAstAndWriteToFile(
              theKclManager.ast,
              undefined,
              wasmInstance
            )
          })
        return {
          sketchDetails: {
            ...sketchDetails,
            sketchEntryNodePath: event.data.sketchEntryNodePath,
            sketchNodePaths: event.data.sketchNodePaths,
          },
        }
      }
    ),
    'listen for rectangle origin': ({
      context: {
        sketchDetails,
        sceneEntitiesManager: providedSceneEntitiesManager,
        sceneInfra: providedSceneInfra,
      },
    }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )

      const theSceneEntitiesManager = providedSceneEntitiesManager
        ? providedSceneEntitiesManager
        : sceneEntitiesManager
      const theSceneInfra = providedSceneInfra ? providedSceneInfra : sceneInfra
      // Position the click raycast plane

      theSceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      theSceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      theSceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails, theSceneEntitiesManager)
        },
        onClick: (args) => {
          theSceneEntitiesManager.removeDraftPoint()
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            theSceneInfra.modelingSend({
              type: 'click in scene',
              data: theSceneEntitiesManager.getSnappedDragPoint(
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

    'listen for center rectangle origin': ({
      context: {
        sketchDetails,
        sceneEntitiesManager: providedSceneEntitiesManager,
        sceneInfra: providedSceneInfra,
      },
    }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )
      const theSceneEntitiesManager = providedSceneEntitiesManager
        ? providedSceneEntitiesManager
        : sceneEntitiesManager
      const theSceneInfra = providedSceneInfra ? providedSceneInfra : sceneInfra
      // Position the click raycast plane

      theSceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      theSceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      theSceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails, theSceneEntitiesManager)
        },
        onClick: (args) => {
          theSceneEntitiesManager.removeDraftPoint()
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            theSceneInfra.modelingSend({
              type: 'Add center rectangle origin',
              data: theSceneEntitiesManager.getSnappedDragPoint(
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

    'listen for circle origin': ({
      context: {
        sketchDetails,
        sceneEntitiesManager: providedSceneEntitiesManager,
        sceneInfra: providedSceneInfra,
      },
    }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )
      const theSceneEntitiesManager = providedSceneEntitiesManager
        ? providedSceneEntitiesManager
        : sceneEntitiesManager
      const theSceneInfra = providedSceneInfra ? providedSceneInfra : sceneInfra
      // Position the click raycast plane

      theSceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      theSceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      theSceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails, theSceneEntitiesManager)
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            theSceneInfra.modelingSend({
              type: 'Add circle origin',
              data: theSceneEntitiesManager.getSnappedDragPoint(
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
    'listen for circle first point': ({
      context: {
        sketchDetails,
        sceneEntitiesManager: providedSceneEntitiesManager,
        sceneInfra: providedSceneInfra,
      },
    }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )
      const theSceneEntitiesManager = providedSceneEntitiesManager
        ? providedSceneEntitiesManager
        : sceneEntitiesManager
      const theSceneInfra = providedSceneInfra ? providedSceneInfra : sceneInfra
      // Position the click raycast plane

      theSceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      theSceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      theSceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails, theSceneEntitiesManager)
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            theSceneInfra.modelingSend({
              type: 'Add first point',
              data: theSceneEntitiesManager.getSnappedDragPoint(
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
    'listen for circle second point': ({
      context: {
        sketchDetails,
        sceneEntitiesManager: providedSceneEntitiesManager,
        sceneInfra: providedSceneInfra,
      },
      event,
    }) => {
      if (!sketchDetails) return
      if (event.type !== 'Add first point') return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )
      const theSceneEntitiesManager = providedSceneEntitiesManager
        ? providedSceneEntitiesManager
        : sceneEntitiesManager
      const theSceneInfra = providedSceneInfra ? providedSceneInfra : sceneInfra
      // Position the click raycast plane

      theSceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      theSceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      const dummy = new Mesh()
      dummy.position.set(0, 0, 0)
      const scale = theSceneInfra.getClientSceneScaleFactor(dummy)
      const position = new Vector3(event.data[0], event.data[1], 0)
      position.applyQuaternion(quaternion)
      const draftPoint = createProfileStartHandle({
        isDraft: true,
        from: event.data,
        scale,
        theme: theSceneInfra.theme,
      })
      draftPoint.position.copy(position)
      theSceneInfra.scene.add(draftPoint)

      theSceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(args, sketchDetails, theSceneEntitiesManager)
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            theSceneInfra.modelingSend({
              type: 'Add second point',
              data: {
                p1: event.data,
                p2: theSceneEntitiesManager.getSnappedDragPoint(
                  twoD,
                  args.intersects,
                  args.mouseEvent
                ).snappedPoint,
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
      defaultPlaneVisibility: ({ context }) => {
        const theKclManager = context.kclManager
          ? context.kclManager
          : kclManager
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        theKclManager.showPlanes()
        return { xy: true, xz: true, yz: true }
      },
    }),
    'show default planes if no errors': assign({
      defaultPlaneVisibility: ({ context }) => {
        const theKclManager = context.kclManager
          ? context.kclManager
          : kclManager
        if (!theKclManager.hasErrors()) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          theKclManager.showPlanes()
          return { xy: true, xz: true, yz: true }
        }
        return { ...context.defaultPlaneVisibility }
      },
    }),
    'show planes sketch no face': assign(({ event, context }) => {
      if (event.type !== 'Enter sketch') return {}
      if (event.data?.keepDefaultPlaneVisibility) {
        // When entering via right-click "Start sketch on selection", show planes only if not requested to keep current visibility
        return {}
      }
      void kclManager.showPlanes()
      return { defaultPlaneVisibility: { xy: true, xz: true, yz: true } }
    }),
    'setup noPoints onClick listener': ({
      context: {
        sketchDetails,
        currentTool,
        sceneEntitiesManager: providedSceneEntitiesManager,
        sceneInfra: providedSceneInfra,
      },
    }) => {
      if (!sketchDetails) return
      const theSceneEntitiesManager = providedSceneEntitiesManager
        ? providedSceneEntitiesManager
        : sceneEntitiesManager
      const theSceneInfra = providedSceneInfra ? providedSceneInfra : sceneInfra
      theSceneEntitiesManager.setupNoPointsListener({
        sketchDetails,
        currentTool,
        afterClick: (_, data) =>
          theSceneInfra.modelingSend(
            currentTool === 'tangentialArc'
              ? { type: 'Continue existing profile', data }
              : currentTool === 'arc'
                ? { type: 'Add start point', data }
                : { type: 'Add start point', data }
          ),
      })
    },
    'add axis n grid': ({
      context: {
        sketchDetails,
        codeManager: providedCodeManager,
        sceneEntitiesManager: providedSceneEntitiesManager,
        kclManager: providedKclManager,
        wasmInstance,
      },
    }) => {
      if (!sketchDetails) return
      if (localStorage.getItem('disableAxis')) return
      const theSceneEntitiesManager = providedSceneEntitiesManager
        ? providedSceneEntitiesManager
        : sceneEntitiesManager
      const theKclManager = providedKclManager ? providedKclManager : kclManager
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      theSceneEntitiesManager.createSketchAxis(
        sketchDetails.zAxis,
        sketchDetails.yAxis,
        sketchDetails.origin
      )

      const theCodeManager = providedCodeManager
        ? providedCodeManager
        : codeManager
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      theCodeManager.updateEditorWithAstAndWriteToFile(
        theKclManager.ast,
        undefined,
        wasmInstance
      )
    },
    'reset client scene mouse handlers': ({ context }) => {
      // when not in sketch mode we don't need any mouse listeners
      // (note the orbit controls are always active though)
      const theSceneInfra = context.sceneInfra ? context.sceneInfra : sceneInfra
      theSceneInfra.resetMouseListeners()
    },
    'clientToEngine cam sync direction': ({ context }) => {
      const theSceneInfra = context.sceneInfra ? context.sceneInfra : sceneInfra
      theSceneInfra.camControls.syncDirection = 'clientToEngine'
    },
    /** TODO: this action is hiding unawaited asynchronous code */
    'set selection filter to faces only': ({ context }) => {
      const theKclManager = context.kclManager ? context.kclManager : kclManager
      theKclManager.setSelectionFilter(['face', 'object'])
    },
    /** TODO: this action is hiding unawaited asynchronous code */
    'set selection filter to defaults': ({ context }) => {
      const theKclManager = context.kclManager ? context.kclManager : kclManager
      theKclManager.setSelectionFilterToDefault()
    },
    'Delete segments': ({
      context: {
        sketchDetails,
        codeManager: providedCodeManager,
        kclManager: providedKclManager,
        wasmInstance,
        rustContext: providedRustContext,
        sceneEntitiesManager: providedSceneEntitiesManager,
        sceneInfra: providedSceneInfra,
      },
      event,
    }) => {
      if (event.type !== 'Delete segments') return
      if (!sketchDetails || !event.data) return
      const theKclManager = providedKclManager ? providedKclManager : kclManager
      const theCodeManager = providedCodeManager
        ? providedCodeManager
        : codeManager
      const theRustContext = providedRustContext
        ? providedRustContext
        : rustContext
      const theSceneEntitiesManager = providedSceneEntitiesManager
        ? providedSceneEntitiesManager
        : sceneEntitiesManager
      const theSceneInfra = providedSceneInfra ? providedSceneInfra : sceneInfra
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      deleteSegmentsOrProfiles({
        pathToNodes: event.data,
        sketchDetails,
        dependencies: {
          kclManager: theKclManager,
          codeManager: theCodeManager,
          wasmInstance,
          rustContext: theRustContext,
          sceneEntitiesManager: theSceneEntitiesManager,
          sceneInfra: theSceneInfra,
        },
      })
        .then(() => {
          return theCodeManager.updateEditorWithAstAndWriteToFile(
            theKclManager.ast,
            undefined,
            wasmInstance
          )
        })
        .catch((e) => {
          console.warn('error', e)
        })
    },
    'remove draft entities': ({ context }) => {
      const theSceneInfra = context.sceneInfra ? context.sceneInfra : sceneInfra
      const draftPoint = theSceneInfra.scene.getObjectByName(DRAFT_POINT)
      if (draftPoint) {
        theSceneInfra.scene.remove(draftPoint)
      }
      const draftLine = theSceneInfra.scene.getObjectByName(DRAFT_DASHED_LINE)
      if (draftLine) {
        theSceneInfra.scene.remove(draftLine)
      }
    },
    'add draft line': ({ event, context }) => {
      if (
        event.type !== 'Add start point' &&
        event.type !== 'xstate.done.actor.setup-client-side-sketch-segments9'
      )
        return

      const theSceneEntitiesManager = context.sceneEntitiesManager
        ? context.sceneEntitiesManager
        : sceneEntitiesManager
      const theSceneInfra = context.sceneInfra ? context.sceneInfra : sceneInfra
      const theKclManager = context.kclManager ? context.kclManager : kclManager
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
        theKclManager.ast,
        sketchEntryNodePath,
        'VariableDeclaration'
      )
      if (err(varDec)) return
      const varName = varDec.node.declaration.id.name
      const sg = sketchFromKclValue(theKclManager.variables[varName], varName)
      if (err(sg)) return
      const lastSegment = sg.paths[sg.paths.length - 1] || sg.start
      const to = lastSegment.to

      const { group, updater } = theSceneEntitiesManager.drawDashedLine({
        from: to,
        to: [to[0] + 0.001, to[1] + 0.001],
      })
      theSceneInfra.scene.add(group)
      const orthoFactor = orthoScale(theSceneInfra.camControls.camera)
      theSceneInfra.setCallbacks({
        onMove: (args) => {
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          if (!context.sketchDetails) return
          const { snappedPoint, isSnapped } =
            theSceneEntitiesManager.getSnappedDragPoint(
              intersectionPoint.twoD,
              args.intersects,
              args.mouseEvent
            )
          if (isSnapped) {
            theSceneEntitiesManager.positionDraftPoint({
              snappedPoint: new Vector2(...snappedPoint),
              origin: context.sketchDetails.origin,
              yAxis: context.sketchDetails.yAxis,
              zAxis: context.sketchDetails.zAxis,
            })
          } else {
            theSceneEntitiesManager.removeDraftPoint()
          }
          updater(group, snappedPoint, orthoFactor)
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
    'Set selection': assign(
      ({
        context: {
          selectionRanges,
          sketchDetails,
          engineCommandManager: providedEngineCommandManager,
          editorManager: providedEditorManager,
          kclEditorMachine: providedKclEditorMachine,
        },
        event,
      }) => {
        // this was needed for ts after adding 'Set selection' action to on done modal events
        const setSelections =
          ('data' in event &&
            typeof event.data === 'object' &&
            'selectionType' in event.data &&
            event.data) ||
          ('output' in event &&
            event.output &&
            'selectionType' in event.output &&
            event.output) ||
          null
        if (!setSelections) return {}
        const theEditorManager = providedEditorManager
          ? providedEditorManager
          : editorManager
        const theKclEditorMachine = providedKclEditorMachine
          ? providedKclEditorMachine
          : kclEditorActor

        let selections: Selections = {
          graphSelections: [],
          otherSelections: [],
        }
        if (setSelections.selectionType === 'singleCodeCursor') {
          if (!setSelections.selection && theEditorManager.isShiftDown) {
            // if the user is holding shift, but they didn't select anything
            // don't nuke their other selections (frustrating to have one bad click ruin your
            // whole selection)
            selections = {
              graphSelections: selectionRanges.graphSelections,
              otherSelections: selectionRanges.otherSelections,
            }
          } else if (
            !setSelections.selection &&
            !theEditorManager.isShiftDown
          ) {
            selections = {
              graphSelections: [],
              otherSelections: [],
            }
          } else if (setSelections.selection && !theEditorManager.isShiftDown) {
            selections = {
              graphSelections: [setSelections.selection],
              otherSelections: [],
            }
          } else if (setSelections.selection && theEditorManager.isShiftDown) {
            // selecting and deselecting multiple objects

            /**
             * There are two scenarios:
             * 1. General case:
             *    When selecting and deselecting edges,
             *    faces or segment (during sketch edit)
             *    we use its artifact ID to identify the selection
             * 2. Initial sketch setup:
             *    The artifact is not yet created
             *    so we use the codeRef.range
             */

            let updatedSelections: typeof selectionRanges.graphSelections

            // 1. General case: Artifact exists, use its ID
            if (setSelections.selection.artifact?.id) {
              // check if already selected
              const alreadySelected = selectionRanges.graphSelections.some(
                (selection) =>
                  selection.artifact?.id ===
                  setSelections.selection?.artifact?.id
              )
              if (alreadySelected && setSelections.selection?.artifact?.id) {
                // remove it
                updatedSelections = selectionRanges.graphSelections.filter(
                  (selection) =>
                    selection.artifact?.id !==
                    setSelections.selection?.artifact?.id
                )
              } else {
                // add it
                updatedSelections = [
                  ...selectionRanges.graphSelections,
                  setSelections.selection,
                ]
              }
            } else {
              // 2. Initial sketch setup: Artifact not yet created – use codeRef.range
              const selectionRange = JSON.stringify(
                setSelections.selection?.codeRef?.range
              )

              // check if already selected
              const alreadySelected = selectionRanges.graphSelections.some(
                (selection) => {
                  const existingRange = JSON.stringify(selection.codeRef?.range)
                  return existingRange === selectionRange
                }
              )

              if (alreadySelected && setSelections.selection?.codeRef?.range) {
                // remove it
                updatedSelections = selectionRanges.graphSelections.filter(
                  (selection) =>
                    JSON.stringify(selection.codeRef?.range) !== selectionRange
                )
              } else {
                // add it
                updatedSelections = [
                  ...selectionRanges.graphSelections,
                  setSelections.selection,
                ]
              }
            }

            selections = {
              graphSelections: updatedSelections,
              otherSelections: selectionRanges.otherSelections,
            }
          }

          const { engineEvents, codeMirrorSelection, updateSceneObjectColors } =
            handleSelectionBatch({
              selections,
            })
          if (codeMirrorSelection) {
            theKclEditorMachine.send({
              type: 'setLastSelectionEvent',
              data: {
                codeMirrorSelection,
                scrollIntoView: setSelections.scrollIntoView ?? false,
              },
            })
          }

          // If there are engine commands that need sent off, send them
          // TODO: This should be handled outside of an action as its own
          // actor, so that the system state is more controlled.
          const theEngineCommandManager = providedEngineCommandManager
            ? providedEngineCommandManager
            : engineCommandManager
          engineEvents &&
            engineEvents.forEach((event) => {
              theEngineCommandManager
                .sendSceneCommand(event)
                .catch(reportRejection)
            })
          updateSceneObjectColors()

          return {
            selectionRanges: selections,
          }
        }

        if (setSelections.selectionType === 'mirrorCodeMirrorSelections') {
          return {
            selectionRanges: setSelections.selection,
          }
        }

        if (
          setSelections.selectionType === 'axisSelection' ||
          setSelections.selectionType === 'defaultPlaneSelection'
        ) {
          if (theEditorManager.isShiftDown) {
            selections = {
              graphSelections: selectionRanges.graphSelections,
              otherSelections: [setSelections.selection],
            }
          } else {
            selections = {
              graphSelections: [],
              otherSelections: [setSelections.selection],
            }
          }
          return {
            selectionRanges: selections,
          }
        }

        if (setSelections.selectionType === 'completeSelection') {
          const codeMirrorSelection = theEditorManager.createEditorSelection(
            setSelections.selection
          )

          // This turns the selection into blue, needed when selecting with ctrl+A
          const { updateSceneObjectColors } = handleSelectionBatch({
            selections: setSelections.selection,
          })
          updateSceneObjectColors()

          theKclEditorMachine.send({
            type: 'setLastSelectionEvent',
            data: {
              codeMirrorSelection,
              scrollIntoView: false,
            },
          })
          if (!sketchDetails)
            return {
              selectionRanges: setSelections.selection,
            }
          return {
            selectionRanges: setSelections.selection,
            sketchDetails: {
              ...sketchDetails,
              sketchEntryNodePath:
                setSelections.updatedSketchEntryNodePath ||
                sketchDetails?.sketchEntryNodePath ||
                [],
              sketchNodePaths:
                setSelections.updatedSketchNodePaths ||
                sketchDetails?.sketchNodePaths ||
                [],
              planeNodePath:
                setSelections.updatedPlaneNodePath ||
                sketchDetails?.planeNodePath ||
                [],
            },
          }
        }

        return {}
      }
    ),
    'Set mouse state': () => {},
    'Set Segment Overlays': () => {},
    'Center camera on selection': () => {},
    'Submit to Text-to-CAD API': () => {},
    'Set sketchDetails': () => {},
    'debug-action': (data) => {
      console.log('re-eval debug-action', data)
    },
    'Toggle default plane visibility': assign(({ context, event }) => {
      if (event.type !== 'Toggle default plane visibility') return {}

      const currentVisibilityMap = context.defaultPlaneVisibility
      const currentVisibility = currentVisibilityMap[event.planeKey]
      const newVisibility = !currentVisibility
      const theKclManager = context.kclManager ? context.kclManager : kclManager

      theKclManager.engineCommandManager
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
      const theKclManager = context.kclManager ? context.kclManager : kclManager
      for (const planeKey of Object.keys(
        context.savedDefaultPlaneVisibility
      ) as (keyof PlaneVisibilityMap)[]) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        theKclManager.setPlaneVisibilityByKey(
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
    sketchSolveMachine,
    sketchExit: fromPromise(
      async (args: { input: { context: ModelingMachineContext } }) => {
        const context = args.input.context
        const store = context.store

        const theEngineCommandManager = context.engineCommandManager
          ? context.engineCommandManager
          : engineCommandManager
        const theSceneInfra = context.sceneInfra
          ? context.sceneInfra
          : sceneInfra
        const theKclManager = context.kclManager
          ? context.kclManager
          : kclManager
        const theSceneEntitiesManager = context.sceneEntitiesManager
          ? context.sceneEntitiesManager
          : sceneEntitiesManager

        // When cancelling the sketch mode we should disable sketch mode within the engine.
        await theEngineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'sketch_mode_disable' },
        })

        theSceneInfra.camControls.syncDirection = 'clientToEngine'

        if (store.cameraProjection?.current === 'perspective') {
          await theSceneInfra.camControls.snapToPerspectiveBeforeHandingBackControlToEngine()
        }

        theSceneInfra.camControls.syncDirection = 'engineToClient'

        // TODO: Re-evaluate if this pause/play logic is needed.
        // TODO: Do I need this video element?
        store.videoElement?.pause()

        await theKclManager
          .executeCode()
          .then(() => {
            if (
              !theEngineCommandManager.started &&
              theEngineCommandManager.connection?.websocket?.readyState ===
                WebSocket.CLOSED
            )
              return

            store.videoElement?.play().catch((e: Error) => {
              console.warn('Video playing was prevented', e)
            })
          })
          .catch(reportRejection)
        theSceneEntitiesManager.tearDownSketch({ removeAxis: false })
        theSceneEntitiesManager.removeSketchGrid()
        theSceneInfra.camControls.syncDirection = 'engineToClient'
        theSceneEntitiesManager.resetOverlays()
        theSceneInfra.stop()
      }
    ),
    /* Below are all the do-constrain sketch actors,
     * which aren't using updateModelingState and don't have the 'no kcl errors' guard yet */
    'do-constrain-remove-constraint': fromPromise(
      async ({
        input: {
          selectionRanges,
          sketchDetails,
          data,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          kclManager: providedKclManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'codeManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
          | 'kclManager'
        > & { data?: PathToNode }
      }) => {
        const constraint = applyRemoveConstrainingValues({
          selectionRanges,
          pathToNodes: data && [data],
          providedKclManager,
          wasmInstance,
        })
        if (trap(constraint)) return
        const { pathToNodeMap } = constraint
        if (!sketchDetails) return
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        let updatedAst = await theSceneEntitiesManager.updateAstAndRejigSketch(
          pathToNodeMap[0],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          constraint.modifiedAst,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments,
          wasmInstance
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return

        const theCodeManager = providedCodeManager
          ? providedCodeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          wasmInstance
        )

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
        input: {
          selectionRanges,
          sketchDetails,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'codeManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
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
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const updatedAst =
          await theSceneEntitiesManager.updateAstAndRejigSketch(
            sketchDetails.sketchEntryNodePath,
            sketchDetails.sketchNodePaths,
            sketchDetails.planeNodePath,
            modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments,
            wasmInstance
          )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const theCodeManager = providedCodeManager
          ? providedCodeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          wasmInstance
        )
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
        input: {
          selectionRanges,
          sketchDetails,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'codeManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
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
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const updatedAst =
          await theSceneEntitiesManager.updateAstAndRejigSketch(
            sketchDetails.sketchEntryNodePath || [],
            sketchDetails.sketchNodePaths,
            sketchDetails.planeNodePath,
            modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments,
            wasmInstance
          )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const theCodeManager = providedCodeManager
          ? providedCodeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          wasmInstance
        )
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
        input: {
          selectionRanges,
          sketchDetails,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'codeManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintHorzVertAlign({
          selectionRanges: selectionRanges,
          constraint: 'setVertDistance',
        })
        if (trap(constraint)) return
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const updatedAst =
          await theSceneEntitiesManager.updateAstAndRejigSketch(
            sketchDetails?.sketchEntryNodePath || [],
            sketchDetails.sketchNodePaths,
            sketchDetails.planeNodePath,
            modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments,
            wasmInstance
          )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const theCodeManager = providedCodeManager
          ? providedCodeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          wasmInstance
        )
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
        input: {
          selectionRanges,
          sketchDetails,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'codeManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintHorzVertAlign({
          selectionRanges: selectionRanges,
          constraint: 'setHorzDistance',
        })
        if (trap(constraint)) return
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const updatedAst =
          await theSceneEntitiesManager.updateAstAndRejigSketch(
            sketchDetails?.sketchEntryNodePath || [],
            sketchDetails.sketchNodePaths,
            sketchDetails.planeNodePath,
            modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments,
            wasmInstance
          )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const theCodeManager = providedCodeManager
          ? providedCodeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          wasmInstance
        )
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
        input: {
          selectionRanges,
          sketchDetails,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'codeManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        if (err(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const updatedAst =
          await theSceneEntitiesManager.updateAstAndRejigSketch(
            sketchDetails?.sketchEntryNodePath || [],
            sketchDetails.sketchNodePaths,
            sketchDetails.planeNodePath,
            modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments,
            wasmInstance
          )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const theCodeManager = providedCodeManager
          ? providedCodeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          wasmInstance
        )
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
        input: {
          selectionRanges,
          sketchDetails,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'codeManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const updatedAst =
          await theSceneEntitiesManager.updateAstAndRejigSketch(
            sketchDetails?.sketchEntryNodePath || [],
            sketchDetails.sketchNodePaths,
            sketchDetails.planeNodePath,
            modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments,
            wasmInstance
          )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const theCodeManager = providedCodeManager
          ? providedCodeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          wasmInstance
        )
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
        input: {
          selectionRanges,
          sketchDetails,
          codeManager: providedCodeManager,
          wasmInstance,
          sceneEntitiesManager: providedSceneEntitiesManager,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'codeManager'
          | 'wasmInstance'
          | 'sceneEntitiesManager'
        >
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
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const recastAst = parse(recast(modifiedAst, wasmInstance), wasmInstance)
        if (err(recastAst) || !resultIsOk(recastAst)) return

        const updatedAst =
          await theSceneEntitiesManager.updateAstAndRejigSketch(
            sketchDetails?.sketchEntryNodePath || [],
            sketchDetails.sketchNodePaths,
            sketchDetails.planeNodePath,
            recastAst.program,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments,
            wasmInstance
          )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const theCodeManager = providedCodeManager
          ? providedCodeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          wasmInstance
        )

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
        input: {
          selectionRanges,
          sketchDetails,
          codeManager: providedCodeManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'codeManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintEqualLength({
          selectionRanges,
        })
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint
        if (!sketchDetails) return
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const updatedAst =
          await theSceneEntitiesManager.updateAstAndRejigSketch(
            sketchDetails?.sketchEntryNodePath || [],
            sketchDetails.sketchNodePaths,
            sketchDetails.planeNodePath,
            modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments,
            wasmInstance
          )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        const theCodeManager = providedCodeManager
          ? providedCodeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          wasmInstance
        )
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
     * which aren't using updateModelingState and don't have the 'no kcl errors' guard yet */
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
    'animate-to-sketch-solve': fromPromise(
      async (_: { input: ArtifactId | undefined }) => {
        return {} as any // TODO
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
    'setup-client-side-sketch-segments': fromPromise(
      async ({
        input: {
          sketchDetails,
          selectionRanges,
          sceneInfra: providedSceneInfra,
          sceneEntitiesManager: providedSceneEntitiesManager,
          kclManager: providedKclManager,
          wasmInstance,
        },
      }: {
        input: {
          sketchDetails: SketchDetails | null
          selectionRanges: Selections
          sceneInfra?: SceneInfra
          sceneEntitiesManager?: SceneEntities
          kclManager?: KclManager
          wasmInstance?: ModuleType
        }
      }) => {
        if (!sketchDetails) {
          return
        }
        const theSceneInfra = providedSceneInfra
          ? providedSceneInfra
          : sceneInfra
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const theKclManager = providedKclManager
          ? providedKclManager
          : kclManager
        if (!sketchDetails.sketchEntryNodePath?.length) {
          // When unequipping eg. the three-point arc tool during placement of the 3rd point, sketchEntryNodePath is
          // empty if its the first profile in a sketch, but we still need to tear down and cancel the current tool properly.
          theSceneInfra.resetMouseListeners()
          theSceneEntitiesManager.tearDownSketch({ removeAxis: false })
          return
        }
        sceneInfra.resetMouseListeners()
        await theSceneEntitiesManager.setupSketch({
          sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
          sketchNodePaths: sketchDetails.sketchNodePaths,
          forward: sketchDetails.zAxis,
          up: sketchDetails.yAxis,
          position: sketchDetails.origin,
          maybeModdedAst: theKclManager.ast,
          selectionRanges,
          wasmInstance,
        })
        theSceneInfra.resetMouseListeners()

        theSceneEntitiesManager.setupSketchIdleCallbacks({
          sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
          forward: sketchDetails.zAxis,
          up: sketchDetails.yAxis,
          position: sketchDetails.origin,
          sketchNodePaths: sketchDetails.sketchNodePaths,
          planeNodePath: sketchDetails.planeNodePath,
          // We will want to pass sketchTools here
          // to add their interactions
          getEventForSegmentSelection,
          updateExtraSegments,
        })

        // We will want to update the context with sketchTools.
        // They'll be used for their .destroy() in tearDownSketch
        return undefined
      }
    ),
    'animate-to-sketch': fromPromise(
      async ({
        input: {
          selectionRanges,
          kclManager: providedKclManager,
          engineCommandManager: providedEngineCommandManager,
          sceneEntitiesManager: providedSceneEntitiesManager,
        },
      }: {
        input: {
          selectionRanges: Selections
          kclManager?: KclManager
          engineCommandManager?: ConnectionManager
          sceneEntitiesManager?: SceneEntities
        }
      }): Promise<ModelingMachineContext['sketchDetails']> => {
        const theKclManager = providedKclManager
          ? providedKclManager
          : kclManager
        const theEngineCommandManager = providedEngineCommandManager
          ? providedEngineCommandManager
          : engineCommandManager
        const theSceneEntitiesManager = providedSceneEntitiesManager
          ? providedSceneEntitiesManager
          : sceneEntitiesManager
        const artifact = selectionRanges.graphSelections[0].artifact
        const plane = getPlaneFromArtifact(
          artifact,
          theKclManager.artifactGraph
        )
        if (err(plane)) return Promise.reject(plane)
        // if the user selected a segment, make sure we enter the right sketch as there can be multiple on a plane
        // but still works if the user selected a plane/face by defaulting to the first path
        const mainPath =
          artifact?.type === 'segment' || artifact?.type === 'solid2d'
            ? artifact?.pathId
            : plane?.pathIds[0]
        let sketch: KclValue | null = null
        let planeVar: Plane | null = null

        for (const variable of Object.values(
          theKclManager.execState.variables
        )) {
          // find programMemory that matches path artifact
          if (
            variable?.type === 'Sketch' &&
            variable.value.artifactId === mainPath
          ) {
            sketch = variable
            break
          }
          if (
            // if the variable is an sweep, check if the underlying sketch matches the artifact
            variable?.type === 'Solid' &&
            variable.value.sketch.on.type === 'plane' &&
            variable.value.sketch.artifactId === mainPath
          ) {
            sketch = {
              type: 'Sketch',
              value: variable.value.sketch,
            }
            break
          }
          if (variable?.type === 'Plane' && plane.id === variable.value.id) {
            planeVar = variable.value
          }
        }

        if (!sketch || sketch.type !== 'Sketch') {
          if (artifact?.type !== 'plane')
            return Promise.reject(new Error('No sketch'))
          const planeCodeRef = getFaceCodeRef(artifact)
          if (planeVar && planeCodeRef) {
            const toTuple = (point: Point3d): [number, number, number] => [
              point.x,
              point.y,
              point.z,
            ]
            const planPath = getNodePathFromSourceRange(
              theKclManager.ast,
              planeCodeRef.range
            )
            await letEngineAnimateAndSyncCamAfter(
              theEngineCommandManager,
              artifact.id
            )
            const normal = crossProduct(planeVar.xAxis, planeVar.yAxis)
            return {
              sketchEntryNodePath: [],
              planeNodePath: planPath,
              sketchNodePaths: [],
              zAxis: toTuple(normal),
              yAxis: toTuple(planeVar.yAxis),
              origin: toTuple(planeVar.origin),
            }
          }
          return Promise.reject(new Error('No sketch'))
        }
        const info = await theSceneEntitiesManager.getSketchOrientationDetails(
          sketch.value
        )
        await letEngineAnimateAndSyncCamAfter(
          theEngineCommandManager,
          info?.sketchDetails?.faceId || ''
        )

        const sketchArtifact = theKclManager.artifactGraph.get(mainPath)
        if (sketchArtifact?.type !== 'path') {
          return Promise.reject(new Error('No sketch artifact'))
        }
        const sketchPaths = getPathsFromArtifact({
          artifact: theKclManager.artifactGraph.get(plane.id),
          sketchPathToNode: sketchArtifact?.codeRef?.pathToNode,
          artifactGraph: theKclManager.artifactGraph,
          ast: theKclManager.ast,
        })
        if (err(sketchPaths)) return Promise.reject(sketchPaths)
        let codeRef = getFaceCodeRef(plane)
        if (!codeRef) return Promise.reject(new Error('No plane codeRef'))
        // codeRef.pathToNode is not always populated correctly
        const planeNodePath = getNodePathFromSourceRange(
          theKclManager.ast,
          codeRef.range
        )
        return {
          sketchEntryNodePath: sketchArtifact.codeRef.pathToNode || [],
          sketchNodePaths: sketchPaths,
          planeNodePath,
          zAxis: info.sketchDetails.zAxis || null,
          yAxis: info.sketchDetails.yAxis || null,
          origin: info.sketchDetails.origin.map(
            (a) => a / sceneInfra.baseUnitMultiplier
          ) as [number, number, number],
          animateTargetId: info?.sketchDetails?.faceId || '',
        }
      }
    ),
    'Apply named value constraint': fromPromise(
      async ({
        input,
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'sketchDetails'
          | 'selectionRanges'
          | 'codeManager'
          | 'wasmInstance'
          | 'kclManager'
          | 'sceneEntitiesManager'
        > & {
          data?: ModelingCommandSchema['Constrain with named value']
        }
      }): Promise<SetSelections> => {
        const { selectionRanges, sketchDetails, data } = input
        if (!sketchDetails) {
          return Promise.reject(new Error('No sketch details'))
        }
        if (!data) {
          return Promise.reject(new Error('No data from command flow'))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager
        const theSceneEntitiesManager = input.sceneEntitiesManager
          ? input.sceneEntitiesManager
          : sceneEntitiesManager
        let pResult = parse(
          recast(theKclManager.ast, input.wasmInstance),
          input.wasmInstance
        )
        if (trap(pResult) || !resultIsOk(pResult))
          return Promise.reject(new Error('Unexpected compilation error'))
        let parsed = pResult.program

        let result: {
          modifiedAst: Node<Program>
          pathToReplaced: PathToNode | null
          exprInsertIndex: number
        } = {
          modifiedAst: parsed,
          pathToReplaced: null,
          exprInsertIndex: -1,
        }
        // If the user provided a constant name,
        // we need to insert the named constant
        // and then replace the node with the constant's name.
        if ('variableName' in data.namedValue) {
          const astAfterReplacement = replaceValueAtNodePath({
            ast: parsed,
            pathToNode: data.currentValue.pathToNode,
            newExpressionString: data.namedValue.variableName,
          })
          if (trap(astAfterReplacement)) {
            return Promise.reject(astAfterReplacement)
          }
          const parseResultAfterInsertion = parse(
            recast(
              insertNamedConstant({
                node: astAfterReplacement.modifiedAst,
                newExpression: data.namedValue,
              }),
              input.wasmInstance
            ),
            input.wasmInstance
          )
          result.exprInsertIndex = data.namedValue.insertIndex

          if (
            trap(parseResultAfterInsertion) ||
            !resultIsOk(parseResultAfterInsertion)
          )
            return Promise.reject(parseResultAfterInsertion)
          result = {
            modifiedAst: parseResultAfterInsertion.program,
            pathToReplaced: astAfterReplacement.pathToReplaced,
            exprInsertIndex: result.exprInsertIndex,
          }
        } else if ('valueText' in data.namedValue) {
          // If they didn't provide a constant name,
          // just replace the node with the value.
          const astAfterReplacement = replaceValueAtNodePath({
            ast: parsed,
            pathToNode: data.currentValue.pathToNode,
            newExpressionString: data.namedValue.valueText,
          })
          if (trap(astAfterReplacement)) {
            return Promise.reject(astAfterReplacement)
          }
          // The `replacer` function returns a pathToNode that assumes
          // an identifier is also being inserted into the AST, creating an off-by-one error.
          // This corrects that error, but TODO we should fix this upstream
          // to avoid this kind of error in the future.
          astAfterReplacement.pathToReplaced[1][0] =
            (astAfterReplacement.pathToReplaced[1][0] as number) - 1
          result = astAfterReplacement
        }

        pResult = parse(
          recast(result.modifiedAst, input.wasmInstance),
          input.wasmInstance
        )
        if (trap(pResult) || !resultIsOk(pResult))
          return Promise.reject(new Error('Unexpected compilation error'))
        parsed = pResult.program

        if (trap(parsed)) return Promise.reject(parsed)
        if (!result.pathToReplaced)
          return Promise.reject(new Error('No path to replaced node'))

        const {
          updatedSketchEntryNodePath,
          updatedSketchNodePaths,
          updatedPlaneNodePath,
        } = updateSketchDetailsNodePaths({
          sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
          sketchNodePaths: sketchDetails.sketchNodePaths,
          planeNodePath: sketchDetails.planeNodePath,
          exprInsertIndex: result.exprInsertIndex,
        })

        const updatedAst =
          await theSceneEntitiesManager.updateAstAndRejigSketch(
            updatedSketchEntryNodePath,
            updatedSketchNodePaths,
            updatedPlaneNodePath,
            parsed,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments,
            input.wasmInstance
          )
        if (err(updatedAst)) return Promise.reject(updatedAst)

        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        await theCodeManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined,
          input.wasmInstance
        )

        const selection = updateSelections(
          { 0: result.pathToReplaced },
          selectionRanges,
          updatedAst.newAst
        )
        if (err(selection)) return Promise.reject(selection)
        return {
          selectionType: 'completeSelection',
          selection,
          updatedSketchEntryNodePath,
          updatedSketchNodePaths,
          updatedPlaneNodePath,
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

    /* Below are recent modeling codemods that are using updateModelinState,
     * trigger toastError on Error, and have the 'no kcl errors' guard yet */
    extrudeAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['Extrude'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const { ast, artifactGraph } = theKclManager
        const astResult = addExtrude({
          ast,
          artifactGraph,
          ...input.data,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
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
        input:
          | {
              data: ModelingCommandSchema['Sweep'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const { ast } = theKclManager
        const astResult = addSweep({
          ...input.data,
          ast,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
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
        input:
          | {
              data: ModelingCommandSchema['Loft'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager
        const { ast } = theKclManager
        const astResult = addLoft({ ast, ...input.data })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager

        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
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
        input:
          | {
              data: ModelingCommandSchema['Revolve'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const { ast } = theKclManager
        const astResult = addRevolve({
          ast,
          ...input.data,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
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
        input:
          | {
              data: ModelingCommandSchema['Offset plane'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const { ast, artifactGraph, variables } = theKclManager
        const astResult = addOffsetPlane({
          ...input.data,
          ast,
          artifactGraph,
          variables,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: [pathToNode],
          }
        )
      }
    ),
    helixAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['Helix'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const { ast, artifactGraph } = theKclManager
        const astResult = addHelix({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
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
        input:
          | {
              data: ModelingCommandSchema['Shell'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const { ast, artifactGraph } = theKclManager
        const astResult = addShell({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: [pathToNode],
          }
        )
      }
    ),
    holeAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['Hole'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        // Remove once this command isn't experimental anymore
        let astWithNewSetting: Node<Program> | undefined
        if (kclManager.fileSettings.experimentalFeatures?.type !== 'Allow') {
          const ast = setExperimentalFeatures(codeManager.code, {
            type: 'Allow',
          })
          if (err(ast)) {
            return Promise.reject(ast)
          }

          astWithNewSetting = ast
        }

        const astResult = addHole({
          ...input,
          ast: astWithNewSetting ?? kclManager.ast,
          artifactGraph: kclManager.artifactGraph,
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
            rustContext,
          },
          {
            focusPath: [pathToNode],
          }
        )
      }
    ),
    filletAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['Fillet'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
              engineCommandManager?: ConnectionManager
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const { ast, artifactGraph } = theKclManager
        const astResult = addFillet({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext

        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: pathToNode,
          }
        )
      }
    ),
    chamferAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['Chamfer'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
              engineCommandManager?: ConnectionManager
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const { ast, artifactGraph } = theKclManager
        const astResult = addChamfer({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext

        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: pathToNode,
          }
        )
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
        input:
          | {
              data: ModelingCommandSchema['Appearance'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager
        const ast = theKclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addAppearance({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
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
        input:
          | {
              data: ModelingCommandSchema['Translate'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const ast = theKclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addTranslate({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
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
        input:
          | {
              data: ModelingCommandSchema['Rotate'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        const ast = theKclManager.ast
        const artifactGraph = kclManager.artifactGraph
        const result = addRotate({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(result)
        }

        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager

        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),
    scaleAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['Scale'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const ast = theKclManager.ast
        const artifactGraph = theKclManager.artifactGraph
        const result = addScale({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(result)
        }

        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
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
        input:
          | {
              data: ModelingCommandSchema['Clone'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager
        const ast = theKclManager.ast
        const artifactGraph = theKclManager.artifactGraph
        const result = addClone({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),
    gdtFlatnessAstMod: fromPromise(
      async ({
        input,
      }: {
        input: ModelingCommandSchema['GDT Flatness'] | undefined
      }) => {
        if (!input) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        // Remove once this command isn't experimental anymore
        let astWithNewSetting: Node<Program> | undefined
        if (kclManager.fileSettings.experimentalFeatures?.type !== 'Allow') {
          const ast = setExperimentalFeatures(codeManager.code, {
            type: 'Allow',
          })
          if (err(ast)) {
            return Promise.reject(ast)
          }

          astWithNewSetting = ast
        }

        const result = addFlatnessGdt({
          ...input,
          ast: astWithNewSetting ?? kclManager.ast,
          artifactGraph: kclManager.artifactGraph,
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
            rustContext,
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
        input:
          | {
              data: ModelingCommandSchema['Boolean Subtract'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager
        const ast = theKclManager.ast
        const artifactGraph = theKclManager.artifactGraph
        const result = addSubtract({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager

        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),
    boolUnionAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['Boolean Union'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager
        const ast = theKclManager.ast
        const artifactGraph = theKclManager.artifactGraph
        const result = addUnion({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager

        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),
    boolIntersectAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['Boolean Intersect'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const ast = theKclManager.ast
        const artifactGraph = theKclManager.artifactGraph
        const result = addIntersect({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),

    patternCircular3dAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['Pattern Circular 3D'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager
        const ast = theKclManager.ast
        const artifactGraph = theKclManager.artifactGraph
        const result = addPatternCircular3D({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager

        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),

    patternLinear3dAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['Pattern Linear 3D'] | undefined
              codeManager?: CodeManager
              kclManager?: KclManager
              editorManager?: EditorManager
              rustContext?: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const ast = theKclManager.ast
        const artifactGraph = theKclManager.artifactGraph
        const result = addPatternLinear3D({
          ...input.data,
          ast,
          artifactGraph,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theRustContext = input.rustContext
          ? input.rustContext
          : rustContext
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: theKclManager,
            editorManager: theEditorManager,
            codeManager: theCodeManager,
            rustContext: theRustContext,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),

    /* Pierre: looks like somewhat of a one-off */
    'reeval-node-paths': fromPromise(
      async ({
        input: { sketchDetails, kclManager: providedKclManager },
      }: {
        input: Pick<ModelingMachineContext, 'sketchDetails' | 'kclManager'>
      }) => {
        const errorMessage =
          'Unable to maintain sketch mode - code changes affected sketch references. Please re-enter.'
        if (!sketchDetails) {
          return Promise.reject(new Error(errorMessage))
        }
        const theKclManager = providedKclManager
          ? providedKclManager
          : kclManager

        // hasErrors is for parse errors, errors is for runtime errors
        if (theKclManager.errors.length > 0 || theKclManager.hasErrors()) {
          // if there's an error in the execution, we don't actually want to disable sketch mode
          // instead we'll give the user the chance to fix their error
          return {
            updatedEntryNodePath: sketchDetails.sketchEntryNodePath,
            updatedSketchNodePaths: sketchDetails.sketchNodePaths,
            updatedPlaneNodePath: sketchDetails.planeNodePath,
          }
        }

        const updatedPlaneNodePath = updatePathToNodesAfterEdit(
          theKclManager._lastAst,
          theKclManager.ast,
          sketchDetails.planeNodePath
        )

        if (err(updatedPlaneNodePath)) {
          return Promise.reject(new Error(errorMessage))
        }
        const maybePlaneArtifact = [
          ...theKclManager.artifactGraph.values(),
        ].find((artifact) => {
          const codeRef = getFaceCodeRef(artifact)
          if (!codeRef) return false

          return (
            stringifyPathToNode(codeRef.pathToNode) ===
            stringifyPathToNode(updatedPlaneNodePath)
          )
        })
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
          const face = theKclManager.artifactGraph.get(
            maybePlaneArtifact.faceId
          )
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
          theKclManager.artifactGraph,
          theKclManager.ast
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANmEBmAHQBGAJwBWABwKpSqTQDsUsQBoQAT0QAmdQBYJYmmPVjDh4YsMKZAX2e60GHPgIBlMOwACWCwwck5uWgYkEBY2cJ5ogQRBNRkzOUsFOTFFGhNZQ10DBBkZCXU7Szl5KRMTWxNXd3QsPEI-QIBbVABXYKD2EnYwSN5Yji4E0CSUqSlDCQUTGRpZefV1GWF1IsQxbYkTOS0FDRo5dRpDKTkmkA9W7w6AvyhOsFxAgHkANzAAJ0wJD0sFG0XG8V4Mzmigk8nUFwRMnUwhMG12CGOC0s9mEGlsOXsdweXkIAFUmBAhmAggBrfzkAAWAQwg2wmFB9DGrAm3F4xUEJg0EnEcls8gUhmWhjEJl0SWq+UOJmEsjETnUyjExJapOIH2G-wC5BI73+JAC3CCITCkzBzB5kMSQjmmvMq2MyxyaWECgxpxoIsMNGUpWyKh1njaBAAKqgoFBMDSMAAzEg9TCBJhA3A0n7YNgAI3ZHD09pijsmUJdUoUhxoeJk8wUmnycv0iHkgdDW1lOUqjTc9110dg9PYTKCqEwfwC7FQ0+NjLIMAg5YhVedyXmeOkMmDaSFGyk9gxc2ECzsEqs232cluQ5JbQk2AgSYIAFFPgC6QzGevKz5LdBEMY5DhkfY1BUKV9zkDEKjKTVNRbTVUXmB9mijfAXzfMBP2-I0xz-KgpCiB04k3aYhAacpJV9a5kSUexCg7BBRCkCR72OE8jk2JwpEjR4oBw98Pz4dh-h6DAAIooCqOSPFA02WpTAbCwrHbYoZWsCRHCuC45F9JZDME0kRLwnwAHcwDAJgZN5KZ+CEap1AkBsEVlfJQOMFitK0YR6ylGw8jxNFhFM59X3fAAZVAU3YeynXkwRFACtJQJuQx9xPHZWOgyQQ1WFVrCOJYFAi7CorwgAlMAfmnP5Esopzkk0Vyck0VLhCbG8MTEUo61xGw2oqWoKuEqqCC+FMU2CLMcxGLlwUAxyZlVVyrjUiDHBuGQzzxSQuwOpwMm08bzIIAAJVo+CauSWpSlYRRoJssmMOZ5gxUCaEDH7zguLR6kMc7Jp8RksEwO7Vucp7jAbZZaklFRhDPUbyjyFUNS2TQQdwq7p0WsiK1k6GEByDjDMcY5NhWdKdFYwR9jrLQxSyhxpVlXH3wAMXZJMEqW8iHOrZJql+85VmRPJbFAr7VjkTimy2E8uKsLm8KIZdOhTAEoZFkRLHKS5xBRKRNjsP1WIaBX5AGnFw2Bx8R0qvGAEEmCYMASHNChCe5En9bxBXrCsTYbBWex6a0vjzCFFsTDEdSBKdrCJrxmMfdgIFhj14CKgWSVqgKNE6gUKPEHyUxFggi8xXvbb1YIarUEGHPBeJ4W8-mEU3pbQzNhVKQMXqJZOMlK4LGRPFypToSLp8E0k1z5LNAC-JlDN7Ggrg1ijmMOEm01NELjEGFG6ITBuD95aA7zl6D42QzllOI5NIrhPXKWKmji0F6XFnsyk0ADiAARGMARubZ1zLATkRMNz3SSOTTiF4sib1pvUcuyR8gBRZuKdm+5OYAMinjAAQguJMZAXg9ELBJEgYRl4PQqGvbqig6hWHkCjVi+x745C9HUDQ6otCNzIQTShZJcB2nbvA0mghTB1iyAoC8+4R75D6hUeR94jj9WOL6YR5Cva4ACAASQIsEehUiVr6yRHCTQNhgwhRMJbYo6oWyBTqDLROydMJz0mgABSGIaQxRBsD-HIBmb2AQxAgIYYgsClNUE0xehgjEgpUTSH7GzSUHNBzeMAXjfx7BAkBGingL2RookxL2HElB1NShJJlCkrE6TWYShgjKRuYkWD-AFnAyxecbCLEMsobqUtNR9QxorNQ9R9whhKo3ZAJB6SVNaonRYVR4S+hRLLK2EEOJZHEFqVE7NG4gJCMMa0SZbQRAsbfZKWRJAnilqUVEWU8hfXsBTM29Qf4bCuI7XJxD3wxjAOJQQ85BBEFdtEm5nd5KeN0vsrJ6xjhvxKMoOE+wZAtnJpkf+AKXbvl8f8VAnQmDsDBagQQkAODLJEPvOYdQoJVGMmeJsAUnBChuInTGeLhyp3MhIRkr4wC+IWrAAgrtunYDTGEAIUBzRMGZGAUlnBIDLKmQFDIhlexsw2L5IwVdRD9S2ciDY-V1YSFgIyVAllRVkDgBKqVMrAjypIIqgILAmDhOGGuGFSUWojzHqsSWjhrgoj6moEUTZ8j91MPYeQ50fDjiZMQMglBIZ+uakkR5ZQMhFWyKUUCFQ+oJxsU4SweQVCMUTcmxkBBTn8xpMEN4BpYH+1hS1RQEFlSqgghqLUKSjgK1FHgrJBCcl8rnkmv8BByAtACNSwIEAej-DaL+Cc-5M0IMQLIVYbluqog0Jonc8FTjmBWJqVYeJLjIhrTOog3BYC0LwAESyHBmS4FNJAAIPwSCYB6NfIW-rs0ZFcvw7YxwlA2CcXsUKIpfRJOVnYDCk6zLTo3RIdDTIjF4wWfSa0LbPg-oBJwRe6qshmEcKUTUicZQaE4cUM2aTVTr2UuccQ2oiHYSw4yTDtacPvjw02sAhHAjWtXQAL24IMDNvTbktRUFYcoNxrAXFVHkTY+0LyDKxYekMZcUNPm47Wvjf4BMa0fc+wx4nsBSc+H+lkBZBi+3I2baQyx+GONPqUVFnp2oHpQUzCCd6MM8fM8QSz5oX1-ClYvRzT602AY7sBndZdsTVCxbYJw+xHHvKlIsdUspOoZCHSFpkpmN3hYfbgJ9UXDGuxIT4AIAANcjjjOJ1CORceEmDE4Nl0je75lgPKGedsJHjFXsN42q7VkgL6GtNYAJptbrLKfcuzxA1z2lw-hbljVaF02KCdRnxsmbC9NyLc3DEriXlu0mu61602qLYI5WwvoKM4hUVSgNFBld4+d98M2rMBCTPgdgm65MduzSsQMaJjDGtONUC4X0pZuQM6cOx60-uTcZFVy7L7Pb-E9rgCA2AwlAiNKThLLm7si03hxPEqIE4S1qFoCNog9tCjxGoGWKJscA4szV4HNm7MycwHoAIf7sBQFwOR0CcJcS7Rri2M8ijXLqeDWobICd-moefBNgXEWhd1eI7Fv94vJc4Bl21hYcghSa9RBBmDCBZAojhJYZWDZ6MVH5-xi7xurtBE-UwOcqAWvkbd1YF6-ULwfORF9fqkgC2SicGXSOvuzP+9my+2AwfQ8BGW7TrcKg3eKdLuqbISxcpaWfosFBSg2ZSjqBnyrWfgdgAAI49Ac6DqA4PyOGSDGsKoOQ+xy3RaYTrQUE5ehb1NwH+PDFMG9ub6gRf5JVsDFoDSShH5imd+KOsyizZ0VSryk7OOcd44Dy+-4yrUCzjnTfz4bab5Q9S3MZTEpuo2ATttvyko5gp8IYO0IYogo2-KBufu74c6GAC6pOS6K6a6REG66qKwHEDYWwR4x6dg-oQocI5ajifawYv2XGp2f4V+eMTIK4NI8404yytGZQL0B4WIxwOQO8xQWohw9EawiiGg6gc+uOuElq-gAQPQIeza7wL+BAEAV8L4uA9U9IIh7A4hgg5AOABoggbAGAWhtaWhImUh7AsAYgyyWWsOKwoEsodcmCv8ZgTg2wCcp8h6jggh5myhYhEhBhraMhcheAihYAyhqh6h2Amh2hYAuhf4+homxhJEkOKWCAtgGwBBEG2wpQyI8gZ4UeIoVg7BeQVhjirhwhc0HhBGhh4qAIxK-wEg2YQwKYqA-wnQgRTAahGhnwWhwqERG6URZRJh6+jCP0nE1wt4xUvopQ8Edu7o1gx0oEYoAhZBl+rslkc2Ym9Rtm0mDmVOzmlAAQeAdRPhuY8h-hEgMA5KIu6xmAgguxqAphaunE2QdumQhc6IVsx40gogWKmilwas8xE2ixyxAQZx9mmA8WWxNIVxBAFR9R1R2cdRDRxx-ggggJMmlxuAdRNxvouk1wdusgEEyOLxqyvCWy1g5w+Q2OfxHApupGGxTmiWOxqJqA+xARfhqAShJxggMWVJFxVxNxCIukdQaQUEdu1g7yOQ0gHKtQxwL0rMZJSxFJHJZO1J1O2x4JkJVRNR7AsJjRbJ8pi8KJaJfRSQjgvJTYjgqeUo8wDYX01QkgaIU8YUjOWQMp-xC2LWdJexshBxzJrJCJJAhYsAggfAep1xBpRgLYZQiiPUryyMfUp8NpduFwqgeQGgx2Y2CxspgQLpzWbpDJqp0JtR9RWpPpfpAZQZNxZ62JRUMoDezuNgBw2wO0duhcWUTpFJLpi22ZjJhxLJARbJvp-pegpZIZCRYZ3Bpp9gGw9gHBew68iwWgcwWU08hC+K5BGG5JGZjWBeHZuZ6pmp8J5KfZggA53JQ5ppW+RWqRtQF4+qZMxwCshWWSSimULZgQN2YJ9JnZXpPZPp+ASYg5cRWaoZZ6ccyGKwkop8vmoFfJKoooicqIM8y5aZ-xr5W5-wlReZGpBZe5ggr5f57a8Rppey85igKIh815jgGJ9QZqdgjgFgcxCFvxHsFuve4Oxoi+7AH5Ch3ZEgrsPgMYahi+ggzFEOeFAFw5boBaR2kotYvWOI5gGwtp1gaQ+4ZJjFEuQlrFz+7F25MJmFPFfFT+2euAglHwfewlb++FI5wYciqgEGuBOy3aU8Hy9yXEdFeuxmFBa5HqAIxOpO5OESmxtJ4JHpTJnF3p5KhOPlZO4S-wggAVvsuF5loloaAUDY8ZsxL04gEabuvo8SpqFgduz5XlROHwvl0VIJgV752l+ZcJbJEVJVUVFOsVNJ8Vx5-526w5dg+6aVcMvYEajgPcuVZqJJ2OJSuYoe04s6y4+AtB5Cyy0ozM3CrOiiKCZ4aknEXuxgoURaI1pS41mAEgJiHAEqEAEAAw3sWYqAeAPSIl7VJ84ZCcUlSSVgq1mgs5xqDxkpuuF+E2o1M104EguABZf6xAl8-QKBTIyyhk2mZcfBUo2JCIZ4tYQ+DESlDYRIPxJmv1e1EgvMEiVqHqxKKY7IeEwVXZShc0QRrR5KYRnRTI3Rra6gkNJ4CwywTOKm9eiNWUbkcNF4hImgEYGNFBWNdB+1uNBYzITAhNxNEJqFUJO5mFFNzRwRoRHR4NjI9NL+jNQ52QAyqEtQDZGwWQZ4yMB8qRci2wJ4nG9FJmh17F6qCMPc85soLy1QDGO6v87mW11wlgjiX1qZE2ttBAsRN192OtGK8w7CrO1QxtWKde6EZsniGQ8FblK55WMYNBnw2ADm3s5Aoek1NBe1c18gCsRBWgxgWoVgU5LuywrkdgbYcF5a942O6d01md2doSoeB1Ei7F1WnAuAAGC6fATma6ktcUxNkNnUtE1QiijKtiZ4lM0gFQIYd1+kVtKdl+LdMAbdwJOdndgNDRwNF8rATataE9+w4EmgiOkG3UqMRw5QmM5wSwgiZszdGdnA7dud84ONeA4tBNY974pNn5TRLRIRbRNNatGtRhwgkNtgwcIYHU7k5F+0FwiwSw9EFgiiLhgtGGm9BoWdO9HdX9Yt+No9RN74VVGFcJitIDKtOhEDkhra0D2tduCwh4KgZcldEEWmdhfcz8ksL02OPQJOYeCW3SPGXwuAHFRxelggQjshWhgwYjtaEjtK3UHE1wKkwFFwqiu8YEil6DGQict62D5WcjIjij7A4jkjFDu5MjZjCj51VjqjT0BaN6FgL2Vd2JhwYao0pgwWJjvGtUYQyFIt+d01hdQ5x8ZQji9Q9EWw+4p4OywY0gXaKw3ylwEBU6JmQTzmiYf1+1a5yBoQ3Ap1c6-wuY-wBAxDzId+wTP5SW0iIs2qgY+wbS09R8EaIY5QeaS9igsZKZkB2ToQuTSY2NhT+Aloq6UAeAs6OA5AtIdJQQlAuYE9AxUeKgDY6EbyVsSMA2QoXkGWRU2OOTIT5C39eN4Mp1Jz9TUjXF1DytYDqtehDDL+RdSghw94P094UowYQ8XCHucINwUpHkO4mTaGQzdTeT2NJAJ1a6EA5o8UAQtTIzJNvhoVARc0sjzR8LJA8UggyLr5kNuI56GVJ+pwZs4ybm7Dt5UyFa4UATEg1zULItEgMLpOEzOLiLBLNzNjCtCJqhnL5K3LeTkNP0dYUxaNAYm1724l-U-ElwH0rl31JmRABoP4TLozoT1B4TItc1aMVG9gR6mQfzWkVwg0KI5w8IXoii2OqrBEAQGr+T3F6Za6ZTFTVTP9+NyzhoSLwzhL2t1grkWwuQP0gMbOVsoEZg-NX87iWK1gtrarRojrYzLrEzqx0zkjrsJ1xoibvrkLoz6beAE9tgukFgRURWiiB+Xu3N-J94J+xwCb9rybLL1T36drPrjrtz5N-glNoD1NTzkRLzRhhgRdmwCKTeWUGC0dVstFyC1gMoGqKojbHbfr9T0L2bgrOb9rwrADaLRxmLArCL5K3rAI+Lq7IrAb1wBWfEvoJwOjfksIEEumIcL2AzWTFB7b6r57mrZzbLLIR7W7PrO7eEvLVD-L2LR7ahibZ7+bDTfS8keaSkm1aoeQSd4+dYjh6oUoF4gMb74LFB6hBiQQ2cqLnp6LEgd+dUf6gggNOhy+4Or+QGolsgzGVM6kWK4bjGXz7myMvzEEaI2OhHlCWc1IMtaF8tcJlHv6FxtH4R9HjIjHyWolIgbuRwHH+kLkDSrEz2yCO4oEzEk5tr3A8pEz84AQn67wp10nAGXbARJAT6QOdWAAcl+hAAAGp-oAY3Hqi6RMYTv8dafOIXCBiSnHjLVpP0vW0fvGckZrpmcWffrWcgey1qk6Vwn2fsCOdXYueWcef-pwfyaGllT7rjrdSOLxl9SRwihQSXlBYCcMueUGXA537dCP5sXiqAPkfyNNd1ZnutfhE9dXbXWJXtU0WuR5qUwqjaOJxfRMZuSbCNigSZagSFWDcvpInm56C2cSDdcCUbeYDi7olRtJkw46JpDIMFTQQqjnDcoJoNfpkaWGWUkKkHdbeddHG7fP7smxeLyHcnktgLD9R9o-Tc73hu0u4IhKRR46KSwqB4f64maNeL4AmrGi6beW7S6SPvdcWfeGWImo-nHi7YVW6y7-f3hBjIa1yyAoqq67igRhmFrxrGCrfI86no9S4y7be49Wbfdm6vfE+Y-efjeqiTtwX7jXnU-DqPybXeTdQs-P5B5ur57NZc+UprdGW55uoUoBnomSCmCOCMrqYzEJ6KKHD7DTyrCXBZBKv+2I8Pfq+K8h5meLaq-8Vfea-NHgplj-fdSfYw4SlfI3BfRojq45aNkuTFTy9Ped7d7AlCWu-q9Upd7UdCU3Hk+WDsPXCDyiBywHAqi2khgzIOFR-A7L7mgHdYAJ8CVl+r6yYh0ixGnYgHZl1JmpRfRUZ3E3A13bRYrw-uUYaawF1xiLjSripzXEWlvYFmv7DV47q2AcTAGmwh8zG2tTUwABDD-Amj9B2kT19bilS12yhGs0XbCI1juL8sZ6pN0MuD-hOb87GzRB2GBtWkwH+T-H9p6z8u6JztRqBL9X9gsEeH7NfjSHv7b8qAYgF-iLDf4ygp+J-L-gdjvJ-9L+FQa-lFwH4gCN+5CB-mPxMBQD9+E-WAR-xn5ngtE5gZASpFQGAD++5WW-uvzAGP8qAcgfAfJBgFH9Ie8A+ep-gv6UCZi1A1OrxjoGgDsB4A4QCwIDSED2Bp0T-vPV948Dl+XEVfkPxEGMD1A4gpIKVCTwnhNkaWRRDYRQQEEEYq8TKOflt7ADlBI-RgQoHUEVw+mnEbQS2F0GZU8omgVhksAFJUYsgVwW1iEkI57Uwm6-XVpE31YcokYFwJBlwlAy6RY8M-aCGHB8GhIf2-1cZlAEmbS4ZmWbUpr4ILZTMi2AbLQArlPg6IKg4FPqNqjeKP1yWlhbIAkL8EssUhDrGFtgD6AesLmxobIQV3fyYgNgiEIHkOgJDPUuEXBbyF6F-h2AbAtQpIaLU9aXMAgwSRIaRxCr7se2StKmu0TobPMvCL+EwG8zvIg8q0IfVYH1FOABQ8QppUCiiBYyTCnWbLOFgB3IAdDtuB7CDri2PYdCJ6lwcoKqERx1JHclXMdndTSIvQ1ASwa4eu3ZapDN2DwhYWJzlppdGizw2KpB2hGEcmad9M2Gpm5xA8ayigO8q8kUiIgy4ffAQRICEFYD-qsAbMBwD7qpC1aHqbAJ7CeFUjqaehJgAyPCLSoaONkDAL6hsEJEXIcIfIBYGWBbAUIGIDLG5HF5hx40d4JQXfzOaUicAhSZArWnpGMjQOCI5kbTXVpsjPYlxFMFyMgBqoTy5wVhuIBUDb5TA-UVFEMm5qyB8+wYF7HKPoEKiVh66ScLCX8HY9u2KhVYX23WHhF6GWwowgwSBiLBTY5ooKEoGHjiBlQWKL5mbEuAhhnRwgikW6LpGejQmGo4Bg837YbDB2wYxTo0y3B9gWaQxOYNyj-jijVkMQs1LUCnimDBmH7DoXOEZCUcPUl1IjFq0wFBC+Rx8SQJ5BjTxwb6u8bRNwXkBFD44ygfgZfnmF1C2xNkDsVdRTbLE10RNf4E+iXGfBjqp1dcZuJYBXUiW3cLsEFmuAx5h4cNT7FWQcCXBmeN-FseDnbEHiuxZzBoWYhKZbj2KmQ60E-lOrPjhuTHW6taXvqhghQoonPqOMNj1k7c6oTQEehnETY5xmrBcTSH-Hgi7hrw9oQsNbFPjOx7Fb0Ri3A5IjXhahDoWChQmCB-xRLfqNEKNSW8rgj8YePkA4jPxxhBaWQGCMfGLi0J9Q1NqkPBwhI-xeE1ob-RRHITcJh47WkHAVzTiPkdGTBFojXhbR+ScEm3k2IH4PiUJn47Gq2yyHYSuJqE4SQRJzFrDwGmw6InIF2FuR4GP0BEC8lRRaIj8WUPzJG2UoNdCG5CAIfkz1byBpAZsafMxE0DiicoukTaAnEMhl0-a6k8rJKk-qvi+JZ1bpJ+J3GJSLqkkvkYZGFA8QBEm2VKsPAlCHAlgCce0YY0i7r1fiHk5IQlM9FiSaQJ7SpsEXmaLNYAyzTofEUMhgR8gSsWlieHODiikks5F5DlBvBqT32q5SqQU1hYcsAOOdJ4URMFbYVQkRLXcC-AyDiACQJrRAJBib7FQ-8lwDYGSQmnOtVxEzEqq7BubVNJcS0qSa4mCjXA4Y+ca8vcTvI2BusSwVKsnWVYeUjp1TNdLNOMn3NTJA7LokO1gAKBRWywNyJbXrg-RHE4PHWnsjLjJk4ch8Q6Z-S0k8TPJ2rQIbNWCFJEAwXU0fH8nFH3IPmZseYEDHsDEiFihDDGXhJXETAJmojNKduO-HMzPxRLV6iSQEThxYKnjFEGYAOQWiuI-CBCYj1pkSSXxVUk6akJqktj6pszMnAsxzytSiWgBRELA1sBSlncxFMoOwQvB7TB4aMnCdxPpn1CppkImaRLNNlXU5p5KQ9iRJzrkTKOlEvCUS33gOBUQrgwyDN204DQo0LYWoGWzRA5BjZBk7SbxJlmtjBJyUy6TnSJZig3iHDZ+MSWdyqhVkVMFEPr24hHAw5dM5cZHMZn8ShU-wISbbKPpg1T6N0swHkWphOAOEqKdaQrFYTvTsURjPOZLMCAtsZhf00JHbN7a0NAx5ksojIFFYyhnoiOMLqHCrqqg3MnKZRGGQ6gdybZUs6YW0NIbS0AZKwmho83zEgzCxagUVnkEOBfF9mR-WoBiCUSXhjAfELKGqDu7oDJwgNAIDKgsg2hAgdImoisyHJhwRQ+cAMGXARB2VOCwobzIG1Wm1w-s5nMPK-N8Dvz3RzIWAA1FQkLR1UKgI2NPXJZldXQg6DAqIGUg9CpuxjBCmQGwCdAhgcXMPF-MWFk07OEichcMG16vyi6gYeJtqlPiIwjgq1fcO5jUjW8faL9eYqQoYWUKPUC0WEal2qqNFhF1IJhXQjanMdkmxqNxl2hmKbSEAbYcwOGHzi8Jww50GRTSPzwgph6TM2tNtwMXhFwUatOaqbybDazBS7xcHqIGxBCgsQ+kPSDOIMWiLjFT6FUTOmzEWLte1iociIDz5fFZ5U8G4GnO7SmiQ4RQ1jOdDVo+BkFDwJ4bWmSUzgwACyJkKUmWQrBh02ieQGwkMb-4XQPCthQqzwRfNEl6SlJS0AkXoVdySSlJXQiFTfy+REccgZeQTqXCmwKSSNiKDhwhxHETgOujUr-AZK-gqSmPgyIiZ8j9alGQ+AiCPCnBJQg6eXG2BLwIh5yo0syM0syWpKhGMyp3rjPmXaRquhaIBaVG2YCh6gJdJao-B2XjKN0kyrJfUrnR4AHhGAT4OqmAJQyjGGmUUBBIFB3yoZxscijkVRDPKmQry1Jb9VgAfhk+mAaKCZX7xDkaAGIGgNCsZCwr6lbnH7n+mWQYrWIWK+YvsqmX1LLoBPIErShxLzcjGlQefhqHgiAthsEEG8N9DvEIV3Y2YPQGuhBQSQpINCoBgKskgYBXYT6DwAwTrBVBeaQpEqKUoSKvTQpM9M8diRuDnQeV4ufleJDFXJdxO8IiQKKqFUSr2AUqocj51lUyh5Va2E3jXO3wLleEZ8eYlqr5VMzrItkJ4R6qYCmrzVfYgcQLP7hYF4yiq72mYFSD6dsgqwUOS6tUrIFvVDSiTgiO9W+r0Ac1GuV5lozm9IMF8q2PWPPSxl5++CzVXGomaXx4o23ctewFTW8i9+CHDaAQlRBPtFQZcVGOimDQjLeakERsXPFdVroq1iaw1VWprXLJYxKICwGoEtanxjAiqq7skQbCOr+wPasyH2omZ356omS7buuuQUjqhybmbLGgwcJ-R6efUdItZJyAZ8DZDbWNbyrXTbrN12Y+9X8F3XzK6wHUusZWlApvZd4VwJgo3y9mbQy4Ja29WmxmjFFqF23OKLNH8B2pcwL6utS1FWTZz7wSMp+pxx3SKAKYgiSwDkDVwrcb12q0DdBvmj2pB1UiiQFBrmiwawA8GkbqTFlCHBagOud6EmXvY7ocO5gDKMiCKyGNdlz4VdakPBg4A+A23ITdgD4C0bAJr-cVutG6g4hpkpgYPq4gN5SlQ4XmYDYRsE03QyNlDRomJok2Sq01kTGTUxhWA5Ysoimq2HbhSq74U88lIDQRrdW0ihNmAJ4S5sk1KdbqUbOHkULSBeD1FOUJgpOQ2aJxwha9C-AJqCAuadNTS9zYZtrV0amm0TcckrCYRTFwe-km0siBPjTIZxkW61LuzI5HECtNG+LbShVCSApQNGVmtMhuUVwjIcIb6CGu+F8bsI+WgmDFswolaPNxY5KBVr5LVasCryByXIm8Zao1OLWjTU5pfl8x-A23MhvzB63wdO0CsHsNsrraaAfQrKXyR6HtE4gsOy6-jaWtlmzatKKXRpZhQW3+AlthXLaY9hUC3kJxajJYHLCVCRtUiaQTIKQW5XHalwpoHWJU2MnUFtYAIG7V0PPqbBK8u0NTvRiroyxr5I8UZWKBDDUzItwOgHZ1rhLo7QdZWi1WBmgkY40QDPdvvYEXregQeb0OwFNrXREoSUZKbXouieHUJOgHASicShVRUoECDBAuLPJGWvxlAGgVXMiHvrmjqMSOXOY5pp3s76d4KRndmNgDM7Wdo9DnYugYJJ4+s3kfZJqCyispVkqgIkZOvnKHa2tv2htP4GEyXJ4gXPM5GAD8CW7JgYO+IoIG7AsJwwVMsMlRneSf4UNVgXqYyjy2m6bdFyYZpMEx2NFPA5uu3SHu4CO7lOLu4uk4UbLmwnA7yLmX01XgYwNVkuiZm6k9gr5fY5ij2GUkSyx72qJ4aQOKCiXqgvIxgL6JqAZxDZ0o3ycLamUi257i9BegJUXvz2UBS992HBJXr6ZLB5gtenZkqAWX1Jm91O0zpnBI7bdaENWEjn3ob4cRXBPtSuqYFdzXkupd5PeKhCjVZ6ftIG-ibPtE7ZiF9InYYMvq3AbL0CGVaUOIA0zDwmNWiv-lYCgxShp9qQ4lK3GFXkcf91Ia-awIWDdRd8OU4Ls8gvGm8QCZrKvKfFa3CRItAB4YGHoo4txADuO+ZWYCKUlZLAC7LDuoscLis5Wm1a0giC-1LM-0f+-dovFK1mqjNfI-LD7ThwhR4YP-GMfgQTLTxzYgio-ZpsoPkNztSay1LQaAMtR8sSYl6IohH36Nt9jZIMEwjTwyhSgFB9QlfG25qG4NmBhDbEhSYxoehZdKZMPDWmoNVQckgUp9Nb2-bND+quEeRpsNiHdDdETII4hY6wCmJ5esw7RmcX5wKDoCcBJAiGDQIOue7LilAAgDsBAj7AYI44aEBWAFgPQlHUNrSb9SmDWoVDsrBbB+GwEECKBHAHKJCHDV4RyI3kZgSxHkg8Ro2KBRq3Db+pZcMeLYVdol5zonSeojSO24goukkR9nV+AzYKKy94ZBCJHBRDKAtEqKWijgmyCzzY8zklvfylaNSpvA2Yzo20e5g9H8AuSk0R1ltLjxsS+C8ZBYHcwDRioXKLYOdDwzRhjJ5C+kGsZJS9HNjjBrLcpEnjfCOFKOLpvZsfpdgaM5xxZNGGzHXGwAtxzoPcfaU6GjA4a7qDwcykRS7cKOdPs2DjRFqvE69ERBQkMQK6aE5oW0N4GMmFhyEPgahLQjCDlHz6kZEHubGjZV1uEb630HBXQg+zzoaJojpieJPtHsx+J6cISaxN0Jq12hxLVuAyDrVqtIvRHTWWJb1iZ8Nce8HznmLMnKEQjIudt05OYBxEDu-k1JpX18l7pldW8uAWpPWBBoYwqtBHSZP6IFT3df44UfI0qm1TMejU55vuzyIrCqVNIrqjURnplAXxY8BxjKkX55ThiK6gCDMTtG8T5CExIaBDPlHu4LME4abGMhKBqTgc-dLXA3gCylyqJ804GdMQh6lj1p3TRIBVMRngzwzco3rJ+ayhgwajTaNSbZSDTp1BaYwBcHOgFIikc4sqlEm270dAk7ZinGIAgDlHGYKDR5DemSN1bMQ7DEUIqDZiZGEDEgVswCCCS+COzICVA92cXO9nvY-Zwcx1DeJPIxzNopGtDpnOTb5iC58psUlKQRJOzxk9c+U1+pbmBzDp3rQ9F3Mjm-4LyFI9p1HylsEQzW5o2eYCSLnLzuYa86uezF3ncAD5-4NuefPLaZgb5qEx+dq02ivI5QXUxNoAskL6FFC0ziI1VFILMlAQboBgG24X4vFeFhBVOCIskWwACAZkiaHiCRBR1YEP5MXQvKpEUkdK8itrqPQWlqZFF-ifhb-DUXZwtF1A+RZwuGKzOdIwi2JZaD0XOKjFyRHQHVS+89IRUmwFrlVBV18Ch4FhDymQhQq7gsneANEBOzgnkg6BPc6Oc-PjnHoZQEdA8RVBLc5zVUSy+qBC7ksQ0SMcNHlCuBik1sakJbr6DmM+JhCQqDANRrMuamtwQC3SOGFmT81aKCeU4USNehxo62lh-lFVEtTWpbUYqSy7aIrR5AvTfBbIGULAzWB-I1oweGLL-CWWmNkgW9hHQdGu1uF0gM1o-BqDiACiDLAXI1bojhimroGLyMbQGRl0a4-UeSfVdCzQFCJgQcQqUVbSDWq4gc4pcmU+h5QZYvnbyMofvChxCiSYEQx8GTDmhLIjkF84aUyCCjgoqCHXLmsYy4b3QWlu6-WWytjTysAuS1HoRNBGVAa5KQsOERxYXXGrdSTq7KCgjCjnspArmqBUKhHAyu1wQqvt3Kq+xsylloKBTFcPR51Ma0uvaWnjQVaNM5wIRPd3+Js9gScVZUvSUxt1AFYdgVsOvF4iPWjA3OIAkSOr2OEUTX01cg90zIY2BT8kHmnuCuCKQ1AgiXrKGiNhJIy4faavYVTbKC3YrwtodNkTB5w1aw45yG5qn2zUZRAAjcmxSWQpXE6bsIQNl8hCinB48OzXcCcEt4fEhQ+wFSrypByormQ6vdgGba0GYFHcAsr-llHeZqAdLXzEocZcfm8ZPKdVEnA1X8rNUabdROm7IHdz7B+oN3KMRGlWQ+0rgXKDqH6bMEYZha5CIqwynAhs01MppDEBx3QsPVPtyMA6QyyLv-VbaRVuwDgn1rvR6xQU-y27lQjZa1poYD6-h0Lu7UWW+9chZgCKsth2UKIbiCpCKiI12syVZSEKXjI7Uxq3c9eVLSTCt3OqDKfkhghhqI0sgA2I-vyXp5hXh75WFu0LYUxg9zATEfKmeKsqrUBkdGJ28hispD2gBODN+vgyulxSS7SRK3gg3esZbGUtEJQF-EKgsxX6rdd+gQzild0OARV3-N0305ay9BCA8MHXgUTaR3E9QOB1vQQcAO96QNSe7fYVAEJ0kxqJtVgWdwJ1Jj09ULVznjYMtcG29Uh0QxmF-0yGYAVB51UZTl1gwnlmwq4PsHICct60wRsI1SlWNGrT8ZTPcXLpyTdLr1PnXDQHvh3ypELFFntUsseZYcnzf6D8yOFWxJyY2jeALrtwS6I7jLb9k6zfHFMScrFcpgCFQecHiCOGk8Cri4QfQT5rgwuI4NmvlZm28UqOYW0uvwWtpsZRYCI6GSjE2NCRUwM3Ju6MQtAhtEJ4Ewcc6SZh36R1q3bSAdY5bP0exCeAjQ8LWmwbVTLA4ZZhP-qtw6aZhOA6t2g75dCwtilyw7NPhaDWinRDlv53opgg3NvU4ocq2A0uycdrGynazqoHz0G9BtJu7Lsv2sHBmYYrdbuPKHW0mNF8IB60YKZ6ihoBtCGTGDqrWT0kSM5yeFzDFkT1Bz5xphmaNMHkVlG6DpPbAwKI8cgzf0uerPN74tNtj85RaoOArqwNXLkHECqgE8JbA3j6D-PF9vnTbK57+w3b3Dc2LTrZ5iHcZQy9Bjg2BuD29oKw4eDE7vnMEE7oniO1IQaxiTuppYKZ7V1iPkrRwahCsimdGnY+qwmchL5nVzj+k878OMX5pMoBekUBYwy4rNm8q9VEAbxsgsAkvibha4P46p7XOm8KB+j5E2EaQTBEMTMAWALwJJIGP3DleB59u4uFVxtB9o2O-8dQfaG9rqCGnQXp8o19FgJWvczX561+Bq+tcuDIZiJjBlredtG3AgDvE1xLg55RPbtCRI8O65hx+3oxeUYruVzHKVnp7TrwxJTYtxhu3Xar5YCD2Kg23GMmrlO47auBChP9gbx7sDg97K8k7Qr5MlUFfiDCtIGkeDC8YqBE6ebBdmKfb2R5VvneNb93KpF0Ufxg+Y7R3IwWRhy9y3DvGPj3ndtZufaMb4qHG9NbtZJ81MY2GvanfI8a+FfMZ46Yb4zkMoMTEKGsHb7AP690hz2TUJv6YCGBMV-d-vyUTu4zDkPPrLOrLqAsIX8sbRFFM+uCCHxxdjF16Haj7COUvydRZDZLpQmcqiY7R7zdoEAfpZRctIRmyKuluze3mX9Qqwg9aoOsuJPeH-G-s0D-3+k8J8h+qhNC+gaHiYjcBy2ht6gQfLhMsqjSW1tIKsY3SSKQlOtdJcwjoag9VDcENIQov6F-wryapsoUdNmBmfg8ke6hyLiEf+0wm1SPHCRzqKUCKHCjKunVL4u9KqA8RqZiE294B-GeGlm3ieH5LRXKc7Jh0sBtKmKEGd-vSRRnikcyMMWfz2RdNktuZ+piWfweaIbsED20Xx0Y17L5z-tUVpUXMxxnh98LYSbhizDlrB6sKV3ixj+SAYdd2K04n5zV5BjiCOa6RlHp7Jw8U0Z1cRibNETWXzuWs7XEhJ9xeEwp58j1cVjI1z+nhd9Ct7vFYylXleV3LI9ufnHZcz4K04HEcNvIt4sx8UFq1fC5EU3CUmy50fNj9J2X3rw04tmKfEWtUk2YZKuqt3T4yCMHgmU+0KSge5QWsGxgdLdftvq846ch4EmlzPxdzhnLeFDZZ9LNk37IGBmcnr73i5zrj1t4jlnMePm38Of+N28UwUtrtJEF-0HirYa60EA6xMPclxTpwRV0NlDNFBixSrfn6cde32TOKj+5z2KdV6ZkWMHvGLo7LDlsmXrSozuHNzbC+SxNJyKTsOX17XH1EsJfg+qa3chki81pHuKs-1PPpGlT41txPHOYqnI-JpCnzdjnVbvdxZ5R2OOGPm06PJ3cHmTqIbQ480zJfN3wxWdPqbAuHkRqW0gmSSfpVONNkydmkHF-iydfv0nPaElbvHyHt1vW8ZfWrH1H3EsxbBNPGXlXeVve7q6xXA4Qnzs7M+Be9pxQ2xxpk2HD4n74B9Ie3PpP0H+T-ej7fQoYthEF-21QYcIIGgEvGd3j+YzE-bPo0Jt65+p+in6kd56U5fgkyS2f5jGLGQ0BEeSRRPkH2bNfFreZf1s-3079WxWiTxVFcUSH6w6OCcigdov535L+mcS5g3r2+T6sLq25yWsxQJfNmTRDOUIc8sVP4LmA+e5Dv8gLt5thsIg5cwBsGnI2b30WDciGV7v+u+XSN5O91P6KTYZp2MsTin-nuCYjM1GUrfnHNAovy8ipZYpAd9OkTmwqIEVgDQsNrHCoCDPv2AC02FmQq4WXLtQqWWogDXKqA2MFK5GGDLvUCFStHmpiJwctvopSW3ikPS+Kpig1YYuY7APBg8oVgbxWexQHSaYkHoOwIVi2KrioYAllubAHwoLlYSsIo+rcqdSupjPT8QM9BQbGq3ARi6CgqyM+xc4CNv1AJ4kMlMYbwmBMRQUGsAN6ogBsTNkRHI7xMmRKBeaseITw7kL1ZXoFBlWo6BWUsjpFKs8mBRtq7KN8xgSZwGdDZ63+nVDIKOgfgQ3yGTuwz4K94MV5dM+zPiCeWLCHOaRalGqIRoBMgYjb30DgBeg5Q45lEpGOpNj7JwUZbnwbTa+mjoHjyIruwjvOMoFTAjuAUEWjn+vVsrAB6x+lFoQw1ga5D1iWwFGKVsp-HlAsB4vAZx9wyhhQYlaIAaTLvmzyChaXywyAHJniyZOogUGV2gv4meQgK4pikI+m2B1ivmGq6SiqGnXQZA-jFkGusWsADo6B59BBhHYF6q4Zw6O1tdw3AyKEnQUGtOhzqy6CBDoF6MFtE-DfCYoELoDi6UEUGjE6BBQZm65yMED2690EH5YIzGEjC+0ZdPEYB23wvYIKq+VNUruBkuN3o+wlAN4EBQR-DHguIV5O9iGwQToqCz2KOhQYX6JHN4GDGLYI-SKg-HM-pgQ5nuwyT4OlhQbIG-LtMFYIkaJPDaCm2gLIOSppGKS9o1wCcIaAmgbQa5BQbBKAz09NtaLGGY7HcokkTRlkawhNhjoFUs60LxAay07JN7FS0Qp5aE6VQNkYBGpRve4AhggH0FIWAwbUasQIyMzCZYv8KYDjB8xAsY0ihIfNy5A7iB9CAw4yP1RM2ftuC6-GtIG0DeBeyFsD6YaQaoAo4tQHJQwgqAh5hweqZAGZBARJtia2hsQZ1I76QopvC+yziGcLoWKkFiSiiBVHKZZmYhJab4A3gSAYgiYBBozI6BpvvDTIRwCGCugLHGaaiI2ZpGa5mUAHcGrYPEEnRww6GmTCkyX8EoBJGt7C2ZAWF5publIICL0HZANlshbGhxQG1COW5obRRw4--ueaGI0FpEijhMgQaH7mdlqij2u3-qMGWhWDEgEiKlFrJbIKxFi0BFW4obzSnAq8AjDg8siDaSdQ0eJvBigAtK4BAAA */
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
            actions: [
              () => {
                sceneInfra.animate()
              },
            ],
            guard: 'Selection is on face',
          },
          {
            target: 'Sketch no face',
            actions: [
              () => {
                sceneInfra.animate()
              },
            ],
          },
        ],

        // Modeling codemods

        Extrude: {
          target: 'Applying extrude',
        },

        Sweep: {
          target: 'Applying sweep',
        },

        Loft: {
          target: 'Applying loft',
        },

        Revolve: {
          target: 'Applying revolve',
        },

        'Offset plane': {
          target: 'Applying offset plane',
        },

        Helix: {
          target: 'Applying helix',
        },

        Shell: {
          target: 'Applying shell',
        },

        Hole: {
          target: 'Applying hole',
        },

        Fillet: {
          target: 'Applying fillet',
        },

        Chamfer: {
          target: 'Applying chamfer',
        },

        Appearance: {
          target: 'Applying appearance',
        },

        Translate: {
          target: 'Applying translate',
        },

        Rotate: {
          target: 'Applying rotate',
        },

        Scale: {
          target: 'Applying scale',
        },

        Clone: {
          target: 'Applying clone',
        },

        'GDT Flatness': {
          target: 'Applying GDT Flatness',
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

        'Pattern Circular 3D': {
          target: 'Pattern Circular 3D',
        },

        'Pattern Linear 3D': {
          target: 'Pattern Linear 3D',
        },

        // Modeling actions

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
      },

      entry: 'reset client scene mouse handlers',

      states: {
        hidePlanes: {
          on: {
            'Artifact graph emptied': {
              target: 'showPlanes',
            },
          },

          entry: 'hide default planes',
        },

        showPlanes: {
          on: {
            'Artifact graph populated': 'hidePlanes',
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
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
                  actions: [(event) => console.log(event)],
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
                }),
              },
            },
          },

          initial: 'Init',
        },

        'undo startSketchOn': {
          invoke: [
            {
              id: 'sketchExit',
              src: 'sketchExit',
              input: ({ context }) => ({ context }),
            },
            {
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
          ],
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
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
            input: ({ context: { sketchDetails, kclManager } }) => ({
              sketchDetails,
              kclManager,
            }),

            onDone: {
              target: 'SketchIdle',
              actions: 'update sketchDetails',
            },
            onError: {
              target: '#Modeling.idle',
              actions: 'toastErrorAndExitSketch',
              reenter: true,
            },
          },
        },

        'Converting to named value': {
          invoke: {
            src: 'Apply named value constraint',
            id: 'astConstrainNamedValue',
            input: ({
              context: {
                selectionRanges,
                sketchDetails,
                codeManager: providedCodeManager,
                wasmInstance,
                kclManager: providedKclManager,
                sceneEntitiesManager: providedSceneEntitiesManager,
              },
              event,
            }) => {
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
                codeManager: providedCodeManager,
                wasmInstance,
                kclManager: providedKclManager,
                sceneEntitiesManager: providedSceneEntitiesManager,
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
            input: ({
              context: {
                selectionRanges,
                sketchDetails,
                codeManager: providedCodeManager,
                sceneEntitiesManager: providedSceneEntitiesManager,
                wasmInstance,
                kclManager: providedKclManager,
              },
              event,
            }) => {
              return {
                selectionRanges,
                sketchDetails,
                data:
                  event.type === 'Constrain remove constraints'
                    ? event.data
                    : undefined,
                codeManager: providedCodeManager,
                sceneEntitiesManager: providedSceneEntitiesManager,
                wasmInstance,
                kclManager: providedKclManager,
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
            input: ({
              context: {
                selectionRanges,
                sketchDetails,
                codeManager: providedCodeManager,
                sceneEntitiesManager: providedSceneEntitiesManager,
                wasmInstance,
              },
            }) => ({
              selectionRanges,
              sketchDetails,
              codeManager: providedCodeManager,
              sceneEntitiesManager: providedSceneEntitiesManager,
              wasmInstance,
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
            input: ({
              context: {
                selectionRanges,
                sketchDetails,
                codeManager: providedCodeManager,
                sceneEntitiesManager: providedSceneEntitiesManager,
                wasmInstance,
              },
            }) => ({
              selectionRanges,
              sketchDetails,
              codeManager: providedCodeManager,
              sceneEntitiesManager: providedSceneEntitiesManager,
              wasmInstance,
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
              codeManager: context.codeManager,
              sceneEntitiesManager: context.sceneEntitiesManager,
              wasmInstance: context.wasmInstance,
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
              codeManager: context.codeManager,
              sceneEntitiesManager: context.sceneEntitiesManager,
              wasmInstance: context.wasmInstance,
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
              codeManager: context.codeManager,
              sceneEntitiesManager: context.sceneEntitiesManager,
              wasmInstance: context.wasmInstance,
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
              codeManager: context.codeManager,
              sceneEntitiesManager: context.sceneEntitiesManager,
              wasmInstance: context.wasmInstance,
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
              codeManager: context.codeManager,
              sceneEntitiesManager: context.sceneEntitiesManager,
              wasmInstance: context.wasmInstance,
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
              codeManager: context.codeManager,
              wasmInstance: context.wasmInstance,
              sceneEntitiesManager: context.sceneEntitiesManager,
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
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

                'Close sketch': {
                  target: 'Finish profile',
                  actions: 'reset deleteIndex',
                },
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
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
                }),
              },
            },

            'Finish profile': {
              invoke: {
                src: 'setup-client-side-sketch-segments',
                id: 'setup-client-side-sketch-segments10',
                onDone: 'Awaiting start point',
                input: ({
                  context: {
                    sketchDetails,
                    selectionRanges,
                    sceneInfra: providedSeneInfra,
                    sceneEntitiesManager: providedSceneEntitiesManager,
                    kclManager: providedKclManager,
                    wasmInstance,
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
                  wasmInstance,
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
        'Delete segments': {
          reenter: false,
          actions: ['Delete segments', 'reset selections'],
        },
        'code edit during sketch': '.clean slate',
        'Constrain with named value': {
          target: '.Converting to named value',
          guard: 'Can convert to named value',
        },
      },

      exit: ['enable copilot'],

      entry: ['add axis n grid', 'clientToEngine cam sync direction'],
    },

    'Sketch no face': {
      entry: [
        'disable copilot',
        'show planes sketch no face',
        'set selection filter to faces only',
        'enter sketching mode',
      ],

      exit: ['hide default planes', 'set selection filter to defaults'],
      on: {
        'Select sketch plane': {
          target: 'animating to plane',
          actions: ['reset sketch metadata'],
          reenter: true,
        },

        'Select sketch solve plane': 'animating to sketch solve mode',
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

        onError: 'Sketch no face',
      },
    },

    'animating to existing sketch': {
      invoke: {
        src: 'animate-to-sketch',
        id: 'animate-to-sketch',

        input: ({ context }) => ({
          selectionRanges: context.selectionRanges,
          kclManager: context.kclManager,
          engineCommandManager: context.engineCommandManager,
          sceneEntitiesManager: context.sceneEntitiesManager,
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

    sketchSolveMode: {
      invoke: {
        id: 'sketchSolveMachine',
        src: 'sketchSolveMachine',
        input: ({ context }) => ({
          parentContext: context,
          initialSketchDetails: context.sketchDetails,
          initialSketchSolvePlane: context.sketchSolveInit,
          // Use context values if available, otherwise fall back to singletons
          codeManager: context.codeManager ?? codeManager,
          sceneInfra: context.sceneInfra ?? sceneInfra,
          sceneEntitiesManager:
            context.sceneEntitiesManager ?? sceneEntitiesManager,
          rustContext: context.rustContext ?? rustContext,
        }),
        onDone: {
          target: 'idle',
          actions: ['reset sketch metadata'],
        },
        onError: {
          target: 'idle',
        },
      },
      exit: [sendTo('sketchSolveMachine', { type: 'exit' })],
      on: {
        'equip tool': {
          actions: [sendTo('sketchSolveMachine', ({ event }) => event)],
        },
        'unequip tool': {
          actions: [sendTo('sketchSolveMachine', ({ event }) => event)],
        },
        coincident: {
          actions: [sendTo('sketchSolveMachine', ({ event }) => event)],
        },
        Parallel: {
          actions: [sendTo('sketchSolveMachine', ({ event }) => event)],
        },
        LinesEqualLength: {
          actions: [sendTo('sketchSolveMachine', ({ event }) => event)],
        },
        Vertical: {
          actions: [sendTo('sketchSolveMachine', ({ event }) => event)],
        },
        Horizontal: {
          actions: [sendTo('sketchSolveMachine', ({ event }) => event)],
        },
        Distance: {
          actions: [sendTo('sketchSolveMachine', ({ event }) => event)],
        },
        'delete selected': {
          actions: [sendTo('sketchSolveMachine', ({ event }) => event)],
        },
      },
      description: `Actor defined in separate file`,
    },

    'Applying extrude': {
      invoke: {
        src: 'extrudeAstMod',
        id: 'extrudeAstMod',
        input: ({ event, context }) => {
          if (event.type !== 'Extrude') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Sweep') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Loft') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Revolve') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Offset plane') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Helix') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Shell') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Applying hole': {
      invoke: {
        src: 'holeAstMod',
        id: 'holeAstMod',
        input: ({ event }) => {
          if (event.type !== 'Hole') return undefined
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
        input: ({ event, context }) => {
          if (event.type !== 'Fillet') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
            engineCommandManager: context.engineCommandManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Chamfer') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
            engineCommandManager: context.engineCommandManager,
          }
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
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
        input: ({ event, context }) => {
          if (event.type !== 'Appearance') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Translate') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Rotate') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Applying scale': {
      invoke: {
        src: 'scaleAstMod',
        id: 'scaleAstMod',
        input: ({ event, context }) => {
          if (event.type !== 'Scale') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
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
        input: ({ event, context }) => {
          if (event.type !== 'Clone') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Applying GDT Flatness': {
      invoke: {
        src: 'gdtFlatnessAstMod',
        id: 'gdtFlatnessAstMod',
        input: ({ event }) => {
          if (event.type !== 'GDT Flatness') return undefined
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
        input: ({ event, context }) => {
          if (event.type !== 'Boolean Subtract') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
        },
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
        input: ({ event, context }) => {
          if (event.type !== 'Boolean Union') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
        },
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
        input: ({ event, context }) => {
          if (event.type !== 'Boolean Intersect') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
        },
        onDone: 'idle',
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Pattern Circular 3D': {
      invoke: {
        src: 'patternCircular3dAstMod',
        id: 'patternCircular3dAstMod',
        input: ({ event, context }) => {
          if (event.type !== 'Pattern Circular 3D') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
        },
        onDone: 'idle',
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Pattern Linear 3D': {
      invoke: {
        src: 'patternLinear3dAstMod',
        id: 'patternLinear3dAstMod',
        input: ({ event, context }) => {
          if (event.type !== 'Pattern Linear 3D') return undefined
          return {
            data: event.data,
            codeManager: context.codeManager,
            kclManager: context.kclManager,
            editorManager: context.editorManager,
          }
        },
        onDone: 'idle',
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'animating to sketch solve mode': {
      invoke: {
        src: 'animate-to-sketch-solve',
        onDone: {
          target: 'sketchSolveMode',
          actions: assign(({ event }) => ({
            // Pipe the plane/face data from the actor into context
            sketchSolveInit: (event as any).output ?? null,
          })),
        },
        onError: 'Sketch no face',
        input: ({ event }) => {
          if (event.type !== 'Select sketch solve plane') return undefined
          return event.data
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
        () => {
          sceneInfra.stop()
        },
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

    'Set Segment Overlays': {
      reenter: false,
      actions: 'Set Segment Overlays',
    },

    'Update sketch details': {
      reenter: false,
      actions: 'Set sketchDetails',
    },
    'Center camera on selection': {
      reenter: false,
      actions: 'Center camera on selection',
    },

    'Toggle default plane visibility': {
      reenter: false,
      actions: 'Toggle default plane visibility',
    },

    'sketch solve tool changed': {
      reenter: false,
      actions: assign(({ event }) => {
        console.log('sketch solve tool changed', event)
        if (event.type !== 'sketch solve tool changed') return {}
        return {
          sketchSolveToolName: event.data.tool,
        }
      }),
    },
  },
})

function listenForOriginMove(
  args: OnMoveCallbackArgs,
  sketchDetails: SketchDetails,
  sceneEntitiesManager: SceneEntities
) {
  if (!args) return
  const { intersectionPoint } = args
  if (!intersectionPoint?.twoD) return
  const { snappedPoint, isSnapped } = sceneEntitiesManager.getSnappedDragPoint(
    intersectionPoint.twoD,
    args.intersects,
    args.mouseEvent
  )
  if (isSnapped) {
    sceneEntitiesManager.positionDraftPoint({
      snappedPoint: new Vector2(...snappedPoint),
      origin: sketchDetails.origin,
      yAxis: sketchDetails.yAxis,
      zAxis: sketchDetails.zAxis,
    })
  } else {
    sceneEntitiesManager.removeDraftPoint()
  }
}

export function isEditingExistingSketch({
  sketchDetails,
  kclManager,
}: {
  sketchDetails: SketchDetails | null
  kclManager: KclManager
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
  kclManager,
}: {
  sketchDetails: SketchDetails | null
  kclManager: KclManager
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

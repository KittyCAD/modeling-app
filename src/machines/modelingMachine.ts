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
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

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
      type: 'Enter existing sketch solve'
      data: number // sketchId
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
    'animate-to-existing-sketch-solve': fromPromise(
      async (_: { input: number | undefined }) => {
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
        input:
          | {
              data: ModelingCommandSchema['Hole'] | undefined
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

        // Remove once this command isn't experimental anymore
        let astWithNewSetting: Node<Program> | undefined
        if (theKclManager.fileSettings.experimentalFeatures?.type !== 'Allow') {
          const ast = setExperimentalFeatures(codeManager.code, {
            type: 'Allow',
          })
          if (err(ast)) {
            return Promise.reject(ast)
          }

          astWithNewSetting = ast
        }

        const astResult = addHole({
          ...input.data,
          ast: astWithNewSetting ?? theKclManager.ast,
          artifactGraph: theKclManager.artifactGraph,
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANmEBmAHQBGAJwBWABwKpSqTQDsUsQBoQAT0QAmdQBYJYmmPVjDh4YsMKZAX2e60GHPgIBlMOwACWCwwck5uWgYkEBY2cJ5ogQRBNRkzOUsFOTFFGhNZQ10DBBkZCXU7Szl5KRMTWxNXd3QsPEI-QIBbVABXYKD2EnYwSN5Yji4E0CSUqSlDCQUTGRpZefV1GWF1IsQxbYkTOS0FDRo5dRpDKTkmkA9W7w6AvyhOsFxAgHkANzAAJ0wJD0sFG0XG8V4Mzmigk8nUFwRMnUwhMG12CGOC0s9mEGlsOXsdweXkIAFUmBAhmAggBrfzkAAWAQwg2wmFB9DGrAm3F4xUEJg0EnEcls8gUhmWhjEJl0SWq+UOJmEsjETnUyjExJapOIH2G-wC5BI73+JAC3CCITCkzBzB5kMSQjmmvMq2MyxyaWECgxpxoIsMNGUpWyKh1njaBAAKqgoFBMDSMAAzEg9TCBJhA3A0n7YNgAI3ZHD09pijsmUJdUoUhxoeJk8wUmnycv0iHkgdDW1lOUqjTc9110dg9PYTKCqEwfwC7FQ0+NjLIMAg5YhVedyXmeOkMmDaSFGyk9gxc2ECzsEqs232cluQ5JbQk2AgSYIAFFPgC6QzGevKz5LdBEMbIJEMJtFBPGUGyOHQOwQVF1EOFFUWRJYbnqSNHigF83zAT9vyNMc-yoKQogdOJN2mIRrjrbIjlKC8oIbHYELkEw6wsIUG2MPExHVbDSTw98Pz4dh-h6DAAKooCaOSPFA02WpTAbCwrHbYoZWscDTlAhFfSWORhCE59X3fHwAHcwDAJgZN5KZ+CEapkNYhj8lA4xCgQ659nrKUbDyPE0RMx8R3wESCIAGVQFN2Hsp15MERRhDhepjjFfcTzY4oVBlCQQ1WFVrCOJYFFMiLzIIgAlMAfmnP4Euopzkk0ZCck0FLhCbG8MTEUo61xGw2oqWoKtwqqCC+FMU2CLMcxGLlwUAxyZlVVzg3EGQbGUaoz34uEMn4pwMm08bIoIAAJVo+CauSWuSlYRRoJssmMOZ5gxUCaEDH7zguLR6kMc7Jp8RksEwO7Vucp7jFgptOLo4Qz1G8o8hVDUtk0EH8Ku6dFooitZOhhAcikCRjMcY5NhWNIZQxQR9jrLQxQghxpVlHH3wAMXZJN4qWyiHOrZJql+85VmRPJbFAr7VjkCmmy2E972ydQuYIohl06FMAShkWREscpLnEFEpE2Ow-R8qUFfkAacXDYGwqjSrcYAQSYJgwBIc0KAJ7liYNvEFesKxNhsFZ7HgrTNi4oUWxMATLCkDXY192AgWGfXgIqBZJWqAo0TqBRo8QfJTEWbbmNA6obFT6rUEGLPBaJ4Wc-mEU3pbYzNhVKQMXqJYKclK4LGRPFyudnCLp8E0k2zpLNFS-JlHNrGArkAexWQ0pzaWBFrBhVOiEwbh-eWwOc5euFkQM5ZTiOTSy8T5Clipo4tBelwp+EyaAHEAAiMYAjc0zrmWAnJCYbnukkMmFMLxZDXrTeopdkj5FSizcU7N9ycx-mZXGAAhBcSYyAvB6IWCSJAwgLwehUZe3VFB1CsPIZGCF9jXxyF6OoGh1RaFTkQ-GpCyS4DtC3aBJNBCmDrFkBQF59yD3yH1Co0j7xwRqL6fhxDva4ACAASSIsEahYiVoGyRHCTQNhgxBU4n1JQyEhRSiBjKMQKc8Gu3fAABSGIaHRRBsD-HIBmH2AQxAAJobA448CqZIJeighmKozCYLZpKDmg5mguwmrjLx7AfEBCingb2RpQnhL2JEymiCaaxPpghZKHckkSilDg1OYkWD-AFlAkxOcbCLGMsobqUtNR9XRorNQ9R9whhKqnZAJB6QlNagJRYVR4S+hRLLHy21yZZHEFqVE7NU4AJCMMa0SZbQRGMZfJKWRJAnilkxMZeQvr2HJtTeoH8NhXCduk6ek0YxgHEoIecggiBuzCectu8kBLkypr6KU6xjhPxKMoOE+wZAtjJpkb+Xzf5ZP+KgToTB2AAtQIISAHA5kiGMNIWo+RVhVCMmeJsqUnBChuAJDGmLhwZIuvonxJBMDXRIPhCBPhxxMjmRkcmphNQTJUC9RQDMBKSG6psTY1RMaTyxfgpMEhGSvjAB4hasACBuzadgNMYQAhQHNEwZkYB8WcEgHM0ZqUMjGV7GzDY3kY5mFEP1VZt9rAcqfO4sAEhYCMlQJZA1ZA4DGtNeawIVqSA2oCCwJgQThhrjBYlFqg9h60oKJKc2rDiguMDN1WoNxtimHsPIc6Iq-zEDIJQSG2bmpJBuWUDIRVsilH0l6vYidzFOEsHkFQ6F62isZAQA5-MaTBDeAaSBAdwUtUUNtZUqptoai1PE+8Ip+zJMaTKNJnLp4NonNO8gLQAiksCBAHo-w2i-kvU6lY5MGxbCPKoncGJpXmBWNKk8ZxkSTsbUQbgsBKF4ACJZDgzJcCmkgAEH4fKejnyFjmjtGR7FCm2McJQO0+rBRFL6WJys7APk1RFC9TIJC0cZLo3G0z6TWkXZ8FDAJOBzydVkMwjhSiagEjBFEKNUQikrS2Js5xxDajcbhBj9Gp1MffCx+dYB2OBAjU+gAXtwQYraOkXJaioKw5QbjWAuKqPImx9oXh6ai1EP1CNUbPcJRTDGVOa0g9BnR2nsB6c+HylkBZBh+14+baQyxuGcRcaUBFnp2rdVEI4Jm20wOXqU3+LzxAfPmhg38U1c8QtQebRh1uWHECmexNUVFtgnD7BsT5C8ZgS4lzRDcDIRxXPBoU1OrLl6csQdwFB-LOi3YEJ8AEAAGrxziFM6i7IuPCVBSdUpwzpkKKw2QevhT63+AbTIht5ZIDBibU2ACac2477g2VtFFfVuEFT9VoRzYpT29cO4yL7x2Ru+YCCueebaYFVcjocWm1RbC7K2F9GRFMKiqUBooDLdHPO42G6N07Oikz4HYP+YHJNZA-RQsYP1pxqgXC+lLAqJdciWPWij77aP3wY-+17f4XtcAQGwIEoERpuelfCwTkWa9yZ4lRInCWlbVsnlSpYPDtKZYokZz99HJ2YP+cCwZzAegAc4CgLgXjoE4S4huKUJmOUquyOQtZgt5w+yfLc8+Dzym1d-bG5xorfKdd6+wAbubCwOI-TUCeYq8qEKyBRHCSwysGwaG2I7z7Lvstu8xzB2AiGmBzlQDN3jUerAvX6heJ5yIvr9UkL2yUTgS5RxV8z7z7usdBEz9ngIV3hdbhUFH0zxd1TZH3l9e+iwEFKDZo4j7e2vuq5Z+rnRYAACOPRgs46gHj3jxkgxrCqDkPscskWmEWwFROXo6+u5n43mDTAfbe+oB3+S47AxaA0nYhEYorZaQgnWeRe9KOyKDZP5PQbVPf7f4O1VAWca9C-T4ZdC+VdDtVeczCUbqGwROGQL6PKcwMtKvNQWRIkeTKfevAga9DAW9bne9R9Z9EiV9O-Ezd9AqZLb9DiX9BCJYQMVFFYTibdYMZHfAwAo7XGJkFcGkecacOZYTMoF6A8LEY4HITeFgrQQ4GFNYWRDQdWXg-revMNfwAIHoLPBdd4aAggCAM+F8XAeqekLQ9gXQwQcgHAA0QQNgDABwqdBwjTAw9gWAMQOZerQMZYK4BiMUbIM8biSubYROFxJzRwU-FPbVOaHQvQtwpdIwkwvAcw0NOaaw2w7AewxwsAZwv8VwzTTwsiIzOAowYwHea3HuUoZEeQYIy4A9SzLrWUDiDVJ3GjDQs-dI7Q3Qtjdwo1AEXFf4CQbMIYFMVAf4ToSwzIuwz4BwvVfIy9Qo-orwmgmYS4QMMUbKWUbYX0UoP9Did0awY6GuYwFXN2SyU7LTCYgLfTYLAXMLSgAIPAcY5I3MUwtIiQGAQlTXO4zAQQF41Abw63CmHbLbUfREL6Y8aQUQVFVRS4Kwc4y4jgAIX4oLTAErR4mkQEggQYiYkYzOcYyYr4-wQQNEgzAE3AcY4E30cCa4Jg83SnHyUOcwDiVZawc4fIJEq4z3bje40LMrZ4qk1AN40NVI1ACw74wQQrPk-4wE4EhEcCOoNIEPNk1BOwHIaQZlWoY4OVWwbklEmUnnfkwXJ4nEvE4Y0Y9gIkqYqUo0ueSk6ktYowbuOEZsavWFTaL6WuFCceEKcXLIA0wIc7GbIU144w948UyU0kkgQsWAQQPgR0oE50hARwTYYfHqCCVYWRPqFxSQR+C4VQPIDQCfLlRTC4nkkM6bMMkUi0gksYiY20mMuMhMpM4E04BbEPFBUfd-PYOwG3ZRTCfOCCIMgIEMi7Gs0Uj4iU0NKU2M+MvQNslMtMsoFURwWRREewOQ0tFeRYLQOYCCCeXBajfbTLCslE8cycusq0m0kkwlecwQRc+U5cpQR-WUFEZSNcgdUmDKcwNrKUORG4RPAA-rc8wIQHbE4UqcqM2cmM-AJMJc0oyrVM18+sSUWtEMGUWoKnEMJUlUUUASVENopPUC5E8C+CyC1468wkxsu8wQCCxCldZC9czZA8xQFEJsCoWHWk+oDYGwBBCwNQk8qfD2bMXXFfPHY0WfdgaCswmciQN2HwGMGw2fQQCS-HJC9tF0t0Xtd7SUWsVbHEcwDYNEZEfqaUc4z2H3dSqSqAmS6ihs4kxS5SyAtPXANSj4VfDSpirSlC9M4MKRVQfDOwKnDdceJ5K5VWIS9o08ujMC1NAETnbnXnYJB4wUnEiMsUuS6MwldnJKnnIJf4QQNKv2Ri2A5i9C+gjie8DbcQPqYtTucpW+CwDiUcvKj4ZKwqzE9KqChy602iqU9qrnAqvnYqgU0q58zSkHFCuwKq7rWqmXRwRqhBZqzklXfJXMbPacIg5cfAYQ4hOZaUZmdhSTFLXshANQcQCmOPPiaWC4dagpLazACQfRDgY1CACAAYH2LMVAPAdpHy6ai4fqRYROfS2JKwM8DQViv1IPXU4Css-rDa-a6cCQXARsvlYgU+foKgsVFM4yezNrPEG2cubcqrWsTfa4eLSOPA4SxTJGp6iQXmERcNVNXFFMdkAiTK6ciwjIpgGw2YwlXIxYpkZYpddQcVaCcHCXCzEfM8cUAqG2C8QkTQCMdQg7emkQ56pmgsZkJgNmjm3E-4IY+s-q4k3m-m7IuYoWnGxkUW6A8WvG4TcoWRWoRwCzTUUmi6lQVKJiFVTibYE8OTWm-rV6mSp1ZYMXVeE9VEUCGHCPT+KLYKWwNQWUSUFXUOggEogGwnbISQDZbSBGM3M8WQaRVUUCc2SFDIYikCg7GMIQz4bAYLH2cgbPHaoQp6w6+QBWTgrQYwLUbbM8ZYZCOwNsIikde8FXOuvahupugJbPF6kRGS4bTgXAdDW9PgULZ9PW2KDm8VTqZ2tVaWixM8SmaQCoEMIGlYUCIOmKqfKemAGejE5u+etGyYjGk+VgedKdPevyIe2Ve8b2tAiPUwEODGc4JYXhc2Se+uzgWelu+cRmvAHW1mne98LmmC6YvmrInIhYm2u2jw4QcVWwEOEMDqViRwEtKrewV+JYGFCwWRKItWzLe+g0Rup+uehB7Wlm7e9m98Pq28827Bq23Blw-QpdQhvGjiBYQ8FQEubbbaOzVrbue+SWF6FXHoLnHPUrNpBjL4XAWSz45ywQDR4whwwYHRqdPR8lCtcCOYIuTCi4RRBCD+coIvSUHISwP1dRzRr6ixv8PRw242m82ioxkx4lbR9gXRw3FMkQJ6XtS4baD5U8diJUeoc2UaUwdLJhujWqMICCp6tuvajulMtEaoQ4N+GFLYfcZJrScZaQddDgqUS4XbBGg7XJsLRMZG56sCyg0IbgT669f4XMf4AgLh5kUAvJii8VbqQMfYY9NVTUBFLA8obtc+xQPM0s89frdp-JzWhSsi59G4qAPAIgnAcgWkIUoISgXMPe4nAvWVMurrWHa4cCVSDyWrIqFXHZiihmsZ5Db5zpgx+SwRgW+YpwvBsR6AzupQQ4e8H6Gq+oVYIZYGyCOVBEFxSjL50IDppMBmwVbnfAFkc0OKAICZnFzmlI7K7owlawiAYlwlMliC6ZjffqF6daV882IZSLWRjKUZUdUKYOtp7F3Z4hCQfF59OlkgElxliiwJ-E4Js20k2l+lwQGVzp8VZzVx8XMjK4UTHyFseifqJwc2VYV0FXIgA0H8AF3FzWwpmAYpqakmNEF5gTewDQDIXhOWJa3Y84eEL0WRc1y1o0a1rp-Zq459QZ4Z0ZpBlm65w0Ul4VqZvG6wHeewAMVYWULQL6UCMwFWt+OoT-awQNoiAIENhmnpwlo5k5t2D640INhNyZzpy0J9Y56Jx1kWC4WwcCCwIqd82Rc6zaX6RxLuveY4Yt+NstvZv5z6i1ktkNoFnm-wGYy2wWkRgoyFjwwwTu-ylJMZFBPaHyQS+BawLC6xAV2+xTWdidxNptvZ-FolqVwIONn8NVtBylz4uaYxvmyVuKGwoN1Vm9oHdtrcTtzZZhftk4JxrSG4L-I128enTZ9zfrK9q1wD0N+9n9p9+t19gifh2iz95Vx9v9oiADxtoD7Ojtv6coPiNUPIKuvfOscI9UAC3yOoFXWw7RIITOClyMqliQUAuqPlQQNGpwq-PHGAzDXy2QcTBBbIGPXdCPeFqLb24MNUNEdjkhHRDOakOVy0mi4kgT1Df4kTvIsTxkCTirXykQKPRiZQfwlyapYoSHeBHcUCewSjFprZg7YbI0wl+cAIRDd4T6oz9DBd0NEgKDVnMbAAOSQwgAADU0NytxERZUs6xrhVkC3to4k2ELhNi1BjxcCODz2SLvPuBfOoBW9AvkMQvcOjb5X9OpiIv2AousdYugvEvMB0NgT5tP1o60g+NPa7wlUQ9ahxA9j1Psnvt4rXKQCwCIDpKjV0G+PTHZuxsAPug-gVK7LgSzNu1KYVRHGBJ0Co8NAthJC1ViHRy1um9yTvc9AwuJBVvVK7vMAdcaTc3iyVhzgbkEUVZJBsyAL7dZQ60puw2USbuCsuNjS3uHvlvPjnuoDpToe553uXyKgANt0fo8ROtKGLqEQlIC9jgcfXpEPndSKeTIe-Mbitd7vfcDdHvEe3KySae-idd6L9c22KOtwqYFYLxKNmJZB4UzwVDwJ2KajKN9xorSuzyyLbK3LeSYefc+U-d9H4f5KmffNkevdYeOfVfdvkJjJ5gfRODbAGV91q1t5q5uprvZ9m9k1W9ptGfiUqeHDM8iUEyaTJBTBHA6gTw1Aa4y9ZFDh9gJ5VhLgshpea7ZfKe7eM8Hf-OLtnftvmf4++bAUywXzup4dvudTzZ8hPammbdGtWiXJipbeoDb1F9l9PK8dk-XeF8l9-j1LgT91k5R8xvZc5YDgElNgQxxkwiK+Fer9zQ3usB6-VKR+b9DNuf5I0zsRXte7iyUps2nBQTMJaiI4lhzXdr7W4xFwzUjVDr2Lu3v0rga9LcLrk7zACvVQ0QKgJ6wetZ279+MTD-M7yJZ-c0T+T13Xz-9hL+6wMoGWjNj38a4O-F-sQmeKzRM6hgYDvJFKjD1ZQf-VLNsGCJmYQBd-T1I-0FaZZn+RTV-tAKP5iB4B3-FsKfxQEX9gi8gG-vHhUgP9POSHbzrvxpCED3+VAEwKQKSCICKBBPVAYALgi0DQB2AxgeT2YGQCD+MAqgHIC4Flwf+yAvgVQIjzHByYmA+gTXFEEdFxBBAqAewOECyCEAPA3-ooIAEn1s+agsAarAgE6DJBR-dQAYNKgV5ZcBrHaHVQjwII4QSwTiv70yjWC9+ugqQQoAcHrMKYzgoTBQ1QTmwO4qKaLM2DhJXBzW-iDjgU0EJFNNah1VGAJkRgWYKGfUHDOBGLwAC8o4cRIQEhtaisK2lXKtvoxrYDMkhuLaoXvQUK9gbg2ULCkszdQwlwGpweYDthvoy86MfiMoaG0qGltBU2APoNG2ZrMhyA9Q5Lp0nkiIgyggaNIDVWcSX9eEkgTyF6E-gal4aXnPAXMN+YxtwYM7OYY9xBYrswWeRCFokWgImBoWCsHtqqGZTvJ+4bCU4KlCJpKAVgLYUQGNCf5HC72H1CVvS2NDnD1ei7Glt+xVazDhhe9BombHJylBYIePAAV2hWEojpM2-QEcMLxYgjCWmHcEcMN04m0BGSrGEURzhEccJaRwM+lZhx79RUUeQrIOYCzKKREQ7WPwawNFawBswHAFepVxtqppsAXsC4fyMFouEmAoovImamE42QMAWaAwbHR3j5BuITEFsJf1qwFR9wxgKuLXBpoXtkOLAgIK-zDQSjBRL6ScNKLFF4czaEo4WrbRtGyiUw8oyAI6mXLnBpG4gFQE-lMDmUMQvSBWrIASTBgoc3I00byKXZ6Ep0AQIkgU0hHUtl2ODcFqIzuEeExCQMRYGbB9EBQlAA8K6sqQDDUwNi1dVpngJNFmjeaVo5kPGNtZ2ipilwlMTcLTFFFMx3SNJqqCfxCh9i7EBZIUL4q1Bx4-+csYMKBGMgBOqaX6hxltapD7W6Qkpui3MB1AC+CcbqAPH6jd0GELidipxBuClDkheOScSwD+rlsDmhLdmv8CgxTi-q71T6peOvEnjPg0zaIR6z2K+Q46xQV5ArE7Z95JQlwM4riMPETibIN4mcRUPPFCi+mXOMCTJVqHWhICn1J8f9XKq+V7wG6KRCGLZa4ENxRsBPBxHVCaB3Wmg2Kt9iGHATjx04wIMCIJaVciR1Im1iBJpDISLhFI4qrCLmEAomJggZCdM2Bp2BfU4fXVgiAHj5ByY98DUr2lkAHjGJlE08Xs1GF45-ESEqiVMOQYMThCTE2CdM3OAm5doTyGCKgjgjLw1Ih4ZEAVxkmaS5J4ElGtO2JEUTQJLExMZgwtrNjHR+DWAHIEeEFRSGP0O+FKC3jqg4QEERLDm33DnEOGxCO1l0wyE0DXQR+dzpoEDHZRwIVwPIISF7r7CmBZ5SKSjVGERNYJd43xj9T+o6TkIoeHhFtAbCe1lgsITiEwhDFviIp8DCCeGwvETF7JuLZ9iMyyLnNLmsAa5vMOMwKgnkhwNYNJhZTBxAxsSPcjHW2Iflmp5bAkXRLBHN1WJ0I9iUR2brTNdwD8I6JYhcTJTJQBUMbv6IGRR9Rx03XKd00gm3oucbsWVmMwBwBJpm5AwKNcDhi5xvyO2J4TYGWysE02i0qdicOfRrTnJTY4RqmPXbpjYACgDVssBOmigxYeQHMn2JcSLAS4JZZ1pxSBlaTkJKQk0QuIcEbBX4P0fINtDk5m92IVyWFlEKlBQ5WqYPE1PAzxlUSzxbUoUeYxKmfAipBU3iXjQDoFQg8ocCCIRU9pWYfUvCXaKoiFAkSRKHDVmfJNakTB2pRoDSXWyIinMecFzdPINNemB5PUnkKQudXF6skDufqPuLjOsnUSKhy0h9iS2fpHjHJqk8GWxMw70UAkXEgTjxKonTNKUDgJCL0NkyBiBoIoVFK2B7ZogcgVs52UrLym3SlJ-wFSbeKenbSBZYoGEnI3vgclzqqoBZFTA-LpQ7Gcs8sgrOtnsyVZlXROcnJ5kf1sa39AWUPHSnUwnALCBFOIGNyMJWCaKASCOIOFxUy5scmyVrRBmEswZ77YFtGNcmQyWx0MoojIA1b5Qw+iIUzBsE9pdj7EksWsOHHupMzB5zEtmcDOmEoNeGPHLKh+ynlCNV2UMpYhu1gBqANWeQFCPLnSksp25IUukhsDqxKxNxjOALjnnNQEQ-AJyQIMKNGI3MUy4cEULnADAlwEQIVFgsKDiwps9pzEP+WjTjFUIgFNoUBbGNgANRmJC0J1LIDRjyJIcprEuvEg-SiBlIX8w7qBnwJkBsAnQIYM+n87gKz53NcLiIhYXDAPegCzumwQYTIE7G9KRTvuCixqRI+8uKBowp4WsK-OOeDhaSIVZNd5FfCwFAIpTLzBZmt8QvOuhrjvCvxtQVki4lzicJww50JhbwrYU54-km9QljbUe7WLqQHvG2odWD7SYJQqpWEnjxSwFRZZOizyOTisXqLbF69BxUKKnQqLGuYrdRXkUBTuKYmNC5+fsDmDjwYOGIZAkLNJyV0V4F06eDbR8AEKHgFwqdMUpnBgBpkTIApHMhWB89Nx8gJhB6yAYCgCgJueEB6DZjwtzoRSkpS0BiWOVGx5SkpVQl1QQKDBYOFxJ3xTawkjFtEQ4khFyWcQnAI9XpSMsqWlLG+ooh1l-w7SvJwInFBEEeFOCSh4kxuNsF3gRAHkClwkPpZsoGUaNtlWeImXsrJpmYt0Uvd7LkARSCgLlkmNeTcvWV-gKlfwUpdejwCzCMAz47RWWhOm9ybMooUQAzAggfoTWCCU2I1mBWXpQVVSgZV4lH5JgZ+qE6as2GHo2xGE94N+Jf0FA6RLlmolQYBOEr3KwVAypGrAA-DV9MAUUWvt5RJU50lqNgMxf+OUj7gGY6wcwHiEuCvIWiiqbFUyFxWlL4uKPPlE6lOiKEQwLwzVVXHFULJ-oZuG2Igl3nMqNlrKjAHjF0x-Fw6PfI4J6k4ReRUEIEBQhlLjwh4lYZYwpaarxXmqAE41SgE6jTJ0lusRkRhMYAZhbExp+S65esHlWMhFVAyzwP4HUwgKPRBgslUGqpXBreK4a7PvSsBUxr8ColHXM+j+QSQpInCjBqWskgYA3YUGDwGITrBVAlabJEqK0qMB-TUpsiNJpwiPiFqrKegEteJGrV1cgmsSqteWtrXsB61KZIKU2plAtqQeQfMwBmwjiigxJcsotQOscXWRbIFwndUwEnXTqHBkgG8EcG2Bfpqqba1MqMmkAXco4GbDdf2soL7rBlptRsfusPXoBDqy62LMJlD4EZsKPkIcQBjzLJ0aF50Tdc+lPhxRHu0G9gJ+qVFvLMQrkHBGhEaWxYUYSKWlCsqVppK+5wkSDYSzg2vrbycGhDXMiuoogLAagX1hi1swR4Ukng8XIeQEi+C+1YlZ9KAXqiVLHuXGgheRu0Wvxt0+FVSD9FAjnU-UEhKoMnBaxjt2Nxawlnxp40Nj+OdUfjXWq-XaL6I1DQ+GOl+Gfiy4VwCQvPyQhpSS4EGp9ZWxmhxFlFzk2KLNH8DRpcwAmgwQsh96qxMZEDLNsoKRT94U6OQa3KBAs0carNDm+aDGhI20V7Nc0JzWABc1IbZQkaxOLYCIlCgoOVDF5n9MjzvkPWty58IRsq7gwcAfAR7kVuwB8B4t-KkWPNjNgcUcQYyUwIPnIG+85UYcWLMFoU2FabokW4kmVoq0abENVWrcDVvWgzNGsEERrT5A4hy47EVeEyuZvk1bqhRRWzABcJW2VbJOgNXNioEThm5OIEqfaOmWqkEZPGv4jrUtqCAraetjY9bQNvFSrlqGSsOhMcTx7mx8oQ9IGmMkfUhbCt+MUrfjA22WdpqgoK6k03axfosyCKDGF-m+iXqXheWiKAVtRJ-aVNEaJMIDpS7AQVQWwtEODpjocEB4UiQ4LDsYjw7ztz6XhvzEe6U7-AGOhYWugVg9hrlADTQD6AZQ0CPQWE-YMx3w35bLNlXGnfZXq56chlEgQXXTuGmIAN8EdI1fIBRQ7a5YSoHNuerSCZAeCwlJHYIR1gAhHuWu3WP8Al1lFSYqUVVLwkVBiwUQhfGWEGvXL7gxQIYMnojv51LhTQ+u67RID10AhDdyFMzMVHE3y5NQNMbNvYDPrehseb0OwOTsJYeJcU9qD3neguHkJOgHAHibHoJQkoyCYhPOF2JWWPw7OgAjUOUGx2yBkQFOI4FHsq4x68U6ewFAnpU2wAk9Ke7enHrvRiEK8ScYJT3ElBXq1QkgVQO1ho0HledTun7QEFnRJrjk2LSYIz0ORgBgFU+7gN7qs7dgGE4YewJxAthOBHkcwUEnAuAx+9vtnWsfbPsn2nJ9GKmxNcMHn1n6l9wOlfV3QiKtFN9V6-sh+nWZLx0Y+4xbaDM9iFIyszi3-dfj9i37CcGCcUDB3VAeQw1zJJFDHR7GvIAoFegHIAd9iUB3dyaL2EAcoAgGRcYB1FeswwgpbYcSoV2vAfpmJwkDlCEbNx0e5UHtOwwHAzz0lQ6K+wB8cmVxWcZC9lx28DctRsP0Xa6DNBlTYIepCMG5+3dd9Gy2lDiAbMA8alKyQK5WBCMUoJA7iibgVq+Oah0Q3dpKYLBuodiSqXlyYgDwKGNOMMUoCjmyKNdzurQ8MHd22G4tOhtNWYCaVdZLAWFZjvMsMECQ6wgaf8bWm2xIGBpfKDQx+zniOGp1mm5UcutlDOsgosEASJfwSSbFNQE8C2FYdvpI7gjfDYXWSPw7hGxDLUKUGjB+iOZ5gpOLYN+Tz1Bg6ENeGUKUCQO2Ez4uu0+M5qcMJaFYmEd2pmVGRbwGwGM1UAZJVIeqCNzupo7mHd3jGIjR6jo4sEqCQHQwStKHeggkyyYBJXkLKXztH2AJgEoCIYOAiW4TzJSEAdgHsfYAHHCjMwKwAsC-kO6IdBO9iFcGXVag6OysFsEgZ2MgIwEcAAYrkdUVfETjZxi4+0aG1JRrjxsX4csHx0PJHjJcYeJ-FJ1d5zoLSCYoKMe5-JWkpx2PV+FbZDSjdJClsIeTVi+gdSsoIZN3myBdji8IU-oZPhROmpvAKmjE6ie5jYn8AtSz0QtlMojwmCNC5Fo-mWAxCA6vaErpPhYzRhnJLC+kKybxQ4mOTyo-MrUU-hvHplOFXw1InAZdghM50cU4yb+OxKpTYAGU50DlMTKkNxRm5OkeMgyZMIVONvmSq-L+9zoAiTTkEHISUJbQ3gZyYWGIQ+B3T5oMIJcb2A+0l+rEKXnMCyDEZcKvSIir0OMi0muULpzjg3ooQBm0TKmn09OD9OpmqE8GkE5tpJgZBrqQmPuPTKUASbcQUWNICDzvBWZnTWiUhBo0rmPdMzmAYRJMCDPXqlSH07bBlFED3glEQUvOVcHHTzAEz08JM42cXrRgMzxCds4vvzNA7Cc0iFotVIl7wglEHZZQAiWPCyZRTiZhszoj+oAhDEaJ708Qh5QnnsWnZupAFtYgvDSokZj4ZoHoLMRV4KIY-PWcERHmDEU+vU6OtF2tnLzV4684ucx3yRgB9M2UJtGkzcE+ojKWaRi17TGBjVt9bJLknIldVQkj3MTj4kwt84xAEATs4zAuAwlbk9xmE051kYihFQbMN4wjtwjoWAQviJIVhYATu7cLzF-Cz7EIvEWOoZFhJhRYRR6V6mdMO2GTvwJMWhmeSApMEmwvOTOLQzJGjxaItgX6dVx0i5aa-jQnhLO+btq-kRPvHJL3iZizJdzByX2LKmxS7gGUv-BeLalyXckH4taW7kkOwMR5FcYGXqgEl4Si4stH+dhR+CypQEG6DmrnJn2Py+EsCsEKQrLQBAOKRNDxBIgFGyJB8i7rnrsoV6lIKUF0jbAR41y4MI7twiRXFFNYqcMFdCsjqGuouiK2EtKvRWKrcVhK6wrOR0AnU2fRwA7uS1qAjeNUtgotiaV7FNQXa1wEOBM7wBogvWJDYIDoIuWhLDMSs4XS2C+gwiRVyKAlo7K5A3VjgDLq9quBalZCXo9GOX3wJVQdUeqWLRNYLMix4FYvLAseE-iX8ZQXw8HV3kO4EYNYYaCNFGkNRIagxo6FGXvGDirZSLlh7nYeFVAlyp0SG6lEqijo7F0oBmr2svBUaWZ8QZ3aIkASTAw3KqLYWGzhg8jF1Etmgcui0T7TnBMb-BWIj0QSJFEcbFcPG80pLKfQI81uj6azE3FqwGLBBLomGkGkPtLIjkcC0UcyBpRAoiCbq39wC3ugbAS-QLSMbEGZZNCeDE0O5TRqEpCweRSVoLZhsojb1mbDNq8e-Ku0ygvwwqGerpiuJcBcVOXq926p+way5p3bQtjs5VwerDYKEkOlrTY6bMP3cc9lJts8l7SJpLEo7dBNFG6gCsV-X7yMithHkqwTAu1kgPhErbRog7PFSrJh3rrPPM9XuCuCKQU6CnUtDteNixIS426SA6OUvKAknbFvWQrJtrCUXB0J4CmC9kEyiA1GTMuXvkxrvh2kghqzy-nyCinBS8+rXcCcHD5wkts+5-udN37UBAbKVPdgLXacGfpUQuxNEFThhaXUbg8LCoFiq7s8khqnVPnPbbNLCknbJClYODftx5j6qeq5AfSVY3K4weGtYhH9bsZS0D9qyfMQhBiE38i869gbssAeqbU9modP6wJKpRAwVaf9SGlHlSOl6jooYBW1oMyxv2Uar9FhZgD+t-DsxTyOxpcEA25RyaO1jK2yWqqgPQ2T0nhhzUgezU7GypbsuqDlqsjScaW6UOs3TqL0Yb94VKOqFkQtVfIAVSGt0hghbZKMAVVB6RIkAsNH6z0lqR-Y2BoxacJsZRK9pXGSrI+fYV8kWzB5yPYG7DFqQvQ4B-WUCKzNzrYE1UQ1lB6M-tg4A0gIHoG09Qxwo5fro0cHfdqXTgmkC9yPzdyc6hXQwToS5GQeW8M44fquPHZqARBsfNofY2vHmIfisqHWAjx1QlgFGB3BUHx5PtHc7xsYWKlRNeH4mTqP2FSPSFCd4kiwxSobAjWwek7d+4k+iy+E4W-0emUi2aywh4WAjg1v725uKYGn8cjmQhP6ZSUhmAIMx0KEVjMdPGJ4FsPVR3339mw4mj2lizI4jDbp1QsxwoTScxntSntn8fbnQhaANggZep2h2OHTD-maHSB2kBduss0pqwNEe0rmZbAgaMhKG0K3Wf4jaJ9swIDh0gfb2+6V9NFE1i0gthuwPtzUJbCLzjtUO3zzWkhp2G6RHEEEfdj3uNZalRA3UT-NsAptP962gzm6cM8jYTPEnTBEOCsmcQfT0tqZJpkLJWR9OdxcL4Nhc4UmbOW2eAMx0FJpjX2bM6LBlG6BWt5WT0aZT53gMJdsvRWdklDqy-WdmP9r2ZfDJ8LSVl4u2vvH0K-kH4Eu52UrlGhhzBHdSG25LBVwv0EcGtiGePa4LpJ226sh6TYVOwMO+wcdSE9BsADjdpKX0S4NL7yxiHqU04NQ6oFxDXnFeDDyu0PUq9V2C5JdL7pt91j8NjguIOhL50QKvGyAnoh+c3TbjSCXtXWlzqXI8D5JaIrjzK6pUPO6AvCckgYPcTNx7le464nbwoH6MW6YSHh9oSuuoNYB6EQvjyadmPhDzt7B3Yejb1yPLg4itu6gKMBGWSvoaN39gtb27qz3RLK9OeI7ot34VRHDWRe82fbeuXECDwX71t6bnLyp6K9UeuuFXgbjXfNuN369lVAyiHTX2p7Txp4wu-Twt5-O02WN9HlUgWKX4ZeCuIJPXi47HX0fQOwO8r5p9W8F2b94Bi2zVV-3PkUyiKGx0RxvaNvQ+xB4V6N8a+uORkNe-lzfc73v9rSCjKL1vITYlDzD0+zt5T8x+nj7O3P13Ll16pQUNYNm2UenPvaMHSjP7cVuDDKxAQvN8Le4FyJo8gxgnknB72903S43eWJuM2NoOxxeIxF00+2jtRse46e-h053IqAAl2XKlf3g0CWSK5lorZ+S4cQh84sRmoh14Y8Y-ivQ1VA8KihM-svhn1UcYX0D+uPx6mn24PGkyG7HKw5gdbSCrGH0yPyJ5Q2yScOQyRf3X5LtJYoUcefw-JtiDfJDjsZAU5da1y9kCNFbitCRhruYZM5uOdRzcrKJu8btmoIlWCVQUPDl+NESCGP+bnnhpBA1vJBKJ4IZNI3tcrL6s8ZiMVWItGUFYxzop2123LwdeoaePNEN2CZHhgSbHzwb1GKsIxi-wcYjqap8Y9FHqm+D4DIqEIlGTCxKjH7u8hDCufFZw8pF+p58mYz3WcBgeOcGQiSf7w6oOrBsAu-ly3PlcuMf4kfFUTbnzyaCKaz+k1My47S76BH1hJ5lPvQ8m2UM5++GJRnyEwFyerkaeQAJOnsuFmXKBhFaG8KYyKG7Injivv+Xu2fRJJ9w-IH6Mwn4T81Cq6jJTI6jhvukwBlYfB8uOcS5+-VzYJ3LsXLeGDzXAi4gU+xCFPlyh9QeR7iQHF7nCXf4fI8q53UJU9y-qfzyR7d5aRBJGXhy48yfnFzqKeZHzMp6n9eDyIzZC33f2gPGUCMd8+iRiCPCCBnKzLRfMgH+S6lC+E-JMmx8wPH9ecUC2-ZxxkT4UrXTwelo+MerO6mQOEZjzOPP1C9KPG-IaZYN4XnU+O+8p5P1aQEkgcdwux72eOLvnYg3Jo80WTqKc-C-yyWpCPy0R1QemdMFX1yX1KZULK0vt4szYMJjLRdpB+noFEP2M1BlZ+3fT8lQIoERC6sVAgYoN8qAx-oIJ4Mcjn1d7U-S6ESaW5AcQ6l3xmb4iRj8mXXL17yWZpPqv5QS5m8+3fL5wn8FHzsHxAx+h8HJ1+7g3I5-sE0zxTo6kR+g2tzswOpDytiaH4gY-Sisy6xdtQSmkcK-WXwP9umDP0fY3HJ2Xn9l7Qfy4gzpXLRPYQ5Fljm04FLfkf98Zb738tdUJORP9tvBUBaID0GQnKNwGLJQmQChN+RPYnTPfzAC4fS5x1p+-cgGp9bYBqV21LqXOVlRyPc+ikR03TAMPlpXE4RPk6HN301IZGVllqw-FRIz3AlAQY0cRVaI93-lMFSgGmsuA31FhRc4d9B70LAPSQMNJeNqFCVmFBRSrklFBaCQ1RAZ40WNUIOzgRQ6Ycpk6wrMHw36hDAmxVKt7FKDBG8-wJDXTJe4Ph19AdodBCyVg+KxzHMjwOYD48IoFlW9V4vAgMQALYG+GzIWiUNRpUXGF+CpUiKV6FRAkDcdQwBprcIiY1VIMPlQIy8BGUpNV4T9HYogjfdTyDZqcbjPUZmM6XQJohUeHvNV-Ge1GNR9ODTyDhQICjlQ+4PKEiFUjHpHewXoM4DOhv9RTTU1KlPIKmcKiE51kYaFAc2cZNWNLXxB0nBhG5skdaLW0IOFPII3wQGbvWm9pVE+g7IjgH7njMiKFQwmCutYrRqCK8QjE2ARXHaEL4QoMXhVo1IKEy-1rDUfXDQIYboPKlBTFrAEcVrQARWtgpSRxWQxQZwOuDkdBJ1iDkgGmTmsdLIIJbt9DXyBLJlEJA0F1ugzo2UAGgegSTc5YI2BehPNEegyAsmb4KP1Pdf4DyC-IfDHewPGPcSt0u2FUHlg4UKuiQMq9OPVr0yCPYMlRhTde2H9jbBrAAwgYfilblVgJA3H0jkYIBAVmoETyEAEkTuCF8i0IVQRxt9eiArovQCWHxdKQi7QwM-9P2BmD+HLbF7BZAqmXBcjYfOCyAu-N1hxE9QthXThuOGYLKADWZphtCuEOQ0iRJvWRgPxIbVQ0bhqQPILUB3QRlADo-SKHXXIsXAoAeZjPGEOyMYglrySheKG+EUAu1SOwDFnGZbGJ1XUQy02CxjVo0TCFQtBG5Z1oW1URBY6USXRkNSU5Rflo5GEM+MgTH42mtEQ5VG0t7kduVDkS6dEKlRGGYSnpNBRF0IKgEQB+DSYPoMkzYRz+czEWww8T4R1MZkNoBmDNkc7lfIMoVQCpwTFKwBhAH+aLCyD8CScy05-TXM0XDEnQUEiQ-eJpX3Jw4VbCJpXGFSHpItgPjC-NXTJs0HDTwgtgkxCoBhhhA4LNhARxidVYRDBXQaTmfDOOY8xAtPTKAD2CuIUPCro4YbzVLQaZN+FfIvBEk3OgpLFiwCQ2LFsLAgkQjsL-Q14MOVVCMQvsLQsTLaS1ssQkABBwiG-ci2RCEILt0fw6sR62dYQAkqxMCyrIK1nBKrP63TI1ydJyXgI6PHkkR8yTqELw14LYknhXAIAA */
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

        'Enter existing sketch solve': 'animating to existing sketch solve',
        // InternalHeadlessSketch: {
        //   target: 'sketchSolveMode',
        //   actions: assign(() => {
        //     return {
        //       sketchSolveInit: {
        //         plane: 'YZ',
        //         planeId: '',
        //         type: 'defaultPlane',
        //         yAxis: [0, 0, 1],
        //         zAxis: [1, 0, 0],
        //       },
        //     }
        //   }),
        //   guard: () => IS_STAGING_OR_DEBUG,
        // },
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

        'Enter existing sketch solve': 'animating to existing sketch solve',
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
          initialSketchSolvePlane: context.sketchSolveInit,
          sketchId: context.sketchSolveId || 0,
          // Use context values if available, otherwise fall back to singletons
          codeManager: context.codeManager ?? codeManager,
          sceneInfra: context.sceneInfra ?? sceneInfra,
          sceneEntitiesManager:
            context.sceneEntitiesManager ?? sceneEntitiesManager,
          rustContext: context.rustContext ?? rustContext,
          kclManager: context.kclManager ?? kclManager,
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
        input: ({ event, context }) => {
          if (event.type !== 'Hole') return undefined
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
          actions: assign(({ event }) => {
            // TODO remove any
            const output = (event as any).output
            return {
              // Pipe the plane/face data from the actor into context
              sketchSolveInit: output?.plane ?? null,
              sketchSolveId: output?.sketchSolveId ?? undefined,
            }
          }),
        },
        onError: 'Sketch no face',
        input: ({ event }) => {
          if (event.type !== 'Select sketch solve plane') return undefined
          return event.data
        },
      },
    },

    'animating to existing sketch solve': {
      invoke: {
        src: 'animate-to-existing-sketch-solve',
        input: ({ event }) => {
          console.log('animating to existing sketch solve invoke')

          if (event.type !== 'Enter existing sketch solve') return 0
          return event.data
        },
        onDone: {
          target: 'sketchSolveMode',
          actions: assign(({ event }) => {
            // TODO remove any
            const output = (event as any).output
            return {
              // Pipe the plane/face data from the actor into context
              sketchSolveInit: output?.plane ?? null,
              sketchSolveId: output?.sketchSolveId || 0,
            }
          }),
        },
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

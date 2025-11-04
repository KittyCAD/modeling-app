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
import type {
  ChamferParameters,
  FilletParameters,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  EdgeTreatmentType,
  editEdgeTreatment,
  modifyAstWithEdgeTreatmentAndTag,
} from '@src/lang/modifyAst/addEdgeTreatment'
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
      type: 'coincident'
    }
  | { type: 'unequip tool' }
  | {
      type: 'sketch solve tool changed'
      data: { tool: EquipTool | null }
    }

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
            // This is needed because hole::hole is experimental,
            // and mock exec will fail due to that
            skipErrorsOnMockExecution: true,
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

        // Extract inputs
        const ast = theKclManager.ast
        let modifiedAst = structuredClone(ast)
        let focusPath: PathToNode[] = []
        const { nodeToEdit, selection, radius } = input.data

        const parameters: FilletParameters = {
          type: EdgeTreatmentType.Fillet,
          radius,
        }

        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theEngineCommandManager = input.engineCommandManager
          ? input.engineCommandManager
          : engineCommandManager

        const dependencies = {
          kclManager: theKclManager,
          engineCommandManager: theEngineCommandManager,
          editorManager: theEditorManager,
          codeManager: theCodeManager,
        }

        // Apply or edit fillet
        if (nodeToEdit) {
          // Edit existing fillet
          // selection is not the edge treatment itself,
          // but just the first edge in the fillet expression >
          // we need to find the edgeCut artifact
          // and build a new selection from it
          // TODO: this is a bit of a hack, we should be able
          // to get the edgeCut artifact from the selection
          const firstSelection = selection.graphSelections[0]
          const edgeCutArtifact = Array.from(
            theKclManager.artifactGraph.values()
          ).find(
            (artifact) =>
              artifact.type === 'edgeCut' &&
              artifact.consumedEdgeId === firstSelection.artifact?.id
          )
          if (!edgeCutArtifact || edgeCutArtifact.type !== 'edgeCut') {
            return Promise.reject(
              new Error(
                'Failed to retrieve edgeCut artifact from sweepEdge selection'
              )
            )
          }
          const edgeTreatmentSelection = {
            artifact: edgeCutArtifact,
            codeRef: edgeCutArtifact.codeRef,
          }

          const editResult = await editEdgeTreatment(
            ast,
            edgeTreatmentSelection,
            parameters
          )
          if (err(editResult)) return Promise.reject(editResult)

          modifiedAst = editResult.modifiedAst
          focusPath = [editResult.pathToEdgeTreatmentNode]
        } else {
          // Apply fillet to selection
          const filletResult = await modifyAstWithEdgeTreatmentAndTag(
            ast,
            selection,
            parameters,
            dependencies
          )
          if (err(filletResult)) return Promise.reject(filletResult)
          modifiedAst = filletResult.modifiedAst
          focusPath = filletResult.pathToEdgeTreatmentNode
        }
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
            focusPath: focusPath,
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

        // Extract inputs
        const theKclManager = input.kclManager ? input.kclManager : kclManager

        const ast = theKclManager.ast
        let modifiedAst = structuredClone(ast)
        let focusPath: PathToNode[] = []
        const { nodeToEdit, selection, length } = input.data

        const parameters: ChamferParameters = {
          type: EdgeTreatmentType.Chamfer,
          length,
        }
        const theCodeManager = input.codeManager
          ? input.codeManager
          : codeManager
        const theEditorManager = input.editorManager
          ? input.editorManager
          : editorManager
        const theEngineCommandManager = input.engineCommandManager
          ? input.engineCommandManager
          : engineCommandManager

        const dependencies = {
          kclManager: theKclManager,
          engineCommandManager: theEngineCommandManager,
          editorManager: theEditorManager,
          codeManager: theCodeManager,
        }

        // Apply or edit chamfer
        if (nodeToEdit) {
          // Edit existing chamfer
          // selection is not the edge treatment itself,
          // but just the first edge in the chamfer expression >
          // we need to find the edgeCut artifact
          // and build a new selection from it
          // TODO: this is a bit of a hack, we should be able
          // to get the edgeCut artifact from the selection
          const firstSelection = selection.graphSelections[0]
          const edgeCutArtifact = Array.from(
            theKclManager.artifactGraph.values()
          ).find(
            (artifact) =>
              artifact.type === 'edgeCut' &&
              artifact.consumedEdgeId === firstSelection.artifact?.id
          )
          if (!edgeCutArtifact || edgeCutArtifact.type !== 'edgeCut') {
            return Promise.reject(
              new Error(
                'Failed to retrieve edgeCut artifact from sweepEdge selection'
              )
            )
          }
          const edgeTreatmentSelection = {
            artifact: edgeCutArtifact,
            codeRef: edgeCutArtifact.codeRef,
          }

          const editResult = await editEdgeTreatment(
            ast,
            edgeTreatmentSelection,
            parameters
          )
          if (err(editResult)) return Promise.reject(editResult)

          modifiedAst = editResult.modifiedAst
          focusPath = [editResult.pathToEdgeTreatmentNode]
        } else {
          // Apply chamfer to selection
          const chamferResult = await modifyAstWithEdgeTreatmentAndTag(
            ast,
            selection,
            parameters,
            dependencies
          )
          if (err(chamferResult)) return Promise.reject(chamferResult)
          modifiedAst = chamferResult.modifiedAst
          focusPath = chamferResult.pathToEdgeTreatmentNode
        }
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
            focusPath: focusPath,
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
            skipErrorsOnMockExecution: true, // Skip validation since gdt::flatness may not be available in runtime yet
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANmEBmAHQBGAJwBWABwKpSqTQDsUsQBoQAT0QAmdQBYJYmmPVjDh4YsMKZAX2e60GHPgIBlMOwACWCwwck5uWgYkEBY2cJ5ogQRBNRkzOUsFOTFFGhNZQ10DBBkZCXU7Szl5KRMTWxNXd3QsPEI-QIBbVABXYKD2EnYwSN5Yji4E0CSUqSlDCQUTGRpZefV1GWF1IsQxbYkTOS0FDRo5dRpDKTkmkA9W7w6AvyhOsFxAgHkANzAAJ0wJD0sFG0XG8V4Mzmigk8nUFwRMnUwhMG12CGOC0s9mEGlsOXsdweXkIAFUmBAhmAggBrfzkAAWAQwg2wmFB9DGrAm3F4xUEJg0EnEcls8gUhmWhjEJl0SWq+UOJmEsjETnUyjExJapOIH2G-wC5BI73+JAC3CCITCkzBzB5kMSQjmmvMq2MyxyaWECgxpxoIsMNGUpWyKh1njaBAAKqgoFBMDSMAAzEg9TCBJhA3A0n7YNgAI3ZHD09pijsmUJdUoUhxoeJk8wUmnycv0iHkgdDW1lOUqjTc9110dg9PYTKCqEwfwC7FQ0+NjLIMAg5YhVedyXmeOkMmDaSFGyk9gxc2ECzsEqs232cluQ5JbQk2AgSYIAFFPgC6QzGevKz5LdBEMY5DhkfY1BUKV9zkDEKjKTVNRbTVUXmB9mijfAXzfMBP2-I0xz-KgpCiB04k3aYhAacpJV9a5kSUexCg7BBRCkCR72OE8jk2JwpEjR4oBw98Pz4dh-h6DAAIooCqOSPFA02WpTAbCwrHbYoZWsCRHCuC45F9JZDME0kRLwnwAHcwDAJgZN5KZ+CEap1AkBsEVlfJQOMFitK0YR6ylGw8jxNFhFM59X3fAAZVAU3YeynXkwRFACtJQJuQx9xPHZWOgyQQ1WFVrCOJYFAi7CorwgAlMAfmnP5Esopzkk0Vyck0VLhCbG8MTEUo61xGw2oqWoKuEqqCC+FMU2CLMcxGLlwUAxyZlVVyrjUiDHBuGQzzxSQuwOpwMm08bzIIAAJVo+CauSWpSlYRRoJssmMOZ5gxUCaEDH7zguLR6kMc7Jp8RksEwO7Vucp7jAbZZaklFRhDPUbyjyFUNS2TQQdwq7p0WsiK1k6GEByDjDMcY5NhWdKdFYwR9jrLQxSyhxpVlXH3wAMXZJMEqW8iHOrZJql+85VmRPJbFAr7VjkTimy2E8uKsLm8KIZdOhTAEoZFkRLHKS5xBRKRNjsP1WIaBX5AGnFw2Bx8R0qvGxJYf4BaJjd7pmawFiyX0T1KS5NT6jHFbUep9xDEr1YIZASHpPXgOsSRTm9C5fRRWWrYgjiA-VfzSqlOOABEQmGa0k1tCJBeJ4XgKySQg8uUpUSyvIvvsCmzfqI4zcuWw45jMBxMEedBCIABBUvk-ksQxA4qn6K8hFagxGRlDhfZN+sY5MhcJ2sImvGAAV-lQTomHYcfUEESAODnh6L1cuY6igqpjLPJsAqcIUbgXpjQ+mEhIXSnkwJgYASDmgoITbkJN9Z4gVqnDY20Vj2HplpPi5ghQthMAvSwAkj6gMmjGGBsAgTDCfr7WwixQJKylKYEwChMGIHyKYRYEELxinvNtOO1VUCDCoXXb2pNBCaAWL6MULZDKbBVFIDE9QlicUlFcCwyI8TlWIWZUGJokzUKEJoAK+RlBm2xkFOCrEjjGDhE2TUaILiLxuHHIgmBuBwOWgglOL1bEbEMssU4RxNJsPwa5JYVN+7qOAcOY+F0ADipcYwBG5pQ3MsBORexWiLcmnELxZDMbTeorDkj5ACizcU7N9yc20ZFPGAAhBcSYyAvB6IWCSJAwgGNanYQ43VFB1CsPIFGrF9g+JyF6OoGhC7ahqS7d8DSCbNLJLgO0Iiskp2YYsVKWUpSOHyH1CodYshyCOP1Y4vo44LKabgAIABJAiwROlrK8clJEcJNA2GDCFZhfUlCuSFFKIGMpF5x1PkMQ0NyiDYH+OQDM0CAhiFns8hu88wKU3yTTF6RSMSClRNIfsbNJQc0HCAnRZ9wUAhudFPAUCjSIq6Tk9F1NShYplDirE+LWYShgjKdWEhGSvjAKfBasACBTw9tgNMYQAhQHNEwZkLAmBwuGGuZFSUHqtlsSqVYFQdr7DPKBMwmhkamFsPiElMSSG4QkLARkqBLLCrIHAMVEqpWBFlSQeVAQwBX04JALpKQNoQX6qol65wUS5WKGoDh5w6jbG6qIYMRDSXPh8OOJkxAyCUEhmq5qSR-JlC2AoVUxhkRAz6vgw4mpDXSmDBsc6aa-wEHLvzGkwQ3gGgyfAlFLVFAQWVKqCCGotQ4qOArUUFSiVVItU+bCjaJyMgIOQFo3qIAcBZD0f4bRfwLq6TcTQnFC4hgAYiSxxRUGcNWIvVUUFkQNvTYuog3BYDtLwAESyHBmS4FNJAAIPwSCYB6B4oW6r80DzhC9WooFi3Sj2iM0K0hthxvyPujClqzLzqZBITDjJbl4wTvSa0HbPh-oBJwPRe6xRGv6bxCwaIpSozxXMHI-VRkthBbM4SOHsMPrw++AjbawDEcCHardAAvbggwc2ZJeS1G4IZpDhMIdUa4jh9oXnMCpm4RwmxHHvX+Hjf4+Ma2fa+m5onsASc+ABlkBZBiwL3cw1y60VjISLsUz0v9upFUcBUSw+mF2GYXcZ4gpnzRvr+BKvRtmX1ZuA-XUDiB5MLGkXUItCIsqRqMBeMwC8USbyQTkE5AWsM4ZC0+3AL7ws3KnnUnwAQAAalHZBuS0HMTLGwrCW2KAQ5Bg8h0nLUjMlNc6H1BaZOVsLJA321fqwATWa0cgeSCLxQSy2TfBZRsjoJOUzapI2uNjbK3jCrVXps3JXPo3NPskuZzhIqOwOWctnqMFkOs+JIP9KUHezj43GR-cm5VszAQkz4HYP+a7pN92BjSPMDQZsWx4mGVpLYW3JR5w2Ds7YJX-vHffKd4HkD-iQNwGu2FQIjRrtiw5yHItagaY0AjDGLCGwKJGSrQ9soYQ8KsGh2dh2DN45M0D6rAQLNWak5gPQAQAPYCgLgRzWxDiyhDAvV6xxutJeLa-F6kEuIYJxwDk7U2ItkewHoqXMucDy+awVEMaIER5KPN-FE9YF7oTmBodQhuhehZF+doI36mBzlQI1yjKpFj9SPFcTGRwvqsbcv1FQeQ1fiB97x43-u32wCDyHgIC3adbm0wFbuTYLgsJOVsL6ATzAXhlGWri9R09Gcz2dt9YAACOPQbOg6gODyjNiw1WD8UHfccst5BS1EoFU1Rm-Bdb4T6BAGkzSe7YlhANxdx4lsCeYwAMURfSynWIpYpkQnjMXPibC-Rf-B9agWcy6s+fC7Z4nt+bmELBUKcXbFhjpfRUPnHRrKHYK6KiJfrhnjMuhgKuuuhAJutukRLuoXvJPuhTEesoNkKev6EKIcNPj9OqPkhcOASFkyCuDSPONOF0llKULkucNwsCv6PMHCNsBcGpOIMWtEvzn9kbkmDav4AED0MHu2u8M-gQBAO4i+LgPVPSHwewIIYIOQDgAaIIGwBgCoQ+ioUJiIewLAGIHul2Pdi2MGFkA2D6GeHRuYFsFiiiNsDuMQdanNAIUIVoZ2mIRIXgNIWALIfIYodgMoaoWAOoX+JocJroSRDJm-klmkMfveA0LIMoHUMEhvlYIGP5MbF6CiGiPYbwY4YIURtoaKgCBfP8BINmEMCmKgP8J0N4UwAoUoZ8CoYKkEQuiEQUXocgRqj9JxNcLeMVL6KUPBCcu6NYMdKBGKN7r9txlPJZNNiJpUZZpJjZlTvZpQAEHgBUW4bmJIZ4RIDADfOLosZgIIOsagFQdkO9mal7jBmylbBsIGKIOIDvMiLKNjpMWNtMbMWLvMRLksXZnFmsbgBsUUZUaUZQhUVUbsf4IIAcdZkcScWceqCKCsD9BBHYjkF9H7FsihiYiGMcIbh8eupFuRr8dTqsScZsV4R4agDIXsYIESebgBscYCacR0UkIasgoDPbv5OqB5uIGYEZCiNUCWhePiTMYSWbtFssf8eScCSUWUewOCdUbSfSXokyRUWcRHtMhcDLFTOtvQgsMiE2LvieF1sNuhqmu8WKYELNo1gCRseIVsVSTSVCSQIWLAIIHwGqSyREevmMYGHlopBYD9KBMUu7gadthYJUG1I7AdtwQSdaXVraTKf8MUaCeUZUUqS6W6R6V6WcWBCicwiad1MGn1HYK-KNKINtCwpwc7ALoFvGQEDaXNnaagBSdsdSV4bSa6e6XoLmayUYJXtvCzP1AiJKBWioOYPMCqO-G-DOrWXGVaY2Ymc2cmamfKYqZCTfN2YIL2fCf2QgH6c9DYCxusC2H1McGYEoIvCiBoD6DGeaaNgZg2ZdjSOSQ6ZSVIR2ZuYIC+X2T6XmgORkIsBGgvL-v1KeLnMKEwkVJvGciiKKZ8S+S2QQLKWmQqRmd+b+Xuf+TdgebEbpJsBUKqLeFYL5K9gcPuJcEsBoMWieOFG8U+RApbr3uDsaCbp8G2U6V4VPD4DGAoexYICxRDjhaTIamUD9DTDLPDGOSMlUMBb6E4k4KcPeVwVMUxdLkJWxU-uwChSmSCeuRhTxXxY-m3rgIJR8H3sJWvgBXhcsCKEiJTLUHYnqaUJIGFPgepMWiZAxfWYuUTiTmTnCpTn8bAshe+e2c6TfP5R8IFRToIFKbAn+dZbhTBAFNkP1LYJWc2H1GbGUksJvNLKbNkAheutFaTubkFTFisa+cybpWuWCRhbSWVbFdAvFSFZQEla-r6csGlWrpld1Nlezo4IpgEoVaqMVT5VhtSrmCHtOEusuPgOQY0l0jpoNMzjcEsJsMUmoOIG5OcIMrGrIobtNUtdOBIPchwGKhABAAMNAlmKgHgJ7MlaTCcmoJObYH-LBOiXlPDpOQvBbPeChlorGdxidbNZgBILgBmQBsQG4v0IgUyF0ulZIBYMbJvGKLKAapsnDgDP1BBCiGaapWNmDRQRDbzCsragEEwBfCmOyHhOFVxTUXUX4Q0QEc0UyK0Z2uoCtSwgaaiCsBqHUNkAasNRjT1KcIPGbMdTSuDRIOTQWAqjTXTXVfpQ1RCXND4fUTfGzQjYyJzc-tzfuRkIbIaqqFcFoGkNtcjOBKqMwvjVcCKZNf9hdTpXurvtIMsGLMWrsnHnlPMGUKiBGaIA2IoIbi7QQOEc9XTsGLlsHPtfMDYEkXMJvLXg2IQiwtqvRSDWNjGGQZ8NgDZtAuQCHvNWQeDStdwvdjeTql2GRRvj1eUHyYaRlQAobrnYtfnYXTCiHudSsjpRVpwLgEBt6nwHZtutTXFHTUjeqAFDWucSGqHHlIZBxLYaEioMGmKG3XnZwF3cXfOJDdDZgLDawG2g+kjUKGlLiGiF2JYEnaYArFKONQhF5M4k7RIO3TAJ3ZgDLt3fvfLZTRPbTe+AzZ+TIRrbUb4f4U0brfrTocIDzUrrlUSjPr7VGvYO1NRXln2uqFvR3Tvd-UXT3f-YrZPe+KhQZerf4JrSzdrdAxocIZ2vA0bdcG5TuPeHvKOeprlhwR6KzOvYbj0KTqHrFh7Dhl8LgJxaA9xbxYIII+ISoYMKIw+uIwGgNbpG-KpJKBcPslYmBNYEWjKBkGrhMdnQZnI8I4o+wGIxI+Q2rdUUZbI0Iwo3ddY6o09Ntq3JGXYC9piEqPUAPNcKYBBIbrVGEEhaTaXYteXfuXUFlPdsYISF2E2F9ErCKIoFzjIkVCYw+XWVhqE-ZomKdRDfGQgaENwDdcuv8LmP8AQMQwELfmE-gFdiJSLNkLuCzrbG3GkHBj1moHWDBCfiGBeAvCE6EAU0mLLSU-gJaFulAHgEujgOQLSACUEJQLmNPZcJHjBqcDtb6F9KokbH1ZoObVoKM404U7LcQ7+vky+ZIzseA8zVA2oTAww8-hXbCNOghASBBT1pYGUG2HUH5n2Gnm-Tc000UxICQNdduhAOaPFPU2M7cyA-c1CfIbCyQPFIIA0+M-FqIq0zYL-A9q9KqDJb8yeCKC2MWvYLtkKHObEtxmCxc6TZC9C9M+i-C9i7c7Y+mZQzfGi3CzfJy+CxXZsLpHkNkPkJvHUPs26H80FDcFBtk0TQZkQAaD+IyxMxE6QVE6TStUnuUIoHMAkVkCqHLMNWbK9WoN5MwnS6AtxqqwRAEBqxC1M1AGxVUwCLU3gArcaGq0aEK4U+fQpvgvUEhjCIvVpIauo8neqGgkq-Ofa36064i+C5M1aduvMXMxI1PNdb646wGxM5m3gNPfuEiWVL3AdDnFpOcFtjKEsAmsoKqIbg64aMm+c5q40nLd67ar+i2+qym4U3c1+Q85A6zXQ8Ea8zoYYBXXZQiJBrfecAxlbKjW5A8ffZXt5aY4Fn20aM67LVCzdey4EGs62wW-Te4VI7IbI7UUewoX61iwO801HVuNtgsL-kEqpj9PeP-rCJttcJS6BKYM20m3u8yweyyAK3m6e4+3hNy+hby9e-FQK3ewRA++27i+svJMVBxLIJotsA7dYOPq5NtKnE2ICvgobooVAjchQtSEOzIbfnVIyVDWoUwEMIyC-iBjZSaQrC9MWagheNEWeD9PyS-S8VsIZMDTk9wVR80rR8MCrXKXYxIIx-+kcSx4EWx+DpxwljZSIK7qtVa7whUMUiprkjuKBMxNS829wPSdM-OAEN+u8DdWp0BvR14SQC+gTtVgAHI-oQAABqAGQGZxCmvojY0Ec762HUv0UEwKZs1wemb9FWdnbrDnTnv6rnsHelSnPL1Rnn7A3n52fnznQXgGGHsmbJGuh6dxB4FguHfUGC0gWKwdRh4rJVx77FCL3QD+7FOh7nEg8jJlZmD7PXgRw31WT1XVNl30xH3mR+4gAt-+CInEmoVhxzWgJcb9DZE3AeMJkuegA3Q3Al+3y+ZY+5IZCsCX7DaWWQPTSWzEnEFryIRj9gwT23i5u3puUWZ3R3d8X3ZlKpZ3Gp-s2wm1pUwU62FrgYMoqIlgi7H1hNCblpnxAPXx4mhxlusu8uf3-FT+0J3xmPvZ2PCuF3YoAUkGCd9gqwKsZ4d3BrGBWg+WDtHXWlplpGP3mAWP1uEjyLX5x3+PQPXPxPPPoXFxGiMdVFPzUR940gKILYrm7DTgrPaPOenqeeDWuPAPKhQet8HpCJZg1wbWNw1QsgDY8eWQ281Qiot4QyKvXXavweDnc2WvAljvev53LTW4hqv0aImM+V6CyORgDunKpw4gagdBfOyPT5n3XXne3e39Qlrv+P8fjJQlZxoEnE+BntAyi8csogzBbYMoRSnW9vT+VNS+XPWAyfplggbH5oVfq+03KVJyCwH+6oadMsVgh+TgbkGQKwU5bGzbC1MAAQcYi4kqoqK1gH6MhquyGCdd8wwYiwUE-te+RIyXI-NI4-39k-EdpEz7WHM-g8rfob2Qi-xgS2NPOyjuUf9LY2msZdO-axs0EdhgXvR-Fws-p-3jNg5h+wK-a-pRUMh387WD-LfmP0aQv8p+YgD-i1HqBf8T+fcX-ovyjyAD2swAjfluywyP8omz-PflQBMBwCkgCA1yEgPn7n8zw1idAWv1v7D8n+UAggXIGIFsJj++kZAQvzPD7waBN-EAUj3v4qsIB+A1-lQGEAsCEApA7-hwMoFL1fQPAzARNWwH-ZcBo-YQVP3UDiCEBh0QghjStZQ88kuBUNrRRUAEF6BeAxgSIIUCaCQycIHQTKD0GowmCNrG-v-CzrSd7W0KKjuDUiaj9dWMTfVgiDkTyBAaxwc8g2EbrxFG2b2GsgIO3aeCO2Z1V1jMzlzzMc2FTeITSCLak9xB5xMwPgnPyuY8gmoHxoSEGjVBUSKoPZKAIwwP8MhabWYtumqhQtsAfQL1hTWZDkAMh59ICsYS8jRwMgbOHrMoAWBrwlgpUcNPwLAEqs6hzLK5jdShQwpgGF7FFnIQgZa1Gizzehi4WfwmB3myCbzMWllBdRfk4Qq1lKH2qEVTmyXGYZ2wPYwtIOnQxYee0dKXs5oiHW9o8Ko7n0lQMoK4KnCUCmJGuorKZOTG9AmJm2Nws6ncLZYPCMhinNChuTeH8sMWN8T4U+2b6kxCy46WJoAnmAmlzyyiSUEsBhCFRg0Zg1QZ21gDZgOAg9N1rrSprYBIEA3KkTgG1oaEmAjIwIpKkEC5hIA-qC7hbHrDIgTOXYdhBiGqB1hTe4gY9E9mqEWlBBDAs6iyJpEIEH0DIpkXB0RHUi2RwRDkZAmOIpgeRNkDAKqnEEJc3K16JzISBTziiDgYof2khH2qz5N+ioiGuAx3SThwS3gvnmAyoZrCaGGwwIi822E6EGUuuHBCqAsCsxYiPjSoXCARjHAi0qwDQOSO36Ui-RHo5kF6IiaaiMKI7dYTrS2GhEGUVrS9DRT9h2Aki6VaQIB18zMQOCEIp4XOEZCMcqaD1EjFqwgF+DNBRSFfo4F5qHITkiiNAUWivKWBUEKlaPnEKbHg5WxLAR6vUImDTNaa-wF9G2MepXUbqK4tcfOM+BI1HArDK8uHyGSDDWBRwNyG1FIqdY1Y1wmcS2JsjriOxnbJIY8nKaPidKaQ60I-huq7ipuXHXCuT0N50VbaXYPPlYnUhy9165-E4G4OVbTivBs4h8b+P3ass3WR7Y0DMPvE0hfxzI1Fje2Q5ojAiiEzTu2L-G6cAJ6icoDkBeiO4xhddd+DDg0ROUTojYhCVhPfGLjaRzY6FD+NIltCfWhE5sXONIn7iDO+wYZk2BCgIhFEmBCDNo0VCmApat4ticJIXGzDu24MdIXeNUkcUfRXhfMQGMLETsQxsAOQHsKrTxoMCpUe7hIPOKHBHAF4daLkFAj4lf6jSHwUUxWoz4VEAMIZn2B8bnIAolwC2gMJNIuTtubkxIem2mYiN7qG4z8bFPfGiTnMNgV6uOPFCKJ4Qtg00mcheKuS96z46KW6y9GCST2nrXwksxWawA1mFXSIpiBsD5xEc-SHklW0QD99cs+6awFOS9z5TJmqEiDiiJ-rkBcJfLfCSiJ-Iwpp6i8AipllIpFDUGbUgAk9wBT9JrAMiXqcyySExUp44LfiZTSLrT1EBTEHZvtWLTijxkkeNUP7T45Sc4JWGcVAVLOrENt0RdEadQyeZBiixBRBQCtU0D-MyoMoBbqENYjpUOI6oXZCpk+TxtYh903+uxOQmdiy63Yw-vALqD9MjI2ubiGeRBlvR7sO1dUAhDAIRS968M0iZxIQKWN3xm426h7CSlG0uc3RH3hUDnanjMQmRfFB5CDIGRk07g94nDJ0mBBNpRUgICVLqFlSamFU5ZtnhqmHSCoRwbqCATI6mdKWWJF7ptWPAbTSZak58f1PQmENiJVMvSVe2RGYsi648LCXXxEnMMU65wD6NYkGSa5MQA0PcGHwMg0VbWNQp8vzKQlkyhZDQ+zgKn+C8SNxdTA6fTNoTiBfQaiE1oR1YiqgbAtELGTIgQGayBZ5MgOTxKpmuIT6mYw6ekGTpvRhRWUDEOIEz5ckqksPZYKnJ9naynpGkl6TCjen+iPp7NPWpO1gAyAK6aQC8cxG4j2B6gJc88BBnWClytgrxJQRIAelCSa5T4uue0KppK0lhLwlYe9LHabDjJoRNQCKzMBDoJavNMxCXKygcRmZTlU1OFKUGOdQ8UqCyDaECD0iyi6zfctsB1xKBEuDtXiI1wVgnJihVSc0bdKnGTgoaIsjpDfOrh3y1RsABqNhIWhu06wfiTeDs26goZ1sgoDiA2G2DOUfQLkc6GQGwCdAhg26Bzg-OeEfkdiuC-BcMD17XyVqT0VHIZDziIwFpG+F6J-gvrqhWCXOaGaAnIUEL7OoeYhfCIob5cVkFCoiXfGoX7k4clhO4hBD7RjFWZbYTTNeQJAnJwwOCkRbwrS6h5R4Y9GKQ+gG48LKFE8XWjzTSipBDW8sSskHzYgM4hQWIfSHpDlHYRDFhC7RaPRfSqim0uYiEoYrEWtzVGBwNEDiGTpFVHZ3UAqOMVAraYVAXCsyLrR8BQKHgzIh9AkpnBgAE4TIGlF0hWDjozk8gAZEYxskpBS2dC4KRUi-bnR4liSloIIuU5VK0lGSgVI-PEHoJJy9OM2DeAGo4oo2qIZmYAm+yVjKlKS6pRgBQpd5GR0TM0X3F0jOVBsmoEMHXUFCZ82wMSteOsCGV-hUlfwJJYI3j4TLkZGI6OlYBFCyBgBUoXIEkSWUKwVlKEbiMYA2ULotl6SmpcujwCdCMAe4yRYvFi5q4ihooUQN0qbCtZjYDkqwPsA9nPhwE2YPQNulHgSQpIJCiKl4ThWSQMAU8F9B4AZTvZCQhjB3LKBsmAyH6QzfxuMhhDnQoVUuWFeJFRXZd6qeXCQCioRXor2AmK-coiSqDDNv5JUAleqDMBXobAvYS1k4uEgUqYVMU6yLZGZESqmAzK1lZoJRqZFZEWwIJNUH-x5BmusEDBFemFWTz1KCBaVbUvpWwBpVsq9AF5LcjMJQKsPbuAkX-x2VWMm3HouPOk6irt0bieKAN3dXsBTVpolGQqCDSVzUSioFhKjC3jJjmE3tBeIOnJV6rpmXqw1fB2qJeqfVXSXagTWTE1tF4paOnlKFsFI4sojxU-DGuhXbpb89UNJQNzLVQKU1kisJEOhVBIY-o0GPqIaT2rUTr05ynmVwVdXTMq1Fa7xdUT7V-Aa1ZoyUegy6l5AzeTgaxQCnEq+ZKxg8VXMWspXTM4os0fggIqNlrq5ojqXMCOr9V7BJApqLiCziWCLxtqhrQ9MoEsA5Btc58l1bGrdbbqN1C0BNRuWfXsBd1YAfdYcq3CyhDgtQfBLYGOa0tWZxpcwBlGeIOJxxy6sVW63Bg4A+AA3BDdgD4A-r-xmIuBetG8zgrMsSRWsK5D2QvRsgGwS1bBu3QoakNA6-lDdHQ3kTMNEQ5nrhrLRfQTkFPP5ESNI0sJyNMUhDUfSNk9suedGvFi+yNQqB8hwagYftGBHUtk8C8bUpMLMg9q6RfGt9XmL43CbMOvaf5ugyVhEURi1i80eBECHAF5APG+DQTGQ0ExNNlXIQJGN0hogM6yqjuEkX95whvoqi5WC2HM1fEyGOXBERhTtRJgbNdU3FJIEYROb24KwVzaYGPweadMJLWJZCsfUiy+Y-gAbkA35ghb18svHsGvHvBmxZAprPKGGFawMQhQ+wcGTENATKbUtVfHStRsy3+BstNlQyOBBUDHBreO8cTXLB+FsaaYFWt7D5tILaxPWRskbTrH+AtbcKAAzYOcV2g6YNA0vA8jLF0i7IBlYoe3MNq1iTa1NEJCbQCGm2kxjlxUaDLfSQgDErY3jOXt6B+hSJMqPm8+JfGvh68H4OlATa0k6AcA6+F8X1PfDXRkSRN88UHm-GnwnJr1UPDUOUEjGnKHKSXWMrVqe1-aJ4b2vbdUVgCfbvtE9P7W9oZSSB0qDigONWhslqg04ygDOhHwwE+aW0-gQTGAsmBHcK4YAPwPTu4BHb9Y3YPpOGH7kK9HABKm9JxHSZGIMYr9BHSlpp2VxggrOmxv5qEWDcmdLOsZpMHZ3AROdwQ69ODvNhOAu4B6c4CwmF3vwdVtWz1JAiXywIDFECWlHFhV0oEyk4oDaryqX56lNQK9PuKyj7iKbktJa6Zibqt3m7qNvus3ZQBt1yY7dR89JsSOA37MlQUGIUOlA90+b2klWShIisZpJ75O36jFWaou7Hy4cfYQIZKwqCKJZACsI4Zfy1Wi6H13utLuQhT1o6JA6elPSHqq7gRkxyq-cNKLRDF66gmmaNF1l5oQrsItWi+EIlT2XsR91IZvawLLYtgpk6DF6FXisQOS3IqifsWiGvI+aJ9CnajVvsz0srs9Uy+7EcDyCWB7B4MhRQvDgUhpjAb3XnD5uqkAYx99zPRHvrlUHqDyfKzyH5kzr4Ju+ViOHqt2LQxxsoSWofSlof1+a6Viam1C-qn0f70YKJWisBvAr0TwdQYIiiwgknValNKWxQu4gG54G91We31b+tRTSBXqiIHqNcE7i6NwhTEFWP7XBG-ZathB2larXpWsG4DOQOhMdELJbBi+iiUpCcseKPYfIk42JLVoSRJIUkQwNJKKiNlQAIA7AGQ+wDkNwHGYFQI2ALR6pRwaDxQU6Hyq1DisvNoBkVSlqkPJJUkcAQorLuU6KHlDVh9JOodIpaH7czm6LeKNVwqItAxhxLedDdiVFaRA3UeO7GUO-avwWbWqevhaxGEJON4BIhKzDiu4AEN6RyTsk93YQAjEqbwNRpCOBHuY4R-AFkou6BgTk19VRK9VEDRd4eHtAaNh22ywT5yBGaMEbPwX0gCjl8CI8UfEEyhjNPUPjiYLmApMFMXGvXV2E1AZHhIzRnI7YfpVtGwAHRzoF0eaXv7c1LcbKIZDoLaYUmsvD0Hgjrzn5zoVyajkEFaTtJbQ3gI2YWEaQ+Azj5oMIFwbMXBR3IlFI1iUM0S5Jtm6EQyJMYkDHG5OdxjpEEeo3XHpwtxtpPce9XEGkapRmii8SnL9jHZd4MpMsBDZcJ2GjR2JP8ZuSCMlxhAK440mWTK7oTOehzapl5ydbRA37EZGtJOWRl16CdI440hOO4ngTsx6A6CcwBEm2dJJ0dZHmP1vdSgbMaLvMpX6XBh8JpfYEycWQ3JHqAIR5EEYJPTh7khoBU3AaYIsww+psYyEoBKEtg0FiaQ1rlRDbSnrkAJVU0rpmNQGNynJlU-KbGZwGygidYvsGAGqbQShP8FfuHxDLADTDEgMFOwAhQBAFh5OeFIigG5acIUIZoKmIAgDOGv+LcBfVFr0OLSlAaTdKLbD8O-YAzQZ6MxTgRSlx69kZylHmegSxn4zr8bqK3HcMpnMQtYcgxmaFIxLzoOZylAEBOphnCzRs4s1Uw7P-ByzvJ9-YzATNVmkzuhqsSxl0gUmEtzZ7MxSiqbtmaUnZos-OdwB9mBz++kgxhv1gdREMUsNuOOfFFeQqJCITzVmdjIuK+FmYqcGkoCDdBRlRsrgpea0XXnIFt5+82AAQBUkTQ8QSIKmvzIVIlVOUIpact0ja5VEa8GOuorwWaK889It87OA-P16nzGiriQ53gtQK7zLQL85+R-OrI6Ae6bqGBftxAa1Ay9WMTDjjT5L+iyEImUOA07wBog-OIcwPz3PVnkzly8oSKH7A+H0cMedWEOezhao8QCXPVNYuRJgWGD8s8cb8aqj8pBUX6xi9ueAiNg3IwaTeF8hyWOy1A-6l3TPmyhwxMTVqHInagdQiohzw0RuovAwIEsKgPjdrPcXtFStGcgQnHO-rtm1GvaOWc5WeBuDxiBaUQgPr8e4xC53LywdqHjVSD-R0Qftf9UbycC31dsCIbIvpP4J5F257l1ReYEithp2GUPHfOUCNZrTSoDiFKzAY+DJhzQlkRyEDrkytwANOUU3rWHEDmEv+ylfxPYCUp2AyrMDE0GZSho3xCwgRdFtVfcvB1Vuqy6RDlioFxMjw+Q1zN5FZ6ndv6CVMksyVWOljVg6DFghsed2VoNqCRcK5BFZ5C8qq0pda6QZahG9kEhIGEJKBGI+NKg3YG8PICyjTku1AC-7A2RtINYWyG1npJ1eZm4I2NSRGwJKAIpXA6jbYf+TDK+uLkmyf1y62yR3DNdZ1JhQOiUKEN-N4cobJWKzyQonF-rZQYMP4kA3hXHr9PE2DvHwS40dValaFSDgsqsUAe7Af64dGUjsFOrn0XOC2Gej3h5YGgNjcFZR6lUAQAVCqvmdWs1UKiqxsNOYFGjwwLyL0HKgnORoIQWETEaWjNVJrv7HNO8-miGDLSnIN4LCFfoAnk3G0lJE8kmp2xdq62uEKiK8JEn8jCdXcoKq8ADALVa2IWUNKogBnf2A12oaWYof3GKFY0yBqiX-BLFRCD7cm-2G23PJ9aAM6aut6dY7Z-iSgvkrUjfHsiNh74HsTgYWwZjttI2ksmVLZK3GUjRFDIwnaaQhARBogTeuVXBp-XwZDSQ8qd7GvL0BT9z7LAyRYBgqMZBQtuE8j+gaALoEM3JvdDgPbfkBrarWVhKOTcC4HTT9gW1cGevtjvcEx7X9du-vV9v4LMAAd6oJIG3wDJh0WgVGNwepb9KU8mOFu+Pd3pEMNJC80hmAFntpQaJ0l3DtpYkStZpYylYfEXcCzmMaZVjZRjVa035pDGimcGasHrakbFEmzXeBsEUhJngHeTGDuDV1tm13NsoL5rD0evoMs+YUTOGve42gssHfsvE1+LfGVNqmAdmnquw+qY50addJxDDkyKEUw0aQP0wyyoeFT-ZT62ZngHtvKJET8-Y5tYs9C8d5pHe3BBQ4nmgdO2cwttji3tv2BWsUiRSeTtZmLwgVkawrSa0BZnMcWKEtdDCMGlnt7bsIIUh1CkTHAPMs+nBCAMoqtgzNyXEDgI+nA4PVgBrediriox08no4XHkkeDKNGXPZ27Lx+h3Tlut6HAIRh8WinN-T4caQc3ldojz3g68v+bOHTYf4xOzH1DriVkMYc+ILYKRIWq9BdzMwgDBa4yM8WA6OtlHidntvMMKcvl7bmhpzLUGCjWJpHDU2iFHAqOwUYbUw6J80+8cQ1wO6E8WQi3Q5dO2++p1nIEmuBqr+SLCLrNETNR8OxssnGjinsyv9QLV5y1nA2EBQbx1VigXmtIkS4gsJ5KXM3FeYy4udgu790uweTls3g6Cw+NuCUIBiIZTAVR6wJXbL7s9b8Y3NnmZh0Ky2NgVaAoOJuoMhqrYJpRYP9Ek6aqsBvMmPqjy67LWpcsL-5H9P-b+MY4+0HAtBT-jeYtAGDuG7i-L5C8CXHzutES4RfhI+mUPWLUGFOCZ21lOQMF8DnxfS4SehL+F-CEqFjC6eaIWwdOR+gNPkrH3el+z0ZfCueeorxu+K6dz4Jv4laCrVGregSJaXk82PuX0d4a9ZbT0XnLPstrb548HCXfGjOh5NgBXouM187wtf+lRyrcfBLa6tjX0PaknH11jBdcB5U+ifJm4yHVd-TtGWr3rf03wQcFN8xyEN2+nr7L4sAsttM39JqCJEisj14wIRr8TfOsgCrh50IIsFKX6NIsfBF0Q0hN0smSdTbgBoBgnhpYJLViQkKPsfPtUZAg4XyWOEjJ2EnES1W9AcS0sO3LrYWaU4+cZBNDA-bazUGkkjIMgvHJzDWw+Q0UJ3cTp1s0L6AB2pyQYeoFejDBnSaTQxM3qM4YjdQt36k9ob2wyGMPpp20a6ztCL0jIA4al+nJsYJYjNlJnbllhY7QmwinhjDrQA5ru22FxOjXHpMGH0eIxv5TeF0eYJ8fMvw4tFJWM2CUAhgw4bfZYMegaP9JUxkApUdqK4n3zORFrkHRh8RMKLNmauOjKtmXr3KkPFIpURmPpHZjGkqxlyBGJfhCnYirmjTN0wVZJjo0N7rWbPK7fKWsOeIIl5ZO0x9pFE4aBzfCDhwRoiCf78ghJ8FmCOaH24uKZ8A0ccQpWogJuPiBsmStj5xtES7h15Safp52E32bp7I9lNSc74mx2nGZSPZMDsYjuLpFM+QQdUzqu6coMwlpywOus4DypJnms3u3KwbECrndwyI9m4Emgg0F+HZPBk4n8L858IWBzg5hnmd8GU5TqfcO-UGSQAP3DHII1lwBsNl5i+XMNJv6QSQbN-H22rgieUNlGszj0T1oiwPD6Of8TiHxnsMx6VJ6rdbhsOhgyUAKq8oKLlAxHQrY5oII2ANpuXmKZTLa9xe3qiby4JTAyyxiclAGjBShmuf5OvZY3410I5FmVEMJTY8WfbeX6kiSoYKzQJ4e4OoRKyZRxhGt8SGRfBpRdVO6bdvKlBk81PR2ecn+bSwCspI7A-KPrKRTimws7aeCy6en3ZQNlzYxk-0NXg6E8D3uDwl2cXfGv7QhueQFTscJ+5qUiPq-ICngz4xMSpiANTGdRPRvDnjiTre7eOTt4WHiY4ExsmZfwIlQJiDHiJ8I+SZOXqKdd8SlbfpP8A9KJ15xs8pWZ9C4jvuCKSpTmE1cxz7XKR-XfRZ93v1ho6NSjQgkKJbqOKMzu6Rds8IR4koG18c+dZgHgafC31naeKfRyJRDllvXIhxRwQxYJnaPyw8QwDvhGet7S75f3PRX8ljpYlGJbpWccoZlZfEnQRG7ofpz606aVutAfcX8IavAW8sKF4g804A5qPAMRp8w31n19e9k6-JPXbeecnaTDtfjEO4RW8MJ8aPES8Glnw6YEOQ45L5wCygEOe8gigedZ8v5qGX7ReVgoTl-j9BYoWuKqaC0d-aIEMOhh40gcWswr6xEYnL9-Uef7BYc46KPFeiv8O-tFZyJsnClPZCeBLnJOzUCdI8MxgeVMgnlDwc-yUoH4Z17w4SFBf3GVynm2zMSxb2tWoyoYAQ5r-p5qqkJogp4PKnZRtMpiKYSKAfprVrGqNkEwAQBANuCqGQ3mKYDleKLkwTxeuTnyRbWPml6oQBwoJlDEa8iPlChqhLFRhhog8DeJi61egizlqfwBAE4EBbkzxf4VRtSbFAQoMGwn6JnGHzwgPmh+pL+TqBAFta99HxZGIlwEnS5AhwCu6b44KkSg+alGpgH46V5JsBg8gMlkDV4bti25qQPVJXrdq4BnxoUBr8MsD8GCbsWja4+0Mk77g3jBbAZY+-swYpaQWu85y+MwE3BsWY5i5p3+5LN1BIwqNPRgs+XuiurFSaWrF4+BdmucCKYS-G2CdY68FbD4EalqeqVi-fL8YsGO2ok4fOgoAAIsEVGNRJYih+LQjaoCrPnYh+HgawFI6L2ijoA60gcfK2EHVh1qL8hdpYRAwBLE4AD81OkzpVwSuvdC1WMwNOQUsiXKEHaQxgF3ATk1MPipRiFSrUFRBMuJbpB63gRN7JQcaDgh-M7BN7R10ekGnDQYCkuD4gBKWo3rUgnAWUCUse3ndwTIxemBCsYJiHgjyIRuilq76EAW9TqIdFH9KZErmv2KKYg6P+xp0KAeAYv6mAWr7XOMdqchpAMkqKwICh1CYbDabiLmAfBlZgT6BCdlhZ75C-nh3zpwFWq8GsBFhioZyGQ5n4GJmB5oEFxyzsvEQsMLlo4D+GfAKEZtAlwReIXK-jB9CY0slMNStg05CwRh850NMZQAnAfnBWEWHp1qqAKTLUDy24bGJTTkppicYY6EJkCbMhBQf-7vw+Sm1jr2jXB15dS9GLtBSIW9tiYCEfdCqFxBJSPUAnKhUN7QwgJNgcg2IUcMfqmIf0pE7PgRoXKarilpkKGqhsIJaIZA91lei-I2QP179ibhoHAtmq5sGaeClVIiikhQYeSE1mSRG1AB03fmEF9+c5oGZtmfZgWaxhzcKOYUhHhqxBrSqRCmF0hEQc4qoWi-hhbvmLQAHZwhwzBLQ8QP8Dig6QjdtkFmI9oloiuAQAA */
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
        }),
        onDone: {
          target: 'idle',
        },
        onError: {
          target: 'idle',
        },
      },
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

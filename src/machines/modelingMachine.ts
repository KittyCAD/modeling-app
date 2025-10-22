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
  Store,
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
import { addOffsetPlane, addShell } from '@src/lang/modifyAst/faces'
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
import { EXECUTION_TYPE_REAL, VALID_PANE_IDS } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
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
import { setExperimentalFeatures } from '@src/lib/kclHelpers'
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
  | { type: 'Set context'; data: Partial<Store> }
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
  | { type: 'unequip tool' }
  | {
      type: 'sketch solve tool changed'
      data: { tool: EquipTool | null }
    }

// export type MoveDesc = { line: number; snippet: string }

export const PERSIST_MODELING_CONTEXT = 'persistModelingContext'

interface PersistedModelingContext {
  openPanes: Store['openPanes']
}

type PersistedKeys = keyof PersistedModelingContext
export const PersistedValues: PersistedKeys[] = ['openPanes']

export const getPersistedContext = (): Partial<PersistedModelingContext> => {
  const fallbackContextObject = {
    openPanes: isDesktop()
      ? (['feature-tree', 'code', 'files'] satisfies Store['openPanes'])
      : (['feature-tree', 'code'] satisfies Store['openPanes']),
  }

  try {
    const c: Partial<PersistedModelingContext> =
      (typeof window !== 'undefined' &&
        JSON.parse(localStorage.getItem(PERSIST_MODELING_CONTEXT) || '{}')) ||
      fallbackContextObject

    // filter out any invalid IDs at read time
    if (c.openPanes) {
      c.openPanes = c.openPanes.filter((p) => VALID_PANE_IDS.includes(p))
    }
    return c
  } catch (e) {
    console.error(e)
    return fallbackContextObject
  }
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
    'is-error-free': ({ context }): boolean => {
      const theKclManager = context.kclManager ? context.kclManager : kclManager
      return theKclManager.errors.length === 0 && !theKclManager.hasErrors()
    },
    'no kcl errors': ({ context }) => {
      const theKclManager = context.kclManager ? context.kclManager : kclManager
      return !theKclManager.hasErrors()
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
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      kclManager.showPlanes()
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
          return Promise.reject(new Error("Couldn't add extrude statement"))
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

        // Remove once it isn't experimental anymore
        if (kclManager.fileSettings.experimentalFeatures?.type !== 'Allow') {
          const result = await setExperimentalFeatures({ type: 'Allow' })
          if (err(result)) {
            return Promise.reject(result)
          }
        }

        const { ast, artifactGraph } = kclManager
        const result = addFlatnessGdt({
          ...input,
          ast,
          artifactGraph,
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANmEBmAHQBGAJwBWABwKpSqTQDsUsQBoQAT0QAmdQBYJYmmPVjDh4YsMKZAX2e60GHPgIBlMOwACWCwwck5uWgYkEBY2cJ5ogQRBNRkzOUsFOTFFGhNZQ10DBBkZCXU7Szl5KRMTWxNXd3QsPEI-QIBbVABXYKD2EnYwSN5Yji4E0CSUqSlDCQUTGRpZefV1GWF1IsQxbYkTOS0FDRo5dRpDKTkmkA9W7w6A8m5hvnZR6PH43hnU4QSVYWbYyMQKdQKRy7BDCfLSYTXQzHUQmJQuNz3Fpedr+AJ+KCdMC4QIAeQAbmAAE6YEh6WBfZisCbcP5COaKCTydQXHkydRwjYw44LSz2YQaWw5ex3B444jE4ZUl4kIlUkgBbhBEJhSaMmLM36JdlSSHmVbGZY5NLCBQw040CSImjKUrZFSy7FtAgAFVQUCgmDAAQwADMSD1MIEmLTcMHydg2AAjbA4dh6fU-SZs5LzNGHGgSmTzCG1Wow+SO11bMQmHKVRqYuVtCTYCBBggAURJ1KCAGt-OQABaZw3Z43JZFSQ5g4RqFSGZbImEVMqQyEQyFw+a3Jte-Ct9tgLs95WwAfsYdUKRRJlxcfTIQNcpQ23XflKeyFfSIUTTuQAXMcIXDIThSJ6ngtm2Hadh8VI9Bgo73qyE4iDQjqbLUpiFhYVgmDChhWJIjhXBcci2ks5EQY8UCHh2PgAO5gGATBISyUz8EI1TqEC2zZHUO7GN+xTXPsBaLjYeQSiYArUTidHHgAMqgoafPQYxjihj7JIogJpFOciGDI1zbDCC6SC6qwmNstaKGiclQUeBAAEpgOSqCYJSbFGtpgiaDxOSaLpwjFlYwgwmIpQKE65E2P5FS1A5B7QcepKhqGwTRrGIzqd8mkcTMc48VcOFgo4NwyGZEqSJW1VOBkhHqEltEpQQAASrR8N5D6cTpKxOjQxZZMYczzARGSOuh5wXFo9SGM1Cm+EOWCYN1Wm9YI1SOsYhbLLUUIqOFP4IKa1zlHk1lOJs2zgXukHJU5ABiqZBmpt4GshBVcf16EZLIlxzcux2GKscgSNUshzvYAFWAtrVEEOqqhtSa1fck1XlJc4gCqaxm2gRi5g-IUViu6813TRi2wSwVJvRpn05n5NiLORyghfyGh2sdFh1ODxZ5EZIMQrWcNOcgJADqjjPWJIpzWhctoCkDIlgtOWTiMo+xHFCjbNPdLVOQAIiEwzakGuoRLld7sYzWSSFIIWXKUcJGXkBH2P+pr1EcpqXLYosdj6YAfII7CoIIRAAIKG1LE5iGI06OKzi7rMc+HHaB06zqB1jHJkGJ65TrUAApUqgnRMOwofh5AHCx75iI8XMAmrFUlFmcWgJOCYoPx5dBdYvri2R0wTBgCQ6oUDl71ZuthXnOU8cbGVKz2DowObNFtYuqY8eWLdhfya1PqT7AtLDPXG0VAsUIQ8ZMl1Ao6-FPkpiLLOyLItUNgB8ezmoIMC+VsPo21QpoBYtpDIQnIpsayUgYT1CWODKEVwLD8glAoX+vhyAkCDJfGYmhAT5GULjbYEk5AIMMjxUopolg8msByLBRBMDcGnvTUBvknZcn5DyOEoE8hyHTi-OsPElhJx9mggezYHodgAEKoA8uPXA+IehJnYOqMI+ChAVCISFOyIj5BHWKPsQa5hBFgjqBocEWgsHyMUWQAIABVXAepgGzzRn5fMWQFCInvo4fIEUKjRSyII7INRbS2IUUGBxABJU8wRNFuPytLaoXJNA2BBlJNEEUlA8R7ouQG8cD6DyLkeCQQ42xgGLtlWABBI602wOGMIAQoDqiYEOAILAmCRiGJALRyRNBmFKNZVY19NZGMQDuMwmhDqmFsJKXWJSj5lNgEOVADFqlkDgHUhpTTAitJIO0gIYAK6cD6UkhmqFTRAjBJFFBg1zgCh2MdNQb9zh1G2CFUQINinSNoj4C8w5iBkEoKtC5HDepaBClyW0c5jD8jmhFOshxITIjqMZEGGwFoAsHEOAgxtXrBmCISRU-SljEUhDYdmj9wQRWnOhFQQU4Tgm2DJbFgK8WvAwMciAHAQw9CpG0fsuL+k3E0ODaxLobiBR5CuTY79gQOzmKsfk7LcXEG4LAdRJA8ABAYhwDpuBVSQACOSXBPQ2F5UudpOYGwuSDVqMiHxS5Krc2kgiUw1l8hit3IfFsOLLxDgkAG4cMSxYSyJWAElJJTXUk4DgsFM9kkThuIuco+iLg8wqEIyZAozBzByJFExwtfn7n+Ry4NHKw0dnFgObU0bAhrMFQALzeLg0VGRooqHqPvaoSIubFAdoiMxxkbhHGLEcNVgbK24urceIgmrtW6qbdgVtJJcEhkTIMKeoq0Q8SKisDcUK6wEVMF3EKVlHAVEsFO4cM7A1zo1bgLV6pdWUgaQmzdWqQWWutj5SFDVwb+OWIrQy-J3ZpqXiFHx5wciCNvUGkNQ5H0LufUu5RkdZE+ACAADQ7bIIEWg5hGQ2NYSEEULBgw2FcMEWQe7iDEAh+9oanKoZfTqjDWGAgAE18PBN9hKci1xRlIsihK1egj9hP0WX85jiGq2scXa+5RZBAy-pAf+pIYq9LVHqN86yhMCLeKBNe4sdl0RNQpvJJDcmUNKY4wEIM+B2AjnBZpyZFxHRpHmBoWhApCwES2GUBwqsNiC22ExpDdm0PKc6dSMeuBeXkB6cqXl36d1uZ6lpgzJm9oXSfoWeB3MHZg2yLWDkhlsg8kiwpjsbH0MBBXWuwYmBMB6ACLg7AUBcC7q2IcbeT9IoqGOAOyZPim6DX2DcACa8auzsUzFhz77424Lax1nA3X8MWRdDJXh-iNAdwFAWIpU5XmWb9QeGzUWFvsd1bAI1TAAhh1wx26yixIo9z9pdI4BEi1AiG6cOskVxBzYfTdhr93DlPdQDx17gIPZmcpeYiZCBFygXMIiQiCKAKCPJhd8tuLbPg9i2AAAjj0DdTmoAuY7cYG5lhSMolKMJIwUqJASU1koay1RQcsbq-Z3VTAJ6reoJlueHmJQDVsA7YwM0BQE3R-Ues-IlWbF58h4nDmqQnNQJSF4AuSQMjF2jfaCwVCnEkyCTIBEVBqx5rWOwtq4Tq8fVy4MtdAgQAFUK88Irjc5jFf+SVyhsi8gocdJYjo0SR8yFkMVLunLDlU8GMOHl+lGVKODQTiJDLx3tPMGF9CcIaxCgnoMEhMoBB6I94lRJDcEAgKw1suB3IDgr-4avghyA4EVIINgGA+8cr71Guv7BYBiFFZWLkihr1ZELDaMyPNzBbEGjJUQ4DhBl7AO3wI1f62j9qY3uMzfW-b8yp37v2Be-97AIP3Fw+G3j+vEm61kK0jRSOIZFOmc6g5pOlYR0KFLGK0PNc7JZf1Cta7cvSvPfWvRUWpakMuKkCQGMIYUMVAKkToHfC-HvEkPvSpO-QNB-A-Cff3MBdCIDB2awayAUJwV1YoHkMwCwawOqL+YwJjSOBiHVRtDA1dNtTAL9bdSgAIPAdAhvJvPAU-CQGAKuJrfgwQUQ1AdPbIaKK4TJDYZ1QiU9S4J0UQeOdmagiLKzCAwnTg7gxrXg5rDdNLIQ4MRQggRAjAlA8+dAzA6Q-wQQOQ9dTABQ3AdA5Q8EJ0FYdCMEYsXOU9ZmOjZuFQF0Y4DgrgvlZbbAT9Gwn9EQvw1AcQ4-SQ1ANvGQwQJIhNXw-wsg7SNFKjWaHbKFcEZ+IwcQMwCiAUaoOFREeI8wwo6wrdNI+wxw5A1A9gVwrA-IjonwxQ5Qt7axQKWwWwLIZ5ESPtNJYsGXB2KwJ+NovlTDbDHDdIsQo-bfHIvIjwkgJMWAQQPgYopQ0o3qL+R0KDdCCwdCZEWohAE7afItK4CUfyPHcAy7CtMwjYrjbYnoqkJA5wtAjAoYo4k4s4i45Q44IEVfNmfYUoPPbmOwJuBKUQMqJ+KRMtOTCQf4wITYnjHYzIvYk-XI7ffI4404vQWEq4pINFMoVWQtfkBwJFFQcwPMOEb1WoGTPEmzQkgIYk7jUkhwkEpw-owY9wquGkwQOksYhkowACR0aqQiMmdcCKNORYJ+U0T4m0b42TQUhIwIVTIMMU8kg4qko4-AIMekl-CFRklUxYJ5eOEEYHcPFWDQcoSxWoUCSKBWdY0020uwjI8U0EqUiEmUwQM02-RUh09zVHACBYeFHRKgpeFnVHcbLkHaSPLcIdDg0eNbKnFzfXRbPAdgLI-YlvSkgknwH0LvA3QQEs1zBMrLZU5YBEzYDFEGOEKECKKoF020BOFQfhQ0gUv4os9rFsss27EkcMyUlwqMyOesxs8s3AZs4kanVs9hRMpkp0PkITP032QLMEFFCUSwXCHxKiYw340wk0uLKkBLJLFLQQ7osMy0msw4quMeJ84kF82kKkQQVIqee03c9s1HEDCVSKWwLEksOlI7btfheoHGbIIMx8585I18kC4Q4EiMpctw-I38zC5LQC4Cro0C+M8C8XSCvrMrDFOC6EYrRwaQJYZC4wOcNC28gnadRSPAFPKJAgJPfAAStPJUhAcdaKaSNEG4OhMEMyHCBEqrFYUJIw-HfEviuMaHDyCQOJDgOpCACAAYCeaMVACs-pQRNQLkmYtIYyUPBS8VBOeOOwEJb1TBbijS-i7SzACQXACE3BYgFhfoX3QNCyt080LGUCXPP-PMLtEGGaSKMEAURjDymzTS0Sny56FxVZTpMuUMVMY8T8qQ8-JgLvXAquG-Qg4cYg+A9QfpNEZmLYZYF0BFI4Z4+YFi3PUKU4P2U0JjdK7yiQLKxMDpJgPKgqhcvogirAkqsqq-PAyqkK6quAw3Oq8SiaYiQROcK4LQNIdqw6GcOcNEJKj48coeGzPSys0VGXaQZYLaHxRcQzF5eYMoYCItUQQsRQJjS6ggZ-aik3EGJg0oS4MmGwGK2QLeCUaqFQWsKGpjH0ZPEkbADdCecgaHISxGES7y+qnPaffzUZSsTMv0wEZK5YTYGC6VeGxGzgFGqkNGsOXSlxSs1DTgXAC1Y5PgLdIVMalSAqsKnxdnQRNqnEiEUbE6ciacG6ERUc+OQyKmkSpG2m+m1AXy-yzAQK1gIlDlCy+jGFciGSSsSwGK0wMGRcTi1cfIa4X1H4niu9BGhWmmgQ1G6HIavAEa3K3mjsIq2s2ay-a-AgpaocGqw3YQeqpwQEPUnWbnH7F5ewAKSPJeRQWjeWmARWp2uml24anKnm-KjsXosEgYqM328q-AgfQO4OsfUO9a0SQ4eYaGXOHkMWodJgnxFYQSa4JwJjHoRLGHb9WmJDUkXAKsiktvFchs7uxvPvQYfujlQe-pEQYsdnZubCW+UwIrF+eE6wLYKEHIS81VVKitCe3u6e9gAeoe-OyMtwsewQI+qekys++ei9cTJ2CwWCz0xASyw4a4MLL2MEJjVyMIWM7yjG5PbG8SuoIyafYwaUSsYsQLAjewaTRlP6NlA+wnAB7dNTQawkn3UIbgIy14KkOMKkAgLOjpbXQBkMsKyXArYmZ2WyulF0dnZYJXTtREeOf+0ITB801PHynB-ATUQVKAPAISnAcgPsdIoISgOMMKnQp+Z1U4NQUQMWxwEGTGeOYyTQHamxNB6dDBoB3h127K5aIy-RkM4eq07A0qv2hagOofFasfHGzkYyWsVcKUewAcsTfIX-a9WsfYFK9SmzMxrBwxkgQyoVCAdUVSAICh7hwqiQr8s-DwzvSJkgVSQQWJ2MsKuwFmfSIaOcfs7mVYeHUW0QACOsHufk86itYJnhqJCQMJ3lAR1J6JzJ8xi+6anfG+0qlpquNptTHG+VQG-iCGuoIzM0Swe+BONOdg3Ru9IgRUXsWpjKkBrG3h+qobdNEhZQNELagiK4LtRg5VT+NEKpymGzBZ08AIZZ7Bk0oVQh4h0ht2nK6RpUGJrhrJ9anuD-B3VlDkcjYGNFJeuYWjFeMAo0itS5t5m5wx-hqAQRrrERyOQyl4RZ5Ufp803g4RnrdamCoIpYZQM9SwZWVnVJXPJYL5NmUtapwnKFpZj5kMwashk1Ol5UZZixxJqxua-2su+xkfeAwwHGzsnkB1I284RcX7b0wsdfT-O6zfOZoNVl65hlkJ+pxpkMKJwIV53sDF+J7IzlzKbp4CzVrvNFjJlVvBXF4yc0YCeoHzaaG3TkOsUdUW5EUwJjJVmFtVlF3p1Fq53Vyagu6Uw1lJk17VoC3VwZ6cSGF0bYD46wfZiELkOKDRvMOoAJm2-E7vJRIIc+PV6sqQ7XNyXBQQPygfIXFzI3NsmilYsGQaAw66IybJF5dCBoy22aL5VmJjbNhxM+XpQNy+rAots1Hwst2-CtocKt-6xmT5Q4aoZQUibiLQ46BYiWuwZEL8aGD17gJIgR57I1IkIykdi1DlqQkgLVerZTAAOWNQgAADVzV1N3EcxkQmHYUHUoQRW5i9hPNCMLQikEpJ0FWJBUNd34X93b3TVH2B3Onz32BL2OMb3D2H3MALVlDOSqs-ZJsVUUd9hshpBV8PqIRhn0LXh1z3nug9cyO5yx9T3azJ7qP0NzXKPb9GPlM6YrVHTlTvSgsaMfFIoXQbceRwZIQV8tGtBFxSODcLCW1+C2s6O28GOmyvCWs2sAiwZToAJPUor6DJkvxwZTRuIMg8O-7gOhS2Ols41kjVs9AFPt8lP1yCirOE01PxK0Ub5tg6FtZJJv2ToRX2ctZLBxWZiM2IX7zzCLPl1LC5P2tOtus7OJAHO5zPDovvC2sYyNscXq20ZP5AQHV5g8PVgSszIsg1xFAbgtABQVg7ApPyORi1s4uh7vbFPw5IuNz6u6TGvlCmGaMlY8hLhryO4AJpBaDNgNAtPO6zOHy2uggHtodcMEukumPIdSqw4ziAizBrgiNptixV5fsshk3qhdMbJDFau5zZuodntuNFvWumyVvq55TxjJoH4KJlhV4UdFw7UtBchxA1BzgZQpuIvpOycKcBCWybu1zkuQeS2WzlDkRwZ7i7r02E59nRAYVvHCIlcNhQuJzwu+UZuhd1RWssAIe2vBBCeRdE1p2Jx3PDgd7TgJRpirACYnAgQMg26JIMEPXMaYAAg-QPIRCMpfrwG3Xzp3O9Nsgib5lFh5wXrZcAfAnIWefgx+eBDGlak-rOPEz6gLgxfccJebAzJjB+MivBZeFrawvp0EZQHVfBeNfDBsucwdeeI-Z9e7BJfF8xIF3iNNHyILfcerfle+eok7ffqxBHeJxne9fvZ3fDeXkPsZfTffeFfM2Lmg-bf1ffqTAI-tIo-XeY+14iajgb5Zeze-fuebeQ-M+qA5Ac-eo8-SIC+PeXk85E+ff5euLFfaX0+q+heqBhA6+kgG-xfY+ibWY2+5fzeceaXA-K+Bfq-1BB-EAdeao49kyE4rhfOZcP8xFYU5h5H3Ku-Z+saM+++FAl+JKniuQ1-c81BjAzJwE6f6hNGe4HYPXsA6a6mPJVnef1nwHNn6EtlHHD7C1KFhygc4UCGzG8S4kZ+8zD-tm1ubcEhUWLJFii3IDwDMWQjPAPzTMB1glUh6frlkC1K2gYoKJA0pRHf6f8MqBJO5gI2chhNsAfQJ5sYxeAYCn2yabSKEm2hVFBY5wVYDkgLw8hu02sR5NP3OaQs2BTLZ5iYwCBEA2BCXYuvNQqp2N78DjWACYCcZUYL0-HbWKIByRgC7+i4WDJsHSSUCEBoTcJs001asCqBCg5Jj0zDZsCda8IQiJv3jhKASEEUUECZllrfdvMh-VPhIKoGDVGmETawegNsEdNwSbhENg4LSZVwIh2bMOjcCdAQM+48wFYlqSQRQglgHISyLcgr4n96msAGMBwFZrwtA6nSbAGPAUGlCKqQ+JgNULjKhhS2zEDABAHTwuUCwPCLHBkFfjCh0cEMcQFKkRDc5ChvPVXhXjqHlDhUgaKoTUKiGF0YhdQqqkHUaFjwFCLQuMJAHOQX9TokgPAX2VzjSRniMCSgiRghCwYecwHa3kUJ0olVZhw4AIK4WAbNckm7AHAkoNLq35y6ag-pGgkkC1hrIlGWwMmXfoSVh0tlCrtvVbjgsA+8zHvvcI7w14OUzwjAsA0WHBtkR3LWxry1UH8tDc-wu-gqk5jWBYKf+MrNIDdZXovwrdMwTwyHBFtOkZlGNLwx-4ZV6qSuGXo4CfhCQ6MCCBPtvSUC4Rl4Z1cQbS0kEuYmRLACsogImACN8qVILVMyIrIGUjKio5UTKJJAWVHABw83P41kAS0EEhMEzKaCsDGAZYcI2AYq0lGMjmIKo1kfUzhbagyORlLUZWWRZGUEk+DB0Rxz-QQVDIcIJeqICOqVgUex0OsJYBG6jlJeJweVkfzgHBCpR9o90SEMsHwtfWiQhkdKJZGVk3hXTUNvEK7xsDQ4do8drmLCqmJc4g0XhEsHqAIJ8gXmdBH6Xqj0iU8ZY30XKJmEuYP+bo3McwPdpZj2xOY8ytXSOx1hvkQ2KSLKgjGh57UFwcdA-D6o3DbRI4x0TpWZYENVxKY-sfmMUE8sfhfLR-HIE0HnlaCY6JOpQkCKIJEQRUXIMiA4IZ02RwlX-lEk5H2BkEM0WNn43BEogSawISsEBBsD+9rRBJJ8U6NoEVCT6votUcZVpi+idRdqcQGijUDmijICCbkNf1WIaN+I8YwIaYXAk6VnRLwocX6yVCiNkiEjO7NI3YGv4kgsYnUk0XJS8jfxq+LkryAThGCsUZnQiXw3TEat4hHWOmnYKriFj0mqNMKgnHZyrgyMgNE2sKFtwGd8kdkawNAkfHK0iJkE45IlkjjmMyGQk8gGFV14bhbQrcFQijlDxmBdSqsV2NvXUlSDjGQqVGiJM+EHjVhFdWAAoHqqaAygpzHekZGvLr0P6RScwDrGRAuNbAVo8UdOnqT00OxqY58UHz-4X9f80UFyp+CEGMphQw0afEo3BCrhncPEuKWuMCCwstJfdUyqqM9FwTKp2o3FvCC-yCJJQIrIKQgAVj5orAZWX6EIPsnJjgwCUiCUgIVHojSJ4bCieI0kawAaJRkiyEcBCiO5iwy7YoDPmCTmJG6u2TQL1Pim5jsG-E31s7T6kwS9x9g41kWNRqlii25PCsdXXRznBRoxfKwKBAGHo4Ian1L9ksC2klSuxQqHsVSD7Gqj9JEk3FrYCdBSZUEdGBNsdDnDMxIQxwc3IwQfFFSns202UWVKGngcKkf0mCcwk1qPCdyWvAMTkHSAgthoPQ3TrCGAlAhchEUrWDAOil3pYpyMr6YYzIZOThJx0j4dYxLqLUjxB+GQDjTSAmYvwcM+wPWKhlAR7U6wZCVsDUr4SYpT4lGeuMyrSCPaudfNiPXeGuTcRh4-EY-jUCDMhk4IHqryNxgwhfE04CoIMgRSgiEMAQPys8JICUBfAOoQIJUNQIyNxK9CUgU5RQqQwxaU2IED3Bow2AKWg0ECfTMNQw4mkx4PwObFdmojYAHkPXO7NolccTonJDYPO0UYhRvUvnQQPCGlaYRl43OfeupTIDYBOgQwH6TDhTkJdy5lc4YA92jn1V+oQWciKrH2gx1B0g0M3PRnBCeZysUU+SPXKrl7sa52UGDtEKwIjzG5a3ZueJR8zL5qMYIJOl-FaneMzECca+ETPdALQZ51cjmlzQEaB065LiBubfjW6B0w6ekVIOV1BhYkUc3yQOXdJBifwLce8s+aPPA4w5g4R8ioRyknlLDp5n82eeHCvniURABwGSGKBBaoUxaIUCyFQjdJjpGUC0QOj4CTlgAHgCgjlBgs8hYLHZFSD2Rf0EA5BooK8vuE1Vdh-5Lo5C19qEi2CoKPK6CzBdgsxFF1cFrCwhfxXnpkLDulCl2CsBoWmAP89C8dAUyHktgWF+CtheTmqFgMSFfCihbWCoVCKEEPVHMhkAYUSK0FnCmRS0AIDd0Qe8i5KdT18hKLC0KiwRW7AjGdwESW84mDou4oEBKhic-Bd5ReDK8OhECuuoAWMir5PshCcEUBBTJ6In4rpLdh5RHgxg9AQqYOOogQjqzLG8S+CBgEjhaoPA-w1QtKHVK7YVFv2eHkLBdjfdvU4c+SNEraxxK4IiSwBdKRSWJL0l7ATJeJUCJVB2GgibHssH25mBgQNgGsJZRuALQKlsS4+UxBYgKCxlTARpc0pSmAi80MCJqgwptx5ACOdlNeMCDKUthhlPuSZbUqLqTLpl6ATkYHMGw2B9gHsHZjbk7JFoJOJkWWbJm2UCMWEqkBLs8vYCHLvFF-XXj3NpkBl387VSEPSjUDR52GU2OmeUqnJCo3leytwm8o+X9JxA4AiwH92-jrByZC4IZDBl8QMYwMQyyFQI21zuR8FCXQlZgvhULzREtGayKyimhOoIo-IMoPcWM4y4fYeKmJUKlJXEr2FbhTlZSHJV7DoofvbHsCtkAtUUc+SRlVejsDQKhYYgiFeyoEYqQMoeIWufmKVWZRNkcYflWYt6jxwfSX8RQBYHJRaAzI5XCVAu1lrjZEZ6lR5fC3VUqqJ53KrAvavYCaqwA2qgmTRVrC1102kU4FXkFanLFzAU4fkK42M6SKDwtqxrJ1AS7LQcAfAD1f6Jor5gcYVXMUM-1MAEQ907OSPPICsAiK5VWy-FfCzjXYA+AMKrAqWoTUZKjl4DaKKmovRawSMf+NFHl1yQ5CNgDVNlZUuPlxr1ae4vtYmo0wBjpk3aaZu-j+hVR5Un1EbJeQuCERu1IyioX2orUV5B1Naz5Tqvom+S46u3HRCwRRz7CZw9CB3PIEXVCpc6r0BLpev8BDrn2E4YbtWCEGAQfJ1kDuPIEIzvge4-jKEOCqLUKr4WN6ysk6okBAa71HA3qORBnDDYKo2QEKN2n2YuCtq3Zb9d4nPUCMk8nQZGCQ3zGYbsN4GuiXsBJp5qQ8aQLaE0QJggyGgPIuykLDObyqe18LPDdSFXXMaqQBGtOVYEOBkJcgrjCEKUAJgfizRW0QsMNBq5RLi1AQUuOXErgPcPcCg1RJ0A4Dk8y4pyQQB7n+Eedm4XOQRAuy35XQfSv3YGkdyA42rJN0mtTWt3k0gbYAim5TTzTU0aaWlkgLqW-JgS-qO4eq1QEgwZQvV0N8LAlP4EjRxzJgi3E2GAFjlcNJgHGxMoICrB6J3Qos-jY4HJmO5-whqwhBdEGUSaANAQQLabGCAhbuAq6zwEFsi0WxcAMWiCnFsWAJaE4SWzYClvdjipzg4Sh2Fls2WRrJNhyMeMLinh1zR448SeJQCq01sI6tgMzPI0tr38N4ygVIUYP0jexC1XW3LT1qG0-pV1a2vrSNo3WipxtRkWSuCGm2+d-E0bb2Kvkep1h-NT2U+HmwS7apn0ebUbTlwtk+Y-G9CfIPyEzKfawYtkY3usuy1mbctD2vtsMFXUg6ntu2tzmDGaoAglwwwmSAgj5JmJXkqxXkfRv-WMaYmACftvmLLiAJ3VUOlKRAkgGXAWCnmZ2MaIFouhX5XOBhBGtohRr8d-bEDczuGDPaA8QyLgd+sIgnBrgAowIlvU-b2AkqnWxnZJqmm4IklBrBNITqaW1qL+aaI2jJEBpQ0gcvnL1I6AuAwZkty4oHVjsl150JSU1KeRXll0c6ae0yKaKBDhTQMtg323TU6CEjDl2GpQa7d3lYQJcPdWqonVup-bSBLKvIUKMJhoUZAu4PiErC9WITu6WEcYVjbHrl0zK-dLxMGK+EyAyV7dtYBsQ7CdArEqUjcf2B5WpgYFyhCXYODTHYCPRVN3YbFqnMTIEZiOWwKrLaFqD8QByiFODSEt8QLqi9fACvd6BA3l6S9Ve8uDXp4VuctddQTePFXyDr5PGgBN7hSyCjA4Fotab0PmMrkDgR9nQMfcQuT2ERj1oUetjDTmCBYmGnai3PVE5jLbaIa+7wCBs31gBt9u+uvRBTTQOwGVVtbPGOkCzDcLQEIAzCZGpaUw7E0SZRLZrUQaJS9+YpMFEh8CqJtUYQC3dpDEjB70IoIEaMNi8FMNWYfZHcLFAWigGc2EBxA6XpA2wGPI8ByA47PeW+7PVaMDIAj0pRwJHqHgrwVBr9IVNZwWnPCbJiIMOJu68owgDAaiTOJotdBpNS9uYZIhOpxwciNDECSBFoZO1MCD3vUr8HlEghsg8bqDZRkKDmAMQ9wGQOQpgktkT6qUGMjchAkpwGXpcHzV57eDeJDQ+kSVAJJoDCTKQvobiSuGuGxhrTGbjIWFgcYlEJQOCPyn0pvk5XPUhU0INRIc2FZakG4YH06HB2EgLw-El8MSHh1NFMoGDUx69l+Y8VelTnqRI7gYK9CD+RXK-nzdXFmCgIN0AwAJdZM+8seXjKCB1GGjYABADkRwTxBIg749nBKFNACIjgmgMWqQrUbfcJtDgJcCLA8otHv5bRtxXrk6OrrmjICg+bUfcWdHujNZXo64joCipIG6bWjBoFGGI6imtWxrcvFtDAiUqmIMdvAGiB-Jk9ggNugiA5jOxn+Ni4oPnO9LiBDIu1cJect-ivGlY3CEZKdHKj7AKwFBcqLMZmjEZf45SSpG6qeOSGZ2piSbHckyQqUm6RtF8LUBF1IgsYyJ1ZOsjROvG4oSK23JLx41mRF5X4UZhoBkgXAEMye+6bdWJixtLtwSlIbZRMhuk+yCcLfBybJrmBEqqQaaEKGereqtu6IX-GqS3w74q8NeAkWPg5OhIJTNCB5Fpy37S5yg+-VSdrFZPKmppxIYMKkwYgcR71NqLhN6j4iLS0Q4gRfLr1OAbtucTgV8GaaHw4INyflKuEmFvxWmbTEGrTB9RE6MoeQjgUYWZGf4Fhd4oqioHLUB58oVOnRdLLhQyL77iRxTBWHyCtonbd4Ae1QOihYLAHrMfxB8iMTfJTxSSOZlIccI5Cfs8O7sCguEr0RNttw6FYkkCWzP0GX2ddGKMRxXpbU-8IclMn7CigCR7IqZoklxlFKKEczOTf1QFLD2f4OSeXAToMjsC7d0KQDJcwOZp4vV2c-3bxmWfBFJxXqREHOYFG+6FkYljmLcqWTa7sBlzNUTCCXnK6ZkAp+6aaKDHG7Aj0KxFf8lhUAq1msz6BffQ8nMAJRdoacQaHSmZhlZzR-pT8P1S8q8Nk9MkJBE1RWBXQ6g2QCsE-Bl59xCYs+6rMBwGqGNLq2F2cMgl3MSIoUDlQEDGapTcgXqjh0CdRfqZ+VMCuCZPeUwChlm6MxwWGUbxkgvgQYVudcxjrvK8VML9TfSTnQKrYXw6DFzuFCEyQksTo-iTGLLl0wpab9+JWi0eZtSwUWYTsTCBOsPX7xygJGDpdNj1Ip1FQyNdOsrTUv5hI6BSUWcEvTZXHbKSuZYC5bToGSXapljE5HzdDs5hMRkKGoo2CXugMc5NcEJ9zmMJig09tVOo7TCsM0+LlczAIJe-hS502V0TWA-xyAxQysaIPIPmrFGVnCcWV1y0rUzoqyVLQYOi31hWDY4hj29B-gXlbiIJUE2PLuj3Rqln0OT6pViqldWBL7M1EYnQjnA2AXlBoNYThpQ1VYeRsL21HMq40FiEQPGwMOOgjy9S6jv6lFjKxIC9aaT0ZLon0Q82pCCWiuvEGYmFiiqZkRyXmUAp8dXwM78S11vhlpJQGhnCNElUCJtw8GPUboAWDeEcARIPw8Y3zNYsBwBtGMRqJqZZnRY-HFNZixCW3HSkXoPUt5w2HxutbiZpimmGY6wbqzouchmigUSBMcGeJXpbic0vtBsD9Ji78SnrC1hlW2urB00orbeIZBipOBVSMGYvoNk75yz5maLZVhta-6A3brD1qkE9YFqNQkzsgejATDewzYpQQRnPB6zluo3nRwNp66YhcoAFCLQ0Q7F2hgxxXKIoao21c1RubjZBxt3m3RYqB09BkkkYvh9xsAWyxEoEeKmhedvQtebFNgSdE3DbvMFbYAL2wsD3RKMYidrZZQ0UGyic0Q8yP6zZh7bgG82mpsTALCOCFZCwBSWE+kGFFvzrgQFm4Tuys6tGD2JqY9gnbMvXEYLYUf7vmudhhGZoHqaldjystncGs2uFjrOXQwan27jJDQHkh8kd07WLoZmysUWDTRWYaylPpbwZnTdpO6Z1rMUEitlFZ7KKAoN2mEwQgqoPcH0t8xtBt0OGc5ie7Fg67QW7UMkU+2IjUAX2XkIip3acC0uZScgI92LHvYa6ZcX7c9w0WemAwldJL4NuEOhEdsXWZbQacztJw67rYusINtOZiggfcgDMdY9qntWOz6Fho4CYy8aSB7kcVu83HDNBf6idTLhe1Rnr9jfgsqZKIrYsEA4czUOrudD24o3SdgTirgWa+VK3tuNSYGVXD3VNDzB7Pmhw4Dk+3g8RB1jENaUusK3RuCM2pHyiCnsT0KvT3WcSgQ026D5J1gccBMO1BaOb2xEkHW9xVoiLV4ZRsLDxWC8CNh0PwGTzMfIIiekiO4AhdjkDpKKiT82Xe2g+osFA5I8RdN1QPNaEXdYrikxg0oQwi2xZPXvbbdOOnokM6gC62e6c4CrmYL+P4RNoxJzdeSf0DeUfQQS3mCd09pdq8gHxIEkETSBur8jd8KXgSfmClL0gllmwKetSSyoW3KBKdByRQaHU3ONUgxjbEU2whgkocU9a0DMN0DN0WGuTP2A5NpLawXZg-HqsmFj+Ew4JwY9RwXRatawRaR4ME5FMk7S4UiOWdM3IOQODjqYWmBmFuymhdDrTbtxLCqAEEOhDRjzERCaP1g4wlXsUORFtGXhWFo5+FOEsGZuybBGhZCL2jHAYRryaZ4dIGlbWjnIyOe58hDzaxyZPcXXmjjEQsMiM6LxWaVKSczCNRtUt89i8YXX9qVdsSUIS7WCC3CwRXTPRS+ZnUvcGro30bTdlhiW8YLu8Ed8cGMu75wTyHlzuNRnetKb0drVtuP6m5i6LVwf7N+oTjQJ8YEYxKjFaVzTRsYf6+S4mPMGUvvpe7TGf9JJDm2Aj+ZlF+IEJdwacyrlXJOgdleqv5XG4np1uKTGUv1XooX5voQVjfaioiwZqo7DPO7PTXKD3idtfFR+TCIAUj2OouuSdx02mObs0jLRnJOKpgrhl1ZQ0cg1G4lWDCQvAoveZZKWQXqXy+GnKhRpaLOi2o3yHUEiImgYUIOS3BYkhan3Wt0RL2nWDUaalkixoAsMxF7Alz5aR-oLDP8ddq1-t0reSf-ldJamL25IHqIh5pQ6B4ULucWA-JCWxfNkzm+6eOSBGw77FwAZih1gpwCD2+MKFStchiEJk+DUU9AmMyMXO0qF4ffr63jk2Sga-d-XJkzYDhGKf7hYYhCfS5XSsmgbdfzfui6L9QTV75m9ijphQjsbhI9Wcq6aoPXrmD8RJGmSDw2WN6ZIByan1tgPWlwWs6wVjuC33EcsCcVOg9UuB3ir-aQrJKlqWzQYiB6mY6ugDDH1WlgKQdZdC4fOxub7sda4Lc-v6JxTAjtaAj0AG-8GCEmgxj-A6xNpObi1yzOkFszyA6rohOsEJY-LniBTbaJYgSiQD6gYnzF8rJYHtW27Mn5fqvFrqVBgIygHS2p-xaiQWTQSW2fbOjmvHP4uhXTXMmkvyVuYZ5a8pJEBMWHrVmbBY-NxTnYWoxYH1EKRldgfdUkZwVtiGNFWoMy5Gx1o7-K1Q+4OUye+VLAhmzDlTtj89Wz8kx6+YdG6laRZSAeDJ6RyBHFqnZCigAsX4r4HNU5SeT6Zrt9SjAK8aBzX8aVGCWq6lpUUSoW9SjBp39ajWwBJlE3nJuIGAhYkWTkUG3AXmq4ghSaxTa7W8om-elU0YcuBOZAf4C0QkC2s4I1Gu28rHP2RjxJYmknpIxjPiPiOK4QezvJQ4IefMe-11LrNQ6USvMl6Of5yoNJtX9b5jjYxVcgc7O6bFD7KScctWOqtRt5c3CjroqKEOZebXyC0ZkOEEDIDszare+153puG91GFGzYUW-WFDmXd4uVozkUa7UBvO8acPPKcPJeWGBj3EbkBWV8KXdM6g-7miMLDY9eh8TiDyyZMx3kBDyUak7QxkUDyE7TXaLNsmqzbynpdOfkgPscAUyjgTDQSuZ5D7FKBcqlBVg12-LcFqi3rRbTG0L1E6AOjZ2JO5ok7QUwM7UEwQfA84Ndq23DbXvzvmYB8nMDfqawn4WwEZijG3xSua+TtHJfF3A7btvSCb52VFog1E-FiJHfCSLTEIlPnFZ7zjuGATerKaCIdD5LzQ0KeRrFCAR3U5creJdsujb9QgafOpCLH2ShPKh17vJmiTCiXxhoT0V+m4RUUY7yHCkNipJdgIH3LG-Vc3i9DSfAJn8ZWN0LoW3AtOOYOaGmPkNBH7qvolhtBM-asFfAB7kM-PgYE6WC-8yZJepYj9icAwgagMn-Zf8JASPIHyAOLUSxiRnovCwgrabengwPKZwy0M3-A33zkkPbaj-tAXS7zCNLZL+jI0pUU0EhhH-MAxcNEjKLVX93-LeAdhS7T9mBBRnWWEQQ-7EDGUBKjBuU2ME5DoxaBsLAjBqIMkamUJ8YQKALZ4sYPkFf5RZRsFcAgAA */
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
            guard: 'no kcl errors',
          },
        ],

        Extrude: {
          target: 'Applying extrude',
          reenter: true,
          guard: 'no kcl errors',
        },

        Sweep: {
          target: 'Applying sweep',
          reenter: true,
          guard: 'no kcl errors',
        },

        Loft: {
          target: 'Applying loft',
          reenter: true,
          guard: 'no kcl errors',
        },

        Revolve: {
          target: 'Applying revolve',
          reenter: true,
          guard: 'no kcl errors',
        },

        'Offset plane': {
          target: 'Applying offset plane',
          reenter: true,
          guard: 'no kcl errors',
        },

        Helix: {
          target: 'Applying helix',
          reenter: true,
          guard: 'no kcl errors',
        },

        Shell: {
          target: 'Applying shell',
          reenter: true,
          guard: 'no kcl errors',
        },

        Fillet: {
          target: 'Applying fillet',
          reenter: true,
          guard: 'no kcl errors',
        },

        Chamfer: {
          target: 'Applying chamfer',
          reenter: true,
          guard: 'no kcl errors',
        },

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

        Appearance: {
          target: 'Applying appearance',
          reenter: true,
          guard: 'no kcl errors',
        },

        Translate: {
          target: 'Applying translate',
          reenter: true,
          guard: 'no kcl errors',
        },

        Rotate: {
          target: 'Applying rotate',
          reenter: true,
          guard: 'no kcl errors',
        },

        Scale: {
          target: 'Applying scale',
          reenter: true,
          guard: 'no kcl errors',
        },

        Clone: {
          target: 'Applying clone',
          reenter: true,
          guard: 'no kcl errors',
        },

        'GDT Flatness': {
          target: 'Applying GDT Flatness',
          reenter: true,
          guard: 'no kcl errors',
        },

        'Boolean Subtract': {
          target: 'Boolean subtracting',
          guard: 'no kcl errors',
        },
        'Boolean Union': {
          target: 'Boolean uniting',
          guard: 'no kcl errors',
        },
        'Boolean Intersect': {
          target: 'Boolean intersecting',
          guard: 'no kcl errors',
        },
        'Pattern Circular 3D': {
          target: 'Pattern Circular 3D',
          guard: 'no kcl errors',
        },
        'Pattern Linear 3D': {
          target: 'Pattern Linear 3D',
          guard: 'no kcl errors',
        },
      },

      entry: 'reset client scene mouse handlers',

      states: {
        hidePlanes: {
          on: {
            'Artifact graph populated': {
              target: 'showPlanes',
              guard: 'no kcl errors',
            },
          },

          entry: 'hide default planes',
        },

        showPlanes: {
          on: {
            'Artifact graph emptied': 'hidePlanes',
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
        onDone: 'sketchSolveMode',
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

    'Set context': {
      reenter: false,
      actions: 'Set context',
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

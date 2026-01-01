import toast from 'react-hot-toast'
import { Mesh, Vector2, Vector3 } from 'three'
import { assertEvent, assign, fromPromise, sendTo, setup } from 'xstate'

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
  ModelingMachineInput,
} from '@src/machines/modelingSharedTypes'
import { modelingMachineInitialInternalContext } from '@src/machines/modelingSharedContext'

import type { Node } from '@rust/kcl-lib/bindings/Node'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'

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
import { addFlatnessGdt, addDatumGdt } from '@src/lang/modifyAst/gdt'
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
import { isSketchBlockSelected } from '@src/machines/sketchSolve/sketchSolveImpl'
import { err, reportRejection, trap } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import { kclEditorActor } from '@src/machines/kclEditorMachine'
import { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import type { EquipTool } from '@src/machines/sketchSolve/sketchSolveImpl'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import type { KclManager } from '@src/lang/KclManager'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type RustContext from '@src/lib/rustContext'
import { addChamfer, addFillet } from '@src/lang/modifyAst/edges'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { EditorView } from 'codemirror'

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
  | { type: 'Exit sketch' }
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
  | { type: 'Text-to-CAD' }
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
  | { type: 'GDT Datum'; data: ModelingCommandSchema['GDT Datum'] }
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
      type: 'update sketch outcome'
      data: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        debounceEditorUpdate?: boolean
      }
    }
  | {
      type: 'sketch solve tool changed'
      data: { tool: EquipTool | null }
    }
  | { type: 'delete selected' }

const NO_INPUT_PROVIDED_MESSAGE = 'No input provided'

export const modelingMachine = setup({
  types: {
    // We store everything in the input on context as well
    context: {} as ModelingMachineContext,
    events: {} as ModelingMachineEvent,
    input: {} as ModelingMachineInput,
  },
  guards: {
    'should use new sketch mode': ({ context }) => {
      return context.store.useNewSketchMode?.current === true
    },
    'Selection is sketchBlock': ({
      context: { selectionRanges },
      event,
    }): boolean => {
      if (event.type !== 'Enter sketch') return false
      if (event.data?.forceNewSketch) return false
      return isSketchBlockSelected(selectionRanges)
    },
    'Selection is on face': ({
      context: { selectionRanges, kclManager, wasmInstance },
      event,
    }): boolean => {
      if (event.type !== 'Enter sketch') return false
      if (event.data?.forceNewSketch) return false
      if (artifactIsPlaneWithPaths(selectionRanges)) {
        return true
      } else if (selectionRanges.graphSelections[0]?.artifact) {
        // See if the selection is "close enough" to be coerced to the plane later
        const maybePlane = getPlaneFromArtifact(
          selectionRanges.graphSelections[0].artifact,
          kclManager.artifactGraph
        )
        return !err(maybePlane)
      }
      if (
        isCursorInFunctionDefinition(
          kclManager.ast,
          selectionRanges.graphSelections[0],
          wasmInstance
        )
      ) {
        return false
      }
      return !!isCursorInSketchCommandRange(
        kclManager.artifactGraph,
        selectionRanges
      )
    },
    'Has exportable geometry': () => false,
    'has valid selection for deletion': () => false,
    // TODO: figure out if we really need this one, was separate from 'no kcl errors'
    'is-error-free': ({ context: { kclManager } }): boolean => {
      return kclManager.errors.length === 0 && !kclManager.hasErrors()
    },
    'is editing existing sketch': ({
      context: { sketchDetails, kclManager, wasmInstance },
    }) => {
      return isEditingExistingSketch({
        sketchDetails,
        kclManager,
        wasmInstance,
      })
    },
    'Can make selection horizontal': ({ context }) => {
      const info = horzVertInfo(
        context.selectionRanges,
        'horizontal',
        context.kclManager.ast,
        context.wasmInstance
      )
      if (err(info)) return false
      return info.enabled
    },
    'Can make selection vertical': ({ context }) => {
      const info = horzVertInfo(
        context.selectionRanges,
        'vertical',
        context.kclManager.ast,
        context.wasmInstance
      )
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain horizontal distance': ({ context }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: context.selectionRanges,
        constraint: 'setHorzDistance',
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain vertical distance': ({ context }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: context.selectionRanges,
        constraint: 'setVertDistance',
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain ABS X': ({ context }) => {
      const info = absDistanceInfo({
        selectionRanges: context.selectionRanges,
        constraint: 'xAbs',
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain ABS Y': ({ context }) => {
      const info = absDistanceInfo({
        selectionRanges: context.selectionRanges,
        constraint: 'yAbs',
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain angle': ({
      context: { selectionRanges, kclManager, wasmInstance },
    }) => {
      const angleBetween = angleBetweenInfo({
        selectionRanges,
        kclManager,
        wasmInstance,
      })
      if (err(angleBetween)) return false
      const angleLength = angleLengthInfo({
        selectionRanges,
        angleOrLength: 'setAngle',
        kclManager,
        wasmInstance,
      })
      if (err(angleLength)) return false
      return angleBetween.enabled || angleLength.enabled
    },
    'Can constrain length': ({
      context: { selectionRanges, kclManager, wasmInstance },
    }) => {
      const angleLength = angleLengthInfo({
        selectionRanges,
        kclManager,
        wasmInstance,
      })
      if (err(angleLength)) return false
      return angleLength.enabled
    },
    'Can constrain perpendicular distance': ({ context }) => {
      const info = intersectInfo({
        selectionRanges: context.selectionRanges,
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain horizontally align': ({ context }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: context.selectionRanges,
        constraint: 'setHorzDistance',
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain vertically align': ({ context }) => {
      const info = horzVertDistanceInfo({
        selectionRanges: context.selectionRanges,
        constraint: 'setHorzDistance',
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain snap to X': ({ context }) => {
      const info = absDistanceInfo({
        selectionRanges: context.selectionRanges,
        constraint: 'snapToXAxis',
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain snap to Y': ({ context }) => {
      const info = absDistanceInfo({
        selectionRanges: context.selectionRanges,
        constraint: 'snapToYAxis',
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain equal length': ({ context }) => {
      const info = setEqualLengthInfo({
        selectionRanges: context.selectionRanges,
        ast: context.kclManager.ast,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain parallel': ({ context }) => {
      const info = equalAngleInfo({
        selectionRanges: context.selectionRanges,
        kclManager: context.kclManager,
        wasmInstance: context.wasmInstance,
      })
      if (err(info)) return false
      return info.enabled
    },
    'Can constrain remove constraints': ({
      context: { selectionRanges, kclManager, wasmInstance },
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
        kclManager,
        wasmInstance
      )
      if (err(info)) return false
      return info.enabled
    },
    'Can convert to named value': ({ context, event }) => {
      if (event.type !== 'Constrain with named value') return false
      if (!event.data) return false

      const ast = parse(
        recast(context.kclManager.ast, context.wasmInstance),
        context.wasmInstance
      )
      if (err(ast) || !ast.program || ast.errors.length > 0) return false
      const isSafeRetVal = isNodeSafeToReplacePath(
        ast.program,
        event.data.currentValue.pathToNode,
        context.wasmInstance
      )
      if (err(isSafeRetVal)) return false
      return isSafeRetVal.isSafe
    },
    'next is tangential arc': ({
      context: { sketchDetails, currentTool, kclManager, wasmInstance },
    }) => {
      return (
        currentTool === 'tangentialArc' &&
        isEditingExistingSketch({ sketchDetails, kclManager, wasmInstance })
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
    toastErrorAndExitSketch: ({ event, context: { sceneEntitiesManager } }) => {
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

      // Clean up the THREE.js sketch scene
      sceneEntitiesManager.tearDownSketch({ removeAxis: false })
      sceneEntitiesManager.removeSketchGrid()
      sceneEntitiesManager.resetOverlays()
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
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        context.kclManager.hidePlanes()
        return { xy: false, xz: false, yz: false }
      },
    }),
    'reset sketch metadata': assign({
      sketchDetails: null,
      sketchEnginePathId: '',
      sketchPlaneId: '',
    }),
    'reset camera position': ({ context: { engineCommandManager } }) => {
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
    'set up draft line': assign(
      ({
        context: { sketchDetails, sceneEntitiesManager, kclManager },
        event,
      }) => {
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
            return kclManager.updateEditorWithAstAndWriteToFile(
              kclManager.ast,
              undefined
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
        context: { sketchDetails, sceneEntitiesManager, kclManager },
        event,
      }) => {
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
            'tangentialArc'
          )
          .then(() => {
            return kclManager.updateEditorWithAstAndWriteToFile(
              kclManager.ast,
              undefined
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
        sceneEntitiesManager,
        sceneInfra,
        wasmInstance,
      },
    }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )

      // Position the click raycast plane
      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      sceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(
            args,
            sketchDetails,
            sceneEntitiesManager,
            wasmInstance
          )
        },
        onClick: (args) => {
          sceneEntitiesManager.removeDraftPoint()
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'click in scene',
              data: sceneEntitiesManager.getSnappedDragPoint(
                twoD,
                args.intersects,
                args.mouseEvent,
                wasmInstance
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
        sceneEntitiesManager,
        sceneInfra,
        wasmInstance,
      },
    }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )
      // Position the click raycast plane
      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      sceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(
            args,
            sketchDetails,
            sceneEntitiesManager,
            wasmInstance
          )
        },
        onClick: (args) => {
          sceneEntitiesManager.removeDraftPoint()
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add center rectangle origin',
              data: sceneEntitiesManager.getSnappedDragPoint(
                twoD,
                args.intersects,
                args.mouseEvent,
                wasmInstance
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
        sceneEntitiesManager,
        sceneInfra,
        wasmInstance,
      },
    }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )

      // Position the click raycast plane
      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      sceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(
            args,
            sketchDetails,
            sceneEntitiesManager,
            wasmInstance
          )
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add circle origin',
              data: sceneEntitiesManager.getSnappedDragPoint(
                twoD,
                args.intersects,
                args.mouseEvent,
                wasmInstance
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
        sceneEntitiesManager,
        sceneInfra,
        wasmInstance,
      },
    }) => {
      if (!sketchDetails) return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )
      // Position the click raycast plane

      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      sceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(
            args,
            sketchDetails,
            sceneEntitiesManager,
            wasmInstance
          )
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add first point',
              data: sceneEntitiesManager.getSnappedDragPoint(
                twoD,
                args.intersects,
                args.mouseEvent,
                wasmInstance
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
        sceneEntitiesManager,
        sceneInfra,
        wasmInstance,
      },
      event,
    }) => {
      if (!sketchDetails) return
      if (event.type !== 'Add first point') return
      const quaternion = quaternionFromUpNForward(
        new Vector3(...sketchDetails.yAxis),
        new Vector3(...sketchDetails.zAxis)
      )

      // Position the click raycast plane
      sceneEntitiesManager.intersectionPlane.setRotationFromQuaternion(
        quaternion
      )
      sceneEntitiesManager.intersectionPlane.position.copy(
        new Vector3(...(sketchDetails?.origin || [0, 0, 0]))
      )

      const dummy = new Mesh()
      dummy.position.set(0, 0, 0)
      const scale = sceneInfra.getClientSceneScaleFactor(dummy)
      const position = new Vector3(event.data[0], event.data[1], 0)
      position.applyQuaternion(quaternion)
      const draftPoint = createProfileStartHandle({
        isDraft: true,
        from: event.data,
        scale,
        theme: sceneInfra.theme,
      })
      draftPoint.position.copy(position)
      sceneInfra.scene.add(draftPoint)

      sceneInfra.setCallbacks({
        onMove: (args) => {
          listenForOriginMove(
            args,
            sketchDetails,
            sceneEntitiesManager,
            wasmInstance
          )
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD) {
            sceneInfra.modelingSend({
              type: 'Add second point',
              data: {
                p1: event.data,
                p2: sceneEntitiesManager.getSnappedDragPoint(
                  twoD,
                  args.intersects,
                  args.mouseEvent,
                  wasmInstance
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
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        context.kclManager.showPlanes()
        return { xy: true, xz: true, yz: true }
      },
    }),
    'show default planes if no errors': assign({
      defaultPlaneVisibility: ({
        context: { kclManager, defaultPlaneVisibility },
      }) => {
        if (!kclManager.hasErrors()) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          kclManager.showPlanes()
          return { xy: true, xz: true, yz: true }
        }
        return { ...defaultPlaneVisibility }
      },
    }),
    'show planes sketch no face': assign(({ event, context }) => {
      if (event.type !== 'Enter sketch') return {}
      if (event.data?.keepDefaultPlaneVisibility) {
        // When entering via right-click "Start sketch on selection", show planes only if not requested to keep current visibility
        return {}
      }
      void context.kclManager.showPlanes()
      return { defaultPlaneVisibility: { xy: true, xz: true, yz: true } }
    }),
    'setup noPoints onClick listener': ({
      context: { sketchDetails, currentTool, sceneEntitiesManager, sceneInfra },
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
    'add axis n grid': ({
      context: { sketchDetails, sceneEntitiesManager, kclManager },
    }) => {
      if (!sketchDetails) return
      if (localStorage.getItem('disableAxis')) return
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sceneEntitiesManager.createSketchAxis(
        sketchDetails.zAxis,
        sketchDetails.yAxis,
        sketchDetails.origin
      )

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      kclManager.updateEditorWithAstAndWriteToFile(kclManager.ast, undefined)
    },
    'reset client scene mouse handlers': ({ context }) => {
      // when not in sketch mode we don't need any mouse listeners
      // (note the orbit controls are always active though)
      context.sceneInfra.resetMouseListeners()
    },
    'clientToEngine cam sync direction': ({ context }) => {
      context.sceneInfra.camControls.syncDirection = 'clientToEngine'
    },
    /** TODO: this action is hiding unawaited asynchronous code */
    'set selection filter to faces only': ({ context }) => {
      context.kclManager.setSelectionFilter(
        ['face', 'object'],
        context.sceneEntitiesManager,
        context.wasmInstance
      )
    },
    /** TODO: this action is hiding unawaited asynchronous code */
    'set selection filter to defaults': ({ context }) => {
      context.kclManager.setSelectionFilterToDefault(
        context.sceneEntitiesManager,
        context.wasmInstance
      )
    },
    'Delete segments': ({
      context: {
        sketchDetails,
        kclManager,
        rustContext,
        sceneEntitiesManager,
        sceneInfra,
      },
      event,
    }) => {
      if (event.type !== 'Delete segments') return
      if (!sketchDetails || !event.data) return
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      deleteSegmentsOrProfiles({
        pathToNodes: event.data,
        sketchDetails,
        dependencies: {
          kclManager,
          rustContext,
          sceneEntitiesManager,
          sceneInfra,
        },
      })
        .then(() => {
          return kclManager.updateEditorWithAstAndWriteToFile(
            kclManager.ast,
            undefined
          )
        })
        .catch((e) => {
          console.warn('error', e)
        })
    },
    'remove draft entities': ({ context: { sceneInfra } }) => {
      const draftPoint = sceneInfra.scene.getObjectByName(DRAFT_POINT)
      if (draftPoint) {
        sceneInfra.scene.remove(draftPoint)
      }
      const draftLine = sceneInfra.scene.getObjectByName(DRAFT_DASHED_LINE)
      if (draftLine) {
        sceneInfra.scene.remove(draftLine)
      }
    },
    'add draft line': ({ event, context }) => {
      if (
        event.type !== 'Add start point' &&
        event.type !== 'xstate.done.actor.setup-client-side-sketch-segments9'
      )
        return

      const sceneEntitiesManager = context.sceneEntitiesManager
      const sceneInfra = context.sceneInfra
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
        context.kclManager.ast,
        sketchEntryNodePath,
        context.wasmInstance,
        'VariableDeclaration'
      )
      if (err(varDec)) return
      const varName = varDec.node.declaration.id.name
      const sg = sketchFromKclValue(
        context.kclManager.variables[varName],
        varName
      )
      if (err(sg)) return
      const lastSegment = sg.paths[sg.paths.length - 1] || sg.start
      const to = lastSegment.to

      const { group, updater } = sceneEntitiesManager.drawDashedLine({
        from: to,
        to: [to[0] + 0.001, to[1] + 0.001],
      })
      sceneInfra.scene.add(group)
      const orthoFactor = orthoScale(sceneInfra.camControls.camera)
      sceneInfra.setCallbacks({
        onMove: (args) => {
          const { intersectionPoint } = args
          if (!intersectionPoint?.twoD) return
          if (!context.sketchDetails) return
          const { snappedPoint, isSnapped } =
            sceneEntitiesManager.getSnappedDragPoint(
              intersectionPoint.twoD,
              args.intersects,
              args.mouseEvent,
              context.wasmInstance
            )
          if (isSnapped) {
            sceneEntitiesManager.positionDraftPoint({
              snappedPoint: new Vector2(...snappedPoint),
              origin: context.sketchDetails.origin,
              yAxis: context.sketchDetails.yAxis,
              zAxis: context.sketchDetails.zAxis,
            })
          } else {
            sceneEntitiesManager.removeDraftPoint()
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
          engineCommandManager,
          sceneEntitiesManager,
          kclManager,
          kclEditorMachine: providedKclEditorMachine,
          wasmInstance,
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
        const theKclEditorMachine = providedKclEditorMachine
          ? providedKclEditorMachine
          : kclEditorActor

        let selections: Selections = {
          graphSelections: [],
          otherSelections: [],
        }
        if (setSelections.selectionType === 'singleCodeCursor') {
          if (!setSelections.selection && kclManager.isShiftDown) {
            // if the user is holding shift, but they didn't select anything
            // don't nuke their other selections (frustrating to have one bad click ruin your
            // whole selection)
            selections = {
              graphSelections: selectionRanges.graphSelections,
              otherSelections: selectionRanges.otherSelections,
            }
          } else if (!setSelections.selection && !kclManager.isShiftDown) {
            selections = {
              graphSelections: [],
              otherSelections: [],
            }
          } else if (setSelections.selection && !kclManager.isShiftDown) {
            selections = {
              graphSelections: [setSelections.selection],
              otherSelections: [],
            }
          } else if (setSelections.selection && kclManager.isShiftDown) {
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
              artifactGraph: kclManager.artifactGraph,
              code: kclManager.code,
              ast: kclManager.ast,
              systemDeps: {
                engineCommandManager,
                sceneEntitiesManager,
                wasmInstance,
              },
            })
          if (codeMirrorSelection) {
            kclManager.editorView.dispatch({
              selection: codeMirrorSelection,
              effects: setSelections.scrollIntoView
                ? [
                    EditorView.scrollIntoView(codeMirrorSelection.ranges[0], {
                      y: 'center',
                    }),
                  ]
                : [],
            })
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
          engineEvents &&
            engineEvents.forEach((event) => {
              engineCommandManager
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
          if (kclManager.isShiftDown) {
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
          const codeMirrorSelection = kclManager.createEditorSelection(
            setSelections.selection
          )

          kclManager.editorView.dispatch({
            selection: codeMirrorSelection,
          })

          // This turns the selection into blue, needed when selecting with ctrl+A
          const { updateSceneObjectColors } = handleSelectionBatch({
            selections: setSelections.selection,
            artifactGraph: kclManager.artifactGraph,
            code: kclManager.code,
            ast: kclManager.ast,
            systemDeps: {
              engineCommandManager,
              sceneEntitiesManager,
              wasmInstance,
            },
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
    'Set sketchDetails': () => {},
    'debug-action': (data) => {
      console.log('re-eval debug-action', data)
    },
    'Toggle default plane visibility': assign(({ context, event }) => {
      if (event.type !== 'Toggle default plane visibility') return {}

      const currentVisibilityMap = context.defaultPlaneVisibility
      const currentVisibility = currentVisibilityMap[event.planeKey]
      const newVisibility = !currentVisibility

      context.kclManager.engineCommandManager
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
      for (const planeKey of Object.keys(
        context.savedDefaultPlaneVisibility
      ) as (keyof PlaneVisibilityMap)[]) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        context.kclManager.setPlaneVisibilityByKey(
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
        const {
          store,
          engineCommandManager,
          sceneInfra,
          kclManager,
          sceneEntitiesManager,
        } = context

        // When cancelling the sketch mode we should disable sketch mode within the engine.
        await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'sketch_mode_disable' },
        })

        sceneInfra.camControls.syncDirection = 'clientToEngine'

        if (store.cameraProjection?.current === 'perspective') {
          await sceneInfra.camControls.snapToPerspectiveBeforeHandingBackControlToEngine()
        }

        sceneInfra.camControls.syncDirection = 'engineToClient'

        // TODO: Re-evaluate if this pause/play logic is needed.
        // TODO: Do I need this video element?
        store.videoElement?.pause()

        await kclManager
          .executeCode()
          .then(() => {
            if (
              !engineCommandManager.started &&
              engineCommandManager.connection?.websocket?.readyState ===
                WebSocket.CLOSED
            )
              return

            store.videoElement?.play().catch((e: Error) => {
              console.warn('Video playing was prevented', e)
            })
          })
          .catch(reportRejection)
        sceneEntitiesManager.tearDownSketch({ removeAxis: false })
        sceneEntitiesManager.removeSketchGrid()
        sceneInfra.camControls.syncDirection = 'engineToClient'
        sceneEntitiesManager.resetOverlays()
        sceneInfra.stop()
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
          sceneEntitiesManager,
          kclManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
          | 'kclManager'
        > & { data?: PathToNode }
      }) => {
        const constraint = applyRemoveConstrainingValues({
          selectionRanges,
          pathToNodes: data && [data],
          kclManager,
          wasmInstance,
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
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return

        await kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )

        return {
          selectionType: 'completeSelection',
          selection: updateSelections(
            pathToNodeMap,
            selectionRanges,
            updatedAst.newAst,
            kclManager.artifactGraph,
            wasmInstance
          ),
        }
      }
    ),
    'do-constrain-horizontally': fromPromise(
      async ({
        input: {
          selectionRanges,
          sketchDetails,
          kclManager,
          sceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'kclManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.variables,
          await kclManager.wasmInstancePromise
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
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )
        return {
          selectionType: 'completeSelection',
          selection: updateSelections(
            pathToNodeMap,
            selectionRanges,
            updatedAst.newAst,
            kclManager.artifactGraph,
            wasmInstance
          ),
        }
      }
    ),
    'do-constrain-vertically': fromPromise(
      async ({
        input: {
          selectionRanges,
          sketchDetails,
          kclManager,
          sceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'kclManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.variables,
          await kclManager.wasmInstancePromise
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
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )
        return {
          selectionType: 'completeSelection',
          selection: updateSelections(
            pathToNodeMap,
            selectionRanges,
            updatedAst.newAst,
            kclManager.artifactGraph,
            wasmInstance
          ),
        }
      }
    ),
    'do-constrain-horizontally-align': fromPromise(
      async ({
        input: {
          selectionRanges,
          sketchDetails,
          kclManager,
          sceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'kclManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
          kclManager: kclManager,
          wasmInstance: await kclManager.wasmInstancePromise,
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
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst,
          kclManager.artifactGraph,
          wasmInstance
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
          kclManager,
          sceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'kclManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
          kclManager: kclManager,
          wasmInstance: await kclManager.wasmInstancePromise,
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
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst,
          kclManager.artifactGraph,
          wasmInstance
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
          kclManager,
          sceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'kclManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
          kclManager: kclManager,
          wasmInstance: await kclManager.wasmInstancePromise,
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
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst,
          kclManager.artifactGraph,
          wasmInstance
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
          kclManager,
          sceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'kclManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
          kclManager: kclManager,
          wasmInstance: await kclManager.wasmInstancePromise,
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
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst,
          kclManager.artifactGraph,
          wasmInstance
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
          kclManager,
          sceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'kclManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintEqualAngle({
          selectionRanges,
          kclManager,
          wasmInstance: await kclManager.wasmInstancePromise,
        })
        if (trap(constraint)) return false
        const { modifiedAst, pathToNodeMap } = constraint

        if (!sketchDetails) {
          trap(new Error('No sketch details'))
          return
        }
        const recastAst = parse(recast(modifiedAst, wasmInstance), wasmInstance)
        if (err(recastAst) || !resultIsOk(recastAst)) return

        const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
          sketchDetails?.sketchEntryNodePath || [],
          sketchDetails.sketchNodePaths,
          sketchDetails.planeNodePath,
          recastAst.program,
          sketchDetails.zAxis,
          sketchDetails.yAxis,
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )

        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst,
          kclManager.artifactGraph,
          wasmInstance
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
          kclManager,
          sceneEntitiesManager,
          wasmInstance,
        },
      }: {
        input: Pick<
          ModelingMachineContext,
          | 'selectionRanges'
          | 'sketchDetails'
          | 'kclManager'
          | 'sceneEntitiesManager'
          | 'wasmInstance'
        >
      }) => {
        const constraint = applyConstraintEqualLength({
          selectionRanges,
          ast: kclManager.ast,
          variables: kclManager.variables,
          wasmInstance: await kclManager.wasmInstancePromise,
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
          sketchDetails.origin,
          getEventForSegmentSelection,
          updateExtraSegments
        )
        if (trap(updatedAst, { suppress: true })) return
        if (!updatedAst) return
        await kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )
        const updatedSelectionRanges = updateSelections(
          pathToNodeMap,
          selectionRanges,
          updatedAst.newAst,
          kclManager.artifactGraph,
          wasmInstance
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
        input: Pick<
          ModelingMachineContext,
          'selectionRanges' | 'sketchDetails' | 'kclManager'
        >
      }) => {
        return {} as SetSelections
      }
    ),
    'Get ABS X info': fromPromise(
      async (_: {
        input: Pick<
          ModelingMachineContext,
          'selectionRanges' | 'sketchDetails' | 'kclManager'
        >
      }) => {
        return {} as SetSelections
      }
    ),
    'Get ABS Y info': fromPromise(
      async (_: {
        input: Pick<
          ModelingMachineContext,
          'selectionRanges' | 'sketchDetails' | 'kclManager'
        >
      }) => {
        return {} as SetSelections
      }
    ),
    'Get angle info': fromPromise(
      async (_: {
        input: Pick<
          ModelingMachineContext,
          'selectionRanges' | 'sketchDetails' | 'kclManager'
        >
      }) => {
        return {} as SetSelections
      }
    ),
    'Get perpendicular distance info': fromPromise(
      async (_: {
        input: Pick<
          ModelingMachineContext,
          'selectionRanges' | 'sketchDetails' | 'kclManager'
        >
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
      async (_: {
        input: ArtifactId | undefined
      }) => {
        return {} as {
          plane: DefaultPlane | OffsetPlane | ExtrudeFacePlane
          sketchSolveId: number
        }
      }
    ),
    'animate-to-existing-sketch-solve': fromPromise(
      async (_: {
        input: ArtifactId | undefined
      }) => {
        return {} as {
          plane: DefaultPlane | OffsetPlane | ExtrudeFacePlane
          sketchSolveId: number
          initialSceneGraphDelta: SceneGraphDelta
        }
      }
    ),
    'Get horizontal info': fromPromise(
      async (_: {
        input: Pick<
          ModelingMachineContext,
          'sketchDetails' | 'selectionRanges' | 'kclManager'
        >
      }) => {
        return {} as SetSelections
      }
    ),
    astConstrainLength: fromPromise(
      async (_: {
        input: Pick<
          ModelingMachineContext,
          'sketchDetails' | 'selectionRanges' | 'kclManager'
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
          sceneInfra,
          sceneEntitiesManager,
          kclManager,
        },
      }: {
        input: {
          sketchDetails: SketchDetails | null
          selectionRanges: Selections
          sceneInfra: SceneInfra
          sceneEntitiesManager: SceneEntities
          kclManager: KclManager
        }
      }) => {
        if (!sketchDetails) {
          return
        }
        if (!sketchDetails.sketchEntryNodePath?.length) {
          // When unequipping eg. the three-point arc tool during placement of the 3rd point, sketchEntryNodePath is
          // empty if its the first profile in a sketch, but we still need to tear down and cancel the current tool properly.
          sceneInfra.resetMouseListeners()
          sceneEntitiesManager.tearDownSketch({ removeAxis: false })
          return
        }
        sceneInfra.resetMouseListeners()
        await sceneEntitiesManager.setupSketch({
          sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
          sketchNodePaths: sketchDetails.sketchNodePaths,
          forward: sketchDetails.zAxis,
          up: sketchDetails.yAxis,
          position: sketchDetails.origin,
          maybeModdedAst: kclManager.ast,
          selectionRanges,
        })
        sceneInfra.resetMouseListeners()

        sceneEntitiesManager.setupSketchIdleCallbacks({
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
          kclManager,
          engineCommandManager,
          sceneEntitiesManager,
          sceneInfra,
        },
      }: {
        input: {
          selectionRanges: Selections
          kclManager: KclManager
          engineCommandManager: ConnectionManager
          sceneEntitiesManager: SceneEntities
          sceneInfra: SceneInfra
        }
      }): Promise<ModelingMachineContext['sketchDetails']> => {
        const artifact = selectionRanges.graphSelections[0].artifact
        const plane = getPlaneFromArtifact(artifact, kclManager.artifactGraph)
        if (err(plane)) return Promise.reject(plane)
        // if the user selected a segment, make sure we enter the right sketch as there can be multiple on a plane
        // but still works if the user selected a plane/face by defaulting to the first path
        const mainPath =
          artifact?.type === 'segment' || artifact?.type === 'solid2d'
            ? artifact?.pathId
            : plane?.pathIds[0]
        let sketch: KclValue | null = null
        let planeVar: Plane | null = null

        for (const variable of Object.values(kclManager.execState.variables)) {
          // find programMemory that matches path artifact
          // Note: this is similar to sketchFromKclValueOptional(), could be combined?
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
            variable.value.sketch.artifactId === mainPath
          ) {
            sketch = {
              type: 'Sketch',
              value: variable.value.sketch,
            }
            break
          }
          if (variable?.type === 'HomArray') {
            const sketchInHomArray = variable.value.find(
              (sk) => sk.type === 'Sketch' && sk.value.artifactId === mainPath
            )
            if (sketchInHomArray) {
              sketch = sketchInHomArray
              break
            }
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
              kclManager.ast,
              planeCodeRef.range
            )
            await letEngineAnimateAndSyncCamAfter(
              engineCommandManager,
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
        const info = await sceneEntitiesManager.getSketchOrientationDetails(
          sketch.value
        )
        await letEngineAnimateAndSyncCamAfter(
          engineCommandManager,
          info?.sketchDetails?.faceId || ''
        )

        const sketchArtifact = kclManager.artifactGraph.get(mainPath)
        if (sketchArtifact?.type !== 'path') {
          return Promise.reject(new Error('No sketch artifact'))
        }
        const sketchPaths = getPathsFromArtifact({
          artifact: kclManager.artifactGraph.get(plane.id),
          sketchPathToNode: sketchArtifact?.codeRef?.pathToNode,
          artifactGraph: kclManager.artifactGraph,
          ast: kclManager.ast,
        })
        if (err(sketchPaths)) return Promise.reject(sketchPaths)
        let codeRef = getFaceCodeRef(plane)
        if (!codeRef) return Promise.reject(new Error('No plane codeRef'))
        // codeRef.pathToNode is not always populated correctly
        const planeNodePath = getNodePathFromSourceRange(
          kclManager.ast,
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
          | 'kclManager'
          | 'wasmInstance'
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
        const wasmInstance = input.wasmInstance
        let pResult = parse(
          recast(input.kclManager.ast, wasmInstance),
          wasmInstance
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
            wasmInstance,
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
              wasmInstance
            ),
            wasmInstance
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
            wasmInstance,
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

        pResult = parse(recast(result.modifiedAst, wasmInstance), wasmInstance)
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
          await input.sceneEntitiesManager.updateAstAndRejigSketch(
            updatedSketchEntryNodePath,
            updatedSketchNodePaths,
            updatedPlaneNodePath,
            parsed,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin,
            getEventForSegmentSelection,
            updateExtraSegments
          )
        if (err(updatedAst)) return Promise.reject(updatedAst)

        await input.kclManager.updateEditorWithAstAndWriteToFile(
          updatedAst.newAst,
          undefined
        )

        const selection = updateSelections(
          { 0: result.pathToReplaced },
          selectionRanges,
          updatedAst.newAst,
          input.kclManager.artifactGraph,
          wasmInstance
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
      async ({}: {
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast, artifactGraph } = input.kclManager
        const astResult = addExtrude({
          ast,
          artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
          ...input.data,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast } = input.kclManager
        const astResult = addSweep({
          ...input.data,
          ast,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const { ast } = input.kclManager
        const astResult = addLoft({
          ast,
          wasmInstance: await input.kclManager.wasmInstancePromise,
          ...input.data,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast } = input.kclManager
        const astResult = addRevolve({
          ast,
          wasmInstance: await input.kclManager.wasmInstancePromise,
          ...input.data,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast, artifactGraph, variables } = input.kclManager
        const astResult = addOffsetPlane({
          ...input.data,
          ast,
          artifactGraph,
          variables,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast, artifactGraph } = input.kclManager
        const astResult = addHelix({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast, artifactGraph } = input.kclManager
        const astResult = addShell({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const astResult = addHole({
          ...input.data,
          ast: input.kclManager.ast,
          artifactGraph: input.kclManager.artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult
        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
              engineCommandManager: ConnectionManager
              wasmInstance: ModuleType
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast, artifactGraph } = input.kclManager
        const astResult = addFillet({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: input.wasmInstance,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult

        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
              engineCommandManager: ConnectionManager
              wasmInstance: ModuleType
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const { ast, artifactGraph } = input.kclManager
        const astResult = addChamfer({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: input.wasmInstance,
        })
        if (err(astResult)) {
          return Promise.reject(astResult)
        }

        const { modifiedAst, pathToNode } = astResult

        await updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
          },
          {
            focusPath: pathToNode,
          }
        )
      }
    ),
    deleteSelectionAstMod: fromPromise(
      ({
        input: { selectionRanges, systemDeps },
      }: {
        input: {
          selectionRanges: Selections
          systemDeps: {
            kclManager: KclManager
            rustContext: RustContext
            sceneEntitiesManager: SceneEntities
          }
        }
      }) => {
        return new Promise((resolve, reject) => {
          if (!selectionRanges) {
            reject(new Error(deletionErrorMessage))
          }

          const selection = selectionRanges.graphSelections[0]
          if (!selectionRanges) {
            reject(new Error(deletionErrorMessage))
          }

          deleteSelectionPromise({ selection, systemDeps })
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addAppearance({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addTranslate({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addRotate({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(result)) {
          return Promise.reject(result)
        }

        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addScale({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(result)) {
          return Promise.reject(result)
        }

        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
              wasmInstance: ModuleType
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addClone({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: input.wasmInstance,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
        input:
          | {
              data: ModelingCommandSchema['GDT Flatness'] | undefined
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        // Remove once this command isn't experimental anymore
        let astWithNewSetting: Node<Program> | undefined
        if (
          input.kclManager.fileSettings.experimentalFeatures?.type !== 'Allow'
        ) {
          const ast = setExperimentalFeatures(
            input.kclManager.code,
            {
              type: 'Allow',
            },
            await input.kclManager.wasmInstancePromise
          )
          if (err(ast)) {
            return Promise.reject(ast)
          }

          astWithNewSetting = ast
        }

        const result = addFlatnessGdt({
          ...input.data,
          ast: astWithNewSetting ?? input.kclManager.ast,
          artifactGraph: input.kclManager.artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(result)) {
          return Promise.reject(result)
        }

        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
          },
          {
            focusPath: [result.pathToNode],
          }
        )
      }
    ),
    gdtDatumAstMod: fromPromise(
      async ({
        input,
      }: {
        input:
          | {
              data: ModelingCommandSchema['GDT Datum'] | undefined
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        // Remove once this command isn't experimental anymore
        let astWithNewSetting: Node<Program> | undefined
        if (
          input.kclManager.fileSettings.experimentalFeatures?.type !== 'Allow'
        ) {
          const ast = setExperimentalFeatures(
            input.kclManager.code,
            {
              type: 'Allow',
            },
            await input.kclManager.wasmInstancePromise
          )
          if (err(ast)) {
            return Promise.reject(ast)
          }

          astWithNewSetting = ast
        }

        const result = addDatumGdt({
          ...input.data,
          ast: astWithNewSetting ?? input.kclManager.ast,
          artifactGraph: input.kclManager.artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(result)) {
          return Promise.reject(result)
        }

        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
              wasmInstance: ModuleType
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addSubtract({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: input.wasmInstance,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
              wasmInstance: ModuleType
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addUnion({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: input.wasmInstance,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
              wasmInstance: ModuleType
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addIntersect({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: input.wasmInstance,
        })
        if (err(result)) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }
        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addPatternCircular3D({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
              kclManager: KclManager
              rustContext: RustContext
            }
          | undefined
      }) => {
        if (!input || !input.data) {
          return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
        }

        const ast = input.kclManager.ast
        const artifactGraph = input.kclManager.artifactGraph
        const result = addPatternLinear3D({
          ...input.data,
          ast,
          artifactGraph,
          wasmInstance: await input.kclManager.wasmInstancePromise,
        })
        if (err(result)) {
          return Promise.reject(result)
        }
        await updateModelingState(
          result.modifiedAst,
          EXECUTION_TYPE_REAL,
          {
            kclManager: input.kclManager,
            rustContext: input.rustContext,
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
        input: { sketchDetails, kclManager, wasmInstance },
      }: {
        input: Pick<
          ModelingMachineContext,
          'sketchDetails' | 'kclManager' | 'wasmInstance'
        >
      }) => {
        const errorMessage =
          'Unable to maintain sketch mode - code changes affected sketch references. Please re-enter.'
        if (!sketchDetails) {
          return Promise.reject(new Error(errorMessage))
        }

        // hasErrors is for parse errors, errors is for runtime errors
        if (kclManager.errors.length > 0 || kclManager.hasErrors()) {
          // if there's an error in the execution, we don't actually want to disable sketch mode
          // instead we'll give the user the chance to fix their error
          return {
            updatedEntryNodePath: sketchDetails.sketchEntryNodePath,
            updatedSketchNodePaths: sketchDetails.sketchNodePaths,
            updatedPlaneNodePath: sketchDetails.planeNodePath,
          }
        }

        const updatedPlaneNodePath = updatePathToNodesAfterEdit(
          kclManager._lastAst,
          kclManager.ast,
          sketchDetails.planeNodePath,
          wasmInstance
        )

        if (err(updatedPlaneNodePath)) {
          return Promise.reject(new Error(errorMessage))
        }
        const maybePlaneArtifact = [...kclManager.artifactGraph.values()].find(
          (artifact) => {
            const codeRef = getFaceCodeRef(artifact)
            if (!codeRef) return false

            return (
              stringifyPathToNode(codeRef.pathToNode) ===
              stringifyPathToNode(updatedPlaneNodePath)
            )
          }
        )
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
          const face = kclManager.artifactGraph.get(maybePlaneArtifact.faceId)
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
          kclManager.artifactGraph,
          kclManager.ast
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
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANmEBmAHQBGAJwBWABwKpSqTQDsUsQBoQAT0QAmdQBYJYmmPVjDh4YsMKZAX2e60GHPgIBlMOwACWCwwck5uWgYkEBY2cJ5ogQRBNRkzOUsFOTFFGhNZQ10DBBkZCXU7Szl5KRMTWxNXd3QsPEI-QIBbVABXYKD2EnYwSN5Yji4E0CSUqSlDCQUTGRpZefV1GWF1IsQxbYkTOS0FDRo5dRpDKTkmkA9W7w6AvyhOsFxAgHkANzAAJ0wJD0sFG0XG8V4Mzmigk8nUFwRMnUwhMG12CGOC0s9mEGlsOXsdweXkIAFUmBAhmAggBrfzkAAWAQwg2wmFB9DGrAm3F4xUEJg0EnEcls8gUhmWhjEJl0SWq+UOJmEsjETnUyjExJapOIH2G-wC5BI73+JAC3CCITCkzBzB5kMSQjmmvMq2MyxyaWECgxpxoIsMNGUpWyKh1njaBAAKqgoFBMDSMAAzEg9TCBJhA3A0n7YNgAI3ZHD09pijsmUJdUoUhxoeJk8wUmnycv0iHkgdDW1lOUqjTc9110dg9PYTKCqEwfwC7FQ0+NjLIMAg5YhVedyXmeOkMmDaSFGyk9gxc2ECzsEqs232cluQ5JbQk2AgSYIAFFPgC6QzGevKz5LdBEMbIJEMJtFBPGUGyOHQOwQVF1EOFFUWRJYbnqSNHigF83zAT9vyNMc-yoKQogdOJN2mIRrjrbIjlKC8oIbHYELkEw6wsIUG2MPExHVbDSTw98Pz4dh-h6DAAKooCaOSPFA02WpTAbCwrHbYoZWscDTlAhFfSWORhCE59X3fHwAHcwDAJgZN5KZ+CEapkNYhj8lA4xCgQ659nrKUbDyPE0RMx8R3wESCIAGVQFN2Hsp15MERRhDhepjjFfcTzY4oVBlCQQ1WFVrCOJYFFMiLzIIgAlMAfmnP4Euopzkk0ZCck0FLhCbG8MTEUo61xGw2oqWoKtwqqCC+FMU2CLMcxGLlwUAxyZlVVzg3EGQbGUaoz34uEMn4pwMm08bIoIAAJVo+CauSWuSlYRRoJssmMOZ5gxUCaEDH7zguLR6kMc7Jp8RksEwO7Vucp7jFgptOLo4Qz1G8o8hVDUtk0EH8Ku6dFooitZOhhAcikCRjMcY5NhWNIZQxQR9jrLQxQghxpVlHH3wAMXZJN4qWyiHOrZJql+85VmRPJbFAr7VjkCmmy2E972ydQuYIohl06FMAShkWREscpLnEFEpE2Ow-R8qUFfkAacXDYGwqjSrcYAQSYJgwBIc0KAJ7liYNvEFesKxNhsFZ7HgrTNi4oUWxMATLCkDXY192AgWGfXgIqBZJWqAo0TqBRo8QfJTEWbbmNA6obFT6rUEGLPBaJ4Wc-mEU3pbYzNhVKQMXqJYKclK4LGRPFyudnCLp8E0k2zpLNFS-JlHNrGArkAexWQ0pzaWBFrBhVOiEwbh-eWwOc5euFkQM5ZTiOTSy8T5Clipo4tBelwp+EyaAHEAAiMYAjc0zrmWAnJCYbnukkMmFMLxZDXrTeopdkj5FSizcU7N9ycx-mZXGAAhBcSYyAvB6IWCSJAwgLwehUZe3VFB1CsPIZGCF9jXxyF6OoGh1RaFTkQ-GpCyS4DtC3aBJNBCmDrFkBQF59yD3yH1Co0j7xwRqL6fhxDva4ACAASSIsEahYiVoGyRHCTQNhgxBU4n1JQyEhRSiBjKMQKc8Gu3fAABSGIaHRRBsD-HIBmH2AQxAAJobA448CqZIJeighmKozCYLZpKDmg5mguwmrjLx7AfEBCingb2RpQnhL2JEymiCaaxPpghZKHckkSilDg1OYkWD-AFlAkxOcbCLGMsobqUtNR9XRorNQ9R9whhKqnZAJB6QlNagJRYVR4S+hRLLHy21yZZHEFqVE7NU4AJCMMa0SZbQRGMZfJKWRJAnilkxMZeQvr2HJtTeoH8NhXCduk6ek0YxgHEoIecggiBuzCectu8kBLkypr6KU6xjhPxKMoOE+wZAtjJpkb+Xzf5ZP+KgToTB2AAtQIISAHA5kiGMNIWo+RVhVCMmeJsqUnBChuAJDGmLhwZIul+Q0AQ-kFk4PgX8E5mSwAaufIWiUWrzCOIsewwYhTGRcTlIQqVsgXDZQnFsJdPmcu+fhCQjJXxgA8QtWABA3ZtOwGmMIAQoDmiYMyMA+LOCQDmaMtV5xuriDZhsbyMczCiH6qs2+1gOVPncWACQsBGSoEsqasgcALVWptYEe1JBHUBBYEwIJww1xgqlUkQew9aUFElObVhxQXGBm6rUG42xTD2HkOdHw44mTEDIJQSGBbmpJBuWUDIRVsilH0v6vYidzFOEsHkFQ6EW1tsZAQA5-MaTBDeAaSBAdwUtUUNtZUqptoai1PE+8Ip+zJMaTKNJerhKtr-AQcgLQ+UQA4CyHo-w2jCqZO6lY5MGxbCPKoncGJNSBn6hoU4J4zjInnfeog3BYCULwAESyHBmS4FNJAAIPwSCYB6BK1uhbEA3GFNw7YxwlA7T6sFEUvpYnKzsA+LFz470iokKxpkujcbTPpNaddnxsMAk4HPd1WQzCOFKJqASMEUQo1RCKOtLYmxeoErBtjHHGRcffDx1dYB+OBFjR+gAXtwQY3aOkXOlSXZCnVrAXFVHkTY+0Lw9NRaiH6lGmM3pYwu9jC6tOawQ0hnRhnsAmc+LhlkArO0EfESLFQ5tpDLG4ZxFxpQEWenat6hBTNtpqaZH5v8AXiBBfNMhv4Vq55RcQzF0T3TzgDVsE4fYNifIXjMCXEuaIbgZCOF5iNuENOFZFcV+DuBENlZ0W7AhPgAgAA1ROcQpnUXZFx4SoKTqlOGdMhRWHVflxkw3OO4zGxNkgyHpuzYAJqLbjvuDZW0UV9W4QVYNWg3NimvQNo7h2NOjdK+dnRK5549pgcRyOhxabVFsLsrYX0ZEUwqKpQGigDs-f++N4LAQkz4HYP+UHJNZA-RQsYYNpxqgXC+lLAqJdciWPWmjv7J2AfIa9v8L2uAX2BKBEaF9NW-buuUs9VEicJZ1o2yeVKlghR4jUDLFEjP-PM8x5NgIoXwtmcwHoAIuHsBQFwKJ0CcJcQ3FKEzFVCAVAHAc6W84fZdXfaG0z98p2scVeE7hrXOucD68WwsDiP01AnmKooBlKI4SWGVg2DQ2wHfhUG7553gWVeA6CBhpgc5UDzdE+HqwL1+oXieciL6-VJDDslE4EuUdFdFeV2d5DsB0+Z4CDdgn8WWwYK66lq5+8vr3zlY4JQbNHFffjz99HdesdgAAI49EizjqAePRPGSDGsKoOQ+xyyRaYFbAVE5ehryNyfqumA+099QNvW5Z2Bi0BpOxCIxRWy0hBOs8i96MdkeGsfTulcu5Zzo-4Z1VAWcR9FPPAdgTdC+bdPtVecoWQFKbaAKGQL6PKcwatCvNQWRIkNxBPP8Cfd8R9DAZ9V9CAd9T9EiEVH9VYAqb1QDDiYDBCJYQMVFFYTiQ9YMVHHA8fJPB9ZcfAGkecacOZaTMoF6A8LEY4HITeRgrQQ4GFNYWRDQdWLgn-WvJMaNfwAIHoDPNdd4T4c1CAM+F8XAeqekDQ9gbQwQcgHAA0QQNgDAOwhdOwvTPQiAsQOZJrQMZYK4BiMUbIM8biSubYROFxdzRwQ-Y7dQuaLQnQlwjdAgQw3MYw0wqNOaSw6w7AWw+wsARwv8Zw-TWAdw8iLdIjBAWwDYOEWRAyGmZEeQAIy4M9OzXrWUDiSeZjCKVQo-KIzQ7QvjVw81AEXFf4CQbMIYFMVAf4Tocw9Imwz4Ow41XIkVfI-o9wy-ReYnMUbKWUbYX0UoEDDid0awY6GuYwNHN2Syc7AzCYsLUzSLPnQYP2AIPAcYhIowvAFIiQGAQldXW4zAQQZ41ADwqoimdVXbIfREL6Y8aQUQVFVRS4KwM4i419H4iLTAarB4ygJ43AF4wYiYkYzOcYyYz4-wQQFEszf47EwEtYlqRwX0cCa4egs3SnHyUOcwDiVZawc4fIREy4wTSrO46LR4gE14pI941AMwr4wQd3bAOeCk8YoEhEcCOoNIIPdk1BOwHIaQZlWoY4F6VmHk19aUqre4mLLEnE-4IY-EsYiYqYyUo03DOUqkizaAowbuOEZsSvWFTaL6WuFCceEKPEX0frb-Xzc43ky7ebM01AEUqNMUiUkkkgQsWAQQPgR0hUsoT-LQCCVYWRPqFxSQR+C4VQPIDQUfLlIbMM19CMubKMggXE4Y0Y9gQk20hMpMlMtM6kpIQfQMegoqGUIfJ-PYOwZCWPXaRGTKA0wICMq7WsxI2Mkw8UqNSUxM5MvQDs500oxwTYOQwfewDYewaQqtFeRYLQOYCCCeXBdo3AtjSsqcmbFvWs+sq0psm04kwlFcwQNcgEoE04aQWUFEZSFUWwPqDKcwTrKUORG4OPcs0MpEwIYHGkYUuc5Ixct8wQBC9cko3tV038+ORjFYSUFxDLAipUlUUUASVENo7zDo2C3khCx8i0vExs5stCjC78zsnCzZM8xQFEJsCoeHOk+oDYGwHLDQM4z2L3BfPHY0f-dgGMlCswt2HwGMKw--QQKS-HDc7Cso7VCmfqT7SUWsDbHEcwDYNEZEfqaUcS7MbXDSmSsAz4Osxihsgk18pSlS0A+vXAdSj4RfTSrCsHHS7c4MKRVQcjOwKnPdceJ5K5VWZQq88fW8rNAEDnLnIJXnQUzEpCt4hc+MwlNnVKmU9KwQE0v2TCqAzcyUKXewPrbbcQPqCtTucpW+CwDiSc5K9nD4NKnndE004Up85i18yUgqrqoqnnEqzKnI9irSwKxwOwGgjie8OqiXRwJqhBFqrktHfJXMTPacXglcAQ4hOZaUZmdhRTUQRwM8NSCmaPPiaWC4LagpXazACQfRDgC1CACAAYH2LMVAcAuZDVDMxOQy2JKwK6zQE84NAPXU6C6eIbbaw66cCQXAG03DYgU+foCg79DizEC6xYdUPEG2cuQ84jWsVfa4dLSObAhK+Gp6wQl63mERGNLNXFFMdkAiZCuM1I-wGYzIuY7IxYpkZYjddQAG6CSHEXG4VZJQM8cUAqG2C8QkTQCMFQ3zBG56iQRmgsZkJgVm9mpyy0waoktIpgKw2YwlAWrGxkYW-Q0WnG7IbpTUVUQeKWzUEmy3K3G+bYZETibYE8bUVWvAt6uS91ZYcmX0M87Y9KOHBCOYCwJLYKWwNQWUSUNHYOggMiGawnB25FeYZhOtPaWO2QaRVUUCc2SFDIKix3XzGMA6z4bASLH2cgTPfa-g5646+QBWNgrMzUW-BEM8ZYZCOwNsSiqde8NHWu-g+uxugJTPV6kROSsbQVfDPlPgAVT9XW2KdmgGzqcoLINzOoc2LQM8SmaQCoEMQGnwgOmmmuuuzgGe5u+cZG1GzAdG1gVdBdHevyQelQf6K3ZA2O0wEODGc4JYXhc2Ceu+hutEpuuerW5mzetm98Tm3K7miw02jIrIhYq2m2iA4QAG2wEOEMDqViWk-aC4RYJYGFCwWRcIwOtjSemAaemB2ep++BnWvW98Aa1y42nmjB82+YhwnB3QjdfB+2jiBYQ8FQEuPbbaZzDrbue+SWF6NHHoTnLPGrNpDTL4XAeSrmiQdywQNRwwuwwYLRhdHR8lWtcCOYIuEMfSRRBCD+coAvQijIASGDehgrYxjRsx9gbR3R7h60okwxnx0xn6gJqxp6YdS4baD5U8diJUeoc2UaUwPLLxw7WqMIei+m1umAdunGtEaoQ4N+GFLYfcBJrScZaQXdVgqUS4YMmCvArJh4xMRGl6288g0IbgL6x9f4XMf4AgdhgIQA7J-AEHLOkWYyJ6fYS9aobVBFdA8oQdc+xQfMssuG3zFpnJ4hAxuCz9a4qAPAB9HAcgWkLEoISgXMHe4nPPX+0u3reHa4cCVSDyaoX9DZ29LZ0IVppMDW9hrDbZ8ZjmnKj4k2s2vmi27BpwkR-QjupQQ4e8H6Ja+oVYIZfqd0jIeER2am6i68grIFtpjWkgT6z9CAc0OKEZn5hCvR1B8wox028lkgOKQQUZ352LTpeSYyFfcDZWTUSDC3CwRLaRjKUZadUKG+5p6l4F4l0loVJlyltlmloJl83hwlSwhVwlJV4FgGjzFxwMujK4WTHyXS8vPi1YV0NHIgA0H8Qlv53JpkA6gpyZrcNEZ5iTewDQdx5QOWVanYhrC4L0WRK1m1o0O19pvZy4z9PpgZoZvAbW40UNqlsZtpr+neewAMVYWUY+62A45Wt+OoF-awENoiAIcNjWzpoVQ545t2T6xN0t7Vol6tg3e23OcCCwIqf82RQcso6PeW5U+8PeY4Et3lct+mzW+NmNLDa10t8N2lsFvhiFrBoRmFuI-QwwDu4KlJMZFBQurSCwZCHuGwatBJCVvF8fGd0d6Vol8dklr6zV+t3lRt5B0F1CuaBlkqilwlK5w0Vl69iZgKkmC4Z56zNzLUDCFA2EbaNzUOGHT5nzPAy921-9iNu9lkL9x9n8Z9giFVli99jVr9qw0Nv9lNgDiq7SwdJSPiNUPISurfOsEI9UCC3yOoNHaw7RIITOEF0UulwAuqB0lGhw0-PHSAyVbS2QeTBBbISPY9WO5FpLK3YMNUNENjkhHRDOakA2pinhqYvjnDP4wTnI4TxkUTwjbSkQcPRiZQHwlyapYoaHeBHcUCeVA8q17gaUoVecAIDDd4L6-T-Ded1CkgRDV3SbAAOUwwgAADVcN8MgT1QbHVlC3to4k2ELgey1BjwsDWCz3q7EP3OhNP0vOfOsN-OcPnLnyWLgv2BQvAcIvfOYu8MOXLMuyyoaCcEVQ0gxN3a7xJAHNbHxBdiVOMnI3X1PKsdADugQDZKDDX2zCTHxvJs-2pucjFvAd2lAORZHArAbqvUILA2BIUDw8NAtgxD5nCH2q1vkMyTPc9BAv5viUrvvKbvMAtcgT5NLghQVhzgbkEUVZJAcyIK7dZRm0Rukqnu+SPdXu7uUGPiFu1L7ToeFSFh+pD0fpZd7xK1iMEQlI89jhZdXp4OaK8Dwf-81driNdbvvc9ddHYfUL4eHLSSKffitd0KfcW2XX5IqYFYLxGNmJ4DagzxFDwIeLSgKnod4rz2Ky4L7KvLIeZSqfdd9d7uo0GevKpTCu55WeleOfNutxtvD3S6fQ2DgLY7O6RQNht5q5upLuyfG8M1m85sVeJA1fgs7D08iUUz3vJBTBHBD6HMa4S9ZFDh9gJ5VhLgshJe8ubyZeIf7eM8vOrtnfXelv4-PeywcbaSB1NhA83l8h3b6mRyWtWiXJipbeHK+VZ959fK8dk-Hu1KZ858-iNKgTT1k4h9ahVRRA5YDgEkc+nBNpTBy+5fT9zRXusA6-VLGfR-z9zM9eueWxsR3ssySyUovoJMQTMJaiI4lgrW+D8m4xFxrVzVjqeL23AMrgq8Ld5hnnq0zY0QKhx6RutYnXD+0Tj+M7ijyPArSoh7ZQvXL++wa-sYDKB39nafqJ-pKzYwv826b-J4rNAzqGBOeLUX-ufwAHbdtgARHbmAJUiP9GmmzRDvvxpBwCP+VAMQMgKLRn8r06Aq-gEXkDmBMu4AvAXv1f7EJ4BJ-EwBQLLhUD-+OPDAdfzggMCY8uAmuCwNgFsDSBcgLgQgFQHUC+BtA2OscHJg4CH+NcfAV80IGsCj+CAqgMIGkGyDeBp0BQblGmZCD7+EAyAVL18wwCD+EgnQeoH0FrMKYkubVDtHqqx0EElRMOkvCgpf4mm0AogQEBIE6CFAjgkuM4NECuDaSqCI+pIyWAqkJMWQK4Fa38TsdnqeTdpsdVRgSZEYUtMhml2FB2ANSftSUOHBSEBJ7WuzStlAEtAfojmujWtr01SF-Nm2O9WQr2BuDZQZQgvNLt1GhKgNIMoEDfOULSHjtqhZbEltgD6BxsmazIcgM0Oa4ulMQGwMoGGjSBLVnEgrLUCL0aT5krgPqEYZUKRoAsvqfiCodx3nILt0GS7fmtCzyKwsICJgeFgrA7aqhmU7yfuGwlOCpRCaSgAiqhDGjP8FhsrF9PKww7zDzhzvfDoy0I4Qj2OO9BombHJylBYIWPUmN7URyo8URymXfkCPOEgiyW4IhYVpxcrBMpi0Iz9sy2-YLCxasqc2PZllyo8e2OQLIOYGzKKREQXWMQbYKRqwBswHAQVDUKtpZpsAXsKEfyItpOEmAooqaimEEC5hIAbqTPi5DSifxlgWwFsBbneYFR9wIAu8FXHUEIcAhWgl6nyJwA5JyCC6EUWKNw6vkzRHAQWtbWlFex-icohURgHzTSCOCkjcQAlgEimBLKGIXpPLVkAJJgwMObkcQN2Ym0v0zIQkukLp5mFwWmDW4Su3uFrsICwhIGIsDNi+iAoMtJxuIGVCopkWKTDzJGKCHRi+GsYgIPGNya2i1WvNZdjkWEYZjTOcWLcPbkODXBVQt+L7gA3s4LJC8YcIiuPD8EEDoBwIvHHxyzR-UBMDrQIfTSyFgRZQh9Hip1wHj6U5C8gFxOuN2iHCBCjIGcSwHAIVt9mQqNmv8EQyzjwCH1L6peOvEnjPgANUuodBxAD93saI15ArGA7qgHAlwU4niNGFHibIN4+cVUPPFCjumnOMCXJUaHWhQCX1J8Rt2-5AdfSUiUMS9F9Dd8nG6kC3qBGBqaAvWho4npOPxHTjQJyEgkWCKpHGgpxIEmkMhKhEkkCOVIqwgsIBQMTBAyEl8RizsBBpw+Rrfuk43yDkx74GpYdLIAPFzgGJsEs8VG085Gp-gSEucXJWGZwj7WsknifbWDjG5doTyGCKgjgjLw1Ih4ZEJl2kkUTGJqk-5pO3BhNDyJWk1ScxOuEpioWaYpYg8NgByBnhBUYhj9DvhSgt4CXe7JlgIn7gzirDYhBkOdbz8UBmwBWK6D3zypNAQY7KOBCuB5BCQWZWGhoJvJRSka4wzRr9VvHwTipsEl8cKGDw8ItoDYd2ssFhCcQmEoY9xrlxDIk8CpHTSCbWImJ0T8RP7AECcxlLnMG8VzRYaUW5ZiS1gymFlMHCDGxITyqIHsdYAAqRTH6VQuVjUIfZN0XJH7TVuhQCQvjdwD8I6JYhcRpTJQBUTvgGIGRR92p+U9aYVO6ldU3YwLGYQmyboviWwbIq4OsHxCm9Bxp6aTGtiYIZs1ptk2YZ+h2mJi0GTY1MS2NXYFEFAurZYFdNFBiw8guZdiJCkoYHs6gFQPiuDKslySFxTrJcYUw2Cvwfo+QbaNJwBmIBFAYEN5DKhhxtUwerDJyaeLGHdTypTEsqX4wqk6SIaXJHhBHAoru17MgaXhLtFUSKoiZnM8CU9IUk1D4xGkmkANMGYZEzmFzWAGNK+n+4-UnkcQj21F5slKYicH2qqHlnHibJYwzaeh1omwNiZTEmGfS1Ykssm6nEvjtxNUkvjKUDgJCPMCVSoJ3mg0VFK2A7Zogcg1syibbIgnKyZJ-iFSbeOGafSdJYoaEjI3vicke2qoBZFTAArpRbGJE-FodktSP0FZgQbmQnLxxJzYJb9TGp-R0lDwsp1MJwCwgRQ+ofxZUeOKHH6gxzrJXM3ZuwyhkBIXJcM9yQjPTEFEZAurfKGH0RAqAw47tXsfYkli1hw4D1dmRXJtlDzjhdklmlvRfY8crhE8wRlPM8lti1AurPIChGlxZSWUnciCJeGMCxwIIaoUHlAMnAo1axVCAiH4BOSBBhRoxa5jjXDj4THAHmPbBFUYLCg0sK0k6cxAOzecs8Nqf+TaCAVWixUM4RiQtHJTmwFgpsUQJsFQjF4akLmduVLBeiFRAy50MgNgE6BDAiuWeEBRcIUpRp6FjC4YJ7zQUd1mCDCbqC4lqD0o5O+4JLGpEj7S4IGXBThUws84sKFoJIyrq+VkXcLAUvCnGvMDAy3x88u6GuJ8OKBtg2SyqAkItRcR0KREXC5havXXpCorazvVRTkUBRW1jqwfZTBKFVIwk0ReNVflos8jk4LFDCuRTUK878pEMlo+9A2KmKOLPeLinGiIF77wlex48G4LnL3TnBScFdFeHdK5RW0fA4qB4FCIXT5KcF0yJkAUjmQrAee+leQEwncYDiXQYi8pulxv5dhzg50PJQUpaBKKja5I4pQUqoRGpQF0giHEIr7grSYSBi2iAcSQiZLOIA-VEB0v6WlLuljfUUbFNQnxZXk4EPigiCPCnBJQ8SI3G2BUCW8zyOS6eJ0pWUYACAajNZQnyOqaLtICmEdAiBtgPwjlXdRTGcvWBLK-wJSv4IUsfR4B5hGAZ8ZourRXSPGjmUUDhIFDvyrpJsaIUcSJ64QrlgK7pV4jH5Jg5+myq-FuXpJ9YjIjCYwPEh0gnLNRSgwCQlXRVgBClCNWAB+Cr6YAooNffynivkhQUuI3QzUK-KVhjptwlKdhJ9z3wO1r657WlYUqi6a9cM7qU6HIRDBvDFVVcBmLfgKiDtocpUDKBcuEiSrull0ZnqiVDq98jgfqThF5FQQgRZC2U6PEHiVhV0x8eqm5QAkmruoCVDQe8MSrfgW5kozzClT8upUSrllGKm5Z4H8C6ZAFSo6Qc2CHo2xGEnqoSgzFMH+qEQ5y86B7Bsqfo-kEkKSGwv0bZrJIGAN2Ihg8DCE6wVQRWuyRKgNKyiNgBWMGFkTJNOER8Lghmq1xZrxIha8robR04SAC1ua4tewFLU40EuFamUFWpB5B8zAWbCOKKFEklyDGElPQOQWsi2QoRq6pgIOuHX6DJAN4I4N7V2SMQUCt81IM52k4sx01S6ldTZCYA9Le1sADdVuvQDHVp1qWaTKHwow9CtItQUARsksSS4dVz4NtcuqFSnw4ozvMDewCfWei4pCoVyDgjQg1LUsKMJFLSnmWK19gUk1tVetA2xQ5KUSiQJBug1zIixKIIVsiw2QgCheUoSooGXPICQJy2GzNUKkAL1QcFzvVjeKmI2aLX4h6MiqpB+igRmRtRPyTkGTjtZh2TG9tSxrqjio71ZIiQJxpwXcbo19EPcofBnQEUY6hiq4KIS3LD0AJxDS9cxpqGxRZomhVhc7zM1zQE0uYFTbBr2A+90onqmhonBzYmCkU2QazgxqqKgRjN0m0zTNGiKWaCN1m-wLZrAD2aOVLUWUIcGpSWIiJQoRxrlAvDKCy6FlIppYEA0RRgNn6cGDgD4DO98t2APgFFrE4-86wZsXijiDGSmA+830v3nqTDipZ-NIGmocVsK0EaOtZWszhVvKDrRuoNWiCHVp8gcQpcdiCvGZRLitbyC+W1+q7KnavcetHYrlmYE0BgNTcnEDIFMstwYi6pFGSwB1BlAza7Fc2+Taq3JFzbltnLHdGUBVBrZZAdCI4miIIUFlkQGqMZAuty1CpY0x8y4ahV+2RaS1z6+JSqEkD1MusAGbMgigxiv5voi1ZWC2BO3tb8Y52lioDuu0tchAYOpUlJmWBLTWCA8KRN2IyAI63h2W3CN9pVl8x-AzvJBvzEx1LDT0PYVNYO00A+gGU9Aj0JhP2BMdxxwkKnbWJp34aKuvSiQPTv8CM6Jpy8V6BlB3G1olgcsJUARO9ppBMgnBBKoLsdY6xBprs7XbrH+BS7tKfkBKbwkVBiwUQBfGWISsHz7gxQIYVFYupM1LhTQButHa+X10AgjdgVHbsVCE3S5NQNMdfvYDPreh0eb0OwMjoCAeJcULqT3qSjkoLbyEnQB0ZvTj0J7hCecXsfMsfjWdr+GocoGDtkDvbalX2nDTUJj14oCU8el9CLp7UKbYAye1PbHur0Z6R1ZeJOP4p7iSga1aoSQKoC6xqALWEEKPcunDXHIfmkwZPocjAAALJ93Ab3RIm7AMJwwNVJTBJkeRzAQS1mKDGuNH0z6J9pyQJqLt7Vhrhgc+o-YvoNjL7O6oRVohbCcCPJhZazJeOjBuBR6M0XsM-H7AcWexCkMWK-VfgwTihUl6oDyKSpZJIolpX3V5AFA-1-7v9lAd3USU-3-6-YgBzlcAfflrMMI5ReHEqFqBSgqkrycVd9kF2UJxsXHZ3hQY07DAMDNJcmJoGDB9gD4NM-ik43gLmAjgxgWROerL3O6aDVBgjYIepD0GuyXdX9FhOlDiBHMA8alGyUy5WBKMUoKPbiibh5reOjcUQ8Dpg3Rai0hC1FC2BqnpcmIA8WkjTnDFKAo50izXeXpGZaHhgyB3Tg4aB1DqQd0aswKXpLLHsTg1wTcQlzDSlCm0e2KPbrNwwaGwWc8Vw9uoc1lFp1q48+iqFgj+iB47mRHIoXX02Hz2gusI1wxP0N6ojYhowGtr+huYb+YaC8FvCWwXg6EVeGUKUCj3WEz4zvJo3Zp0PCFEp9BRED1GuAPInGR0Shl3yxAqkHVXKLXafFzBOGJArR6I+4diOakqqmQTiBJyvQDx0ECmcQCJRqO2Ao9gCYBKAiGDgJZuJ81ClAAgDsADj7AI40UeSBWAFgKwh3VDsJ3sQrg06rULR0R0U6ndAWgIHsZARgI4AAxfIxds+LnHLj1x9o-EruPGwCK+O+5Aikrpl53jjEcnedBaQTFBRzvP5K0guOx6vw9Q8aeJwzIEyo4KIZQHBEWYx4ammG6CHImO1cF0TVqbwARuxMYnuYeJ-ABUsz49l8ZqKDgugkwFsJp0SWAaMVFZRbBzoPGaMK7MYX0h2TeKfE1ya9FvblIY8N4UIqpwhhjYnEUBl2CkySmZk0YAjbKbADynOgip4ZbEZo03ILY9aL1JhCpxt8Y1QFHsa4gSoCI1OQQchJQltDeBXZhYYhD4G9PmgwgNxvyD0fR4Wx82PXCePAkbXKAa44gc6B6Y46N6KEIZzEwRoDPTggz6ZqhFBshPSCMgN1PHaXUHgFiq0uIEU-vgNH2ZkzWiUhGowmB+m5uUabM5gGESTAbj7rZJtpA1WiB7wSiBLnnN+lOA869ZwRDoibOZngTLFds52YX2FnYjKgfGkcDqli9fUSiX8soHhLHhNjbUrlCmdITgEAQhiTE-6eIT6JDQZ5m43UhZGsQ3hpULILYmFkXUoIFaffBOc9Mnmrxk+5k7OdfLtmrzp5n5jcdAFSgr0m0ZTBwT6iMpFpLiIYfuAPjnRskuSM4dzmCShJnewnHxOhfSpiAIANxxmBQxtNfwCdfR+ztIxFCKg2YnxlC94gBC+JUh6VEJAAimM4XGLeFnnARaIsdRoStyJ4xRYZlk1NttF1E1wVQuMW8kBSTC2xddkcX+mCNH2DxaXN6GhAfF0i3cmh1BiN87bB-CidOX0WckUlpS0UjYsEaFLuAUyypbcO6HytEiDS91FiaCWETHkFxvpeqDiWEqqi6xcKOwWzhugoa1sxIG+w+X5FNY-yzSECtgAEAYpE0PEEiDCE90FguOutrI0MwOCJTI6E2k1EHLAlVi8K35fFQBBorUx0K5YuCXN4irOCkqy0FisLl4roiOgO6j6GQKlgicXo8ZBuADxmCK2WpbsX5aLKZFFVwUc3jCWjXqrfwZ3uVaCWjXQla9cJXYqwXip6r9URq2cmas41BFcBZLDqR4PPmakmVrbQ2BysbA8rw12a9YvGsRKRUU4djQRpmsFWQlWea60tb-B3W-gq11AOtY54kaJ0QAkXDYCEqP6nGvVzrmNqPRI67ghneANEAGyxHBAv6fi85fIsIoRAK+BGMHgpwdRHdVUeY7+VyB2q5qFaVVSHo1SAw0s9TA8-qnUJGoMAEW2G-ZZFhvKRe6BY8J-AtwygfhkO05fdoowaxo0saeNGaliPBjp0mMveMHA2wUNrDvOw8KqAXUaZlzTCTuJHTDGeWMrLiPepqJRANZhoERTTPhGXNVUcx8WjIKYE+hycO4h9PpD9H3CEUDbAWcwjET6IbpjbFcFsGbdLKW3co1u64EbP0pqwvjnRSIqkTGkOzLIjkFbTSUyBpRAoiCDq1+uIwsj3QNgFfr5tGMTiCsSeaNE4RNDeUUahKQsDkSZaR3lzKI6QFIqzYfGBVhBsoARUKj7q6YbpqwSTxl4vdeqQpSklabc3LZrOVcNQEdEhITom0YOxzD91IP3SCsSVRHp3ayrd21LcR2VMOWpQqBTVSdsorLjQJdYwDIRFu9H2nsy9qyUZHuyviJyVBaUvCDbHNWNixIS4h6MA+1WnIn3F7cas9Jjxti1ghLpMdYzE2L2oQVGYPGXvRQBKn3KtVgc2ElroxkKtIwvE4OH1hK7ZqbeU6e0uuxxsrZewWdgKfbLxqBaCOxNEFTgRZ4OSM5wCoC1naojVOcY1YJKVXnvjEe7sgCPHLbtz5iGqCye+QyQY0K4Ru6temqLdsYS01x0tHtrQwKgdXBt0jIpo9R2rjtg6ot-iVSiBjK0f64NVKE7Xe1HRQwmdlB4dj4e7MUakxXDKLY7w5inktjS4BvZlR1g5q3tTCHssVtq06aw8g+Yg3ZoKP5qtjZUigk6yy1WRpOJLdKDWZp0F6y5zHmBVkStVfIIVK6t0hgi7ZGMIVHR0aIKyMMDQ0DHXFFIEcVEI+JDUci9ssQ6itk-SL7heEgZT176LDdafPQ4Ci2gbyzZzrYEVVg1FBWt7tg4A0iwHynTDSp5k+qeGPGFmAUWzgj-LBo0IAGHtuXQwT3hUUDGmXMWxG5pPmGfTuBq484ZgA6n81Q+jweYOnAYhTB5wYwI+0HCRuPjb6uYz-A6MwnH3VlNvF4NByidYkqw3GobCNq0cY7YhLEeSxeEkW-0CC2i1G2ak7MTHEIh-Ed1DYPnSs5s1BMQkyV+mAIOp0KEVhMdDtJ4FsA1S30P9mwQmt2u85Q7yToXtQvXHgDqeyER4hIbtiqWHs-i7c6ELQGdccdStSOEbE4WWxQ4KO0gfd8DJlNWBojKb5gORHuTJjRyRukLl6ne0JG0TsOCj4hzwZWBbkU68OBolQwPZVV77yDlJ4diQ5ht8X-Dxe16ChTbsIIu7XvWScxZtXkmXqEdsh2ZcEvRrMbBF4va6P9bF+0mGVDtoaCuRekPgw+Iy+gFJsxXo3Ua82zqcBGxe06B-v4TN5uhsJ2wQioPARDWudXtr8dqy+1dsvmXdTq4FdKqK5BBuHrwp37x9AP5giSbjN+yxBEOzKWGs5NuyyzdL9In2qQhmiM6takHEaTZSPvanuHZ2OpCWgxs8XtW56IgRtOzbG02dhzgNODUOqBcRV4-XBWMbB52evedIu2GWLgO6Zv68aZEeBEH8NjhEUQKENSITCGPbgvaKY3MnpN2ALqyZuPd4UD9BaJ1ALZicFAvJgsAXguSQMHuMPyxwvctcd71yNLg4hMJDw+0ZXfjPVA5l4SZ7tu7yQh6I9-3r9o8KJsfgge6gKMVGTGpoZf39gP71XH++1w68APKH77qiDjeTO2uW23crKC3IavSJh9uD2TwQ+Ef2exHh994VREkKGUE6FYP1DEyvHXjeH1PPH0d6MP67pZKoI-Baf7sK4Ak9eGiGUBCeG8TeRPmJ53e7ZFqL8PvNuTI8iErcNvIB4x4r6N9q+uORkGx+lykfioFZowJjML1vITYi1JTzohn7j8hnSHlc2XSalBQ1g6-HJ73VkSpLGMk9-wQu8CHBDGbvWkmEBXE9d8ceScXvVmXdKDd5Y+lXKZq4kDoWjh7nzd-JC9DtR0es6B-gC6rRsxjYCUpg2FUsnxzCXIbp1w4hD5pZdNljnbWJp-FehFqB4VFNV6hejXqokwvoKLcfg1MPtufBkkohmWMpj2S8aoD14Zp2Tp2Cwup6qDkKdPP4AU2xCvmhy2NfBDEObxIAlc0Tq3S3p1zR+Nim4Nk0nRZoXjRhgGH3+PVjs-3C+fPX7GkcwCl2pgHsTwJ6XSB3j0V6kmwFYt-tGglETWrRzojd1F627ZjS8byL71+OVeo9wwTByQvO61fPfeR1Y4UXWJe+5eaSFTMx1BkVDqhrAqRgskox+7vIQwlkyuc9S+fbRAPJcAKcZFeRbn67aulJHsuTo0-d5isrqQnIfElTPgHL55NBAtZ1rKmZcAoCLzODZd8yPP2OXvP5+EvDEPTWCTK93UyNPIhmnbfcn61SJ7tOpXFgfa1f0TefVc3Zod62lEjHJ5vhR1re5bctNQauoyaj3KAbzlMgZZJ-R9N+2-FffPoN0VyUnJzhfp3rW8Qo7bzAVIMOtWN2PGR9gYSaPzL2b-98W-95swrDGrJkl2+nX3Q+BGtk8tIgLcfcO7OtprjSYiZuPqH1uEHR-p-aMz6mVjMMXeoksvvZRJ9mDuhlOpgfuxQLOQkKOkXPEeEljZs8yCql7pHfPxPvBANK-vXz9KrOBEayB-ZQB5tHn6jekXjfkBV7-Wg4Ilt5Fbe2dtICQKOO4vYz7PHE3zsQbkEeZLLZmd+z-lfo1l6cCyzfXIg05lIssluEsNF47FgY12kE78OpR6Xm9IZIVCboFHE9RkREQI1hUAdLcIULZt4AU2p99-Z2TjlpwenxXw0Qe+X3wioIMXPJ22EXF6QdwQAIels-VPztdyCPv1UkFHCGm5ZgofYQPggxbqAY44mNK3x5+dDL3LkyAweQD9xhBf36lQ2DlzMB1ION0E0PldiEMplmXrDc1VXAeRJkNpUEWt9HZDmRz88fBUAbVTKC2XcZhKAVQpxUoJjlcFrAF-DkCqJauUJda5ZSXV9TvWVFFBTyJp1DwEICeCHp3MFSDTsrZFANp9U3OyVHlyAe31thmpNzTwdc5X+ns9z6KRGyB0vH3wMYVA8gK8DZhQ+SQZIfaO3UDNSKRnAx3mbxX9E9wJQC75HEFWi-l0MVBT-kEbEIKDRYUXOF-Re9eOg1E7EfYRcgsjR60qsvOVhViNRAN41DAdiCOm-s6YEph6x7MASHvt8rJoJesFrMHz-BYjbcl7hMeX0B2h0EDEGwl6SD0F4E46P5RFQAVOlRaAJgppV-QusBNQgMBQZxhfhPVSileghrWw2d1+1DAARsQiWjVUgw+C2RLxUZbIAjo8HCUC+McjDdWuD5qQbn3VBtG6RQIO4eV3fcyNWaSj1INa4Kql7dfqzmBCKFDSZQUWahQAk9-c4J+MlNP4GuCkXV+XpdpGYhUHNQbLUyS18QSDwYR3guwzC15oRNGuCV8IBh70NAbKG-tUlH5x+4lUSihUMpNNrTVwboL4KRNQOONxlAqYbTy2wAYPBxB4FbUIzm0IQ5CB-UtgfMW7ZBTFLTcVWZS2DeV+5dkLy18YBGyuRkbMi3hN5gvpBFA+TDmzdZvfSnTsMJdbB0XtBQSdwSwGgXAQPcfIB9yKdsPXZHzxGjbWAN1rgvyHIxPsMTWWMrdWwAVVOhYwCRYTQ74w5DK9OPUBQE9KkMYM-aFnzeExQIXj3RLKAkEtgURLtzGM7DMfSORggQBWahkg7HUk5y0XIWm99gowDeFnBatVapkWeAy-1fYSgAxD9A3bF7Acg+mR0ojYfOH3oQoSukd1yDdOC44MQ4kyMNGZNIBS45DSJFh9pGHfDFC1QljRcNrgtQHdBGUP2n9IYdQfC1ID0OiGjxSQ53VyMkgm7RmAhKG+EUBG1OoGHQY-bcnSguSTy0MtZwmoRmMFwqUPWhTVREFAga1ZqXAhtkQqH-4RXFEI5C-jcE0BNNQsCE0sXLeYIGhsg3yFLJlENEz4AcTNoEHCCoXd3RhrgD6FlAhkValbBT2ZCLo9cIKU3wAMQzZFO4lAZkNUAqcWoFMoYQR-mSwzg89iPN1OYM3zMEIy0MOCaZegmVRtoDbEJoXGFSAZINRNmXdMGzKcwXpmItQOx16gBTEKhaGGEBgs2EJHDj81zVeHZ1cIiQHoisSa8z-MoAKkK4gsbexkscNsLULfgSI+IQjojLNC2YseqUJGAi3-AS1RsQMNeANDy0PGRgiJLBi36ZpLXMFktrI7UK0tnjYoGsBfyYuigjTAFyO8sRrXy2WsaraK3mNUUNGHvhLEKqjmAGYJ6DDAcgn9TOUF1MK2XdXrIUUij0QxeyIl9WHczG1OuGtURtmCCUEC9B6VnVcBXAIAA */
  id: 'Modeling',

  context: ({ input }) => ({
    ...modelingMachineInitialInternalContext,
    ...input,
    store: {
      ...modelingMachineInitialInternalContext.store,
      ...input.store,
    },
  }),

  states: {
    idle: {
      on: {
        'Enter sketch': [
          {
            target: 'animating to existing sketch solve',
            actions: [
              ({ context }) => {
                context.sceneInfra.animate()
              },
            ],
            guard: 'Selection is sketchBlock',
          },
          {
            target: 'animating to existing sketch',
            actions: [
              ({ context }) => {
                context.sceneInfra.animate()
              },
            ],
            guard: 'Selection is on face',
          },
          {
            target: 'Sketch no face',
            actions: [
              ({ context }) => {
                context.sceneInfra.animate()
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

        'GDT Datum': {
          target: 'Applying GDT Datum',
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
                  },
                }) => ({
                  sketchDetails,
                  selectionRanges,
                  sceneInfra: providedSeneInfra,
                  sceneEntitiesManager: providedSceneEntitiesManager,
                  kclManager: providedKclManager,
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
            input: ({
              context: { selectionRanges, sketchDetails, kclManager },
            }) => ({
              selectionRanges,
              sketchDetails,
              kclManager,
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
            input: ({
              context: { selectionRanges, sketchDetails, kclManager },
            }) => ({
              selectionRanges,
              sketchDetails,
              kclManager,
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
            input: ({
              context: { selectionRanges, sketchDetails, kclManager },
            }) => ({
              selectionRanges,
              sketchDetails,
              kclManager,
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
            input: ({
              context: { selectionRanges, sketchDetails, kclManager },
            }) => ({
              selectionRanges,
              sketchDetails,
              kclManager,
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
            input: ({
              context: { selectionRanges, sketchDetails, kclManager },
            }) => ({
              selectionRanges,
              sketchDetails,
              kclManager,
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
            input: ({
              context: { selectionRanges, sketchDetails, kclManager },
              event,
            }) => {
              const data =
                event.type === 'Constrain length' ? event.data : undefined
              return {
                selectionRanges,
                sketchDetails,
                kclManager,
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
            input: ({
              context: { selectionRanges, sketchDetails, kclManager },
            }) => ({
              selectionRanges,
              sketchDetails,
              kclManager,
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
            input: ({
              context: { sketchDetails, kclManager, wasmInstance },
            }) => ({
              sketchDetails,
              kclManager,
              wasmInstance,
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
                wasmInstance,
                kclManager,
                sceneEntitiesManager: providedSceneEntitiesManager,
              },
              event,
            }) => {
              assertEvent(event, 'Constrain with named value')
              return {
                selectionRanges,
                sketchDetails,
                data: event.data,
                wasmInstance,
                kclManager,
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
                kclManager: providedKclManager,
                sceneEntitiesManager: providedSceneEntitiesManager,
                wasmInstance,
              },
            }) => ({
              selectionRanges,
              sketchDetails,
              kclManager: providedKclManager,
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
                kclManager: providedKclManager,
                sceneEntitiesManager: providedSceneEntitiesManager,
                wasmInstance,
              },
            }) => ({
              selectionRanges,
              sketchDetails,
              kclManager: providedKclManager,
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
              kclManager: context.kclManager,
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
              kclManager: context.kclManager,
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
              kclManager: context.kclManager,
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
              kclManager: context.kclManager,
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
              kclManager: context.kclManager,
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
              kclManager: context.kclManager,
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
          sceneInfra: context.sceneInfra,
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
      id: 'sketchSolveMode',
      entry: ['clientToEngine cam sync direction'],
      initial: 'active',
      states: {
        active: {
          invoke: {
            id: 'sketchSolveMachine',
            src: 'sketchSolveMachine',
            input: ({ context }) => ({
              initialSketchSolvePlane: context.sketchSolveInit,
              sketchId: context.sketchSolveId || 0,
              initialSceneGraphDelta: context.initialSceneGraphDelta,
              // Use context values if available, otherwise fall back to singletons
              sceneInfra: context.sceneInfra,
              sceneEntitiesManager: context.sceneEntitiesManager,
              rustContext: context.rustContext,
              kclManager: context.kclManager,
            }),
            onDone: {
              target: '#sketchSolveMode.exiting',
            },
            onError: {
              target: '#sketchSolveMode.exiting',
            },
          },
        },
        exiting: {
          invoke: {
            id: 'sketchExit',
            src: 'sketchExit',
            input: ({ context }) => {
              console.log('sketchExit actor input prepared')
              return { context }
            },
            onDone: {
              target: '#Modeling.idle',
              actions: ['reset sketch metadata'],
            },
            onError: {
              target: '#Modeling.idle',
              actions: ['reset sketch metadata'],
            },
          },
        },
      },
      on: {
        Cancel: {
          actions: [sendTo('sketchSolveMachine', { type: 'escape' })],
          // Forward escape to sketch solve machine for hierarchical handling:
          // - If tool equipped in ShowDraftLine: delete draft, return to ready
          // - If tool equipped in ready: unequip tool
          // - If no tool equipped (move and select): exit sketch mode
        },
        'Exit sketch': {
          actions: [sendTo('sketchSolveMachine', { type: 'exit' })],
          // Exit sketch immediately, bypassing tool unequip logic
        },
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
        'update sketch outcome': {
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            engineCommandManager: context.engineCommandManager,
            rustContext: context.rustContext,
            wasmInstance: context.wasmInstance,
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
            kclManager: context.kclManager,
            engineCommandManager: context.engineCommandManager,
            rustContext: context.rustContext,
            wasmInstance: context.wasmInstance,
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

        input: ({ context }) => {
          return {
            selectionRanges: context.selectionRanges,
            systemDeps: {
              kclManager: context.kclManager,
              rustContext: context.rustContext,
              sceneEntitiesManager: context.sceneEntitiesManager,
            },
          }
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
            wasmInstance: context.wasmInstance,
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
        input: ({ event, context }) => {
          if (event.type !== 'GDT Flatness') return undefined
          return {
            data: event.data,
            kclManager: context.kclManager,
            rustContext: context.rustContext,
          }
        },
        onDone: ['idle'],
        onError: {
          target: 'idle',
          actions: 'toastError',
        },
      },
    },

    'Applying GDT Datum': {
      invoke: {
        src: 'gdtDatumAstMod',
        id: 'gdtDatumAstMod',
        input: ({ event, context }) => {
          if (event.type !== 'GDT Datum') return undefined
          return {
            data: event.data,
            kclManager: context.kclManager,
            rustContext: context.rustContext,
          }
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
            wasmInstance: context.wasmInstance,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
            wasmInstance: context.wasmInstance,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
            wasmInstance: context.wasmInstance,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
            kclManager: context.kclManager,
            rustContext: context.rustContext,
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
        input: ({ event, context }) => {
          if (event.type === 'Enter sketch') {
            // Get artifact ID from selection
            const artifact =
              context.selectionRanges.graphSelections[0]?.artifact
            if (artifact?.type === 'sketchBlock' && artifact.id) {
              return artifact.id
            }
          }
          return undefined
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
              initialSceneGraphDelta: output?.initialSceneGraphDelta,
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
        ({ context }) => {
          context.sceneInfra.stop()
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
  sceneEntitiesManager: SceneEntities,
  wasmInstance: ModuleType
) {
  if (!args) return
  const { intersectionPoint } = args
  if (!intersectionPoint?.twoD) return
  const { snappedPoint, isSnapped } = sceneEntitiesManager.getSnappedDragPoint(
    intersectionPoint.twoD,
    args.intersects,
    args.mouseEvent,
    wasmInstance
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
  wasmInstance,
}: {
  sketchDetails: SketchDetails | null
  kclManager: KclManager
  wasmInstance: ModuleType
}): boolean {
  // should check that the variable declaration is a pipeExpression
  // and that the pipeExpression contains a "startProfile" callExpression
  if (!sketchDetails?.sketchEntryNodePath) return false
  const variableDeclaration = getNodeFromPath<VariableDeclarator>(
    kclManager.ast,
    sketchDetails.sketchEntryNodePath,
    wasmInstance,
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
  wasmInstance,
}: {
  sketchDetails: SketchDetails | null
  kclManager: KclManager
  wasmInstance: ModuleType
}): boolean {
  if (!sketchDetails?.sketchEntryNodePath) return false
  const variableDeclaration = getNodeFromPath<VariableDeclarator>(
    kclManager.ast,
    sketchDetails.sketchEntryNodePath,
    wasmInstance,
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

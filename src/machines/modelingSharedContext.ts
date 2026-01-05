import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type RustContext from '@src/lib/rustContext'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  ModelingMachineContext,
  ModelingMachineInternalContext,
} from '@src/machines/modelingSharedTypes'

const dummyInitSketchGraphDelta = Object.freeze({
  new_graph: {
    project: 0,
    file: 0,
    version: 0,
    objects: [],
    settings: {
      highlight_edges: false,
      enable_ssao: false,
      show_grid: false,
      replay: null,
      project_directory: null,
      current_file: null,
      fixed_size_grid: true,
    },
    sketch_mode: null,
  },
  new_objects: [],
  invalidates_ids: false,
  exec_outcome: {
    errors: [],
    variables: {},
    operations: [],
    artifactGraph: { map: {}, itemCount: 0 },
    filenames: {},
    defaultPlanes: null,
  },
})

export const modelingMachineInitialInternalContext: ModelingMachineInternalContext =
  {
    currentMode: 'modeling',
    currentTool: 'none',
    toastId: null,
    selection: [],
    selectionRanges: {
      graphSelections: [],
      otherSelections: [],
    },
    sketchDetails: null,
    sketchSolveInit: null,
    sketchPlaneId: '',
    sketchEnginePathId: '',
    moveDescs: [],
    mouseState: { type: 'idle' },
    segmentOverlays: {},
    segmentHoverMap: {},
    store: {},
    defaultPlaneVisibility: {
      xy: true,
      xz: true,
      yz: true,
    },
    savedDefaultPlaneVisibility: {
      xy: true,
      xz: true,
      yz: true,
    },
    planesInitialized: false,
    sketchSolveToolName: null,
    sketchSolveTool: null,
    initialSceneGraphDelta: dummyInitSketchGraphDelta,
  }

export function generateModelingMachineDefaultContext(systemDeps: {
  kclManager: KclManager
  sceneInfra: SceneInfra
  rustContext: RustContext
  wasmInstance: ModuleType
  sceneEntitiesManager: SceneEntities
  engineCommandManager: ConnectionManager
}) {
  const context: ModelingMachineContext = {
    currentMode: 'modeling',
    currentTool: 'none',
    toastId: null,
    machineManager: {
      machines: [],
      machineApiIp: null,
      currentMachine: null,
      setCurrentMachine: () => {},
      noMachinesReason: () => undefined,
    },
    selection: [],
    selectionRanges: {
      graphSelections: [],
      otherSelections: [],
    },
    sketchDetails: null,
    sketchSolveInit: null,
    sketchPlaneId: '',
    sketchEnginePathId: '',
    moveDescs: [],
    mouseState: { type: 'idle' },
    segmentOverlays: {},
    segmentHoverMap: {},
    store: {},
    defaultPlaneVisibility: {
      xy: true,
      xz: true,
      yz: true,
    },
    savedDefaultPlaneVisibility: {
      xy: true,
      xz: true,
      yz: true,
    },
    planesInitialized: false,
    sketchSolveTool: null,
    sketchSolveToolName: null,
    initialSceneGraphDelta: dummyInitSketchGraphDelta,
    ...systemDeps,
  }
  return context
}

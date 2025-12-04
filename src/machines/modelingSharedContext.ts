import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type RustContext from '@src/lib/rustContext'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  ModelingMachineContext,
  ModelingMachineInternalContext,
} from '@src/machines/modelingSharedTypes'

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
  }

export function generateModelingMachineDefaultContext(
  kclManager: KclManager,
  sceneInfra: SceneInfra,
  rustContext: RustContext,
  wasmInstance: ModuleType,
  sceneEntitiesManager: SceneEntities
) {
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
    kclManager,
    sceneInfra,
    rustContext,
    wasmInstance,
    sceneEntitiesManager,
  }
  return context
}

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'

export const modelingMachineDefaultContext: Omit<
  ModelingMachineContext,
  'kclManager' | 'sceneInfra'
> = {
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
  sketchSolveToolName: null,
  sketchSolveTool: null,
}

export function generateModelingMachineDefaultContext(
  kclManager: KclManager,
  sceneInfra: SceneInfra
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
  }
  return context
}

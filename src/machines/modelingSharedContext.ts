import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'

export const modelingMachineDefaultContext: ModelingMachineContext = {
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
  store: {
    openPanes: [],
  },
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
}

import { vi } from 'vitest'
import type {
  SceneGraphDelta,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import { Themes } from '@src/lib/theme'

/**
 * Helper to create a minimal valid SceneGraphDelta for testing
 */
export function createSceneGraphDelta(
  objects: Array<ApiObject>,
  newObjectIds: number[] = []
): SceneGraphDelta {
  // Create a sparse array where objects are placed at their ID index
  const objectsArray: Array<ApiObject> = []
  for (const obj of objects) {
    objectsArray[obj.id] = obj
  }

  return {
    new_graph: {
      project: 0,
      file: 0,
      version: 0,
      objects: objectsArray,
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
    new_objects: newObjectIds,
    invalidates_ids: false,
    exec_outcome: {
      issues: [],
      variables: {},
      operations: [],
      artifactGraph: { map: {}, itemCount: 0 },
      filenames: {},
      defaultPlanes: null,
    },
  }
}

/**
 * Helper to create a Point ApiObject
 */
export function createPointApiObject({
  id,
  x = 0,
  y = 0,
  owner = null,
}: {
  id: number
  x?: number
  y?: number
  owner?: number | null
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Point',
        position: {
          x: { value: x, units: 'Mm' },
          y: { value: y, units: 'Mm' },
        },
        ctor: null,
        owner,
        freedom: 'Free',
        constraints: [],
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

/**
 * Helper to create a Line ApiObject
 */
export function createLineApiObject({
  id,
  start,
  end,
}: {
  id: number
  start: number
  end: number
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Line',
        start,
        end,
        ctor: {
          type: 'Line',
          start: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
        },
        ctor_applicable: false,
        construction: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

/**
 * Helper to create an Arc ApiObject
 */
export function createArcApiObject({
  id,
  center,
  start,
  end,
}: {
  id: number
  center: number
  start: number
  end: number
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Arc',
        center,
        start,
        end,
        ctor: {
          type: 'Arc',
          center: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          start: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
        },
        ctor_applicable: false,
        construction: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

/**
 * Helper to create a Circle ApiObject
 */
export function createCircleApiObject({
  id,
  center,
  start,
}: {
  id: number
  center: number
  start: number
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Circle',
        center,
        start,
        ctor: {
          type: 'Circle',
          center: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          start: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          construction: false,
        },
        ctor_applicable: false,
        construction: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

export function createControlPointSplineApiObject({
  id,
  controls,
  degree = Math.min(3, Math.max(1, controls.length - 1)),
}: {
  id: number
  controls: number[]
  degree?: number
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'ControlPointSpline',
        controls,
        degree,
        ctor: {
          type: 'ControlPointSpline',
          points: controls.map(() => ({
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          })),
          construction: false,
        },
        ctor_applicable: false,
        construction: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

/**
 * Mock dependencies
 * Note: SceneInfra only needs setCallbacks, but we mock it for simplicity
 * RustContext and KclManager MUST be mocked as they have WASM bindings and complex dependencies
 */
export function createMockSceneInfra(): SceneInfra {
  return {
    setCallbacks: vi.fn(),
    getClientSceneScaleFactor: vi.fn(() => 1),
    theme: Themes.Light,
    scene: {
      getObjectByName: vi.fn(() => null),
    },
  } as unknown as SceneInfra
}

export function createMockRustContext(): RustContext {
  return {
    addSegment: vi.fn(),
    addConstraint: vi.fn(),
    chainSegment: vi.fn(),
    editSegments: vi.fn(),
    deleteObjects: vi.fn(),
    settingsActor: {
      send: vi.fn(),
      getSnapshot: vi.fn(() => ({
        context: {
          app: {},
        },
      })),
    },
  } as unknown as RustContext
}

export function createMockKclManager(): KclManager {
  return {
    fileSettings: {
      defaultLengthUnit: 'Mm',
    },
  } as unknown as KclManager
}

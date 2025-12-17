import { describe, it, expect, vi } from 'vitest'
import {
  projectPointOntoArcRadius,
  sendResultToParent,
  storeCreatedArcResult,
} from '@src/machines/sketchSolve/tools/centerArcToolImpl'
import type {
  SceneGraphDelta,
  SourceDelta,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { DoneActorEvent } from 'xstate'

// Helper to create a minimal valid SceneGraphDelta for testing
function createSceneGraphDelta(
  objects: Array<ApiObject>,
  newObjectIds: number[] = []
): SceneGraphDelta {
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
      errors: [],
      variables: {},
      operations: [],
      artifactGraph: { map: {}, itemCount: 0 },
      filenames: {},
      defaultPlanes: null,
    },
  }
}

// Helper to create a Point ApiObject
function createPointApiObject({
  id,
  x = 0,
  y = 0,
}: {
  id: number
  x?: number
  y?: number
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
        owner: null,
        freedom: 'Free',
        constraints: [],
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

// Helper to create an Arc ApiObject
function createArcApiObject({
  id,
  center,
  start,
  end,
  startX = 0,
  startY = 0,
}: {
  id: number
  center: number
  start: number
  end: number
  startX?: number
  startY?: number
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
            x: { type: 'Var', value: startX, units: 'Mm' },
            y: { type: 'Var', value: startY, units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          ccw: true,
        },
        ctor_applicable: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

describe('centerArcToolImpl', () => {
  describe('projectPointOntoArcRadius', () => {
    it('should project a point onto the circle defined by center and start', () => {
      const center: [number, number] = [0, 0]
      const start: [number, number] = [10, 0] // radius = 10
      const end: [number, number] = [20, 0] // further out

      const result = projectPointOntoArcRadius({ center, start, end })

      // Should normalize to radius 10, preserving direction
      expect(result[0]).toBeCloseTo(10, 5)
      expect(result[1]).toBeCloseTo(0, 5)
    })

    it('should preserve radius when end point is at different angle', () => {
      const center: [number, number] = [0, 0]
      const start: [number, number] = [10, 0] // radius = 10, angle = 0
      const end: [number, number] = [0, 20] // angle = 90 degrees

      const result = projectPointOntoArcRadius({ center, start, end })

      // Should be at radius 10, angle 90 degrees
      expect(result[0]).toBeCloseTo(0, 5)
      expect(result[1]).toBeCloseTo(10, 5)

      // Verify radius is preserved
      const radius = Math.sqrt(result[0] ** 2 + result[1] ** 2)
      expect(radius).toBeCloseTo(10, 5)
    })

    it('should handle end point closer than start radius', () => {
      const center: [number, number] = [0, 0]
      const start: [number, number] = [10, 0] // radius = 10
      const end: [number, number] = [5, 0] // closer in

      const result = projectPointOntoArcRadius({ center, start, end })

      // Should normalize to radius 10
      expect(result[0]).toBeCloseTo(10, 5)
      expect(result[1]).toBeCloseTo(0, 5)
    })

    it('should handle degenerate radius (start at center)', () => {
      const center: [number, number] = [0, 0]
      const start: [number, number] = [0, 0] // degenerate
      const end: [number, number] = [10, 20]

      const result = projectPointOntoArcRadius({ center, start, end })

      // Should return raw end point when radius is degenerate
      expect(result[0]).toBe(10)
      expect(result[1]).toBe(20)
    })

    it('should handle mouse at center (end at center)', () => {
      const center: [number, number] = [0, 0]
      const start: [number, number] = [10, 0] // radius = 10, angle = 0
      const end: [number, number] = [0, 0] // at center

      const result = projectPointOntoArcRadius({ center, start, end })

      // Should preserve angle from start
      expect(result[0]).toBeCloseTo(10, 5)
      expect(result[1]).toBeCloseTo(0, 5)
    })

    it('should handle arbitrary angles correctly', () => {
      const center: [number, number] = [5, 5]
      const start: [number, number] = [15, 5] // radius = 10, angle = 0
      const end: [number, number] = [5, 15] // angle = 90 degrees

      const result = projectPointOntoArcRadius({ center, start, end })

      // Should be at radius 10 from center, angle 90 degrees
      expect(result[0]).toBeCloseTo(5, 5)
      expect(result[1]).toBeCloseTo(15, 5)

      // Verify radius is preserved
      const dx = result[0] - center[0]
      const dy = result[1] - center[1]
      const radius = Math.sqrt(dx ** 2 + dy ** 2)
      expect(radius).toBeCloseTo(10, 5)
    })
  })

  describe('storeCreatedArcResult', () => {
    it('should extract arc ID, end point ID, and start point from scene graph', () => {
      const centerPoint = createPointApiObject({ id: 1, x: 0, y: 0 })
      const startPoint = createPointApiObject({ id: 2, x: 10, y: 20 })
      const endPoint = createPointApiObject({ id: 3, x: 0, y: 0 })
      const arcObj = createArcApiObject({
        id: 4,
        center: 1,
        start: 2,
        end: 3,
        startX: 10,
        startY: 20,
      })

      const sceneGraphDelta = createSceneGraphDelta(
        [centerPoint, startPoint, endPoint, arcObj],
        [1, 2, 3, 4]
      )

      const event = {
        output: {
          kclSource: { text: 'test' } as SourceDelta,
          sceneGraphDelta,
        },
      } as DoneActorEvent<{
        kclSource?: SourceDelta
        sceneGraphDelta?: SceneGraphDelta
        error?: string
      }>

      const mockSelf = {
        _parent: {
          send: vi.fn(),
        },
      }

      const result = storeCreatedArcResult({
        event,
        self: mockSelf as any,
      } as any)

      expect(result.arcId).toBe(4)
      expect(result.arcEndPointId).toBe(3)
      expect(result.arcStartPoint).toEqual([10, 20])
      expect(result.sceneGraphDelta).toBe(sceneGraphDelta)

      // Verify draft entities were set
      expect(mockSelf._parent.send).toHaveBeenCalledWith({
        type: 'set draft entities',
        data: {
          segmentIds: [4, 1, 2, 3], // arc ID + all point IDs
          constraintIds: [],
        },
      })
    })

    it('should return empty object if output has error', () => {
      const event = {
        output: {
          error: 'test error',
        },
      } as DoneActorEvent<{
        kclSource?: SourceDelta
        sceneGraphDelta?: SceneGraphDelta
        error?: string
      }>

      const result = storeCreatedArcResult({ event } as any)

      expect(result).toEqual({})
    })

    it('should return empty object if no output', () => {
      const event = {} as DoneActorEvent<{
        kclSource?: SourceDelta
        sceneGraphDelta?: SceneGraphDelta
        error?: string
      }>

      const result = storeCreatedArcResult({ event } as any)

      expect(result).toEqual({})
    })
  })

  describe('sendResultToParent', () => {
    it('should extract IDs from scene graph and return context updates', () => {
      const centerPoint = createPointApiObject({ id: 1, x: 0, y: 0 })
      const startPoint = createPointApiObject({ id: 2, x: 0, y: 0 })
      const endPoint = createPointApiObject({ id: 3, x: 0, y: 0 })
      const arcObj = createArcApiObject({
        id: 4,
        center: 1,
        start: 2,
        end: 3,
      })

      const sceneGraphDelta = createSceneGraphDelta(
        [centerPoint, startPoint, endPoint, arcObj],
        [1, 2, 3, 4]
      )

      const mockSelf = {
        _parent: {
          send: vi.fn(),
        },
      }

      const event = {
        output: {
          kclSource: { text: 'test' } as SourceDelta,
          sceneGraphDelta,
        },
      } as DoneActorEvent<{
        kclSource?: SourceDelta
        sceneGraphDelta?: SceneGraphDelta
        error?: string
      }>

      const context = {
        sceneGraphDelta: {} as SceneGraphDelta,
      }

      const result = sendResultToParent({
        event,
        self: mockSelf as any,
        context: context as any,
      } as any)

      expect(mockSelf._parent.send).toHaveBeenCalledWith({
        type: 'update sketch outcome',
        data: {
          kclSource: { text: 'test' },
          sceneGraphDelta,
        },
      })

      expect(result.centerPointId).toBe(1)
      expect(result.arcId).toBe(4)
      expect(result.arcEndPointId).toBe(3)
      expect(result.sceneGraphDelta).toBe(sceneGraphDelta)
    })

    it('should return empty object if output has error', () => {
      const event = {
        output: {
          error: 'test error',
        },
      } as DoneActorEvent<{
        kclSource?: SourceDelta
        sceneGraphDelta?: SceneGraphDelta
        error?: string
      }>

      const result = sendResultToParent({
        event,
        self: {} as any,
        context: {} as any,
      } as any)

      expect(result).toEqual({})
    })

    it('should return empty object if no output', () => {
      const event = {} as DoneActorEvent<{
        kclSource?: SourceDelta
        sceneGraphDelta?: SceneGraphDelta
        error?: string
      }>

      const result = sendResultToParent({
        event,
        self: {} as any,
        context: {} as any,
      } as any)

      expect(result).toEqual({})
    })
  })
})

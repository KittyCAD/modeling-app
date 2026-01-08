import { describe, it, expect } from 'vitest'

import {
  deriveSegmentFreedom,
  getSegmentColor,
} from '@src/machines/sketchSolve/segmentsUtils'
import type { ApiObject, Freedom } from '@rust/kcl-lib/bindings/FrontendApi'
import { SKETCH_SELECTION_COLOR } from '@src/lib/constants'

// Helper to create a point object
function createPointObject(id: number, freedom: Freedom): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Point',
        position: {
          x: { value: 0, units: 'Mm' },
          y: { value: 0, units: 'Mm' },
        },
        ctor: null,
        owner: null,
        freedom,
        constraints: [],
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

// Helper to create a line segment object
function createLineSegmentObject(
  id: number,
  startId: number,
  endId: number
): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Line',
        start: startId,
        end: endId,
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
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

// Helper to create an arc segment object
function createArcSegmentObject(
  id: number,
  startId: number,
  endId: number,
  centerId: number
): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Arc',
        start: startId,
        end: endId,
        center: centerId,
        ctor: {
          type: 'Arc',
          start: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          center: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
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

// Helper to create a circle segment object
function createCircleSegmentObject(id: number, startId: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Circle',
        start: startId,
        radius: { value: 1, units: 'Mm' },
        ctor: {
          type: 'Circle',
          center: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          radius: { type: 'Var', value: 1, units: 'Mm' },
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

describe('deriveSegmentFreedom', () => {
  it('should return null for non-segment objects', () => {
    const nonSegment: ApiObject = {
      id: 1,
      kind: {
        type: 'Sketch',
        args: { on: { default: 'xy' } },
        segments: [],
        constraints: [],
      },
      label: '',
      comments: '',
      artifact_id: '0',
      source: { type: 'Simple', range: [0, 0, 0] },
    }

    expect(deriveSegmentFreedom(nonSegment, [])).toBeNull()
  })

  it('should return freedom directly for Point segments', () => {
    const point = createPointObject(1, 'Fixed')
    expect(deriveSegmentFreedom(point, [])).toBe('Fixed')

    const freePoint = createPointObject(2, 'Free')
    expect(deriveSegmentFreedom(freePoint, [])).toBe('Free')

    const conflictPoint = createPointObject(3, 'Conflict')
    expect(deriveSegmentFreedom(conflictPoint, [])).toBe('Conflict')
  })

  it('should return null for Point segments with null freedom', () => {
    const point: ApiObject = {
      id: 1,
      kind: {
        type: 'Segment',
        segment: {
          type: 'Point',
          position: {
            x: { value: 0, units: 'Mm' },
            y: { value: 0, units: 'Mm' },
          },
          ctor: null,
          owner: null,
          freedom: null as any,
          constraints: [],
        },
      },
      label: '',
      comments: '',
      artifact_id: '0',
      source: { type: 'Simple', range: [0, 0, 0] },
    }
    expect(deriveSegmentFreedom(point, [])).toBeNull()
  })

  describe('Line segments', () => {
    it('should return Fixed when both points are Fixed', () => {
      const startPoint = createPointObject(1, 'Fixed')
      const endPoint = createPointObject(2, 'Fixed')
      const line = createLineSegmentObject(3, 1, 2)
      const objects = [startPoint, endPoint, line]

      expect(deriveSegmentFreedom(line, objects)).toBe('Fixed')
    })

    it('should return Free when one point is Free', () => {
      const startPoint = createPointObject(1, 'Fixed')
      const endPoint = createPointObject(2, 'Free')
      const line = createLineSegmentObject(3, 1, 2)
      const objects = [startPoint, endPoint, line]

      expect(deriveSegmentFreedom(line, objects)).toBe('Free')
    })

    it('should return Conflict when one point is Conflict', () => {
      const startPoint = createPointObject(1, 'Fixed')
      const endPoint = createPointObject(2, 'Conflict')
      const line = createLineSegmentObject(3, 1, 2)
      const objects = [startPoint, endPoint, line]

      expect(deriveSegmentFreedom(line, objects)).toBe('Conflict')
    })

    it('should return Conflict when both points are Conflict', () => {
      const startPoint = createPointObject(1, 'Conflict')
      const endPoint = createPointObject(2, 'Conflict')
      const line = createLineSegmentObject(3, 1, 2)
      const objects = [startPoint, endPoint, line]

      expect(deriveSegmentFreedom(line, objects)).toBe('Conflict')
    })

    it('should return Conflict when one point is Conflict and one is Free', () => {
      const startPoint = createPointObject(1, 'Conflict')
      const endPoint = createPointObject(2, 'Free')
      const line = createLineSegmentObject(3, 1, 2)
      const objects = [startPoint, endPoint, line]

      expect(deriveSegmentFreedom(line, objects)).toBe('Conflict')
    })

    it('should return null when points are missing', () => {
      const line = createLineSegmentObject(3, 1, 2)
      const objects = [line] // No point objects

      expect(deriveSegmentFreedom(line, objects)).toBeNull()
    })

    it('should filter out null freedoms and use valid ones', () => {
      const startPoint: ApiObject = {
        id: 1,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Point',
            position: {
              x: { value: 0, units: 'Mm' },
              y: { value: 0, units: 'Mm' },
            },
            ctor: null,
            owner: null,
            freedom: null as any,
            constraints: [],
          },
        },
        label: '',
        comments: '',
        artifact_id: '0',
        source: { type: 'Simple', range: [0, 0, 0] },
      }
      const endPoint = createPointObject(2, 'Fixed')
      const line = createLineSegmentObject(3, 1, 2)
      const objects = [startPoint, endPoint, line]

      // When one point has null freedom, it's filtered out and only the valid one is used
      expect(deriveSegmentFreedom(line, objects)).toBe('Fixed')
    })

    it('should return null when all points have null freedom', () => {
      const startPoint: ApiObject = {
        id: 1,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Point',
            position: {
              x: { value: 0, units: 'Mm' },
              y: { value: 0, units: 'Mm' },
            },
            ctor: null,
            owner: null,
            freedom: null as any,
            constraints: [],
          },
        },
        label: '',
        comments: '',
        artifact_id: '0',
        source: { type: 'Simple', range: [0, 0, 0] },
      }
      const endPoint: ApiObject = {
        id: 2,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Point',
            position: {
              x: { value: 0, units: 'Mm' },
              y: { value: 0, units: 'Mm' },
            },
            ctor: null,
            owner: null,
            freedom: null as any,
            constraints: [],
          },
        },
        label: '',
        comments: '',
        artifact_id: '0',
        source: { type: 'Simple', range: [0, 0, 0] },
      }
      const line = createLineSegmentObject(3, 1, 2)
      const objects = [startPoint, endPoint, line]

      expect(deriveSegmentFreedom(line, objects)).toBeNull()
    })
  })

  describe('Arc segments', () => {
    it('should return Fixed when all three points are Fixed', () => {
      const startPoint = createPointObject(1, 'Fixed')
      const endPoint = createPointObject(2, 'Fixed')
      const centerPoint = createPointObject(3, 'Fixed')
      const arc = createArcSegmentObject(4, 1, 2, 3)
      const objects = [startPoint, endPoint, centerPoint, arc]

      expect(deriveSegmentFreedom(arc, objects)).toBe('Fixed')
    })

    it('should return Free when one point is Free', () => {
      const startPoint = createPointObject(1, 'Fixed')
      const endPoint = createPointObject(2, 'Fixed')
      const centerPoint = createPointObject(3, 'Free')
      const arc = createArcSegmentObject(4, 1, 2, 3)
      const objects = [startPoint, endPoint, centerPoint, arc]

      expect(deriveSegmentFreedom(arc, objects)).toBe('Free')
    })

    it('should return Conflict when one point is Conflict', () => {
      const startPoint = createPointObject(1, 'Fixed')
      const endPoint = createPointObject(2, 'Fixed')
      const centerPoint = createPointObject(3, 'Conflict')
      const arc = createArcSegmentObject(4, 1, 2, 3)
      const objects = [startPoint, endPoint, centerPoint, arc]

      expect(deriveSegmentFreedom(arc, objects)).toBe('Conflict')
    })

    it('should return Conflict when multiple points have different freedoms', () => {
      const startPoint = createPointObject(1, 'Conflict')
      const endPoint = createPointObject(2, 'Free')
      const centerPoint = createPointObject(3, 'Fixed')
      const arc = createArcSegmentObject(4, 1, 2, 3)
      const objects = [startPoint, endPoint, centerPoint, arc]

      expect(deriveSegmentFreedom(arc, objects)).toBe('Conflict')
    })

    it('should handle missing points', () => {
      const startPoint = createPointObject(1, 'Fixed')
      const arc = createArcSegmentObject(4, 1, 2, 3)
      const objects = [startPoint, arc] // Missing end and center

      expect(deriveSegmentFreedom(arc, objects)).toBeNull()
    })
  })

  describe('Circle segments', () => {
    it('should return Fixed when center point is Fixed', () => {
      const centerPoint = createPointObject(1, 'Fixed')
      const circle = createCircleSegmentObject(2, 1)
      const objects = [centerPoint, circle]

      expect(deriveSegmentFreedom(circle, objects)).toBe('Fixed')
    })

    it('should return Free when center point is Free', () => {
      const centerPoint = createPointObject(1, 'Free')
      const circle = createCircleSegmentObject(2, 1)
      const objects = [centerPoint, circle]

      expect(deriveSegmentFreedom(circle, objects)).toBe('Free')
    })

    it('should return Conflict when center point is Conflict', () => {
      const centerPoint = createPointObject(1, 'Conflict')
      const circle = createCircleSegmentObject(2, 1)
      const objects = [centerPoint, circle]

      expect(deriveSegmentFreedom(circle, objects)).toBe('Conflict')
    })
  })
})

describe('getSegmentColor', () => {
  const UNCONSTRAINED_COLOR = parseInt('#3c73ff'.replace('#', ''), 16) // Brand blue
  const CONFLICT_COLOR = 0xff5e5b // Coral red
  const TEXT_COLOR = 0xffffff // White
  const DRAFT_COLOR = 0x888888 // Grey

  it('should return draft color when isDraft is true (highest priority)', () => {
    const color = getSegmentColor({
      isDraft: true,
      isHovered: true,
      isSelected: true,
      freedom: 'Conflict',
    })

    expect(color).toBe(DRAFT_COLOR)
  })

  it('should return hover color when isHovered is true (priority 2)', () => {
    const color = getSegmentColor({
      isDraft: false,
      isHovered: true,
      isSelected: true,
      freedom: 'Conflict',
    })

    // Hover color is calculated from SKETCH_SELECTION_RGB at 70% brightness
    // We can't easily test the exact value without importing SKETCH_SELECTION_RGB,
    // but we can verify it's not any of the other colors
    expect(color).not.toBe(DRAFT_COLOR)
    expect(color).not.toBe(SKETCH_SELECTION_COLOR)
    expect(color).not.toBe(CONFLICT_COLOR)
    expect(color).not.toBe(TEXT_COLOR)
    expect(color).not.toBe(UNCONSTRAINED_COLOR)
  })

  it('should return selection color when isSelected is true (priority 3)', () => {
    const color = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: true,
      freedom: 'Conflict',
    })

    expect(color).toBe(SKETCH_SELECTION_COLOR)
  })

  it('should return conflict color when freedom is Conflict (priority 4)', () => {
    const color = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: false,
      freedom: 'Conflict',
    })

    expect(color).toBe(CONFLICT_COLOR)
  })

  it('should return unconstrained color when freedom is Free (priority 5)', () => {
    const color = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: false,
      freedom: 'Free',
    })

    expect(color).toBe(UNCONSTRAINED_COLOR)
  })

  it('should return constrained color when freedom is Fixed (priority 6)', () => {
    const color = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: false,
      freedom: 'Fixed',
    })

    expect(color).toBe(TEXT_COLOR)
  })

  it('should return unconstrained color when freedom is null (default)', () => {
    const color = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: false,
      freedom: null,
    })

    expect(color).toBe(UNCONSTRAINED_COLOR)
  })

  it('should return unconstrained color when freedom is undefined (default)', () => {
    const color = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: false,
    })

    expect(color).toBe(UNCONSTRAINED_COLOR)
  })

  it('should prioritize draft over all other states', () => {
    const color1 = getSegmentColor({
      isDraft: true,
      isHovered: true,
      isSelected: false,
      freedom: 'Fixed',
    })

    const color2 = getSegmentColor({
      isDraft: true,
      isHovered: false,
      isSelected: true,
      freedom: 'Conflict',
    })

    expect(color1).toBe(DRAFT_COLOR)
    expect(color2).toBe(DRAFT_COLOR)
  })

  it('should prioritize hover over selection and freedom', () => {
    const hoverColor = getSegmentColor({
      isDraft: false,
      isHovered: true,
      isSelected: true,
      freedom: 'Fixed',
    })

    const selectionColor = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: true,
      freedom: 'Fixed',
    })

    expect(hoverColor).not.toBe(selectionColor)
    expect(hoverColor).not.toBe(TEXT_COLOR)
  })

  it('should prioritize selection over freedom', () => {
    const selectedColor = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: true,
      freedom: 'Free',
    })

    const unselectedColor = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: false,
      freedom: 'Free',
    })

    expect(selectedColor).toBe(SKETCH_SELECTION_COLOR)
    expect(unselectedColor).toBe(UNCONSTRAINED_COLOR)
  })

  it('should prioritize conflict over free and fixed', () => {
    const conflictColor = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: false,
      freedom: 'Conflict',
    })

    const freeColor = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: false,
      freedom: 'Free',
    })

    const fixedColor = getSegmentColor({
      isDraft: false,
      isHovered: false,
      isSelected: false,
      freedom: 'Fixed',
    })

    expect(conflictColor).toBe(CONFLICT_COLOR)
    expect(freeColor).toBe(UNCONSTRAINED_COLOR)
    expect(fixedColor).toBe(TEXT_COLOR)
  })
})

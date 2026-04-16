import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'

export const constraintToolNames = [
  'coincidentConstraintTool',
  'tangentConstraintTool',
  'parallelConstraintTool',
  'equalLengthConstraintTool',
  'horizontalConstraintTool',
  'verticalConstraintTool',
  'perpendicularConstraintTool',
  'fixedConstraintTool',
] satisfies readonly ConstraintToolName[]

export type ConstraintToolName =
  | 'coincidentConstraintTool'
  | 'tangentConstraintTool'
  | 'parallelConstraintTool'
  | 'equalLengthConstraintTool'
  | 'horizontalConstraintTool'
  | 'verticalConstraintTool'
  | 'perpendicularConstraintTool'
  | 'fixedConstraintTool'

export const constraintToolbarActionEventTypes = [
  'coincident',
  'Tangent',
  'Parallel',
  'EqualLength',
  'Horizontal',
  'Vertical',
  'Perpendicular',
  'Fixed',
] satisfies readonly ConstraintToolbarActionEventType[]

export type ConstraintToolbarActionEventType =
  | 'coincident'
  | 'Tangent'
  | 'Parallel'
  | 'EqualLength'
  | 'Horizontal'
  | 'Vertical'
  | 'Perpendicular'
  | 'Fixed'

export const constraintToolbarActionToToolName = {
  coincident: 'coincidentConstraintTool',
  Tangent: 'tangentConstraintTool',
  Parallel: 'parallelConstraintTool',
  EqualLength: 'equalLengthConstraintTool',
  Horizontal: 'horizontalConstraintTool',
  Vertical: 'verticalConstraintTool',
  Perpendicular: 'perpendicularConstraintTool',
  Fixed: 'fixedConstraintTool',
} satisfies Record<ConstraintToolbarActionEventType, ConstraintToolName>

export type ConstraintSelectionKind =
  | 'point'
  | 'origin'
  | 'line'
  | 'arc'
  | 'circle'
  | 'constraint'
  | 'dimension'
  | 'other'

export type ConstraintSelectionMatcher =
  | ConstraintSelectionKind
  | 'pointLike'
  | 'arcLike'

export type ConstraintToolAreaSelectionPolicy =
  | 'consume-minimal'
  | 'consume-all-compatible'

export type ConstraintToolSelectionMode = {
  id: string
  resultingConstraintType: ApiConstraint['type']
  slots: readonly (readonly ConstraintSelectionMatcher[])[]
  repeatableLastSlot?: boolean
  areaSelectionPolicy: ConstraintToolAreaSelectionPolicy
}

export type ConstraintToolConfig = {
  toolName: ConstraintToolName
  keepEquippedAfterApply: true
  modes: readonly ConstraintToolSelectionMode[]
}

export type ClassifiedConstraintSelection = {
  selectionId: SketchSolveSelectionId
  kind: ConstraintSelectionKind
  object?: ApiObject
}

export type ConstraintToolSelectionStatus =
  | 'empty'
  | 'invalid'
  | 'partial'
  | 'complete'

export type ConstraintToolSelectionMatch = {
  mode: ConstraintToolSelectionMode
  status: ConstraintToolSelectionStatus
  matchedSelectionCount: number
}

type ConstraintToolSelectionMatchesResult = {
  config: ConstraintToolConfig
  classifiedSelections: ClassifiedConstraintSelection[]
  matches: ConstraintToolSelectionMatch[]
  bestMatch: ConstraintToolSelectionMatch | null
  status: ConstraintToolSelectionStatus
}

export const constraintToolConfigs = {
  coincidentConstraintTool: {
    toolName: 'coincidentConstraintTool',
    keepEquippedAfterApply: true,
    modes: [
      {
        id: 'point-point',
        resultingConstraintType: 'Coincident',
        slots: [['point'], ['point']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'point-line',
        resultingConstraintType: 'Coincident',
        slots: [['point'], ['line']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'line-point',
        resultingConstraintType: 'Coincident',
        slots: [['line'], ['point']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'point-arc',
        resultingConstraintType: 'Coincident',
        slots: [['point'], ['arc']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'arc-point',
        resultingConstraintType: 'Coincident',
        slots: [['arc'], ['point']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'point-circle',
        resultingConstraintType: 'Coincident',
        slots: [['point'], ['circle']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'circle-point',
        resultingConstraintType: 'Coincident',
        slots: [['circle'], ['point']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'line-line',
        resultingConstraintType: 'Coincident',
        slots: [['line'], ['line']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'point-origin',
        resultingConstraintType: 'Coincident',
        slots: [['point'], ['origin']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'origin-point',
        resultingConstraintType: 'Coincident',
        slots: [['origin'], ['point']],
        areaSelectionPolicy: 'consume-minimal',
      },
    ],
  },
  tangentConstraintTool: {
    toolName: 'tangentConstraintTool',
    keepEquippedAfterApply: true,
    modes: [
      {
        id: 'line-arcLike',
        resultingConstraintType: 'Tangent',
        slots: [['line'], ['arcLike']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'arcLike-line',
        resultingConstraintType: 'Tangent',
        slots: [['arcLike'], ['line']],
        areaSelectionPolicy: 'consume-minimal',
      },
      {
        id: 'arcLike-arcLike',
        resultingConstraintType: 'Tangent',
        slots: [['arcLike'], ['arcLike']],
        areaSelectionPolicy: 'consume-minimal',
      },
    ],
  },
  parallelConstraintTool: {
    toolName: 'parallelConstraintTool',
    keepEquippedAfterApply: true,
    modes: [
      {
        id: 'line-line',
        resultingConstraintType: 'Parallel',
        slots: [['line'], ['line']],
        areaSelectionPolicy: 'consume-minimal',
      },
    ],
  },
  equalLengthConstraintTool: {
    toolName: 'equalLengthConstraintTool',
    keepEquippedAfterApply: true,
    modes: [
      {
        id: 'line-set',
        resultingConstraintType: 'LinesEqualLength',
        slots: [['line'], ['line']],
        repeatableLastSlot: true,
        areaSelectionPolicy: 'consume-all-compatible',
      },
      {
        id: 'arcLike-set',
        resultingConstraintType: 'EqualRadius',
        slots: [['arcLike'], ['arcLike']],
        repeatableLastSlot: true,
        areaSelectionPolicy: 'consume-all-compatible',
      },
    ],
  },
  horizontalConstraintTool: {
    toolName: 'horizontalConstraintTool',
    keepEquippedAfterApply: true,
    modes: [
      {
        id: 'single-line',
        resultingConstraintType: 'Horizontal',
        slots: [['line']],
        repeatableLastSlot: true,
        areaSelectionPolicy: 'consume-all-compatible',
      },
      {
        id: 'point-pair',
        resultingConstraintType: 'VerticalDistance',
        slots: [['pointLike'], ['pointLike']],
        areaSelectionPolicy: 'consume-minimal',
      },
    ],
  },
  verticalConstraintTool: {
    toolName: 'verticalConstraintTool',
    keepEquippedAfterApply: true,
    modes: [
      {
        id: 'single-line',
        resultingConstraintType: 'Vertical',
        slots: [['line']],
        repeatableLastSlot: true,
        areaSelectionPolicy: 'consume-all-compatible',
      },
      {
        id: 'point-pair',
        resultingConstraintType: 'HorizontalDistance',
        slots: [['pointLike'], ['pointLike']],
        areaSelectionPolicy: 'consume-minimal',
      },
    ],
  },
  perpendicularConstraintTool: {
    toolName: 'perpendicularConstraintTool',
    keepEquippedAfterApply: true,
    modes: [
      {
        id: 'line-line',
        resultingConstraintType: 'Perpendicular',
        slots: [['line'], ['line']],
        areaSelectionPolicy: 'consume-minimal',
      },
    ],
  },
  fixedConstraintTool: {
    toolName: 'fixedConstraintTool',
    keepEquippedAfterApply: true,
    modes: [
      {
        id: 'single-point',
        resultingConstraintType: 'Fixed',
        slots: [['point']],
        areaSelectionPolicy: 'consume-minimal',
      },
    ],
  },
} satisfies Record<ConstraintToolName, ConstraintToolConfig>

const DIMENSION_CONSTRAINT_TYPES = new Set<ApiConstraint['type']>([
  'Distance',
  'HorizontalDistance',
  'VerticalDistance',
  'Radius',
  'Diameter',
  'Angle',
])

export function selectionMatcherMatchesKind(
  matcher: ConstraintSelectionMatcher,
  kind: ConstraintSelectionKind
) {
  if (matcher === 'pointLike') {
    return kind === 'point' || kind === 'origin'
  }

  if (matcher === 'arcLike') {
    return kind === 'arc' || kind === 'circle'
  }

  return matcher === kind
}

function getModeSelectionStatus(
  mode: ConstraintToolSelectionMode,
  selections: readonly ClassifiedConstraintSelection[]
): ConstraintToolSelectionMatch {
  if (selections.length === 0) {
    return {
      mode,
      status: 'empty',
      matchedSelectionCount: 0,
    }
  }

  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index]
    const slot =
      mode.slots[index] ??
      (mode.repeatableLastSlot ? mode.slots.at(-1) : undefined)

    if (
      selection === undefined ||
      slot === undefined ||
      !slot.some((matcher) =>
        selectionMatcherMatchesKind(matcher, selection.kind)
      )
    ) {
      return {
        mode,
        status: 'invalid',
        matchedSelectionCount: index,
      }
    }
  }

  if (selections.length < mode.slots.length) {
    return {
      mode,
      status: 'partial',
      matchedSelectionCount: selections.length,
    }
  }

  return {
    mode,
    status: 'complete',
    matchedSelectionCount: selections.length,
  }
}

function getSelectionMatchersForMode(
  mode: ConstraintToolSelectionMode
): ConstraintSelectionMatcher[] {
  const matchers = mode.repeatableLastSlot
    ? [...mode.slots.flat()]
    : mode.slots.flat()

  return [...new Set(matchers)]
}

function expandSelectionMatcher(
  matcher: ConstraintSelectionMatcher
): ConstraintSelectionKind[] {
  if (matcher === 'pointLike') {
    return ['point', 'origin']
  }

  if (matcher === 'arcLike') {
    return ['arc', 'circle']
  }

  return [matcher]
}

export function getConstraintToolConfig(toolName: ConstraintToolName) {
  return constraintToolConfigs[toolName]
}

export function classifyConstraintSelection(
  selectionId: SketchSolveSelectionId,
  objects: readonly ApiObject[]
): ClassifiedConstraintSelection {
  if (selectionId === ORIGIN_TARGET) {
    return {
      selectionId,
      kind: 'origin',
    }
  }

  const object = objects[selectionId]
  if (!object) {
    return {
      selectionId,
      kind: 'other',
    }
  }

  if (object.kind.type === 'Segment') {
    switch (object.kind.segment.type) {
      case 'Point':
        return { selectionId, kind: 'point', object }
      case 'Line':
        return { selectionId, kind: 'line', object }
      case 'Arc':
        return { selectionId, kind: 'arc', object }
      case 'Circle':
        return { selectionId, kind: 'circle', object }
    }
  }

  if (object.kind.type === 'Constraint') {
    return {
      selectionId,
      kind: DIMENSION_CONSTRAINT_TYPES.has(object.kind.constraint.type)
        ? 'dimension'
        : 'constraint',
      object,
    }
  }

  return {
    selectionId,
    kind: 'other',
    object,
  }
}

export function getConstraintToolSelectionMatches(
  toolName: ConstraintToolName,
  selectionIds: readonly SketchSolveSelectionId[],
  objects: readonly ApiObject[]
): ConstraintToolSelectionMatchesResult {
  const config = getConstraintToolConfig(toolName)
  const classifiedSelections = selectionIds.map((selectionId) =>
    classifyConstraintSelection(selectionId, objects)
  )
  const matches = config.modes.map((mode) =>
    getModeSelectionStatus(mode, classifiedSelections)
  )
  const bestMatch =
    matches.find((match) => match.status === 'complete') ??
    matches.find((match) => match.status === 'partial') ??
    matches.find((match) => match.status === 'empty') ??
    null

  return {
    config,
    classifiedSelections,
    matches,
    bestMatch,
    status: bestMatch?.status ?? 'invalid',
  }
}

export function getConstraintToolPermittedSelectionKinds(
  toolName: ConstraintToolName
) {
  const config = getConstraintToolConfig(toolName)
  const kinds = config.modes.flatMap((mode) =>
    getSelectionMatchersForMode(mode).flatMap(expandSelectionMatcher)
  )

  return [...new Set(kinds)]
}

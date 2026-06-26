import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  buildEqualLengthConstraintInput,
  buildFixedConstraintInput,
  buildSymmetricConstraintInput,
  buildSymmetricConstraintInputWithExplicitAxis,
  buildTangentConstraintInput,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import {
  type ConstraintToolName,
  type ConstraintToolSelectionMatch,
  classifyConstraintSelection,
  getConstraintToolConfig,
  getConstraintToolSelectionMatches,
  selectionMatcherMatchesKind,
} from '@src/machines/sketchSolve/tools/constraintToolModel'
import type { ConstraintSegment } from '@src/machines/sketchSolve/types'

type HorizontalVerticalPayload =
  | Extract<ApiConstraint, { type: 'Horizontal' }>
  | Extract<ApiConstraint, { type: 'Vertical' }>

export type ConstraintToolPayload =
  | Extract<ApiConstraint, { type: 'Coincident' }>
  | Extract<ApiConstraint, { type: 'Symmetric' }>
  | Extract<ApiConstraint, { type: 'Midpoint' }>
  | Extract<ApiConstraint, { type: 'Tangent' }>
  | Extract<ApiConstraint, { type: 'Parallel' }>
  | Extract<ApiConstraint, { type: 'Perpendicular' }>
  | Extract<ApiConstraint, { type: 'LinesEqualLength' }>
  | Extract<ApiConstraint, { type: 'EqualRadius' }>
  | Extract<ApiConstraint, { type: 'Fixed' }>
  | HorizontalVerticalPayload

export type ConstraintToolPreparedApply = {
  toolName: ConstraintToolName
  mode: ConstraintToolSelectionMatch['mode']
  selectionIds: SketchSolveSelectionId[]
  resultingConstraintType: ApiConstraint['type']
  payloads: ConstraintToolPayload[]
  payload: ConstraintToolPayload
}

export type ConstraintToolSelectionAction =
  | {
      type: 'clear'
      nextSelectionIds: []
    }
  | {
      type: 'select'
      nextSelectionIds: SketchSolveSelectionId[]
      match: ConstraintToolSelectionMatch
    }
  | {
      type: 'apply'
      nextSelectionIds: []
      apply: ConstraintToolPreparedApply
    }

export type ConstraintToolClickAction = ConstraintToolSelectionAction

export type NormalizeConstraintToolSelectionResult = {
  selectionIds: SketchSolveSelectionId[]
  match: ConstraintToolSelectionMatch | null
  status: 'empty' | 'partial' | 'complete' | 'invalid'
}

function toConstraintSegments(
  selectionIds: readonly SketchSolveSelectionId[]
): ConstraintSegment[] {
  return selectionIds.map((selectionId) =>
    selectionId === ORIGIN_TARGET ? 'ORIGIN' : selectionId
  )
}

function isNumberSelection(
  selectionId: SketchSolveSelectionId
): selectionId is number {
  return typeof selectionId === 'number'
}

function uniqueSelectionIds(
  selectionIds: readonly SketchSolveSelectionId[]
): SketchSolveSelectionId[] {
  return Array.from(new Set(selectionIds))
}

function toPair<T>(values: readonly T[]): [T, T] | null {
  if (values.length !== 2) {
    return null
  }

  const [first, second] = values
  if (first === undefined || second === undefined) {
    return null
  }

  return [first, second]
}

function includesAllSelectionIds(
  selectionIds: readonly SketchSolveSelectionId[],
  requiredSelectionIds: readonly SketchSolveSelectionId[]
) {
  return requiredSelectionIds.every((selectionId) =>
    selectionIds.includes(selectionId)
  )
}

function getSelectionObjectIds(
  selectionIds: readonly SketchSolveSelectionId[]
) {
  return selectionIds.filter(isNumberSelection)
}

function buildExplicitSymmetricPreparedApply(
  currentSelectionIds: readonly SketchSolveSelectionId[],
  clickedSelectionId: SketchSolveSelectionId,
  objects: readonly ApiObject[]
): ConstraintToolPreparedApply | null {
  if (!isNumberSelection(clickedSelectionId)) {
    return null
  }

  const selectionIds = uniqueSelectionIds([
    ...currentSelectionIds,
    clickedSelectionId,
  ])
  const objectSelectionIds = getSelectionObjectIds(selectionIds)
  const payload = buildSymmetricConstraintInputWithExplicitAxis({
    selectedIds: objectSelectionIds,
    axisId: clickedSelectionId,
    objects: [...objects],
  })

  if (!payload) {
    return null
  }

  const selectionResult = getConstraintToolSelectionMatches(
    'symmetricConstraintTool',
    selectionIds,
    objects
  )
  const match = selectionResult.bestMatch
  if (!match) {
    return null
  }

  return {
    toolName: 'symmetricConstraintTool',
    mode: match.mode,
    selectionIds,
    resultingConstraintType: match.mode.resultingConstraintType,
    payloads: [payload],
    payload,
  }
}

function collectSelectionsForMode(
  match: ConstraintToolSelectionMatch,
  selectionIds: readonly SketchSolveSelectionId[],
  objects: readonly ApiObject[]
) {
  const classifiedSelections = selectionIds.map((selectionId) =>
    classifyConstraintSelection(selectionId, objects)
  )

  const matchedSelectionIds: SketchSolveSelectionId[] = []

  classifiedSelections.forEach((classifiedSelection) => {
    const slot =
      match.mode.slots[matchedSelectionIds.length] ??
      (match.mode.repeatableLastSlot ? match.mode.slots.at(-1) : undefined)

    if (
      classifiedSelection === undefined ||
      slot === undefined ||
      !slot.some((matcher) =>
        selectionMatcherMatchesKind(matcher, classifiedSelection.kind)
      )
    ) {
      return
    }

    matchedSelectionIds.push(classifiedSelection.selectionId)
  })

  return matchedSelectionIds
}

function chooseBetterNormalizedMatch(
  current: NormalizeConstraintToolSelectionResult,
  candidate: NormalizeConstraintToolSelectionResult
) {
  const rank = {
    invalid: -1,
    empty: 0,
    partial: 1,
    complete: 2,
  } satisfies Record<NormalizeConstraintToolSelectionResult['status'], number>

  const currentRank = rank[current.status]
  const candidateRank = rank[candidate.status]

  if (candidateRank !== currentRank) {
    return candidateRank > currentRank ? candidate : current
  }

  if (candidate.selectionIds.length !== current.selectionIds.length) {
    return candidate.selectionIds.length > current.selectionIds.length
      ? candidate
      : current
  }

  return current
}

function buildConstraintToolPayloads(
  toolName: ConstraintToolName,
  match: ConstraintToolSelectionMatch,
  selectionIds: readonly SketchSolveSelectionId[],
  objects: readonly ApiObject[]
): ConstraintToolPayload[] | null {
  const objectSelectionIds = getSelectionObjectIds(selectionIds)

  switch (toolName) {
    case 'coincidentConstraintTool':
      return [
        {
          type: 'Coincident',
          segments: toConstraintSegments(selectionIds),
        },
      ]
    case 'midpointConstraintTool': {
      const midpointPair = toPair(selectionIds)
      if (!midpointPair) {
        return null
      }

      const [firstId, secondId] = midpointPair
      const pointIsFirst =
        match.mode.id === 'point-line' ||
        match.mode.id === 'origin-line' ||
        match.mode.id === 'point-arc' ||
        match.mode.id === 'origin-arc'
      const point = pointIsFirst ? firstId : secondId
      const segment = pointIsFirst ? secondId : firstId
      if (!isNumberSelection(segment)) {
        return null
      }

      return [
        {
          type: 'Midpoint',
          point: point === ORIGIN_TARGET ? 'ORIGIN' : point,
          segment,
        },
      ]
    }
    case 'tangentConstraintTool': {
      const tangentInput = buildTangentConstraintInput(objectSelectionIds, [
        ...objects,
      ])
      if (!tangentInput || tangentInput.type !== 'Tangent') {
        return null
      }

      const tangentPair = toPair(tangentInput.input)
      if (!tangentPair) {
        return null
      }

      return [
        {
          type: 'Tangent',
          input: tangentPair,
        },
      ]
    }
    case 'symmetricConstraintTool': {
      const symmetricInput = buildSymmetricConstraintInput(objectSelectionIds, [
        ...objects,
      ])
      if (!symmetricInput) {
        return null
      }

      return [symmetricInput]
    }
    case 'parallelConstraintTool': {
      const [anchorLineId, ...otherLineIds] = objectSelectionIds
      if (anchorLineId === undefined || otherLineIds.length === 0) {
        return null
      }

      return otherLineIds.map((lineId) => ({
        type: 'Parallel',
        lines: [anchorLineId, lineId],
      }))
    }
    case 'equalLengthConstraintTool': {
      const equalLengthInput = buildEqualLengthConstraintInput(
        objectSelectionIds,
        [...objects]
      )
      if (!equalLengthInput) {
        return null
      }

      if (equalLengthInput.type === 'LinesEqualLength') {
        return [
          {
            type: 'LinesEqualLength',
            lines: equalLengthInput.lines,
          },
        ]
      }

      return [
        {
          type: 'EqualRadius',
          input: equalLengthInput.input,
        },
      ]
    }
    case 'horizontalConstraintTool':
      if (match.mode.id === 'single-line') {
        if (objectSelectionIds.length === 0) {
          return null
        }

        return objectSelectionIds.map((lineId) => ({
          type: 'Horizontal',
          line: lineId,
        }))
      }

      return [
        {
          type: 'Horizontal',
          points: toConstraintSegments(selectionIds),
        },
      ]
    case 'verticalConstraintTool':
      if (match.mode.id === 'single-line') {
        if (objectSelectionIds.length === 0) {
          return null
        }

        return objectSelectionIds.map((lineId) => ({
          type: 'Vertical',
          line: lineId,
        }))
      }

      return [
        {
          type: 'Vertical',
          points: toConstraintSegments(selectionIds),
        },
      ]
    case 'perpendicularConstraintTool': {
      const linePair = toPair(objectSelectionIds)
      if (!linePair) {
        return null
      }

      return [
        {
          type: 'Perpendicular',
          lines: linePair,
        },
      ]
    }
    case 'fixedConstraintTool': {
      const fixedPoints = buildFixedConstraintInput(objectSelectionIds, [
        ...objects,
      ])
      if (!fixedPoints) {
        return null
      }

      return [
        {
          type: 'Fixed',
          points: fixedPoints,
        },
      ]
    }
  }
}

export function normalizeConstraintToolSelection(
  toolName: ConstraintToolName,
  selectionIds: readonly SketchSolveSelectionId[],
  objects: readonly ApiObject[]
): NormalizeConstraintToolSelectionResult {
  const config = getConstraintToolConfig(toolName)
  const initial: NormalizeConstraintToolSelectionResult = {
    selectionIds: [],
    match: null,
    status: 'empty',
  }

  return config.modes.reduce((bestResult, mode) => {
    const syntheticMatch: ConstraintToolSelectionMatch = {
      mode,
      matchedSelectionCount: 0,
      status: 'empty',
    }
    const normalizedSelectionIds = collectSelectionsForMode(
      syntheticMatch,
      selectionIds,
      objects
    )
    const selectionResult = getConstraintToolSelectionMatches(
      toolName,
      normalizedSelectionIds,
      objects
    )
    const modeMatch =
      selectionResult.matches.find((match) => match.mode.id === mode.id) ?? null
    const candidate: NormalizeConstraintToolSelectionResult = {
      selectionIds: normalizedSelectionIds,
      match: modeMatch,
      status: modeMatch?.status ?? 'invalid',
    }

    return chooseBetterNormalizedMatch(bestResult, candidate)
  }, initial)
}

export function getConstraintToolPreparedApply(
  toolName: ConstraintToolName,
  selectionIds: readonly SketchSolveSelectionId[],
  objects: readonly ApiObject[]
): ConstraintToolPreparedApply | null {
  const selectionResult = getConstraintToolSelectionMatches(
    toolName,
    selectionIds,
    objects
  )
  const match = selectionResult.bestMatch
  if (selectionResult.status !== 'complete' || !match) {
    return null
  }

  const payloads = buildConstraintToolPayloads(
    toolName,
    match,
    selectionIds,
    objects
  )
  if (!payloads || payloads.length === 0) {
    return null
  }

  return {
    toolName,
    mode: match.mode,
    selectionIds: [...selectionIds],
    resultingConstraintType: match.mode.resultingConstraintType,
    payloads,
    payload: payloads[0],
  }
}

export function resolveConstraintToolClickAction(
  toolName: ConstraintToolName,
  currentSelectionIds: readonly SketchSolveSelectionId[],
  clickedSelectionId: SketchSolveSelectionId | null,
  objects: readonly ApiObject[]
): ConstraintToolClickAction {
  if (clickedSelectionId === null) {
    return {
      type: 'clear',
      nextSelectionIds: [],
    }
  }

  if (toolName === 'symmetricConstraintTool') {
    const explicitApply = buildExplicitSymmetricPreparedApply(
      currentSelectionIds,
      clickedSelectionId,
      objects
    )
    if (explicitApply) {
      return {
        type: 'apply',
        nextSelectionIds: [],
        apply: explicitApply,
      }
    }
  }

  return resolveConstraintToolSelectionAction(
    toolName,
    currentSelectionIds,
    [clickedSelectionId],
    objects
  )
}

export function resolveConstraintToolSelectionAction(
  toolName: ConstraintToolName,
  currentSelectionIds: readonly SketchSolveSelectionId[],
  candidateSelectionIds: readonly SketchSolveSelectionId[],
  objects: readonly ApiObject[]
): ConstraintToolSelectionAction {
  const uniqueCandidateSelectionIds = uniqueSelectionIds(candidateSelectionIds)
  if (uniqueCandidateSelectionIds.length === 0) {
    return {
      type: 'clear',
      nextSelectionIds: [],
    }
  }

  const uniqueCurrentSelectionIds = uniqueSelectionIds(currentSelectionIds)
  const combinedSelectionIds = uniqueSelectionIds([
    ...uniqueCurrentSelectionIds,
    ...uniqueCandidateSelectionIds,
  ])

  const normalizedCombinedSelection = normalizeConstraintToolSelection(
    toolName,
    combinedSelectionIds,
    objects
  )
  const normalizedCombinedSelectionIds =
    normalizedCombinedSelection.selectionIds
  const currentSelectionWasExtended =
    uniqueCurrentSelectionIds.length === 0
      ? normalizedCombinedSelectionIds.length > 0
      : normalizedCombinedSelectionIds.length > uniqueCurrentSelectionIds.length

  if (
    currentSelectionWasExtended &&
    includesAllSelectionIds(
      normalizedCombinedSelectionIds,
      uniqueCurrentSelectionIds
    )
  ) {
    if (toolName === 'symmetricConstraintTool') {
      if (
        (normalizedCombinedSelection.status === 'complete' ||
          normalizedCombinedSelection.status === 'partial') &&
        normalizedCombinedSelection.match
      ) {
        return {
          type: 'select',
          nextSelectionIds: normalizedCombinedSelectionIds,
          match: normalizedCombinedSelection.match,
        }
      }
    }

    const preparedApply = getConstraintToolPreparedApply(
      toolName,
      normalizedCombinedSelectionIds,
      objects
    )
    if (preparedApply) {
      return {
        type: 'apply',
        nextSelectionIds: [],
        apply: preparedApply,
      }
    }

    if (
      normalizedCombinedSelection.status === 'partial' &&
      normalizedCombinedSelection.match
    ) {
      return {
        type: 'select',
        nextSelectionIds: normalizedCombinedSelectionIds,
        match: normalizedCombinedSelection.match,
      }
    }
  }

  return {
    type: 'clear',
    nextSelectionIds: [],
  }
}

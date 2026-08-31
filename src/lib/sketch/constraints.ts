import type { IconName } from '@kittycad/ui-kit'
import type {
  ApiConstraint,
  ApiObject,
  ApiObjectId,
  ConstraintSegment,
  FixedPoint,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSelectionId } from '@src/contracts/sketchSession'
import { objectAt } from '@src/lib/sketch/sceneGraph'

/**
 * Which constraints a selection can take, and what they turn into.
 *
 * A port of `constraintToolModel.ts` and the payload half of
 * `constraintToolHelpers.ts`, and the thing worth preserving is that it is
 * *declarative*. A constraint tool is a list of modes; a mode is a list of slots;
 * a slot is a list of kinds it accepts. "Can I apply this to what I have
 * selected?" is then a pure function over the selection, which is what makes it
 * answerable in a disabled state on a button rather than discovered by clicking.
 *
 * Two ideas in the data are easy to miss. `repeatableLastSlot` is how a tool
 * takes any number of the same thing — parallel across five lines is one
 * constraint, not four. And a mode's slot *order* is the selection order, which
 * is why the selection is a list: midpoint of a point and a line is a different
 * request from midpoint of a line and a point, and only one of them is what the
 * user meant.
 */

export type ConstraintToolId =
  | 'coincident'
  | 'midpoint'
  | 'tangent'
  | 'parallel'
  | 'perpendicular'
  | 'equalLength'
  | 'symmetric'
  | 'vertical'
  | 'horizontal'
  | 'fixed'

/** What a selected thing is, as far as a constraint cares. */
export type SelectionKind =
  | 'point'
  | 'origin'
  | 'line'
  | 'arc'
  | 'circle'
  | 'constraint'
  | 'dimension'
  | 'other'

/** What a slot accepts. The two families are shorthands over several kinds. */
export type SelectionMatcher = SelectionKind | 'pointLike' | 'arcLike'

export interface ConstraintMode {
  id: string
  /** In slot order, which is selection order. */
  slots: readonly (readonly SelectionMatcher[])[]
  /**
   * Whether the last slot takes any number.
   *
   * Parallel across five lines is one constraint naming five lines, not four
   * constraints naming pairs — so the tool has to be able to say "and more of
   * these".
   */
  repeatableLastSlot?: boolean
}

export interface ConstraintToolInfo {
  id: ConstraintToolId
  title: string
  icon: IconName
  description: string
  /** The existing app's key, in the sketching scope. */
  key: string
  order: number
  modes: readonly ConstraintMode[]
}

/** How well a selection fits a tool. */
export type MatchStatus = 'empty' | 'invalid' | 'partial' | 'complete'

export interface ConstraintMatch {
  mode: ConstraintMode | null
  status: MatchStatus
}

/**
 * The constraints that carry a value.
 *
 * Selected, they classify as `dimension` rather than `constraint`: several tools
 * accept one as input — a dimension can be made equal to another — while the
 * plain geometric constraints cannot.
 */
const DIMENSION_TYPES = new Set<ApiConstraint['type']>([
  'Distance',
  'HorizontalDistance',
  'VerticalDistance',
  'Radius',
  'Diameter',
  'Angle',
])

export const CONSTRAINT_TOOLS: readonly ConstraintToolInfo[] = [
  {
    id: 'coincident',
    title: 'Coincident',
    icon: 'coincident',
    description: 'Put points, or a point and a curve, in the same place.',
    key: 'x',
    order: 10,
    modes: [
      {
        id: 'point-point',
        slots: [['point'], ['point']],
        repeatableLastSlot: true,
      },
      { id: 'point-line', slots: [['point'], ['line']] },
      { id: 'line-point', slots: [['line'], ['point']] },
      { id: 'point-arc', slots: [['point'], ['arc']] },
      { id: 'arc-point', slots: [['arc'], ['point']] },
      { id: 'point-circle', slots: [['point'], ['circle']] },
      { id: 'circle-point', slots: [['circle'], ['point']] },
      { id: 'line-line', slots: [['line'], ['line']] },
      { id: 'point-origin', slots: [['point'], ['origin']] },
      {
        id: 'origin-point',
        slots: [['origin'], ['point']],
        repeatableLastSlot: true,
      },
    ],
  },
  {
    id: 'midpoint',
    title: 'Midpoint',
    icon: 'midpoint',
    description: 'Hold a point at the middle of a line or an arc.',
    key: 'Shift+X',
    order: 20,
    modes: [
      { id: 'point-line', slots: [['point'], ['line']] },
      { id: 'line-point', slots: [['line'], ['point']] },
      { id: 'origin-line', slots: [['origin'], ['line']] },
      { id: 'line-origin', slots: [['line'], ['origin']] },
      { id: 'point-arc', slots: [['point'], ['arc']] },
      { id: 'arc-point', slots: [['arc'], ['point']] },
      { id: 'origin-arc', slots: [['origin'], ['arc']] },
      { id: 'arc-origin', slots: [['arc'], ['origin']] },
    ],
  },
  {
    id: 'tangent',
    title: 'Tangent',
    icon: 'tangent',
    description: 'Meet a curve without crossing it.',
    key: 't',
    order: 30,
    modes: [
      { id: 'line-arcLike', slots: [['line'], ['arcLike']] },
      { id: 'arcLike-line', slots: [['arcLike'], ['line']] },
      { id: 'arcLike-arcLike', slots: [['arcLike'], ['arcLike']] },
    ],
  },
  {
    id: 'parallel',
    title: 'Parallel',
    icon: 'parallel',
    description: 'Keep lines pointing the same way.',
    key: 'b',
    order: 40,
    modes: [
      {
        id: 'line-set',
        slots: [['line'], ['line']],
        repeatableLastSlot: true,
      },
    ],
  },
  {
    id: 'perpendicular',
    title: 'Perpendicular',
    icon: 'perpendicular',
    description: 'Hold two lines at a right angle.',
    key: 'Shift+B',
    order: 50,
    modes: [{ id: 'line-line', slots: [['line'], ['line']] }],
  },
  {
    id: 'equalLength',
    title: 'Equal',
    icon: 'equal',
    description: 'Make lines the same length, or arcs the same radius.',
    key: 'e',
    order: 60,
    modes: [
      {
        id: 'line-set',
        slots: [['line'], ['line']],
        repeatableLastSlot: true,
      },
      {
        id: 'arcLike-set',
        slots: [['arcLike'], ['arcLike']],
        repeatableLastSlot: true,
      },
    ],
  },
  {
    id: 'symmetric',
    title: 'Symmetric',
    icon: 'symmetric',
    description: 'Mirror two things about a line.',
    key: 'Shift+E',
    order: 70,
    modes: [
      { id: 'point-point-line', slots: [['point'], ['point'], ['line']] },
      { id: 'point-line-point', slots: [['point'], ['line'], ['point']] },
      { id: 'line-point-point', slots: [['line'], ['point'], ['point']] },
      {
        id: 'arcLike-arcLike-line',
        slots: [['arcLike'], ['arcLike'], ['line']],
      },
      {
        id: 'arcLike-line-arcLike',
        slots: [['arcLike'], ['line'], ['arcLike']],
      },
      {
        id: 'line-arcLike-arcLike',
        slots: [['line'], ['arcLike'], ['arcLike']],
      },
      /*
       * Three lines is deliberately not offered.
       *
       * The existing app has the mode but refuses to build a constraint from it
       * unless the user clicks the axis explicitly — with three lines selected
       * there is no way to guess which is the mirror, and it says so. Until
       * there is a way to say "this one is the axis", offering a tool that
       * cannot act is worse than not offering it.
       */
    ],
  },
  {
    id: 'vertical',
    title: 'Vertical',
    icon: 'vertical',
    description: 'Hold a line, or two points, on a vertical.',
    key: 'v',
    order: 80,
    modes: [
      { id: 'single-line', slots: [['line']], repeatableLastSlot: true },
      { id: 'point-pair', slots: [['pointLike'], ['pointLike']] },
    ],
  },
  {
    id: 'horizontal',
    title: 'Horizontal',
    icon: 'horizontal',
    description: 'Hold a line, or two points, on a horizontal.',
    key: 'h',
    order: 90,
    modes: [
      { id: 'single-line', slots: [['line']], repeatableLastSlot: true },
      { id: 'point-pair', slots: [['pointLike'], ['pointLike']] },
    ],
  },
  {
    id: 'fixed',
    title: 'Fixed',
    icon: 'fix',
    description: 'Pin a point where it is.',
    key: 'f',
    order: 100,
    modes: [{ id: 'single-point', slots: [['point']] }],
  },
]

export const constraintToolInfo = (
  id: ConstraintToolId
): ConstraintToolInfo => {
  const found = CONSTRAINT_TOOLS.find((tool) => tool.id === id)
  if (!found) throw new Error(`no constraint tool called ${id}`)
  return found
}

/** Whether a slot's matcher accepts what was selected. */
export function matcherAccepts(
  matcher: SelectionMatcher,
  kind: SelectionKind
): boolean {
  if (matcher === 'pointLike') return kind === 'point' || kind === 'origin'
  if (matcher === 'arcLike') return kind === 'arc' || kind === 'circle'
  return matcher === kind
}

/** What a selected id is. */
export function classify(
  graph: SceneGraph,
  id: SketchSelectionId
): { id: SketchSelectionId; kind: SelectionKind; object?: ApiObject } {
  if (id === 'origin') return { id, kind: 'origin' }

  const object = objectAt(graph, id)
  if (!object) return { id, kind: 'other' }

  if (object.kind.type === 'Segment') {
    switch (object.kind.segment.type) {
      case 'Point':
        return { id, kind: 'point', object }
      case 'Line':
        return { id, kind: 'line', object }
      case 'Arc':
        return { id, kind: 'arc', object }
      case 'Circle':
        return { id, kind: 'circle', object }
      default:
        return { id, kind: 'other', object }
    }
  }

  if (object.kind.type === 'Constraint') {
    return {
      id,
      kind: DIMENSION_TYPES.has(object.kind.constraint.type)
        ? 'dimension'
        : 'constraint',
      object,
    }
  }

  return { id, kind: 'other', object }
}

/** How one mode fits the selection. */
function statusOf(
  mode: ConstraintMode,
  selected: readonly { kind: SelectionKind }[]
): ConstraintMatch {
  if (selected.length === 0) return { mode, status: 'empty' }

  for (const [index, selection] of selected.entries()) {
    const slot =
      mode.slots[index] ??
      (mode.repeatableLastSlot ? mode.slots.at(-1) : undefined)

    if (
      !slot ||
      !slot.some((matcher) => matcherAccepts(matcher, selection.kind))
    ) {
      return { mode, status: 'invalid' }
    }
  }

  return {
    mode,
    status: selected.length < mode.slots.length ? 'partial' : 'complete',
  }
}

/**
 * Whether this tool can be applied to this selection, and by which mode.
 *
 * `complete` beats `partial` beats `empty`, which is the existing app's order
 * and reads as: something that can be applied now, else something that could be
 * with one more click, else nothing picked yet. Only `invalid` means "not with
 * this selection".
 */
export function matchConstraint(
  tool: ConstraintToolId,
  graph: SceneGraph,
  selection: readonly SketchSelectionId[]
): ConstraintMatch {
  const selected = selection.map((id) => classify(graph, id))
  const matches = constraintToolInfo(tool).modes.map((mode) =>
    statusOf(mode, selected)
  )

  return (
    matches.find((match) => match.status === 'complete') ??
    matches.find((match) => match.status === 'partial') ??
    matches.find((match) => match.status === 'empty') ?? {
      mode: null,
      status: 'invalid',
    }
  )
}

const segmentsOf = (
  selection: readonly SketchSelectionId[]
): ConstraintSegment[] =>
  selection.map((id) => (id === 'origin' ? 'ORIGIN' : id))

/** Only the real object ids, for the constraints that cannot name the origin. */
const objectIdsOf = (selection: readonly SketchSelectionId[]): ApiObjectId[] =>
  selection.filter((id): id is ApiObjectId => id !== 'origin')

const pair = <T>(values: readonly T[]): [T, T] | null =>
  values.length === 2 && values[0] !== undefined && values[1] !== undefined
    ? [values[0], values[1]]
    : null

/**
 * The constraints to write, for a tool applied to a complete selection.
 *
 * A *list*, because two tools produce more than one: horizontal and vertical
 * across several lines are one constraint each, since each line is
 * independently horizontal, while parallel across several lines is a single
 * constraint naming them all. Empty when the selection does not make a
 * constraint, which the caller reports rather than guessing at.
 */
export function constraintsFor(
  tool: ConstraintToolId,
  graph: SceneGraph,
  selection: readonly SketchSelectionId[]
): readonly ApiConstraint[] {
  const match = matchConstraint(tool, graph, selection)
  if (match.status !== 'complete' || !match.mode) return []

  const ids = objectIdsOf(selection)
  const kinds = selection.map((id) => classify(graph, id))

  switch (tool) {
    case 'coincident':
      return [{ type: 'Coincident', segments: segmentsOf(selection) }]

    case 'midpoint': {
      const both = pair(selection)
      if (!both) return []

      /*
       * Which of the two is the point is decided by the *mode*, not by looking
       * at the objects: the tool accepts both orders and the mode that matched
       * is what records which one the user picked.
       */
      const pointFirst =
        match.mode.id.startsWith('point') || match.mode.id.startsWith('origin')
      const point = pointFirst ? both[0] : both[1]
      const segment = pointFirst ? both[1] : both[0]
      if (segment === 'origin') return []

      return [
        {
          type: 'Midpoint',
          point: point === 'origin' ? 'ORIGIN' : point,
          segment,
        },
      ]
    }

    case 'tangent': {
      const both = pair(ids)
      return both ? [{ type: 'Tangent', input: both }] : []
    }

    case 'parallel':
      return ids.length >= 2 ? [{ type: 'Parallel', lines: ids }] : []

    case 'perpendicular': {
      const both = pair(ids)
      return both ? [{ type: 'Perpendicular', lines: both }] : []
    }

    case 'equalLength': {
      if (ids.length < 2) return []

      /*
       * Two different constraints behind one tool, which is what the existing
       * app offers: equal *length* for lines and equal *radius* for arcs and
       * circles. Which one is decided by what was selected, and a mixed
       * selection is neither.
       */
      const allLines = kinds.every((each) => each.kind === 'line')
      if (allLines) return [{ type: 'LinesEqualLength', lines: ids }]

      const allArcs = kinds.every(
        (each) => each.kind === 'arc' || each.kind === 'circle'
      )
      return allArcs ? [{ type: 'EqualRadius', input: ids }] : []
    }

    case 'symmetric': {
      /*
       * The single line is the axis, and which position it was picked in is what
       * the matched mode records — so the axis is found from the mode rather
       * than by guessing from the objects.
       */
      const axisIndex = match.mode.id
        .split('-')
        .findIndex((slot) => slot === 'line')
      const axis = ids[axisIndex]
      if (axis === undefined) return []

      const mirrored = pair(ids.filter((id) => id !== axis))
      return mirrored ? [{ type: 'Symmetric', input: mirrored, axis }] : []
    }

    case 'horizontal':
    case 'vertical': {
      const type = tool === 'horizontal' ? 'Horizontal' : 'Vertical'

      // A line at a time: each is independently horizontal, so several lines are
      // several constraints rather than one naming them all.
      if (match.mode.id === 'single-line') {
        return ids.map((line) => ({ type, line }) as ApiConstraint)
      }

      return [{ type, points: segmentsOf(selection) } as ApiConstraint]
    }

    case 'fixed': {
      const points: FixedPoint[] = []

      for (const id of ids) {
        const object = objectAt(graph, id)
        if (object?.kind.type !== 'Segment') return []
        const segment = object.kind.segment
        if (segment.type !== 'Point') return []

        // Pinned where it is now, which is why the position travels with it: the
        // constraint is "here", and here is a value.
        points.push({ point: id, position: segment.position })
      }

      return points.length > 0 ? [{ type: 'Fixed', points }] : []
    }
  }
}

import type { IconName } from '@kittycad/ui-kit'
import type { ToolbarItem } from '@src/contracts/sceneModes'
import { SKETCHING_MODE } from '@src/features/sceneToolbar/modes'
import {
  CONSTRAINT_TOOLS,
  type ConstraintToolId,
} from '@src/lib/sketch/constraints'
import type { SketchToolId } from '@src/lib/sketch/tools'
import { type ToolbarGroup, toolbarItemsFrom } from '@src/lib/toolbarItems'

/**
 * Every button a sketch has, and where it goes.
 *
 * One list, on purpose, and the same arrangement `MODELING_TOOLS` has: the
 * command, the button, the group it shares and the letter that presses it all
 * come from one row, so adding an action is a row plus its behaviour and nothing
 * to keep in step by hand. Before this there were three sources — segment tools,
 * constraints, and a dimension written out longhand — and the mode, the section
 * and the group were named at each `provide` call instead of in the row. Every
 * number in a second place is a number that can drift.
 *
 * What is *not* here is behaviour, and that is the real difference between this
 * and the modelling catalogue. A modelling tool is derived from a stdlib
 * signature — its arguments become its prompts and the result is one line of KCL
 * — so one row describes the whole tool. A sketch action cannot be: equipping a
 * tool starts a pointer state machine (`draft.ts`), a constraint is a matcher
 * over the selection (`constraints.ts`), and a dimension measures geometry
 * (`dimensions.ts`). So a row says what the button *is*, and `kind` says which of
 * the three it wires up to.
 */

export type SketchActionKind =
  /** Equips a drawing tool. Active while it is the one in hand. */
  | { kind: 'tool'; tool: SketchToolId }
  /** Applies a constraint to the selection. Enabled when the selection fits. */
  | { kind: 'constraint'; constraint: ConstraintToolId }
  /** Dimensions the selection. Enabled when exactly two things are picked. */
  | { kind: 'dimension' }

export interface SketchAction {
  /** The command pressing it runs, and what the key and the button bind to. */
  commandId: string
  /** The toolbar button's own id, which is not the command's. */
  itemId: string
  title: string
  icon: IconName
  /** One sentence, shown in the palette and as a tooltip. */
  description: string
  /**
   * A single chord, live only while the sketching scope is applied.
   *
   * The existing app's letters. Somebody switching between the two apps should
   * not have to relearn which key draws a circle — which is also why they are
   * bare letters: the editor's text-entry scope takes those back whenever
   * something is being typed into.
   */
  key?: string
  /** Whose toolbar this appears in. Sketching, for all of them, so far. */
  mode: string
  /** The run of buttons it belongs to. A change of section draws a rule. */
  section?: string
  /** Shares one button with every other action naming the same group. */
  group?: string
  /** Lower sorts earlier, in tens so one can be slotted between two others. */
  order?: number
  what: SketchActionKind
}

export const SKETCH_GROUPS: readonly ToolbarGroup[] = [
  {
    id: 'constraints',
    itemId: 'sketch.group.constraints',
    title: 'Constraints',
    icon: 'coincident',
  },
]

/** The drawing tools, in the order they are offered. */
const drawingActions: readonly SketchAction[] = [
  {
    commandId: 'sketch.tool.line',
    itemId: 'sketch.item.line',
    title: 'Line',
    icon: 'line',
    description: 'Draw a line between two points, then keep going.',
    key: 'l',
    mode: SKETCHING_MODE,
    section: 'draw',
    order: 10,
    what: { kind: 'tool', tool: 'line' },
  },
  {
    commandId: 'sketch.tool.point',
    itemId: 'sketch.item.point',
    title: 'Point',
    icon: 'oneDot',
    description: 'Place a single point in the sketch.',
    key: '.',
    mode: SKETCHING_MODE,
    section: 'draw',
    order: 20,
    what: { kind: 'tool', tool: 'point' },
  },
  {
    commandId: 'sketch.tool.circle',
    itemId: 'sketch.item.circle',
    title: 'Center circle',
    icon: 'circle',
    description: 'Draw a circle from its centre and a point on it.',
    key: 'c',
    mode: SKETCHING_MODE,
    section: 'draw',
    order: 30,
    what: { kind: 'tool', tool: 'circle' },
  },
  {
    commandId: 'sketch.tool.threePointArc',
    itemId: 'sketch.item.threePointArc',
    title: '3-point arc',
    icon: 'arc',
    description: 'Draw an arc through a start, an end, and a point between.',
    key: 'Alt+A',
    mode: SKETCHING_MODE,
    section: 'draw',
    order: 40,
    what: { kind: 'tool', tool: 'threePointArc' },
  },
  {
    commandId: 'sketch.tool.cornerRectangle',
    itemId: 'sketch.item.cornerRectangle',
    title: 'Corner rectangle',
    icon: 'rectangle',
    description: 'Draw a rectangle from one corner to the opposite one.',
    key: 'r',
    mode: SKETCHING_MODE,
    section: 'draw',
    order: 50,
    what: { kind: 'tool', tool: 'cornerRectangle' },
  },
  {
    commandId: 'sketch.tool.centerRectangle',
    itemId: 'sketch.item.centerRectangle',
    title: 'Center rectangle',
    icon: 'rectangleCenter',
    description: 'Draw a rectangle outwards from its centre.',
    key: 'Shift+R',
    mode: SKETCHING_MODE,
    section: 'draw',
    order: 60,
    what: { kind: 'tool', tool: 'centerRectangle' },
  },
]

/**
 * How each constraint is presented, keyed by the tool it applies.
 *
 * A map rather than a second list, so a constraint that exists without a button
 * is a type error rather than a silently missing one — and so the *name* stays
 * where the matcher is. The keys are the existing app's.
 */
const constraintPresentation: Record<
  ConstraintToolId,
  { icon: IconName; description: string; key: string; order: number }
> = {
  coincident: {
    icon: 'coincident',
    description: 'Put points, or a point and a curve, in the same place.',
    key: 'x',
    order: 10,
  },
  midpoint: {
    icon: 'midpoint',
    description: 'Hold a point at the middle of a line or an arc.',
    key: 'Shift+X',
    order: 20,
  },
  tangent: {
    icon: 'tangent',
    description: 'Meet a curve without crossing it.',
    key: 't',
    order: 30,
  },
  parallel: {
    icon: 'parallel',
    description: 'Keep lines pointing the same way.',
    key: 'b',
    order: 40,
  },
  perpendicular: {
    icon: 'perpendicular',
    description: 'Hold two lines at a right angle.',
    key: 'Shift+B',
    order: 50,
  },
  equalLength: {
    icon: 'equal',
    description: 'Make lines the same length, or arcs the same radius.',
    key: 'e',
    order: 60,
  },
  symmetric: {
    icon: 'symmetric',
    description: 'Mirror two things about a line.',
    key: 'Shift+E',
    order: 70,
  },
  vertical: {
    icon: 'vertical',
    description: 'Hold a line, or two points, on a vertical.',
    key: 'v',
    order: 80,
  },
  horizontal: {
    icon: 'horizontal',
    description: 'Hold a line, or two points, on a horizontal.',
    key: 'h',
    order: 90,
  },
  fixed: {
    icon: 'fix',
    description: 'Pin a point where it is.',
    key: 'f',
    order: 100,
  },
}

const constraintActions: readonly SketchAction[] = CONSTRAINT_TOOLS.map(
  (tool) => ({
    commandId: `sketch.constrain.${tool.id}`,
    itemId: `sketch.item.constrain.${tool.id}`,
    // The name comes from the matcher's own table: two features need it, and one
    // name in two places is one name to get wrong.
    title: tool.title,
    ...constraintPresentation[tool.id],
    mode: SKETCHING_MODE,
    section: 'constrain',
    group: 'constraints',
    what: { kind: 'constraint' as const, constraint: tool.id },
  })
)

/**
 * The dimension tool, which is its own kind.
 *
 * Beside the constraint group rather than inside it, because what it produces is
 * different in kind: a value that can be typed over afterwards, rather than a
 * relationship that either holds or does not.
 */
const dimensionAction: SketchAction = {
  commandId: 'sketch.dimension',
  itemId: 'sketch.item.dimension',
  title: 'Dimension',
  icon: 'dimension',
  description: 'Constrain a distance or an angle between two selected things.',
  key: 'd',
  mode: SKETCHING_MODE,
  section: 'constrain',
  order: 20,
  what: { kind: 'dimension' },
}

export const SKETCH_ACTIONS: readonly SketchAction[] = [
  ...drawingActions,
  ...constraintActions,
  dimensionAction,
]

/** The buttons, derived — the same derivation the modelling toolbar uses. */
export const sketchToolbarItems = (): readonly ToolbarItem[] =>
  toolbarItemsFrom(SKETCH_ACTIONS, SKETCH_GROUPS)

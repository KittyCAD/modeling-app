import type { IconName } from '@kittycad/ui-kit'
import type { ModelingOperation } from '@src/contracts/modelingOperations'
import type { ToolbarItem } from '@src/contracts/sceneModes'
import type { OperationSpec } from '@src/features/modelingOperations/operations/derive'
import {
  derivedOperation,
  operationIdFor,
} from '@src/features/modelingOperations/operations/derive'
import {
  ANNOTATING_MODE,
  MODELING_MODE,
} from '@src/features/sceneToolbar/modes'

/**
 * One operation, and where it appears.
 *
 * Placement lives with the operation rather than in a second table, because
 * every number in a second table is a number that can drift. The toolbar's items
 * are *derived* from this list, so a tool is added by adding a line here and
 * nothing else: the operation, its command, its button, its place in a group and
 * its key all come from one entry.
 */
export interface ModelingTool extends OperationSpec {
  /** Whose toolbar this appears in, and whose keymap scope its key lives in. */
  mode: string
  /** The run of buttons it belongs to. A change of section draws a rule. */
  section?: string
  /** Shares one button with every other tool naming the same group. */
  group?: string
  /** Lower sorts earlier, within the section and within the group. */
  order?: number
  /**
   * A single keystroke, live only while its mode is active.
   *
   * Bare letters, which is what a modelling app's keyboard looks like — and safe
   * because they are scoped: the editor's text-entry scope takes bare keys back
   * whenever something is being typed into.
   */
  key?: string
}

/** A button shared by several tools. Everything else is read from its members. */
export interface ToolGroup {
  id: string
  /** Names the group in its menu: "Pattern". */
  title: string
  icon?: IconName
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  { id: 'hollow', title: 'Shell', icon: 'layers' },
  { id: 'pattern', title: 'Pattern', icon: 'grid' },
  { id: 'transform', title: 'Transform', icon: 'cube' },
  { id: 'gdt.form', title: 'Form', icon: 'dimension' },
  { id: 'gdt.orientation', title: 'Orientation', icon: 'dimension' },
  { id: 'gdt.location', title: 'Location', icon: 'dimension' },
  { id: 'gdt.notes', title: 'Notes', icon: 'dimension' },
]

/**
 * A geometric characteristic, as a tool.
 *
 * Eighteen of these differ only in which characteristic they call and what to
 * call the result: every one takes a tolerance, and every one is applied to faces
 * or edges you point at. Writing them out longhand would be eighteen chances to
 * make a different decision about the same thing.
 */
const gdtTool = (
  fn: string,
  title: string,
  placement: {
    group: string
    order: number
    /** Extra optional arguments worth asking for. `faces` unless said. */
    prompt?: readonly string[]
  }
): ModelingTool => ({
  stdlib: `gdt::${fn}`,
  title,
  past: `Added a ${title.toLowerCase()} callout`,
  icon: 'dimension',
  category: 'Annotate',
  stem: fn,
  prompt: placement.prompt ?? ['faces'],
  mode: ANNOTATING_MODE,
  section: 'gdt',
  group: placement.group,
  order: placement.order,
})

/**
 * Every modelling and annotation tool the app ships.
 *
 * Deliberately not every stdlib function. What is missing is missing for a
 * reason worth writing down: the boolean operations and `loft` take two or more
 * solids or sketches, and the argument layer can hold one answer per argument —
 * so their buttons would reliably write code that does not run, which is worse
 * than a button that is not there yet. They arrive with multi-selection.
 */
export const MODELING_TOOLS: readonly ModelingTool[] = [
  // Create ------------------------------------------------------------------
  {
    stdlib: 'extrude',
    title: 'Extrude',
    past: 'Extruded',
    icon: 'cube',
    prompt: ['length'],
    labels: { sketches: 'Sketch' },
    mode: MODELING_MODE,
    section: 'create',
    order: 10,
    key: 'e',
  },
  {
    stdlib: 'offsetPlane',
    title: 'Offset plane',
    past: 'Offset a plane from',
    icon: 'layers',
    stem: 'plane',
    mode: MODELING_MODE,
    section: 'create',
    order: 20,
    key: 'o',
  },
  {
    stdlib: 'helix',
    title: 'Helix',
    past: 'Added a helix',
    icon: 'sketch',
    prompt: ['radius', 'axis', 'length'],
    mode: MODELING_MODE,
    section: 'create',
    order: 30,
  },

  // Modify ------------------------------------------------------------------
  {
    stdlib: 'fillet',
    title: 'Fillet',
    past: 'Filleted',
    icon: 'cube',
    prompt: ['tags'],
    labels: { tags: 'Edges' },
    mode: MODELING_MODE,
    section: 'modify',
    order: 10,
    key: 'f',
  },
  {
    stdlib: 'chamfer',
    title: 'Chamfer',
    past: 'Chamfered',
    icon: 'cube',
    prompt: ['tags'],
    labels: { tags: 'Edges' },
    mode: MODELING_MODE,
    section: 'modify',
    order: 20,
    key: 'c',
  },
  {
    stdlib: 'shell',
    title: 'Shell',
    past: 'Shelled',
    icon: 'layers',
    labels: { faces: 'Faces to open' },
    mode: MODELING_MODE,
    section: 'modify',
    order: 30,
    group: 'hollow',
  },
  {
    stdlib: 'hollow',
    title: 'Hollow',
    past: 'Hollowed',
    icon: 'layers',
    mode: MODELING_MODE,
    section: 'modify',
    order: 40,
    group: 'hollow',
  },

  // Pattern -----------------------------------------------------------------
  {
    stdlib: 'patternLinear3d',
    title: 'Linear pattern',
    past: 'Patterned',
    icon: 'grid',
    stem: 'pattern',
    mode: MODELING_MODE,
    section: 'pattern',
    order: 10,
    group: 'pattern',
    key: 'p',
  },
  {
    stdlib: 'patternCircular3d',
    title: 'Circular pattern',
    past: 'Patterned',
    icon: 'grid',
    stem: 'pattern',
    mode: MODELING_MODE,
    section: 'pattern',
    order: 20,
    group: 'pattern',
  },

  // Transform ---------------------------------------------------------------
  {
    stdlib: 'translate',
    title: 'Move',
    past: 'Moved',
    icon: 'cube',
    prompt: ['xyz'],
    labels: { xyz: 'Offset' },
    mode: MODELING_MODE,
    section: 'transform',
    order: 10,
    group: 'transform',
    key: 't',
  },
  {
    stdlib: 'rotate',
    title: 'Rotate',
    past: 'Rotated',
    icon: 'refresh',
    prompt: ['axis', 'angle'],
    mode: MODELING_MODE,
    section: 'transform',
    order: 20,
    group: 'transform',
  },
  {
    stdlib: 'scale',
    title: 'Scale',
    past: 'Scaled',
    icon: 'cube',
    prompt: ['factor'],
    mode: MODELING_MODE,
    section: 'transform',
    order: 30,
    group: 'transform',
  },
  {
    stdlib: 'mirror3d',
    title: 'Mirror',
    past: 'Mirrored',
    icon: 'cube',
    stem: 'mirror',
    mode: MODELING_MODE,
    section: 'transform',
    order: 40,
    group: 'transform',
  },

  // Annotate: datums --------------------------------------------------------
  {
    stdlib: 'gdt::datum',
    title: 'Datum',
    past: 'Added a datum on',
    icon: 'dimension',
    category: 'Annotate',
    stem: 'datum',
    mode: ANNOTATING_MODE,
    section: 'datum',
    order: 10,
    key: 'd',
  },

  // Annotate: geometric characteristics ------------------------------------
  gdtTool('flatness', 'Flatness', { group: 'gdt.form', order: 10 }),
  gdtTool('straightness', 'Straightness', { group: 'gdt.form', order: 20 }),
  gdtTool('circularity', 'Circularity', { group: 'gdt.form', order: 30 }),
  gdtTool('cylindricity', 'Cylindricity', { group: 'gdt.form', order: 40 }),

  gdtTool('parallelism', 'Parallelism', {
    group: 'gdt.orientation',
    order: 10,
    prompt: ['faces', 'datums'],
  }),
  gdtTool('perpendicularity', 'Perpendicularity', {
    group: 'gdt.orientation',
    order: 20,
    prompt: ['faces', 'datums'],
  }),
  gdtTool('angularity', 'Angularity', {
    group: 'gdt.orientation',
    order: 30,
    prompt: ['faces', 'datums'],
  }),

  gdtTool('position', 'Position', {
    group: 'gdt.location',
    order: 10,
    prompt: ['faces', 'datums'],
  }),
  gdtTool('concentricity', 'Concentricity', {
    group: 'gdt.location',
    order: 20,
  }),
  gdtTool('symmetry', 'Symmetry', { group: 'gdt.location', order: 30 }),
  gdtTool('runout', 'Runout', { group: 'gdt.location', order: 40 }),
  gdtTool('profile', 'Profile', {
    group: 'gdt.location',
    order: 50,
    prompt: ['faces', 'datums'],
  }),
  gdtTool('profileLine', 'Line profile', {
    group: 'gdt.location',
    order: 60,
    prompt: ['datums'],
  }),
  gdtTool('profileSurface', 'Surface profile', {
    group: 'gdt.location',
    order: 70,
    prompt: ['datums'],
  }),
  gdtTool('distance', 'Distance', {
    group: 'gdt.location',
    order: 80,
    prompt: ['from', 'to'],
  }),

  // Annotate: text ----------------------------------------------------------
  gdtTool('note', 'Note', { group: 'gdt.notes', order: 10, prompt: [] }),
  gdtTool('annotation', 'Annotation', {
    group: 'gdt.notes',
    order: 20,
    prompt: ['faces'],
  }),
]

/**
 * The toolbar, derived from the tools.
 *
 * A grouped tool contributes to its group's button; everything else is a button
 * of its own. A group takes its mode, section and position from its members, so
 * moving a group means moving its tools and there is no second place that has to
 * agree about where it went.
 */
export function toolbarItemsFor(
  tools: readonly ModelingTool[],
  groups: readonly ToolGroup[]
): readonly ToolbarItem[] {
  const items: ToolbarItem[] = []

  for (const tool of tools) {
    if (tool.group) continue
    items.push({
      kind: 'command',
      id: `modeling.tool.${tool.stdlib.replace(/::/g, '.')}`,
      mode: tool.mode,
      section: tool.section,
      order: tool.order,
      commandId: operationIdFor(tool.stdlib),
    })
  }

  for (const group of groups) {
    const members = [...tools]
      .filter((tool) => tool.group === group.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    // A group nobody joined is not a button. This is what makes a group survive
    // its members being removed, rather than drawing an empty caret.
    const first = members[0]
    if (!first) continue

    items.push({
      kind: 'group',
      id: `modeling.group.${group.id}`,
      mode: first.mode,
      section: first.section,
      order: first.order,
      title: group.title,
      icon: group.icon,
      commandIds: members.map((member) => operationIdFor(member.stdlib)),
    })
  }

  return items
}

/** Every shipped tool as an operation, derived from its stdlib shape. */
export const modelingOperations: readonly ModelingOperation[] =
  MODELING_TOOLS.map((tool) => derivedOperation(tool))

/**
 * One operation, by the stdlib function it derives from.
 *
 * For tests and for anything that legitimately needs a single operation. Throws
 * rather than returning undefined: naming a function that is not shipped is a
 * mistake at the call site, not a state to handle.
 */
export function operationFor(stdlib: string): ModelingOperation {
  const operation = modelingOperations.find(
    (candidate) => candidate.stdlib === stdlib
  )
  if (!operation) throw new Error(`No modelling operation for ${stdlib}`)
  return operation
}

import {
  appendValueSpec,
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { IconName } from '@kittycad/ui-kit'
import type { ReadonlySignal } from '@preact/signals'
import { byOrder, dedupeById } from '@src/lib/registryOrdering'

/**
 * A way of working in the scene.
 *
 * Modelling, sketching and annotating are different jobs with different tools,
 * different keys and different meanings for a click. The existing app derives
 * which toolbar to show from the state of one large machine, which is why adding
 * a mode there means editing that machine; here a mode is a contribution, and
 * the toolbar is whatever the active one says it is.
 *
 * A mode holds no behaviour. It names a situation, says which keymap scope is
 * live inside it, and nothing else — so it cannot become a second place where
 * work happens.
 */
export interface SceneMode {
  id: string
  /** The noun in the switcher: "Modeling". */
  title: string
  icon?: IconName
  /** Lower sorts earlier; the first one is where you start. */
  order?: number
  /**
   * Applied to the keymap while this mode is active.
   *
   * How a mode gets its own keys without knowing what a key is: `e` means
   * extrude in Modeling and something else in Sketching, because the bindings
   * are scoped and only one of those scopes is live. The scope itself is
   * contributed to the keymap like any other.
   */
  keymapScope?: string
  /** Whether the mode can be entered right now. Absent means always. */
  available?: ReadonlySignal<boolean>
  /** Why not, for the tooltip on a mode that cannot be entered. */
  unavailableReason?: string
  /**
   * Said in place of tools when the mode has none.
   *
   * A mode with an empty toolbar is a real state during a rebuild, and an empty
   * strip explains nothing. Saying why is the difference between "not built yet"
   * and "broken".
   */
  empty?: string
}

interface ToolbarItemBase {
  id: string
  /** The mode this appears in. An item belongs to exactly one. */
  mode: string
  /**
   * Which run of items this belongs to. Absent means the unnamed first run.
   *
   * This is how dividers survive being contributed. The existing app writes a
   * literal `'break'` between two items, which only works because one file holds
   * the whole list in order — the moment another feature can insert a button, a
   * positional separator separates the wrong things. Naming the run instead
   * means the toolbar draws a rule wherever the name changes, and an item added
   * later lands inside a run rather than between two.
   */
  section?: string
  /** Lower sorts earlier. Sections are ordered by their earliest item. */
  order?: number
}

/** One button, running one command. */
export interface ToolbarCommandItem extends ToolbarItemBase {
  kind: 'command'
  commandId: string
}

/**
 * Several commands under one button.
 *
 * The face is whichever was used last, so the tool you keep reaching for stops
 * being two clicks away. Everything is still one click from the caret.
 */
export interface ToolbarGroupItem extends ToolbarItemBase {
  kind: 'group'
  /** Names the group in its menu: "Pattern", "GD&T". */
  title: string
  icon?: IconName
  commandIds: readonly string[]
}

export type ToolbarItem = ToolbarCommandItem | ToolbarGroupItem

/**
 * A reason a mode cannot be entered right now.
 *
 * Contributed rather than declared on the mode, because whoever *ships* a mode
 * rarely knows when it applies: sketching is a mode of the scene, and whether
 * you are in a sketch is a fact about the KCL file. So the mode says what it is
 * and a gate says when — and a second feature can gate the same mode without
 * either of them meeting.
 *
 * Every gate for a mode has to agree before it can be entered. That direction is
 * deliberate: a gate can only ever take a mode away, so adding one cannot make an
 * unavailable mode reachable by accident.
 */
export interface SceneModeGate {
  id: string
  /** The mode this gates. */
  mode: string
  available: ReadonlySignal<boolean>
  /** Said on the disabled mode: "Select something inside a sketch." */
  reason?: string
}

export interface SceneModeService {
  readonly modes: ReadonlySignal<readonly SceneMode[]>
  /** Null only before the first mode is contributed. */
  readonly active: ReadonlySignal<SceneMode | null>
  /** Whether a mode can be entered, and why not. */
  availability(modeId: string): { available: boolean; reason?: string }
  /**
   * Which command each group ran last, keyed by group id.
   *
   * In memory, not persisted. It is a convenience about the last few minutes of
   * work — a preference the user never expressed — and restoring it a week later
   * would present a toolbar they do not recognise as their own.
   */
  readonly lastUsed: ReadonlySignal<ReadonlyMap<string, string>>
  /** No-ops if the mode is missing or unavailable. */
  enter(modeId: string): void
  /**
   * Forget which mode was asked for, landing back where you start.
   *
   * How a mode is *left*, and worth being a separate verb from entering the
   * first mode: the fallback already knows what to land on, so a mode
   * contributed later becomes the place you land without this method learning
   * about it.
   *
   * A mode may have work behind it — sketching *is* an open sketch — so this
   * can be expensive, and it is still only ever called because somebody said to.
   * Nothing infers it.
   */
  reset(): void
  noteUsed(groupId: string, commandId: string): void
}

/**
 * Modal tools over the scene.
 *
 * Items are contributed separately from the modes they appear in, which is what
 * makes both extensible in the direction that matters: a feature can add a mode
 * without owning any tools, and a feature that owns a tool can put it in
 * somebody else's mode.
 */
/**
 * The command that means "stop what I was doing".
 *
 * A constant rather than a service dependency, because the two features that
 * need to agree about it sit on opposite sides of the seam: the toolbar owns
 * modes, and the scene owns clicks. A shared string is the smaller coupling.
 */
export const EXIT_MODE_COMMAND = 'scene.exitMode'

export const sceneModesContract = defineContract({
  sceneModesValueSpec: defineValueSpec<SceneMode, SceneMode[]>({
    name: 'scene.modes',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
  toolbarItemsValueSpec: defineValueSpec<ToolbarItem, ToolbarItem[]>({
    name: 'scene.toolbarItems',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
  sceneModeGatesValueSpec: appendValueSpec<SceneModeGate>('scene.modeGates'),
  sceneModeService: defineService<SceneModeService>('scene.modes.service'),
})

export const {
  sceneModesValueSpec,
  toolbarItemsValueSpec,
  sceneModeGatesValueSpec,
  sceneModeService,
} = sceneModesContract

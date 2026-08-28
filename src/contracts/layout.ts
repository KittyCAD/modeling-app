import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal, Signal } from '@preact/signals'
import type { IconName } from '@kittycad/ui-kit'
import type { ComponentChildren } from 'preact'

export type Orientation = 'inline' | 'block'
export type RailSide = 'inline-start' | 'inline-end' | 'block-end'

/** A leaf: one contributed area, rendered on its own. */
export interface AreaNode {
  type: 'area'
  id: string
  areaId: string
}

/** A resizable division. Sizes are fractions summing to 1. */
export interface SplitNode {
  type: 'split'
  id: string
  orientation: Orientation
  sizes: number[]
  children: LayoutNode[]
}

/**
 * An icon rail with collapsible areas behind it.
 *
 * The rail is always visible and the areas behind it are not, which is what
 * lets a dense tool keep a dozen panels reachable without spending screen on
 * any of them.
 */
export interface RailNode {
  type: 'rail'
  id: string
  side: RailSide
  areaIds: string[]
  /** Areas currently expanded. Empty is normal: the rail collapses flat. */
  openAreaIds: string[]
  /**
   * Starting extent of the expanded region, in pixels.
   *
   * Pixels rather than a fraction, for the same reason the whole node exists: a
   * file tree wants the same width at 1280 as at 3840. It is a starting point
   * only — once dragged, `extentFor(node.id)` is the answer.
   */
  size: number
  /**
   * Bounds for the expanded region, in pixels.
   *
   * Per-node rather than global because what counts as too narrow depends on
   * what is in there: a title block is unreadable under 180px and pointless
   * over 400, while a code editor is still cramped at 720.
   */
  minExtent?: number
  maxExtent?: number
}

/**
 * Rails docked around a centre.
 *
 * Rails are sized in pixels and the centre takes what is left, which does not
 * express as fractions — so a dock is its own node rather than a `SplitNode`
 * with special cases. This is also the shape every IDE layout actually has.
 */
export interface DockNode {
  type: 'dock'
  id: string
  start?: RailNode
  end?: RailNode
  center: LayoutNode
}

export type LayoutNode = AreaNode | SplitNode | RailNode | DockNode

export interface AreaContext {
  /** The layout node the area is mounted in, for areas that care. */
  nodeId: string
}

/**
 * A dockable surface.
 *
 * Areas are contributed, not hard-coded into a layout component, so a feature
 * can add a panel without the shell knowing it exists — and a plugin can add
 * one without a core change.
 */
export interface AreaDefinition {
  id: string
  /** Shown in the rail tooltip and the panel heading. */
  title: string
  icon: IconName
  /** Display form of the toggle binding, e.g. `⌘1`. */
  shortcut?: string
  /** Dropped from rails and layouts entirely while false. */
  available?: ReadonlySignal<boolean>
  /**
   * `panel` gives the area a heading strip and a scrolling body. `bare` hands
   * it the region untouched, for a canvas or an editor that owns its own
   * chrome.
   */
  chrome?: 'panel' | 'bare'
  /**
   * The id of another area that renders this one.
   *
   * A rail still lists a hosted area, so `toggleArea`, `isAreaOpen`,
   * `extentFor`, the toggle command and persistence all behave exactly as they
   * do for a docked panel — but neither the icon strip nor the expanded region
   * draws it. Its host draws it, wherever it belongs and with whatever
   * affordance belongs there.
   *
   * This is how the file tree sits inside the code panel with its own toggle
   * rather than beside it in the rail. The alternative was to let a rail's
   * region hold a whole layout subtree, which is more general and answers a
   * question nobody has asked yet: what the icon strip toggles when the region
   * is not an area.
   */
  hostedBy?: string
  render: (context: AreaContext) => ComponentChildren
  /**
   * Controls for the area's own heading strip.
   *
   * The area owns its actions for the same reason it owns its body: "new file"
   * belongs to the file tree, and the shell has no business knowing the panel
   * has one. Drawn before the close button, and only for `panel` chrome — a
   * `bare` area has no strip to put them in and draws its own.
   */
  headerActions?: (context: AreaContext) => ComponentChildren
}

/** A named starting layout, e.g. `modeling`, `review`. */
export interface LayoutPreset {
  id: string
  title: string
  build: () => LayoutNode
}

export interface LayoutService {
  readonly root: ReadonlySignal<LayoutNode | null>
  readonly presetId: ReadonlySignal<string | null>
  readonly areas: ReadonlySignal<readonly AreaDefinition[]>
  area(areaId: string): AreaDefinition | undefined
  /**
   * A stable, writable sizes signal for one split node.
   *
   * Handing the signal to `Split` is what makes a drag, a restored layout, and
   * a command all one code path — the component has no private copy to drift.
   */
  sizesFor(nodeId: string): Signal<number[]>
  /**
   * A stable, writable extent in pixels for one rail's expanded region.
   *
   * Rails are sized in pixels rather than fractions: a file tree wants the same
   * width whether the window is 1280 or 3840 wide.
   */
  extentFor(nodeId: string, fallback?: number): Signal<number>
  isAreaOpen(areaId: string): ReadonlySignal<boolean>
  toggleArea(areaId: string): void
  openArea(areaId: string): void
  closeArea(areaId: string): void
  applyPreset(presetId: string): void
  reset(): void
}

export const layoutContract = defineContract({
  layoutAreasValueSpec: appendValueSpec<AreaDefinition>('layout.areas'),
  layoutPresetsValueSpec: appendValueSpec<LayoutPreset>('layout.presets'),
  layoutService: defineService<LayoutService>('layout.service'),
})

export const { layoutAreasValueSpec, layoutPresetsValueSpec, layoutService } =
  layoutContract

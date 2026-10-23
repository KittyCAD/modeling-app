import { LitElement, css, html } from 'lit'
import {
  buildFeatureTreeModel,
  type FeatureTreeNode,
  type FeatureTreeEntry,
} from './feature-tree-model'
export type { FeatureTreeNode, FeatureTreeEntry } from './feature-tree-model'
import {
  registerFeatureTreeRow,
  ZooFeatureTreeRow,
} from '../feature-tree-row/feature-tree-row'
import type {
  FeatureTreeAppearance,
  FeatureTreeRowEventDetail,
  FeatureTreeRowExpandDetail,
} from '../feature-tree-row/feature-tree-row'

export interface FeatureTreeSelectionDetail extends FeatureTreeRowEventDetail {
  selectedIds: readonly string[]
}

/** Optional widget shortcuts, expressed as DOM keys rather than app command IDs. */
export interface FeatureTreeShortcut {
  key: string
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
}

export type FeatureTreeAction =
  | 'focusActions'
  | 'focusRow'
  | 'requestContextMenu'
export type FeatureTreeShortcuts = Partial<
  Record<FeatureTreeAction, readonly FeatureTreeShortcut[]>
>

const defaultShortcuts: Record<
  FeatureTreeAction,
  readonly FeatureTreeShortcut[]
> = {
  focusActions: [{ key: 'F2' }],
  focusRow: [{ key: 'Escape' }],
  requestContextMenu: [{ key: 'ContextMenu' }, { key: 'F10', shift: true }],
}

/**
 * Controlled tree navigation over explicit node data. Mounted rows are flat,
 * slotted siblings keyed by node-id; their content can come from any framework.
 * Supply the complete model, even when only some visible rows are mounted.
 */
export class ZooFeatureTree extends LitElement {
  static properties = {
    nodes: { attribute: false },
    selectedIds: { attribute: false },
    expandedIds: { attribute: false },
    multiselect: { type: Boolean },
    appearance: { type: String, reflect: true },
    shortcuts: { attribute: false },
  }

  declare nodes: readonly FeatureTreeNode[]
  declare selectedIds: readonly string[]
  declare expandedIds: readonly string[]
  declare multiselect: boolean
  declare appearance: FeatureTreeAppearance
  /** Partial replacements; [] disables one action, false disables all optional shortcuts. */
  declare shortcuts: FeatureTreeShortcuts | false
  private model = buildFeatureTreeModel([], [])
  private rows = new Map<string, ZooFeatureTreeRow>()
  private active: string | undefined
  private pendingFocus: string | undefined
  private focusOwner: HTMLElement | undefined
  private managed = new Set<ZooFeatureTreeRow>()
  private observer = new MutationObserver((records) => this.sync(records))
  private search = ''
  private searchTime = 0

  constructor() {
    super()
    this.nodes = []
    this.selectedIds = []
    this.expandedIds = []
    this.multiselect = false
    this.appearance = 'default'
    this.shortcuts = {}
    this.addEventListener('keydown', this.onKeyDown)
    this.addEventListener('focusin', this.onFocusIn)
    this.addEventListener('zoo-select', this.onSelect as EventListener)
    this.addEventListener('zoo-expand', this.onExpand as EventListener)
  }

  static styles = css`
    :host { display: block; min-width: 0; height: 100%; overflow: auto; }
    :host(:focus-visible) { outline: 2px solid var(--zoo-tree-focus-color, #2563eb); outline-offset: -2px; }
    slot { display: block; padding: var(--zoo-tree-padding, 0.25rem); }
  `

  connectedCallback() {
    super.connectedCallback()
    this.setAttribute('role', 'tree')
    if (
      !this.hasAttribute('aria-label') &&
      !this.hasAttribute('aria-labelledby')
    ) {
      this.setAttribute('aria-label', 'Features')
    }
    this.observer.observe(this, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['node-id', 'slot'],
    })
    this.requestUpdate()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.observer.disconnect()
    for (const row of this.managed) this.release(row)
    this.managed.clear()
    this.focusOwner = undefined
  }

  protected updated() {
    this.sync()
  }

  private release(row: ZooFeatureTreeRow) {
    row.treeItem = false
    row.appearance = 'default'
    row.depth = 0
    row.guides = []
    row.hidden = false
    for (const name of [
      'role',
      'tabindex',
      'aria-label',
      'aria-selected',
      'aria-expanded',
      'aria-disabled',
      'aria-level',
      'aria-posinset',
      'aria-setsize',
    ])
      row.removeAttribute(name)
  }

  /** The full visible projection, including rows not currently mounted. */
  get visibleNodes(): readonly FeatureTreeEntry[] {
    return this.model.visible
  }

  private sync = (records?: readonly MutationRecord[] | Event) => {
    if (!this.isConnected) return
    const previous = this.model
    const previousRow = this.active ? this.rows.get(this.active) : undefined
    const root = this.getRootNode() as Document | ShadowRoot
    let deepFocus = this.ownerDocument.activeElement
    while (deepFocus?.shadowRoot?.activeElement)
      deepFocus = deepFocus.shadowRoot.activeElement
    const orphanedFocus =
      deepFocus === this.ownerDocument.body ||
      (root instanceof ShadowRoot &&
        !root.activeElement &&
        deepFocus === root.host)
    const removedFocusOwner =
      !!this.focusOwner && !this.contains(this.focusOwner) && orphanedFocus
    const movedFocusOwner =
      orphanedFocus &&
      !!this.focusOwner &&
      this.contains(this.focusOwner) &&
      Array.isArray(records) &&
      records.some((record) =>
        [...record.removedNodes].some(
          (node) => node === this.focusOwner || node.contains(this.focusOwner!)
        )
      )
    const focused =
      root.activeElement === this ||
      removedFocusOwner ||
      (!!previousRow &&
        ((!!root.activeElement &&
          (root.activeElement === previousRow ||
            previousRow.contains(root.activeElement))) ||
          (!this.contains(previousRow) && orphanedFocus)))

    // DOM reconciliation identifies mounted views only; it never determines hierarchy.
    this.model = buildFeatureTreeModel(this.nodes, this.expandedIds)
    const visible = new Set(this.model.visible.map((entry) => entry.id))
    const selected = new Set(this.selectedIds)
    const rows = new Map<string, ZooFeatureTreeRow>()
    const managed = new Set<ZooFeatureTreeRow>()
    for (const child of this.children) {
      if (!(child instanceof ZooFeatureTreeRow) || child.slot !== '') continue
      managed.add(child)
      const entry = this.model.entries.get(child.nodeId)
      if (!entry) {
        child.hidden = true
        continue
      }
      rows.set(entry.id, child)
      child.treeItem = true
      child.appearance = this.appearance
      child.depth = entry.depth
      child.guides = entry.guides
      child.label = entry.label
      child.disabled = !!entry.disabled
      child.hidden = !visible.has(entry.id)
      child.selected = selected.has(entry.id)
      child.expanded = entry.childIds.length
        ? this.expandedIds.includes(entry.id)
        : undefined
      child.setAttribute('role', 'treeitem')
      child.setAttribute('aria-label', entry.label)
      child.setAttribute('aria-selected', String(child.selected))
      child.setAttribute('aria-disabled', String(child.disabled))
      child.setAttribute('aria-level', String(entry.depth + 1))
      child.setAttribute('aria-posinset', String(entry.posInSet))
      child.setAttribute('aria-setsize', String(entry.setSize))
      if (child.expanded === undefined) child.removeAttribute('aria-expanded')
      else child.setAttribute('aria-expanded', String(child.expanded))
    }
    for (const row of this.managed) if (!managed.has(row)) this.release(row)
    this.rows = rows
    this.managed = managed
    this.setAttribute('aria-multiselectable', String(this.multiselect))

    if (!this.active || !visible.has(this.active)) {
      // Prefer a surviving visible ancestor when a logical branch disappears.
      let ancestor = this.active
        ? previous.entries.get(this.active)?.parentId
        : undefined
      while (ancestor && !visible.has(ancestor))
        ancestor = previous.entries.get(ancestor)?.parentId
      this.active =
        ancestor ??
        this.model.visible.find((entry) => selected.has(entry.id))?.id ??
        this.model.visible[0]?.id
      this.pendingFocus = undefined
      if (focused) this.focusActive()
    } else if (this.pendingFocus && focused && rows.has(this.pendingFocus)) {
      this.focusActive()
    } else if (removedFocusOwner && focused) this.focusActive()
    else if (movedFocusOwner) this.focusOwner?.focus()
    if (!focused) this.pendingFocus = undefined
    this.updateTabStops()
  }

  private updateTabStops() {
    const mounted = this.active ? this.rows.get(this.active) : undefined
    if (mounted && !mounted.hidden) this.removeAttribute('tabindex')
    else this.tabIndex = 0
    for (const [id, row] of this.rows)
      this.setTabStop(row, id === this.active && !row.hidden)
  }

  private focusActive() {
    const row = this.active ? this.rows.get(this.active) : undefined
    if (row && !row.hidden) {
      this.pendingFocus = undefined
      this.setTabStop(row, true)
      row.focus()
      row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    } else this.focus()
  }

  private eventRow(event: Event) {
    return event
      .composedPath()
      .find(
        (element): element is ZooFeatureTreeRow =>
          element instanceof ZooFeatureTreeRow && this.managed.has(element)
      )
  }

  // Negative tabindex on a shadow host suppresses its slotted descendants in
  // sequential focus navigation. Inactive hosts must omit the attribute.
  private setTabStop(row: ZooFeatureTreeRow, active: boolean) {
    if (active) row.tabIndex = 0
    else row.removeAttribute('tabindex')
  }

  private moveFocus(nodeId: string) {
    this.active = nodeId
    this.updateTabStops()
    this.focusActive()
    if (!this.rows.has(nodeId)) {
      this.pendingFocus = nodeId
      // A windowed renderer can mount the requested row, then sync restores focus.
      this.dispatchEvent(
        new CustomEvent<FeatureTreeRowEventDetail>('zoo-focus-request', {
          detail: { nodeId },
          bubbles: true,
          composed: true,
        })
      )
    }
  }

  private onFocusIn = (event: FocusEvent) => {
    const row = this.eventRow(event)
    if (!row) return
    this.focusOwner = event.composedPath()[0] as HTMLElement
    if (row.nodeId === this.active) return
    this.active = row.nodeId
    this.updateTabStops()
  }

  private requestSelection(row: FeatureTreeNode) {
    if (row.disabled) return
    const selectedIds = this.multiselect
      ? this.selectedIds.includes(row.id)
        ? this.selectedIds.filter((id) => id !== row.id)
        : [...this.selectedIds, row.id]
      : [row.id]
    this.dispatchEvent(
      new CustomEvent<FeatureTreeSelectionDetail>('zoo-selection-change', {
        detail: { nodeId: row.id, selectedIds },
        bubbles: true,
        composed: true,
      })
    )
  }

  private onSelect = (event: CustomEvent<FeatureTreeRowEventDetail>) => {
    const row = this.eventRow(event)
    if (row) {
      this.moveFocus(row.nodeId)
      const entry = this.model.entries.get(row.nodeId)
      if (entry) this.requestSelection(entry)
    }
  }

  private onExpand = (event: CustomEvent<FeatureTreeRowExpandDetail>) => {
    // Expansion remains controlled. The row event passes through to the consumer.
    const row = this.eventRow(event)
    if (row) this.moveFocus(row.nodeId)
  }

  private requestExpansion(row: FeatureTreeEntry, expanded: boolean) {
    if (row.disabled || !row.childIds.length) return
    this.dispatchEvent(
      new CustomEvent<FeatureTreeRowExpandDetail>('zoo-expand', {
        detail: { nodeId: row.id, expanded },
        bubbles: true,
        composed: true,
      })
    )
  }

  get focusedNodeId(): string | undefined {
    return this.active
  }

  private availableActions(row: ZooFeatureTreeRow) {
    return row.actionElements().filter((element) => {
      if (
        element.matches(':disabled, [aria-disabled="true"]') ||
        element.closest('[hidden], [inert]')
      )
        return false
      for (
        let parent: HTMLElement | null = element;
        parent && parent !== row;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent)
        if (style.display === 'none' || style.visibility === 'hidden')
          return false
      }
      return true
    })
  }

  /** Enter/cycle enabled actions on the focused row. Safe for registry commands. */
  focusActions(): boolean {
    const row = this.active ? this.rows.get(this.active) : undefined
    if (!row) return false
    const actions = this.availableActions(row)
    if (!actions.length) return false
    const root = this.getRootNode() as Document | ShadowRoot
    const index = actions.findIndex(
      (element) =>
        element === root.activeElement || element.contains(root.activeElement)
    )
    actions[(index + 1) % actions.length].focus()
    return true
  }

  focusRow(): boolean {
    if (!this.active || !this.model.entries.has(this.active)) return false
    this.moveFocus(this.active)
    return true
  }

  requestContextMenu(): boolean {
    const row = this.active ? this.rows.get(this.active) : undefined
    if (!row || row.disabled) return false
    const rect = row.getBoundingClientRect()
    row.dispatchEvent(
      new CustomEvent('zoo-context-menu', {
        detail: { nodeId: row.nodeId, clientX: rect.left, clientY: rect.top },
        bubbles: true,
        composed: true,
      })
    )
    return true
  }

  private shortcutAction(event: KeyboardEvent): FeatureTreeAction | undefined {
    if (this.shortcuts === false) return undefined
    return (Object.keys(defaultShortcuts) as FeatureTreeAction[]).find(
      (action) =>
        (
          (this.shortcuts && this.shortcuts[action]) ||
          defaultShortcuts[action]
        ).some(
          (binding) =>
            event.key === binding.key &&
            event.shiftKey === !!binding.shift &&
            event.ctrlKey === !!binding.ctrl &&
            event.altKey === !!binding.alt &&
            event.metaKey === !!binding.meta
        )
    )
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return
    const row = this.eventRow(event)
    const nodeId =
      row?.nodeId ?? (event.target === this ? this.active : undefined)
    if (!nodeId) return
    const fromAction = event
      .composedPath()
      .some(
        (element) =>
          element instanceof HTMLElement &&
          element !== row &&
          element.matches(
            'button, a[href], input, select, textarea, [contenteditable]:not([contenteditable="false"])'
          )
      )
    const fromEditable = event
      .composedPath()
      .some(
        (element) =>
          element instanceof HTMLElement &&
          element.matches(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
          )
      )
    // Printable input belongs to the editor even if an optional shortcut uses it.
    if (
      fromEditable &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    )
      return
    const action = this.shortcutAction(event)
    if (
      action &&
      (action === 'focusActions' ||
        (action === 'focusRow' ? fromAction : !fromAction))
    ) {
      if (this[action]()) event.preventDefault()
      return
    }
    if (fromAction) return
    const visible = this.model.visible
    const index = visible.findIndex((entry) => entry.id === nodeId)
    const entry = visible[index]
    if (!entry) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    let next: string | undefined
    const rtl = getComputedStyle(this).direction === 'rtl'
    const key =
      rtl && event.key === 'ArrowLeft'
        ? 'ArrowRight'
        : rtl && event.key === 'ArrowRight'
          ? 'ArrowLeft'
          : event.key
    switch (key) {
      case 'ArrowDown':
        next = visible[Math.min(index + 1, visible.length - 1)]?.id
        break
      case 'ArrowUp':
        next = visible[Math.max(index - 1, 0)]?.id
        break
      case 'Home':
        next = visible[0]?.id
        break
      case 'End':
        next = visible.at(-1)?.id
        break
      case 'ArrowRight':
        if (entry.childIds.length && !this.expandedIds.includes(entry.id))
          this.requestExpansion(entry, true)
        else next = entry.childIds[0]
        break
      case 'ArrowLeft':
        if (entry.childIds.length && this.expandedIds.includes(entry.id))
          this.requestExpansion(entry, false)
        else next = entry.parentId
        break
      case 'Enter':
      case ' ':
        this.requestSelection(entry)
        break
      default: {
        if (event.key.length !== 1 || event.key.trim() === '') return
        const now = Date.now()
        this.search =
          now - this.searchTime > 700 ? event.key : this.search + event.key
        this.searchTime = now
        const query = this.search.toLocaleLowerCase()
        const repeated = [...query].every((character) => character === query[0])
        const prefix = repeated ? query[0] : query
        // Further characters refine the current match; repeated letters cycle matches.
        const start = repeated ? index + 1 : index
        next = Array.from(
          { length: visible.length },
          (_, offset) => visible[(start + offset) % visible.length]
        ).find((candidate) =>
          candidate.label.toLocaleLowerCase().startsWith(prefix)
        )?.id
      }
    }
    event.preventDefault()
    if (next) this.moveFocus(next)
  }

  render() {
    return html`<slot @slotchange=${this.sync}></slot>`
  }
}

export function registerFeatureTree() {
  registerFeatureTreeRow()
  if (!customElements.get('zoo-feature-tree'))
    customElements.define('zoo-feature-tree', ZooFeatureTree)
}

declare global {
  interface HTMLElementTagNameMap {
    'zoo-feature-tree': ZooFeatureTree
  }
}

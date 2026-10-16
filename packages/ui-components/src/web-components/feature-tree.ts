import { LitElement, css, html } from 'lit'
import { registerFeatureTreeRow, ZooFeatureTreeRow } from './feature-tree-row'
import type {
  FeatureTreeAppearance,
  FeatureTreeRowEventDetail,
  FeatureTreeRowExpandDetail,
} from './feature-tree-row'

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

/** Parsed DOM hierarchy. Only direct rows and rows in a parent's children slot participate. */
interface TreeEntry {
  row: ZooFeatureTreeRow
  parent: TreeEntry | undefined
  children: TreeEntry[]
}

/**
 * A controlled, composable tree. Rows are supplied as DOM so any framework can
 * populate their slots. This element owns focus, never the app's selected or
 * expanded state. Node IDs must be non-empty and unique within this tree.
 */
export class ZooFeatureTree extends LitElement {
  static properties = {
    selectedIds: { attribute: false },
    expandedIds: { attribute: false },
    multiselect: { type: Boolean },
    appearance: { type: String, reflect: true },
    shortcuts: { attribute: false },
  }

  declare selectedIds: readonly string[]
  declare expandedIds: readonly string[]
  declare multiselect: boolean
  declare appearance: FeatureTreeAppearance
  /** Partial replacements; [] disables one action, false disables all optional shortcuts. */
  declare shortcuts: FeatureTreeShortcuts | false
  private entries: TreeEntry[] = []
  private visible: TreeEntry[] = []
  private active: ZooFeatureTreeRow | undefined
  private focusOwner: HTMLElement | undefined
  private managed = new Set<ZooFeatureTreeRow>()
  private observer = new MutationObserver((records) => this.sync(records))
  private search = ''
  private searchTime = 0

  constructor() {
    super()
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
      attributeFilter: ['node-id', 'label', 'disabled', 'slot'],
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
    row.nested = false
    row.lastSibling = false
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

  private sync = (records?: readonly MutationRecord[] | Event) => {
    if (!this.isConnected) return
    const previousEntries = this.entries
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
      (!!this.active &&
        ((!!root.activeElement &&
          (root.activeElement === this.active ||
            this.active.contains(root.activeElement))) ||
          (!this.contains(this.active) && orphanedFocus)))
    const read = (element: Element, parent?: TreeEntry): TreeEntry[] =>
      [...element.children]
        .filter(
          (child): child is ZooFeatureTreeRow =>
            child instanceof ZooFeatureTreeRow &&
            (parent ? child.slot === 'children' : child.slot === '')
        )
        .map((row) => {
          const entry: TreeEntry = { row, parent, children: [] }
          entry.children = read(row, entry)
          return entry
        })
    const roots = read(this)
    const all: TreeEntry[] = []
    const visible: TreeEntry[] = []
    const visit = (siblings: TreeEntry[], level: number, shown: boolean) => {
      siblings.forEach((entry, index) => {
        const { row, children } = entry
        all.push(entry)
        row.treeItem = true
        row.appearance = this.appearance
        row.nested = level > 1
        row.lastSibling = index === siblings.length - 1
        row.selected = this.selectedIds.includes(row.nodeId)
        row.expanded = children.length
          ? this.expandedIds.includes(row.nodeId)
          : undefined
        row.setAttribute('role', 'treeitem')
        row.setAttribute('aria-label', row.label)
        row.setAttribute('aria-selected', String(row.selected))
        row.setAttribute('aria-disabled', String(row.disabled))
        row.setAttribute('aria-level', String(level))
        row.setAttribute('aria-posinset', String(index + 1))
        row.setAttribute('aria-setsize', String(siblings.length))
        if (row.expanded === undefined) row.removeAttribute('aria-expanded')
        else row.setAttribute('aria-expanded', String(row.expanded))
        if (shown) visible.push(entry)
        visit(children, level + 1, shown && row.expanded === true)
      })
    }
    visit(roots, 1, true)
    const managed = new Set(all.map(({ row }) => row))
    for (const row of this.managed) if (!managed.has(row)) this.release(row)
    this.managed = managed
    this.entries = all
    this.visible = visible
    this.setAttribute('aria-multiselectable', String(this.multiselect))
    if (visible.length) this.removeAttribute('tabindex')
    else this.tabIndex = 0

    if (!visible.some(({ row }) => row === this.active)) {
      // Collapsing/removing a focused subtree returns focus to its nearest visible ancestor.
      let ancestor = previousEntries.find(
        ({ row }) => row === this.active
      )?.parent
      while (ancestor && !visible.some(({ row }) => row === ancestor?.row))
        ancestor = ancestor.parent
      this.active =
        ancestor?.row ??
        visible.find(({ row }) => row.selected)?.row ??
        visible[0]?.row
      if (focused) (this.active ?? this).focus()
    } else if (removedFocusOwner) this.active?.focus()
    else if (movedFocusOwner) this.focusOwner?.focus()
    for (const { row } of all) this.setTabStop(row, row === this.active)
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

  private moveFocus(row: ZooFeatureTreeRow) {
    this.active = row
    for (const entry of this.entries)
      this.setTabStop(entry.row, entry.row === row)
    row.focus()
    row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  private onFocusIn = (event: FocusEvent) => {
    const row = this.eventRow(event)
    if (row) this.focusOwner = event.composedPath()[0] as HTMLElement
    if (!row || row === this.active) return
    this.active = row
    for (const entry of this.entries)
      this.setTabStop(entry.row, entry.row === row)
  }

  private requestSelection(row: ZooFeatureTreeRow) {
    if (row.disabled) return
    const selectedIds = this.multiselect
      ? this.selectedIds.includes(row.nodeId)
        ? this.selectedIds.filter((id) => id !== row.nodeId)
        : [...this.selectedIds, row.nodeId]
      : [row.nodeId]
    this.dispatchEvent(
      new CustomEvent<FeatureTreeSelectionDetail>('zoo-selection-change', {
        detail: { nodeId: row.nodeId, selectedIds },
        bubbles: true,
        composed: true,
      })
    )
  }

  private onSelect = (event: CustomEvent<FeatureTreeRowEventDetail>) => {
    const row = this.eventRow(event)
    if (row) {
      this.moveFocus(row)
      this.requestSelection(row)
    }
  }

  private onExpand = (event: CustomEvent<FeatureTreeRowExpandDetail>) => {
    // Expansion remains controlled. The row event passes through to the consumer.
    const row = this.eventRow(event)
    if (row) this.moveFocus(row)
  }

  private requestExpansion(row: ZooFeatureTreeRow, expanded: boolean) {
    if (row.disabled || row.expanded === undefined) return
    this.dispatchEvent(
      new CustomEvent<FeatureTreeRowExpandDetail>('zoo-expand', {
        detail: { nodeId: row.nodeId, expanded },
        bubbles: true,
        composed: true,
      })
    )
  }

  get focusedNodeId(): string | undefined {
    return this.active?.nodeId
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
    if (!this.active || !this.managed.has(this.active)) return false
    const actions = this.availableActions(this.active)
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
    if (!this.active || !this.managed.has(this.active)) return false
    this.moveFocus(this.active)
    return true
  }

  requestContextMenu(): boolean {
    const row = this.active
    if (!row || !this.managed.has(row) || row.disabled) return false
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
    if (!row) return
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
    const index = this.visible.findIndex((entry) => entry.row === row)
    const entry = this.visible[index]
    if (!entry) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    let next: ZooFeatureTreeRow | undefined
    const rtl = getComputedStyle(this).direction === 'rtl'
    const key =
      rtl && event.key === 'ArrowLeft'
        ? 'ArrowRight'
        : rtl && event.key === 'ArrowRight'
          ? 'ArrowLeft'
          : event.key
    switch (key) {
      case 'ArrowDown':
        next = this.visible[Math.min(index + 1, this.visible.length - 1)]?.row
        break
      case 'ArrowUp':
        next = this.visible[Math.max(index - 1, 0)]?.row
        break
      case 'Home':
        next = this.visible[0]?.row
        break
      case 'End':
        next = this.visible.at(-1)?.row
        break
      case 'ArrowRight':
        if (row.expanded === false) this.requestExpansion(row, true)
        else if (row.expanded) next = entry.children[0]?.row
        break
      case 'ArrowLeft':
        if (row.expanded) this.requestExpansion(row, false)
        else next = entry.parent?.row
        break
      case 'Enter':
      case ' ':
        this.requestSelection(row)
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
          { length: this.visible.length },
          (_, offset) =>
            this.visible[(start + offset) % this.visible.length].row
        ).find((candidate) =>
          candidate.label.toLocaleLowerCase().startsWith(prefix)
        )
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

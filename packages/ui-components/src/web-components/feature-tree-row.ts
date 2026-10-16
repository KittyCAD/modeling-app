import { LitElement, css, html, nothing, type PropertyValues } from 'lit'

/** The row identifies intent; the host application decides how to change state. */
export interface FeatureTreeRowEventDetail {
  nodeId: string
}

export interface FeatureTreeRowExpandDetail extends FeatureTreeRowEventDetail {
  expanded: boolean
}

export type FeatureTreeAppearance = 'default' | 'hud'

export interface FeatureTreeContextMenuDetail
  extends FeatureTreeRowEventDetail {
  clientX: number
  clientY: number
}

/**
 * Controlled presentation for one feature. This is a row building block, not a
 * complete ARIA tree: its container owns navigation and tree semantics.
 *
 * Slots: disclosure-icon, icon, label, detail, status, actions, children.
 * Give icon-only actions accessible names. Slotted actions own their disabled
 * state and dispatch their own events.
 */
export class ZooFeatureTreeRow extends LitElement {
  static properties = {
    nodeId: { type: String, attribute: 'node-id' },
    label: { type: String },
    detail: { type: String },
    selected: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    expanded: { attribute: false },
    treeItem: { type: Boolean, attribute: false },
    appearance: { type: String, reflect: true },
    nested: { type: Boolean, reflect: true },
    lastSibling: { type: Boolean, attribute: 'last-sibling', reflect: true },
  }

  declare nodeId: string
  declare label: string
  declare detail: string
  declare selected: boolean
  declare disabled: boolean
  /** Undefined means leaf; false/true means collapsed/expanded branch. */
  declare expanded: boolean | undefined
  /** Set by zoo-feature-tree, not by consumers. */
  declare treeItem: boolean
  declare appearance: FeatureTreeAppearance
  /** Hierarchy metadata supplied by the tree for connector geometry. */
  declare nested: boolean
  declare lastSibling: boolean
  private actionTabIndices = new Map<HTMLElement, string | null>()

  focus(options?: FocusOptions) {
    if (this.treeItem) this.tabIndex = 0
    super.focus(options)
  }

  constructor() {
    super()
    this.nodeId = ''
    this.label = ''
    this.detail = ''
    this.selected = false
    this.disabled = false
    this.expanded = undefined
    this.treeItem = false
    this.appearance = 'default'
    this.nested = false
    this.lastSibling = false
  }

  static styles = css`
    :host {
      display: block;
      min-width: 0;
      color: var(--zoo-tree-color, #242b35);
      font: var(--zoo-tree-font, 400 0.875rem/1.4 system-ui, sans-serif);
    }

    [part='row'] {
      display: flex;
      align-items: center;
      gap: var(--zoo-tree-gap, 0.375rem);
      min-height: var(--zoo-tree-row-height, 2rem);
      padding: var(--zoo-tree-row-padding, 0.125rem 0.375rem);
      border-radius: var(--zoo-tree-radius, 0.25rem);
      background: var(--zoo-tree-background, transparent);
    }

    :host(:not([disabled])) [part='row']:hover {
      background: var(--zoo-tree-hover-background, #edf0f4);
    }

    :host([selected]) [part='row'],
    :host([selected]:not([disabled])) [part='row']:hover {
      background: var(--zoo-tree-selected-background, #dce9ff);
      color: var(--zoo-tree-selected-color, inherit);
    }

    button {
      appearance: none;
      border: 0;
      margin: 0;
      border-radius: var(--zoo-tree-radius, 0.25rem);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }

    button:focus-visible, :host(:focus-visible) [part='row'] {
      outline: 2px solid var(--zoo-tree-focus-color, #2563eb);
      outline-offset: -2px;
    }
    :host([role='treeitem']:focus) { outline: none; }

    button:disabled {
      cursor: default;
      opacity: 0.5;
    }

    [part='disclosure'], .disclosure-space {
      box-sizing: border-box;
      flex: 0 0 1.5rem;
      width: 1.5rem;
      height: var(--zoo-tree-disclosure-height, 1.5rem);
      padding: 0;
      text-align: center;
    }

    [part='content'] {
      display: flex;
      align-items: center;
      gap: var(--zoo-tree-gap, 0.375rem);
      flex: 1;
      min-width: 0;
      align-self: stretch;
      padding: var(--zoo-tree-content-padding, 0.25rem 0);
    }

    .disclosure-icon { display: grid; place-items: center; }
    .disclosure-icon.closed { transform: rotate(-90deg); }
    :host(:dir(rtl)) .disclosure-icon.closed { transform: rotate(90deg); }
    slot[name='disclosure-icon']::slotted(*) { width: 1.25rem; height: 1.25rem; }

    [part='label'], [part='detail'] {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    [part='label'] { flex: 0 1 auto; min-width: 0; }
    [part='detail'] { flex: 0 2 auto; min-width: 0; color: var(--zoo-tree-muted-color, #596372); }
    [part='status'], [part='actions'] { display: flex; align-items: center; flex-shrink: 0; }
    slot[name='icon']::slotted(*) { width: 1.25rem; height: 1.25rem; flex-shrink: 0; }
    [part='actions'] { gap: var(--zoo-tree-gap, 0.375rem); }
    [part='children'] { margin-inline-start: var(--zoo-tree-indent, 1rem); min-width: 0; }
    :host([aria-disabled='true']) [part='content'] { opacity: 0.5; }
    :host([role='treeitem']) [part='content'] { cursor: pointer; }

    .connector, .continuation { display: none; pointer-events: none; }
    :host([appearance='hud']) [part='row'] {
      position: relative;
      border-radius: 0;
      padding-inline: 0.25rem;
      min-height: var(--zoo-tree-row-height, 1.75rem);
      background: transparent;
    }
    :host([appearance='hud']:not([disabled])) [part='row']:hover {
      background: var(--zoo-tree-hover-background, rgb(110 145 180 / 0.08));
    }
    :host([appearance='hud'][selected]) [part='row'],
    :host([appearance='hud'][selected]:not([disabled])) [part='row']:hover {
      background: var(--zoo-tree-selected-background, rgb(80 140 220 / 0.12));
    }
    :host([appearance='hud']) [part='disclosure'],
    :host([appearance='hud']) .disclosure-space {
      position: relative;
      flex-basis: 0.75rem;
      width: 0.75rem;
    }
    :host([appearance='hud']) [part='disclosure'] { display: grid; place-items: center; }
    .junction {
      display: block; box-sizing: border-box;
      width: var(--zoo-tree-junction-size, 0.375rem);
      height: var(--zoo-tree-junction-size, 0.375rem);
      border-radius: var(--zoo-tree-junction-radius, 50%);
      color: var(--zoo-tree-junction-color, var(--zoo-tree-guide-color, #8a9aaa));
      border: var(--zoo-tree-guide-width, 1px) solid currentColor;
    }
    .junction.closed { background: currentColor; }
    :host([appearance='hud']) [part='children'] {
      margin-inline-start: 0.625rem;
    }
    :host([appearance='hud']) [part='row'].open::after {
      content: ''; position: absolute;
      inset-inline-start: calc(0.625rem - var(--zoo-tree-guide-width, 1px) / 2);
      inset-block-start: calc(50% + var(--zoo-tree-junction-size, 0.375rem) / 2);
      inset-block-end: 0; pointer-events: none;
      border-inline-start: var(--zoo-tree-guide-width, 1px) solid var(--zoo-tree-guide-color, #8a9aaa);
    }
    :host([appearance='hud'][nested]) {
      display: grid;
      grid-template-columns: var(--zoo-tree-indent, 0.75rem) minmax(0, 1fr);
      grid-template-rows: auto auto;
    }
    :host([appearance='hud'][nested]) [part='row'] { grid-column: 2; grid-row: 1; }
    :host([appearance='hud'][nested]) [part='children'] { grid-column: 2; grid-row: 2; }
    :host([appearance='hud'][nested]) .connector {
      display: block; grid-column: 1; grid-row: 1; position: relative;
    }
    :host([appearance='hud'][nested]) .connector::before {
      content: ''; position: absolute;
      inset-inline-start: calc(var(--zoo-tree-guide-width, 1px) / -2); inset-block: 0;
      border-inline-start: var(--zoo-tree-guide-width, 1px) solid var(--zoo-tree-guide-color, #8a9aaa);
    }
    :host([appearance='hud'][nested][last-sibling]) .connector::before { inset-block-end: 50%; }
    :host([appearance='hud'][nested]) .connector::after {
      content: ''; position: absolute; inset-inline: 0;
      inset-block-start: calc(50% - var(--zoo-tree-guide-width, 1px) / 2);
      border-block-start: var(--zoo-tree-guide-width, 1px) solid var(--zoo-tree-guide-color, #8a9aaa);
    }
    :host([appearance='hud'][nested]) [part='row']::before {
      content: ''; position: absolute; inset-inline-start: 0; width: 0.625rem;
      inset-block-start: calc(50% - var(--zoo-tree-guide-width, 1px) / 2); pointer-events: none;
      border-block-start: var(--zoo-tree-guide-width, 1px) solid var(--zoo-tree-guide-color, #8a9aaa);
    }
    :host([appearance='hud'][nested]) [part='row'].branch::before {
      width: calc(0.625rem - var(--zoo-tree-junction-size, 0.375rem) / 2);
    }
    :host([appearance='hud'][nested]:not([last-sibling])) .continuation {
      display: block; grid-column: 1; grid-row: 2;
      margin-inline-start: calc(var(--zoo-tree-guide-width, 1px) / -2);
      border-inline-start: var(--zoo-tree-guide-width, 1px) solid var(--zoo-tree-guide-color, #8a9aaa);
    }
  `

  /** Keep supplementary actions out of the tree's single Tab stop. F2 enters them. */
  actionElements(): HTMLElement[] {
    const slot = this.shadowRoot?.querySelector<HTMLSlotElement>(
      'slot[name="actions"]'
    )
    const selector =
      'button, a[href], input, select, textarea, [tabindex], [contenteditable]:not([contenteditable="false"])'
    return (slot?.assignedElements() ?? []).flatMap((element) => [
      ...(element.matches(selector) ? [element as HTMLElement] : []),
      ...element.querySelectorAll<HTMLElement>(selector),
    ])
  }

  private syncActions() {
    for (const [element, tabIndex] of this.actionTabIndices) {
      if (!this.treeItem || !this.contains(element)) {
        if (tabIndex === null) element.removeAttribute('tabindex')
        else element.setAttribute('tabindex', tabIndex)
        this.actionTabIndices.delete(element)
      }
    }
    if (this.treeItem) {
      for (const element of this.actionElements()) {
        if (!this.actionTabIndices.has(element)) {
          this.actionTabIndices.set(element, element.getAttribute('tabindex'))
        }
        element.tabIndex = -1
      }
    }
  }

  protected updated(changed: PropertyValues) {
    if (changed.has('treeItem')) this.syncActions()
    if (this.treeItem && changed.has('label'))
      this.setAttribute('aria-label', this.label)
  }

  private requestSelection() {
    if (this.disabled) return
    if (this.treeItem) this.focus()
    this.dispatchEvent(
      new CustomEvent<FeatureTreeRowEventDetail>('zoo-select', {
        detail: { nodeId: this.nodeId },
        bubbles: true,
        composed: true,
      })
    )
  }

  private requestExpansion() {
    if (this.disabled) return
    if (this.treeItem) this.focus()
    this.dispatchEvent(
      new CustomEvent<FeatureTreeRowExpandDetail>('zoo-expand', {
        detail: { nodeId: this.nodeId, expanded: !this.expanded },
        bubbles: true,
        composed: true,
      })
    )
  }

  private requestContextMenu(event: MouseEvent) {
    if (this.disabled) return
    event.preventDefault()
    this.dispatchEvent(
      new CustomEvent<FeatureTreeContextMenuDetail>('zoo-context-menu', {
        detail: {
          nodeId: this.nodeId,
          clientX: event.clientX,
          clientY: event.clientY,
        },
        bubbles: true,
        composed: true,
      })
    )
  }

  private content() {
    return html`
      <slot name="icon" aria-hidden="true"></slot>
      <span part="label" title=${this.label}><slot name="label">${this.label}</slot></span>
      <span part="detail" title=${this.detail}><slot name="detail">${this.detail || nothing}</slot></span>
    `
  }

  render() {
    return html`
      <span class="connector" aria-hidden="true"></span>
      <div part="row" class=${`${this.expanded !== undefined ? 'branch' : ''} ${this.expanded ? 'open' : ''}`}>
        ${
          this.expanded === undefined
            ? html`<span class="disclosure-space" aria-hidden="true"></span>`
            : html`<button
              part="disclosure" type="button" ?disabled=${this.disabled}
              aria-label=${`${this.expanded ? 'Collapse' : 'Expand'} ${this.label}`}
              aria-expanded=${this.treeItem ? nothing : String(this.expanded)}
              tabindex=${this.treeItem ? -1 : 0}
              @click=${this.requestExpansion}
            ><span aria-hidden="true">${
              this.appearance === 'hud'
                ? html`<span part="junction" class=${`junction ${this.expanded ? '' : 'closed'}`}></span>`
                : html`<span class=${`disclosure-icon ${this.expanded ? '' : 'closed'}`}><slot name="disclosure-icon">▾</slot></span>`
            }</span></button>`
        }
        ${
          this.treeItem
            ? html`<span part="content" @click=${this.requestSelection}
              @contextmenu=${this.requestContextMenu}>${this.content()}</span>`
            : html`<button part="content" type="button" ?disabled=${this.disabled}
              aria-pressed=${String(this.selected)} @click=${this.requestSelection}
              @contextmenu=${this.requestContextMenu}>${this.content()}</button>`
        }
        <span part="status"><slot name="status"></slot></span>
        <span part="actions"><slot name="actions" @slotchange=${this.syncActions}></slot></span>
      </div>
      <span class="continuation" aria-hidden="true"></span>
      <div part="children" role=${this.treeItem ? 'group' : nothing}
        ?hidden=${!this.expanded}><slot name="children"></slot></div>
    `
  }
}

/** Explicit registration keeps importing the class free of registry mutations. */
export function registerFeatureTreeRow() {
  if (!customElements.get('zoo-feature-tree-row')) {
    customElements.define('zoo-feature-tree-row', ZooFeatureTreeRow)
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'zoo-feature-tree-row': ZooFeatureTreeRow
  }
}

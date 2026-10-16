import type { Meta, StoryObj } from '@storybook/web-components-vite'
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import {
  registerFeatureTree,
  type FeatureTreeSelectionDetail,
} from './feature-tree'
import type {
  FeatureTreeContextMenuDetail,
  FeatureTreeRowExpandDetail,
} from './feature-tree-row'

registerFeatureTree()

/** Example view data belongs to the story, not to the tree's framework-neutral API. */
type Feature = {
  id: string
  label: string
  detail?: string
  warning?: string
  disabled?: boolean
  children?: Feature[]
}

const features: Feature[] = [
  {
    id: 'origin',
    label: 'Origin',
    children: [
      { id: 'xy', label: 'XY plane' },
      { id: 'xz', label: 'XZ plane' },
      { id: 'yz', label: 'YZ plane' },
    ],
  },
  {
    id: 'housing',
    label: 'Housing',
    detail: 'Component',
    children: [
      {
        id: 'sketch',
        label: 'Sketch001',
        detail: 'XY plane',
        children: [
          {
            id: 'profile',
            label:
              'Housing perimeter profile with a deliberately long descriptive name',
            detail: 'Fully constrained',
          },
          {
            id: 'construction',
            label: 'Construction geometry',
            detail: '4 lines',
          },
        ],
      },
      { id: 'extrude', label: 'Extrude001', detail: '10 mm' },
      {
        id: 'fillet',
        label: 'Fillet001',
        detail: '2 mm',
        warning: 'Some edges could not be filleted',
      },
      {
        id: 'suppressed',
        label: 'Chamfer001',
        detail: 'Unavailable',
        disabled: true,
      },
    ],
  },
  {
    id: 'bracket',
    label: 'Mounting bracket',
    children: [
      { id: 'sketch2', label: 'Sketch002', detail: 'XZ plane' },
      { id: 'extrude2', label: 'Extrude002', detail: '5 mm' },
    ],
  },
]

const hebrewFeatures: Record<
  string,
  { label: string; detail?: string; warning?: string }
> = {
  origin: { label: 'ראשית הצירים' },
  xy: { label: 'מישור XY' },
  xz: { label: 'מישור XZ' },
  yz: { label: 'מישור YZ' },
  housing: { label: 'מארז', detail: 'רכיב' },
  sketch: { label: 'סקיצה 001', detail: 'מישור XY' },
  profile: {
    label: 'פרופיל היקף המארז עם שם תיאורי ארוך במיוחד',
    detail: 'מוגדר במלואו',
  },
  construction: { label: 'גאומטריית עזר', detail: '4 קווים' },
  extrude: { label: 'שיחול 001', detail: '10 מ״מ' },
  fillet: {
    label: 'עיגול פינות 001',
    detail: '2 מ״מ',
    warning: 'לא ניתן לעגל חלק מהקצוות',
  },
  suppressed: { label: 'פאזה 001', detail: 'לא זמין' },
  bracket: { label: 'תושבת הרכבה' },
  sketch2: { label: 'סקיצה 002', detail: 'מישור XZ' },
  extrude2: { label: 'שיחול 002', detail: '5 מ״מ' },
}

class FeatureTreeDemo extends LitElement {
  static properties = {
    dark: { type: Boolean },
    multiselect: { type: Boolean },
    narrow: { type: Boolean },
    hud: { type: Boolean },
    rtl: { type: Boolean },
    selected: { state: true },
    expanded: { state: true },
    hiddenIds: { state: true },
    message: { state: true },
  }
  declare dark: boolean
  declare multiselect: boolean
  declare narrow: boolean
  declare hud: boolean
  declare rtl: boolean
  private declare selected: string[]
  private declare expanded: string[]
  private declare hiddenIds: string[]
  private declare message: string

  constructor() {
    super()
    this.dark = false
    this.multiselect = false
    this.narrow = false
    this.hud = false
    this.rtl = false
    this.selected = ['extrude']
    this.expanded = ['housing', 'sketch']
    this.hiddenIds = []
    this.message = 'Ready'
  }

  static styles = css`
    :host { display: block; font: 0.875rem/1.5 system-ui, sans-serif; color: #242b35; }
    .frame {
      box-sizing: border-box; resize: both; overflow: hidden; width: 390px; height: 380px;
      min-width: 220px; min-height: 180px; max-width: 100%;
      display: flex; flex-direction: column; border: 1px solid #c4ccd7; border-radius: 0.5rem;
      background: #fff; color: #242b35;
    }
    .narrow { width: 240px; }
    .dark {
      background: #18212f; color: #ecf0f5; border-color: #526177;
      --zoo-tree-color: #ecf0f5; --zoo-tree-muted-color: #b6c1d0;
      --zoo-tree-hover-background: #29374b; --zoo-tree-selected-background: #284b77;
      --zoo-tree-focus-color: #9ac5ff;
    }
    header { padding: 0.65rem 0.75rem; border-bottom: 1px solid #8995a5; font-weight: 600; }
    zoo-feature-tree { flex: 1; min-height: 0; height: auto; }
    button {
      box-sizing: border-box; width: 1.5rem; height: 1.5rem; padding: 0; border: 1px solid transparent;
      border-radius: 0.25rem; color: inherit; background: transparent; cursor: pointer;
    }
    button:hover { border-color: currentColor; }
    button:focus-visible { outline: 2px solid var(--zoo-tree-focus-color, #2563eb); }
    p { max-width: 36rem; }
    output { display: block; margin-top: 0.75rem; }
    .warning { color: #8b4c00; }
    .dark .warning { color: #ffd580; }
    .scene {
      padding: 1rem; max-width: 42rem; overflow: hidden;
      background-color: #18212f;
      background-image: radial-gradient(ellipse at 85% 45%, rgb(95 130 160 / 0.22), transparent 65%),
        repeating-linear-gradient(0deg, transparent 0 31px, rgb(145 170 200 / 0.07) 31px 32px),
        repeating-linear-gradient(90deg, transparent 0 31px, rgb(145 170 200 / 0.07) 31px 32px);
    }
    .frame.hud {
      background: transparent; border: 0; border-radius: 0;
      --zoo-tree-hover-background: rgb(170 200 230 / 0.06);
      --zoo-tree-selected-background: rgb(130 180 240 / 0.14);
      --zoo-tree-guide-color: #71879e;
    }
    .hud header { border: 0; font-size: 0.6875rem; letter-spacing: 0.14em; text-transform: uppercase; }
  `

  private rows(nodes: Feature[], nested = false): TemplateResult {
    return html`${repeat(
      nodes,
      (node) => node.id,
      (feature) => {
        const node = this.rtl
          ? { ...feature, ...hebrewFeatures[feature.id] }
          : feature
        return html`
      <zoo-feature-tree-row slot=${nested ? 'children' : nothing}
        .nodeId=${node.id} .label=${node.label} .detail=${node.detail ?? ''} .disabled=${!!node.disabled}>
        ${this.hud ? nothing : html`<span slot="icon">${node.children ? '▱' : '◇'}</span>`}
        ${
          node.warning
            ? html`<span slot="status" class="warning" role="img"
          aria-label=${node.warning} title=${node.warning}>⚠</span>`
            : nothing
        }
        <button slot="actions" type="button" ?disabled=${!!node.disabled}
          aria-label=${`${this.hiddenIds.includes(node.id) ? (this.rtl ? 'הצגת' : 'Show') : this.rtl ? 'הסתרת' : 'Hide'} ${node.label}`}
          aria-pressed=${String(this.hiddenIds.includes(node.id))}
          @click=${() => {
            this.hiddenIds = this.hiddenIds.includes(node.id)
              ? this.hiddenIds.filter((id) => id !== node.id)
              : [...this.hiddenIds, node.id]
            this.message = `Visibility changed: ${node.label}`
          }}>${this.hiddenIds.includes(node.id) ? '○' : '◉'}</button>
        <button slot="actions" type="button" ?disabled=${!!node.disabled}
          aria-label=${`${this.rtl ? 'פעולות עבור' : 'Actions for'} ${node.label}`} @click=${() => {
            this.message = `Action menu requested: ${node.label}`
          }}>…</button>
        ${node.children ? this.rows(node.children, true) : nothing}
      </zoo-feature-tree-row>
    `
      }
    )}`
  }

  render() {
    return html`
      ${
        this.rtl
          ? html`<p dir="rtl" lang="he">אפשר לשנות את גודל התצוגה באמצעות גרירת הפינה.
        מקשי החצים מזיזים את המיקוד. חץ שמאלה פותח ענף וחץ ימינה סוגר אותו.
        רווח בוחר פריט. F2 מעביר לפעולות הפריט ו־Escape מחזיר לעץ.</p>`
          : html`<p>Drag the lower-right corner to resize. Use arrow keys, Home/End, and typing
        to move focus; Space/Enter to select. F2 enters or cycles row actions;
        Escape returns to the row. Shift+F10 requests a context menu.</p>`
      }
      <section class=${this.hud ? 'scene' : ''} dir=${this.rtl ? 'rtl' : 'ltr'} lang=${this.rtl ? 'he' : 'en'}>
      <div class=${`frame ${this.dark || this.hud ? 'dark' : ''} ${this.narrow ? 'narrow' : ''} ${this.hud ? 'hud' : ''}`}>
        <header>${this.rtl ? 'תכונות' : 'Features'}</header>
        <zoo-feature-tree aria-label=${this.rtl ? 'תכונות המודל' : 'Model features'} .selectedIds=${this.selected}
          .appearance=${this.hud ? 'hud' : 'default'}
          .expandedIds=${this.expanded} .multiselect=${this.multiselect}
          @zoo-selection-change=${(
            event: CustomEvent<FeatureTreeSelectionDetail>
          ) => {
            this.selected = [...event.detail.selectedIds]
            this.message = `Selected: ${this.selected.join(', ') || 'none'}`
          }}
          @zoo-expand=${(event: CustomEvent<FeatureTreeRowExpandDetail>) => {
            const { nodeId, expanded } = event.detail
            this.expanded = expanded
              ? [...this.expanded, nodeId]
              : this.expanded.filter((id) => id !== nodeId)
          }}
          @zoo-context-menu=${(
            event: CustomEvent<FeatureTreeContextMenuDetail>
          ) => {
            this.message = `Context menu requested: ${event.detail.nodeId}`
          }}>${this.rows(features)}</zoo-feature-tree>
      </div>
      </section>
      <output aria-live="polite">${this.rtl && this.message === 'Ready' ? 'מוכן' : this.message}</output>
    `
  }
}

if (!customElements.get('zoo-feature-tree-demo'))
  customElements.define('zoo-feature-tree-demo', FeatureTreeDemo)

const meta = {
  title: 'Feature Tree/Tree',
  component: 'zoo-feature-tree',
  render: () => html`<zoo-feature-tree-demo></zoo-feature-tree-demo>`,
} satisfies Meta
export default meta
type Story = StoryObj
export const Interactive: Story = {}
export const Narrow: Story = {
  render: () => html`<zoo-feature-tree-demo narrow></zoo-feature-tree-demo>`,
}
export const Dark: Story = {
  render: () => html`<zoo-feature-tree-demo dark></zoo-feature-tree-demo>`,
}
export const MultipleSelection: Story = {
  render: () =>
    html`<zoo-feature-tree-demo multiselect></zoo-feature-tree-demo>`,
}
export const HUD: Story = {
  render: () => html`<zoo-feature-tree-demo hud></zoo-feature-tree-demo>`,
}
export const HUDNarrow: Story = {
  render: () =>
    html`<zoo-feature-tree-demo hud narrow></zoo-feature-tree-demo>`,
}
export const HUDRightToLeft: Story = {
  render: () => html`<zoo-feature-tree-demo hud rtl></zoo-feature-tree-demo>`,
}

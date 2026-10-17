import type { Meta, StoryObj } from '@storybook/web-components-vite'
import { html } from 'lit'
import {
  registerFeatureTreeRow,
  type ZooFeatureTreeRow,
} from './feature-tree-row'

registerFeatureTreeRow()

interface RowArgs {
  label: string
  detail: string
  selected: boolean
  disabled: boolean
}

const meta = {
  title: 'Feature Tree/Row',
  component: 'zoo-feature-tree-row',
  args: { label: 'Extrude', detail: '10 mm', selected: false, disabled: false },
  render: (args) => html`
    <zoo-feature-tree-row node-id="extrude-1"
      .label=${args.label} .detail=${args.detail}
      .selected=${args.selected} .disabled=${args.disabled}
      style="max-width: 32rem"
    ><span slot="icon">◇</span></zoo-feature-tree-row>
  `,
} satisfies Meta<RowArgs>

export default meta
type Story = StoryObj<RowArgs>

export const Default: Story = {}
export const Selected: Story = { args: { selected: true } }
export const Disabled: Story = { args: { disabled: true } }

export const Composed: Story = {
  render: () => html`
    <zoo-feature-tree-row node-id="sketch-1" label="Sketch001" .expanded=${true}
      @zoo-expand=${(event: CustomEvent) => {
        ;(event.currentTarget as ZooFeatureTreeRow).expanded =
          event.detail.expanded
      }}
      @zoo-select=${(event: CustomEvent) => {
        ;(event.currentTarget as ZooFeatureTreeRow).selected = true
      }}
      style="max-width: 32rem"
    >
      <span slot="icon">▱</span>
      <span slot="detail">XY plane</span>
      <span slot="status" role="img" aria-label="Has a warning">⚠</span>
      <button slot="actions" type="button" aria-label="Hide Sketch001"
        aria-pressed="false" @click=${(event: Event) => {
          const button = event.currentTarget as HTMLButtonElement
          const hidden = button.getAttribute('aria-pressed') !== 'true'
          button.setAttribute('aria-pressed', String(hidden))
          button.setAttribute(
            'aria-label',
            `${hidden ? 'Show' : 'Hide'} Sketch001`
          )
        }}>◉</button>
      <button slot="actions" type="button" aria-label="More actions for Sketch001">…</button>
    </zoo-feature-tree-row>
  `,
}

export const DarkTheme: Story = {
  render: () => html`
    <div style="padding: 1rem; max-width: 32rem; background: #18212f;
      --zoo-tree-color: #ecf0f5; --zoo-tree-muted-color: #b6c1d0;
      --zoo-tree-hover-background: #29374b;
      --zoo-tree-selected-background: #284b77; --zoo-tree-focus-color: #9ac5ff;">
      <zoo-feature-tree-row label="Extrude" detail="10 mm" selected>
        <span slot="icon">◇</span>
      </zoo-feature-tree-row>
      <zoo-feature-tree-row label="Fillet" detail="2 mm">
        <span slot="icon">◔</span>
      </zoo-feature-tree-row>
    </div>
  `,
}

import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Button } from './Button'

const meta = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    children: 'Create project',
    onClick: fn(),
  },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Solid: Story = {}

export const Outline: Story = {
  args: {
    tone: 'neutral',
    emphasis: 'outline',
    children: 'Share workspace',
  },
}

export const Danger: Story = {
  args: {
    tone: 'danger',
    children: 'Delete project',
  },
}

export const WithVisuals: Story = {
  args: {
    emphasis: 'ghost',
    children: 'Add panel',
    leadingVisual: <span>+</span>,
    trailingVisual: <span>{'>'}</span>,
  },
}

export const Interactive: Story = {
  args: {
    children: 'Run action',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Run action' })

    await userEvent.click(button)
    await expect(args.onClick).toHaveBeenCalled()
  },
}

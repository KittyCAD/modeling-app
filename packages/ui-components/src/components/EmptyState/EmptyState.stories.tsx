import type { Meta, StoryObj } from '@storybook/react-vite'
import { EmptyState } from './EmptyState'

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EmptyState>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  args: {
    icon: '+',
    children: 'Start something new',
    action: <button type="button">Create document</button>,
  },
}
export const WithoutAction: Story = {
  args: { children: 'Nothing to show yet' },
}

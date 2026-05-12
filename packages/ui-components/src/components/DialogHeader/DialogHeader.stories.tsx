import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { DialogHeader } from './DialogHeader'

const meta = {
  title: 'Components/DialogHeader',
  component: DialogHeader,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    title: 'Offset Plane',
    onClose: () => {},
  },
} satisfies Meta<typeof DialogHeader>

export default meta

type Story = StoryObj<typeof meta>

function HeaderPreview({ title }: { title: string }) {
  const [closeCount, setCloseCount] = useState(0)

  return (
    <div className="relative flex w-80 flex-col overflow-hidden rounded border border-chalkboard-20 bg-chalkboard-10 shadow dark:border-chalkboard-70 dark:bg-chalkboard-100">
      <DialogHeader title={title} onClose={() => setCloseCount((n) => n + 1)} />
      <div className="px-3 py-4 text-xs text-chalkboard-70 dark:text-chalkboard-40">
        Close clicked {closeCount} times
      </div>
    </div>
  )
}

export const Default: Story = {
  render: () => <HeaderPreview title="Offset Plane" />,
}

export const LongTitle: Story = {
  render: () => (
    <HeaderPreview title="Create a very long command name that wraps cleanly" />
  ),
}

export const Dark: Story = {
  render: () => (
    <div className="dark">
      <HeaderPreview title="Shell" />
    </div>
  ),
}

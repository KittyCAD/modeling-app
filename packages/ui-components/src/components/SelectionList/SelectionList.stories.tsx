import type { Meta, StoryFn, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { SelectionList, type SelectionListItem } from './SelectionList'

const sampleItems: SelectionListItem[] = [
  {
    id: 'face-0',
    label: 'Face',
  },
  {
    id: 'edge-1',
    label: 'Edge',
  },
  {
    id: 'plane-0',
    label: 'Plane',
  },
]

const meta = {
  title: 'Components/SelectionList',
  component: SelectionList,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    items: [],
    onRemove: () => {},
  },
  decorators: [
    (Story: StoryFn) => (
      <div className="w-72 rounded border border-chalkboard-20 bg-chalkboard-10 p-3 text-chalkboard-100 dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-10">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SelectionList>

export default meta

type Story = StoryObj<typeof meta>

function StatefulSelectionList({
  initialItems,
  isActive = false,
}: {
  initialItems: SelectionListItem[]
  isActive?: boolean
}) {
  const [items, setItems] = useState(initialItems)

  return (
    <SelectionList
      heading="Profiles"
      emptyLabel="Select profiles or faces"
      hint="Pick from the scene to add to this collector."
      items={items}
      isActive={isActive}
      onRemove={(itemToRemove) =>
        setItems((currentItems) =>
          currentItems.filter((item) => item.id !== itemToRemove.id)
        )
      }
      onClear={() => setItems([])}
    />
  )
}

export const Empty: Story = {
  args: {
    items: [],
    onRemove: () => {},
  },
}

export const Captured: Story = {
  render: () => <StatefulSelectionList initialItems={sampleItems} />,
}

export const ActiveCollector: Story = {
  render: () => <StatefulSelectionList initialItems={sampleItems} isActive />,
}

export const LongLabels: Story = {
  render: () => (
    <StatefulSelectionList
      initialItems={[
        {
          id: 'long-0',
          label:
            'Very long selected extrusion face label that should truncate inside the row',
        },
        ...sampleItems,
      ]}
    />
  ),
}

export const Dark: Story = {
  render: () => (
    <div className="dark">
      <StatefulSelectionList initialItems={sampleItems} />
    </div>
  ),
}

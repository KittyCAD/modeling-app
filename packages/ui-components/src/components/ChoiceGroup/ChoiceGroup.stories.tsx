import type { Meta, StoryFn, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ChoiceGroup, type ChoiceGroupOption } from './ChoiceGroup'

const operationOptions: ChoiceGroupOption<string>[] = [
  { name: 'New', value: 'new' },
  { name: 'Add', value: 'add' },
  { name: 'Remove', value: 'remove' },
  { name: 'Intersect', value: 'intersect' },
]

const meta = {
  title: 'Components/ChoiceGroup',
  component: ChoiceGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    name: 'operation',
    options: operationOptions,
    value: 'new',
    onChange: () => {},
  },
  decorators: [
    (Story: StoryFn) => (
      <div className="w-80 rounded border border-chalkboard-20 bg-chalkboard-10 p-3 text-chalkboard-100 dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-10">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChoiceGroup>

export default meta

type Story = StoryObj<typeof meta>

function StatefulChoiceGroup({
  allowDeselect = false,
}: {
  allowDeselect?: boolean
}) {
  const [value, setValue] = useState<string | undefined>('new')

  return (
    <ChoiceGroup
      name="operation"
      options={operationOptions}
      value={value}
      onChange={setValue}
      allowDeselect={allowDeselect}
    />
  )
}

export const Default: Story = {
  render: () => <StatefulChoiceGroup />,
}

export const Optional: Story = {
  render: () => <StatefulChoiceGroup allowDeselect />,
}

export const DisabledOption: Story = {
  args: {
    name: 'operation',
    options: [
      ...operationOptions.slice(0, 3),
      { name: 'Intersect', value: 'intersect', disabled: true },
    ],
    value: 'add',
    onChange: () => {},
  },
}

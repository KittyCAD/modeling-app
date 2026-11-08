import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { TabPicker } from './TabPicker'

const meta = {
  title: 'Components/TabPicker',
  component: TabPicker,
  tags: ['autodocs'],
  args: {
    label: 'Document mode',
    value: undefined,
    options: [],
    onChange: () => {},
  },
} satisfies Meta<typeof TabPicker>
export default meta
type Story = StoryObj<typeof meta>
function ChoicesPreview() {
  const [value, setValue] = useState('code')
  return (
    <TabPicker
      label="Document mode"
      value={value}
      onChange={setValue}
      options={[
        { id: 'code', label: 'Code' },
        { id: 'preview', label: 'Preview' },
      ]}
    />
  )
}
export const Choices: Story = { render: () => <ChoicesPreview /> }
export const SingleChoice: Story = {
  args: {
    label: 'Document mode',
    value: 'code',
    options: [{ id: 'code', label: 'Code' }],
    onChange: () => {},
  },
}
export const Unavailable: Story = {
  args: {
    label: 'Document mode',
    value: undefined,
    options: [],
    onChange: () => {},
  },
}

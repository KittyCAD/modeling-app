import type { Meta, StoryFn, StoryObj } from '@storybook/react-vite'
import { ArgumentField } from '../ArgumentField/ArgumentField'
import { ArgumentGroup } from './ArgumentGroup'

const meta = {
  title: 'Components/ArgumentGroup',
  component: ArgumentGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    title: 'Extent',
    description: 'Choose how far the feature should terminate.',
    children: null,
  },
  decorators: [
    (Story: StoryFn) => (
      <div className="w-80 rounded border border-chalkboard-20 bg-chalkboard-10 p-3 text-chalkboard-100 dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-10">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ArgumentGroup>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ArgumentGroup
      title="Extent"
      description="Choose how far the feature should terminate."
    >
      <ArgumentField
        name="distance"
        inputType="kcl"
        label="Distance"
        isRequired={false}
        value="10"
        onChange={() => {}}
      />
      <ArgumentField
        name="symmetric"
        inputType="boolean"
        label="Symmetric"
        isRequired={false}
        value={true}
        controlStyle="segmented"
        onChange={() => {}}
      />
    </ArgumentGroup>
  ),
}

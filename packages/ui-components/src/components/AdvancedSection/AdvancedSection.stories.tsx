import type { Meta, StoryFn, StoryObj } from '@storybook/react-vite'
import { ArgumentField } from '../ArgumentField/ArgumentField'
import { AdvancedSection } from './AdvancedSection'

const meta = {
  title: 'Components/AdvancedSection',
  component: AdvancedSection,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    title: 'Advanced',
    children: null,
  },
  decorators: [
    (Story: StoryFn) => (
      <div className="w-80 rounded border border-chalkboard-20 bg-chalkboard-10 p-3 text-chalkboard-100 dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-10">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AdvancedSection>

export default meta

type Story = StoryObj<typeof meta>

export const Closed: Story = {
  render: () => (
    <AdvancedSection description="Less common command parameters.">
      <ArgumentField
        name="tagStart"
        inputType="tagDeclarator"
        label="Tag Start"
        isRequired={false}
        value=""
        onChange={() => {}}
      />
      <ArgumentField
        name="hideSeams"
        inputType="boolean"
        label="Hide Seams"
        isRequired={false}
        value={undefined}
        controlStyle="segmented"
        onChange={() => {}}
      />
    </AdvancedSection>
  ),
}

export const Open: Story = {
  render: () => (
    <AdvancedSection defaultOpen description="Less common command parameters.">
      <ArgumentField
        name="twistAngle"
        inputType="kcl"
        label="Twist Angle"
        isRequired={false}
        value="15deg"
        onChange={() => {}}
      />
    </AdvancedSection>
  ),
}

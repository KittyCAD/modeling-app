import type { Meta, StoryFn, StoryObj } from '@storybook/react-vite'
import { SubmitButton } from './SubmitButton'

const meta = {
  title: 'Components/SubmitButton',
  component: SubmitButton,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story: StoryFn) => (
      <form
        className="rounded border border-chalkboard-20 bg-chalkboard-10 p-3 dark:border-chalkboard-70 dark:bg-chalkboard-100"
        onSubmit={(event) => event.preventDefault()}
      >
        <Story />
      </form>
    ),
  ],
} satisfies Meta<typeof SubmitButton>

export default meta

type Story = StoryObj<typeof meta>

export const Ready: Story = {
  args: {
    disabled: false,
    isChecking: false,
  },
}

export const Checking: Story = {
  args: {
    isChecking: true,
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}

export const Dark: Story = {
  args: {
    disabled: false,
    isChecking: false,
  },
  decorators: [
    (Story: StoryFn) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
}

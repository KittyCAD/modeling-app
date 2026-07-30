import { MarkdownEditor } from '@kittycad/ui-components'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { useState } from 'react'

const sampleMarkdown = [
  'A **parametric enclosure** for a small sensor board.',
  '',
  '- Snap-fit lid',
  '- USB-C access',
  '- [Project notes](zoo.dev/docs)',
].join('\n')

const meta = {
  title: 'Components/MarkdownEditor',
  component: MarkdownEditor,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    id: 'storybook-markdown-editor',
    value: sampleMarkdown,
    placeholder: 'Write a description...',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 'min(640px, calc(100vw - 32px))' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MarkdownEditor>

export default meta

type Story = StoryObj<typeof meta>

function MarkdownEditorPreview(args: ComponentProps<typeof MarkdownEditor>) {
  const [value, setValue] = useState(args.value)

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <MarkdownEditor {...args} value={value} onChange={setValue} />
      <pre
        style={{
          background: 'rgba(0, 0, 0, 0.05)',
          border: '1px solid rgba(0, 0, 0, 0.12)',
          borderRadius: 6,
          fontSize: 12,
          margin: 0,
          maxHeight: 160,
          overflow: 'auto',
          padding: 12,
          whiteSpace: 'pre-wrap',
        }}
      >
        {value}
      </pre>
    </div>
  )
}

export const Default: Story = {
  render: (args) => <MarkdownEditorPreview {...args} />,
}

export const Empty: Story = {
  args: {
    value: '',
  },
  render: (args) => <MarkdownEditorPreview {...args} />,
}

export const Invalid: Story = {
  args: {
    invalid: true,
    value: '',
  },
  render: (args) => <MarkdownEditorPreview {...args} />,
}

export const CompactTools: Story = {
  args: {
    features: ['bold', 'italic', 'link'],
  },
  render: (args) => <MarkdownEditorPreview {...args} />,
}

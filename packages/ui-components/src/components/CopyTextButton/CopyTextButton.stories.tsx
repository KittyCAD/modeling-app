import { CopyTextButton } from '@kittycad/ui-components'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { useState } from 'react'

const meta = {
  title: 'Components/CopyTextButton',
  component: CopyTextButton,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    textToCopy: 'X distance: 12.34 mm',
    children: 'Copy measurement',
  },
} satisfies Meta<typeof CopyTextButton>

export default meta

type Story = StoryObj<typeof meta>

function CopyTextButtonPreview(args: ComponentProps<typeof CopyTextButton>) {
  const [status, setStatus] = useState('Ready to copy')

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 240 }}>
      <CopyTextButton
        {...args}
        onCopySuccess={(copiedText) => {
          setStatus(`Copied "${copiedText}"`)
        }}
        onCopyError={() => {
          setStatus('Clipboard copy failed')
        }}
        style={{
          border: '1px solid #c8c2b6',
          borderRadius: 6,
          background: '#fffdf7',
          color: '#1f2933',
          cursor: 'pointer',
          padding: '8px 10px',
          textAlign: 'left',
          ...args.style,
        }}
      />
      <span style={{ color: '#5d6670', fontSize: 12 }}>{status}</span>
    </div>
  )
}

export const Default: Story = {
  render: (args) => <CopyTextButtonPreview {...args} />,
}

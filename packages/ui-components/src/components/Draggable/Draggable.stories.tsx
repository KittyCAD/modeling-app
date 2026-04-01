import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef } from 'react'
import { Draggable } from '@kittycad/ui-components'

const containerStyle = {
  width: '100%',
  minHeight: 320,
  borderRadius: 24,
  border: '1px solid #d7d2c4',
  background:
    'linear-gradient(180deg, rgb(249 247 241 / 0.95), rgb(237 232 220 / 0.95))',
  boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.75)',
  overflow: 'hidden',
  padding: 20,
  position: 'relative' as const,
}

const cardStyle = {
  width: 280,
  margin: 12,
  borderRadius: 20,
  border: '1px solid #c6c1b3',
  background: '#fffdf7',
  boxShadow: '0 18px 48px rgb(67 57 40 / 0.16)',
}

const meta = {
  title: 'Components/Draggable',
  component: Draggable,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof Draggable>

export default meta

type Story = StoryObj<typeof meta>

function BoundedWithCustomHandlePreview() {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={containerRef} style={containerStyle}>
      <Draggable
        containerRef={containerRef}
        Handle={
          <div
            style={{
              alignItems: 'center',
              borderBottom: '1px solid #e5dfd1',
              cursor: 'move',
              display: 'flex',
              justifyContent: 'space-between',
              padding: '14px 16px',
            }}
          >
            <strong>Inspector</strong>
            <span aria-hidden="true">:::</span>
          </div>
        }
        side="top"
        style={cardStyle}
      >
        <div style={{ padding: 16 }}>
          <p style={{ marginTop: 0 }}>
            The drag handle is fully custom markup, and the card stays inside
            the bounded canvas.
          </p>
          <button type="button">Action</button>
        </div>
      </Draggable>
    </div>
  )
}

function RightDockHandlePreview() {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={containerRef} style={containerStyle}>
      <Draggable
        containerRef={containerRef}
        Handle={
          <div
            style={{
              alignItems: 'center',
              background: '#1f3347',
              color: '#fbf7ef',
              cursor: 'move',
              display: 'flex',
              justifyContent: 'center',
              minWidth: 48,
            }}
          >
            <span aria-hidden="true">::</span>
          </div>
        }
        side="right"
        style={cardStyle}
      >
        <div style={{ padding: 16 }}>
          <strong>Right-mounted handle</strong>
          <p style={{ marginBottom: 0 }}>
            The `side` prop flips the layout without owning the visuals.
          </p>
        </div>
      </Draggable>
    </div>
  )
}

export const Freeform: Story = {
  render: () => (
    <div style={containerStyle}>
      <Draggable style={cardStyle}>
        <div style={{ padding: 18 }}>
          <strong>Drag anywhere</strong>
          <p style={{ marginBottom: 0 }}>
            This version uses the whole surface as the handle.
          </p>
        </div>
      </Draggable>
    </div>
  ),
}

export const BoundedWithCustomHandle: Story = {
  render: () => <BoundedWithCustomHandlePreview />,
}

export const RightDockHandle: Story = {
  render: () => <RightDockHandlePreview />,
}

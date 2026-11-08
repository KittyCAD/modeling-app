import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { Tabs } from './Tabs'
import { TabPicker } from '../TabPicker/TabPicker'
import { EmptyState } from '../EmptyState/EmptyState'

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  args: { label: 'Documents', items: [], selectedId: null, onChange: () => {} },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Tabs>
export default meta
type Story = StoryObj<typeof meta>

function Workspace({
  position = 'top',
  narrow = false,
}: {
  position?: 'top' | 'bottom'
  narrow?: boolean
}) {
  const [files, setFiles] = useState(['main.kcl', 'notes.md'])
  const [active, setActive] = useState('main.kcl')
  const [mode, setMode] = useState('code')
  const add = () => {
    const name = `Untitled ${files.length + 1}`
    setFiles([...files, name])
    setActive(name)
  }
  return (
    <div style={{ height: 260, width: narrow ? 300 : '100%', display: 'flex' }}>
      <Tabs
        label="Documents"
        position={position}
        selectedId={active}
        onChange={setActive}
        postfixAlign="end"
        prefix={<button type="button">Files</button>}
        postfix={
          <button type="button" onClick={add} aria-label="New document">
            +
          </button>
        }
        emptyState={
          <EmptyState
            action={
              <button type="button" onClick={add}>
                New document
              </button>
            }
          >
            No documents open
          </EmptyState>
        }
        items={files.map((name) => ({
          id: name,
          label: name,
          accessory: (
            <TabPicker
              label={`Mode for ${name}`}
              value={mode}
              options={[
                { id: 'code', label: 'Code' },
                { id: 'preview', label: 'Preview' },
              ]}
              onChange={setMode}
            />
          ),
          close: {
            label: `Close ${name}`,
            onClose: () => {
              setFiles(files.filter((file) => file !== name))
              if (active === name)
                setActive(files.find((file) => file !== name) ?? '')
            },
          },
          renderPanel: () => (
            <textarea
              aria-label={`Contents of ${name}`}
              defaultValue={`Contents of ${name}`}
              style={{
                height: '100%',
                width: '100%',
                background: 'transparent',
                color: 'inherit',
                border: 'none',
                resize: 'none',
              }}
            />
          ),
        }))}
      />
    </div>
  )
}

export const Top: Story = { render: () => <Workspace /> }
export const Bottom: Story = { render: () => <Workspace position="bottom" /> }
export const Narrow: Story = { render: () => <Workspace narrow /> }
function DarkWorkspace() {
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains('dark')
    document.documentElement.classList.add('dark')
    return () => {
      document.documentElement.classList.toggle('dark', wasDark)
    }
  }, [])
  return <Workspace />
}

export const Dark: Story = { render: () => <DarkWorkspace /> }

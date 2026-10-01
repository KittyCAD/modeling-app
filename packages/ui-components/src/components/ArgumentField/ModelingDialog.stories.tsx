import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { AdvancedSection } from '../AdvancedSection/AdvancedSection'
import { ArgumentGroup } from '../ArgumentGroup/ArgumentGroup'
import { DialogHeader } from '../DialogHeader/DialogHeader'
import { SubmitButton } from '../SubmitButton/SubmitButton'
import { ArgumentField } from './ArgumentField'

// Preview the dialog primitives together, including optional and read-only fields.
function DialogPreview({
  readOnly = false,
  isChecking = false,
}: {
  readOnly?: boolean
  isChecking?: boolean
}) {
  const [values, setValues] = useState<Record<string, unknown>>({
    length: '10mm',
    color: '#87c7ff',
  })
  const [profiles, setProfiles] = useState([
    { id: 'profile-1', label: 'Profile 1' },
    { id: 'profile-2', label: 'Profile 2' },
  ])
  const [isSelecting, setIsSelecting] = useState(false)
  const [isOpen, setIsOpen] = useState(true)
  const field = (name: string) => ({
    name,
    value: values[name],
    isRequired: false,
    onChange: (value: unknown) =>
      setValues((current) => ({ ...current, [name]: value })),
  })

  if (!isOpen)
    return <button onClick={() => setIsOpen(true)}>Open dialog</button>

  return (
    <div className="w-80 overflow-hidden rounded-md border border-chalkboard-30 bg-chalkboard-10 text-chalkboard-100 shadow-lg dark:border-chalkboard-80 dark:bg-chalkboard-100 dark:text-chalkboard-10">
      <DialogHeader title="Modeling dialog" onClose={() => setIsOpen(false)} />
      <form
        className="flex flex-col gap-3 p-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <ArgumentGroup title="Profiles">
          <ArgumentField
            {...field('profiles')}
            inputType="selection"
            label="Profiles"
            hideLabel
            orderedSelection
            disabled={readOnly}
            selectionItems={profiles.map((item, index) => ({
              ...item,
              canMoveUp: index > 0,
              canMoveDown: index < profiles.length - 1,
            }))}
            selectionEmptyLabel="Select profiles or faces"
            isSelecting={isSelecting}
            onStartSelecting={() => setIsSelecting(true)}
            onRemoveSelection={(item) =>
              setProfiles((current) =>
                current.filter(({ id }) => id !== item.id)
              )
            }
            onMoveSelection={(item, direction) =>
              setProfiles((current) => {
                const next = [...current]
                const index = next.findIndex(({ id }) => id === item.id)
                const target = index + (direction === 'up' ? -1 : 1)
                ;[next[index], next[target]] = [next[target], next[index]]
                return next
              })
            }
          />
        </ArgumentGroup>
        <ArgumentGroup title="Extent">
          <ArgumentField
            {...field('length')}
            inputType="string"
            label="Distance"
            isRequired
          />
          <ArgumentField
            {...field('symmetric')}
            inputType="boolean"
            controlStyle="segmented"
            label="Symmetric"
          />
        </ArgumentGroup>
        <ArgumentGroup title="Result">
          <ArgumentField
            {...field('operation')}
            inputType="options"
            label="Operation"
            controlStyle="segmented"
            options={[
              { name: 'New', value: 'new' },
              { name: 'Add', value: 'add' },
              { name: 'Intersect', value: 'intersect', disabled: true },
            ]}
          />
          <ArgumentField
            {...field('bodyType')}
            inputType="options"
            label="Output"
            options={[
              { name: 'Solid', value: 'solid' },
              { name: 'Surface', value: 'surface' },
            ]}
          />
        </ArgumentGroup>
        <AdvancedSection title="More options">
          <ArgumentField
            {...field('hideSeams')}
            inputType="boolean"
            label="Hide seams"
          />
          <ArgumentField
            {...field('direction')}
            inputType="vector3d"
            label="Direction"
          />
          <ArgumentField {...field('note')} inputType="text" label="Note" />
          <ArgumentField {...field('color')} inputType="color" label="Color" />
        </AdvancedSection>
        <SubmitButton isChecking={isChecking} />
      </form>
    </div>
  )
}

const meta = {
  title: 'Components/ModelingDialog',
  component: DialogPreview,
  tags: ['autodocs'],
} satisfies Meta<typeof DialogPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = {}
export const ReadOnlySelection: Story = { args: { readOnly: true } }
export const Checking: Story = { args: { isChecking: true } }
export const Dark: Story = {
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
}

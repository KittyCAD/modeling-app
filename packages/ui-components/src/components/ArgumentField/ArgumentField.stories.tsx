import type { Meta, StoryFn, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { SelectionListItem } from '../SelectionList/SelectionList'
import {
  ArgumentField,
  type ArgumentFieldInputType,
  type ArgumentFieldOption,
} from './ArgumentField'

const selectionItems: SelectionListItem[] = [
  {
    id: 'face-0',
    label: 'Face',
  },
  {
    id: 'edge-1',
    label: 'Edge',
  },
]

const modeOptions: ArgumentFieldOption[] = [
  { name: 'Add', value: 'add' },
  { name: 'Subtract', value: 'subtract' },
  { name: 'Intersect', value: 'intersect', disabled: true },
]

type FieldPreviewProps = {
  name: string
  inputType: ArgumentFieldInputType
  label: string
  initialValue?: unknown
  isRequired?: boolean
  options?: ArgumentFieldOption[]
  description?: string
  initialSelectionItems?: SelectionListItem[]
  initialSelecting?: boolean
  controlStyle?: 'select' | 'segmented'
}

const meta = {
  title: 'Components/ArgumentField',
  component: ArgumentField,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    name: 'distance',
    inputType: 'kcl',
    label: 'Distance',
    isRequired: false,
    value: '',
    onChange: () => {},
  },
  decorators: [
    (Story: StoryFn) => (
      <div className="w-80 rounded border border-chalkboard-20 bg-chalkboard-10 p-3 text-chalkboard-100 dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-10">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ArgumentField>

export default meta

type Story = StoryObj<typeof meta>

function Description({ children }: { children: string }) {
  return (
    <p className="my-0 text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40">
      {children}
    </p>
  )
}

function FieldPreview({
  name,
  inputType,
  label,
  initialValue,
  isRequired = false,
  options,
  description,
  initialSelectionItems = [],
  initialSelecting = false,
  controlStyle,
}: FieldPreviewProps) {
  const [value, setValue] = useState(initialValue)
  const [items, setItems] = useState(initialSelectionItems)
  const [isSelecting, setIsSelecting] = useState(initialSelecting)

  return (
    <ArgumentField
      name={name}
      inputType={inputType}
      label={label}
      isRequired={isRequired}
      options={options}
      controlStyle={controlStyle}
      value={value}
      selectionItems={items}
      selectionHeading="Selected"
      selectionEmptyLabel="Select profiles or faces"
      selectionHint="Multiple selections are accepted."
      isSelecting={isSelecting}
      currentSelectionLabel="1 face, 1 edge"
      description={
        description ? <Description>{description}</Description> : undefined
      }
      onChange={setValue}
      onStartSelecting={() => setIsSelecting(true)}
      onRemoveSelection={(itemToRemove) =>
        setItems((currentItems) =>
          currentItems.filter((item) => item.id !== itemToRemove.id)
        )
      }
      onClearSelection={() => setItems([])}
    />
  )
}

export const Options: Story = {
  render: () => (
    <FieldPreview
      name="mode"
      inputType="options"
      label="Mode"
      isRequired
      initialValue="add"
      options={modeOptions}
      description="Choose how the generated geometry should be combined."
    />
  ),
}

export const SegmentedOptions: Story = {
  render: () => (
    <FieldPreview
      name="mode"
      inputType="options"
      label="Mode"
      initialValue="add"
      options={modeOptions}
      controlStyle="segmented"
      description="Choose how the generated geometry should be combined."
    />
  ),
}

export const BooleanField: Story = {
  render: () => (
    <FieldPreview
      name="keepOriginal"
      inputType="boolean"
      label="Keep original"
      initialValue={true}
      controlStyle="segmented"
      description="Controls whether the source body remains after the operation."
    />
  ),
}

export const Selection: Story = {
  render: () => (
    <FieldPreview
      name="objects"
      inputType="selectionMixed"
      label="Objects"
      isRequired
      initialSelectionItems={selectionItems}
      initialSelecting
      description="Pick scene objects or code-backed selections."
    />
  ),
}

export const Text: Story = {
  render: () => (
    <FieldPreview
      name="prompt"
      inputType="text"
      label="Prompt"
      initialValue="Create mounting holes on the selected face."
      description="Free-form text for commands that need longer input."
    />
  ),
}

export const Kcl: Story = {
  render: () => (
    <FieldPreview
      name="distance"
      inputType="kcl"
      label="Distance"
      initialValue="wallThickness"
      description="Accepts a KCL expression, variable, or numeric value."
    />
  ),
}

export const Vector: Story = {
  render: () => (
    <FieldPreview
      name="direction"
      inputType="vector3d"
      label="Direction"
      initialValue="[0, 0, 1]"
    />
  ),
}

export const Color: Story = {
  render: () => (
    <FieldPreview
      name="color"
      inputType="color"
      label="Color"
      isRequired
      initialValue="#87c7ff"
    />
  ),
}

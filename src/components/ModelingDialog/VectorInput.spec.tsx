import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { VectorInput } from '@src/components/ModelingDialog/VectorInput'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
})
afterAll(() => {
  world.commandBarActor.stop()
  world.settingsActor.stop()
  world.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

it.each<{
  inputType: 'vector2d' | 'vector3d'
  value: string
  required: boolean
}>([
  { inputType: 'vector2d', value: '[min([1mm, 2mm]), 3mm]', required: false },
  {
    inputType: 'vector3d',
    value: '[min([1mm, 2mm]), 3mm, 4mm]',
    required: true,
  },
])(
  'edits and validates the coordinates of $inputType',
  async ({ inputType, value, required }) => {
    const onChange = vi.fn()
    const onValidationChange = vi.fn()
    await act(async () => {
      render(
        <VectorInput
          id="position"
          label="Position"
          inputType={inputType}
          value={value}
          required={required}
          kclManager={world.kclManager}
          wasmPromise={Promise.resolve(world.instance)}
          onChange={onChange}
          onValidationChange={onValidationChange}
        />
      )
    })
    const x = screen.getByRole('textbox', { name: 'X' })
    expect(x).toHaveValue('min([1mm, 2mm])')
    expect(screen.queryByRole('textbox', { name: 'Z' }) !== null).toBe(
      inputType === 'vector3d'
    )
    await waitFor(() =>
      expect(onValidationChange).toHaveBeenLastCalledWith({
        canSubmit: true,
        isChecking: false,
      })
    )

    fireEvent.change(x, { target: { value: 'missingCoordinate' } })
    await waitFor(() =>
      expect(onValidationChange).toHaveBeenLastCalledWith({
        canSubmit: false,
        isChecking: false,
      })
    )
    fireEvent.change(x, { target: { value: '5mm + 2mm' } })
    await waitFor(() =>
      expect(onValidationChange).toHaveBeenLastCalledWith({
        canSubmit: true,
        isChecking: false,
      })
    )
    expect(onChange).toHaveBeenLastCalledWith(
      inputType === 'vector2d' ? '[5mm + 2mm, 3mm]' : '[5mm + 2mm, 3mm, 4mm]'
    )

    for (const input of screen.getAllByRole('textbox'))
      fireEvent.change(input, { target: { value: '' } })
    await waitFor(() =>
      expect(onValidationChange).toHaveBeenLastCalledWith({
        canSubmit: !required,
        isChecking: false,
      })
    )
    expect(onChange).toHaveBeenLastCalledWith('')
  }
)

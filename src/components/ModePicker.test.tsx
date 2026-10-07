import {
  Registry,
  Slot,
  createPlugin,
  defineRegistryItem,
} from '@kittycad/registry'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useApp: vi.fn() }))
vi.mock('@src/lib/boot', () => ({ useApp: mocks.useApp }))

import { ModePicker } from '@src/components/ModePicker'
import { modesService, provideMode } from '@src/registry/contracts/modes'
import modesRegistryItem from '@src/registry/extensions/modes'

describe('ModePicker', () => {
  let registry: Registry
  let pluginSlot: Slot

  beforeEach(() => {
    registry = new Registry()
    pluginSlot = new Slot()
    registry.configure([modesRegistryItem, pluginSlot.of()])
    mocks.useApp.mockReturnValue({ registry })
  })

  afterEach(() => {
    cleanup()
    registry[Symbol.dispose]()
    vi.clearAllMocks()
  })

  async function installReviewMode() {
    await act(async () => {
      await registry.reconfigureAsync(pluginSlot, [
        createPlugin({
          id: 'review-plugin',
          title: 'Review',
          description: 'Review the current model.',
          items: [
            defineRegistryItem({
              provides: [
                provideMode({
                  id: 'review',
                  label: 'Review',
                  toolbar: [],
                }),
              ],
            }),
          ],
        }),
      ])
    })
  }

  function renderPicker(disabled = false) {
    render(
      <ul>
        <ModePicker disabled={disabled} />
      </ul>
    )
  }

  it('shows registered modes and selects them through the registry service', async () => {
    renderPicker()
    expect(screen.queryByRole('combobox', { name: 'Mode' })).toBeNull()

    await installReviewMode()

    expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveValue(
      'modeling'
    )
    expect(
      screen.getAllByRole('option').map((option) => option.textContent)
    ).toEqual(['Modeling', 'Review'])

    fireEvent.change(screen.getByRole('combobox', { name: 'Mode' }), {
      target: { value: 'review' },
    })

    expect(registry.get(modesService).activeMode.value?.id).toBe('review')
    expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveValue('review')
  })

  it('shows the forced sketch mode and disables switching until sketch exit', async () => {
    await installReviewMode()
    renderPicker()
    const modes = registry.get(modesService)
    act(() => {
      modes.setMode('review')
      modes.syncModelingMode('sketchSolve')
    })

    expect(screen.getByRole('combobox', { name: 'Mode' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveValue(
      'sketchSolve'
    )
    expect(screen.getByRole('option', { name: 'Sketch' })).toBeInTheDocument()

    act(() => modes.syncModelingMode('modeling'))

    expect(screen.getByRole('combobox', { name: 'Mode' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveValue('review')
    expect(screen.queryByRole('option', { name: 'Sketch' })).toBeNull()
  })

  it('respects toolbar-level interaction locks', async () => {
    await installReviewMode()
    renderPicker(true)

    expect(screen.getByRole('combobox', { name: 'Mode' })).toBeDisabled()
  })
})

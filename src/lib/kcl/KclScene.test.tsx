import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
vi.mock('@src/clientSideScene/localRenderer/LocalWebGPUScene', () => ({
  LocalWebGPUSceneView: () => null,
}))
import { KclScene } from '@src/lib/kcl/KclScene'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import type { ModelingStatusItem } from '@src/lib/kcl/registry/contract'

it('keeps selection across remounts and clears it from the owning view status bar', async () => {
  const first = modelingTestContext(),
    second = modelingTestContext()
  const { selection } = first.resource
  try {
    const mounted = render(<KclScene context={first.context} />)
    await screen.findByText('No selection', {}, { timeout: 10000 })
    await act(async () => {
      await selection.pick({ clientX: 1, clientY: 0 })
    })
    expect(screen.getByLabelText('Scene selection')).toHaveTextContent(
      '1 selected'
    )
    mounted.unmount()
    render(
      <>
        <KclScene context={first.context} />
        <KclScene context={second.context} />
      </>
    )
    const bars = await screen.findAllByRole('contentinfo', {
      name: 'Modeling view status',
    })
    expect(within(bars[0]).getByLabelText('Scene selection')).toHaveTextContent(
      '1 selected'
    )
    expect(within(bars[1]).getByLabelText('Scene selection')).toHaveTextContent(
      'No selection'
    )
    fireEvent.click(within(bars[0]).getByTestId('selection-status'))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear selection' })
    )
    expect(selection.selected.peek()).toEqual([])
    expect(within(bars[0]).getByLabelText('Scene selection')).toHaveTextContent(
      'No selection'
    )
    expect(screen.queryByText('0 selected')).not.toBeInTheDocument()
  } finally {
    first.dispose()
    second.dispose()
  }
})

it('orders extensible items by side and keeps their context bound to their own view', async () => {
  const first = modelingTestContext(),
    second = modelingTestContext()
  const contribution = (
    id: string,
    side: 'start' | 'end',
    order: number
  ): ModelingStatusItem => ({
    id,
    side,
    order,
    Component: ({ context }) => (
      <button onClick={() => context.measurement.open()}>{id}</button>
    ),
  })
  const items = signal([
    contribution('last', 'end', 20),
    contribution('first', 'end', 10),
    contribution('capture', 'start', 99),
  ])
  first.context.statusItems = items
  second.context.statusItems = signal([contribution('other', 'end', 0)])
  try {
    render(
      <>
        <KclScene context={first.context} />
        <KclScene context={second.context} />
      </>
    )
    const bars = screen.getAllByRole('contentinfo')
    expect(
      within(bars[0])
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['capture', 'first', 'last'])
    fireEvent.click(screen.getByRole('button', { name: 'first' }))
    expect(first.context.measurement.isOpen.peek()).toBe(true)
    expect(second.context.measurement.isOpen.peek()).toBe(false)
    await act(async () => {
      items.value = [contribution('replacement', 'end', 0)]
    })
    expect(screen.queryByText('first')).not.toBeInTheDocument()
    expect(screen.getByText('other')).toBeInTheDocument()
    expect(screen.queryByText('idle / hidePlanes')).not.toBeInTheDocument()
  } finally {
    first.dispose()
    second.dispose()
  }
})

it('opens analysis in the owning viewport and sends requests only to that scene', async () => {
  const first = modelingTestContext(),
    second = modelingTestContext()
  try {
    render(
      <>
        <KclScene context={first.context} />
        <KclScene context={second.context} />
      </>
    )
    const buttons = await screen.findAllByRole('button', {
      name: 'Physical analysis',
    })
    fireEvent.click(buttons[1])
    expect(second.context.physicalAnalysis.isOpen.peek()).toBe(true)
    expect(first.context.physicalAnalysis.isOpen.peek()).toBe(false)
    await within(second.resource.element).findByTestId(
      'physical-analysis-length-unit'
    )
    expect(
      within(first.resource.element).queryByTestId(
        'physical-analysis-length-unit'
      )
    ).not.toBeInTheDocument()
    expect(second.resource.commands.sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: { type: 'volume', entity_ids: [], output_unit: 'mm3' },
      })
    )
    expect(first.resource.commands.sendSceneCommand).not.toHaveBeenCalled()
    fireEvent.click(
      within(second.resource.element).getByRole('button', { name: /Close$/ })
    )
    expect(second.context.physicalAnalysis.isOpen.peek()).toBe(false)
  } finally {
    first.dispose()
    second.dispose()
  }
})

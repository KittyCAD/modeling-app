import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  wasmPromise: Promise.resolve({}),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    wasmPromise: mocks.wasmPromise,
    commands: {
      useState: () => ({ context: { argumentsToSubmit: {} } }),
    },
  }),
}))
vi.mock('@src/lib/openWindow', () => ({
  openExternalBrowserIfDesktop: vi.fn(),
}))

import CommandBarPathInput from '@src/components/CommandBar/CommandBarPathInput'

const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron')

afterEach(() => {
  if (originalElectron) {
    Object.defineProperty(window, 'electron', originalElectron)
  } else {
    Reflect.deleteProperty(window, 'electron')
  }
  vi.restoreAllMocks()
  mocks.open.mockReset()
})

async function renderInput(onSubmit = vi.fn()) {
  await act(async () => {
    render(
      <CommandBarPathInput
        arg={{ inputType: 'path', name: 'files', required: true, filters: [] }}
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )
  })
  return onSubmit
}

describe('CommandBarPathInput', () => {
  it('opens the browser picker without submitting and ignores an empty selection', async () => {
    Reflect.deleteProperty(window, 'electron')
    const onSubmit = await renderInput()
    const picker = screen.getByLabelText('Choose a file')
    const click = vi.spyOn(picker, 'click')

    fireEvent.click(screen.getByRole('button', { name: 'Open file' }))
    expect(click).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(picker, { target: { files: [] } })
    fireEvent.submit(screen.getByRole('textbox'))
    expect(onSubmit).not.toHaveBeenCalled()

    const file = new File(['local KCL'], 'part.kcl')
    fireEvent.change(picker, { target: { files: [file] } })
    fireEvent.change(picker, { target: { files: [] } })
    expect(screen.getByRole('textbox')).toHaveValue('part.kcl')
    fireEvent.submit(screen.getByRole('textbox'))
    expect(onSubmit).toHaveBeenCalledWith(file)
  })

  it('keeps native desktop paths and does not submit when opening the dialog', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { process: { env: { NODE_ENV: 'test' } }, open: mocks.open },
    })
    mocks.open.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/part.kcl'],
    })
    const onSubmit = await renderInput()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open file' }))
    })
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(screen.getByRole('textbox')).toHaveValue('/tmp/part.kcl')
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.submit(screen.getByRole('textbox'))
    expect(onSubmit).toHaveBeenCalledWith('/tmp/part.kcl')
  })
})

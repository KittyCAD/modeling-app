import { CopyTextButton } from '@kittycad/ui-components'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const writeText = vi.fn()

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

afterEach(() => {
  cleanup()
  writeText.mockReset()
})

describe('CopyTextButton', () => {
  test('copies the provided text to the clipboard', async () => {
    writeText.mockResolvedValue(undefined)
    const onCopySuccess = vi.fn()

    render(
      <CopyTextButton textToCopy="Length: 12 mm" onCopySuccess={onCopySuccess}>
        Copy
      </CopyTextButton>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Length: 12 mm')
    })
    expect(onCopySuccess).toHaveBeenCalledWith('Length: 12 mm')
  })

  test('reports clipboard failures', async () => {
    const error = new Error('Clipboard blocked')
    writeText.mockRejectedValue(error)
    const onCopyError = vi.fn()

    render(
      <CopyTextButton textToCopy="Length: 12 mm" onCopyError={onCopyError}>
        Copy
      </CopyTextButton>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => {
      expect(onCopyError).toHaveBeenCalledWith(error)
    })
  })

  test('does not copy when the click is prevented', () => {
    render(
      <CopyTextButton
        textToCopy="Length: 12 mm"
        onClick={(event) => event.preventDefault()}
      >
        Copy
      </CopyTextButton>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).not.toHaveBeenCalled()
  })
})

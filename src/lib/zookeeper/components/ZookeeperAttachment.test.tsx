import { fireEvent, render, screen, within } from '@testing-library/react'
import { ZookeeperAttachment } from '@src/lib/zookeeper/components/ZookeeperAttachment'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

describe('attachment preview dialogs', () => {
  const revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>()

  beforeEach(() => {
    let nextUrl = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      () => `blob:preview-${++nextUrl}`
    )
    revokeObjectURL.mockReset()
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)
  })

  afterEach(() => vi.restoreAllMocks())

  test('reads the full text only on open and preserves its whitespace', async () => {
    const content = `First line\n\n  ${'long reference '.repeat(1000)}\nLast line`
    const file = new File([content], 'pasted-text-reference.txt', {
      type: 'text/plain',
    })
    const read = vi.spyOn(file, 'text')
    render(<ZookeeperAttachment file={file} className="" />)

    const trigger = await screen.findByRole('button', { name: /First line/ })
    expect(read).not.toHaveBeenCalled()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Text preview' })
    await within(dialog).findByText(/Last line/)
    expect(dialog.querySelector('pre')?.textContent).toBe(content)
    expect(read).toHaveBeenCalledOnce()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close preview' })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  test('fits the full image and releases its URL when the dialog closes', () => {
    const file = new File(['image'], 'image-reference.png', {
      type: 'image/png',
    })
    render(<ZookeeperAttachment file={file} className="" />)

    fireEvent.click(screen.getByRole('button', { name: 'Attachment preview' }))
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const image = within(dialog).getByRole('img')
    expect(image).toHaveClass('object-contain')
    expect(image).toHaveAttribute('src', 'blob:preview-2')
    fireEvent.error(image)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Could not preview this attachment.'
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close preview' })
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-2')
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:preview-1')
  })

  test('ignores a text read that finishes after the selected file changes', async () => {
    let finishRead: (value: string) => void = () => {}
    const first = new File(['old'], 'first.txt', { type: 'text/plain' })
    vi.spyOn(first, 'text').mockReturnValue(
      new Promise((resolve) => {
        finishRead = resolve
      })
    )
    const second = new File(['Current text'], 'second.txt', {
      type: 'text/plain',
    })
    const { rerender } = render(
      <ZookeeperAttachment file={first} className="" />
    )
    fireEvent.click(screen.getByRole('button', { name: /first\.txt/ }))
    rerender(<ZookeeperAttachment file={second} className="" />)

    const dialog = screen.getByRole('dialog', { name: 'Text preview' })
    await within(dialog).findByText('Current text')
    finishRead('Stale text')
    await Promise.resolve()
    expect(dialog.querySelector('pre')?.textContent).toBe('Current text')
  })
})

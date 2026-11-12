import { fireEvent, render, screen, within } from '@testing-library/react'
import { ZookeeperAttachment } from '@src/lib/zookeeper/components/ZookeeperAttachment'
import { afterEach, describe, expect, test, vi } from 'vitest'

describe('attachment preview dialogs', () => {
  afterEach(() => vi.restoreAllMocks())

  test.each([
    ['README', ''],
    ['reference.custom', 'application/octet-stream'],
  ])('previews %s (%s) lazily', async (name, type) => {
    const content = `First line\n\n  ${'long reference '.repeat(1000)}\nLast line`
    const file = new File([content], name, { type })
    const read = vi.spyOn(file, 'arrayBuffer')
    render(
      <ZookeeperAttachment file={file} className="">
        {file.name}
      </ZookeeperAttachment>
    )

    const trigger = screen.getByRole('button', { name: file.name })
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

  test('allows text previews exactly at 1 MiB', async () => {
    const file = new File(['é'.repeat(512 * 1024)], 'reference.txt', {
      type: 'text/plain',
    })
    const read = vi
      .spyOn(file, 'arrayBuffer')
      .mockResolvedValue(
        new TextEncoder().encode('At the preview limit').buffer
      )
    render(
      <ZookeeperAttachment file={file} className="">
        {file.name}
      </ZookeeperAttachment>
    )
    fireEvent.click(screen.getByRole('button', { name: file.name }))
    expect(await screen.findByText('At the preview limit')).toBeInTheDocument()
    expect(read).toHaveBeenCalledOnce()
  })

  test.each(['local', 'replayed'])(
    'rejects oversized %s text before reading it',
    (source) => {
      const content = `${'é'.repeat(512 * 1024)}a`
      const file =
        source === 'local'
          ? new File([content], 'reference.txt', { type: 'text/plain' })
          : {
              name: 'reference.txt',
              mimetype: 'text/plain',
              data: Array.from(new TextEncoder().encode(content)),
            }
      const read = vi.spyOn(Blob.prototype, 'arrayBuffer')
      render(
        <ZookeeperAttachment file={file} className="">
          {file.name}
        </ZookeeperAttachment>
      )
      fireEvent.click(screen.getByRole('button', { name: file.name }))
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Text files larger than 1 MiB cannot be previewed.'
      )
      expect(read).not.toHaveBeenCalled()
    }
  )

  test.each([[0xff], [0], [0x1b]])(
    'rejects binary or invalid UTF-8 bytes %j',
    async (byte) => {
      const file = new File([new Uint8Array([byte])], 'reference.txt', {
        type: 'text/plain',
      })
      render(
        <ZookeeperAttachment file={file} className="">
          {file.name}
        </ZookeeperAttachment>
      )
      fireEvent.click(screen.getByRole('button', { name: file.name }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This file is binary or is not UTF-8 text.'
      )
    }
  )

  test('handles image errors and releases the preview URL on close', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})
    const file = new File(['image'], 'image-reference.png', {
      type: 'image/png',
    })
    render(
      <ZookeeperAttachment file={file} className="">
        {file.name}
      </ZookeeperAttachment>
    )

    fireEvent.click(screen.getByRole('button', { name: file.name }))
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const image = within(dialog).getByRole('img', {
      name: 'Attachment preview',
    })
    expect(image).toHaveAttribute('src', 'blob:preview')
    fireEvent.error(image)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Could not preview this attachment.'
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close preview' })
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  test('ignores a text read that finishes after the selected file changes', async () => {
    let finishRead: (value: ArrayBuffer) => void = () => {}
    const first = new File(['old'], 'first.txt', { type: 'text/plain' })
    vi.spyOn(first, 'arrayBuffer').mockReturnValue(
      new Promise((resolve) => {
        finishRead = resolve
      })
    )
    const second = new File(['Current text'], 'second.txt', {
      type: 'text/plain',
    })
    const { rerender } = render(
      <ZookeeperAttachment file={first} className="">
        {first.name}
      </ZookeeperAttachment>
    )
    fireEvent.click(screen.getByRole('button', { name: /first\.txt/ }))
    rerender(
      <ZookeeperAttachment file={second} className="">
        {second.name}
      </ZookeeperAttachment>
    )

    const dialog = screen.getByRole('dialog', { name: 'Text preview' })
    await within(dialog).findByText('Current text')
    finishRead(new TextEncoder().encode('Stale text').buffer)
    await Promise.resolve()
    expect(dialog.querySelector('pre')?.textContent).toBe('Current text')
  })
})

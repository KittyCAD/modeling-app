import { fireEvent, render, screen, within } from '@testing-library/react'
import { ZookeeperAttachment } from '@src/lib/zookeeper/components/ZookeeperAttachment'
import { afterEach, describe, expect, test, vi } from 'vitest'

describe('attachment preview dialogs', () => {
  afterEach(() => vi.restoreAllMocks())

  test.each([
    ['reference.txt', 'text/plain'],
    ['README.MD', ''],
    ['reference.json', 'application/octet-stream'],
    ['reference', 'application/json'],
    ['reference', 'application/schema+json'],
    ['reference', 'application/xml; charset=utf-8'],
    ['reference', 'application/yaml'],
    ['reference', 'application/toml'],
    ['main.kcl', ''],
  ])('previews %s (%s) lazily', async (name, type) => {
    const content = `First line\n\n  ${'long reference '.repeat(1000)}\nLast line`
    const file = new File([content], name, { type })
    const read = vi.spyOn(file, 'text')
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

  test('does not offer a text preview for binary attachments', () => {
    const file = new File(['binary'], 'reference.pdf', {
      type: 'application/pdf',
    })
    render(
      <ZookeeperAttachment file={file} className="">
        {file.name}
      </ZookeeperAttachment>
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(file.name)).toBeInTheDocument()
  })

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
    finishRead('Stale text')
    await Promise.resolve()
    expect(dialog.querySelector('pre')?.textContent).toBe('Current text')
  })
})

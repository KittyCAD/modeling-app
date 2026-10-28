import { fireEvent, render, screen } from '@testing-library/react'
import { ZookeeperAttachmentPreview } from '@src/lib/zookeeper/components/ZookeeperAttachmentPreview'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

test('uses explicit paste intent rather than the filename', async () => {
  const contents = 'Pasted reference contents'
  const uploaded = new File([contents], 'pasted-text-upload.txt', {
    type: 'text/plain',
  })
  const pasted = new File([contents], 'reference.txt', { type: 'text/plain' })
  const { rerender } = render(<ZookeeperAttachmentPreview file={uploaded} />)
  expect(screen.getByText(uploaded.name)).toBeInTheDocument()

  rerender(<ZookeeperAttachmentPreview file={pasted} isPastedText={true} />)
  expect(await screen.findByText(contents)).toBeInTheDocument()
})

describe('image attachment previews', () => {
  const createObjectURL = vi.fn<typeof URL.createObjectURL>()
  const revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>()

  beforeEach(() => {
    let nextUrl = 0
    createObjectURL
      .mockReset()
      .mockImplementation(() => `blob:image-${++nextUrl}`)
    revokeObjectURL.mockReset()
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)
  })

  afterEach(() => vi.restoreAllMocks())

  test('falls back on decode failure and releases replaced and removed image URLs', () => {
    const first = new File(['first'], 'image-first.png', { type: 'image/png' })
    const second = new File(['second'], 'image-second.png', {
      type: 'image/png',
    })
    const { rerender, unmount } = render(
      <ZookeeperAttachmentPreview file={first} />
    )

    expect(screen.queryByText('Image')).not.toBeInTheDocument()
    expect(screen.queryByText(first.name)).not.toBeInTheDocument()
    const thumbnail = screen.getByRole('img', { name: 'Attachment preview' })
    expect(thumbnail).toHaveAttribute('src', 'blob:image-1')
    expect(thumbnail.closest('[title]')).toHaveAttribute('title', first.name)
    expect(createObjectURL).toHaveBeenCalledWith(first)

    fireEvent.error(thumbnail)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Image')).toHaveClass('sr-only')

    rerender(<ZookeeperAttachmentPreview file={second} />)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-1')
    expect(
      screen.getByRole('img', { name: 'Attachment preview' })
    ).toHaveAttribute('src', 'blob:image-2')
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-2')
  })

  test('creates a thumbnail only after replay image bytes become available', () => {
    const file = { name: 'image-replay.png', mimetype: 'image/png', data: [] }
    const { rerender } = render(<ZookeeperAttachmentPreview file={file} />)
    expect(screen.getByText('Image')).toHaveClass('sr-only')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(createObjectURL).not.toHaveBeenCalled()

    rerender(<ZookeeperAttachmentPreview file={{ ...file, data: [1, 2, 3] }} />)
    expect(
      screen.getByRole('img', { name: 'Attachment preview' })
    ).toHaveAttribute('src', 'blob:image-1')
  })
})

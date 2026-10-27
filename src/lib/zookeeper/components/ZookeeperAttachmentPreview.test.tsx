import { fireEvent, render, screen } from '@testing-library/react'
import { ZookeeperAttachmentPreview } from '@src/lib/zookeeper/components/ZookeeperAttachmentPreview'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

    expect(screen.getByText('Image')).toHaveAttribute('title', first.name)
    expect(screen.queryByText(first.name)).not.toBeInTheDocument()
    const thumbnail = screen.getByRole('img', { name: 'Attachment preview' })
    expect(thumbnail).toHaveAttribute('src', 'blob:image-1')
    expect(thumbnail).toHaveClass('h-8', 'w-8')
    expect(createObjectURL).toHaveBeenCalledWith(first)

    fireEvent.error(thumbnail)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Image')).toBeInTheDocument()

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
    const { rerender, unmount } = render(
      <ZookeeperAttachmentPreview file={file} />
    )
    expect(screen.getByText('Image')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(createObjectURL).not.toHaveBeenCalled()

    rerender(<ZookeeperAttachmentPreview file={{ ...file, data: [1, 2, 3] }} />)
    expect(
      screen.getByRole('img', { name: 'Attachment preview' })
    ).toHaveAttribute('src', 'blob:image-1')
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:image-1')
  })
})

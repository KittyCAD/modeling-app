import { fireEvent, render, screen } from '@testing-library/react'
import { ZookeeperAttachmentPreview } from '@src/lib/zookeeper/components/ZookeeperAttachmentPreview'
import { afterEach, expect, test, vi } from 'vitest'

test('shows text excerpts for pastes and filenames for uploads', async () => {
  const contents = 'Pasted reference contents'
  const uploaded = new File([contents], 'requirements.txt', {
    type: 'text/plain',
  })
  const pasted = new File([contents], 'reference.txt', { type: 'text/plain' })
  const { rerender } = render(<ZookeeperAttachmentPreview file={uploaded} />)
  expect(screen.getByText(uploaded.name)).toBeInTheDocument()

  rerender(<ZookeeperAttachmentPreview file={pasted} isPastedText={true} />)
  expect(await screen.findByText(contents)).toBeInTheDocument()
})

afterEach(() => vi.restoreAllMocks())

test('previews images, handles decode errors, and releases object URLs', () => {
  let nextUrl = 0
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation(() => `blob:image-${++nextUrl}`)
  const revokeObjectURL = vi
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => {})
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

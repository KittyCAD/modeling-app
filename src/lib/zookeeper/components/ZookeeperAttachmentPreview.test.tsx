import { render, screen } from '@testing-library/react'
import { ZookeeperAttachmentPreview } from '@src/lib/zookeeper/components/ZookeeperAttachmentPreview'
import { expect, test, vi } from 'vitest'

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

test('previews local image bytes and releases their object URL', () => {
  const createUrl = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:local-image')
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL')
  const file = new File(['image'], 'Part reference.png', { type: 'image/png' })
  const { unmount } = render(<ZookeeperAttachmentPreview file={file} />)
  expect(screen.getByRole('img', { name: file.name })).toHaveAttribute(
    'src',
    'blob:local-image'
  )
  expect(
    screen.getByRole('link', { name: `Download ${file.name}` })
  ).toHaveAttribute('download', file.name)
  unmount()
  expect(revokeUrl).toHaveBeenCalledWith('blob:local-image')
  createUrl.mockRestore()
  revokeUrl.mockRestore()
})

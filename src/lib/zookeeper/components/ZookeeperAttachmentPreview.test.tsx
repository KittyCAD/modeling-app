import { render, screen } from '@testing-library/react'
import { ZookeeperAttachmentPreview } from '@src/lib/zookeeper/components/ZookeeperAttachmentPreview'
import { expect, test } from 'vitest'

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

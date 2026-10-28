import { render, screen } from '@testing-library/react'
import { ZookeeperAttachmentPreview } from '@src/lib/zookeeper/components/ZookeeperAttachmentPreview'
import { expect, test } from 'vitest'

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

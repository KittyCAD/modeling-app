import { render, screen } from '@testing-library/react'
import { ZookeeperAttachmentPreview } from '@src/lib/zookeeper/components/ZookeeperAttachmentPreview'
import { expect, test } from 'vitest'

test.each(['reference.txt', 'pasted-text-upload.txt'])(
  'uses explicit paste intent rather than the filename: %s',
  async (name) => {
    const file = new File(['Pasted reference contents'], name, {
      type: 'text/plain',
    })
    const { rerender } = render(<ZookeeperAttachmentPreview file={file} />)
    expect(screen.getByText(name)).toHaveClass('truncate')

    rerender(<ZookeeperAttachmentPreview file={file} isPastedText={true} />)
    expect(await screen.findByText('Pasted reference contents')).toHaveClass(
      'line-clamp-2'
    )
  }
)

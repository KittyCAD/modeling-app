import type { MlCopilotFile } from '@kittycad/lib'
import {
  fetchZookeeperAttachment,
  handleZookeeperAttachmentMessage,
} from '@src/lib/zookeeper/zookeeperAttachments'
import { describe, expect, it, vi } from 'vitest'

class TestSocket extends EventTarget {
  readyState = WebSocket.OPEN
  send = vi.fn()
}

describe('Zookeeper attachments', () => {
  it('fetches a replay attachment once and caches the response', async () => {
    const testSocket = new TestSocket()
    const ws = testSocket as unknown as WebSocket
    const replayFile: MlCopilotFile = {
      name: 'render.png',
      mimetype: 'image/png',
      data: [],
      metadata: {
        attachment_prompt_id: 'prompt-id',
        attachment_seq: '2',
        attachment_role: 'server',
      },
    }
    const fetchedFile: MlCopilotFile = { ...replayFile, data: [1, 2, 3] }

    const firstFetch = fetchZookeeperAttachment(ws, replayFile)
    expect(testSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'fetch_attachment',
        prompt_id: 'prompt-id',
        seq: 2,
        role: 'server',
        name: 'render.png',
      })
    )

    expect(
      handleZookeeperAttachmentMessage(ws, {
        attachment: {
          prompt_id: 'prompt-id',
          seq: 2,
          role: 'server',
          file: fetchedFile,
        },
      })
    ).toBe(true)
    await expect(firstFetch).resolves.toBe(fetchedFile)
    await expect(fetchZookeeperAttachment(ws, replayFile)).resolves.toBe(
      fetchedFile
    )
    expect(testSocket.send).toHaveBeenCalledOnce()
  })
})

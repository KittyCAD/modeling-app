import { writeProjectThumbnailFile } from '@src/lib/desktop'
import {
  createThumbnailPNGOnDesktop,
  takeEngineSnapshot,
} from '@src/lib/screenshot'
import type { ConnectionManager } from '@src/network/connectionManager'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@src/lib/desktop', () => ({
  writeProjectThumbnailFile: vi.fn(async () => {}),
}))

const createEngineCommandManager = (
  sendSceneCommand: ReturnType<typeof vi.fn>
) =>
  ({
    sendSceneCommand,
  }) as unknown as Pick<ConnectionManager, 'sendSceneCommand'>

const takeSnapshotCommand = {
  type: 'modeling_cmd_req',
  cmd_id: expect.any(String),
  cmd: {
    type: 'take_snapshot',
    format: 'png',
  },
}

const takeSnapshotResponse = (contents = 'AQID') => ({
  success: true,
  resp: {
    type: 'modeling',
    data: {
      modeling_response: {
        type: 'take_snapshot',
        data: {
          contents,
        },
      },
    },
  },
})

describe('engine snapshots', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(writeProjectThumbnailFile).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('sends a take_snapshot modeling command', async () => {
    const sendSceneCommand = vi.fn(async () => takeSnapshotResponse())

    await expect(
      takeEngineSnapshot({
        engineCommandManager: createEngineCommandManager(sendSceneCommand),
      })
    ).resolves.toBe('data:image/png;base64,AQID')

    expect(sendSceneCommand).toHaveBeenCalledTimes(1)
    expect(sendSceneCommand).toHaveBeenCalledWith(takeSnapshotCommand)
  })

  test('writes the engine snapshot as the project thumbnail data URL', async () => {
    const sendSceneCommand = vi.fn(async () => takeSnapshotResponse())

    createThumbnailPNGOnDesktop({
      projectDirectoryWithoutEndingSlash: '/project',
      engineCommandManager: createEngineCommandManager(sendSceneCommand),
    })

    await vi.advanceTimersByTimeAsync(500)

    expect(writeProjectThumbnailFile).toHaveBeenCalledTimes(1)
    expect(writeProjectThumbnailFile).toHaveBeenCalledWith(
      'data:image/png;base64,AQID',
      '/project'
    )
  })

  test('normalizes quoted base64url snapshot contents', async () => {
    const sendSceneCommand = vi.fn(async () => takeSnapshotResponse('"--__"'))

    await expect(
      takeEngineSnapshot({
        engineCommandManager: createEngineCommandManager(sendSceneCommand),
      })
    ).resolves.toBe('data:image/png;base64,++//')
  })

  test('writes normalized base64url snapshot contents', async () => {
    const sendSceneCommand = vi.fn(async () => takeSnapshotResponse('"--__"'))

    createThumbnailPNGOnDesktop({
      projectDirectoryWithoutEndingSlash: '/project',
      engineCommandManager: createEngineCommandManager(sendSceneCommand),
    })

    await vi.advanceTimersByTimeAsync(500)

    expect(writeProjectThumbnailFile).toHaveBeenCalledTimes(1)
    expect(writeProjectThumbnailFile).toHaveBeenCalledWith(
      'data:image/png;base64,++//',
      '/project'
    )
  })

  test.each([
    {
      name: 'null response',
      response: null,
    },
    {
      name: 'non-modeling response',
      response: {
        success: true,
        resp: {
          type: 'export',
          data: {},
        },
      },
    },
    {
      name: 'non-snapshot modeling response',
      response: {
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'empty',
            },
          },
        },
      },
    },
    {
      name: 'snapshot response without contents',
      response: {
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'take_snapshot',
              data: {},
            },
          },
        },
      },
    },
  ])('returns an empty string for $name', async ({ response }) => {
    const sendSceneCommand = vi.fn(async () => response)

    await expect(
      takeEngineSnapshot({
        engineCommandManager: createEngineCommandManager(sendSceneCommand),
      })
    ).resolves.toBe('')
  })

  test('logs thumbnail failures without writing a malformed response', async () => {
    const sendSceneCommand = vi.fn(async () => null)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    createThumbnailPNGOnDesktop({
      projectDirectoryWithoutEndingSlash: '/project',
      engineCommandManager: createEngineCommandManager(sendSceneCommand),
    })

    await vi.advanceTimersByTimeAsync(500)

    expect(writeProjectThumbnailFile).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to generate thumbnail for /project'
    )
  })
})

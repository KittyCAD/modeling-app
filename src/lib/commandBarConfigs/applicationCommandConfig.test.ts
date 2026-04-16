import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApplicationCommands } from '@src/lib/commandBarConfigs/applicationCommandConfig'
import fsZds from '@src/lib/fs-zds'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'

vi.mock('@src/lang/wasmUtils', () => ({
  relevantFileExtensions: vi.fn(() => ['glb', 'kcl']),
}))

vi.mock('@src/lib/fs-zds', () => {
  const join = (...parts: string[]) => {
    const joined = parts.filter(Boolean).join('/').replace(/\/+/g, '/')
    return parts[0]?.startsWith('/') && !joined.startsWith('/')
      ? `/${joined}`
      : joined
  }

  return {
    default: {
      join,
      sep: '/',
      basename: (targetPath: string) => targetPath.split('/').pop() || '',
      mkdir: vi.fn(() => Promise.resolve(undefined)),
      readFile: vi.fn(),
      writeFile: vi.fn(() => Promise.resolve(undefined)),
    },
  }
})

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@src/lib/desktopFS', async () => {
  const actual = await vi.importActual<object>('@src/lib/desktopFS')
  return {
    ...actual,
    getNextFileName: vi.fn(
      async ({
        entryName,
        baseDir,
      }: {
        entryName: string
        baseDir: string
      }) => ({
        name: entryName,
        path: `${baseDir}/${entryName}`.replace(/\/+/g, '/'),
      })
    ),
  }
})

describe('add-kcl-file-to-project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves raw bytes for local files imported into an existing project', async () => {
    const sourceBytes = Uint8Array.from([0x00, 0x80, 0xff, 0xc3, 0x28])
    vi.mocked(fsZds.readFile).mockResolvedValue(sourceBytes)

    const send = vi.fn()
    const app = {
      project: { name: 'widget-project' },
      layout: {
        reset: vi.fn(),
      },
      systemIOActor: {
        getSnapshot: () => ({
          context: {
            folders: [{ name: 'widget-project' }],
            projectDirectoryPath: '/projects',
          },
        }),
        send,
      },
    }

    const command = createApplicationCommands({
      app: app as unknown as Parameters<
        typeof createApplicationCommands
      >[0]['app'],
      wasmInstance: {} as ModuleType,
    }).find((candidate) => candidate.name === 'add-kcl-file-to-project')

    expect(command).toBeDefined()

    command?.onSubmit({
      source: 'local',
      method: 'existingProject',
      projectName: 'widget-project',
      files: '/tmp/input.glb',
    })

    await vi.waitFor(() => {
      expect(fsZds.writeFile).toHaveBeenCalledWith(
        '/projects/widget-project/input.glb',
        sourceBytes
      )
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: SystemIOMachineEvents.importFileFromURL,
      })
    )
  })
})

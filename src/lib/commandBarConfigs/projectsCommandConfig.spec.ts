import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { describe, expect, it, vi } from 'vitest'
import type { ActorRefFrom } from 'xstate'

function createSystemIOActor() {
  return {
    getSnapshot: () => ({
      context: {
        defaultProjectFolderName: 'untitled',
        folders: [],
      },
    }),
    send: vi.fn(),
  } as unknown as ActorRefFrom<typeof systemIOMachine>
}

describe('project command config', () => {
  it('keeps project directory mutation commands disabled by default on web', () => {
    const commands = createProjectCommands({
      systemIOActor: createSystemIOActor(),
      enableProjectDirectoryCommands: false,
    })

    expect(commands.map((command) => command.name)).toEqual([
      'Import file from URL',
    ])
  })

  it('enables project directory mutation commands for supported runtimes', () => {
    const commands = createProjectCommands({
      systemIOActor: createSystemIOActor(),
      enableProjectDirectoryCommands: true,
    })

    expect(commands.map((command) => command.name)).toEqual([
      'Open project',
      'Create project',
      'Delete project',
      'Rename project',
      'Import file from URL',
    ])
  })
})

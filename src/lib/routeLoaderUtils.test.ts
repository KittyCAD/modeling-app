import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import { describe, expect, it, vi } from 'vitest'

describe('route loaders', () => {
  it('loads Home project state without touching the demo-project flow', () => {
    const closeProject = vi.fn()
    const app = {
      systemIOActor: {
        send: vi.fn(),
      },
      closeProject,
      settings: {
        actor: {
          send: vi.fn(),
        },
      },
    }

    const result = loadHomeProjects(app)

    expect(result).toEqual({})
    expect(app.systemIOActor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    expect(closeProject).toHaveBeenCalled()
    expect(app.settings.actor.send).toHaveBeenCalledWith({
      type: 'clear.project',
    })
  })
})

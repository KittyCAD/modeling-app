import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import { describe, expect, it, vi } from 'vitest'

describe('route loaders', () => {
  it('loads Home project state without touching the demo-project flow', () => {
    const closeProject = vi.fn()
    const app = {
      refreshProjects: vi.fn(async () => undefined),
      closeProject,
      settings: {
        actor: {
          send: vi.fn(),
        },
      },
    }

    const result = loadHomeProjects(app)

    expect(result).toEqual({})
    expect(app.refreshProjects).toHaveBeenCalledOnce()
    expect(closeProject).toHaveBeenCalled()
    expect(app.settings.actor.send).toHaveBeenCalledWith({
      type: 'clear.project',
    })
  })
})

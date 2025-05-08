import * as path from 'path'

import { parseProjectRoute } from '@src/lib/paths'

describe('testing parseProjectRoute', () => {
  it('should parse a project as a subpath of project dir', async () => {
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/projects',
        },
      },
    }
    const route = '/home/somebody/projects/project'
    expect(parseProjectRoute(config, route, path)).toEqual({
      projectName: 'project',
      projectPath: route,
      currentFileName: null,
      currentFilePath: null,
    })
  })
  it('should parse a project as the project dir', async () => {
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/projects',
        },
      },
    }
    const route = '/home/somebody/projects'
    expect(parseProjectRoute(config, route, path)).toEqual({
      projectName: null,
      projectPath: route,
      currentFileName: null,
      currentFilePath: null,
    })
  })
  it('should parse a project with file in the project dir', async () => {
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/projects',
        },
      },
    }
    const route = '/home/somebody/projects/assembly/main.kcl'
    expect(parseProjectRoute(config, route, path)).toEqual({
      projectName: 'assembly',
      projectPath: '/home/somebody/projects/assembly',
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })
  it('should parse a project with file in a subdir in the project dir', async () => {
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/projects',
        },
      },
    }
    const route = '/home/somebody/projects/assembly/subdir/main.kcl'
    expect(parseProjectRoute(config, route, path)).toEqual({
      projectName: 'assembly',
      projectPath: '/home/somebody/projects/assembly',
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })
  it('should work in the browser context', async () => {
    let config = {}
    const route = '/browser/main.kcl'
    expect(parseProjectRoute(config, route, undefined)).toEqual({
      projectName: 'browser',
      projectPath: '/browser',
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })
})

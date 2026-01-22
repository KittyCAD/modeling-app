import { expect, describe, it } from 'vitest'
import { getFilePathRelativeToProject, parseProjectRoute } from '@src/lib/paths'

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
    expect(parseProjectRoute(config, route)).toEqual({
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
    expect(parseProjectRoute(config, route)).toEqual({
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
    expect(parseProjectRoute(config, route)).toEqual({
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
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'assembly',
      projectPath: '/home/somebody/projects/assembly',
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })
})

describe('testing getFilePathRelativeToProject', () => {
  it('should work even if the project name occurs early in the file path', () => {
    const filePath =
      '/oops/early-e-characters/hi/im/franknoirot/e/some/nested/file.kcl'
    const projectName = 'e'
    const expectedProjectRelativeFilePath = '/some/nested/file.kcl'
    expect(getFilePathRelativeToProject(filePath, projectName, '/')).toEqual(
      expectedProjectRelativeFilePath
    )
  })
})

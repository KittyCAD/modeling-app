import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { beforeAll, expect, describe, it } from 'vitest'
import {
  getFilePathRelativeToProject,
  getRouterSearchFromRequestUrl,
  parseProjectRoute,
} from '@src/lib/paths'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

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

describe('testing getRouterSearchFromRequestUrl', () => {
  it('should read search params from normal browser router URLs', () => {
    expect(
      getRouterSearchFromRequestUrl(
        'https://zoo.dev/?project-id=abc&ask-open-desktop=true',
        false
      )
    ).toEqual('?project-id=abc&ask-open-desktop=true')
  })

  it('should read search params from hash router root URLs', () => {
    expect(
      getRouterSearchFromRequestUrl(
        'http://localhost:3000/#/?project-id=abc',
        true
      )
    ).toEqual('?project-id=abc')
  })

  it('should read search params from hash router root URLs without a slash', () => {
    expect(
      getRouterSearchFromRequestUrl(
        'file:///Applications/Zoo%20Design%20Studio.app/index.html#?project-id=abc',
        true
      )
    ).toEqual('?project-id=abc')
  })

  it('should read search params from hash router route URLs', () => {
    expect(
      getRouterSearchFromRequestUrl(
        'file:///Applications/Zoo%20Design%20Studio.app/index.html#/home?project-id=abc',
        true
      )
    ).toEqual('?project-id=abc')
  })

  it('should ignore nested hash fragments after hash router search params', () => {
    expect(
      getRouterSearchFromRequestUrl(
        'http://localhost:3000/#/home?project-id=abc#section',
        true
      )
    ).toEqual('?project-id=abc')
  })

  it('should fall back to document search when a hash router URL has no route search', () => {
    expect(
      getRouterSearchFromRequestUrl(
        'http://localhost:3000/?debug=true#/home',
        true
      )
    ).toEqual('?debug=true')
  })
})

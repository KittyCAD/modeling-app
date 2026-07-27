import { APP_NAME } from '@src/lib/constants'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import {
  fileNameHasExtension,
  getFilePathRelativeToProject,
  getProjectRelativeFilePath,
  getRouterSearchFromRequestUrl,
  parentPathRelativeToApplicationDirectory,
  parentPathRelativeToProject,
  parseProjectRoute,
  toProjectRelativePath,
  toWebSafePath,
} from '@src/lib/paths'
import { beforeAll, describe, expect, it } from 'vitest'

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

  it('should prefer the default directory library over the legacy project directory', async () => {
    let config = {
      settings: {
        app: {
          libraries: [
            {
              title: 'Projects',
              path: '/home/somebody/library-projects',
              type: 'directory',
            },
          ],
        },
        project: {
          directory: '/home/somebody/legacy-projects',
        },
      },
    }
    const route = '/home/somebody/library-projects/assembly/main.kcl'
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'assembly',
      projectPath: '/home/somebody/library-projects/assembly',
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })

  it('should respect an explicit empty libraries setting', async () => {
    let config = {
      settings: {
        app: {
          libraries: [],
        },
        project: {
          directory: '/home/somebody/legacy-projects',
        },
      },
    }
    const route = '/home/somebody/legacy-projects/assembly/subdir/main.kcl'
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'subdir',
      projectPath: '/home/somebody/legacy-projects/assembly/subdir',
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })

  it('should not parse a sibling path with the same prefix as inside the project dir', async () => {
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/Documents/zoo-design-studio-projects',
        },
      },
    }
    const route =
      '/home/somebody/Documents/zoo-design-studio-projects-2/project'
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'project',
      projectPath: route,
      currentFileName: null,
      currentFilePath: null,
    })
  })

  it('should not parse a file in a sibling path with the same prefix as inside the project dir', async () => {
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/Documents/zoo-design-studio-projects',
        },
      },
    }
    const route =
      '/home/somebody/Documents/zoo-design-studio-projects-2/project/main.kcl'
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'project',
      projectPath:
        '/home/somebody/Documents/zoo-design-studio-projects-2/project',
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

describe('testing web-safe project paths', () => {
  it('should normalize Windows separators for display paths', () => {
    expect(toWebSafePath('parts\\generated\\nested-part.kcl', '\\')).toEqual(
      'parts/generated/nested-part.kcl'
    )
  })

  it('should return a project-relative file path', () => {
    expect(
      toProjectRelativePath(
        '/some/path/Simple Box',
        '/some/path/Simple Box/parts/generated/nested-part.kcl'
      )
    ).toEqual('parts/generated/nested-part.kcl')
  })

  it('should return the app name when there is no file', () => {
    expect(getProjectRelativeFilePath()).toEqual(APP_NAME)
  })

  it('should return the file name when a relative path cannot be derived', () => {
    expect(
      getProjectRelativeFilePath(undefined, {
        name: 'nested-part.kcl',
        path: '',
        children: null,
      })
    ).toEqual('nested-part.kcl')
  })
})

describe('testing project-relative paths', () => {
  it('returns the file path relative to the project when the file is inside the project directory', () => {
    expect(
      parentPathRelativeToProject(
        '/home/somebody/Documents/zoo-design-studio-projects/project/main.kcl',
        '/home/somebody/Documents/zoo-design-studio-projects'
      )
    ).toEqual('main.kcl')
  })

  it('returns an empty path when the file is in a sibling directory with the same prefix', () => {
    expect(
      parentPathRelativeToProject(
        '/home/somebody/Documents/zoo-design-studio-projects-2/project/main.kcl',
        '/home/somebody/Documents/zoo-design-studio-projects'
      )
    ).toEqual('')
  })

  it('returns the file path relative to the application directory when contained', () => {
    expect(
      parentPathRelativeToApplicationDirectory(
        '/home/somebody/Documents/zoo-design-studio-projects/project/main.kcl',
        '/home/somebody/Documents/zoo-design-studio-projects'
      )
    ).toEqual('project/main.kcl')
  })

  it('returns an empty path relative to the application directory when the file is in a sibling prefix directory', () => {
    expect(
      parentPathRelativeToApplicationDirectory(
        '/home/somebody/Documents/zoo-design-studio-projects-2/project/main.kcl',
        '/home/somebody/Documents/zoo-design-studio-projects'
      )
    ).toEqual('')
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

describe('testing fileNameHasExtension', () => {
  it('returns true when a real extension is present', () => {
    expect(fileNameHasExtension('notes.txt')).toBe(true)
    expect(fileNameHasExtension('readme.md')).toBe(true)
    expect(fileNameHasExtension('part.kcl')).toBe(true)
    expect(fileNameHasExtension('archive.tar.gz')).toBe(true)
    expect(fileNameHasExtension('data.JSON')).toBe(true)
  })

  it('returns false for names without an extension', () => {
    expect(fileNameHasExtension('bracket')).toBe(false)
    expect(fileNameHasExtension('my-part')).toBe(false)
  })

  it('treats a leading dot (dotfile) and a trailing dot as no extension', () => {
    expect(fileNameHasExtension('.gitignore')).toBe(false)
    expect(fileNameHasExtension('bracket.')).toBe(false)
    expect(fileNameHasExtension('')).toBe(false)
  })
})

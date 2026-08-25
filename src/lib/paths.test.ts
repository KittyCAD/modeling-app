import { APP_NAME } from '@src/lib/constants'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
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
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

const absolutePath = (...parts: string[]) => fsZds.join(fsZds.sep, ...parts)

describe('testing parseProjectRoute', () => {
  it('should parse a project as a subpath of project dir', async () => {
    const projectDirectory = absolutePath('home', 'somebody', 'projects')
    const config = {
      settings: {
        project: {
          directory: projectDirectory,
        },
      },
    }
    const route = fsZds.join(projectDirectory, 'project')
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'project',
      projectPath: route,
      currentFileName: null,
      currentFilePath: null,
    })
  })
  it('should parse a project as the project dir', async () => {
    const projectDirectory = absolutePath('home', 'somebody', 'projects')
    const config = {
      settings: {
        project: {
          directory: projectDirectory,
        },
      },
    }
    const route = projectDirectory
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: null,
      projectPath: route,
      currentFileName: null,
      currentFilePath: null,
    })
  })
  it('should parse a project with file in the project dir', async () => {
    const projectDirectory = absolutePath('home', 'somebody', 'projects')
    const config = {
      settings: {
        project: {
          directory: projectDirectory,
        },
      },
    }
    const projectPath = fsZds.join(projectDirectory, 'assembly')
    const route = fsZds.join(projectPath, 'main.kcl')
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'assembly',
      projectPath,
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })
  it('should parse a project with file in a subdir in the project dir', async () => {
    const projectDirectory = absolutePath('home', 'somebody', 'projects')
    const config = {
      settings: {
        project: {
          directory: projectDirectory,
        },
      },
    }
    const projectPath = fsZds.join(projectDirectory, 'assembly')
    const route = fsZds.join(projectPath, 'subdir', 'main.kcl')
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'assembly',
      projectPath,
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })

  it('should parse a nested file relative to the active project directory', async () => {
    const defaultProjectDirectory = absolutePath(
      'home',
      'somebody',
      'local-projects'
    )
    const activeProjectDirectory = absolutePath(
      'home',
      'somebody',
      'Zoo',
      'personal'
    )
    const config = {
      settings: {
        project: {
          directory: defaultProjectDirectory,
        },
      },
    }
    const projectPath = fsZds.join(activeProjectDirectory, 'assembly')
    const route = fsZds.join(projectPath, 'parts', 'bolt.kcl')
    expect(
      parseProjectRoute(config, route, { activeProjectPath: projectPath })
    ).toEqual({
      projectName: 'assembly',
      projectPath,
      currentFileName: 'bolt.kcl',
      currentFilePath: route,
    })
  })

  it('should prefer the most specific candidate project directory', async () => {
    const outerProjectDirectory = absolutePath('home', 'somebody', 'projects')
    const nestedProjectDirectory = fsZds.join(outerProjectDirectory, 'client')
    const config = {
      settings: {
        project: {
          directory: outerProjectDirectory,
        },
      },
    }
    const projectPath = fsZds.join(nestedProjectDirectory, 'assembly')
    const route = fsZds.join(projectPath, 'parts', 'bolt.kcl')
    expect(
      parseProjectRoute(config, route, {
        candidateProjectDirectories: [
          outerProjectDirectory,
          nestedProjectDirectory,
        ],
      })
    ).toEqual({
      projectName: 'assembly',
      projectPath,
      currentFileName: 'bolt.kcl',
      currentFilePath: route,
    })
  })

  it('should keep the active project when it contains a nested library', async () => {
    const projectDirectory = absolutePath('home', 'somebody', 'projects')
    const projectPath = fsZds.join(projectDirectory, 'assembly')
    const nestedLibraryPath = fsZds.join(projectPath, 'vendor')
    const route = fsZds.join(nestedLibraryPath, 'parts', 'bolt.kcl')
    const config = {
      settings: {
        project: {
          directory: projectDirectory,
        },
      },
    }
    expect(
      parseProjectRoute(config, route, {
        activeProjectPath: projectPath,
        candidateProjectDirectories: [nestedLibraryPath],
      })
    ).toEqual({
      projectName: 'assembly',
      projectPath,
      currentFileName: 'bolt.kcl',
      currentFilePath: route,
    })
  })

  it('should prefer the default directory library over the legacy project directory', async () => {
    const libraryProjectDirectory = absolutePath(
      'home',
      'somebody',
      'library-projects'
    )
    const config = {
      settings: {
        app: {
          libraries: [
            {
              title: 'Projects',
              path: libraryProjectDirectory,
              type: 'directory',
            },
          ],
        },
        project: {
          directory: absolutePath('home', 'somebody', 'legacy-projects'),
        },
      },
    }
    const projectPath = fsZds.join(libraryProjectDirectory, 'assembly')
    const route = fsZds.join(projectPath, 'main.kcl')
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'assembly',
      projectPath,
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })

  it('should parse a Windows project route with mixed separators as the project root', async () => {
    const originalFsPathFunctions = {
      sep: fsZds.sep,
      relative: fsZds.relative,
      join: fsZds.join,
      basename: fsZds.basename,
      dirname: fsZds.dirname,
      extname: fsZds.extname,
      resolve: fsZds.resolve,
    }
    Object.assign(fsZds, {
      sep: path.win32.sep,
      relative: path.win32.relative.bind(path.win32),
      join: path.win32.join.bind(path.win32),
      basename: path.win32.basename.bind(path.win32),
      dirname: path.win32.dirname.bind(path.win32),
      extname: path.win32.extname.bind(path.win32),
      resolve: path.win32.resolve.bind(path.win32),
    })

    try {
      const projectDirectory =
        'C:\\Users\\runneradmin\\work\\modeling-app\\test-results\\electron-test-projects-dir'
      const route =
        'C:/Users/runneradmin/work/modeling-app/test-results/electron-test-projects-dir\\testProject'
      const config = {
        settings: {
          project: {
            directory: projectDirectory,
          },
        },
      }

      expect(parseProjectRoute(config, route)).toEqual({
        projectName: 'testProject',
        projectPath: path.win32.join(projectDirectory, 'testProject'),
        currentFileName: null,
        currentFilePath: null,
      })
    } finally {
      Object.assign(fsZds, originalFsPathFunctions)
    }
  })

  it('should respect an explicit empty libraries setting', async () => {
    const legacyProjectDirectory = absolutePath(
      'home',
      'somebody',
      'legacy-projects'
    )
    const config = {
      settings: {
        app: {
          libraries: [],
        },
        project: {
          directory: legacyProjectDirectory,
        },
      },
    }
    const projectPath = fsZds.join(legacyProjectDirectory, 'assembly', 'subdir')
    const route = fsZds.join(projectPath, 'main.kcl')
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'subdir',
      projectPath,
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })

  it('should not parse a sibling path with the same prefix as inside the project dir', async () => {
    const projectDirectory = absolutePath(
      'home',
      'somebody',
      'Documents',
      'zoo-design-studio-projects'
    )
    const config = {
      settings: {
        project: {
          directory: projectDirectory,
        },
      },
    }
    const route = fsZds.join(`${projectDirectory}-2`, 'project')
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'project',
      projectPath: route,
      currentFileName: null,
      currentFilePath: null,
    })
  })

  it('should not parse a file in a sibling path with the same prefix as inside the project dir', async () => {
    const projectDirectory = absolutePath(
      'home',
      'somebody',
      'Documents',
      'zoo-design-studio-projects'
    )
    const config = {
      settings: {
        project: {
          directory: projectDirectory,
        },
      },
    }
    const siblingProjectPath = fsZds.join(`${projectDirectory}-2`, 'project')
    const route = fsZds.join(siblingProjectPath, 'main.kcl')
    expect(parseProjectRoute(config, route)).toEqual({
      projectName: 'project',
      projectPath: siblingProjectPath,
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
    const projectPath = absolutePath('some', 'path', 'Simple Box')
    expect(
      toProjectRelativePath(
        projectPath,
        fsZds.join(projectPath, 'parts', 'generated', 'nested-part.kcl')
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
    const applicationProjectDirectory = absolutePath(
      'home',
      'somebody',
      'Documents',
      'zoo-design-studio-projects'
    )
    expect(
      parentPathRelativeToProject(
        fsZds.join(applicationProjectDirectory, 'project', 'main.kcl'),
        applicationProjectDirectory
      )
    ).toEqual('main.kcl')
  })

  it('returns an empty path when the file is in a sibling directory with the same prefix', () => {
    const applicationProjectDirectory = absolutePath(
      'home',
      'somebody',
      'Documents',
      'zoo-design-studio-projects'
    )
    expect(
      parentPathRelativeToProject(
        fsZds.join(`${applicationProjectDirectory}-2`, 'project', 'main.kcl'),
        applicationProjectDirectory
      )
    ).toEqual('')
  })

  it('returns the file path relative to the application directory when contained', () => {
    const applicationProjectDirectory = absolutePath(
      'home',
      'somebody',
      'Documents',
      'zoo-design-studio-projects'
    )
    expect(
      parentPathRelativeToApplicationDirectory(
        fsZds.join(applicationProjectDirectory, 'project', 'main.kcl'),
        applicationProjectDirectory
      )
    ).toEqual(fsZds.join('project', 'main.kcl'))
  })

  it('returns an empty path relative to the application directory when the file is in a sibling prefix directory', () => {
    const applicationProjectDirectory = absolutePath(
      'home',
      'somebody',
      'Documents',
      'zoo-design-studio-projects'
    )
    expect(
      parentPathRelativeToApplicationDirectory(
        fsZds.join(`${applicationProjectDirectory}-2`, 'project', 'main.kcl'),
        applicationProjectDirectory
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

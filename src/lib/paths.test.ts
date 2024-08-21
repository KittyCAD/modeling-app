import { parseProjectRoute } from './paths'
import * as path from 'path'
describe('testing parseProjectRoute', () => {
  it('should parse a project as a subpath of project dir', async () => {
<<<<<<< HEAD
    global.window = {electron:  { path: path }}
=======
    // @ts-ignore
    global.window = { electron: { path: path } }
>>>>>>> b1e8f79f (Ignore tsc for electron monkey-patch)
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/projects',
        },
      },
    }
    const route = '/home/somebody/projects/project'
    expect(await parseProjectRoute(config, route, true)).toEqual({
      projectName: 'project',
      projectPath: route,
      currentFileName: null,
      currentFilePath: null,
    })
  })
  it('should parse a project as the project dir', async () => {
<<<<<<< HEAD
    global.window = {electron:  { path: path }}
=======
    // @ts-ignore
    global.window = { electron: { path: path } }
>>>>>>> b1e8f79f (Ignore tsc for electron monkey-patch)
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/projects',
        },
      },
    }
    const route = '/home/somebody/projects'
    expect(await parseProjectRoute(config, route, true)).toEqual({
      projectName: null,
      projectPath: route,
      currentFileName: null,
      currentFilePath: null,
    })
  })
  it('should parse a project with file in the project dir', async () => {
    // @ts-ignore
    global.window = { electron: { path: path } }
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/projects',
        },
      },
    }
    const route = "/home/somebody/projects/assembly/main.kcl"
    expect(await parseProjectRoute(config, route, true)).toEqual({
      projectName: "assembly",
      projectPath: "/home/somebody/projects/assembly",
      currentFileName: "main.kcl",
      currentFilePath: route,
    })
  })
  it('should parse a project with file in a subdir in the project dir', async () => {
    // @ts-ignore
    global.window = { electron: { path: path } }
    let config = {
      settings: {
        project: {
          directory: '/home/somebody/projects',
        },
      },
    }
    const route = '/home/somebody/projects/assembly/subdir/main.kcl'
    expect(await parseProjectRoute(config, route, true)).toEqual({
      projectName: 'assembly',
      projectPath: '/home/somebody/projects/assembly',
      currentFileName: 'main.kcl',
      currentFilePath: route,
    })
  })
})

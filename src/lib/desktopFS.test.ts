import { getUniqueProjectName } from './desktopFS'
import { FileEntry } from './project'

/** Create a dummy project */
function project(name: string, children?: FileEntry[]): FileEntry {
  return {
    name,
    children: children || [
      { name: 'main.kcl', children: null, path: 'main.kcl' },
    ],
    path: `/projects/${name}`,
  }
}

describe(`Getting unique project names`, () => {
  it(`should return the same name if no conflicts`, () => {
    const projectName = 'new-project'
    const projects = [project('existing-project'), project('another-project')]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe(projectName)
  })
  it(`should return a unique name if there is a conflict`, () => {
    const projectName = 'existing-project'
    const projects = [project('existing-project'), project('another-project')]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe('existing-project-1')
  })
  it(`should increment an ending index until a unique one is found`, () => {
    const projectName = 'existing-project-1'
    const projects = [
      project('existing-project'),
      project('existing-project-1'),
      project('existing-project-2'),
    ]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe('existing-project-3')
  })
  it(`should prefer the formatting of the index identifier if present`, () => {
    const projectName = 'existing-project-$nn'
    const projects = [
      project('existing-project'),
      project('existing-project-1'),
      project('existing-project-2'),
    ]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe('existing-project-03')
  })
  it(`be able to get an incrementing index regardless of padding zeroes`, () => {
    const projectName = 'existing-project-$nn'
    const projects = [
      project('existing-project'),
      project('existing-project-01'),
      project('existing-project-2'),
    ]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe('existing-project-03')
  })
})

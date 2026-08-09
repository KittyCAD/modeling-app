import { Registry } from '@kittycad/registry'
import type { ZDSProject } from '@src/lang/KclManager'
import { projectSessionService } from '@src/registry/contracts/projectSession'
import projectSessionRegistryItem from '@src/registry/extensions/projectSession'
import { afterEach, describe, expect, it } from 'vitest'

describe('project session extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('provides the opened project session through registry signals', () => {
    registry = new Registry()
    registry.configure([projectSessionRegistryItem])

    const projectSession = registry.get(projectSessionService)
    const project = { name: 'bracket' } as ZDSProject

    expect(projectSession.getProject()).toBeUndefined()
    expect(projectSession.project.value).toBeUndefined()

    projectSession.setProject(project)

    expect(projectSession.getProject()).toBe(project)
    expect(projectSession.project.value).toBe(project)

    projectSession.clearProject()

    expect(projectSession.getProject()).toBeUndefined()
    expect(projectSession.project.value).toBeUndefined()
  })

  it('tracks the current project library id', () => {
    registry = new Registry()
    registry.configure([projectSessionRegistryItem])

    const projectSession = registry.get(projectSessionService)

    expect(projectSession.getCurrentProjectLibraryId()).toBeUndefined()
    expect(projectSession.currentProjectLibraryId.value).toBeUndefined()

    projectSession.setCurrentProjectLibraryId('directory:projects')

    expect(projectSession.getCurrentProjectLibraryId()).toBe(
      'directory:projects'
    )
    expect(projectSession.currentProjectLibraryId.value).toBe(
      'directory:projects'
    )

    projectSession.setCurrentProjectLibraryId(undefined)

    expect(projectSession.getCurrentProjectLibraryId()).toBeUndefined()
    expect(projectSession.currentProjectLibraryId.value).toBeUndefined()
  })
})

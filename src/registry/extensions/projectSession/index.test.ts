import { Registry } from '@kittycad/registry'
import type { ZDSProject } from '@src/lang/KclManager'
import { projectSession } from '@src/registry/contracts/projectSession'
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

    const session = registry.get(projectSession)
    const project = { name: 'bracket' } as ZDSProject

    expect(session.getProject()).toBeUndefined()
    expect(session.project.value).toBeUndefined()

    session.setProject(project)

    expect(session.getProject()).toBe(project)
    expect(session.project.value).toBe(project)

    session.clearProject()

    expect(session.getProject()).toBeUndefined()
    expect(session.project.value).toBeUndefined()
  })

  it('tracks the current project library id', () => {
    registry = new Registry()
    registry.configure([projectSessionRegistryItem])

    const session = registry.get(projectSession)

    expect(session.getCurrentProjectLibraryId()).toBeUndefined()
    expect(session.currentProjectLibraryId.value).toBeUndefined()

    session.setCurrentProjectLibraryId('directory:projects')

    expect(session.getCurrentProjectLibraryId()).toBe('directory:projects')
    expect(session.currentProjectLibraryId.value).toBe('directory:projects')

    session.setCurrentProjectLibraryId(undefined)

    expect(session.getCurrentProjectLibraryId()).toBeUndefined()
    expect(session.currentProjectLibraryId.value).toBeUndefined()
  })
})

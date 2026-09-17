import { Registry } from '@kittycad/registry'
import type { ZDSProject } from '@src/lang/KclManager'
import { projectSession } from '@src/registry/contracts/projectSession'
import projectSessionRegistryItem from '@src/registry/extensions/projectSession'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  it('owns opening the project and its optional initial editor', async () => {
    registry = new Registry()
    registry.configure([projectSessionRegistryItem])

    const session = registry.get(projectSession)
    const editor = { code: 'part = 1' }
    const openEditor = vi.fn(async () => editor)
    const openedProject = {
      openEditor,
    } as unknown as ZDSProject
    const openProject = vi.fn(async () => openedProject)
    const closeProject = vi.fn()
    session.bindRuntime({ openProject, closeProject })
    const assertCurrent = vi.fn()
    const project = { name: 'bracket' } as never
    const providedEditor = {} as never

    const result = await session.openProject({
      project,
      initialEditor: {
        path: '/projects/bracket/part.kcl',
        providedEditor,
      },
      assertCurrent,
    })

    expect(openProject).toHaveBeenCalledWith(project, assertCurrent)
    expect(openEditor).toHaveBeenCalledWith(
      '/projects/bracket/part.kcl',
      providedEditor,
      undefined,
      true,
      assertCurrent
    )
    expect(result).toEqual({ project: openedProject, editor })
    session.closeProject()
    expect(closeProject).toHaveBeenCalledTimes(1)
  })
})

import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import {
  type OpenProjectSessionInput,
  type ProjectSessionRuntime,
  type ProjectSessionService,
  projectSession,
} from '@src/registry/contracts/projectSession'

export const projectSessionExtension = defineRegistryItemFactory(() => {
  const project = signal<ZDSProject | undefined>(undefined)
  const currentProjectLibraryId = signal<string | undefined>(undefined)
  let runtime: ProjectSessionRuntime | undefined

  const getRuntime = () => {
    if (!runtime) {
      return Promise.reject(
        new Error('Project session runtime has not been bound.')
      )
    }
    return Promise.resolve(runtime)
  }

  const openProject = async (input: OpenProjectSessionInput) => {
    const activeRuntime = await getRuntime()
    const assertCurrent = input.assertCurrent ?? (() => undefined)
    const openedProject = await activeRuntime.openProject(
      input.project,
      assertCurrent
    )
    const editor = input.initialEditor
      ? await openedProject.openEditor(
          input.initialEditor.path,
          input.initialEditor.providedEditor,
          input.initialEditor.providedCode,
          input.initialEditor.isExecuting ?? true,
          assertCurrent
        )
      : undefined
    assertCurrent()

    return { project: openedProject, editor }
  }

  const closeProject = () => {
    runtime?.closeProject()
  }

  const serviceImpl: ProjectSessionService = {
    project,
    currentProjectLibraryId,
    getProject: () => project.value,
    setProject: (nextProject) => {
      project.value = nextProject
    },
    clearProject: () => {
      project.value = undefined
    },
    getCurrentProjectLibraryId: () => currentProjectLibraryId.value,
    setCurrentProjectLibraryId: (libraryId) => {
      currentProjectLibraryId.value = libraryId
    },
    bindRuntime: (nextRuntime) => {
      runtime = nextRuntime
      return () => {
        if (runtime === nextRuntime) {
          runtime = undefined
        }
      }
    },
    openProject,
    closeProject,
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'project-session-extension',
      providesServices: [provideService(projectSession, serviceImpl)],
      dispose: closeProject,
    }),
  }
}, 'project-session-extension')

export default defineRegistryItem({
  id: 'project-session',
  uses: [projectSessionExtension],
})

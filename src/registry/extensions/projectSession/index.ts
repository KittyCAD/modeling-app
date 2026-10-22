import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lib/projectSession'
import {
  createTextFileIO,
  type TextFileIO,
} from '@src/lib/projectSession/textFileIO'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import {
  projectSession,
  type ProjectSessionService,
} from '@src/registry/contracts/projectSession'

export const projectSessionExtension = defineRegistryItemFactory((ctx) => {
  const project = signal<ZDSProject | undefined>(undefined)
  const executingEditor = computed(() => {
    const currentProject = project.value
    const editor = currentProject?.executingEditor.value
    if (!currentProject || !editor) return undefined
    const execution = editor.execution
    const isCurrent = () =>
      project.peek() === currentProject &&
      currentProject.executingEditor.peek() === editor
    return {
      ...execution,
      executeCode: (code?: string) =>
        isCurrent() ? execution.executeCode(code) : Promise.resolve(),
      updateCode: (...args: Parameters<typeof execution.updateCode>) => {
        if (isCurrent()) execution.updateCode(...args)
      },
    }
  })
  const currentProjectLibraryId = signal<string | undefined>(undefined)
  let textFileIO: TextFileIO | undefined
  const electron = window.electron

  const serviceImpl: ProjectSessionService = {
    get textFileIO() {
      return (textFileIO ??= createTextFileIO(
        ctx.services.get(fileOperationsService),
        {
          watch: (path, key, onEvent) =>
            electron?.watchFileOn(path, key, onEvent),
          unwatch: (path, key) => electron?.watchFileOff(path, key),
        }
      ))
    },
    project,
    executingEditor,
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
  }

  return {
    id: 'project-session-extension',
    providesServices: [provideService(projectSession, serviceImpl)],
  }
}, 'project-session-extension')

export default defineRegistryItem({
  id: 'project-session',
  uses: [projectSessionExtension],
})

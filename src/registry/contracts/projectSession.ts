import { defineContract, defineService } from '@kittycad/registry'
import type { Signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'

/**
 * Owns the currently opened project session.
 *
 * This is the registry replacement target for `App.project`,
 * `App.projectSignal`, and the selected project-library id. The legacy App
 * fields delegate to this service while call sites are migrated.
 */
export interface ProjectSessionService {
  readonly project: Signal<ZDSProject | undefined>
  readonly currentProjectLibraryId: Signal<string | undefined>
  getProject: () => ZDSProject | undefined
  setProject: (project: ZDSProject | undefined) => void
  clearProject: () => void
  getCurrentProjectLibraryId: () => string | undefined
  setCurrentProjectLibraryId: (libraryId: string | undefined) => void
}

export const projectSessionContract = defineContract({
  projectSession: defineService<ProjectSessionService>('project-session'),
})

export const { projectSession } = projectSessionContract

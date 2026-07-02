import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Project } from '@src/lib/project'

export type ProjectHandle = {
  readonly path: string
}

export type ProjectHandles = readonly ProjectHandle[] | undefined

export type Projects = Project[] | undefined

export type SystemIOService = {
  projectHandles: ReadonlySignal<ProjectHandles>
  projects: ReadonlySignal<Projects>
  refreshProjectHandles: () => Promise<readonly ProjectHandle[]>
}

export function combineProjectHandles(
  inputs: readonly ProjectHandles[]
): ProjectHandles {
  let hasHandles = false
  const seenPaths = new Set<string>()
  const handles: ProjectHandle[] = []

  for (const input of inputs) {
    if (input === undefined) {
      continue
    }

    hasHandles = true
    for (const handle of input) {
      if (seenPaths.has(handle.path)) {
        continue
      }

      seenPaths.add(handle.path)
      handles.push(handle)
    }
  }

  return hasHandles ? handles : undefined
}

export function combineProjects(inputs: readonly Projects[]): Projects {
  let hasProjects = false
  const seenPaths = new Set<string>()
  const projects: Project[] = []

  for (const input of inputs) {
    if (input === undefined) {
      continue
    }

    hasProjects = true
    for (const project of input) {
      if (seenPaths.has(project.path)) {
        continue
      }

      seenPaths.add(project.path)
      projects.push(project)
    }
  }

  return hasProjects ? projects : undefined
}

export const systemIOContract = defineContract({
  systemIOService: defineService<SystemIOService>('system-io.service'),
  projectHandlesValueSpec: defineValueSpec<ProjectHandles, ProjectHandles>({
    name: 'system-io.project-handles',
    defaultValue: undefined,
    combine: combineProjectHandles,
  }),
  projectsValueSpec: defineValueSpec<Projects, Projects>({
    name: 'system-io.projects',
    defaultValue: undefined,
    combine: combineProjects,
  }),
})

export const { projectHandlesValueSpec, projectsValueSpec, systemIOService } =
  systemIOContract

import fsZds from '@src/lib/fs-zds'
import { isExtensionAnImportExtension } from '@src/lib/paths'
import type { Project } from '@src/lib/project'

export const getProjectSubdirectories = (project: Project | undefined) =>
  project?.children?.filter((entry) => entry.children !== null) ?? []

export function listImportableProjectFiles(
  project: Project | undefined,
  extensions: string[]
) {
  if (!project) return []
  const files: string[] = []
  const entries = [...(project.children ?? [])]
  while (entries.length) {
    const entry = entries.pop()!
    if (entry.children) entries.push(...entry.children)
    else {
      const path = fsZds.relative(project.path, entry.path)
      if (isExtensionAnImportExtension(path, extensions)) files.push(path)
    }
  }
  return files
}

import type { Project } from '@src/lib/project'

export type AiProjectKclFile = {
  label: string
  path: string
}

export function getProjectKclFiles(project: Project): AiProjectKclFile[] {
  const pendingEntries = (project.children ?? []).map((entry) => ({
    entry,
    label: entry.name,
  }))
  const files: AiProjectKclFile[] = []

  while (pendingEntries.length > 0) {
    const pendingEntry = pendingEntries.pop()
    if (!pendingEntry) {
      continue
    }
    const { entry, label } = pendingEntry
    if (entry.children !== null) {
      pendingEntries.push(
        ...entry.children.map((child) => ({
          entry: child,
          label: `${label}/${child.name}`,
        }))
      )
      continue
    }
    if (!entry.name.toLocaleLowerCase().endsWith('.kcl')) {
      continue
    }

    files.push({
      label,
      path: entry.path,
    })
  }

  return files.sort((a, b) => a.label.localeCompare(b.label))
}

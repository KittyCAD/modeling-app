import fsZds from '@src/lib/fs-zds'
import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
import type { FileEntry } from '@src/lib/project'
import type { ProjectFileMutation } from '@src/lib/projectSession/next/contract'
import type { ProjectDirectory } from '@src/lib/projectSession/next/types'

const paths = {
  relative: (from: string, to: string) => fsZds.relative(from, to),
  get sep() {
    return fsZds.sep
  },
}

const samePath = (left: string, right: string) =>
  fsZds.relative(left, right) === ''

/** Apply confirmed file membership changes while retaining unaffected entries and directory metadata. */
export function applyProjectFileMutation(
  root: ProjectDirectory,
  mutation: ProjectFileMutation
): ProjectDirectory | Error {
  const destination =
    mutation.type === 'created' ? mutation.path : mutation.destination
  const relative = getContainedRelativePath(paths, root.path, destination)
  if (!relative) return new Error('Expected a file path within the project')
  const path = fsZds.join(root.path, relative)
  const parents: string[] = []
  for (
    let parent = fsZds.dirname(relative);
    parent !== '.';
    parent = fsZds.dirname(parent)
  ) {
    parents.unshift(fsZds.join(root.path, parent))
  }
  let previous: FileEntry | undefined
  function remove(
    directory: ProjectDirectory,
    source: string
  ): ProjectDirectory {
    const children = directory.children
      .map((entry) => {
        if (samePath(entry.path, source)) {
          previous = entry
          return undefined
        }
        if (
          entry.children &&
          getContainedRelativePath(paths, entry.path, source) !== undefined
        ) {
          const updated = remove({ ...entry, children: entry.children }, source)
          return updated.children === entry.children ? entry : updated
        }
        return entry
      })
      .filter((entry): entry is FileEntry => entry !== undefined)
    return children.every(
      (entry, index) => entry === directory.children[index]
    ) && children.length === directory.children.length
      ? directory
      : { ...directory, children }
  }
  const tree =
    mutation.type === 'renamed' ? remove(root, mutation.source) : root
  const file: FileEntry = {
    ...(previous?.children === null ? previous : {}),
    name: fsZds.basename(path),
    path,
    children: null,
  }
  function insert(
    directory: ProjectDirectory,
    depth: number
  ): ProjectDirectory {
    const parent = parents[depth]
    if (parent === undefined) {
      const index = directory.children.findIndex((entry) =>
        samePath(entry.path, destination)
      )
      const children = [...directory.children]
      if (index === -1) children.push(file)
      else children[index] = file
      return { ...directory, children }
    }
    const index = directory.children.findIndex((entry) =>
      samePath(entry.path, parent)
    )
    const existing = directory.children[index]
    // Successful creation or rename confirms these ancestors exist even if the snapshot missed them.
    const child = insert(
      existing?.children
        ? { ...existing, children: existing.children }
        : { name: fsZds.basename(parent), path: parent, children: [] },
      depth + 1
    )
    const children = [...directory.children]
    if (index === -1) children.push(child)
    else children[index] = child
    return { ...directory, children }
  }
  return insert(tree, 0)
}

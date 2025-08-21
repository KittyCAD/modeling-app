import type { FileEntry, Project } from '@src/lib/project'

export interface SnapshotContextHelpers {
  getFolders: () => Project[]
  getDefaultProjectFolderName: () => string
  getAllSubDirectoriesAtProjectRoot: (params: {
    projectFolderName: string
  }) => FileEntry[]
}

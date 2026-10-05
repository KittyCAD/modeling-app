import { getAppSettingsFilePath } from '@src/lib/desktop'
import {
  FileAlreadyExists,
  FileNotFound,
  type FileStat,
} from '@src/lib/fileSystem/fileOperations'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { vi } from 'vitest'

export const settingsProjectPath = '/settings-project'
export const settingsProjectFile = `${settingsProjectPath}/project.toml`
export const settingsProjectId = 'e8f5178c-5227-4567-bb5a-f52b3caef5ea'
export const settingsCloudId = '0656fb1a-9640-473e-b334-591dc70c0138'

/** A writable settings-file fixture that records persistence and supports IO failures. */
export async function settingsLoadingFiles(projectToml?: string) {
  const appFile = await getAppSettingsFilePath()
  const contents = new Map<string, string>([
    [
      appFile,
      '[settings.app.appearance]\ntheme = "dark"\n[settings.modeling]\nbase_unit = "ft"',
    ],
  ])
  if (projectToml !== undefined) contents.set(settingsProjectFile, projectToml)
  const directories = new Set([settingsProjectPath])
  const faults: { read?: Error; write?: Error } = {}
  const files = {
    ...testFileOperations,
    stat: vi.fn<FileOperationsRegistryService['stat']>(
      async (path): Promise<FileStat> => {
        if (!contents.has(path) && !directories.has(path))
          return Promise.reject(
            new FileNotFound({
              operation: 'stat',
              path,
              cause: undefined,
              message: 'ENOENT',
            })
          )
        return {
          kind: directories.has(path) ? 'directory' : 'file',
          device: 0,
          inode: 0,
          size: contents.get(path)?.length ?? 0,
          accessedAt: 0,
          modifiedAt: 0,
          changedAt: 0,
          createdAt: 0,
        }
      }
    ),
    readFile: vi.fn<FileOperationsRegistryService['readFile']>(async (path) => {
      if (path === settingsProjectFile && faults.read)
        return Promise.reject(faults.read)
      const value = contents.get(path)
      if (value === undefined)
        return Promise.reject(
          new FileNotFound({
            operation: 'read-file',
            path,
            cause: undefined,
            message: 'ENOENT',
          })
        )
      return new TextEncoder().encode(value)
    }),
    writeFile: vi.fn<FileOperationsRegistryService['writeFile']>(
      async (path, value) => {
        if (faults.write) return Promise.reject(faults.write)
        contents.set(
          path,
          typeof value === 'string' ? value : new TextDecoder().decode(value)
        )
      }
    ),
    createDirectory: vi.fn<FileOperationsRegistryService['createDirectory']>(
      async (path) => {
        if (directories.has(path))
          return Promise.reject(
            new FileAlreadyExists({
              operation: 'create-directory',
              path,
              cause: undefined,
              message: 'EEXIST',
            })
          )
        directories.add(path)
      }
    ),
  }
  return { files, contents, faults }
}

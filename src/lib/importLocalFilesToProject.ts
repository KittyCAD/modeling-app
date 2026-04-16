import { getNextFileName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import { joinOSPaths } from '@src/lib/paths'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export type LocalProjectImportSource = {
  name: string
  relativePath?: string
  readData: () => Promise<Uint8Array>
}

export async function importLocalFilesToProject({
  files,
  projectPath,
  wasmInstance,
}: {
  files: LocalProjectImportSource[]
  projectPath: string
  wasmInstance: ModuleType
}) {
  await fsZds.mkdir(projectPath, { recursive: true })

  const createdDirs = new Set<string>()
  const importedPaths: string[] = []

  for (const file of files) {
    const relativePath = file.relativePath || ''
    const destinationDirPath = relativePath
      ? joinOSPaths(projectPath, relativePath)
      : projectPath

    if (relativePath && !createdDirs.has(destinationDirPath)) {
      await fsZds.mkdir(destinationDirPath, { recursive: true })
      createdDirs.add(destinationDirPath)
    }

    const { path: destinationPath } = await getNextFileName({
      entryName: file.name,
      baseDir: destinationDirPath,
      wasmInstance,
    })

    await fsZds.writeFile(destinationPath, await file.readData())
    importedPaths.push(destinationPath)
  }

  return importedPaths
}

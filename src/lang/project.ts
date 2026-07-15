import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import fsZds from '@src/lib/fs-zds'
import { runWithProjectFilesystemMutationLock } from '@src/lib/projectDirectoryNamespaceLock'

import { changeDefaultUnits, changeKclVersion } from '@src/lang/wasm'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  DEFAULT_KCL_VERSION,
} from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/**
 * Create a new KCL file with the given initial content and default length unit.
 * @returns KCL string
 */
export function newKclFile(
  initialContent: string | undefined,
  defaultLengthUnit: UnitLength,
  wasmInstance: ModuleType
): string | Error {
  // If we're given non-empty initial content, we're loading a file that should
  // already have settings in it. Don't modify it.
  if (initialContent !== undefined && initialContent !== '') {
    return initialContent
  }

  let codeToWrite = ''
  if (defaultLengthUnit !== DEFAULT_DEFAULT_LENGTH_UNIT) {
    const codeWithDefaultUnits = changeDefaultUnits(
      codeToWrite,
      defaultLengthUnit,
      wasmInstance
    )
    if (err(codeWithDefaultUnits)) {
      return codeWithDefaultUnits
    }
    codeToWrite = codeWithDefaultUnits
  }

  return changeKclVersion(codeToWrite, DEFAULT_KCL_VERSION, wasmInstance)
}

export async function projectSkeletonCreate(
  targetPath: string,
  defaultLengthUnit: UnitLength,
  wasmInstance: ModuleType
) {
  return runWithProjectFilesystemMutationLock(
    async () => {
      await fsZds.mkdir(fsZds.dirname(targetPath), { recursive: true })
      const codeToWrite = newKclFile(undefined, defaultLengthUnit, wasmInstance)
      if (err(codeToWrite)) {
        return Promise.reject(codeToWrite)
      }
      await fsZds.writeFile(targetPath, new TextEncoder().encode(codeToWrite))
    },
    { ifAvailable: true, mode: 'shared' }
  )
}

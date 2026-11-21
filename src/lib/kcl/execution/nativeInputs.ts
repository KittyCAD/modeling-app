import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/** Native input metadata is read after WASM initializes, independently of scene startup. */
export async function readKclVersion(
  contents: string,
  wasm: Promise<ModuleType>
) {
  return getKclLanguageVersion(contents, await wasm)
}

export async function readKclFileExtensions(wasm: Promise<ModuleType>) {
  return (await wasm).relevant_file_extensions()
}

import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { ExecState, Program } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { rustContext } from '@src/lib/singletons'
import type RustContext from '@src/lib/rustContext'

export async function enginelessExecutor(
  ast: Node<Program>,
  usePrevMemory?: boolean,
  path?: string,
  providedRustContext?: RustContext
): Promise<ExecState> {
  const settings = await jsAppSettings()
  const theRustContext = providedRustContext ? providedRustContext : rustContext
  return await theRustContext.executeMock(ast, settings, path, usePrevMemory)
}

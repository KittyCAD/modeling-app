import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { ExecState, Program } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { rustContext } from '@src/lib/singletons'

export async function enginelessExecutor(
  ast: Node<Program>,
  usePrevMemory?: boolean,
  path?: string
): Promise<ExecState> {
  const settings = { settings: await jsAppSettings() }
  return await rustContext.executeMock(ast, settings, path, usePrevMemory)
}

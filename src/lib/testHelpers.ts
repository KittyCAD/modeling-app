import { Node } from '@rust/kcl-lib/bindings/Node'

import { ExecState, Program, jsAppSettings } from '../lang/wasm'
import { rustContext } from './singletons'

export async function enginelessExecutor(
  ast: Node<Program>,
  usePrevMemory?: boolean,
  path?: string
): Promise<ExecState> {
  const settings = { settings: await jsAppSettings() }
  return await rustContext.executeMock(ast, settings, path, usePrevMemory)
}

<<<<<<< HEAD
import { Program, ExecState, jsAppSettings } from '../lang/wasm'
import { Node } from '@rust/kcl-lib/bindings/Node'
import { rustContext } from './singletons'
=======
import { Program, executeMock, ExecState } from '../lang/wasm'
import { Node } from '@rust/kcl-lib/bindings/Node'
>>>>>>> 2a5bd269f (more)

export async function enginelessExecutor(
  ast: Node<Program>,
  usePrevMemory?: boolean,
  path?: string
): Promise<ExecState> {
  const settings = { settings: await jsAppSettings() }
  return await rustContext.executeMock(ast, settings, path, usePrevMemory)
}

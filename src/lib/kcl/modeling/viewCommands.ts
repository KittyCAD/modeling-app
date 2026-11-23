import type { ModelingCmd, UnitLength } from '@kittycad/lib'
import { changeDefaultUnits } from '@src/lang/wasm'
import { buildMinimalDocumentChange } from '@src/lib/minimalDocumentChange'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { KclSceneResource } from '@src/lib/kcl/scene/open'
import type { SelectionModel } from '@src/lib/kcl/scene/selection'
import { isErr } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'

/** Geometry queries address the displayed execution, which can remain valid after working-text edits. */
export function boundSceneCommands(
  context: Pick<ModelingViewContext, 'executor' | 'session'>,
  scene: KclSceneResource | undefined,
  model: SelectionModel | null
) {
  const { editor } = context.executor
  const current = () =>
    !!scene &&
    !!model &&
    !editor.signal.aborted &&
    context.session.resource.peek() === scene &&
    scene.selection.model.peek() === model &&
    scene.isConnected() &&
    !scene.runtime.executing.peek() &&
    !scene.runtime.failed.peek()

  return async (command: ModelingCmd): Promise<unknown> => {
    if (!current() || !scene)
      return new Error(
        'The model changed. Wait for execution to finish and try again.'
      )
    const response = await scene.commands.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: command,
    })
    return current()
      ? response
      : new Error('The model changed before the request completed.')
  }
}

export async function setViewFileUnits(
  context: Pick<ModelingViewContext, 'executor' | 'wasm'>,
  unit: UnitLength
): Promise<Error | undefined> {
  const { editor } = context.executor
  const before = editor.contents.peek()
  const source = editor.src.peek()
  const wasm = await context.wasm
  if (editor.signal.aborted || editor.readOnly.peek())
    return new Error('The editor is closed or read-only.')
  if (editor.contents.peek() !== before || editor.src.peek() !== source)
    return new Error(
      'The source changed before units could be updated. Try again.'
    )
  const next = changeDefaultUnits(before, unit, wasm)
  if (isErr(next)) return next
  const changes = buildMinimalDocumentChange(before, next)
  if (changes) editor.dispatch({ changes })
  return undefined
}

import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { ModelingCmd, UnitLength } from '@kittycad/lib'
import { changeDefaultUnits } from '@src/lang/wasm'
import { buildMinimalDocumentChange } from '@src/lib/minimalDocumentChange'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { KclSceneResource } from '@src/lib/kcl/scene'
import type { SelectionModel } from '@src/lib/scene/selection'
import { isErr } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'

/** Both request and reply must still belong to this exact view's executed source. */
export function boundSceneCommands(
  context: Pick<ModelingViewContext, 'executor' | 'session'>,
  scene: KclSceneResource | undefined,
  model: SelectionModel | null,
  source: { contents: string; src: string } = context.executor.output.peek()
) {
  const { editor } = context.executor
  const current = () =>
    !!scene &&
    !!model &&
    !editor.signal.aborted &&
    context.session.resource.peek() === scene &&
    scene.selection.model.peek() === model &&
    !scene.runtime.executing.peek() &&
    !scene.runtime.failed.peek() &&
    !context.executor.output.peek().running &&
    !context.executor.output.peek().errors['kcl.execution'] &&
    editor.contents.peek() === source.contents &&
    (editor.src.peek() ?? '') === source.src
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

/** Legacy reference helpers query only the captured scene; expired results cannot become reference rows. */
export function boundSceneQueries(
  context: Pick<ModelingViewContext, 'executor' | 'session'>,
  scene: KclSceneResource,
  model: SelectionModel
): Pick<ConnectionManager, 'sendSceneCommand'> {
  const send = boundSceneCommands(context, scene, model)
  return {
    sendSceneCommand: async (request) => {
      if (request.type !== 'modeling_cmd_req') return null
      const result = await send(request.cmd)
      return isModelingResponse(result) ? result : null
    },
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

import { batch } from '@preact/signals-core'
import * as dialogArguments from '@src/components/ModelingDialog/arguments'
import { createModelingCodePreview } from '@src/components/ModelingDialog/codePreview'
import { assertParse } from '@src/lang/wasm'
import { createCodeChangesPreview } from '@src/lib/codeChangesPreview'
import type { Command } from '@src/lib/commandTypes'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { expect, it, vi } from 'vitest'

it('previews the latest draft/source without editing code and discards work when the command closes', async () => {
  const world = await buildTheWorldAndNoEngineConnection()
  const { kclManager, commandBarActor: commandBar } = world
  const source = '@settings(kclVersion = 3.0)'
  const setSource = (code: string) =>
    batch(() => {
      kclManager.updateCodeEditor(code, {
        shouldExecute: false,
        shouldWriteToDisk: false,
        shouldSyncRust: false,
      })
      kclManager.astSignal.value = assertParse(code, world.instance)
      kclManager.hasEditsSinceLastExecutionSignal.value = false
    })
  setSource(source)
  const command: Command = {
    name: 'Named View',
    groupId: 'modeling',
    scopes: GLOBAL_COMMAND_SCOPES,
    useModelingDialog: true,
    needsReview: true,
    onSubmit: () => {},
    args: { name: { inputType: 'string', required: true } },
  }
  commandBar.send({ type: 'Add commands', data: { commands: [command] } })
  commandBar.send({
    type: 'Find and select command',
    data: { name: command.name, groupId: command.groupId },
  })
  const preview = createCodeChangesPreview(() => kclManager)
  const controller = createModelingCodePreview({
    kclManager,
    commandBar,
    preview,
  })
  const update = (name: string) =>
    controller.update({
      context: commandBar.getSnapshot().context,
      values: {
        name,
        orientation: 'Front',
        projection: 'Orthographic',
        baseline: 'Show',
      },
      incomplete: false,
    })
  const expectPreview = (name: string, beforeText = source) =>
    expect(preview.current.value).toMatchObject({
      status: 'ready',
      beforeText,
      afterText: expect.stringContaining(`"${name}"`),
    })
  vi.useFakeTimers()
  try {
    update('First')
    controller.toggle()
    await vi.advanceTimersByTimeAsync(300)
    expectPreview('First')
    expect(kclManager.code).toBe(source)

    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const resolveArguments = dialogArguments.resolveArguments
    const resolving = vi
      .spyOn(dialogArguments, 'resolveArguments')
      .mockImplementationOnce(async (...args) => {
        await pending
        return resolveArguments(...args)
      })
    update('Obsolete')
    await vi.advanceTimersByTimeAsync(300)
    expect(resolving).toHaveBeenCalledOnce()
    update('Latest')
    await vi.advanceTimersByTimeAsync(300)
    expectPreview('Latest')
    finish()
    await resolving.mock.results[0]?.value
    expectPreview('Latest')

    const changedSource = `${source}\nwidth = 2mm`
    setSource(changedSource)
    await vi.advanceTimersByTimeAsync(300)
    expectPreview('Latest', changedSource)

    resolving.mockImplementationOnce(async (...args) => {
      commandBar.send({ type: 'Close' })
      return resolveArguments(...args)
    })
    update('Cancelled')
    await vi.advanceTimersByTimeAsync(300)
    expect(preview.current.value).toBeNull()
    expect(controller.available.value).toBe(false)
    expect(kclManager.code).toBe(changedSource)
  } finally {
    controller.dispose()
    preview.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
    commandBar.stop()
    world.settingsActor.stop()
    world.engineCommandManager.tearDown({
      route: 'user-requested',
      initiatedBy: 'client',
    })
  }
})

import { expect, it } from 'vitest'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import { boundSceneCommands } from '@src/lib/kcl/viewCommands'
import type { KclSceneResource } from '@src/lib/kcl/scene'

it('sends commands to the owning view even when another view exists', async () => {
  const first = modelingTestContext(),
    second = modelingTestContext()
  try {
    const send = boundSceneCommands(
      first.context,
      first.resource as unknown as KclSceneResource,
      first.resource.selection.model.peek()
    )
    await send({ type: 'volume', entity_ids: [], output_unit: 'mm3' })
    expect(first.resource.commands.sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: { type: 'volume', entity_ids: [], output_unit: 'mm3' },
      })
    )
    expect(second.resource.commands.sendSceneCommand).not.toHaveBeenCalled()
  } finally {
    first.dispose()
    second.dispose()
  }
})

it.each(['source edit', 're-execution', 'close'] as const)(
  'rejects replies after %s and refuses new commands through the old binding',
  async (change) => {
    const view = modelingTestContext()
    let reply!: (value: unknown) => void
    view.resource.commands.sendSceneCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve
        })
    )
    try {
      const send = boundSceneCommands(
        view.context,
        view.resource as unknown as KclSceneResource,
        view.resource.selection.model.peek()
      )
      const pending = send({
        type: 'volume',
        entity_ids: [],
        output_unit: 'mm3',
      })
      if (change === 'source edit')
        view.editor.dispatch({ changes: { from: 0, insert: '// changed\n' } })
      if (change === 're-execution')
        view.resource.selection.setModel({
          sceneId: Symbol(),
          executionId: Symbol(),
        })
      if (change === 'close') view.dispose()
      reply({ volume: 1000 })
      expect(await pending).toBeInstanceOf(Error)
      view.resource.commands.sendSceneCommand.mockClear()
      expect(
        await send({ type: 'volume', entity_ids: [], output_unit: 'mm3' })
      ).toBeInstanceOf(Error)
      expect(view.resource.commands.sendSceneCommand).not.toHaveBeenCalled()
    } finally {
      view.dispose()
    }
  }
)

import { expect, it } from 'vitest'
import { modelingTestContext } from '@src/lib/kcl/modeling/testContext'
import { boundSceneCommands } from '@src/lib/kcl/modeling/viewCommands'

it('sends commands to the owning view even when another view exists', async () => {
  const first = modelingTestContext(),
    second = modelingTestContext()
  try {
    const send = boundSceneCommands(
      first.context,
      first.resource,
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

it.each(['re-execution', 'close'] as const)(
  'rejects replies after %s and refuses new commands through the old binding',
  async (change) => {
    const view = modelingTestContext()
    let reply!: (value: null) => void
    view.resource.commands.sendSceneCommand.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          reply = resolve
        })
    )
    try {
      const send = boundSceneCommands(
        view.context,
        view.resource,
        view.resource.selection.model.peek()
      )
      const pending = send({
        type: 'volume',
        entity_ids: [],
        output_unit: 'mm3',
      })
      if (change === 're-execution')
        view.resource.selection.setModel({
          sceneId: Symbol(),
          executionId: Symbol(),
        })
      if (change === 'close') view.dispose()
      reply(null)
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

it('keeps geometry queries valid when only working text or source capture changes', async () => {
  const view = modelingTestContext()
  const response = Promise.withResolvers<null>()
  view.resource.commands.sendSceneCommand.mockReturnValue(response.promise)
  const model = view.resource.selection.model.peek()
  const send = boundSceneCommands(view.context, view.resource, model)
  try {
    const pending = send({ type: 'volume', entity_ids: [], output_unit: 'mm3' })
    view.editor.dispatch({ changes: { from: 0, insert: '// not rendered\n' } })
    view.viewState.value = {
      ...view.viewState.peek(),
      stale: true,
      running: true,
    }
    response.resolve(null)
    expect(await pending).toBeNull()
    expect(view.resource.selection.model.peek()).toBe(model)
    expect(
      await send({ type: 'volume', entity_ids: [], output_unit: 'mm3' })
    ).toBeNull()
  } finally {
    view.dispose()
  }
})

it('rejects a query response if its scene is replaced while waiting', async () => {
  const view = modelingTestContext()
  const response = Promise.withResolvers<null>()
  view.resource.commands.sendSceneCommand.mockReturnValue(response.promise)
  try {
    const send = boundSceneCommands(
      view.context,
      view.resource,
      view.resource.selection.model.peek()
    )
    const pending = send({ type: 'volume', entity_ids: [], output_unit: 'mm3' })
    view.context.session.resource.value = undefined
    response.resolve(null)
    expect(await pending).toBeInstanceOf(Error)
    expect(
      await send({ type: 'volume', entity_ids: [], output_unit: 'mm3' })
    ).toBeInstanceOf(Error)
  } finally {
    view.dispose()
  }
})

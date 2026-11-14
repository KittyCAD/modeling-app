import { expect, it, vi } from 'vitest'
import { sendQueryEntityTypeWithPointFromSceneClick } from '@src/lib/scene/picking'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { SelectionModel } from '@src/lib/scene/selection'
import { sceneSelectionAdapter } from '@src/lib/scene/selectionAdapter'

const model: SelectionModel = {
  sceneId: Symbol('scene'),
  executionId: Symbol('execution'),
}

it.each([false, true])(
  'uses the existing point query and coordinate conversion (wrapped reply: %s)',
  async (wrapped) => {
    const reference = { type: 'region' as const, region_id: 'region' }
    const response = {
      success: true,
      resp: {
        type: 'modeling',
        data: {
          modeling_response: {
            type: 'query_entity_type_with_point',
            data: { reference },
          },
        },
      },
    }
    const send = vi.fn().mockResolvedValue(wrapped ? [response] : response)
    const commands = {
      streamDimensions: { width: 800, height: 600 },
      sendSceneCommand: send,
    } as Pick<ConnectionManager, 'streamDimensions' | 'sendSceneCommand'>
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 50, 400, 300)
    )
    const adapter = sceneSelectionAdapter(commands, canvas)
    expect(await adapter.pick({ clientX: 200, clientY: 125 })).toEqual({
      reference,
    })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: {
          type: 'query_entity_type_with_point',
          selected_at_window: { x: 200, y: 150 },
          selection_type: 'add',
        },
      })
    )
  }
)

it('distinguishes a genuine background hit from an unavailable local model', async () => {
  const commands = {
    streamDimensions: { width: 100, height: 100 },
    sendSceneCommand: vi.fn().mockResolvedValue(null),
  }
  const element = { getBoundingClientRect: () => new DOMRect(0, 0, 100, 100) }
  expect(
    await sendQueryEntityTypeWithPointFromSceneClick(
      { clientX: 0, clientY: 0 },
      element,
      commands
    )
  ).toBeUndefined()
  commands.sendSceneCommand.mockResolvedValue({
    success: true,
    resp: {
      type: 'modeling',
      data: {
        modeling_response: { type: 'query_entity_type_with_point', data: {} },
      },
    },
  })
  expect(
    await sendQueryEntityTypeWithPointFromSceneClick(
      { clientX: 0, clientY: 0 },
      element,
      commands
    )
  ).toEqual({})
})

it('stops a highlight projection when its execution changes during a command', async () => {
  const gate = Promise.withResolvers<null>()
  const send = vi.fn().mockReturnValue(gate.promise)
  const adapter = sceneSelectionAdapter(
    { sendSceneCommand: send, streamDimensions: { width: 100, height: 100 } },
    document.createElement('canvas')
  )
  let current = true
  const pending = adapter.present(
    [{ type: 'region', region_id: 'old' }],
    ['region'],
    () => current,
    model
  )
  current = false
  gate.resolve(null)
  await pending
  expect(send).toHaveBeenCalledOnce()
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({
      cmd: expect.objectContaining({ type: 'select_entity' }),
    })
  )
})

it('replaces nonempty selections without a blank intermediate state or resending an unchanged filter', async () => {
  const frames: string[][] = []
  const send = vi.fn<ConnectionManager['sendSceneCommand']>(async (request) => {
    if (request.type !== 'modeling_cmd_req') return null
    if (request.cmd.type === 'select_clear') frames.push([])
    if (request.cmd.type === 'select_entity')
      frames.push(
        request.cmd.entities.map((entity) =>
          entity.type === 'face' ? entity.face_id : 'other'
        )
      )
    return null
  })
  const adapter = sceneSelectionAdapter(
    { sendSceneCommand: send, streamDimensions: { width: 100, height: 100 } },
    document.createElement('canvas')
  )
  const face = (face_id: string) => ({ type: 'face' as const, face_id })
  await adapter.present([face('A')], ['face'], () => true, model)
  await adapter.present([face('B')], ['face'], () => true, model)
  await adapter.present([face('B'), face('C')], ['face'], () => true, model)
  expect(frames).toEqual([['A'], ['B'], ['B', 'C']])
  expect(
    send.mock.calls.filter(
      ([request]) =>
        request.type === 'modeling_cmd_req' &&
        request.cmd.type === 'set_selection_filter'
    )
  ).toHaveLength(1)
  await adapter.present([], ['face'], () => true, model)
  expect(frames).toEqual([['A'], ['B'], ['B', 'C'], []])
  await adapter.present([], ['edge'], () => true, model)
  expect(
    send.mock.calls.filter(
      ([request]) =>
        request.type === 'modeling_cmd_req' &&
        request.cmd.type === 'set_selection_filter'
    )
  ).toHaveLength(2)
  await adapter.present([], ['edge'], () => true, {
    ...model,
    executionId: Symbol('new execution'),
  })
  expect(
    send.mock.calls.filter(
      ([request]) =>
        request.type === 'modeling_cmd_req' &&
        request.cmd.type === 'set_selection_filter'
    )
  ).toHaveLength(3)
})

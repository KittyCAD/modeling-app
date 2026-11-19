import type { WebSocketResponse } from '@kittycad/lib'
import {
  EngineCassette,
  type EngineRequest,
} from '@src/machines/modelingMachine.engineCassette'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
]
const start = (id: string): EngineRequest => ({
  type: 'modeling_cmd_req',
  cmd_id: id,
  cmd: { type: 'start_path' },
})
const response = (id: string): WebSocketResponse => ({
  success: true,
  request_id: id,
  resp: {
    type: 'modeling',
    data: { modeling_response: { type: 'start_path', data: {} } },
  },
})

describe('engine cassette correlation', () => {
  it('rebinds command IDs and batch acknowledgement keys', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 3, maxLength: 3 }),
        fc.integer(),
        ([batch, path, segment], x) => {
          const recorded: EngineRequest = {
            type: 'modeling_cmd_batch_req',
            batch_id: ids[0],
            requests: [
              { cmd_id: ids[1], cmd: { type: 'start_path' } },
              {
                cmd_id: ids[2],
                cmd: {
                  type: 'move_path_pen',
                  path: ids[1],
                  to: { x, y: 0, z: 0 },
                },
              },
            ],
            responses: true,
          }
          const actual: EngineRequest = {
            ...recorded,
            batch_id: batch,
            requests: [
              { cmd_id: path, cmd: { type: 'start_path' } },
              {
                cmd_id: segment,
                cmd: { type: 'move_path_pen', path, to: { x, y: 0, z: 0 } },
              },
            ],
          }
          const tape = new EngineCassette([
            {
              request: recorded,
              responses: [
                {
                  success: true,
                  request_id: ids[0],
                  resp: {
                    type: 'modeling_batch',
                    data: {
                      responses: {
                        [ids[1]]: {
                          response: { type: 'start_path', data: {} },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ])
          expect(tape.reply(actual)).toEqual([
            {
              success: true,
              request_id: batch,
              resp: {
                type: 'modeling_batch',
                data: {
                  responses: {
                    [path]: { response: { type: 'start_path', data: {} } },
                  },
                },
              },
            },
          ])
          tape.assertConsumed()
        }
      )
    )
  })

  it('rejects changed geometry and does not consume a mismatched request', () => {
    const request = {
      type: 'modeling_cmd_req',
      cmd_id: ids[0],
      cmd: { type: 'move_path_pen', path: ids[1], to: { x: 10, y: 20, z: 0 } },
    } satisfies EngineRequest
    const tape = new EngineCassette([
      { request, responses: [response(ids[0])] },
    ])
    expect(() =>
      tape.reply({
        ...request,
        cmd: { ...request.cmd, to: { x: 11, y: 20, z: 0 } },
      })
    ).toThrow('Unrecorded')
    expect(tape.reply(request)).toEqual([response(ids[0])])
  })

  it('keeps a geometry reference bound to its original command across messages', () => {
    const request = {
      type: 'modeling_cmd_req',
      cmd_id: ids[1],
      cmd: { type: 'move_path_pen', path: ids[0], to: { x: 10, y: 20, z: 0 } },
    } satisfies EngineRequest
    const tape = new EngineCassette([
      { request: start(ids[0]), responses: [response(ids[0])] },
      { request, responses: [response(ids[1])] },
    ])
    tape.reply(start(ids[2]))
    expect(() => tape.reply(request)).toThrow('Unrecorded')
    expect(() => tape.assertConsumed()).toThrow('Unconsumed')
    expect(
      tape.reply({ ...request, cmd: { ...request.cmd, path: ids[2] } })
    ).toEqual([response(ids[1])])
    tape.assertConsumed()
  })

  it('rejects collapsing distinct geometry IDs onto one live ID', () => {
    const request: EngineRequest = {
      type: 'modeling_cmd_batch_req',
      batch_id: ids[0],
      requests: [
        { cmd_id: ids[1], cmd: { type: 'start_path' } },
        { cmd_id: ids[2], cmd: { type: 'start_path' } },
      ],
    }
    const tape = new EngineCassette([
      { request, responses: [response(ids[0])] },
    ])
    expect(() =>
      tape.reply({
        ...request,
        requests: [request.requests[0], request.requests[0]],
      })
    ).toThrow('Unrecorded')
  })

  it('rejects missing or extra messages instead of silently using the network', () => {
    const tape = new EngineCassette([
      { request: start(ids[0]), responses: [response(ids[0])] },
    ])
    expect(() => tape.assertConsumed()).toThrow('Unconsumed')
    tape.reply(start(ids[1]))
    expect(() => tape.reply(start(ids[2]))).toThrow('Unrecorded')
  })
})

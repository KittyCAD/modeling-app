import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import { assertParse } from '@src/lang/wasm'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { expect, it, vi } from 'vitest'

const codeForVersion = (
  version: KclVersion
) => `@settings(kclVersion = "${version}", defaultLengthUnit = mm)
sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [10, 0])
  right = line(start = [10, 0], end = [10, 10])
  top = line(start = [10, 10], end = [0, 10])
  left = line(start = [0, 10], end = [0, 0])
}
region001 = region(point = [5, 5], sketch = sketch001)
body001 = extrude(region001, length = 5)`

it('switches KCL versions in both directions on the same engine connection', async () => {
  const { instance, kclManager, engineCommandManager } =
    await buildTheWorldAndConnectToEngine({
      webrtc: false,
      pool: 'cpu',
    })
  try {
    const connection = engineCommandManager.connection
    if (!connection?.websocket) throw new Error('Expected an engine WebSocket')
    expect(
      new URL(connection.websocket.url).searchParams.has('kcl_version')
    ).toBe(false)

    const send = vi.spyOn(connection, 'send')
    const versions: KclVersion[] = ['2.0', '3.0-preview', '2.0']
    for (const version of versions) {
      send.mockClear()
      await kclManager.executeAst({
        ast: assertParse(codeForVersion(version), instance),
      })

      expect(kclManager.errors).toEqual([])
      expect(kclManager.variables.body001).toMatchObject({ type: 'Solid' })
      expect(engineCommandManager.connection).toBe(connection)
      const commands = send.mock.calls.flatMap(([message]) => {
        if (message.type === 'modeling_cmd_batch_req') {
          return message.requests.map(({ cmd }) => cmd)
        }
        return message.type === 'modeling_cmd_req' ? [message.cmd] : []
      })
      expect(commands.filter(({ type }) => type === 'set_kcl_version')).toEqual(
        [{ type: 'set_kcl_version', kcl_version: version }]
      )
    }
  } finally {
    vi.restoreAllMocks()
    engineCommandManager.tearDown({
      route: 'user-requested',
      initiatedBy: 'client',
    })
  }
}, 30_000)

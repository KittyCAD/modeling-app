import { PNG } from 'pngjs'
import env from '@src/env'
import { createKclRuntime } from '@src/lib/kcl/execution/runtime'
import { createTestKclExecutionSettings } from '@src/lib/kcl/scene/executionSettingsTestUtils'
import { createTestSettings } from '@src/lib/kcl/testFixtures'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { uuidv4, isArray } from '@src/lib/utils'
import { expect, it, onTestFinished } from 'vitest'

it('updates existing streamed backfaces without rebuilding the native scene', async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  const wasm = await loadAndInitialiseWasmInstance(
    'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm'
  )
  const settings = createTestSettings()
  settings.current.peek().modeling.backfaceColor.user = '#ff0000'
  const inputs = createTestKclExecutionSettings(() => settings.current.peek())
  const manager = new ConnectionManager({ settingsActor: settings.actor })
  onTestFinished(() =>
    manager.tearDown({ route: 'service-disposed', initiatedBy: 'client' })
  )
  const connected = Promise.withResolvers<undefined>()
  await manager.start({
    token: env().VITE_ZOO_API_TOKEN ?? '',
    width: 256,
    height: 256,
    geometryOnly: false,
    unitTestWebrtc: false,
    unitTestGeometryOnly: false,
    setStreamIsReady: () => {},
    callbackOnUnitTestingConnection: (message) => {
      if (message === 'auth success') connected.resolve(undefined)
      if (message === 'auth_token_invalid')
        connected.reject(new Error('Engine authentication failed'))
    },
  })
  const deadline = setTimeout(
    () => connected.reject(new Error('Engine authentication timed out')),
    15000
  )
  manager.connection?.websocket?.addEventListener('error', () =>
    connected.reject(new Error('Engine WebSocket failed'))
  )
  try {
    await connected.promise
  } finally {
    clearTimeout(deadline)
  }
  const model = await createKclRuntime(Promise.resolve(wasm), manager, () =>
    inputs.configuration.peek()
  )
  const code = `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  perimeter = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([perimeter.center, ORIGIN])
  radius(perimeter) == 10mm
  horizontal([perimeter.center, perimeter.start])
}
body = extrude(region(segments = [profile.perimeter]), length = 20mm)
`
  const sources = {
    src: '/backfaces.kcl',
    files: new Map([['/backfaces.kcl', new TextEncoder().encode(code)]]),
  }
  const capture = async () => {
    const reply = await manager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'take_snapshot', format: 'png' },
    })
    if (
      !reply ||
      isArray(reply) ||
      !('resp' in reply) ||
      reply.resp.type !== 'modeling' ||
      reply.resp.data.modeling_response.type !== 'take_snapshot'
    )
      throw new Error('Missing snapshot response')
    const contents = Buffer.from(
      reply.resp.data.modeling_response.data.contents,
      'base64'
    )
    const image = PNG.sync.read(contents)
    let red = 0,
      green = 0
    for (let i = 0; i < image.data.length; i += 4) {
      const [r, g, b] = image.data.subarray(i, i + 3)
      if (r > g + 30 && r > b + 30) red++
      if (g > r + 30 && g > b + 30) green++
    }
    return {
      redFraction: red / (image.width * image.height),
      greenFraction: green / (image.width * image.height),
    }
  }
  try {
    const first = await model.execute(sources)
    // Looking from inside the solid makes the rendered pixels measure backfaces.
    await manager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 0, y: 0, z: 10 },
        center: { x: 10, y: 0, z: 10 },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    const red = await capture()
    expect(red.redFraction).toBeGreaterThan(0.5)
    settings.current.peek().modeling.backfaceColor.user = '#00ff00'
    const second = await model.execute(sources)
    const ordinary = await capture()
    expect(ordinary.greenFraction).toBeGreaterThan(0.5)
    expect(ordinary.redFraction).toBeLessThan(0.01)
    expect(second.engineSceneGeneration).toBe(first.engineSceneGeneration)
  } finally {
    await model.dispose()
  }
}, 60000)

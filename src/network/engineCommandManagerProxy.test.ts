import { decode as msgpackDecode } from '@msgpack/msgpack'
import { assertParse } from '@src/lang/wasm'
import { ConnectionManager } from '@src/network/connectionManager'
import type { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
import {
  OPEN_CASCADE_CIRCLE_EXTRUDE_KCL,
  OPEN_CASCADE_HELIX_KCL,
  OPEN_CASCADE_TRANSFORM_KCL,
} from '@src/network/openCascadeProofFixture'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it, vi } from 'vitest'

const RANGE = JSON.stringify([0, 0, 0])
const ID_MAP = '{}'

describe('EngineCommandManagerProxy', () => {
  it('delegates WASM modeling commands to Zoo by default', async () => {
    const { engineCommandManager } =
      await buildTheWorldAndNoEngineConnection(true)
    const proxy = engineCommandManager as EngineCommandManagerProxy
    const encoded = new Uint8Array([1, 2, 3])
    const spy = vi
      .spyOn(ConnectionManager.prototype, 'sendModelingCommandFromWasm')
      .mockResolvedValue(encoded)

    await expect(
      proxy.sendModelingCommandFromWasm(
        '00000000-0000-0000-0000-000000000001',
        RANGE,
        JSON.stringify({
          type: 'modeling_cmd_req',
          cmd_id: '00000000-0000-0000-0000-000000000002',
          cmd: { type: 'scene_clear_all' },
        }),
        ID_MAP
      )
    ).resolves.toBe(encoded)
    expect(spy).toHaveBeenCalledOnce()

    spy.mockRestore()
  })

  it('switches to OpenCascade without replacing the proxy object', async () => {
    const { engineCommandManager, settingsActor } =
      await buildTheWorldAndNoEngineConnection(true)
    const proxy = engineCommandManager as EngineCommandManagerProxy
    const originalProxy = proxy

    expect(proxy.currentEngine).toBe('zoo')

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )

    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    expect(proxy).toBe(originalProxy)
    expect(proxy.currentEngine).toBe('open_cascade')

    const encoded = await proxy.sendModelingCommandFromWasm(
      '00000000-0000-0000-0000-000000000003',
      RANGE,
      JSON.stringify({
        type: 'modeling_cmd_req',
        cmd_id: '00000000-0000-0000-0000-000000000004',
        cmd: { type: 'scene_clear_all' },
      }),
      ID_MAP
    )
    expect(encoded).toBeDefined()
    const response = msgpackDecode(encoded as Uint8Array)

    expect(response).toMatchObject({
      success: true,
      request_id: '00000000-0000-0000-0000-000000000003',
    })
  })

  it('forwards OpenCascade scene command batches for selection filters', async () => {
    const { engineCommandManager, settingsActor } =
      await buildTheWorldAndNoEngineConnection(true)
    const proxy = engineCommandManager as EngineCommandManagerProxy

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    await proxy.sendSceneCommand({
      type: 'modeling_cmd_batch_req',
      batch_id: '00000000-0000-0000-0000-000000000005',
      requests: [
        {
          cmd_id: '00000000-0000-0000-0000-000000000006',
          cmd: {
            type: 'set_selection_filter',
            filter: ['object'],
          },
        },
      ],
      responses: false,
    })

    expect(proxy.openCascadeCommandManager.latestSelectionFilter.value).toEqual(
      ['object']
    )
  })

  it('does not make OpenCascade execution stale when rejecting commands', async () => {
    const { engineCommandManager, settingsActor } =
      await buildTheWorldAndNoEngineConnection(true)
    const proxy = engineCommandManager as EngineCommandManagerProxy

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    proxy.rejectAllModelingCommands('cancel pending commands')

    expect(proxy.executionIsStale).toBe(false)
    await expect(
      proxy.sendModelingCommandFromWasm(
        '00000000-0000-0000-0000-000000000007',
        RANGE,
        JSON.stringify({
          type: 'modeling_cmd_req',
          cmd_id: '00000000-0000-0000-0000-000000000008',
          cmd: { type: 'scene_clear_all' },
        }),
        ID_MAP
      )
    ).resolves.toBeDefined()
  })

  it('runs OpenCascade previews against an isolated manager', async () => {
    const { engineCommandManager, instance, rustContext, settingsActor } =
      await buildTheWorldAndNoEngineConnection()
    const proxy = engineCommandManager as EngineCommandManagerProxy

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    const ast = assertParse(OPEN_CASCADE_CIRCLE_EXTRUDE_KCL, instance)
    await proxy.runOpenCascadePreviewAst(ast, rustContext, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(proxy.openCascadeCommandManager.getSolidCount()).toBe(0)
    const previewGlbs = await proxy.exportVisibleOpenCascadePreviewGlbBytes()
    expect(previewGlbs).toHaveLength(1)
    expect(previewGlbs[0]?.bytes.length).toBeGreaterThan(0)
    expect(proxy.latestOpenCascadePreviewStatus.value).toBe('ready')

    proxy.clearOpenCascadePreview()
    expect(await proxy.exportVisibleOpenCascadePreviewGlbBytes()).toEqual([])
    expect(proxy.latestOpenCascadePreviewStatus.value).toBe('idle')
  })

  it('exports transformed bodies from OpenCascade previews', async () => {
    const { engineCommandManager, instance, rustContext, settingsActor } =
      await buildTheWorldAndNoEngineConnection()
    const proxy = engineCommandManager as EngineCommandManagerProxy

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    const ast = assertParse(OPEN_CASCADE_TRANSFORM_KCL, instance)
    await proxy.runOpenCascadePreviewAst(ast, rustContext, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    const previewGlbs = await proxy.exportVisibleOpenCascadePreviewGlbBytes()
    expect(previewGlbs).toHaveLength(1)
    expect(previewGlbs[0]?.bytes.length).toBeGreaterThan(0)
  })

  it('keeps the last renderable OpenCascade preview after an empty preview result', async () => {
    const { engineCommandManager, instance, rustContext, settingsActor } =
      await buildTheWorldAndNoEngineConnection()
    const proxy = engineCommandManager as EngineCommandManagerProxy

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    const solidAst = assertParse(OPEN_CASCADE_CIRCLE_EXTRUDE_KCL, instance)
    await proxy.runOpenCascadePreviewAst(solidAst, rustContext, {
      settings: { modeling: { engine: 'open_cascade' } },
    })
    const firstPreviewVersion = proxy.latestOpenCascadePreviewVersion.value
    const firstPreviewGlbs =
      await proxy.exportVisibleOpenCascadePreviewGlbBytes()
    expect(firstPreviewGlbs).toHaveLength(1)

    const emptyAst = assertParse('answer = 1', instance)
    await proxy.runOpenCascadePreviewAst(emptyAst, rustContext, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(proxy.latestOpenCascadePreviewVersion.value).toBe(
      firstPreviewVersion
    )
    const retainedPreviewGlbs =
      await proxy.exportVisibleOpenCascadePreviewGlbBytes()
    expect(retainedPreviewGlbs).toHaveLength(1)
    expect(retainedPreviewGlbs[0]?.bytes.length).toBeGreaterThan(0)
  })

  it('keeps OpenCascade previews that render only sketch-line geometry', async () => {
    const { engineCommandManager, instance, rustContext, settingsActor } =
      await buildTheWorldAndNoEngineConnection()
    const proxy = engineCommandManager as EngineCommandManagerProxy

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    const ast = assertParse(OPEN_CASCADE_HELIX_KCL, instance)
    await proxy.runOpenCascadePreviewAst(ast, rustContext, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(await proxy.exportVisibleOpenCascadePreviewGlbBytes()).toEqual([])
    expect(
      proxy.exportLatestOpenCascadePreviewSketchLineMeshes().segments.length
    ).toBeGreaterThan(16)
    expect(proxy.latestOpenCascadePreviewStatus.value).toBe('ready')
  })

  it('keeps OpenCascade previews that render only offset-plane geometry', async () => {
    const { engineCommandManager, instance, rustContext, settingsActor } =
      await buildTheWorldAndNoEngineConnection()
    const proxy = engineCommandManager as EngineCommandManagerProxy

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    const ast = assertParse('plane001 = offsetPlane(XY, offset = 1)', instance)
    await proxy.runOpenCascadePreviewAst(ast, rustContext, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(await proxy.exportVisibleOpenCascadePreviewGlbBytes()).toEqual([])
    expect(
      proxy.exportLatestOpenCascadePreviewSketchLineMeshes().segments
    ).toHaveLength(0)
    expect(
      proxy.exportLatestOpenCascadePreviewPlaneMeshes().planes
    ).toHaveLength(1)
    expect(proxy.latestOpenCascadePreviewStatus.value).toBe('ready')
  })
})

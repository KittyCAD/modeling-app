import type { Connection } from '@src/lib/engineConnection/connection'
import { createKclManagerTestHarness } from '@src/lang/testHelpers/kclManagerTestHarness'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

describe('entrypoint version before the engine connection', () => {
  it('uses current code before execution, including after an edit', async () => {
    const { kclManager } = createKclManagerTestHarness(
      '@settings(kclVersion = 2.0)'
    )
    expect(await kclManager.getLanguageVersion()).toBe('2.0')
    kclManager.updateCodeEditor('@settings(kclVersion = "3.0-preview")', {
      shouldExecute: false,
      shouldWriteToDisk: false,
    })
    expect(await kclManager.getLanguageVersion()).toBe('3.0-preview')
  })

  it('rejects invalid settings instead of choosing a fallback', async () => {
    const { kclManager } = createKclManagerTestHarness(
      '@settings(kclVersion = 99.0)'
    )
    expect(await kclManager.getLanguageVersion()).toBeInstanceOf(Error)
    expect(kclManager.diagnostics.some((d) => d.severity === 'error')).toBe(
      true
    )
  })

  it('reconnects before executing a different version and preserves the requested AST', async () => {
    const { kclManager } = createKclManagerTestHarness(
      '@settings(kclVersion = 2.0)'
    )
    const ast = await kclManager.safeParse(
      '@settings(kclVersion = "3.0-preview")'
    )
    if (!ast) throw new Error('Expected parsed program')
    const requestReconnect = vi.fn()
    kclManager.engineCommandManager.started = true
    kclManager.engineCommandManager.connection = {
      kclVersion: '2.0',
      requestReconnect,
    } as unknown as Connection
    const execute = vi.spyOn(kclManager.rustContext, 'execute')
    await kclManager.executeAst({ ast })
    expect(execute).not.toHaveBeenCalled()
    expect(requestReconnect).toHaveBeenCalledOnce()
    expect(await kclManager.getLanguageVersion()).toBe('3.0-preview')
    const executeAst = vi.spyOn(kclManager, 'executeAst').mockResolvedValue()
    await kclManager.executeAfterReconnect()
    expect(executeAst).toHaveBeenCalledWith(expect.objectContaining({ ast }))
    expect(
      getKclLanguageVersion(ast, await kclManager.wasmInstancePromise)
    ).toBe('3.0-preview')
  })

  it('discards a pending AST when the editor changes during reconnect', async () => {
    const { kclManager } = createKclManagerTestHarness(
      '@settings(kclVersion = 2.0)'
    )
    const ast = await kclManager.safeParse(
      '@settings(kclVersion = "3.0-preview")'
    )
    if (!ast) throw new Error('Expected parsed program')
    kclManager.engineCommandManager.started = true
    kclManager.engineCommandManager.connection = {
      kclVersion: '2.0',
      requestReconnect: vi.fn(),
    } as unknown as Connection
    await kclManager.executeAst({ ast })
    kclManager.updateCodeEditor('@settings(kclVersion = 2.0)\nx = 1', {
      shouldExecute: false,
      shouldWriteToDisk: false,
    })
    expect(await kclManager.getLanguageVersion()).toBe('2.0')
    const executeCode = vi.spyOn(kclManager, 'executeCode').mockResolvedValue()
    await kclManager.executeAfterReconnect()
    expect(executeCode).toHaveBeenCalledOnce()
  })
})

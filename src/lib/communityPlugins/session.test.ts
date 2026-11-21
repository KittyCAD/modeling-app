import { createPluginSession } from '@src/lib/communityPlugins/session'
import { compilePlugin } from '@src/lib/communityPlugins/source'
import type { PluginRuntime } from '@src/lib/communityPlugins/runtime'
import { describe, expect, it, vi } from 'vitest'

async function source(message: string, permissions = '["ui.notify"]') {
  const result = await compilePlugin(`/* @zds-plugin
id = "test"
name = "Test"
api_version = 1
permissions = ${permissions}
*/
export default zds => zds.contribute('command', { id: 'test', title: 'Test', run: () => zds.ui.notify(${JSON.stringify(message)}) })`)
  if (result instanceof Error) throw result
  return result
}

describe('plugin development sessions', () => {
  it('waits for explicit start, reloads successful edits, and keeps the previous instance after failure', async () => {
    let installed: PluginRuntime | undefined
    const messages: string[] = []
    const session = createPluginSession(
      async (runtime) => {
        installed = runtime
        return undefined
      },
      (message) => messages.push(message)
    )
    try {
      const first = await source('first')
      await session.update(first)
      expect(installed).toBeUndefined()
      await session.start(first, new Set(['ui.notify']))
      const previous = installed!
      await session.update(await source('second'))
      expect(previous.invoke(0)).toBeInstanceOf(Error)
      expect(installed!.invoke(0)).toBeUndefined()
      const broken = await source('broken')
      await session.update({
        ...broken,
        javascript: "throw new Error('bad build')",
      })
      expect(session.status.value).toContain('bad build')
      expect(installed!.invoke(0)).toBeUndefined()
      expect(messages).toEqual(['second', 'second'])
      await session.stop()
      expect(installed).toBeUndefined()
    } finally {
      await session.dispose()
    }
  })

  it('requires approval when an edit adds permissions', async () => {
    let installed: PluginRuntime | undefined
    const session = createPluginSession(
      async (runtime) => {
        installed = runtime
        return undefined
      },
      () => {}
    )
    try {
      await session.start(await source('first', '[]'), new Set())
      const previous = installed
      await session.update(await source('second'))
      expect(installed).toBe(previous)
      expect(session.status.value).toContain('require approval')
    } finally {
      await session.dispose()
    }
  })

  it('revokes a candidate immediately when stopped during publication', async () => {
    const publication = Promise.withResolvers<undefined>()
    let candidate: PluginRuntime | undefined
    const messages: string[] = []
    const session = createPluginSession(
      async (runtime) => {
        if (runtime) {
          candidate = runtime
          await publication.promise
        }
        return undefined
      },
      (message) => messages.push(message)
    )
    try {
      const starting = session.start(
        await source('late'),
        new Set(['ui.notify'])
      )
      await vi.waitFor(() => expect(candidate).toBeDefined())
      const stopping = session.stop()
      expect(candidate!.invoke(0)).toBeInstanceOf(Error)
      expect(messages).toEqual([])
      publication.resolve(undefined)
      await Promise.all([starting, stopping])
      expect(session.status.value).toBe('Stopped')
    } finally {
      publication.resolve(undefined)
      await session.dispose()
    }
  })
})

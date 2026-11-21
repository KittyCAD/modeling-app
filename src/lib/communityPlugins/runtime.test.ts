import { compilePlugin } from '@src/lib/communityPlugins/source'
import {
  createPluginRuntime,
  type PluginRuntime,
} from '@src/lib/communityPlugins/runtime'
import { afterEach, describe, expect, it } from 'vitest'

const header = `/* @zds-plugin
id = "test"
name = "Test"
api_version = 1
permissions = ["ui.notify"]
*/\n`

describe('isolated local plugins', () => {
  const runtimes: PluginRuntime[] = []
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose()
  })
  async function load(body: string, grants = new Set(['ui.notify'])) {
    const source = await compilePlugin(header + body)
    if (source instanceof Error) throw source
    const messages: string[] = []
    const runtime = await createPluginRuntime(source, grants, (message) =>
      messages.push(message)
    )
    if (!(runtime instanceof Error)) runtimes.push(runtime)
    return { runtime, messages }
  }
  const command = (body: string) =>
    `export default zds => zds.contribute('command', { id: 'test', title: 'Test', run() { ${body} } })`

  it('erases SDK type imports and invokes a contributed command on demand', async () => {
    const { runtime, messages } = await load(
      `import type { Activate } from '@zoo/zds-plugin'; const activate: Activate = zds => zds.contribute('command', { id: 'test', title: 'Test', run: () => zds.ui.notify('Hello') }); export default activate`
    )
    if (runtime instanceof Error) throw runtime
    expect(messages).toEqual([])
    expect(runtime.invoke(0)).toBeUndefined()
    expect(messages).toEqual(['Hello'])
    runtime.dispose()
    expect(runtime.invoke(0)).toBeInstanceOf(Error)
    expect(messages).toEqual(['Hello'])
  })

  it('denies notifications without a grant', async () => {
    const { runtime, messages } = await load(
      command("zds.ui.notify('secret')"),
      new Set()
    )
    if (runtime instanceof Error) throw runtime
    expect(runtime.invoke(0)?.message).toContain('Permission denied')
    expect(messages).toEqual([])
  })

  it('does not expose browser, Node, Electron, or host globals', async () => {
    const { runtime, messages } = await load(
      command(
        "zds.ui.notify([typeof fetch, typeof process, typeof require, typeof window, typeof document, typeof electron].join(','))"
      )
    )
    if (runtime instanceof Error) throw runtime
    expect(runtime.invoke(0)).toBeUndefined()
    expect(messages).toEqual([
      'undefined,undefined,undefined,undefined,undefined,undefined',
    ])
  })

  it('rejects activation side effects before publication', async () => {
    const { runtime, messages } = await load(
      "export default zds => zds.ui.notify('not installed')"
    )
    expect(runtime).toBeInstanceOf(Error)
    expect(messages).toEqual([])
  })

  it.each([
    'export default () => { while (true) {} }',
    command('while (true) {}'),
  ])('interrupts unbounded guest execution', async (body) => {
    const { runtime } = await load(body)
    if (runtime instanceof Error)
      expect(runtime.message).toContain('interrupted')
    else expect(runtime.invoke(0)?.message).toContain('interrupted')
  })

  it('rejects runtime imports rather than executing them in the host', async () => {
    const { runtime } = await load(
      "import fs from 'node:fs'; export default () => fs.readFileSync('/etc/passwd')"
    )
    expect(runtime).toBeInstanceOf(Error)
  })

  it('limits guest heap allocation', async () => {
    const { runtime } = await load(
      'export default () => new Array(10_000_000).fill(42)'
    )
    expect(runtime).toBeInstanceOf(Error)
  })

  it('bounds notification spam in one command', async () => {
    const { runtime, messages } = await load(
      command("for (let i = 0; i < 100; i++) zds.ui.notify('hello')")
    )
    if (runtime instanceof Error) throw runtime
    expect(runtime.invoke(0)?.message).toContain('Notification limit')
    expect(messages).toHaveLength(10)
  })

  it('contains exceptions whose message accessor runs unbounded code', async () => {
    const { runtime } = await load(
      command('throw { get message() { while (true) {} } }')
    )
    if (runtime instanceof Error) throw runtime
    expect(runtime.invoke(0)).toBeInstanceOf(Error)
  })
})

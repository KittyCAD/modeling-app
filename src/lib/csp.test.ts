import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, platform } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import packageJson from '@root/package.json'
import { getAppFolderNameFromBuild } from '@src/lib/appFolderName'

const electron = vi.hoisted(() => ({
  app: { getPath: vi.fn() },
  net: { fetch: vi.fn() },
  session: { defaultSession: { protocol: { handle: vi.fn() } } },
}))
vi.mock('electron', () => electron)

import { registerFileProtocolCsp } from '@src/lib/csp'

describe('desktop review lab CSP', () => {
  let root: string
  let indexPath: string
  let configPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await mkdtemp(path.join(tmpdir(), 'zds-api-csp-'))
    electron.app.getPath.mockReturnValue(root)
    electron.net.fetch.mockImplementation(async () => new Response('unchanged'))
    const profile = path.join(
      root,
      getAppFolderNameFromBuild({
        packageName: packageJson.name,
        packageVersion: packageJson.version,
        platform: platform(),
      })
    )
    await mkdir(path.join(profile, 'envs'), { recursive: true })
    await writeFile(path.join(profile, 'environment.txt'), 'dev.zoo.dev')
    configPath = path.join(profile, 'envs/dev.zoo.dev.json')
    indexPath = path.join(root, 'index.html')
    await writeFile(
      indexPath,
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\';"></head><body></body></html>'
    )
    registerFileProtocolCsp()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('allows only the selected lab and reloads the policy after clearing it', async () => {
    await writeFile(configPath, JSON.stringify({ apiSubdomain: 'api-pr-3072' }))
    const handler = electron.session.defaultSession.protocol.handle.mock
      .calls[0][1] as (request: Request) => Promise<Response>
    const request = new Request(pathToFileURL(indexPath))
    const response = await handler(request)
    const html = await response.text()

    expect(html).toContain('https://api-pr-3072.dev.zoo.dev')
    expect(html).toContain('wss://api.dev.zoo.dev')
    expect(html).toContain("worker-src 'self' blob:")
    expect(html).not.toContain('https://*.')
    expect(html).not.toContain('wss://api-pr-3072')

    await writeFile(configPath, JSON.stringify({ apiSubdomain: '' }))
    expect(await (await handler(request)).text()).toBe('unchanged')
    expect(electron.net.fetch).toHaveBeenCalledWith(request, {
      bypassCustomProtocolHandlers: true,
    })
  })

  it('keeps the existing policy when the override is absent or invalid', async () => {
    const handler = electron.session.defaultSession.protocol.handle.mock
      .calls[0][1] as (request: Request) => Promise<Response>
    const request = new Request(pathToFileURL(indexPath))

    expect(await (await handler(request)).text()).toBe('unchanged')

    await writeFile(configPath, JSON.stringify({ apiSubdomain: 'api/path' }))
    expect(await (await handler(request)).text()).toBe('unchanged')
    expect(await readFile(indexPath, 'utf8')).toContain("default-src 'none'")
  })
})

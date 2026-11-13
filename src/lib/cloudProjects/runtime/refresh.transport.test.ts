import { createHash } from 'node:crypto'
import { posix } from '@chainner/node-path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudProjectRuntime } from '@src/lib/cloudProjects/runtime'
import noopfs from '@src/lib/fs-zds/noopfs'

const bytes = (text: string) => new TextEncoder().encode(text)
const initial = {
  'main.kcl': bytes('@settings(kclVersion = 3.0)\n'),
  'parts/note.md': bytes('original'),
  'asset.bin': new Uint8Array([0, 255]),
  'removed.md': bytes('remove me'),
}
const instances: ReturnType<typeof createCloudProjectRuntime>[] = []
afterEach(async () => {
  await Promise.all(instances.splice(0).map((fs) => fs.detach()))
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function setup() {
  let accountId = 'first'
  let current = '1'
  const versions = new Map<string, Record<string, Uint8Array>>([['1', initial]])
  const downloads: { version: string; paths: string[]; selected: boolean }[] =
    []
  let gate: Promise<void> | undefined
  let corrupt = false
  const response = (version: string) => ({
    id: 'one',
    revision: version,
    title: 'Test',
    description: '',
    category_ids: [],
    files: Object.entries(versions.get(version)!).map(
      ([relative_path, data]) => ({
        id: `${version}:${relative_path}`,
        relative_path,
        byte_size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      })
    ),
  })
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (init?.method && init.method !== 'GET')
        throw new Error('Unexpected mutation')
      const version = url.pathname.match(/\/versions\/([^/]+)/)?.[1] ?? current
      if (url.pathname.endsWith('/download')) {
        const ids = url.searchParams.get('file_ids')?.split(',')
        const paths = response(version)
          .files.filter((file) => !ids || ids.includes(file.id))
          .map((file) => file.relative_path)
        downloads.push({ version, paths, selected: Boolean(ids) })
        await gate
        const zip = new JSZip()
        for (const path of paths)
          if (!corrupt) zip.file(path, versions.get(version)![path])
        return new Response(await zip.generateAsync({ type: 'arraybuffer' }), {
          headers: { 'content-type': 'application/zip' },
        })
      }
      return Response.json(
        url.pathname.includes('/versions/')
          ? { ...response(version), id: version }
          : response(version)
      )
    }
  )
  vi.stubGlobal('fetch', fetch)
  const fs = createCloudProjectRuntime({ ...noopfs.impl, ...posix }, () => ({
    enabled: true,
    baseUrl: 'https://api.dev.zoo.dev',
    accountId,
  }))
  instances.push(fs)
  return {
    fs,
    fetch,
    downloads,
    change(files: Record<string, Uint8Array>, version = '2') {
      versions.set(version, files)
      current = version
    },
    block(promise: Promise<void>) {
      gate = promise
    },
    corrupt(value: boolean) {
      corrupt = value
    },
    signOut() {
      accountId = 'second'
    },
  }
}

describe('cloud refresh through the SDK transport and ZIP decoder (mock HTTP)', () => {
  it('opens a full pinned snapshot, then selects nested changes and additions while keeping binary bytes and applying deletions', async () => {
    const remote = setup()
    const root = await remote.fs.openProject('one')
    expect(remote.downloads[0]).toEqual({
      version: '1',
      paths: Object.keys(initial),
      selected: false,
    })
    const next = {
      'main.kcl': initial['main.kcl'],
      'asset.bin': initial['asset.bin'],
      'parts/note.md': bytes('updated'),
      'new/empty.bin': new Uint8Array(),
    }
    remote.change(next)
    await remote.fs.refreshProject('one')
    expect(remote.downloads[1]).toEqual({
      version: '2',
      paths: ['parts/note.md', 'new/empty.bin'],
      selected: true,
    })
    for (const [path, data] of Object.entries(next))
      expect(await remote.fs.readFile(posix.join(root, path))).toEqual(data)
    await expect(
      remote.fs.stat(posix.join(root, 'removed.md'))
    ).rejects.toThrow()
    expect(remote.fs.projects.value[0].revision).toBe('2')
    await remote.fs.refreshProject('one')
    expect(remote.downloads).toHaveLength(2)
    remote.change({ 'main.kcl': initial['main.kcl'] }, '3')
    await remote.fs.refreshProject('one')
    expect(remote.downloads).toHaveLength(2)
    expect(await remote.fs.readdir(root)).toEqual(['main.kcl'])
    expect(remote.fs.pending()).toBe(0)
  })

  it('uses the requested version metadata and file IDs even when the latest version has advanced', async () => {
    const remote = setup()
    const root = await remote.fs.openProject('one')
    remote.change({ 'parts/note.md': bytes('version two') }, '2')
    remote.change({ 'parts/note.md': bytes('version three') }, '3')
    await remote.fs.refreshProject('one', () => true, '2')
    expect(remote.downloads.at(-1)).toEqual({
      version: '2',
      paths: ['parts/note.md'],
      selected: true,
    })
    expect(
      await remote.fs.readFile(posix.join(root, 'parts/note.md'), 'utf8')
    ).toBe('version two')
    expect(remote.fs.projects.value[0].revision).toBe('2')
  })

  it.each(['complete', 'fail', 'cancel', 'account'] as const)(
    'keeps old bytes and revision during a seven-second selected download, then handles %s',
    async (outcome) => {
      const remote = setup()
      const root = await remote.fs.openProject('one')
      remote.change({ 'parts/note.md': bytes('new bytes') })
      const gate = Promise.withResolvers<undefined>()
      remote.block(gate.promise)
      let current = true
      const refresh = remote.fs.refreshProject('one', () => current)
      const finished =
        outcome === 'fail'
          ? expect(refresh).rejects.toThrow('missing selected')
          : outcome === 'account'
            ? expect(refresh).rejects.toThrow('account changed')
            : refresh
      await vi.waitFor(() => expect(remote.downloads).toHaveLength(2))
      vi.useFakeTimers()
      await vi.advanceTimersByTimeAsync(7_000)
      expect(
        await remote.fs.readFile(posix.join(root, 'parts/note.md'), 'utf8')
      ).toBe('original')
      expect(remote.fs.projects.value[0].revision).toBe('1')
      expect(remote.fs.pending()).toBe(1)
      if (outcome === 'fail') remote.corrupt(true)
      if (outcome === 'cancel') current = false
      if (outcome === 'account') remote.signOut()
      vi.useRealTimers()
      gate.resolve(undefined)
      await finished
      expect(remote.fs.pending()).toBe(0)
      if (outcome === 'complete') {
        expect(
          await remote.fs.readFile(posix.join(root, 'parts/note.md'), 'utf8')
        ).toBe('new bytes')
        expect(remote.fs.projects.value[0].revision).toBe('2')
      } else {
        expect(remote.fs.projects.value[0].revision).toBe('1')
        // Account ownership intentionally prevents reading an old account's bytes.
        if (outcome !== 'account')
          expect(
            await remote.fs.readFile(posix.join(root, 'parts/note.md'), 'utf8')
          ).toBe('original')
      }
      if (outcome === 'fail') {
        remote.corrupt(false)
        await remote.fs.refreshProject('one')
        expect(
          await remote.fs.readFile(posix.join(root, 'parts/note.md'), 'utf8')
        ).toBe('new bytes')
        expect(remote.fs.projects.value[0].revision).toBe('2')
      }
    }
  )
})

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { signal } from '@preact/signals-core'
import { RemoteProjectArchiveLimitError } from '@src/lib/cloudSync/cloudApi'
import type { ProjectArchiveFile } from '@src/lib/cloudSync/types'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import { createProjectReferenceCommands } from '@src/lib/zookeeper/projectReferenceCommands'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const cloudMocks = vi.hoisted(() => ({
  download: vi.fn(),
  get: vi.fn(),
  parse: vi.fn(),
}))

vi.mock('@src/lib/cloudSync/cloudApi', () => ({
  downloadRemoteProjectArchive: cloudMocks.download,
  getRemoteProject: cloudMocks.get,
  RemoteProjectArchiveLimitError: class RemoteProjectArchiveLimitError extends Error {
    constructor() {
      super('Project archive is too large to reference.')
    }
  },
}))
vi.mock('@src/lib/cloudSync/projectArchive', () => ({
  parseProjectArchive: cloudMocks.parse,
}))

const localProject: HomeProjectEntry = {
  id: 'local:/private/library/TRUCK',
  source: 'local',
  status: 'local',
  name: 'TRUCK',
  localProjectPath: '/private/library/TRUCK',
  readWriteAccess: true,
}
const cloudProject: HomeProjectEntry = {
  id: 'remote:cloud-123',
  source: 'remote',
  status: 'cloud-only',
  name: 'TRUCK cloud',
  remoteProjectId: 'cloud-123',
  readWriteAccess: true,
}

function makeSocket() {
  const sent: Record<string, unknown>[] = []
  const ws = {
    readyState: WebSocket.OPEN,
    send: (frame: string) => sent.push(JSON.parse(frame)),
  } as unknown as WebSocket
  return { sent, ws }
}

function fixture(
  options: {
    initialEntries?: HomeProjectEntry[]
    fileOperations?: FileOperationsRegistryService
    getApiToken?: () => string
  } = {}
) {
  const entries = signal<readonly HomeProjectEntry[]>(
    options.initialEntries ?? [localProject, cloudProject]
  )
  const readFile = vi.fn(async (path: string) => {
    if (path === '/private/library/TRUCK/main.kcl') {
      return new TextEncoder().encode('wheel = circle(10)')
    }
    return new TextEncoder().encode('')
  })
  const readDirectory = vi.fn(
    async (path: string): Promise<readonly string[]> => {
      if (path === '/private/library/TRUCK') {
        return [
          'main.kcl',
          'project.toml',
          'secrets.toml',
          '.env',
          'assets',
          'parts',
        ]
      }
      if (path === '/private/library/TRUCK/parts') {
        return ['wheel.kcl']
      }
      return []
    }
  )
  const statReadOnly = vi.fn(async (path: string) => ({
    kind:
      path.endsWith('/assets') || path.endsWith('/parts')
        ? ('directory' as const)
        : ('file' as const),
    size: 20,
  }))
  const stat = vi.fn()
  const realpath = vi.fn(async (path: string) => path)
  const fileOperations = {
    readDirectory,
    readFile,
    realpath,
    stat,
    statReadOnly,
    writeFile: vi.fn(),
  } as unknown as FileOperationsRegistryService
  const { sent, ws } = makeSocket()
  const commands = createProjectReferenceCommands({
    entries,
    fileOperations: options.fileOperations ?? fileOperations,
    getApiToken: options.getApiToken ?? (() => 'token'),
  })
  let nextRequest = 0
  async function request(
    commandId: string,
    args: Record<string, unknown>,
    catalogRevision = 1
  ) {
    const requestId = `request-${++nextRequest}`
    expect(
      commands.handleRequest(ws, {
        client_command_request: {
          request_id: requestId,
          catalog_revision: catalogRevision,
          command_id: commandId,
          arguments: args,
        },
      })
    ).toBe(true)
    await vi.waitFor(() => {
      expect(sent.some((frame) => frame.request_id === requestId)).toBe(true)
    })
    return sent.find((frame) => frame.request_id === requestId) as {
      request_id: string
      status: string
      result?: Record<string, unknown>
      error?: string
    }
  }
  return {
    commands,
    entries,
    fileOperations,
    readDirectory,
    readFile,
    realpath,
    request,
    sent,
    stat,
    statReadOnly,
    ws,
  }
}

describe('Zookeeper project reference commands', () => {
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })

  beforeEach(() => {
    cloudMocks.download.mockReset()
    cloudMocks.get.mockReset().mockResolvedValue({
      id: 'cloud-123',
      revision: 'revision-1',
    })
    cloudMocks.parse.mockReset()
  })

  it('advertises only read-only commands and hides source paths and cloud IDs', async () => {
    const { commands, request, sent, ws } = fixture()
    commands.advertise(ws)
    const catalog = sent[0]
    expect(catalog.type).toBe('update_client_command_schema')
    expect(
      (catalog.commands as Array<{ id: string }>).map((cmd) => cmd.id)
    ).toEqual(['projects.search', 'projects.list_files', 'projects.read_file'])

    const response = await request('projects.search', { query: 'TRUCK' })
    expect(response.status).toBe('succeeded')
    const projects = response.result?.projects as Array<{
      project_id: string
      name: string
      source: string
    }>
    expect(projects).toHaveLength(2)
    expect(projects.map((project) => project.source)).toEqual([
      'local',
      'cloud',
    ])
    expect(JSON.stringify(projects)).not.toContain('/private/library')
    expect(JSON.stringify(projects)).not.toContain('cloud-123')
  })

  it('rejects requests for another catalog revision', async () => {
    const { commands, request, sent, ws } = fixture()
    commands.advertise(ws)
    expect(sent[0]).toMatchObject({
      type: 'update_client_command_schema',
      revision: 1,
    })
    const response = await request('projects.search', { query: 'TRUCK' }, 2)
    expect(response.status).toBe('rejected')
    expect(response.error).toBe('The command catalog changed.')
  })

  it('rechecks library membership for a retried read after reconnect', async () => {
    const { commands, entries, request, ws } = fixture()
    commands.advertise(ws)
    const found = await request('projects.search', { query: 'TRUCK' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const args = { project_id: projectId, path: 'main.kcl' }
    const first = await request('projects.read_file', args)
    expect(first.result?.content).toBe('wheel = circle(10)')

    entries.value = [cloudProject]
    const next = makeSocket()
    commands.advertise(next.ws)
    commands.handleRequest(next.ws, {
      client_command_request: {
        request_id: first.request_id,
        catalog_revision: 1,
        command_id: 'projects.read_file',
        arguments: args,
      },
    })
    await vi.waitFor(() => {
      expect(
        next.sent.some((frame) => frame.request_id === first.request_id)
      ).toBe(true)
    })
    expect(
      next.sent.find((frame) => frame.request_id === first.request_id)
    ).toMatchObject({
      status: 'rejected',
      error: 'Invalid project_id, path, or offset.',
    })
  })

  it('ignores requests and in-flight results from an earlier socket', async () => {
    const {
      commands,
      entries,
      readDirectory,
      request,
      sent,
      statReadOnly,
      ws,
    } = fixture()
    commands.advertise(ws)
    const found = await request('projects.search', { query: 'TRUCK' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    let finishRead!: (names: readonly string[]) => void
    const pausedRead = new Promise<readonly string[]>((resolve) => {
      finishRead = resolve
    })
    readDirectory.mockImplementationOnce(() => pausedRead)
    const message = {
      client_command_request: {
        request_id: 'in-flight-read',
        catalog_revision: 1,
        command_id: 'projects.list_files',
        arguments: { project_id: projectId },
      },
    }
    commands.handleRequest(ws, message)
    await vi.waitFor(() => expect(readDirectory).toHaveBeenCalledOnce())

    const next = makeSocket()
    commands.advertise(next.ws)
    commands.handleRequest(ws, {
      client_command_request: {
        ...message.client_command_request,
        request_id: 'late-old-socket',
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readDirectory).toHaveBeenCalledOnce()
    expect(sent.some((frame) => frame.request_id === 'late-old-socket')).toBe(
      false
    )

    entries.value = [cloudProject]
    commands.handleRequest(next.ws, message)
    await vi.waitFor(() => {
      expect(
        next.sent.some((frame) => frame.request_id === 'in-flight-read')
      ).toBe(true)
    })
    expect(
      next.sent.find((frame) => frame.request_id === 'in-flight-read')?.status
    ).toBe('rejected')

    finishRead(['main.kcl'])
    await vi.waitFor(() => expect(statReadOnly).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent.some((frame) => frame.request_id === 'in-flight-read')).toBe(
      false
    )
  })

  it('finds projects beyond the first page of library results', async () => {
    const { entries, request } = fixture()
    entries.value = Array.from({ length: 25 }, (_, index) => ({
      ...localProject,
      id: `library-${index}`,
      name: `TRUCK ${index}`,
    }))
    const first = await request('projects.search', { query: 'TRUCK' })
    expect((first.result?.projects as unknown[]).length).toBe(20)
    expect(first.result?.next_offset).toBe(20)
    const second = await request('projects.search', {
      query: 'TRUCK',
      offset: first.result?.next_offset,
    })
    expect((second.result?.projects as unknown[]).length).toBe(5)
    expect(second.result?.next_offset).toBeNull()
  })

  it('lists and reads nested KCL without opening or writing the source', async () => {
    const { fileOperations, readFile, request } = fixture()
    const found = await request('projects.search', { query: 'TRUCK' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const listing = await request('projects.list_files', {
      project_id: projectId,
    })
    expect(listing.result?.files).toEqual([
      'main.kcl',
      'parts/wheel.kcl',
      'project.toml',
    ])
    const read = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })
    expect(read.result?.content).toBe('wheel = circle(10)')
    expect(readFile).toHaveBeenCalledWith('/private/library/TRUCK/main.kcl')
    expect(fileOperations.stat).not.toHaveBeenCalled()
    expect(fileOperations.statReadOnly).toHaveBeenCalled()
    expect(fileOperations.writeFile).not.toHaveBeenCalled()
  })

  it('rejects traversal, hidden files, and a project removed from the library', async () => {
    const { entries, readFile, request } = fixture()
    const found = await request('projects.search', { query: 'TRUCK' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    for (const path of ['../secret.kcl', '.env', 'parts/../../secret.kcl']) {
      const response = await request('projects.read_file', {
        project_id: projectId,
        path,
      })
      expect(response.status).toBe('rejected')
    }
    entries.value = [cloudProject]
    const response = await request('projects.list_files', {
      project_id: projectId,
    })
    expect(response.status).toBe('rejected')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('does not follow a project symlink outside its root', async () => {
    const { readDirectory, readFile, realpath, request, statReadOnly } =
      fixture()
    readDirectory.mockImplementation(async (path) => {
      if (path === '/private/library/TRUCK') {
        return ['linked']
      }
      if (path === '/private/outside') {
        return ['secret.kcl']
      }
      return []
    })
    realpath.mockImplementation(async (path) =>
      path === '/private/library/TRUCK/linked' ? '/private/outside' : path
    )
    statReadOnly.mockImplementation(async (path) => ({
      kind: path.endsWith('/linked') ? 'directory' : 'file',
      size: 20,
    }))
    const found = await request('projects.search', { query: 'TRUCK' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id

    const listing = await request('projects.list_files', {
      project_id: projectId,
    })
    expect(listing.result?.files).toEqual([])
    const read = await request('projects.read_file', {
      project_id: projectId,
      path: 'linked/secret.kcl',
    })
    expect(read.status).toBe('rejected')
    expect(readFile).not.toHaveBeenCalled()
    expect(readDirectory).not.toHaveBeenCalledWith('/private/outside')
  })

  it('blocks real desktop file and directory symlinks outside the project', async () => {
    const temp = await mkdtemp(path.join(tmpdir(), 'zds-project-reference-'))
    const root = path.join(temp, 'project')
    const outside = path.join(temp, 'outside')
    const runtime = createFileOperationsRuntime(nodeFileSystem.impl)
    try {
      await mkdir(root)
      await mkdir(outside)
      await writeFile(path.join(root, 'main.kcl'), 'cube = 1')
      await writeFile(path.join(outside, 'secret.kcl'), 'secret = 1')
      await symlink(outside, path.join(root, 'linked'), 'dir')
      await symlink(
        path.join(outside, 'secret.kcl'),
        path.join(root, 'secret.kcl'),
        'file'
      )
      const { request } = fixture({
        initialEntries: [{ ...localProject, localProjectPath: root }],
        fileOperations: runtime.operations,
      })
      const found = await request('projects.search', { query: 'TRUCK' })
      const projectId = (
        found.result?.projects as Array<{ project_id: string }>
      )[0].project_id

      const listing = await request('projects.list_files', {
        project_id: projectId,
      })
      expect(listing.result?.files).toEqual(['main.kcl'])
      for (const forbiddenPath of ['secret.kcl', 'linked/secret.kcl']) {
        const read = await request('projects.read_file', {
          project_id: projectId,
          path: forbiddenPath,
        })
        expect(read.status).toBe('rejected')
      }
    } finally {
      await runtime.dispose()
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('keeps Unicode characters whole across file pages', async () => {
    const { readFile, request } = fixture()
    const content = `${'a'.repeat(7_999)}🚗 more`
    readFile.mockResolvedValue(new TextEncoder().encode(content))
    const found = await request('projects.search', { query: 'TRUCK' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const first = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })
    const missingVersion = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
      offset: first.result?.next_offset,
    })
    const second = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
      offset: first.result?.next_offset,
      version: first.result?.version,
    })

    expect(first.result?.next_offset).toBe(7_999)
    expect(missingVersion.error).toBe(
      'version is required for continued reads.'
    )
    expect(`${first.result?.content}${second.result?.content}`).toBe(content)
    const invalid = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
      offset: 8_000,
      version: first.result?.version,
    })
    expect(invalid.status).toBe('rejected')
  })

  it('rejects a later page when the source changes without changing length', async () => {
    const { readFile, request } = fixture()
    readFile
      .mockResolvedValueOnce(new TextEncoder().encode('a'.repeat(8_001)))
      .mockResolvedValueOnce(new TextEncoder().encode('b'.repeat(8_001)))
    const found = await request('projects.search', { query: 'TRUCK' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const first = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })
    const second = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
      offset: first.result?.next_offset,
      version: first.result?.version,
    })

    expect(first.result?.next_offset).toBe(8_000)
    expect(second.status).toBe('rejected')
    expect(second.error).toBe(
      'File changed while reading. Start again from offset 0.'
    )
  })

  it('does not include local paths in failed command responses', async () => {
    const { readDirectory, request } = fixture()
    readDirectory.mockRejectedValueOnce(
      new Error('Unable to read-directory /private/library/TRUCK')
    )
    const found = await request('projects.search', { query: 'TRUCK' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const response = await request('projects.list_files', {
      project_id: projectId,
    })

    expect(response.status).toBe('rejected')
    expect(response.error).not.toContain('/private/library/TRUCK')
    expect(response.error).toBe('Could not access the library project.')
  })

  it('reads cloud-only project archives without materializing them', async () => {
    const { request, readFile } = fixture()
    const archive = new ArrayBuffer(1)
    cloudMocks.download.mockResolvedValue(archive)
    cloudMocks.parse.mockResolvedValue([
      {
        relativePath: 'main.kcl',
        data: new TextEncoder().encode('cloudWheel = circle(12)'),
      },
    ] satisfies ProjectArchiveFile[])
    const found = await request('projects.search', { query: 'TRUCK cloud' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const read = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })
    expect(read.result?.content).toBe('cloudWheel = circle(12)')
    expect(cloudMocks.download).toHaveBeenCalledWith(
      { enabled: true, token: 'token' },
      'cloud-123',
      32 * 1024 * 1024
    )
    expect(readFile).not.toHaveBeenCalled()
    expect(cloudMocks.download).toHaveBeenCalledTimes(1)
  })

  it('reuses one cloud snapshot across file pages and refreshes a new read', async () => {
    const { request } = fixture()
    cloudMocks.download.mockResolvedValue(new ArrayBuffer(1))
    cloudMocks.parse.mockResolvedValue([
      {
        relativePath: 'main.kcl',
        data: new TextEncoder().encode('a'.repeat(8_001)),
      },
    ] satisfies ProjectArchiveFile[])
    const found = await request('projects.search', { query: 'TRUCK cloud' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const first = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })
    const second = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
      offset: first.result?.next_offset,
      version: first.result?.version,
    })

    expect(`${first.result?.content}${second.result?.content}`).toBe(
      'a'.repeat(8_001)
    )
    expect(cloudMocks.download).toHaveBeenCalledOnce()
    expect(cloudMocks.parse).toHaveBeenCalledOnce()
    expect(cloudMocks.get).toHaveBeenCalledTimes(2)

    cloudMocks.parse.mockResolvedValue([
      {
        relativePath: 'main.kcl',
        data: new TextEncoder().encode('new contents'),
      },
    ] satisfies ProjectArchiveFile[])
    const fresh = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })
    expect(fresh.result?.content).toBe('new contents')
    expect(cloudMocks.download).toHaveBeenCalledTimes(2)
  })

  it('rejects a cloud continuation when the remote revision changes', async () => {
    const { request } = fixture()
    cloudMocks.get
      .mockResolvedValueOnce({ id: 'cloud-123', revision: 'revision-1' })
      .mockResolvedValueOnce({ id: 'cloud-123', revision: 'revision-2' })
    cloudMocks.download.mockResolvedValue(new ArrayBuffer(1))
    cloudMocks.parse
      .mockResolvedValueOnce([
        {
          relativePath: 'main.kcl',
          data: new TextEncoder().encode('a'.repeat(8_001)),
        },
      ] satisfies ProjectArchiveFile[])
      .mockResolvedValueOnce([
        {
          relativePath: 'main.kcl',
          data: new TextEncoder().encode('b'.repeat(8_001)),
        },
      ] satisfies ProjectArchiveFile[])
    const found = await request('projects.search', { query: 'TRUCK cloud' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const first = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })
    const second = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
      offset: first.result?.next_offset,
      version: first.result?.version,
    })

    expect(second.error).toBe(
      'File changed while reading. Start again from offset 0.'
    )
    expect(cloudMocks.download).toHaveBeenCalledTimes(2)
  })

  it('refreshes each cloud page when the server has no revision', async () => {
    const { request } = fixture()
    cloudMocks.get.mockResolvedValue({
      id: 'cloud-123',
      updated_at: '2026-10-19T12:00:00Z',
    })
    cloudMocks.download.mockResolvedValue(new ArrayBuffer(1))
    cloudMocks.parse
      .mockResolvedValueOnce([
        {
          relativePath: 'main.kcl',
          data: new TextEncoder().encode('a'.repeat(8_001)),
        },
      ] satisfies ProjectArchiveFile[])
      .mockResolvedValueOnce([
        {
          relativePath: 'main.kcl',
          data: new TextEncoder().encode('b'.repeat(8_001)),
        },
      ] satisfies ProjectArchiveFile[])
    const found = await request('projects.search', { query: 'TRUCK cloud' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const first = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })
    const second = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
      offset: first.result?.next_offset,
      version: first.result?.version,
    })

    expect(second.error).toBe(
      'File changed while reading. Start again from offset 0.'
    )
    expect(cloudMocks.get).toHaveBeenCalledTimes(2)
    expect(cloudMocks.download).toHaveBeenCalledTimes(2)
    expect(cloudMocks.parse).toHaveBeenCalledTimes(2)
  })

  it('reloads a cloud snapshot when the API token changes', async () => {
    let apiToken = 'token'
    const { request } = fixture({ getApiToken: () => apiToken })
    cloudMocks.download.mockResolvedValue(new ArrayBuffer(1))
    cloudMocks.parse
      .mockResolvedValueOnce([
        {
          relativePath: 'main.kcl',
          data: new TextEncoder().encode('a'.repeat(8_001)),
        },
      ] satisfies ProjectArchiveFile[])
      .mockResolvedValueOnce([
        {
          relativePath: 'main.kcl',
          data: new TextEncoder().encode('b'.repeat(8_001)),
        },
      ] satisfies ProjectArchiveFile[])
    const found = await request('projects.search', { query: 'TRUCK cloud' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const first = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })
    apiToken = 'new-token'
    const second = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
      offset: first.result?.next_offset,
      version: first.result?.version,
    })

    expect(second.error).toBe(
      'File changed while reading. Start again from offset 0.'
    )
    expect(cloudMocks.download).toHaveBeenCalledTimes(2)
    expect(cloudMocks.download).toHaveBeenLastCalledWith(
      { enabled: true, token: 'new-token' },
      'cloud-123',
      32 * 1024 * 1024
    )
  })

  it('reports an oversized cloud archive without exposing request details', async () => {
    const { request } = fixture()
    cloudMocks.download.mockRejectedValue(new RemoteProjectArchiveLimitError())
    const found = await request('projects.search', { query: 'TRUCK cloud' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id

    const listing = await request('projects.list_files', {
      project_id: projectId,
    })
    expect(listing.status).toBe('rejected')
    expect(listing.error).toBe('Project archive is too large to reference.')
    expect(cloudMocks.parse).not.toHaveBeenCalled()
  })

  it('keeps long file listings within the broker response limit', async () => {
    const { request } = fixture()
    cloudMocks.download.mockResolvedValue(new ArrayBuffer(1))
    cloudMocks.parse.mockResolvedValue(
      Array.from({ length: 150 }, (_, index) => ({
        relativePath: `part-${String(index).padStart(3, '0')}-${'x'.repeat(500)}.kcl`,
        data: new Uint8Array(),
      })) satisfies ProjectArchiveFile[]
    )
    const found = await request('projects.search', { query: 'TRUCK cloud' })
    const projectId = (
      found.result?.projects as Array<{ project_id: string }>
    )[0].project_id
    const first = await request('projects.list_files', {
      project_id: projectId,
    })
    expect(
      new TextEncoder().encode(JSON.stringify(first.result)).byteLength
    ).toBeLessThan(64 * 1024)
    expect(first.result?.next_offset).toBeTypeOf('number')
    const second = await request('projects.list_files', {
      project_id: projectId,
      offset: first.result?.next_offset,
    })
    expect((second.result?.files as string[])[0]).not.toBe(
      (first.result?.files as string[])[0]
    )
    expect(cloudMocks.download).toHaveBeenCalledOnce()
    expect(cloudMocks.parse).toHaveBeenCalledOnce()
  })
})

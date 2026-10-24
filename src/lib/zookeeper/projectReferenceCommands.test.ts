import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { signal } from '@preact/signals-core'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import { createProjectReferenceCommands } from '@src/lib/zookeeper/projectReferenceCommands'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'

import { beforeAll, describe, expect, it, vi } from 'vitest'

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

async function searchProjectId(
  request: ReturnType<typeof fixture>['request'],
  query: string
) {
  const found = await request('projects.search', { query })
  return (found.result?.projects as Array<{ project_id: string }>)[0].project_id
}

describe('Zookeeper project reference commands', () => {
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })

  it('advertises local reference commands without exposing source paths', async () => {
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
    expect(projects).toHaveLength(1)
    expect(projects.map((project) => project.source)).toEqual(['local'])
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
    const projectId = await searchProjectId(request, 'TRUCK')
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
    const projectId = await searchProjectId(request, 'TRUCK')
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
    const projectId = await searchProjectId(request, 'TRUCK')
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

  it('reads a known local KCL file without enumerating the project', async () => {
    const { readDirectory, request } = fixture()
    readDirectory.mockRejectedValue(new Error('Directory listing unavailable'))
    const projectId = await searchProjectId(request, 'TRUCK')

    const read = await request('projects.read_file', {
      project_id: projectId,
      path: 'main.kcl',
    })

    expect(read.result?.content).toBe('wheel = circle(10)')
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('rejects traversal, hidden files, and a project removed from the library', async () => {
    const { entries, readFile, request } = fixture()
    const projectId = await searchProjectId(request, 'TRUCK')
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
    realpath.mockImplementation(async (path) => {
      if (path === '/private/library/TRUCK/linked') {
        return '/private/outside'
      }
      if (path === '/private/library/TRUCK/linked/secret.kcl') {
        return '/private/outside/secret.kcl'
      }
      return path
    })
    statReadOnly.mockImplementation(async (path) => ({
      kind: path.endsWith('/linked') ? 'directory' : 'file',
      size: 20,
    }))
    const projectId = await searchProjectId(request, 'TRUCK')

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
      const projectId = await searchProjectId(request, 'TRUCK')

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
    const projectId = await searchProjectId(request, 'TRUCK')
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
    const projectId = await searchProjectId(request, 'TRUCK')
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
    const projectId = await searchProjectId(request, 'TRUCK')
    const response = await request('projects.list_files', {
      project_id: projectId,
    })

    expect(response.status).toBe('rejected')
    expect(response.error).not.toContain('/private/library/TRUCK')
    expect(response.error).toBe('Could not access the library project.')
  })
})

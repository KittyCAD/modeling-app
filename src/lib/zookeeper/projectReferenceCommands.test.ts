import { signal } from '@preact/signals-core'
import type { ProjectArchiveFile } from '@src/lib/cloudSync/types'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { createProjectReferenceCommands } from '@src/lib/zookeeper/projectReferenceCommands'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const cloudMocks = vi.hoisted(() => ({
  download: vi.fn(),
  parse: vi.fn(),
}))

vi.mock('@src/lib/cloudSync/cloudApi', () => ({
  downloadRemoteProjectArchive: cloudMocks.download,
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

function fixture() {
  const entries = signal<readonly HomeProjectEntry[]>([
    localProject,
    cloudProject,
  ])
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
  const stat = vi.fn(async (path: string) => ({
    kind:
      path.endsWith('/assets') || path.endsWith('/parts')
        ? ('directory' as const)
        : ('file' as const),
    size: 20,
  }))
  const fileOperations = {
    readDirectory,
    readFile,
    stat,
    writeFile: vi.fn(),
  } as unknown as FileOperationsRegistryService
  const sent: Record<string, unknown>[] = []
  const ws = {
    readyState: WebSocket.OPEN,
    send: (frame: string) => sent.push(JSON.parse(frame)),
  } as unknown as WebSocket
  const commands = createProjectReferenceCommands({
    entries,
    fileOperations,
    getApiToken: () => 'token',
  })
  let nextRequest = 0
  async function request(commandId: string, args: Record<string, unknown>) {
    const requestId = `request-${++nextRequest}`
    expect(
      commands.handleRequest(ws, {
        client_command_request: {
          request_id: requestId,
          catalog_revision: 1,
          command_id: commandId,
          arguments: args,
        },
      })
    ).toBe(true)
    await vi.waitFor(() => {
      expect(sent.some((frame) => frame.request_id === requestId)).toBe(true)
    })
    return sent.find((frame) => frame.request_id === requestId) as {
      status: string
      result?: Record<string, unknown>
      error?: string
    }
  }
  return { commands, entries, fileOperations, readFile, request, sent, ws }
}

describe('Zookeeper project reference commands', () => {
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })

  beforeEach(() => {
    cloudMocks.download.mockReset()
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
      'cloud-123'
    )
    expect(readFile).not.toHaveBeenCalled()
    expect(cloudMocks.download).toHaveBeenCalledTimes(1)
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
  })
})

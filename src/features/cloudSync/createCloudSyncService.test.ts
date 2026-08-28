import { signal } from '@preact/signals'
import type { RemoteCloudProject } from '@src/contracts/cloudSync'
import type { CloudApi } from '@src/features/cloudSync/cloudApi'
import type { CloudArchiveFile } from '@src/features/cloudSync/cloudArchive'
import { createCloudSyncService } from '@src/features/cloudSync/createCloudSyncService'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { createFakeFileSystem } from '@src/test/fakeFileSystem'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

const library: ProjectLibrary = {
  id: 'cloud-personal',
  order: 0,
  title: 'Personal Cloud',
  path: '/cloud',
  source: 'personal',
  type: 'cloud',
}

const textFile = (
  relativePath: string,
  contents: string
): CloudArchiveFile => ({
  relativePath,
  data: new TextEncoder().encode(contents),
})

function fakeCloudApi(
  initial: Array<{
    project: RemoteCloudProject
    files: CloudArchiveFile[]
  }> = []
) {
  const projects = new Map<
    string,
    { project: RemoteCloudProject; files: CloudArchiveFile[] }
  >(
    initial.map(({ project, files }) => [
      project.id,
      { project: { description: '', category_ids: [], ...project }, files },
    ])
  )
  let nextId = 1
  const calls = {
    create: 0,
    update: [] as Array<{ id: string; expectedRevision?: string }>,
    delete: [] as string[],
  }

  const archive = async (files: CloudArchiveFile[]) => {
    const zip = new JSZip()
    for (const file of files) zip.file(file.relativePath, file.data)
    return zip.generateAsync({ type: 'arraybuffer' })
  }

  const api: CloudApi = {
    async listProjects() {
      return Array.from(projects.values(), ({ project }) => ({ ...project }))
    },
    async getProject(id) {
      const found = projects.get(id)
      if (!found) throw new Error('missing remote')
      return { ...found.project }
    },
    async downloadProject(id) {
      const found = projects.get(id)
      if (!found) throw new Error('missing remote')
      return archive(found.files)
    },
    async createProject(projectPath, files) {
      calls.create += 1
      const id = `remote-${nextId++}`
      const project = {
        id,
        title: projectPath.split('/').at(-1),
        revision: '1',
        updated_at: '2026-01-01T00:00:00Z',
        description: '',
        category_ids: [],
      }
      projects.set(id, { project, files: structuredClone(files) })
      return { ...project }
    },
    async updateProject(project, _path, files, expectedRevision) {
      calls.update.push({ id: project.id, expectedRevision })
      const revision = String(Number(project.revision ?? 0) + 1)
      const updated: RemoteCloudProject = {
        ...project,
        description: project.description ?? '',
        category_ids: project.category_ids ?? [],
        revision,
        updated_at: '2026-01-02T00:00:00Z',
      }
      projects.set(project.id, {
        project: updated,
        files: structuredClone(files),
      })
      return { ...updated }
    },
    async deleteProject(id) {
      calls.delete.push(id)
      projects.delete(id)
    },
  }

  return { api, calls, projects }
}

function subject(
  initialFiles: Record<string, string> = {},
  remote: Parameters<typeof fakeCloudApi>[0] = []
) {
  const fileSystem = createFakeFileSystem(initialFiles)
  const cloud = fakeCloudApi(remote)
  const token = signal<string | null>('token')
  const enabled = signal(true)
  const service = createCloudSyncService({
    fileSystem,
    token,
    enabled,
    api: cloud.api,
    backgroundIntervalMs: 0,
  })
  return { fileSystem, cloud, token, enabled, service }
}

describe('cloud sync service', () => {
  it('enrolls local projects and records a durable sync base', async () => {
    const test = subject({
      '/cloud/bracket/main.kcl': 'cube = startSketchOn(XY)',
    })

    await test.service.syncLibrary(library)

    expect(test.cloud.calls.create).toBe(1)
    expect(test.service.status.value).toMatchObject({
      state: 'idle',
      enabled: true,
    })
    expect(test.fileSystem.files.get('/cloud/.zds-cloud-sync.json')).toContain(
      'remote-1'
    )
    test.service.dispose()
  })

  it('materializes remote-only projects, including binary files', async () => {
    const image = Uint8Array.from([0, 255, 1, 128])
    const test = subject({}, [
      {
        project: {
          id: 'remote-bracket',
          title: 'Mounting Bracket',
          revision: '4',
        },
        files: [
          textFile('main.kcl', 'remote'),
          { relativePath: 'preview.png', data: image },
        ],
      },
    ])

    await test.service.syncLibrary(library)

    expect(
      await test.fileSystem.readTextFile('/cloud/mounting-bracket/main.kcl')
    ).toBe('remote')
    expect(
      await test.fileSystem.readFile('/cloud/mounting-bracket/preview.png')
    ).toEqual(image)
    test.service.dispose()
  })

  it('pushes a local change with the last acknowledged revision', async () => {
    const test = subject({ '/cloud/bracket/main.kcl': 'first' })
    await test.service.syncLibrary(library)
    await test.fileSystem.writeTextFile('/cloud/bracket/main.kcl', 'second')

    await test.service.syncLibrary(library)

    expect(test.cloud.calls.update).toEqual([
      { id: 'remote-1', expectedRevision: '1' },
    ])
    test.service.dispose()
  })

  it('pulls a remote change when the local project still matches its base', async () => {
    const test = subject({ '/cloud/bracket/main.kcl': 'first' })
    await test.service.syncLibrary(library)
    const stored = test.cloud.projects.get('remote-1')
    if (!stored) throw new Error('remote not created')
    stored.project.revision = '2'
    stored.files = [textFile('main.kcl', 'from cloud')]

    await test.service.syncLibrary(library)

    expect(await test.fileSystem.readTextFile('/cloud/bracket/main.kcl')).toBe(
      'from cloud'
    )
    test.service.dispose()
  })

  it('keeps local bytes and reports a conflict when both sides changed', async () => {
    const test = subject({ '/cloud/bracket/main.kcl': 'base' })
    await test.service.syncLibrary(library)
    await test.fileSystem.writeTextFile('/cloud/bracket/main.kcl', 'local')
    const stored = test.cloud.projects.get('remote-1')
    if (!stored) throw new Error('remote not created')
    stored.project.revision = '2'
    stored.files = [textFile('main.kcl', 'remote')]

    await test.service.syncLibrary(library)

    expect(await test.fileSystem.readTextFile('/cloud/bracket/main.kcl')).toBe(
      'local'
    )
    expect(test.service.status.value).toMatchObject({
      state: 'conflict',
      conflictCount: 1,
    })
    expect(test.cloud.calls.update).toHaveLength(0)
    test.service.dispose()
  })

  it('deletes the remote before removing a materialized project', async () => {
    const test = subject({ '/cloud/bracket/main.kcl': 'base' })
    await test.service.syncLibrary(library)

    await test.service.deleteProject(library, '/cloud/bracket')

    expect(test.cloud.calls.delete).toEqual(['remote-1'])
    expect(await test.fileSystem.exists('/cloud/bracket')).toBe(false)
    test.service.dispose()
  })

  it('does no remote work while signed out', async () => {
    const test = subject({ '/cloud/bracket/main.kcl': 'base' })
    test.token.value = null

    await test.service.syncLibrary(library)

    expect(test.cloud.calls.create).toBe(0)
    expect(test.service.status.value.state).toBe('disabled')
    test.service.dispose()
  })

  it('keeps the engine registered but inert while its plugin is disabled', async () => {
    const test = subject({ '/cloud/bracket/main.kcl': 'base' })
    test.enabled.value = false

    await test.service.syncLibrary(library)

    expect(test.cloud.calls.create).toBe(0)
    expect(test.service.status.value).toMatchObject({
      enabled: false,
      state: 'disabled',
    })

    // Local-first operations still protect the user's device state even when
    // replication policy is off.
    await test.service.deleteProject(library, '/cloud/bracket')
    expect(await test.fileSystem.exists('/cloud/bracket')).toBe(false)
    expect(test.cloud.calls.delete).toEqual([])
    test.service.dispose()
  })
})

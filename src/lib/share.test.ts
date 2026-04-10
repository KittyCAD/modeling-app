import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectResponse, ProjectShareLinkResponse } from '@kittycad/lib'
import type { Project } from '@src/lib/project'

type ShareLink = Pick<ProjectShareLinkResponse, 'access_mode' | 'key' | 'url'>

function makeRemoteProject(
  overrides: Partial<ProjectResponse> = {}
): ProjectResponse {
  return {
    category_ids: [],
    created_at: '2026-04-01T00:00:00Z',
    description: 'Existing description',
    entrypoint_path: 'main.kcl',
    files: [],
    id: 'project-existing',
    preview_status: 'pending',
    project_toml_path: 'project.toml',
    publication: {
      has_unpublished_changes: false,
    },
    publication_status: 'draft',
    title: 'Bracket',
    updated_at: '2026-04-09T15:00:00Z',
    ...overrides,
  }
}

const mockState = vi.hoisted(() => ({
  createKCClient: vi.fn(() => ({
    mocked: true,
    token: 'token-123',
    baseUrl: 'https://api.dev.zoo.dev',
  })),
  kcCall: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
  createProject: vi.fn(async () =>
    makeRemoteProject({
      id: 'project-created',
      title: 'bracket',
      description: '',
    })
  ),
  updateProject: vi.fn(async () => makeRemoteProject()),
  getProject: vi.fn(async () => makeRemoteProject()),
  publishProject: vi.fn(async () =>
    makeRemoteProject({
      id: 'project-created',
      publication_status: 'pending_review',
    })
  ),
  listProjectShareLinks: vi.fn(
    async (_args: { client?: unknown; id: string }): Promise<ShareLink[]> => []
  ),
  createProjectShareLink: vi.fn(
    async (_args: {
      client?: unknown
      id: string
      body: { access_mode: ShareLink['access_mode'] }
    }): Promise<ShareLink> => ({
      access_mode: 'anyone_with_link',
      key: 'share-key',
      url: 'https://zoo.dev/project/share-key',
    })
  ),
  readProjectSettingsFile: vi.fn(async () => ({})),
  writeProjectSettingsFile: vi.fn(async () => {}),
  serializeProjectConfiguration: vi.fn(() => 'serialized-project-toml'),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeText: vi.fn(async () => {}),
  fsReadFile: vi.fn(async (path: string, options?: { encoding: 'utf-8' }) => {
    if (options?.encoding === 'utf-8') {
      return '[settings.meta]\nid = "local-project"'
    }

    return new TextEncoder().encode(`raw:${path}`)
  }),
}))

vi.mock('@src/env', () => ({
  default: () => ({
    VITE_ZOO_BASE_DOMAIN: 'dev.zoo.dev',
    VITE_ZOO_API_BASE_URL: 'https://api.dev.zoo.dev',
  }),
}))

vi.mock('@src/lib/kcClient', () => ({
  createKCClient: mockState.createKCClient,
  kcCall: mockState.kcCall,
}))

vi.mock('@kittycad/lib', () => ({
  projects: {
    create_project: mockState.createProject,
    update_project: mockState.updateProject,
    get_project: mockState.getProject,
    publish_project: mockState.publishProject,
    list_project_share_links: mockState.listProjectShareLinks,
    create_project_share_link: mockState.createProjectShareLink,
  },
}))

vi.mock('@src/lib/desktop', () => ({
  readProjectSettingsFile: mockState.readProjectSettingsFile,
  writeProjectSettingsFile: mockState.writeProjectSettingsFile,
}))

vi.mock('@src/lang/wasm', () => ({
  serializeProjectConfiguration: mockState.serializeProjectConfiguration,
}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    sep: '/',
    join: (...parts: string[]) =>
      parts.reduce((path, part) => `${path}/${part}`).replaceAll('//', '/'),
    relative: (from: string, to: string) => to.replace(`${from}/`, ''),
    extname: (path: string) => {
      const lastDot = path.lastIndexOf('.')
      return lastDot >= 0 ? path.slice(lastDot) : ''
    },
    readFile: mockState.fsReadFile,
  },
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mockState.toastError,
    success: mockState.toastSuccess,
  },
}))

import {
  copyCurrentFileShareLink,
  getCurrentProjectPublicationDetails,
  publishCurrentProject,
} from '@src/lib/share'

function makeProject(): Project {
  return {
    metadata: null,
    kcl_file_count: 1,
    directory_count: 0,
    default_file: '/projects/bracket/main.kcl',
    path: '/projects/bracket',
    name: 'bracket',
    children: [
      {
        path: '/projects/bracket/project.toml',
        name: 'project.toml',
        children: null,
      },
      {
        path: '/projects/bracket/main.kcl',
        name: 'main.kcl',
        children: null,
      },
    ],
    readWriteAccess: true,
  }
}

describe('copyCurrentFileShareLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockState.writeText,
      },
    })
  })

  it('creates a remote project, persists the env binding, and creates a share link', async () => {
    const copied = await copyCurrentFileShareLink({
      token: 'token-123',
      project: makeProject(),
      currentFilePath: '/projects/bracket/main.kcl',
      currentFileContents: 'part001 = startSketchOn(XY)',
      wasmInstance: {} as never,
      isRestrictedToOrg: false,
    })

    expect(copied).toBe(true)
    expect(mockState.createProject).toHaveBeenCalledTimes(1)
    expect(mockState.getProject).not.toHaveBeenCalled()
    expect(mockState.writeProjectSettingsFile).toHaveBeenCalledWith(
      '/projects/bracket',
      'serialized-project-toml'
    )
    expect(mockState.createProjectShareLink).toHaveBeenCalledWith({
      client: {
        mocked: true,
        token: 'token-123',
        baseUrl: 'https://api.dev.zoo.dev',
      },
      id: 'project-created',
      body: { access_mode: 'anyone_with_link' },
    })

    const createProjectCalls = mockState.createProject.mock.calls as unknown as Array<
      [
        {
          client: unknown
          files: Array<{ name: string; data: Blob }>
        },
      ]
    >
    const createArgs = createProjectCalls[0]?.[0]
    if (!createArgs) {
      throw new Error('Expected project upload to be called')
    }

    expect(createArgs.client).toEqual({
      mocked: true,
      token: 'token-123',
      baseUrl: 'https://api.dev.zoo.dev',
    })

    expect(createArgs.files.map((file: { name: string }) => file.name)).toEqual([
      'body',
      'project.toml',
      'main.kcl',
    ])

    const bodyFile = createArgs.files.find(
      (file: { name: string }) => file.name === 'body'
    )
    if (!bodyFile) {
      throw new Error('Expected body file to be uploaded')
    }
    await expect(bodyFile.data.text()).resolves.toBe(
      JSON.stringify({
        title: 'bracket',
        description: '',
      })
    )

    const projectToml = createArgs.files.find(
      (file: { name: string }) => file.name === 'project.toml'
    )
    if (!projectToml) {
      throw new Error('Expected project.toml file to be uploaded')
    }
    await expect(projectToml.data.text()).resolves.toBe(
      'raw:/projects/bracket/project.toml'
    )

    const mainFile = createArgs.files.find(
      (file: { name: string }) => file.name === 'main.kcl'
    )
    if (!mainFile) {
      throw new Error('Expected main.kcl file to be uploaded')
    }
    await expect(mainFile.data.text()).resolves.toBe('part001 = startSketchOn(XY)')
    expect(mockState.writeText).toHaveBeenCalledWith(
      'https://zoo.dev/project/share-key'
    )
    expect(mockState.toastSuccess).toHaveBeenCalledWith(
      'Link copied to clipboard.',
      { duration: 5000 }
    )
  })

  it('updates an existing remote project and reuses a matching share link', async () => {
    mockState.readProjectSettingsFile.mockResolvedValue({
      cloud: {
        'dev.zoo.dev': {
          project_id: 'project-existing',
        },
      },
    })
    mockState.listProjectShareLinks.mockResolvedValue([
      {
        access_mode: 'organization_only',
        key: 'existing-share-key',
        url: 'https://zoo.dev/project/existing-share-key',
      },
    ])

    const copied = await copyCurrentFileShareLink({
      token: 'token-123',
      project: makeProject(),
      currentFilePath: '/projects/bracket/main.kcl',
      currentFileContents: 'part001 = startSketchOn(XY)',
      wasmInstance: {} as never,
      isRestrictedToOrg: true,
    })

    expect(copied).toBe(true)
    expect(mockState.updateProject).toHaveBeenCalledWith({
      client: {
        mocked: true,
        token: 'token-123',
        baseUrl: 'https://api.dev.zoo.dev',
      },
      id: 'project-existing',
      files: expect.any(Array),
    })
    expect(mockState.getProject).toHaveBeenCalledWith({
      client: {
        mocked: true,
        token: 'token-123',
        baseUrl: 'https://api.dev.zoo.dev',
      },
      id: 'project-existing',
    })
    expect(mockState.writeProjectSettingsFile).not.toHaveBeenCalled()
    expect(mockState.createProjectShareLink).not.toHaveBeenCalled()
    expect(mockState.writeText).toHaveBeenCalledWith(
      'https://zoo.dev/project/existing-share-key'
    )

    const updateProjectCalls = mockState.updateProject.mock.calls as unknown as Array<
      [
        {
          files: Array<{ name: string; data: Blob }>
        },
      ]
    >
    const updateArgs = updateProjectCalls[0]?.[0]
    if (!updateArgs) {
      throw new Error('Expected update project upload to be called')
    }
    expect(updateArgs.files).toHaveLength(3)
    const updateBody = updateArgs.files.find(
      (file: { name: string; data: Blob }) => file.name === 'body'
    )
    if (!updateBody) {
      throw new Error('Expected update body file to be uploaded')
    }
    await expect(updateBody.data.text()).resolves.toBe(
      JSON.stringify({
        title: 'Bracket',
        description: 'Existing description',
      })
    )
  })

  it('rejects when there is no auth token', async () => {
    const copied = await copyCurrentFileShareLink({
      token: '',
      project: makeProject(),
      currentFilePath: '/projects/bracket/main.kcl',
      currentFileContents: 'part001 = startSketchOn(XY)',
      wasmInstance: {} as never,
      isRestrictedToOrg: false,
    })

    expect(copied).toBe(false)
    expect(mockState.createProject).not.toHaveBeenCalled()
    expect(mockState.writeText).not.toHaveBeenCalled()
    expect(mockState.toastError).toHaveBeenCalledWith(
      'You need to be signed in to share a file.',
      { duration: 5000 }
    )
  })
})

describe('publishCurrentProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.readProjectSettingsFile.mockResolvedValue({})
  })

  it('uploads the project and submits it for review', async () => {
    const published = await publishCurrentProject({
      token: 'token-123',
      project: makeProject(),
      currentFilePath: '/projects/bracket/main.kcl',
      currentFileContents: 'part001 = startSketchOn(XY)',
      wasmInstance: {} as never,
    })

    expect(published).toBe(true)
    expect(mockState.createProject).toHaveBeenCalledWith({
      client: {
        mocked: true,
        token: 'token-123',
        baseUrl: 'https://api.dev.zoo.dev',
      },
      files: expect.any(Array),
    })
    expect(mockState.publishProject).toHaveBeenCalledWith({
      client: {
        mocked: true,
        token: 'token-123',
        baseUrl: 'https://api.dev.zoo.dev',
      },
      id: 'project-created',
    })
    expect(mockState.toastSuccess).toHaveBeenCalledWith(
      'Project submitted for review.',
      { duration: 5000 }
    )
  })
})

describe('getCurrentProjectPublicationDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns publication details for the current environment binding', async () => {
    mockState.readProjectSettingsFile.mockResolvedValue({
      cloud: {
        'dev.zoo.dev': {
          project_id: 'project-existing',
        },
      },
    })
    mockState.getProject.mockResolvedValue(
      makeRemoteProject({
        publication_status: 'published',
        publication: {
          has_unpublished_changes: false,
          last_published_at: '2026-04-07T12:34:56Z',
        },
      })
    )

    const details = await getCurrentProjectPublicationDetails({
      token: 'token-123',
      project: makeProject(),
      wasmInstance: {} as never,
    })

    expect(details).toEqual({
      projectId: 'project-existing',
      publicationStatus: 'published',
      updatedAt: '2026-04-09T15:00:00Z',
      publishedAt: '2026-04-07T12:34:56Z',
    })
  })

  it('returns null when there is no bound cloud project for this environment', async () => {
    mockState.readProjectSettingsFile.mockResolvedValue({})

    const details = await getCurrentProjectPublicationDetails({
      token: 'token-123',
      project: makeProject(),
      wasmInstance: {} as never,
    })

    expect(details).toBeNull()
    expect(mockState.getProject).not.toHaveBeenCalled()
  })
})

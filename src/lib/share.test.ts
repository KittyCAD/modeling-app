import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectResponse } from '@kittycad/lib'
import type { Project } from '@src/lib/project'

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

describe('publishCurrentProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.readProjectSettingsFile.mockResolvedValue({})
    mockState.getProject.mockResolvedValue(makeRemoteProject())
  })

  it('uploads the project and submits it for review', async () => {
    const published = await publishCurrentProject({
      token: 'token-123',
      project: makeProject(),
      currentFilePath: '/projects/bracket/main.kcl',
      currentFileContents: 'part001 = startSketchOn(XY)',
      wasmInstance: {} as never,
      submission: {
        title: 'Bracket',
        description: 'A mounting bracket.',
        categoryIds: ['category-a', 'category-b'],
      },
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
    const createProjectCall = mockState.createProject.mock.calls.at(0) as
      | [
          {
            files: Array<{ name: string; data: Blob }>
          },
        ]
      | undefined
    const createProjectArgs = createProjectCall?.[0]
    const createProjectFiles = createProjectArgs?.files ?? []
    const bodyFile = createProjectFiles.find((file) => file.name === 'body')

    expect(bodyFile).toBeDefined()
    await expect(bodyFile?.data.text()).resolves.toBe(
      JSON.stringify({
        title: 'Bracket',
        description: 'A mounting bracket.',
        category_ids: ['category-a', 'category-b'],
      })
    )
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
    mockState.readProjectSettingsFile.mockResolvedValue({})
    mockState.getProject.mockResolvedValue(makeRemoteProject())
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
      title: 'Bracket',
      description: 'Existing description',
      categoryIds: [],
      updatedAt: '2026-04-09T15:00:00Z',
      publishedAt: '2026-04-07T12:34:56Z',
      submittedAt: undefined,
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

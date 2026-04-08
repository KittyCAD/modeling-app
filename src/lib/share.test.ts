import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Project } from '@src/lib/project'

type ShareLink = {
  access_mode: 'anyone_with_link' | 'organization_only'
  key: string
  url: string
}

type FetchResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

const mockState = vi.hoisted(() => ({
  projectFetch: vi.fn(
    async (url: string, init?: RequestInit): Promise<FetchResponse> => {
      const method = init?.method || 'GET'
      if (method === 'POST' && url.endsWith('/user/projects')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'project-created' }),
          text: async () => '',
        }
      }

      if (method === 'PUT' && url.endsWith('/user/projects/project-existing')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'project-existing' }),
          text: async () => '',
        }
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'not found' }),
        text: async () => 'not found',
      }
    }
  ),
  createKCClient: vi.fn(() => ({
    mocked: true,
    token: 'token-123',
    baseUrl: 'https://api.dev.zoo.dev',
    fetch: mockState.projectFetch,
  })),
  kcCall: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
  getUserProject: vi.fn(async () => ({
    title: 'Bracket',
    description: 'Existing description',
  })),
  listUserProjectShareLinks: vi.fn(
    async (_args: { client?: unknown; id: string }): Promise<ShareLink[]> => []
  ),
  createUserProjectShareLink: vi.fn(
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
  users: {
    get_user_project: mockState.getUserProject,
    list_user_project_share_links: mockState.listUserProjectShareLinks,
    create_user_project_share_link: mockState.createUserProjectShareLink,
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

import { copyCurrentFileShareLink } from '@src/lib/share'

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
    expect(mockState.projectFetch).toHaveBeenCalledTimes(1)
    expect(mockState.getUserProject).not.toHaveBeenCalled()
    expect(mockState.writeProjectSettingsFile).toHaveBeenCalledWith(
      '/projects/bracket',
      'serialized-project-toml'
    )
    expect(mockState.createUserProjectShareLink).toHaveBeenCalledWith({
      client: {
        mocked: true,
        token: 'token-123',
        baseUrl: 'https://api.dev.zoo.dev',
        fetch: mockState.projectFetch,
      },
      id: 'project-created',
      body: { access_mode: 'anyone_with_link' },
    })

    const [createUrl, createInit] =
      mockState.projectFetch.mock.calls.at(0) ?? []
    if (!createUrl || !createInit) {
      throw new Error('Expected project upload to be called')
    }

    expect(createUrl).toBe('https://api.dev.zoo.dev/user/projects')
    expect(createInit.method).toBe('POST')
    expect(createInit.headers).toEqual({
      Authorization: 'Bearer token-123',
    })

    const createForm = createInit.body as FormData
    expect(Array.from(createForm.keys())).toEqual([
      'body',
      'project.toml',
      'main.kcl',
    ])
    const createBody = createForm.get('body')
    if (!(createBody instanceof File)) {
      throw new Error('Expected body part to be a File')
    }
    await expect(createBody.text()).resolves.toBe(
      JSON.stringify({
        title: 'bracket',
        description: '',
      })
    )

    const mainFile = createForm.get('main.kcl')
    if (!(mainFile instanceof File)) {
      throw new Error('Expected main.kcl part to be a File')
    }
    await expect(mainFile.text()).resolves.toBe('part001 = startSketchOn(XY)')
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
    mockState.listUserProjectShareLinks.mockResolvedValue([
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
    expect(mockState.getUserProject).toHaveBeenCalledWith({
      client: {
        mocked: true,
        token: 'token-123',
        baseUrl: 'https://api.dev.zoo.dev',
        fetch: mockState.projectFetch,
      },
      id: 'project-existing',
    })
    expect(mockState.projectFetch).toHaveBeenCalledWith(
      'https://api.dev.zoo.dev/user/projects/project-existing',
      expect.objectContaining({
        method: 'PUT',
      })
    )
    expect(mockState.writeProjectSettingsFile).not.toHaveBeenCalled()
    expect(mockState.createUserProjectShareLink).not.toHaveBeenCalled()
    expect(mockState.writeText).toHaveBeenCalledWith(
      'https://zoo.dev/project/existing-share-key'
    )

    const updateInit = mockState.projectFetch.mock.calls.at(0)?.[1]
    if (!updateInit) {
      throw new Error('Expected update project upload to be called')
    }
    const updateForm = updateInit.body as FormData
    const updateBody = updateForm.get('body')
    if (!(updateBody instanceof File)) {
      throw new Error('Expected update body part to be a File')
    }
    await expect(updateBody.text()).resolves.toBe(
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
    expect(mockState.projectFetch).not.toHaveBeenCalled()
    expect(mockState.writeText).not.toHaveBeenCalled()
    expect(mockState.toastError).toHaveBeenCalledWith(
      'You need to be signed in to share a file.',
      { duration: 5000 }
    )
  })
})

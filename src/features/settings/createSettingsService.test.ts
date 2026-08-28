import { computed, type ReadonlySignal, signal } from '@preact/signals'
import type {
  ProjectSession,
  ProjectSessionService,
} from '@src/contracts/projectSession'
import type { RuntimeService } from '@src/contracts/runtime'
import {
  type AnySetting,
  booleanSetting,
  optionsSetting,
  type SettingsSection,
  type SettingsStore,
} from '@src/contracts/settings'
import { createSettingsService } from '@src/features/settings/createSettingsService'
import {
  createFakeFileSystem,
  type FakeFileSystem,
} from '@src/test/fakeFileSystem'
import { beforeEach, describe, expect, it } from 'vitest'

const theme = optionsSetting({
  id: 'appearance.theme',
  section: 'appearance',
  title: 'Theme',
  defaultValue: 'system' as 'system' | 'dark' | 'light',
  // Deliberately user-only, like the real one: a project has no business
  // deciding what colour someone's app is.
  levels: ['user'],
  toml: ['settings', 'app', 'appearance', 'theme'],
  options: [
    { value: 'system' as const, label: 'System' },
    { value: 'dark' as const, label: 'Dark' },
    { value: 'light' as const, label: 'Light' },
  ],
})

const highlightEdges = booleanSetting({
  id: 'modeling.highlightEdges',
  section: 'modeling',
  title: 'Highlight edges',
  defaultValue: true,
  toml: ['settings', 'modeling', 'highlight_edges'],
})

const desktopOnly = booleanSetting({
  id: 'editor.watchFiles',
  section: 'editor',
  title: 'Watch files',
  defaultValue: true,
  platforms: ['desktop'],
  toml: ['settings', 'app', 'watch_files'],
})

const sections: SettingsSection[] = [
  { id: 'appearance', title: 'Appearance', order: 0 },
  { id: 'modeling', title: 'Modeling', order: 10 },
  { id: 'editor', title: 'Editor', order: 20 },
]

/** An in-memory store, so a test can inspect exactly what would hit the disk. */
function createFakeStore(initial: string | null = null) {
  let text = initial
  return {
    store: {
      id: 'fake',
      location: computed(() => '/config/user.toml'),
      read: async () => text,
      write: async (next: string) => {
        text = next
      },
    } satisfies SettingsStore,
    text: () => text,
  }
}

function createFakeSessions(): {
  service: ProjectSessionService
  open: (path: string) => void
  close: () => void
} {
  const current = signal<ProjectSession | null>(null)
  const openProject = (path: string) => {
    current.value = {
      project: computed(() => ({ path }) as ProjectSession['project']['value']),
    } as unknown as ProjectSession
  }

  return {
    service: {
      current: current as ReadonlySignal<ProjectSession | null>,
      opening: computed(() => null),
      error: computed(() => null),
      open: async () => null,
      close: () => {
        current.value = null
      },
    },
    open: openProject,
    close: () => {
      current.value = null
    },
  }
}

const fakeRuntime = (target: 'desktop' | 'web'): RuntimeService => ({
  info: computed(() => ({
    target,
    isDesktop: target === 'desktop',
    isWeb: target === 'web',
    isTest: true,
    version: 'test',
  })),
})

interface Harness {
  settings: ReturnType<typeof createSettingsService>
  storeText: () => string | null
  fileSystem: FakeFileSystem
  sessions: ReturnType<typeof createFakeSessions>
}

function harness(
  options: {
    definitions?: AnySetting[]
    userToml?: string | null
    files?: Record<string, string>
    target?: 'desktop' | 'web'
  } = {}
): Harness {
  const { store, text } = createFakeStore(options.userToml ?? null)
  const fileSystem = createFakeFileSystem(options.files ?? {})
  const sessions = createFakeSessions()

  const settings = createSettingsService({
    definitions: computed(
      () => options.definitions ?? [theme, highlightEdges, desktopOnly]
    ),
    sections: computed(() => sections),
    userStore: () => store,
    sessions: () => sessions.service,
    fileSystem: () => fileSystem,
    runtime: () => fakeRuntime(options.target ?? 'desktop'),
  })

  return { settings, storeText: text, fileSystem, sessions }
}

/** Let the microtask-deferred effects and the write queues run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createSettingsService', () => {
  let subject: Harness

  beforeEach(() => {
    subject = harness()
  })

  it('resolves the app default when nothing is stored', () => {
    expect(subject.settings.read(theme)).toBe('system')
    expect(subject.settings.read(highlightEdges)).toBe(true)
  })

  it('lets a user override beat the default', () => {
    subject.settings.set(theme, 'user', 'light')
    expect(subject.settings.read(theme)).toBe('light')
  })

  it('lets a project override beat the user', async () => {
    subject.settings.set(highlightEdges, 'user', false)
    subject.sessions.open('/projects/bracket')
    await settle()

    subject.settings.set(highlightEdges, 'project', true)
    expect(subject.settings.read(highlightEdges)).toBe(true)
  })

  it('ignores a project override for a setting that does not allow one', async () => {
    subject = harness({
      userToml: `[settings.app.appearance]
theme = "dark"
`,
      files: {
        '/projects/bracket/project.toml': `[settings.app.appearance]
theme = "light"
`,
      },
    })
    subject.sessions.open('/projects/bracket')
    await settle()

    // The file says light; the setting is user-level only, so the file is not
    // allowed to promise something the app will not honour.
    expect(subject.settings.read(theme)).toBe('dark')
    expect(subject.settings.supportsLevel(theme, 'project')).toBe(false)
  })

  it('falls back to the user value when a project override is cleared', async () => {
    subject.settings.set(highlightEdges, 'user', false)
    subject.sessions.open('/projects/bracket')
    await settle()

    subject.settings.set(highlightEdges, 'project', true)
    subject.settings.clear(highlightEdges, 'project')
    expect(subject.settings.read(highlightEdges)).toBe(false)
  })

  it('reports what each level would inherit', async () => {
    subject.settings.set(highlightEdges, 'user', false)
    subject.sessions.open('/projects/bracket')
    await settle()

    expect(subject.settings.inheritedAt(highlightEdges, 'project').value).toBe(
      false
    )
    expect(subject.settings.inheritedAt(highlightEdges, 'user').value).toBe(
      true
    )
  })

  it('writes the user level at the path the Rust schema describes', async () => {
    subject.settings.set(theme, 'user', 'dark')
    await settle()

    expect(subject.storeText()).toContain('[settings.app.appearance]')
    expect(subject.storeText()).toContain('theme = "dark"')
  })

  it('writes the project level into project.toml, keeping the title', async () => {
    subject = harness({
      files: { '/projects/bracket/project.toml': 'title = "Bracket"\n' },
    })
    subject.sessions.open('/projects/bracket')
    await settle()

    subject.settings.set(highlightEdges, 'project', false)
    await settle()

    const written = await subject.fileSystem.readTextFile(
      '/projects/bracket/project.toml'
    )
    expect(written).toContain('title = "Bracket"')
    expect(written).toContain('highlight_edges = false')
  })

  it('creates project.toml when a project does not have one', async () => {
    subject.sessions.open('/projects/fresh')
    await settle()

    subject.settings.set(highlightEdges, 'project', false)
    await settle()

    expect(
      await subject.fileSystem.exists('/projects/fresh/project.toml')
    ).toBe(true)
  })

  it('hydrates from what is already stored', async () => {
    subject = harness({
      userToml: `[settings.modeling]
highlight_edges = false
`,
    })
    await settle()

    expect(subject.settings.hydrated.value).toBe(true)
    expect(subject.settings.read(highlightEdges)).toBe(false)
  })

  it('keeps a change made before hydration finished', async () => {
    subject = harness({
      userToml: `[settings.modeling]
highlight_edges = false
`,
    })
    // Same tick as construction: the file has not been read yet.
    subject.settings.set(highlightEdges, 'user', true)
    await settle()

    expect(subject.settings.read(highlightEdges)).toBe(true)
    expect(subject.storeText()).toContain('highlight_edges = true')
  })

  it('drops project overrides when the project closes', async () => {
    subject.sessions.open('/projects/bracket')
    await settle()
    subject.settings.set(highlightEdges, 'project', false)
    expect(subject.settings.read(highlightEdges)).toBe(false)

    subject.sessions.close()
    await settle()
    expect(subject.settings.read(highlightEdges)).toBe(true)
  })

  it('reports a value it could not read, and keeps the default', async () => {
    subject = harness({
      userToml: `[settings.app.appearance]
theme = "solarized"
`,
    })
    await settle()

    expect(subject.settings.read(theme)).toBe('system')
    expect(subject.settings.error.value).toContain('appearance.theme')
  })

  it('hides a setting that does not apply to this platform', () => {
    const desktop = harness({ target: 'desktop' })
    const web = harness({ target: 'web' })

    const sectionIds = (subject: Harness) =>
      subject.settings.sections.value.map((section) => section.id)

    expect(sectionIds(desktop)).toContain('editor')
    expect(sectionIds(web)).not.toContain('editor')
  })

  it('orders sections and their settings as declared', () => {
    expect(subject.settings.sections.value.map((s) => s.title)).toEqual([
      'Appearance',
      'Modeling',
      'Editor',
    ])
  })

  it('opens at the first section when none is named', () => {
    expect(subject.settings.openSection.value).toBeNull()
    subject.settings.open()
    expect(subject.settings.openSection.value).toBe('appearance')
    subject.settings.close()
    expect(subject.settings.openSection.value).toBeNull()
  })
})

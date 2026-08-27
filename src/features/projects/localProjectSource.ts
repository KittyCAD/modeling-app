import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type {
  LoadState,
  ProjectFile,
  ProjectSource,
  ProjectSummary,
} from '@src/contracts/projects'

const STORAGE_KEY = 'zds.projects.local'
const SOURCE_ID = 'local'

interface StoredProject {
  name: string
  createdAt: number
  modifiedAt: number
  revision: number
  /** Flat path -> contents. A tree is derived, never stored. */
  files: Record<string, string>
}

interface StoredState {
  version: 1
  projects: Record<string, StoredProject>
}

/**
 * Seed content, so a first run has something to look at.
 *
 * These are the shapes someone actually starts from, not lorem ipsum: a part,
 * an assembly, and a sketch-only file.
 */
const seeds: Record<string, StoredProject> = {
  'bracket-v2': {
    name: 'bracket-v2',
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 12,
    modifiedAt: Date.now() - 1000 * 60 * 60 * 20,
    revision: 12,
    files: {
      'main.kcl': [
        '// Mounting bracket, 6061-T6, 4 mm plate',
        'thickness = 4',
        'width = 60',
        'height = 45',
        '',
        'plate = startSketchOn(XY)',
        '  |> startProfile(at = [0, 0])',
        '  |> line(end = [width, 0])',
        '  |> line(end = [0, height])',
        '  |> line(end = [-width, 0])',
        '  |> close()',
        '  |> extrude(length = thickness)',
        '',
      ].join('\n'),
      'params.kcl': 'boltDiameter = 6\nboltSpacing = 40\n',
      'README.md': '# bracket-v2\n\nRevised for the 40 mm bolt spacing.\n',
    },
  },
  enclosure: {
    name: 'enclosure',
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 40,
    modifiedAt: Date.now() - 1000 * 60 * 60 * 24 * 6,
    revision: 3,
    files: {
      'main.kcl':
        '// Sealed enclosure, top and bottom shells\nwallThickness = 2.4\n',
      'lid.kcl': '// Lid, gasket channel to follow\n',
      'body.kcl': '// Body shell\n',
    },
  },
  'gearbox-housing': {
    name: 'gearbox-housing',
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
    modifiedAt: Date.now() - 1000 * 60 * 60 * 24 * 21,
    revision: 41,
    files: {
      'main.kcl': '// Two-stage reduction housing\ncenterDistance = 84\n',
    },
  },
}

function read(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as StoredState
      if (parsed.version === 1 && parsed.projects) return parsed
    }
  } catch {
    // Corrupt or unavailable storage falls back to seeds rather than failing
    // the boot. Losing local scratch projects beats not starting.
  }
  return { version: 1, projects: structuredClone(seeds) }
}

function write(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.warn('projects: could not persist local projects', error)
  }
}

const qualify = (localId: string) => `${SOURCE_ID}:${localId}`
const localise = (projectId: string) =>
  projectId.startsWith(`${SOURCE_ID}:`)
    ? projectId.slice(SOURCE_ID.length + 1)
    : null

function toSummary(localId: string, stored: StoredProject): ProjectSummary {
  return {
    id: qualify(localId),
    name: stored.name,
    sourceId: SOURCE_ID,
    location: 'This browser',
    modifiedAt: stored.modifiedAt,
    fileCount: Object.keys(stored.files).length,
    revision: stored.revision,
  }
}

/** Derive a nested tree from flat paths, directories first then alphabetical. */
function toTree(paths: string[]): ProjectFile[] {
  const root: ProjectFile[] = []

  for (const path of paths.slice().sort()) {
    const segments = path.split('/')
    let level = root
    let prefix = ''

    segments.forEach((segment, index) => {
      prefix = prefix ? `${prefix}/${segment}` : segment
      const isLeaf = index === segments.length - 1

      let node = level.find((entry) => entry.name === segment)
      if (!node) {
        node = {
          path: prefix,
          name: segment,
          kind: isLeaf ? 'file' : 'directory',
          ...(isLeaf ? {} : { children: [] }),
        }
        level.push(node)
      }
      if (!isLeaf) level = node.children ?? (node.children = [])
    })
  }

  const sort = (entries: ProjectFile[]): ProjectFile[] =>
    entries
      .sort(
        (a, b) =>
          Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
          a.name.localeCompare(b.name)
      )
      .map((entry) =>
        entry.children ? { ...entry, children: sort(entry.children) } : entry
      )

  return sort(root)
}

function uniqueName(state: StoredState, requested: string): string {
  const trimmed = requested.trim() || 'untitled'
  const taken = new Set(Object.keys(state.projects))
  if (!taken.has(trimmed)) return trimmed

  let suffix = 2
  while (taken.has(`${trimmed}-${suffix}`)) suffix += 1
  return `${trimmed}-${suffix}`
}

/**
 * Projects held in browser storage.
 *
 * This is the whole storage layer for now. It exists so the rest of the app can
 * be built against `ProjectSource` rather than against a filesystem — the
 * desktop and cloud sources are the same shape, and nothing above this line
 * will need to change when they arrive.
 */
export function createLocalProjectSource(): ProjectSource {
  const state = signal<StoredState>(read())
  const loadState = signal<LoadState>('ready')
  const error = signal<string | null>(null)

  const projects: ReadonlySignal<readonly ProjectSummary[]> = computed(() =>
    Object.entries(state.value.projects)
      .map(([localId, stored]) => toSummary(localId, stored))
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
  )

  const mutate = (change: (draft: StoredState) => void): StoredState => {
    const draft = structuredClone(state.peek())
    change(draft)
    write(draft)
    state.value = draft
    return draft
  }

  const requireProject = (projectId: string) => {
    const localId = localise(projectId)
    const stored = localId ? state.peek().projects[localId] : undefined
    if (!localId || !stored) {
      throw new Error(`No local project "${projectId}"`)
    }
    return { localId, stored }
  }

  return {
    id: SOURCE_ID,
    label: 'On this device',
    projects,
    state: computed(() => loadState.value),
    error: computed(() => error.value),

    async refresh() {
      state.value = read()
      loadState.value = 'ready'
    },

    async create(name) {
      let created: ProjectSummary | null = null
      mutate((draft) => {
        const localId = uniqueName(draft, name)
        const now = Date.now()
        draft.projects[localId] = {
          name: localId,
          createdAt: now,
          modifiedAt: now,
          revision: 1,
          // A new project gets one empty KCL file, so the editor has somewhere
          // to land instead of opening onto nothing.
          files: { 'main.kcl': '' },
        }
        created = toSummary(localId, draft.projects[localId])
      })
      if (!created) throw new Error('Could not create project')
      return created
    },

    async rename(projectId, name) {
      const { localId } = requireProject(projectId)
      mutate((draft) => {
        const nextId = uniqueName(draft, name)
        const stored = draft.projects[localId]
        delete draft.projects[localId]
        draft.projects[nextId] = {
          ...stored,
          name: nextId,
          modifiedAt: Date.now(),
        }
      })
    },

    async delete(projectId) {
      const { localId } = requireProject(projectId)
      mutate((draft) => {
        delete draft.projects[localId]
      })
    },

    async listFiles(projectId) {
      const { stored } = requireProject(projectId)
      return toTree(Object.keys(stored.files))
    },

    async readFile(projectId, path) {
      const { stored } = requireProject(projectId)
      const contents = stored.files[path]
      if (contents === undefined) {
        throw new Error(`No file "${path}" in "${projectId}"`)
      }
      return contents
    },

    async writeFile(projectId, path, contents) {
      const { localId } = requireProject(projectId)
      mutate((draft) => {
        const stored = draft.projects[localId]
        stored.files[path] = contents
        stored.modifiedAt = Date.now()
        stored.revision += 1
      })
    },
  }
}

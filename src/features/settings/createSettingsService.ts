import {
  computed,
  effect,
  type ReadonlySignal,
  type Signal,
  signal,
} from '@preact/signals'
import type { FileSystem } from '@src/contracts/fileSystem'
import type { FileWatcher } from '@src/contracts/fileWatcher'
import type { FsOperationQueue } from '@src/contracts/fsOperations'
import type { ProjectSessionService } from '@src/contracts/projectSession'
import type { RuntimeService } from '@src/contracts/runtime'
import {
  type AnySetting,
  type SettingDefinition,
  type SettingsLevel,
  type SettingsLevelInfo,
  type SettingsSection,
  type SettingsSectionView,
  type SettingsService,
  type SettingsStore,
  settingsLevels,
} from '@src/contracts/settings'
import { readExternalChange } from '@src/lib/fs/externalChange'
import { hashString } from '@src/lib/hash'
import { joinPath, normalizePath } from '@src/lib/paths'
import {
  decodeSettingsToml,
  encodeSettingsToml,
  PROJECT_SETTINGS_FILE,
} from '@src/lib/settings/settingsToml'

export interface SettingsServiceDependencies {
  definitions: ReadonlySignal<readonly AnySetting[]>
  sections: ReadonlySignal<readonly SettingsSection[]>
  /**
   * Lazy accessors, because a service may not be resolved while the registry
   * graph is still being built. Every one of these is read on demand instead.
   */
  userStore: () => SettingsStore | undefined
  sessions: () => ProjectSessionService
  fileSystem: () => FileSystem
  runtime: () => RuntimeService
  /** Write provenance, so an echo of our own save is not read back as an edit. */
  queue: () => FsOperationQueue
  /** Absent on platforms with nothing external to watch. */
  watcher: () => FileWatcher | undefined
}

type Overrides = Record<string, unknown>

/** "modeling" -> "Modeling", for a section nobody described. */
const titleCase = (id: string) =>
  id
    .split(/[.\-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

/**
 * The cascade.
 *
 * Three layers, resolved in one direction: the app's compiled defaults, then
 * the user's overrides, then the open project's. Nothing merges downward and
 * nothing writes to a lower layer, so "why is this value what it is" always has
 * a three-line answer.
 *
 * Definitions are static data contributed by features and are never mutated —
 * unlike a settings tree of stateful objects, where the current value and its
 * declaration live in the same place and every consumer needs the whole tree.
 * Here the only state is two override maps, and every value is derived.
 */
export function createSettingsService(
  dependencies: SettingsServiceDependencies
): SettingsService & { dispose: () => void } {
  const {
    definitions,
    sections,
    userStore,
    sessions,
    fileSystem,
    runtime,
    queue,
    watcher,
  } = dependencies

  const overrides: Record<SettingsLevel, Signal<Overrides>> = {
    user: signal<Overrides>({}),
    project: signal<Overrides>({}),
  }

  /**
   * Ids changed in this session, per level.
   *
   * Reading a file is slower than a click. Without this, a toggle made while
   * `user.toml` is still being read would be overwritten by the file that did
   * not know about it yet.
   */
  const touched: Record<SettingsLevel, Set<string>> = {
    user: new Set(),
    project: new Set(),
  }

  const hydrated = signal(false)
  const error = signal<string | null>(null)
  const openSection = signal<string | null>(null)
  /** Survives a close, so reopening lands where you left off. */
  let lastSection: string | null = null
  const userLocation = computed(() => userStore()?.location.value ?? null)

  const appliesToPlatform = (setting: AnySetting) => {
    if (!setting.platforms) return true
    return setting.platforms.includes(runtime().info.value.target)
  }

  const supportsLevel = (setting: AnySetting, level: SettingsLevel) =>
    (setting.levels ?? settingsLevels).includes(level)

  /**
   * Apply what a file said.
   *
   * The two modes differ on who is more likely to be right:
   *
   * - `hydrate` is the first read, racing a click. A setting the person has
   *   already changed this session keeps their value, because the file is stale
   *   by definition — their change is what is about to be written to it.
   * - `external` is somebody editing the file while the app is open. That file
   *   is newer than anything the app knows, so it wins outright, including for
   *   settings changed here earlier. A line they deleted becomes inherited
   *   again, which is the whole point of editing the file by hand.
   */
  const applyDecoded = (
    level: SettingsLevel,
    decoded: Overrides,
    mode: 'hydrate' | 'external'
  ) => {
    if (mode === 'external') {
      touched[level].clear()
      overrides[level].value = { ...decoded }
      return
    }

    const local = overrides[level].peek()
    const next: Overrides = { ...decoded }
    for (const id of touched[level]) {
      if (local[id] === undefined) delete next[id]
      else next[id] = local[id]
    }
    overrides[level].value = next
  }

  const reportRejected = (source: string, rejected: readonly string[]) => {
    if (rejected.length === 0) return
    error.value = `${rejected.length} setting${
      rejected.length === 1 ? '' : 's'
    } in ${source} could not be read: ${rejected.join(', ')}`
  }

  // ---------------------------------------------------------------- user level

  const applyUserText = (text: string | null, mode: 'hydrate' | 'external') => {
    const store = userStore()
    if (!text) {
      // Gone or empty means no overrides at all, not "keep whatever we had".
      applyDecoded('user', {}, mode)
      return
    }
    const decoded = decodeSettingsToml(text, definitions.value)
    applyDecoded('user', decoded.overrides, mode)
    reportRejected(store?.location.peek() ?? 'your settings', decoded.rejected)
  }

  const loadUser = async () => {
    const store = userStore()
    if (!store) {
      hydrated.value = true
      return
    }
    try {
      applyUserText(await store.read(), 'hydrate')
    } catch (caught) {
      error.value = `Could not read ${store.location.peek()}: ${String(caught)}`
    } finally {
      hydrated.value = true
    }
  }

  const userHydration = loadUser()

  /**
   * Somebody editing `user.toml` in a text editor.
   *
   * The store only reports edits it did not perform itself, so anything arriving
   * here is external and takes precedence — no provenance check needed on this
   * side of the boundary.
   */
  const stopWatchingUser = userStore()?.watch?.((text) => {
    try {
      applyUserText(text, 'external')
    } catch (caught) {
      error.value = `Could not read your settings: ${String(caught)}`
    }
  })

  // ------------------------------------------------------------- project level

  const projectPath = () => sessions().current.value?.project.value.path ?? null

  const projectSettingsPath = computed(() => {
    const path = projectPath()
    return path ? joinPath(path, PROJECT_SETTINGS_FILE) : null
  })

  const loadProject = async (path: string | null) => {
    touched.project.clear()
    if (!path) {
      overrides.project.value = {}
      return
    }
    try {
      // One question rather than `exists` then read, which leaves a gap between
      // the two answers and costs a second round trip to the main process.
      const text = await fileSystem().readTextFileIfPresent(path)
      if (text === null) {
        overrides.project.value = {}
        return
      }
      const decoded = decodeSettingsToml(text, definitions.value)
      applyDecoded('project', decoded.overrides, 'hydrate')
      reportRejected(PROJECT_SETTINGS_FILE, decoded.rejected)
    } catch (caught) {
      // A project whose settings file is unreadable still opens; it just has no
      // project-level overrides, which is the same as not having the file.
      console.warn('settings: could not read project settings', caught)
      overrides.project.value = {}
    }
  }

  /**
   * Somebody editing `project.toml` while the project is open.
   *
   * The whole project folder is watched rather than the one file, because that
   * is the shape the watcher offers and because a watch on a single file goes
   * deaf the moment an editor saves by writing a temporary file and renaming it.
   * Sharing costs nothing: the watcher keeps one operating-system watch per
   * directory however many features ask for it.
   */
  let stopWatchingProjectFile = () => {}

  const watchProjectFile = (
    root: string | null,
    settingsPath: string | null
  ) => {
    stopWatchingProjectFile()
    stopWatchingProjectFile = () => {}
    if (!root || !settingsPath) return

    const active = watcher()?.watch(root, (changes) => {
      const change = changes.find(
        (candidate) => normalizePath(candidate.path) === settingsPath
      )
      if (!change) return

      void (async () => {
        if (change.kind === 'removed') {
          applyDecoded('project', {}, 'external')
          return
        }
        const external = await readExternalChange(fileSystem(), queue(), change)
        if (!external) return

        const decoded = decodeSettingsToml(external.contents, definitions.value)
        applyDecoded('project', decoded.overrides, 'external')
        reportRejected(PROJECT_SETTINGS_FILE, decoded.rejected)
      })().catch((caught) => {
        console.warn('settings: could not read the project settings', caught)
      })
    })

    if (active) stopWatchingProjectFile = active
  }

  let stopWatchingProject = () => {}
  // Deferred: an effect that reads a value spec while the registry graph is
  // still being flattened is a cycle, and this one reaches the session service.
  queueMicrotask(() => {
    stopWatchingProject = effect(() => {
      const path = projectSettingsPath.value
      const root = projectPath()
      void loadProject(path)
      watchProjectFile(root, path)
    })
  })

  // ----------------------------------------------------------------- persisting

  /** One write at a time per level, so two quick toggles cannot interleave. */
  const writeQueues: Record<SettingsLevel, Promise<void>> = {
    user: Promise.resolve(),
    project: Promise.resolve(),
  }

  const writeUser = async () => {
    const store = userStore()
    if (!store) return
    await userHydration
    // Re-read rather than remembering the text: someone may have edited the
    // file since, and their keys are not ours to drop.
    const existing = await store.read()
    await store.write(
      encodeSettingsToml(existing, definitions.value, overrides.user.peek())
    )
  }

  const writeProject = async () => {
    const path = projectSettingsPath.peek()
    if (!path) return
    const fs = fileSystem()

    // Through the operation queue: `project.toml` is also written when a project
    // is renamed, and recording the content is what stops the watcher reading
    // our own write back as somebody else's edit.
    await queue().enqueue(path, async () => {
      // The first write to a project has nothing to merge into, which is the
      // ordinary case rather than a failure.
      const existing = await fs.readTextFileIfPresent(path)
      const next = encodeSettingsToml(
        existing,
        definitions.value,
        overrides.project.peek()
      )
      queue().recordWrite(path, hashString(next))
      await fs.writeTextFile(path, next)
    })
  }

  const persist = (level: SettingsLevel) => {
    writeQueues[level] = writeQueues[level]
      .then(level === 'user' ? writeUser : writeProject)
      .then(
        () => {
          error.value = null
        },
        (caught) => {
          error.value = `Could not save settings: ${
            caught instanceof Error ? caught.message : String(caught)
          }`
        }
      )
  }

  // -------------------------------------------------------------------- reading

  const valueCache = new Map<string, ReadonlySignal<unknown>>()

  const resolve = <T>(setting: SettingDefinition<T>): ReadonlySignal<T> => {
    const cached = valueCache.get(setting.id)
    if (cached) return cached as ReadonlySignal<T>

    const created = computed<T>(() => {
      // Highest precedence first. A level the setting does not support is
      // skipped even when a file sets it, so the file cannot promise something
      // the app will not honour.
      for (const level of ['project', 'user'] as const) {
        if (!supportsLevel(setting, level)) continue
        const stored = overrides[level].value[setting.id]
        if (stored !== undefined) return stored as T
      }
      return setting.defaultValue
    })

    valueCache.set(setting.id, created)
    return created
  }

  const overrideAt = <T>(
    setting: SettingDefinition<T>,
    level: SettingsLevel
  ): ReadonlySignal<T | undefined> =>
    computed(() =>
      supportsLevel(setting, level)
        ? (overrides[level].value[setting.id] as T | undefined)
        : undefined
    )

  const inheritedAt = <T>(
    setting: SettingDefinition<T>,
    level: SettingsLevel
  ): ReadonlySignal<T> =>
    computed(() => {
      // Everything below the given level, in the same precedence order.
      const below = settingsLevels.slice(0, settingsLevels.indexOf(level))
      for (const candidate of [...below].reverse()) {
        if (!supportsLevel(setting, candidate)) continue
        const stored = overrides[candidate].value[setting.id]
        if (stored !== undefined) return stored as T
      }
      return setting.defaultValue
    })

  // ------------------------------------------------------------------- writing

  const set = <T>(
    setting: SettingDefinition<T>,
    level: SettingsLevel,
    value: T
  ) => {
    if (!supportsLevel(setting, level)) {
      console.warn(
        `settings: ${setting.id} cannot be set at the ${level} level`
      )
      return
    }
    const parsed = setting.parse(value)
    if (parsed === undefined) {
      error.value = `${setting.title} does not accept that value.`
      return
    }
    touched[level].add(setting.id)
    overrides[level].value = {
      ...overrides[level].peek(),
      [setting.id]: parsed,
    }
    persist(level)
  }

  const clear = (setting: AnySetting, level: SettingsLevel) => {
    touched[level].add(setting.id)
    const next = { ...overrides[level].peek() }
    delete next[setting.id]
    overrides[level].value = next
    persist(level)
  }

  // ------------------------------------------------------------------ sections

  const sectionViews = computed<readonly SettingsSectionView[]>(() => {
    const applicable = definitions.value.filter(appliesToPlatform)
    const declared = new Map(
      sections.value.map((section) => [section.id, section])
    )

    const grouped = new Map<string, AnySetting[]>()
    for (const setting of applicable) {
      const list = grouped.get(setting.section)
      if (list) list.push(setting)
      else grouped.set(setting.section, [setting])
    }

    // Declared sections as well as grouped ones: a section can be a body with no
    // rows — the keybindings table — and grouping alone would never see it. The
    // dialog drops an empty section that has nothing to draw either way.
    const ids = [...new Set([...grouped.keys(), ...declared.keys()])]

    return (
      ids
        .map((id) => {
          // A setting whose section nobody declared still gets a home, named
          // after its id. Losing a setting because a section contribution is
          // missing would be the worse failure.
          const section = declared.get(id) ?? { id, title: titleCase(id) }
          return { ...section, settings: grouped.get(id) ?? [] }
        })
        // A section with neither rows nor a body has nothing to draw. That is the
        // ordinary case for a section whose settings are all desktop-only, seen
        // from the web.
        .filter((section) => section.settings.length > 0 || section.render)
        .sort(
          (a, b) =>
            (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title)
        )
    )
  })

  const levels: readonly SettingsLevelInfo[] = [
    {
      level: 'user',
      label: 'You',
      location: computed(() => userLocation.value),
      unavailableReason: computed(() =>
        userStore()
          ? null
          : 'This build has nowhere to store your settings, so they last for this session only.'
      ),
    },
    {
      level: 'project',
      label: 'This project',
      location: computed(() => projectSettingsPath.value),
      unavailableReason: computed(() =>
        projectSettingsPath.value
          ? null
          : 'Open a project to override settings just for it.'
      ),
    },
  ]

  return {
    sections: sectionViews,
    hydrated: computed(() => hydrated.value),
    error: computed(() => error.value),
    levels,

    value: resolve,
    read: (setting) => resolve(setting).peek(),
    overrideAt,
    inheritedAt,
    set,
    clear,
    supportsLevel: (setting, level) =>
      supportsLevel(setting, level) && appliesToPlatform(setting),

    openSection: computed(() => openSection.value),
    open: (sectionId) => {
      // Reopening returns to the group you were last in. Someone adjusting one
      // setting usually comes back for its neighbour, not for the first group
      // in the list.
      const next = sectionId ?? lastSection ?? sectionViews.value.at(0)?.id
      if (next) lastSection = next
      openSection.value = next ?? null
    },
    close: () => {
      openSection.value = null
    },

    dispose: () => {
      stopWatchingProject()
      stopWatchingProjectFile()
      stopWatchingUser?.()
    },
  }
}

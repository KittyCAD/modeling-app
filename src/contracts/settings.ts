import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { IconName } from '@kittycad/ui-kit'
import type { ReadonlySignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import type { RuntimeTarget } from '@src/contracts/runtime'

/**
 * A level a setting can be overridden at.
 *
 * Resolution runs `default -> user -> project`, last one wins. The app default
 * is not a level because nothing writes to it: it is compiled into the setting
 * definition, so a fresh install with no files on disk is already a valid
 * configuration rather than an empty one.
 */
export type SettingsLevel = 'user' | 'project'

export const settingsLevels: readonly SettingsLevel[] = ['user', 'project']

/** What a TOML leaf may hold. Deliberately primitive — settings files are read by people. */
export type SettingsValue = string | number | boolean

/**
 * How a setting is edited.
 *
 * The control is part of the definition rather than a component, so a setting
 * is data: the dialog can render it, the command palette could offer it, and an
 * agent could enumerate it, without any of them importing the owning feature.
 */
export type SettingControl<T> =
  | { kind: 'boolean' }
  | {
      kind: 'options'
      options: readonly { value: T; label: string; hint?: string }[]
    }
  | { kind: 'text'; placeholder?: string }
  | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string }

export interface SettingDefinition<T> {
  /**
   * Stable identity, conventionally `section.key`.
   *
   * Used for deduplication and for the reactive value cache, so it must not
   * change between releases — a renamed id silently orphans everyone's override.
   */
  id: string
  /** Which section of the dialog this appears in. */
  section: string
  title: string
  description?: string
  /** Lower sorts earlier within a section. */
  order?: number

  /** What the app does when nobody has said otherwise. */
  defaultValue: T
  control: SettingControl<T>

  /**
   * Levels this may be overridden at. Defaults to both.
   *
   * Some settings genuinely have no per-project meaning — the colour theme
   * follows the person, not the drawing — and offering the override anyway
   * produces a file that promises something the app will not honour.
   */
  levels?: readonly SettingsLevel[]
  /** Platforms this applies to. Hidden elsewhere. Defaults to all. */
  platforms?: readonly RuntimeTarget[]

  /**
   * Where the value lives in `user.toml` and `project.toml`.
   *
   * Tables first, leaf key last: `['settings', 'modeling', 'camera_projection']`.
   * These paths match the Rust schema in `rust/kcl-lib/src/settings/types`, so
   * the files this app writes are the files that schema describes.
   */
  toml: readonly string[]

  /**
   * Validate and coerce a value that came from outside — a TOML file someone
   * hand-edited, or an older release's format. Return undefined to reject it.
   *
   * Rejecting has to be a normal outcome: one bad line in a settings file must
   * cost that one setting, not the whole file.
   */
  parse: (raw: unknown) => T | undefined
  /** How the value is written back. Defaults to the value itself. */
  serialize?: (value: T) => SettingsValue

  /**
   * Extra rows shown under this setting, derived from its current value.
   *
   * Data rather than a component, like `control`, so the dialog stays the only
   * thing that renders and a setting stays something an agent could enumerate.
   *
   * This is what makes a preference like "camera controls" answerable: the
   * choice is a name — OnShape, Solidworks — and the name means nothing without
   * the gestures it stands for.
   */
  detail?: (value: T) => readonly { label: string; value: string }[]
}

// biome-ignore lint/suspicious/noExplicitAny: the registry holds a
// heterogeneous list of settings; each one's own type is recovered at the call
// site through `SettingDefinition<T>`.
export type AnySetting = SettingDefinition<any>

/** A group of settings in the dialog's sidebar. */
export interface SettingsSection {
  id: string
  title: string
  description?: string
  icon?: IconName
  /** Lower sorts earlier. */
  order?: number
  /**
   * Content below the rows, for a group that is not a list of settings.
   *
   * The keybindings table is the case: it belongs in this dialog, it is not a
   * cascade of values, and modelling eighty bindings as eighty settings would
   * make the cascade lie about what it holds. A section may have both — rows for
   * what is a setting, and a body for what is not.
   */
  render?: (context: { level: SettingsLevel }) => ComponentChildren
  /**
   * Levels a body-only section appears at. Defaults to `user`.
   *
   * Only consulted when the section has no settings of its own: with settings,
   * the rows already decide, since a section is dropped when none of them apply
   * at the level being edited.
   */
  levels?: readonly SettingsLevel[]
}

/** A section with the settings that landed in it, ready to render. */
export interface SettingsSectionView extends SettingsSection {
  settings: readonly AnySetting[]
}

export interface SettingsLevelInfo {
  level: SettingsLevel
  label: string
  /** Where overrides at this level are stored, so someone can go find the file. */
  location: ReadonlySignal<string | null>
  /** Null when this level can be written. Otherwise why it cannot. */
  unavailableReason: ReadonlySignal<string | null>
}

export interface SettingsService {
  /** Sections that have at least one setting applicable to this platform. */
  readonly sections: ReadonlySignal<readonly SettingsSectionView[]>
  /**
   * False until the stored overrides have been read.
   *
   * Every setting still has a value before this — the app default — so nothing
   * has to wait. It exists so the dialog can avoid showing a default as though
   * it were the user's choice, and so writes cannot race the initial read.
   */
  readonly hydrated: ReadonlySignal<boolean>
  /** Reading or writing a settings file failed. Shown in the dialog, not fatal. */
  readonly error: ReadonlySignal<string | null>
  readonly levels: readonly SettingsLevelInfo[]

  /** The resolved value: project override, else user override, else default. */
  value<T>(setting: SettingDefinition<T>): ReadonlySignal<T>
  /** The resolved value, without subscribing. */
  read<T>(setting: SettingDefinition<T>): T
  /** What is set at exactly this level, or undefined if nothing is. */
  overrideAt<T>(
    setting: SettingDefinition<T>,
    level: SettingsLevel
  ): ReadonlySignal<T | undefined>
  /**
   * What this setting would resolve to if this level's override were removed.
   *
   * This is what makes an override legible: "Inherited from your settings"
   * needs the inherited value, not just the knowledge that one exists.
   */
  inheritedAt<T>(
    setting: SettingDefinition<T>,
    level: SettingsLevel
  ): ReadonlySignal<T>
  set<T>(setting: SettingDefinition<T>, level: SettingsLevel, value: T): void
  clear(setting: AnySetting, level: SettingsLevel): void
  /** Whether this setting may be overridden at this level on this platform. */
  supportsLevel(setting: AnySetting, level: SettingsLevel): boolean

  /** The open section, or null when the settings dialog is closed. */
  readonly openSection: ReadonlySignal<string | null>
  /** Open the dialog, optionally at a section. */
  open(sectionId?: string): void
  close(): void
}

/**
 * Somewhere a level's overrides are kept.
 *
 * TOML text in and out, rather than a parsed object, so the store stays a dumb
 * byte channel and the one place that understands the format is the codec. It
 * also means unrecognised keys survive a round trip, which matters: these files
 * hold things this app does not own.
 */
export interface SettingsStore {
  readonly id: string
  /**
   * Human-readable location, shown so someone can find and edit the file.
   *
   * A signal because on desktop the path comes from the main process, and the
   * store has to exist before that round trip finishes.
   */
  readonly location: ReadonlySignal<string>
  /** Null when nothing has been stored yet. */
  read(): Promise<string | null>
  write(text: string): Promise<void>
  /**
   * Notice changes made outside this app. Returns a disposer.
   *
   * Optional, because not every platform can answer: a store that cannot watch
   * simply leaves an external edit to be picked up on the next start. Where it
   * is implemented, the listener is only called for edits this app did not make
   * — telling a save apart from its own echo is the store's job, since the store
   * is what performed the write.
   */
  watch?(listener: (text: string | null) => void): () => void
}

const bySectionOrder = (
  inputs: readonly SettingsSection[]
): SettingsSection[] => {
  const seen = new Set<string>()
  return [...inputs]
    .filter((section) => {
      if (seen.has(section.id)) return false
      seen.add(section.id)
      return true
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}

const bySettingOrder = (inputs: readonly AnySetting[]): AnySetting[] => {
  const seen = new Set<string>()
  return [...inputs]
    .filter((setting) => {
      if (seen.has(setting.id)) return false
      seen.add(setting.id)
      return true
    })
    .sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title)
    )
}

/**
 * Settings, contributed.
 *
 * A setting belongs to the feature whose behaviour it changes — the engine owns
 * the camera settings, the theme owns the theme — so nothing has to maintain a
 * central tree of every preference in the app. What the settings feature owns is
 * only the cascade and the surface that draws it.
 */
export const settingsContract = defineContract({
  settingsValueSpec: defineValueSpec<AnySetting, AnySetting[]>({
    name: 'settings.definitions',
    defaultValue: [],
    combine: bySettingOrder,
  }),
  settingsSectionsValueSpec: defineValueSpec<
    SettingsSection,
    SettingsSection[]
  >({
    name: 'settings.sections',
    defaultValue: [],
    combine: bySectionOrder,
  }),
  settingsService: defineService<SettingsService>('settings.service'),
  /** Where user-level overrides live. Platform-specific, hence a service. */
  userSettingsStoreService: defineService<SettingsStore>('settings.userStore'),
})

export const {
  settingsValueSpec,
  settingsSectionsValueSpec,
  settingsService,
  userSettingsStoreService,
} = settingsContract

/** Identity, with the types filled in. Purely for readable call sites. */
export function defineSetting<T>(
  definition: SettingDefinition<T>
): SettingDefinition<T> {
  return definition
}

/** A checkbox. */
export function booleanSetting(
  definition: Omit<SettingDefinition<boolean>, 'control' | 'parse'>
): SettingDefinition<boolean> {
  return {
    ...definition,
    control: { kind: 'boolean' },
    parse: (raw) => (typeof raw === 'boolean' ? raw : undefined),
  }
}

/**
 * A fixed set of choices.
 *
 * `parse` validates against the option list rather than against a type
 * assertion, so a value that was legal in an older release and is not legal now
 * gets rejected instead of quietly poisoning the setting.
 */
export function optionsSetting<T extends string>(
  definition: Omit<SettingDefinition<T>, 'control' | 'parse'> & {
    options: readonly { value: T; label: string; hint?: string }[]
  }
): SettingDefinition<T> {
  const { options, ...rest } = definition
  return {
    ...rest,
    control: { kind: 'options', options },
    parse: (raw) =>
      typeof raw === 'string' && options.some((option) => option.value === raw)
        ? (raw as T)
        : undefined,
  }
}

export function numberSetting(
  definition: Omit<SettingDefinition<number>, 'control' | 'parse'> & {
    min?: number
    max?: number
    step?: number
    unit?: string
  }
): SettingDefinition<number> {
  const { min, max, step, unit, ...rest } = definition
  return {
    ...rest,
    control: { kind: 'number', min, max, step, unit },
    parse: (raw) => {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
      if (min !== undefined && raw < min) return undefined
      if (max !== undefined && raw > max) return undefined
      return raw
    },
  }
}

export function textSetting(
  definition: Omit<SettingDefinition<string>, 'control' | 'parse'> & {
    placeholder?: string
    validate?: (value: string) => boolean
  }
): SettingDefinition<string> {
  const { placeholder, validate, ...rest } = definition
  return {
    ...rest,
    control: { kind: 'text', placeholder },
    parse: (raw) => {
      if (typeof raw !== 'string') return undefined
      return validate && !validate(raw) ? undefined : raw
    },
  }
}

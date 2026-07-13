import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import type { JsonValue } from '@rust/kcl-lib/bindings/serde_json/JsonValue'
import {
  kclSettings,
  changeKclVersion,
  serializeConfiguration,
  serializeProjectConfiguration,
} from '@src/lang/wasm'
import {
  cameraSystemToMouseControl,
  mouseControlsToCameraSystem,
} from '@src/lib/cameraControls'
import {
  LEGACY_KCL_VERSION,
  PROJECT_ENTRYPOINT,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import {
  getInitialDefaultDir,
  readAppSettingsFile,
  readProjectSettingsFile,
  writeAppSettingsFile,
  writeProjectSettingsFile,
} from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { isDesktop } from '@src/lib/isDesktop'
import type {
  LayoutWithMetadata,
  LayoutsWithMetadata,
} from '@src/lib/layout/types'
import {
  createLayoutWithMetadata,
  parseLayoutJsonWithMigrations,
  parseLayoutWithMigrations,
} from '@src/lib/layout/utils'
import type { ResolvedExtensionSettings } from '@src/lib/settings/extensionSettings'
import {
  Setting,
  type SettingsType,
  createSettings,
} from '@src/lib/settings/initialSettings'
import type {
  SaveSettingsPayload,
  SettingsLevel,
} from '@src/lib/settings/settingsTypes'
import { appThemeToTheme } from '@src/lib/theme'
import { err, isErr } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import decamelize from 'decamelize'
import { NIL as uuidNIL, v4 } from 'uuid'

const INITIALISM_MAPPING: Record<string, string> = {
  api: 'API',
  id: 'ID',
  kcl: 'KCL',
  ui: 'UI',
  url: 'URL',
}

export function formatSettingsLabel(key: string): string {
  return decamelize(key, { separator: ' ' })
    .split(' ')
    .map((word) =>
      word in INITIALISM_MAPPING ? INITIALISM_MAPPING[word] : word
    )
    .join(' ')
}

type OmitNull<T> = T extends null ? undefined : T
const toUndefinedIfNull = <T>(a: T): OmitNull<T> =>
  (a === null ? undefined : a) as OmitNull<T>

function compactRecord<T extends Record<string, unknown>>(
  value: T
): Partial<T> | undefined {
  const compacted = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>

  return Object.keys(compacted).length > 0 ? compacted : undefined
}

type TomlJsonObject = { [key: string]: JsonValue }

function asTomlJsonObject(value: unknown): TomlJsonObject | undefined {
  if (!value || typeof value !== 'object' || isArray(value)) {
    return undefined
  }

  return value as TomlJsonObject
}

function getTomlSettingsSection(
  settings: unknown,
  key: string
): TomlJsonObject | undefined {
  const settingsObject = asTomlJsonObject(settings)
  return asTomlJsonObject(settingsObject?.[key])
}

type AppOnlySettingsFieldSelector = {
  category: keyof SaveSettingsPayload
  field: string
}

type AppOnlySettingCodec = {
  fromToml: (value: JsonValue | undefined) => unknown
  toToml: (value: unknown) => JsonValue | undefined
}

type AppOnlySettingsFieldDefinition = {
  selector: AppOnlySettingsFieldSelector
  tomlKey: string
  codec: AppOnlySettingCodec
}

type AppOnlySettingsSectionDefinition = {
  sectionKey: string
  fields: readonly AppOnlySettingsFieldDefinition[]
}

function getSettingsPayloadFieldValue(
  payload: DeepPartial<SaveSettingsPayload>,
  selector: AppOnlySettingsFieldSelector
): unknown {
  const payloadRecord = payload as Record<string, Record<string, unknown>>
  return payloadRecord[selector.category]?.[selector.field]
}

function setSettingsPayloadFieldValue(
  payload: DeepPartial<SaveSettingsPayload>,
  selector: AppOnlySettingsFieldSelector,
  value: unknown
) {
  const payloadRecord = payload as Record<string, Record<string, unknown>>
  payloadRecord[selector.category] = {
    ...(payloadRecord[selector.category] ?? {}),
    [selector.field]: value,
  }
}

function defineAppOnlySection(
  sectionKey: string,
  fields: readonly AppOnlySettingsFieldDefinition[]
): AppOnlySettingsSectionDefinition {
  return { sectionKey, fields }
}

function defineAppOnlyField(
  selector: AppOnlySettingsFieldSelector,
  tomlKey: string,
  codec: AppOnlySettingCodec
): AppOnlySettingsFieldDefinition {
  return { selector, tomlKey, codec }
}

function defineBooleanAppOnlyField(
  selector: AppOnlySettingsFieldSelector,
  tomlKey: string
): AppOnlySettingsFieldDefinition {
  return defineAppOnlyField(selector, tomlKey, {
    fromToml: (value) => (typeof value === 'boolean' ? value : undefined),
    toToml: (value) => (typeof value === 'boolean' ? value : undefined),
  })
}

function defineNumberAppOnlyField(
  selector: AppOnlySettingsFieldSelector,
  tomlKey: string
): AppOnlySettingsFieldDefinition {
  return defineAppOnlyField(selector, tomlKey, {
    fromToml: (value) => (typeof value === 'number' ? value : undefined),
    toToml: (value) => (typeof value === 'number' ? value : undefined),
  })
}

function defineStringAppOnlyField(
  selector: AppOnlySettingsFieldSelector,
  tomlKey: string
): AppOnlySettingsFieldDefinition {
  return defineAppOnlyField(selector, tomlKey, {
    fromToml: (value) => (typeof value === 'string' ? value : undefined),
    toToml: (value) => (typeof value === 'string' ? value : undefined),
  })
}

function defineMappedAppOnlyField(
  selector: AppOnlySettingsFieldSelector,
  tomlKey: string,
  codec: AppOnlySettingCodec
): AppOnlySettingsFieldDefinition {
  return defineAppOnlyField(selector, tomlKey, codec)
}

function parseLayoutSettingValue(value: unknown): LayoutWithMetadata | Error {
  if (typeof value === 'string') {
    return parseLayoutJsonWithMigrations(value)
  }

  return parseLayoutWithMigrations(value)
}

function defineLayoutsAppOnlyField(
  selector: AppOnlySettingsFieldSelector,
  tomlKey: string
): AppOnlySettingsFieldDefinition {
  return defineAppOnlyField(selector, tomlKey, {
    fromToml: (value) => {
      const layoutsValue =
        typeof value === 'string'
          ? (() => {
              try {
                return JSON.parse(value)
              } catch {
                return undefined
              }
            })()
          : value
      if (!layoutsValue || typeof layoutsValue !== 'object') {
        return undefined
      }

      const layouts = Object.entries(layoutsValue).reduce<LayoutsWithMetadata>(
        (parsedLayouts, [name, layoutValue]) => {
          const parsed = parseLayoutSettingValue(layoutValue)
          if (!err(parsed)) {
            parsedLayouts[name] = parsed
          }
          return parsedLayouts
        },
        {}
      )

      return Object.keys(layouts).length > 0 ? layouts : undefined
    },
    toToml: (value) => {
      if (!value || typeof value !== 'object') {
        return undefined
      }

      const layouts = Object.entries(value).reduce<Record<string, string>>(
        (serializedLayouts, [name, layoutValue]) => {
          if (
            !layoutValue ||
            typeof layoutValue !== 'object' ||
            !('layout' in layoutValue) ||
            !layoutValue.layout
          ) {
            return serializedLayouts
          }

          const layoutWithMetadata =
            'version' in layoutValue && typeof layoutValue.version === 'string'
              ? (layoutValue as LayoutWithMetadata)
              : createLayoutWithMetadata(
                  layoutValue.layout as LayoutWithMetadata['layout']
                )
          serializedLayouts[name] = JSON.stringify(layoutWithMetadata)
          return serializedLayouts
        },
        {}
      )

      return Object.keys(layouts).length > 0 ? layouts : undefined
    },
  })
}

function readAppOnlySettingsPayload(
  settings: unknown,
  sections: readonly AppOnlySettingsSectionDefinition[]
): DeepPartial<SaveSettingsPayload> {
  const payload = {} as DeepPartial<SaveSettingsPayload>

  for (const sectionDef of sections) {
    const section = getTomlSettingsSection(settings, sectionDef.sectionKey)

    for (const fieldDef of sectionDef.fields) {
      const value = fieldDef.codec.fromToml(section?.[fieldDef.tomlKey])
      if (value !== undefined) {
        setSettingsPayloadFieldValue(payload, fieldDef.selector, value)
      }
    }
  }

  return payload
}

function writeAppOnlySettingsSections(
  payload: DeepPartial<SaveSettingsPayload>,
  sections: readonly AppOnlySettingsSectionDefinition[]
): Partial<Record<string, TomlJsonObject>> {
  return Object.fromEntries(
    sections
      .map((sectionDef) => {
        const section = compactRecord(
          Object.fromEntries(
            sectionDef.fields.map((fieldDef) => [
              fieldDef.tomlKey,
              fieldDef.codec.toToml(
                getSettingsPayloadFieldValue(payload, fieldDef.selector)
              ),
            ])
          )
        ) as TomlJsonObject | undefined

        return section ? [sectionDef.sectionKey, section] : undefined
      })
      .filter((entry) => entry !== undefined)
      .map((entry) => entry as [string, TomlJsonObject])
  )
}

function readExtensionSettingsPayload(
  settings: unknown,
  extensionSettings: ResolvedExtensionSettings,
  level: 'user' | 'project'
): DeepPartial<SaveSettingsPayload> {
  const payload = {} as DeepPartial<SaveSettingsPayload>
  const payloadRecord = payload as Record<string, Record<string, unknown>>

  for (const [category, settingDefs] of Object.entries(extensionSettings)) {
    for (const [settingName, definition] of Object.entries(settingDefs)) {
      const binding =
        level === 'user' ? definition.userToml : definition.projectToml
      if (!binding) {
        continue
      }

      const section = getTomlSettingsSection(settings, binding.sectionKey)
      const value = binding.fromToml(section?.[binding.tomlKey])
      if (value === undefined) {
        continue
      }

      if (!payloadRecord[category]) {
        payloadRecord[category] = {}
      }

      payloadRecord[category][settingName] = value
    }
  }

  return payload
}

function writeExtensionSettingsSections(
  payload: DeepPartial<SaveSettingsPayload>,
  extensionSettings: ResolvedExtensionSettings,
  level: 'user' | 'project'
): Partial<Record<string, TomlJsonObject>> {
  const groupedSections = new Map<string, TomlJsonObject>()
  const payloadRecord = payload as Record<string, Record<string, unknown>>

  for (const [category, settingDefs] of Object.entries(extensionSettings)) {
    for (const [settingName, definition] of Object.entries(settingDefs)) {
      const binding =
        level === 'user' ? definition.userToml : definition.projectToml
      if (!binding) {
        continue
      }

      const categoryValues = payloadRecord[category]
      const value = binding.toToml(categoryValues?.[settingName])
      if (value === undefined) {
        continue
      }

      const section = groupedSections.get(binding.sectionKey) ?? {}
      section[binding.tomlKey] = value
      groupedSections.set(binding.sectionKey, section)
    }
  }

  return Object.fromEntries(groupedSections.entries())
}

function mergeSettingsPayloads(
  ...payloads: DeepPartial<SaveSettingsPayload>[]
): DeepPartial<SaveSettingsPayload> {
  return payloads.reduce(
    (merged, payload) => {
      const mergedRecord = merged as Record<string, Record<string, unknown>>
      for (const [category, value] of Object.entries(payload)) {
        if (!value) {
          continue
        }

        mergedRecord[category] = {
          ...(mergedRecord[category] ?? {}),
          ...(value as Record<string, unknown>),
        }
      }

      return merged
    },
    {} as DeepPartial<SaveSettingsPayload>
  )
}

function mergeTomlSections(
  ...sections: (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined {
  return compactRecord(
    Object.assign({}, ...sections.filter((section) => section !== undefined))
  )
}

function mergeSettingsSectionMaps(
  ...sectionMaps: Partial<Record<string, TomlJsonObject>>[]
): Partial<Record<string, TomlJsonObject>> {
  const merged = new Map<string, TomlJsonObject>()

  for (const sectionMap of sectionMaps) {
    for (const [sectionKey, sectionValue] of Object.entries(sectionMap)) {
      merged.set(sectionKey, {
        ...(merged.get(sectionKey) ?? {}),
        ...sectionValue,
      })
    }
  }

  return Object.fromEntries(merged.entries())
}

// App-owned settings sections are serialized through Rust as opaque TOML
// sections or flattened fields so the app can evolve them without expanding
// the CLI/KCL schema. This registry is the migration path for future
// plugin-owned settings bundles as well.
const USER_APP_ONLY_SETTINGS_SECTIONS = [
  defineAppOnlySection('app', [
    defineStringAppOnlyField(
      { category: 'app', field: 'onboardingStatus' },
      'onboarding_status'
    ),
    defineBooleanAppOnlyField(
      { category: 'app', field: 'allowOrbitInSketchMode' },
      'allow_orbit_in_sketch_mode'
    ),
    defineBooleanAppOnlyField(
      { category: 'app', field: 'machineApi' },
      'machine_api'
    ),
    defineBooleanAppOnlyField(
      { category: 'app', field: 'showAllFiles' },
      'show_all_files'
    ),
  ]),
  defineAppOnlySection('debug', [
    defineBooleanAppOnlyField(
      { category: 'debug', field: 'showPanel' },
      'show_panel'
    ),
    defineBooleanAppOnlyField(
      { category: 'debug', field: 'showModelingMachineState' },
      'show_modeling_machine_state'
    ),
  ]),
  defineAppOnlySection('modeling', [
    defineMappedAppOnlyField(
      { category: 'modeling', field: 'mouseControls' },
      'mouse_controls',
      {
        fromToml: (value) =>
          typeof value === 'string'
            ? mouseControlsToCameraSystem(value as never)
            : undefined,
        toToml: (value) =>
          typeof value === 'string'
            ? cameraSystemToMouseControl(value as never)
            : undefined,
      }
    ),
    defineStringAppOnlyField(
      { category: 'modeling', field: 'gizmoType' },
      'gizmo_type'
    ),
    defineBooleanAppOnlyField(
      { category: 'modeling', field: 'enableTouchControls' },
      'enable_touch_controls'
    ),
    defineBooleanAppOnlyField(
      { category: 'modeling', field: 'useSketchSolveMode' },
      'use_sketch_solve_mode'
    ),
    defineBooleanAppOnlyField(
      { category: 'modeling', field: 'snapToGrid' },
      'snap_to_grid'
    ),
    defineNumberAppOnlyField(
      { category: 'modeling', field: 'majorGridSpacing' },
      'major_grid_spacing'
    ),
    defineNumberAppOnlyField(
      { category: 'modeling', field: 'minorGridsPerMajor' },
      'minor_grids_per_major'
    ),
    defineNumberAppOnlyField(
      { category: 'modeling', field: 'snapsPerMinor' },
      'snaps_per_minor'
    ),
  ]),
  defineAppOnlySection('project', [
    defineStringAppOnlyField(
      { category: 'app', field: 'projectDirectory' },
      'directory'
    ),
    defineStringAppOnlyField(
      { category: 'projects', field: 'defaultProjectName' },
      'default_project_name'
    ),
  ]),
  defineAppOnlySection('command_bar', [
    defineBooleanAppOnlyField(
      { category: 'commandBar', field: 'includeSettings' },
      'include_settings'
    ),
  ]),
  defineAppOnlySection('text_editor', [
    defineBooleanAppOnlyField(
      { category: 'textEditor', field: 'textWrapping' },
      'text_wrapping'
    ),
    defineBooleanAppOnlyField(
      { category: 'textEditor', field: 'blinkingCursor' },
      'blinking_cursor'
    ),
  ]),
  defineAppOnlySection('layout', [
    defineLayoutsAppOnlyField(
      { category: 'layout', field: 'configs' },
      'configs'
    ),
  ]),
] as const

const PROJECT_APP_ONLY_SETTINGS_SECTIONS = [
  defineAppOnlySection('app', [
    defineStringAppOnlyField(
      { category: 'app', field: 'onboardingStatus' },
      'onboarding_status'
    ),
    defineBooleanAppOnlyField(
      { category: 'app', field: 'allowOrbitInSketchMode' },
      'allow_orbit_in_sketch_mode'
    ),
  ]),
  defineAppOnlySection('debug', [
    defineBooleanAppOnlyField(
      { category: 'debug', field: 'showPanel' },
      'show_panel'
    ),
    defineBooleanAppOnlyField(
      { category: 'debug', field: 'showModelingMachineState' },
      'show_modeling_machine_state'
    ),
  ]),
  defineAppOnlySection('modeling', [
    defineBooleanAppOnlyField(
      { category: 'modeling', field: 'snapToGrid' },
      'snap_to_grid'
    ),
    defineNumberAppOnlyField(
      { category: 'modeling', field: 'majorGridSpacing' },
      'major_grid_spacing'
    ),
    defineNumberAppOnlyField(
      { category: 'modeling', field: 'minorGridsPerMajor' },
      'minor_grids_per_major'
    ),
    defineNumberAppOnlyField(
      { category: 'modeling', field: 'snapsPerMinor' },
      'snaps_per_minor'
    ),
  ]),
  defineAppOnlySection('command_bar', [
    defineBooleanAppOnlyField(
      { category: 'commandBar', field: 'includeSettings' },
      'include_settings'
    ),
  ]),
  defineAppOnlySection('text_editor', [
    defineBooleanAppOnlyField(
      { category: 'textEditor', field: 'textWrapping' },
      'text_wrapping'
    ),
    defineBooleanAppOnlyField(
      { category: 'textEditor', field: 'blinkingCursor' },
      'blinking_cursor'
    ),
  ]),
] as const

/**
 * Convert from a rust settings struct into the JS settings struct.
 * We do this because the JS settings type has all the fancy shit
 * for hiding and showing settings.
 **/
export function configurationToSettingsPayload(
  configuration: DeepPartial<Configuration>,
  extensionSettings: ResolvedExtensionSettings = {}
): DeepPartial<SaveSettingsPayload> {
  return mergeSettingsPayloads(
    {
      app: {
        theme: configuration?.settings?.app?.appearance?.theme
          ? appThemeToTheme(configuration?.settings?.app?.appearance?.theme)
          : undefined,
        streamIdleMode: toUndefinedIfNull(
          configuration?.settings?.app?.stream_idle_mode
        ),
      },
      modeling: {
        defaultUnit: toUndefinedIfNull(
          configuration?.settings?.modeling?.base_unit
        ),
        cameraProjection: toUndefinedIfNull(
          configuration?.settings?.modeling?.camera_projection
        ),
        cameraOrbit: toUndefinedIfNull(
          configuration?.settings?.modeling?.camera_orbit
        ),
        highlightEdges: toUndefinedIfNull(
          configuration?.settings?.modeling?.highlight_edges
        ),
        enableSSAO: toUndefinedIfNull(
          configuration?.settings?.modeling?.enable_ssao
        ),
        backfaceColor: toUndefinedIfNull(
          configuration?.settings?.modeling?.backface_color
        ),
        showScaleGrid: toUndefinedIfNull(
          configuration?.settings?.modeling?.show_scale_grid
        ),
        fixedSizeGrid: toUndefinedIfNull(
          configuration?.settings?.modeling?.fixed_size_grid
        ),
      },
    },
    readAppOnlySettingsPayload(
      configuration?.settings,
      USER_APP_ONLY_SETTINGS_SECTIONS
    ),
    readExtensionSettingsPayload(
      configuration?.settings,
      extensionSettings,
      'user'
    )
  )
}

export function settingsPayloadToConfiguration(
  configuration: DeepPartial<SaveSettingsPayload>,
  extensionSettings: ResolvedExtensionSettings = {}
): DeepPartial<Configuration> {
  const appearance = compactRecord({
    theme: toUndefinedIfNull(configuration?.app?.theme),
  })

  const typedAppSection = compactRecord({
    appearance,
    stream_idle_mode: toUndefinedIfNull(configuration?.app?.streamIdleMode),
  })

  const typedModelingSection = compactRecord({
    base_unit: toUndefinedIfNull(configuration?.modeling?.defaultUnit),
    camera_projection: toUndefinedIfNull(
      configuration?.modeling?.cameraProjection
    ),
    camera_orbit: toUndefinedIfNull(configuration?.modeling?.cameraOrbit),
    highlight_edges: toUndefinedIfNull(configuration?.modeling?.highlightEdges),
    enable_ssao: toUndefinedIfNull(configuration?.modeling?.enableSSAO),
    backface_color: toUndefinedIfNull(configuration?.modeling?.backfaceColor),
    show_scale_grid: toUndefinedIfNull(configuration?.modeling?.showScaleGrid),
    fixed_size_grid: toUndefinedIfNull(configuration?.modeling?.fixedSizeGrid),
  })

  const appOnlySections = mergeSettingsSectionMaps(
    writeAppOnlySettingsSections(
      configuration,
      USER_APP_ONLY_SETTINGS_SECTIONS
    ),
    writeExtensionSettingsSections(configuration, extensionSettings, 'user')
  )

  const settings = compactRecord({
    ...appOnlySections,
    app: mergeTomlSections(appOnlySections.app, typedAppSection) as
      | TomlJsonObject
      | undefined,
    modeling: mergeTomlSections(
      appOnlySections.modeling,
      typedModelingSection
    ) as TomlJsonObject | undefined,
  })

  return {
    ...(settings ? { settings } : {}),
  }
}

export function isNamedView(
  namedView: DeepPartial<NamedView> | undefined
): namedView is NamedView {
  const namedViewKeys = [
    'name',
    'eye_offset',
    'fov_y',
    'ortho_scale_enabled',
    'ortho_scale_factor',
    'pivot_position',
    'pivot_rotation',
    'world_coord_system',
    'version',
  ] as const

  return namedViewKeys.every((key) => {
    return namedView && key in namedView
  })
}

function deepPartialNamedViewsToNamedViews(
  maybeViews: { [key: string]: NamedView | undefined } | undefined
): { [key: string]: NamedView } {
  const namedViews: { [key: string]: NamedView } = {}

  if (!maybeViews) {
    return namedViews
  }

  for (const [key, maybeView] of Object.entries(maybeViews)) {
    if (isNamedView(maybeView)) {
      namedViews[key] = maybeView
    }
  }
  return namedViews
}

export function projectConfigurationToSettingsPayload(
  configuration: DeepPartial<ProjectConfiguration>,
  extensionSettings: ResolvedExtensionSettings = {}
): DeepPartial<SaveSettingsPayload> {
  return mergeSettingsPayloads(
    {
      meta: {
        id: configuration?.settings?.meta?.id,
      },
      app: {
        namedViews: deepPartialNamedViewsToNamedViews(
          configuration?.settings?.app?.named_views
        ),
        zookeeperMode: (() => {
          const v = configuration?.settings?.app?.zookeeper_mode
          return typeof v === 'string' && v.length > 0 ? v : undefined
        })(),
      },
      modeling: {
        defaultUnit: configuration?.settings?.modeling?.base_unit ?? undefined,
        kclVersion: configuration?.settings?.modeling?.kcl_version ?? undefined,
        highlightEdges: configuration?.settings?.modeling?.highlight_edges,
        enableSSAO: configuration?.settings?.modeling?.enable_ssao,
        fixedSizeGrid: toUndefinedIfNull(
          configuration?.settings?.modeling?.fixed_size_grid
        ),
      },
    },
    readAppOnlySettingsPayload(
      configuration?.settings,
      PROJECT_APP_ONLY_SETTINGS_SECTIONS
    ),
    readExtensionSettingsPayload(
      configuration?.settings,
      extensionSettings,
      'project'
    )
  )
}

export function settingsPayloadToProjectConfiguration(
  configuration: DeepPartial<SaveSettingsPayload>,
  extensionSettings: ResolvedExtensionSettings = {}
): DeepPartial<ProjectConfiguration> {
  const namedViews = deepPartialNamedViewsToNamedViews(
    configuration?.app?.namedViews
  )

  const meta = compactRecord({
    id: configuration?.meta?.id,
  })

  const typedAppSection = compactRecord({
    zookeeper_mode: configuration?.app?.zookeeperMode,
    named_views: Object.keys(namedViews).length > 0 ? namedViews : undefined,
  })

  const typedModelingSection = compactRecord({
    base_unit: configuration?.modeling?.defaultUnit,
    kcl_version: configuration?.modeling?.kclVersion,
    highlight_edges: configuration?.modeling?.highlightEdges,
    enable_ssao: configuration?.modeling?.enableSSAO,
    fixed_size_grid: configuration?.modeling?.fixedSizeGrid,
  })

  const appOnlySections = mergeSettingsSectionMaps(
    writeAppOnlySettingsSections(
      configuration,
      PROJECT_APP_ONLY_SETTINGS_SECTIONS
    ),
    writeExtensionSettingsSections(configuration, extensionSettings, 'project')
  )

  const settings = compactRecord({
    meta,
    ...appOnlySections,
    app: mergeTomlSections(appOnlySections.app, typedAppSection) as
      | TomlJsonObject
      | undefined,
    modeling: mergeTomlSections(
      appOnlySections.modeling,
      typedModelingSection
    ) as TomlJsonObject | undefined,
  })

  return {
    ...(settings ? { settings } : {}),
  }
}

export function mergeProjectConfiguration(
  existingConfiguration: DeepPartial<ProjectConfiguration>,
  updatedConfiguration: DeepPartial<ProjectConfiguration>
): DeepPartial<ProjectConfiguration> {
  const existingSettings =
    asTomlJsonObject(existingConfiguration.settings) ?? {}
  const updatedSettings = asTomlJsonObject(updatedConfiguration.settings) ?? {}
  const settings = compactRecord({
    ...existingSettings,
    ...updatedSettings,
    meta: mergeTomlSections(
      asTomlJsonObject(existingConfiguration.settings?.meta),
      asTomlJsonObject(updatedConfiguration.settings?.meta)
    ),
    app: mergeTomlSections(
      asTomlJsonObject(existingConfiguration.settings?.app),
      asTomlJsonObject(updatedConfiguration.settings?.app)
    ),
    modeling: mergeTomlSections(
      asTomlJsonObject(existingConfiguration.settings?.modeling),
      asTomlJsonObject(updatedConfiguration.settings?.modeling)
    ),
  }) as DeepPartial<ProjectConfiguration>['settings']

  return {
    ...existingConfiguration,
    ...updatedConfiguration,
    settings,
  }
}

export function replaceProjectSettingsPreservingMetadata(
  existingConfiguration: DeepPartial<ProjectConfiguration>,
  updatedConfiguration: DeepPartial<ProjectConfiguration>
): DeepPartial<ProjectConfiguration> {
  const updatedSettings = asTomlJsonObject(updatedConfiguration.settings)
  const meta = mergeTomlSections(
    asTomlJsonObject(existingConfiguration.settings?.meta),
    asTomlJsonObject(updatedConfiguration.settings?.meta)
  )

  const settings = compactRecord({
    ...updatedSettings,
    meta,
  }) as DeepPartial<ProjectConfiguration>['settings'] | undefined

  return {
    ...existingConfiguration,
    settings,
  }
}

function setProjectConfigurationId(
  projectConfiguration: DeepPartial<ProjectConfiguration>,
  id: string
): DeepPartial<ProjectConfiguration> {
  return mergeProjectConfiguration(projectConfiguration, {
    settings: {
      meta: {
        id,
      },
    },
  })
}

function setProjectConfigurationKclVersion(
  projectConfiguration: DeepPartial<ProjectConfiguration>,
  kclVersion: string
): DeepPartial<ProjectConfiguration> {
  return mergeProjectConfiguration(projectConfiguration, {
    settings: {
      modeling: {
        kcl_version: kclVersion,
      },
    },
  })
}

async function resolveProjectEntrypointPath(
  projectPath: string
): Promise<string> {
  const projectTomlPath = fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  try {
    const projectToml = await fsZds.readFile(projectTomlPath, {
      encoding: 'utf-8',
    })
    const defaultFileMatch = projectToml.match(
      /^\s*default_file\s*=\s*(".*?")/m
    )
    if (defaultFileMatch) {
      const defaultFile = JSON.parse(defaultFileMatch[1]) as string
      if (defaultFile) {
        return fsZds.join(projectPath, defaultFile)
      }
    }
  } catch {
    // Fall through to the project entrypoint.
  }
  return fsZds.join(projectPath, PROJECT_ENTRYPOINT)
}

async function readKclVersionFromEntrypoint(
  projectPath: string,
  wasmInstance: ModuleType
): Promise<string | undefined> {
  const entrypointPath = await resolveProjectEntrypointPath(projectPath)
  try {
    const code = await fsZds.readFile(entrypointPath, { encoding: 'utf-8' })
    const settings = kclSettings(code, wasmInstance)
    if (isErr(settings) || !settings) {
      return undefined
    }
    const version = settings.kclVersion
    if (typeof version === 'string' && version.length > 0) {
      return version
    }
  } catch {
    // Missing or unreadable entrypoint — treat as no file-level version.
  }
  return undefined
}

/**
 * Keep the entrypoint file's `@settings(kclVersion)` in sync with the project
 * setting. Only updates when the entrypoint already declares a kclVersion, and
 * only writes when the file content would change.
 */
export async function syncKclVersionToEntrypoint(
  projectPath: string,
  kclVersion: string,
  wasmInstance: ModuleType
): Promise<void> {
  const entrypointPath = await resolveProjectEntrypointPath(projectPath)
  let code = ''
  try {
    code = await fsZds.readFile(entrypointPath, { encoding: 'utf-8' })
  } catch {
    // Missing entrypoint — nothing to sync.
    return
  }

  const settings = kclSettings(code, wasmInstance)
  const existingVersion =
    !isErr(settings) && settings && typeof settings.kclVersion === 'string'
      ? settings.kclVersion
      : undefined
  if (!existingVersion) {
    // Do not introduce `@settings(kclVersion)` if the file does not already
    // have one; project.toml is the source of truth in that case.
    return
  }

  const updated = changeKclVersion(code, kclVersion, wasmInstance)
  if (isErr(updated) || updated === code) {
    return
  }

  await fsZds.writeFile(entrypointPath, new TextEncoder().encode(updated))
}

export interface AppSettings {
  settings: SettingsType
  configuration: DeepPartial<Configuration>
}

/**
 * Finds the TOML settings files for user-level (and project-level if projectPath is provided)
 * settings, deserialize them and validate them, serialize and write the validated TOML back to the locations,
 * and return the settings object and the raw "configuration" object returned from WASM.
 *
 * Relies on WASM for TOML de/serialization.
 */
export async function loadAndValidateSettings(
  initPromise: Promise<ModuleType> | ModuleType,
  projectPathOrOptions:
    | string
    | {
        extensionSettings?: ResolvedExtensionSettings
        projectPath?: string
      }
    | undefined = {}
): Promise<AppSettings> {
  const options =
    typeof projectPathOrOptions === 'string'
      ? { projectPath: projectPathOrOptions }
      : projectPathOrOptions
  const { extensionSettings = {}, projectPath } = options
  // Make sure we have wasm initialized.
  const wasmInstance = await initPromise

  // Load the app settings from the file system or localStorage.
  const appSettingsPayload = await readAppSettingsFile(wasmInstance)

  if (err(appSettingsPayload)) {
    return Promise.reject(appSettingsPayload)
  }

  let settingsNext = createSettings(extensionSettings)

  settingsNext.app.projectDirectory.default = await getInitialDefaultDir()

  settingsNext = setSettingsAtLevel(
    settingsNext,
    'user',
    configurationToSettingsPayload(appSettingsPayload, extensionSettings)
  )

  // Load the project settings if they exist
  if (projectPath) {
    let projectSettings = await readProjectSettingsFile(
      projectPath,
      wasmInstance
    )

    if (err(projectSettings)) {
      return Promise.reject(new Error('Invalid project settings'))
    }

    let projectSettingsDirty = false
    if (
      !projectSettings.settings?.meta?.id ||
      projectSettings.settings.meta.id === uuidNIL
    ) {
      projectSettings = setProjectConfigurationId(projectSettings, v4())
      projectSettingsDirty = true
    }

    // Migrate project-level KCL version from main.kcl (or assume legacy 1.0).
    let projectKclVersion = projectSettings.settings?.modeling?.kcl_version
    if (!projectKclVersion) {
      projectKclVersion =
        (await readKclVersionFromEntrypoint(projectPath, wasmInstance)) ??
        LEGACY_KCL_VERSION
      projectSettings = setProjectConfigurationKclVersion(
        projectSettings,
        projectKclVersion
      )
      projectSettingsDirty = true
    }

    if (projectSettingsDirty) {
      const projectTomlString = serializeProjectConfiguration(
        projectSettings,
        wasmInstance
      )
      if (err(projectTomlString)) {
        return Promise.reject(
          new Error('Could not serialize project configuration')
        )
      }
      await writeProjectSettingsFile(projectPath, projectTomlString)
    }

    // Keep main.kcl `@settings(kclVersion)` aligned if the entrypoint already has one.
    await syncKclVersionToEntrypoint(
      projectPath,
      projectKclVersion,
      wasmInstance
    )

    const projectSettingsPayload = projectSettings
    settingsNext = setSettingsAtLevel(
      settingsNext,
      'project',
      projectConfigurationToSettingsPayload(
        projectSettingsPayload,
        extensionSettings
      )
    )
  }

  // Resolve all async hideOnPlatform values before returning
  // This makes everything synchronous from this point on
  await resolveAsyncHideOnPlatform(settingsNext)

  // Return the settings object
  return {
    settings: settingsNext,
    configuration: appSettingsPayload,
  }
}

/**
 * Resolves all async hideOnPlatform functions in settings and replaces them with resolved values.
 * This is called once during settings loading to make everything synchronous afterward.
 */
async function resolveAsyncHideOnPlatform(
  settings: SettingsType
): Promise<void> {
  const settingsToResolve: Array<{ setting: Setting<unknown> }> = []

  // Collect all settings with async hideOnPlatform functions
  for (const categorySettings of Object.values(settings)) {
    for (const setting of Object.values(categorySettings)) {
      if (
        setting instanceof Setting &&
        typeof setting.hideOnPlatform === 'function'
      ) {
        settingsToResolve.push({ setting })
      }
    }
  }

  if (settingsToResolve.length === 0) {
    return
  }

  // Resolve all async hideOnPlatform values in parallel
  await Promise.all(
    settingsToResolve.map(async ({ setting }) => {
      const hideOnPlatform = setting.hideOnPlatform
      if (typeof hideOnPlatform === 'function') {
        try {
          const resolved = await hideOnPlatform()
          // Replace the function with the resolved value
          // Convert null to undefined since the type doesn't allow null
          setting.hideOnPlatform = resolved === null ? undefined : resolved
        } catch (error) {
          console.error('Error resolving hideOnPlatform:', error)
          // Default to hidden on error
          setting.hideOnPlatform = 'both'
        }
      }
    })
  )
}

/**
 * Given a settings object, serialize it to TOML
 * and write it to the appropriate location.
 *
 * Relies on WASM for TOML serialization.
 */
export async function saveSettings(
  initPromise: Promise<ModuleType>,
  allSettings: SettingsType,
  extensionSettings: ResolvedExtensionSettings = {},
  projectPath?: string
) {
  // Make sure we have wasm initialized.
  const wasmInstance = await initPromise

  // Get the user settings.
  const jsAppSettings = getChangedSettingsAtLevel(allSettings, 'user')
  const appTomlString = serializeConfiguration(
    settingsPayloadToConfiguration(jsAppSettings, extensionSettings),
    wasmInstance
  )
  if (err(appTomlString)) {
    return
  }

  // Write the app settings.
  await writeAppSettingsFile(appTomlString)

  if (!projectPath) {
    // If we're not saving project settings, we're done.
    return
  }

  // Get the project settings.
  const jsProjectSettings = getChangedSettingsAtLevel(allSettings, 'project')
  const existingProjectSettings = await readProjectSettingsFile(
    projectPath,
    wasmInstance
  )
  if (err(existingProjectSettings)) {
    return
  }

  const mergedProjectSettings = replaceProjectSettingsPreservingMetadata(
    existingProjectSettings,
    settingsPayloadToProjectConfiguration(jsProjectSettings, extensionSettings)
  )
  const projectTomlString = serializeProjectConfiguration(
    mergedProjectSettings,
    wasmInstance
  )
  if (err(projectTomlString)) {
    return
  }

  // Write the project settings.
  await writeProjectSettingsFile(projectPath, projectTomlString)

  // Keep main.kcl `@settings(kclVersion)` aligned if the entrypoint already has one.
  const projectKclVersion = allSettings.modeling.kclVersion.current
  if (projectKclVersion) {
    await syncKclVersionToEntrypoint(
      projectPath,
      projectKclVersion,
      wasmInstance
    )
  }
}

export function getChangedSettingsAtLevel(
  allSettings: SettingsType,
  level: SettingsLevel
): Partial<SaveSettingsPayload> {
  const changedSettings = {} as Record<string, Record<string, unknown>>
  for (const [category, settingsCategory] of Object.entries(allSettings)) {
    for (const [setting, settingValue] of Object.entries(settingsCategory)) {
      if (!(settingValue instanceof Setting)) {
        continue
      }
      // If setting is different its ancestors' non-undefined values,
      // then it has been changed from the default
      if (
        settingValue[level] !== undefined &&
        ((level === 'project' &&
          (settingValue.user !== undefined
            ? settingValue.project !== settingValue.user
            : settingValue.project !== settingValue.default)) ||
          (level === 'user' && settingValue.user !== settingValue.default))
      ) {
        if (!changedSettings[category]) {
          changedSettings[category] = {}
        }
        changedSettings[category][setting] = settingValue[level]
      }
    }
  }

  return changedSettings
}

export function getAllCurrentSettings(
  allSettings: SettingsType
): SaveSettingsPayload {
  const currentSettings = {} as SaveSettingsPayload
  const currentSettingsRecord = currentSettings as Record<
    string,
    Record<string, unknown>
  >
  for (const [category, settingsCategory] of Object.entries(allSettings)) {
    for (const [setting, settingValue] of Object.entries(settingsCategory)) {
      if (!(settingValue instanceof Setting)) {
        continue
      }
      currentSettingsRecord[category] = {
        ...currentSettingsRecord[category],
        [setting]: settingValue.current,
      }
    }
  }

  return currentSettings
}

export function clearSettingsAtLevel(
  allSettings: SettingsType,
  level: SettingsLevel
) {
  for (const settingsCategory of Object.values(allSettings)) {
    for (const settingValue of Object.values(settingsCategory)) {
      if (!(settingValue instanceof Setting)) {
        continue
      }
      settingValue[level] = undefined
    }
  }

  return allSettings
}

export function setSettingsAtLevel(
  allSettings: SettingsType,
  level: SettingsLevel,
  newSettings: Partial<SaveSettingsPayload>
) {
  const settingsRecord = allSettings as Record<string, Record<string, Setting>>
  for (const [category, settingsCategory] of Object.entries(newSettings)) {
    if (!settingsRecord[category]) {
      continue // ignore unrecognized categories
    }
    for (const [settingKey, settingValue] of Object.entries(settingsCategory)) {
      if (!(settingKey in settingsRecord[category])) {
        continue // ignore unrecognized settings
      }
      settingsRecord[category][settingKey][level] = settingValue
    }
  }

  return allSettings
}

/**
 * Synchronous version of shouldHideSetting
 * Async hideOnPlatform functions should have been resolved in loadAndValidateSettings,
 * so this works synchronously.
 */
export function shouldHideSetting(
  setting: Setting<unknown>,
  settingsLevel: SettingsLevel
): boolean {
  // Async functions should have been resolved in loadAndValidateSettings,
  // but if we encounter one (shouldn't happen), default to hidden
  const hideOnPlatform = setting.hideOnPlatform
  if (typeof hideOnPlatform === 'function') {
    return true
  }

  return (
    setting.hideOnLevel === settingsLevel ||
    hideOnPlatform === 'both' ||
    (hideOnPlatform && isDesktop()
      ? hideOnPlatform === 'desktop'
      : hideOnPlatform === 'web')
  )
}

/**
 * Synchronous version of shouldShowSettingInput
 * Async hideOnPlatform functions should have been resolved in loadAndValidateSettings,
 * so this works synchronously.
 */
export function shouldShowSettingInput(
  setting: Setting<unknown>,
  settingsLevel: SettingsLevel
): boolean {
  const isHidden = shouldHideSetting(setting, settingsLevel)
  if (isHidden) {
    return false
  }

  return !!(
    setting.Component ||
    typeof setting.default === 'string' ||
    typeof setting.default === 'boolean' ||
    typeof setting.default === 'number' ||
    (setting.commandConfig?.inputType &&
      ['string', 'options', 'boolean', 'number'].some(
        (t) => setting.commandConfig?.inputType === t
      ))
  )
}

/**
 * Get the appropriate input type to show given a
 * command's config. Highly dependent on the filtering logic from
 * shouldShowSettingInput being applied
 */
export function getSettingInputType(setting: Setting) {
  if (setting.Component) {
    return 'component'
  }
  if (setting.commandConfig) {
    return setting.commandConfig.inputType as
      | 'string'
      | 'options'
      | 'boolean'
      | 'number'
  }
  return typeof setting.default as 'string' | 'boolean' | 'number'
}

export function getSettingsFromActorContext(
  s: SettingsActorType
): SettingsType {
  const {
    currentProject: _,
    commandBarActor: _cmd,
    wasmInstancePromise,
    ...settings
  } = s.getSnapshot().context
  return settings
}

export function jsAppSettings(s: SettingsType | SettingsActorType) {
  const settings = 'send' in s ? getSettingsFromActorContext(s) : s
  return settingsPayloadToConfiguration(getAllCurrentSettings(settings))
}

/**
 * Synchronous check if a setting is hidden on the given platform.
 * For async hideOnPlatform functions, this returns false (not hidden) since
 * we can't resolve them synchronously. The actual visibility will be resolved
 * asynchronously and commands will be updated reactively.
 */
export function hiddenOnPlatform(setting: Setting, desktop: boolean): boolean {
  const hideOnPlatform = setting.hideOnPlatform

  // Async functions should have been resolved in loadAndValidateSettings,
  // but if we encounter one (shouldn't happen), default to hidden
  if (typeof hideOnPlatform === 'function') {
    return true // Hidden until resolved
  }

  // Handle sync values (including resolved async values)
  if (hideOnPlatform === null || hideOnPlatform === undefined) {
    return false // Not hidden
  }

  return (
    hideOnPlatform === 'both' ||
    hideOnPlatform === (desktop ? 'desktop' : 'web')
  )
}

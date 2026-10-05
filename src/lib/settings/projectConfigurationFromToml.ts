import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import type { ProjectAppSettings } from '@rust/kcl-lib/bindings/ProjectAppSettings'
import type { ProjectCloudSettings } from '@rust/kcl-lib/bindings/ProjectCloudSettings'
import type { ProjectCloudEnvironmentSettings } from '@rust/kcl-lib/bindings/ProjectCloudEnvironmentSettings'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import type { ProjectMetaSettings } from '@rust/kcl-lib/bindings/ProjectMetaSettings'
import type { ProjectModelingSettings } from '@rust/kcl-lib/bindings/ProjectModelingSettings'
import type { JsonValue } from '@rust/kcl-lib/bindings/serde_json/JsonValue'
import {
  booleanValue,
  enumValue,
  jsonValue,
  stringValue,
  table,
  type JsonTable,
} from '@src/lib/settings/tomlConfiguration'
import { isErr } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { TomlTableWithoutBigInt } from 'smol-toml'

const nilUuid = '00000000-0000-0000-0000-000000000000'

function uuidValue(value: JsonValue): string | Error {
  if (typeof value !== 'string')
    return new Error('Project ID must be a UUID string')
  let id = value
  if (id.startsWith('urn:uuid:')) id = id.slice(9)
  else if (id.startsWith('{') && id.endsWith('}')) id = id.slice(1, -1)
  // Rust accepts UUIDs of any version/variant, including nil IDs. uuid.validate
  // is more restrictive, so parse the supported textual forms directly.
  if (
    !/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(
      id
    )
  ) {
    return new Error('Invalid project UUID')
  }
  const digits = id.replaceAll('-', '').toLowerCase()
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`
}

// Serde accepts positional arrays for structs without flattened extension
// fields. Preserve that representation for metadata, cloud IDs, and views.
function record(
  value: JsonValue | undefined,
  fields: readonly string[]
): JsonTable | Error {
  if (value === undefined) return {}
  if (!isArray(value)) return table(value)
  return Object.fromEntries(
    fields.flatMap((key, index) =>
      value[index] === undefined ? [] : [[key, value[index]]]
    )
  )
}

function projectMeta(
  value: JsonValue | undefined
): ProjectMetaSettings | Error {
  const section = record(value, ['id'])
  if (isErr(section)) return section
  if (section.id === undefined) return {}
  const id = uuidValue(section.id)
  if (isErr(id)) return id
  return id === nilUuid ? {} : { id }
}

function cloudSettings(
  value: JsonValue | undefined
): ProjectCloudSettings | Error {
  if (value === undefined) return {}
  const section = table(value)
  if (isErr(section)) return section
  const environments: Array<[string, ProjectCloudEnvironmentSettings]> = []
  for (const [environment, value] of Object.entries(section)) {
    const metadata = record(value, ['project_id'])
    if (isErr(metadata)) return metadata
    if (metadata.project_id === undefined) {
      environments.push([environment, {}])
      continue
    }
    const id = uuidValue(metadata.project_id)
    if (isErr(id)) return id
    environments.push([environment, id === nilUuid ? {} : { project_id: id }])
  }
  return Object.fromEntries(environments)
}

function numberValue(value: JsonValue): number | Error {
  return typeof value === 'number'
    ? value
    : new Error('Named-view coordinate must be a number')
}

function position(value: JsonValue): [number, number, number] | Error {
  if (!isArray(value) || value.length !== 3)
    return new Error('Named-view position must have three coordinates')
  const [x, y, z] = value
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number')
    return new Error('Named-view position coordinates must be numbers')
  return [x, y, z]
}

function rotation(value: JsonValue): [number, number, number, number] | Error {
  if (!isArray(value) || value.length !== 4)
    return new Error('Named-view rotation must have four coordinates')
  const [x, y, z, w] = value
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    typeof w !== 'number'
  )
    return new Error('Named-view rotation coordinates must be numbers')
  return [x, y, z, w]
}

function namedView(value: JsonValue): NamedView | Error {
  const section = record(value, [
    'name',
    'eye_offset',
    'fov_y',
    'is_ortho',
    'ortho_scale_enabled',
    'ortho_scale_factor',
    'pivot_position',
    'pivot_rotation',
    'world_coord_system',
    'version',
  ])
  if (isErr(section)) return section
  // Missing fields describe the legacy default camera pose. Version is one
  // even when all numeric pose values default to zero.
  const view: NamedView = {
    name: '',
    eye_offset: 0,
    fov_y: 0,
    is_ortho: false,
    ortho_scale_enabled: false,
    ortho_scale_factor: 0,
    pivot_position: [0, 0, 0],
    pivot_rotation: [0, 0, 0, 0],
    world_coord_system: '',
    version: 1,
  }
  const numericFields: Array<
    'eye_offset' | 'fov_y' | 'ortho_scale_factor' | 'version'
  > = ['eye_offset', 'fov_y', 'ortho_scale_factor', 'version']
  for (const key of numericFields) {
    if (section[key] === undefined) continue
    const parsed = numberValue(section[key])
    if (isErr(parsed)) return parsed
    view[key] = parsed
  }
  const stringFields: Array<'name' | 'world_coord_system'> = [
    'name',
    'world_coord_system',
  ]
  for (const key of stringFields) {
    if (section[key] === undefined) continue
    const parsed = stringValue(section[key])
    if (isErr(parsed)) return parsed
    view[key] = parsed
  }
  const booleanFields: Array<'is_ortho' | 'ortho_scale_enabled'> = [
    'is_ortho',
    'ortho_scale_enabled',
  ]
  for (const key of booleanFields) {
    if (section[key] === undefined) continue
    const parsed = booleanValue(section[key])
    if (isErr(parsed)) return parsed
    view[key] = parsed
  }
  if (section.pivot_position !== undefined) {
    const parsed = position(section.pivot_position)
    if (isErr(parsed)) return parsed
    view.pivot_position = parsed
  }
  if (section.pivot_rotation !== undefined) {
    const parsed = rotation(section.pivot_rotation)
    if (isErr(parsed)) return parsed
    view.pivot_rotation = parsed
  }
  return view
}

function namedViews(value: JsonValue): { [key: string]: NamedView } | Error {
  const section = table(value)
  if (isErr(section)) return section
  const views: { [key: string]: NamedView } = {}
  for (const [key, value] of Object.entries(section)) {
    const id = uuidValue(key)
    if (isErr(id)) return id
    const view = namedView(value)
    if (isErr(view)) return view
    views[id] = view
  }
  return views
}

function appSettings(value: JsonValue | undefined): ProjectAppSettings | Error {
  const section = value === undefined ? {} : table(value)
  if (isErr(section)) return section
  const { stream_idle_mode, zookeeper_mode, named_views, ...other } = section
  const app: ProjectAppSettings = other
  if (stream_idle_mode !== undefined) {
    const enabled = booleanValue(stream_idle_mode)
    if (isErr(enabled)) return enabled
    if (enabled) app.stream_idle_mode = true
  }
  if (zookeeper_mode !== undefined) {
    const mode = stringValue(zookeeper_mode)
    if (isErr(mode)) return mode
    app.zookeeper_mode = mode
  }
  if (named_views !== undefined) {
    const views = namedViews(named_views)
    if (isErr(views)) return views
    if (Object.keys(views).length) app.named_views = views
  }
  return app
}

function modelingSettings(
  value: JsonValue | undefined
): ProjectModelingSettings | Error {
  const section = value === undefined ? {} : table(value)
  if (isErr(section)) return section
  const { base_unit, highlight_edges, enable_ssao, fixed_size_grid, ...other } =
    section
  const modeling: ProjectModelingSettings = other
  if (base_unit !== undefined) {
    const unit = enumValue(base_unit, ['mm', 'cm', 'm', 'in', 'ft', 'yd'])
    if (isErr(unit)) return unit
    modeling.base_unit = unit
  }
  if (highlight_edges !== undefined) {
    const enabled = booleanValue(highlight_edges)
    if (isErr(enabled)) return enabled
    if (!enabled) modeling.highlight_edges = false
  }
  if (enable_ssao !== undefined) {
    const enabled = booleanValue(enable_ssao)
    if (isErr(enabled)) return enabled
    if (!enabled) modeling.enable_ssao = false
  }
  if (fixed_size_grid !== undefined) {
    const fixed = booleanValue(fixed_size_grid)
    if (isErr(fixed)) return fixed
    modeling.fixed_size_grid = fixed
  }
  return modeling
}

/**
 * Construct typed project settings from TOML without initializing Wasm.
 * Preserve core section defaults, UUID normalization, named-view camera poses,
 * and extension data at the settings/app/modeling boundaries.
 */
export function projectConfigurationFromToml(
  parsed: TomlTableWithoutBigInt
): ProjectConfiguration | Error {
  const section =
    parsed.settings === undefined ? {} : table(jsonValue(parsed.settings))
  if (isErr(section)) return section
  const { meta, app, modeling, ...other } = section
  const parsedMeta = projectMeta(meta)
  if (isErr(parsedMeta)) return parsedMeta
  const parsedApp = appSettings(app)
  if (isErr(parsedApp)) return parsedApp
  const parsedModeling = modelingSettings(modeling)
  if (isErr(parsedModeling)) return parsedModeling
  const cloud = cloudSettings(
    parsed.cloud === undefined ? undefined : jsonValue(parsed.cloud)
  )
  if (isErr(cloud)) return cloud
  return {
    settings: {
      ...other,
      meta: parsedMeta,
      app: parsedApp,
      modeling: parsedModeling,
    },
    ...(Object.keys(cloud).length ? { cloud } : {}),
  }
}

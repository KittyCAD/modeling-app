import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'

export const projectId = 'e8f5178c-5227-4567-bb5a-f52b3caef5ea'
export const viewId = '0656fb1a-9640-473e-b334-591dc70c0138'

export const defaultNamedView: NamedView = {
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

export const defaultProjectConfiguration: ProjectConfiguration = {
  settings: { meta: {}, app: {}, modeling: {} },
}

// Independent expected values shared by the old-parser characterization and
// the replacement's unit tests, so migration cannot quietly change the contract.
export const projectConfigurationCases: Array<{
  description: string
  toml: string
  expected: ProjectConfiguration
}> = [
  ...[
    '',
    '# comment only\n',
    '[settings]',
    '[cloud]',
    '[settings.app]\n[settings.modeling]\n[settings.meta]',
  ].map((toml) => ({
    description: `creates empty core sections for ${JSON.stringify(toml)}`,
    toml,
    expected: defaultProjectConfiguration,
  })),
  {
    description:
      'omits default booleans and nil UUIDs, but keeps explicit optional values',
    toml: `[settings.meta]
id = "00000000-0000-0000-0000-000000000000"
[settings.app]
stream_idle_mode = false
zookeeper_mode = ""
named_views = {}
[settings.modeling]
base_unit = "mm"
highlight_edges = true
enable_ssao = true
fixed_size_grid = false
`,
    expected: {
      settings: {
        meta: {},
        app: { zookeeper_mode: '' },
        modeling: { base_unit: 'mm', fixed_size_grid: false },
      },
    },
  },
  {
    description:
      'preserves extension settings while dropping unknown root and metadata fields',
    toml: `title = "Ignored by the settings parser"
default_file = "main.kcl"
[settings]
custom = { enabled = false, values = [1, 2], nested = { name = "extension" } }
[settings.meta]
id = "${projectId}"
unknown = "discarded"
[settings.app]
stream_idle_mode = true
streamIdleMode = false
appearance = { theme = "dark" }
[settings.modeling]
highlight_edges = false
enable_ssao = false
fixed_size_grid = true
camera_projection = "anything"
[settings.plugins]
telemetry = false
[cloud."zoo.dev"]
project_id = "${viewId}"
unknown = "discarded"
`,
    expected: {
      settings: {
        meta: { id: projectId },
        app: {
          stream_idle_mode: true,
          streamIdleMode: false,
          appearance: { theme: 'dark' },
        },
        modeling: {
          highlight_edges: false,
          enable_ssao: false,
          fixed_size_grid: true,
          camera_projection: 'anything',
        },
        custom: {
          enabled: false,
          values: [1, 2],
          nested: { name: 'extension' },
        },
        plugins: { telemetry: false },
      },
      cloud: { 'zoo.dev': { project_id: viewId } },
    },
  },
  {
    description:
      'omits empty cloud but preserves explicitly empty environments',
    toml: '[cloud."zoo.dev"]\nproject_id = "00000000-0000-0000-0000-000000000000"\n[cloud."dev.zoo.dev"]',
    expected: {
      ...defaultProjectConfiguration,
      cloud: { 'zoo.dev': {}, 'dev.zoo.dev': {} },
    },
  },
  {
    description: 'normalizes uppercase, simple, braced, and URN UUIDs',
    toml: `[settings.meta]
id = "${projectId.replaceAll('-', '').toUpperCase()}"
[settings.app.named_views."{${viewId.toUpperCase()}}"]
name = "Front"
[cloud."zoo.dev"]
project_id = "urn:uuid:${projectId}"
`,
    expected: {
      settings: {
        meta: { id: projectId },
        app: {
          named_views: { [viewId]: { ...defaultNamedView, name: 'Front' } },
        },
        modeling: {},
      },
      cloud: { 'zoo.dev': { project_id: projectId } },
    },
  },
  {
    description:
      'fills missing named-view fields and discards unknown view fields',
    toml: `[settings.app.named_views."${viewId}"]\nname = "Front"\nunknown = true`,
    expected: {
      settings: {
        meta: {},
        app: {
          named_views: { [viewId]: { ...defaultNamedView, name: 'Front' } },
        },
        modeling: {},
      },
    },
  },
  {
    description:
      'preserves complete named views including explicit version zero',
    toml: `[settings.app.named_views."${viewId}"]
name = "Perspective"
eye_offset = 1.5
fov_y = 45
is_ortho = true
ortho_scale_enabled = true
ortho_scale_factor = 2
pivot_position = [1, 2.5, -3]
pivot_rotation = [0, 0, 0, 1]
world_coord_system = "right_handed_up_z"
version = 0
`,
    expected: {
      settings: {
        meta: {},
        app: {
          named_views: {
            [viewId]: {
              name: 'Perspective',
              eye_offset: 1.5,
              fov_y: 45,
              is_ortho: true,
              ortho_scale_enabled: true,
              ortho_scale_factor: 2,
              pivot_position: [1, 2.5, -3],
              pivot_rotation: [0, 0, 0, 1],
              world_coord_system: 'right_handed_up_z',
              version: 0,
            },
          },
        },
        modeling: {},
      },
    },
  },
  {
    description: 'accepts positional metadata, cloud, and named-view records',
    toml: `[settings]
meta = ["${projectId}", "ignored trailing value"]
[settings.app]
named_views = { "${viewId}" = ["Front", 1.5] }
[cloud]
"zoo.dev" = ["${projectId}"]
"dev.zoo.dev" = []
`,
    expected: {
      settings: {
        meta: { id: projectId },
        app: {
          named_views: {
            [viewId]: { ...defaultNamedView, name: 'Front', eye_offset: 1.5 },
          },
        },
        modeling: {},
      },
      cloud: { 'zoo.dev': { project_id: projectId }, 'dev.zoo.dev': {} },
    },
  },
  {
    description:
      'preserves signed float zero while integer zero loses its sign',
    toml: `[settings.app.named_views."${viewId}"]\neye_offset = -0.0\npivot_position = [-0.0, 0.0, -0]`,
    expected: {
      settings: {
        ...defaultProjectConfiguration.settings,
        app: {
          named_views: {
            [viewId]: {
              ...defaultNamedView,
              eye_offset: -0,
              pivot_position: [-0, 0, 0],
            },
          },
        },
      },
    },
  },
  {
    description:
      'represents extension dates and non-finite numbers through JSON',
    toml: '[settings.plugins]\ncreated = 2024-01-01T00:00:00Z\nnan = nan\npositive = inf\nnegative = -inf',
    expected: {
      settings: {
        ...defaultProjectConfiguration.settings,
        plugins: {
          created: { $__toml_private_datetime: '2024-01-01T00:00:00Z' },
          nan: null,
          positive: null,
          negative: null,
        },
      },
    },
  },
]

export const invalidProjectConfigurationCases = [
  'broken = [',
  'settings = false',
  '[settings]\nmeta = false',
  '[settings]\napp = []',
  '[settings]\nmodeling = []',
  '[settings]\napp = false',
  '[settings]\nmodeling = "mm"',
  '[settings.meta]\nid = "invalid"',
  '[settings.meta]\nid = 123',
  '[settings.app]\nstream_idle_mode = 1',
  '[settings.app]\nzookeeper_mode = true',
  '[settings.app]\nnamed_views = []',
  '[settings.app.named_views."invalid"]',
  `[settings.app.named_views."${viewId}"]\nname = 1`,
  `[settings.app.named_views."${viewId}"]\neye_offset = "1"`,
  `[settings.app.named_views."${viewId}"]\nis_ortho = 1`,
  `[settings.app.named_views."${viewId}"]\npivot_position = [1, 2]`,
  `[settings.app.named_views."${viewId}"]\npivot_rotation = [0, 0, 1]`,
  `[settings.app.named_views."${viewId}"]\npivot_position = [1, 2, "3"]`,
  '[settings.modeling]\nbase_unit = "invalid"',
  '[settings.modeling]\nhighlight_edges = "false"',
  '[settings.modeling]\nenable_ssao = 0',
  '[settings.modeling]\nfixed_size_grid = "true"',
  'cloud = false',
  '[cloud]\n"zoo.dev" = false',
  '[cloud."zoo.dev"]\nproject_id = "invalid"',
  '[settings.plugins]\ntelemetry = true\ntelemetry = false',
]

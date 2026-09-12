import { optionsSetting, textSetting } from '@src/contracts/settings'

/** Which service evaluates KCL and produces the model. */
export type ModelingEngineKind = 'zoo' | 'kclean'

/** Which renderer draws the viewport. */
export type RendererKind = 'engine' | 'bevy'

/**
 * The renderer that can actually be used for an engine/renderer preference.
 *
 * Kclean returns geometry rather than a video stream, so Bevy is part of that
 * engine's transport contract. Keeping this as a derived value preserves the
 * user's Zoo renderer preference when they switch to Kclean and back.
 */
export function effectiveRenderer(
  engine: ModelingEngineKind,
  renderer: RendererKind
): RendererKind {
  return engine === 'kclean' ? 'bevy' : renderer
}

/** Which service evaluates KCL and produces the model. */
export const modelingEngineSetting = optionsSetting<ModelingEngineKind>({
  id: 'modeling.engine',
  section: 'modeling',
  title: 'Modeling engine',
  description:
    'Zoo evaluates projects in the hosted modeling engine. Kclean sends the complete KCL project to a separately hosted Kclean demo server.',
  order: 1,
  defaultValue: 'zoo',
  levels: ['user'],
  toml: ['settings', 'app', 'modeling_engine'],
  options: [
    { value: 'zoo', label: 'Zoo' },
    { value: 'kclean', label: 'Kclean (experimental)' },
  ],
  detail: (value) => [
    { label: 'Applies', value: 'on the next launch' },
    ...(value === 'kclean'
      ? [{ label: 'Renderer', value: 'Bevy (required)' }]
      : []),
  ],
})

/**
 * Which renderer draws the viewport.
 *
 * Not live, and it cannot be: the Bevy app is a wasm module that takes over a
 * canvas and offers no way to be asked to stop, so switching is a reload. That
 * follows the convention ambient occlusion and the scale grid already set — say
 * so in a `detail` row rather than pretend otherwise.
 *
 * User level. Which renderer a machine can drive is a property of the person and
 * their hardware rather than of the part, and `ProjectModelingSettings` has no
 * field for it, so a project override would write a key nothing reads.
 *
 * The description states both costs plainly. Somebody choosing this should not
 * discover the double charge on their bill.
 */
export const rendererSetting = optionsSetting<RendererKind>({
  id: 'modeling.renderer',
  section: 'modeling',
  title: 'Renderer',
  description:
    'The streamed renderer is provided by Zoo. Bevy renders geometry on this machine and is required by Kclean; selection and sketching remain unavailable in the experimental Bevy viewport.',
  order: 2,
  defaultValue: 'engine',
  levels: ['user'],
  toml: ['settings', 'app', 'renderer'],
  options: [
    { value: 'engine', label: 'Zoo engine (streamed)' },
    { value: 'bevy', label: 'bevy-zoo (local, experimental)' },
  ],
  detail: (value) => [
    { label: 'Applies', value: 'on the next launch' },
    ...(value === 'bevy'
      ? [
          {
            label: 'When using Zoo',
            value: 'solves on a separate Zoo connection',
          },
        ]
      : []),
  ],
})

/** Base URL of the prototype server; the client appends `/v1/evaluations`. */
export const kcleanServerSetting = textSetting({
  id: 'modeling.kcleanServer',
  section: 'modeling',
  title: 'Kclean server',
  description:
    'HTTP base URL of the Kclean demo server. The browser must be able to reach it directly.',
  order: 3,
  defaultValue: 'http://127.0.0.1:3001',
  levels: ['user'],
  toml: ['settings', 'app', 'kclean_server'],
  placeholder: 'http://127.0.0.1:3001',
  validate: (value) => {
    try {
      const protocol = new URL(value).protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  },
  detail: () => [{ label: 'Applies', value: 'on the next launch' }],
})

export const bevySceneSettings = [
  modelingEngineSetting,
  rendererSetting,
  kcleanServerSetting,
]

import { optionsSetting } from '@src/contracts/settings'

/** Which renderer draws the viewport. */
export type RendererKind = 'engine' | 'bevy'

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
    'The Zoo engine renders on a server and streams video. bevy-zoo is experimental: it renders on this machine, but it solves the project on its own connection — so a file is solved, and charged for, twice — and selection and sketching stay on the engine.',
  order: 1,
  defaultValue: 'engine',
  levels: ['user'],
  toml: ['settings', 'app', 'renderer'],
  options: [
    { value: 'engine', label: 'Zoo engine (streamed)' },
    { value: 'bevy', label: 'bevy-zoo (local, experimental)' },
  ],
  detail: () => [{ label: 'Applies', value: 'on the next launch' }],
})

export const bevySceneSettings = [rendererSetting]

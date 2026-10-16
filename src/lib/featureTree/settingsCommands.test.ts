import { signal } from '@preact/signals-core'
import type { MachineManager } from '@src/lib/MachineManager'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { featureTreeSettings } from '@src/lib/featureTree/settings'
import { SCENE_BROWSER_FEATURE } from '@src/lib/sceneBrowser/featureFlag'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { settingsMachine } from '@src/machines/settingsMachine'
import type { UserFeature } from '@src/machines/userFeaturesMachine'
import { expect, it } from 'vitest'
import { createActor, fromCallback, fromPromise, waitFor } from 'xstate'

it('offers Scene browser style after the flag loads and removes it on revocation', async () => {
  const features = signal(new Set<UserFeature>())
  const settings = createSettings(featureTreeSettings)
  const wasmInstancePromise = Promise.resolve({} as ModuleType)
  const commandBarActor = createActor(commandBarMachine, {
    input: {
      commands: [],
      wasmInstancePromise,
      machineManager: {} as MachineManager,
    },
  }).start()
  const actor = createActor(
    settingsMachine.provide({
      actors: {
        loadUserSettings: fromPromise(async () => settings),
        watchSystemTheme: fromCallback(() => () => {}),
      },
    }),
    {
      input: {
        ...settings,
        commandBarActor,
        defaultProjectLibraries: [],
        projectLibrarySettingDefaultPolicies: [],
        extensionSettings: featureTreeSettings,
        fileOperations: testFileOperations,
        wasmInstancePromise,
        hasFeature: (feature) => features.value.has(feature),
      },
    }
  ).start()
  const styleCommands = () =>
    commandBarActor
      .getSnapshot()
      .context.commands.filter(
        ({ name, groupId }) =>
          name === 'modeling.featureTreeDisplay' && groupId === 'settings'
      )
  try {
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))
    expect(styleCommands()).toEqual([])
    features.value = new Set([SCENE_BROWSER_FEATURE])
    expect(styleCommands()).toHaveLength(1)
    expect(styleCommands()[0].displayName).toBe(
      'Settings · modeling · Scene browser style'
    )
    expect(styleCommands()[0].args?.value).toMatchObject({
      inputType: 'options',
      options: [
        { name: 'HUD', value: 'hud' },
        { name: 'Solid', value: 'standard' },
      ],
    })
    features.value = new Set()
    expect(styleCommands()).toEqual([])
    features.value = new Set([SCENE_BROWSER_FEATURE])
    expect(styleCommands()).toHaveLength(1)
  } finally {
    actor.stop()
    commandBarActor.stop()
  }
})

import { initialiseWasm } from '@src/lang/wasmUtils'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { computed, signal } from '@preact/signals-core'
import { createViewerExtrudeCommand } from '@src/lib/kcl/extrudeCommand'
import {
  modelingTargetBinding,
  type ModelingTarget,
} from '@src/lib/kcl/modelingTarget'
import {
  commandsValueSpec,
  commandSystemService,
} from '@src/registry/contracts/commands'
import { createViewerKclRuntime } from '@src/lib/kcl/runtime'
import { bindViewerTransport } from '@src/lib/kcl/transport'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import env from '@src/env'
import {
  codeEditorExtensionValueSpec,
  editorLanguageValueSpec,
  editorsService,
  editorViewValueSpec,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import {
  executorCapabilityValueSpec,
  executorsService,
} from '@src/lib/executors/registry/contract'
import { createKclExecution } from '@src/lib/kcl/executor'
import { KclScene } from '@src/lib/kcl/KclScene'
import { loadKclProjectSources } from '@src/lib/kcl/projectSources'
import { createKclSceneSettings } from '@src/lib/kcl/settings'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { authService } from '@src/registry/contracts/auth'
import { settingsService } from '@src/registry/contracts/settings'
import { createElement } from 'react'

/** KCL contributes syntax, execution, and a standalone engine stream without legacy modeling services. */
const extension = defineRegistryItemFactory(({ services, valueSpecs }) => {
  // Value specs resolve against the completed registry graph, so reading one
  // inside this factory would reenter graph construction and create a signal cycle.
  const wasmPromise = computed(
    () => valueSpecs.get(wasmPromiseValueSpec) ?? initialiseWasm()
  )
  const targets = signal<readonly ModelingTarget[]>([])
  const sceneSettings = createKclSceneSettings(
    () => services.get(settingsService).current.value
  )
  const { capability, getSession } = createKclExecution(
    async (size) => {
      // The SDK worker resolves WASM from location.origin, which cannot address a packaged file:// build.
      if (window.location.protocol === 'file:') {
        return new Error(
          'KCL previews are currently available in the web app and desktop development builds.'
        )
      }
      const token = services.get(authService).token.peek()
      if (!token) return new Error('Sign in to connect to the engine')
      // Keep the viewer SDK separate from the app SDK until their API changes are adopted.
      const [{ ZooWebView }, { Client, modeling }] = await Promise.all([
        import('@kittycad/web-view'),
        import('@kittycad/viewer-sdk'),
      ])
      const view = new ZooWebView({
        zooClient: new Client({ token, baseUrl: env().VITE_ZOO_API_BASE_URL }),
        size,
        allowMultiple: true,
        autoStart: false,
      })
      // The SDK's auto-start frame can restart a disposed viewer. Start only after
      // the session has attached its element and checked that it is still owned.
      let unbindTransport: (() => void) | undefined
      const destroy = view.deconstructor.bind(view)
      return Object.assign(view, {
        deconstructor: () => {
          unbindTransport?.()
          return destroy()
        },
        start: () => {
          const start = view.el.querySelector<HTMLElement>('.start')
          start?.click()
          if (start) start.style.display = 'none'
          const rtc = view.rtc
          if (rtc) {
            unbindTransport = bindViewerTransport(rtc, (message) =>
              modeling.modeling_commands_ws.parseMessage(
                message as MessageEvent
              )
            )
            // The SDK observes hidden panels too. Keep their last valid stream
            // size instead of asking the engine to render a 0x0 framebuffer.
            const resize = rtc.resize.bind(rtc)
            rtc.resize = (size) => {
              if (size.width >= 4 && size.height >= 4) resize(size)
            }
          }
        },
      })
    },
    (send) =>
      createViewerKclRuntime(wasmPromise.value, send, () =>
        jsAppSettings(services.get(settingsService).current.peek())
      ),
    sceneSettings.current,
    (contents, context) =>
      loadKclProjectSources(
        contents,
        context,
        services.optional(projectSessionService),
        services.optional(editorsService)?.editors.peek() ?? []
      )
  )
  return {
    id: 'kcl',
    dispose: sceneSettings.dispose,
    provides: [
      provide(
        commandsValueSpec,
        computed(() =>
          createViewerExtrudeCommand(targets, wasmPromise.value, () =>
            services
              .get(userFeaturesService)
              .has(EXPERIMENTAL_POINT_AND_CLICK_FLAG, false)
          )
        ),
        { key: 'kcl.extrude' }
      ),
      provide(editorLanguageValueSpec, {
        id: 'kcl',
        matches: '.kcl',
      }),

      provide(codeEditorExtensionValueSpec, {
        id: 'editors.kcl',
        matches: ({ languageId }) => languageId === 'kcl',
        extensions: [kcl(), editorKclHighlight],
      }),
      provide(executorCapabilityValueSpec, capability),
      provide(
        editorViewValueSpec,
        defineEditorView((host) => {
          const context = executionContext(capability, () => services.get(executorsService), { shared: false })(host)
          const target = {
            id: crypto.randomUUID(),
            editor: host.editor,
            session: getSession(context.executor),
          }
          targets.value = [...targets.peek(), target]
          host.onDispose(() => {
            targets.value = targets.peek().filter((entry) => entry !== target)
          })
          return { ...context, target }
        })({
          id: 'kcl.engine',
          label: 'Modeling',
          priority: 1000,
          matches: '.kcl',

          Component: ({ context }) =>
            createElement(KclScene, {
              executor: context.executor,
              capability,
              session: getSession(context.executor),
              onExtrude: () =>
                services.get(commandSystemService).send({
                  type: 'Find and select command',
                  data: {
                    name: 'Extrude',
                    groupId: 'kcl-modeling',
                    argDefaultValues: {
                      modelingTarget: modelingTargetBinding(context.target),
                    },
                  },
                }),
            }),
        })
      ),
    ],
  }
}, 'kcl')

export default withProjectShellFeature(extension, 'kcl')

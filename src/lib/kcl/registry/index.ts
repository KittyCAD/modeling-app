import { editorKclHighlight } from '@src/editor/plugins/theme'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import env from '@src/env'
import {
  editorCapabilityValueSpec,
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
import type { KclStreamView } from '@src/lib/kcl/session'
import { createKclSceneSettings } from '@src/lib/kcl/settings'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { authService } from '@src/registry/contracts/auth'
import { settingsService } from '@src/registry/contracts/settings'
import { createElement } from 'react'

/** KCL contributes syntax, execution, and a standalone engine stream without legacy modeling services. */
const extension = defineRegistryItemFactory(({ services }) => {
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
      const [{ ZooWebView }, { Client }] = await Promise.all([
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
      // SDK 4.5.26 forwards Map inputs to its worker, but declares submit(string).
      // Keep that declaration correction confined to the SDK boundary.
      return Object.assign(view, {
        start: () => {
          const start = view.el.querySelector<HTMLElement>('.start')
          start?.click()
          if (start) start.style.display = 'none'
          const rtc = view.rtc
          if (rtc) {
            // The SDK observes hidden panels too. Keep their last valid stream
            // size instead of asking the engine to render a 0x0 framebuffer.
            const resize = rtc.resize.bind(rtc)
            rtc.resize = (size) => {
              if (size.width >= 4 && size.height >= 4) resize(size)
            }
          }
        },
      }) as KclStreamView
    },
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
      provide(editorLanguageValueSpec, {
        id: 'kcl',
        matches: '.kcl',
      }),

      provide(editorCapabilityValueSpec, {
        id: 'editors.kcl',
        matches: ({ languageId }) => languageId === 'kcl',
        capabilities: [kcl(), editorKclHighlight],
      }),
      provide(executorCapabilityValueSpec, capability),
      provide(
        editorViewValueSpec,
        defineEditorView(
          executionContext(capability, () => services.get(executorsService))
        )({
          id: 'kcl.engine',
          label: 'Modeling',
          priority: 1000,
          matches: '.kcl',

          Component: ({ context }) =>
            createElement(KclScene, {
              executor: context.executor,
              capability,
              session: getSession(context.executor),
            }),
        })
      ),
    ],
  }
}, 'kcl')

export default withProjectShellFeature(extension, 'kcl')

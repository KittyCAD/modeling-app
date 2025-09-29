import { builtinModules } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { ConfigEnv, Plugin, UserConfig } from 'vite'

import pkg from './package.json'

export const builtins = [
  'electron',
  ...builtinModules.map((m) => [m, `node:${m}`]).flat(),
]

export const external = [
  ...builtins,
  ...Object.keys(
    'dependencies' in pkg ? (pkg.dependencies as Record<string, unknown>) : {}
  ),
]

export function getBuildConfig(env: ConfigEnv<'build'>): UserConfig {
  const { root, mode, command } = env

  return {
    root,
    mode,
    build: {
      // Prevent multiple builds from interfering with each other.
      emptyOutDir: false,
      // 🚧 Multiple builds may conflict.
      outDir: '.vite/build',
      watch: command === 'serve' ? {} : null,
      minify: command === 'build',
    },
    clearScreen: false,
  }
}

export function getDefineKeys(names: string[]) {
  const define: { [name: string]: VitePluginRuntimeKeys } = {}

  return names.reduce((acc, name) => {
    const NAME = name.toUpperCase()
    const keys: VitePluginRuntimeKeys = {
      VITE_DEV_SERVER_URL: `${NAME}_VITE_DEV_SERVER_URL`,
      VITE_NAME: `${NAME}_VITE_NAME`,
    }

    return { ...acc, [name]: keys }
  }, define)
}

export function getBuildDefine(env: ConfigEnv<'build'>) {
  const { command, forgeConfig } = env
  const renderer = (forgeConfig && forgeConfig.renderer) ?? [
    {
      name: 'main_window',
      config: 'vite.renderer.config.ts',
    },
  ]
  const names = renderer
    .filter(({ name }) => name != null)
    .map(({ name }) => name!)
  const defineKeys = getDefineKeys(names)
  const define = Object.entries(defineKeys).reduce(
    (acc, [name, keys]) => {
      const { VITE_DEV_SERVER_URL, VITE_NAME } = keys
      const def = {
        [VITE_DEV_SERVER_URL]:
          command === 'serve'
            ? JSON.stringify(process.env[VITE_DEV_SERVER_URL])
            : undefined,
        [VITE_NAME]: JSON.stringify(name),
      }
      return { ...acc, ...def }
    },
    {} as Record<string, any>
  )

  return define
}

export function pluginExposeRenderer(name: string): Plugin {
  const { VITE_DEV_SERVER_URL } = getDefineKeys([name])[name]

  return {
    name: '@electron-forge/plugin-vite:expose-renderer',
    configureServer(server) {
      process.viteDevServers ??= {}
      // Expose server for preload scripts hot reload.
      process.viteDevServers[name] = server

      server.httpServer?.once('listening', () => {
        const addressInfo = server.httpServer!.address() as AddressInfo
        // Expose env constant for main process use.
        process.env[VITE_DEV_SERVER_URL] =
          `http://localhost:${addressInfo?.port}`
      })
    },
  }
}

export function pluginHotRestart(command: 'reload' | 'restart'): Plugin {
  return {
    name: '@electron-forge/plugin-vite:hot-restart',
    closeBundle() {
      if (command === 'reload') {
        for (const server of Object.values(process.viteDevServers)) {
          // Preload scripts hot reload.
          server.ws.send({ type: 'full-reload' })
        }
      } else {
        // Main process hot restart.
        // https://github.com/electron/forge/blob/v7.2.0/packages/api/core/src/api/start.ts#L216-L223
        process.stdin.emit('data', 'rs')
      }
    },
  }
}

export function indexHtmlCsp(enabled: boolean): Plugin {
  const csp = [
    //  By default, only allow same origin.
    "default-src 'self'",
    // Allow inline styles and styles from the same origin. This is how we use CSS rightnow.
    "style-src 'self' 'unsafe-inline'",
    // Allow images from any source and inline images. We fetch user profile images from any origin.
    "img-src * blob: data: 'unsafe-inline'",
    // Allow WebSocket connections and fetches to our API.
    "connect-src 'self' https://plausible.corp.zoo.dev https://api.zoo.dev wss://api.zoo.dev https://api.dev.zoo.dev wss://api.dev.zoo.dev https://api.zoogov.dev wss://api.zoogov.dev",
    // Disallow legacy stuff
    "object-src 'none'",
  ]

  // Allow scripts from the same origin and from Plausible Analytics. Allow WASM execution.
  const cspScriptBase =
    "script-src 'self' 'wasm-unsafe-eval' https://plausible.corp.zoo.dev/js/script.tagged-events.js"

  // frame ancestors can only be blocked using HTTP headers (see vercel.json)
  const vercelCspBase = ["frame-ancestors 'none'"]

  const cspReporting = [
    'report-uri https://csp-logger.vercel.app/csp-report',
    'report-to csp-reporting-endpoint',
  ]

  const vercelCsp =
    csp
      .concat(vercelCspBase)
      .concat([cspScriptBase])
      .concat(cspReporting)
      .join('; ') + ';'

  const reportingEndpoints = {
    key: 'Reporting-Endpoints',
    value: 'csp-reporting-endpoint="https://csp-logger.vercel.app/csp-report"',
  }

  console.log(
    'Content-Security-Policy for Vercel (prod) (vercel.json):',
    vercelCsp
  )

  console.log(
    JSON.stringify(
      [
        reportingEndpoints,
        {
          key: 'Content-Security-Policy',
          value: vercelCsp,
        },
      ],
      null,
      2
    )
  )

  console.log('Content-Security-Policy for Vercel (preview) (vercel.json):')

  console.log(
    JSON.stringify(
      [
        reportingEndpoints,
        {
          key: 'Content-Security-Policy',
          value:
            csp
              .concat(vercelCspBase)
              .concat([
                // vercel.live is used for feedback scripts in preview deployments.
                "frame-src 'self' https://vercel.live",
                `${cspScriptBase} https://vercel.live/_next-live/feedback/feedback.js 'unsafe-eval'`,
              ])
              .concat(cspReporting)
              .join('; ') + ';',
        },
      ],

      null,
      2
    )
  )

  return {
    name: 'html-transform',
    transformIndexHtml(html: string) {
      let indexHtmlRegex =
        /<meta\shttp-equiv="Content-Security-Policy"\scontent="(.*?)">/
      if (!enabled) {
        // Web deployments that are deployed to vercel don't need a CSP in the indexHTML.
        // They get it through vercel.json.
        return html.replace(indexHtmlRegex, '')
      } else {
        return html.replace(
          indexHtmlRegex,
          `<meta http-equiv="Content-Security-Policy" content="${
            csp.concat([cspScriptBase]).join('; ') + ';'
          }">`
        )
      }
    },
  }
}

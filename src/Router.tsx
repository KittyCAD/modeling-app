import { App } from './App'
import {
  createBrowserRouter,
  Outlet,
  redirect,
  useLocation,
  RouterProvider,
} from 'react-router-dom'
import {
  matchRoutes,
  createRoutesFromChildren,
  useNavigationType,
} from 'react-router'
import { useEffect } from 'react'
import { ErrorPage } from './components/ErrorPage'
import { Settings } from './routes/Settings'
import Onboarding, {
  onboardingRoutes,
  onboardingPaths,
} from './routes/Onboarding'
import SignIn from './routes/SignIn'
import { Auth } from './Auth'
import { isTauri } from './lib/isTauri'
import Home from './routes/Home'
import { FileEntry, readDir, readTextFile } from '@tauri-apps/api/fs'
import makeUrlPathRelative from './lib/makeUrlPathRelative'
import {
  initializeProjectDirectory,
  isProjectDirectory,
  PROJECT_ENTRYPOINT,
} from './lib/tauriFS'
import { metadata, type Metadata } from 'tauri-plugin-fs-extra-api'
import DownloadAppBanner from './components/DownloadAppBanner'
import { GlobalStateProvider } from './components/GlobalStateProvider'
import {
  SETTINGS_PERSIST_KEY,
  settingsMachine,
} from './machines/settingsMachine'
import { ContextFrom } from 'xstate'
import CommandBarProvider from 'components/CommandBar'
import { TEST, VITE_KC_SENTRY_DSN } from './env'
import * as Sentry from '@sentry/react'
import ModelingMachineProvider from 'components/ModelingMachineProvider'
import { KclContextProvider } from 'lang/KclSinglton'

if (VITE_KC_SENTRY_DSN && !TEST) {
  Sentry.init({
    dsn: VITE_KC_SENTRY_DSN,
    // TODO(paultag): pass in the right env here.
    // environment: "production",
    integrations: [
      new Sentry.BrowserTracing({
        routingInstrumentation: Sentry.reactRouterV6Instrumentation(
          useEffect,
          useLocation,
          useNavigationType,
          createRoutesFromChildren,
          matchRoutes
        ),
      }),
      new Sentry.Replay(),
    ],

    // Set tracesSampleRate to 1.0 to capture 100%
    // of transactions for performance monitoring.
    tracesSampleRate: 1.0,

    // TODO: Add in kittycad.io endpoints
    tracePropagationTargets: ['localhost'],

    // Capture Replay for 10% of all sessions,
    // plus for 100% of sessions with an error
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}

const prependRoutes =
  (routesObject: Record<string, string>) => (prepend: string) => {
    return Object.fromEntries(
      Object.entries(routesObject).map(([constName, path]) => [
        constName,
        prepend + path,
      ])
    )
  }

export const paths = {
  INDEX: '/',
  HOME: '/home',
  FILE: '/file',
  SETTINGS: '/settings',
  SIGN_IN: '/signin',
  ONBOARDING: prependRoutes(onboardingPaths)(
    '/onboarding'
  ) as typeof onboardingPaths,
}

export const BROWSER_FILE_NAME = 'new'

export type IndexLoaderData = {
  code: string | null
  project?: ProjectWithEntryPointMetadata
  file?: FileEntry
}

export type ProjectWithEntryPointMetadata = FileEntry & {
  entrypointMetadata: Metadata
}
export type HomeLoaderData = {
  projects: ProjectWithEntryPointMetadata[]
}

type CreateBrowserRouterArg = Parameters<typeof createBrowserRouter>[0]

const addGlobalContextToElements = (
  routes: CreateBrowserRouterArg
): CreateBrowserRouterArg =>
  routes.map((route) =>
    'element' in route
      ? {
          ...route,
          element: (
            <CommandBarProvider>
              <GlobalStateProvider>{route.element}</GlobalStateProvider>
            </CommandBarProvider>
          ),
        }
      : route
  )

const router = createBrowserRouter(
  addGlobalContextToElements([
    {
      path: paths.INDEX,
      loader: () =>
        isTauri()
          ? redirect(paths.HOME)
          : redirect(paths.FILE + '/' + BROWSER_FILE_NAME),
      errorElement: <ErrorPage />,
    },
    {
      path: paths.FILE + '/:id',
      element: (
        <Auth>
          <Outlet />
          <KclContextProvider>
            <ModelingMachineProvider>
              <App />
            </ModelingMachineProvider>
          </KclContextProvider>
          {!isTauri() && import.meta.env.PROD && <DownloadAppBanner />}
        </Auth>
      ),
      id: paths.FILE,
      loader: async ({
        request,
        params,
      }): Promise<IndexLoaderData | Response> => {
        const fetchedStorage = localStorage?.getItem(SETTINGS_PERSIST_KEY)
        const persistedSettings = JSON.parse(fetchedStorage || '{}') as Partial<
          ContextFrom<typeof settingsMachine>
        >

        const status = persistedSettings.onboardingStatus || ''
        const notEnRouteToOnboarding = !request.url.includes(
          paths.ONBOARDING.INDEX
        )
        // '' is the initial state, 'done' and 'dismissed' are the final states
        const hasValidOnboardingStatus =
          status.length === 0 || !(status === 'done' || status === 'dismissed')
        const shouldRedirectToOnboarding =
          notEnRouteToOnboarding && hasValidOnboardingStatus

        if (shouldRedirectToOnboarding) {
          return redirect(
            makeUrlPathRelative(paths.ONBOARDING.INDEX) + status.slice(1)
          )
        }

        const defaultDir = persistedSettings.defaultDirectory || ''

        if (params.id && params.id !== BROWSER_FILE_NAME) {
          const decodedId = decodeURIComponent(params.id)
          const projectAndFile = decodedId.replace(defaultDir + '/', '')
          const firstSlashIndex = projectAndFile.indexOf('/')
          const projectName = projectAndFile.slice(0, firstSlashIndex)
          const projectPath = defaultDir + '/' + projectName
          const currentFileName = projectAndFile.slice(firstSlashIndex + 1)

          if (firstSlashIndex === -1 || !currentFileName)
            return redirect(
              `${paths.FILE}/${encodeURIComponent(
                `${params.id}/${PROJECT_ENTRYPOINT}`
              )}`
            )

          // Note that PROJECT_ENTRYPOINT is hardcoded until we support multiple files
          const code = await readTextFile(decodedId)
          const entrypointMetadata = await metadata(
            projectPath + '/' + PROJECT_ENTRYPOINT
          )
          const children = await readDir(projectPath, { recursive: true })

          return {
            code,
            project: {
              name: projectName,
              path: projectPath,
              children,
              entrypointMetadata,
            },
            file: {
              name: currentFileName,
              path: params.id,
            },
          }
        }

        return {
          code: '',
        }
      },
      children: [
        {
          path: makeUrlPathRelative(paths.SETTINGS),
          element: <Settings />,
        },
        {
          path: makeUrlPathRelative(paths.ONBOARDING.INDEX),
          element: <Onboarding />,
          children: onboardingRoutes,
        },
      ],
    },
    {
      path: paths.HOME,
      element: (
        <Auth>
          <Outlet />
          <Home />
        </Auth>
      ),
      loader: async () => {
        if (!isTauri()) {
          return redirect(paths.FILE + '/' + BROWSER_FILE_NAME)
        }
        const fetchedStorage = localStorage?.getItem(SETTINGS_PERSIST_KEY)
        const persistedSettings = JSON.parse(fetchedStorage || '{}') as Partial<
          ContextFrom<typeof settingsMachine>
        >
        const projectDir = await initializeProjectDirectory(
          persistedSettings.defaultDirectory || ''
        )
        if (projectDir !== persistedSettings.defaultDirectory) {
          localStorage.setItem(
            SETTINGS_PERSIST_KEY,
            JSON.stringify({
              ...persistedSettings,
              defaultDirectory: projectDir,
            })
          )
        }
        const projectsNoMeta = (await readDir(projectDir)).filter(
          isProjectDirectory
        )
        const projects = await Promise.all(
          projectsNoMeta.map(async (p) => ({
            entrypointMetadata: await metadata(
              p.path + '/' + PROJECT_ENTRYPOINT
            ),
            ...p,
          }))
        )

        return {
          projects,
        }
      },
      children: [
        {
          path: makeUrlPathRelative(paths.SETTINGS),
          element: <Settings />,
        },
      ],
    },
    {
      path: paths.SIGN_IN,
      element: <SignIn />,
    },
  ])
)

/**
 * All routes in the app, used in src/index.tsx
 * @returns RouterProvider
 */
export const Router = () => {
  return <RouterProvider router={router} />
}

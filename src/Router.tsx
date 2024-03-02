import { App } from './App'
import {
  createBrowserRouter,
  Outlet,
  redirect,
  RouterProvider,
} from 'react-router-dom'
import { ErrorPage } from './components/ErrorPage'
import { Settings } from './routes/Settings'
import Onboarding, { onboardingRoutes } from './routes/Onboarding'
import SignIn from './routes/SignIn'
import { Auth } from './Auth'
import { isTauri } from './lib/isTauri'
import Home from './routes/Home'
import { readTextFile, stat } from '@tauri-apps/plugin-fs'
import makeUrlPathRelative from './lib/makeUrlPathRelative'
import {
  getProjectsInDir,
  initializeProjectDirectory,
  PROJECT_ENTRYPOINT,
} from './lib/tauriFS'
import DownloadAppBanner from './components/DownloadAppBanner'
import { WasmErrBanner } from './components/WasmErrBanner'
import { GlobalStateProvider } from './components/GlobalStateProvider'
import {
  SETTINGS_PERSIST_KEY,
  settingsMachine,
} from './machines/settingsMachine'
import { ContextFrom } from 'xstate'
import CommandBarProvider, {
  CommandBar,
} from 'components/CommandBar/CommandBar'
import ModelingMachineProvider from 'components/ModelingMachineProvider'
import { KclContextProvider, kclManager } from 'lang/KclSingleton'
import FileMachineProvider from 'components/FileMachineProvider'
import { join, sep } from '@tauri-apps/api/path'
import { paths } from 'lib/paths'
import type { IndexLoaderData, HomeLoaderData, FileEntry } from 'lib/types'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { invoke } from '@tauri-apps/api/core'

export const BROWSER_FILE_NAME = 'new'

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
        <KclContextProvider>
          <Auth>
            <FileMachineProvider>
              <ModelingMachineProvider>
                <Outlet />
                <App />
                <CommandBar />
              </ModelingMachineProvider>
              <WasmErrBanner />
            </FileMachineProvider>
            {!isTauri() && import.meta.env.PROD && <DownloadAppBanner />}
          </Auth>
        </KclContextProvider>
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
          const projectAndFile = decodedId.replace(defaultDir + sep(), '')
          const firstSlashIndex = projectAndFile.indexOf(sep())
          const projectName = projectAndFile.slice(0, firstSlashIndex)
          const projectPath = await join(defaultDir, projectName)
          const currentFileName = projectAndFile.slice(firstSlashIndex + 1)

          if (firstSlashIndex === -1 || !currentFileName)
            return redirect(
              `${paths.FILE}/${encodeURIComponent(
                await join(params.id, PROJECT_ENTRYPOINT)
              )}`
            )

          // Note that PROJECT_ENTRYPOINT is hardcoded until we support multiple files
          const code = await readTextFile(decodedId)
          const entrypointMetadata = await stat(
            await join(projectPath, PROJECT_ENTRYPOINT)
          )
          const children = await invoke<FileEntry[]>('read_dir_recursive', {
            path: projectPath,
          })
          kclManager.setCodeAndExecute(code, false)

          // Set the file system manager to the project path
          // So that WASM gets an updated path for operations
          fileSystemManager.dir = projectPath

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
          <CommandBar />
        </Auth>
      ),
      loader: async (): Promise<HomeLoaderData | Response> => {
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
        let newDefaultDirectory: string | undefined = undefined
        if (projectDir !== persistedSettings.defaultDirectory) {
          localStorage.setItem(
            SETTINGS_PERSIST_KEY,
            JSON.stringify({
              ...persistedSettings,
              defaultDirectory: projectDir,
            })
          )
          newDefaultDirectory = projectDir
        }
        // TODO: here we're doing recursive instead of non-recursive?
        const projects = await getProjectsInDir(projectDir)

        return {
          projects,
          newDefaultDirectory,
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

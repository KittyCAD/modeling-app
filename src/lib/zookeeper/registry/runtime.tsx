import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import {
  computed,
  effect,
  type ReadonlySignal,
  signal,
} from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { Spinner } from '@src/components/Spinner'
import type { KclManager, ZDSProject } from '@src/lang/KclManager'
import type { BillingRegistryService } from '@src/lib/billing'
import { AreaType, type AreaTypeComponentProps } from '@src/lib/layout/types'
import type {
  ZookeeperSessionController,
  ZookeeperSessionControllerDependencies,
} from '@src/lib/zookeeper/registry/controller'
import { zookeeperPromptRunningSignal } from '@src/lib/zookeeper/zookeeperPromptState'
import {
  type AuthRegistryService,
  authService,
} from '@src/registry/contracts/auth'
import { billingService } from '@src/registry/contracts/billing'
import {
  type DebugRegistryService,
  debugService,
} from '@src/registry/contracts/debug'
import { layoutAreaLibraryValueSpec } from '@src/registry/contracts/layout'
import {
  type ProjectSessionService,
  projectSession,
} from '@src/registry/contracts/projectSession'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import {
  type SystemIORegistryService,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import { lazy, Suspense } from 'react'

const ZookeeperConversationPaneWrapper = lazy(async () => {
  const { ZookeeperConversationPaneWrapper } = await import(
    '@src/lib/zookeeper/components/ZookeeperConversationPaneWrapper'
  )
  return { default: ZookeeperConversationPaneWrapper }
})

type ZookeeperRuntime = ReturnType<typeof createZookeeperRuntime>

type ZookeeperRuntimeServices = {
  auth: ReadonlySignal<AuthRegistryService | undefined>
  billing: ReadonlySignal<BillingRegistryService | undefined>
  debug?: ReadonlySignal<DebugRegistryService | undefined>
  projectSession: ReadonlySignal<ProjectSessionService | undefined>
  settings: ReadonlySignal<SettingsRegistryService | undefined>
  systemIO: ReadonlySignal<SystemIORegistryService | undefined>
}

type ZookeeperSessionControllerModule = {
  createZookeeperSessionController: (
    deps: ZookeeperSessionControllerDependencies
  ) => ZookeeperSessionController
}

type ZookeeperActivation = {
  apiToken: string
  controller?: ZookeeperSessionController
  kclManager: KclManager
  project: ReadonlySignal<ZDSProject | undefined>
  projectId: string | undefined
  projectPath: string
}

const loadZookeeperSessionController = () =>
  import('@src/lib/zookeeper/registry/controller')

const CONTROLLER_LOAD_RETRY_DELAY_MS = 1_000

const pendingSessionDisposals = new Map<string, Promise<void>>()
const pendingEditorDisposals = new WeakMap<KclManager, Promise<void>>()

function trackSessionDisposal(
  projectPath: string,
  kclManager: KclManager,
  disposal: Promise<void>
) {
  pendingSessionDisposals.set(projectPath, disposal)
  pendingEditorDisposals.set(kclManager, disposal)
  const finish = () => {
    if (pendingSessionDisposals.get(projectPath) === disposal) {
      pendingSessionDisposals.delete(projectPath)
    }
    if (pendingEditorDisposals.get(kclManager) === disposal) {
      pendingEditorDisposals.delete(kclManager)
    }
  }
  void disposal.then(finish, (error: unknown) => {
    console.error('Failed to finish stopping the Zookeeper session.', error)
    finish()
  })
}

async function waitForDisposals(disposals: readonly Promise<void>[]) {
  const failures = (await Promise.allSettled(disposals)).flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  )
  if (failures.length === 1) {
    return Promise.reject(failures[0])
  }
  if (failures.length > 1) {
    return Promise.reject(
      new AggregateError(
        failures,
        'One or more Zookeeper sessions failed to stop.'
      )
    )
  }
}

export function createZookeeperRuntime(
  services: ZookeeperRuntimeServices,
  loadController: () => Promise<ZookeeperSessionControllerModule> = loadZookeeperSessionController
) {
  const session = signal<ZookeeperSessionController | undefined>(undefined)
  const currentZdsProject = computed(
    () => services.projectSession.value?.project.value
  )
  const currentProject = computed(
    () => currentZdsProject.value?.projectIORefSignal.value
  )
  let activation: ZookeeperActivation | undefined
  let disposed = false
  let stopObserver: (() => void) | undefined
  let waitingForDisposal: Promise<void> | undefined
  let controllerLoadRetry: ReturnType<typeof setTimeout> | undefined
  let runtimeDisposal: Promise<void> | undefined
  const controllerDisposals = new Set<Promise<void>>()

  const disposeController = (
    controller: ZookeeperSessionController,
    projectPath: string,
    kclManager: KclManager
  ) => {
    const disposal = controller.dispose()
    controllerDisposals.add(disposal)
    trackSessionDisposal(projectPath, kclManager, disposal)
    const finish = () => controllerDisposals.delete(disposal)
    void disposal.then(finish, finish)
  }

  const scheduleControllerLoadRetry = () => {
    if (controllerLoadRetry !== undefined) {
      return
    }
    controllerLoadRetry = setTimeout(() => {
      controllerLoadRetry = undefined
      reconcile()
    }, CONTROLLER_LOAD_RETRY_DELAY_MS)
  }

  const deactivate = () => {
    const previous = activation
    activation = undefined
    session.value = undefined
    if (previous?.controller) {
      disposeController(
        previous.controller,
        previous.projectPath,
        previous.kclManager
      )
    }
  }

  const waitForSessionDisposal = (
    projectPath: string,
    kclManager: KclManager | null | undefined
  ) => {
    const disposal =
      pendingSessionDisposals.get(projectPath) ??
      (kclManager ? pendingEditorDisposals.get(kclManager) : undefined)
    if (!disposal) {
      waitingForDisposal = undefined
      return false
    }
    if (waitingForDisposal !== disposal) {
      waitingForDisposal = disposal
      void disposal.then(
        () => {
          if (waitingForDisposal === disposal) {
            waitingForDisposal = undefined
            reconcile()
          }
        },
        () => {
          if (waitingForDisposal === disposal) {
            waitingForDisposal = undefined
            reconcile()
          }
        }
      )
    }
    return true
  }

  const reconcile = () => {
    if (disposed) {
      return
    }

    const auth = services.auth.value
    const billing = services.billing.value
    const debug = services.debug?.value
    const settings = services.settings.value
    const systemIO = services.systemIO.value
    const project = currentZdsProject.value
    const projectRef = project?.projectIORefSignal.value
    const projectPath = projectRef?.path
    const settingsProjectPath =
      settings?.actor.getSnapshot().context.currentProject?.path
    const settingsProjectId = settings?.current.value.meta.id.current
    const settingsMatchProject = settingsProjectPath === projectPath
    // Settings can lead the project signal during navigation, while folder
    // metadata can lag. Keep an active session stable until their paths agree.
    const projectId = settingsMatchProject
      ? settingsProjectId
      : activation?.projectPath === projectPath
        ? activation?.projectId
        : undefined
    const kclManager = project?.executingEditor.value
    const executingFile = project?.executingFileEntry.value
    const editorReady =
      kclManager !== null &&
      kclManager !== undefined &&
      Boolean(executingFile?.path) &&
      kclManager.path === executingFile?.path
    const apiToken = auth?.token.value ?? ''
    const isLoggedIn = auth?.isLoggedIn.value ?? false

    if (
      activation &&
      (activation.projectPath !== projectPath ||
        activation.projectId !== projectId ||
        (kclManager !== null &&
          kclManager !== undefined &&
          activation.kclManager !== kclManager))
    ) {
      deactivate()
    }
    const currentActivation = activation
    if (
      currentActivation &&
      currentActivation.projectPath === projectPath &&
      currentActivation.projectId === projectId
    ) {
      if (!isLoggedIn) {
        deactivate()
        return
      }
      if (currentActivation.apiToken !== apiToken) {
        currentActivation.apiToken = apiToken
        currentActivation.controller?.updateAuthToken(apiToken)
      }
      return
    }

    if (projectPath && waitForSessionDisposal(projectPath, kclManager)) {
      return
    }

    if (
      !projectPath ||
      !project ||
      !kclManager ||
      !editorReady ||
      !settingsMatchProject ||
      !isLoggedIn ||
      !apiToken.trim() ||
      !auth ||
      !billing ||
      !settings ||
      !systemIO
    ) {
      return
    }

    const next: ZookeeperActivation = {
      apiToken,
      kclManager,
      project: currentZdsProject,
      projectId,
      projectPath,
    }
    activation = next
    void loadController()
      .then(({ createZookeeperSessionController }) => {
        if (disposed || activation !== next) {
          return
        }

        const controller = createZookeeperSessionController({
          apiToken: next.apiToken,
          billing,
          debug,
          kclManager: next.kclManager,
          project: next.project,
          projectId: next.projectId,
          projectPath: next.projectPath,
          systemIO,
        })
        if (disposed || activation !== next) {
          disposeController(controller, next.projectPath, next.kclManager)
          return
        }
        next.controller = controller
        session.value = controller
      })
      .catch((error: unknown) => {
        if (disposed || activation !== next) {
          return
        }
        activation = undefined
        console.error('Failed to start the Zookeeper session.', error)
        scheduleControllerLoadRetry()
      })
  }

  const observe = () => {
    if (disposed || stopObserver) {
      return
    }
    stopObserver = effect(reconcile)
  }

  // Runtime services are installed after registry items are flattened.
  queueMicrotask(observe)

  return {
    currentProject,
    session,
    dispose() {
      if (runtimeDisposal) {
        return runtimeDisposal
      }
      disposed = true
      stopObserver?.()
      clearTimeout(controllerLoadRetry)
      deactivate()
      runtimeDisposal = waitForDisposals([
        ...controllerDisposals,
        ...(waitingForDisposal ? [waitingForDisposal] : []),
      ])
      return runtimeDisposal
    },
  }
}

function ZookeeperPaneLoading({
  layout,
  onClose,
}: Pick<AreaTypeComponentProps, 'layout' | 'onClose'>) {
  return (
    <LayoutPanel
      title={layout.label}
      id={`${layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={layout.id}
        icon="sparkles"
        title="Zookeeper"
        onClose={onClose}
      />
      <output className="flex flex-1 flex-col items-center justify-center text-primary">
        <Spinner />
        <p className="mt-4 text-base">Starting Zookeeper...</p>
      </output>
    </LayoutPanel>
  )
}

export function ZookeeperPaneOutlet({
  areaConfig,
  layout,
  onClose,
  runtime,
}: AreaTypeComponentProps & { runtime: ZookeeperRuntime }) {
  useSignals()
  const project = runtime.currentProject.value
  const controller = runtime.session.value
  const projectPath = project?.path

  if (!project || !controller || controller.projectPath !== projectPath) {
    return <ZookeeperPaneLoading layout={layout} onClose={onClose} />
  }

  return (
    <Suspense
      fallback={<ZookeeperPaneLoading layout={layout} onClose={onClose} />}
    >
      <ZookeeperConversationPaneWrapper
        areaConfig={areaConfig}
        layout={layout}
        onClose={onClose}
        controller={controller}
        theProject={project}
      />
    </Suspense>
  )
}

export const zookeeperPaneRuntimeRegistryItem = defineRegistryItemFactory(
  (ctx) => {
    const runtime = createZookeeperRuntime({
      auth: ctx.services.signal(authService),
      billing: ctx.services.signal(billingService),
      debug: ctx.services.signal(debugService),
      projectSession: ctx.services.signal(projectSession),
      settings: ctx.services.signal(settingsService),
      systemIO: ctx.services.signal(systemIOService),
    })

    const PaneOutlet = (props: AreaTypeComponentProps) => (
      <ZookeeperPaneOutlet {...props} runtime={runtime} />
    )

    return {
      item: defineRuntimeRegistryItem({
        id: 'zookeeper.pane-runtime',
        provides: [
          provide(layoutAreaLibraryValueSpec, {
            [AreaType.Zookeeper]: {
              hide: () => false,
              shortcut: 'Ctrl + T',
              cssClassOverrides: {
                button:
                  'bg-ml-green pressed:bg-transparent dark:!text-chalkboard-100 hover:dark:!text-inherit dark:pressed:!text-inherit',
              },
              getIcon(isOpen) {
                return !isOpen && zookeeperPromptRunningSignal.value
                  ? 'loading'
                  : undefined
              },
              Component: PaneOutlet,
            },
          }),
        ],
        dispose: () => runtime.dispose(),
      }),
    }
  },
  'zookeeper.pane-runtime'
)

import { effect } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import { billingService } from '@src/lib/billing'
import { FactoryButton } from '@src/lib/factory/FactoryButton'
import { createFactoryWorkspace } from '@src/lib/factory/jobs'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsFacet } from '@src/registry/contracts/appHeader'
import { observations } from '@src/registry/contracts/auth'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { contribute, factory } from 'plankton'
import { createElement, useMemo } from 'react'
import { createFactoryFormContext } from '@src/lib/factory/registry/projects'

const workspaceOwner = factory({
  dependencies: { auth: observations },
  create({ auth }) {
    const workspaces = new Map<
      string,
      ReturnType<typeof createFactoryWorkspace>
    >()
    const clear = () => {
      for (const workspace of workspaces.values()) workspace.dispose()
      workspaces.clear()
    }
    function FactoryHeaderItem({ app }: AppHeaderItemProps) {
      useSignals()
      const project = app.projectSignal.value
      const user = app.auth.user.value
      const token = app.auth.token.value
      const organization =
        app.registry.optional(billingService)?.context.value.isOrg
      const local =
        project?.projectIORefSignal.value.libraryType !==
        CLOUD_PROJECT_LIBRARY_TYPE
      const context = useMemo(
        () =>
          createFactoryFormContext(app, {
            project,
            token,
            userId: user?.id,
            organization,
            local,
          }),
        [app, project, user?.id, token, organization, local]
      )
      if (!project) return null
      const key = JSON.stringify([
        user?.id,
        app.registry.optional(billingService)?.context.value.isOrg,
        project.path,
      ])
      let workspace = workspaces.get(key)
      if (!workspace) {
        workspace = createFactoryWorkspace()
        workspaces.set(key, workspace)
      }
      return createElement(FactoryButton, { key, context, workspace })
    }
    return {
      items: [
        contribute(appHeaderItemsFacet, () => ({
          id: 'factory.open',
          order: 105,
          Component: FactoryHeaderItem,
        })),
      ],
      start: () => {
        let previous: string | undefined
        return effect(() => {
          const current = auth.authService.current.value
          const account = current?.token.value
            ? current.user.value?.id
            : undefined
          if (account !== previous) clear()
          previous = account
        })
      },
      dispose: clear,
    }
  },
})

export default createZdsPlugin({
  id: 'factory',
  title: 'Submit to Factory',
  description: 'Submit project entry points as manufacturing jobs.',
  items: [workspaceOwner],
  defaultSetting: 'core',
  activationSetting: {
    category: 'plugins',
    settingName: 'factory',
    hideOnLevel: 'project',
    hideWithoutFeature: 'factory_portal',
    featurePolicy: {
      feature: 'factory_portal',
      defaultEnabled: true,
      disableWithoutFeature: true,
    },
  },
})

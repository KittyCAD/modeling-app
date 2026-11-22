import { createElement } from 'react'
import toast from 'react-hot-toast'
import { useSignals } from '@preact/signals-react/runtime'
import { effect } from '@preact/signals-core'
import { settingsPagesFacet } from '@src/registry/contracts/settingsPages'
import { settingsContributionAdapter } from '@src/lib/communityPlugins/settings/adapter'
import { createPluginInstallations } from '@src/lib/communityPlugins/installations'
import {
  createFilePluginStorage,
  type PluginStorage,
} from '@src/lib/communityPlugins/persistence'
import { communityPluginsService } from '@src/lib/communityPlugins/registry/contract'
import { observations as filesObservations } from '@src/registry/contracts/fileOperations'
import { readTextFile } from '@src/lib/fileSystem/readTextFile'
import fsZds from '@src/lib/fs-zds'
import type { PluginRuntime } from '@src/lib/communityPlugins/runtime'
import type { PluginSource } from '@src/lib/communityPlugins/source'
import {
  communityContributionAdaptersFacet,
  prepareContributions,
  type CommunityContributionAdapter,
  type CommunityContributionOwner,
} from '@src/lib/communityPlugins/contributions'
import { pluginCompiler } from '@src/lib/communityPlugins/executor'
import { PluginBuilder } from '@src/lib/communityPlugins/PluginBuilder'
import {
  createPluginSession,
  type PluginSession,
} from '@src/lib/communityPlugins/session'
import { matchesPluginSource } from '@src/lib/communityPlugins/source'
import {
  editorCapabilityFacet,
  editorViewsFacet,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import {
  observations as executorsObservations,
  executorCapabilityFacet,
} from '@src/lib/executors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { isErr, reportRejection, trap } from '@src/lib/trap'
import {
  GLOBAL_COMMAND_SCOPES,
  provideCommand,
} from '@src/registry/contracts/commands'
import { factory, contribute, slot, provide, type Extension } from 'plankton'

const commandAdapter: CommunityContributionAdapter = {
  kind: 'command',
  requiredPermissions: [],
  prepare: (value, { namespace, invoke, manifest }) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(value.id) ||
      !('title' in value) ||
      typeof value.title !== 'string' ||
      !value.title.trim() ||
      value.title.length > 120
    ) {
      return new Error('Commands require a short id and title.')
    }
    if (
      !('run' in value) ||
      !value.run ||
      typeof value.run !== 'object' ||
      !('callback' in value.run) ||
      typeof value.run.callback !== 'number' ||
      !Number.isInteger(value.run.callback) ||
      value.run.callback < 0 ||
      value.run.callback >= 128
    )
      return new Error('Expected a command callback')
    const callback = value.run.callback
    return provideCommand({
      id: `${namespace}.${value.id}`,
      name: `${namespace}.${value.id}`,
      displayName: `${manifest.name}: ${value.title}`,
      groupId: namespace,
      scopes: GLOBAL_COMMAND_SCOPES,
      needsReview: false,
      onSubmit: () => {
        const error = invoke(callback)
        if (error) trap(error)
      },
    })
  },
}

export const createCommunityPluginsExtension = (storage?: PluginStorage) =>
  factory({
    dependencies: {
      executors: executorsObservations,
      files: filesObservations,
    },
    create: ({ executors, files }, scope) => {
      const content = slot([])
      const adapters = scope.observe(communityContributionAdaptersFacet)
      const settingsPages = scope.observe(settingsPagesFacet)
      const sessions = new Map<Editor, PluginSession>()
      const retiring = new Set<Promise<void>>()
      const installed = new Map<string, readonly Extension[]>()
      let nextInstallation = 0
      let pending = Promise.resolve()
      let disposed = false
      const publish = (
        namespace: string,
        runtime: PluginRuntime | undefined,
        source?: PluginSource,
        grants?: ReadonlySet<string>,
        owner: CommunityContributionOwner = { kind: 'preview' }
      ) => {
        const update = pending.then(async () => {
          if (disposed)
            return runtime ? new Error('Plugin host is closed') : undefined
          const items =
            runtime && source && grants
              ? prepareContributions(
                  runtime,
                  source.manifest,
                  namespace,
                  grants,
                  adapters.value,
                  owner
                )
              : []
          if (isErr(items)) return items
          const next = new Map(installed)
          if (runtime) next.set(namespace, items)
          else next.delete(namespace)
          try {
            await scope.replace(content, [...next.values()])
            installed.clear()
            for (const [id, value] of next) installed.set(id, value)
            return undefined
          } catch (cause) {
            return isErr(cause) ? cause : new Error(String(cause))
          }
        })
        pending = update.then(
          () => {},
          () => {}
        )
        return update
      }
      const installations = createPluginInstallations({
        storage: async () => {
          if (storage) return storage
          const { getAppSettingsFilePath } = await import('@src/lib/desktop')
          const path = fsZds.join(
            fsZds.dirname(await getAppSettingsFilePath()),
            'community-plugins.toml'
          )
          return createFilePluginStorage(
            files.fileOperationsService.required(),
            path
          )
        },
        readSource: (path) =>
          readTextFile(files.fileOperationsService.required(), path),
        publish: (id, runtime, source, grants) =>
          publish(`community.installed-${id}`, runtime, source, grants, {
            kind: 'community',
            installationId: id,
          }),
        getSettingsPage: (id) =>
          settingsPages.value.find(
            (page) =>
              page.owner.kind === 'community' &&
              page.owner.installationId === id
          ),
        notify: (message) => {
          toast(message)
        },
      })
      const capability = {
        id: 'communityPlugins.development',
        matches: matchesPluginSource,
        setup: ({
          editor,
          onDispose,
        }: {
          editor: Editor
          onDispose: (fn: () => void) => void
        }) => {
          const lease = executors.executorsService
            .required()
            .acquireExecutor(editor)
          if (isErr(lease)) return lease
          const namespace = `community.local-${++nextInstallation}`
          const session = createPluginSession(
            (runtime, source, grants) =>
              publish(namespace, runtime, source, grants),
            (message) => {
              toast(message)
            }
          )
          sessions.set(editor, session)
          const unsubscribe = effect(() => {
            const output = lease.executor.output.value
            const compiled = output.get(pluginCompiler)?.source
            if (compiled) void session.update(compiled).catch(reportRejection)
            const path = editor.src.value
            const result = compiled ?? output.errors[pluginCompiler.id]
            if (path && result)
              installations.updateDevelopment(path, result, editor.id)
          })
          onDispose(() => {
            unsubscribe()
            lease.release()
            sessions.delete(editor)
            installations.releaseDevelopment(editor.id)
            const closing = session.dispose().catch(reportRejection)
            retiring.add(closing)
            void closing
              .then(() => retiring.delete(closing))
              .catch(reportRejection)
          })
          return undefined
        },
      }
      const builder = defineEditorView(({ editor, onDispose }) => {
        const session = sessions.get(editor)
        if (!session)
          return new Error('Plugin development session is unavailable')
        const lease = executors.executorsService
          .required()
          .acquireExecutor(editor)
        if (isErr(lease)) return lease
        onDispose(lease.release)
        return { session, executor: lease.executor }
      })({
        id: 'communityPlugins.builder',
        label: 'Plugin Builder',
        matches: matchesPluginSource,
        Component: ({ context }) => {
          useSignals()
          const output = context.executor.output.value
          return createElement(PluginBuilder, {
            source: output.get(pluginCompiler)?.source,
            error: output.errors[pluginCompiler.id],
            session: context.session,
            installations,
            path: context.executor.editor.src.value,
          })
        },
      })
      return {
        start: () => {
          let started = false
          return effect(() => {
            if (
              started ||
              (!storage && !files.fileOperationsService.current.value)
            )
              return
            started = true
            void installations.restore().catch(reportRejection)
          })
        },
        items: [
          content,
          provide(communityPluginsService, {
            ...installations,
            settled: async () => {
              let previous: Promise<void>
              do {
                previous = pending
                await installations.settled()
                await Promise.all(
                  [...sessions.values()].map((session) => session.settled())
                )
                await Promise.all(retiring)
                await pending
              } while (previous !== pending || retiring.size > 0)
            },
          }),
          contribute(communityContributionAdaptersFacet, () => commandAdapter),
          contribute(
            communityContributionAdaptersFacet,
            () => settingsContributionAdapter
          ),
          contribute(executorCapabilityFacet, () => pluginCompiler),
          contribute(editorCapabilityFacet, () => capability),
          contribute(editorViewsFacet, () => builder),
        ],
        dispose: async () => {
          disposed = true
          await installations.dispose()
          await Promise.all(
            [...sessions.values()].map((session) => session.dispose())
          )
          await Promise.all(retiring)
          await pending
        },
      }
    },
  })

export default withProjectShellFeature(
  createCommunityPluginsExtension(),
  'communityPlugins'
)

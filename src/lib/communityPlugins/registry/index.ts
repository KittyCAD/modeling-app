import { createElement } from 'react'
import toast from 'react-hot-toast'
import { useSignals } from '@preact/signals-react/runtime'
import { effect } from '@preact/signals-core'
import {
  communityContributionAdaptersFacet,
  prepareContributions,
  type CommunityContributionAdapter,
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
import { factory, contribute, slot, type Extension } from 'plankton'

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

const extension = factory({
  dependencies: { executors: executorsObservations },
  create: ({ executors }, scope) => {
    const content = slot([])
    const adapters = scope.observe(communityContributionAdaptersFacet)
    const sessions = new Map<Editor, PluginSession>()
    const installed = new Map<string, readonly Extension[]>()
    let nextInstallation = 0
    let pending = Promise.resolve()
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
          (runtime, source, grants) => {
            const update = pending.then(async () => {
              const items =
                runtime && source && grants
                  ? prepareContributions(
                      runtime,
                      source.manifest,
                      namespace,
                      grants,
                      adapters.value
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
          },
          (message) => {
            toast(message)
          }
        )
        sessions.set(editor, session)
        const unsubscribe = effect(() => {
          const compiled =
            lease.executor.output.value.get(pluginCompiler)?.source
          if (compiled) void session.update(compiled).catch(reportRejection)
        })
        onDispose(() => {
          unsubscribe()
          lease.release()
          sessions.delete(editor)
          void session.dispose().catch(reportRejection)
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
        })
      },
    })
    return {
      items: [
        content,
        contribute(communityContributionAdaptersFacet, () => commandAdapter),
        contribute(executorCapabilityFacet, () => pluginCompiler),
        contribute(editorCapabilityFacet, () => capability),
        contribute(editorViewsFacet, () => builder),
      ],
      dispose: async () => {
        await Promise.all(
          [...sessions.values()].map((session) => session.dispose())
        )
        await pending
      },
    }
  },
})

export default withProjectShellFeature(extension, 'communityPlugins')

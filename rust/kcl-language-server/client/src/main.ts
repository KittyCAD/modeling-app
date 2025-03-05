/* eslint suggest-no-throw/suggest-no-throw: 0 */
import * as vscode from 'vscode'
import type * as lc from 'vscode-languageclient/node'

import * as commands from './commands'
import { type CommandFactory, Ctx, fetchWorkspace } from './ctx'
import { setContextValue } from './util'

const KCL_PROJECT_CONTEXT_NAME = 'inKclProject'

export interface KclAnalyzerExtensionApi {
  readonly client?: lc.LanguageClient
}

export async function deactivate() {
  await setContextValue(KCL_PROJECT_CONTEXT_NAME, undefined)
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<KclAnalyzerExtensionApi> {
  const ctx = new Ctx(context, createCommands(), fetchWorkspace())
  // VS Code doesn't show a notification when an extension fails to activate
  // so we do it ourselves.
  const api = await activateServer(ctx).catch((err) => {
    void vscode.window.showErrorMessage(
      `Cannot activate kcl-language-server extension: ${err.message}`
    )
    throw err
  })
  await setContextValue(KCL_PROJECT_CONTEXT_NAME, true)
  return api
}

async function activateServer(ctx: Ctx): Promise<KclAnalyzerExtensionApi> {
  await ctx.start()
  return ctx
}

function createCommands(): Record<string, CommandFactory> {
  return {
    restartServer: {
      enabled: (ctx) => async () => {
        await ctx.restart()
      },
      disabled: (ctx) => async () => {
        await ctx.start()
      },
    },
    startServer: {
      enabled: (ctx) => async () => {
        await ctx.start()
        ctx.setServerStatus({
          health: 'ok',
          quiescent: true,
        })
      },
      disabled: (ctx) => async () => {
        await ctx.start()
        ctx.setServerStatus({
          health: 'ok',
          quiescent: true,
        })
      },
    },
    stopServer: {
      enabled: (ctx) => async () => {
        // FIXME: We should reuse the client, that is ctx.deactivate() if none of the configs have changed
        await ctx.stopAndDispose()
        ctx.setServerStatus({
          health: 'stopped',
        })
      },
      disabled: (_) => async () => {},
    },
    serverVersion: { enabled: commands.serverVersion },
    openLogs: { enabled: commands.openLogs },
  }
}

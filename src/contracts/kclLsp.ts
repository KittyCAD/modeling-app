import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

export type LanguageServerStatus = 'idle' | 'starting' | 'running' | 'failed'

/**
 * The KCL language server, as the rest of the app sees it.
 *
 * Almost nothing: the editor gets its completion and hover through a contributed
 * capability, so the only reasons to hold this are to show whether the server is
 * up and to answer the one question two features would otherwise both answer.
 */
export interface KclLanguageServerService {
  readonly status: ReadonlySignal<LanguageServerStatus>
  readonly error: ReadonlySignal<string | null>
  /**
   * Whether this service is publishing diagnostics for a language.
   *
   * Both the language server and the analysis executor produce diagnostics for
   * KCL, and CodeMirror's lint state has one writer's worth of room — two
   * writers means whichever ran last wins, silently. So the server states that
   * it owns the gutter and the executor asks before writing.
   */
  ownsDiagnosticsFor(languageId: string): boolean
}

export const kclLspContract = defineContract({
  kclLanguageServerService:
    defineService<KclLanguageServerService>('kclLsp.service'),
})

export const { kclLanguageServerService } = kclLspContract

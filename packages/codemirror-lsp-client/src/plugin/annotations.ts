import { hasNextSnippetField, pickedCompletion } from '@codemirror/autocomplete'
import { Annotation, Transaction } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'

export enum LspAnnotation {
  SemanticTokens = 'semantic-tokens',
  FormatCode = 'format-code',
  Diagnostics = 'diagnostics',
}

const lspEvent = Annotation.define<LspAnnotation>()
export const lspSemanticTokensEvent = lspEvent.of(LspAnnotation.SemanticTokens)
export const lspFormatCodeEvent = lspEvent.of(LspAnnotation.FormatCode)
export const lspDiagnosticsEvent = lspEvent.of(LspAnnotation.Diagnostics)

export enum TransactionAnnotation {
  Remote = 'remote',
  UserSelect = 'user.select',
  UserInput = 'user.input',
  UserMove = 'user.move',
  UserDelete = 'user.delete',
  UserUndo = 'user.undo',
  UserRedo = 'user.redo',

  SemanticTokens = 'SemanticTokens',
  FormatCode = 'FormatCode',
  Diagnostics = 'Diagnostics',

  PickedCompletion = 'PickedCompletion',
}

export interface TransactionInfo {
  annotations: TransactionAnnotation[]
  time: number | null
  docChanged: boolean
  addToHistory: boolean
  inSnippet: boolean
  transaction: Transaction
}

export const updateInfo = (update: ViewUpdate): TransactionInfo[] => {
  let transactionInfos: TransactionInfo[] = []

  for (const tr of update.transactions) {
    let annotations: TransactionAnnotation[] = []

    if (tr.isUserEvent('select')) {
      annotations.push(TransactionAnnotation.UserSelect)
    }

    if (tr.isUserEvent('input')) {
      annotations.push(TransactionAnnotation.UserInput)
    }
    if (tr.isUserEvent('delete')) {
      annotations.push(TransactionAnnotation.UserDelete)
    }
    if (tr.isUserEvent('undo')) {
      annotations.push(TransactionAnnotation.UserUndo)
    }
    if (tr.isUserEvent('redo')) {
      annotations.push(TransactionAnnotation.UserRedo)
    }
    if (tr.isUserEvent('move')) {
      annotations.push(TransactionAnnotation.UserMove)
    }

    if (tr.annotation(pickedCompletion) !== undefined) {
      annotations.push(TransactionAnnotation.PickedCompletion)
    }

    if (tr.annotation(lspSemanticTokensEvent.type) !== undefined) {
      annotations.push(TransactionAnnotation.SemanticTokens)
    }

    if (tr.annotation(lspFormatCodeEvent.type) !== undefined) {
      annotations.push(TransactionAnnotation.FormatCode)
    }

    if (tr.annotation(lspDiagnosticsEvent.type) !== undefined) {
      annotations.push(TransactionAnnotation.Diagnostics)
    }

    if (tr.annotation(Transaction.remote) !== undefined) {
      annotations.push(TransactionAnnotation.Remote)
    }

    transactionInfos.push({
      annotations,
      time: tr.annotation(Transaction.time) || null,
      docChanged: tr.docChanged,
      addToHistory: tr.annotation(Transaction.addToHistory) || false,
      inSnippet: hasNextSnippetField(update.state),
      transaction: tr,
    })
  }

  return transactionInfos
}

export interface RelevantUpdate {
  overall: boolean
  userSelect: boolean
  time: number | null
}

export const relevantUpdate = (update: ViewUpdate): RelevantUpdate => {
  const infos = updateInfo(update)
  // Make sure we are not in a snippet
  if (infos.some((info) => info.inSnippet)) {
    return {
      overall: false,
      userSelect: false,
      time: null,
    }
  }
  return {
    overall: infos.some(
      (info) =>
        info.docChanged ||
        info.annotations.includes(TransactionAnnotation.UserInput) ||
        info.annotations.includes(TransactionAnnotation.UserDelete) ||
        info.annotations.includes(TransactionAnnotation.UserUndo) ||
        info.annotations.includes(TransactionAnnotation.UserRedo) ||
        info.annotations.includes(TransactionAnnotation.UserMove)
    ),
    userSelect: infos.some((info) =>
      info.annotations.includes(TransactionAnnotation.UserSelect)
    ),
    time: infos.length ? infos[0].time : null,
  }
}

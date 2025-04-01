import { highlightingFor } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { StateEffect, StateField } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { Decoration, EditorView } from '@codemirror/view'
import type { Tag } from '@lezer/highlight'
import { tags } from '@lezer/highlight'

import { lspSemanticTokensEvent } from './lsp'

export interface SemanticToken {
  from: number
  to: number
  type: string
  modifiers: string[]
}

export const addToken = StateEffect.define<SemanticToken>({
  map: (token: SemanticToken, change) => ({
    ...token,
    from: change.mapPos(token.from),
    to: change.mapPos(token.to),
  }),
})

export default function lspSemanticTokenExt(): Extension {
  return StateField.define<DecorationSet>({
    create() {
      return Decoration.none
    },
    update(highlights, tr) {
      // Nothing can come before this line, this is very important!
      // It makes sure the highlights are updated correctly for the changes.
      highlights = highlights.map(tr.changes)

      const isSemanticTokensEvent = tr.annotation(lspSemanticTokensEvent.type)
      if (!isSemanticTokensEvent) {
        return highlights
      }

      // Check if any of the changes are addToken
      const hasAddToken = tr.effects.some((e) => e.is(addToken))
      if (hasAddToken) {
        highlights = highlights.update({
          filter: (from, to) => false,
        })
      }

      for (const e of tr.effects)
        if (e.is(addToken)) {
          const tag = getTag(e.value)
          const className = tag
            ? highlightingFor(tr.startState, [tag])
            : undefined

          if (e.value.from < e.value.to && tag) {
            if (className) {
              highlights = highlights.update({
                add: [
                  Decoration.mark({ class: className }).range(
                    e.value.from,
                    e.value.to
                  ),
                ],
              })
            }
          }
        }
      return highlights
    },
    provide: (f) => EditorView.decorations.from(f),
  })
}

export function getTag(semanticToken: SemanticToken): Tag | null {
  let tokenType = convertSemanticTokenTypeToCodeMirrorTag(semanticToken.type)

  if (
    semanticToken.modifiers === undefined ||
    semanticToken.modifiers === null ||
    semanticToken.modifiers.length === 0
  ) {
    return tokenType
  }

  for (let modifier of semanticToken.modifiers) {
    tokenType = convertSemanticTokenToCodeMirrorTag(
      '',
      modifier,
      tokenType || undefined
    )
  }

  return tokenType
}

export function getTagName(semanticToken: SemanticToken): string {
  let tokenType = semanticToken.type

  if (
    semanticToken.modifiers === undefined ||
    semanticToken.modifiers === null ||
    semanticToken.modifiers.length === 0
  ) {
    return tokenType
  }

  for (let modifier of semanticToken.modifiers) {
    tokenType = `${tokenType}.${modifier}`
  }

  return tokenType
}

function convertSemanticTokenTypeToCodeMirrorTag(
  tokenType: string
): Tag | null {
  switch (tokenType) {
    case 'keyword':
      return tags.keyword
    case 'variable':
      return tags.variableName
    case 'string':
      return tags.string
    case 'number':
      return tags.number
    case 'comment':
      return tags.comment
    case 'operator':
      return tags.operator
    case 'function':
      return tags.function(tags.name)
    case 'type':
      return tags.typeName
    case 'property':
      return tags.propertyName
    case 'parameter':
      return tags.local(tags.name)
    default:
      console.error('Unknown token type:', tokenType)
      return null
  }
}

function convertSemanticTokenToCodeMirrorTag(
  tokenType: string,
  tokenModifier: string,
  givenTag?: Tag
): Tag | null {
  let tag = givenTag
    ? givenTag
    : convertSemanticTokenTypeToCodeMirrorTag(tokenType)

  if (!tag) {
    return null
  }

  if (tokenModifier) {
    switch (tokenModifier) {
      case 'definition':
        return tags.definition(tag)
      case 'declaration':
        return tags.definition(tag)
      case 'readonly':
        return tags.constant(tag)
      case 'static':
        return tags.constant(tag)
      case 'defaultLibrary':
        return tags.standard(tag)
      default:
        console.error('Unknown token modifier:', tokenModifier)
        return tag
    }
  }

  return tag
}

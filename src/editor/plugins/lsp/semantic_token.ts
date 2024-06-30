import { Tag, tags } from '@lezer/highlight'

export interface SemanticToken {
  from: number
  to: number
  type: string
  modifiers: string[]
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

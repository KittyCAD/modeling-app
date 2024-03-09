import type * as LSP from 'vscode-languageserver-protocol'

export class SemanticToken {
  delta_line: number
  delta_start: number
  length: number
  token_type: string
  token_modifiers_bitset: string

  constructor(
    delta_line = 0,
    delta_start = 0,
    length = 0,
    token_type = '',
    token_modifiers_bitset = ''
  ) {
    this.delta_line = delta_line
    this.delta_start = delta_start
    this.length = length
    this.token_type = token_type
    this.token_modifiers_bitset = token_modifiers_bitset
  }
}

export function deserializeTokens(
  data: number[],
  semanticTokensProvider?: LSP.SemanticTokensOptions
): SemanticToken[] {
  if (!semanticTokensProvider) {
    return []
  }
  // Check if data length is divisible by 5
  if (data.length % 5 !== 0) {
    throw new Error('Length is not divisible by 5')
  }

  const tokens = []
  for (let i = 0; i < data.length; i += 5) {
    tokens.push(
      new SemanticToken(
        data[i],
        data[i + 1],
        data[i + 2],
        semanticTokensProvider.legend.tokenTypes[data[i + 3]],
        semanticTokensProvider.legend.tokenModifiers[data[i + 4]]
      )
    )
  }

  return tokens
}

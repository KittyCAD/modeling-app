// Extends the codemirror Parser for kcl.

import {
  Parser,
  Input,
  TreeFragment,
  PartialParse,
  Tree,
  NodeType,
  NodeSet,
} from '@lezer/common'
import { LanguageServerClient } from '.'
import { posToOffset } from 'editor/lsp/util'
import { SemanticToken } from './semantic_tokens'
import { DocInput } from '@codemirror/language'
import { tags, styleTags } from '@lezer/highlight'

export default class KclParser extends Parser {
  private client: LanguageServerClient

  constructor(client: LanguageServerClient) {
    super()
    this.client = client
  }

  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[]
  ): PartialParse {
    let parse: PartialParse = new Context(this, input, fragments, ranges)
    return parse
  }

  getTokenTypes(): string[] {
    return this.client.getServerCapabilities().semanticTokensProvider!.legend
      .tokenTypes
  }

  getSemanticTokens(): SemanticToken[] {
    return this.client.getSemanticTokens()
  }
}

class Context implements PartialParse {
  private parser: KclParser
  private input: DocInput
  private fragments: readonly TreeFragment[]
  private ranges: readonly { from: number; to: number }[]

  private nodeTypes: { [key: string]: NodeType }
  stoppedAt: number = 0

  private semanticTokens: SemanticToken[] = []
  private currentLine: number = 0
  private currentColumn: number = 0
  private nodeSet: NodeSet

  constructor(
    /// The parser configuration used.
    parser: KclParser,
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[]
  ) {
    this.parser = parser
    this.input = input as DocInput
    this.fragments = fragments
    this.ranges = ranges

    // Iterate over the semantic token types and create a node type for each.
    this.nodeTypes = {}
    let nodeArray: NodeType[] = []
    this.parser.getTokenTypes().forEach((tokenType, index) => {
      const nodeType = NodeType.define({
        id: index,
        name: tokenType,
        // props: [this.styleTags],
      })
      this.nodeTypes[tokenType] = nodeType
      nodeArray.push(nodeType)
    })

    this.semanticTokens = this.parser.getSemanticTokens()
    const styles = styleTags({
      number: tags.number,
      variable: tags.variableName,
      operator: tags.operator,
      keyword: tags.keyword,
      string: tags.string,
      comment: tags.comment,
      function: tags.function(tags.variableName),
    })
    this.nodeSet = new NodeSet(nodeArray).extend(styles)
  }

  get parsedPos(): number {
    return 0
  }

  advance(): Tree | null {
    if (this.semanticTokens.length === 0) {
      return new Tree(NodeType.none, [], [], 0)
    }
    const tree = this.createTree(this.semanticTokens[0], 0)
    this.stoppedAt = this.input.doc.length
    return tree
  }

  createTree(token: SemanticToken, index: number): Tree {
    const changedLine = token.delta_line !== 0
    this.currentLine += token.delta_line
    if (changedLine) {
      this.currentColumn = 0
    }
    this.currentColumn += token.delta_start

    // Let's get our position relative to the start of the file.
    let currentPosition = posToOffset(this.input.doc, {
      line: this.currentLine,
      character: this.currentColumn,
    })

    const nodeType = this.nodeSet.types[this.nodeTypes[token.token_type].id]

    if (currentPosition === undefined) {
      // This is bad and weird.
      return new Tree(nodeType, [], [], token.length)
    }

    if (index >= this.semanticTokens.length - 1) {
      // We have no children.
      return new Tree(nodeType, [], [], token.length)
    }

    const nextIndex = index + 1
    const nextToken = this.semanticTokens[nextIndex]
    const changedLineNext = nextToken.delta_line !== 0
    const nextLine = this.currentLine + nextToken.delta_line
    const nextColumn = changedLineNext
      ? nextToken.delta_start
      : this.currentColumn + nextToken.delta_start
    const nextPosition = posToOffset(this.input.doc, {
      line: nextLine,
      character: nextColumn,
    })

    if (nextPosition === undefined) {
      // This is bad and weird.
      return new Tree(nodeType, [], [], token.length)
    }

    // Let's get the

    return new Tree(
      nodeType,
      [this.createTree(nextToken, nextIndex)],

      // The positions (offsets relative to the start of this tree) of the children.
      [nextPosition - currentPosition],
      token.length
    )
  }

  stopAt(pos: number) {
    this.stoppedAt = pos
  }
}

// Extends the codemirror Parser for kcl.
// This is really just a no-op parser since we use semantic tokens from the LSP
// server.

import {
  Parser,
  Input,
  TreeFragment,
  PartialParse,
  Tree,
  NodeType,
} from '@lezer/common'
import { DocInput } from '@codemirror/language'

export default class KclParser extends Parser {
  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[]
  ): PartialParse {
    let parse: PartialParse = new Context(input)
    return parse
  }
}

class Context implements PartialParse {
  private input: DocInput

  stoppedAt: number = 0

  constructor(input: Input) {
    this.input = input as DocInput
  }

  get parsedPos(): number {
    return 0
  }

  advance(): Tree | null {
    this.stoppedAt = this.input.doc.length
    return new Tree(NodeType.none, [], [], this.input.doc.length)
  }

  stopAt(pos: number) {
    this.stoppedAt = pos
  }
}

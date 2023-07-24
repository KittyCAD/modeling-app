export class KCLError {
  kind: string | undefined
  sourceRanges: [number, number][]
  msg: string
  constructor(
    kind: string | undefined,
    msg: string,
    sourceRanges: [number, number][],
  ) {
    this.kind = kind
    this.msg = msg
    this.sourceRanges = sourceRanges
    Object.setPrototypeOf(this, KCLError.prototype)
  }
}

export class KCLSyntaxError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('syntax', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSemanticError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('semantic', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSemanticError.prototype)
  }
}

export class KCLTypeError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('type', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLTypeError.prototype)
  }
}

export class KCLUnimplementedError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('unimplemented feature', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLUnimplementedError.prototype)
  }
}

export class KCLValueAlreadyDefined extends KCLError {
  constructor(key: string, sourceRanges: [number, number][]) {
    super('name', `Key ${key} was already defined elsewhere`, sourceRanges)
    Object.setPrototypeOf(this, KCLValueAlreadyDefined.prototype)
  }
}

export class KCLUndefinedValueError extends KCLError {
  constructor(key: string, sourceRanges: [number, number][]) {
    super('name', `Key ${key} has not been defined`, sourceRanges)
    Object.setPrototypeOf(this, KCLUndefinedValueError.prototype)
  }
}

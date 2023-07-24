export class KCLError extends Error {
  constructor(msg: string, kind: string) {
    super(`KCL ${kind} error: ${msg}`)
    Object.setPrototypeOf(this, KCLError.prototype)
  }
}

export class KCLSyntaxError extends KCLError {
  constructor(msg: string) {
    super('syntax', msg)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSemanticError extends KCLError {
  constructor(msg: string) {
    super('semantic', msg)
    Object.setPrototypeOf(this, KCLSemanticError.prototype)
  }
}

export class KCLTypeError extends KCLError {
  constructor(msg: string) {
    super('type', msg)
    Object.setPrototypeOf(this, KCLTypeError.prototype)
  }
}

export class KCLUnimplementedError extends KCLError {
  constructor(msg: string) {
    super('unimplemented feature', msg)
    Object.setPrototypeOf(this, KCLUnimplementedError.prototype)
  }
}

export class KCLValueAlreadyDefined extends KCLError {
  constructor(key: string) {
    super('name', `Key ${key} was already defined elsewhere`)
    Object.setPrototypeOf(this, KCLValueAlreadyDefined.prototype)
  }
}

export class KCLUndefinedValueError extends KCLError {
  constructor(key: string) {
    super('name', `Key ${key} has not been defined`)
    Object.setPrototypeOf(this, KCLUndefinedValueError.prototype)
  }
}

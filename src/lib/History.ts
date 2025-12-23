import { signal } from '@preact/signals-react'

export class History {
  public entries = signal([])
  constructor() {}
}

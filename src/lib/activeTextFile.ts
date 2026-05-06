import { signal } from '@preact/signals-core'
import fsZds from '@src/lib/fs-zds'

export type ActiveTextFile =
  | {
      path: string
      name: string
      text: string
      status: 'ready'
    }
  | {
      path: string
      name: string
      text: ''
      status: 'loading'
    }
  | {
      path: string
      name: string
      text: ''
      status: 'error'
      error: string
    }

export const activeTextFileSignal = signal<ActiveTextFile | null>(null)

let latestOpenRequestId = 0

export function clearActiveTextFile() {
  latestOpenRequestId += 1
  activeTextFileSignal.value = null
}

export async function openActiveTextFile(path: string) {
  const requestId = ++latestOpenRequestId
  const name = fsZds.basename(path)

  activeTextFileSignal.value = {
    path,
    name,
    text: '',
    status: 'loading',
  }

  try {
    const text = await fsZds.readFile(path, { encoding: 'utf-8' })
    if (requestId !== latestOpenRequestId) {
      return
    }
    activeTextFileSignal.value = {
      path,
      name,
      text,
      status: 'ready',
    }
  } catch (error) {
    if (requestId !== latestOpenRequestId) {
      return
    }
    activeTextFileSignal.value = {
      path,
      name,
      text: '',
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

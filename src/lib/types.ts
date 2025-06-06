import type { FileEntry, Project } from '@src/lib/project'
import type CodeManager from '@src/lang/codeManager'
import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import type { KclManager } from '@src/lang/KclSingleton'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { engineStreamMachine } from '@src/machines/engineStreamMachine'
import type { authMachine } from '@src/machines/authMachine'
import type { settingsMachine } from '@src/machines/settingsMachine'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type { ActorRefFrom } from 'xstate'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type { billingMachine } from '@src/machines/billingMachine'

export type IndexLoaderData = {
  code: string | null
  project?: Project
  file?: FileEntry
}

export type FileLoaderData = {
  code: string | null
  project?: FileEntry | Project
  file?: FileEntry
}

export type HomeLoaderData = Record<string, never>

// From the very helpful @jcalz on StackOverflow: https://stackoverflow.com/a/58436959/22753272
type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${'' extends P ? '' : '.'}${P}`
    : never
  : never

type Prev = [
  never,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  ...0[],
]

export type Paths<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends object
    ? {
        [K in keyof T]-?: K extends string | number
          ? `${K}` | Join<K, Paths<T[K], Prev[D]>>
          : never
      }[keyof T]
    : ''

type Idx<T, K> = K extends keyof T
  ? T[K]
  : number extends keyof T
    ? K extends `${number}`
      ? T[number]
      : never
    : never

export type PathValue<
  T,
  P extends Paths<T, 1>,
> = P extends `${infer Key}.${infer Rest}`
  ? Rest extends Paths<Idx<T, Key>, 1>
    ? PathValue<Idx<T, Key>, Rest>
    : never
  : Idx<T, P>

export type Leaves<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends object
    ? { [K in keyof T]-?: Join<K, Leaves<T[K], Prev[D]>> }[keyof T]
    : ''

// Thanks to @micfan on StackOverflow for this utility type:
// https://stackoverflow.com/a/57390160/22753272
export type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>

export function isEnumMember<T extends Record<string, unknown>>(
  v: unknown,
  e: T
) {
  return Object.values(e).includes(v)
}

// utility type to make all *nested* object properties optional
// https://www.geodev.me/blog/deeppartial-in-typescript
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * Replace a function's return type with another type.
 */
export type WithReturnType<F extends (...args: any[]) => any, NewReturn> = (
  ...args: Parameters<F>
) => NewReturn

/**
 * Assert that a function type is async, preserving its parameter types.
 */
export type AsyncFn<F extends (...args: any[]) => any> = WithReturnType<
  F,
  Promise<unknown>
>

export type AppMachineContext = {
  codeManager: CodeManager
  kclManager: KclManager
  engineCommandManager: EngineCommandManager
  sceneInfra: SceneInfra
  sceneEntitiesManager: SceneEntities
  authActor?: ActorRefFrom<typeof authMachine>
  settingsActor?: ActorRefFrom<typeof settingsMachine>
  systemIOActor?: ActorRefFrom<typeof systemIOMachine>
  engineStreamActor?: ActorRefFrom<typeof engineStreamMachine>
  commandBarActor?: ActorRefFrom<typeof commandBarMachine>
  billingActor?: ActorRefFrom<typeof billingMachine>
}

export type FileMeta =
  | {
      type: 'kcl'
      relPath: string
      absPath: string
      fileContents: string
      execStateFileNamesIndex: number
    }
  | {
      type: 'other'
      relPath: string
      data: Blob
    }

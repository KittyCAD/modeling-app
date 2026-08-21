import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import type { FileEntry, Project } from '@src/lib/project'
import type { MlEphantManagerActor } from '@src/lib/zookeeper/mlEphantManagerMachine'

export type ZookeeperProjectRuntime = {
  project: Project | undefined
  projectId: string | undefined
  loaderFile: FileEntry | undefined
  kclManager: KclManager
}

export type ZookeeperService = {
  actor: MlEphantManagerActor
  showManualConnect: ReadonlySignal<boolean>
  isClearingChat: ReadonlySignal<boolean>
  bindProject: (runtime: ZookeeperProjectRuntime) => void
  clearProject: () => void
  reconnect: () => void
  handleNetworkOffline: () => void
  handleNetworkOnline: () => void
  clearChat: () => Promise<void>
  dispose: () => void
}

export const zookeeperContract = defineContract({
  zookeeperService: defineService<ZookeeperService>('zookeeper.service'),
})

export const { zookeeperService } = zookeeperContract

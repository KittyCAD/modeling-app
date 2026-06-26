export const ZOOKEEPER_REASONING_SLEEP_BLOCKER_TYPE =
  'prevent-app-suspension' as const

export type SleepBlocker = {
  start: (type: typeof ZOOKEEPER_REASONING_SLEEP_BLOCKER_TYPE) => number
  stop: (id: number) => boolean
}

export class ZookeeperReasoningSleepBlocker {
  private activeWebContentsIds = new Set<number>()
  private blockerId: number | undefined

  constructor(private readonly sleepBlocker: SleepBlocker) {}

  setActive(webContentsId: number, active: boolean): boolean {
    if (active) {
      this.activeWebContentsIds.add(webContentsId)
    } else {
      this.activeWebContentsIds.delete(webContentsId)
    }

    this.sync()
    return this.isBlocking()
  }

  clear(webContentsId: number): boolean {
    return this.setActive(webContentsId, false)
  }

  isBlocking(): boolean {
    return this.blockerId !== undefined
  }

  getActiveCount(): number {
    return this.activeWebContentsIds.size
  }

  private sync() {
    if (this.activeWebContentsIds.size > 0) {
      if (this.blockerId === undefined) {
        this.blockerId = this.sleepBlocker.start(
          ZOOKEEPER_REASONING_SLEEP_BLOCKER_TYPE
        )
      }
      return
    }

    if (this.blockerId !== undefined) {
      const blockerId = this.blockerId
      this.blockerId = undefined
      this.sleepBlocker.stop(blockerId)
    }
  }
}

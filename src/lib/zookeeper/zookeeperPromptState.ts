import { signal } from '@preact/signals-core'

/**
 * Shared prompt state for app-wide behavior that must remain active while
 * Zookeeper is waiting for a response.
 */
export const zookeeperPromptRunningSignal = signal(false)

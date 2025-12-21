import type { EffectOptions, Signal } from '@preact/signals-core'
import { effect, signal } from '@preact/signals-core'
import { err } from '@src/lib/trap'
import { useSignalEffect } from '@preact/signals-react'
import { isArray } from '@src/lib/utils'

type LiveEventMap = Map<UserTask, Signal<boolean>>

/**
 * A named task that the user might perform while using ZDS
 * that the Zoo team might want to teach them more about with a tip
 * or otherwise follow-up with them about.
 */
export enum UserTask {
  OpenedFeatureTreePane = 'opened-feature-tree',
  UsedExtrude = 'used-extrude',
}

/**
 * A tracking system for one-time events that the user has completed,
 * which are automatically persisted to localStorage (unless `shouldAutoPersist` is turned off).
 *
 * Useful for triggering tips or other user educational content.
 *
 * use the static method `fromPersisted` to instantiate from localStorage.
 */
export class UserTaskTracker {
  private static PERSISTENCE_KEY = 'zds-user-events'
  private eventMap: LiveEventMap = new Map()
  shouldAutoPersist = true

  /**
   * Revive an array of the user's triggered UserEvents from persisted storage.
   *
   * TODO: make persist to disk on desktop, or maybe better, provide the persistence behavior.
   */
  static fromPersisted() {
    const fallback = () => UserTaskTracker.fromArray([])
    const jsonString = globalThis.localStorage.getItem(
      UserTaskTracker.PERSISTENCE_KEY
    )
    if (jsonString === null) {
      return fallback()
    }
    const userEventsArray: UserTask[] = JSON.parse(jsonString, (_, value) =>
      UserTaskTracker.isUserEvent(value) ? value : isArray(value) ? value : null
    )

    return UserTaskTracker.fromArray(userEventsArray)
  }

  /**
   * Instantiate a live set of signals given an array of events
   * that should be instantiated as already "triggered".
   */
  static fromArray(providedEvents: UserTask[]): UserTaskTracker {
    const userEvents = new UserTaskTracker()
    for (const event of Object.values(UserTask)) {
      const found = providedEvents.find((e) => e === event)
      userEvents.eventMap.set(event, signal(Boolean(found)))
    }

    return userEvents
  }

  /**
   * Set the signal value for the user event so that others can get notified.
   * Will return Error if no key is found.
   * Will return false if value is already what is being set.
   * Will return true if value is changed.
   */
  trigger(key: UserTask) {
    const eventSignal = this.getSignal(key)
    if (err(eventSignal)) {
      return eventSignal
    }

    if (eventSignal.value) {
      return false
    } else {
      eventSignal.value = true
      if (this.shouldAutoPersist) {
        this.persist()
        console.log(
          "I've auto-persisted since the values changed",
          this.getTriggeredEvents()
        )
      }
      return true
    }
  }

  /**
   * Subscribe to a user event being triggered (by UserEvents.trigger())
   * outside of React. For use within React, use the `useSubscribe` method hook.
   *
   * Returns `true` if the subscription was established (because the task isn't completed yet),
   * or false if the task is completed and therefore not subscribable.
   */
  subscribe(
    key: UserTask,
    onChange: (value: boolean) => void | Promise<void>,
    options?: EffectOptions
  ) {
    const eventSignal = this.getSignal(key)
    if (err(eventSignal)) {
      return eventSignal
    }

    // No need to subscribe if the event is already `true`
    if (eventSignal.value === true) return false
    // If it false it's worth subscribing to
    effect(() => {
      onChange(eventSignal.value)
    }, options)
    // Notify the caller that we established a subscription
    return true
  }

  /**
   * Subscribe to a user event being triggered (by UserEvents.trigger())
   * within of React. For use within React, use the `subscribe` method.
   *
   * Returns `true` if the subscription was established (because the task isn't completed yet),
   * or false if the task is completed and therefore not subscribable.
   */
  useSubscribe(
    key: UserTask,
    onChange: (value: boolean) => void | Promise<void>,
    options?: EffectOptions
  ) {
    const eventSignal = this.getSignal(key)
    if (err(eventSignal)) {
      return eventSignal
    }

    // No need to subscribe if the event is already `true`
    if (eventSignal.value === true) return false
    // If it false it's worth subscribing to
    useSignalEffect(() => {
      onChange(eventSignal.value)
    }, options)
    // Notify the caller that we established a subscription
    return true
  }

  /**
   * Persist the user events to storage.
   *
   * TODO: make persist to disk on desktop, or maybe better, provide the persistence behavior.
   */
  persist() {
    const jsonString = this.toJSON()
    globalThis.localStorage.setItem(UserTaskTracker.PERSISTENCE_KEY, jsonString)
  }

  /**
   * Return an array of only the triggered events so far.
   */
  private getTriggeredEvents() {
    return this.eventMap
      .entries()
      .filter(([_, signal]) => signal.value)
      .map(([eventName]) => eventName)
      .toArray()
  }

  /**
   * Create a JSON array of the events that have been triggered by the user.
   */
  private toJSON() {
    return JSON.stringify(this.getTriggeredEvents())
  }
  private getSignal(key: UserTask) {
    const eventSignal = this.eventMap.get(key)
    return eventSignal ?? new Error(`No user event with id ${key} found.`)
  }

  private static isUserEvent(e: unknown): e is UserTask {
    return Object.values(UserTask).includes(e as UserTask)
  }
}

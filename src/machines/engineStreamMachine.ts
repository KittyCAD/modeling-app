import type { MutableRefObject } from 'react'
import type { ActorRefFrom } from 'xstate'
import { assign, fromPromise, setup } from 'xstate'
import type { AppMachineContext } from '@src/lib/types'

export enum EngineStreamState {
  Off = 'off',
  On = 'on',
  WaitForMediaStream = 'wait-for-media-stream',
  Playing = 'playing',
  Reconfiguring = 'reconfiguring',
  Paused = 'paused',
  // The is the state in-between Paused and Playing *specifically that order*.
  Resuming = 'resuming',
}

export enum EngineStreamTransition {
  SetMediaStream = 'set-media-stream',
  SetPool = 'set-pool',
  SetAuthToken = 'set-auth-token',
  Play = 'play',
  Resume = 'resume',
  Pause = 'pause',
  StartOrReconfigureEngine = 'start-or-reconfigure-engine',
}

export interface EngineStreamContext {
  pool: string | null
  authToken: string | undefined
  mediaStream: MediaStream | null
  videoRef: MutableRefObject<HTMLVideoElement | null>
  canvasRef: MutableRefObject<HTMLCanvasElement | null>
  zoomToFit: boolean
}

export const engineStreamContextCreate = (): EngineStreamContext => ({
  pool: null,
  authToken: undefined,
  mediaStream: null,
  videoRef: { current: null },
  canvasRef: { current: null },
  zoomToFit: true,
})

export function getDimensions(streamWidth: number, streamHeight: number) {
  const factorOf = 4
  const maxResolution = 2160
  const ratio = Math.min(
    Math.min(maxResolution / streamWidth, maxResolution / streamHeight),
    1.0
  )
  const quadWidth = Math.round((streamWidth * ratio) / factorOf) * factorOf
  const quadHeight = Math.round((streamHeight * ratio) / factorOf) * factorOf
  return { width: quadWidth, height: quadHeight }
}

export async function holdOntoVideoFrameInCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
) {
  await video.pause()
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.style.width = video.videoWidth + 'px'
  canvas.style.height = video.videoHeight + 'px'
  canvas.style.display = 'block'

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
}

export const engineStreamMachine = setup({
  types: {
    context: {} as EngineStreamContext,
    input: {} as EngineStreamContext,
  },
  actors: {
    [EngineStreamTransition.Play]: fromPromise(
      async ({
        input: { context, params, rootContext },
      }: {
        input: {
          context: EngineStreamContext
          params: { zoomToFit: boolean }
          rootContext: AppMachineContext
        }
      }) => {
        const canvas = context.canvasRef.current
        if (!canvas) return false

        const video = context.videoRef.current
        if (!video) return false

        const mediaStream = context.mediaStream
        if (!mediaStream) return false

        // If the video is already playing it means we're doing a reconfigure.
        // We don't want to re-run the KCL or touch the video element at all.
        if (!video.paused) {
          return
        }

        await rootContext.sceneInfra.camControls.restoreRemoteCameraStateAndTriggerSync()

        video.style.display = 'block'
        canvas.style.display = 'none'

        video.srcObject = mediaStream
      }
    ),
    [EngineStreamTransition.Pause]: fromPromise(
      async ({
        input: { context, rootContext },
      }: {
        input: { context: EngineStreamContext; rootContext: AppMachineContext }
      }) => {
        const video = context.videoRef.current
        if (!video) return

        await video.pause()

        const canvas = context.canvasRef.current
        if (!canvas) return

        await holdOntoVideoFrameInCanvas(video, canvas)
        video.style.display = 'none'

        await rootContext.sceneInfra.camControls.saveRemoteCameraState()

        // Make sure we're on the next frame for no flickering between canvas
        // and the video elements.
        window.requestAnimationFrame(
          () =>
            void (async () => {
              // Destroy the media stream. We will re-establish it. We could
              // leave everything at pausing, preventing video decoders from running
              // but we can do even better by significantly reducing network
              // cards also.
              context.mediaStream?.getVideoTracks()[0].stop()
              context.mediaStream = null
              video.srcObject = null

              rootContext.engineCommandManager.tearDown({ idleMode: true })
            })()
        )
      }
    ),
    [EngineStreamTransition.StartOrReconfigureEngine]: fromPromise(
      async ({
        input: { context, event, rootContext },
      }: {
        input: {
          context: EngineStreamContext
          event: any
          rootContext: AppMachineContext
        }
      }) => {
        if (!context.authToken) return

        const video = context.videoRef.current
        if (!video) return

        const canvas = context.canvasRef.current
        if (!canvas) return

        const { width, height } = getDimensions(
          window.innerWidth - 500,
          window.innerHeight
        )

        video.width = width
        video.height = height

        const settingsNext = {
          // override the pool param (?pool=) to request a specific engine instance
          // from a particular pool.
          pool: context.pool,
          ...event.settings,
        }

        rootContext.engineCommandManager.settings = settingsNext

        window.requestAnimationFrame(() => {
          rootContext.engineCommandManager.start({
            setMediaStream: event.onMediaStream,
            setIsStreamReady: (isStreamReady: boolean) => {
              event.setAppState({ isStreamReady })
            },
            width,
            height,
            token: context.authToken,
            settings: settingsNext,
          })

          event.modelingMachineActorSend({
            type: 'Set context',
            data: {
              streamDimensions: {
                streamWidth: width,
                streamHeight: height,
              },
            },
          })
        })
      }
    ),
  },
}).createMachine({
  initial: EngineStreamState.Off,
  context: (initial) => initial.input,
  states: {
    [EngineStreamState.Off]: {
      reenter: true,
      on: {
        [EngineStreamTransition.SetPool]: {
          target: EngineStreamState.Off,
          actions: [assign({ pool: ({ context, event }) => event.data.pool })],
        },
        [EngineStreamTransition.SetAuthToken]: {
          target: EngineStreamState.Off,
          actions: [
            assign({ authToken: ({ context, event }) => event.data.authToken }),
          ],
        },
        [EngineStreamTransition.StartOrReconfigureEngine]: {
          target: EngineStreamState.On,
        },
      },
    },
    [EngineStreamState.On]: {
      reenter: true,
      invoke: {
        src: EngineStreamTransition.StartOrReconfigureEngine,
        input: (args) => ({
          context: args.context,
          rootContext: args.self.system.get('root').getSnapshot().context,
          params: { zoomToFit: args.context.zoomToFit },
          event: args.event,
        }),
      },
      on: {
        // Transition requested by engineConnection
        [EngineStreamTransition.SetMediaStream]: {
          target: EngineStreamState.On,
          actions: [
            assign({ mediaStream: ({ context, event }) => event.mediaStream }),
          ],
        },
        [EngineStreamTransition.Play]: {
          target: EngineStreamState.Playing,
          actions: [assign({ zoomToFit: () => true })],
        },
      },
    },
    [EngineStreamState.Playing]: {
      invoke: {
        src: EngineStreamTransition.Play,
        input: (args) => ({
          context: args.context,
          rootContext: args.self.system.get('root').getSnapshot().context,
          params: { zoomToFit: args.context.zoomToFit },
        }),
      },
      on: {
        [EngineStreamTransition.StartOrReconfigureEngine]: {
          target: EngineStreamState.Reconfiguring,
        },
        [EngineStreamTransition.Pause]: {
          target: EngineStreamState.Paused,
        },
      },
    },
    [EngineStreamState.Reconfiguring]: {
      invoke: {
        src: EngineStreamTransition.StartOrReconfigureEngine,
        input: (args) => ({
          context: args.context,
          rootContext: args.self.system.get('root').getSnapshot().context,
          event: args.event,
        }),
        onDone: {
          target: EngineStreamState.Playing,
        },
      },
    },
    [EngineStreamState.Paused]: {
      invoke: {
        src: EngineStreamTransition.Pause,
        input: (args) => ({
          context: args.context,
          rootContext: args.self.system.get('root').getSnapshot().context,
        }),
      },
      on: {
        [EngineStreamTransition.StartOrReconfigureEngine]: {
          target: EngineStreamState.Resuming,
        },
      },
    },
    [EngineStreamState.Resuming]: {
      reenter: true,
      invoke: {
        src: EngineStreamTransition.StartOrReconfigureEngine,
        input: (args) => ({
          context: args.context,
          rootContext: args.self.system.get('root').getSnapshot().context,
          event: args.event,
        }),
      },
      on: {
        // The stream can be paused as it's resuming.
        [EngineStreamTransition.Pause]: {
          target: EngineStreamState.Paused,
        },
        [EngineStreamTransition.SetMediaStream]: {
          actions: [
            assign({ mediaStream: ({ context, event }) => event.mediaStream }),
          ],
        },
        [EngineStreamTransition.Play]: {
          target: EngineStreamState.Playing,
          actions: [assign({ zoomToFit: () => false })],
        },
      },
    },
  },
})

export type EngineStreamActor = ActorRefFrom<typeof engineStreamMachine>

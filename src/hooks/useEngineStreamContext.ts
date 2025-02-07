import { makeDefaultPlanes, clearSceneAndBustCache } from 'lang/wasm'
import { MutableRefObject } from 'react'
import { setup, assign, fromPromise } from 'xstate'
import { createActorContext } from '@xstate/react'
import { kclManager, sceneInfra, engineCommandManager } from 'lib/singletons'
import { trap } from 'lib/trap'

export enum EngineStreamState {
  Off = 'off',
  On = 'on',
  WaitForMediaStream = 'wait-for-media-stream',
  Playing = 'playing',
  Paused = 'paused',
  // The is the state in-between Paused and Playing *specifically that order*.
  Resuming = 'resuming',
}

export enum EngineStreamTransition {
  SetMediaStream = 'set-context',
  Play = 'play',
  Resume = 'resume',
  Pause = 'pause',
  StartOrReconfigureEngine = 'start-or-reconfigure-engine',
}

export interface EngineStreamContext {
  pool: string | null
  authToken: string | null
  mediaStream: MediaStream | null
  videoRef: MutableRefObject<HTMLVideoElement | null>
  canvasRef: MutableRefObject<HTMLCanvasElement | null>
  zoomToFit: boolean
}

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

const engineStreamMachine = setup({
  types: {
    context: {} as EngineStreamContext,
    input: {} as EngineStreamContext,
  },
  actors: {
    [EngineStreamTransition.Play]: fromPromise(
      async ({
        input: { context, params },
      }: {
        input: { context: EngineStreamContext; params: { zoomToFit: boolean } }
      }) => {
        const canvas = context.canvasRef.current
        if (!canvas) return false

        const video = context.videoRef.current
        if (!video) return false

        const mediaStream = context.mediaStream
        if (!mediaStream) return false

        video.style.display = 'block'
        canvas.style.display = 'none'

        await sceneInfra.camControls.restoreCameraPosition()
        await clearSceneAndBustCache(kclManager.engineCommandManager)

        video.srcObject = mediaStream
        await video.play()

        await kclManager.executeCode(params.zoomToFit)
      }
    ),
    [EngineStreamTransition.Pause]: fromPromise(
      async ({
        input: { context },
      }: {
        input: { context: EngineStreamContext }
      }) => {
        const video = context.videoRef.current
        if (!video) return

        video.pause()

        const canvas = context.canvasRef.current
        if (!canvas) return

        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.style.width = video.videoWidth + 'px'
        canvas.style.height = video.videoHeight + 'px'
        canvas.style.display = 'block'

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        // Make sure we're on the next frame for no flickering between canvas
        // and the video elements.
        window.requestAnimationFrame(() => {
          video.style.display = 'none'

          // Destroy the media stream only. We will re-establish it. We could
          // leave everything at pausing, preventing video decoders from running
          // but we can do even better by significantly reducing network
          // cards also.
          context.mediaStream?.getVideoTracks()[0].stop()
          video.srcObject = null

          sceneInfra.camControls.old = {
            camera: sceneInfra.camControls.camera.clone(),
            target: sceneInfra.camControls.target.clone(),
          }

          engineCommandManager.tearDown({ idleMode: true })
        })
      }
    ),
    [EngineStreamTransition.StartOrReconfigureEngine]: fromPromise(
      async ({
        input: { context, event },
      }: {
        input: { context: EngineStreamContext; event: any }
      }) => {
        if (!context.authToken) return

        const video = context.videoRef.current
        if (!video) return

        const { width, height } = getDimensions(
          window.innerWidth,
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

        engineCommandManager.settings = settingsNext

        engineCommandManager.start({
          setMediaStream: event.onMediaStream,
          setIsStreamReady: (isStreamReady) =>
            event.setAppState({ isStreamReady }),
          width,
          height,
          token: context.authToken,
          settings: settingsNext,
          makeDefaultPlanes: () => {
            return makeDefaultPlanes(kclManager.engineCommandManager)
          },
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
      }
    ),
  },
}).createMachine({
  context: (initial) => initial.input,
  initial: EngineStreamState.Off,
  states: {
    [EngineStreamState.Off]: {
      on: {
        [EngineStreamTransition.StartOrReconfigureEngine]: {
          target: EngineStreamState.On,
        },
      },
    },
    [EngineStreamState.On]: {
      reenter: true,
      invoke: {
        src: EngineStreamTransition.StartOrReconfigureEngine,
        input: (args) => args,
      },
      on: {
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
          params: { zoomToFit: args.context.zoomToFit },
        }),
      },
      on: {
        [EngineStreamTransition.Pause]: {
          target: EngineStreamState.Paused,
        },
      },
    },
    [EngineStreamState.Paused]: {
      invoke: {
        src: EngineStreamTransition.Pause,
        input: (args) => args,
      },
      on: {
        [EngineStreamTransition.StartOrReconfigureEngine]: {
          target: EngineStreamState.Resuming,
        },
      },
    },
    [EngineStreamState.Resuming]: {
      invoke: {
        src: EngineStreamTransition.StartOrReconfigureEngine,
        input: (args) => args,
      },
      on: {
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

export default createActorContext(engineStreamMachine)

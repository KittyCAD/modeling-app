import type { MutableRefObject } from 'react'
import type { ActorRefFrom } from 'xstate'
import { assign, fromPromise, setup } from 'xstate'
import type { AppMachineContext } from '@src/lib/types'
import { EngineConnectionStateType } from '@src/lang/std/engineConnection'
import { reportRejection } from '@src/lib/trap'

export enum EngineStreamState {
  WaitingForDependencies = 'waiting-for-dependencies',
  WaitingForMediaStream = 'waiting-for-media-stream',
  WaitingToPlay = 'waiting-to-play',
  Playing = 'playing',
  Reconfiguring = 'reconfiguring',
  Pausing = 'pausing',
  Paused = 'paused',
  Stopped = 'stopped',
  // The is the state in-between Paused and Playing *specifically that order*.
  Resuming = 'resuming',
}

export enum EngineStreamTransition {
  // This brings us back to the configuration loop
  WaitForDependencies = 'wait-for-dependencies',

  // Our dependencies to set
  SetPool = 'set-pool',
  SetAuthToken = 'set-auth-token',
  SetContainerElementRef = 'set-container-element-ref',
  SetVideoRef = 'set-video-ref',
  SetCanvasRef = 'set-canvas-ref',
  SetMediaStream = 'set-media-stream',

  // Stream operations
  Play = 'play',
  Resume = 'resume',
  Pause = 'pause',
  Stop = 'stop',

  // Used to reconfigure the stream during connection
  StartOrReconfigureEngine = 'start-or-reconfigure-engine',
}

export interface EngineStreamContext {
  pool: string | null
  authToken: string | undefined
  containerElementRef: MutableRefObject<HTMLDivElement | null>
  videoRef: MutableRefObject<HTMLVideoElement | null>
  canvasRef: MutableRefObject<HTMLCanvasElement | null>
  mediaStream: MediaStream | null
  zoomToFit: boolean
}

export const engineStreamContextCreate = (): EngineStreamContext => ({
  pool: null,
  authToken: undefined,
  containerElementRef: { current: null },
  videoRef: { current: null },
  canvasRef: { current: null },
  mediaStream: null,
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
        if (!context.authToken) return Promise.reject()
        if (!context.containerElementRef.current) return Promise.reject()
        if (!context.videoRef.current) return Promise.reject()
        if (!context.canvasRef.current) return Promise.reject()

        const { width, height } = getDimensions(
          context.containerElementRef.current.clientWidth,
          context.containerElementRef.current.clientHeight
        )

        context.videoRef.current.width = width
        context.videoRef.current.height = height

        const settingsNext = {
          // override the pool param (?pool=) to request a specific engine instance
          // from a particular pool.
          pool: context.pool,
          ...event.settings,
        }

        rootContext.engineCommandManager.settings = settingsNext

        window.requestAnimationFrame(() => {
          rootContext.engineCommandManager
            .start({
              width,
              height,
              token: context.authToken,
              settings: settingsNext,
            })
            .catch(reportRejection)

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
    [EngineStreamTransition.Play]: fromPromise(
      async ({
        input: { context, params },
      }: {
        input: { context: EngineStreamContext; params: { zoomToFit: boolean } }
      }) => {
        if (!context.canvasRef.current) return
        if (!context.videoRef.current) return
        if (!context.mediaStream) return

        // If the video is already playing it means we're doing a reconfigure.
        // We don't want to re-run the KCL or touch the video element at all.
        if (!context.videoRef.current.paused) {
          return
        }

        // In the past we'd try to play immediately, but the proper thing is to way
        // for the 'canplay' event to tell us data is ready.
        const onCanPlay = () => {
          if (!context.videoRef.current) {
            return
          }

          context.videoRef.current.play().catch(console.error)

          // Yes, event listeners can remove themselves because of the
          // lazy nature of interpreted languages :D
          context.videoRef.current.removeEventListener('canplay', onCanPlay)
        }

        // We're receiving video frames, so show the video now.
        const onPlay = () => {
          // We have to give engine time to crunch all the scene setup we
          // ask it to do. As far as I can tell it doesn't block until
          // they are done, so we must wait.
          setTimeout(() => {
            if (!context.videoRef.current) {
              return
            }
            if (!context.canvasRef.current) {
              return
            }

            context.videoRef.current.style.display = 'block'
            context.canvasRef.current.style.display = 'none'

            context.videoRef.current.removeEventListener('play', onPlay)
            // I've tried < 400ms and sometimes it's possible to see a flash
            // and the camera snap.
          }, 400)
        }

        context.videoRef.current.addEventListener('canplay', onCanPlay)
        context.videoRef.current.addEventListener('play', onPlay)

        // THIS ASSIGNMENT IS *EXTREMELY* EFFECTFUL! The amount of logic
        // this triggers is quite far and wide. It drives the above events.
        context.videoRef.current.srcObject = context.mediaStream
      }
    ),

    // Pause is also called when leaving the modeling scene. It's possible
    // then videoRef and canvasRef are now null due to their DOM elements
    // being destroyed.
    [EngineStreamTransition.Pause]: fromPromise(
      async ({
        input: { context, rootContext },
      }: {
        input: {
          context: EngineStreamContext
          rootContext: AppMachineContext
        }
      }) => {
        if (context.videoRef.current && context.canvasRef.current) {
          await context.videoRef.current.pause()

          // It's possible we've already frozen the frame due to a disconnect.
          if (context.videoRef.current.style.display !== 'none') {
            await holdOntoVideoFrameInCanvas(
              context.videoRef.current,
              context.canvasRef.current
            )
            context.videoRef.current.style.display = 'none'
          }
        }

        try {
          await rootContext.sceneInfra.camControls.saveRemoteCameraState()
        } catch (e) {
          console.warn('Save remote camera state timed out', e)
        }

        await new Promise<void>((resolve, reject) => {
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

                if (context.videoRef.current) {
                  context.videoRef.current.srcObject = null
                }

                let oldEngineConnection =
                  rootContext.engineCommandManager.engineConnection
                rootContext.engineCommandManager.tearDown({ idleMode: true })

                let timeoutCheckId: ReturnType<typeof setTimeout>
                const timeoutEjectId = setTimeout(() => {
                  clearTimeout(timeoutCheckId)
                  reject()
                }, 5000)

                const checkClosed = () => {
                  timeoutCheckId = setTimeout(() => {
                    if (
                      oldEngineConnection?.state?.type !==
                      EngineConnectionStateType.Paused
                    ) {
                      checkClosed()
                      return
                    }
                    // Finally disconnected.
                    clearTimeout(timeoutEjectId)
                    resolve()
                  }, 100)
                }
                checkClosed()
              })()
          )
        })

        return {}
      }
    ),
  },
}).createMachine({
  initial: EngineStreamState.WaitingForDependencies,
  context: (initial) => initial.input,
  states: {
    [EngineStreamState.WaitingForDependencies]: {
      on: {
        [EngineStreamTransition.SetPool]: {
          target: EngineStreamState.WaitingForDependencies,
          actions: [assign({ pool: ({ context, event }) => event.pool })],
        },
        [EngineStreamTransition.SetAuthToken]: {
          target: EngineStreamState.WaitingForDependencies,
          actions: [
            assign({ authToken: ({ context, event }) => event.authToken }),
          ],
        },
        [EngineStreamTransition.SetContainerElementRef]: {
          target: EngineStreamState.WaitingForDependencies,
          actions: [
            assign({
              containerElementRef: ({ event }) => event.containerElementRef,
            }),
          ],
        },
        [EngineStreamTransition.SetVideoRef]: {
          target: EngineStreamState.WaitingForDependencies,
          actions: [
            assign({ videoRef: ({ context, event }) => event.videoRef }),
          ],
        },
        [EngineStreamTransition.SetCanvasRef]: {
          target: EngineStreamState.WaitingForDependencies,
          actions: [
            assign({ canvasRef: ({ context, event }) => event.canvasRef }),
          ],
        },
        [EngineStreamTransition.StartOrReconfigureEngine]: {
          target: EngineStreamState.WaitingForMediaStream,
        },
      },
    },
    [EngineStreamState.WaitingForMediaStream]: {
      invoke: {
        src: EngineStreamTransition.StartOrReconfigureEngine,
        input: (args) => ({
          context: args.context,
          rootContext: args.self.system.get('root').getSnapshot().context,
          event: args.event,
        }),
        onError: [
          {
            target: EngineStreamState.WaitingForDependencies,
            reenter: true,
          },
        ],
      },
      on: {
        [EngineStreamTransition.StartOrReconfigureEngine]: {
          target: EngineStreamState.WaitingForMediaStream,
          reenter: true,
        },
        [EngineStreamTransition.SetMediaStream]: {
          target: EngineStreamState.WaitingToPlay,
          actions: [
            assign({ mediaStream: ({ context, event }) => event.mediaStream }),
          ],
        },
      },
    },
    [EngineStreamState.WaitingToPlay]: {
      on: {
        [EngineStreamTransition.Play]: {
          target: EngineStreamState.Playing,
        },
        // We actually failed in between needing to play and sending commands.
        [EngineStreamTransition.StartOrReconfigureEngine]: {
          target: EngineStreamState.WaitingForMediaStream,
          reenter: true,
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
          target: EngineStreamState.Pausing,
        },
        [EngineStreamTransition.Stop]: {
          target: EngineStreamState.Stopped,
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
        onDone: [{ target: EngineStreamState.Playing }],
      },
    },
    [EngineStreamState.Pausing]: {
      invoke: {
        src: EngineStreamTransition.Pause,
        input: (args) => ({
          context: args.context,
          rootContext: args.self.system.get('root').getSnapshot().context,
        }),
        onDone: [{ target: EngineStreamState.Paused }],
        onError: [{ target: EngineStreamState.Stopped }],
      },
    },
    [EngineStreamState.Paused]: {
      on: {
        [EngineStreamTransition.Resume]: {
          target: EngineStreamState.Resuming,
        },
        [EngineStreamTransition.Stop]: {
          target: EngineStreamState.Stopped,
        },
      },
    },
    [EngineStreamState.Stopped]: {
      invoke: {
        src: EngineStreamTransition.Pause,
        input: (args) => ({
          context: args.context,
          rootContext: args.self.system.get('root').getSnapshot().context,
        }),
        onDone: [
          {
            target: EngineStreamState.WaitingForDependencies,
            actions: [
              assign({
                videoRef: { current: null },
                canvasRef: { current: null },
                containerElementRef: { current: null },
              }),
            ],
          },
        ],
      },
    },
    [EngineStreamState.Resuming]: {
      invoke: {
        src: EngineStreamTransition.StartOrReconfigureEngine,
        input: (args) => ({
          context: args.context,
          rootContext: args.self.system.get('root').getSnapshot().context,
          event: args.event,
        }),
        // Usually only fails if there was a disconnection mid-way.
        onError: [
          {
            target: EngineStreamState.WaitingForDependencies,
            reenter: true,
          },
        ],
      },
      on: {
        [EngineStreamTransition.Stop]: {
          target: EngineStreamState.Stopped,
        },
        [EngineStreamTransition.SetMediaStream]: {
          target: EngineStreamState.Playing,
          actions: [
            assign({ mediaStream: ({ context, event }) => event.mediaStream }),
          ],
        },
      },
    },
  },
})

export type EngineStreamActor = ActorRefFrom<typeof engineStreamMachine>

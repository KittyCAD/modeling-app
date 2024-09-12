import { makeDefaultPlanes, modifyGrid } from 'lang/wasm'
import { MouseEventHandler, useEffect, useRef, useState, MutableRefObject } from 'react'
import { createMachine, createActor, setup, assign } from 'xstate'
import { createActorContext } from '@xstate/react'
import { getNormalisedCoordinates } from '../lib/utils'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useModelingContext } from 'hooks/useModelingContext'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { ClientSideScene } from 'clientSideScene/ClientSideSceneComp'
import { btnName } from 'lib/cameraControls'
import { sendSelectEventToEngine } from 'lib/selections'
import { kclManager, engineCommandManager, sceneInfra } from 'lib/singletons'
import {
  EngineCommandManagerEvents,
  EngineConnectionStateType,
  DisconnectingType,
} from 'lang/std/engineConnection'
import { useRouteLoaderData } from 'react-router-dom'
import { PATHS } from 'lib/paths'
import { IndexLoaderData } from 'lib/types'

export enum EngineStreamState {
  Playing = 'playing',
  Paused = 'paused',
  Resuming = 'resuming',
  NotSetup = 'not-setup',
  IsSetup = 'is-setup',
  EngineStartedOrReconfigured = 'engine-started-or-reconfigured',
}

export enum EngineStreamTransition {
  SetContextProperty= 'set-context-property',
  Play = 'play',
  Resume = 'resume',
  Pause = 'pause',
  StartOrReconfigureEngine = 'start-or-reconfigure-engine',
  IsSetup = 'is-setup',
}

export interface EngineStreamContext {
  authToken: string | null,
  mediaStreamRef: MutableRefObject<MediaStream | null>,
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  canvasRef: MutableRefObject<HTMLCanvasElement | null>,
}

function getDimensions(streamWidth: number, streamHeight: number) {
  // Scaling for either portrait or landscape
  const maxHeightResolution = streamWidth > streamHeight ? 1080 : 1920
  const aspectRatio = 16/9
  const height = Math.min(streamHeight, maxHeightResolution)
  const width = height * aspectRatio

  return { width, height }
}

const engineStreamMachine = setup({
    types: {
      context: {} as EngineStreamContext,
      input: {} as EngineStreamContext,
    },
    actions: {
      [EngineStreamTransition.SetContextProperty]({ context, event }) {
        const nextContext = {
          ...context,
          ...event.value,
        }
        assign(nextContext)
        return nextContext.authToken && nextContext.videoRef.current && nextContext.canvasRef.current
      },
      [EngineStreamTransition.Play]({ context }, params: { reconnect: boolean }) {
        const canvas = context.canvasRef.current
        if (!canvas) return false

        const video = context.videoRef.current
        if (!video) return false

        const mediaStream = context.mediaStreamRef.current
        if (!mediaStream) return false

        video.style.display = "block"
        canvas.style.display = "none"

        video.srcObject = mediaStream
        video.play().catch((e) => {
            console.warn('Video playing was prevented', e, video)
        }).then(() => {
          if (params.reconnect) return
          kclManager.executeCode(true)
        })
      },
      [EngineStreamTransition.Pause]({ context }) {
        const video = context.videoRef.current
        if (!video) return

        video.pause()

        const canvas = context.canvasRef.current
        if (!canvas) return

        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.style.display = "block"

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        // Make sure we're on the next frame for no flickering between canvas
        // and the video elements.
        window.requestAnimationFrame(() => {
          video.style.display = "none"

          // Destroy the media stream only. We will re-establish it. We could
          // leave everything at pausing, preventing video decoders from running
          // but we can do even better by significantly reducing network
          // cards also.
          context.mediaStreamRef.current?.getVideoTracks()[0].stop()
          video.srcObject = null
          context.mediaStreamRef.current = null
        })
      },
      async [EngineStreamTransition.StartOrReconfigureEngine]({ context, event: { modelingMachineActorSend, settings, setAppState } }) {
        if (!context.authToken) return

        const { width, height } = getDimensions(
          window.innerWidth,
          window.innerHeight,
        )

        engineCommandManager.settings = settings

        engineCommandManager.start({
          setMediaStream: (mediaStream) => context.mediaStreamRef.current = mediaStream,
          setIsStreamReady: (isStreamReady) => setAppState({ isStreamReady }),
          width,
          height,
          token: context.authToken,
          settings,
          makeDefaultPlanes: () => {
            return makeDefaultPlanes(kclManager.engineCommandManager)
          },
          modifyGrid: (hidden: boolean) => {
            return modifyGrid(kclManager.engineCommandManager, hidden)
          },
        })

        modelingMachineActorSend({
          type: 'Set context',
          data: {
            streamDimensions: {
              streamWidth: width,
              streamHeight: height,
            },
          },
        })
      },
    }
  }).createMachine({
    context: {
      mediaStreamRef: { current: null },
      videoRef: { current: null },
      canvasRef: { current: null },
      authToken: null,
    },
    initial: EngineStreamState.NotSetup,
    states: {
      [EngineStreamState.NotSetup]: {
        on: {
          [EngineStreamTransition.SetContextProperty]: {
            target: EngineStreamState.IsSetup,
            actions: { type: EngineStreamTransition.SetContextProperty },
          },
        }
      },
      [EngineStreamState.IsSetup]: {
        always: {
          target: EngineStreamState.EngineStartedOrReconfigured,
          actions: [ { type: EngineStreamTransition.StartOrReconfigureEngine }  ]
        }
      },
      [EngineStreamState.EngineStartedOrReconfigured]: {
        always: {
          target: EngineStreamState.Playing,
          actions: [ { type: EngineStreamTransition.Play , params: { reconnect: false } } ]
        }
      },
      [EngineStreamState.Playing]: {
        on: {
          [EngineStreamTransition.Pause]: {
            target: EngineStreamState.Paused,
            actions: [ { type: EngineStreamTransition.Pause } ]
          }
        }
      },
      [EngineStreamState.Paused]: {
        on: {
          [EngineStreamTransition.Resume]: {
            target: EngineStreamState.Resuming,
          },
        }
      },
      [EngineStreamState.Resuming]: {
        always: {
          target: EngineStreamState.Playing,
          actions: [ { type: EngineStreamTransition.Play, params: { reconnect: true } } ]
        }
      },
    }
  })

export default createActorContext(engineStreamMachine)



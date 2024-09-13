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
  Off = 'off',
  On = 'on',
  Playing = 'playing',
  Paused = 'paused',
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
  pool: string | null,
  authToken: string | null,
  mediaStream: MediaStream | null,
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  canvasRef: MutableRefObject<HTMLCanvasElement | null>,
}

function getDimensions(streamWidth: number, streamHeight: number) {
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
    actions: {
      [EngineStreamTransition.Play]({ context }) {
        const canvas = context.canvasRef.current
        if (!canvas) return false

        const video = context.videoRef.current
        if (!video) return false

        const mediaStream = context.mediaStream
        if (!mediaStream) return false

        video.style.display = "block"
        canvas.style.display = "none"

        video.srcObject = mediaStream
        video.play().catch((e) => {
            console.warn('Video playing was prevented', e, video)
        }).then(() => {
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
          context.mediaStream?.getVideoTracks()[0].stop()
          video.srcObject = null

          engineCommandManager.tearDown({ idleMode: true })
        })
      },
      async [EngineStreamTransition.StartOrReconfigureEngine]({ context, event }) {
        if (!context.authToken) return

        const video = context.videoRef.current
        if (!video) return

        const { width, height } = getDimensions(
          window.innerWidth,
          window.innerHeight,
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
          setIsStreamReady: (isStreamReady) => event.setAppState({ isStreamReady }),
          width,
          height,
          token: context.authToken,
          settings: settingsNext,
          makeDefaultPlanes: () => {
            return makeDefaultPlanes(kclManager.engineCommandManager)
          },
          modifyGrid: (hidden: boolean) => {
            return modifyGrid(kclManager.engineCommandManager, hidden)
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
      },
      async [EngineStreamTransition.Resume]({ context, event }) {
        // engineCommandManager.engineConnection?.reattachMediaStream()
      },
    }
  }).createMachine({
    context: (initial) => initial.input,
    initial: EngineStreamState.Off,
    states: {
      [EngineStreamState.Off]: {
        on: {
          [EngineStreamTransition.StartOrReconfigureEngine]: {
            target: EngineStreamState.On,
            actions: [{ type: EngineStreamTransition.StartOrReconfigureEngine } ]
          }
        }
      },
      [EngineStreamState.On]: {
        on: {
          [EngineStreamTransition.SetMediaStream]: {
            target: EngineStreamState.On,
            actions: [ assign({ mediaStream: ({ context, event }) => event.mediaStream }) ]
          },
          [EngineStreamTransition.Play]: {
            target: EngineStreamState.Playing,
            actions: [ { type: EngineStreamTransition.Play } ]
          }
        }
      },
      [EngineStreamState.Playing]: {
        on: {
          [EngineStreamTransition.StartOrReconfigureEngine]: {
            target: EngineStreamState.Playing,
            reenter: true,
            actions: [{ type: EngineStreamTransition.StartOrReconfigureEngine } ]
          },
          [EngineStreamTransition.Pause]: {
            target: EngineStreamState.Paused,
            actions: [ { type: EngineStreamTransition.Pause } ]
          }
        }
      },
      [EngineStreamState.Paused]: {
        on: {
          [EngineStreamTransition.StartOrReconfigureEngine]: {
            target: EngineStreamState.Resuming,
            actions: [{ type: EngineStreamTransition.StartOrReconfigureEngine } ]
          },
        }
      },
      [EngineStreamState.Resuming]: {
        on: {
          [EngineStreamTransition.SetMediaStream]: {
            target: EngineStreamState.Resuming,
            actions: [ assign({ mediaStream: ({ context, event }) => event.mediaStream }) ]
          },
          [EngineStreamTransition.Play]: {
            target: EngineStreamState.Playing,
            actions: [ { type: EngineStreamTransition.Play } ]
          }
        }
      },
    }
  })

export default createActorContext(engineStreamMachine)



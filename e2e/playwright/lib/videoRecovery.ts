// Runs in the page via evaluateHandle. Keep this function self-contained.
export function installVideoRecoveryProbe() {
  const video = document.querySelector<HTMLVideoElement>('video#video-stream')
  if (!video) throw new Error('Engine video is missing')
  const oldSource = video.srcObject
  const oldConnection = window.engineCommandManager.connection
  const logStart = window.engineDebugger.logs.length
  let active = true
  let frameCallback: number | undefined
  let pinned:
    | {
        source: HTMLVideoElement['srcObject']
        connection: typeof oldConnection
      }
    | undefined
  let firstFrame: VideoFrameCallbackMetadata | undefined
  let lastFrame: VideoFrameCallbackMetadata | undefined
  let sourceChanged = false

  const identityChanged = () => {
    if (
      pinned &&
      (video.srcObject !== pinned.source ||
        window.engineCommandManager.connection !== pinned.connection ||
        video.srcObject !== pinned.connection?.mediaStream ||
        document.querySelector('video#video-stream') !== video)
    )
      sourceChanged = true
    return sourceChanged
  }
  const ready = () => {
    const connection = window.engineCommandManager.connection
    // Visibility and retained body rows can pass before asynchronous reconnect.
    // Use the existing setup-complete log, after this recovery's source load,
    // rather than the network-connected event that precedes scene replay.
    const logs = window.engineDebugger.logs.slice(logStart)
    const sourceLoaded = logs.findLastIndex(
      (log) => log.message === 'setIsSceneReady(true)'
    )
    const sceneReady = logs.findLastIndex(
      (log) =>
        log.label === 'tryConnecting' &&
        log.message === 'setAppState({ isStreamAcceptingInput: true })'
    )
    return Boolean(
      connection &&
        connection !== oldConnection &&
        video.srcObject &&
        video.srcObject !== oldSource &&
        video.srcObject === connection.mediaStream &&
        connection.peerConnection?.connectionState === 'connected' &&
        sourceLoaded >= 0 &&
        sceneReady > sourceLoaded
    )
  }
  return {
    ready,
    beginPlayback: () => {
      if (!ready()) throw new Error('Replacement stream/scene is not ready')
      if (pinned) throw new Error('Playback measurement already started')
      if (typeof video.requestVideoFrameCallback !== 'function') {
        throw new Error('Presented-frame measurement is unavailable')
      }
      pinned = {
        source: video.srcObject,
        connection: window.engineCommandManager.connection,
      }
      const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (!active || identityChanged()) return
        firstFrame ??= metadata
        lastFrame = metadata
        frameCallback = video.requestVideoFrameCallback(onFrame)
      }
      frameCallback = video.requestVideoFrameCallback(onFrame)
    },
    playback: () => {
      if (identityChanged()) return 'source-changed'
      if (pinned?.connection?.peerConnection?.connectionState !== 'connected')
        return 'not-connected'
      if (
        firstFrame &&
        lastFrame &&
        lastFrame.presentedFrames > firstFrame.presentedFrames + 3 &&
        lastFrame.mediaTime > firstFrame.mediaTime
      )
        return 'advancing'
      return 'waiting'
    },
    stop: () => {
      active = false
      if (frameCallback !== undefined)
        video.cancelVideoFrameCallback(frameCallback)
      const connection = window.engineCommandManager.connection
      return {
        connectionId: connection?.id,
        connectionState: connection?.peerConnection?.connectionState,
        sourceMatchesConnection: video.srcObject === connection?.mediaStream,
        sourceChanged: identityChanged(),
        sceneReady: ready(),
        paused: video.paused,
        readyState: video.readyState,
        firstPresented: firstFrame?.presentedFrames,
        lastPresented: lastFrame?.presentedFrames,
        lastMediaTime: lastFrame?.mediaTime,
      }
    },
  }
}

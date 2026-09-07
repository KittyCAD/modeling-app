// Runs in the page via evaluateHandle. Keep this function self-contained.
// Only this recovery test records these bounded, allowlisted diagnostics.
export function installVideoRecoveryProbe() {
  const video = document.querySelector<HTMLVideoElement>('video#video-stream')
  if (!video) throw new Error('Engine video is missing')
  const oldSource = video.srcObject
  const oldConnection = window.engineCommandManager.connection
  const logStart = window.engineDebugger.logs.length
  const timeline: unknown[] = []
  let omitted = 0
  let active = true
  let sampling = false
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

  const record = (entry: unknown) => {
    if (!active) return
    if (timeline.length === 240) {
      timeline.shift()
      omitted++
    }
    timeline.push(entry)
  }
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
  const snapshot = () => {
    const connection = window.engineCommandManager.connection
    const source = video.srcObject
    const quality = video.getVideoPlaybackQuality()
    const bounds = video.getBoundingClientRect()
    return {
      time: Date.now(),
      monotonicTime: performance.now(),
      connectionId: connection?.id,
      apiCallId: connection?.apiCallId,
      sourceId: source instanceof MediaStream ? source.id : null,
      sourceMatchesConnection: source === connection?.mediaStream,
      sourceChanged: identityChanged(),
      sceneReady: ready(),
      connectionState: connection?.peerConnection?.connectionState,
      iceState: connection?.peerConnection?.iceConnectionState,
      visibility: document.visibilityState,
      paused: video.paused,
      ended: video.ended,
      readyState: video.readyState,
      currentTime: video.currentTime,
      width: video.videoWidth,
      height: video.videoHeight,
      displayWidth: bounds.width,
      displayHeight: bounds.height,
      totalVideoFrames: quality.totalVideoFrames,
      droppedVideoFrames: quality.droppedVideoFrames,
      tracks:
        source instanceof MediaStream
          ? source.getVideoTracks().map((track) => ({
              id: track.id,
              enabled: track.enabled,
              muted: track.muted,
              readyState: track.readyState,
            }))
          : [],
      firstPresented: firstFrame?.presentedFrames,
      lastPresented: lastFrame?.presentedFrames,
      lastMediaTime: lastFrame?.mediaTime,
    }
  }
  const sample = async () => {
    if (!active || sampling) return
    sampling = true
    const connection = window.engineCommandManager.connection
    const state = snapshot()
    try {
      const stats = await connection?.peerConnection?.getStats()
      const inbound: unknown[] = []
      stats?.forEach((report) => {
        if (report.type !== 'inbound-rtp' || report.kind !== 'video') return
        const videoStats = report as RTCInboundRtpStreamStats
        inbound.push({
          id: videoStats.id,
          timestamp: videoStats.timestamp,
          bytesReceived: videoStats.bytesReceived,
          packetsReceived: videoStats.packetsReceived,
          packetsLost: videoStats.packetsLost,
          jitter: videoStats.jitter,
          framesReceived: videoStats.framesReceived,
          framesDecoded: videoStats.framesDecoded,
          framesDropped: videoStats.framesDropped,
          keyFramesDecoded: videoStats.keyFramesDecoded,
          totalDecodeTime: videoStats.totalDecodeTime,
          freezeCount: videoStats.freezeCount,
          pliCount: videoStats.pliCount,
          nackCount: videoStats.nackCount,
        })
      })
      record({ event: 'sample', ...state, inbound })
    } catch {
      record({ event: 'sample', ...state, statsUnavailable: true })
    } finally {
      sampling = false
    }
  }
  const events = [
    'playing',
    'pause',
    'waiting',
    'stalled',
    'emptied',
    'loadeddata',
    'error',
  ]
  const onEvent = (event: Event) => record({ event: event.type, ...snapshot() })
  events.forEach((event) => video.addEventListener(event, onEvent))
  const timer = window.setInterval(() => {
    void sample()
  }, 250)
  void sample()

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
      record({ event: 'playback-start', ...snapshot() })
      const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (!active || identityChanged()) return
        if (!firstFrame)
          record({
            event: 'first-presented-frame',
            time: Date.now(),
            presentedFrames: metadata.presentedFrames,
            mediaTime: metadata.mediaTime,
          })
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
      record({ event: 'stop', ...snapshot() })
      active = false
      clearInterval(timer)
      if (frameCallback !== undefined)
        video.cancelVideoFrameCallback(frameCallback)
      events.forEach((event) => video.removeEventListener(event, onEvent))
      return { omitted, timeline }
    },
  }
}

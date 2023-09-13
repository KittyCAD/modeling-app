import { useEffect, useLayoutEffect } from 'react'
import { useStore } from 'useStore'
import { useGlobalStateContext } from './useGlobalStateContext'
import { EngineCommandManager } from 'lang/std/engineConnection'
import { asyncParser } from 'lang/abstractSyntaxTree'
import { _executor } from 'lang/executor'
import { KCLError } from 'lang/errors'

export function useEngineWithStream(streamRef: React.RefObject<HTMLElement>) {
  const {
    addKCLError,
    addLog,
    defferedCode,
    engineCommandManager,
    highlightRange,
    isStreamReady,
    resetKCLErrors,
    resetLogs,
    setArtifactMap,
    setAst,
    setCursor2,
    setEngineCommandManager,
    setError,
    setHighlightRange,
    setIsExecuting,
    setIsStreamReady,
    setProgramMemory,
    setStreamDimensions,
    setMediaStream,
  } = useStore((s) => ({
    addKCLError: s.addKCLError,
    addLog: s.addLog,
    defferedCode: s.defferedCode,
    engineCommandManager: s.engineCommandManager,
    highlightRange: s.highlightRange,
    isStreamReady: s.isStreamReady,
    resetKCLErrors: s.resetKCLErrors,
    resetLogs: s.resetLogs,
    setArtifactMap: s.setArtifactNSourceRangeMaps,
    setAst: s.setAst,
    setCursor2: s.setCursor2,
    setEngineCommandManager: s.setEngineCommandManager,
    setError: s.setError,
    setHighlightRange: s.setHighlightRange,
    setIsExecuting: s.setIsExecuting,
    setIsStreamReady: s.setIsStreamReady,
    setMediaStream: s.setMediaStream,
    setProgramMemory: s.setProgramMemory,
    setStreamDimensions: s.setStreamDimensions,
  }))
  const {
    auth: {
      context: { token },
    },
  } = useGlobalStateContext()

  const streamWidth = streamRef?.current?.offsetWidth
  const streamHeight = streamRef?.current?.offsetHeight

  const width = streamWidth ? streamWidth : 0
  const quadWidth = Math.round(width / 4) * 4
  const height = streamHeight ? streamHeight : 0
  const quadHeight = Math.round(height / 4) * 4

  useLayoutEffect(() => {
    setStreamDimensions({
      streamWidth: quadWidth,
      streamHeight: quadHeight,
    })
    if (!width || !height) return
    const eng = new EngineCommandManager({
      setMediaStream,
      setIsStreamReady,
      width: quadWidth,
      height: quadHeight,
      token,
    })
    setEngineCommandManager(eng)
    return () => {
      eng?.tearDown()
    }
  }, [
    quadWidth,
    quadHeight,
    setStreamDimensions,
    width,
    height,
    setMediaStream,
    setIsStreamReady,
    token,
    setEngineCommandManager,
  ])

  useEffect(() => {
    if (!isStreamReady) return
    if (!engineCommandManager) return
    let unsubFn: any[] = []
    const asyncWrap = async () => {
      try {
        if (!defferedCode) {
          setAst({
            start: 0,
            end: 0,
            body: [],
            nonCodeMeta: {
              noneCodeNodes: {},
              start: null,
            },
          })
          setProgramMemory({ root: {}, return: null })
          engineCommandManager.endSession()
          engineCommandManager.startNewSession()
          return
        }
        const _ast = await asyncParser(defferedCode)
        setAst(_ast)
        resetLogs()
        resetKCLErrors()
        engineCommandManager.endSession()
        engineCommandManager.startNewSession()
        setIsExecuting(true)
        const programMemory = await _executor(
          _ast,
          {
            root: {
              _0: {
                type: 'UserVal',
                value: 0,
                __meta: [],
              },
              _90: {
                type: 'UserVal',
                value: 90,
                __meta: [],
              },
              _180: {
                type: 'UserVal',
                value: 180,
                __meta: [],
              },
              _270: {
                type: 'UserVal',
                value: 270,
                __meta: [],
              },
            },
            return: null,
          },
          engineCommandManager
        )

        const { artifactMap, sourceRangeMap } =
          await engineCommandManager.waitForAllCommands()
        setIsExecuting(false)
        if (programMemory !== undefined) {
          setProgramMemory(programMemory)
        }

        setArtifactMap({ artifactMap, sourceRangeMap })
        const unSubHover = engineCommandManager.subscribeToUnreliable({
          event: 'highlight_set_entity',
          callback: ({ data }) => {
            if (data?.entity_id) {
              const sourceRange = sourceRangeMap[data.entity_id]
              setHighlightRange(sourceRange)
            } else if (
              !highlightRange ||
              (highlightRange[0] !== 0 && highlightRange[1] !== 0)
            ) {
              setHighlightRange([0, 0])
            }
          },
        })
        const unSubClick = engineCommandManager.subscribeTo({
          event: 'select_with_point',
          callback: ({ data }) => {
            if (!data?.entity_id) {
              setCursor2()
              return
            }
            const sourceRange = sourceRangeMap[data.entity_id]
            setCursor2({ range: sourceRange, type: 'default' })
          },
        })
        unsubFn.push(unSubHover, unSubClick)

        setError()
      } catch (e: any) {
        setIsExecuting(false)
        if (e instanceof KCLError) {
          addKCLError(e)
        } else {
          setError('problem')
          console.log(e)
          addLog(e)
        }
      }
    }
    asyncWrap()
    return () => {
      unsubFn.forEach((fn) => fn())
    }
  }, [defferedCode, isStreamReady, engineCommandManager])
}

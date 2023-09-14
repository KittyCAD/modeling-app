import { useEffect } from 'react'
import { asyncParser } from '../lang/abstractSyntaxTree'
import { _executor } from '../lang/executor'
import { useStore } from '../useStore'
import { KCLError } from '../lang/errors'

// This recently moved out of app.tsx
// and is our old way of thinking that whenever the code changes we need to re-execute, instead of
// being more decisive about when and where we execute, its likey this custom hook will be
// refactored away entirely at some point

export function useCodeEval() {
  const {
    addLog,
    addKCLError,
    setAst,
    setError,
    setProgramMemory,
    resetLogs,
    resetKCLErrors,
    setArtifactMap,
    engineCommandManager,
    highlightRange,
    setHighlightRange,
    setCursor2,
    isStreamReady,
    setIsExecuting,
    defferedCode,
  } = useStore((s) => ({
    addLog: s.addLog,
    defferedCode: s.defferedCode,
    setAst: s.setAst,
    setError: s.setError,
    setProgramMemory: s.setProgramMemory,
    resetLogs: s.resetLogs,
    resetKCLErrors: s.resetKCLErrors,
    setArtifactMap: s.setArtifactNSourceRangeMaps,
    engineCommandManager: s.engineCommandManager,
    highlightRange: s.highlightRange,
    setHighlightRange: s.setHighlightRange,
    setCursor2: s.setCursor2,
    isStreamReady: s.isStreamReady,
    addKCLError: s.addKCLError,
    setIsExecuting: s.setIsExecuting,
  }))
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

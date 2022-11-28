import { useStore } from './useStore'

export const Toolbar = () => {
  const { setGuiMode, guiMode } = useStore(({ guiMode, setGuiMode }) => ({
    guiMode,
    setGuiMode,
  }))
  return (
    <div>
      {guiMode.mode === 'default' && (
        <button
          onClick={() => {
            setGuiMode({
              mode: 'sketch',
              sketchMode: 'selectFace',
            })
          }}
        >
          Start sketch
        </button>
      )}
      {guiMode.mode === 'sketch' && guiMode.sketchMode === 'points' && (
        <button>LineTo TODO</button>
      )}
      {guiMode.mode !== 'default' && (
        <button onClick={() => setGuiMode({ mode: 'default' })}>exit</button>
      )}
    </div>
  )
}

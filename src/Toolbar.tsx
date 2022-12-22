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
          className="border m-1 px-1 rounded"
        >
          Start sketch
        </button>
      )}
      {guiMode.mode === 'canEditSketch' && (
        <button
          onClick={() => {
            setGuiMode({
              mode: 'sketch',
              sketchMode: 'sketchEdit',
              pathToNode: guiMode.pathToNode,
              quaternion: guiMode.quaternion,
            })
          }}
          className="border m-1 px-1 rounded"
        >
          EditSketch
        </button>
      )}

      {guiMode.mode !== 'default' && (
        <button
          onClick={() => setGuiMode({ mode: 'default' })}
          className="border m-1 px-1 rounded"
        >
          Exit sketch
        </button>
      )}
      {guiMode.mode === 'sketch' &&
        (guiMode.sketchMode === 'points' ||
          guiMode.sketchMode === 'sketchEdit') && (
          <button
            className={`border m-1 px-1 rounded ${
              guiMode.sketchMode === 'points' && 'bg-gray-400'
            }`}
            onClick={() =>
              setGuiMode({
                ...guiMode,
                sketchMode:
                  guiMode.sketchMode === 'points' ? 'sketchEdit' : 'points',
              })
            }
          >
            LineTo{guiMode.sketchMode === 'points' && '✅'}
          </button>
        )}
    </div>
  )
}

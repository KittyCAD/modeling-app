import { useEffect, useRef } from "react"
import { MergeView} from '@codemirror/merge'
import {
  EditorState,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {computed} from '@preact/signals-core'
import { kclManager } from '@src/lib/singletons'

async function setDiff(editorRef, mergeViewRef, absoluteFilePath, left, right) {
  const originalFile = await window.electron.readFile(absoluteFilePath, 'utf-8')
  if (mergeViewRef.current) {
    mergeViewRef.current.destroy()
  }
  const mergeView = new MergeView({
    a: {
      doc: left,
      extensions: [
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping
      ]
    },
    b: {
      doc: right,
      extensions: [
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping
      ]
    },
    parent: editorRef.current,
  })


  mergeViewRef.current = mergeView
}

export const DiffView = ({}) => {
  const editor = useRef<HTMLDivElement>(null)
  const mergeView = useRef<MergeView>(null)


  return (<div className="w-full h-full relative overflow-y-auto overflow-x-hidden">
    <div className="w-full h-full flex flex-col">
    <div className="overflow-auto absolute pb-12 inset-0 ">
      {kclManager.history.entries.value.map((e) => {
        console.log("UPDATED!")
        return <div
        className="h-16"
        onClick={() => setDiff(editor, mergeView, e.absoluteFilePath, e.left, e.right)}>
          <h2>{e.absoluteFilePath}</h2>
          <p>{e.dateString}</p>
        </div>
      })}
    </div>
    </div>
    <div ref={editor}>
    </div>
  </div>)
}

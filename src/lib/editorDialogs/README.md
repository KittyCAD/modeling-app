# Editor dialogs

An editor dialog owns a temporary editor, an executor, and a compact host with
Submit, Cancel, and a mode picker. Its modes edit the same document, so Code is
always available alongside a domain-specific form. The host is nonmodal to allow
selection from a modeling scene while editing arguments.

`editorDialogsService.open` takes initial contents, a semantic `documentType`, a
typed executor capability, and `prepareSubmit`. A document type describes what
the buffer means, independently of its language or filename. Views and executor
capabilities can match it through their normal predicates.

Each dialog uses a child registry. Parent views and executor capabilities are
available there, but project editor capabilities such as saving and collaboration
are not copied. The temporary editor never becomes a project tab. Closing the
dialog disposes its editor, executor, and view contexts and restores opener focus.

Submission consumes only a successful result for the current buffer contents.
`prepareSubmit` may await validation; its returned synchronous `commit` performs
the final source edit. If the draft changes or closes during preparation, that
commit is discarded. Failed validation leaves the draft open for correction.
The domain must also reject a stale target at commit time, as the stdlib Extrude
adapter does for its captured execution snapshot.

The command-arguments extension demonstrates this contract with a JSON argument
document, a resolver/reviewer executor capability, and a Form view built from the
existing stdlib schema. Domain objects such as the target model and evaluator
stay in its typed binding rather than being serialized into the draft.

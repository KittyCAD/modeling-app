# Modeling tools

A `modelingTools` contribution advertises a registered command as a toolbar tool.
The toolbar derives the label and description from the command. Tools can set an
icon, group, order, and additional availability rule; tools sharing a group appear
as a primary button with a dropdown of alternatives.

```ts
provide(modelingToolsValueSpec, {
  id: 'kcl.extrude',
  command: { name: 'Extrude', groupId: 'kcl-modeling' },
  icon: 'extrude',
  group: 'Solids',
})
```

A Modeling mode attaches its editor to `modelingToolsService` for the lifetime of
its bound mode context. The attachment supplies an availability callback and a
callback returning command arguments. Invocation checks eligibility again and
reads those arguments at click time. For KCL, the arguments contain the current
execution binding, so toolbar clicks cannot retarget another editor through focus
changes or reuse arguments from an obsolete execution.

The extension contributes its toolbar to the KCL scene's top zone, using the same
zone geometry as legacy engine-scene extensions with a context specific to the
new Modeling mode. Only active modes render the toolbar. Loading, failed, and
outdated executions disable their tools with an explanatory tooltip.

Extrude uses the shared stdlib arguments, viewer-backed evaluation and mock
review, and the existing codemod. The toolbar contains no argument form or AST
editing logic. All argument collection continues through the command palette.

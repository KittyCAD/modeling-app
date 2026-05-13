# `@kittycad/ui-components`

This workspace is the promotion target for components that are ready to move out of the application tree and into a documented, tested library.

## What belongs here

- Components with an app-agnostic API.
- Components with Storybook stories.
- Components with Vitest coverage for rendering and behavior.
- Components that do not depend on app-only state machines, routing, or network clients.

## Commands

- `npm run storybook -w @kittycad/ui-components`
- `npm run build-storybook -w @kittycad/ui-components`
- `npm run test -w @kittycad/ui-components`
- `npm run build -w @kittycad/ui-components`

## Suggested migration flow

1. Keep iterating in `src/components` while the component is tightly coupled to the app.
2. Extract the UI surface into this package once the API settles.
3. Add or expand stories, component tests, and unit tests here before wider reuse.

# Interaction timing policy

Production TypeScript, JavaScript, CSS, Tailwind configuration, and shared UI
components are checked by the normal ESLint command:

- No artificial interaction timers, sleep helpers, debounces, or throttles.
- Animations and transitions must have statically known timing, finish within
  100 ms, and have zero start delay. Indeterminate activity indicators are the
  only duration exception; they cannot delay an interaction.
- Inline ESLint directives cannot disable these guardrails, including blanket
  disables. Existing unrelated rule suppressions still work.

A real transport deadline, storage batch, feedback lifetime, or similar functional
clock needs one adjacent comment identifying its supported category and specific
reason. An exception applies to one site, not its whole file. For example:

```ts
// zds-performance-exception: network-deadline -- Reject a missing acknowledgement without delaying successful commands.
const deadline = setTimeout(rejectMissingAck, commandDeadlineMs)
```

Use actual completion signals for ordering, serial ownership for asynchronous
updates, and cancellation or generation checks for obsolete work. Render-frame
coalescing may keep the latest pointer/resize input, but must flush final drag
input and cancel queued work on owner changes or unmount.

Static lint covers known APIs and common aliases, not arbitrary third-party
runtime behavior. The end-to-end 150 ms usable-outcome measurements remain the
backstop for slow work that contains no explicit wait. The
[before/after animation checkpoint](interaction-performance.md) is historical,
not a measurement of later cache fixes.

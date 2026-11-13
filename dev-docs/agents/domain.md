# Domain docs

Layout: multi-context.

## Read before exploring

Read the root `GLOSSARY-MAP.md` when present. It identifies domain contexts, their code paths, and their glossary and ADR locations. Read the glossaries relevant to the task, including every affected context when work crosses boundaries.

Read relevant system-wide decisions in `dev-docs/adr/` and context-specific ADRs listed by the map.

If domain documents are missing, proceed silently. The `/domain-modeling` skill creates them when terms or decisions are resolved.

## Layout and ownership

The root `GLOSSARY-MAP.md` indexes contexts. Each entry records:

- Context name and scope
- Relevant code paths
- Glossary path
- ADR directory

Keep each context's `GLOSSARY.md` at its project directory root, such as `src/GLOSSARY.md` or `rust/GLOSSARY.md`. Store context-specific ADRs in its `dev-docs/adr/` directory. A context can span several code directories; package and language boundaries do not automatically define domain contexts.

Reserve `dev-docs/adr/` for decisions spanning contexts.

Create the map, context glossaries, and ADRs lazily when there is resolved content to record.

## Vocabulary and decisions

Use terms defined by the relevant context's glossary. Preserve distinctions when the same word has different meanings across contexts.

When a needed concept lacks a definition, check current usage and record the gap for `/domain-modeling`.

Identify conflicts with existing ADRs explicitly, including which decision would need revision.

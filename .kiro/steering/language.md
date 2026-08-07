# Language Convention

All written output in this project is in **English**. This applies to:

- Code comments (`//`, `/** */`, JSX `{/* */}`)
- User-facing UI copy, labels, placeholders and `aria-label` text
- Error messages, warnings and `console.*` output
- Commit messages, spec documents and Markdown docs
- Test names and assertion messages

This supersedes the earlier convention of Spanish comments and Spanish console/error
strings found in older files such as `src/App.tsx` and `src/agentSelection.ts`.

## Migrating legacy Spanish text

Do not run a repo-wide translation. Translate opportunistically instead:

- When you edit a block that contains Spanish comments or strings, rewrite them in English
  as part of that change.
- Leave Spanish text in code you are not otherwise touching, so diffs stay scoped to the
  task at hand.

## Preserved conventions

- Comments keep citing numbered requirements, e.g. `(Requirement 14.1)` or
  `(Requirements 12.5, 12.6)`.
- EARS keywords in spec documents stay uppercase: `WHEN`, `WHILE`, `IF`, `THEN`, `WHERE`,
  `THE`, `SHALL`.

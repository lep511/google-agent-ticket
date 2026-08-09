# Tests

Test infrastructure and cross-cutting tests for Tickr. Unit tests live next to
the code they cover; this folder holds the shared setup, the shared fixture
builders, and the tests that cover that infrastructure itself.

## Layout

```
tests/
├── setup/
│   ├── fastCheck.ts        # global fast-check config, loaded by both projects
│   └── dom.ts              # jest-dom matchers + unmount between tests (web only)
├── helpers/
│   ├── tempCatalog.ts      # builds agent catalogs in a temp directory
│   └── motionStub.tsx      # animation-free stand-in for `motion/react`
├── server/
│   ├── setup.test.ts       # the shared fast-check config is really applied
│   └── tempCatalog.test.ts # the fixture builder agrees with production validation
└── web/
    ├── environment.test.tsx # jsdom + testing-library + user-event are operational
    └── motionStub.test.tsx  # the `motion/react` alias and the stub behave
```

Everything under `tests/` is infrastructure. Behaviour tests belong beside their
module: `server/lib/analyzeInput.test.ts`, `src/interactionHistory.test.ts`, and
so on. Both locations are picked up automatically.

## Running

```bash
npm test                        # whole suite, single run
npm run test:watch              # watch mode
npx vitest --run --project server
npx vitest --run --project web
npx vitest --run src/interactionHistory.test.ts
npm run lint                    # tsc --noEmit, covers the test files too
```

The full suite takes about four minutes. Most of that is the property tests in
`src/App.history.test.tsx`, which mount the whole application a hundred times per
property. Run a single project or a single file while iterating.

## The two projects

`vitest.config.ts` defines two projects with separate environments:

| Project  | Environment | Includes                                          |
|----------|-------------|---------------------------------------------------|
| `server` | `node`      | `server/**/*.test.ts`, `tests/server/**`, `tests/*.test.ts` |
| `web`    | `jsdom`     | `src/**/*.test.{ts,tsx}`, `tests/web/**`          |

Both alias `@` to the repository root. The `web` project additionally aliases
`motion/react` to `tests/helpers/motionStub.tsx` and defines `global` as `window`,
which `amazon-cognito-identity-js` expects in the browser.

Both projects run with `globals: false`, so `describe`, `it`, `expect`, `vi` and
the lifecycle hooks must be imported from `vitest` explicitly. Imports use
explicit `.ts` / `.tsx` extensions, matching `allowImportingTsExtensions` in
`tsconfig.json`.

## Shared setup

### `setup/fastCheck.ts`

Configures fast-check globally so individual properties do not declare their own
budget:

- **at least 100 iterations per property** (`MIN_PROPERTY_RUNS`), per the design's
  testing strategy
- verbose counterexamples, untrimmed, so a failure can be triaged from the log
- a stable seed by default

Two environment variables adjust it:

```bash
FC_NUM_RUNS=1000 npm test   # more iterations; can never go below 100
FC_SEED=-57346423 npm test  # replay a specific failure
```

Properties that do real I/O per case need an explicit per-test timeout, because
the Vitest default of 5 s does not cover 100 iterations. Pass it as the second
argument to `it`:

```ts
it('validates every generated snake_case folder', () => {
  fc.assert(fc.property(/* ... */));
}, 30_000);
```

### `setup/dom.ts`

Web project only. Registers the `@testing-library/jest-dom` matchers and unmounts
the rendered tree after each test.

## Helpers

### `helpers/tempCatalog.ts`

Materializes agent catalogs under `os.tmpdir()` so the registry, the manifest
validation and the prompt builder can be tested against real folders on disk
without touching the repository's `agent/` directory. Importing the module
registers the cleanup; nothing else is required.

```ts
import { createTempCatalog, validManifest } from '../../tests/helpers/tempCatalog.ts';

const catalog = createTempCatalog({
  // A valid folder: manifest.json, AGENTS.md, prompt.md, output.schema.json.
  financial_analyst_agent: {},
  // A manifest string is written verbatim, so malformed JSON is expressible.
  broken_agent: { manifest: '{ not json' },
  // `null` omits the manifest entirely.
  no_manifest_agent: { manifest: null },
  // Overrides and extra files, subfolders included.
  custom_agent: {
    manifest: validManifest('custom_agent', { order: 5, isDefault: true }),
    files: { 'resources/data.txt': 'content' },
  },
  // No default files at all: what a half-migrated folder looks like.
  naked_agent: { withDefaultFiles: false },
});

createAgentRegistry({ agentsDir: catalog.agentsDir, logger: null });
```

The default folder contains exactly the four files the server requires, and both
the file names and the manifest field types are derived from the production
constants in `server/lib/agent/agentTypes.ts`. A rename or an allow-list change on
the server side therefore fails `npm run lint` here instead of silently leaving
the fixtures behind. `tests/server/tempCatalog.test.ts` pins the rest of that
contract by running the real `validateAgentFolder` over the generated folders.

Keep assertions off the default file *contents*. If a test needs to prove
something about a specific file, write that file in the spec with a sentinel
value, so the assertion does not depend on what a default folder happens to ship.

### `helpers/motionStub.tsx`

Aliased over `motion/react` for the whole `web` project. The real library runs an
animation pipeline on every mount: it reads computed styles, schedules frames and
maintains a motion-value graph per element. None of that changes what the
component tests assert, but in jsdom it dominates the cost of a property test
that mounts the tree a hundred times.

The stub keeps the semantics the tests rely on. `motion.<tag>` renders the plain
DOM element, forwarding children, refs and real DOM attributes while dropping the
animation-only props, so React does not warn about unknown attributes.
`AnimatePresence` mounts and unmounts children immediately, which is the end state
every assertion waits for anyway.

If a component starts using a `motion/react` export the stub does not provide, add
it to the stub and cover it in `tests/web/motionStub.test.tsx`. A gap there looks
like a bug in every component that animates.

## Writing application-level tests

`src/App.history.test.tsx` is the integration harness for the full app. Three
things about the current application have to be set up, and each of them broke
these tests once already when the app moved on:

**The interface is gated behind a Cognito session.** `App` renders a sign-in
screen until `getCurrentCognitoUser()` resolves. The harness signs in by seeding
an unexpired, unsigned ID token into its `localStorage` double, so the real
session-reading path still runs and no module mock is needed.

**The history storage key is scoped per user.** `App` reads and writes
`userHistoryKey(user.userId)`, not the bare `HISTORY_STORAGE_KEY`. The mount reads
the history twice, once before the session resolves under the unscoped key and
again under the scoped one, so a seeded history is written to both keys. That makes
the first committed count the final one instead of a race the assertions have to
tolerate.

**The execution panel is identified by its model badge.** The panel is told apart
from the landing view by the `alt` text of the provider logo in its header, kept
in a single constant. Switching model providers in `App.tsx` means updating it.

## Conventions

- All test output in English: names, comments, assertion messages. See
  `.kiro/steering/language.md`.
- Name what the test proves, not what it calls. Reference the requirement the
  assertion comes from in a comment when there is one.
- Prefer accessible queries (`getByRole` with a name) over test ids or class
  names, so the test breaks when the interface stops being usable, not when the
  markup is reshuffled.
- Inject dependencies instead of mocking modules where the production code allows
  it: `buildAgentPrompt` accepts a template and a schema, `resolveRunLogDownload`
  accepts a directory listing, `resolveArtifactPath` accepts a path module.
- Property tests state the invariant in the name and let the generators cover the
  input space; do not lower the iteration count to make one faster.

## Coverage gaps

A snapshot, accurate as of the last update to this file. Modules with no test of
their own:

- Server: `promptBuilder.ts`, `runLogNaming.ts`, `runLogDownload.ts`,
  `jsonExtractor.ts`, `debugFiles.ts`, `cognitoAuth.ts`,
  `agent/agentCatalog.ts`, `agent/agentInlineSources.ts`, `agent/agentEvents.ts`,
  `model/nvidiaProvider.ts`, `tools/*`
- Web: `src/data.ts`, `src/types.ts`, `src/cognito.ts`, `ReportTemplate.tsx`,
  and the `AgentSelector`, `AgentTimeline`, `CookieConsent`, `DebugPanel`,
  `FormattedMarkdown` and `PulsatingDots` components

Most of the server modules in that list are pure and take injected dependencies,
so they are cheap to cover. `promptBuilder.ts` is the highest-value one: it
assembles what actually gets sent to the model.

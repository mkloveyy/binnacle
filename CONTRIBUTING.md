# Contributing

## Develop

The plugin is in `plugin/` (only that folder is installed):

```
cd plugin
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

Rules of the codebase:

- One entry module (`hooks/register.tsx`); all host hooks are registered there with `on('event', ...)`, and pure logic lives in `hooks/core` or `hooks/modules/*`.
- Decisions, layout and formatting are pure functions under `hooks/core` or a module folder, with tests under `tests/`.
- Declare an `atom` in the file that uses it, with literal `plugin` and `key`. The validator does not follow imported atoms.
- Guard hooks fail closed: `.catch(($, e, next) => (next.called ? next(e) : { deny: '...' }))`.
- Write each new test so it fails against a wrong implementation before you make it pass.

## Plugins

Rule packs and other plugins live in their own repositories and the marketplace; see [docs/plugins.md](docs/plugins.md) for the interface, and `template/` in the marketplace repository for a starting point (with `tests/binnacle-mock.tsx`, a stand-in for binnacle in `claude plugin test`).

A change to binnacle's plugin interface needs its own tests in `plugin/tests/ext-api.test.ts` (the pure functions) and `plugin/tests/ext-hooks.test.ts` (registration, drawing and `binnacle.notify` with inline plugins), and an update to `docs/plugins.md` and `docs/plugins.zh-CN.md`. A change a plugin written for the old interface would break on raises `API` in `plugin/hooks/modules/ext/ext.ts`.

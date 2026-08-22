# Contributing to GitRoot

Thanks for wanting to work on this. A few things that'll save you a round trip.

## Before you start

For anything bigger than a small fix or a typo, open an issue first and
describe what you want to change and why. It's much cheaper to align on
approach before code exists than after.

## Workflow

1. Fork the repo, then branch off `main` in your fork.
2. Make your change. Match the app's existing patterns rather than
   introducing a new one. See the "project structure" section in
   [README.md](README.md) for where things live, and pick the file
   that's already closest to what you're doing.
3. Open a pull request against `main`.
4. **Every PR needs [@AbdelattyBadwy16](https://github.com/AbdelattyBadwy16)'s
   review and a passing CI run before it can merge.** This is enforced by
   branch protection, not just a request. Direct pushes to `main` aren't
   possible.

## Before you open the PR

Run the same checks CI runs. Catching these locally is faster than
round-tripping through a CI failure:

```bash
npx tsc --noEmit && npm run build

cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --bin gitroot
```

All four have to pass clean. `cargo clippy` in particular runs with
`-D warnings`, so a clippy warning fails CI here, not just an error.

## Code conventions

- **Rust git operations**: every command goes through `run_git`/
  `run_git_network` in `src-tauri/src/git/mod.rs`, always as an argument
  array (`&["checkout", "-b", &name]`), never a concatenated shell
  string. Network-touching commands (clone/pull/push/ls-remote) use
  `run_git_network`, which has a much longer timeout than local commands.
  See the comment on `GIT_NETWORK_TIMEOUT` for why.
- **Rust tests**: use the `TestRepo` helper in
  `src-tauri/src/git/tests/commands_tests.rs` and call the `_sync`
  function directly, not the async `#[tauri::command]` wrapper. Tests run
  real `git` subprocesses against a real temp repo, nothing is mocked. If
  you're fixing a bug, try to reproduce it with a failing test first.
- **User-facing text**: lowercase, plain, direct, never marketing
  language. New result/error text for an existing command goes in
  `src/lib/dictionary.json`, not hardcoded in a component. See
  `src/lib/explain.ts` for how templates get filled in.
- **Frontend state**: a new feature area gets its own hook in `src/hooks/`
  (see `useStashActions.ts` or `useResetRevert.ts` for the shape most
  hooks follow) instead of growing `App.tsx` further.

## Reporting a bug

Open an issue with: what you did, what you expected, what actually
happened, and your OS. If it's a git-operation bug, the exact repo state
that triggers it (a `git log --oneline --all --graph` from before the bug
hit) is the single most useful thing you can include.

For a security vulnerability specifically, see [SECURITY.md](SECURITY.md)
instead of opening a public issue.

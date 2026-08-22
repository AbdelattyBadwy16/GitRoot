# GitRoot

[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/jV3UE3zMJ)

A desktop git client that explains what it's doing, every time.

Open a local repo and run the git commands you already reach for: pull, push,
commit, stash, branch, merge, rebase, reset, revert. All from buttons. After
each one you get a plain-language explanation of what actually happened,
not git's raw output. Anything that can lose work (a hard reset, a force
push, deleting an unmerged branch) stops first and shows you exactly what
you'd lose before it touches anything.

Built with [Tauri](https://tauri.app) (Rust) + React/TypeScript.

## How it works

- **Four tabs**: history (an animated commit graph), commit (staging, down
  to individual lines), branches (switch/create/merge/rebase, plus conflict
  resolution when git can't combine something automatically), and stash.
- **A command bar** on the left for the everyday actions: pull, push,
  stash, commit, each one click.
- **Plain-language results**, e.g. *"pulled 3 commits from origin/main."*
  The wording lives in a JSON dictionary
  ([`src/lib/dictionary.json`](src/lib/dictionary.json)) owned by the
  frontend, kept separate from the Rust side so copy changes don't need a
  recompile.
- **Real previews before anything risky runs.** Reset shows a live diagram
  of exactly where a commit's changes will end up (staged, unstaged, or
  discarded) for whichever mode you're about to pick. Merge and rebase
  preview their outcome before you confirm. Anything already pushed gets
  an extra warning before you rewrite it.
- **A persistent undo history**, stored per-repo, that reverses exactly
  what your last action did. It stays visible in the header for a while
  after each command.

None of this is AI-generated wording at runtime. Every explanation is a
static template filled in with real values from the git command that just
ran. See [DESIGN.md](DESIGN.md) for the original design notes (a couple of
things have changed since: merge conflict resolution and the stash picker
both ended up going further than that doc originally planned).

## Project structure

```
src/
├── App.tsx           trunk state: repo lifecycle, polling, tab switching
├── hooks/            one hook per feature area, each owning its own state
│                     (useBranches, useMergeRebase, useResetRevert,
│                     useStashActions, usePausedOp, useUndoHistory, ...)
├── components/       presentational pieces: dialogs, tabs, the graph
└── lib/              framework-free utilities
    ├── gitCommands.ts    typed wrappers around every Tauri `invoke` call
    ├── dictionary.json   the plain-language explanation for every action
    ├── explain.ts        fills the dictionary's templates in with real data
    ├── graph.ts, diff.ts, tour.ts, undo.ts, branchName.ts, ...

src-tauri/src/
├── main.rs               registers every #[tauri::command]
├── git/
│   ├── mod.rs             the actual subprocess runner (`run_git`), plus
│   │                      error classification (auth/network/conflict/...)
│   ├── commands.rs        one #[tauri::command] per git operation
│   ├── log.rs             commit graph layout (lanes, edges, merges)
│   └── tests/              real TestRepo fixtures. every test runs
│                          actual git subprocesses, nothing is mocked
├── undo_history.rs       reads/writes .git/gitroot-undo-history.json
└── settings.rs            small per-machine settings (tour offered, etc.)

.github/workflows/
├── ci.yml         lint (fmt+clippy), typecheck, unit tests, build. on every PR
└── release.yml    builds macOS/Windows/Linux on a `v*.*.*` tag, publishes
                   a draft GitHub Release
```

## Contributing

This repo is open to contributions. A few things before you open a PR:

- **Every PR needs review and a passing CI run before it can merge.**
  Direct pushes to `main` aren't accepted. See
  [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, coding
  conventions, and what CI actually checks.
- For anything beyond a small fix, open an issue first and talk through
  the approach. Saves you writing code that goes a direction the project
  isn't going in.
- Match the app's own voice in any user-facing text you touch: lowercase,
  plain, direct. It says *"pulled 3 commits from origin/main,"* never
  *"seamlessly synchronizes your repository."*

## Developing locally

Requires [Node.js](https://nodejs.org) and [Rust](https://rustup.rs).

```bash
git clone https://github.com/<your-username>/GitRoot.git
cd GitRoot
npm install
npm run tauri dev
```

(If you forked the repo first, which you'll need to do to open a PR, swap
in your fork's URL above.)

Same checks CI runs, worth running before you push:

```bash
npx tsc --noEmit && npm run build

cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --bin gitroot
```

## Installing

Grab the latest build from the [Releases page](https://github.com/AbdelattyBadwy16/GitRoot/releases/latest) and pick the file for your OS.

Builds aren't code-signed yet (that costs money, see below), so your OS
will show a security warning the first time you open one. That's expected.
It doesn't mean anything's wrong, and the source is right here if you'd
rather check it yourself before trusting it.

**macOS**: you'll see *"Apple could not verify 'gitroot' is free of
malware..."*. Either:
- Terminal: `xattr -cr /path/to/gitroot.app`, then open it normally, **or**
- System Settings → Privacy & Security → scroll down to the blocked-app
  notice → **Open Anyway**

**Windows**: you'll see a blue *"Windows protected your PC"* SmartScreen
screen, or Chrome may block the download outright before you even get
that far. For the download block: open `chrome://downloads`, use the
three-dot menu next to the blocked file, then **Keep dangerous file**
(not always available, depends on your Safe Browsing settings). For
SmartScreen: click **More info**, then **Run anyway**. Both warnings ease
off over time as more people download a build without issues. Signing
(in progress, see below) is the real fix.

**Linux**: no equivalent OS-level warning. For the `.AppImage`, make it
executable first: `chmod +x gitroot*.AppImage`, then run it directly. The
`.deb` installs normally via `dpkg -i` or your distro's software center.

*(Applied to [SignPath Foundation](https://signpath.io) for free Windows
code signing, pending review. macOS notarization needs a paid Apple
Developer account, $99/yr, not set up yet.)*

## License

MIT, see [LICENSE](LICENSE).

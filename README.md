# GitRoot

A desktop git client that explains what it's doing, every time.

Open a local repo and run the git commands you already know from buttons —
pull, push, commit, stash, branch, merge, rebase, reset, revert — and after
each one, get a plain-language explanation of what actually happened, not
just git's raw output. Destructive commands ask first, with a real preview
of what will change before you confirm.

Built with [Tauri](https://tauri.app) (Rust) + React/TypeScript. See
[DESIGN.md](DESIGN.md) for the full design rationale and technical
decisions.

## Installing

Grab the latest build from the [Releases page](https://github.com/AbdelattyBadwy16/GitRoot/releases/latest) — pick the file for your OS.

Builds aren't code-signed yet (that costs money — see below), so your OS
will show a security warning the first time you open one. That's expected,
not a sign anything's wrong — the source is right here if you'd rather
check it yourself before trusting it.

**macOS** — you'll see *"Apple could not verify 'gitroot' is free of
malware..."*. Either:
- Terminal: `xattr -cr /path/to/gitroot.app`, then open it normally, **or**
- System Settings → Privacy & Security → scroll down to the blocked-app
  notice → **Open Anyway**

**Windows** — you'll see a blue *"Windows protected your PC"* SmartScreen
screen. Click **More info**, then **Run anyway**. This goes away on its
own once enough people have downloaded that build without issues.

**Linux** — no equivalent OS-level warning. For the `.AppImage`, make it
executable first: `chmod +x gitroot*.AppImage`, then run it directly. The
`.deb` installs normally via `dpkg -i` or your distro's software center.

*(Planning to sign the Windows build for free via [SignPath](https://signpath.io)'s
open-source program. macOS notarization needs a paid Apple Developer
account — $99/yr — not set up yet.)*

## Developing

Requires [Node.js](https://nodejs.org) and [Rust](https://rustup.rs).

```bash
npm install
npm run tauri dev
```

Same checks CI runs, useful to run before pushing:

```bash
npx tsc --noEmit && npm run build

cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --bin gitroot
```

## License

MIT — see [LICENSE](LICENSE).

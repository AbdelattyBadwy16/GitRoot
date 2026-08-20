## What does this change, and why?

## Checklist

- [ ] `npx tsc --noEmit && npm run build` passes
- [ ] `cargo fmt --check` passes (in `src-tauri`)
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes (in `src-tauri`)
- [ ] `cargo test --bin gitroot` passes (in `src-tauri`)
- [ ] If this changes git-command behavior, I added/updated a Rust test using a real `TestRepo`, not a mock
- [ ] If this adds/changes user-facing text, it matches the app's voice (lowercase, plain, direct) and lives in `src/lib/dictionary.json` if it's a command result/error

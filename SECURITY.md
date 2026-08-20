# Security Policy

GitRoot runs `git` as a real subprocess against whatever repository you
open, and reads/writes files inside `.git/` directly (undo history,
settings). If you find a way for a malicious repo, remote, or commit
message to make GitRoot do something it shouldn't, like run an unintended
command or write outside the repo it's pointed at, that's a real security
issue and worth reporting privately rather than as a public issue.

## Reporting a vulnerability

Please use GitHub's private reporting instead of opening a public issue:

1. Go to the [Security tab](https://github.com/AbdelattyBadwy16/GitRoot/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, ideally with a minimal repro (a repo state or
   sequence of actions that triggers it).

You should get an initial response within a few days. Please give a
reasonable amount of time to land a fix before any public disclosure.

## What's in scope

- Arbitrary command execution beyond the intended `git` subprocess calls
  (e.g. via a crafted branch name, remote URL, commit message, or file
  path that isn't properly passed as an argument-array element).
- Path traversal, GitRoot writing or reading outside the repo folder it's
  supposed to be scoped to.
- Anything that lets a repo you merely *open* (without running any
  command) execute code or exfiltrate data.

## What's out of scope

- Issues that require the user to already have arbitrary code execution
  on their own machine.
- Social-engineering scenarios ("a malicious repo owner could ask you to
  click force-push"). GitRoot's job is to warn clearly before destructive
  actions, not to prevent a user from choosing to run one.
- The unsigned-build OS warnings on macOS/Windows, that's a known,
  tracked issue (see the README), not a vulnerability report.

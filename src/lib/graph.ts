import type { GraphCommit } from "./gitCommands";

// true if this commit is currently checked out
export function isHead(commit: GraphCommit): boolean {
  return commit.refs.some((r) => r === "HEAD" || r.startsWith("HEAD -> "));
}

import type { GraphCommit } from "./gitCommands";

export function isHead(commit: GraphCommit): boolean {
  return commit.refs.some((r) => r === "HEAD" || r.startsWith("HEAD -> "));
}

// git is strict about what a ref (branch) name can look like - see git-check-ref-format(1).
// we validate client-side and explain *why* in plain language, instead of letting a bad name
// round-trip to git and back as a raw "fatal: 'x' is not a valid branch name" stderr dump.
export function invalidBranchNameReason(name: string): string | null {
  if (name === "") return "can't be empty.";
  if (name.startsWith("-")) return "can't start with a dash.";
  if (name.startsWith("/") || name.endsWith("/")) return "can't start or end with a slash.";
  if (name.endsWith(".")) return "can't end with a dot.";
  if (name === "@") return "can't be just \"@\".";
  if (/\s/.test(name)) return "can't contain spaces.";
  if (/\.\./.test(name)) return "can't contain \"..\".";
  if (/@\{/.test(name)) return "can't contain \"@{\".";
  if (/\/\//.test(name)) return "can't contain two slashes in a row.";
  // control characters, plus the specific punctuation git reserves: ~ ^ : ? * [ \
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(name)) return "can't contain spaces or the characters ~ ^ : ? * [ \\";
  if (name.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))) {
    return "no part between slashes can start with a dot or end with \".lock\".";
  }
  return null;
}

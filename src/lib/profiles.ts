// saved git identities you can switch between - local to this machine only, and purely cosmetic:
// switching one just sets git's global user.name/user.email (see gitCommands.setGitIdentity), the
// same thing GitIdentityPrompt already does. it never touches SSH keys, tokens, or credential
// helpers, so it can't change which GitHub account push/pull actually authenticates as.
export interface GitProfile {
  id: string;
  // shown in the switcher list - defaults to the name when left blank while adding
  label: string;
  name: string;
  email: string;
  // public GitHub username, used only to fetch the avatar - no login, no API key
  githubUsername: string | null;
}

const PROFILES_KEY = "gitroot:profiles";

export function loadProfiles(): GitProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: GitProfile[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function newProfileId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// the same public URL github.com itself uses for profile pictures - no auth needed, works for any
// existing username. returns null when there's nothing to fetch, so callers fall back to initials.
export function avatarUrl(githubUsername: string | null | undefined, size = 64): string | null {
  const trimmed = githubUsername?.trim();
  return trimmed ? `https://github.com/${encodeURIComponent(trimmed)}.png?size=${size}` : null;
}

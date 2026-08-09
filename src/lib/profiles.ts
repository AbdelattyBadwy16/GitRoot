export interface GitProfile {
  id: string;
  label: string;
  name: string;
  email: string;
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

export function avatarUrl(githubUsername: string | null | undefined, size = 64): string | null {
  const trimmed = githubUsername?.trim();
  return trimmed ? `https://github.com/${encodeURIComponent(trimmed)}.png?size=${size}` : null;
}

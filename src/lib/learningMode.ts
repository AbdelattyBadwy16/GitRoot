const LEARNING_MODE_KEY = "gitroot:learningMode";

export function loadLearningMode(): boolean {
  const stored = localStorage.getItem(LEARNING_MODE_KEY);
  return stored === null ? true : stored === "true";
}

export function saveLearningMode(value: boolean): void {
  localStorage.setItem(LEARNING_MODE_KEY, String(value));
}

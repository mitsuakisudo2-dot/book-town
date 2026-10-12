// Each page mounts its own town, so a toast shown just before moving on
// (posting from home lands on the timeline) is carried to the next page.
const CARRY_FOR = 1500;
let last: { message: string; at: number } | null = null;

export function noteToast(message: string) {
  last = { message, at: Date.now() };
}

export function carriedToast(): string {
  return last && Date.now() - last.at < CARRY_FOR ? last.message : "";
}

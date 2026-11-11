// "Assisted deductions" preference: when on, truths with a deduction are confirmed automatically.
// Kept here (not in the UI layer) so story rules can read it without touching localStorage.
let assisted = false;

export function setAssistedDeductions(value: boolean): void {
  assisted = value;
}

export function isAssistedDeductions(): boolean {
  return assisted;
}

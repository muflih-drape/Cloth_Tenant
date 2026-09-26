export function archiveCountdownLabel(daysUntilPurge: number): string {
  if (daysUntilPurge <= 0) return "Deletes today";
  if (daysUntilPurge === 1) return "Deletes in 1 day";
  return `Deletes in ${daysUntilPurge} days`;
}
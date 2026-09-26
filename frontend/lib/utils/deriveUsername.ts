export function deriveUsername(
  displayName: string,
  existingUsernames?: Set<string>
): string {
  const base = displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (!existingUsernames) return base;

  let username = base;
  let counter = 1;
  while (existingUsernames.has(username)) {
    username = `${base}_${counter}`;
    counter++;
  }
  return username;
}

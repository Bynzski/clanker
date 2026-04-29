export function isWindowsDrivePath(input: string): boolean {
  return /^[A-Za-z]:\//.test(input);
}

export function isUncPath(input: string): boolean {
  return input.startsWith('//');
}

export function isAbsoluteWorkspacePath(input: string): boolean {
  return input.startsWith('/') || isWindowsDrivePath(input) || isUncPath(input);
}

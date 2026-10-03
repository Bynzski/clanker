/**
 * Windows command-line helpers for tests that run on any host.
 *
 * `ptyCommandLine` is node-pty's real serializer (the exact string its Windows agent hands to
 * CreateProcess/ConPTY for a spawn(file, args) call). `parseMsvcrtArgv` is the documented
 * CommandLineToArgvW/MSVCRT rule set, so a round trip proves argument boundaries without a shell.
 * Neither involves cmd.exe: batch-file behaviour is only checked structurally, never executed.
 */
import { createRequire } from 'node:module';

const { argsToCommandLine } = createRequire(import.meta.url)('node-pty/lib/windowsPtyAgent') as {
  argsToCommandLine(file: string, args: string[] | string): string;
};

export function ptyCommandLine(file: string, args: string[] | string): string {
  return argsToCommandLine(file, args);
}

export function parseMsvcrtArgv(line: string): string[] {
  const argv: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ' || line[i] === '\t') i++;
    if (i >= line.length) break;
    let arg = '';
    let quoted = false;
    while (i < line.length && (quoted || (line[i] !== ' ' && line[i] !== '\t'))) {
      let slashes = 0;
      while (line[i] === '\\') { slashes++; i++; }
      if (line[i] === '"') {
        arg += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2 === 1) arg += '"'; else quoted = !quoted;
        i++;
      } else {
        arg += '\\'.repeat(slashes);
        if (i < line.length) arg += line[i++];
      }
    }
    argv.push(arg);
  }
  return argv;
}

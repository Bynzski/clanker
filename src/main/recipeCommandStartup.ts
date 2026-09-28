import { randomUUID } from 'node:crypto';

export type RecipeCommandOutcome =
  | { status: 'success' }
  | { status: 'started' }
  | { status: 'failed'; error: string };

const READY_TIMEOUT_MS = 6000;
const STARTUP_WINDOW_MS = 3000;

/** Watches the existing interactive shell PTY for a command's exit marker. */
export class RecipeCommandStartup {
  private readonly marker = `CLANKER_RECIPE_${randomUUID().replace(/-/g, '')}_`;
  private tail = '';
  private outcome?: RecipeCommandOutcome;
  private readonly waiters: Array<(outcome: RecipeCommandOutcome) => void> = [];
  private timer?: ReturnType<typeof setTimeout>;

  public wrap(command: string, platform = process.platform, shell = ''): string {
    const shellName = (shell.split(/[/\\]/).pop() ?? '').toLowerCase().replace(/\.exe$/i, '');
    if (platform === 'win32' || shellName === 'pwsh' || shellName === 'powershell') {
      return `try { . { ${command} }; $clankerRecipeExit = if ($?) { 0 } elseif ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { $LASTEXITCODE } else { 1 } } catch { $clankerRecipeExit = 1 } finally { Write-Output "${this.marker}$clankerRecipeExit" }`;
    }
    if (shellName === 'fish') {
      return `begin; ${command}; end; set -l clanker_recipe_exit $status; printf '${this.marker}%s\\n' $clanker_recipe_exit`;
    }
    return `{ ${command}; }; clanker_recipe_exit=$?; printf '${this.marker}%s\\n' "$clanker_recipe_exit"`;
  }

  public onReady(): void {
    if (this.outcome) return;
    this.schedule(STARTUP_WINDOW_MS, { status: 'started' });
  }

  public onData(data: string): void {
    if (this.outcome) return;
    this.tail = (this.tail + data).slice(-512);
    const match = this.tail.match(new RegExp(`${this.marker}(-?\\d+)`));
    if (!match) return;
    const code = Number(match[1]);
    this.finish(code === 0 ? { status: 'success' } : {
      status: 'failed', error: `Command exited immediately with code ${code}`,
    });
  }

  public onExit(exitCode: number): void {
    this.finish({ status: 'failed', error: `Shell exited before command startup completed (code ${exitCode})` });
  }

  public wait(): Promise<RecipeCommandOutcome> {
    if (this.outcome) return Promise.resolve(this.outcome);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      if (!this.timer) this.schedule(READY_TIMEOUT_MS, {
        status: 'failed', error: 'Terminal did not become ready to run the command',
      });
    });
  }

  private schedule(ms: number, outcome: RecipeCommandOutcome): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(outcome), ms);
  }

  private finish(outcome: RecipeCommandOutcome): void {
    if (this.outcome) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.outcome = outcome;
    for (const resolve of this.waiters) resolve(outcome);
    this.waiters.length = 0;
  }
}

/**
 * Shell-aware argument quoting. The launch command is user-provided and must be
 * run through a shell, so every argument we append has to be quoted for that shell.
 */

export type ShellKind = 'posix' | 'powershell' | 'cmd';

export function detectShellKind(shell: string | undefined, platform: NodeJS.Platform = process.platform): ShellKind {
  const name = (shell ?? '').toLowerCase().split(/[\\/]/).pop() ?? '';
  if (name.includes('pwsh') || name.includes('powershell')) {
    return 'powershell';
  }
  if (name === 'cmd' || name === 'cmd.exe' || (!name && platform === 'win32')) {
    return 'cmd';
  }
  return 'posix';
}

export function quoteArg(arg: string, kind: ShellKind): string {
  switch (kind) {
    case 'posix':
      return `'${arg.replace(/'/g, `'\\''`)}'`;
    case 'powershell':
      return `'${arg.replace(/'/g, `''`)}'`;
    case 'cmd':
      // Windows paths cannot contain double quotes; escape cmd metacharacters defensively.
      return `"${arg.replace(/"/g, '""').replace(/%/g, '%%')}"`;
  }
}

export interface RunCommandOptions {
  /** Cucumber tag expression appended as `--tags`. */
  tags?: string;
  /** `--format` value; defaults to `message` (NDJSON on stdout). */
  format?: string;
}

/** Builds `<launchCommand> --paths <loc>... [--tags <expr>] --format message`. */
export function buildRunCommand(
  launchCommand: string,
  locations: readonly string[],
  kind: ShellKind,
  options: RunCommandOptions = {}
): string {
  const parts = [launchCommand.trim(), ...locations.map(loc => `--paths ${quoteArg(loc, kind)}`)];
  if (options.tags?.trim()) {
    parts.push(`--tags ${quoteArg(options.tags.trim(), kind)}`);
  }
  parts.push(`--format ${options.format ? quoteArg(options.format, kind) : 'message'}`);
  return parts.join(' ');
}

/**
 * `--format` value writing message NDJSON to a file. Cucumber splits the value on `:`, so
 * Windows paths (`C:\...`) use the quoted `"formatter":"path"` form.
 */
export function messageFileFormat(filePath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return `"message":"${filePath.replace(/\\/g, '/')}"`;
  }
  return `message:${filePath}`;
}

/** cmd.exe rejects command lines over 8191 chars; keep a margin for the shell wrapper. */
export const MAX_COMMAND_LENGTH = { win32: 7000, other: 100_000 };

/** Splits locations into groups whose built command stays under `maxLength`. */
export function chunkLocations(
  launchCommand: string,
  locations: readonly string[],
  kind: ShellKind,
  maxLength: number,
  options: RunCommandOptions = {}
): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const loc of locations) {
    const candidate = [...current, loc];
    if (current.length && buildRunCommand(launchCommand, candidate, kind, options).length > maxLength) {
      chunks.push(current);
      current = [loc];
    } else {
      current = candidate;
    }
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

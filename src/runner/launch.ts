import * as path from 'node:path';
import * as vscode from 'vscode';

export const DEFAULT_LAUNCH_COMMAND = 'npx qavajs run';

export interface LaunchProfileConfig {
  name: string;
  command: string;
  /** Extra environment variables for the test process. */
  env?: Record<string, string>;
  /** Working directory, relative to the workspace folder. */
  cwd?: string;
  /** Cucumber tag expression, e.g. `@smoke and not @wip`. */
  tags?: string;
}

export interface ResolvedLaunch {
  command: string;
  cwd: string;
  env: Record<string, string>;
  tags?: string;
}

function readProfiles(scope?: vscode.Uri): LaunchProfileConfig[] {
  const profiles = vscode.workspace.getConfiguration('qavajs', scope).get<LaunchProfileConfig[]>('launchProfiles') ?? [];
  return profiles.filter(p => typeof p?.name === 'string' && p.name && typeof p.command === 'string' && p.command);
}

/**
 * Profile names across the workspace and every folder (folders of a multi-root workspace
 * can define their own profiles); order of first appearance is kept.
 */
export function profileNames(): string[] {
  const names = new Set<string>();
  for (const p of readProfiles()) {
    names.add(p.name);
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const p of readProfiles(folder.uri)) {
      names.add(p.name);
    }
  }
  return [...names];
}

/** Replaces `${workspaceFolder}`, `${workspaceFolderBasename}` and `${env:NAME}`. */
export function substituteVariables(value: string, folderPath: string, env: NodeJS.ProcessEnv = process.env): string {
  return value
    .replace(/\$\{workspaceFolder\}/g, folderPath)
    .replace(/\$\{workspaceFolderBasename\}/g, path.basename(folderPath))
    .replace(/\$\{env:([^}]+)\}/g, (_, name: string) => env[name] ?? '');
}

/**
 * Launch settings for `profileName` as seen from `folder`. A profile missing in that folder
 * falls back to the window-level one, then to `qavajs.launchCommand`.
 */
export function resolveLaunch(profileName: string | undefined, folder: vscode.WorkspaceFolder | undefined, fallbackCwd: string): ResolvedLaunch {
  const folderPath = folder?.uri.fsPath ?? fallbackCwd;
  const profile = profileName
    ? (readProfiles(folder?.uri).find(p => p.name === profileName) ?? readProfiles().find(p => p.name === profileName))
    : undefined;
  const command =
    profile?.command ||
    vscode.workspace.getConfiguration('qavajs', folder?.uri).get<string>('launchCommand') ||
    DEFAULT_LAUNCH_COMMAND;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(profile?.env ?? {})) {
    if (value !== undefined && value !== null) {
      env[key] = substituteVariables(String(value), folderPath);
    }
  }
  const cwd = profile?.cwd ? path.resolve(folderPath, substituteVariables(profile.cwd, folderPath)) : folderPath;

  return { command: substituteVariables(command, folderPath), cwd, env, tags: profile?.tags || undefined };
}

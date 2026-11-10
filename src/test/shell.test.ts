import { describe, expect, it } from 'vitest';
import { buildRunCommand, chunkLocations, detectShellKind, messageFileFormat, quoteArg } from '../runner/shell';

describe('detectShellKind', () => {
  it.each([
    ['/bin/zsh', 'darwin', 'posix'],
    ['C:\\Program Files\\Git\\bin\\bash.exe', 'win32', 'posix'],
    ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'win32', 'powershell'],
    ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32', 'powershell'],
    ['C:\\Windows\\System32\\cmd.exe', 'win32', 'cmd'],
    ['', 'win32', 'cmd'],
    [undefined, 'linux', 'posix'],
  ] as const)('%s on %s -> %s', (shell, platform, expected) => {
    expect(detectShellKind(shell, platform)).toBe(expected);
  });
});

describe('quoteArg', () => {
  it('neutralises shell metacharacters for posix shells', () => {
    expect(quoteArg(`/a b/it's $HOME \`x\`.feature:3`, 'posix')).toBe(`'/a b/it'\\''s $HOME \`x\`.feature:3'`);
  });

  it('doubles single quotes for powershell', () => {
    expect(quoteArg(`C:\\it's $env:X.feature:3`, 'powershell')).toBe(`'C:\\it''s $env:X.feature:3'`);
  });

  it('wraps in double quotes for cmd', () => {
    expect(quoteArg('C:\\my tests\\100%.feature:3', 'cmd')).toBe('"C:\\my tests\\100%%.feature:3"');
  });
});

describe('buildRunCommand', () => {
  it('appends quoted paths and message formatter', () => {
    expect(buildRunCommand('npx qavajs run --config c.ts', ['/w/a.feature:12'], 'posix')).toBe(
      `npx qavajs run --config c.ts --paths '/w/a.feature:12' --format message`
    );
  });

  it('runs several locations in one command', () => {
    expect(buildRunCommand('npx qavajs run', ['/w/a.feature', '/w/b.feature:3:7'], 'posix')).toBe(
      `npx qavajs run --paths '/w/a.feature' --paths '/w/b.feature:3:7' --format message`
    );
  });

  it('adds tags and a custom format', () => {
    expect(buildRunCommand('npx qavajs run', ['/w/a.feature'], 'posix', { tags: ' @smoke and not @wip ', format: 'message:/tmp/m.ndjson' })).toBe(
      `npx qavajs run --paths '/w/a.feature' --tags '@smoke and not @wip' --format 'message:/tmp/m.ndjson'`
    );
  });
});

describe('messageFileFormat', () => {
  it('uses formatter:path on posix', () => {
    expect(messageFileFormat('/tmp/x.ndjson', 'darwin')).toBe('message:/tmp/x.ndjson');
  });

  it('quotes both parts on windows so the drive colon is not a separator', () => {
    expect(messageFileFormat('C:\\Temp\\x.ndjson', 'win32')).toBe('"message":"C:/Temp/x.ndjson"');
  });
});

describe('chunkLocations', () => {
  it('splits locations so every command fits the limit', () => {
    const locations = Array.from({ length: 50 }, (_, i) => `/workspace/features/feature-${i}.feature`);
    const chunks = chunkLocations('npx qavajs run', locations, 'posix', 400);
    expect(chunks.flat()).toEqual(locations);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(buildRunCommand('npx qavajs run', chunk, 'posix').length).toBeLessThanOrEqual(400);
    }
  });

  it('keeps a single over-long location in its own chunk', () => {
    expect(chunkLocations('cmd', ['x'.repeat(500)], 'posix', 100)).toEqual([['x'.repeat(500)]]);
  });
});

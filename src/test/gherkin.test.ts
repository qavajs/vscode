import { describe, expect, it } from 'vitest';
import { interpolateName, parseFeature } from '../gherkin';

const feature = `@auth
Feature: Login

  @smoke @fast
  Scenario: valid user
    Given I open login page

  Scenario Outline: login as <user> with <user> twice
    Given I log in as <user>

    @admins
    Examples:
      | user  |
      | admin |
      | guest |

  Rule: lockout
    Scenario: three failures
      Given I fail 3 times
`;

describe('parseFeature', () => {
  it('builds feature / scenario / outline / example / rule nodes with lines', () => {
    const result = parseFeature(feature);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const f = result.feature!;
    expect(f).toMatchObject({ kind: 'feature', name: 'Login', line: 2, tags: ['auth'] });
    expect(f.children.map(c => [c.kind, c.name, c.line, c.tags])).toEqual([
      ['scenario', 'valid user', 5, ['smoke', 'fast']],
      ['outline', 'login as <user> with <user> twice', 8, []],
      ['rule', 'lockout', 17, []],
    ]);
    expect(f.children[1].children.map(c => [c.kind, c.name, c.line, c.tags])).toEqual([
      ['example', 'login as admin with admin twice', 14, ['admins']],
      ['example', 'login as guest with guest twice', 15, ['admins']],
    ]);
    expect(f.children[2].children.map(c => [c.kind, c.line])).toEqual([['scenario', 18]]);
  });

  it('returns an error for invalid gherkin', () => {
    expect(parseFeature('Scenario: no feature\n  Given x\n')).toMatchObject({ ok: false });
  });

  it('returns no feature for an empty file', () => {
    expect(parseFeature('')).toEqual({ ok: true, feature: undefined });
  });
});

describe('interpolateName', () => {
  it('replaces all occurrences of each placeholder', () => {
    expect(interpolateName('<a> and <a> or <b>', ['a', 'b'], ['1', '2'])).toBe('1 and 1 or 2');
  });
});

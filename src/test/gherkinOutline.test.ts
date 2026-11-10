import { describe, expect, it } from 'vitest';
import { parseGherkinDocument } from '../gherkin';
import { computeFolds, featureSymbols, fuzzyMatch } from '../gherkinOutline';

const feature = `# language: en
@login
Feature: Login

  Background:
    Given I open app

  # first comment
  # second comment
  @smoke
  Scenario: valid user
    When I type into form:
      | user  | admin |
      | pass  | 123   |
    Then I see
      """
      Welcome
      """

  Rule: lockout
    Scenario Outline: fail <n>
      When I fail <n> times

      Examples:
        | n |
        | 1 |
        | 3 |
`;

describe('computeFolds', () => {
  const folds = computeFolds(feature, parseGherkinDocument(feature)).map(f => [f.start + 1, f.end + 1, f.kind ?? '']);

  it('folds feature, background, scenarios, rules and examples', () => {
    expect(folds).toEqual(
      expect.arrayContaining([
        [3, 27, ''], // feature
        [5, 6, ''], // background, up to before the comments/tags of the next scenario
        [11, 18, ''], // scenario
        [20, 27, ''], // rule
        [21, 27, ''], // outline
        [24, 27, ''], // examples
      ])
    );
  });

  it('folds tables, doc strings and comment runs but not the language header', () => {
    expect(folds).toEqual(expect.arrayContaining([[13, 14, ''], [16, 18, ''], [8, 9, 'comment']]));
    expect(folds.some(f => f[0] === 1)).toBe(false);
  });
});

describe('featureSymbols', () => {
  it('lists feature, rules and scenarios with containers', () => {
    expect(featureSymbols(parseGherkinDocument(feature)).map(s => [s.kind, s.name, s.line, s.container])).toEqual([
      ['feature', 'Login', 2, undefined],
      ['scenario', 'valid user', 10, 'Login'],
      ['rule', 'lockout', 19, 'Login'],
      ['scenario', 'fail <n>', 20, 'lockout'],
    ]);
  });
});

describe('fuzzyMatch', () => {
  it('matches characters in order', () => {
    expect(fuzzyMatch('validuser', 'vus')).toBe(true);
    expect(fuzzyMatch('validuser', 'usv')).toBe(false);
    expect(fuzzyMatch('anything', '')).toBe(true);
  });
});

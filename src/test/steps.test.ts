import { describe, expect, it } from 'vitest';
import { parseJsDoc, parseStepLine, StepMatcher } from '../qavajs/steps';

const def = (expression: string, extra = {}) => ({ keyword: 'When', expression, pos: { line: 0, character: 0 }, file: 'f', ...extra });

describe('parseJsDoc', () => {
  it('splits description, params, examples and other tags', () => {
    const doc = parseJsDoc(`Verify text of element
second line
@param {string} alias - element to verify
@param {string} value expected value
@example I expect text of 'Title' to equal 'Hello'
  And more
@deprecated use something else`);
    expect(doc).toEqual({
      description: 'Verify text of element\nsecond line',
      params: [
        { type: 'string', name: 'alias', description: 'element to verify' },
        { type: 'string', name: 'value', description: 'expected value' },
      ],
      examples: ["I expect text of 'Title' to equal 'Hello'\n  And more"],
      tags: [{ tag: 'deprecated', text: 'use something else' }],
    });
  });
});

describe('StepMatcher', () => {
  it('matches cucumber expressions with unknown (runtime) parameter types', () => {
    const matcher = new StepMatcher([
      def('I open {value} url'),
      def('I expect text of {playwrightLocator} {validation} {value}'),
      def('I click {string}'),
    ]);
    expect(matcher.size).toBe(3);
    expect(matcher.match("I open 'https://qavajs.github.io' url")?.expression).toBe('I open {value} url');
    expect(matcher.match("I expect text of 'Login Form > Title' not to equal '$title'")?.expression).toContain('{validation}');
    expect(matcher.match('I click "Save"')?.expression).toBe('I click {string}');
    expect(matcher.match('something else')).toBeUndefined();
  });

  it('matches regex steps and uses declared parameter types', () => {
    const matcher = new StepMatcher(
      [def('^I type "(.*)"$', { regex: { flags: 'i' } }), def('I pick {color}')],
      [{ name: 'color', regexp: { source: 'red|blue', flags: '' } }]
    );
    expect(matcher.match('i TYPE "x"')).toBeDefined();
    expect(matcher.match('I pick red')?.expression).toBe('I pick {color}');
    expect(matcher.match('I pick green')).toBeUndefined();
  });

  it('ignores invalid expressions', () => {
    expect(new StepMatcher([def('I have {'), def('(', { regex: { flags: '' } })]).size).toBe(0);
  });
});

describe('feature line helpers', () => {
  const keywords = ['Given ', 'When ', 'Then ', 'And ', 'But ', '* '];

  it('parses step lines', () => {
    expect(parseStepLine("    When I click 'Button'", keywords)).toEqual({ keyword: 'When', text: "I click 'Button'", textStart: 9 });
    expect(parseStepLine('  * I wait', keywords)).toMatchObject({ keyword: '*', text: 'I wait' });
    expect(parseStepLine('  Scenario: x', keywords)).toBeUndefined();
  });
});

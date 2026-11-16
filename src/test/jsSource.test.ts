import { describe, expect, it } from 'vitest';
import { maskSource, parseParameterTypes, parseStepDefinitions } from '../qavajs/jsSource';

const source = `import { locator } from '@qavajs/steps-playwright/po';

// a component with a template literal selector
class LoginForm {
  /** user name input */
  Username = locator('#user');
  Password = locator(\`input[type="\${'password'}"]\`);
  Submit = locator('button')
    .as(Button)
  static helper() { return '{ not a member }'; }
}

export class App {
  LoginForm = locator('form#login').as(LoginForm);
  private readonly Items: Locator = locator('li') // no semicolon
  Template = locator.template((text: string) => \`//div[text()="\${text}"]\`);
  regex = /}{'"/g;
  get Title() { return locator('h1'); }
  async open(url: string): Promise<void> {
    if (url) { await this.page.goto(url); }
  }
}
`;

describe('maskSource', () => {
  it('blanks comments and literal contents but keeps length and newlines', () => {
    const masked = maskSource(source);
    expect(masked).toHaveLength(source.length);
    expect(masked.split('\n')).toHaveLength(source.split('\n').length);
    expect(masked).not.toContain('{ not a member }');
    expect(masked).not.toContain('user name input');
    expect(masked).not.toContain('}{');
  });
});

describe('parseStepDefinitions', () => {
  const steps = `import { When, Then } from '@qavajs/core';

/**
 * Opens provided url
 * @param {string} url - url to navigate
 * @example I open 'https://google.com' url
 */
When('I open {value} url', async function (url) {});

// not a jsdoc
Then("I expect {value} {validation} {value}", async function () {});

When(/^I type "(.*)" into (?:'|")(.+)(?:'|")$/i, async function () {});

When(\`template \${dynamic}\`, () => {});
cucumber.Given('I am on {string}', () => {});
`;

  it('finds string and regex expressions with their JSDoc', () => {
    const defs = parseStepDefinitions(steps);
    expect(defs.map(d => [d.keyword, d.expression, d.regex?.flags, d.pos.line])).toEqual([
      ['When', 'I open {value} url', undefined, 7],
      ['Then', 'I expect {value} {validation} {value}', undefined, 10],
      ['When', `^I type "(.*)" into (?:'|")(.+)(?:'|")$`, 'i', 12],
    ]);
    expect(defs[0].doc).toContain('@example');
    expect(defs[1].doc).toBeUndefined();
  });

  it('skips template literals with expressions and member calls', () => {
    expect(parseStepDefinitions(steps).some(d => d.expression.includes('template'))).toBe(false);
  });
});

describe('parseParameterTypes', () => {
  it('reads literal parameter type declarations', () => {
    const src = `defineParameterType({ name: 'color', regexp: /red|blue/i, transform: s => s });
defineParameterType({ regexp: getRegexp(), name: 'validation' });`;
    expect(parseParameterTypes(src)).toEqual([
      { name: 'color', regexp: { source: 'red|blue', flags: 'i' } },
      { name: 'validation', regexp: undefined },
    ]);
  });
});

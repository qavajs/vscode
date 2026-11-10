const { When, Then, After } = require('@qavajs/core');

let flakyAttempts = 0;

/**
 * Logs a value to stdout
 * @param {string} value - value to log
 * @example When I log 'hello'
 */
When('I log {string}', function (value) {
  console.log(`log: ${value}`);
});

/**
 * Compares two strings
 * @param {string} actual - actual value
 * @param {string} expected - expected value
 */
Then('I expect {string} to equal {string}', function (actual, expected) {
  if (actual !== expected) {
    const error = new Error(`expected '${actual}' to equal '${expected}'`);
    error.name = 'AssertionError';
    throw error;
  }
});

When('I fail on the first attempt', function () {
  if (flakyAttempts++ === 0) {
    throw new Error('first attempt fails');
  }
});

When('I attach a screenshot', function () {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  this.attach(Buffer.from(png, 'base64'), 'image/png');
});

Then('env {string} is {string}', function (name, value) {
  if (process.env[name] !== value) {
    throw new Error(`env ${name} is '${process.env[name]}'`);
  }
});

When('I wait {int} seconds', function (seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}, { timeout: 120_000 });

After({ name: 'broken hook', tags: '@brokenhook' }, function () {
  throw new Error('hook failed');
});

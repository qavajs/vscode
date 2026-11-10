@basic
Feature: Basic

  Background:
    When I log 'background'

  @smoke
  Scenario: passes
    When I log 'hello'

  Scenario: fails with diff
    When I attach a screenshot
    Then I expect 'admin' to equal 'root'

  Scenario: flaky
    When I fail on the first attempt

  @brokenhook
  Scenario: hook breaks
    When I log 'x'

  Scenario: undefined step
    When nobody implemented this

  Scenario Outline: row <n>
    Then I expect '<n>' to equal '1'

    @rows
    Examples:
      | n |
      | 1 |
      | 2 |

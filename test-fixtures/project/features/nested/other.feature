Feature: Other

  Rule: env and tags
    @smoke
    Scenario: env from profile
      Then env 'QAVAJS_FIXTURE' is 'from-profile'

    Scenario: slow
      When I wait 60 seconds

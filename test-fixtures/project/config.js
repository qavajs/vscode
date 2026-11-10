// no `paths` here: qavajs merges config paths with --paths, which would run every feature
module.exports = {
  default: {
    require: ['step_definition/*.js'],
    retry: 1,
  },
};

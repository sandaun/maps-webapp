/**
 * Conventional Commits, enforced locally by the .husky/commit-msg hook and used
 * by release-please to decide the next version on every push to `main`.
 *
 * Commit format:  <type>(<optional scope>): <subject>
 * Example:        feat(signals): add compact grid mode
 *
 * Version bump caused by each type (see release-please-config.json):
 *   feat      -> minor   (0.1.0 -> 0.2.0)   new user-facing capability
 *   fix       -> patch   (0.1.0 -> 0.1.1)   bug fix
 *   perf      -> patch                      performance improvement
 *   chore     -> patch                      maintenance, deps, tooling
 *   revert    -> patch                      reverts a previous commit
 *   docs      -> none                       documentation only
 *   style     -> none                       formatting, whitespace, no code change
 *   refactor  -> none                       code change with no behaviour change
 *   test      -> none                       tests only
 *   ci        -> none                       CI configuration only
 *   build     -> none                       build system or dependencies
 *
 * Breaking changes bump MAJOR regardless of type. Mark them either with a `!`
 * after the type/scope (`feat!:`, `fix(api)!:`) or with a `BREAKING CHANGE:`
 * footer in the commit body. While the version is still 0.x, a breaking change
 * bumps the minor (0.1.0 -> 0.2.0) rather than reaching 1.0.0.
 */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", // minor
        "fix", // patch
        "chore", // patch
        "docs", // no bump
        "style", // no bump
        "refactor", // no bump
        "perf", // patch
        "test", // no bump
        "ci", // no bump
        "build", // no bump
        "revert", // patch
      ],
    ],
    "subject-case": [2, "always", "lower-case"],
    "header-max-length": [2, "always", 100],
  },
};

export default config;

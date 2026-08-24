---
name: Portable npm lockfiles
description: Rules for keeping npm installs portable across registry environments.
---

Do not rely on the active npm registry to repair a lockfile: `package-lock.json`
records each tarball's resolved host, so a lock created behind an internal proxy
will keep targeting that proxy on another machine. Regenerate the lockfile against
the public registry and verify a clean `npm ci` before considering a deployment
portable.

Avoid `file:` values in npm `overrides` for project-root compatibility stubs.
npm can resolve those paths relative to the dependent package, producing invalid
links or a lockfile that `npm ci` rejects. Keep the compatibility-stub mapping as
application metadata and materialize real stub files in a postinstall/build step.

**Why:** Registry access can differ between development and production, and npm's
override-link semantics are not portable across clean installs.

**How to apply:** After changing registry metadata or local compatibility packages,
regenerate the lockfile using the intended public registry, run `npm ci` from an
empty dependency directory, confirm required CLI binaries, then run the complete
production build and startup check.
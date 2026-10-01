import type { Plugin } from "vite";

/**
 * Optional, lazily-loaded browser SDKs (Live AI avatar providers).
 *
 * The widget imports these ONLY via dynamic import() when a visitor taps the
 * avatar button. If a checkout hasn't run `npm install` since they were added,
 * the build and the dev server must still work: the missing package resolves
 * to a stub module that throws when loaded, so the avatar falls back to plain
 * voice instead of breaking the whole widget.
 */
const OPTIONAL_SDKS = ["livekit-client", "@anam-ai/js-sdk"];
const STUB_PREFIX = "\0optional-sdk-missing:";

export function optionalAvatarSdks(): Plugin {
  return {
    name: "optional-avatar-sdks",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!OPTIONAL_SDKS.includes(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved) return resolved;
      this.warn(`${source} is not installed — the Live AI avatar for this provider will fall back to voice. Run npm install.`);
      return STUB_PREFIX + source;
    },
    load(id) {
      if (!id.startsWith(STUB_PREFIX)) return null;
      const name = id.slice(STUB_PREFIX.length);
      return `throw new Error(${JSON.stringify(`${name} is not installed (run npm install)`)});\nexport default {};`;
    },
  };
}

// Live AI avatar provider SDKs are loaded lazily (dynamic import) and treated
// as untyped here, so type-checking works whether or not they are installed
// (see vite.optionalDeps.ts). The adapters in lib/liveAvatar/adapters wrap them.
declare module "livekit-client";
declare module "@anam-ai/js-sdk";

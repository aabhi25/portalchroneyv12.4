import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig(async ({ command }) => ({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    // Replit dev-only plugins: load ONLY for the dev server (Vite command
    // "serve"), never during a production `vite build` (command "build").
    // Gating on the command instead of NODE_ENV is the robust check — the
    // deploy build environment can set NODE_ENV=development, which let
    // cartographer run during the build and crash it ("traverse is not a
    // function"). These plugins add nothing to a built bundle anyway.
    ...(command === "serve" && process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "jspdf": path.resolve(import.meta.dirname, "stubs", "jspdf", "index.js"),
      "jspdf-autotable": path.resolve(import.meta.dirname, "stubs", "jspdf-autotable", "index.js"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    hmr: process.env.REPLIT_DEV_DOMAIN ? false : true,
    fs: {
      strict: false,
      deny: ["**/.*"],
    },
  },
}));

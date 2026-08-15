import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

// Fix for production builds - import.meta.dirname doesn't work in bundled ESM
const __dirname = import.meta.dirname || path.dirname(fileURLToPath(import.meta.url));

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: process.env.REPLIT_DEV_DOMAIN ? false : { server },
    allowedHosts: true as const,
  };

  // vite.config.ts exports a config *function* (so it can gate dev-only
  // plugins on Vite's `command`). When consumed here we must resolve it to a
  // plain object before spreading — spreading the bare function would drop
  // root/aliases/plugins and break dev module resolution.
  const resolvedViteConfig =
    typeof viteConfig === "function"
      ? await (viteConfig as (env: {
          command: "serve" | "build";
          mode: string;
        }) => Promise<Record<string, unknown>> | Record<string, unknown>)({
          command: "serve",
          mode: "development",
        })
      : viteConfig;

  const vite = await createViteServer({
    ...resolvedViteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  // Serve public directory BEFORE Vite middleware so widget.js is served correctly
  const publicPath = path.resolve(__dirname, "..", "public");
  app.use(express.static(publicPath));

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      // Use embed.html for embed routes (smaller bundle)
      const isEmbedRoute = url.startsWith("/embed/");
      const templateFile = isEmbedRoute ? "embed.html" : "index.html";
      const mainEntry = isEmbedRoute ? "/src/main-embed.tsx" : "/src/main.tsx";
      
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        templateFile,
      );

      // always reload the html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="${mainEntry}"`,
        `src="${mainEntry}?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  const embedDistPath = path.resolve(__dirname, "..", "dist", "embed");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));
  
  // Serve embed bundle for embed routes if it exists
  if (fs.existsSync(embedDistPath)) {
    app.use("/embed", express.static(embedDistPath));
  }

  // fall through to appropriate index.html
  app.use("*", (req, res) => {
    const isEmbedRoute = req.originalUrl.startsWith("/embed/");
    
    // Serve embed bundle for embed routes if available
    if (isEmbedRoute && fs.existsSync(path.resolve(embedDistPath, "embed.html"))) {
      res.sendFile(path.resolve(embedDistPath, "embed.html"));
    } else {
      res.sendFile(path.resolve(distPath, "index.html"));
    }
  });
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import environment from "./server/environment.cjs";
import security from "./server/security.cjs";
import { fileURLToPath } from "node:url";

environment.loadEnvironment(fileURLToPath(new URL("./.env", import.meta.url)));
const apiToken = process.env.LOCAL_API_TOKEN;
const apiPort = process.env.PORT || "4010";

export default defineConfig({
  base: "./",
  plugins: [react(), {
    name: "local-api-boundary",
    configureServer(server) {
      if (process.env.VITEST) return;
      security.validateToken(apiToken);
      server.middlewares.use((req, res, next) => {
        if (!security.browserRequestAllowed({ host: req.headers.host, origin: req.headers.origin,
          fetchSite: req.headers["sec-fetch-site"] }, ["127.0.0.1:5173"], [security.DEV_ORIGIN])) {
          res.statusCode = 403;
          res.end("Untrusted development request");
          return;
        }
        next();
      });
    }
  }],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`, changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request) => {
            request.removeHeader("origin");
            request.setHeader("Authorization", `Bearer ${apiToken}`);
          });
        }
      },
      "/health": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true }
    }
  },
  test: {
    include: ["src/**/*.test.{js,jsx}"],
    environment: "jsdom",
    setupFiles: "./src/testSetup.js"
  }
});

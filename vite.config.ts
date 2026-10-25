/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handlePlan, MAX_BODY_BYTES } from "./src/server/handler";
import { handleExtract, MAX_EXTRACT_BODY } from "./src/server/extract";

/** Serves /api/plan during `npm run dev`, using the same handler as production. */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: "dev-api",
    configureServer(server) {
      server.middlewares.use("/api/plan", async (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > MAX_BODY_BYTES * 2) { res.statusCode = 413; return res.end(); }
          chunks.push(c as Buffer);
        }
        const out = await handlePlan(Buffer.concat(chunks).toString(), req.socket.remoteAddress ?? "local", env);
        res.statusCode = out.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out.body));
      });
      server.middlewares.use("/api/extract", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > MAX_EXTRACT_BODY) { res.statusCode = 413; return res.end(JSON.stringify({ error: "File too large. Keep it under 3 MB." })); }
          chunks.push(c as Buffer);
        }
        const out = await handleExtract(Buffer.concat(chunks).toString(), req.socket.remoteAddress ?? "local", env);
        res.statusCode = out.status;
        res.end(JSON.stringify(out.body));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [react(), devApi(env)], test: { globals: true } };
});
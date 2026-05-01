import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { runsRouter } from "./routes/runs.js";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: [
      env.CORS_ORIGIN,
      "http://localhost:3001",
      "http://localhost:3000",
    ],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/v1/runs", runsRouter);

app.get("/", (c) => {
  return c.text("OK");
});

export default app;


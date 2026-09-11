import { createServer } from "node:http";

import app from "./app";
import { logger } from "./lib/logger";
import { attachSignaling } from "./signaling";

// Hosted environments inject PORT; locally we fall back so the server
// can simply be started without ceremony.
const rawPort = process.env["PORT"] ?? "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// An explicit http.Server is needed because the WebRTC signaling
// WebSocket has to share the same port as the REST API — Express's
// app.listen() hides the server instance the upgrade handler needs.
const server = createServer(app);
attachSignaling(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening (REST + /ws signaling)");
});

server.on("error", (err) => {
  logger.error({ err }, "Server failed to listen");
  process.exit(1);
});

import app from "./app";
import { logger } from "./lib/logger";

// Hosted environments inject PORT; locally we fall back so the server
// can simply be started without ceremony.
const rawPort = process.env["PORT"] ?? "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening (REST)");
});

server.on("error", (err) => {
  logger.error({ err }, "Server failed to listen");
  process.exit(1);
});

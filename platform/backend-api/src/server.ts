import { app } from "./app";
import { config } from "./config";
import { logger } from "./services/logger.service";

app.listen(config.port, () => {
  logger.info("Execution service started", {
    port: config.port,
    environment: config.nodeEnv
  });
});

import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.logLevel,
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard"
          }
        }
      : undefined
});

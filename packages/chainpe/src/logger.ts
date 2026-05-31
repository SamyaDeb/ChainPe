/**
 * ChainPe Logger
 * Beautiful, structured logging with colors and icons
 */

import chalk from "chalk";
import type { LogLevel, Logger } from "./types.js";

let currentLogLevel: LogLevel = "normal";

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

const icons = {
  info: chalk.blue("●"),
  success: chalk.green("✓"),
  warn: chalk.yellow("⚠"),
  error: chalk.red("✗"),
  verbose: chalk.gray("○"),
  payment: chalk.green("$"),
  request: chalk.cyan("→"),
  server: chalk.magenta("◆"),
};

const timestamp = (): string => {
  const now = new Date();
  return chalk.gray(
    `[${now.toLocaleTimeString("en-US", { hour12: false })}]`
  );
};

export const logger: Logger = {
  verbose: (message: string, ...args: unknown[]) => {
    if (currentLogLevel === "verbose") {
      console.log(`${timestamp()} ${icons.verbose} ${chalk.gray(message)}`, ...args);
    }
  },

  info: (message: string, ...args: unknown[]) => {
    if (currentLogLevel !== "quiet") {
      console.log(`${timestamp()} ${icons.info} ${message}`, ...args);
    }
  },

  success: (message: string, ...args: unknown[]) => {
    if (currentLogLevel !== "quiet") {
      console.log(`${timestamp()} ${icons.success} ${chalk.green(message)}`, ...args);
    }
  },

  warn: (message: string, ...args: unknown[]) => {
    console.log(`${timestamp()} ${icons.warn} ${chalk.yellow(message)}`, ...args);
  },

  error: (message: string, ...args: unknown[]) => {
    console.error(`${timestamp()} ${icons.error} ${chalk.red(message)}`, ...args);
  },
};

// Specialized loggers for specific events
export const logPayment = (
  amount: string,
  token: string,
  payer: string,
  path: string
): void => {
  if (currentLogLevel !== "quiet") {
    console.log(
      `${timestamp()} ${icons.payment} ${chalk.green.bold(`+${amount} ${token}`)} from ${chalk.cyan(payer.slice(0, 8))}...${chalk.cyan(payer.slice(-4))} → ${chalk.white(path)}`
    );
  }
};

export const logRequest = (
  method: string,
  path: string,
  status: number,
  duration: number
): void => {
  if (currentLogLevel === "verbose") {
    const statusColor =
      status >= 500
        ? chalk.red
        : status >= 400
          ? chalk.yellow
          : status >= 300
            ? chalk.cyan
            : chalk.green;

    console.log(
      `${timestamp()} ${icons.request} ${chalk.white.bold(method)} ${path} ${statusColor(status)} ${chalk.gray(`${duration}ms`)}`
    );
  }
};

export const logServerStart = (port: number, serviceName: string): void => {
  console.log();
  console.log(
    `${timestamp()} ${icons.server} ${chalk.magenta.bold("ChainPe")} proxy started`
  );
  console.log(
    `${chalk.gray("   ")}${icons.info} Service: ${chalk.white.bold(serviceName)}`
  );
  console.log(
    `${chalk.gray("   ")}${icons.info} Listening on: ${chalk.cyan.bold(`http://localhost:${port}`)}`
  );
  console.log();
};

export default logger;

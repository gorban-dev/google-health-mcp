#!/usr/bin/env node
import { runStdioServer } from "./server.js";

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case "setup": {
      const { runSetup } = await import("./cli/setup.js");
      await runSetup();
      break;
    }
    case "auth": {
      const { runAuth } = await import("./cli/auth.js");
      await runAuth();
      break;
    }
    case "doctor": {
      const { runDoctor } = await import("./cli/doctor.js");
      await runDoctor();
      break;
    }
    case undefined:
    case "serve":
      await runStdioServer();
      break;
    default:
      console.error(
        `Unknown command "${command}". Usage: google-health-mcp [setup|auth|doctor|serve]`,
      );
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

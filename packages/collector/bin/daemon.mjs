#!/usr/bin/env node
import { runDaemon } from "../src/daemon.ts";

runDaemon().catch((error) => {
  console.error("[seorak/collector] fatal", error);
  process.exitCode = 1;
});

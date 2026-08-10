#!/usr/bin/env node
import { run } from "../src/cli.ts";

run().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error("[seorak] fatal", err);
    process.exitCode = 1;
  },
);

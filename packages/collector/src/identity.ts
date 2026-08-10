import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deviceIdPath } from "./paths.ts";

let cached: string | undefined;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const path = deviceIdPath();
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) {
      cached = existing;
      return cached;
    }
  } catch {
    // file missing — fall through to create one
  }
  const id = randomUUID();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, id, "utf8");
  cached = id;
  return id;
}

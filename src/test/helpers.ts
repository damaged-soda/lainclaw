import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-home-"));
  const previousHome = process.env.HOME;

  process.env.HOME = home;

  try {
    return await fn(home);
  } finally {
    if (typeof previousHome === "string") {
      process.env.HOME = previousHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
}

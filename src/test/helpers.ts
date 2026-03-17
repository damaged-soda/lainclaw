import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-home-"));
  const legacyHome = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-legacy-home-"));
  const previousHome = process.env.HOME;
  const previousLainclawHome = process.env.LAINCLAW_HOME;

  process.env.LAINCLAW_HOME = home;
  process.env.HOME = legacyHome;

  try {
    return await fn(home);
  } finally {
    if (typeof previousLainclawHome === "string") {
      process.env.LAINCLAW_HOME = previousLainclawHome;
    } else {
      delete process.env.LAINCLAW_HOME;
    }
    if (typeof previousHome === "string") {
      process.env.HOME = previousHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(legacyHome, { recursive: true, force: true });
  }
}

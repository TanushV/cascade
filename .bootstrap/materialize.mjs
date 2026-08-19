import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXPECTED_SHA256 = "2ea552b01521022c9972b93ad6b2c889b91dbe4f9c64589e0051eb38a57e4c95";
const root = resolve(process.cwd());
const bootstrapDir = join(root, ".bootstrap");
const chunkNames = (await readdir(bootstrapDir))
  .filter((name) => /^chunk-\d+$/.test(name))
  .sort();

if (chunkNames.length === 0) {
  throw new Error("Pi Cascade bootstrap chunks are missing");
}

let encoded = "";
for (const name of chunkNames) {
  encoded += await readFile(join(bootstrapDir, name), "utf8");
}

const archive = Buffer.from(encoded.replace(/\s+/g, ""), "base64");
const actual = createHash("sha256").update(archive).digest("hex");
if (actual !== EXPECTED_SHA256) {
  throw new Error(`Pi Cascade source archive checksum mismatch: ${actual}`);
}

const copyChildren = async (from, to) => {
  for (const name of await readdir(from)) {
    await cp(join(from, name), join(to, name), {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
  }
};

const temp = await mkdtemp(join(tmpdir(), "pi-cascade-source-"));
try {
  const archiveName = "source.tar.gz";
  await writeFile(join(temp, archiveName), archive);

  // Use paths relative to cwd. Git for Windows' tar treats `D:\\...` as a
  // remote archive spec because of the drive-letter colon.
  const extract = spawnSync("tar", ["-xzf", archiveName], {
    cwd: temp,
    encoding: "utf8",
  });
  if (extract.status !== 0) {
    throw new Error(`Unable to extract Pi Cascade source: ${extract.stderr || extract.stdout}`);
  }

  await copyChildren(join(temp, "source"), root);

  // Small, reviewable overlays hold fixes discovered by cross-platform CI
  // after the large source archive was signed. They are committed as ordinary
  // source files and applied deterministically after the verified base tree.
  try {
    await copyChildren(join(bootstrapDir, "overlays"), root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await chmod(join(root, "bin", "pi-cascade.mjs"), 0o755);
  process.stdout.write("Materialized verified Pi Cascade source tree.\n");
} finally {
  await rm(temp, { recursive: true, force: true });
}

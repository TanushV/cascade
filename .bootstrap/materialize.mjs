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

const temp = await mkdtemp(join(tmpdir(), "pi-cascade-source-"));
try {
  const archivePath = join(temp, "source.tar.gz");
  await writeFile(archivePath, archive);
  const extract = spawnSync("tar", ["-xzf", archivePath, "-C", temp], {
    cwd: root,
    encoding: "utf8",
  });
  if (extract.status !== 0) {
    throw new Error(`Unable to extract Pi Cascade source: ${extract.stderr || extract.stdout}`);
  }

  const source = join(temp, "source");
  for (const name of await readdir(source)) {
    await cp(join(source, name), join(root, name), {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
  }
  await chmod(join(root, "bin", "pi-cascade.mjs"), 0o755);
  process.stdout.write("Materialized verified Pi Cascade source tree.\n");
} finally {
  await rm(temp, { recursive: true, force: true });
}

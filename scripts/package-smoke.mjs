#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const packageVersion = packageJson.version;
const temporary = mkdtempSync(join(tmpdir(), "cascade-smoke-"));
const packDir = join(temporary, "pack");
const installDir = join(temporary, "install");
const fakePiDir = join(temporary, "fake-pi");
const globalPrefix = join(temporary, "global-prefix");
const gitPrefix = join(temporary, "git-prefix");
const gitSource = join(temporary, "git-source");
mkdirSync(packDir, { recursive: true });
mkdirSync(installDir, { recursive: true });
mkdirSync(join(fakePiDir, "dist"), { recursive: true });
mkdirSync(globalPrefix, { recursive: true });
mkdirSync(gitPrefix, { recursive: true });

function run(executable, args, options = {}) {
  const needsShell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
  return execFileSync(executable, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...options,
    shell: options.shell ?? needsShell
  });
}

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) return run(process.execPath, [npmCli, ...args], options);
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function pack(cwd) {
  const raw = runNpm(["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], {
    cwd,
    capture: true
  });
  const packed = JSON.parse(raw);
  const filename = packed?.[0]?.filename;
  if (!filename) throw new Error(`npm pack did not return a filename: ${raw}`);
  return join(packDir, filename);
}

try {
  // Protocol-faithful local substitute for the published Pi runtime. It has the
  // exact package name/version and bin layout, allowing this smoke test to prove
  // that the final Cascade tarball installs and resolves its own dependency
  // without relying on a pre-existing global `pi` command or network access.
  writeFileSync(join(fakePiDir, "package.json"), `${JSON.stringify({
    name: "@earendil-works/pi-coding-agent",
    version: "0.84.2",
    type: "module",
    main: "./dist/index.js",
    exports: { ".": { import: "./dist/index.js" } },
    bin: { pi: "dist/cli.js" },
    files: ["dist"]
  }, null, 2)}\n`);
  writeFileSync(join(fakePiDir, "dist", "index.js"), "export const smokeRuntime = true;\n");
  writeFileSync(join(fakePiDir, "dist", "cli.js"), `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nconst args = process.argv.slice(2);\nif (args.includes("--version") || args.includes("-v")) { console.log("pi 0.84.2-smoke"); process.exit(0); }\nif (process.env.CASCADE_SMOKE_ARGS) writeFileSync(process.env.CASCADE_SMOKE_ARGS, JSON.stringify(args));\nconsole.log("pi smoke runtime");\n`);
  chmodSync(join(fakePiDir, "dist", "cli.js"), 0o755);

  cpSync(packageRoot, gitSource, {
    recursive: true,
    filter(source) {
      const relative = source.slice(packageRoot.length).replace(/^[/\\]/, "");
      const first = relative.split(/[/\\]/)[0];
      return !["node_modules", ".git", "dist"].includes(first) && !source.endsWith(".tgz");
    }
  });
  run("git", ["init", "-q", "-b", "main"], { cwd: gitSource });
  run("git", ["config", "user.email", "smoke@example.com"], { cwd: gitSource });
  run("git", ["config", "user.name", "Cascade Smoke"], { cwd: gitSource });
  run("git", ["add", "."], { cwd: gitSource });
  run("git", ["commit", "-qm", "smoke source"], { cwd: gitSource });

  const fakePiTarball = pack(fakePiDir);
  const cascadeTarball = pack(packageRoot);

  // Serve the fake runtime through a tiny private npm registry, then install
  // *only* the Cascade tarball. This reproduces the user's real command: npm
  // resolves Pi as Cascade's dependency rather than relying on a separate or
  // pre-existing global install.
  const portFile = join(temporary, "registry-port.txt");
  const registryScript = join(temporary, "registry-server.mjs");
  writeFileSync(registryScript, `
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
const tarballPath = process.argv[2];
const portFile = process.argv[3];
const tarball = readFileSync(tarballPath);
const shasum = createHash("sha1").update(tarball).digest("hex");
const integrity = "sha512-" + createHash("sha512").update(tarball).digest("base64");
const server = http.createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (path.endsWith(".tgz")) {
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": tarball.length });
    response.end(tarball);
    return;
  }
  if (path === "/@earendil-works/pi-coding-agent" || path === "/@earendil-works%2fpi-coding-agent") {
    const port = server.address().port;
    const version = {
      name: "@earendil-works/pi-coding-agent",
      version: "0.84.2",
      type: "module",
      main: "./dist/index.js",
      exports: { ".": { import: "./dist/index.js" } },
      bin: { pi: "dist/cli.js" },
      dist: {
        tarball: \`http://127.0.0.1:\${port}/@earendil-works/pi-coding-agent/-/pi-coding-agent-0.84.2.tgz\`,
        shasum,
        integrity
      }
    };
    const body = Buffer.from(JSON.stringify({
      name: version.name,
      "dist-tags": { latest: version.version },
      versions: { [version.version]: version }
    }));
    response.writeHead(200, { "content-type": "application/json", "content-length": body.length });
    response.end(body);
    return;
  }
  response.writeHead(404);
  response.end("not found");
});
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`);
  const registry = spawn(process.execPath, [registryScript, fakePiTarball, portFile], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt += 1) sleep(25);
  if (!existsSync(portFile)) throw new Error("Local smoke-test npm registry did not start");
  const registryUrl = `http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}`;

  try {
    writeFileSync(join(installDir, "package.json"), `${JSON.stringify({ private: true }, null, 2)}\n`);
    runNpm([
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--engine-strict=false",
      "--registry", registryUrl,
      cascadeTarball
    ], { cwd: installDir });
    runNpm([
      "install",
      "-g",
      "--prefix", globalPrefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--engine-strict=false",
      "--registry", registryUrl,
      cascadeTarball
    ], { cwd: installDir });
    runNpm([
      "install",
      "-g",
      "--prefix", gitPrefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--engine-strict=false",
      "--registry", registryUrl,
      `git+${pathToFileURL(gitSource).href}`
    ], { cwd: installDir });
  } finally {
    registry.kill("SIGTERM");
  }

  const installedRoot = join(installDir, "node_modules", "cascade");
  const installedPackage = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  if (installedPackage.name !== "cascade") throw new Error("Installed package identity is incorrect");
  if (installedPackage.dependencies?.["@earendil-works/pi-coding-agent"] !== "0.84.2") {
    throw new Error("Standalone Pi runtime dependency is missing or unpinned");
  }

  const cli = join(installedRoot, "bin", "cascade.mjs");
  const help = run(process.execPath, [cli, "--help"], { cwd: installDir, capture: true });
  if (!help.includes("Cascade") || !help.includes("--worker-tools")) {
    throw new Error("Installed CLI help is incomplete");
  }

  const version = run(process.execPath, [cli, "--version"], { cwd: installDir, capture: true });
  if (!version.includes(`cascade ${packageVersion}`) || !version.includes("0.84.2-smoke")) {
    throw new Error(`Installed standalone runtime was not resolved: ${version}`);
  }

  const selfTest = run(process.execPath, [cli, "self-test"], { cwd: installDir, capture: true });
  if (!selfTest.includes("Cascade self-test passed")) {
    throw new Error(`Installed self-test failed: ${selfTest}`);
  }

  const globalCli = join(globalPrefix, "bin", process.platform === "win32" ? "cascade.cmd" : "cascade");
  const globalVersion = run(globalCli, ["--version"], { cwd: installDir, capture: true });
  if (!globalVersion.includes(`cascade ${packageVersion}`) || !globalVersion.includes("0.84.2-smoke")) {
    throw new Error(`Global standalone installation did not resolve its runtime: ${globalVersion}`);
  }
  const globalSelfTest = run(globalCli, ["self-test"], { cwd: installDir, capture: true });
  if (!globalSelfTest.includes("Cascade self-test passed")) {
    throw new Error(`Global standalone self-test failed: ${globalSelfTest}`);
  }

  const gitCli = join(gitPrefix, "bin", process.platform === "win32" ? "cascade.cmd" : "cascade");
  const gitVersion = run(gitCli, ["--version"], { cwd: installDir, capture: true });
  if (!gitVersion.includes(`cascade ${packageVersion}`) || !gitVersion.includes("0.84.2-smoke")) {
    throw new Error(`Git-source installation did not resolve its runtime: ${gitVersion}`);
  }
  const gitSelfTest = run(gitCli, ["self-test"], { cwd: installDir, capture: true });
  if (!gitSelfTest.includes("Cascade self-test passed")) {
    throw new Error(`Git-source standalone self-test failed: ${gitSelfTest}`);
  }

  const argsPath = join(temporary, "spawn-args.json");
  run(process.execPath, [
    cli,
    "--single",
    "--worker", "openrouter/vendor/smoke-worker",
    "--",
    "--mode", "json",
    "hello"
  ], {
    cwd: installDir,
    capture: true,
    env: { ...process.env, CASCADE_SMOKE_ARGS: argsPath, CASCADE_STATE_DIR: join(temporary, "state") }
  });
  const spawnedArgs = JSON.parse(readFileSync(argsPath, "utf8"));
  if (!spawnedArgs.includes("--extension") || !spawnedArgs.includes("vendor/smoke-worker")) {
    throw new Error(`Standalone wrapper did not launch bundled Pi correctly: ${JSON.stringify(spawnedArgs)}`);
  }

  console.log(`Standalone package and Git-source smoke tests passed: ${cascadeTarball}`);
} finally {
  if (process.env.CASCADE_SMOKE_KEEP !== "1") rmSync(temporary, { recursive: true, force: true });
  else console.log(`Smoke workspace retained at ${temporary}`);
}

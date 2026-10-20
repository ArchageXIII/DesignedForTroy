import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, mkdir, writeFile, rm, copyFile, symlink, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { build, crc32, payloadFiles, root, sha256 } from "../scripts/build-kit.mjs";
const read = path => readFile(new URL(path, root));
const children = new WeakMap();
function cleanup(context, folder) {
  children.set(context, []);
  context.after(async () => {
    await Promise.all(children.get(context).map(child => new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve); child.kill();
    })));
    await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
}

async function start(cwd, strict, context) {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ["tools/troy-dev.mjs", "game", "--port", String(port), ...(strict ? ["--strict-upload"] : [])], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  children.get(context).push(child);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Harness startup timed out")), 5000);
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Harness exited ${code}: ${stderr}`)); });
    child.stdout.on("data", () => { clearTimeout(timer); resolve(); });
  });
  return `http://127.0.0.1:${port}`;
}

test("all selected payload bytes, snapshots and deterministic outputs match", async () => {
  const outputs = await build();
  for (const [path, bytes] of Object.entries(outputs)) assert.deepEqual(await read(path), bytes, path);
  const provenance = JSON.parse(await read("provenance.json"));
  assert.match(provenance.sourceCommit, /^[a-f0-9]{40}$/);
  for (const path of provenance.snapshots) {
    const origin = provenance.selectedSources.find(s => s.path === path);
    assert.equal(sha256(await read(path)), origin.sourceSha256, path);
  }
  const runner = (await read("tools/troy-dev.mjs")).toString();
  assert.doesNotMatch(runner, /repoSdkPath|\.\.\/\.\.\/\.\.\/shared/);
  assert.doesNotMatch(payloadFiles.join("\n"), /developer_internal|node_modules|\.env|functions\/|client\/src/);
});

test("relative documentation links and anchors resolve in checkout and kit", async () => {
  const slugs = text => {
    const counts = new Map();
    return text.split("\n").filter(l => /^#{1,6} /.test(l)).map(l => {
      const slug = l.replace(/^#+ /, "").toLowerCase().replace(/[`*]/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
      const n = counts.get(slug) ?? 0; counts.set(slug, n + 1); return n ? `${slug}-${n}` : slug;
    });
  };
  for (const path of payloadFiles.filter(f => f.endsWith(".md"))) {
    const text = (await read(path)).toString();
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^[a-z]+:/i.test(target)) continue;
      const url = new URL(target, new URL(path, root));
      const bytes = await readFile(url);
      if (url.hash) assert.ok(slugs(bytes.toString()).includes(decodeURIComponent(url.hash.slice(1))), `${path}: ${target}`);
    }
  }
});

test("archive paths/CRC/completeness and extracted kit run with spaces and no sibling source", async context => {
  const folder = await mkdtemp(join(tmpdir(), "TROY isolated kit with spaces "));
  cleanup(context, folder);
  const archive = await read("dist/troy-game-dev-kit-v1.zip");
  let offset = 0; const found = [];
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(archive.readUInt16LE(offset + 8), 0); // stored
    const size = archive.readUInt32LE(offset + 18);
    const length = archive.readUInt16LE(offset + 26);
    const name = archive.subarray(offset + 30, offset + 30 + length).toString();
    assert.match(name, /^troy-game-dev-kit-v1\/[a-zA-Z0-9._/-]+$/);
    assert.ok(!name.split("/").includes(".."));
    const data = archive.subarray(offset + 30 + length, offset + 30 + length + size);
    assert.equal(crc32(data), archive.readUInt32LE(offset + 14));
    const relative = name.replace("troy-game-dev-kit-v1/", "");
    assert.deepEqual(data, await read(relative), relative);
    found.push(relative);
    const destination = join(folder, name);
    await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, data);
    offset += 30 + length + size;
  }
  assert.deepEqual(found.sort(), [...payloadFiles, "manifest.json"].sort());
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  const cwd = join(folder, "troy-game-dev-kit-v1");
  for (const strict of [false, true]) {
    const url = await start(cwd, strict, context);
    assert.equal((await fetch(url + "/__troy/")).status, 200);
    const sdk = Buffer.from(await (await fetch(url + "/shared/troy-game-api-v1.js")).arrayBuffer());
    assert.deepEqual(sdk, await read("tools/troy-game-api-v1.js"));
  }
});

test("harness HTTP strict policy, MIME, CSP, traversal and standalone serving", async context => {
  const folder = await mkdtemp(join(tmpdir(), "TROY HTTP test "));
  cleanup(context, folder);
  await mkdir(join(folder, "game")); await mkdir(join(folder, "tools"));
  for (const path of ["tools/troy-dev.mjs", "tools/troy-game-api-v1.js", "bundle-policy.json", "game/index.html", "game/game.js"]) {
    await copyFile(new URL(path, root), join(folder, path));
  }
  await writeFile(join(folder, "game", "denied.exe"), "denied");
  await writeFile(join(folder, "game", "model.wasm"), "wasm");
  await writeFile(join(folder, "game", "test.svg"), "<svg/>");
  await mkdir(join(folder, "game", "nested"));
  await writeFile(join(folder, "game", "nested", "valid.json"), '{"valid":true}');
  await writeFile(join(folder, "game", "large.bin"), "");
  await truncate(join(folder, "game", "large.bin"), 52428800);
  await mkdir(join(folder, "outside"));
  await writeFile(join(folder, "outside", "private.txt"), "must not be served");
  await symlink(join(folder, "outside"), join(folder, "game", "escape"), process.platform === "win32" ? "junction" : "dir");
  const strict = await start(folder, true, context);
  const page = await fetch(strict + "/");
  assert.equal(page.status, 200); assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'self'/);
  assert.equal((await fetch(strict + "/denied.exe")).status, 404);
  assert.equal((await fetch(strict + "/large.bin")).status, 413);
  assert.equal((await fetch(strict + "/escape/private.txt")).status, 403);
  assert.deepEqual(await (await fetch(strict + "/nested/valid.json")).json(), { valid: true });
  assert.equal((await fetch(strict + "/model.wasm")).headers.get("content-type"), "application/wasm");
  assert.match((await fetch(strict + "/game.js")).headers.get("content-type"), /^application\/javascript/);
  assert.ok((await fetch(strict + "/test.svg")).headers.get("content-security-policy"));
  assert.equal((await fetch(strict + "/%2e%2e%2fbundle-policy.json")).status, 403);
  assert.equal((await fetch(strict + "/", { method: "POST" })).status, 405);
  assert.equal((await fetch(strict + "/", { method: "HEAD" })).headers.get("x-content-type-options"), "nosniff");
  const ordinary = await start(folder, false, context);
  assert.equal((await fetch(ordinary + "/denied.exe")).status, 200);
  assert.equal((await fetch(ordinary + "/escape/private.txt")).status, 403);
  assert.equal((await fetch(ordinary + "/")).headers.get("content-security-policy"), null);
});

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const root = new URL("../", import.meta.url);
export const payloadFiles = [
  ".gitattributes", ".gitignore", ".github/workflows/ci.yml", "AGENTS.md", "LICENSE",
  "NOTICE", "README.md", "UPDATING.md", "package.json", "provenance.json",
  "overview.md", "lifecycle.md", "storage.md", "capture.md", "assets.md",
  "remixability.md", "engines.md", "offline-dev.md", "testing.md", "bundle-policy.json",
  "game/README.md", "game/index.html", "game/game.js", "game/bonus-loader.js",
  "game/bonus-content.js", "game/bonus-content.json", "tools/troy-dev.mjs",
  "tools/troy-game-api-v1.js", "tools/troy-mcp.mjs", "scripts/build-kit.mjs",
  "scripts/test.mjs", "tests/sdk.test.mjs", "tests/loading.test.mjs",
  "tests/mcp.test.mjs", "tests/kit.test.mjs",
  "tests/lifecycle-storage.test.mjs", "tests/integration-fixture.mjs",
].sort();
export const sha256 = data => createHash("sha256").update(data).digest("hex");
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// ZIP32, stored entries. Fixed metadata makes output independent of OS/zlib/time.
export function zip(entries) {
  const local = []; const central = []; let offset = 0;
  for (const [path, data] of entries) {
    const name = Buffer.from(`troy-game-dev-kit-v1/${path}`);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x5c21, 12); // 2026-01-01
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    header.copy(dir, 8, 6, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(dir, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export async function build() {
  const entries = await Promise.all(payloadFiles.map(async path => [path, await readFile(new URL(path, root))]));
  const manifest = Buffer.from(JSON.stringify({
    apiVersion: "v1", protocolVersion: 1, quotaBytes: 65536, minimumNodeVersion: 22,
    mcp: { transport: "stdio", command: "node tools/troy-mcp.mjs" },
    files: entries.map(([path, bytes]) => ({ path, sizeBytes: bytes.length, sha256: sha256(bytes) })),
  }, null, 2) + "\n");
  const archive = zip([...entries, ["manifest.json", manifest]].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const sums = Buffer.from(`${sha256(archive)}  dist/troy-game-dev-kit-v1.zip\n${sha256(manifest)}  manifest.json\n`);
  return { "manifest.json": manifest, "dist/troy-game-dev-kit-v1.zip": archive, "dist/SHA256SUMS": sums };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node 22+ is required.");
  const check = process.argv.includes("--check");
  const outputs = await build();
  if (!check) await mkdir(new URL("dist/", root), { recursive: true });
  for (const [path, bytes] of Object.entries(outputs)) {
    if (check) {
      const existing = await readFile(new URL(path, root));
      if (!existing.equals(bytes)) throw new Error(`${path} is stale; run node scripts/build-kit.mjs`);
    } else await writeFile(new URL(path, root), bytes);
  }
  console.log(check ? "Kit, manifest and checksums are reproducible." : "Built kit, manifest and checksums.");
}

import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node 22+ is required.");
const files = (await readdir(new URL("../tests/", import.meta.url))).filter(f => f.endsWith(".test.mjs")).sort();
const run = spawnSync(process.execPath, ["--test", ...files.map(f => `tests/${f}`)], { cwd: root, stdio: "inherit" });
process.exitCode = run.status ?? 1;

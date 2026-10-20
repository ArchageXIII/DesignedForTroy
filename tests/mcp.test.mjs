import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { handleRequest } from "../tools/troy-mcp.mjs";
const call = (method, params = {}) => handleRequest({ jsonrpc: "2.0", id: 1, method, params });

test("MCP initializes, preserves public tools/resources and reads actual bundled content", async () => {
  assert.equal((await call("initialize", { protocolVersion: "2025-03-26" })).result.protocolVersion, "2025-03-26");
  assert.equal((await call("initialize", { protocolVersion: "unknown" })).result.protocolVersion, "2025-11-25");
  const tools = (await call("tools/list")).result.tools;
  assert.deepEqual(tools.map(t => t.name), ["get_troy_game_api_guide", "get_troy_engine_integration_guide"]);
  for (const tool of tools) for (const topic of tool.inputSchema.properties.topic.enum) {
    const response = await call("tools/call", { name: tool.name, arguments: { topic } });
    assert.equal(response.result.isError, false);
    assert.match(response.result.content[0].text, /must integrate the TROY Game API/);
  }
  const resources = (await call("resources/list")).result.resources;
  assert.equal(resources.length, 21);
  assert.equal(resources.filter(r => r.uri.startsWith("troy://game-api/v1/")).length, 12);
  for (const resource of resources) {
    const response = (await call("resources/read", { uri: resource.uri })).result.contents[0];
    assert.equal(response.uri, resource.uri);
    if (resource.uri.endsWith("/manifest")) {
      assert.deepEqual(JSON.parse(response.text), JSON.parse(await readFile(new URL("../manifest.json", import.meta.url))));
    } else assert.ok(response.text.startsWith("# "));
    assert.doesNotMatch(response.text, /developer_internal|internal_hosting|Use the optional TROY Game API/);
  }
});

test("MCP rejects invalid/private inputs and does not expose filesystem access", async () => {
  for (const args of [{ topic: "internal_hosting" }, { topic: "../LICENSE" }, { topic: "overview", version: "v2" },
    { topic: "overview", file: "LICENSE" }, [], null]) {
    assert.equal((await call("tools/call", { name: "get_troy_game_api_guide", arguments: args })).result.isError, true);
  }
  for (const uri of ["troy://internal-hosting/v1/guide", "file:///etc/passwd", "troy://game-api/v1/../../LICENSE"]) {
    assert.equal((await call("resources/read", { uri })).error.code, -32602);
  }
  assert.equal((await call("tools/call", { name: "__proto__" })).error.code, -32602);
  for (const name of [["get_troy_game_api_guide"], {}, null, 1]) {
    assert.equal((await call("tools/call", { name, arguments: { topic: "overview" } })).error.code, -32602);
  }
  assert.equal((await call("unknown")).error.code, -32601);
  for (const request of [null, [], {}, { jsonrpc: "2.0", method: "ping", id: {} }]) {
    assert.equal((await handleRequest(request)).error.code, -32600);
  }
  assert.equal(await handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("real stdio survives malformed JSON, suppresses notifications and keeps stdout protocol-only", () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../tools/troy-mcp.mjs", import.meta.url))], {
    cwd: process.env.TEMP || "/tmp", encoding: "utf8",
    input: '{bad\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n',
  });
  assert.equal(run.status, 0); assert.equal(run.stderr, "");
  const lines = run.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 2); assert.equal(lines[0].error.code, -32700); assert.deepEqual(lines[1].result, {});
});

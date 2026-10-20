#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node 22+ is required.");
const root = new URL("../", import.meta.url);
const protocolVersion = "2025-11-25";
const supportedVersions = new Set([protocolVersion, "2025-03-26"]);
const documents = {
  overview: "overview.md", lifecycle: "lifecycle.md", storage: "storage.md",
  capture: "capture.md", assets: "assets.md", loading: "assets.md",
  remixability: "remixability.md", engines: "engines.md", "offline-dev": "offline-dev.md",
  testing: "testing.md", examples: "game/README.md", manifest: "manifest.json",
};
const guideTopics = ["overview", "install", "assets", "loading", "remixability", "engines", "lifecycle", "storage", "capture", "testing"];
const engineTopics = ["baseline", "lifecycle", "presentation", "audio", "content", "capture", "diagnostics", "testing", "defold-1.12"];
const toolTopics = {
  get_troy_game_api_guide: guideTopics,
  get_troy_engine_integration_guide: engineTopics,
};
const resources = [
  ...Object.entries(documents).map(([topic, file]) => ({
    uri: `troy://game-api/v1/${topic}`, name: `TROY Game API: ${topic}`,
    mimeType: file.endsWith(".json") ? "application/json" : "text/markdown", file,
  })),
  ...engineTopics.map(topic => ({
    uri: `troy://engine-integration/v1/${topic}`, name: `TROY engine integration: ${topic}`,
    mimeType: "text/markdown", file: "engines.md",
  })),
];
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const result = (id, value) => ({ jsonrpc: "2.0", id, result: value });
const error = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const read = file => readFile(new URL(file, root), "utf8");

export async function handleRequest(request) {
  if (!object(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string"
    || (Object.hasOwn(request, "id") && request.id !== null && typeof request.id !== "string" && typeof request.id !== "number")
    || (request.params !== undefined && !object(request.params))) {
    return error(null, -32600, "Invalid JSON-RPC request.");
  }
  // Notifications never receive responses, including unknown notifications.
  if (!Object.hasOwn(request, "id")) return null;
  const { id, method, params = {} } = request;
  if (method === "initialize") return result(id, {
    protocolVersion: supportedVersions.has(params.protocolVersion) ? params.protocolVersion : protocolVersion,
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: "troy-game-api", version: "1.2.0" },
    instructions: "Every TROY game must integrate the Game API and working lifecycle handling, input cleanup and gesture-gated audio. Meaningful progress or preferences require API storage. Capture is recommended. Read overview, assets and loading before implementation. Existing published games remain compatible until replacement. This server reads bundled public documents only.",
  });
  if (method === "ping") return result(id, {});
  if (method === "tools/list") return result(id, {
    tools: Object.entries(toolTopics).map(([name, topics]) => ({
      name, description: "Read complete bundled public TROY v1 guidance.",
      inputSchema: {
        type: "object", properties: { version: { type: "string", enum: ["v1"], default: "v1" }, topic: { type: "string", enum: topics } },
        required: ["topic"], additionalProperties: false,
      },
    })),
  });
  if (method === "tools/call") {
    if (!Object.hasOwn(toolTopics, params.name ?? "")) return error(id, -32602, "Unknown TROY MCP tool.");
    const args = params.arguments;
    if (!object(args) || Object.keys(args).some(key => !["version", "topic"].includes(key))
      || (args.version !== undefined && args.version !== "v1") || !toolTopics[params.name].includes(args.topic)) {
      return result(id, { isError: true, content: [{ type: "text", text: "Choose version v1 and a listed public topic; no other arguments are accepted." }] });
    }
    const file = params.name === "get_troy_engine_integration_guide" ? "engines.md"
      : documents[args.topic === "install" ? "offline-dev" : args.topic];
    return result(id, { isError: false, content: [{ type: "text", text: await read(file) }] });
  }
  if (method === "resources/list") return result(id, {
    resources: resources.map(({ file: _file, ...resource }) => resource),
  });
  if (method === "resources/read") {
    const resource = resources.find(entry => entry.uri === params.uri);
    if (!resource) return error(id, -32602, "Unknown TROY Game API resource.");
    return result(id, { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: await read(resource.file) }] });
  }
  return error(id, -32601, "Unsupported MCP method.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    let request;
    try { request = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify(error(null, -32700, "Parse error.")) + "\n"); continue; }
    try {
      const response = await handleRequest(request);
      if (response) process.stdout.write(JSON.stringify(response) + "\n");
    } catch {
      process.stderr.write("Unable to read bundled TROY guidance.\n");
      if (object(request) && Object.hasOwn(request, "id")) {
        process.stdout.write(JSON.stringify(error(request.id, -32603, "Internal MCP error.")) + "\n");
      }
    }
  }
}

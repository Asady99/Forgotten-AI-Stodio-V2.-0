const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "production-engine", "worker.js"),
  "utf8"
).replace("export default {", "module.exports = {");

const moduleBox = { exports: {} };
vm.runInNewContext(source, {
  module: moduleBox,
  URL,
  Response,
  crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" }
});
const worker = moduleBox.exports.default || moduleBox.exports;

function request(url, method = "GET", headers = {}) {
  return new Request(url, { method, headers });
}

async function invoke(req, env = {}, ctx = {}) {
  return worker.fetch(req, env, ctx);
}

test("health endpoint clearly reports scaffold and does not claim readiness", async () => {
  const response = await invoke(request("https://engine.test/health"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "scaffold");
  assert.equal(body.deployed, false);
  assert.equal(body.database_migration_required, true);
  assert.equal(body.compute_adapter, "not_configured");
  assert.equal(body.storage_adapter, "not_configured");
  assert.equal(body.paid_fallbacks, false);
});

test("owner job listing is denied without verified owner authentication", async () => {
  const response = await invoke(request("https://engine.test/jobs"), {});
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: "Unauthorized" });
});

test("a caller-supplied email header cannot impersonate the owner", async () => {
  const response = await invoke(request("https://engine.test/jobs", "GET", {
    "x-user-email": "owner@example.com"
  }), { STUDIO_OWNER_EMAIL: "owner@example.com" });
  assert.equal(response.status, 401);
});

test("orchestrator stage updates require the separate orchestrator token", async () => {
  const response = await invoke(request(
    "https://engine.test/jobs/00000000-0000-4000-8000-000000000001/stage",
    "POST",
    { "Content-Type": "application/json" }
  ), { STUDIO_OWNER_TOKEN: "owner-secret" });
  assert.equal(response.status, 401);
});

test("browser requests from an unapproved origin are rejected", async () => {
  const response = await invoke(request("https://engine.test/health", "GET", {
    Origin: "https://attacker.example"
  }), { STUDIO_ORIGIN: "https://studio.example" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Origin not allowed");
});

test("CORS preflight is allowed only for the exact configured studio origin", async () => {
  const response = await invoke(request("https://engine.test/jobs", "OPTIONS", {
    Origin: "https://studio.example",
    "Access-Control-Request-Method": "POST"
  }), { STUDIO_ORIGIN: "https://studio.example" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://studio.example");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
});

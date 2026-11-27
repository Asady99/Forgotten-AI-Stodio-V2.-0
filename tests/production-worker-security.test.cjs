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

test("retry endpoint requires the orchestrator credential, not the owner credential", async () => {
  const path="https://engine.test/jobs/00000000-0000-4000-8000-000000000001/retry";
  const ownerOnly=await invoke(request(path,"POST",{Authorization:"Bearer owner-secret"}),{
    STUDIO_OWNER_TOKEN:"owner-secret"
  });
  assert.equal(ownerOnly.status,401);
  const orchestrator=await invoke(request(path,"POST",{Authorization:"Bearer orchestrator-secret"}),{
    STUDIO_ORCHESTRATOR_TOKEN:"orchestrator-secret"
  });
  assert.equal(orchestrator.status,500); // Auth passed; missing DB is handled by the protected route.
});

test("agent execution endpoints require orchestrator credentials", async () => {
  const path="https://engine.test/jobs/00000000-0000-4000-8000-000000000001/agent-runs";
  const ownerOnly=await invoke(request(path,"POST",{"Authorization":"Bearer owner-secret","Content-Type":"application/json"}),{
    STUDIO_OWNER_TOKEN:"owner-secret"
  });
  assert.equal(ownerOnly.status,401);
  const missing=await invoke(request(path,"POST",{"Authorization":"Bearer orchestrator-secret","Content-Type":"application/json"}),{
    STUDIO_ORCHESTRATOR_TOKEN:"orchestrator-secret"
  });
  assert.equal(missing.status,500); // Orchestrator authentication passed; protected DB access failed closed.
});

test("agent run monitoring is owner-only", async () => {
  const path="https://engine.test/jobs/00000000-0000-4000-8000-000000000001/agent-runs";
  const denied=await invoke(request(path));
  assert.equal(denied.status,401);
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

test("Cloudflare Access identity authorizes only the configured owner email", async () => {
  const ownerRequest=request("https://engine.test/jobs");
  const allowed=await invoke(ownerRequest,{STUDIO_OWNER_EMAIL:"OWNER@example.com"},{
    access:{getIdentity:async()=>({email:"owner@example.com"})}
  });
  assert.equal(allowed.status,500); // Auth passed; missing DB is handled by the protected route.
  const denied=await invoke(request("https://engine.test/jobs"),{STUDIO_OWNER_EMAIL:"owner@example.com"},{
    access:{getIdentity:async()=>({email:"someone-else@example.com"})}
  });
  assert.equal(denied.status,401);
});

test("Cloudflare Access identity lookup failure does not bypass owner authentication", async () => {
  const response=await invoke(request("https://engine.test/jobs"),{STUDIO_OWNER_EMAIL:"owner@example.com"},{
    access:{getIdentity:async()=>{throw new Error("identity unavailable");}}
  });
  assert.equal(response.status,401);
});

test("unsupported HTTP methods are not exposed as public routes", async () => {
  const response=await invoke(request("https://engine.test/jobs","DELETE"),{
    STUDIO_OWNER_TOKEN:"owner-secret"
  });
  assert.equal(response.status,401);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "production.js"), "utf8");

function setup(api, fetchImpl) {
  const ids = [
    "production-form", "start-button", "connection-notice",
    "backend-status", "topic", "format", "language", "progress-label",
    "monitor-job-id", "monitor-button", "agent-run-output"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    id,
    disabled: false,
    hidden: false,
    textContent: "",
    value: id === "topic" ? "Test topic" : id === "format" ? "documentary" : id === "monitor-job-id" ? "00000000-0000-4000-8000-000000000001" : "en",
    handlers: {},
    addEventListener(type, callback) { this.handlers[type] = callback; },
    focus() {}
  }]));
  const context = {
    window: { FORGOTTEN_PRODUCTION_API: api },
    document: { getElementById: (id) => elements[id] },
    fetch: fetchImpl,
    console,
    AbortController,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(source, context);
  return elements;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("keeps production disabled when no API URL is configured", () => {
  const elements = setup("", () => { throw new Error("fetch should not run"); });
  assert.equal(elements["start-button"].disabled, true);
  assert.equal(elements["monitor-button"].disabled, true);
  assert.equal(elements["backend-status"].textContent, "Production engine not connected");
});

test("does not enable production when the backend reports scaffold", async () => {
  const elements = setup("https://example.test", async () => ({
    ok: true,
    json: async () => ({ status: "scaffold" })
  }));
  await tick();
  assert.equal(elements["start-button"].disabled, true);
  assert.equal(elements["monitor-button"].disabled, true);
  assert.equal(elements["backend-status"].textContent, "Production engine unavailable");
});

test("enables production only when health reports ready", async () => {
  const elements = setup("https://example.test", async () => ({
    ok: true,
    json: async () => ({ status: "ready" })
  }));
  await tick();
  assert.equal(elements["start-button"].disabled, false);
  assert.equal(elements["backend-status"].textContent, "Production engine connected");
});

test("loads owner-visible agent execution history without rendering HTML", async () => {
  const elements=setup("https://example.test",async (url) => {
    if(url.endsWith("/health")) return {ok:true,json:async()=>({status:"ready"})};
    assert.ok(url.endsWith("/jobs/00000000-0000-4000-8000-000000000001/agent-runs"));
    return {ok:true,json:async()=>({success:true,agent_runs:[{
      agent_name:"Research Agent",stage:"researching",status:"succeeded",attempt_number:1,
      duration_ms:1250,input_ref:"research:topic-1",output_ref:"research:sources-1"
    }]})};
  });
  await tick();
  assert.equal(elements["monitor-button"].disabled,false);
  elements["monitor-button"].handlers.click();
  await tick();
  await tick();
  assert.match(elements["agent-run-output"].textContent,/Research Agent/);
  assert.match(elements["agent-run-output"].textContent,/1250 ms/);
  assert.match(elements["agent-run-output"].textContent,/research:sources-1/);
  assert.equal(elements["agent-run-output"].innerHTML,undefined);
});

test("agent monitor rejects malformed job IDs before making a request", async () => {
  let requests=0;
  const elements=setup("https://example.test",async (url) => {
    requests++;
    return {ok:true,json:async()=>({status:"ready"})};
  });
  await tick();
  elements["monitor-job-id"].value="../../jobs";
  elements["monitor-button"].handlers.click();
  assert.match(elements["agent-run-output"].textContent,/valid production job ID/);
  assert.equal(requests,1); // Only the initial health check was sent.
});

test("submits a job and displays the returned queued job ID", async () => {
  let submitted = false;
  const elements = setup("https://example.test", async (url, options) => {
    if (url.endsWith("/health")) {
      return { ok: true, json: async () => ({ status: "ready" }) };
    }
    submitted = true;
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.equal(body.title, "Test topic");
    assert.equal(body.format, "documentary");
    assert.equal(body.language, "en");
    return { ok: true, json: async () => ({ success: true, job: { id: "job-123" } }) };
  });
  await tick();
  elements["production-form"].handlers.submit({ preventDefault() {} });
  await tick();
  await tick();
  assert.equal(submitted, true);
  assert.equal(elements["progress-label"].textContent, "Job job-123 is queued.");
});

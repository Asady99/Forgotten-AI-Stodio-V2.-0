const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "production.js"), "utf8");

function setup(api, fetchImpl) {
  const ids = [
    "production-form", "start-button", "connection-notice",
    "backend-status", "topic", "format", "language", "progress-label"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    id,
    disabled: false,
    hidden: false,
    textContent: "",
    value: id === "topic" ? "Test topic" : id === "format" ? "documentary" : "en",
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
  assert.equal(elements["backend-status"].textContent, "Production engine not connected");
});

test("does not enable production when the backend reports scaffold", async () => {
  const elements = setup("https://example.test", async () => ({
    ok: true,
    json: async () => ({ status: "scaffold" })
  }));
  await tick();
  assert.equal(elements["start-button"].disabled, true);
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

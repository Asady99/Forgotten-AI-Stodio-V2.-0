const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(
  path.join(__dirname, "..", "production-engine", "worker.js"),
  "utf8"
).replace("export default {", "module.exports = {");

const moduleBox = { exports: {} };
vm.runInNewContext(source, {
  module: moduleBox,
  URL,
  Request,
  Response,
  crypto: webcrypto
});
const worker = moduleBox.exports.default || moduleBox.exports;
const OWNER = "owner-test-token";
const ORCHESTRATOR = "orchestrator-test-token";
const JOB_ID = "00000000-0000-4000-8000-000000000001";

class FakeDB {
  constructor() {
    this.jobs = new Map();
    this.approvals = new Map();
    this.assets = new Map();
  }
  prepare(sql) {
    const db = this;
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first() {
        if (sql.includes("FROM production_jobs WHERE id=?")) return db.jobs.get(args[0]) || null;
        if (sql.includes("FROM production_approvals WHERE job_id=?")) {
          return [...db.approvals.values()].find(a => a.job_id === args[0] && a.approval_type === "final_video" && a.decision === "pending") || null;
        }
        return null;
      },
      async all() {
        if (sql.includes("FROM production_jobs ORDER BY")) return {results:[...db.jobs.values()]};
        if (sql.includes("FROM production_assets")) return {results:[...(db.assets.get(args[0]) || [])]};
        if (sql.includes("FROM production_approvals")) return {results:[...db.approvals.values()].filter(a=>a.job_id===args[0])};
        return {results:[]};
      },
      async run() {
        if (sql.startsWith("UPDATE production_jobs SET status='failed'")) {
          const j=db.jobs.get(args[1]); if (!j || ["approved","rejected","failed"].includes(j.status)) return {meta:{changes:0}};
          Object.assign(j,{status:"failed",current_stage:"failed",error_message:args[0]}); return {meta:{changes:1}};
        }
        if (sql.startsWith("UPDATE production_jobs SET status=?,current_stage=?")) {
          const [status,stage,id,oldStage,oldStatus]=args, j=db.jobs.get(id);
          if (!j || j.current_stage!==oldStage || j.status!==oldStatus) return {meta:{changes:0}};
          Object.assign(j,{status,current_stage:stage,error_message:null}); return {meta:{changes:1}};
        }
        return {meta:{changes:0}};
      }
    };
    return statement;
  }
  async batch(statements) {
    if (statements.length === 2 && this.jobs.size === 0) {
      const [jobStmt, approvalStmt] = statements;
      const [id,project_id,topic_id,title,format,language] = jobStmt.__args || [];
      const [approvalId,jobId] = approvalStmt.__args || [];
      this.jobs.set(id,{id,project_id,topic_id,title,format,language,status:"queued",current_stage:"queued",owner_approval_required:1});
      this.approvals.set(approvalId,{id:approvalId,job_id:jobId,approval_type:"final_video",decision:"pending"});
      return [{meta:{changes:1}},{meta:{changes:1}}];
    }
    return [{meta:{changes:0}},{meta:{changes:0}}];
  }
}

function makeDB() {
  const db = new FakeDB();
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = originalPrepare(sql);
    const originalBind = stmt.bind;
    stmt.bind = (...args) => { stmt.__args=args; return originalBind(...args); };
    return stmt;
  };
  return db;
}
function req(pathname, method, token, body) {
  return new Request("https://engine.test"+pathname,{
    method,
    headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
async function call(pathname, method, token, body, db) {
  const response=await worker.fetch(req(pathname,method,token,body),{
    DB:db,STUDIO_OWNER_TOKEN:OWNER,STUDIO_ORCHESTRATOR_TOKEN:ORCHESTRATOR
  },{});
  return {response,body:await response.json()};
}
async function createJob(db) {
  const result=await call("/jobs","POST",OWNER,{title:"Test documentary",format:"documentary",language:"en"},db);
  assert.equal(result.response.status,201);
  return result.body.job.id;
}

test("job creation validates required topic and production format", async () => {
  const db=makeDB();
  const missing=await call("/jobs","POST",OWNER,{format:"short"},db);
  assert.equal(missing.response.status,400);
  const badFormat=await call("/jobs","POST",OWNER,{title:"Topic",format:"movie"},db);
  assert.equal(badFormat.response.status,400);
  assert.equal(db.jobs.size,0);
});

test("job creation creates queued job and pending final approval record", async () => {
  const db=makeDB();
  const id=await createJob(db);
  assert.equal(db.jobs.get(id).status,"queued");
  assert.equal(db.jobs.get(id).current_stage,"queued");
  assert.equal([...db.approvals.values()].filter(a=>a.job_id===id && a.decision==="pending").length,1);
});

test("stage progression rejects skipping and then accepts the next stage", async () => {
  const db=makeDB(), id=await createJob(db);
  const skipped=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"scripting"},db);
  assert.equal(skipped.response.status,409);
  assert.equal(skipped.body.required_next_stage,"researching");
  const next=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"researching"},db);
  assert.equal(next.response.status,200);
  assert.equal(db.jobs.get(id).current_stage,"researching");
});

test("owner cannot approve before the final review stage", async () => {
  const db=makeDB(), id=await createJob(db);
  const result=await call("/jobs/"+id+"/approval","POST",OWNER,{decision:"approved"},db);
  assert.equal(result.response.status,409);
  assert.equal(db.jobs.get(id).status,"queued");
});

test("unknown stages and invalid approval decisions are rejected", async () => {
  const db=makeDB(), id=await createJob(db);
  const stage=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"publish"},db);
  assert.equal(stage.response.status,400);
  const approval=await call("/jobs/"+id+"/approval","POST",OWNER,{decision:"publish"},db);
  assert.equal(approval.response.status,400);
});

test("failed jobs are terminal and cannot advance", async () => {
  const db=makeDB(), id=await createJob(db);
  const fail=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"failed",error:"test failure"},db);
  assert.equal(fail.response.status,200);
  const retry=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"researching"},db);
  assert.equal(retry.response.status,409);
  assert.equal(db.jobs.get(id).status,"failed");
});

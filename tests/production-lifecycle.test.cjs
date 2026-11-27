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
    this.attempts = new Map();
    this.agentRuns = new Map();
    this.projects = new Set([1]);
    this.topics = new Set(Array.from({length:96},(_,i)=>i+1));
  }
  prepare(sql) {
    const db = this;
    let args = [];
    const statement = {
      sql,
      bind(...values) { args = values; return statement; },
      async first() {
        if (sql.includes("FROM projects WHERE id=?")) return db.projects.has(args[0]) ? {id:args[0]} : null;
        if (sql.includes("FROM topics WHERE id=?")) return db.topics.has(args[0]) ? {id:args[0]} : null;
        if (sql.includes("FROM production_jobs WHERE id=?")) {
          const job=db.jobs.get(args[0]);
          return job ? {...job} : null;
        }
        if (sql.includes("FROM production_approvals WHERE job_id=?")) {
          return [...db.approvals.values()].find(a => a.job_id === args[0] && a.approval_type === "final_video" && a.decision === "pending") || null;
        }
        return null;
      },
      async all() {
        if (sql.includes("FROM production_jobs ORDER BY")) return {results:[...db.jobs.values()]};
        if (sql.includes("FROM production_assets")) return {results:[...(db.assets.get(args[0]) || [])]};
        if (sql.includes("FROM production_approvals")) return {results:[...db.approvals.values()].filter(a=>a.job_id===args[0])};
        if (sql.includes("FROM production_job_attempts")) return {results:[...db.attempts.values()].filter(a=>a.job_id===args[0]).sort((a,b)=>a.attempt_number-b.attempt_number)};
        if (sql.includes("FROM production_agent_runs")) return {results:[...db.agentRuns.values()].filter(a=>a.job_id===args[0])};
        return {results:[]};
      },
      async run() {
        if (sql.startsWith("INSERT INTO production_agent_runs")) {
          const [id,agent_id,agent_name,stage,input_ref,jobId,expectedStage,attemptNumber,attemptJobId,attemptNo]=args;
          const job=db.jobs.get(jobId);
          const activeAttempt=[...db.attempts.values()].find(a=>a.job_id===attemptJobId && a.attempt_number===attemptNo && a.status==="running");
          if (!job || !activeAttempt || ["failed","approved","rejected","awaiting_owner_approval"].includes(job.status) || job.current_stage!==expectedStage || job.attempt_count!==attemptNumber || stage!==expectedStage) return {meta:{changes:0}};
          db.agentRuns.set(id,{id,job_id:jobId,attempt_number:attemptNumber,agent_id,agent_name,stage,status:"running",input_ref,output_ref:null,error_message:null,started_at:"2026-11-27T00:00:00Z",finished_at:null,duration_ms:null});
          return {meta:{changes:1}};
        }
        if (sql.startsWith("UPDATE production_agent_runs SET status=?")) {
          const [status,output_ref,error_message,id,jobId,jobForAttempt]=args;
          const run=db.agentRuns.get(id), job=db.jobs.get(jobId);
          if (!run || !job || run.job_id!==jobId || run.status!=="running" || run.attempt_number!==job.attempt_count || job.id!==jobForAttempt) return {meta:{changes:0}};
          Object.assign(run,{status,output_ref,error_message,finished_at:"2026-11-27T00:00:01Z",duration_ms:1000});
          return {meta:{changes:1}};
        }
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
    const firstSql=statements[0]?.sql || "";
    if (statements.length === 3 && firstSql.startsWith("INSERT INTO production_jobs")) {
      const [jobStmt, approvalStmt, attemptStmt] = statements;
      const [id,project_id,topic_id,title,format,language] = jobStmt.__args || [];
      const [approvalId,jobId] = approvalStmt.__args || [];
      const [attemptId,attemptJobId] = attemptStmt.__args || [];
      this.jobs.set(id,{id,project_id,topic_id,title,format,language,status:"queued",current_stage:"queued",owner_approval_required:1,attempt_count:1,max_attempts:3,last_failed_stage:null,next_retry_at:null});
      this.approvals.set(approvalId,{id:approvalId,job_id:jobId,approval_type:"final_video",decision:"pending"});
      this.attempts.set(attemptId,{id:attemptId,job_id:attemptJobId,attempt_number:1,status:"running",stage:"queued",error_message:null});
      return [{meta:{changes:1}},{meta:{changes:1}},{meta:{changes:1}}];
    }
    if (statements.length === 2 && firstSql.startsWith("INSERT INTO production_job_attempts")) {
      const [attemptId,jobId]=statements[0].__args;
      const job=this.jobs.get(jobId);
      if (!job || job.status!=="failed" || job.attempt_count>=job.max_attempts || (job.next_retry_at && Date.parse(job.next_retry_at)>Date.now())) return [{meta:{changes:0}},{meta:{changes:0}}];
      const number=job.attempt_count+1;
      this.attempts.set(attemptId,{id:attemptId,job_id:jobId,attempt_number:number,status:"running",stage:"queued",error_message:null});
      if (job.status!=="failed" || job.attempt_count>=job.max_attempts || !this.attempts.has(attemptId)) return [{meta:{changes:1}},{meta:{changes:0}}];
      Object.assign(job,{status:"queued",current_stage:"queued",attempt_count:number,last_failed_stage:null,next_retry_at:null,error_message:null});
      return [{meta:{changes:1}},{meta:{changes:1}}];
    }
    if (statements.length === 3 && firstSql.startsWith("UPDATE production_jobs SET status='failed'")) {
      const [delaySeconds,error,id,status,stage,jobId,attemptNumber,attemptStage]=statements[0].__args;
      const [attemptError,attemptJobId,attemptNo,attemptOldStage]=statements[1].__args;
      const job=this.jobs.get(id);
      const attempt=[...this.attempts.values()].find(a=>a.job_id===attemptJobId && a.attempt_number===attemptNo);
      if (!job || !attempt || job.status!==status || job.current_stage!==stage || job.attempt_count!==attemptNumber || attempt.status!=="running" || attempt.stage!==attemptStage || attemptOldStage!==stage) return [{meta:{changes:0}},{meta:{changes:0}}];
      Object.assign(job,{status:"failed",current_stage:"failed",last_failed_stage:stage,next_retry_at:new Date(Date.now()+delaySeconds*1000).toISOString(),error_message:error});
      Object.assign(attempt,{status:"failed",error_message:attemptError});
      let closedRuns=0;
      for (const run of db.agentRuns.values()) {
        if (run.job_id===id && run.attempt_number===attemptNumber && run.stage===stage && run.status==="running") {
          Object.assign(run,{status:"failed",error_message:error,finished_at:"2026-11-27T00:00:01Z",duration_ms:1000});
          closedRuns++;
        }
      }
      return [{meta:{changes:1}},{meta:{changes:1}},{meta:{changes:closedRuns}}];
    }
    if (statements.length === 2 && firstSql.startsWith("UPDATE production_jobs SET status=?,current_stage=?") && firstSql.includes("production_job_attempts")) {
      const [status,stage,id,oldStage,oldStatus,jobId,attemptNumber,attemptStage]=statements[0].__args;
      const [attemptStageNew,finalStage,finalStage2,attemptJobId,attemptNo,attemptOldStage]=statements[1].__args;
      const job=this.jobs.get(id);
      const attempt=[...this.attempts.values()].find(a=>a.job_id===attemptJobId && a.attempt_number===attemptNo);
      const activeRuns=[...this.agentRuns.values()].some(run=>run.job_id===id && run.attempt_number===attemptNumber && run.stage===oldStage && run.status==="running");
      if (!job || !attempt || activeRuns || job.current_stage!==oldStage || job.status!==oldStatus || job.attempt_count!==attemptNumber || attempt.status!=="running" || attempt.stage!==attemptStage || attemptOldStage!==oldStage) return [{meta:{changes:0}},{meta:{changes:0}}];
      Object.assign(job,{status,current_stage:stage,error_message:null});
      Object.assign(attempt,{stage:attemptStageNew,status:finalStage==="awaiting_owner_approval" ? "succeeded":"running"});
      return [{meta:{changes:1}},{meta:{changes:1}}];
    }
    if (statements.length === 2 && firstSql.startsWith("UPDATE production_jobs SET status=?")) {
      const [decision,stage,jobId,approvalId,approvalJobId] = statements[0].__args;
      const [approvalDecision,notes,approvalId2,approvalJobId2,jobId2,jobStatus] = statements[1].__args;
      const job=this.jobs.get(jobId), approval=this.approvals.get(approvalId);
      const valid=!!job && !!approval && job.status==="awaiting_owner_approval" &&
        approval.job_id===approvalJobId && approval.job_id===approvalJobId2 &&
        approval.id===approvalId2 && approval.id===approvalId &&
        approval.decision==="pending" && jobId===jobId2 &&
        approvalDecision===decision && jobStatus===decision;
      if (!valid) return [{meta:{changes:0}},{meta:{changes:0}}];
      Object.assign(job,{status:decision,current_stage:stage});
      Object.assign(approval,{decision:approvalDecision,notes});
      return [{meta:{changes:1}},{meta:{changes:1}}];
    }
    return statements.map(()=>({meta:{changes:0}}));
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

async function advanceToOwnerApproval(db,id) {
  for (const stage of ["researching","scripting","fact_checking","storyboarding","creating_visuals","creating_voice","rendering","quality_review","awaiting_owner_approval"]) {
    const result=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage},db);
    assert.equal(result.response.status,200, "stage "+stage+" should advance");
  }
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

test("job creation accepts existing project and topic references", async () => {
  const db=makeDB();
  const result=await call("/jobs","POST",OWNER,{title:"Linked topic",format:"documentary",project_id:1,topic_id:96},db);
  assert.equal(result.response.status,201);
  const job=db.jobs.get(result.body.job.id);
  assert.equal(job.project_id,1);
  assert.equal(job.topic_id,96);
});

test("job creation rejects invalid or missing project and topic references", async () => {
  const db=makeDB();
  const cases=[
    [{project_id:999},404,"Project not found"],
    [{topic_id:999},404,"Topic not found"],
    [{project_id:0},400,"Invalid project_id"],
    [{topic_id:-1},400,"Invalid topic_id"],
    [{project_id:"1"},400,"Invalid project_id"]
  ];
  for (const [extra,status,error] of cases) {
    const result=await call("/jobs","POST",OWNER,{title:"Linked topic",format:"documentary",...extra},db);
    assert.equal(result.response.status,status);
    assert.equal(result.body.error,error);
  }
  assert.equal(db.jobs.size,0);
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

async function failCurrentAttempt(db,id,error="test failure") {
  const result=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"failed",error},db);
  assert.equal(result.response.status,200);
  db.jobs.get(id).next_retry_at=null; // Helper advances the clock past the backoff for non-backoff tests.
  return result;
}

test("retry endpoint enforces exponential backoff before creating the next attempt", async () => {
  const db=makeDB(), id=await createJob(db);
  const failed=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"failed",error:"temporary failure"},db);
  assert.equal(failed.response.status,200);
  assert.ok(db.jobs.get(id).next_retry_at);
  const blocked=await call("/jobs/"+id+"/retry","POST",ORCHESTRATOR,undefined,db);
  assert.equal(blocked.response.status,429);
  assert.equal(blocked.body.error,"Retry backoff is still active");
  assert.equal(db.jobs.get(id).attempt_count,1);
  db.jobs.get(id).next_retry_at=null;
  const ready=await call("/jobs/"+id+"/retry","POST",ORCHESTRATOR,undefined,db);
  assert.equal(ready.response.status,200);
  assert.equal(db.jobs.get(id).attempt_count,2);
});

test("failed jobs preserve attempt history and can be retried once", async () => {
  const db=makeDB(), id=await createJob(db);
  await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"researching"},db);
  await failCurrentAttempt(db,id,"research provider unavailable");
  let job=db.jobs.get(id);
  assert.equal(job.status,"failed");
  assert.equal(job.last_failed_stage,"researching");
  assert.equal(db.attempts.get([...db.attempts.keys()][0]).status,"failed");
  const retry=await call("/jobs/"+id+"/retry","POST",ORCHESTRATOR,undefined,db);
  assert.equal(retry.response.status,200);
  assert.equal(retry.body.status,"queued");
  assert.equal(retry.body.attempt_count,2);
  assert.equal(retry.body.attempts_remaining,1);
  job=db.jobs.get(id);
  assert.equal(job.status,"queued");
  assert.equal(job.current_stage,"queued");
  assert.equal(job.attempt_count,2);
  assert.equal([...db.attempts.values()].length,2);
  assert.equal([...db.attempts.values()].find(a=>a.attempt_number===2).status,"running");
  const next=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"researching"},db);
  assert.equal(next.response.status,200);
});

test("retry rejects jobs that are not failed and enforces the configured maximum", async () => {
  const db=makeDB(), id=await createJob(db);
  const notFailed=await call("/jobs/"+id+"/retry","POST",ORCHESTRATOR,undefined,db);
  assert.equal(notFailed.response.status,409);
  for (let attempt=1; attempt<=3; attempt++) {
    await failCurrentAttempt(db,id,"attempt "+attempt+" failed");
    if (attempt<3) {
      const retry=await call("/jobs/"+id+"/retry","POST",ORCHESTRATOR,undefined,db);
      assert.equal(retry.response.status,200);
    }
  }
  const exhausted=await call("/jobs/"+id+"/retry","POST",ORCHESTRATOR,undefined,db);
  assert.equal(exhausted.response.status,409);
  assert.equal(exhausted.body.error,"Retry limit reached");
  assert.equal(db.jobs.get(id).attempt_count,3);
  assert.equal([...db.attempts.values()].length,3);
});

test("simultaneous retry requests allow only one new attempt", async () => {
  const db=makeDB(), id=await createJob(db);
  await failCurrentAttempt(db,id);
  const results=await Promise.all([
    call("/jobs/"+id+"/retry","POST",ORCHESTRATOR,undefined,db),
    call("/jobs/"+id+"/retry","POST",ORCHESTRATOR,undefined,db)
  ]);
  assert.deepEqual(results.map(x=>x.response.status).sort(),[200,409]);
  assert.equal(db.jobs.get(id).attempt_count,2);
  assert.equal([...db.attempts.values()].length,2);
});

test("owner approval updates job and approval record together after final review", async () => {
  const db=makeDB(), id=await createJob(db);
  await advanceToOwnerApproval(db,id);
  const result=await call("/jobs/"+id+"/approval","POST",OWNER,{decision:"approved",notes:"Reviewed"},db);
  assert.equal(result.response.status,200);
  assert.equal(result.body.publishing,"not_authorized");
  assert.equal(db.jobs.get(id).status,"approved");
  assert.equal([...db.approvals.values()].find(a=>a.job_id===id).decision,"approved");
});

test("simultaneous owner approval requests allow only one state change", async () => {
  const db=makeDB(), id=await createJob(db);
  await advanceToOwnerApproval(db,id);
  const results=await Promise.all([
    call("/jobs/"+id+"/approval","POST",OWNER,{decision:"approved"},db),
    call("/jobs/"+id+"/approval","POST",OWNER,{decision:"rejected"},db)
  ]);
  assert.deepEqual(results.map(x=>x.response.status).sort(),[200,409]);
  const finalJob=db.jobs.get(id).status;
  const finalApproval=[...db.approvals.values()].find(a=>a.job_id===id).decision;
  assert.equal(finalJob,finalApproval);
  assert.ok(["approved","rejected"].includes(finalJob));
});


test("malformed or non-object JSON bodies return 400 without a server error", async () => {
  const db=makeDB();
  const cases=[
    ["/jobs","POST",OWNER,"{"],
    ["/jobs","POST",OWNER,"null"],
    ["/jobs/"+JOB_ID+"/stage","POST",ORCHESTRATOR,"{"],
    ["/jobs/"+JOB_ID+"/approval","POST",OWNER,"{"]
  ];
  for (const [pathname,method,token,raw] of cases) {
    const response=await worker.fetch(new Request("https://engine.test"+pathname,{
      method,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:raw
    }),{DB:db,STUDIO_OWNER_TOKEN:OWNER,STUDIO_ORCHESTRATOR_TOKEN:ORCHESTRATOR},{});
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(),{success:false,error:"Invalid JSON body"});
  }
  assert.equal(db.jobs.size,0);
});


test("agent execution runs record successful completion and are visible to the owner", async () => {
  const db=makeDB(), id=await createJob(db);
  const started=await call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Research Agent",agent_id:2,stage:"queued",input_ref:"research:topic-96"},db);
  assert.equal(started.response.status,201);
  const runId=started.body.agent_run.id;
  assert.equal(db.agentRuns.get(runId).attempt_number,1);
  const finished=await call("/jobs/"+id+"/agent-runs/"+runId,"POST",ORCHESTRATOR,{status:"succeeded",output_ref:"research:source-pack-1"},db);
  assert.equal(finished.response.status,200);
  assert.equal(db.agentRuns.get(runId).status,"succeeded");
  assert.equal(db.agentRuns.get(runId).duration_ms,1000);
  const visible=await call("/jobs/"+id+"/agent-runs","GET",OWNER,undefined,db);
  assert.equal(visible.response.status,200);
  assert.equal(visible.body.count,1);
  assert.equal(visible.body.agent_runs[0].output_ref,"research:source-pack-1");
});

test("agent execution failure is recorded with redacted diagnostics and can be skipped", async () => {
  const db=makeDB(), id=await createJob(db);
  const failedStart=await call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Fact Check Agent",stage:"queued"},db);
  const failed=await call("/jobs/"+id+"/agent-runs/"+failedStart.body.agent_run.id,"POST",ORCHESTRATOR,{status:"failed",error:"Bearer abc123 token=secret-value"},db);
  assert.equal(failed.response.status,200);
  assert.equal(db.agentRuns.get(failedStart.body.agent_run.id).error_message,"Bearer [REDACTED] token=[REDACTED]");
  const skippedStart=await call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Optional Visual Agent",stage:"queued"},db);
  const skipped=await call("/jobs/"+id+"/agent-runs/"+skippedStart.body.agent_run.id,"POST",ORCHESTRATOR,{status:"skipped"},db);
  assert.equal(skipped.response.status,200);
  assert.equal(db.agentRuns.get(skippedStart.body.agent_run.id).status,"skipped");
});

test("agent execution validates stage and opaque references and rejects duplicate closure", async () => {
  const db=makeDB(), id=await createJob(db);
  const wrongStage=await call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Research Agent",stage:"scripting"},db);
  assert.equal(wrongStage.response.status,400);
  const rawInput=await call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Research Agent",stage:"queued",input_ref:"https://example.com/?token=secret"},db);
  assert.equal(rawInput.response.status,400);
  const started=await call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Research Agent",stage:"queued"},db);
  const runId=started.body.agent_run.id;
  assert.equal((await call("/jobs/"+id+"/agent-runs/"+runId,"POST",ORCHESTRATOR,{status:"succeeded"},db)).response.status,200);
  assert.equal((await call("/jobs/"+id+"/agent-runs/"+runId,"POST",ORCHESTRATOR,{status:"failed"},db)).response.status,409);
});

test("failing a stage closes any active agent runs for that attempt", async () => {
  const db=makeDB(), id=await createJob(db);
  const started=await call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Research Agent",stage:"queued"},db);
  const failed=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"failed",error:"research provider unavailable"},db);
  assert.equal(failed.response.status,200);
  const run=db.agentRuns.get(started.body.agent_run.id);
  assert.equal(run.status,"failed");
  assert.equal(run.error_message,"research provider unavailable");
  assert.ok(run.finished_at);
  assert.ok(run.duration_ms>=0);
});

test("stage progression waits for all current-stage agent runs to close", async () => {
  const db=makeDB(), id=await createJob(db);
  const started=await call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Research Agent",stage:"queued"},db);
  const blocked=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"researching"},db);
  assert.equal(blocked.response.status,409);
  assert.equal(db.jobs.get(id).current_stage,"queued");
  const closed=await call("/jobs/"+id+"/agent-runs/"+started.body.agent_run.id,"POST",ORCHESTRATOR,{status:"succeeded"},db);
  assert.equal(closed.response.status,200);
  const advanced=await call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"researching"},db);
  assert.equal(advanced.response.status,200);
  assert.equal(db.jobs.get(id).current_stage,"researching");
});

test("multiple agents can execute concurrently within the same job stage", async () => {
  const db=makeDB(), id=await createJob(db);
  const results=await Promise.all([
    call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Research Agent",stage:"queued"},db),
    call("/jobs/"+id+"/agent-runs","POST",ORCHESTRATOR,{agent_name:"Topic Agent",stage:"queued"},db)
  ]);
  assert.deepEqual(results.map(x=>x.response.status),[201,201]);
  assert.equal(db.agentRuns.size,2);
  assert.ok([...db.agentRuns.values()].every(run=>run.attempt_number===1 && run.status==="running"));
});

test("simultaneous stage updates from the same stage allow only one transition", async () => {
  const db=makeDB(), id=await createJob(db);
  const results=await Promise.all([
    call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"researching"},db),
    call("/jobs/"+id+"/stage","POST",ORCHESTRATOR,{stage:"researching"},db)
  ]);
  assert.deepEqual(results.map(x=>x.response.status).sort(),[200,409]);
  assert.equal(db.jobs.get(id).current_stage,"researching");
});

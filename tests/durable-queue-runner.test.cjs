const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const runner=fs.readFileSync(path.join(__dirname,"..","production-engine","runner.js"),"utf8");
const migration=fs.readFileSync(path.join(__dirname,"..","production-engine","002_durable_queue.sql"),"utf8");
test("scheduled worker exposes authenticated tick only",()=>{assert.match(runner,/async scheduled\(event,env,ctx\)/);assert.match(runner,/\/internal\/tick/);assert.match(runner,/env\.RUNNER_TOKEN/);});
test("model execution requires D1 and Workers AI without paid fallback",()=>{assert.match(runner,/!env\.AI/);assert.match(runner,/no paid fallback/);assert.match(runner,/paid_fallbacks:false/);assert.doesNotMatch(runner,/api\.elevenlabs|runwayml/i);});
test("durable claims include expiry recovery, lease token and heartbeat",()=>{assert.match(runner,/lease_expires_at<=CURRENT_TIMESTAMP/);assert.match(runner,/lease_token/);assert.match(runner,/heartbeat_at=CURRENT_TIMESTAMP/);});
test("all nine production stages have named agents and sequential next stages",()=>{for(const stage of ["queued","researching","scripting","fact_checking","storyboarding","creating_visuals","creating_voice","rendering","quality_review"])assert.match(runner,new RegExp(stage+":\\{next:"));});
test("runner persists bounded outputs and attempt-scoped agent runs",()=>{assert.match(runner,/INSERT INTO production_agent_outputs/);assert.match(runner,/INSERT INTO production_agent_runs/);assert.match(runner,/output\.slice\(0,24000\)/);});
test("queue triggers enqueue new jobs and reset queue on retry",()=>{assert.match(migration,/trg_production_jobs_enqueue/);assert.match(migration,/trg_production_jobs_retry_enqueue/);assert.match(migration,/ON CONFLICT\(job_id\) DO UPDATE/);});
test("final stage stops at owner approval and cannot publish",()=>{assert.match(runner,/awaiting_owner_approval/);assert.match(runner,/publishing:false/);assert.doesNotMatch(runner,/youtube\.com\/upload|publishVideo/i);});

test("retry budget counts failed executions, not successful queue stage deliveries",()=>{
 assert.ok(runner.includes("failure_count,max_deliveries"));
 assert.ok(runner.includes("(item.failure_count+1)>=item.max_deliveries"));
 assert.ok(runner.includes("failure_count=failure_count+1"));
 assert.ok(runner.includes("item.failure_count)))"));
});
test("staging example has no scheduled trigger and smoke test never sends credentials",()=>{
 const config=fs.readFileSync(path.join(__dirname,"..","wrangler.runner.staging.example.toml"),"utf8");
 const smoke=fs.readFileSync(path.join(__dirname,"..","scripts","runner-staging-smoke.mjs"),"utf8");
 assert.doesNotMatch(config,/crons\\s*=/);
 assert.match(config,/REPLACE_WITH_STAGING_D1_DATABASE_ID/);
 assert.doesNotMatch(smoke,/Authorization|RUNNER_TOKEN/);
 assert.match(smoke,/mutating_tick_invoked:false/);
});

test("stale or expired queue leases cannot persist agent outputs",()=>{
 const jobUpdate=runner.indexOf("UPDATE production_jobs SET status=?,current_stage=?");
 const attemptUpdate=runner.indexOf("UPDATE production_job_attempts SET stage=?,status=?");
 const runInsert=runner.indexOf("INSERT INTO production_agent_runs(id,job_id,attempt_number,agent_name,stage,status,started_at,finished_at,duration_ms,output_ref) SELECT");
 const outputInsert=runner.indexOf("INSERT INTO production_agent_outputs(id,job_id,attempt_number,stage,agent_run_id,output_text,model_name) SELECT");
 const queueComplete=runner.indexOf("UPDATE production_queue SET status=?,available_at=CURRENT_TIMESTAMP");
 assert.ok(jobUpdate>=0 && attemptUpdate>jobUpdate && runInsert>attemptUpdate && outputInsert>runInsert && queueComplete>outputInsert);
 assert.match(runner,/lease_expires_at>CURRENT_TIMESTAMP/);
 assert.match(runner,/q\.lease_token=\?/);
 assert.match(runner,/EXISTS \(SELECT 1 FROM production_agent_runs r WHERE r\.id=\?/);
 assert.match(runner,/EXISTS \(SELECT 1 FROM production_agent_outputs o WHERE o\.id=\?/);
 assert.equal((runner.match(/WHERE changes\(\)!=1/g)||[]).length,1,"one shared sentinel is reused after each guarded write");
 assert.match(runner,/zero-row write into a SQL error/);
});

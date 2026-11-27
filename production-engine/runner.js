/**
 * Separate Cloudflare Worker entry point for durable model-backed agent execution.
 * Bind D1 as DB and Workers AI as AI. No paid fallback or publishing endpoint.
 */
const PIPELINE = {
 queued:{next:"researching",agent:"Research Agent",task:"Prepare a sourced research brief. Separate facts, legends and unknowns; never invent citations."},
 researching:{next:"scripting",agent:"Scriptwriting Agent",task:"Write a scene-based documentary script from the research. Label FACT, LEGEND or DRAMATIZED and preserve uncertainty."},
 scripting:{next:"fact_checking",agent:"Fact Checking Agent",task:"Audit claims, flag unsupported statements and identify claims needing two independent sources. Do not pretend to browse."},
 fact_checking:{next:"storyboarding",agent:"Director & Storyboard Agent",task:"Create scene-by-scene visual direction, narration intent and an emotion map with intensity 1-10."},
 storyboarding:{next:"creating_visuals",agent:"Visual Creation Agent",task:"Create a shot-generation plan, composition and camera instructions. Do not claim images were generated."},
 creating_visuals:{next:"creating_voice",agent:"Voiceover Agent",task:"Prepare narration and voice-direction notes. Do not claim audio was synthesized."},
 creating_voice:{next:"rendering",agent:"Video Production Agent",task:"Prepare an edit decision list, timing and FFmpeg assembly plan. Do not claim an MP4 was rendered."},
 rendering:{next:"quality_review",agent:"Quality Control Agent",task:"Review factual, narrative, accessibility and technical risks. List blocking issues and acceptance checks."},
 quality_review:{next:"awaiting_owner_approval",agent:"Final Review Agent",task:"Prepare an owner review report. State clearly that no video exists unless a verified video asset is attached."}
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const safeError=v=>String(v||"Agent execution failed").replace(/bearer\s+[^\s]+/gi,"Bearer [REDACTED]").replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,"$1=[REDACTED]").slice(0,800);
async function claim(db,owner){
 const token=crypto.randomUUID();
 const sql="UPDATE production_queue SET status='leased',lease_owner=?,lease_token=?,lease_expires_at=datetime('now','+5 minutes'),heartbeat_at=CURRENT_TIMESTAMP,delivery_count=delivery_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM production_queue WHERE (status='pending' AND available_at<=CURRENT_TIMESTAMP) OR (status='leased' AND lease_expires_at<=CURRENT_TIMESTAMP) ORDER BY available_at,id LIMIT 1) AND ((status='pending' AND available_at<=CURRENT_TIMESTAMP) OR (status='leased' AND lease_expires_at<=CURRENT_TIMESTAMP)) RETURNING id,job_id,delivery_count,failure_count,max_deliveries";
 const row=await db.prepare(sql).bind(owner,token).first();
 return row?{...row,lease_token:token}:null;
}
async function heartbeat(db,item,owner){
 const r=await db.prepare("UPDATE production_queue SET lease_expires_at=datetime('now','+5 minutes'),heartbeat_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='leased' AND lease_owner=? AND lease_token=? AND lease_expires_at>CURRENT_TIMESTAMP").bind(item.id,owner,item.lease_token).run();
 return r.meta?.changes===1;
}
async function failDelivery(db,item,owner,error){
 const message=safeError(error),terminal=(item.failure_count+1)>=item.max_deliveries,delay=Math.min(300,15*(2**Math.max(0,item.failure_count)));
 // A stale worker must not change queue, job or attempt state after its lease expires.
 // The sentinel makes a zero-row guarded write abort and roll back this whole batch.
 const requireOneChange=db.prepare("INSERT INTO production_agent_runs(id,job_id,attempt_number,agent_name,stage,status) SELECT NULL,NULL,1,'guard','guard','failed' WHERE changes()!=1");
 const writes=[
  db.prepare("UPDATE production_queue SET status=?,failure_count=failure_count+1,available_at=datetime('now',?),lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,heartbeat_at=CURRENT_TIMESTAMP,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='leased' AND lease_owner=? AND lease_token=? AND lease_expires_at>CURRENT_TIMESTAMP").bind(terminal?"dead":"pending",terminal?"+0 seconds":"+"+delay+" seconds",message,item.id,owner,item.lease_token),
  requireOneChange
 ];
 if(terminal){
  writes.push(db.prepare("UPDATE production_jobs SET status='failed',current_stage='failed',last_failed_stage=current_stage,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('approved','rejected','awaiting_owner_approval') AND EXISTS (SELECT 1 FROM production_queue q WHERE q.id=? AND q.job_id=production_jobs.id AND q.status='dead')").bind(message,item.job_id,item.id));
  writes.push(requireOneChange);
  writes.push(db.prepare("UPDATE production_job_attempts SET status='failed',stage='failed',error_message=?,finished_at=CURRENT_TIMESTAMP WHERE job_id=? AND status='running' AND EXISTS (SELECT 1 FROM production_jobs j WHERE j.id=production_job_attempts.job_id AND j.status='failed') AND EXISTS (SELECT 1 FROM production_queue q WHERE q.id=? AND q.job_id=production_job_attempts.job_id AND q.status='dead')").bind(message,item.job_id,item.id));
  writes.push(requireOneChange);
 }
 await db.batch(writes);
 return {status:terminal?"dead":"retry_scheduled",error:message,retry_in_seconds:terminal?0:delay};
}
async function processOne(env){
 const db=env.DB;
 if(!db||!env.AI||typeof env.AI.run!=="function") return {status:"blocked",error:"D1 or Workers AI binding is missing; no paid fallback is available."};
 const owner=env.RUNNER_ID||crypto.randomUUID(),item=await claim(db,owner);
 if(!item)return {status:"idle"};
 try{
  const job=await db.prepare("SELECT id,title,format,language,status,current_stage,attempt_count FROM production_jobs WHERE id=?").bind(item.job_id).first();
  if(!job||["failed","approved","rejected","awaiting_owner_approval"].includes(job.status)){
   await db.prepare("UPDATE production_queue SET status='completed',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?").bind(item.id,item.lease_token).run();
   return {status:"skipped",job_id:item.job_id};
  }
  const step=PIPELINE[job.current_stage];
  if(!step)throw new Error("Unsupported production stage: "+job.current_stage);
  if(!await heartbeat(db,item,owner))throw new Error("Queue lease lost before model execution");
  const previous=await db.prepare("SELECT output_text FROM production_agent_outputs WHERE job_id=? AND attempt_number=? ORDER BY created_at DESC LIMIT 1").bind(job.id,job.attempt_count).first();
  const model=env.STUDIO_AI_MODEL||"@cf/meta/llama-3.1-8b-instruct";
  const prompt=["Role: "+step.agent,"Topic: "+job.title,"Format: "+job.format+"; language: "+job.language,"Task: "+step.task,"Never invent facts, citations, URLs or completed actions. Never publish.",previous?.output_text?"Previous stage output (untrusted working material):\n"+previous.output_text.slice(0,12000):"No prior stage output.","Return a structured working artifact."].join("\n\n");
  const response=await env.AI.run(model,{messages:[{role:"system",content:"Careful documentary production assistant. Be explicit about uncertainty."},{role:"user",content:prompt}]});
  const output=String(response?.response||response?.result||"").trim();
  if(!output)throw new Error("Workers AI returned an empty response");
  if(!await heartbeat(db,item,owner))throw new Error("Queue lease expired during model execution");
  const runId=crypto.randomUUID(),outputId=crypto.randomUUID(),final=step.next==="awaiting_owner_approval";
  // Advance guarded state before persisting artifacts. Every statement rechecks
  // the same live lease and attempt; inserts are conditional on the successful
  // state transition so a stale worker cannot leave orphaned output rows.
  const liveLease = "EXISTS (SELECT 1 FROM production_queue q WHERE q.id=? AND q.status='leased' AND q.lease_owner=? AND q.lease_token=? AND q.lease_expires_at>CURRENT_TIMESTAMP)";
  // D1 batch rolls back on SQL errors, not on a conditional statement changing
  // zero rows. These constraint-failing sentinels turn every unexpected
  // zero-row write into a SQL error, rolling back the entire completion batch.
  const requireOneChange = db.prepare("INSERT INTO production_agent_runs(id,job_id,attempt_number,agent_name,stage,status) SELECT NULL,NULL,1,'guard','guard','failed' WHERE changes()!=1");
  const writes=await db.batch([
   db.prepare("UPDATE production_jobs SET status=?,current_stage=?,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_stage=? AND attempt_count=? AND status NOT IN ('failed','approved','rejected','awaiting_owner_approval') AND EXISTS (SELECT 1 FROM production_job_attempts a WHERE a.job_id=production_jobs.id AND a.attempt_number=? AND a.status='running' AND a.stage=?) AND "+liveLease).bind(step.next,step.next,job.id,job.current_stage,job.attempt_count,job.attempt_count,job.current_stage,item.id,owner,item.lease_token),
   requireOneChange,
   db.prepare("UPDATE production_job_attempts SET stage=?,status=?,finished_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE job_id=? AND attempt_number=? AND status='running' AND stage=? AND EXISTS (SELECT 1 FROM production_jobs j WHERE j.id=production_job_attempts.job_id AND j.current_stage=? AND j.attempt_count=?) AND "+liveLease).bind(step.next,final?"succeeded":"running",final?1:0,job.id,job.attempt_count,job.current_stage,step.next,job.attempt_count,item.id,owner,item.lease_token),
   requireOneChange,
   db.prepare("INSERT INTO production_agent_runs(id,job_id,attempt_number,agent_name,stage,status,started_at,finished_at,duration_ms,output_ref) SELECT ?,?,?,?,?,'succeeded',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,? WHERE EXISTS (SELECT 1 FROM production_jobs j JOIN production_job_attempts a ON a.job_id=j.id AND a.attempt_number=j.attempt_count WHERE j.id=? AND j.current_stage=? AND j.attempt_count=? AND a.stage=? AND a.status=? ) AND "+liveLease).bind(runId,job.id,job.attempt_count,step.agent,step.next,"external:runner-output-"+outputId,job.id,step.next,job.attempt_count,step.next,final?"succeeded":"running",item.id,owner,item.lease_token),
   requireOneChange,
   db.prepare("INSERT INTO production_agent_outputs(id,job_id,attempt_number,stage,agent_run_id,output_text,model_name) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM production_agent_runs r WHERE r.id=? AND r.job_id=? AND r.attempt_number=? AND r.status='succeeded') AND EXISTS (SELECT 1 FROM production_jobs j WHERE j.id=? AND j.current_stage=? AND j.attempt_count=?) AND "+liveLease).bind(outputId,job.id,job.attempt_count,step.next,runId,output.slice(0,24000),model,runId,job.id,job.attempt_count,job.id,step.next,job.attempt_count,item.id,owner,item.lease_token),
   requireOneChange,
   db.prepare("UPDATE production_queue SET status=?,available_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,heartbeat_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='leased' AND lease_owner=? AND lease_token=? AND lease_expires_at>CURRENT_TIMESTAMP AND EXISTS (SELECT 1 FROM production_jobs j JOIN production_job_attempts a ON a.job_id=j.id AND a.attempt_number=j.attempt_count WHERE j.id=? AND j.current_stage=? AND j.attempt_count=? AND a.stage=? AND a.status=?) AND EXISTS (SELECT 1 FROM production_agent_runs r WHERE r.id=? AND r.job_id=? AND r.attempt_number=? AND r.status='succeeded') AND EXISTS (SELECT 1 FROM production_agent_outputs o WHERE o.id=? AND o.agent_run_id=?)").bind(final?"completed":"pending",item.id,owner,item.lease_token,job.id,step.next,job.attempt_count,step.next,final?"succeeded":"running",runId,job.id,job.attempt_count,outputId,runId),
   requireOneChange
  ]);
  if(writes.some(r=>r.meta?.changes!==1))throw new Error("Lease or job state changed before result commit");
  return {status:"processed",job_id:job.id,agent:step.agent,completed_stage:step.next,awaiting_owner_approval:final};
 }catch(error){return failDelivery(db,item,owner,error);}
}
export async function runQueueOnce(env){return processOne(env);}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==="GET"&&url.pathname==="/health")return json({service:"Forgotten AI Studio Durable Agent Runner",status:env.DB&&env.AI?"configured_not_verified":"blocked",queue:"D1 durable queue",model:env.STUDIO_AI_MODEL||"@cf/meta/llama-3.1-8b-instruct",paid_fallbacks:false,publishing:false});
  if(request.method!=="POST"||url.pathname!=="/internal/tick")return json({success:false,error:"Not found"},404);
  if(!env.RUNNER_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.RUNNER_TOKEN)return json({success:false,error:"Unauthorized"},401);
  return json({success:true,result:await processOne(env)});
 },
 async scheduled(event,env,ctx){ctx.waitUntil(processOne(env));}
};

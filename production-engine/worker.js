/**
 * Forgotten AI Studio Production Engine API.
 * Development-only scaffold. Do not deploy until identity, CORS, D1,
 * storage and compute adapters have been configured and tested.
 */
const json = (body, status = 200, origin = "", allowedOrigin = "") => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
  if (origin && allowedOrigin && origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return new Response(JSON.stringify(body), { status, headers });
};
function hasToken(request, env, name) {
  const expected = env[name];
  return !!expected && (request.headers.get("Authorization") || "") === ("Bearer " + expected);
}
const stages = [
  "queued","researching","scripting","fact_checking","storyboarding",
  "creating_visuals","creating_voice","rendering","quality_review",
  "awaiting_owner_approval","failed"
];
const publicStage = (s) => ({
  queued:"Queued", researching:"Preparing", scripting:"Preparing",
  fact_checking:"Preparing", storyboarding:"Preparing",
  creating_visuals:"Creating visuals", creating_voice:"Creating narration",
  rendering:"Rendering video", quality_review:"Quality check",
  awaiting_owner_approval:"Awaiting your approval", approved:"Approved",
  rejected:"Not approved", failed:"Failed"
}[s] || "In progress");
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.STUDIO_ORIGIN || "";
    const send = (body, status = 200) => json(body, status, origin, allowedOrigin);
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) {
      return send({success:false,error:"Origin not allowed"},403);
    }
    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigin || origin !== allowedOrigin) {
        return new Response(null, {status:403,headers:{"Cache-Control":"no-store"}});
      }
      return new Response(null, {status:204,headers:{
        "Access-Control-Allow-Origin":allowedOrigin,
        "Access-Control-Allow-Credentials":"true",
        "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":"Authorization, Content-Type",
        "Access-Control-Max-Age":"600",
        "Vary":"Origin",
        "Cache-Control":"no-store"
      }});
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return send({
        service:"Forgotten AI Studio Production Engine",
        status:"scaffold",
        deployed:false,
        database_migration_required:true,
        compute_adapter:"not_configured",
        storage_adapter:"not_configured",
        paid_fallbacks:false
      });
    }
    const isOrchestratorStage = request.method === "POST" && (/^\/jobs\/[0-9a-f-]{36}\/stage$/i.test(url.pathname) || /^\/jobs\/[0-9a-f-]{36}\/retry$/i.test(url.pathname));
    const isOwnerAction = (request.method === "POST" && (url.pathname === "/jobs" || /^\/jobs\/[0-9a-f-]{36}\/approval$/i.test(url.pathname))) ||
      (request.method === "GET" && (url.pathname === "/jobs" || /^\/jobs\/[0-9a-f-]{36}$/i.test(url.pathname)));
    // ctx.access exists only when Cloudflare Access authenticated this direct Worker request.
    const accessIdentity = ctx?.access ? await ctx.access.getIdentity().catch(() => null) : null;
    const configuredOwnerEmail = String(env.STUDIO_OWNER_EMAIL || "").trim().toLowerCase();
    const ownerViaAccess = !!configuredOwnerEmail &&
      String(accessIdentity?.email || "").trim().toLowerCase() === configuredOwnerEmail;
    if (isOrchestratorStage ? !hasToken(request,env,"STUDIO_ORCHESTRATOR_TOKEN") :
        isOwnerAction ? !(ownerViaAccess || hasToken(request,env,"STUDIO_OWNER_TOKEN")) : true) {
      return send({success:false,error:"Unauthorized"},401);
    }
    try {
      if (request.method === "POST" && url.pathname === "/jobs") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return send({success:false,error:"Invalid JSON body"},400);
        const title = String(body.title || body.topic || "").trim().slice(0,200);
        const format = body.format;
        const language = ["en","ur","es"].includes(body.language) ? body.language : "en";
        if (!title) return send({success:false,error:"A topic is required"},400);
        if (format !== "documentary" && format !== "short") return send({success:false,error:"Invalid production format"},400);
        const projectId = body.project_id === undefined || body.project_id === null ? null : body.project_id;
        const topicId = body.topic_id === undefined || body.topic_id === null ? null : body.topic_id;
        if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId < 1)) {
          return send({success:false,error:"Invalid project_id"},400);
        }
        if (topicId !== null && (!Number.isSafeInteger(topicId) || topicId < 1)) {
          return send({success:false,error:"Invalid topic_id"},400);
        }
        if (projectId !== null) {
          const project = await env.DB.prepare("SELECT id FROM projects WHERE id=?").bind(projectId).first();
          if (!project) return send({success:false,error:"Project not found"},404);
        }
        if (topicId !== null) {
          const topic = await env.DB.prepare("SELECT id FROM topics WHERE id=?").bind(topicId).first();
          if (!topic) return send({success:false,error:"Topic not found"},404);
        }
        const id = crypto.randomUUID();
        const created = await env.DB.batch([
          env.DB.prepare("INSERT INTO production_jobs (id,project_id,topic_id,title,format,language,status,current_stage,owner_approval_required,attempt_count,max_attempts) VALUES (?,?,?,?,?,?,'queued','queued',1,1,3)")
            .bind(id,projectId,topicId,title,format,language),
          env.DB.prepare("INSERT INTO production_approvals (id,job_id,approval_type,decision) VALUES (?,?,'final_video','pending')")
            .bind(crypto.randomUUID(),id),
          env.DB.prepare("INSERT INTO production_job_attempts (id,job_id,attempt_number,status,stage,started_at) VALUES (?,?,1,'running','queued',CURRENT_TIMESTAMP)")
            .bind(crypto.randomUUID(),id)
        ]);
        if (created.some(result => result.meta?.changes !== 1)) {}
          throw new Error("Atomic job creation did not complete");
        }
        return send({success:true,job:{id,title,format,language,status:"queued",stage_label:publicStage("queued"),owner_approval_required:true}},201);
      }
      if (request.method === "GET" && url.pathname === "/jobs") {
        const result = await env.DB.prepare("SELECT id,title,format,language,status,current_stage,owner_approval_required,attempt_count,max_attempts,last_failed_stage,created_at,updated_at FROM production_jobs ORDER BY created_at DESC LIMIT 50").all();
        return send({success:true,count:result.results.length,jobs:result.results.map(j=>({...j,stage_label:publicStage(j.current_stage)}))});
      }
      const approvalMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/approval$/i);
      if (request.method === "POST" && approvalMatch) {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return send({success:false,error:"Invalid JSON body"},400);
        const decision = body.decision;
        if (!["approved","rejected"].includes(decision)) return send({success:false,error:"Decision must be approved or rejected"},400);
        const id = approvalMatch[1];
        const job = await env.DB.prepare("SELECT id,status FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return send({success:false,error:"Job not found"},404);
        if (job.status !== "awaiting_owner_approval") return send({success:false,error:"Final video is not awaiting owner approval"},409);
        const approval = await env.DB.prepare("SELECT id FROM production_approvals WHERE job_id=? AND approval_type='final_video' AND decision='pending' ORDER BY created_at DESC LIMIT 1").bind(id).first();
        if (!approval) return send({success:false,error:"Pending final-video approval not found"},409);
        const notes = String(body.notes || "").trim().slice(0,1000);
        const results = await env.DB.batch([
          env.DB.prepare("UPDATE production_jobs SET status=?,current_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='awaiting_owner_approval' AND EXISTS (SELECT 1 FROM production_approvals WHERE id=? AND job_id=? AND approval_type='final_video' AND decision='pending')").bind(decision,decision,id,approval.id,id),
          env.DB.prepare("UPDATE production_approvals SET decision=?,notes=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND job_id=? AND decision='pending' AND EXISTS (SELECT 1 FROM production_jobs WHERE id=? AND status=?)").bind(decision,notes,approval.id,id,id,decision)
        ]);
        if (results.some(result => result.meta?.changes !== 1)) {
          return send({success:false,error:"Approval state changed concurrently; refresh and try again"},409);
        }
        return send({success:true,job_id:id,decision,publishing:"not_authorized"});
      }
      const retryMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/retry$/i);
      if (request.method === "POST" && retryMatch) {
        const id = retryMatch[1];
        const job = await env.DB.prepare("SELECT id,status,attempt_count,max_attempts FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return send({success:false,error:"Job not found"},404);
        if (job.status !== "failed") return send({success:false,error:"Only failed jobs can be retried"},409);
        if (job.attempt_count >= job.max_attempts) {
          return send({success:false,error:"Retry limit reached",attempt_count:job.attempt_count,max_attempts:job.max_attempts},409);
        }
        const attemptId = crypto.randomUUID();
        const retried = await env.DB.batch([
          env.DB.prepare("INSERT INTO production_job_attempts (id,job_id,attempt_number,status,stage,started_at) SELECT ?,id,attempt_count+1,'running','queued',CURRENT_TIMESTAMP FROM production_jobs WHERE id=? AND status='failed' AND attempt_count<max_attempts")
            .bind(attemptId,id),
          env.DB.prepare("UPDATE production_jobs SET status='queued',current_stage='queued',attempt_count=attempt_count+1,last_failed_stage=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='failed' AND attempt_count<max_attempts AND EXISTS (SELECT 1 FROM production_job_attempts WHERE job_id=? AND attempt_number=production_jobs.attempt_count+1 AND status='running')")
            .bind(id,id)
        ]);
        if (retried.some(result => result.meta?.changes !== 1)) {
          return send({success:false,error:"Job changed concurrently or retry limit reached; refresh and try again"},409);
        }
        return send({success:true,job_id:id,status:"queued",attempt_count:job.attempt_count+1,max_attempts:job.max_attempts,attempts_remaining:job.max_attempts-job.attempt_count-1});
      }
      const stageMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/stage$/i);
      if (request.method === "POST" && stageMatch) {}
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return send({success:false,error:"Invalid JSON body"},400);
        const stage = String(body.stage || "");
        if (!stages.includes(stage)) return send({success:false,error:"Unknown or owner-only production stage"},400);
        const id = stageMatch[1];
        const job = await env.DB.prepare("SELECT id,status,current_stage,attempt_count,max_attempts FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return send({success:false,error:"Job not found"},404);
        if (["approved","rejected","failed"].includes(job.status)) return send({success:false,error:"Final or failed job state is locked"},409);
        if (stage === "failed") {
          const errorMessage = String(body.error || "Production stage failed").slice(0,1000);
          const failed = await env.DB.batch([
            env.DB.prepare("UPDATE production_jobs SET status='failed',current_stage='failed',last_failed_stage=current_stage,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND current_stage=? AND EXISTS (SELECT 1 FROM production_job_attempts WHERE job_id=? AND attempt_number=? AND status='running' AND stage=?)")
              .bind(errorMessage,id,job.status,job.current_stage,id,job.attempt_count,job.current_stage),
            env.DB.prepare("UPDATE production_job_attempts SET status='failed',error_message=?,finished_at=CURRENT_TIMESTAMP WHERE job_id=? AND attempt_number=? AND status='running' AND stage=?")
              .bind(errorMessage,id,job.attempt_count,job.current_stage)
          ]);
          if (failed.some(result => result.meta?.changes !== 1)) return send({success:false,error:"Job or attempt state changed concurrently; refresh and retry"},409);
          return send({success:true,job_id:id,status:"failed",failed_stage:job.current_stage,attempt_count:job.attempt_count,stage_label:publicStage("failed")});
        }
        const currentIndex = stages.indexOf(job.current_stage);
        const nextIndex = stages.indexOf(stage);
        if (nextIndex !== currentIndex + 1) return send({success:false,error:"Invalid stage transition",current_stage:job.current_stage,required_next_stage:stages[currentIndex+1] || null},409);
        const advanced = await env.DB.batch([
          env.DB.prepare("UPDATE production_jobs SET status=?,current_stage=?,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_stage=? AND status=? AND EXISTS (SELECT 1 FROM production_job_attempts WHERE job_id=? AND attempt_number=? AND status='running' AND stage=?)")
            .bind(stage,stage,id,job.current_stage,job.status,id,job.attempt_count,job.current_stage),
          env.DB.prepare("UPDATE production_job_attempts SET stage=?,status=CASE WHEN ?='awaiting_owner_approval' THEN 'succeeded' ELSE 'running' END,finished_at=CASE WHEN ?='awaiting_owner_approval' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE job_id=? AND attempt_number=? AND status='running' AND stage=?")
            .bind(stage,stage,stage,id,job.attempt_count,job.current_stage)
        ]);
        if (advanced.some(result => result.meta?.changes !== 1)) return send({success:false,error:"Job or attempt state changed concurrently; refresh and retry"},409);
        return send({success:true,job_id:id,status:stage,attempt_count:job.attempt_count,stage_label:publicStage(stage)});
      }
      const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})$/i);
      if (request.method === "GET" && match) {
        const id = match[1];
        const job = await env.DB.prepare("SELECT id,title,format,language,status,current_stage,owner_approval_required,attempt_count,max_attempts,last_failed_stage,created_at,updated_at FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return send({success:false,error:"Job not found"},404);
        const [assets,approvals,attempts] = await Promise.all([
          env.DB.prepare("SELECT id,asset_type,storage_provider,mime_type,size_bytes,created_at FROM production_assets WHERE job_id=? ORDER BY created_at").bind(id).all(),
          env.DB.prepare("SELECT approval_type,decision,notes,decided_at,created_at FROM production_approvals WHERE job_id=? ORDER BY created_at").bind(id).all(),
          env.DB.prepare("SELECT attempt_number,status,stage,error_message,started_at,finished_at,created_at FROM production_job_attempts WHERE job_id=? ORDER BY attempt_number").bind(id).all()
        ]);
        return send({success:true,job:{...job,stage_label:publicStage(job.current_stage)},assets:assets.results,approvals:approvals.results,attempts:attempts.results});
      }
      return send({success:false,error:"Not found"},404);
    } catch (_) {
      return send({success:false,error:"Production Engine request failed"},500);
    }
  }
};

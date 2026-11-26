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
    const isOrchestratorStage = request.method === "POST" && /^\/jobs\/[0-9a-f-]{36}\/stage$/i.test(url.pathname);
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
        const body = await request.json();
        const title = String(body.title || body.topic || "").trim().slice(0,200);
        const format = body.format;
        const language = ["en","ur","es"].includes(body.language) ? body.language : "en";
        if (!title) return send({success:false,error:"A topic is required"},400);
        if (format !== "documentary" && format !== "short") return send({success:false,error:"Invalid production format"},400);
        const id = crypto.randomUUID();
        const created = await env.DB.batch([
          env.DB.prepare("INSERT INTO production_jobs (id,project_id,topic_id,title,format,language,status,current_stage,owner_approval_required) VALUES (?,?,?,?,?,?,'queued','queued',1)")
            .bind(id,Number.isInteger(body.project_id)?body.project_id:null,Number.isInteger(body.topic_id)?body.topic_id:null,title,format,language),
          env.DB.prepare("INSERT INTO production_approvals (id,job_id,approval_type,decision) VALUES (?,?,'final_video','pending')")
            .bind(crypto.randomUUID(),id)
        ]);
        if (created.some(result => result.meta?.changes !== 1)) {
          throw new Error("Atomic job creation did not complete");
        }
        return send({success:true,job:{id,title,format,language,status:"queued",stage_label:publicStage("queued"),owner_approval_required:true}},201);
      }
      if (request.method === "GET" && url.pathname === "/jobs") {
        const result = await env.DB.prepare("SELECT id,title,format,language,status,current_stage,owner_approval_required,created_at,updated_at FROM production_jobs ORDER BY created_at DESC LIMIT 50").all();
        return send({success:true,count:result.results.length,jobs:result.results.map(j=>({...j,stage_label:publicStage(j.current_stage)}))});
      }
      const approvalMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/approval$/i);
      if (request.method === "POST" && approvalMatch) {
        const body = await request.json();
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
      const stageMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/stage$/i);
      if (request.method === "POST" && stageMatch) {
        const body = await request.json();
        const stage = String(body.stage || "");
        if (!stages.includes(stage)) return send({success:false,error:"Unknown or owner-only production stage"},400);
        const id = stageMatch[1];
        const job = await env.DB.prepare("SELECT id,status,current_stage FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return send({success:false,error:"Job not found"},404);
        if (["approved","rejected","failed"].includes(job.status)) return send({success:false,error:"Final or failed job state is locked"},409);
        if (stage === "failed") {
          const errorMessage = String(body.error || "Production stage failed").slice(0,1000);
          const result = await env.DB.prepare("UPDATE production_jobs SET status='failed',current_stage='failed',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('approved','rejected','failed')").bind(errorMessage,id).run();
          if (result.meta?.changes !== 1) return send({success:false,error:"Job state changed concurrently; refresh and retry"},409);
          return send({success:true,job_id:id,status:"failed",stage_label:publicStage("failed")});
        }
        const currentIndex = stages.indexOf(job.current_stage);
        const nextIndex = stages.indexOf(stage);
        if (nextIndex !== currentIndex + 1) return send({success:false,error:"Invalid stage transition",current_stage:job.current_stage,required_next_stage:stages[currentIndex+1] || null},409);
        const result = await env.DB.prepare("UPDATE production_jobs SET status=?,current_stage=?,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_stage=? AND status=?")
          .bind(stage,stage,id,job.current_stage,job.status).run();
        if (result.meta?.changes !== 1) return send({success:false,error:"Job state changed concurrently; refresh and retry"},409);
        return send({success:true,job_id:id,status:stage,stage_label:publicStage(stage)});
      }
      const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})$/i);
      if (request.method === "GET" && match) {
        const id = match[1];
        const job = await env.DB.prepare("SELECT id,title,format,language,status,current_stage,owner_approval_required,created_at,updated_at FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return send({success:false,error:"Job not found"},404);
        const [assets,approvals] = await Promise.all([
          env.DB.prepare("SELECT id,asset_type,storage_provider,mime_type,size_bytes,created_at FROM production_assets WHERE job_id=? ORDER BY created_at").bind(id).all(),
          env.DB.prepare("SELECT approval_type,decision,notes,decided_at,created_at FROM production_approvals WHERE job_id=? ORDER BY created_at").bind(id).all()
        ]);
        return send({success:true,job:{...job,stage_label:publicStage(job.current_stage)},assets:assets.results,approvals:approvals.results});
      }
      return send({success:false,error:"Not found"},404);
    } catch (_) {
      return send({success:false,error:"Production Engine request failed"},500);
    }
  }
};

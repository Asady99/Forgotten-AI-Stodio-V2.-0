/**
 * Forgotten AI Studio Production Engine API.
 * Development-only scaffold. Do not deploy until identity, CORS, D1,
 * storage and compute adapters have been configured and tested.
 */
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, {status:204,headers:{"Allow":"GET,POST,OPTIONS","Cache-Control":"no-store"}});
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
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
    if (isOrchestratorStage ? !hasToken(request,env,"STUDIO_ORCHESTRATOR_TOKEN") :
        isOwnerAction ? !hasToken(request,env,"STUDIO_OWNER_TOKEN") : true) {
      return json({success:false,error:"Unauthorized"},401);
    }
    try {
      if (request.method === "POST" && url.pathname === "/jobs") {
        const body = await request.json();
        const title = String(body.title || body.topic || "").trim().slice(0,200);
        const format = body.format;
        const language = ["en","ur","es"].includes(body.language) ? body.language : "en";
        if (!title) return json({success:false,error:"A topic is required"},400);
        if (format !== "documentary" && format !== "short") return json({success:false,error:"Invalid production format"},400);
        const id = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO production_jobs (id,project_id,topic_id,title,format,language,status,current_stage,owner_approval_required) VALUES (?,?,?,?,?,?,'queued','queued',1)")
          .bind(id,Number.isInteger(body.project_id)?body.project_id:null,Number.isInteger(body.topic_id)?body.topic_id:null,title,format,language).run();
        await env.DB.prepare("INSERT INTO production_approvals (id,job_id,approval_type,decision) VALUES (?,?,'final_video','pending')")
          .bind(crypto.randomUUID(),id).run();
        return json({success:true,job:{id,title,format,language,status:"queued",stage_label:publicStage("queued"),owner_approval_required:true}},201);
      }
      if (request.method === "GET" && url.pathname === "/jobs") {
        const result = await env.DB.prepare("SELECT id,title,format,language,status,current_stage,owner_approval_required,created_at,updated_at FROM production_jobs ORDER BY created_at DESC LIMIT 50").all();
        return json({success:true,count:result.results.length,jobs:result.results.map(j=>({...j,stage_label:publicStage(j.current_stage)}))});
      }
      const approvalMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/approval$/i);
      if (request.method === "POST" && approvalMatch) {
        const body = await request.json();
        const decision = body.decision;
        if (!["approved","rejected"].includes(decision)) return json({success:false,error:"Decision must be approved or rejected"},400);
        const id = approvalMatch[1];
        const job = await env.DB.prepare("SELECT id,status FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return json({success:false,error:"Job not found"},404);
        if (job.status !== "awaiting_owner_approval") return json({success:false,error:"Final video is not awaiting owner approval"},409);
        const approval = await env.DB.prepare("SELECT id FROM production_approvals WHERE job_id=? AND approval_type='final_video' AND decision='pending' ORDER BY created_at DESC LIMIT 1").bind(id).first();
        if (!approval) return json({success:false,error:"Pending final-video approval not found"},409);
        const notes = String(body.notes || "").trim().slice(0,1000);
        await env.DB.batch([
          env.DB.prepare("UPDATE production_approvals SET decision=?,notes=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND decision='pending'").bind(decision,notes,approval.id),
          env.DB.prepare("UPDATE production_jobs SET status=?,current_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='awaiting_owner_approval'").bind(decision,decision,id)
        ]);
        return json({success:true,job_id:id,decision,publishing:"not_authorized"});
      }
      const stageMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/stage$/i);
      if (request.method === "POST" && stageMatch) {
        const body = await request.json();
        const stage = String(body.stage || "");
        if (!stages.includes(stage)) return json({success:false,error:"Unknown or owner-only production stage"},400);
        const id = stageMatch[1];
        const job = await env.DB.prepare("SELECT id,status,current_stage FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return json({success:false,error:"Job not found"},404);
        if (["approved","rejected","failed"].includes(job.status)) return json({success:false,error:"Final or failed job state is locked"},409);
        if (stage === "failed") {
          const errorMessage = String(body.error || "Production stage failed").slice(0,1000);
          await env.DB.prepare("UPDATE production_jobs SET status='failed',current_stage='failed',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('approved','rejected','failed')").bind(errorMessage,id).run();
          return json({success:true,job_id:id,status:"failed",stage_label:publicStage("failed")});
        }
        const currentIndex = stages.indexOf(job.current_stage);
        const nextIndex = stages.indexOf(stage);
        if (nextIndex !== currentIndex + 1) return json({success:false,error:"Invalid stage transition",current_stage:job.current_stage,required_next_stage:stages[currentIndex+1] || null},409);
        await env.DB.prepare("UPDATE production_jobs SET status=?,current_stage=?,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_stage=?")
          .bind(stage,stage,id,job.current_stage).run();
        return json({success:true,job_id:id,status:stage,stage_label:publicStage(stage)});
      }
      const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})$/i);
      if (request.method === "GET" && match) {
        const id = match[1];
        const job = await env.DB.prepare("SELECT * FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return json({success:false,error:"Job not found"},404);
        const [assets,approvals] = await Promise.all([
          env.DB.prepare("SELECT id,asset_type,storage_provider,mime_type,size_bytes,created_at FROM production_assets WHERE job_id=? ORDER BY created_at").bind(id).all(),
          env.DB.prepare("SELECT approval_type,decision,notes,decided_at,created_at FROM production_approvals WHERE job_id=? ORDER BY created_at").bind(id).all()
        ]);
        return json({success:true,job:{...job,stage_label:publicStage(job.current_stage)},assets:assets.results,approvals:approvals.results});
      }
      return json({success:false,error:"Not found"},404);
    } catch (_) {
      return json({success:false,error:"Production Engine request failed"},500);
    }
  }
};

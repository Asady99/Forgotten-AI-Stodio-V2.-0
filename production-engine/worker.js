/**
 * Forgotten AI Studio Production Engine API scaffold.
 * NOT deployed. Requires the additive D1 migration in this folder.
 */
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
function authorized(request, env) {
  const expected = env.STUDIO_API_TOKEN;
  return !!expected && (request.headers.get("Authorization") || "") === ("Bearer " + expected);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({service:"Forgotten AI Studio Production Engine",status:"scaffold",deployed:false,paid_fallbacks:false});
    }
    if (!authorized(request, env)) return json({success:false,error:"Unauthorized"},401);
    try {
      if (request.method === "POST" && url.pathname === "/jobs") {
        const length = Number(request.headers.get("Content-Length") || 0);
        if (length > 12000) return json({success:false,error:"Request too large"},413);
        const body = await request.json();
        const title = String(body.title || body.topic || "").trim().slice(0,200);
        const format = body.format;
        const language = ["en","ur","es"].includes(body.language) ? body.language : "en";
        if (!title) return json({success:false,error:"A topic is required"},400);
        if (format !== "documentary" && format !== "short") return json({success:false,error:"Format must be documentary or short"},400);
        const id = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO production_jobs (id,project_id,topic_id,title,format,language,status,current_stage,owner_approval_required) VALUES (?,?,?,?,?,?,'queued','queued',1)")
          .bind(id,Number.isInteger(body.project_id)?body.project_id:null,Number.isInteger(body.topic_id)?body.topic_id:null,title,format,language).run();
        await env.DB.prepare("INSERT INTO production_approvals (id,job_id,approval_type,decision) VALUES (?,?,'final_video','pending')")
          .bind(crypto.randomUUID(),id).run();
        return json({success:true,job:{id,title,format,language,status:"queued",owner_approval_required:true}},201);
      }
      if (request.method === "GET" && url.pathname === "/jobs") {
        const result = await env.DB.prepare("SELECT id,title,format,language,status,current_stage,owner_approval_required,created_at,updated_at FROM production_jobs ORDER BY created_at DESC LIMIT 50").all();
        return json({success:true,count:result.results.length,jobs:result.results});
      }
      const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})$/i);
      if (request.method === "GET" && match) {
        const id = match[1];
        const job = await env.DB.prepare("SELECT * FROM production_jobs WHERE id=?").bind(id).first();
        if (!job) return json({success:false,error:"Job not found"},404);
        const [runs,assets,approvals] = await Promise.all([
          env.DB.prepare("SELECT * FROM production_agent_runs WHERE job_id=? ORDER BY created_at").bind(id).all(),
          env.DB.prepare("SELECT * FROM production_assets WHERE job_id=? ORDER BY created_at").bind(id).all(),
          env.DB.prepare("SELECT * FROM production_approvals WHERE job_id=? ORDER BY created_at").bind(id).all()
        ]);
        return json({success:true,job,agent_runs:runs.results,assets:assets.results,approvals:approvals.results});
      }
      return json({success:false,error:"Not found"},404);
    } catch (error) {
      return json({success:false,error:"Production Engine request failed"},500);
    }
  }
};

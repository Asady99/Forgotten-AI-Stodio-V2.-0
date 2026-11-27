/* Production-only dashboard. No agent roster or script drafts are exposed here. */
(function(){
  var form=document.getElementById("production-form");
  var button=document.getElementById("start-button");
  var notice=document.getElementById("connection-notice");
  var status=document.getElementById("backend-status");
  var monitorButton=document.getElementById("monitor-button");
  var monitorJobId=document.getElementById("monitor-job-id");
  var monitorOutput=document.getElementById("agent-run-output");
  // Set this only after the production Worker is deployed and its API is verified.
  var API=window.FORGOTTEN_PRODUCTION_API || "";
  if(!API){
    button.disabled=true;
    if(monitorButton) monitorButton.disabled=true;
    status.textContent="Production engine not connected";
    return;
  }
  fetch(API+"/health",{credentials:"include"}).then(function(r){
    if(!r.ok) throw new Error("Health check failed");
    return r.json();
  }).then(function(data){
    if(!data || data.status!=="ready") throw new Error("Engine is not ready");
    status.textContent="Production engine connected";
    notice.hidden=true;
    button.disabled=false;
    if(monitorButton) monitorButton.disabled=false;
  }).catch(function(){
    status.textContent="Production engine unavailable";
    notice.textContent="The production service could not be reached. No job was started.";
    button.disabled=true;
    if(monitorButton) monitorButton.disabled=true;
  });
  form.addEventListener("submit",function(event){
    event.preventDefault();
    var topic=document.getElementById("topic").value.trim();
    if(!topic || button.disabled) return;
    button.disabled=true;
    button.textContent="Submitting…";
    fetch(API+"/jobs",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      title:topic,
      format:document.getElementById("format").value,
      language:document.getElementById("language").value
    })}).then(function(r){
      if(!r.ok) throw new Error("Could not create production job");
      return r.json();
    }).then(function(data){
      if(!data || !data.success) throw new Error("Unexpected production response");
      status.textContent="Production job queued";
      document.getElementById("progress-label").textContent="Job "+data.job.id+" is queued.";
    }).catch(function(){
      notice.hidden=false;
      notice.textContent="Could not start production. No job was created. Please try again when the backend is ready.";
    }).finally(function(){
      button.disabled=false;
      button.textContent="Start Production";
    });
  });
  if(monitorButton && monitorJobId && monitorOutput){
    monitorButton.addEventListener("click",function(){
      var jobId=monitorJobId.value.trim();
      if(!/^[0-9a-f-]{36}$/i.test(jobId)){
        monitorOutput.textContent="Enter a valid production job ID.";
        return;
      }
      monitorButton.disabled=true;
      monitorOutput.textContent="Loading agent execution records…";
      fetch(API+"/jobs/"+encodeURIComponent(jobId)+"/agent-runs",{credentials:"include"}).then(function(r){
        if(!r.ok) throw new Error("Agent log request failed");
        return r.json();
      }).then(function(data){
        if(!data || !data.success || !Array.isArray(data.agent_runs)) throw new Error("Unexpected agent log response");
        if(!data.agent_runs.length){
          monitorOutput.textContent="No agent runs have been recorded for this job yet.";
          return;
        }
        monitorOutput.textContent=data.agent_runs.map(function(run){
          var line=(run.agent_name || "Unnamed agent")+" | "+(run.stage || "unknown stage")+" | "+(run.status || "unknown")+" | attempt "+(run.attempt_number || "?");
          if(Number.isFinite(run.duration_ms)) line+=" | "+run.duration_ms+" ms";
          if(run.error_message) line+="\n  Error: "+run.error_message;
          if(run.input_ref) line+="\n  Input: "+run.input_ref;
          if(run.output_ref) line+="\n  Output: "+run.output_ref;
          return line;
        }).join("\n\n");
      }).catch(function(){
        monitorOutput.textContent="Could not load agent logs. Check the job ID and owner access, then try again.";
      }).finally(function(){
        monitorButton.disabled=false;
      });
    });
  }
})();

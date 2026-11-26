/* Production-only dashboard. No agent roster or script drafts are exposed here. */
(function(){
  var form=document.getElementById("production-form");
  var button=document.getElementById("start-button");
  var notice=document.getElementById("connection-notice");
  var status=document.getElementById("backend-status");
  // Set this only after the production Worker is deployed and its API is verified.
  var API=window.FORGOTTEN_PRODUCTION_API || "";
  if(!API){
    button.disabled=true;
    status.textContent="Production engine not connected";
    return;
  }
  fetch(API+"/health").then(function(r){
    if(!r.ok) throw new Error("Health check failed");
    return r.json();
  }).then(function(data){
    if(!data || data.status!=="ready") throw new Error("Engine is not ready");
    status.textContent="Production engine connected";
    notice.hidden=true;
    button.disabled=false;
  }).catch(function(){
    status.textContent="Production engine unavailable";
    notice.textContent="The production service could not be reached. No job was started.";
    button.disabled=true;
  });
  form.addEventListener("submit",function(event){
    event.preventDefault();
    var topic=document.getElementById("topic").value.trim();
    if(!topic || button.disabled) return;
    button.disabled=true;
    button.textContent="Submitting…";
    fetch(API+"/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
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
})();

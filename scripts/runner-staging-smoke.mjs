const base=process.env.STAGING_RUNNER_URL;
if(!base){console.error("Set STAGING_RUNNER_URL to the isolated staging Runner URL.");process.exit(2);}
const root=base.replace(/\/+$/,"");
const health=await fetch(root+"/health",{headers:{accept:"application/json"}});
const healthBody=await health.json().catch(()=>null);
if(!health.ok||!healthBody||healthBody.service!=="Forgotten AI Studio Durable Agent Runner"){
 console.error("Health endpoint check failed",health.status);process.exit(1);
}
if(healthBody.status!=="configured_not_verified"&&healthBody.status!=="blocked"){
 console.error("Unexpected health state; expected blocked or configured_not_verified.");process.exit(1);
}
const tick=await fetch(root+"/internal/tick",{method:"POST",headers:{accept:"application/json"}});
if(tick.status!==401){
 console.error("Unauthenticated tick was not rejected with HTTP 401; stop staging verification.");process.exit(1);
}
console.log(JSON.stringify({
 health:"passed",
 reported_status:healthBody.status,
 unauthenticated_tick:"rejected (401)",
 mutating_tick_invoked:false,
 secret_sent:false,
 queue_job_claimed:false
},null,2));

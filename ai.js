(function () {
  var AI_URL = "https://bold-mud-516e.bakhatfraz.workers.dev/";
  var btn = document.getElementById("generateButton");
  var out = document.getElementById("output");
  var typeEl = document.getElementById("contentType");
  var inputEl = document.getElementById("promptInput");
  if (!btn || !out) return;
  var busy = false;
  btn.addEventListener("click", function () {
    var idea = inputEl.value.trim();
    if (!idea || busy) return;
    busy = true;
    btn.disabled = true;
    out.textContent = "Generating... this can take up to a minute.";
    var prompt = "Create: " + typeEl.value + "\nIdea: " + idea + "\n\nRules:\n- Use only well-documented facts and tag each scene FACT, LEGEND or DRAMATIZED.\n- Add one clear moral lesson.\n- Plan the emotion of each scene (wonder, suspense, dread, love, awe) with intensity 1-10.\n- End with a memorable closing that calls back the opening and a short quotable final line.\n- List the main sources a researcher should check.\n- If unsure about a fact, say it is uncertain instead of guessing.";
    fetch(AI_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { out.textContent = d.success ? d.result : "Error: " + (d.error || "AI failed."); })
      .catch(function () { out.textContent = "Could not reach the AI server."; })
      .then(function () { busy = false; btn.disabled = false; });
  });
})();

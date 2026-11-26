(function () {
  var AI_URL = "https://bold-mud-516e.bakhatfraz.workers.dev/";
  var btn = document.getElementById("generateButton");
  var out = document.getElementById("output");
  var typeEl = document.getElementById("contentType");
  var inputEl = document.getElementById("promptInput");

  if (!btn || !out || !typeEl || !inputEl) return;

  var busy = false;

  btn.addEventListener("click", function () {
    var idea = inputEl.value.trim();

    if (!idea) {
      out.textContent = "Please enter your creative idea first.";
      inputEl.focus();
      return;
    }

    if (busy) return;

    busy = true;
    btn.disabled = true;
    out.textContent = "Generating... this can take up to a minute.";

    var prompt =
      "Create: " + typeEl.value +
      "\nIdea: " + idea +
      "\n\nRules:\n" +
      "- Use only well-documented facts and tag each scene FACT, LEGEND or DRAMATIZED.\n" +
      "- Add one clear moral lesson.\n" +
      "- Plan the emotion of each scene (wonder, suspense, dread, love, awe) with intensity 1-10.\n" +
      "- End with a memorable closing that calls back the opening and a short quotable final line.\n" +
      "- List the main sources a researcher should check.\n" +
      "- If unsure about a fact, say it is uncertain instead of guessing.";

    fetch(AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt })
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("AI server returned HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        if (data && data.success && typeof data.result === "string") {
          out.textContent = data.result;
        } else {
          out.textContent = "Error: " + ((data && data.error) || "The AI server returned an unexpected response.");
        }
      })
      .catch(function (error) {
        out.textContent = "Could not generate content. " + (error && error.message ? error.message : "Please try again.");
      })
      .then(function () {
        busy = false;
        btn.disabled = false;
      });
  });
})();

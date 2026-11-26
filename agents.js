(function () {
  var API = "https://forgotten-agents-api.bakhatfraz.workers.dev/";
  var status = document.getElementById("agents-status");
  var grid = document.getElementById("agents-grid");

  if (!status || !grid) return;

  fetch(API)
    .then(function (response) {
      if (!response.ok) throw new Error("Agents API returned HTTP " + response.status);
      return response.json();
    })
    .then(function (data) {
      if (!data || !data.success || !Array.isArray(data.agents)) {
        throw new Error("Unexpected agents API response.");
      }

      var active = data.agents.filter(function (agent) {
        return agent.status === "active";
      }).length;

      status.textContent = data.count + " agents, " + active + " active";

      data.agents.forEach(function (agent) {
        var card = document.createElement("article");
        card.className = "agent-card";

        var title = document.createElement("strong");
        title.textContent = agent.id + ". " + agent.name;

        var badge = document.createElement("span");
        badge.textContent = " — " + agent.status;

        var role = document.createElement("p");
        role.textContent = agent.role || "Role details unavailable.";

        card.appendChild(title);
        card.appendChild(badge);
        card.appendChild(role);
        grid.appendChild(card);
      });
    })
    .catch(function () {
      status.textContent = "Agents could not be loaded. The rest of the studio is still available.";
    });
})();

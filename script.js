/* Forgotten AI Studio V2.0 — interface helpers */
document.addEventListener("DOMContentLoaded", function () {
  console.log("Forgotten AI Studio V2.0 Loaded");

  // Keep optional navigation support without assuming those elements exist.
  var menuButton = document.querySelector("#menuButton");
  var navigation = document.querySelector("#navigation");

  if (menuButton && navigation) {
    menuButton.addEventListener("click", function () {
      navigation.classList.toggle("active");
    });
  }

  // AI generation is handled only by ai.js to avoid duplicate click handlers.
});

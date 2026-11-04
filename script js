
/* =====================================
   FORGOTTEN AI STUDIO V2.0
   Main JavaScript
===================================== */

document.addEventListener("DOMContentLoaded", () => {
    console.log("Forgotten AI Studio V2.0 Loaded");

    // Mobile navigation
    const menuButton = document.querySelector("#menuButton");
    const navigation = document.querySelector("#navigation");

    if (menuButton && navigation) {
        menuButton.addEventListener("click", () => {
            navigation.classList.toggle("active");
        });
    }

// AI Studio form
const generateButton = document.querySelector("#generateButton");
const promptInput = document.querySelector("#promptInput");
const contentType = document.querySelector("#contentType");
const output = document.querySelector("#output");

if (generateButton && promptInput && contentType && output) {
    generateButton.addEventListener("click", () => {
        const idea = promptInput.value.trim();
        const type = contentType.value;

        if (!idea) {
            output.textContent = "Please enter your creative idea first.";
            return;
        }

        const result = `
FORGOTTEN AI STUDIO
========================

CONTENT TYPE:
${type}

YOUR CREATIVE IDEA:
${idea}

CONTENT CREATION PLAN:
1. Research the topic.
2. Develop a powerful opening hook.
3. Create an engaging storyline.
4. Organize the main sections.
5. Add a strong conclusion.
6. Prepare ideas for visuals and narration.

STATUS:
Your content project has been prepared successfully!

NEXT STEP:
Connect an AI model to generate the complete content.
`;

        output.textContent = result;
    });
}




// Note: The Web App URL will need to be replaced with the deployed Google Apps Script URL.
const GAS_WEBAPP_URL = "https://script.google.com/a/macros/techbrain.africa/s/AKfycbzN4MIg_M8P0oiB3EaVwRl2JtzTyEkPV3h7-ZI7puPpKxMkAnw3SOktX6j5nJtPk-c/exec";

document.addEventListener("DOMContentLoaded", () => {
    const refreshBtn = document.getElementById("refreshDataBtn");
    const askAgentBtn = document.getElementById("askAgentBtn");
    const loadingOverlay = document.getElementById("loadingOverlay");

    // Settings & Question Elements
    const propertyIdInput = document.getElementById("propertyIdInput");
    const questionInput = document.getElementById("questionInput");
    
    const answerSection = document.getElementById("answerSection");
    const answerQuestionTitle = document.getElementById("answerQuestionTitle");
    const answerContent = document.getElementById("answerContent");

    const fetchData = async (activeBtn = null) => {
        const targetBtn = activeBtn || refreshBtn;
        targetBtn.classList.add('loading');
        loadingOverlay.classList.remove('hidden');

        const propertyId = propertyIdInput.value.trim();
        const question = questionInput.value.trim();

        // Build URL dynamically
        let fetchUrl = GAS_WEBAPP_URL;
        const params = ["api=true"]; // Signal backend to return JSON API response instead of UI HTML
        if (propertyId) params.push(`propertyId=${encodeURIComponent(propertyId)}`);
        if (question) params.push(`question=${encodeURIComponent(question)}`);
        if (params.length > 0) {
            fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + params.join('&');
        }

        try {
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error('Network response was not ok');
            const result = await response.json();

            if (result.status === 'success') {
                updateUI(result.data, result.ai);
            } else {
                console.error("Error from backend:", result.message);
                alert("Failed to fetch data: " + result.message);
            }
        } catch (error) {
            console.error("Fetch error:", error);
            if (confirm("Failed to fetch live data. Load sample mock data instead to preview the UI?")) {
                loadMockData();
            }
        } finally {
            targetBtn.classList.remove('loading');
            loadingOverlay.classList.add('hidden');
        }
    };

    const updateUI = (data, ai) => {
        // Render specific AI response if available
        if (ai && ai.answer) {
            answerQuestionTitle.textContent = `AI Agent Answer: "${ai.question}"`;
            answerContent.innerHTML = `<p>${ai.answer.replace(/\n/g, '<br>')}</p>`;
            answerSection.classList.remove('hidden');
        } else {
            // Default placeholder when no question has been queried
            answerQuestionTitle.textContent = "AI Agent Dashboard";
            answerContent.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Please enter your query in the "Ask the AI Agent" field above and click "Query Agent" to retrieve analysis on your GA4 data.</p>`;
            answerSection.classList.remove('hidden');
        }
    };

    const loadMockData = () => {
        const question = questionInput.value.trim();
        if (question) {
            updateUI(null, {
                question: question,
                answer: `Based on the GA4 data, the user sign-up/conversion rate is 4.2%, with a 32% drop-off rate on mobile devices. There are currently 128 lead forms submitted, indicating healthy volume, but mobile usability optimization remains key to improving conversion trends.`
            });
        } else {
            updateUI(null, null);
        }
    };

    // Handlers
    refreshBtn.addEventListener("click", () => fetchData(refreshBtn));
    askAgentBtn.addEventListener("click", () => fetchData(askAgentBtn));

    // Initial Load - wait 1 second for effect
    setTimeout(() => {
        fetchData();
    }, 1000);
});

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
    const generalAiSection = document.getElementById("generalAiSection");

    // Metrics Elements
    const metricEls = {
        conversion: document.querySelector('#metric-conversion .metric-value'),
        dropoff: document.querySelector('#metric-dropoff .metric-value'),
        cpa: document.querySelector('#metric-cpa .metric-value'),
        engagementTime: document.querySelector('#metric-engagement-time .metric-value'),
        leadForms: document.querySelector('#metric-lead-forms .metric-value'),
        topCampaign: document.querySelector('#metric-top-campaign .metric-value'),
        source: document.querySelector('#metric-source .metric-value'),
        engagementRate: document.querySelector('#metric-engagement-rate .metric-value'),
        device: document.querySelector('#metric-device .metric-value'),
        returning: document.querySelector('#metric-returning .metric-value')
    };

    const conclusionList = document.getElementById('conclusionsList');
    const recommendationsList = document.getElementById('recommendationsList');

    const fetchData = async (activeBtn = null) => {
        const targetBtn = activeBtn || refreshBtn;
        targetBtn.classList.add('loading');
        loadingOverlay.classList.remove('hidden');

        const propertyId = propertyIdInput.value.trim();
        const question = questionInput.value.trim();

        // Build URL dynamically
        let fetchUrl = GAS_WEBAPP_URL;
        const params = [];
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
        // Update Metrics
        metricEls.conversion.textContent = data.sessionConversionRate || '0%';
        metricEls.dropoff.textContent = data.dropoffRate || '0%';
        metricEls.cpa.textContent = data.costPerConversion || '$0.00';
        metricEls.engagementTime.textContent = data.averageEngagementTime || '0s';
        metricEls.leadForms.textContent = data.leadForms || '0';
        metricEls.topCampaign.textContent = data.topCampaign || 'N/A';
        metricEls.source.textContent = data.topSourceMedium || 'Direct';
        metricEls.engagementRate.textContent = data.engagementRate || '0%';
        metricEls.device.textContent = data.topDevice || 'Mobile';
        metricEls.returning.textContent = data.returningRate || '0%';

        // Toggle layout depending on whether it is a specific question or general audit
        if (ai && ai.answer) {
            answerQuestionTitle.textContent = `AI Agent Answer: "${ai.question}"`;
            answerContent.innerHTML = `<p>${ai.answer.replace(/\n/g, '<br>')}</p>`;
            
            answerSection.classList.remove('hidden');
            generalAiSection.classList.add('hidden');
        } else {
            renderList(conclusionList, (ai && ai.conclusions) ? ai.conclusions : ["No conclusions generated."]);
            renderList(recommendationsList, (ai && ai.recommendations) ? ai.recommendations : ["No recommendations generated."]);
            
            answerSection.classList.add('hidden');
            generalAiSection.classList.remove('hidden');
        }
    };

    const renderList = (element, items) => {
        element.innerHTML = '';
        items.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            element.appendChild(li);
        });
    };

    const loadMockData = () => {
        const question = questionInput.value.trim();
        if (question) {
            updateUI({
                sessionConversionRate: "4.2%",
                dropoffRate: "32%",
                costPerConversion: "R$ 45.20",
                averageEngagementTime: "2m 14s",
                leadForms: "128",
                topCampaign: "Q1_Psychometric_Search",
                topSourceMedium: "google / cpc",
                engagementRate: "68%",
                topDevice: "Mobile",
                returningRate: "18%"
            }, {
                question: question,
                answer: `Based on the GA4 data, the user sign-up/conversion rate is 4.2%, with a 32% drop-off rate on mobile devices, which represent the top device category. There are currently 128 lead forms submitted, indicating healthy volume, but mobile usability optimization remains key to improving conversion trends.`
            });
        } else {
            updateUI({
                sessionConversionRate: "4.2%",
                dropoffRate: "32%",
                costPerConversion: "R$ 45.20",
                averageEngagementTime: "2m 14s",
                leadForms: "128",
                topCampaign: "Q1_Psychometric_Search",
                topSourceMedium: "google / cpc",
                engagementRate: "68%",
                topDevice: "Mobile",
                returningRate: "18%"
            }, {
                conclusions: [
                    "The Q1 Search campaign is driving high-quality traffic but the drop-off rate on mobile devices remains slightly elevated.",
                    "Engagement parameters suggest users are actively interacting with your assessments, with average times over 2 minutes."
                ],
                recommendations: [
                    "Optimize the mobile layout for psychometric tests to reduce the 32% drop-off.",
                    "Consider re-allocating budget from lower-performing campaigns to 'Q1_Psychometric_Search' due to its high conversion efficiency by 10 AM.",
                    "Implement a dynamic remarketing campaign targeting the 82% of non-returning users."
                ]
            });
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

// Note: The Web App URL will need to be replaced with the deployed Google Apps Script URL.
const GAS_WEBAPP_URL = "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL"; 

document.addEventListener("DOMContentLoaded", () => {
    const refreshBtn = document.getElementById("refreshDataBtn");
    const loadingOverlay = document.getElementById("loadingOverlay");

    // Elements
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

    const fetchData = async () => {
        if(GAS_WEBAPP_URL === "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL") {
            alert("Please update the GAS_WEBAPP_URL in js/app.js with your Google Apps Script URL after deploying it.");
            return;
        }

        refreshBtn.classList.add('loading');
        loadingOverlay.classList.remove('hidden');

        try {
            // Using a simple GET request for the web app
            const response = await fetch(GAS_WEBAPP_URL);
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
            // Example stub generation to see what the UI looks like when failing
            if(confirm("Failed to fetch live data. Load sample mock data instead to preview the UI?")) {
                loadMockData();
            }
        } finally {
            refreshBtn.classList.remove('loading');
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

        // Update AI Insights
        renderList(conclusionList, ai.conclusions || ["No conclusions generated."]);
        renderList(recommendationsList, ai.recommendations || ["No recommendations generated."]);
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

    // Handlers
    refreshBtn.addEventListener("click", fetchData);

    // Initial Load - wait 1 second for effect
    setTimeout(() => {
        if(GAS_WEBAPP_URL !== "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL") {
            fetchData();
        } else {
            // Immediately show mock data if not configured to show a nice UI preview
            loadingOverlay.classList.add('hidden');
            loadMockData(); 
        }
    }, 1000);
});

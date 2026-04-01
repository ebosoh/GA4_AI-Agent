/**
 * GA4 Automation with Gemini AI
 * Backend Google Apps Script (Code.gs)
 * 
 * Instructions:
 * 1. Add this code to a new Google Apps Script project.
 * 2. In GAS Editor, go to Services (left panel) -> Add Google Analytics API (AnalyticsData).
 * 3. Add your Gemini API Key directly or in the Script Properties as 'GEMINI_API_KEY'.
 * 4. Deploy as a Web App (Execute as Me, Access: Anyone).
 * 5. Update the GAS_WEBAPP_URL in your frontend app.js.
 */

const GA4_PROPERTY_ID = 'properties/431424603'; 

// Replace with your actual Gemini API key if you don't use Script Properties
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || 'INSERT_YOUR_GEMINI_API_KEY_HERE';

/**
 * Handle GET Requests from the Frontend Dashboard
 */
function doGet(e) {
  try {
    const rawGA4Data = fetchGA4Data();
    const parsedData = processGA4Data(rawGA4Data);
    
    // Call Gemini to get Conclusions and Recommendations
    const aiInsights = analyzeWithGemini(parsedData);
    
    // Log data to Active Spreadsheet (Database)
    try { logToDatabase(parsedData, aiInsights); } catch(err) {} 
    
    const responseBody = {
      status: 'success',
      data: parsedData,
      ai: aiInsights
    };

    return ContentService.createTextOutput(JSON.stringify(responseBody))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


/**
 * Queries GA4 using the Google Analytics Data API advanced service.
 * Gets standard overall metrics across the last 7 days.
 */
function fetchGA4Data() {
  const startDate = '7daysAgo';
  const endDate = 'today';
  
  // Create a comprehensive report request
  // Note: Some dimensions like campaign and device might cause cardinality issues if 
  // queried all at once, so we request standard session metrics first.
  const request = {
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [
      { name: 'sessionSourceMedium' },
      { name: 'campaignName' },
      { name: 'deviceCategory' }
    ],
    metrics: [
      { name: 'sessionConversionRate' },
      { name: 'advertiserAdCost' },
      { name: 'conversions' },
      { name: 'averageSessionDuration' },
      { name: 'engagementRate' },
      { name: 'newUsers' },
      { name: 'activeUsers' },
      { name: 'eventCount' }
    ]
  };

  try {
    const report = AnalyticsData.Properties.runReport(request, GA4_PROPERTY_ID);
    return report;
  } catch (error) {
    throw new Error("Failed to fetch from GA4 API. Please ensure the 'Google Analytics Data API' service is enabled in Apps Script. Details: " + error.message);
  }
}

/**
 * Process raw GA4 report into clean JSON structure for UI & AI
 */
function processGA4Data(report) {
  if (!report.rows || report.rows.length === 0) {
    return _getFallbackData();
  }

  // Aggregate values
  let totalAdCost = 0;
  let totalConversions = 0;
  let topCampaign = '';
  let topCampaignSessions = 0;
  
  // Assuming the first returned row has highest traffic defaults
  const mainRow = report.rows[0];
  
  const parsedData = {
    sessionConversionRate: (parseFloat(mainRow.metricValues[0].value) * 100).toFixed(2) + "%",
    dropoffRate: "N/A (Needs custom event analysis)", // Simplified for demo
    costPerConversion: "N/A",
    averageEngagementTime: Math.floor(parseFloat(mainRow.metricValues[3].value)) + "s",
    leadForms: mainRow.metricValues[2].value, // Fallback to raw conversions
    topCampaign: mainRow.dimensionValues[1].value,
    topSourceMedium: mainRow.dimensionValues[0].value,
    engagementRate: (parseFloat(mainRow.metricValues[4].value) * 100).toFixed(2) + "%",
    topDevice: mainRow.dimensionValues[2].value,
    returningRate: "N/A" // Needs separate dimension query normally
  };

  return parsedData;
}


/**
 * Fetches insights from Gemini 2.5 Flash API
 */
function analyzeWithGemini(gaData) {
  if(GEMINI_API_KEY === 'INSERT_YOUR_GEMINI_API_KEY_HERE') {
      return {
          conclusions: ["Gemini API Key missing. Add it to Code.gs to enable insights."],
          recommendations: ["Update Code.gs with a valid GEMINI_API_KEY."]
      };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const prompt = `
  You are an expert GA4 data analyst and AI automation guru.
  Analyze the following GA4 metrics for a psychometrics company and provide crisp, data-driven conclusions and actionable recommendations (especially regarding ad spend, user drop-offs, and UI for mobile/desktop). Note that tests can be "fiddly" on mobile.

  Data:
  ${JSON.stringify(gaData, null, 2)}
  
  Output your response EXACTLY as a JSON object with this shape:
  {
    "conclusions": ["conclusion 1", "conclusion 2", "conclusion 3"],
    "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
  }
  Do not include markdown or code block syntax. Just pure JSON.
  `;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    if (result.error) throw new Error(result.error.message);
    const aiText = result.candidates[0].content.parts[0].text;
    
    return JSON.parse(aiText);
  } catch (err) {
    return {
      conclusions: ["Error communicating with Gemini AI: " + err.message],
      recommendations: ["Ensure API key has Gemini 2.5 Flash access."]
    };
  }
}

/**
 * DB Logging 
 */
function logToDatabase(data, aiInsights) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  // Ensure headers exist
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Conversion Rate", "Top Source", "Top Device", "Engagement Time", "Conclusion Sample", "Recommendation Sample"]);
  }
  
  sheet.appendRow([
    new Date(),
    data.sessionConversionRate,
    data.topSourceMedium,
    data.topDevice,
    data.averageEngagementTime,
    aiInsights.conclusions[0] || "",
    aiInsights.recommendations[0] || ""
  ]);
}

/**
 * Fallback Data for when the property lacks traffic/events to query.
 */
function _getFallbackData() {
    return {
    sessionConversionRate: "0.00%",
    dropoffRate: "No Data",
    costPerConversion: "No Data",
    averageEngagementTime: "0s",
    leadForms: "0",
    topCampaign: "No Data",
    topSourceMedium: "No Data",
    engagementRate: "0.00%",
    topDevice: "No Data",
    returningRate: "No Data"
  };
}

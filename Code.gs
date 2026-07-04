/**
 * GA4 Automation with Gemini AI
 * Backend Google Apps Script (Code.gs)
 */

var GA4_PROPERTY_ID = 'properties/431424603'; 

// Replace with your actual Gemini API key if you don't use Script Properties
var GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || 'INSERT_YOUR_GEMINI_API_KEY_HERE';

/**
 * Handle GET Requests from the Frontend Dashboard
 */
function doGet(e) {
  try {
    var propertyId = e && e.parameter && e.parameter.propertyId ? e.parameter.propertyId.toString().trim() : '';
    if (!propertyId) {
      propertyId = GA4_PROPERTY_ID;
    }
    // Automatically prepend 'properties/' if missing and it's a numeric ID
    if (propertyId && !propertyId.startsWith('properties/')) {
      propertyId = 'properties/' + propertyId;
    }

    var question = e && e.parameter && e.parameter.question ? e.parameter.question.toString().trim() : '';

    var rawReports = fetchGA4Data(propertyId);
    var parsedData = processGA4Data(rawReports);
    
    var aiInsights;
    if (question) {
      // Call Gemini for a specific, concise answer to the user's question
      var answerText = answerQuestionWithGemini(parsedData, question);
      aiInsights = {
        question: question,
        answer: answerText
      };
    } else {
      // Call Gemini to get standard Conclusions and Recommendations
      aiInsights = analyzeWithGemini(parsedData);
    }
    
    // Log data to Active Spreadsheet (Database)
    try { logToDatabase(parsedData, aiInsights); } catch(err) {} 
    
    var responseBody = {
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
 * Queries GA4 using multiple smaller requests to avoid incompatible dimensions
 */
function fetchGA4Data(propertyId) {
  var targetPropertyId = propertyId || GA4_PROPERTY_ID;
  var startDate = '7daysAgo';
  var endDate = 'today';
  
  // 1. General Traffic & Engagement
  var reqGeneral = {
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [
      { name: 'sessionSourceMedium' },
      { name: 'deviceCategory' }
    ],
    metrics: [
      { name: 'sessionConversionRate' },
      { name: 'averageSessionDuration' },
      { name: 'engagementRate' }
    ]
  };

  // 2. Campaign Traffic
  var reqCampaigns = {
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [
      { name: 'sessionCampaignName' }
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'conversions' }
    ]
  };

  // 3. Specific Events for Drop-off
  var reqEvents = {
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [
      { name: 'eventName' }
    ],
    metrics: [
      { name: 'eventCount' }
    ],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: {
          values: ["test_start", "test_complete", "lead_form_submit"]
        }
      }
    }
  };

  try {
    var resGeneral = AnalyticsData.Properties.runReport(reqGeneral, targetPropertyId);
    var resCampaigns = AnalyticsData.Properties.runReport(reqCampaigns, targetPropertyId);
    
    // We try/catch events separately in case they haven't happened yet
    var resEvents = null;
    try {
      resEvents = AnalyticsData.Properties.runReport(reqEvents, targetPropertyId);
    } catch(err) {}

    return {
      general: resGeneral,
      campaigns: resCampaigns,
      events: resEvents
    };
  } catch (error) {
    throw new Error("Failed to fetch GA4 Data API: " + error.message);
  }
}

/**
 * Process raw GA4 report into clean JSON structure for UI & AI
 */
function processGA4Data(reports) {
  var gen = reports.general;
  var camp = reports.campaigns;
  var evs = reports.events;

  if (!gen || !gen.rows || gen.rows.length === 0) {
    return _getFallbackData();
  }

  // General Parse
  var mainRow = gen.rows[0];
  var sessionConvRate = (parseFloat(mainRow.metricValues[0].value) * 100).toFixed(2) + "%";
  var avgSessionDur = Math.floor(parseFloat(mainRow.metricValues[1].value)) + "s";
  var engRate = (parseFloat(mainRow.metricValues[2].value) * 100).toFixed(2) + "%";
  var topSource = mainRow.dimensionValues[0].value;
  var topDevice = mainRow.dimensionValues[1].value;

  // Campaigns Parse
  var topCampaign = "N/A";
  if (camp && camp.rows && camp.rows.length > 0) {
    topCampaign = camp.rows[0].dimensionValues[0].value;
  }

  // Events Parse
  var testStarts = 0;
  var testCompletes = 0;
  var leadForms = 0;

  if (evs && evs.rows) {
    for (var i = 0; i < evs.rows.length; i++) {
        var eName = evs.rows[i].dimensionValues[0].value;
        var eCount = parseInt(evs.rows[i].metricValues[0].value);
        if (eName === "test_start") testStarts = eCount;
        if (eName === "test_complete") testCompletes = eCount;
        if (eName === "lead_form_submit") leadForms = eCount;
    }
  }

  // Drop-off math
  var dropoff = "Need custom events";
  if (testStarts > 0) {
      var diff = testStarts - testCompletes;
      var percentage = (diff / testStarts) * 100;
      dropoff = percentage.toFixed(1) + "%";
  } else if (testCompletes > 0) {
      dropoff = "0.0%"; // more completes than starts logged
  }

  var parsedData = {
    sessionConversionRate: sessionConvRate,
    dropoffRate: dropoff,
    costPerConversion: "Ads Unlinked", // Safely bypassed incompatible ad cost parameter
    averageEngagementTime: avgSessionDur,
    leadForms: leadForms.toString(),
    topCampaign: topCampaign,
    topSourceMedium: topSource,
    engagementRate: engRate,
    topDevice: topDevice,
    returningRate: "Requires Custom Setup" 
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

  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  
  var prompt = "You are an expert GA4 data analyst and AI automation guru.\n" +
  "Analyze the following GA4 metrics for a psychometrics company and provide crisp, data-driven conclusions and actionable recommendations (especially regarding ad spend, user drop-offs, and UI for mobile/desktop). Note that tests can be \"fiddly\" on mobile.\n\n" +
  "Data:\n" +
  JSON.stringify(gaData, null, 2) + "\n\n" +
  "Output your response EXACTLY as a JSON object with this shape:\n" +
  "{\n" +
  "  \"conclusions\": [\"conclusion 1\", \"conclusion 2\", \"conclusion 3\"],\n" +
  "  \"recommendations\": [\"recommendation 1\", \"recommendation 2\", \"recommendation 3\"]\n" +
  "}\n" +
  "Do not include markdown or code block syntax. Just pure JSON.";

  var payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
    }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());
    if (result.error) throw new Error(result.error.message);
    var aiText = result.candidates[0].content.parts[0].text;
    
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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  // Ensure headers exist
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Conversion Rate", "Top Source", "Top Device", "Engagement Time", "Conclusion Sample", "Recommendation Sample"]);
  }
  
  var conclusion = "";
  var recommendation = "";
  if (aiInsights) {
    if (aiInsights.answer) {
      conclusion = "[Question: " + (aiInsights.question || "") + "] " + aiInsights.answer;
    } else if (aiInsights.conclusions && aiInsights.conclusions.length > 0) {
      conclusion = aiInsights.conclusions[0];
      recommendation = aiInsights.recommendations[0] || "";
    }
  }

  sheet.appendRow([
    new Date(),
    data.sessionConversionRate,
    data.topSourceMedium,
    data.topDevice,
    data.averageEngagementTime,
    conclusion,
    recommendation
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

/**
 * Fetches specific concise answers from Gemini for a custom question
 */
function answerQuestionWithGemini(gaData, question) {
  if (GEMINI_API_KEY === 'INSERT_YOUR_GEMINI_API_KEY_HERE') {
    return "Gemini API Key missing. Please configure GEMINI_API_KEY in the Apps Script.";
  }

  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  
  var prompt = "You are an expert GA4 data analyst and AI automation assistant.\n" +
  "The user has asked the following specific question about their GA4 data:\n" +
  "\"" + question + "\"\n\n" +
  "Here is the GA4 data:\n" +
  JSON.stringify(gaData, null, 2) + "\n\n" +
  "Instructions:\n" +
  "1. Answer the question as directly, specifically, and concisely as possible.\n" +
  "2. Do NOT generate unnecessary details, background information, or recommendations that are not related to the question.\n" +
  "3. Keep the response short (1-3 sentences or a very concise list) to avoid time/token wastage.\n" +
  "4. If the provided data does not contain the answer, state that clearly and briefly (do not hallucinate details).";

  var payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1
    }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());
    if (result.error) throw new Error(result.error.message);
    var aiText = result.candidates[0].content.parts[0].text;
    return aiText.trim();
  } catch (err) {
    return "Error communicating with Gemini AI: " + err.message;
  }
}

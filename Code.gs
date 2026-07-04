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
  // Check if this is an API call requesting JSON data
  if (e && e.parameter && (e.parameter.api === 'true' || e.parameter.fetch === 'true')) {
    try {
      var propertyId = e.parameter.propertyId ? e.parameter.propertyId.toString().trim() : '';
      if (!propertyId) {
        propertyId = GA4_PROPERTY_ID;
      }
      // Automatically prepend 'properties/' if missing and it's a numeric ID
      if (propertyId && !propertyId.startsWith('properties/')) {
        propertyId = 'properties/' + propertyId;
      }

      var question = e.parameter.question ? e.parameter.question.toString().trim() : '';

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

  // Otherwise, serve the frontend HTML interface (index.html)
  try {
    return HtmlService.createTemplateFromFile('index')
        .evaluate()
        .setTitle('GA4 AI Automation Dashboard')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  } catch (error) {
    return HtmlService.createHtmlOutput('<h1>Error rendering UI</h1><p>' + error.toString() + '</p>');
  }
}

/**
 * Helper to include external files (CSS, JS) in Google Apps Script templates
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    return '/* Error including file ' + filename + ': ' + err.toString() + ' */';
  }
}

/**
 * Utility to parse GA4 report rows into a list of clean JavaScript objects
 */
function parseReportRows(report) {
  if (!report || !report.rows || report.rows.length === 0) return [];
  
  var dimHeaders = report.dimensionHeaders || [];
  var metHeaders = report.metricHeaders || [];
  
  return report.rows.map(function(row) {
    var item = {};
    dimHeaders.forEach(function(header, idx) {
      item[header.name] = row.dimensionValues[idx] ? row.dimensionValues[idx].value : '';
    });
    metHeaders.forEach(function(header, idx) {
      var val = row.metricValues[idx] ? row.metricValues[idx].value : '0';
      item[header.name] = isNaN(val) ? val : parseFloat(val);
    });
    return item;
  });
}

/**
 * Queries GA4 using multiple robust requests to retrieve all key metrics and dimensions
 */
function fetchGA4Data(propertyId) {
  var targetPropertyId = propertyId || GA4_PROPERTY_ID;
  var startDate = '7daysAgo';
  var endDate = 'today';
  
  var reports = {};

  // 1. General Traffic, Engagement, and Device split
  try {
    reports.general = AnalyticsData.Properties.runReport({
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
        { name: 'sessionConversionRate' }
      ]
    }, targetPropertyId);
  } catch (error) {
    console.warn("Failed to fetch general metrics: " + error.message);
  }

  // 2. Acquisition Traffic by Campaign and Source/Medium
  try {
    reports.trafficSources = AnalyticsData.Properties.runReport({
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [
        { name: 'sessionSourceMedium' },
        { name: 'sessionCampaignName' }
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'conversions' }
      ]
    }, targetPropertyId);
  } catch (error) {
    console.warn("Failed to fetch traffic sources: " + error.message);
  }

  // 3. Event Counts for custom events (test drop-offs, leads)
  try {
    reports.events = AnalyticsData.Properties.runReport({
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }]
    }, targetPropertyId);
  } catch (error) {
    console.warn("Failed to fetch event metrics: " + error.message);
  }

  // 4. Geographical Data
  try {
    reports.geo = AnalyticsData.Properties.runReport({
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'country' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' }
      ]
    }, targetPropertyId);
  } catch (error) {
    console.warn("Failed to fetch geographical metrics: " + error.message);
  }

  // 5. Google Ads Performance (if linked)
  try {
    reports.googleAds = AnalyticsData.Properties.runReport({
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'sessionCampaignName' }],
      metrics: [
        { name: 'advertiserAdClicks' },
        { name: 'advertiserAdCost' },
        { name: 'advertiserAdImpressions' }
      ]
    }, targetPropertyId);
  } catch (error) {
    console.warn("Google Ads metrics not available (likely unlinked): " + error.message);
  }

  return reports;
}

/**
 * Process raw GA4 report data into clean JSON structure for UI & AI
 */
function processGA4Data(reports) {
  var generalData = parseReportRows(reports.general);
  var trafficSources = parseReportRows(reports.trafficSources);
  var eventData = parseReportRows(reports.events);
  var geoData = parseReportRows(reports.geo);
  var adsData = parseReportRows(reports.googleAds);

  // If no general metrics are returned, return fallback data structure
  if (generalData.length === 0) {
    return _getFallbackData();
  }

  // Calculate overall traffic totals
  var totalSessions = 0;
  var totalActiveUsers = 0;
  var totalNewUsers = 0;
  var totalPageViews = 0;
  var weightedDurationSum = 0;
  var weightedEngagementRateSum = 0;
  var weightedBounceRateSum = 0;
  var weightedConversionRateSum = 0;

  generalData.forEach(function(row) {
    totalSessions += (row.sessions || 0);
    totalActiveUsers += (row.activeUsers || 0);
    totalNewUsers += (row.newUsers || 0);
    totalPageViews += (row.screenPageViews || 0);

    weightedDurationSum += (row.averageSessionDuration || 0) * (row.sessions || 0);
    weightedEngagementRateSum += (row.engagementRate || 0) * (row.sessions || 0);
    weightedBounceRateSum += (row.bounceRate || 0) * (row.sessions || 0);
    weightedConversionRateSum += (row.sessionConversionRate || 0) * (row.sessions || 0);
  });

  var avgSessionDur = totalSessions > 0 ? Math.round(weightedDurationSum / totalSessions) : 0;
  var avgEngagementRate = totalSessions > 0 ? (weightedEngagementRateSum / totalSessions) : 0;
  var avgBounceRate = totalSessions > 0 ? (weightedBounceRateSum / totalSessions) : 0;
  var avgConversionRate = totalSessions > 0 ? (weightedConversionRateSum / totalSessions) : 0;

  // Process specific events
  var testStarts = 0;
  var testCompletes = 0;
  var leadForms = 0;

  eventData.forEach(function(row) {
    var eName = row.eventName;
    var eCount = row.eventCount || 0;
    if (eName === "test_start") testStarts = eCount;
    if (eName === "test_complete") testCompletes = eCount;
    if (eName === "lead_form_submit") leadForms = eCount;
  });

  // Calculate Drop-off Rate
  var dropoff = "No Data";
  if (testStarts > 0) {
    var diff = testStarts - testCompletes;
    var percentage = (diff / testStarts) * 100;
    dropoff = percentage.toFixed(1) + "%";
  } else if (testCompletes > 0) {
    dropoff = "0.0%";
  }

  // Calculate Ads CPA
  var adClicks = 0;
  var adCost = 0;
  var adImpressions = 0;
  adsData.forEach(function(row) {
    adClicks += (row.advertiserAdClicks || 0);
    adCost += (row.advertiserAdCost || 0);
    adImpressions += (row.advertiserAdImpressions || 0);
  });

  var costPerConversion = "Ads Unlinked";
  if (adCost > 0 && leadForms > 0) {
    costPerConversion = "$" + (adCost / leadForms).toFixed(2);
  } else if (adCost > 0) {
    costPerConversion = "$" + adCost.toFixed(2) + " (Total)";
  }

  // Identify top metrics
  var topCampaign = "N/A";
  var topSource = "N/A";
  var maxCampaignSessions = -1;
  var maxSourceSessions = -1;

  trafficSources.forEach(function(row) {
    if (row.sessions > maxCampaignSessions && row.sessionCampaignName && row.sessionCampaignName !== "(referral)" && row.sessionCampaignName !== "(direct)") {
      maxCampaignSessions = row.sessions;
      topCampaign = row.sessionCampaignName;
    }
    if (row.sessions > maxSourceSessions) {
      maxSourceSessions = row.sessions;
      topSource = row.sessionSourceMedium;
    }
  });

  var topDevice = "N/A";
  var maxDeviceSessions = -1;
  generalData.forEach(function(row) {
    if (row.sessions > maxDeviceSessions) {
      maxDeviceSessions = row.sessions;
      topDevice = row.deviceCategory;
    }
  });

  var conversionRateText = (avgConversionRate * 100).toFixed(2) + "%";
  var engagementRateText = (avgEngagementRate * 100).toFixed(2) + "%";

  var parsedData = {
    sessionConversionRate: conversionRateText,
    dropoffRate: dropoff,
    costPerConversion: costPerConversion,
    averageEngagementTime: avgSessionDur + "s",
    leadForms: leadForms.toString(),
    topCampaign: topCampaign,
    topSourceMedium: topSource,
    engagementRate: engagementRateText,
    topDevice: topDevice,
    returningRate: "Requires Custom Setup",
    
    // Detailed raw dataset containing all metrics for AI agent retrieval
    rawMetrics: {
      summary: {
        totalSessions: totalSessions,
        totalActiveUsers: totalActiveUsers,
        totalNewUsers: totalNewUsers,
        totalPageViews: totalPageViews,
        averageEngagementTimeSeconds: avgSessionDur,
        averageBounceRate: (avgBounceRate * 100).toFixed(2) + "%",
        overallEngagementRate: engagementRateText,
        overallConversionRate: conversionRateText
      },
      devices: generalData.map(function(d) {
        return {
          deviceCategory: d.deviceCategory,
          activeUsers: d.activeUsers,
          sessions: d.sessions,
          conversionRate: (d.sessionConversionRate * 100).toFixed(2) + "%"
        };
      }),
      trafficSources: trafficSources.slice(0, 10).map(function(t) {
        return {
          sourceMedium: t.sessionSourceMedium,
          campaign: t.sessionCampaignName,
          sessions: t.sessions,
          activeUsers: t.activeUsers,
          conversions: t.conversions
        };
      }),
      events: eventData.slice(0, 15),
      countries: geoData.slice(0, 10),
      googleAds: adsData.slice(0, 10)
    }
  };

  return parsedData;
}

/**
 * Fetches insights from Gemini 2.5 Flash API
 */
function analyzeWithGemini(gaData) {
  if (GEMINI_API_KEY === 'INSERT_YOUR_GEMINI_API_KEY_HERE') {
    return {
      conclusions: ["Gemini API Key missing. Add it to Code.gs to enable insights."],
      recommendations: ["Update Code.gs with a valid GEMINI_API_KEY."]
    };
  }

  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  
  var prompt = "You are an expert GA4 data analyst and AI automation guru.\n" +
  "Analyze the following GA4 metrics and provide crisp, data-driven conclusions and actionable recommendations based strictly on the data provided.\n\n" +
  "Data:\n" +
  JSON.stringify(gaData, null, 2) + "\n\n" +
  "Instructions:\n" +
  "1. Provide exactly 3 conclusions and 3 recommendations.\n" +
  "2. Conclusions must be directly derived from the numbers in the data (e.g. device categories, conversion rates, campaigns, event counts).\n" +
  "3. Recommendations must be actionable steps to improve the site's metrics.\n" +
  "4. Output your response EXACTLY as a JSON object with this shape:\n" +
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
    returningRate: "No Data",
    rawMetrics: {
      summary: {
        totalSessions: 0,
        totalActiveUsers: 0,
        totalNewUsers: 0,
        totalPageViews: 0,
        averageEngagementTimeSeconds: 0,
        averageBounceRate: "0.00%",
        overallEngagementRate: "0.00%",
        overallConversionRate: "0.00%"
      },
      devices: [],
      trafficSources: [],
      events: [],
      countries: [],
      googleAds: []
    }
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
  "Here is the GA4 data (including structured lists in 'rawMetrics'):\n" +
  JSON.stringify(gaData, null, 2) + "\n\n" +
  "CRITICAL INSTRUCTIONS:\n" +
  "1. Answer ONLY the exact question asked. Do NOT provide extra commentary, general suggestions, recommendations, or side facts that are not directly answering the user's prompt.\n" +
  "2. Use the detailed metrics in 'rawMetrics' to provide precise numbers (like page views, sessions, active users, country, device, source, etc.) if relevant to the question.\n" +
  "3. If the provided data does not contain the information needed to answer the question, state exactly: 'The provided GA4 data does not contain the necessary information to answer this question.' Do not attempt to guess, extrapolate, or offer speculative advice.\n" +
  "4. Keep your response extremely focused, clear, and concise (1-3 sentences maximum).";

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

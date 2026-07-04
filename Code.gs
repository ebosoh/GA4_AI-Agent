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
 * Queries GA4 using Period-over-Period date ranges and top pages breakdown
 */
function fetchGA4Data(propertyId) {
  var targetPropertyId = propertyId || GA4_PROPERTY_ID;
  
  var currentStart = '7daysAgo';
  var currentEnd = 'today';
  var previousStart = '15daysAgo';
  var previousEnd = '8daysAgo';
  
  var reports = {};

  // Safe executor to run reports and return null on API error
  function runReportSafe(config) {
    try {
      return AnalyticsData.Properties.runReport(config, targetPropertyId);
    } catch (e) {
      console.warn("AnalyticsData API warning: " + e.message);
      return null;
    }
  }

  // 1. General traffic (current period)
  reports.general_current = runReportSafe({
    dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
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
  });

  // 2. General traffic (previous period for PoP comparison)
  reports.general_previous = runReportSafe({
    dateRanges: [{ startDate: previousStart, endDate: previousEnd }],
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
  });

  // 3. Acquisition channels (current period)
  reports.traffic_current = runReportSafe({
    dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
    dimensions: [
      { name: 'sessionSourceMedium' },
      { name: 'sessionCampaignName' }
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'conversions' }
    ]
  });

  // 4. Acquisition channels (previous period)
  reports.traffic_previous = runReportSafe({
    dateRanges: [{ startDate: previousStart, endDate: previousEnd }],
    dimensions: [
      { name: 'sessionSourceMedium' },
      { name: 'sessionCampaignName' }
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'conversions' }
    ]
  });

  // 5. Custom Events (current period)
  reports.events_current = runReportSafe({
    dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }]
  });

  // 6. Top Pages by pageviews (current period)
  reports.pages_current = runReportSafe({
    dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'activeUsers' }
    ],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
  });

  // 7. Google Ads campaign metrics (current period, if linked)
  reports.googleAds = runReportSafe({
    dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
    dimensions: [{ name: 'sessionCampaignName' }],
    metrics: [
      { name: 'advertiserAdClicks' },
      { name: 'advertiserAdCost' },
      { name: 'advertiserAdImpressions' }
    ]
  });

  return reports;
}

/**
 * Process raw GA4 report data, calculate growth rates, and bundle context
 */
function processGA4Data(reports) {
  var genCurrent = parseReportRows(reports.general_current);
  var genPrevious = parseReportRows(reports.general_previous);
  var trafficCurrent = parseReportRows(reports.traffic_current);
  var trafficPrevious = parseReportRows(reports.traffic_previous);
  var eventData = parseReportRows(reports.events_current);
  var pagesData = parseReportRows(reports.pages_current);
  var adsData = parseReportRows(reports.googleAds);

  if (genCurrent.length === 0) {
    return _getFallbackData();
  }

  // Calculate helper for percentage change
  function getChangePercent(currentVal, previousVal) {
    if (!previousVal || previousVal === 0) {
      return currentVal > 0 ? "+100.0%" : "0.0%";
    }
    var pct = ((currentVal - previousVal) / previousVal) * 100;
    return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  }

  // Helper for absolute percentage point difference (e.g. rate changes)
  function getDiffPercent(currentVal, previousVal) {
    var diff = currentVal - previousVal;
    return (diff >= 0 ? "+" : "") + diff.toFixed(2) + "% pts";
  }

  // 1. Compute CURRENT totals
  var totalSessions = 0;
  var totalActiveUsers = 0;
  var totalNewUsers = 0;
  var totalPageViews = 0;
  var weightedDurationSum = 0;
  var weightedEngagementRateSum = 0;
  var weightedBounceRateSum = 0;
  var weightedConversionRateSum = 0;

  genCurrent.forEach(function(row) {
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

  // 2. Compute PREVIOUS totals
  var totalSessionsPrev = 0;
  var totalActiveUsersPrev = 0;
  var totalNewUsersPrev = 0;
  var totalPageViewsPrev = 0;
  var weightedDurationSumPrev = 0;
  var weightedEngagementRateSumPrev = 0;
  var weightedBounceRateSumPrev = 0;
  var weightedConversionRateSumPrev = 0;

  genPrevious.forEach(function(row) {
    totalSessionsPrev += (row.sessions || 0);
    totalActiveUsersPrev += (row.activeUsers || 0);
    totalNewUsersPrev += (row.newUsers || 0);
    totalPageViewsPrev += (row.screenPageViews || 0);

    weightedDurationSumPrev += (row.averageSessionDuration || 0) * (row.sessions || 0);
    weightedEngagementRateSumPrev += (row.engagementRate || 0) * (row.sessions || 0);
    weightedBounceRateSumPrev += (row.bounceRate || 0) * (row.sessions || 0);
    weightedConversionRateSumPrev += (row.sessionConversionRate || 0) * (row.sessions || 0);
  });

  var avgSessionDurPrev = totalSessionsPrev > 0 ? Math.round(weightedDurationSumPrev / totalSessionsPrev) : 0;
  var avgEngagementRatePrev = totalSessionsPrev > 0 ? (weightedEngagementRateSumPrev / totalSessionsPrev) : 0;
  var avgBounceRatePrev = totalSessionsPrev > 0 ? (weightedBounceRateSumPrev / totalSessionsPrev) : 0;
  var avgConversionRatePrev = totalSessionsPrev > 0 ? (weightedConversionRateSumPrev / totalSessionsPrev) : 0;

  // 3. Process Custom Events
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

  // Drop-off rate
  var dropoff = "No Data";
  if (testStarts > 0) {
    var diff = testStarts - testCompletes;
    var percentage = (diff / testStarts) * 100;
    dropoff = percentage.toFixed(1) + "%";
  } else if (testCompletes > 0) {
    dropoff = "0.0%";
  }

  // Google Ads CPA
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

  // Top dimensions (Current)
  var topCampaign = "N/A";
  var topSource = "N/A";
  var maxCampaignSessions = -1;
  var maxSourceSessions = -1;

  trafficCurrent.forEach(function(row) {
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
  genCurrent.forEach(function(row) {
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
    
    // Period-over-Period changes & expanded context
    growthMetrics: {
      activeUsersGrowth: getChangePercent(totalActiveUsers, totalActiveUsersPrev),
      sessionsGrowth: getChangePercent(totalSessions, totalSessionsPrev),
      pageViewsGrowth: getChangePercent(totalPageViews, totalPageViewsPrev),
      conversionRateChange: getDiffPercent(avgConversionRate * 100, avgConversionRatePrev * 100),
      engagementRateChange: getDiffPercent(avgEngagementRate * 100, avgEngagementRatePrev * 100)
    },
    
    rawMetrics: {
      summary: {
        current: {
          totalSessions: totalSessions,
          totalActiveUsers: totalActiveUsers,
          totalNewUsers: totalNewUsers,
          totalPageViews: totalPageViews,
          averageEngagementTimeSeconds: avgSessionDur,
          averageBounceRate: (avgBounceRate * 100).toFixed(2) + "%",
          overallEngagementRate: engagementRateText,
          overallConversionRate: conversionRateText
        },
        previous: {
          totalSessions: totalSessionsPrev,
          totalActiveUsers: totalActiveUsersPrev,
          totalNewUsers: totalNewUsersPrev,
          totalPageViews: totalPageViewsPrev,
          averageEngagementTimeSeconds: avgSessionDurPrev,
          averageBounceRate: (avgBounceRatePrev * 100).toFixed(2) + "%",
          overallEngagementRate: (avgEngagementRatePrev * 100).toFixed(2) + "%",
          overallConversionRate: (avgConversionRatePrev * 100).toFixed(2) + "%"
        }
      },
      devices: genCurrent.map(function(d) {
        var prevDeviceMatch = genPrevious.find(function(pd) { return pd.deviceCategory === d.deviceCategory; });
        var prevUsers = prevDeviceMatch ? prevDeviceMatch.activeUsers : 0;
        return {
          deviceCategory: d.deviceCategory,
          activeUsers: d.activeUsers,
          activeUsersGrowth: getChangePercent(d.activeUsers, prevUsers),
          sessions: d.sessions,
          conversionRate: (d.sessionConversionRate * 100).toFixed(2) + "%"
        };
      }),
      trafficSources: trafficCurrent.slice(0, 10).map(function(t) {
        return {
          sourceMedium: t.sessionSourceMedium,
          campaign: t.sessionCampaignName,
          sessions: t.sessions,
          activeUsers: t.activeUsers,
          conversions: t.conversions
        };
      }),
      topPages: pagesData.slice(0, 10),
      events: eventData.slice(0, 15),
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
  
  var prompt = "You are Google Analytics Intelligence (Ask Advisor), a senior GA4 analyst.\n" +
  "Analyze the following GA4 metrics (including period-over-period comparisons, top pages, and device segments) and provide crisp, data-driven conclusions and actionable recommendations based strictly on the data provided.\n\n" +
  "Data:\n" +
  JSON.stringify(gaData, null, 2) + "\n\n" +
  "Instructions:\n" +
  "1. Provide exactly 3 conclusions and 3 recommendations.\n" +
  "2. Conclusions must incorporate specific numbers and growth rates (e.g., 'Mobile conversions dropped by -8.5%...').\n" +
  "3. Recommendations must offer clear UI/UX action points for mobile layout, Google Ads spend, or landing page optimization.\n" +
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
    growthMetrics: {
      activeUsersGrowth: "0.0%",
      sessionsGrowth: "0.0%",
      pageViewsGrowth: "0.0%",
      conversionRateChange: "0.0%",
      engagementRateChange: "0.0%"
    },
    rawMetrics: {
      summary: {
        current: {
          totalSessions: 0,
          totalActiveUsers: 0,
          totalNewUsers: 0,
          totalPageViews: 0,
          averageEngagementTimeSeconds: 0,
          averageBounceRate: "0.00%",
          overallEngagementRate: "0.00%",
          overallConversionRate: "0.00%"
        },
        previous: {
          totalSessions: 0,
          totalActiveUsers: 0,
          totalNewUsers: 0,
          totalPageViews: 0,
          averageEngagementTimeSeconds: 0,
          averageBounceRate: "0.00%",
          overallEngagementRate: "0.00%",
          overallConversionRate: "0.00%"
        }
      },
      devices: [],
      trafficSources: [],
      topPages: [],
      events: [],
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
  
  var prompt = "You are Google Analytics Intelligence (Ask Advisor), a world-class GA4 senior web analyst and growth advisor.\n" +
  "The user has asked the following specific question about their GA4 data:\n" +
  "\"" + question + "\"\n\n" +
  "Here is the GA4 data (including current totals, previous totals, top pages, traffic channels, and period-over-period percentage growth):\n" +
  JSON.stringify(gaData, null, 2) + "\n\n" +
  "CRITICAL DIRECTIVES:\n" +
  "1. Answer ONLY the exact question asked. Do NOT include generic commentary or side facts that are not related to the user's prompt.\n" +
  "2. You are Google Analytics Advisor, so bring deep diagnostic insights. E.g., if traffic dropped, explain WHICH campaign or source caused it, and compare device categories (mobile vs desktop).\n" +
  "3. Incorporate Period-over-Period (PoP) changes (e.g. 'Sessions grew by +12.4% compared to the previous week, driven by a spike in search traffic') to show trends.\n" +
  "4. Provide a clear attribution for successes or failures (attribute traffic/conversions to specific campaign names or source/mediums) and list the top page views if relevant.\n" +
  "5. DIAGNOSTIC TROUBLESHOOTING: If the GA4 dataset is empty (all 0s or 'No Data'), or if a specific metric requested (like ad spend or custom events) is missing, do NOT just output a generic error message. Instead, act like a helpful advisor: explain that the property has no recorded traffic/events for this period, and guide the user with clear setup steps (e.g., verifying their Google Tag installation, checking if their Google Ads account is linked, or confirming if custom events like 'test_start' are configured in their GA4 Admin panel).\n" +
  "6. Keep the response highly focused, clear, and actionable (maximum 2-4 sentences or a concise bullet list).";

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

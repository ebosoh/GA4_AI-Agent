/**
 * GA4 Automation with Gemini AI
 * Backend Google Apps Script (Code.gs)
 */

var GA4_PROPERTY_ID = 'properties/431424603'; 

// Replace with your actual Gemini API key if you don't use Script Properties
var GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || 'INSERT_YOUR_GEMINI_API_KEY_HERE';
var GEMINI_MODEL = 'gemini-2.5-flash-lite';

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
        var customReportData = null;
        var generatedQuery = null;

        // 1. Dynamically generate a custom GA4 Data API request based on the user's question
        var cache = CacheService.getScriptCache();
        var cacheKey = "query_" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, question.toLowerCase().trim()));
        var cachedQuery = cache.get(cacheKey);

        try {
          if (cachedQuery) {
            generatedQuery = JSON.parse(cachedQuery);
          } else {
            generatedQuery = generateGA4RequestWithGemini(question);
            if (generatedQuery && !generatedQuery.error) {
              cache.put(cacheKey, JSON.stringify(generatedQuery), 21600); // Cache for 6 hours
            }
          }

          if (generatedQuery && !generatedQuery.error) {
            // Run the custom query against the GA4 property
            var customReport = AnalyticsData.Properties.runReport(generatedQuery, propertyId);
            customReportData = parseReportRows(customReport);
          }
        } catch (queryErr) {
          console.warn("Failed to generate or run custom dynamic query: " + queryErr.toString());
        }

        // 2. Call Gemini to answer the question using both general parsedData and custom report data
        var answerText = answerQuestionWithGemini(parsedData, question, customReportData, generatedQuery);
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
      trafficSources: trafficCurrent.slice(0, 5).map(function(t) {
        return {
          sourceMedium: t.sessionSourceMedium,
          campaign: t.sessionCampaignName,
          sessions: t.sessions,
          activeUsers: t.activeUsers,
          conversions: t.conversions
        };
      }),
      topPages: pagesData.slice(0, 5),
      events: eventData.slice(0, 8),
      googleAds: adsData.slice(0, 5)
    }
  };

  return parsedData;
}

/**
 * Uses Gemini to translate user's question into a clean, valid GA4 Data API JSON query configuration
 */
function generateGA4RequestWithGemini(question) {
  if (GEMINI_API_KEY === 'INSERT_YOUR_GEMINI_API_KEY_HERE') {
    return { error: true, message: "Missing API Key" };
  }

  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY;

  var prompt = "You are a specialized compiler that translates user natural language questions into Google Analytics 4 (GA4) runReport query payloads.\n" +
  "Given the user's question: \"" + question + "\"\n\n" +
  "Produce a valid, syntax-compliant GA4 Data API report request config as a JSON object.\n" +
  "You MUST follow these rules:\n" +
  "1. Only use standard dimensions (e.g. 'deviceCategory', 'country', 'city', 'pagePath', 'sessionSourceMedium', 'sessionCampaignName', 'eventName', 'date').\n" +
  "2. Only use standard metrics (e.g. 'activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'conversions', 'eventCount', 'averageSessionDuration', 'bounceRate', 'engagementRate', 'sessionConversionRate').\n" +
  "3. Format dateRanges as standard strings: [{ 'startDate': '7daysAgo', 'endDate': 'today' }] or choose appropriate bounds if the user mentions time. Default to 7daysAgo to today.\n" +
  "4. Do NOT group incompatible dimensions or metrics (like advertiserAdCost with user-scoped dimensions) to prevent API errors.\n" +
  "5. If filtering is needed (e.g. a specific page path or event name), add a valid 'dimensionFilter' or 'metricFilter' object structure.\n" +
  "6. Output EXACTLY a single JSON object. Do not include markdown code block formatting (like ```json), commentary, or extra brackets. Just pure JSON.";

  var payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1,
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
    var aiText = result.candidates[0].content.parts[0].text.trim();
    return JSON.parse(aiText);
  } catch (err) {
    console.error("Failed to generate GA4 request config: " + err.message);
    return { error: true, message: err.message };
  }
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

  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY;
  
  var prompt = "You are Google Analytics Intelligence (Ask Advisor), a senior GA4 analyst.\n" +
  "Analyze the following GA4 metrics (including period-over-period comparisons, top pages, and device segments) and provide crisp, data-driven conclusions and actionable recommendations based strictly on the data provided.\n\n" +
  "Data:\n" +
  JSON.stringify(gaData) + "\n\n" +
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
function answerQuestionWithGemini(gaData, question, customReportData, generatedQuery) {
  if (GEMINI_API_KEY === 'INSERT_YOUR_GEMINI_API_KEY_HERE') {
    return "Gemini API Key missing. Please configure GEMINI_API_KEY in the Apps Script.";
  }

  var condensedGaData = _getCondensedOverview(gaData);

  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY;
  
  var prompt = "You are Google Analytics Intelligence (Ask Advisor), a world-class GA4 senior web analyst and growth advisor.\n" +
  "The user has asked the following specific question about their GA4 data:\n" +
  "\"" + question + "\"\n\n" +
  "To help you answer, we ran a dynamically generated GA4 Data API query tailored to their question.\n" +
  "Dynamic Query Configuration Used:\n" +
  JSON.stringify(generatedQuery) + "\n\n" +
  "Dynamically Retrieved GA4 Dataset:\n" +
  JSON.stringify(customReportData) + "\n\n" +
  "Standard Dashboard Overview Metrics (use if needed for context/comparison):\n" +
  JSON.stringify(condensedGaData) + "\n\n" +
  "CRITICAL DIRECTIVES:\n" +
  "1. Answer ONLY the exact question asked using the custom query data and general metrics. Do NOT include unrelated commentary or recommendations.\n" +
  "2. You are Google Analytics Advisor, so bring deep diagnostic insights. Reference exact numbers (active users, sessions, conversions, pageviews, event counts) returned in the custom query data.\n" +
  "3. Incorporate Period-over-Period (PoP) comparisons (e.g. sessions/conversions growth compared to the previous period) from the standard metrics if helpful to show weekly performance trends.\n" +
  "4. Provide attribution for trends: tie traffic shifts to specific landing pages, device categories, or traffic source channels.\n" +
  "5. DIAGNOSTIC TROUBLESHOOTING: If the custom dataset is empty (all 0s or empty arrays), do NOT just say 'no data'. Explain that the specific metric/dimension is currently not tracking in their GA4 property and guide them with quick instructions on how to set it up (e.g., verifying tag configuration, linking ads, or setting up custom conversion events).\n" +
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

/**
 * Helper to remove rawMetrics array lists from gaData to save tokens
 */
function _getCondensedOverview(gaData) {
  if (!gaData) return {};
  var condensed = {};
  for (var key in gaData) {
    if (key !== 'rawMetrics') {
      condensed[key] = gaData[key];
    }
  }
  return condensed;
}

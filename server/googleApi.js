import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';
import { saveAdminTokens } from './db.js';

dotenv.config();

// Initialize OAuth2 client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID || 'MOCK_CLIENT_ID',
  process.env.GOOGLE_CLIENT_SECRET || 'MOCK_CLIENT_SECRET',
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback'
);

/**
 * Generates the Google OAuth authorization URL.
 */
export function getGoogleAuthUrl(dynamicRedirectUri) {
  const redirectUri = dynamicRedirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback';

  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID') {
    return `${redirectUri}?code=mock_authorization_code_success`;
  }

  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const scopes = [
    'https://www.googleapis.com/auth/webmasters.readonly', // Search Console
    'https://www.googleapis.com/auth/analytics.readonly',   // Google Analytics
    'https://www.googleapis.com/auth/adwords',              // Google Ads
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  return client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
}

/**
 * Exchanges the code for Google Access and Refresh Tokens.
 */
export async function getTokensFromCode(code, dynamicRedirectUri) {
  if (process.env.GOOGLE_CLIENT_ID === undefined || process.env.GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID') {
    // Return mock tokens in development/no-env mode
    return {
      access_token: 'mock_access_token_' + Math.random().toString(36).substring(7),
      refresh_token: 'mock_refresh_token_' + Math.random().toString(36).substring(7),
      expiry_date: Date.now() + 3600 * 1000,
      isMock: true
    };
  }

  const redirectUri = dynamicRedirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback';
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const { tokens } = await client.getToken(code);
  return tokens;
}

/**
 * Fetches user info from Google OAuth2 API.
 */
export async function getUserInfo(tokens) {
  if (tokens.isMock || !process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID') {
    return {
      name: 'Utilizator Demo',
      email: 'seo.user@gmail.com',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80'
    };
  }

  try {
    const auth = new OAuth2Client();
    auth.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth });
    const res = await oauth2.userinfo.get();
    return {
      name: res.data.name || 'Utilizator Google',
      email: res.data.email || '',
      avatar: res.data.picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80'
    };
  } catch (error) {
    console.error('Error fetching user info:', error.message);
    return {
      name: 'Utilizator Google',
      email: 'connected-user@google.com',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80'
    };
  }
}

export async function refreshAndGetTokens(tokens) {
  if (!tokens || tokens.isMock || !tokens.refresh_token || !process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID') {
    return tokens;
  }

  // If token is expired or close to expiry (within 5 minutes)
  if (!tokens.expiry_date || tokens.expiry_date < Date.now() + 300 * 1000) {
    try {
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback';
      const auth = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri
      );
      auth.setCredentials(tokens);
      const { credentials } = await auth.refreshAccessToken();
      
      const updatedTokens = { ...tokens, ...credentials };
      saveAdminTokens(updatedTokens);
      console.log('[Google Auth] Tokenul de acces Google a fost reîmprospătat și salvat pe server.');
      return updatedTokens;
    } catch (e) {
      console.error('[Google Auth Error] Eșec la reîmprospătarea automată a tokenului Google:', e.message);
    }
  }

  return tokens;
}

/**
 * Google Search Console API fetch or mock fallback.
 */
export async function getSearchConsoleData(tokens, domain) {
  const activeTokens = await refreshAndGetTokens(tokens);
  const isMock = activeTokens.isMock || !process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID';

  if (isMock) {
    return generateMockSearchConsoleData(domain);
  }

  try {
    const auth = new OAuth2Client();
    auth.setCredentials(activeTokens);
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    // Format domain for GSC API (usually siteUrl starts with sc-domain: or https://)
    let siteUrl = domain;
    if (!siteUrl.startsWith('sc-domain:') && !siteUrl.startsWith('http')) {
      siteUrl = `sc-domain:${siteUrl}`;
    }

    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const formatDate = (d) => d.toISOString().split('T')[0];

    const response = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: formatDate(thirtyDaysAgo),
        endDate: formatDate(today),
        dimensions: ['QUERY'],
        rowLimit: 20
      }
    });

    // Also get impressions/clicks history
    const historyResponse = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: formatDate(thirtyDaysAgo),
        endDate: formatDate(today),
        dimensions: ['DATE'],
        rowLimit: 30
      }
    });

    return {
      queries: response.data.rows || [],
      history: historyResponse.data.rows || [],
      isMock: false
    };
  } catch (error) {
    console.error('Error fetching Google Search Console data, falling back to mock:', error.message);
    return generateMockSearchConsoleData(domain);
  }
}

/**
 * Google Analytics 4 (GA4) API fetch or mock fallback.
 */
export async function getAnalyticsData(tokens, propertyId) {
  const activeTokens = await refreshAndGetTokens(tokens);
  const isMock = activeTokens.isMock || !process.env.GOOGLE_CLIENT_ID || !propertyId;

  if (isMock) {
    return generateMockAnalyticsData();
  }

  try {
    const auth = new OAuth2Client();
    auth.setCredentials(activeTokens);

    // Call GA4 reporting API (Google Analytics Data API v1beta)
    // Note: requires setting up the property ID
    const analyticsdata = google.analyticsdata({ version: 'v1beta', auth });
    
    const response = await analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' }
        ],
        dimensions: [{ name: 'date' }]
      }
    });

    const pagesResponse = await analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        metrics: [{ name: 'screenPageViews' }],
        dimensions: [{ name: 'pagePath' }],
        limit: 10
      }
    });

    return {
      dailyReport: response.data.rows || [],
      topPages: pagesResponse.data.rows || [],
      isMock: false
    };
  } catch (error) {
    console.error('Error fetching Google Analytics data, falling back to mock:', error.message);
    return generateMockAnalyticsData();
  }
}

/**
 * Google Ads API fetch or mock fallback.
 * NOTE: Ads API is highly restricted (requires dev token). We default to high-fidelity mock here.
 */
export async function getGoogleAdsData(tokens) {
  // Mostly mock, as Ads API is very complex to authenticate dynamically for small apps
  return generateMockGoogleAdsData();
}

// ==========================================
// MOCK DATA GENERATORS (HIGH-FIDELITY)
// ==========================================

function generateMockSearchConsoleData(domain) {
  const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '');
  const queries = [
    { keys: [`${cleanDomain} seo`], clicks: 145, impressions: 842, ctr: 0.172, position: 1.2 },
    { keys: [`analiza seo gratuita`], clicks: 92, impressions: 1205, ctr: 0.076, position: 3.4 },
    { keys: [`cum fac optimizare seo`], clicks: 48, impressions: 630, ctr: 0.076, position: 5.1 },
    { keys: [`crawler site romania`], clicks: 35, impressions: 210, ctr: 0.166, position: 2.1 },
    { keys: [`audit seo on-page`], clicks: 28, impressions: 450, ctr: 0.062, position: 6.8 },
    { keys: [`google search console conectare`], clicks: 12, impressions: 180, ctr: 0.066, position: 8.2 },
    { keys: [`viteze site optimizare`], clicks: 8, impressions: 320, ctr: 0.025, position: 12.4 }
  ];

  // History for last 15 days
  const history = [];
  for (let i = 15; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    // Add some random noise to clicks and impressions
    const baseImpressions = 1500 + Math.sin(i) * 300 + Math.random() * 200;
    const baseClicks = 120 + Math.sin(i) * 30 + Math.random() * 20;

    history.push({
      keys: [dateStr],
      clicks: Math.round(baseClicks),
      impressions: Math.round(baseImpressions),
      ctr: baseClicks / baseImpressions,
      position: 4.2 + (Math.random() - 0.5)
    });
  }

  return {
    queries,
    history,
    isMock: true
  };
}

function generateMockAnalyticsData() {
  const topPages = [
    { dimensionValues: [{ value: '/' }], metricValues: [{ value: '4520' }] },
    { dimensionValues: [{ value: '/blog/ghid-seo-2026' }], metricValues: [{ value: '1850' }] },
    { dimensionValues: [{ value: '/servicii' }], metricValues: [{ value: '1240' }] },
    { dimensionValues: [{ value: '/preturi' }], metricValues: [{ value: '980' }] },
    { dimensionValues: [{ value: '/despre-noi' }], metricValues: [{ value: '620' }] },
    { dimensionValues: [{ value: '/contact' }], metricValues: [{ value: '410' }] }
  ];

  const dailyReport = [];
  for (let i = 15; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const activeUsers = 350 + Math.round(Math.sin(i * 1.5) * 100 + Math.random() * 60);
    const sessions = activeUsers + Math.round(Math.random() * 50);
    const bounceRate = 0.42 + (Math.random() - 0.5) * 0.08;

    dailyReport.push({
      dimensionValues: [{ value: dateStr }],
      metricValues: [
        { value: activeUsers.toString() },
        { value: sessions.toString() },
        { value: bounceRate.toFixed(4) },
        { value: '184' } // Average duration in seconds
      ]
    });
  }

  return {
    dailyReport,
    topPages,
    isMock: true
  };
}

function generateMockGoogleAdsData() {
  // Campaign metrics
  const campaigns = [
    { id: '1', name: 'Search - Servicii SEO', budget: 50, status: 'Activ', clicks: 824, impressions: 12400, ctr: 0.066, cost: 412, cpc: 0.50, conversions: 45 },
    { id: '2', name: 'Performance Max - Brand', status: 'Activ', budget: 20, clicks: 1450, impressions: 38200, ctr: 0.038, cost: 290, cpc: 0.20, conversions: 98 },
    { id: '3', name: 'Display - Remarketing', status: 'Inactiv', budget: 15, clicks: 180, impressions: 24500, ctr: 0.007, cost: 72, cpc: 0.40, conversions: 8 }
  ];

  const summary = {
    clicks: campaigns.reduce((acc, c) => acc + c.clicks, 0),
    impressions: campaigns.reduce((acc, c) => acc + c.impressions, 0),
    cost: campaigns.reduce((acc, c) => acc + c.cost, 0),
    conversions: campaigns.reduce((acc, c) => acc + c.conversions, 0),
  };
  summary.ctr = summary.clicks / summary.impressions;
  summary.cpc = summary.cost / summary.clicks;
  summary.cpa = summary.cost / summary.conversions;

  return {
    campaigns,
    summary,
    isMock: true
  };
}

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { SiteCrawler } from './crawler.js';
import { 
  getGoogleAuthUrl, 
  getTokensFromCode, 
  getUserInfo,
  getSearchConsoleData, 
  getAnalyticsData, 
  getGoogleAdsData 
} from './googleApi.js';
import {
  getProjects,
  saveProjects,
  getProjectData,
  saveProjectData,
  deleteProjectFiles
} from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Real-Time Google PageSpeed Insights API Route
app.get('/api/pagespeed', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    console.log(`[PageSpeed API] Se rulează testul real pentru: ${url}`);
    const googleApiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=performance&strategy=mobile`;
    const response = await axios.get(googleApiUrl);
    const data = response.data;
    
    if (!data.lighthouseResult) {
      throw new Error('Răspuns invalid de la Google PageSpeed API');
    }

    const lighthouse = data.lighthouseResult;
    const score = Math.round(lighthouse.categories.performance.score * 100);
    const audits = lighthouse.audits;
    
    // Extract metrics
    const fcp = audits['first-contentful-paint']?.displayValue || 'N/A';
    const lcp = audits['largest-contentful-paint']?.displayValue || 'N/A';
    const cls = audits['cumulative-layout-shift']?.displayValue || 'N/A';
    const inp = audits['interactive']?.displayValue || 'N/A';
    const speedIndex = audits['speed-index']?.displayValue || 'N/A';
    const tti = audits['interactive']?.displayValue || 'N/A';
    const ttfb = audits['server-response-time']?.numericValue ? Math.round(audits['server-response-time'].numericValue) : 0;
    
    // Extract opportunities
    const opportunities = [];
    Object.keys(audits).forEach(key => {
      const audit = audits[key];
      if (audit.details && audit.details.type === 'opportunity' && audit.details.overallSavingsMs > 0) {
        opportunities.push({
          title: audit.title,
          savings: `${(audit.details.overallSavingsMs / 1000).toFixed(1)} s`,
          severity: audit.details.overallSavingsMs > 2000 ? 'critical' : 'warning'
        });
      }
    });

    res.json({
      score,
      metrics: {
        fcp,
        lcp,
        cls,
        inp,
        speedIndex,
        tti,
        ttfb: `${ttfb} ms`
      },
      opportunities: opportunities.slice(0, 4)
    });
  } catch (error) {
    console.error('[PageSpeed API Error]:', error.message);
    res.status(500).json({ error: 'Eroare PageSpeed: ' + error.message });
  }
});

// ==========================================
// CRAWLER ENDPOINTS (Server-Sent Events)
// ==========================================

app.get('/api/crawl/stream', (req, res) => {
  const { domain, maxPages, projectId } = req.query;

  if (!domain) {
    return res.status(400).json({ error: 'Domeniul este obligatoriu.' });
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Prevent Nginx buffering if deployed
  });

  const parsedMaxPages = parseInt(maxPages) || 30;
  
  console.log(`[Crawler] Cerere primită pentru domeniul: ${domain}, max pagini: ${parsedMaxPages}, proiect: ${projectId || 'niciunul'}`);

  // Stream connection start
  res.write(`data: ${JSON.stringify({ type: 'start', message: `Inițializare crawler pentru: ${domain}` })}\n\n`);

  const crawler = new SiteCrawler(domain, parsedMaxPages);

  crawler.onProgress = (stats) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', stats })}\n\n`);
  };

  crawler.onPageCrawled = (page) => {
    console.log(`[Crawler] Scanat cu succes: ${page.url} (Scor: ${page.score}, Status: ${page.statusCode || 200})`);
    res.write(`data: ${JSON.stringify({ type: 'page', page })}\n\n`);
  };

  crawler.onFinished = (pages) => {
    console.log(`[Crawler] Scanare completată. Total pagini scanate: ${pages.length}`);
    
    // Auto-save results to project file if projectId is present
    if (projectId) {
      try {
        const projectData = getProjectData(projectId);
        
        // Initialize history if missing
        if (!projectData.history) {
          projectData.history = [];
        }
        
        // Save current pages to history
        projectData.history.push({
          timestamp: new Date().toISOString(),
          pages: pages
        });
        
        // Limit to last 5 crawls
        if (projectData.history.length > 5) {
          projectData.history = projectData.history.slice(-5);
        }

        projectData.pages = pages;
        projectData.lastCrawlTime = new Date().toISOString();
        saveProjectData(projectId, projectData);
        console.log(`[Crawler] Rezultate salvate cu succes pentru proiectul: ${projectId}`);
      } catch (err) {
        console.error(`[Crawler] Eroare la salvarea paginilor pentru proiectul ${projectId}:`, err.message);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'finished', pages })}\n\n`);
    res.end();
  };

  // Start crawling
  crawler.start().catch((err) => {
    console.error(`[Crawler] Eroare la pornirea crawling-ului:`, err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  });

  // If user closes connection, stop crawling
  req.on('close', () => {
    console.log(`[Crawler] Conexiune închisă de client. Oprire crawl.`);
    crawler.stop();
  });
});

// ==========================================
// GOOGLE OAUTH ENDPOINTS
// ==========================================

app.get('/api/auth/google/url', (req, res) => {
  try {
    const url = getGoogleAuthUrl();
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/google/callback', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Codul de autorizare lipsește.' });
  }

  try {
    const tokens = await getTokensFromCode(code);
    const user = await getUserInfo(tokens);
    res.json({ tokens, user });
  } catch (error) {
    console.error('Error exchanging code:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// GOOGLE METRICS ENDPOINTS
// ==========================================

app.post('/api/google/search-console', async (req, res) => {
  const { tokens, domain } = req.body;
  if (!tokens || !domain) {
    return res.status(400).json({ error: 'Tokens și domeniul sunt obligatorii.' });
  }

  try {
    const data = await getSearchConsoleData(tokens, domain);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/google/analytics', async (req, res) => {
  const { tokens, propertyId } = req.body;
  if (!tokens) {
    return res.status(400).json({ error: 'Tokens sunt obligatorii.' });
  }

  try {
    const data = await getAnalyticsData(tokens, propertyId || null);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/google/ads', async (req, res) => {
  const { tokens } = req.body;
  if (!tokens) {
    return res.status(400).json({ error: 'Tokens sunt obligatorii.' });
  }

  try {
    const data = await getGoogleAdsData(tokens);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// PROJECTS API ENDPOINTS
// ==========================================

app.get('/api/projects', (req, res) => {
  try {
    const list = getProjects();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects', (req, res) => {
  const { name, domain } = req.body;
  if (!name || !domain) {
    return res.status(400).json({ error: 'Numele și domeniul sunt obligatorii.' });
  }

  try {
    const projects = getProjects();
    
    // Add protocol to domain if missing
    let cleanDomain = domain.trim();
    if (!/^https?:\/\//i.test(cleanDomain)) {
      cleanDomain = 'https://' + cleanDomain;
    }

    const newProject = {
      id: 'proj_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      name: name.trim(),
      domain: cleanDomain,
      createdAt: new Date().toISOString(),
      googlePropertyId: ''
    };

    projects.push(newProject);
    saveProjects(projects);

    // Initialize empty project data file
    saveProjectData(newProject.id, {
      pages: [],
      editorText: '',
      targetKeywords: 'seo, optimizare, site',
      googlePropertyId: ''
    });

    res.status(210).json(newProject);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;

  try {
    const projects = getProjects();
    const filtered = projects.filter(p => p.id !== id);
    
    if (projects.length === filtered.length) {
      return res.status(404).json({ error: 'Proiectul nu a fost găsit.' });
    }

    saveProjects(filtered);
    deleteProjectFiles(id);

    res.json({ message: 'Proiect șters cu succes.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects/:id/data', (req, res) => {
  const { id } = req.params;

  try {
    const data = getProjectData(id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects/:id/data', (req, res) => {
  const { id } = req.params;
  const { pages, editorText, targetKeywords, googlePropertyId } = req.body;

  try {
    const data = getProjectData(id);
    
    if (pages !== undefined) data.pages = pages;
    if (editorText !== undefined) data.editorText = editorText;
    if (targetKeywords !== undefined) data.targetKeywords = targetKeywords;
    if (googlePropertyId !== undefined) {
      data.googlePropertyId = googlePropertyId;
      
      // Update property id in main projects index too
      const projects = getProjects();
      const index = projects.findIndex(p => p.id === id);
      if (index !== -1) {
        projects[index].googlePropertyId = googlePropertyId;
        saveProjects(projects);
      }
    }

    saveProjectData(id, data);
    res.json({ message: 'Date salvate cu succes.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auto-deployment Webhook from GitHub
app.post('/api/deploy-webhook', (req, res) => {
  console.log('[Webhook] Actualizare detectată pe GitHub. Se pornește descărcarea codului...');
  
  // Run git pull to fetch latest changes
  exec('git pull origin main', (err, stdout, stderr) => {
    if (err) {
      console.error('[Webhook Error] Eșec la rularea git pull:', err.message);
      return res.status(500).json({ error: err.message });
    }
    
    console.log('[Webhook] Codul a fost actualizat cu succes:', stdout);
    
    // Touch tmp/restart.txt to tell cPanel Phusion Passenger to reload the Node app
    exec('mkdir -p tmp && touch tmp/restart.txt', (err2) => {
      if (err2) {
        console.error('[Webhook Error] Nu s-a putut genera tmp/restart.txt:', err2.message);
      } else {
        console.log('[Webhook] Fisierul tmp/restart.txt a fost atins. cPanel va reporni aplicația automat.');
      }
    });

    res.json({ message: 'Auto-deployment finalizat cu succes!', log: stdout });
  });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static assets from React client build
app.use(express.static(path.join(__dirname, '../client/dist')));

// Wildcard route to serve React's index.html for frontend routing
app.get('*', (req, res) => {
  // If request is an API request, return 404 instead of serving HTML
  if (req.originalUrl.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`[SEOapp Server] Rulează pe portul http://localhost:${PORT}`);
});

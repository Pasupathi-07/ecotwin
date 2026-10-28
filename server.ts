import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { initializeDatabaseAndSeed } from './server/db.ts';
import { apiRouter } from './server/routes.ts';

async function startServer() {
  // Initialize SQLite schema, bundled demo CSVs, and baseline + Random Forest v1.0.0 artifact
  initializeDatabaseAndSeed();

  const app = express();
  const port = Number(process.env.PORT || 3000);

  // Restrict JSON body size to prevent oversized payload abuse
  app.use(express.json({ limit: '2mb' }));

  // Local CORS safety header for development
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('.run.app'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Mount REST API
  app.use('/api', apiRouter);

  // Consistent JSON 404 & error boundary for API routes (never leak stack traces)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Requested API endpoint does not exist.' });
  });

  const distPath = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(distPath, 'index.html'));

  if (isProd) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`EcoTwin AI server listening at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start EcoTwin AI server:', err);
  process.exit(1);
});

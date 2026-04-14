import express from 'express';
import cors from 'cors';
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import EventEmitter from 'eventemitter3';
import dotenv from 'dotenv';
import { fetchAndBackupEmail } from './src/fetch-and-backup-email.js';
import { addMonths, addDays, format, parseISO } from 'date-fns';
import { access, constants } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, 'ui')));

const globalEmitter = new EventEmitter();
let activeAbortController = null;
let currentBackupEnv = null;

// Helper to get env files
async function getEnvFiles() {
  const files = await readdir(__dirname);
  return files.filter(f => f.endsWith('.env') && f !== 'sample.env');
}

// Get all accounts
app.get('/api/accounts', async (req, res) => {
  try {
    const envFiles = await getEnvFiles();
    const accounts = [];
    for (const file of envFiles) {
      const content = await readFile(path.join(__dirname, file), 'utf8');
      const parsed = dotenv.parse(content);
      const envFileName = path.basename(file, '.env');
      let lastExecution = null;
      try {
        lastExecution = await readFile(`./MAIL/${envFileName}_last_execution.txt`, 'utf8');
      } catch (e) {
        // File doesn't exist
      }

      accounts.push({
        filename: file,
        host: parsed.IMAP_HOST || '',
        port: parsed.IMAP_PORT || '',
        user: parsed.IMAP_USER || '',
        lastExecution: lastExecution
      });
    }
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create or update account
app.post('/api/accounts', async (req, res) => {
  const { filename, host, port, user } = req.body;
  if (!filename || !host || !port || !user) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  
  const content = `IMAP_HOST=${host}\nIMAP_PORT=${port}\nIMAP_USER=${user}\n`;
  const normalizedFilename = filename.endsWith('.env') ? filename : `${filename}.env`;
  
  try {
    await writeFile(path.join(__dirname, normalizedFilename), content, 'utf8');
    res.json({ success: true, filename: normalizedFilename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete account
app.delete('/api/accounts/:filename', async (req, res) => {
  const file = req.params.filename;
  if (!file.endsWith('.env')) return res.status(400).json({ error: 'Invalid file' });
  try {
    await unlink(path.join(__dirname, file));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE endpoint for progress
app.get('/api/backup/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const onLog = (msg) => res.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
  const onProgress = (data) => res.write(`data: ${JSON.stringify({ type: 'progress', data })}\n\n`);
  const onFinished = () => res.write(`data: ${JSON.stringify({ type: 'finished' })}\n\n`);
  const onStatus = () => {
    res.write(`data: ${JSON.stringify({ type: 'status', active: !!activeAbortController, env: currentBackupEnv })}\n\n`);
  }

  globalEmitter.on('log', onLog);
  globalEmitter.on('progress', onProgress);
  globalEmitter.on('finished', onFinished);
  globalEmitter.on('status', onStatus);

  // Send initial status immediately
  onStatus();

  req.on('close', () => {
    globalEmitter.off('log', onLog);
    globalEmitter.off('progress', onProgress);
    globalEmitter.off('finished', onFinished);
    globalEmitter.off('status', onStatus);
  });
});

// Start backup
app.post('/api/backup/start', async (req, res) => {
  if (activeAbortController) {
    return res.status(400).json({ error: 'Backup is already running' });
  }

  const { filename, start, end, password, deleteOlderThan } = req.body;
  
  if (!password) {
     return res.status(400).json({ error: `IMAP password is required to start backup` });
  }

  try {
    const envPath = path.join(__dirname, filename);
    const content = await readFile(envPath, 'utf8');
    const env = dotenv.parse(content);

    const envFileName = path.basename(envPath, path.extname(envPath));
    const outputDir = `./MAIL/${envFileName}`;
    const lastExecutionFile = `./MAIL/${envFileName}_last_execution.txt`;

    let startDate = start;
    if (!startDate) {
      try {
        await access(lastExecutionFile, constants.F_OK)
        const lastExecutionDate = await readFile(lastExecutionFile, 'utf8')
        startDate = format(parseISO(lastExecutionDate), 'yyyy-MM-dd')
      } catch {
        startDate = '1970-01-01'; // Default to a very old date to backup EVERYTHING
      }
    }

    const endDate = end || format(addDays(new Date(), 1), 'yyyy-MM-dd');

    const imapConfig = {
      host: env.IMAP_HOST,
      port: env.IMAP_PORT,
      user: env.IMAP_USER,
      password: password
    };

    activeAbortController = new AbortController();
    currentBackupEnv = filename;
    globalEmitter.emit('status');

    res.json({ success: true, message: 'Backup started' });

    // Run async
    setImmediate(async () => {
      try {
        // Save execution time
        try {
          await access('./MAIL', constants.F_OK).catch(() => import('node:fs/promises').then(fs => fs.mkdir('./MAIL', { recursive: true })));
          await writeFile(lastExecutionFile, new Date().toISOString())
        } catch(e) {}

        await fetchAndBackupEmail({
          imapConfig,
          searchQuery: { since: startDate, before: endDate },
          output: outputDir,
          eventEmitter: globalEmitter,
          abortSignal: activeAbortController.signal,
          deleteOlderThan: deleteOlderThan
        });
      } catch (err) {
        globalEmitter.emit('log', `ERROR: ${err.message}`);
      } finally {
        activeAbortController = null;
        currentBackupEnv = null;
        globalEmitter.emit('finished');
        globalEmitter.emit('status');
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop backup
app.post('/api/backup/stop', (req, res) => {
  if (activeAbortController) {
    activeAbortController.abort();
    res.json({ success: true, message: 'Stopping backup...' });
  } else {
    res.status(400).json({ error: 'No backup running' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Email Backup Server running at http://localhost:${PORT}`);
});

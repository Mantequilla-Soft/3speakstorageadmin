import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import path from 'path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ProgressManager } from '../utils/progress-manager';
import { BatchProcessor } from '../utils/batch-processor';
import { DatabaseService } from '../services/database';
import { IpfsService } from '../services/ipfs';
import { statsCommand } from '../commands/stats';
import { purgeFailedCommand, purgeFailedCommandWithProgress } from '../commands/purge-failed';
import { purgeAbandonedCommand, purgeAbandonedCommandWithProgress } from '../commands/purge-abandoned';
import { purgeBannedCommand, purgeBannedCommandWithProgress } from '../commands/purge-banned';
import { ipfsDietCommand, ipfsDietCommandWithProgress } from '../commands/ipfs-diet';
import { nukeAccountCommand, nukeAccountCommandWithProgress } from '../commands/nuke-account';
import { cleanupCommand, cleanupCommandWithProgress } from '../commands/cleanup';
import { listCommand } from '../commands/list';

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const WEB_PASSWORD = process.env.WEB_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'your-secret-key-change-this';

// Initialize progress manager
const progressManager = ProgressManager.getInstance();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  secret: SESSION_SECRET,
  resave: true,
  saveUninitialized: true,
  cookie: { 
    secure: false, // Set to false for development/HTTP
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Auth middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const isAuthenticated = req.session && (req.session as any).authenticated;
  logger.info(`Auth check: ${req.path}, authenticated: ${isAuthenticated}`);
  
  if (isAuthenticated) {
    return next();
  }
  logger.info('Not authenticated, redirecting to login');
  res.redirect('/login');
}

// Routes
app.get('/login', (req: Request, res: Response) => {
  res.render('login', { error: null });
});

app.post('/login', async (req: Request, res: Response) => {
  const { password } = req.body;
  
  logger.info(`Login attempt with password length: ${password?.length || 0}`);
  logger.info(`Expected password: ${WEB_PASSWORD}`);
  logger.info(`Password match: ${password === WEB_PASSWORD}`);
  
  if (password === WEB_PASSWORD) {
    (req.session as any).authenticated = true;
    
    // Explicitly save the session
    req.session.save((err) => {
      if (err) {
        logger.error('Session save error:', err);
        return res.render('login', { error: 'Login error - please try again' });
      }
      logger.info('Session saved, redirecting to dashboard');
      res.redirect('/');
    });
    return;
  }
  
  logger.info('Login failed - invalid password');
  res.render('login', { error: 'Invalid password' });
});

app.get('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Protected routes
app.get('/', requireAuth, (req: Request, res: Response) => {
  logger.info('Dashboard route accessed');
  try {
    res.render('dashboard');
    logger.info('Dashboard rendered successfully');
  } catch (error: any) {
    logger.error('Dashboard render error', error);
    res.status(500).send(`Dashboard Error: ${error.message}`);
  }
});

app.get('/api/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const db = new DatabaseService();
    await db.connect();
    
    // Create a new method to get comprehensive stats
    const stats = await db.getComprehensiveStats();
    
    await db.disconnect();
    
    logger.info('Stats fetched successfully:', stats);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    logger.error('Stats API error', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/node-stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const nodeMonitorUrl = process.env.NODE_MONITOR_URL;
    const nodeMonitorSecret = process.env.NODE_MONITOR_SECRET;
    
    if (!nodeMonitorUrl || !nodeMonitorSecret) {
      res.status(500).json({ 
        success: false, 
        error: 'Node monitoring service not configured (missing NODE_MONITOR_URL or NODE_MONITOR_SECRET)' 
      });
      return;
    }
    
    const response = await fetch(nodeMonitorUrl, {
      headers: {
        'Authorization': `Bearer ${nodeMonitorSecret}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Monitor service returned ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    logger.error('Node monitor fetch error', error);
    res.status(500).json({ 
      success: false, 
      error: `Unable to fetch node stats from supernode: ${error.message}`
    });
  }
});

app.post('/api/purge-failed', requireAuth, async (req: Request, res: Response) => {
  const { dryRun = true, batchSize = 100 } = req.body;
  const operationId = randomUUID();
  
  try {
    const operationName = `Purge failed videos${dryRun ? ' [PREVIEW]' : ''}`;
    progressManager.startOperation(operationId, operationName);
    
    // Small delay to ensure client connects before operation starts
    setTimeout(async () => {
      try {
        await purgeFailedCommandWithProgress(operationId, {
          dryRun: dryRun !== false,
          confirm: false,
          batchSize: batchSize.toString()
        });
      } catch (error: any) {
        logger.error('Purge failed background operation error:', error);
        progressManager.errorOperation(operationId, error.message);
      }
    }, 500);
    
    res.json({ 
      success: true, 
      message: 'Purge failed operation started',
      operationId: operationId
    });
  } catch (error: any) {
    logger.error('Purge failed API error', error);
    progressManager.errorOperation(operationId, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Server-Sent Events endpoint for real-time progress
app.get('/api/progress-stream', requireAuth, (req: Request, res: Response) => {
  const clientId = randomUUID();
  progressManager.addClient(clientId, res);
});

// Get active operations
app.get('/api/operations', requireAuth, (req: Request, res: Response) => {
  const operations = progressManager.getActiveOperations();
  res.json({ success: true, data: operations });
});

// Control operations
app.post('/api/operations/:operationId/:action', requireAuth, (req: Request, res: Response) => {
  const { operationId, action } = req.params;
  
  switch (action) {
    case 'pause':
      progressManager.pauseOperation(operationId);
      res.json({ success: true, message: `${action} requested for operation ${operationId}` });
      break;
    case 'resume':
      progressManager.resumeOperation(operationId);
      res.json({ success: true, message: `${action} requested for operation ${operationId}` });
      break;
    case 'cancel':
      progressManager.cancelOperation(operationId);
      res.json({ success: true, message: `${action} requested for operation ${operationId}` });
      break;
    default:
      res.status(400).json({ success: false, error: 'Invalid action' });
      break;
  }
});

app.post('/api/purge-abandoned', requireAuth, async (req: Request, res: Response) => {
  const { dryRun = true, olderThanDays = 30, batchSize = 25 } = req.body;
  const operationId = randomUUID();
  
  try {
    const operationName = `Purge abandoned videos (${olderThanDays}+ days)${dryRun ? ' [PREVIEW]' : ''}`;
    progressManager.startOperation(operationId, operationName);
    
    purgeAbandonedCommandWithProgress(operationId, {
      dryRun: dryRun !== false,
      confirm: false,
      olderThanDays: olderThanDays.toString(),
      batchSize: batchSize.toString()
    }).catch((error: any) => {
      progressManager.errorOperation(operationId, error.message);
    });
    
    res.json({ 
      success: true, 
      message: 'Purge abandoned operation started',
      operationId: operationId
    });
  } catch (error: any) {
    logger.error('Purge abandoned API error', error);
    progressManager.errorOperation(operationId, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ipfs-diet', requireAuth, async (req: Request, res: Response) => {
  const { dryRun = true, olderThanMonths = 6, viewThreshold = 500, batchSize = 25 } = req.body;
  const operationId = randomUUID();
  
  try {
    const operationName = `IPFS Diet (${olderThanMonths}+ months, <${viewThreshold} views)${dryRun ? ' [PREVIEW]' : ''}`;
    progressManager.startOperation(operationId, operationName);
    
    // Small delay to ensure client connects before operation starts
    setTimeout(async () => {
      try {
        await ipfsDietCommandWithProgress(operationId, {
          dryRun: dryRun !== false,
          confirm: false,
          olderThanMonths: olderThanMonths.toString(),
          viewThreshold: viewThreshold.toString(),
          batchSize: batchSize.toString()
        });
      } catch (error: any) {
        logger.error('IPFS diet background operation error:', error);
        progressManager.errorOperation(operationId, error.message);
      }
    }, 500);
    
    res.json({ 
      success: true, 
      message: 'IPFS diet operation started',
      operationId: operationId
    });
  } catch (error: any) {
    logger.error('IPFS diet API error', error);
    progressManager.errorOperation(operationId, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/nuke-account', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { username, dryRun = true, batchSize = 25 } = req.body;
  const operationId = randomUUID();
  
  if (!username) {
    res.status(400).json({ success: false, error: 'Username is required' });
    return;
  }
  
  try {
    const operationName = `Nuke account: ${username}${dryRun ? ' [PREVIEW]' : ''}`;
    progressManager.startOperation(operationId, operationName);
    
    // Small delay to ensure client connects before operation starts
    setTimeout(async () => {
      try {
        await nukeAccountCommandWithProgress(operationId, {
          username,
          dryRun: dryRun !== false,
          confirm: false,
          batchSize: batchSize.toString()
        });
      } catch (error: any) {
        logger.error('Nuke account background operation error:', error);
        progressManager.errorOperation(operationId, error.message);
      }
    }, 500);
    
    res.json({ 
      success: true, 
      message: 'Nuke account operation started',
      operationId: operationId
    });
  } catch (error: any) {
    logger.error('Nuke account API error', error);
    progressManager.errorOperation(operationId, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/purge-banned', requireAuth, async (req: Request, res: Response) => {
  const { dryRun = true, batchSize = 25 } = req.body;
  const operationId = randomUUID();
  
  try {
    const operationName = `Purge banned user videos${dryRun ? ' [PREVIEW]' : ''} (${batchSize} videos)`;
    progressManager.startOperation(operationId, operationName);
    
    // Small delay to ensure client connects before operation starts
    setTimeout(async () => {
      try {
        await purgeBannedCommandWithProgress(operationId, {
          dryRun: dryRun !== false,
          confirm: false,
          batchSize: batchSize.toString(),
          limit: batchSize.toString() // Limit total videos to batch size for safety
        });
      } catch (error: any) {
        logger.error('Purge banned background operation error:', error);
        progressManager.errorOperation(operationId, error.message);
      }
    }, 500); // 500ms delay to allow client connection
    
    res.json({ 
      success: true, 
      message: 'Purge banned operation started',
      operationId: operationId
    });
  } catch (error: any) {
    logger.error('Purge banned API error', error);
    progressManager.errorOperation(operationId, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/cleanup', requireAuth, async (req: Request, res: Response) => {
  const { dryRun = true, status = 'deleted', storageType, batchSize = 25 } = req.body;
  const operationId = randomUUID();
  
  try {
    // Start operation tracking
    const operationName = `Cleanup ${status} videos${storageType ? ` (${storageType})` : ''}${dryRun ? ' [DRY RUN]' : ''}`;
    progressManager.startOperation(operationId, operationName);
    
    // Run operation in background
    cleanupCommandWithProgress(operationId, {
      status,
      storageType,
      dryRun: dryRun !== false,
      confirm: false,
      batchSize: batchSize.toString()
    }).catch(error => {
      progressManager.errorOperation(operationId, error.message);
    });
    
    res.json({ 
      success: true, 
      message: 'Cleanup operation started',
      operationId: operationId
    });
  } catch (error: any) {
    logger.error('Cleanup API error', error);
    progressManager.errorOperation(operationId, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export function startWebServer() {
  app.listen(PORT, () => {
    logger.info(`🌐 3Speak Admin Web Interface running on http://localhost:${PORT}`);
    logger.info(`🔐 Login with password from WEB_PASSWORD environment variable`);
  });
}

export default app;

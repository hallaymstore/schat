const express = require('express');
const mongoose = require('mongoose');
const socketIO = require('socket.io');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const PptxGenJS = require('pptxgenjs');
const cloudinary = require('cloudinary').v2;
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Readable, Writable } = require('stream');
const { v4: uuidv4 } = require('uuid');
const { renderDeckSlidePngBuffers } = require('./slide-export-renderer');
const {
  WEBSITE_TEMPLATE_PRESETS,
  buildWebsiteLinks,
  normalizeWebsiteRenderSlug,
  normalizeWebsiteRenderPageSlug,
  renderWebsiteProjectHtml
} = require('./website-builder-renderer');
// const { AccessToken } = require('livekit-server-sdk'); // (disabled) using pure WebRTC signaling now
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Keep process alive on unexpected async/stream errors.
// We log the error and continue so live classes are not dropped by a single failed upload.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

// Mongoose safety: avoid buffering queries when DB is down
mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);


// ==================== DEFAULT ADMIN (Hardcoded) ====================
// Requested default admin credentials
const DEFAULT_ADMIN_USERNAME = 'admin0877hallaym';
const DEFAULT_ADMIN_PASSWORD = '0877admin++hallaym';
const LEGACY_ADMIN_USERNAMES = ['admin'];


// Initialize Express
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: ['http://localhost:3000', 'https://schat-q1nj.onrender.com', 'https://students.hallaym.site', 'https://hallaym.site'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'https://schat-q1nj.onrender.com', 'https://students.hallaym.site', 'https://hallaym.site'],
  credentials: true
}));
app.use(express.json());

// ==================== WebRTC ICE (STUN/TURN) config ====================
// Frontend should call GET /api/rtc-config and use returned iceServers.
// Set these env vars on your hosting (Render / VPS):
//   TURN_URL="turn:your-turn-domain:3478?transport=udp,turn:your-turn-domain:3478?transport=tcp"
//   TURN_USERNAME="user"
//   TURN_CREDENTIAL="pass"
// If TURN_URL is empty, only STUN servers will be returned.
app.get('/api/rtc-config', (req, res) => {
  try {
    const stunUrls = [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun3.l.google.com:19302',
      'stun:stun4.l.google.com:19302'
    ];

    const iceServers = [
      { urls: stunUrls }
    ];

    const turnUrlRaw = String(
      process.env.TURN_URL ||
      process.env.TURN_URLS ||
      process.env.TURN_SERVER ||
      process.env.EXPRESS_TURN_URL ||
      process.env.EXPRESSTURN_URL ||
      process.env.EXPRESS_TURN_URI ||
      process.env.EXPRESSTURN_URI ||
      process.env.TURN_URI ||
      ''
    ).trim();
    const turnUsername = String(
      process.env.TURN_USERNAME ||
      process.env.TURN_USER ||
      process.env.EXPRESS_TURN_USERNAME ||
      process.env.EXPRESSTURN_USERNAME ||
      process.env.EXPRESS_TURN_USER ||
      process.env.EXPRESSTURN_USER ||
      ''
    ).trim();
    const turnCredential = String(
      process.env.TURN_CREDENTIAL ||
      process.env.TURN_PASSWORD ||
      process.env.EXPRESS_TURN_CREDENTIAL ||
      process.env.EXPRESS_TURN_PASSWORD ||
      process.env.EXPRESSTURN_CREDENTIAL ||
      process.env.EXPRESSTURN_PASSWORD ||
      process.env.EXPRESS_TURN_PASS ||
      process.env.EXPRESSTURN_PASS ||
      ''
    ).trim();
    const disablePublicTurn = String(process.env.DISABLE_PUBLIC_TURN || '').trim() === '1';
    const fallbackTurnUrls = [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443?transport=tcp'
    ];

    const splitUrls = (raw) => String(raw || '')
      .split(/[\s,;]+/g)
      .map((s) => String(s || '').trim())
      .filter(Boolean);

    const normalizeTurnUrl = (u) => {
      let v = String(u || '').trim();
      if (!v) return '';
      if (/^turns?:\/\//i.test(v)) {
        const proto = v.startsWith('turns://') ? 'turns:' : 'turn:';
        v = proto + v.replace(/^turns?:\/\//i, '');
      }
      return v;
    };

    const parseEmbeddedCred = (url) => {
      const src = String(url || '').trim();
      const m = src.match(/^(turns?:)(?:\/\/)?([^:@\/\s]+):([^@\/\s]+)@(.+)$/i);
      if (!m) return { url: src.replace(/^turns?:\/\//i, (x) => x.replace('//', '')), username: '', credential: '' };
      return {
        url: `${m[1]}${m[4]}`.replace(/^turns?:\/\//i, (x) => x.replace('//', '')),
        username: decodeURIComponent(String(m[2] || '')),
        credential: decodeURIComponent(String(m[3] || ''))
      };
    };

    let embeddedUsername = '';
    let embeddedCredential = '';
    let customUrls = splitUrls(turnUrlRaw).map((u) => {
      const parsed = parseEmbeddedCred(u);
      if (!embeddedUsername && parsed.username) embeddedUsername = parsed.username;
      if (!embeddedCredential && parsed.credential) embeddedCredential = parsed.credential;
      return normalizeTurnUrl(parsed.url);
    }).filter(Boolean);

    // Keep stable order + remove duplicates.
    customUrls = Array.from(new Set(customUrls));

    const customUser = turnUsername || embeddedUsername;
    const customPass = turnCredential || embeddedCredential;
    const hasCustomTurn = customUrls.length > 0 && !!(customUser && customPass);
    const forceRelayEnv = String(process.env.TURN_FORCE_RELAY || process.env.FORCE_RELAY || '').trim().toLowerCase();
    const forceRelayDefault = forceRelayEnv === '1' || forceRelayEnv === 'true' || forceRelayEnv === 'yes';

    if (customUrls.length) {
      if (customUser && customPass) {
        iceServers.push({ urls: customUrls, username: customUser, credential: customPass });
      } else {
        // Some TURN deployments allow auth-less relay or short-lived token in URL.
        iceServers.push({ urls: customUrls });
      }
    }

    if (!disablePublicTurn) {
      iceServers.push({
        urls: fallbackTurnUrls,
        username: 'openrelayproject',
        credential: 'openrelayproject'
      });
    }

    res.json({
      success: true,
      iceServers,
      hasTurn: hasCustomTurn,
      forceRelayDefault
    });
  } catch (e) {
    console.error('❌ /api/rtc-config error:', e);
    res.status(500).json({ success: false, error: 'Failed to build rtc config' });
  }
});



/* LiveKit token endpoint disabled.
   To enable: uncomment the AccessToken import at the top:
     const { AccessToken } = require('livekit-server-sdk');
   and restore the endpoint body (ensure LIVEKIT_* env vars are set).
*/

app.use(express.urlencoded({ extended: true }));
app.use(async (req, res, next) => {
  try {
    const pathName = String(req.path || '').trim();
    if (!pathName || pathName.startsWith('/api/') || pathName.startsWith('/socket.io/') || pathName.startsWith('/uploads/')) {
      return next();
    }
    const host = String(req.headers.host || '').trim().toLowerCase();
    const slug = extractWebsiteBuilderSlugFromHost(host);
    if (!slug) return next();
    const handled = await tryServeGeneratedWebsiteRequest({
      req,
      res,
      slug,
      pageSlug: pathName === '/' ? 'index' : pathName.replace(/^\/+/, ''),
      allowDraft: false,
      preview: false
    });
    if (handled) return;
  } catch (e) {
    console.error('website subdomain middleware error:', e);
  }
  return next();
});
app.use(express.static('public'));


// Static fallbacks (avoid noisy 404s)
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/default-avatar.png', (req, res) => res.redirect('https://res.cloudinary.com/demo/image/upload/v1692290000/default-avatar.png'));
app.get('/default-group.png', (req, res) => res.redirect('https://res.cloudinary.com/demo/image/upload/v1692290000/default-group.png'));
app.get('/default-channel.png', (req, res) => res.redirect('https://res.cloudinary.com/demo/image/upload/v1692290000/default-channel.png'));



// Ensure uploads directory exists (Windows/Render safe)
try { require('fs').mkdirSync(path.join(__dirname, 'uploads'), { recursive: true }); } catch(e) { console.warn('uploads dir create failed', e); }

// Serve the first existing file from a list (so your local filenames work)
function sendFirstExisting(res, candidates) {
  const fs = require('fs');
  for (const f of candidates) {
    const fp = path.join(__dirname, f);
    if (fs.existsSync(fp)) return res.sendFile(fp);
  }
  return res.status(404).send('File not found: ' + candidates.join(', '));
}


// Serve live pages (keep files next to server file, or move into /public)
app.get('/lives.html', (req, res) => {
  return sendFirstExisting(res, ['lives.html','lives_final.html']);
});
app.get('/live.html', (req, res) => {
  return sendFirstExisting(res, ['live.html','live_final.html']);
});
// Teacher dashboard patched with Lives button
app.get('/teacher-dashboard.html', (req, res) => {
  return sendFirstExisting(res, ['teacher-dashboard.html','teacher-dashboard5.html','teacher-dashboard_final.html']);
});

// Student schedule page (upcoming lessons / planned lives)
app.get('/schedule.html', (req, res) => {
  return sendFirstExisting(res, ['schedule.html','schedule_final.html']);
});

// External university platforms (local preview wrappers)
app.get('/kstu.html', (req, res) => {
  return sendFirstExisting(res, ['public/kstu.html', 'kstu.html']);
});
app.get('/hemis.html', (req, res) => {
  return sendFirstExisting(res, ['public/hemis.html', 'hemis.html']);
});

// Group lessons (recordings list)
app.get('/group-lessons.html', (req, res) => {
  return sendFirstExisting(res, ['group-lessons2.html','group-lessons2.fixed.html','group-lessons.html','group-lessons.fixed.html']);
});

// Minimal topup placeholder (replace with your real payments/topup page)
app.get('/topup.html', (req, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Balansni to'ldirish</title>
  <style>body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#eaf0ff}
  .card{max-width:560px;padding:18px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05)}
  a{color:#93c5fd}</style></head><body><div class="card">
  <h2 style="margin:0 0 8px 0">Balansingiz yetarli emas</h2>
  <div>Coin balansingizni to'ldiring, keyin qayta urining.</div>
  <div style="margin-top:12px"><a href="/lives.html">← Lives ro'yxatiga qaytish</a></div>
  </div></body></html>`);
});
// Serve uploaded files (screenshots, media)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// Storage configuration (Cloudinary default, optional Cloudflare R2 via S3 API)
const STORAGE_PROVIDER = String(process.env.STORAGE_PROVIDER || '').trim().toLowerCase();
const R2_ACCOUNT_ID = String(process.env.R2_ACCOUNT_ID || '').trim();
const R2_ENDPOINT = String(
  process.env.R2_S3_ENDPOINT ||
  process.env.R2_ENDPOINT ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '')
).trim().replace(/\/+$/, '');
const R2_BUCKET = String(process.env.R2_BUCKET || '').trim();
const R2_ACCESS_KEY_ID = String(process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = String(process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const R2_REGION = String(process.env.R2_REGION || 'auto').trim();
const R2_PUBLIC_BASE_URL = String(process.env.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const REQUEST_R2_STORAGE = STORAGE_PROVIDER === 'r2' || !!R2_ENDPOINT;
const R2_READY = !!(R2_ENDPOINT && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
let r2Client = null;

function sanitizeStoragePath(v) {
  return String(v || '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9/_\-.]/g, '_');
}

function guessMimeTypeFromExt(fileName = '') {
  const ext = String(path.extname(fileName || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.ppt') return 'application/vnd.ms-powerpoint';
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return 'application/octet-stream';
}

function toPublicObjectUrl(key) {
  const cleanKey = encodeURIComponent(String(key || '').replace(/\\/g, '/')).replace(/%2F/g, '/');
  if (R2_PUBLIC_BASE_URL) return `${R2_PUBLIC_BASE_URL}/${cleanKey}`;
  if (R2_ENDPOINT && R2_BUCKET) return `${R2_ENDPOINT}/${R2_BUCKET}/${cleanKey}`;
  return cleanKey;
}

function buildObjectKey({ fileName, folder, publicId, uniqueFilename }) {
  const cleanFolder = sanitizeStoragePath(folder);
  const ext = path.extname(String(fileName || '')).toLowerCase();
  const hasExt = String(publicId || '').includes('.');
  if (publicId) {
    const withExt = hasExt ? String(publicId) : `${publicId}${ext}`;
    const key = sanitizeStoragePath(withExt);
    return cleanFolder ? `${cleanFolder}/${key}` : key;
  }
  const rawBase = String(path.basename(String(fileName || 'file'), ext) || 'file');
  const safeBase = rawBase.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uniq = uniqueFilename === false
    ? ''
    : `-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const keyName = `${safeBase}${uniq}${ext || ''}`;
  return cleanFolder ? `${cleanFolder}/${keyName}` : keyName;
}

async function putObjectToR2({ bodyBuffer, fileName, contentType, options = {} }) {
  if (!r2Client) throw new Error('R2 client is not initialized');
  const key = buildObjectKey({
    fileName,
    folder: options.folder || '',
    publicId: options.public_id || '',
    uniqueFilename: options.unique_filename
  });
  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: bodyBuffer,
    ContentType: contentType || options.content_type || guessMimeTypeFromExt(fileName)
  }));
  return {
    secure_url: toPublicObjectUrl(key),
    url: toPublicObjectUrl(key),
    public_id: key,
    bytes: Number(bodyBuffer?.length || 0),
    resource_type: String(options.resource_type || 'auto')
  };
}

if (REQUEST_R2_STORAGE && R2_READY) {
  r2Client = new S3Client({
    region: R2_REGION,
    endpoint: R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });

  cloudinary.uploader.upload = async (filePath, options = {}) => {
    const fsx = require('fs');
    const body = await fsx.promises.readFile(filePath);
    return putObjectToR2({
      bodyBuffer: body,
      fileName: options.filename_override || path.basename(filePath || 'file'),
      contentType: options.content_type || guessMimeTypeFromExt(filePath),
      options
    });
  };

  cloudinary.uploader.upload_large = async (filePath, options = {}) => {
    return cloudinary.uploader.upload(filePath, options);
  };

  cloudinary.uploader.upload_stream = (options = {}, callback) => {
    const chunks = [];
    const writable = new Writable({
      write(chunk, enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
        cb();
      }
    });

    writable.on('finish', async () => {
      try {
        const body = Buffer.concat(chunks);
        const result = await putObjectToR2({
          bodyBuffer: body,
          fileName: `${options.filename_override || 'stream'}.${String(options.resource_type || 'raw') === 'image' ? 'png' : 'bin'}`,
          contentType: options.content_type || 'application/octet-stream',
          options
        });
        if (typeof callback === 'function') callback(null, result);
      } catch (e) {
        if (typeof callback === 'function') callback(e);
      }
    });
    writable.on('error', (err) => {
      if (typeof callback === 'function') callback(err);
    });
    return writable;
  };

  cloudinary.uploader.destroy = async (publicId) => {
    const key = sanitizeStoragePath(publicId);
    if (!key) return { result: 'not_found' };
    await r2Client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key
    }));
    return { result: 'ok' };
  };

  console.log('✅ Storage provider: Cloudflare R2');
} else {
  if (REQUEST_R2_STORAGE && !R2_READY) {
    console.warn('⚠️ R2 requested but credentials are incomplete. Falling back to Cloudinary.');
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept all file types
    cb(null, true);
  }
});

const COURSE_MATERIAL_MAX_FILES = 3;
const COURSE_MATERIAL_MAX_BYTES = 5 * 1024 * 1024;
const COURSE_MATERIAL_MAX_TEXT_CHARS = 16000;
const COURSE_AI_SOURCE_MAX_CHARS = 18000;
const COURSE_COMMENT_MAX_CHARS = 2200;
const COURSE_REQUEST_MAX_CHARS = 700;
const COURSE_REVIEW_MAX_CHARS = 1200;
const COURSE_RATING_REVIEW_MAX_CHARS = 900;
const COURSE_LESSON_QUIZ_MAX_QUESTIONS = 12;
const COURSE_LESSON_QUIZ_MAX_OPTIONS = 6;

const courseMaterialUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: COURSE_MATERIAL_MAX_BYTES,
    files: COURSE_MATERIAL_MAX_FILES
  },
  fileFilter: (req, file, cb) => cb(null, true)
});

function withCourseMaterialUpload(req, res, next) {
  courseMaterialUpload.array('materials', COURSE_MATERIAL_MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Each material file must be <= 5MB' });
    }
    if (err?.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Max 3 files allowed per lesson' });
    }
    return res.status(400).json({ error: 'Failed to upload material files' });
  });
}


// Separate multer for lesson recordings (disk-backed to avoid RAM spikes on long uploads)
const recordingUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, getLessonUploadsTmpDir());
    },
    filename: function (req, file, cb) {
      const ext = (path.extname(file?.originalname || '') || '.webm').slice(0, 12).toLowerCase();
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `recording-${uniqueSuffix}${ext || '.webm'}`);
    }
  }),
  limits: { fileSize: 1500 * 1024 * 1024 }, // 1.5GB per upload for long 480p lessons
  fileFilter: (req, file, cb) => cb(null, true)
});

// Helper function to determine media type
function getMediaType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf')) return 'document';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'document';
  return 'file';
}


// Fail fast if MONGODB_URI is not set (prevents stats buffering timeouts)
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set. Create a MongoDB Atlas URI and set it in your environment (.env or Render).');
  process.exit(1);
}

// MongoDB Connection (defer HTTP start until connected)
const mongoConnectPromise = mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  family: 4
}).then(async () => {
  console.log('✅ MongoDB Connected');
  await ensureUserContactIndexes();
  // Default bootstrap (safe because it runs after file load; models are defined synchronously)
  await ensureDefaultAdmin();
  await ensureDefaultCatalog();
  await ensureDefaultPrograms();
  await ensureDefaultStudyTypes();
  await ensureDefaultStudyGroups();
}).catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
  process.exit(1);
});

async function waitForMongoReady() {
  try {
    // If already connected
    if (mongoose.connection.readyState === 1) return;
    // Wait for initial connect promise
    await mongoConnectPromise;
    if (mongoose.connection.readyState === 1) return;
    // Fallback: wait for open
    await new Promise((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onErr = (e) => { cleanup(); reject(e); };
      const cleanup = () => {
        mongoose.connection.off('open', onOpen);
        mongoose.connection.off('error', onErr);
      };
      mongoose.connection.on('open', onOpen);
      mongoose.connection.on('error', onErr);
    });
  } catch (e) {
    console.error('❌ MongoDB not ready:', e);
    process.exit(1);
  }
}

// ==================== MODELS ====================

const PREMIUM_USER_PLAN_CATALOG = [
  {
    scope: 'user',
    id: 'spark',
    label: 'HALLAYM Spark',
    monthlyPrice: 89000,
    yearlyPrice: 890000,
    aiCredits: 70,
    maxWebsites: 2,
    maxSlides: 25,
    stickerPack: 'premium-core',
    features: ['AI Slides', 'AI Website', 'Animated stickers', 'Verified badge']
  },
  {
    scope: 'user',
    id: 'pro',
    label: 'HALLAYM Pro',
    monthlyPrice: 189000,
    yearlyPrice: 1890000,
    aiCredits: 220,
    maxWebsites: 8,
    maxSlides: 90,
    stickerPack: 'premium-pro',
    features: ['AI Slides', 'AI Website', 'Animated stickers', 'Verified badge', 'Priority queue']
  },
  {
    scope: 'user',
    id: 'ultra',
    label: 'HALLAYM Ultra',
    monthlyPrice: 349000,
    yearlyPrice: 3490000,
    aiCredits: 520,
    maxWebsites: 20,
    maxSlides: 240,
    stickerPack: 'premium-ultra',
    features: ['AI Slides', 'AI Website', 'Animated stickers', 'Verified badge', 'Priority queue', 'Extended limits']
  }
];

const PREMIUM_UNIVERSITY_PLAN_CATALOG = [
  {
    scope: 'university',
    id: 'campus-250',
    label: 'Campus 250',
    monthlyPrice: 1990000,
    yearlyPrice: 19900000,
    seatLimit: 250,
    features: ['250 foydalanuvchi', 'Dashboard access', 'Notification center', 'Campus analytics']
  },
  {
    scope: 'university',
    id: 'campus-500',
    label: 'Campus 500',
    monthlyPrice: 3490000,
    yearlyPrice: 34900000,
    seatLimit: 500,
    features: ['500 foydalanuvchi', 'Dashboard access', 'Notification center', 'Campus analytics', 'Priority support']
  },
  {
    scope: 'university',
    id: 'campus-1000',
    label: 'Campus 1000',
    monthlyPrice: 5990000,
    yearlyPrice: 59900000,
    seatLimit: 1000,
    features: ['1000 foydalanuvchi', 'Dashboard access', 'Notification center', 'Campus analytics', 'Priority support', 'Launch assistance']
  }
];

const PREMIUM_PAYMENT_METHOD = {
  holder: String(process.env.PREMIUM_PAYMENT_HOLDER || process.env.ADMIN_PAYMENT_HOLDER || 'HALLAYM EDU').trim(),
  cardNumber: String(process.env.PREMIUM_PAYMENT_CARD || process.env.ADMIN_PAYMENT_CARD || '8600 0000 0000 0000').trim(),
  bankNote: String(process.env.PREMIUM_PAYMENT_BANK_NOTE || 'To‘lovdan keyin screenshot yuklang, admin tasdiqlaydi.').trim()
};

const PREMIUM_STICKER_PACKS = [
  {
    id: 'premium-core',
    label: 'Core Motion',
    minimumUserPlanIds: ['spark', 'pro', 'ultra'],
    stickers: [
      { id: 'spark-rocket', label: 'Rocket', url: '/assets/stickers/spark-rocket.svg' },
      { id: 'pulse-star', label: 'Pulse star', url: '/assets/stickers/pulse-star.svg' }
    ]
  },
  {
    id: 'premium-pro',
    label: 'Pro Motion',
    minimumUserPlanIds: ['pro', 'ultra'],
    stickers: [
      { id: 'orbit-crown', label: 'Orbit crown', url: '/assets/stickers/orbit-crown.svg' },
      { id: 'wave-heart', label: 'Wave heart', url: '/assets/stickers/wave-heart.svg' }
    ]
  },
  {
    id: 'premium-ultra',
    label: 'Ultra Motion',
    minimumUserPlanIds: ['ultra'],
    stickers: [
      { id: 'halo-burst', label: 'Halo burst', url: '/assets/stickers/halo-burst.svg' },
      { id: 'neon-bolt', label: 'Neon bolt', url: '/assets/stickers/neon-bolt.svg' }
    ]
  }
];

const PREMIUM_AI_COSTS = {
  slides_generate: 1,
  website_generate: 3
};

function cloneJsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDefaultNotificationSettings() {
  return {
    directMessages: true,
    courseUpdates: true,
    liveClasses: true,
    aiProducts: true,
    billing: true,
    marketing: false
  };
}

function buildDefaultPrivacySettings() {
  return {
    showEmail: false,
    showPhone: false,
    profileVisibility: 'campus'
  };
}

function buildDefaultUserSettings() {
  return {
    language: 'uz',
    theme: 'system',
    notifications: buildDefaultNotificationSettings(),
    privacy: buildDefaultPrivacySettings(),
    animatedStickers: true,
    stickerAutoplay: true,
    compactMode: false,
    soundEnabled: true,
    updatedAt: new Date()
  };
}

function buildDefaultPremiumState() {
  return {
    userPlan: {
      planId: '',
      label: '',
      scope: 'user',
      status: 'inactive',
      billingCycle: '',
      aiCreditsLimit: 0,
      aiCreditsRemaining: 0,
      aiCreditsUsed: 0,
      maxWebsites: 0,
      maxSlides: 0,
      stickerPackId: '',
      startedAt: null,
      renewedAt: null,
      expiresAt: null
    },
    institutionPlan: {
      planId: '',
      label: '',
      scope: 'university',
      status: 'inactive',
      billingCycle: '',
      seatLimit: 0,
      startedAt: null,
      renewedAt: null,
      expiresAt: null
    },
    features: {
      websiteGenerator: false,
      slideGenerator: false,
      animatedStickers: false,
      verifiedBadge: false
    },
    badgeLabel: '',
    stickerPackId: '',
    lastCreditResetAt: null
  };
}

function premiumCatalogByScope(scope) {
  return String(scope || '').trim().toLowerCase() === 'university'
    ? PREMIUM_UNIVERSITY_PLAN_CATALOG
    : PREMIUM_USER_PLAN_CATALOG;
}

function getPremiumPlanDefinition(scope, planId) {
  const safeId = String(planId || '').trim().toLowerCase();
  return premiumCatalogByScope(scope).find((item) => String(item.id || '').toLowerCase() === safeId) || null;
}

function premiumDurationDays(billingCycle) {
  return String(billingCycle || '').trim().toLowerCase() === 'yearly' ? 365 : 30;
}

function addDays(date, days) {
  const safe = date instanceof Date && !Number.isNaN(date.getTime()) ? new Date(date.getTime()) : new Date();
  safe.setDate(safe.getDate() + Number(days || 0));
  return safe;
}

function ensureUserSettingsState(user) {
  if (!user) return buildDefaultUserSettings();
  const defaults = buildDefaultUserSettings();
  const raw = user.settings && typeof user.settings === 'object' ? user.settings : {};
  const next = {
    language: ['uz', 'en', 'ru'].includes(String(raw.language || '').toLowerCase()) ? String(raw.language).toLowerCase() : defaults.language,
    theme: ['light', 'dark', 'system'].includes(String(raw.theme || '').toLowerCase()) ? String(raw.theme).toLowerCase() : defaults.theme,
    notifications: Object.assign({}, defaults.notifications, raw.notifications || {}),
    privacy: Object.assign({}, defaults.privacy, raw.privacy || {}),
    animatedStickers: raw.animatedStickers !== undefined ? !!raw.animatedStickers : defaults.animatedStickers,
    stickerAutoplay: raw.stickerAutoplay !== undefined ? !!raw.stickerAutoplay : defaults.stickerAutoplay,
    compactMode: raw.compactMode !== undefined ? !!raw.compactMode : defaults.compactMode,
    soundEnabled: raw.soundEnabled !== undefined ? !!raw.soundEnabled : defaults.soundEnabled,
    updatedAt: raw.updatedAt || defaults.updatedAt
  };
  user.settings = next;
  return next;
}

function isPremiumPlanActive(plan) {
  if (!plan || String(plan.status || '').toLowerCase() !== 'active') return false;
  if (!plan.expiresAt) return true;
  const exp = new Date(plan.expiresAt);
  return !Number.isNaN(exp.getTime()) && exp.getTime() > Date.now();
}

function syncPremiumDerivedState(user) {
  const defaults = buildDefaultPremiumState();
  if (!user) return defaults;
  const raw = user.premium && typeof user.premium === 'object' ? user.premium : {};
  const userPlan = Object.assign({}, defaults.userPlan, raw.userPlan || {});
  const institutionPlan = Object.assign({}, defaults.institutionPlan, raw.institutionPlan || {});
  const activeUserPlan = isPremiumPlanActive(userPlan);
  const activeInstitutionPlan = isPremiumPlanActive(institutionPlan);
  const now = new Date();
  const shouldResetCredits = activeUserPlan
    && userPlan.aiCreditsLimit > 0
    && (!userPlan.renewedAt || addDays(new Date(userPlan.renewedAt), premiumDurationDays(userPlan.billingCycle)).getTime() <= now.getTime());

  if (shouldResetCredits) {
    userPlan.aiCreditsRemaining = Number(userPlan.aiCreditsLimit || 0);
    userPlan.aiCreditsUsed = 0;
    userPlan.renewedAt = now;
  } else {
    userPlan.aiCreditsRemaining = Math.max(0, Number(userPlan.aiCreditsRemaining || 0));
    userPlan.aiCreditsUsed = Math.max(0, Number(userPlan.aiCreditsUsed || 0));
  }

  const next = {
    userPlan,
    institutionPlan,
    features: {
      websiteGenerator: !!(activeUserPlan && Number(userPlan.maxWebsites || 0) > 0),
      slideGenerator: !!(activeUserPlan && Number(userPlan.maxSlides || 0) > 0),
      animatedStickers: !!activeUserPlan,
      verifiedBadge: !!activeUserPlan
    },
    badgeLabel: activeUserPlan ? 'PREMIUM' : '',
    stickerPackId: activeUserPlan ? (userPlan.stickerPackId || 'premium-core') : '',
    lastCreditResetAt: userPlan.renewedAt || raw.lastCreditResetAt || null
  };
  user.premium = next;
  return next;
}

function serializePremiumPlanCatalog() {
  const annotate = (item) => Object.assign({}, item, {
    yearlyDiscountLabel: item.monthlyPrice > 0 && item.yearlyPrice > 0
      ? `${Math.max(1, Math.round((1 - (item.yearlyPrice / (item.monthlyPrice * 12))) * 100))}% chegirma`
      : '',
    currency: 'UZS'
  });
  return {
    user: PREMIUM_USER_PLAN_CATALOG.map(annotate),
    university: PREMIUM_UNIVERSITY_PLAN_CATALOG.map(annotate)
  };
}

function serializePremiumState(user) {
  const premium = syncPremiumDerivedState(user || {});
  return {
    userPlan: Object.assign({}, premium.userPlan),
    institutionPlan: Object.assign({}, premium.institutionPlan),
    features: Object.assign({}, premium.features),
    badgeLabel: premium.badgeLabel || '',
    stickerPackId: premium.stickerPackId || '',
    active: {
      user: isPremiumPlanActive(premium.userPlan),
      institution: isPremiumPlanActive(premium.institutionPlan)
    }
  };
}

function hasPremiumFeature(user, featureKey) {
  const premium = syncPremiumDerivedState(user || {});
  return !!premium.features?.[featureKey];
}

function effectiveVerifiedFlag(user) {
  return !!(user?.verified || hasPremiumFeature(user, 'verifiedBadge'));
}

async function consumePremiumAiCredits(userId, usageKey) {
  const cost = Number(PREMIUM_AI_COSTS[usageKey] || 0);
  const user = await User.findById(userId);
  if (!user) return { ok: false, error: 'User not found' };
  syncPremiumDerivedState(user);
  if (!hasPremiumFeature(user, usageKey === 'website_generate' ? 'websiteGenerator' : 'slideGenerator')) {
    return { ok: false, code: 'PREMIUM_REQUIRED', error: 'Premium plan required' };
  }
  const credits = Number(user.premium?.userPlan?.aiCreditsRemaining || 0);
  if (cost > credits) {
    return { ok: false, code: 'AI_CREDITS_EXHAUSTED', error: 'AI credits exhausted', creditsRemaining: credits };
  }
  user.premium.userPlan.aiCreditsRemaining = credits - cost;
  user.premium.userPlan.aiCreditsUsed = Number(user.premium.userPlan.aiCreditsUsed || 0) + cost;
  user.premium.userPlan.renewedAt = user.premium.userPlan.renewedAt || new Date();
  user.markModified('premium');
  await user.save({ validateBeforeSave: false });
  return {
    ok: true,
    creditsRemaining: Number(user.premium.userPlan.aiCreditsRemaining || 0),
    creditsUsed: Number(user.premium.userPlan.aiCreditsUsed || 0),
    premium: serializePremiumState(user)
  };
}

async function checkPremiumAiAccess(userId, usageKey) {
  const cost = Number(PREMIUM_AI_COSTS[usageKey] || 0);
  const user = await User.findById(userId).select('verified premium').lean();
  if (!user) return { ok: false, error: 'User not found' };
  const featureKey = usageKey === 'website_generate' ? 'websiteGenerator' : 'slideGenerator';
  if (!hasPremiumFeature(user, featureKey)) {
    return { ok: false, code: 'PREMIUM_REQUIRED', error: 'Premium plan required', redirect: '/payment.html?focus=user' };
  }
  const creditsRemaining = Number(serializePremiumState(user)?.userPlan?.aiCreditsRemaining || 0);
  if (cost > creditsRemaining) {
    return {
      ok: false,
      code: 'AI_CREDITS_EXHAUSTED',
      error: 'AI credits exhausted',
      redirect: '/payment.html?focus=user',
      creditsRemaining
    };
  }
  return { ok: true, creditsRemaining, premium: serializePremiumState(user) };
}

function buildStickerCatalogForUser(user) {
  const premium = syncPremiumDerivedState(user || {});
  const activePlanId = String(premium.userPlan?.planId || '').trim().toLowerCase();
  const allowedPlanIds = new Set();
  if (activePlanId) {
    PREMIUM_USER_PLAN_CATALOG.forEach((plan) => {
      allowedPlanIds.add(String(plan.id || '').toLowerCase());
      if (String(plan.id || '').toLowerCase() === activePlanId) return false;
    });
  }
  return PREMIUM_STICKER_PACKS.map((pack) => {
    const allowed = hasPremiumFeature(user, 'animatedStickers')
      && Array.isArray(pack.minimumUserPlanIds)
      && pack.minimumUserPlanIds.includes(activePlanId);
    return {
      id: pack.id,
      label: pack.label,
      allowed,
      stickers: Array.isArray(pack.stickers) ? pack.stickers.map((item) => Object.assign({}, item)) : []
    };
  });
}

function buildPremiumNotificationPrefsSummary(settings) {
  const safe = ensureUserSettingsState({ settings });
  return safe.notifications;
}

// User Model
const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  nickname: { type: String, default: '' },
  username: { type: String, required: true, unique: true },
  bio: { type: String, default: '' },
  university: { type: String, required: true },
  faculty: { type: String, default: '' },
  studyType: { type: String, required: true, default: 'Kunduzgi' },
  studyGroup: { type: String, required: true },
  phone: { type: String, default: undefined, trim: true },
  email: { type: String, default: undefined, trim: true, lowercase: true },
  password: { type: String, required: true },
  avatar: { type: String, default: 'https://res.cloudinary.com/demo/image/upload/v1692290000/default-avatar.png' },
  coverBanner: { type: String, default: '' },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  lastUsernameChange: { type: Date, default: null },
  socketId: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['online', 'offline', 'away', 'busy'], 
    default: 'offline' 
  },
  lastActive: { type: Date, default: Date.now },
  verified: { type: Boolean, default: false },
  settings: {
    language: { type: String, enum: ['uz', 'en', 'ru'], default: 'uz' },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    notifications: {
      directMessages: { type: Boolean, default: true },
      courseUpdates: { type: Boolean, default: true },
      liveClasses: { type: Boolean, default: true },
      aiProducts: { type: Boolean, default: true },
      billing: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false }
    },
    privacy: {
      showEmail: { type: Boolean, default: false },
      showPhone: { type: Boolean, default: false },
      profileVisibility: { type: String, enum: ['public', 'campus', 'private'], default: 'campus' }
    },
    animatedStickers: { type: Boolean, default: true },
    stickerAutoplay: { type: Boolean, default: true },
    compactMode: { type: Boolean, default: false },
    soundEnabled: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now }
  },
  premium: {
    userPlan: {
      planId: { type: String, default: '' },
      label: { type: String, default: '' },
      scope: { type: String, default: 'user' },
      status: { type: String, enum: ['inactive', 'active', 'expired'], default: 'inactive' },
      billingCycle: { type: String, enum: ['', 'monthly', 'yearly'], default: '' },
      aiCreditsLimit: { type: Number, default: 0 },
      aiCreditsRemaining: { type: Number, default: 0 },
      aiCreditsUsed: { type: Number, default: 0 },
      maxWebsites: { type: Number, default: 0 },
      maxSlides: { type: Number, default: 0 },
      stickerPackId: { type: String, default: '' },
      startedAt: { type: Date, default: null },
      renewedAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null }
    },
    institutionPlan: {
      planId: { type: String, default: '' },
      label: { type: String, default: '' },
      scope: { type: String, default: 'university' },
      status: { type: String, enum: ['inactive', 'active', 'expired'], default: 'inactive' },
      billingCycle: { type: String, enum: ['', 'monthly', 'yearly'], default: '' },
      seatLimit: { type: Number, default: 0 },
      startedAt: { type: Date, default: null },
      renewedAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null }
    },
    features: {
      websiteGenerator: { type: Boolean, default: false },
      slideGenerator: { type: Boolean, default: false },
      animatedStickers: { type: Boolean, default: false },
      verifiedBadge: { type: Boolean, default: false }
    },
    badgeLabel: { type: String, default: '' },
    stickerPackId: { type: String, default: '' },
    lastCreditResetAt: { type: Date, default: null }
  },
  resetPasswordTokenHash: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },

  // ==================== MODERATION FLAGS ====================
  banned: { type: Boolean, default: false },
  banReason: { type: String, default: '' },
  mutedUntil: { type: Date, default: null },
  // ==================== COINS + PET (Robotcha) ====================
isAdmin: { type: Boolean, default: false },
  role: { type: String, enum: ['student','teacher','admin','organizer'], default: 'student' },
  teachingSubject: { type: String, default: '' },
  teachingSubjects: { type: [String], default: [] },
  teacherBalance: { type: Number, default: 0 },
coins: { type: Number, default: 0 },
pet: {
  name: { type: String, default: 'Robotcha' },
  color: { type: String, default: '#6366f1' },          // robot tana rangi
  outfitColor: { type: String, default: '#ec4899' },     // kiyim rangi
  hunger: { type: Number, default: 60 },                 // 0..100
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  lastFedAt: { type: Date, default: null }
},
inventory: {
  foods: [{ id: String, name: String, hungerPlus: Number, qty: { type: Number, default: 0 }, price: Number }],
  paints: [{ id: String, name: String, color: String, qty: { type: Number, default: 0 }, price: Number }],
  outfits: [{ id: String, name: String, color: String, qty: { type: Number, default: 0 }, price: Number }]
},
  // ==================== ROBOT COLLECTION (multi-robot) ====================
  robots: [{
    typeId: { type: String, default: 'starter' },     // catalog id
    name: { type: String, default: 'Robotcha' },
    baseColor: { type: String, default: '#6366f1' },
    outfitColor: { type: String, default: '#ec4899' },
    hunger: { type: Number, default: 60 },
    lastFedAt: { type: Date, default: null },
    cuteness: { type: Number, default: 50 },          // 0..100 (yoqimtoylik)
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    mood: { type: String, default: 'neutral' },       // neutral|happy|sad|thinking
    equipped: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  activeRobotId: { type: String, default: '' },       // robots subdoc _id (string)

  // ==================== COMPANIONS (cute animals) ====================
  companions: [{
    typeId: { type: String, default: '' },  // PET_MARKET.companions id
    name: { type: String, default: '' },
    emoji: { type: String, default: '🐾' },
    rarity: { type: String, default: 'common' },
    moodBoost: { type: Number, default: 0 },
        color: { type: String, default: '' },
    accessoryColor: { type: String, default: '' },
    hunger: { type: Number, default: 70 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    lastFedAt: { type: Date, default: null },
equipped: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  activeCompanionId: { type: String, default: '' },   // companions subdoc _id (string)
  petScene: {
    robotMotion: { type: String, default: 'float' },      // float|dance|guard|spin|hop
    companionMotion: { type: String, default: 'hop' },    // hop|orbit|pulse|idle
    stageTheme: { type: String, default: 'aurora' },      // aurora|night|sunset|mint
    robotFx: { type: String, default: 'auto' },           // auto|on|off
    updatedAt: { type: Date, default: Date.now }
  },

  createdAt: { type: Date, default: Date.now }
});
UserSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $exists: true, $type: 'string' } } }
);
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true, $type: 'string' } } }
);
const User = mongoose.model('User', UserSchema);

const AuthSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  userAgent: { type: String, default: '' },
  deviceType: { type: String, default: 'unknown' },
  deviceName: { type: String, default: '' },
  browser: { type: String, default: '' },
  os: { type: String, default: '' },
  ip: { type: String, default: '' },
  locationLabel: { type: String, default: '' },
  createdFrom: { type: String, default: 'http' },
  lastActiveAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
  revokedAt: { type: Date, default: null, index: true },
  revokedReason: { type: String, default: '' }
}, { timestamps: true });
AuthSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: -1 });
const AuthSession = mongoose.models.AuthSession || mongoose.model('AuthSession', AuthSessionSchema);

// ==================== UNIVERSITY / FACULTY CATALOG ====================
const UniversityCatalogSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  faculties: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const UniversityCatalog = mongoose.models.UniversityCatalog || mongoose.model('UniversityCatalog', UniversityCatalogSchema);

// Program Catalog (university/faculty/program list)
const ProgramCatalogSchema = new mongoose.Schema({
  university: { type: String, required: true, index: true, trim: true },
  faculty: { type: String, default: '', index: true, trim: true },
  code: { type: String, default: '', index: true, trim: true },
  name: { type: String, required: true, trim: true }
}, { timestamps: true });

ProgramCatalogSchema.index({ university: 1, faculty: 1, code: 1, name: 1 }, { unique: true });

const ProgramCatalog = mongoose.models.ProgramCatalog || mongoose.model('ProgramCatalog', ProgramCatalogSchema);

// Study Type Catalog (university/faculty/study-type list)
const StudyTypeCatalogSchema = new mongoose.Schema({
  university: { type: String, required: true, index: true, trim: true },
  faculty: { type: String, required: true, index: true, trim: true },
  name: { type: String, required: true, trim: true }
}, { timestamps: true });

StudyTypeCatalogSchema.index({ university: 1, faculty: 1, name: 1 }, { unique: true });

const StudyTypeCatalog = mongoose.models.StudyTypeCatalog || mongoose.model('StudyTypeCatalog', StudyTypeCatalogSchema);

// Study Group Catalog (university/faculty/study-group list)
const StudyGroupCatalogSchema = new mongoose.Schema({
  university: { type: String, required: true, index: true, trim: true },
  faculty: { type: String, required: true, index: true, trim: true },
  studyType: { type: String, required: true, index: true, trim: true, default: 'Kunduzgi' },
  name: { type: String, required: true, trim: true }
}, { timestamps: true });

StudyGroupCatalogSchema.index({ university: 1, faculty: 1, studyType: 1, name: 1 }, { unique: true });

const StudyGroupCatalog = mongoose.models.StudyGroupCatalog || mongoose.model('StudyGroupCatalog', StudyGroupCatalogSchema);

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanText(value, maxLen = 200) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeCaptionLang(value, fallback = 'uz') {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'en' || v.startsWith('en-')) return 'en';
  if (v === 'ru' || v.startsWith('ru-')) return 'ru';
  if (v === 'uz' || v.startsWith('uz-')) return 'uz';
  return String(fallback || 'uz').toLowerCase();
}

const SESSION_ACTIVITY_REFRESH_MS = 2 * 60 * 1000;
const SESSION_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function pickFirstHeader(headers = {}, keys = []) {
  for (const key of keys) {
    const raw = headers?.[key];
    if (Array.isArray(raw)) {
      const found = raw.find(Boolean);
      if (found) return String(found).trim();
      continue;
    }
    if (raw) return String(raw).trim();
  }
  return '';
}

function normalizeIp(raw) {
  let ip = String(raw || '').split(',')[0].trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function getRequestClientIp(req) {
  return normalizeIp(
    pickFirstHeader(req?.headers, [
      'cf-connecting-ip',
      'x-real-ip',
      'x-client-ip',
      'x-forwarded-for'
    ]) ||
    req?.ip ||
    req?.connection?.remoteAddress ||
    req?.socket?.remoteAddress
  );
}

function getSocketClientIp(socket) {
  return normalizeIp(
    pickFirstHeader(socket?.handshake?.headers, [
      'cf-connecting-ip',
      'x-real-ip',
      'x-client-ip',
      'x-forwarded-for'
    ]) ||
    socket?.handshake?.address ||
    socket?.conn?.remoteAddress
  );
}

function parseClientEnvironment(userAgentRaw = '') {
  const ua = String(userAgentRaw || '').trim();
  const lower = ua.toLowerCase();
  let deviceType = 'desktop';
  if (/ipad|tablet|sm-t|tab/i.test(ua)) deviceType = 'tablet';
  else if (/mobile|iphone|ipod|android/i.test(ua)) deviceType = 'mobile';

  let os = 'Unknown OS';
  const androidMatch = ua.match(/Android\s+([\d.]+)/i);
  const iosMatch = ua.match(/OS\s(\d+[_\d]*)\slike Mac OS X/i);
  const windowsMatch = ua.match(/Windows NT\s+([\d.]+)/i);
  const macMatch = ua.match(/Mac OS X\s+([\d_]+)/i);

  if (androidMatch) os = `Android ${androidMatch[1]}`;
  else if (iosMatch) os = `iOS ${iosMatch[1].replace(/_/g, '.')}`;
  else if (windowsMatch) os = `Windows ${windowsMatch[1]}`;
  else if (/macintosh|mac os x/i.test(ua) && macMatch) os = `macOS ${macMatch[1].replace(/_/g, '.')}`;
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/cros/i.test(ua)) os = 'ChromeOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Unknown browser';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = 'Opera';
  else if (/samsungbrowser\//i.test(ua)) browser = 'Samsung Internet';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/chrome\//i.test(ua) || /crios\//i.test(ua)) browser = 'Chrome';
  else if (/safari\//i.test(ua)) browser = 'Safari';

  const typeLabel = deviceType === 'mobile' ? 'Telefon' : deviceType === 'tablet' ? 'Planshet' : 'Kompyuter';
  const deviceName = [typeLabel, browser !== 'Unknown browser' ? browser : '', os !== 'Unknown OS' ? os : '']
    .filter(Boolean)
    .join(' • ');

  return {
    userAgent: cleanText(ua, 320),
    deviceType,
    deviceName: cleanText(deviceName || typeLabel, 120),
    browser: cleanText(browser, 80),
    os: cleanText(os, 80)
  };
}

function inferLocationLabel(headers = {}, fallbackIp = '') {
  const city = cleanText(pickFirstHeader(headers, ['x-vercel-ip-city', 'cf-ipcity', 'x-appengine-city']), 80);
  const region = cleanText(pickFirstHeader(headers, ['x-vercel-ip-country-region', 'cf-region', 'x-appengine-region']), 80);
  const country = cleanText(pickFirstHeader(headers, ['x-vercel-ip-country', 'cf-ipcountry', 'x-appengine-country']), 40).toUpperCase();
  const parts = [city, region, country].filter(Boolean);
  if (parts.length) return parts.join(', ');
  if (fallbackIp) return `IP: ${fallbackIp}`;
  return 'Aniqlanmadi';
}

function maskIp(ipRaw = '') {
  const ip = normalizeIp(ipRaw);
  if (!ip) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  if (ip.includes(':')) {
    return ip.split(':').slice(0, 3).join(':') + ':x:x';
  }
  return ip;
}

function buildAuthSessionMeta({ headers = {}, userAgent = '', ip = '', createdFrom = 'http' } = {}) {
  const env = parseClientEnvironment(userAgent || pickFirstHeader(headers, ['user-agent']));
  const normalizedIp = normalizeIp(ip);
  return {
    ...env,
    ip: normalizedIp,
    locationLabel: inferLocationLabel(headers, normalizedIp),
    createdFrom: cleanText(createdFrom, 40) || 'http'
  };
}

function getTokenExpiryDate(decoded = {}) {
  const expMs = Number(decoded?.exp || 0) * 1000;
  if (expMs > Date.now()) return new Date(expMs);
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function isSessionRefreshDue(session, meta = {}) {
  const lastActiveMs = session?.lastActiveAt ? new Date(session.lastActiveAt).getTime() : 0;
  if (!lastActiveMs || (Date.now() - lastActiveMs) >= SESSION_ACTIVITY_REFRESH_MS) return true;
  return (
    String(session?.ip || '') !== String(meta.ip || '') ||
    String(session?.locationLabel || '') !== String(meta.locationLabel || '') ||
    String(session?.deviceName || '') !== String(meta.deviceName || '')
  );
}

async function ensureActiveAuthSessionForToken({ userId, token, decoded, headers = {}, ip = '', createdFrom = 'http' } = {}) {
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expiresAt = getTokenExpiryDate(decoded);
  const meta = buildAuthSessionMeta({
    headers,
    userAgent: pickFirstHeader(headers, ['user-agent']),
    ip,
    createdFrom
  });

  let session = await AuthSession.findOne({ tokenHash }).lean();
  if (session) {
    if (String(session.userId || '') !== String(userId || '')) {
      return { ok: false, code: 'SESSION_USER_MISMATCH' };
    }
    if (session.revokedAt) return { ok: false, code: 'SESSION_REVOKED', session };
    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      return { ok: false, code: 'SESSION_EXPIRED', session };
    }
    if (isSessionRefreshDue(session, meta)) {
      await AuthSession.updateOne(
        { _id: session._id },
        { $set: { ...meta, expiresAt, lastActiveAt: now, lastSeenAt: now } }
      );
      session = { ...session, ...meta, expiresAt, lastActiveAt: now, lastSeenAt: now };
    }
    return { ok: true, tokenHash, session };
  }

  try {
    const created = await AuthSession.create({
      userId,
      tokenHash,
      ...meta,
      expiresAt,
      lastActiveAt: now,
      lastSeenAt: now
    });
    return { ok: true, tokenHash, session: created.toObject() };
  } catch (error) {
    if (error?.code === 11000) {
      session = await AuthSession.findOne({ tokenHash }).lean();
      if (session && !session.revokedAt) {
        return { ok: true, tokenHash, session };
      }
    }
    throw error;
  }
}

function formatSessionForClient(session, currentSessionId = '') {
  return {
    id: String(session?._id || ''),
    deviceName: String(session?.deviceName || 'Qurilma'),
    deviceType: String(session?.deviceType || 'unknown'),
    browser: String(session?.browser || ''),
    os: String(session?.os || ''),
    locationLabel: String(session?.locationLabel || 'Aniqlanmadi'),
    ipLabel: maskIp(session?.ip || ''),
    createdFrom: String(session?.createdFrom || 'http'),
    createdAt: session?.createdAt || null,
    updatedAt: session?.updatedAt || null,
    lastActiveAt: session?.lastActiveAt || null,
    lastSeenAt: session?.lastSeenAt || null,
    expiresAt: session?.expiresAt || null,
    revokedAt: session?.revokedAt || null,
    isCurrent: String(session?._id || '') === String(currentSessionId || '')
  };
}

async function pruneExpiredAuthSessions(userId) {
  const threshold = new Date(Date.now() - SESSION_RETENTION_MS);
  const filter = {
    userId,
    $or: [
      { expiresAt: { $lt: new Date() } },
      { revokedAt: { $lt: threshold } }
    ]
  };
  try {
    await AuthSession.deleteMany(filter);
  } catch (error) {
    console.warn('pruneExpiredAuthSessions warning:', error?.message || error);
  }
}

async function findUniversityDocInsensitive(nameRaw) {
  const name = cleanText(nameRaw, 180);
  if (!name) return null;
  return UniversityCatalog.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') }).lean();
}

function pickCanonicalFaculty(uniDoc, facultyRaw) {
  const faculty = cleanText(facultyRaw, 180);
  if (!faculty) return '';
  const list = Array.isArray(uniDoc?.faculties) ? uniDoc.faculties : [];
  const found = list.find((x) => String(x || '').trim().toLowerCase() === faculty.toLowerCase());
  return found ? String(found).trim() : '';
}

async function pickCanonicalStudyType(universityRaw, facultyRaw, studyTypeRaw) {
  const university = cleanText(universityRaw, 180);
  const faculty = cleanText(facultyRaw, 180);
  const studyType = cleanText(studyTypeRaw, 80);
  if (!university || !faculty || !studyType) return '';
  const doc = await StudyTypeCatalog.findOne({
    university,
    faculty,
    name: new RegExp(`^${escapeRegex(studyType)}$`, 'i')
  }).lean();
  return doc ? String(doc.name || '').trim() : '';
}

async function pickCanonicalStudyGroup(universityRaw, facultyRaw, studyTypeRaw, studyGroupRaw) {
  const university = cleanText(universityRaw, 180);
  const faculty = cleanText(facultyRaw, 180);
  const studyType = cleanText(studyTypeRaw, 80);
  const studyGroup = cleanText(studyGroupRaw, 80);
  if (!university || !faculty || !studyType || !studyGroup) return '';
  const doc = await StudyGroupCatalog.findOne({
    university,
    faculty,
    studyType,
    name: new RegExp(`^${escapeRegex(studyGroup)}$`, 'i')
  }).lean();
  return doc ? String(doc.name || '').trim() : '';
}

async function normalizeAcademicIdentity(input = {}, opts = {}) {
  const options = {
    requireUniversity: true,
    requireFaculty: true,
    requireStudyType: true,
    requireStudyGroup: true,
    strictStudyType: true,
    strictStudyGroup: true,
    ...opts
  };

  const universityRaw = cleanText(input.university, 180);
  const facultyRaw = cleanText(input.faculty, 180);
  let studyType = cleanText(input.studyType, 80);
  let studyGroup = cleanText(input.studyGroup, 80);

  if (options.requireUniversity && !universityRaw) {
    return { ok: false, error: 'University required' };
  }
  if (options.requireFaculty && !facultyRaw) {
    return { ok: false, error: 'Faculty required' };
  }
  if (options.requireStudyType && !studyType) {
    return { ok: false, error: 'studyType required' };
  }
  if (options.requireStudyGroup && !studyGroup) {
    return { ok: false, error: 'studyGroup required' };
  }

  let university = universityRaw;
  let faculty = facultyRaw;

  if (universityRaw) {
    const uniDoc = await findUniversityDocInsensitive(universityRaw);
    if (!uniDoc) return { ok: false, error: 'Unknown university. Choose from the list.' };
    university = String(uniDoc.name || '').trim();

    if (facultyRaw) {
      const canonicalFaculty = pickCanonicalFaculty(uniDoc, facultyRaw);
      if (!canonicalFaculty) return { ok: false, error: 'Unknown faculty for selected university' };
      faculty = canonicalFaculty;
    } else if (options.requireFaculty) {
      return { ok: false, error: 'Faculty required' };
    } else {
      faculty = '';
    }
  }

  if (studyType) {
    const canonicalStudyType = await pickCanonicalStudyType(university, faculty, studyType);
    if (!canonicalStudyType && options.strictStudyType) {
      return { ok: false, error: 'Unknown study type for selected university and faculty' };
    }
    studyType = canonicalStudyType || studyType;
  } else if (options.requireStudyType) {
    return { ok: false, error: 'studyType required' };
  }

  if (studyGroup) {
    const canonicalStudyGroup = await pickCanonicalStudyGroup(university, faculty, studyType, studyGroup);
    if (!canonicalStudyGroup && options.strictStudyGroup) {
      return { ok: false, error: 'Unknown study group for selected university, faculty and study type' };
    }
    studyGroup = canonicalStudyGroup || studyGroup;
  } else if (options.requireStudyGroup) {
    return { ok: false, error: 'studyGroup required' };
  }

  return {
    ok: true,
    value: { university, faculty, studyType, studyGroup }
  };
}

async function ensureUserContactIndexes() {
  try {
    // Convert null/empty contact fields to missing fields.
    await User.updateMany({ email: null }, { $unset: { email: 1 } }).catch(() => {});
    await User.updateMany({ email: '' }, { $unset: { email: 1 } }).catch(() => {});
    await User.updateMany({ phone: null }, { $unset: { phone: 1 } }).catch(() => {});
    await User.updateMany({ phone: '' }, { $unset: { phone: 1 } }).catch(() => {});

    const existing = await User.collection.indexes().catch(() => []);

    const ensureIndex = async (field) => {
      const match = (existing || []).find((idx) => idx?.key && idx.key[field] === 1 && Object.keys(idx.key).length === 1);
      const expectedPfe = { [field]: { $exists: true, $type: 'string' } };
      const samePfe = !!match?.partialFilterExpression &&
        JSON.stringify(match.partialFilterExpression) === JSON.stringify(expectedPfe);
      const needsReplace = !match || !match.unique || !samePfe;

      if (match && needsReplace) {
        await User.collection.dropIndex(match.name).catch(() => {});
      }
      if (needsReplace) {
        await User.collection.createIndex(
          { [field]: 1 },
          { name: `${field}_1`, unique: true, partialFilterExpression: expectedPfe }
        );
      }
    };

    await ensureIndex('email');
    await ensureIndex('phone');
  } catch (e) {
    console.warn('ensureUserContactIndexes warning:', e?.message || e);
  }
}


async function ensureDefaultCatalog() {
  // Seed universities + faculties from official sources (see README notes / citations in chat).
  const defaults = [
    {
      name: "Qarshi Davlat Texnika Universiteti",
      faculties: [
        "Transport va qurilish muhandisligi fakulteti",
        "Energetika muhandisligi fakulteti",
        "Neft-gaz va geologiya fakulteti",
        "Raqamli texnologiyalar va sun'iy intellekt fakulteti",
        "Shahrisabz oziq-ovqat muhandisligi fakulteti",
        "Iqtisodiyot va boshqaruv fakulteti",
        "Irrigatsiya muhandisligi fakulteti"
      ]
    },
    {
      name: "Muhammad al-Xorazmiy nomidagi Toshkent Axborot Texnologiyalari Universiteti (TATU)",
      faculties: [
        "Kompyuter injiniringi",
        "Dasturiy injiniring",
        "Kiberxavfsizlik fakulteti",
        "Telekommunikatsiya texnologiyalari fakulteti",
        "Televizion texnologiyalar fakulteti",
        "Radio va mobil aloqa fakulteti",
        "AKT sohasida iqtisodiyot va menejment fakulteti",
        "AKT sohasida kasb ta’limi fakulteti",
        "TATU-BGUIR qo‘shma axborot texnologiyalari fakulteti",
        "Zarafshon fakulteti"
      ]
    },
    {
      name: "Qarshi Davlat Universiteti",
      faculties: [
        "Fizika fakulteti",
        "Matematika va kompyuter ilmlari fakulteti",
        "Kimyo-biologiya fakulteti",
        "Geografiya va agronomiya fakulteti",
        "Tarix fakulteti",
        "Iqtisodiyot fakulteti",
        "Xorijiy tillar fakulteti",
        "Filologiya fakulteti",
        "Pedagogika fakulteti",
        "San’atshunoslik fakulteti",
        "Sport fakulteti",
        "Tibbiyot fakulteti"
      ]
    },
    {
      name: "Sharof Rashidov nomidagi Samarqand Davlat Universiteti (SamDU)",
      faculties: [
        "Geografiya va ekologiya fakulteti",
        "Tarix fakulteti",
        "Psixologiya va ijtimoiy-siyosiy fanlar fakulteti",
        "Intellektual tizimlar va kompyuter texnologiyalari fakulteti",
        "Yuridik fakulteti",
        "Filologiya fakulteti",
        "Matematika fakulteti",
        "Sun’iy intellekt va raqamli texnologiyalar fakulteti"
      ]
    }
  ];

  for (const u of defaults) {
    await UniversityCatalog.updateOne(
      { name: u.name },
      { $setOnInsert: { name: u.name, faculties: u.faculties } },
      { upsert: true }
    );
  }
}

async function ensureDefaultPrograms() {
  // A lightweight seed. Full lists should be maintained via Admin UI/API as they change year to year.
  const upserts = [];

  // Qarshi DU (sample + many): pulled from their "Ta'lim yo'nalishlari" page.
  const qarshiDU = "Qarshi Davlat Universiteti";
  const qarshiPrograms = [
    { code: "60540200", name: "Amaliy matematika" },
    { code: "60540100", name: "Matematika" },
    { code: "60610100", name: "Kompyuter ilmlari va dasturlash texnologiyalari (yo‘nalishlar bo‘yicha)" },
    { code: "60110600", name: "Matematika va informatika" },
    { code: "60530100", name: "Kimyo (turlari bo‘yicha)" },
    { code: "60510100", name: "Biologiya (turlari bo‘yicha)" },
    { code: "60710200", name: "Biotexnologiya (tarmoqlar bo‘yicha)" },
    { code: "60230100", name: "Filologiya va tillarni o‘qitish (ingliz tili)" },
    { code: "60230100", name: "Filologiya va tillarni o‘qitish (nemis tili)" },
    { code: "60230100", name: "Filologiya va tillarni o‘qitish (fransuz tili)" },
    { code: "60220300", name: "Tarix (mamlakatlar va yo‘nalishlar bo‘yicha)" },
    { code: "60310900", name: "Psixologiya (amaliy psixologiya)" },
    { code: "61020200", name: "Mehnat muhofazasi va texnika xavfsizligi (tarmoqlar bo‘yicha)" },
    { code: "60310100", name: "Iqtisodiyot (tarmoqlar va sohalar bo‘yicha)" },
    { code: "60410400", name: "Moliya va moliyaviy texnologiyalar" },
    { code: "60610400", name: "Dasturiy injiniring" },
    { code: "60610100", name: "Axborot tizimlari va texnologiyalari" },
    { code: "60710400", name: "Energetika muhandisligi" }
  ];
  for (const p of qarshiPrograms) upserts.push({ university: qarshiDU, faculty: "", ...p });

  // SamDU: names list from their booklet PDF.
  const samdu = "Sharof Rashidov nomidagi Samarqand Davlat Universiteti (SamDU)";
  const samduPrograms = [
    "Dizayn","Tarix","Arxeologiya","Filologiya va tillarni o‘qitish: o‘zbek tili","Filologiya va tillarni o‘qitish: turk tili",
    "Filologiya va tillarni o‘qitish rus tili","Filologiya va tillarni o‘qitish: tojik tili","Siyosatshunoslik","Psixologiya",
    "Sotsiologiya","Iqtisodiyot","Bank ishi va auditi","Inson resurslarini boshqarish","Yurisprudensiya","Davlat va jamiyat boshqaruvi",
    "Biologiya","Ekologiya va atrof-muhit muhofazasi","Kimyo","Geografiya","Geologiya","Gidrologiya","Fizika","Astronomiya","Matematika",
    "Amaliy matematika","Axborot tizimlari va texnologiyalari","Axborot xavfsizligi","Dasturiy injiniring","Sun’iy intellekt",
    "Kimyoviy muhandisligi","Biotexnologiya","Elektronika va asbobsozlik","Texnologik jarayonlar va ishlab chiqarishni avtomatlashtirish",
    "Mexanika muhandisligi","Geodeziya va geoinformatika","Agrokimyo va agrotuproqshunoslik","Agronomiya","O‘simliklarni himoyasi va karantini",
    "Qishloq xo‘jalik mahsulotlarini saqlash va qayta ishlash texnologiyasi","Agromuhandislik","Fundamental tibbiyot","Farmatsiya (turlari bo‘yicha)",
    "Ijtimoiy ish","Sport faoliyati (Gandbol)","Sport faoliyati (Kurash)"
  ];
  for (const name of samduPrograms) upserts.push({ university: samdu, faculty: "", code: "", name });

  for (const p of upserts) {
    // Normalize to match the UNIQUE index exactly (university, faculty, code, name)
    const uni = String(p.university || '').trim();
    const faculty = String(p.faculty || '').trim();
    const code = String(p.code || '').trim();
    const name = String(p.name || '').trim();

    if (!uni || !name) continue;

    try {
      await ProgramCatalog.updateOne(
        { university: uni, faculty, code, name },
        { $setOnInsert: { university: uni, faculty, code, name } },
        { upsert: true }
      );
    } catch (e) {
      // Ignore duplicates caused by concurrent boots / prior bad seed filters
      if (String(e?.code) === '11000') continue;
      throw e;
    }
  }
}

async function ensureDefaultStudyTypes() {
  const defaults = ['Kunduzgi', 'Kechki', 'Masofaviy'];

  const universities = await UniversityCatalog.find({}).select('name faculties').lean().catch(() => []);
  for (const uni of (universities || [])) {
    const university = cleanText(uni?.name, 180);
    const faculties = Array.isArray(uni?.faculties) ? uni.faculties : [];
    for (const facRaw of faculties) {
      const faculty = cleanText(facRaw, 180);
      if (!university || !faculty) continue;
      for (const name of defaults) {
        await StudyTypeCatalog.updateOne(
          { university, faculty, name },
          { $setOnInsert: { university, faculty, name } },
          { upsert: true }
        );
      }
    }
  }
}

async function ensureDefaultStudyGroups() {
  // Seed minimal study groups and import existing user/group values into catalog.
  const seeds = [
    {
      university: "Qarshi Davlat Texnika Universiteti",
      faculty: "Iqtisodiyot va boshqaruv fakulteti",
      studyType: "Kunduzgi",
      groups: ["MMT-520-25"]
    }
  ];

  await StudyGroupCatalog.updateMany(
    { $or: [{ studyType: { $exists: false } }, { studyType: '' }] },
    { $set: { studyType: 'Kunduzgi' } }
  ).catch(() => {});

  const upsertCanonical = async (universityRaw, facultyRaw, studyTypeRaw, nameRaw) => {
    const universityInput = cleanText(universityRaw, 180);
    const facultyInput = cleanText(facultyRaw, 180);
    const studyTypeInput = cleanText(studyTypeRaw, 80) || 'Kunduzgi';
    const name = cleanText(nameRaw, 80);
    if (!universityInput || !facultyInput || !name) return;

    const uniDoc = await findUniversityDocInsensitive(universityInput);
    if (!uniDoc) return;
    const university = cleanText(uniDoc.name, 180);
    const faculty = pickCanonicalFaculty(uniDoc, facultyInput);
    if (!faculty) return;
    const studyType = await pickCanonicalStudyType(university, faculty, studyTypeInput);
    if (!studyType) return;

    const existing = await StudyGroupCatalog.findOne({
      university,
      faculty,
      studyType,
      name: new RegExp(`^${escapeRegex(name)}$`, 'i')
    }).lean();
    if (existing) return;

    await StudyGroupCatalog.updateOne(
      { university, faculty, studyType, name },
      { $setOnInsert: { university, faculty, studyType, name } },
      { upsert: true }
    );
  };

  for (const seed of seeds) {
    for (const groupName of (seed.groups || [])) {
      await upsertCanonical(seed.university, seed.faculty, seed.studyType, groupName);
    }
  }

  const [userRows, groupRows] = await Promise.all([
    User.find({
      university: { $exists: true, $ne: '' },
      faculty: { $exists: true, $ne: '' },
      studyGroup: { $exists: true, $ne: '' }
    }).select('university faculty studyType studyGroup').lean().limit(20000).catch(() => []),
    Group.find({
      university: { $exists: true, $ne: '' },
      faculty: { $exists: true, $ne: '' },
      studyGroup: { $exists: true, $ne: '' }
    }).select('university faculty studyType studyGroup').lean().limit(20000).catch(() => [])
  ]);

  const merged = [...(userRows || []), ...(groupRows || [])];
  for (const row of merged) {
    await upsertCanonical(row?.university, row?.faculty, row?.studyType, row?.studyGroup);
  }
}

// ==================== NOTIFICATIONS ====================

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, default: 'general', index: true },
  icon: { type: String, default: 'fa-bell' },
  title: { type: String, default: '' },
  body: { type: String, default: '' },
  link: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  read: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now, index: true }
});
NotificationSchema.index({ userId: 1, createdAt: -1 });
const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);

// Support chat (user <-> admin) for chatbot widget
const SupportMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  senderRole: { type: String, enum: ['user', 'admin'], required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required: true, default: '' },
  readByUser: { type: Boolean, default: false, index: true },
  readByAdmin: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now, index: true }
});
SupportMessageSchema.index({ userId: 1, createdAt: -1 });
const SupportMessage = mongoose.models.SupportMessage || mongoose.model('SupportMessage', SupportMessageSchema);


async function findDefaultAdminCandidate() {
  let existing = await User.findOne({ username: DEFAULT_ADMIN_USERNAME });
  if (existing) return existing;
  if (Array.isArray(LEGACY_ADMIN_USERNAMES) && LEGACY_ADMIN_USERNAMES.length > 0) {
    existing = await User.findOne({ username: { $in: LEGACY_ADMIN_USERNAMES } });
    if (existing) return existing;
  }
  return null;
}

async function ensureDefaultAdmin() {
  try {
    const existing = await findDefaultAdminCandidate();
    const hashed = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

    if (!existing) {
      await User.create({
        fullName: 'Administrator',
        nickname: 'Admin',
        username: DEFAULT_ADMIN_USERNAME,
        bio: 'SChat Administrator account',
        university: 'SChat',
        faculty: 'Admin',
        studyType: 'Kunduzgi',
        studyGroup: 'Admin',
        phone: '998000000000', // required & unique
        email: '',
        password: hashed,
        avatar: '',
        isAdmin: true,
        role: 'admin',
        coins: 0
      });
      console.log(`🛡️ Default admin created: ${DEFAULT_ADMIN_USERNAME}`);
      return;
    }

    // Ensure admin flag + password as requested
    const updates = {};
    if (existing.username !== DEFAULT_ADMIN_USERNAME) {
      const usernameTaken = await User.findOne({
        username: DEFAULT_ADMIN_USERNAME,
        _id: { $ne: existing._id }
      }).select('_id').lean();
      if (!usernameTaken) {
        updates.username = DEFAULT_ADMIN_USERNAME;
      } else {
        console.warn(`⚠️ Cannot migrate default admin username to "${DEFAULT_ADMIN_USERNAME}" because it is already used by another account.`);
      }
    }
    if (!existing.isAdmin) updates.isAdmin = true;
    if (existing.role !== 'admin') updates.role = 'admin';
    if (!cleanText(existing.faculty, 180)) updates.faculty = 'Admin';
    if (!cleanText(existing.studyType, 80)) updates.studyType = 'Kunduzgi';
    if (!cleanText(existing.studyGroup, 80)) updates.studyGroup = 'Admin';

    const ok = await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, existing.password).catch(() => false);
    if (!ok) updates.password = hashed;

    if (Object.keys(updates).length) {
      await User.updateOne({ _id: existing._id }, { $set: updates });
      console.log(`🛡️ Default admin ensured: ${DEFAULT_ADMIN_USERNAME} (password synced)`);
    } else {
      console.log(`🛡️ Default admin present: ${DEFAULT_ADMIN_USERNAME}`);
    }
  } catch (e) {
    // If phone unique collision happens, try a different phone once
    if (String(e?.code) === '11000') {
      try {
        const existing = await findDefaultAdminCandidate();
        if (!existing) {
          const hashed = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
          await User.create({
            fullName: 'Administrator',
            nickname: 'Admin',
            username: DEFAULT_ADMIN_USERNAME,
            bio: 'SChat Administrator account',
            university: 'SChat',
            faculty: 'Admin',
            studyType: 'Kunduzgi',
            studyGroup: 'Admin',
            phone: 'admin_phone_' + Date.now(),
            email: '',
            password: hashed,
            avatar: '',
            isAdmin: true,
             role: 'admin',
             coins: 0
           });
          console.log(`🛡️ Default admin created (fallback phone): ${DEFAULT_ADMIN_USERNAME}`);
          return;
        }
      } catch (e2) {
        console.error('❌ ensureDefaultAdmin fallback failed:', e2);
      }
    }
    console.error('❌ ensureDefaultAdmin failed:', e);
  }
}


// Message Model (1v1)
const MessageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '' },
  mediaUrl: { type: String, default: '' },
  mediaType: { type: String, enum: ['image', 'video', 'audio', 'document', 'voice', 'file', 'sticker', ''], default: '' },
  reactions: [{
    emoji: { type: String, required: true },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  }],
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  isRead: { type: Boolean, default: false },
  isDelivered: { type: Boolean, default: false },
  mediaMetadata: {
    fileName: String,
    fileSize: Number,
    mimeType: String,
    duration: String,
    thumbnail: String
  },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// Call History Model
const CallHistorySchema = new mongoose.Schema({
  callerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['audio', 'video'], required: true },
  status: { type: String, enum: ['missed', 'completed', 'rejected', 'cancelled', 'initiated', 'accepted'], required: true },
  duration: { type: Number, default: 0 }, // in seconds
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date }
});
const CallHistory = mongoose.model('CallHistory', CallHistorySchema);

// Group Model
const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  university: { type: String, default: '', index: true },
  faculty: { type: String, default: '', index: true },
  studyType: { type: String, default: 'Kunduzgi', index: true },
  studyGroup: { type: String, default: '', index: true },
  previewImage: { type: String, default: '' },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  avatar: { type: String, default: 'https://res.cloudinary.com/demo/image/upload/v1692290000/default-group.png' },
  createdAt: { type: Date, default: Date.now },
  isPublic: { type: Boolean, default: true }
});
const Group = mongoose.model('Group', GroupSchema);

// Group Message Model
const GroupMessageSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '' },
  mediaUrl: { type: String, default: '' },
  mediaType: { type: String, enum: ['image', 'video', 'audio', 'document', 'voice', 'file', 'sticker', ''], default: '' },
  mediaName: { type: String, default: '' },
  mediaSize: { type: Number, default: 0 },
  mediaMime: { type: String, default: '' },
  reactions: [{
    emoji: { type: String, required: true },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  }],
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
const GroupMessage = mongoose.model('GroupMessage', GroupMessageSchema);

// Coin mission claim log (daily unique claim per mission)
const CoinMissionClaimSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  missionKey: { type: String, required: true, index: true },
  dayKey: { type: String, required: true, index: true }, // YYYY-MM-DD
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
});
CoinMissionClaimSchema.index({ userId: 1, missionKey: 1, dayKey: 1 }, { unique: true });
const CoinMissionClaim = mongoose.models.CoinMissionClaim || mongoose.model('CoinMissionClaim', CoinMissionClaimSchema);

// Game activity log (solo + pvp)
const GameActivitySchema = new mongoose.Schema({
  gameId: { type: String, default: '', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  gameType: { type: String, required: true, index: true }, // tap_rush, guess_number, tic_tac_toe, ...
  mode: { type: String, enum: ['solo', 'pvp'], default: 'solo', index: true },
  scope: { type: String, enum: ['global', 'group', 'duel'], default: 'global', index: true },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null, index: true },
  opponentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  score: { type: Number, default: 0, index: true },
  result: { type: String, enum: ['win', 'lose', 'draw', 'participate'], default: 'participate', index: true },
  coinsAwarded: { type: Number, default: 0 },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
});
GameActivitySchema.index({ userId: 1, createdAt: -1 });
GameActivitySchema.index({ mode: 1, gameType: 1, createdAt: -1 });
const GameActivity = mongoose.models.GameActivity || mongoose.model('GameActivity', GameActivitySchema);


// ==================== GROUP LESSONS (Class Live) ====================
// GroupLesson: one live lesson session inside a Group (teacher live inside a group)
const GroupLessonSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  callId: { type: String, required: true, index: true }, // maps to group callId
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // teacher
  title: { type: String, default: '' },
  mode: { type: String, enum: ['camera','screen'], default: 'camera' },
  status: { type: String, enum: ['live','ended'], default: 'live', index: true },
  startedAt: { type: Date, default: Date.now, index: true },
  endedAt: { type: Date, default: null },
  // recording in Cloudinary (uploaded via server endpoint)
  recordingUrl: { type: String, default: '' },
  recordingPublicId: { type: String, default: '' },
  recordingBytes: { type: Number, default: 0 },
  recordingDurationSec: { type: Number, default: 0 }
}, { timestamps: true });

GroupLessonSchema.index({ groupId: 1, startedAt: -1 });

const GroupLesson = mongoose.models.GroupLesson || mongoose.model('GroupLesson', GroupLessonSchema);

// Chunked upload session for long lesson recordings (resumable + retry-safe).
const GroupLessonUploadSessionSchema = new mongoose.Schema({
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupLesson', required: true, index: true },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: 'video/webm' },
  title: { type: String, default: '' },
  totalBytes: { type: Number, default: 0 },
  uploadedBytes: { type: Number, default: 0 },
  chunkSize: { type: Number, default: 1024 * 1024 },
  tempPath: { type: String, default: '' },
  status: { type: String, enum: ['uploading', 'uploaded', 'processing', 'completed', 'failed'], default: 'uploading', index: true },
  error: { type: String, default: '' },
  recordingUrl: { type: String, default: '' },
  recordingPublicId: { type: String, default: '' },
  recordingBytes: { type: Number, default: 0 },
  recordingDurationSec: { type: Number, default: 0 },
  completedAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });
GroupLessonUploadSessionSchema.index({ lessonId: 1, hostId: 1, status: 1, updatedAt: -1 });
const GroupLessonUploadSession = mongoose.models.GroupLessonUploadSession || mongoose.model('GroupLessonUploadSession', GroupLessonUploadSessionSchema);

async function cleanupStaleRecordingSessions() {
  try {
    const fsx = require('fs');
    const now = Date.now();
    const staleBefore = new Date(now - (48 * 60 * 60 * 1000)); // 48h
    const stale = await GroupLessonUploadSession.find({
      status: { $in: ['uploading', 'uploaded', 'failed'] },
      updatedAt: { $lt: staleBefore }
    }).select('_id tempPath').lean();
    for (const s of stale) {
      const p = String(s?.tempPath || '').trim();
      if (p) {
        try { await fsx.promises.unlink(p); } catch (_) {}
      }
    }
    if (stale.length) {
      await GroupLessonUploadSession.deleteMany({ _id: { $in: stale.map((x) => x._id) } });
    }
  } catch (e) {
    console.warn('cleanupStaleRecordingSessions warn:', e?.message || e);
  }
}

function computeLessonDurationSec(lesson, nowMs = Date.now()) {
  try {
    const startedMs = lesson?.startedAt ? new Date(lesson.startedAt).getTime() : 0;
    const endedMs = lesson?.endedAt ? new Date(lesson.endedAt).getTime() : 0;
    const endPointMs = (endedMs && endedMs > startedMs) ? endedMs : Number(nowMs || Date.now());
    if (!startedMs || endPointMs < startedMs) return 0;
    return Math.max(0, Math.round((endPointMs - startedMs) / 1000));
  } catch (_) {
    return 0;
  }
}

async function closeOpenLessonAttendance(lessonId, opts = {}) {
  try {
    const leftAt = opts.leftAt instanceof Date ? opts.leftAt : new Date();
    const rawUserIds = Array.isArray(opts.userIds) ? opts.userIds.map(String).filter(Boolean) : [];
    const query = { lessonId, leftAt: null };
    if (rawUserIds.length) query.userId = { $in: rawUserIds };
    const atts = await GroupAttendance.find(query).select('_id joinedAt').lean().catch(() => []);
    if (!atts.length) return 0;
    const ops = atts.map((att) => {
      const joinedMs = att?.joinedAt ? new Date(att.joinedAt).getTime() : 0;
      const durationSec = joinedMs ? Math.max(0, Math.round((leftAt.getTime() - joinedMs) / 1000)) : 0;
      return {
        updateOne: {
          filter: { _id: att._id },
          update: { $set: { leftAt, durationSec } }
        }
      };
    });
    await GroupAttendance.bulkWrite(ops, { ordered: false }).catch(() => null);
    return ops.length;
  } catch (_) {
    return 0;
  }
}

async function bestEffortFinalizeLessonRecordingSession(lessonInput, opts = {}) {
  try {
    const lesson = (lessonInput && lessonInput._id)
      ? lessonInput
      : await GroupLesson.findById(String(lessonInput || '')).lean().catch(() => null);
    if (!lesson?._id) return { ok: false, skipped: 'lesson_missing' };

    const latest = await GroupLessonUploadSession.findOne({
      lessonId: lesson._id,
      status: { $in: ['uploading', 'uploaded', 'processing', 'completed', 'failed'] }
    }).sort({ updatedAt: -1 });
    if (!latest) return { ok: false, skipped: 'session_missing' };

    if (String(latest.status || '') === 'completed' && String(latest.recordingUrl || '').trim()) {
      if (!String(lesson.recordingUrl || '').trim()) {
        await GroupLesson.updateOne({ _id: lesson._id }, {
          $set: {
            recordingUrl: String(latest.recordingUrl || ''),
            recordingPublicId: String(latest.recordingPublicId || ''),
            recordingBytes: Number(latest.recordingBytes || 0),
            recordingDurationSec: Math.max(0, Math.round(Number(latest.recordingDurationSec || 0)))
          }
        }).catch(() => null);
      }
      return { ok: true, resumed: true, recordingUrl: String(latest.recordingUrl || '') };
    }

    const tempPath = String(latest.tempPath || '').trim();
    const uploadedBytes = Math.max(0, Number(latest.uploadedBytes || 0));
    if (!tempPath || uploadedBytes < 1) return { ok: false, skipped: 'empty_session' };

    const fsx = require('fs');
    try {
      await fsx.promises.stat(tempPath);
    } catch (_) {
      await GroupLessonUploadSession.updateOne(
        { _id: latest._id },
        { $set: { status: 'failed', error: 'temp file missing', lastSeenAt: new Date() } }
      ).catch(() => null);
      return { ok: false, skipped: 'temp_missing' };
    }

    let session = latest;
    if (String(latest.status || '') !== 'processing') {
      const locked = await GroupLessonUploadSession.findOneAndUpdate(
        { _id: latest._id, status: { $in: ['uploading', 'uploaded', 'failed'] } },
        { $set: { status: 'processing', lastSeenAt: new Date(), error: '' } },
        { new: true }
      ).catch(() => null);
      if (!locked) {
        const fresh = await GroupLessonUploadSession.findById(latest._id).lean().catch(() => null);
        if (String(fresh?.status || '') === 'completed' && String(fresh?.recordingUrl || '').trim()) {
          return { ok: true, resumed: true, recordingUrl: String(fresh.recordingUrl || '') };
        }
        return { ok: false, skipped: 'processing' };
      }
      session = locked;
    }

    const fallbackDurationSec = Math.max(
      0,
      Math.round(Number(
        opts.durationSec
        || session.recordingDurationSec
        || computeLessonDurationSec(lesson)
        || 0
      ))
    );
    const incomingTitle = cleanText(opts.title || session.title || lesson.title, 120);
    const uploadResult = await finalizeLessonRecordingFromPath({
      lesson,
      filePath: tempPath,
      incomingTitle,
      fallbackDurationSec
    });

    session.status = 'completed';
    session.completedAt = new Date();
    session.lastSeenAt = new Date();
    session.recordingUrl = uploadResult.secure_url || uploadResult.url || '';
    session.recordingPublicId = uploadResult.public_id || '';
    session.recordingBytes = uploadResult.bytes || 0;
    session.recordingDurationSec = Math.max(0, Math.round(Number(uploadResult.duration || fallbackDurationSec || 0)));
    await session.save();

    return {
      ok: true,
      recordingUrl: session.recordingUrl,
      durationSec: Number(session.recordingDurationSec || 0),
      resumed: false
    };
  } catch (e) {
    console.warn('bestEffortFinalizeLessonRecordingSession warn:', e?.message || e);
    return { ok: false, skipped: 'finalize_failed', error: String(e?.message || e || 'finalize_failed') };
  }
}

async function endGroupLessonLifecycle(groupId, callId, opts = {}) {
  try {
    const lesson = await GroupLesson.findOne({ groupId, callId }).lean().catch(() => null);
    if (!lesson?._id) return { ok: false, lesson: null };
    const endedAt = opts.endedAt instanceof Date ? opts.endedAt : new Date();

    await GroupLesson.updateOne(
      { _id: lesson._id },
      { $set: { status: 'ended', endedAt } }
    ).catch(() => null);

    await closeOpenLessonAttendance(lesson._id, { leftAt: endedAt, userIds: opts.userIds || [] }).catch(() => null);
    lessonControllers.delete(String(lesson._id));

    const durationSec = computeLessonDurationSec({ startedAt: lesson.startedAt, endedAt });
    const recording = await bestEffortFinalizeLessonRecordingSession(
      { ...lesson, endedAt },
      { durationSec, title: lesson.title }
    );
    return { ok: true, lesson: { ...lesson, endedAt, status: 'ended' }, recording };
  } catch (e) {
    console.warn('endGroupLessonLifecycle warn:', e?.message || e);
    return { ok: false, error: String(e?.message || e || 'lesson_end_failed') };
  }
}

// GroupAttendance: join/leave tracking per lesson
const GroupAttendanceSchema = new mongoose.Schema({
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupLesson', required: true, index: true },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  joinedAt: { type: Date, default: Date.now },
  leftAt: { type: Date, default: null },
  durationSec: { type: Number, default: 0 }
}, { timestamps: true });

GroupAttendanceSchema.index({ lessonId: 1, userId: 1 }, { unique: true });

const GroupAttendance = mongoose.models.GroupAttendance || mongoose.model('GroupAttendance', GroupAttendanceSchema);

async function getUsersBrief(userIds) {
  const ids = (userIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];
  const users = await User.find({ _id: { $in: ids } }).select('fullName username role').lean();
  const map = new Map(users.map(u => [String(u._id), u]));
  return ids.map(id => {
    const u = map.get(id);
    return u ? { userId: String(u._id), fullName: u.fullName, username: u.username, role: u.role } : { userId: id, fullName: 'Unknown', username: '', role: 'student' };
  });
}

async function isGroupMember(groupId, userId) {
  const g = await Group.findById(groupId).select('isPublic members').lean();
  if (!g) return false;
  if (g.isPublic) return true;
  return (g.members || []).some(m => String(m) === String(userId));
}

// Channel Model
const ChannelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subscribers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  moderators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  avatar: { type: String, default: 'https://res.cloudinary.com/demo/image/upload/v1692290000/default-channel.png' },
  category: { type: String, default: 'other' },
  university: { type: String, default: '' },
  isPublic: { type: Boolean, default: true },
  inviteLink: { type: String },
  createdAt: { type: Date, default: Date.now }
});
const Channel = mongoose.model('Channel', ChannelSchema);

// Channel Post Model
const ChannelPostSchema = new mongoose.Schema({
  title: { type: String, default: '' },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  content: { type: String, required: true },
  mediaUrl: { type: String, default: '' },
  mediaType: { type: String, enum: ['image', 'video', 'audio', 'document', ''], default: '' },
  type: { type: String, enum: ['announcement', 'post', 'media'], default: 'post' },
  viewsCount: { type: Number, default: 0 },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now }
});
const ChannelPost = mongoose.model('ChannelPost', ChannelPostSchema);

// Channel Post Comment Model
const ChannelPostCommentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelPost', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const ChannelPostComment = mongoose.model('ChannelPostComment', ChannelPostCommentSchema);


// Stats Model
const StatsSchema = new mongoose.Schema({
  totalUsers: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  totalGroups: { type: Number, default: 0 },
  totalChannels: { type: Number, default: 0 },
  dailyVisits: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now }
});
const Stats = mongoose.model('Stats', StatsSchema);
// ==================== ADMIN AUDIT LOG ====================
// IMPORTANT: Any privileged admin access to private content should be auditable.
// This provides accountability and helps with compliance.
const AdminAuditSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true, index: true }, // e.g. 'PM_LIST','PM_THREAD','PM_DELETE','GROUP_MSG_LIST'
  targetType: { type: String, default: '' },             // 'user','message','group','channel','post'
  targetId: { type: String, default: '' },               // stringified id
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' },
  ua: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});
AdminAuditSchema.index({ adminId: 1, createdAt: -1 });
const AdminAudit = mongoose.models.AdminAudit || mongoose.model('AdminAudit', AdminAuditSchema);

function getReqIp(req){
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
}

async function audit(req, action, targetType='', targetId='', meta={}){
  try{
    if (!req?.adminUser?._id) return;
    await AdminAudit.create({
      adminId: req.adminUser._id,
      action,
      targetType,
      targetId: targetId ? String(targetId) : '',
      meta: meta || {},
      ip: getReqIp(req),
      ua: String(req.headers['user-agent'] || '')
    });
  }catch(e){
    console.warn('admin audit log failed', e?.message || e);
  }
}


// ==================== COIN TOPUP REQUESTS ====================
const TopUpRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  coins: { type: Number, required: true },
  amountSom: { type: Number, required: true }, // 10 coin = 1000 so'm => 1 coin = 100 so'm
  screenshotUrl: { type: String, default: '' }, // local uploads path or cloud url
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
const TopUpRequest = mongoose.model('TopUpRequest', TopUpRequestSchema);

const PremiumPaymentRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  planScope: { type: String, enum: ['user', 'university'], required: true, index: true },
  planId: { type: String, required: true, index: true },
  planLabel: { type: String, default: '' },
  billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true, index: true },
  priceAmount: { type: Number, default: 0 },
  currency: { type: String, default: 'UZS' },
  screenshotUrl: { type: String, default: '' },
  note: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  adminNote: { type: String, default: '' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, index: true }
});
PremiumPaymentRequestSchema.index({ userId: 1, createdAt: -1 });
const PremiumPaymentRequest = mongoose.models.PremiumPaymentRequest || mongoose.model('PremiumPaymentRequest', PremiumPaymentRequestSchema);

async function pushUserNotification(userId, payload = {}) {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) return null;
  const doc = await Notification.create({
    userId: safeUserId,
    type: cleanText(payload.type || 'general', 40) || 'general',
    icon: cleanText(payload.icon || 'fa-bell', 80) || 'fa-bell',
    title: cleanText(payload.title, 140),
    body: cleanText(payload.body, 600),
    link: cleanText(payload.link, 240),
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
    read: false,
    createdAt: new Date()
  });
  try {
    const socketIds = getUserSocketIds(safeUserId);
    socketIds.forEach((sid) => {
      io.to(sid).emit('notification', {
        id: String(doc._id || ''),
        title: doc.title,
        message: doc.body,
        type: doc.type,
        icon: doc.icon,
        link: doc.link,
        timestamp: doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now()
      });
    });
  } catch (_) {}
  return doc;
}

function applyUserPremiumPlanToUserDoc(user, plan, billingCycle) {
  const now = new Date();
  const expiresAt = addDays(now, premiumDurationDays(billingCycle));
  syncPremiumDerivedState(user);
  user.premium.userPlan = {
    planId: String(plan.id || ''),
    label: String(plan.label || ''),
    scope: 'user',
    status: 'active',
    billingCycle: String(billingCycle || 'monthly'),
    aiCreditsLimit: Number(plan.aiCredits || 0),
    aiCreditsRemaining: Number(plan.aiCredits || 0),
    aiCreditsUsed: 0,
    maxWebsites: Number(plan.maxWebsites || 0),
    maxSlides: Number(plan.maxSlides || 0),
    stickerPackId: String(plan.stickerPack || ''),
    startedAt: now,
    renewedAt: now,
    expiresAt
  };
  user.premium.features = {
    websiteGenerator: true,
    slideGenerator: true,
    animatedStickers: true,
    verifiedBadge: true
  };
  user.premium.badgeLabel = 'PREMIUM';
  user.premium.stickerPackId = String(plan.stickerPack || '');
  user.premium.lastCreditResetAt = now;
  user.verified = true;
  user.markModified('premium');
  return user;
}

function applyInstitutionPremiumPlanToUserDoc(user, plan, billingCycle) {
  const now = new Date();
  const expiresAt = addDays(now, premiumDurationDays(billingCycle));
  syncPremiumDerivedState(user);
  user.premium.institutionPlan = {
    planId: String(plan.id || ''),
    label: String(plan.label || ''),
    scope: 'university',
    status: 'active',
    billingCycle: String(billingCycle || 'monthly'),
    seatLimit: Number(plan.seatLimit || 0),
    startedAt: now,
    renewedAt: now,
    expiresAt
  };
  user.markModified('premium');
  return user;
}

// ==================== PET MARKET DEFAULT ITEMS (in-memory) ====================
// Note: Items are stored in code for simplicity. You can move them to DB later.
const PET_MARKET = {
  foods: [
    { id: 'food_noodle', name: "Lag‘mon", hungerPlus: 18, price: 25 },
    { id: 'food_samsa',  name: 'Somsa', hungerPlus: 12, price: 18 },
    { id: 'food_plov',   name: 'Osh (plov)', hungerPlus: 28, price: 40 },
    { id: 'food_salad',  name: 'Salat', hungerPlus: 8, price: 10 }
  ],
  paints: [
    { id: 'paint_indigo',  name: 'Indigo',  color: '#6366f1', price: 55 },
    { id: 'paint_pink',    name: 'Pink',    color: '#ec4899', price: 55 },
    { id: 'paint_emerald', name: 'Emerald', color: '#10b981', price: 55 },
    { id: 'paint_amber',   name: 'Amber',   color: '#f59e0b', price: 55 }
  ],
  outfits: [
    { id: 'outfit_neon',  name: 'Neon kiyim',  color: '#22c55e', price: 75 },
    { id: 'outfit_royal', name: 'Royal kiyim', color: '#a855f7', price: 75 },
    { id: 'outfit_sky',   name: 'Sky kiyim',   color: '#0ea5e9', price: 75 },
    { id: 'outfit_mono',  name: 'Mono kiyim',  color: '#111827', price: 60 }
  ]
,
  companions: [
    { id: 'pet_mochi_cat', name: "Mochi Mushuk", emoji: '🐱', price: 90,  rarity: 'common', moodBoost: 2, desc: 'Yumshoq va do‘stona, profilga yoqimtoy vibe.' },
    { id: 'pet_foxie',     name: 'Foxie Tulki',  emoji: '🦊', price: 140, rarity: 'rare',   moodBoost: 3, desc: 'Chaqqon tulki — o‘yinlarda qiziq reaksiya.' },
    { id: 'pet_panda',     name: 'Mini Panda',   emoji: '🐼', price: 200, rarity: 'epic',   moodBoost: 4, desc: 'Sokin, lekin juda yoqimli.' },
    { id: 'pet_bunny',     name: 'Bunny Hop',    emoji: '🐰', price: 160, rarity: 'rare',   moodBoost: 3, desc: 'Sakrash animatsiyasi bor.' },
    { id: 'pet_owl',       name: 'Donish Owl',   emoji: '🦉', price: 220, rarity: 'epic',   moodBoost: 4, desc: 'O‘ylash holatida bonus beradi.' },
    { id: 'pet_axolotl',   name: 'Axolotl',      emoji: '🦎', price: 260, rarity: 'legend', moodBoost: 5, desc: 'Juda kamyob va chiroyli.' }
  ]
};


// ==================== ROBOT CATALOG (multi-robot shop) ====================
// Yoqimtoylik (cuteness) 0..100: yuqori bo'lsa profil ko'rinishi va o'yin reaksiyalari yoqimliroq bo'ladi.
const ROBOT_CATALOG = [
  { id: 'starter', name: 'Starter Robotcha', price: 0,   baseCuteness: 50, rarity: 'common', desc: 'Boshlang‘ich, oddiy va ishonchli.' },
  { id: 'laser',   name: 'Crimson Laser Bot',  price: 240, baseCuteness: 74, rarity: 'epic',   desc: 'Och qizil, ko‘zidan lazer nur chiqaradi.' },
  { id: 'shade',   name: 'Navy Shades Bot',    price: 260, baseCuteness: 76, rarity: 'epic',   desc: 'To‘q ko‘k, ko‘zoynakli — yechib/taqib animatsiya qiladi.' },
  { id: 'pixel',   name: 'Pixel Buddy',      price: 120, baseCuteness: 65, rarity: 'rare',   desc: 'Retro piksel uslubi, juda yoqimtoy.' },
  { id: 'neo',     name: 'Neo Glass Bot',    price: 180, baseCuteness: 72, rarity: 'rare',   desc: 'Shisha effektli, zamonaviy korpus.' },
  { id: 'astro',   name: 'Astro Rover',      price: 260, baseCuteness: 78, rarity: 'epic',   desc: 'Kosmik kayfiyat, yorqin animatsiya.' },
  { id: 'mochi',   name: 'Mochi Mini',       price: 320, baseCuteness: 85, rarity: 'epic',   desc: 'Kichkina va yumshoq ko‘rinish.' },
  { id: 'lux',     name: 'Lux Companion',    price: 450, baseCuteness: 92, rarity: 'legend', desc: 'Premium — eng yoqimtoy kolleksiya.' },
];

const ROBOT_UPGRADES = {
  // coin narxlari
  polish:  { id: 'polish',  name: 'Shine Polish', price: 35,  cutenessPlus: 3, xpPlus: 2,  desc: 'Korpus yaltiraydi (+yoqimtoylik).' },
  sticker: { id: 'sticker', name: 'Sticker Pack', price: 55,  cutenessPlus: 5, xpPlus: 3,  desc: 'Qiziqarli stikerlar (+yoqimtoylik).' },
  ai:      { id: 'ai',      name: 'AI Upgrade',   price: 85,  cutenessPlus: 2, xpPlus: 10, desc: 'Aqlli bo‘lib qoladi (+XP).' },
  aura:    { id: 'aura',    name: 'Aura Glow',    price: 110, cutenessPlus: 8, xpPlus: 5,  desc: 'Profilga aura effekti qo‘shadi.' },
};

function ensureRobots(user) {
  if (!user.robots) user.robots = [];

  // Legacy pet -> robotga migratsiya (agar robotlar bo‘lmasa)
  if (user.robots.length === 0) {
    const legacy = user.pet || {
      name: 'Robotcha',
      color: '#6366f1',
      outfitColor: '#ec4899',
      hunger: 60,
      xp: 0,
      level: 1,
      lastFedAt: null
    };

    const starter = {
      typeId: 'starter',
      name: legacy.name || 'Robotcha',
      baseColor: legacy.color || '#6366f1',
      outfitColor: legacy.outfitColor || '#ec4899',
      hunger: Number.isFinite(legacy.hunger) ? legacy.hunger : 60,
      lastFedAt: legacy.lastFedAt || null,
      cuteness: 50,
      level: Number.isFinite(legacy.level) ? legacy.level : 1,
      xp: Number.isFinite(legacy.xp) ? legacy.xp : 0,
      mood: 'neutral',
      equipped: true,
      createdAt: new Date()
    };

    user.robots.push(starter);

    // Mongoose subdocument bo‘lsa _id shu zahoti paydo bo‘ladi.
    // Bo‘lmasa, fallback: birinchi robotni equipped qilib qo‘yamiz, activeRobotId ni keyin saqlaganda set qilamiz.
    const firstId = user.robots[0]?._id ? String(user.robots[0]._id) : null;
    user.activeRobotId = firstId || user.activeRobotId || null;

    user.robots.forEach((r, idx) => {
      r.equipped = firstId ? (String(r._id) === String(user.activeRobotId)) : (idx === 0);
    });
  }

  // activeRobotId yo‘q bo‘lsa, birinchisini equip qilamiz
  if (!user.activeRobotId && user.robots[0]?._id) {
    user.activeRobotId = String(user.robots[0]._id);
  }
  if (user.robots.length > 0) {
    user.robots.forEach((r, idx) => {
      if (user.activeRobotId && r._id) r.equipped = (String(r._id) === String(user.activeRobotId));
      else r.equipped = (idx === 0);
    });
  }

  // user.pet bilan sync (faqat ko'rinish va progress)
  const active =
    user.robots.find(r => r._id && user.activeRobotId && String(r._id) === String(user.activeRobotId)) ||
    user.robots.find(r => r.equipped) ||
    user.robots[0];

  if (!user.pet) user.pet = { name: 'Robotcha', color: '#6366f1', outfitColor: '#ec4899', hunger: 60, xp: 0, level: 1, lastFedAt: null };

  if (active) {
    user.pet.name = active.name;
    user.pet.color = active.baseColor;
    user.pet.outfitColor = active.outfitColor;
    user.pet.hunger = Number.isFinite(active.hunger) ? active.hunger : (user.pet.hunger ?? 60);
    user.pet.lastFedAt = active.lastFedAt ?? user.pet.lastFedAt ?? null;
    user.pet.xp = Number.isFinite(active.xp) ? active.xp : (user.pet.xp ?? 0);
    user.pet.level = Number.isFinite(active.level) ? active.level : (user.pet.level ?? 1);
  }
}

function findMarketItem(itemId) {
  const id = (itemId ?? '').toString().trim();
  if (!id) return null;

  for (const k of ['foods', 'paints', 'outfits', 'companions']) {
    const arr = (PET_MARKET && PET_MARKET[k]) ? PET_MARKET[k] : [];
    const item = arr.find(x => x && x.id === id);
    if (item) return { type: k, item };
  }
  return null;
}


function ensureCompanions(user) {
  user.companions = user.companions || [];
  if (user.companions.length === 0) return;

  let active = null;
  if (user.activeCompanionId) {
    active = user.companions.find(c => c._id && String(c._id) === String(user.activeCompanionId)) || null;
  }
  if (!active) active = user.companions.find(c => c.equipped) || user.companions[0];

  user.companions.forEach(c => {
    c.equipped = !!(active && c._id && active._id && String(c._id) === String(active._id));
  });
  if (active && active._id) user.activeCompanionId = String(active._id);
}

function ensureInventoryArrays(user) {
  if (!user.inventory) user.inventory = { foods: [], paints: [], outfits: [] };
  user.inventory.foods = user.inventory.foods || [];
  user.inventory.paints = user.inventory.paints || [];
  user.inventory.outfits = user.inventory.outfits || [];
}

function invAdd(arr, item, extraFields = {}) {
  const i = arr.findIndex(x => x.id === item.id);
  if (i === -1) arr.push({ ...item, ...extraFields, qty: 1 });
  else arr[i].qty = (arr[i].qty || 0) + 1;
}

function invConsume(arr, id) {
  const i = arr.findIndex(x => x.id === id);
  if (i === -1) return false;
  if ((arr[i].qty || 0) <= 0) return false;
  arr[i].qty -= 1;
  return true;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function normalizePetScene(raw = {}) {
  const allowedRobotMotion = new Set(['float', 'dance', 'guard', 'spin', 'hop']);
  const allowedCompanionMotion = new Set(['hop', 'orbit', 'pulse', 'idle']);
  const allowedStageTheme = new Set(['aurora', 'night', 'sunset', 'mint']);
  const allowedRobotFx = new Set(['auto', 'on', 'off']);

  const robotMotion = String(raw.robotMotion || '').trim().toLowerCase();
  const companionMotion = String(raw.companionMotion || '').trim().toLowerCase();
  const stageTheme = String(raw.stageTheme || '').trim().toLowerCase();
  const robotFx = String(raw.robotFx || '').trim().toLowerCase();

  return {
    robotMotion: allowedRobotMotion.has(robotMotion) ? robotMotion : 'float',
    companionMotion: allowedCompanionMotion.has(companionMotion) ? companionMotion : 'hop',
    stageTheme: allowedStageTheme.has(stageTheme) ? stageTheme : 'aurora',
    robotFx: allowedRobotFx.has(robotFx) ? robotFx : 'auto',
    updatedAt: new Date()
  };
}

// Initialize Stats
async function initializeStats() {
  const stats = await Stats.findOne();
  if (!stats) {
    await Stats.create({});
  }
}

// ==================== AUTHENTICATION MIDDLEWARE ====================
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.authToken = token;
    req.authTokenHash = sha256Hex(token);

    // Moderation gate: deny banned accounts and mark muted accounts.
    // NOTE: This adds 1 lightweight DB read per authenticated request.
    const u = await User.findById(req.userId).select('banned banReason mutedUntil').lean();
    if (!u) return res.status(401).json({ error: 'User not found' });

    if (u.banned) {
      return res.status(403).json({
        error: 'Account is banned',
        code: 'BANNED',
        reason: u.banReason || ''
      });
    }

    const mu = u.mutedUntil ? new Date(u.mutedUntil).getTime() : 0;
    req.mutedUntil = u.mutedUntil || null;
    req.isMuted = !!(mu && mu > Date.now());

    const sessionState = await ensureActiveAuthSessionForToken({
      userId: req.userId,
      token,
      decoded,
      headers: req.headers || {},
      ip: getRequestClientIp(req),
      createdFrom: 'http'
    });
    if (!sessionState?.ok || !sessionState?.session?._id) {
      return res.status(401).json({
        error: sessionState?.code === 'SESSION_REVOKED' ? 'Session revoked' : 'Session expired',
        code: sessionState?.code || 'SESSION_INVALID',
        action: 'LOGIN_REQUIRED'
      });
    }
    req.authSessionId = String(sessionState.session._id);
    req.authSession = sessionState.session;

    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};


// ==================== ROLE MIDDLEWARE (LMS) ====================
// attachUserRole: loads user's role from DB and sets req.userRole
async function attachUserRole(req, res, next) {
  try {
    const u = await User.findById(req.userId).select('role isAdmin');
    req.userRole = (u?.role || (u?.isAdmin ? 'admin' : 'student') || 'student').toLowerCase();
  } catch (e) {
    req.userRole = 'student';
  }
  next();
}

// requireRole: checks req.userRole (must be set by attachUserRole)
function requireRole(roles = []) {
  return function (req, res, next) {
    try {
      const role = (req.userRole || '').toLowerCase();
      if (!roles.length) return next();
      if (roles.includes(role)) return next();
      return res.status(403).json({ error: 'Forbidden' });
    } catch (e) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  };
}





// ==================== MODERATION HELPERS ====================
function denyIfMuted(req, res) {
  try {
    if (req.isMuted) {
      return res.status(403).json({
        error: 'Muted',
        code: 'MUTED',
        mutedUntil: req.mutedUntil
      });
    }
  } catch (_) {}
  return null;
}

// ==================== CAPTION TRANSLATE API ====================
const captionTranslateCache = new Map();

app.post('/api/translate/caption', authenticateToken, async (req, res) => {
  try {
    const text = cleanText(req.body?.text, 320);
    if (!text) return res.status(400).json({ error: 'text required' });

    const targetLang = normalizeCaptionLang(req.body?.targetLang, 'uz');
    const sourceLangRaw = String(req.body?.sourceLang || 'auto').trim().toLowerCase();
    const sourceLang = (sourceLangRaw === 'auto') ? 'auto' : normalizeCaptionLang(sourceLangRaw, 'uz');

    if (sourceLang !== 'auto' && sourceLang === targetLang) {
      return res.json({ ok: true, translatedText: text, sourceLang, targetLang, cached: true });
    }

    const key = `${sourceLang}|${targetLang}|${text}`;
    if (captionTranslateCache.has(key)) {
      return res.json({
        ok: true,
        translatedText: String(captionTranslateCache.get(key) || text),
        sourceLang,
        targetLang,
        cached: true
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let translated = text;
    try {
      const u = new URL('https://translate.googleapis.com/translate_a/single');
      u.searchParams.set('client', 'gtx');
      u.searchParams.set('sl', sourceLang || 'auto');
      u.searchParams.set('tl', targetLang);
      u.searchParams.set('dt', 't');
      u.searchParams.set('q', text);
      const r = await fetch(u.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Accept': 'application/json,text/plain,*/*' }
      });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data?.[0])) {
          translated = data[0]
            .map((row) => Array.isArray(row) ? String(row[0] || '') : '')
            .join('')
            .trim() || text;
        }
      }
    } catch (_) {
      translated = text;
    } finally {
      clearTimeout(timer);
    }

    captionTranslateCache.set(key, translated);
    if (captionTranslateCache.size > 1200) {
      const first = captionTranslateCache.keys().next().value;
      if (first) captionTranslateCache.delete(first);
    }

    return res.json({
      ok: true,
      translatedText: translated,
      sourceLang,
      targetLang
    });
  } catch (e) {
    console.error('POST /api/translate/caption error:', e);
    return res.status(500).json({ error: 'Failed to translate caption' });
  }
});

// ==================== GLOBAL ASSISTANT AI API ====================
const assistantAiRateBuckets = new Map(); // key -> [timestamps]
const ASSISTANT_AI_RATE_WINDOW_MS = Math.max(10_000, Number(process.env.AI_RATE_WINDOW_MS || 10 * 60 * 1000));
const ASSISTANT_AI_RATE_MAX = Math.max(3, Number(process.env.AI_RATE_MAX || 30));

function takeAssistantAiRateSlot(key) {
  const k = String(key || '').trim() || 'anon';
  const now = Date.now();
  const from = now - ASSISTANT_AI_RATE_WINDOW_MS;
  const arr = (assistantAiRateBuckets.get(k) || []).filter((t) => Number(t || 0) >= from);
  if (arr.length >= ASSISTANT_AI_RATE_MAX) {
    const oldest = Number(arr[0] || now);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + ASSISTANT_AI_RATE_WINDOW_MS - now) / 1000));
    assistantAiRateBuckets.set(k, arr);
    return { ok: false, retryAfterSec };
  }
  arr.push(now);
  assistantAiRateBuckets.set(k, arr);
  return { ok: true, retryAfterSec: 0 };
}

function normalizeAssistantMode(v) {
  return String(v || '').trim().toLowerCase() === 'lab' ? 'lab' : 'bot';
}

function normalizeAssistantHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => {
      const role = String(row?.role || '').trim().toLowerCase();
      const content = cleanText(row?.content, 1200);
      if (!content) return null;
      if (role !== 'user' && role !== 'assistant') return null;
      return { role, content };
    })
    .filter(Boolean)
    .slice(-12);
}

function normalizeAssistantContext(raw) {
  const c = (raw && typeof raw === 'object') ? raw : {};
  return {
    subject: cleanText(c.subject, 120),
    callActive: !!c.callActive,
    science: !!c.science,
    labType: cleanText(c.labType, 64)
  };
}

function buildAssistantSystemPrompt({ mode, user, context }) {
  const role = String(user?.role || 'student').toLowerCase();
  const fullName = cleanText(user?.fullName || user?.nickname || user?.username || 'foydalanuvchi', 80);
  const university = cleanText(user?.university, 90);
  const faculty = cleanText(user?.faculty, 90);
  const studyType = cleanText(user?.studyType, 60);
  const studyGroup = cleanText(user?.studyGroup, 90);
  const subject = cleanText(context?.subject, 120);
  const labType = cleanText(context?.labType, 60);

  const base = [
    'You are HALLAYM global assistant for an education app.',
    'Primary language: Uzbek (latin).',
    'If user asks in another language, answer in that language.',
    'Be concise, practical, and actionable.',
    'Avoid unsafe/illegal instructions.',
    'If uncertain, say uncertainty clearly instead of hallucinating.'
  ];

  const profile = [
    `User: ${fullName}.`,
    `Role: ${role}.`,
    university ? `University: ${university}.` : '',
    faculty ? `Faculty: ${faculty}.` : '',
    studyType ? `Study type: ${studyType}.` : '',
    studyGroup ? `Study group: ${studyGroup}.` : ''
  ].filter(Boolean);

  if (mode === 'lab') {
    const labRules = [
      'Mode: LAB assistant.',
      'Give short experiment guidance, safety-first checklist, and result interpretation hints.',
      'Prefer step-by-step instructions (3-7 steps).',
      'Use simple formulas only when needed.',
      'If context is not science, suggest how to switch to relevant lab activity.'
    ];
    const labCtx = [
      subject ? `Current lesson subject: ${subject}.` : '',
      labType ? `Lab type: ${labType}.` : '',
      `Live call active: ${context?.callActive ? 'yes' : 'no'}.`,
      `Science context detected: ${context?.science ? 'yes' : 'no'}.`
    ].filter(Boolean);
    return base.concat(profile, labRules, labCtx).join('\n');
  }

  const botRules = [
    'Mode: GENERAL assistant.',
    'Help with platform usage, study planning, quick troubleshooting, and clear next steps.',
    'Prefer short bullets when useful.',
    'When user asks technical/site issue, include quick diagnostics.'
  ];
  return base.concat(profile, botRules).join('\n');
}

async function requestOpenAiCompatibleChat({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  history,
  userMessage,
  extraHeaders = {},
  temperature = 0.4,
  maxTokens = 600,
  responseFormat = null
}) {
  const root = String(baseUrl || '').replace(/\/+$/g, '');
  if (!root || !apiKey || !model) throw new Error('openai-compatible config missing');

  const url = `${root}/chat/completions`;
  const messages = [{ role: 'system', content: systemPrompt }]
    .concat(history || [])
    .concat([{ role: 'user', content: userMessage }]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }, extraHeaders || {}),
      body: JSON.stringify(Object.assign({
        model,
        messages,
        temperature,
        max_tokens: maxTokens
      }, responseFormat ? { response_format: responseFormat } : {}))
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = cleanText(data?.error?.message || data?.message || `HTTP ${r.status}`, 280);
      throw new Error(detail || `HTTP ${r.status}`);
    }
    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!content) throw new Error('Empty AI response');
    return { data, content };
  } finally {
    clearTimeout(timer);
  }
}

async function requestOpenAiCompatibleAnswer({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  history,
  userMessage,
  extraHeaders = {},
  temperature = 0.4,
  maxTokens = 600
}) {
  const { content } = await requestOpenAiCompatibleChat({
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    history,
    userMessage,
    extraHeaders,
    temperature,
    maxTokens
  });
  const answer = cleanText(content, 4000);
  if (!answer) throw new Error('Empty AI response');
  return answer;
}

async function requestGeminiAnswer({ apiKey, model, systemPrompt, history, userMessage }) {
  if (!apiKey || !model) throw new Error('gemini config missing');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents = [];
  (history || []).forEach((m) => {
    const role = String(m?.role || '') === 'assistant' ? 'model' : 'user';
    const text = cleanText(m?.content, 1200);
    if (!text) return;
    contents.push({ role, parts: [{ text }] });
  });
  contents.push({ role: 'user', parts: [{ text: cleanText(userMessage, 1500) }] });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
        contents
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = cleanText(data?.error?.message || data?.message || `HTTP ${r.status}`, 280);
      throw new Error(detail || `HTTP ${r.status}`);
    }
    const parts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
    const answer = cleanText(parts.map((p) => String(p?.text || '')).join(' ').trim(), 4000);
    if (!answer) throw new Error('Empty AI response');
    return answer;
  } finally {
    clearTimeout(timer);
  }
}

async function generateAssistantAiAnswer({ systemPrompt, history, userMessage, req }) {
  const providerPref = String(process.env.AI_PROVIDER || 'auto').trim().toLowerCase();
  const order = providerPref === 'auto'
    ? ['gemini', 'groq', 'openrouter', 'custom']
    : [providerPref];

  let lastErr = '';
  for (const provider of order) {
    try {
      if (provider === 'gemini') {
        const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
        const model = String(process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
        if (!apiKey) throw new Error('GEMINI_API_KEY missing');
        const answer = await requestGeminiAnswer({ apiKey, model, systemPrompt, history, userMessage });
        return { answer, provider: 'gemini', model };
      }

      if (provider === 'groq') {
        const apiKey = String(process.env.GROQ_API_KEY || '').trim();
        const model = String(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
        if (!apiKey) throw new Error('GROQ_API_KEY missing');
        const answer = await requestOpenAiCompatibleAnswer({
          baseUrl: 'https://api.groq.com/openai/v1',
          apiKey,
          model,
          systemPrompt,
          history,
          userMessage
        });
        return { answer, provider: 'groq', model };
      }

      if (provider === 'openrouter') {
        const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
        const model = String(process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free').trim();
        if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');
        const appUrl = String(process.env.PUBLIC_APP_URL || process.env.APP_URL || req?.headers?.origin || '').trim();
        const answer = await requestOpenAiCompatibleAnswer({
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey,
          model,
          systemPrompt,
          history,
          userMessage,
          extraHeaders: Object.assign(
            { 'X-Title': 'SCHAT Global Assistant' },
            appUrl ? { 'HTTP-Referer': appUrl } : {}
          )
        });
        return { answer, provider: 'openrouter', model };
      }

      if (provider === 'custom') {
        const apiKey = String(process.env.AI_API_KEY || '').trim();
        const baseUrl = String(process.env.AI_BASE_URL || '').trim();
        const model = String(process.env.AI_MODEL || '').trim();
        if (!apiKey || !baseUrl || !model) throw new Error('AI_API_KEY/AI_BASE_URL/AI_MODEL missing');
        const answer = await requestOpenAiCompatibleAnswer({
          baseUrl,
          apiKey,
          model,
          systemPrompt,
          history,
          userMessage
        });
        return { answer, provider: 'custom', model };
      }

      throw new Error(`Unknown AI_PROVIDER: ${provider}`);
    } catch (e) {
      lastErr = String(e?.message || e || 'provider error');
      console.warn(`assistant ai provider failed (${provider}):`, lastErr);
    }
  }
  throw new Error(lastErr || 'No AI provider configured');
}

const slideAiRateBuckets = new Map();
const SLIDE_AI_RATE_WINDOW_MS = Math.max(10_000, Number(process.env.SLIDE_AI_RATE_WINDOW_MS || 10 * 60 * 1000));
const SLIDE_AI_RATE_MAX = Math.max(2, Number(process.env.SLIDE_AI_RATE_MAX || 12));
const SLIDE_LAYOUTS = ['cover', 'agenda', 'content', 'split', 'quote', 'timeline', 'metrics', 'closing'];
const SLIDE_THEME_PRESETS = [
  { id: 'teal-minimal', label: 'Teal Minimal', mood: 'bright, premium, clean, official', tones: ['cool', 'fresh'], swatches: ['#0F8F83', '#D8ECE8', '#FBFFFE'] },
  { id: 'executive-white', label: 'Executive White', mood: 'formal, boardroom, minimalist', tones: ['neutral', 'cool'], swatches: ['#0A6F66', '#203D3B', '#FFFFFF'] },
  { id: 'midnight-teal', label: 'Midnight Teal', mood: 'dark, premium, high contrast', tones: ['dark', 'cool'], swatches: ['#77D0C4', '#102D30', '#081C1E'] },
  { id: 'blueprint-grid', label: 'Blueprint Grid', mood: 'academic, technical, structured', tones: ['cool', 'royal'], swatches: ['#126D82', '#EFF8F7', '#1B3D3A'] },
  { id: 'editorial-warm', label: 'Editorial Warm', mood: 'storytelling, elegant, warm editorial', tones: ['warm', 'neutral'], swatches: ['#B76B3A', '#FCFAF6', '#3F3B34'] },
  { id: 'campus-card', label: 'Campus Card', mood: 'friendly, student-focused, modern cards', tones: ['fresh', 'cool'], swatches: ['#149F92', '#F5FBFA', '#122826'] },
  { id: 'heritage-royal', label: 'Heritage Royal', mood: 'historical, ceremonial, navy and gold', tones: ['royal', 'neutral'], swatches: ['#C79A3B', '#1D2F52', '#F7F0E1'] },
  { id: 'forest-emerald', label: 'Forest Emerald', mood: 'nature, health, eco, calm', tones: ['fresh', 'earth'], swatches: ['#2F8F6B', '#F3FAF6', '#153E33'] },
  { id: 'sunset-signal', label: 'Sunset Signal', mood: 'energetic, bold, marketing-ready', tones: ['warm', 'vibrant'], swatches: ['#E46A3A', '#FFF7EF', '#5A2418'] },
  { id: 'berry-luxe', label: 'Berry Luxe', mood: 'creative, cultural, elegant plum', tones: ['warm', 'royal'], swatches: ['#A14C7A', '#FCF4F8', '#402236'] },
  { id: 'graphite-coral', label: 'Graphite Coral', mood: 'strategy, product, dark neutral with coral', tones: ['dark', 'neutral'], swatches: ['#F06B5D', '#1C232B', '#F6EDEA'] }
];
const SLIDE_THEME_MAP = new Map(SLIDE_THEME_PRESETS.map((item) => [item.id, item]));
const SLIDE_COLOR_MOODS = new Set(['auto', 'cool', 'warm', 'dark', 'royal', 'fresh', 'earth', 'vibrant', 'neutral']);
const SLIDE_GENERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deck_title: { type: 'string' },
    deck_subtitle: { type: 'string' },
    summary: { type: 'string' },
    theme_id: { type: 'string', enum: SLIDE_THEME_PRESETS.map((item) => item.id) },
    theme_label: { type: 'string' },
    slides: {
      type: 'array',
      minItems: 4,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          layout: { type: 'string', enum: SLIDE_LAYOUTS },
          kicker: { type: 'string' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          body: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          left_title: { type: 'string' },
          left_bullets: { type: 'array', items: { type: 'string' } },
          right_title: { type: 'string' },
          right_bullets: { type: 'array', items: { type: 'string' } },
          stats: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string' },
                value: { type: 'string' }
              },
              required: ['label', 'value']
            }
          },
          timeline: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                detail: { type: 'string' }
              },
              required: ['title', 'detail']
            }
          },
          quote: { type: 'string' },
          quote_author: { type: 'string' },
          image_url: { type: 'string' },
          image_caption: { type: 'string' },
          source_links: { type: 'array', items: { type: 'string' } },
          callout: { type: 'string' },
          speaker_note: { type: 'string' }
        },
        required: [
          'layout',
          'kicker',
          'title',
          'subtitle',
          'body',
          'bullets',
          'left_title',
          'left_bullets',
          'right_title',
          'right_bullets',
          'stats',
          'timeline',
          'quote',
          'quote_author',
          'image_url',
          'image_caption',
          'source_links',
          'callout',
          'speaker_note'
        ]
      }
    }
  },
  required: ['deck_title', 'deck_subtitle', 'summary', 'theme_id', 'theme_label', 'slides']
};

function takeSlideAiRateSlot(key) {
  const k = String(key || '').trim() || 'anon';
  const now = Date.now();
  const from = now - SLIDE_AI_RATE_WINDOW_MS;
  const arr = (slideAiRateBuckets.get(k) || []).filter((t) => Number(t || 0) >= from);
  if (arr.length >= SLIDE_AI_RATE_MAX) {
    const oldest = Number(arr[0] || now);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + SLIDE_AI_RATE_WINDOW_MS - now) / 1000));
    slideAiRateBuckets.set(k, arr);
    return { ok: false, retryAfterSec };
  }
  arr.push(now);
  slideAiRateBuckets.set(k, arr);
  return { ok: true, retryAfterSec: 0 };
}

function clampSlideCount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 6;
  return Math.max(4, Math.min(12, Math.round(n)));
}

function normalizeSlideStudioLanguage(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'en' || v === 'english') return 'en';
  if (v === 'ru' || v === 'russian') return 'ru';
  return 'uz';
}

function normalizeSlideColorMood(value) {
  const v = String(value || '').trim().toLowerCase();
  return SLIDE_COLOR_MOODS.has(v) ? v : 'auto';
}

function addSlideThemeScore(scores, themeId, amount) {
  if (!scores.has(themeId)) return;
  scores.set(themeId, Number(scores.get(themeId) || 0) + Number(amount || 0));
}

function pickAutoSlideThemeId({ prompt, research, colorMood }) {
  const tone = normalizeSlideColorMood(colorMood);
  const haystack = [
    cleanText(prompt, 500),
    cleanText(research?.query, 200),
    cleanText(research?.title, 200),
    cleanText(research?.summary, 1600)
  ].join(' ').toLowerCase();
  const scores = new Map(SLIDE_THEME_PRESETS.map((item) => [item.id, 0]));

  if (tone !== 'auto') {
    SLIDE_THEME_PRESETS.forEach((theme) => {
      if (Array.isArray(theme?.tones) && theme.tones.includes(tone)) addSlideThemeScore(scores, theme.id, 4);
    });
  }

  const award = (pattern, winners) => {
    if (!pattern.test(haystack)) return;
    winners.forEach(([themeId, points]) => addSlideThemeScore(scores, themeId, points));
  };

  award(/\b(tarix|history|empire|civilization|amir temur|temur|biography|hayoti|legacy|meros|culture|madaniyat|king|queen|dynasty|medieval|samarkand)\b/i, [
    ['heritage-royal', 8],
    ['editorial-warm', 4],
    ['executive-white', 2]
  ]);
  award(/\b(ai|sun['’]?iy intellekt|artificial intelligence|machine learning|technology|texnolog|engineering|physics|mathematics|math|science|robot|software|dasturlash|code|cyber)\b/i, [
    ['blueprint-grid', 8],
    ['graphite-coral', 4],
    ['midnight-teal', 3]
  ]);
  award(/\b(student|education|ta['’]?lim|edu|school|university|kurs|lesson|teacher|o['’]?qituv|campus|academy)\b/i, [
    ['campus-card', 8],
    ['teal-minimal', 4],
    ['executive-white', 2]
  ]);
  award(/\b(health|medicine|medical|biology|eco|ecology|agriculture|nature|tabiat|green|sog['’]?liq|farm|environment)\b/i, [
    ['forest-emerald', 8],
    ['teal-minimal', 3],
    ['editorial-warm', 2]
  ]);
  award(/\b(finance|business|startup|strategy|market|marketing|sales|brand|product|economy|bank|management)\b/i, [
    ['executive-white', 7],
    ['graphite-coral', 5],
    ['sunset-signal', 3]
  ]);
  award(/\b(art|design|fashion|music|literature|adabiyot|media|story|storytelling|creative|san['’]?at|culture)\b/i, [
    ['berry-luxe', 7],
    ['editorial-warm', 6],
    ['sunset-signal', 2]
  ]);
  award(/\b(sport|event|festival|promo|launch|motivation|campaign|energy|concert)\b/i, [
    ['sunset-signal', 8],
    ['graphite-coral', 3],
    ['berry-luxe', 2]
  ]);
  award(/\b(law|policy|government|davlat|politics|legal|administration|public service)\b/i, [
    ['executive-white', 6],
    ['heritage-royal', 4],
    ['blueprint-grid', 2]
  ]);

  const defaultByTone = {
    auto: 'campus-card',
    cool: 'blueprint-grid',
    warm: 'editorial-warm',
    dark: 'graphite-coral',
    royal: 'heritage-royal',
    fresh: 'forest-emerald',
    earth: 'forest-emerald',
    vibrant: 'sunset-signal',
    neutral: 'executive-white'
  };

  let winner = defaultByTone[tone] || 'campus-card';
  let bestScore = Number(scores.get(winner) || 0);
  scores.forEach((score, themeId) => {
    if (score > bestScore) {
      bestScore = score;
      winner = themeId;
    }
  });
  return winner;
}

function resolveSlideThemeId({ styleRequested, prompt, research, colorMood }) {
  return SLIDE_THEME_MAP.has(styleRequested)
    ? styleRequested
    : pickAutoSlideThemeId({ prompt, research, colorMood });
}

const slideTranslateCache = new Map();
const SLIDE_COPY = {
  uz: {
    defaultTopic: 'Mavzu',
    defaultDeckTitle: 'Yangi taqdimot',
    coverCallout: 'Asosiy g‘oya va bu taqdimotdan nima olinishi ko‘rsatiladi.',
    agendaKicker: 'Reja',
    agendaTitle: 'Taqdimot rejasi',
    agendaCallout: 'Har bir slide alohida mantiqiy bo‘limni yoritadi.',
    closingKicker: 'Xulosa',
    closingTitle: 'Yakuniy xulosa',
    closingSubtitle: 'Asosiy xabar',
    closingCallout: 'Taqdimotni yakunlaydigan qisqa va kuchli xabar.',
    coverSubtitleSuffix: 'haqida qisqa kirish',
    splitLeftTitle: 'Asosiy nuqtalar',
    splitRightTitle: 'Davomi',
    nextStep: 'Keyingi qadam',
    sourceLabel: 'Manbalar',
    coverNote: 'Mazmun internet manbalari va HALLAYM AI tahlili asosida yig‘ildi.',
    fallbackSubtitle: 'Mavzu bo‘yicha tushunarli va tayyor taqdimot',
    fallbackDeckSubtitle: 'HALLAYM AI tomonidan tayyorlangan taqdimot',
    fallbackDeckSummary: 'Asosiy mazmun tartibli slide ko‘rinishida jamlandi.',
    fallbackClosingTitle: 'Yakuniy xabar',
    fallbackClosingSubtitle: 'Asosiy g‘oya va keyingi fikr',
    fallbackDraftSubtitle: 'AI servis band bo‘lsa ham ishga tayyor draft',
    fallbackDraftSummary: 'Asosiy mazmunni sodda va ko‘rgazmali qilib bosqichma-bosqich taqdim eting.',
    fallbackAgendaTitle: 'Nimani ko‘rib chiqamiz?',
    fallbackContentTitle: 'Muhim nuqtalar',
    fallbackContentBody: 'Bu yerga mavzu bo‘yicha AI generatsiya qilgan asosiy mazmun joylashadi.',
    fallbackRegenerate: 'Ma’lumotlar kerak bo‘lsa deckni qayta generatsiya qiling.',
    fallbackSpeakerIntro: 'Kirish, maqsad va nimani ko‘rib chiqishingizni ayting.',
    fallbackSpeakerAgenda: 'Tomoshabinga deck strukturasini qisqa ayting.',
    fallbackSpeakerContent: 'Misol yoki dalil bilan tushuntiring.',
    fallbackSpeakerClosing: 'Yakuniy slide auditoriyani keyingi qadamga olib borishi kerak.',
    bodyLeftHint: 'Mazmunni chap tarafda qisqa blok bilan tushuntiring.',
    calloutRightHint: 'Qisqa dalillar, misollar yoki keyingi qadamlar shu yerda turadi.',
    themeDeckLabel: 'HALLAYM AI deck',
    deckSummaryFallback: 'HALLAYM Slide Studio bu deckni presentation-ready ko‘rinishda tayyorladi.',
    agendaHint: 'Ushbu qismni qisqa va aniq tushuntiring.',
    visualLabel: 'Vizual',
    biography: [
      { title: 'Kelib chiqishi va davri', subtitle: 'Shaxsning paydo bo‘lishi va tarixiy fon' },
      { title: 'Yoshlik va shakllanish', subtitle: 'Shakllanish bosqichi va dastlabki ta’sirlar' },
      { title: 'Yuksalish bosqichi', subtitle: 'Burilish nuqtalari va hokimiyatga kelish' },
      { title: 'Asosiy yurishlar va yutuqlar', subtitle: 'Muhim voqealar, yurishlar va natijalar' },
      { title: 'Boshqaruv va ta’sir', subtitle: 'Siyosat, madaniyat va ta’sir doirasi' },
      { title: 'Meros va xotira', subtitle: 'Tarixiy baho va bugungi xotira' }
    ],
    generic: [
      { title: 'Asosiy tushuncha', subtitle: 'Mavzuning mazmuni va mohiyati' },
      { title: 'Qanday ishlaydi', subtitle: 'Jarayon, tamoyil yoki mexanizm' },
      { title: 'Bosqichlar', subtitle: 'Ketma-ket rivojlanish yoki timeline' },
      { title: 'Muhim ko‘rsatkichlar', subtitle: 'Raqamlar, faktlar va ta’sir' },
      { title: 'Misollar va qo‘llanish', subtitle: 'Amaliy ko‘rinish va natijalar' },
      { title: 'Yakuniy xulosa', subtitle: 'Asosiy xabar va eslab qolish kerak bo‘lgan nuqta' }
    ]
  },
  en: {
    defaultTopic: 'Topic',
    defaultDeckTitle: 'New Presentation',
    coverCallout: 'Show the main idea and what the audience will learn.',
    agendaKicker: 'Agenda',
    agendaTitle: 'Presentation Plan',
    agendaCallout: 'Each slide should cover one clear logical section.',
    closingKicker: 'Closing',
    closingTitle: 'Final Takeaway',
    closingSubtitle: 'Core message',
    closingCallout: 'A short, strong final message for the audience.',
    coverSubtitleSuffix: 'quick overview',
    splitLeftTitle: 'Key points',
    splitRightTitle: 'More detail',
    nextStep: 'Next step',
    sourceLabel: 'Sources',
    coverNote: 'Content was assembled from web sources and HALLAYM AI analysis.',
    fallbackSubtitle: 'A clear and presentation-ready overview of the topic',
    fallbackDeckSubtitle: 'A presentation prepared by HALLAYM AI',
    fallbackDeckSummary: 'The main content was organized into a clean slide sequence.',
    fallbackClosingTitle: 'Final message',
    fallbackClosingSubtitle: 'Main idea and next thought',
    fallbackDraftSubtitle: 'A ready draft even when the AI service is busy',
    fallbackDraftSummary: 'Present the main content step by step in a simple and visual way.',
    fallbackAgendaTitle: 'What will we cover?',
    fallbackContentTitle: 'Key points',
    fallbackContentBody: 'The main AI-generated content for the topic appears here.',
    fallbackRegenerate: 'If you need more detail, generate the deck again.',
    fallbackSpeakerIntro: 'Introduce the topic, the goal, and what the audience will see.',
    fallbackSpeakerAgenda: 'Briefly explain the structure of the deck.',
    fallbackSpeakerContent: 'Explain it with an example or a supporting fact.',
    fallbackSpeakerClosing: 'The final slide should lead the audience to a clear next step.',
    bodyLeftHint: 'Explain the idea in a short block on the left.',
    calloutRightHint: 'Put concise facts, examples, or next actions here.',
    themeDeckLabel: 'HALLAYM AI deck',
    deckSummaryFallback: 'HALLAYM Slide Studio prepared this deck in a presentation-ready format.',
    agendaHint: 'Explain this section briefly and clearly.',
    visualLabel: 'Visual',
    biography: [
      { title: 'Origins and Historical Context', subtitle: 'Where the person came from and the setting around them' },
      { title: 'Early Life and Formation', subtitle: 'Formative years and early influences' },
      { title: 'Rise to Power', subtitle: 'Turning points and path to influence' },
      { title: 'Major Campaigns and Achievements', subtitle: 'Key events, victories, and outcomes' },
      { title: 'Leadership and Impact', subtitle: 'Policy, culture, and sphere of influence' },
      { title: 'Legacy and Memory', subtitle: 'Historical assessment and long-term remembrance' }
    ],
    generic: [
      { title: 'Core Idea', subtitle: 'Meaning and scope of the topic' },
      { title: 'How It Works', subtitle: 'Process, mechanism, or principle' },
      { title: 'Stages', subtitle: 'Ordered development or timeline' },
      { title: 'Key Metrics', subtitle: 'Numbers, facts, and impact' },
      { title: 'Examples and Use Cases', subtitle: 'Practical application and outcomes' },
      { title: 'Final Summary', subtitle: 'Main takeaway to remember' }
    ]
  },
  ru: {
    defaultTopic: 'Тема',
    defaultDeckTitle: 'Новая презентация',
    coverCallout: 'Покажите главную идею и то, что аудитория узнает из презентации.',
    agendaKicker: 'План',
    agendaTitle: 'План презентации',
    agendaCallout: 'Каждый слайд должен раскрывать один понятный логический блок.',
    closingKicker: 'Итог',
    closingTitle: 'Главный вывод',
    closingSubtitle: 'Ключевая мысль',
    closingCallout: 'Короткое и сильное финальное сообщение для аудитории.',
    coverSubtitleSuffix: 'краткий обзор',
    splitLeftTitle: 'Ключевые пункты',
    splitRightTitle: 'Детали',
    nextStep: 'Следующий шаг',
    sourceLabel: 'Источники',
    coverNote: 'Содержание собрано из веб-источников и анализа HALLAYM AI.',
    fallbackSubtitle: 'Понятная и готовая к показу презентация по теме',
    fallbackDeckSubtitle: 'Презентация, подготовленная HALLAYM AI',
    fallbackDeckSummary: 'Основное содержание собрано в последовательную структуру слайдов.',
    fallbackClosingTitle: 'Финальное сообщение',
    fallbackClosingSubtitle: 'Главная мысль и следующий акцент',
    fallbackDraftSubtitle: 'Готовый черновик даже если AI-сервис временно занят',
    fallbackDraftSummary: 'Представьте основное содержание просто, наглядно и поэтапно.',
    fallbackAgendaTitle: 'Что мы рассмотрим?',
    fallbackContentTitle: 'Ключевые пункты',
    fallbackContentBody: 'Здесь будет размещено основное содержание, сгенерированное AI по теме.',
    fallbackRegenerate: 'Если нужно больше данных, заново сгенерируйте deck.',
    fallbackSpeakerIntro: 'Кратко обозначьте тему, цель и структуру презентации.',
    fallbackSpeakerAgenda: 'Коротко объясните структуру deck.',
    fallbackSpeakerContent: 'Объясните через пример или подтверждающий факт.',
    fallbackSpeakerClosing: 'Последний слайд должен подвести аудиторию к понятному следующему шагу.',
    bodyLeftHint: 'Кратко объясните идею в левом блоке.',
    calloutRightHint: 'Здесь разместите короткие факты, примеры или дальнейшие шаги.',
    themeDeckLabel: 'deck HALLAYM AI',
    deckSummaryFallback: 'HALLAYM Slide Studio подготовила этот deck в удобном для показа формате.',
    agendaHint: 'Объясните этот раздел кратко и ясно.',
    visualLabel: 'Визуал',
    biography: [
      { title: 'Происхождение и исторический контекст', subtitle: 'Откуда происходит личность и в какой среде она появилась' },
      { title: 'Ранние годы и становление', subtitle: 'Формирующий этап и первые влияния' },
      { title: 'Путь к власти', subtitle: 'Переломные моменты и рост влияния' },
      { title: 'Крупные походы и достижения', subtitle: 'Ключевые события, победы и результаты' },
      { title: 'Управление и влияние', subtitle: 'Политика, культура и масштаб воздействия' },
      { title: 'Наследие и память', subtitle: 'Историческая оценка и современная память' }
    ],
    generic: [
      { title: 'Основная идея', subtitle: 'Смысл и охват темы' },
      { title: 'Как это работает', subtitle: 'Процесс, механизм или принцип' },
      { title: 'Этапы', subtitle: 'Последовательное развитие или таймлайн' },
      { title: 'Ключевые показатели', subtitle: 'Цифры, факты и влияние' },
      { title: 'Примеры и применение', subtitle: 'Практическая форма и результаты' },
      { title: 'Итоговое резюме', subtitle: 'Главная мысль, которую стоит запомнить' }
    ]
  }
};

function getSlideCopy(language) {
  return SLIDE_COPY[normalizeSlideStudioLanguage(language)] || SLIDE_COPY.uz;
}

function shortenByWords(text, { maxWords = 28, maxChars = 220 } = {}) {
  const src = cleanText(text, Math.max(maxChars * 2, maxChars));
  if (!src) return '';
  const words = src.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords && src.length <= maxChars) return src;
  const out = [];
  for (const word of words) {
    const next = out.length ? `${out.join(' ')} ${word}` : word;
    if (out.length >= maxWords || next.length > maxChars) break;
    out.push(word);
  }
  return cleanText(out.join(' '), maxChars);
}

function parseJsonObjectLoose(text) {
  const src = String(text || '').trim();
  if (!src) return null;
  try {
    return JSON.parse(src);
  } catch (_) {}
  const first = src.indexOf('{');
  const last = src.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(src.slice(first, last + 1));
    } catch (_) {}
  }
  return null;
}

function normalizeStringList(list, { maxItems = 6, maxLen = 160 } = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => cleanText(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeStatsList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      label: cleanText(item?.label, 80),
      value: cleanText(item?.value, 80)
    }))
    .filter((item) => item.label && item.value)
    .slice(0, 4);
}

function normalizeTimelineList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      title: cleanText(item?.title, 120),
      detail: cleanText(item?.detail, 220)
    }))
    .filter((item) => item.title && item.detail)
    .slice(0, 5);
}

function decodeHtmlEntities(text) {
  const named = {
    amp: '&',
    apos: "'",
    quot: '"',
    nbsp: ' ',
    lt: '<',
    gt: '>'
  };
  return String(text || '')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code || 0);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = parseInt(String(code || '0'), 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    })
    .replace(/&([a-z]+);/gi, (match, name) => named[String(name || '').toLowerCase()] || match);
}

function stripHtmlToText(html) {
  return decodeHtmlEntities(String(html || ''))
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function truncateBySentence(text, maxLen = 900) {
  const src = cleanText(text, Math.max(maxLen * 2, maxLen));
  if (!src || src.length <= maxLen) return src;
  const parts = src.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = '';
  for (const part of parts) {
    const next = out ? `${out} ${part}` : part;
    if (next.length > maxLen) break;
    out = next;
  }
  return out || src.slice(0, maxLen);
}

function splitTextToBullets(text, { maxItems = 5, maxLen = 150 } = {}) {
  if (!text) return [];
  return String(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => cleanText(item.replace(/^[-*•\s]+/, ''), maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function splitListInHalf(list) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return { left: [], right: [] };
  const middle = Math.ceil(arr.length / 2);
  return {
    left: arr.slice(0, middle),
    right: arr.slice(middle)
  };
}

function buildResearchQueries(prompt) {
  const src = String(prompt || '').trim();
  if (!src) return [];
  const stripped = src
    .replace(/[?!.:,;()[\]{}"']/g, ' ')
    .replace(/\b(kim|nima|qanday|qachon|qaerda|qayerda|haqida|hayoti|slayd|slide|taqdimot|tayyorla|tayyorlab|ber|batafsil|presentation|about|life|history|details|prepare|create|deck|ppt|pptx)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const base = cleanText(stripped || src, 140);
  const values = [base, cleanText(src, 140)].filter(Boolean);
  const biographyLike = /(kim|hayot|biography|life|tarix|history|person|amir temur|temur|leader|ruler)/i.test(src);
  if (base) {
    if (biographyLike) {
      values.push(`${base} history`);
      values.push(`${base} legacy`);
      values.push(`${base} campaigns`);
    } else {
      values.push(`${base} overview`);
      values.push(`${base} examples`);
      values.push(`${base} impact`);
    }
  }
  return Array.from(new Set(values.map((item) => cleanText(item, 140)).filter(Boolean))).slice(0, 4);
}

async function fetchJsonWithTimeout(url, { timeoutMs = 9000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: Object.assign(
        {
          'Accept': 'application/json',
          'User-Agent': 'HALLAYM-Slide-Studio/1.0'
        },
        headers || {}
      ),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinaryWithTimeout(url, { timeoutMs = 9000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: Object.assign(
        {
          'User-Agent': 'HALLAYM-Slide-Studio/1.0'
        },
        headers || {}
      ),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: String(response.headers.get('content-type') || '').trim()
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url, { timeoutMs = 9000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: Object.assign(
        {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'HALLAYM-Slide-Studio/1.0'
        },
        headers || {}
      ),
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function translateSlideText(text, targetLang, sourceLang = 'auto') {
  const clean = cleanText(text, 5000);
  const target = normalizeSlideStudioLanguage(targetLang);
  const sourceRaw = String(sourceLang || 'auto').trim().toLowerCase();
  const source = sourceRaw === 'auto' ? 'auto' : normalizeSlideStudioLanguage(sourceRaw);
  if (!clean) return '';
  if (source !== 'auto' && source === target) return clean;

  const key = `${source}|${target}|${clean}`;
  if (slideTranslateCache.has(key)) return String(slideTranslateCache.get(key) || clean);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let translated = clean;
  try {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', source || 'auto');
    url.searchParams.set('tl', target);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', clean);
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'HALLAYM-Slide-Studio/1.0'
      },
      signal: controller.signal
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.[0])) {
        translated = data[0]
          .map((row) => Array.isArray(row) ? String(row[0] || '') : '')
          .join('')
          .trim() || clean;
      }
    }
  } catch (_) {
    translated = clean;
  } finally {
    clearTimeout(timer);
  }

  slideTranslateCache.set(key, translated);
  if (slideTranslateCache.size > 1500) {
    const first = slideTranslateCache.keys().next().value;
    if (first) slideTranslateCache.delete(first);
  }
  return translated;
}

async function translateSlideList(list, targetLang, sourceLang = 'auto') {
  if (!Array.isArray(list) || !list.length) return [];
  const rows = await Promise.all(list.map((item) => translateSlideText(item, targetLang, sourceLang)));
  return rows.map((item) => cleanText(item, 500)).filter(Boolean);
}

function resolveRelativeUrl(baseUrl, maybeUrl) {
  const raw = String(maybeUrl || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).toString();
  } catch (_) {
    return '';
  }
}

function extractHtmlMeta(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    const value = decodeHtmlEntities(match?.[1] || '');
    if (value) return cleanText(value, 500);
  }
  return '';
}

function extractHtmlTitle(html) {
  const og = extractHtmlMeta(html, 'og:title');
  if (og) return cleanText(og, 180);
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(stripHtmlToText(match?.[1] || ''), 180);
}

function extractHtmlLang(html) {
  const match = String(html || '').match(/<html[^>]+lang=["']([^"']+)["']/i);
  const value = String(match?.[1] || '').trim().toLowerCase();
  if (value.startsWith('ru')) return 'ru';
  if (value.startsWith('en')) return 'en';
  if (value.startsWith('uz')) return 'uz';
  return 'auto';
}

function looksLikeJunkParagraph(text) {
  const src = String(text || '').trim().toLowerCase();
  if (!src) return true;
  return /cookie|privacy|subscribe|newsletter|all rights reserved|javascript|enable browser|advertisement|share on|terms of use|privacy policy|copyright/.test(src);
}

function extractReadableParagraphs(html, { maxParagraphs = 4, maxChars = 1500 } = {}) {
  const out = [];
  const seen = new Set();
  const regex = /<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = regex.exec(String(html || '')))) {
    const text = cleanText(stripHtmlToText(match[0]), 700);
    const key = text.toLowerCase();
    if (!text || text.length < 80 || looksLikeJunkParagraph(text) || seen.has(key)) continue;
    out.push(text);
    seen.add(key);
    if (out.length >= maxParagraphs) break;
  }

  if (!out.length) {
    stripHtmlToText(html)
      .split(/\n{2,}/)
      .map((item) => cleanText(item, 700))
      .filter((item) => item.length >= 90 && !looksLikeJunkParagraph(item))
      .slice(0, maxParagraphs)
      .forEach((item) => out.push(item));
  }

  const merged = [];
  let total = 0;
  for (const row of out) {
    if ((total + row.length) > maxChars) break;
    merged.push(row);
    total += row.length;
  }
  return merged;
}

function extractHeadingSectionsFromHtml(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const regex = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>([\s\S]*?)(?=<h2\b|<h3\b|<\/article>|<\/main>|<\/body>|$)/gi;
  let match;
  while ((match = regex.exec(String(html || '')))) {
    const heading = cleanText(stripHtmlToText(match[2] || ''), 140);
    const text = truncateBySentence(extractReadableParagraphs(match[3] || '', { maxParagraphs: 2, maxChars: 900 }).join(' '), 700);
    const key = heading.toLowerCase();
    if (!heading || !text || heading.length < 3 || seen.has(key)) continue;
    if (/references|external links|see also|notes|bibliography|related articles|источники|ссылки|примечания|manbalar|havolalar/i.test(heading)) continue;
    seen.add(key);
    out.push({
      heading,
      text,
      sourceLink: baseUrl
    });
    if (out.length >= 4) break;
  }
  return out;
}

function decodeSearchResultUrl(rawHref) {
  const href = decodeHtmlEntities(String(rawHref || '').trim());
  if (!href) return '';
  try {
    const absolute = href.startsWith('//') ? `https:${href}` : href;
    const url = new URL(absolute, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    const out = uddg ? decodeURIComponent(uddg) : url.toString();
    return /^https?:\/\//i.test(out) ? out : '';
  } catch (_) {
    return '';
  }
}

function isBlockedResearchUrl(url) {
  const src = String(url || '').trim();
  if (!/^https?:\/\//i.test(src)) return true;
  return /\.(pdf|docx?|pptx?|xlsx?|zip)(\?|$)/i.test(src)
    || /duckduckgo\.com|google\.com|youtube\.com|youtu\.be|facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com|pinterest\.com|reddit\.com/i.test(src);
}

async function searchDuckDuckGoResults(query) {
  const html = await fetchTextWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { timeoutMs: 9000 });
  const out = [];
  const seen = new Set();
  const regexes = [
    /class="result__a"[^>]+href="([^"]+)"/gi,
    /class='result__a'[^>]+href='([^']+)'/gi,
    /<a[^>]+href="([^"]+)"[^>]*>\s*<span[^>]*class="result__type"/gi
  ];

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(html))) {
      const url = decodeSearchResultUrl(match[1]);
      if (!url || seen.has(url) || isBlockedResearchUrl(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

async function scrapeWebResearchEntry(url) {
  if (isBlockedResearchUrl(url)) return null;
  try {
    const html = await fetchTextWithTimeout(url, { timeoutMs: 9500 });
    const title = extractHtmlTitle(html);
    const description = extractHtmlMeta(html, 'description') || extractHtmlMeta(html, 'og:description');
    const paragraphs = extractReadableParagraphs(html, { maxParagraphs: 4, maxChars: 1500 });
    const summary = truncateBySentence([description, paragraphs.join(' ')].filter(Boolean).join(' '), 1000);
    if (!title || !summary) return null;
    const imageUrl = resolveRelativeUrl(url, extractHtmlMeta(html, 'og:image') || extractHtmlMeta(html, 'twitter:image'));
    const lang = extractHtmlLang(html);
    return {
      lang,
      query: title,
      title,
      summary,
      heroImageUrl: cleanText(imageUrl, 500),
      sourceLink: cleanText(url, 500),
      sections: extractHeadingSectionsFromHtml(html, url)
    };
  } catch (_) {
    return null;
  }
}

async function wikipediaActionQuery(lang, params) {
  const qs = new URLSearchParams();
  qs.set('format', 'json');
  qs.set('origin', '*');
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    qs.set(key, String(value));
  });
  return fetchJsonWithTimeout(`https://${lang}.wikipedia.org/w/api.php?${qs.toString()}`);
}

async function fetchWikipediaSectionText(lang, title, sectionIndex) {
  try {
    const data = await wikipediaActionQuery(lang, {
      action: 'parse',
      page: title,
      prop: 'text',
      section: sectionIndex
    });
    const html = data?.parse?.text?.['*'] || data?.parse?.text || '';
    return truncateBySentence(stripHtmlToText(html), 700);
  } catch (_) {
    return '';
  }
}

async function lookupWikipediaEntry(lang, query) {
  try {
    const search = await wikipediaActionQuery(lang, {
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: 3,
      utf8: 1
    });
    const hit = Array.isArray(search?.query?.search) ? search.query.search[0] : null;
    const title = cleanText(hit?.title, 160);
    if (!title) return null;

    const detail = await wikipediaActionQuery(lang, {
      action: 'query',
      prop: 'extracts|pageimages|info',
      titles: title,
      redirects: 1,
      inprop: 'url',
      piprop: 'original|thumbnail',
      pithumbsize: 1200,
      exintro: 1,
      explaintext: 1,
      exsentences: 12
    });
    const pages = detail?.query?.pages || {};
    const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
    if (!page || page.missing) return null;

    const sectionsData = await wikipediaActionQuery(lang, {
      action: 'parse',
      page: title,
      prop: 'sections'
    }).catch(() => null);
    const sectionRows = Array.isArray(sectionsData?.parse?.sections) ? sectionsData.parse.sections : [];
    const usefulSections = sectionRows
      .filter((item) => {
        const name = String(item?.line || '').trim();
        if (!name) return false;
        return !/references|notes|links|manbalar|external|see also|bibliography/i.test(name);
      })
      .slice(0, 4);

    const sections = [];
    for (const item of usefulSections) {
      const text = await fetchWikipediaSectionText(lang, title, item?.index);
      if (!text) continue;
      sections.push({
        heading: cleanText(item?.line, 120),
        text
      });
    }

    return {
      lang,
      query,
      title,
      summary: truncateBySentence(page?.extract || hit?.snippet || '', 950),
      heroImageUrl: cleanText(page?.original?.source || page?.thumbnail?.source || '', 500),
      sourceLink: cleanText(page?.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`, 500),
      sections
    };
  } catch (_) {
    return null;
  }
}

function buildResearchImagePool(entries) {
  const out = [];
  const seen = new Set();
  (entries || []).forEach((entry) => {
    const imageUrl = cleanText(entry?.heroImageUrl, 500);
    const sourceLink = cleanText(entry?.sourceLink, 500);
    const caption = cleanText(entry?.title || entry?.query || '', 160);
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return;
    const key = imageUrl.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      url: imageUrl,
      caption,
      sourceLink,
      sourceTitle: caption
    });
  });
  return out.slice(0, 12);
}

async function translateResearchToLanguage(research, targetLang) {
  if (!research) return null;
  const language = normalizeSlideStudioLanguage(targetLang);
  const out = Object.assign({}, research);
  out.query = await translateSlideText(research.query || '', language, 'auto');
  out.summary = await translateSlideText(research.summary || '', language, 'auto');
  out.sections = await Promise.all((research.sections || []).map(async (section) => ({
    heading: await translateSlideText(section?.heading || '', language, 'auto'),
    text: await translateSlideText(section?.text || '', language, 'auto'),
    sourceLink: cleanText(section?.sourceLink, 500),
    sourceTitle: await translateSlideText(section?.sourceTitle || '', language, 'auto')
  })));
  out.entries = await Promise.all((research.entries || []).map(async (entry) => ({
    lang: normalizeSlideStudioLanguage(entry?.lang),
    title: await translateSlideText(entry?.title || '', language, 'auto'),
    summary: await translateSlideText(entry?.summary || '', language, 'auto'),
    sourceLink: cleanText(entry?.sourceLink, 500)
  })));
  out.imagePool = Array.isArray(research.imagePool)
    ? research.imagePool.map((item) => ({
        url: cleanText(item?.url, 500),
        caption: cleanText(item?.caption, 160),
        sourceLink: cleanText(item?.sourceLink, 500),
        sourceTitle: cleanText(item?.sourceTitle, 160)
      })).filter((item) => item.url)
    : [];
  out.sourceLinks = Array.isArray(research.sourceLinks)
    ? research.sourceLinks.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 10)
    : [];
  out.heroImageUrl = cleanText(research.heroImageUrl, 500);
  return out;
}

function buildResearchDigest(research) {
  if (!research) return '';
  const lines = [];
  if (research.summary) lines.push(`Summary: ${research.summary}`);
  (research.entries || []).slice(0, 4).forEach((entry, idx) => {
    if (!entry?.summary) return;
    lines.push(`Source ${idx + 1} (${entry.lang || 'web'}): ${entry.summary}`);
  });
  (research.sections || []).slice(0, 4).forEach((item, idx) => {
    const heading = cleanText(item?.heading, 120) || `Section ${idx + 1}`;
    const text = truncateBySentence(item?.text, 520);
    if (!text) return;
    lines.push(`${heading}: ${text}`);
  });
  return lines.join('\n');
}

function ensureSlideVariety(slides, desiredCount) {
  const safe = Array.isArray(slides) ? slides.map((item) => Object.assign({}, item)) : [];
  const total = Math.min(safe.length, clampSlideCount(desiredCount));
  const pattern = ['agenda', 'content', 'split', 'timeline', 'metrics', 'quote', 'content', 'split', 'timeline', 'metrics'];

  for (let i = 0; i < total; i += 1) {
    const slide = safe[i];
    if (!slide) continue;

    if (i === 0) {
      slide.layout = 'cover';
    } else if (i === total - 1) {
      slide.layout = 'closing';
    } else if (slide.timeline?.length >= 2) {
      slide.layout = 'timeline';
    } else if (slide.stats?.length >= 2) {
      slide.layout = 'metrics';
    } else if (slide.quote) {
      slide.layout = 'quote';
    } else if ((slide.leftBullets?.length || 0) + (slide.rightBullets?.length || 0) >= 2) {
      slide.layout = 'split';
    } else {
      slide.layout = pattern[(i - 1) % pattern.length];
    }

    if (slide.layout === 'split' && (!slide.leftBullets?.length || !slide.rightBullets?.length)) {
      const parts = splitListInHalf(slide.bullets || []);
      slide.leftTitle = slide.leftTitle || 'Asosiy nuqtalar';
      slide.rightTitle = slide.rightTitle || 'Davomi';
      slide.leftBullets = slide.leftBullets?.length ? slide.leftBullets : parts.left;
      slide.rightBullets = slide.rightBullets?.length ? slide.rightBullets : parts.right;
    }

    if (slide.layout === 'metrics' && (!slide.stats || !slide.stats.length) && Array.isArray(slide.bullets) && slide.bullets.length >= 3) {
      slide.stats = slide.bullets.slice(0, 3).map((item, idx) => ({
        label: cleanText(item, 60),
        value: `${idx + 1}`
      }));
    }
  }

  return safe;
}

async function researchSlideTopic(prompt, language) {
  const queries = buildResearchQueries(prompt);
  const targetLang = normalizeSlideStudioLanguage(language);
  if (!queries.length) return null;

  const langOrder = Array.from(new Set([
    targetLang,
    'en',
    'uz',
    'ru'
  ]));

  const wikiResults = [];
  for (const query of queries) {
    const hits = await Promise.all(langOrder.map((lang) => lookupWikipediaEntry(lang, query).catch(() => null)));
    hits.forEach((hit) => {
      if (!hit || !hit.summary) return;
      const duplicate = wikiResults.some((item) => item.title === hit.title && item.lang === hit.lang);
      if (!duplicate) wikiResults.push(hit);
    });
    if (wikiResults.length >= 6) break;
  }

  const webResultUrls = [];
  const searchGroups = await Promise.all(queries.slice(0, 3).map((query) => searchDuckDuckGoResults(query).catch(() => [])));
  searchGroups.flat().forEach((url) => {
    if (!url || webResultUrls.includes(url)) return;
    webResultUrls.push(url);
  });
  const webResults = (await Promise.all(webResultUrls.slice(0, 5).map((url) => scrapeWebResearchEntry(url))))
    .filter((item) => item && item.summary);

  const allResults = []
    .concat(wikiResults.slice(0, 6))
    .concat(webResults.slice(0, 4));
  if (!allResults.length) return null;

  const primary = allResults[0];
  const summaries = allResults.map((item) => item.summary).filter(Boolean);
  const mergedSections = [];
  const seenHeadings = new Set();
  allResults.forEach((entry) => {
    (entry.sections || []).forEach((section) => {
      const key = String(section?.heading || '').trim().toLowerCase();
      if (!key || seenHeadings.has(key)) return;
      seenHeadings.add(key);
      mergedSections.push({
        heading: cleanText(section?.heading, 120),
        text: truncateBySentence(section?.text, 700),
        sourceLink: cleanText(section?.sourceLink || entry.sourceLink, 500),
        sourceTitle: cleanText(entry?.title, 160)
      });
    });
  });

  const research = {
    query: cleanText(primary.query || primary.title || prompt, 140),
    summary: truncateBySentence(summaries.join(' '), 1800),
    heroImageUrl: allResults.find((item) => item.heroImageUrl)?.heroImageUrl || '',
    sourceLinks: Array.from(new Set(allResults.map((item) => item.sourceLink).filter(Boolean))).slice(0, 10),
    sections: mergedSections.slice(0, 10).filter((item) => item.heading && item.text),
    entries: allResults.slice(0, 8).map((item) => ({
      lang: item.lang,
      title: item.title,
      summary: truncateBySentence(item.summary, 720),
      sourceLink: item.sourceLink
    })),
    imagePool: buildResearchImagePool(allResults)
  };

  return translateResearchToLanguage(research, targetLang);
}

function looksLikeBiographyTopic(prompt, research) {
  const src = `${prompt || ''} ${(research?.summary || '')} ${(research?.sections || []).map((item) => item.heading).join(' ')}`.toLowerCase();
  return /(kim|hayoti|shajar|yosh|vafot|meros|biography|life|legacy|history|tarix|person|ruler|leader|amir temur|temur|биограф|жизн|наслед|правител|истор)/i.test(src);
}

function pickResearchSections(sections, matchers, usedTitles, limit = 1) {
  const out = [];
  for (const section of sections || []) {
    const heading = String(section?.heading || '').toLowerCase();
    const text = String(section?.text || '').toLowerCase();
    if (!heading && !text) continue;
    if (usedTitles.has(heading)) continue;
    const ok = matchers.some((matcher) => matcher.test(heading) || matcher.test(text));
    if (!ok) continue;
    out.push(section);
    usedTitles.add(heading);
    if (out.length >= limit) break;
  }
  return out;
}

function deriveTimelineFromSections(sections) {
  return (sections || []).slice(0, 4).map((section) => ({
    title: cleanText(section?.heading, 120),
    detail: truncateBySentence(section?.text, 180)
  })).filter((item) => item.title && item.detail);
}

function getSlideCategoryDefinitions(isBiography, language) {
  const copy = getSlideCopy(language);
  const localized = isBiography ? copy.biography : copy.generic;
  const matchers = isBiography
    ? [
        [/umumiy|tavsif|origin|background|ism|shajara|kelib|происх|контекст|описан|обзор/i],
        [/yosh|yoshlik|oil|family|childhood|early|ранн|детств|семь|становл/i],
        [/rise|career|power|hokim|yuksal|boshlanish|turning|власт|карьер|путь|перелом/i],
        [/campaign|harbiy|jangi|yutuq|achievement|expansion|davlat|поход|битв|достиж|импер/i],
        [/boshqar|reform|policy|culture|impact|ta.sir|mamlakat|управл|реформ|влиян|культур/i],
        [/legacy|meros|vafot|memory|xotira|after|наслед|памят|итог|последств/i]
      ]
    : [
        [/umumiy|kirish|overview|intro|definition|общ|введ|определ|обзор/i],
        [/qanday|how|process|principle|working|как|процесс|механизм|принцип/i],
        [/bosqich|step|phase|timeline|этап|стад|таймлайн|последоват/i],
        [/fact|number|stat|impact|foyda|natija|показат|цифр|факт|влиян/i],
        [/example|use|case|misol|qo.llanish|пример|применен|сценар/i],
        [/summary|conclusion|xulosa|future|lesson|итог|вывод|резюме|урок/i]
      ];
  return localized.map((item, index) => ({
    title: item.title,
    subtitle: item.subtitle,
    layout: ['content', 'split', 'timeline', 'metrics', 'split', 'quote'][index] || 'content',
    matchers: matchers[index] || [/.+/]
  }));
}

function trimTimelineRows(rows, maxRows = 4) {
  return normalizeTimelineList(rows).slice(0, maxRows).map((item) => ({
    title: shortenByWords(item.title, { maxWords: 7, maxChars: 70 }),
    detail: shortenByWords(item.detail, { maxWords: 16, maxChars: 110 })
  })).filter((item) => item.title && item.detail);
}

function trimStatsRows(rows, maxRows = 4) {
  return normalizeStatsList(rows).slice(0, maxRows).map((item) => ({
    label: shortenByWords(item.label, { maxWords: 7, maxChars: 52 }),
    value: shortenByWords(item.value, { maxWords: 5, maxChars: 28 })
  })).filter((item) => item.label && item.value);
}

function fitSlideToAspect(slide, language) {
  const copy = getSlideCopy(language);
  const layout = String(slide?.layout || 'content');
  const safe = Object.assign({}, slide || {});
  const originalBody = cleanText(safe.body, 1000);
  safe.title = shortenByWords(safe.title, { maxWords: layout === 'cover' ? 9 : 11, maxChars: layout === 'cover' ? 66 : 88 });
  safe.subtitle = shortenByWords(safe.subtitle, { maxWords: 18, maxChars: 160 });
  safe.callout = shortenByWords(safe.callout, { maxWords: 18, maxChars: 130 });
  safe.kicker = cleanText(safe.kicker, 80);
  safe.quoteAuthor = shortenByWords(safe.quoteAuthor, { maxWords: 8, maxChars: 80 });
  safe.imageCaption = shortenByWords(safe.imageCaption, { maxWords: 12, maxChars: 110 });

  if (layout === 'cover') {
    safe.body = shortenByWords(safe.body, { maxWords: 34, maxChars: 260 });
    safe.bullets = normalizeStringList(safe.bullets, { maxItems: 4, maxLen: 74 }).map((item) => shortenByWords(item, { maxWords: 10, maxChars: 74 }));
  } else if (layout === 'agenda') {
    safe.body = '';
    safe.bullets = normalizeStringList(safe.bullets, { maxItems: 6, maxLen: 62 }).map((item) => shortenByWords(item, { maxWords: 8, maxChars: 62 }));
  } else if (layout === 'split') {
    safe.body = shortenByWords(safe.body, { maxWords: 24, maxChars: 180 }) || copy.bodyLeftHint;
    safe.leftBullets = normalizeStringList(safe.leftBullets, { maxItems: 4, maxLen: 78 }).map((item) => shortenByWords(item, { maxWords: 11, maxChars: 78 }));
    safe.rightBullets = normalizeStringList(safe.rightBullets, { maxItems: 4, maxLen: 78 }).map((item) => shortenByWords(item, { maxWords: 11, maxChars: 78 }));
    safe.bullets = normalizeStringList(safe.bullets, { maxItems: 4, maxLen: 78 }).map((item) => shortenByWords(item, { maxWords: 11, maxChars: 78 }));
    safe.leftTitle = shortenByWords(safe.leftTitle || copy.splitLeftTitle, { maxWords: 6, maxChars: 54 });
    safe.rightTitle = shortenByWords(safe.rightTitle || copy.splitRightTitle, { maxWords: 6, maxChars: 54 });
  } else if (layout === 'timeline') {
    safe.body = shortenByWords(safe.body, { maxWords: 18, maxChars: 140 });
    safe.timeline = trimTimelineRows(safe.timeline, 4);
    safe.bullets = normalizeStringList(safe.bullets, { maxItems: 4, maxLen: 84 }).map((item) => shortenByWords(item, { maxWords: 12, maxChars: 84 }));
  } else if (layout === 'metrics') {
    safe.body = shortenByWords(safe.body, { maxWords: 18, maxChars: 140 });
    safe.stats = trimStatsRows(safe.stats, 4);
    safe.bullets = normalizeStringList(safe.bullets, { maxItems: 4, maxLen: 58 }).map((item) => shortenByWords(item, { maxWords: 8, maxChars: 58 }));
  } else if (layout === 'quote') {
    safe.body = '';
    safe.quote = shortenByWords(safe.quote || originalBody || safe.title, { maxWords: 30, maxChars: 220 });
  } else if (layout === 'closing') {
    safe.body = shortenByWords(safe.body, { maxWords: 20, maxChars: 150 });
    safe.bullets = normalizeStringList(safe.bullets, { maxItems: 4, maxLen: 78 }).map((item) => shortenByWords(item, { maxWords: 11, maxChars: 78 }));
  } else {
    safe.body = shortenByWords(safe.body, { maxWords: 26, maxChars: 200 });
    safe.bullets = normalizeStringList(safe.bullets, { maxItems: 5, maxLen: 80 }).map((item) => shortenByWords(item, { maxWords: 11, maxChars: 80 }));
  }

  safe.sourceLinks = Array.isArray(safe.sourceLinks)
    ? safe.sourceLinks.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 3)
    : [];
  safe.imageUrl = cleanText(safe.imageUrl, 500);
  safe.leftBullets = normalizeStringList(safe.leftBullets, { maxItems: 4, maxLen: 80 });
  safe.rightBullets = normalizeStringList(safe.rightBullets, { maxItems: 4, maxLen: 80 });
  return safe;
}

function tokenizeForMatch(text) {
  return Array.from(new Set(String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((item) => item && item.length >= 4)));
}

function pickImageForSlide(slide, imagePool, usedUrls = new Set()) {
  const pool = Array.isArray(imagePool) ? imagePool.filter((item) => item?.url) : [];
  if (!pool.length) return null;
  const tokens = tokenizeForMatch([
    slide?.title,
    slide?.subtitle,
    slide?.body,
    slide?.kicker,
    slide?.quote
  ].filter(Boolean).join(' '));

  let best = null;
  for (const item of pool) {
    const haystack = `${item.caption || ''} ${item.sourceTitle || ''}`.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 2 : 0), 0)
      + (usedUrls.has(item.url) ? -3 : 0);
    if (!best || score > best.score) best = { item, score };
  }

  if (best?.item) return best.item;
  return pool.find((item) => !usedUrls.has(item.url)) || pool[0] || null;
}

function buildSlideResearchPlan({ prompt, slideCount, research, language }) {
  const total = clampSlideCount(slideCount);
  const sections = Array.isArray(research?.sections) ? research.sections.filter((item) => item?.heading || item?.text) : [];
  const usedTitles = new Set();
  const isBiography = looksLikeBiographyTopic(prompt, research);
  const copy = getSlideCopy(language);
  const title = cleanText(research?.query, 120) || cleanText(prompt, 120) || copy.defaultTopic;
  const plan = [];

  plan.push({
    layout: 'cover',
    title: title,
    subtitle: cleanText(research?.summary, 220) || `${title} ${copy.coverSubtitleSuffix}`,
    body: truncateBySentence(research?.summary, 420),
    bullets: splitTextToBullets(research?.summary, { maxItems: 4, maxLen: 120 }),
    callout: copy.coverCallout,
    sourceLinks: Array.isArray(research?.sourceLinks) ? research.sourceLinks.slice(0, 3) : []
  });

  if (total > 1) {
    plan.push({
      layout: 'agenda',
      kicker: copy.agendaKicker,
      title: copy.agendaTitle,
      subtitle: '',
      body: '',
      bullets: [],
      callout: copy.agendaCallout
    });
  }

  const categoryDefs = getSlideCategoryDefinitions(isBiography, language);

  for (const category of categoryDefs) {
    if (plan.length >= total - 1) break;
    const matched = pickResearchSections(sections, category.matchers, usedTitles, category.layout === 'timeline' ? 3 : 2);
    const relevant = matched.length ? matched : pickResearchSections(sections, [/.+/], usedTitles, category.layout === 'timeline' ? 3 : 1);
    if (!relevant.length) continue;

    const combinedText = relevant.map((item) => item.text).filter(Boolean).join(' ');
    const bullets = splitTextToBullets(combinedText, { maxItems: category.layout === 'metrics' ? 4 : 5, maxLen: 120 });
    plan.push({
      layout: category.layout,
      title: cleanText(relevant[0]?.heading, 160) || category.title,
      subtitle: category.subtitle,
      body: truncateBySentence(combinedText, category.layout === 'quote' ? 240 : 520),
      bullets,
      timeline: category.layout === 'timeline' ? deriveTimelineFromSections(relevant) : [],
      stats: category.layout === 'metrics'
        ? bullets.slice(0, 4).map((item, idx) => ({ label: cleanText(item, 60), value: `${idx + 1}` }))
        : [],
      quote: category.layout === 'quote' ? truncateBySentence(combinedText, 240) : '',
      callout: cleanText(relevant.map((item) => item.heading).filter(Boolean).join(' | '), 180),
      sourceLinks: Array.from(new Set(relevant.map((item) => cleanText(item?.sourceLink, 500)).filter(Boolean))).slice(0, 3)
    });
  }

  while (plan.length < total - 1 && sections.length) {
    const next = sections.find((item) => !usedTitles.has(String(item?.heading || '').toLowerCase()));
    if (!next) break;
    usedTitles.add(String(next?.heading || '').toLowerCase());
    plan.push({
      layout: plan.length % 2 === 0 ? 'content' : 'split',
      title: cleanText(next?.heading, 160) || (language === 'en' ? `Section ${plan.length}` : (language === 'ru' ? `Раздел ${plan.length}` : `Bo'lim ${plan.length}`)),
      subtitle: '',
      body: truncateBySentence(next?.text, 520),
      bullets: splitTextToBullets(next?.text, { maxItems: 5, maxLen: 120 }),
      callout: '',
      sourceLinks: next?.sourceLink ? [cleanText(next.sourceLink, 500)] : []
    });
  }

  const closingBullets = splitTextToBullets(research?.summary, { maxItems: 3, maxLen: 120 });
  plan.push({
    layout: 'closing',
    kicker: copy.closingKicker,
    title: isBiography ? (language === 'en' ? `${title} Legacy` : (language === 'ru' ? `Наследие ${title}` : `${title} merosi`)) : copy.closingTitle,
    subtitle: copy.closingSubtitle,
    body: '',
    bullets: closingBullets.length
      ? closingBullets
      : (language === 'en'
          ? ['Repeat the main idea', 'State the most important takeaway', 'Move into questions']
          : (language === 'ru'
              ? ['Повторите главную мысль', 'Скажите ключевой вывод', 'Перейдите к вопросам']
              : ['Asosiy fikrni takrorlang', 'Muhim xulosani ayting', 'Savol-javobga o\'ting'])),
    callout: copy.closingCallout,
    sourceLinks: Array.isArray(research?.sourceLinks) ? research.sourceLinks.slice(0, 3) : []
  });

  const trimmed = plan.slice(0, total);
  if (trimmed[1] && trimmed[1].layout === 'agenda') {
    trimmed[1].bullets = trimmed.slice(2).map((item) => cleanText(item.title, 100)).filter(Boolean).slice(0, 6);
  }
  return trimmed;
}

function renderSlidePlanForPrompt(plan) {
  return (plan || []).map((item, idx) => {
    const parts = [
      `Slide ${idx + 1}`,
      `layout=${item.layout || 'content'}`,
      `title=${cleanText(item.title, 160)}`,
      item.subtitle ? `subtitle=${cleanText(item.subtitle, 160)}` : '',
      item.body ? `body=${truncateBySentence(item.body, 220)}` : '',
      Array.isArray(item.bullets) && item.bullets.length ? `bullets=${item.bullets.join(' | ')}` : '',
      Array.isArray(item.timeline) && item.timeline.length ? `timeline=${item.timeline.map((row) => `${row.title}: ${row.detail}`).join(' | ')}` : '',
      Array.isArray(item.stats) && item.stats.length ? `stats=${item.stats.map((row) => `${row.label}: ${row.value}`).join(' | ')}` : '',
      item.callout ? `callout=${cleanText(item.callout, 160)}` : ''
    ].filter(Boolean);
    return parts.join(' ; ');
  }).join('\n');
}

function enhanceDeckWithPlan(deck, plan, research) {
  const safeDeck = Object.assign({}, deck || {});
  const language = normalizeSlideStudioLanguage(safeDeck.language || 'uz');
  const copy = getSlideCopy(language);
  const rawSlides = Array.isArray(safeDeck.slides) ? safeDeck.slides.map((item) => Object.assign({}, item)) : [];
  const desiredCount = clampSlideCount(rawSlides.length || plan?.length || 6);
  const planRows = Array.isArray(plan) ? plan : [];
  const enhancedSlides = [];
  const usedImages = new Set();

  for (let i = 0; i < Math.max(desiredCount, planRows.length); i += 1) {
    const sourceSlide = rawSlides[i] || {};
    const planRow = planRows[i] || {};
    const bullets = Array.isArray(sourceSlide.bullets) && sourceSlide.bullets.length
      ? sourceSlide.bullets
      : (Array.isArray(planRow.bullets) ? planRow.bullets : []);
    const layout = (planRow.layout && SLIDE_LAYOUTS.includes(planRow.layout))
      ? planRow.layout
      : (SLIDE_LAYOUTS.includes(sourceSlide.layout) ? sourceSlide.layout : 'content');
    const imageCandidate = pickImageForSlide({
      title: sourceSlide.title || planRow.title,
      subtitle: sourceSlide.subtitle || planRow.subtitle,
      body: sourceSlide.body || planRow.body,
      kicker: sourceSlide.kicker || planRow.kicker,
      quote: sourceSlide.quote || planRow.quote
    }, research?.imagePool, usedImages);
    const mergedSourceLinks = Array.from(new Set(
      []
        .concat(Array.isArray(sourceSlide.sourceLinks) ? sourceSlide.sourceLinks : [])
        .concat(Array.isArray(planRow.sourceLinks) ? planRow.sourceLinks : [])
        .concat(imageCandidate?.sourceLink ? [imageCandidate.sourceLink] : [])
        .map((item) => cleanText(item, 500))
        .filter(Boolean)
    )).slice(0, 3);
    const imageUrl = cleanText(
      sourceSlide.imageUrl
        || planRow.imageUrl
        || imageCandidate?.url
        || ((i === 0 || layout === 'cover') ? (safeDeck.heroImageUrl || research?.heroImageUrl) : ''),
      500
    );
    if (imageUrl) usedImages.add(imageUrl);

    const leftRight = splitListInHalf(bullets);
    enhancedSlides.push({
      order: i + 1,
      layout,
      kicker: cleanText(sourceSlide.kicker || planRow.kicker || '', 120),
      title: cleanText(sourceSlide.title, 220) || cleanText(planRow.title, 220) || `Slide ${i + 1}`,
      subtitle: cleanText(sourceSlide.subtitle, 260) || cleanText(planRow.subtitle, 260),
      body: cleanText(sourceSlide.body, 1000) || cleanText(planRow.body, 1000),
      bullets: normalizeStringList(bullets, { maxItems: 6, maxLen: 160 }),
      leftTitle: cleanText(sourceSlide.leftTitle, 120) || (layout === 'split' ? 'Asosiy nuqtalar' : ''),
      leftBullets: normalizeStringList(sourceSlide.leftBullets?.length ? sourceSlide.leftBullets : leftRight.left, { maxItems: 5, maxLen: 160 }),
      rightTitle: cleanText(sourceSlide.rightTitle, 120) || (layout === 'split' ? 'Davomi' : ''),
      rightBullets: normalizeStringList(sourceSlide.rightBullets?.length ? sourceSlide.rightBullets : leftRight.right, { maxItems: 5, maxLen: 160 }),
      stats: normalizeStatsList(sourceSlide.stats?.length ? sourceSlide.stats : planRow.stats),
      timeline: normalizeTimelineList(sourceSlide.timeline?.length ? sourceSlide.timeline : planRow.timeline),
      quote: cleanText(sourceSlide.quote, 320) || cleanText(planRow.quote, 320),
      quoteAuthor: cleanText(sourceSlide.quoteAuthor, 120),
      imageUrl,
      imageCaption: cleanText(sourceSlide.imageCaption, 160) || cleanText(planRow.imageCaption, 160) || cleanText(imageCandidate?.caption || imageCandidate?.sourceTitle || '', 160),
      sourceLinks: mergedSourceLinks,
      callout: cleanText(sourceSlide.callout, 220) || cleanText(planRow.callout, 220),
      speakerNote: cleanText(sourceSlide.speakerNote, 400) || cleanText(planRow.body || research?.summary, 400)
    });
  }

  safeDeck.slides = ensureSlideVariety(enhancedSlides.slice(0, desiredCount), desiredCount).map((slide) => fitSlideToAspect(slide, language));
  safeDeck.summary = cleanText(safeDeck.summary, 600) || cleanText(research?.summary, 600);
  safeDeck.heroImageUrl = cleanText(safeDeck.heroImageUrl || safeDeck.slides[0]?.imageUrl || research?.heroImageUrl, 500);
  safeDeck.researchSummary = cleanText(safeDeck.researchSummary || research?.summary, 1800);
  safeDeck.sourceLinks = Array.from(new Set(
    []
      .concat(Array.isArray(safeDeck.sourceLinks) ? safeDeck.sourceLinks : [])
      .concat(Array.isArray(research?.sourceLinks) ? research.sourceLinks : [])
      .concat(safeDeck.slides.flatMap((slide) => Array.isArray(slide?.sourceLinks) ? slide.sourceLinks : []))
      .map((item) => cleanText(item, 500))
      .filter(Boolean)
  )).slice(0, 10);
  safeDeck.language = language;
  safeDeck.watermark = cleanText(safeDeck.watermark, 200);
  safeDeck.themeLabel = cleanText(safeDeck.themeLabel, 120) || copy.themeDeckLabel;
  return safeDeck;
}

function createFallbackSlideDeck({ prompt, slideCount, themeId, watermark, research, language }) {
  const lang = normalizeSlideStudioLanguage(language);
  const copy = getSlideCopy(lang);
  const generatedTitle = cleanText(prompt, 80) || cleanText(research?.query, 80) || copy.defaultDeckTitle;
  const sections = Array.isArray(research?.sections)
    ? research.sections.slice(0, Math.max(2, clampSlideCount(slideCount) - 2))
    : [];
  const agendaBullets = sections.length
    ? sections.map((item) => cleanText(item.heading, 100)).filter(Boolean).slice(0, 5)
    : (lang === 'en'
        ? ['Introduction', 'Main ideas', 'Important facts', 'Takeaway']
        : (lang === 'ru'
            ? ['Введение', 'Основная тема', 'Важные факты', 'Итог']
            : ['Kirish', 'Asosiy mavzu', 'Muhim faktlar', 'Xulosa']));
  const imagePool = Array.isArray(research?.imagePool) ? research.imagePool : [];
  const usedImages = new Set();

  const generatedSlides = [
    {
      order: 1,
      layout: 'cover',
      kicker: 'HALLAYM AI',
      title: generatedTitle,
      subtitle: cleanText(research?.summary, 220) || copy.fallbackSubtitle,
      body: '',
      bullets: splitTextToBullets(research?.summary, { maxItems: 4, maxLen: 120 }),
      leftTitle: '',
      leftBullets: [],
      rightTitle: '',
      rightBullets: [],
      stats: [],
      timeline: [],
      quote: '',
      quoteAuthor: '',
      imageUrl: cleanText(research?.heroImageUrl, 500),
      imageCaption: cleanText(research?.query || generatedTitle, 160),
      sourceLinks: Array.isArray(research?.sourceLinks) ? research.sourceLinks.slice(0, 3) : [],
      callout: copy.coverNote,
      speakerNote: lang === 'en'
        ? 'Briefly explain why the topic matters before moving into the details.'
        : (lang === 'ru'
            ? 'Коротко объясните, почему тема важна, и затем переходите к деталям.'
            : 'Kirish qismida mavzu nega muhim ekanini qisqa tushuntiring.')
    },
    {
      order: 2,
      layout: 'agenda',
      kicker: copy.agendaKicker,
      title: copy.fallbackAgendaTitle,
      subtitle: '',
      body: '',
      bullets: agendaBullets,
      leftTitle: '',
      leftBullets: [],
      rightTitle: '',
      rightBullets: [],
      stats: [],
      timeline: [],
      quote: '',
      quoteAuthor: '',
      imageUrl: '',
      imageCaption: '',
      sourceLinks: [],
      callout: '',
      speakerNote: lang === 'en'
        ? 'Preview the structure so the audience knows what is coming.'
        : (lang === 'ru'
            ? 'Коротко покажите структуру, чтобы аудитория понимала ход презентации.'
            : 'Taqdimot strukturasini oldindan ayting.')
    }
  ];

  sections.forEach((item, idx) => {
    const detailBullets = splitTextToBullets(item.text, { maxItems: 6, maxLen: 120 });
    const parts = splitListInHalf(detailBullets);
    const pickedImage = pickImageForSlide({ title: item.heading, body: item.text }, imagePool, usedImages);
    if (pickedImage?.url) usedImages.add(pickedImage.url);
    generatedSlides.push({
      order: generatedSlides.length + 1,
      layout: idx % 2 === 0 ? 'content' : 'split',
      kicker: cleanText(item.heading, 100) || copy.fallbackContentTitle,
      title: cleanText(item.heading, 180) || (lang === 'en' ? `Section ${idx + 1}` : (lang === 'ru' ? `Раздел ${idx + 1}` : `Bo'lim ${idx + 1}`)),
      subtitle: '',
      body: truncateBySentence(item.text, 520),
      bullets: detailBullets,
      leftTitle: lang === 'en' ? 'Important facts' : (lang === 'ru' ? 'Важные факты' : 'Muhim faktlar'),
      leftBullets: parts.left,
      rightTitle: copy.splitRightTitle,
      rightBullets: parts.right,
      stats: [],
      timeline: [],
      quote: '',
      quoteAuthor: '',
      imageUrl: cleanText(pickedImage?.url, 500),
      imageCaption: cleanText(pickedImage?.caption || item.heading, 160),
      sourceLinks: item?.sourceLink ? [cleanText(item.sourceLink, 500)] : [],
      callout: '',
      speakerNote: lang === 'en'
        ? 'Close this section with one fact and one short explanation.'
        : (lang === 'ru'
            ? 'Завершите раздел одним фактом и одним коротким пояснением.'
            : 'Bo‘limni fakt va izoh bilan yoping.')
    });
  });

  generatedSlides.push({
    order: generatedSlides.length + 1,
    layout: 'closing',
    kicker: copy.closingKicker,
    title: copy.fallbackClosingTitle,
    subtitle: copy.fallbackClosingSubtitle,
    body: '',
    bullets: splitTextToBullets(research?.summary, { maxItems: 3, maxLen: 120 }).length
      ? splitTextToBullets(research?.summary, { maxItems: 3, maxLen: 120 })
      : (lang === 'en'
          ? ['Repeat the main idea', 'State the key takeaway', 'Move into Q&A']
          : (lang === 'ru'
              ? ['Повторите главную мысль', 'Озвучьте ключевой вывод', 'Перейдите к вопросам']
              : ['Asosiy fikrni takrorlang', 'Muhim xulosani ayting', 'Savol-javobga o‘ting'])),
    leftTitle: '',
    leftBullets: [],
    rightTitle: '',
    rightBullets: [],
    stats: [],
    timeline: [],
    quote: '',
    quoteAuthor: '',
    imageUrl: '',
    imageCaption: '',
    sourceLinks: Array.isArray(research?.sourceLinks) ? research.sourceLinks.slice(0, 3) : [],
    callout: watermark,
    speakerNote: lang === 'en'
      ? 'Leave the audience with one clear closing thought.'
      : (lang === 'ru'
          ? 'Оставьте аудиторию с одной понятной финальной мыслью.'
          : 'Yakuniy slide auditoriyani bitta asosiy fikr bilan qoldirishi kerak.')
  });

  return {
    title: generatedTitle,
    subtitle: cleanText(research?.summary, 240) || copy.fallbackDeckSubtitle,
    summary: cleanText(research?.summary, 600) || copy.fallbackDeckSummary,
    language: lang,
    themeId,
    themeLabel: (SLIDE_THEME_MAP.get(themeId) || SLIDE_THEME_PRESETS[0]).label,
    watermark,
    heroImageUrl: cleanText(research?.heroImageUrl, 500),
    researchSummary: cleanText(research?.summary, 1800),
    sourceLinks: Array.isArray(research?.sourceLinks) ? research.sourceLinks.slice(0, 10) : [],
    generationMode: 'fallback',
    slides: ensureSlideVariety(generatedSlides.slice(0, clampSlideCount(slideCount)), slideCount).map((slide) => fitSlideToAspect(slide, lang))
  };
}

function normalizeSlideDeckPayload(raw, { prompt, slideCount, styleRequested, colorMood, watermark, research, language }) {
  const fallbackThemeId = resolveSlideThemeId({ styleRequested, prompt, research, colorMood });
  const themeId = SLIDE_THEME_MAP.has(raw?.theme_id) ? raw.theme_id : fallbackThemeId;
  const theme = SLIDE_THEME_MAP.get(themeId) || SLIDE_THEME_PRESETS[0];
  const desiredCount = clampSlideCount(slideCount);
  const finalLanguage = normalizeSlideStudioLanguage(language);
  const copy = getSlideCopy(finalLanguage);
  const safeSlides = Array.isArray(raw?.slides) ? raw.slides : [];

  const slides = safeSlides
    .slice(0, desiredCount)
    .map((slide, idx) => {
      const layout = SLIDE_LAYOUTS.includes(String(slide?.layout || '').trim()) ? String(slide.layout).trim() : (idx === 0 ? 'cover' : 'content');
      const bullets = normalizeStringList(slide?.bullets, { maxItems: 6, maxLen: 160 });
      const leftBullets = normalizeStringList(slide?.left_bullets, { maxItems: 5, maxLen: 160 });
      const rightBullets = normalizeStringList(slide?.right_bullets, { maxItems: 5, maxLen: 160 });
      return {
        order: idx + 1,
        layout,
        kicker: cleanText(slide?.kicker, 120),
        title: cleanText(slide?.title, 220) || `Slide ${idx + 1}`,
        subtitle: cleanText(slide?.subtitle, 260),
        body: cleanText(slide?.body, 1000),
        bullets,
        leftTitle: cleanText(slide?.left_title, 120),
        leftBullets,
        rightTitle: cleanText(slide?.right_title, 120),
        rightBullets,
        stats: normalizeStatsList(slide?.stats),
        timeline: normalizeTimelineList(slide?.timeline),
        quote: cleanText(slide?.quote, 320),
        quoteAuthor: cleanText(slide?.quote_author, 120),
        imageUrl: cleanText(slide?.image_url, 500),
        imageCaption: cleanText(slide?.image_caption, 160),
        sourceLinks: Array.isArray(slide?.source_links) ? slide.source_links.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 3) : [],
        callout: cleanText(slide?.callout, 220),
        speakerNote: cleanText(slide?.speaker_note, 400)
      };
    })
    .filter((slide) => slide.title || slide.quote || slide.body || slide.bullets.length || slide.timeline.length || slide.stats.length);

  if (slides.length < 4) {
    return createFallbackSlideDeck({ prompt, slideCount: desiredCount, themeId: fallbackThemeId, watermark, research, language: finalLanguage });
  }

  const variedSlides = ensureSlideVariety(slides, desiredCount).map((slide) => fitSlideToAspect(slide, finalLanguage));

  return {
    title: cleanText(raw?.deck_title, 200) || cleanText(prompt, 80) || copy.defaultDeckTitle,
    subtitle: cleanText(raw?.deck_subtitle, 240),
    summary: cleanText(raw?.summary, 600) || cleanText(research?.summary, 600),
    language: finalLanguage,
    themeId,
    themeLabel: cleanText(raw?.theme_label, 120) || theme.label,
    watermark,
    heroImageUrl: cleanText(research?.heroImageUrl, 500),
    researchSummary: cleanText(research?.summary, 1800),
    sourceLinks: Array.isArray(research?.sourceLinks) ? research.sourceLinks.slice(0, 10) : [],
    generationMode: 'ai',
    slides: variedSlides
  };
}

async function requestGroqSlideDeckJson({ systemPrompt, userMessage }) {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) throw new Error('GROQ_API_KEY missing');

  const preferredModel = String(process.env.GROQ_SLIDES_MODEL || 'openai/gpt-oss-20b').trim();
  const fallbackModel = String(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
  const models = Array.from(new Set([preferredModel, fallbackModel].filter(Boolean)));
  let lastErr = '';

  for (const model of models) {
    const strictSupported = /^openai\/gpt-oss-/i.test(model);
    try {
      const responseFormat = strictSupported
        ? {
            type: 'json_schema',
            json_schema: {
              name: 'slide_deck',
              strict: true,
              schema: SLIDE_GENERATION_SCHEMA
            }
          }
        : { type: 'json_object' };

      const { content } = await requestOpenAiCompatibleChat({
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey,
        model,
        systemPrompt,
        history: [],
        userMessage,
        temperature: strictSupported ? 0.25 : 0.45,
        maxTokens: 3800,
        responseFormat
      });
      const parsed = parseJsonObjectLoose(content);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('AI JSON parse failed');
      }
      return { parsed, model, generationMode: strictSupported ? 'ai' : 'ai-best-effort' };
    } catch (e) {
      lastErr = String(e?.message || e || 'slide generation failed');
      console.warn(`slide ai provider failed (${model}):`, lastErr);
    }
  }

  throw new Error(lastErr || 'Groq slide generation failed');
}

async function generateSlideDeckWithGroq({ user, prompt, audience, language, styleRequested, colorMood, slideCount }) {
  {
    const finalLanguageValue = normalizeSlideStudioLanguage(language);
    const finalCountValue = clampSlideCount(slideCount);
    const finalStyleValue = SLIDE_THEME_MAP.has(styleRequested) ? styleRequested : 'auto';
    const finalColorMoodValue = normalizeSlideColorMood(colorMood);
    const watermarkValue = `${cleanText(user?.fullName || user?.username || 'Foydalanuvchi', 80)} tayyorladi | by HALLAYM`;
    const research = await researchSlideTopic(prompt, finalLanguageValue);
    const themeHintsValue = SLIDE_THEME_PRESETS
      .map((item) => `- ${item.id}: ${item.label} (${item.mood}; tones: ${(item.tones || []).join(', ')})`)
      .join('\n');
    const languageHintValue = finalLanguageValue === 'en' ? 'English' : (finalLanguageValue === 'ru' ? 'Russian' : 'Uzbek');
    const styleHintValue = finalStyleValue === 'auto'
      ? 'Choose the most appropriate theme for the topic.'
      : `Prefer this theme id if it fits: ${finalStyleValue}.`;
    const colorHintValue = finalColorMoodValue === 'auto'
      ? 'Let the color palette follow the topic naturally. Do not default to teal.'
      : `Prefer a ${finalColorMoodValue} color direction if it fits the topic while keeping the result elegant.`;
    const researchDigest = buildResearchDigest(research);
    const slidePlan = buildSlideResearchPlan({
      prompt,
      slideCount: finalCountValue,
      research,
      language: finalLanguageValue
    });
    const slidePlanText = renderSlidePlanForPrompt(slidePlan);
    const systemPromptValue = [
      'You are HALLAYM AI and you create rich, premium, visually varied slide decks for a university web app.',
      `Write all slide text in ${languageHintValue}.`,
      'Return only structured deck JSON. Do not include markdown, code fences, or explanations.',
      'Do not mention Groq, providers, prompts, JSON, or internal tooling anywhere in the slide text.',
      'The deck must be content-rich, not a thin outline.',
      'Distribute information across the full deck. Do not dump most facts into slide 1.',
      'Each middle slide should teach something concrete with facts, names, dates, places, reasons, or outcomes when relevant.',
      'For biography or history topics, cover origin, early life, major turning points, achievements, impact, legacy, and memorable facts.',
      'Assume every slide is a strict 16:9 canvas. Keep content compact enough to fit elegantly without overflow.',
      'Use one relevant image or visual idea per slide when it improves understanding. Keep visuals smaller than the text area and integrated into the layout.',
      'For each slide, fill image_url and image_caption when a relevant visual is available, and include per-slide source_links whenever possible.',
      'All visible text must stay in the requested language only. Do not mix Uzbek, English, Russian, or any other language.',
      'Use varied layouts across the deck so consecutive slides do not feel repetitive.',
      'First slide must work like a strong cover. Last slide must work like a strong closing slide.',
      'Use body text plus bullets or structured blocks so each slide feels complete.',
      'Use topic-appropriate accent colors for headers, chips, callouts, and cards instead of repeating the same teal palette.',
      styleHintValue,
      colorHintValue,
      'Allowed themes:',
      themeHintsValue
    ].join('\n');
    const userMessageValue = [
      `Topic: ${prompt}`,
      audience ? `Audience: ${audience}` : 'Audience: general',
      `Slide count: ${finalCountValue}`,
      `Requested style: ${finalStyleValue}`,
      researchDigest ? `Research notes:\n${researchDigest}` : 'Research notes: no external notes found, use general knowledge carefully.',
      slidePlanText ? `Slide plan:\n${slidePlanText}` : '',
      research?.sourceLinks?.length ? `Sources:\n${research.sourceLinks.join('\n')}` : '',
      research?.imagePool?.length ? `Image candidates:\n${research.imagePool.map((item) => `${item.caption || 'visual'} | ${item.sourceLink || item.url}`).join('\n')}` : '',
      'Make the structure presentation-ready, modern, visually clear, and informative.',
      'Prefer a different useful layout on most slides.',
      'For each slide, place the right facts on the right page instead of repeating the same introduction.',
      'Return source_links for each slide whenever possible.'
    ].filter(Boolean).join('\n\n');

    try {
      const { parsed, model, generationMode } = await requestGroqSlideDeckJson({
        systemPrompt: systemPromptValue,
        userMessage: userMessageValue
      });
      let deck = normalizeSlideDeckPayload(parsed, {
        prompt,
        slideCount: finalCountValue,
        styleRequested: finalStyleValue,
        colorMood: finalColorMoodValue,
        watermark: watermarkValue,
        research,
        language: finalLanguageValue
      });
      deck = enhanceDeckWithPlan(deck, slidePlan, research);
      deck.aiProvider = 'hallaym-ai';
      deck.aiModel = cleanText(model, 120);
      deck.generationMode = generationMode || deck.generationMode || 'ai';
      deck.heroImageUrl = cleanText(deck.heroImageUrl || research?.heroImageUrl, 500);
      deck.researchSummary = cleanText(deck.researchSummary || research?.summary, 1800);
      deck.sourceLinks = Array.isArray(deck.sourceLinks) && deck.sourceLinks.length
        ? deck.sourceLinks.slice(0, 10)
        : (Array.isArray(research?.sourceLinks) ? research.sourceLinks.slice(0, 10) : []);
      return deck;
    } catch (e) {
      const fallbackThemeId = resolveSlideThemeId({
        styleRequested: finalStyleValue,
        prompt,
        research,
        colorMood: finalColorMoodValue
      });
      let deck = createFallbackSlideDeck({
        prompt,
        slideCount: finalCountValue,
        themeId: fallbackThemeId,
        watermark: watermarkValue,
        research,
        language: finalLanguageValue
      });
      deck = enhanceDeckWithPlan(deck, slidePlan, research);
      deck.aiProvider = 'hallaym-ai';
      deck.aiModel = 'fallback';
      deck.generationMode = 'fallback';
      deck.fallbackReason = cleanText(e?.message || e, 280);
      return deck;
    }
  }
  const finalLanguage = normalizeSlideStudioLanguage(language);
  const finalCount = clampSlideCount(slideCount);
  const finalStyle = SLIDE_THEME_MAP.has(styleRequested) ? styleRequested : 'auto';
  const watermark = `${cleanText(user?.fullName || user?.username || 'Foydalanuvchi', 80)} tayyorladi • by HALLAYM`;
  const themeHints = SLIDE_THEME_PRESETS
    .map((item) => `- ${item.id}: ${item.label} (${item.mood})`)
    .join('\n');
  const languageHint = finalLanguage === 'en' ? 'English' : (finalLanguage === 'ru' ? 'Russian' : 'Uzbek');
  const styleHint = finalStyle === 'auto'
    ? 'Choose the most appropriate theme for the topic.'
    : `Prefer this theme id if it fits: ${finalStyle}.`;

  const systemPrompt = [
    'You create premium but simple slide decks for a university web slide studio.',
    `Write all slide text in ${languageHint}.`,
    'Return only structured deck JSON. Do not include markdown, code fences, or explanations.',
    'Every slide must be easy to understand for beginners.',
    'Use concise wording. Each bullet should stay short and scannable.',
    'Vary layouts across the deck so it feels designed, not repetitive.',
    'First slide must work like a cover. Last slide must work like a closing slide.',
    styleHint,
    'Allowed themes:',
    themeHints
  ].join('\n');

  const userMessage = [
    `Topic: ${prompt}`,
    audience ? `Audience: ${audience}` : 'Audience: general',
    `Slide count: ${finalCount}`,
    `Requested style: ${finalStyle}`,
    'Make the structure presentation-ready, modern, and visually clear.',
    'Use honest, informative content only.'
  ].join('\n');

  try {
    const { parsed, model, generationMode } = await requestGroqSlideDeckJson({ systemPrompt, userMessage });
    const deck = normalizeSlideDeckPayload(parsed, {
      prompt,
      slideCount: finalCount,
      styleRequested: finalStyle,
      watermark
    });
    deck.aiProvider = 'groq';
    deck.aiModel = model;
    deck.generationMode = generationMode || deck.generationMode || 'ai';
    return deck;
  } catch (e) {
    const fallbackThemeId = SLIDE_THEME_MAP.has(finalStyle) ? finalStyle : 'teal-minimal';
    const deck = createFallbackSlideDeck({
      prompt,
      slideCount: finalCount,
      themeId: fallbackThemeId,
      watermark
    });
    deck.aiProvider = 'groq';
    deck.aiModel = 'fallback';
    deck.generationMode = 'fallback';
    deck.fallbackReason = cleanText(e?.message || e, 280);
    return deck;
  }
}

function serializeSlideDeck(deck, { includeSlides = true } = {}) {
  if (!deck) return null;
  const src = (typeof deck.toObject === 'function') ? deck.toObject() : deck;
  const out = {
    _id: String(src._id || ''),
    title: cleanText(src.title, 200),
    subtitle: cleanText(src.subtitle, 240),
    summary: cleanText(src.summary, 600),
    prompt: cleanText(src.prompt, 3000),
    audience: cleanText(src.audience, 160),
    language: normalizeSlideStudioLanguage(src.language),
    styleRequested: cleanText(src.styleRequested, 64) || 'auto',
    themeId: cleanText(src.themeId, 64) || 'teal-minimal',
    themeLabel: cleanText(src.themeLabel, 120),
    slideCount: clampSlideCount(src.slideCount),
    watermark: cleanText(src.watermark, 200),
    heroImageUrl: cleanText(src.heroImageUrl, 500),
    researchSummary: cleanText(src.researchSummary, 1800),
    sourceLinks: Array.isArray(src.sourceLinks) ? src.sourceLinks.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 10) : [],
    aiProvider: cleanText(src.aiProvider, 32),
    aiModel: cleanText(src.aiModel, 120),
    generationMode: cleanText(src.generationMode, 32) || 'ai',
    createdAt: src.createdAt || null,
    updatedAt: src.updatedAt || null
  };

  if (includeSlides) {
    out.slides = Array.isArray(src.slides)
      ? src.slides.map((slide, idx) => ({
          order: Math.max(1, Number(slide?.order || idx + 1)),
          layout: SLIDE_LAYOUTS.includes(String(slide?.layout || '').trim()) ? String(slide.layout).trim() : 'content',
          kicker: cleanText(slide?.kicker, 120),
          title: cleanText(slide?.title, 220),
          subtitle: cleanText(slide?.subtitle, 260),
          body: cleanText(slide?.body, 1000),
          bullets: normalizeStringList(slide?.bullets, { maxItems: 6, maxLen: 160 }),
          leftTitle: cleanText(slide?.leftTitle, 120),
          leftBullets: normalizeStringList(slide?.leftBullets, { maxItems: 5, maxLen: 160 }),
          rightTitle: cleanText(slide?.rightTitle, 120),
          rightBullets: normalizeStringList(slide?.rightBullets, { maxItems: 5, maxLen: 160 }),
          stats: normalizeStatsList(slide?.stats),
          timeline: normalizeTimelineList(slide?.timeline),
          quote: cleanText(slide?.quote, 320),
          quoteAuthor: cleanText(slide?.quoteAuthor, 120),
          imageUrl: cleanText(slide?.imageUrl, 500),
          imageCaption: cleanText(slide?.imageCaption, 160),
          sourceLinks: Array.isArray(slide?.sourceLinks) ? slide.sourceLinks.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 3) : [],
          callout: cleanText(slide?.callout, 220),
          speakerNote: cleanText(slide?.speakerNote, 400)
        }))
      : [];
  }

  return out;
}

const SLIDE_THEME_TOKENS = {
  'teal-minimal': { bg: 'FBFFFE', surface: 'EEF7F5', text: '163633', strong: '0D2623', muted: '5C7671', accent: '0F8F83', accentText: 'FFFFFF', border: 'D8ECE8' },
  'executive-white': { bg: 'FFFFFF', surface: 'F4F8F7', text: '203D3B', strong: '102422', muted: '5A6C69', accent: '0A6F66', accentText: 'FFFFFF', border: 'DEE8E6' },
  'midnight-teal': { bg: '081C1E', surface: '102D30', text: 'DFFAF5', strong: 'EFFDFA', muted: 'A7D8D0', accent: '77D0C4', accentText: '062422', border: '214447' },
  'blueprint-grid': { bg: 'EFF8F7', surface: 'FFFFFF', text: '1B3D3A', strong: '0F2725', muted: '5A7774', accent: '126D82', accentText: 'FFFFFF', border: 'D9E8E7' },
  'editorial-warm': { bg: 'FCFAF6', surface: 'FFFFFF', text: '3F3B34', strong: '25211B', muted: '6D665D', accent: 'B76B3A', accentText: 'FFFFFF', border: 'E9E1D4' },
  'campus-card': { bg: 'F5FBFA', surface: 'FFFFFF', text: '1E3F3C', strong: '122826', muted: '58706C', accent: '149F92', accentText: 'FFFFFF', border: 'DBECE9' },
  'heritage-royal': { bg: 'F7F0E1', surface: 'FFF9F0', text: '1D2F52', strong: '10203F', muted: '6A5B46', accent: 'C79A3B', accentText: 'FFFFFF', border: 'E7D8BC' },
  'forest-emerald': { bg: 'F3FAF6', surface: 'FFFFFF', text: '173C34', strong: '0F291F', muted: '587067', accent: '2F8F6B', accentText: 'FFFFFF', border: 'D9ECE2' },
  'sunset-signal': { bg: 'FFF7EF', surface: 'FFFFFF', text: '5A2418', strong: '3D170F', muted: '8C5A4D', accent: 'E46A3A', accentText: 'FFFFFF', border: 'F1D6C8' },
  'berry-luxe': { bg: 'FCF4F8', surface: 'FFFFFF', text: '45243A', strong: '2E1627', muted: '7B5A6C', accent: 'A14C7A', accentText: 'FFFFFF', border: 'EBD7E3' },
  'graphite-coral': { bg: '1C232B', surface: '273039', text: 'F6EDEA', strong: 'FFF8F5', muted: 'C7B7B2', accent: 'F06B5D', accentText: '1C232B', border: '3D4A54' }
};

function getSlideThemeTokens(themeId) {
  return SLIDE_THEME_TOKENS[String(themeId || '').trim()] || SLIDE_THEME_TOKENS['teal-minimal'];
}

function sanitizeDownloadName(value, ext = '') {
  const base = cleanText(value, 120)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'hallaym-slide-deck';
  return ext ? `${base}.${ext}` : base;
}

function guessImageMimeType(url, contentType) {
  const explicit = String(contentType || '').toLowerCase();
  if (explicit.includes('svg')) return 'image/svg+xml';
  if (explicit.includes('png')) return 'image/png';
  if (explicit.includes('jpeg') || explicit.includes('jpg')) return 'image/jpeg';
  if (explicit.includes('webp')) return 'image/webp';
  if (/\.svg(\?|$)/i.test(String(url || ''))) return 'image/svg+xml';
  if (/\.png(\?|$)/i.test(String(url || ''))) return 'image/png';
  if (/\.webp(\?|$)/i.test(String(url || ''))) return 'image/webp';
  return 'image/jpeg';
}

function bufferToDataUri(buffer, mimeType) {
  if (!buffer || !buffer.length) return '';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function isSafeSlideExportAssetUrl(rawUrl) {
  const value = cleanText(rawUrl, 1000);
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    const host = String(parsed.hostname || '').trim().toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const octets = host.split('.').map((item) => Number(item));
      if (octets.length !== 4 || octets.some((item) => !Number.isFinite(item) || item < 0 || item > 255)) return false;
      if (octets[0] === 0 || octets[0] === 10 || octets[0] === 127) return false;
      if (octets[0] === 169 && octets[1] === 254) return false;
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
      if (octets[0] === 192 && octets[1] === 168) return false;
    }
    if (host.includes(':')) {
      if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function loadImageAssetByUrl(imageUrl) {
  const url = cleanText(imageUrl, 500);
  if (!url) return null;
  try {
    const out = await fetchBinaryWithTimeout(url, { timeoutMs: 12000 });
    const mimeType = guessImageMimeType(url, out?.contentType);
    if (mimeType === 'image/webp') return null;
    return {
      buffer: out?.buffer || null,
      mimeType,
      dataUri: bufferToDataUri(out?.buffer, mimeType)
    };
  } catch (_) {
    return null;
  }
}

async function loadDeckImageAssetMap(deck) {
  const urls = Array.from(new Set(
    []
      .concat(cleanText(deck?.heroImageUrl, 500) ? [cleanText(deck.heroImageUrl, 500)] : [])
      .concat((Array.isArray(deck?.slides) ? deck.slides : []).map((slide) => cleanText(slide?.imageUrl, 500)))
      .filter(Boolean)
  ));
  const entries = await Promise.all(urls.map(async (url) => [url, await loadImageAssetByUrl(url)]));
  return new Map(entries.filter((item) => item[0] && item[1]));
}

function resolveSlideAsset(assetMap, deck, slide) {
  const imageUrl = cleanText(slide?.imageUrl || deck?.heroImageUrl, 500);
  return imageUrl ? (assetMap.get(imageUrl) || null) : null;
}

function buildExportRenderDeck(deck, assetMap) {
  const safeDeck = serializeSlideDeck(deck, true);
  const out = Object.assign({}, safeDeck, {
    heroImageDataUri: ''
  });
  const heroUrl = cleanText(safeDeck?.heroImageUrl, 500);
  if (heroUrl && assetMap?.has(heroUrl)) {
    out.heroImageDataUri = String(assetMap.get(heroUrl)?.dataUri || '');
  }
  out.slides = Array.isArray(safeDeck?.slides)
    ? safeDeck.slides.map((slide) => {
        const imageUrl = cleanText(slide?.imageUrl, 500);
        return Object.assign({}, slide, {
          imageDataUri: imageUrl && assetMap?.has(imageUrl) ? String(assetMap.get(imageUrl)?.dataUri || '') : ''
        });
      })
    : [];
  return out;
}

function buildSlideTextBlocks(slide) {
  const bullets = normalizeStringList(slide?.bullets, { maxItems: 6, maxLen: 160 });
  const leftBullets = normalizeStringList(slide?.leftBullets, { maxItems: 5, maxLen: 160 });
  const rightBullets = normalizeStringList(slide?.rightBullets, { maxItems: 5, maxLen: 160 });
  const stats = normalizeStatsList(slide?.stats);
  const timeline = normalizeTimelineList(slide?.timeline);
  const body = cleanText(slide?.body, 1000);
  return {
    body,
    bullets,
    leftBullets,
    rightBullets,
    stats,
    timeline,
    bulletText: bullets.map((item) => `- ${item}`).join('\n'),
    leftText: leftBullets.map((item) => `- ${item}`).join('\n'),
    rightText: rightBullets.map((item) => `- ${item}`).join('\n'),
    statsText: stats.map((item) => `${item.label}: ${item.value}`).join('\n'),
    timelineText: timeline.map((item) => `${item.title}: ${item.detail}`).join('\n')
  };
}

function composeSourceSummary(deck, slide) {
  const copy = getSlideCopy(deck?.language);
  const links = Array.from(new Set(
    []
      .concat(Array.isArray(slide?.sourceLinks) ? slide.sourceLinks : [])
      .concat(Array.isArray(deck?.sourceLinks) ? deck.sourceLinks : [])
      .filter(Boolean)
  )).slice(0, 3);
  return links.length ? `${copy.sourceLabel}: ${links.join(' | ')}` : `${copy.sourceLabel}: HALLAYM AI research`;
}

async function buildSlideDeckPptxBuffer(deck) {
  const pptx = new PptxGenJS();
  const assetMap = await loadDeckImageAssetMap(deck);
  const renderDeck = buildExportRenderDeck(deck, assetMap);
  const slidePngs = await renderDeckSlidePngBuffers(renderDeck);
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'HALLAYM AI';
  pptx.company = 'HALLAYM';
  pptx.subject = cleanText(deck?.title, 180);
  pptx.title = cleanText(deck?.title, 180);
  pptx.lang = normalizeSlideStudioLanguage(deck?.language);
  slidePngs.forEach((buffer) => {
    const page = pptx.addSlide();
    page.addImage({
      data: bufferToDataUri(buffer, 'image/png'),
      x: 0,
      y: 0,
      w: 13.333,
      h: 7.5
    });
  });
  return pptx.write({ outputType: 'nodebuffer' });
}

async function streamSlideDeckPdf(res, deck) {
  const assetMap = await loadDeckImageAssetMap(deck);
  const renderDeck = buildExportRenderDeck(deck, assetMap);
  const slidePngs = await renderDeckSlidePngBuffers(renderDeck);
  const doc = new PDFDocument({ size: [1280, 720], margin: 0 });
  doc.pipe(res);
  slidePngs.forEach((buffer, index) => {
    if (index > 0) doc.addPage({ size: [1280, 720], margin: 0 });
    doc.image(buffer, 0, 0, { width: 1280, height: 720 });
  });
  doc.end();
}

app.post('/api/assistant/ai', authenticateToken, async (req, res) => {
  try {
    if (denyIfMuted(req, res)) return;
    const userId = String(req.userId || '').trim();
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const rate = takeAssistantAiRateSlot(`u:${userId}`);
    if (!rate.ok) {
      return res.status(429).json({
        error: 'Too many AI requests. Please wait a bit.',
        retryAfterSec: rate.retryAfterSec
      });
    }

    const mode = normalizeAssistantMode(req.body?.mode);
    const message = cleanText(req.body?.message, 1500);
    if (!message) return res.status(400).json({ error: 'message required' });
    const history = normalizeAssistantHistory(req.body?.history);
    const context = normalizeAssistantContext(req.body?.context);

    const me = await User.findById(userId)
      .select('fullName nickname username role university faculty studyType studyGroup teachingSubject teachingSubjects')
      .lean()
      .catch(() => null);

    const systemPrompt = buildAssistantSystemPrompt({
      mode,
      user: me || {},
      context
    });

    const out = await generateAssistantAiAnswer({
      systemPrompt,
      history,
      userMessage: message,
      req
    });

    return res.json({
      success: true,
      answer: cleanText(out?.answer, 4000),
      provider: String(out?.provider || ''),
      model: String(out?.model || '')
    });
  } catch (e) {
    const msg = String(e?.message || e || 'AI service unavailable');
    console.error('POST /api/assistant/ai error:', msg);
    if (/missing|configured|provider/i.test(msg)) {
      return res.status(503).json({ error: 'AI provider configured emas. API key ni server .env ga qo\'ying.' });
    }
    return res.status(500).json({ error: 'AI service unavailable' });
  }
});

app.post('/api/slides/generate', authenticateToken, async (req, res) => {
  try {
    if (denyIfMuted(req, res)) return;
    const userId = String(req.userId || '').trim();
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const rate = takeSlideAiRateSlot(`u:${userId}`);
    if (!rate.ok) {
      return res.status(429).json({
        error: 'Too many slide requests. Please wait a bit.',
        retryAfterSec: rate.retryAfterSec
      });
    }

    const prompt = cleanText(req.body?.prompt, 3000);
    if (!prompt || prompt.length < 6) {
      return res.status(400).json({ error: 'prompt required' });
    }

    const audience = cleanText(req.body?.audience, 160);
    const language = normalizeSlideStudioLanguage(req.body?.language);
    const styleRequestedRaw = cleanText(req.body?.styleRequested || req.body?.style || req.body?.themeId, 64);
    const styleRequested = SLIDE_THEME_MAP.has(styleRequestedRaw) ? styleRequestedRaw : 'auto';
    const colorMood = normalizeSlideColorMood(req.body?.colorMood || req.body?.color || req.body?.palette);
    const slideCount = clampSlideCount(req.body?.slideCount);

    const me = await User.findById(userId)
      .select('fullName username role university faculty studyType studyGroup')
      .lean()
      .catch(() => null);
    if (!me) return res.status(404).json({ error: 'User not found' });

    const premiumAccess = await checkPremiumAiAccess(userId, 'slides_generate');
    if (!premiumAccess.ok) {
      return res.status(403).json({
        error: premiumAccess.error || 'Premium required',
        code: premiumAccess.code || 'PREMIUM_REQUIRED',
        redirect: premiumAccess.redirect || '/payment.html?focus=user',
        creditsRemaining: Number(premiumAccess.creditsRemaining || 0)
      });
    }

    const deck = await generateSlideDeckWithGroq({
      user: me,
      prompt,
      audience,
      language,
      styleRequested,
      colorMood,
      slideCount
    });

    const created = await SlideDeck.create({
      userId,
      title: cleanText(deck.title, 200) || cleanText(prompt, 80) || 'Yangi taqdimot',
      subtitle: cleanText(deck.subtitle, 240),
      summary: cleanText(deck.summary, 600),
      prompt,
      audience,
      language,
      styleRequested,
      themeId: cleanText(deck.themeId, 64) || 'teal-minimal',
      themeLabel: cleanText(deck.themeLabel, 120),
      slideCount: Array.isArray(deck.slides) ? deck.slides.length : slideCount,
      watermark: cleanText(deck.watermark, 200),
      heroImageUrl: cleanText(deck.heroImageUrl, 500),
      researchSummary: cleanText(deck.researchSummary, 1800),
      sourceLinks: Array.isArray(deck.sourceLinks) ? deck.sourceLinks.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 10) : [],
      aiProvider: cleanText(deck.aiProvider, 32) || 'hallaym-ai',
      aiModel: cleanText(deck.aiModel, 120),
      generationMode: cleanText(deck.generationMode, 32) || 'ai',
      slides: Array.isArray(deck.slides) ? deck.slides : []
    });

    const creditState = await consumePremiumAiCredits(userId, 'slides_generate');

    return res.json({
      success: true,
      deck: serializeSlideDeck(created),
      themePresets: SLIDE_THEME_PRESETS,
      premium: creditState?.premium || premiumAccess.premium,
      creditsRemaining: Number(creditState?.creditsRemaining ?? premiumAccess.creditsRemaining ?? 0)
    });
  } catch (e) {
    const msg = String(e?.message || e || 'Slide service unavailable');
    console.error('POST /api/slides/generate error:', msg);
    if (/missing|configured|provider/i.test(msg)) {
      return res.status(503).json({ error: 'HALLAYM AI slide xizmati hozircha tayyor emas.' });
    }
    return res.status(500).json({ error: 'Slide service unavailable' });
  }
});

app.get('/api/slides', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.userId || '').trim();
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const limitRaw = Number(req.query.limit || 18);
    const limit = Math.max(1, Math.min(40, Number.isFinite(limitRaw) ? Math.round(limitRaw) : 18));

    const decks = await SlideDeck.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      decks: Array.isArray(decks) ? decks.map((item) => serializeSlideDeck(item, { includeSlides: false })) : [],
      themePresets: SLIDE_THEME_PRESETS
    });
  } catch (e) {
    console.error('GET /api/slides error:', e);
    return res.status(500).json({ error: 'Failed to load slide history' });
  }
});

app.get('/api/slides/:deckId', authenticateToken, async (req, res) => {
  try {
    const deckId = String(req.params.deckId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(deckId)) {
      return res.status(400).json({ error: 'Invalid deck id' });
    }

    const deck = await SlideDeck.findOne({ _id: deckId, userId: req.userId }).lean();
    if (!deck) return res.status(404).json({ error: 'Slide deck not found' });

    return res.json({
      success: true,
      deck: serializeSlideDeck(deck)
    });
  } catch (e) {
    console.error('GET /api/slides/:deckId error:', e);
    return res.status(500).json({ error: 'Failed to load slide deck' });
  }
});

app.get('/api/slides/:deckId/export.pdf', authenticateToken, async (req, res) => {
  try {
    const deckId = String(req.params.deckId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(deckId)) {
      return res.status(400).json({ error: 'Invalid deck id' });
    }

    const deck = await SlideDeck.findOne({ _id: deckId, userId: req.userId }).lean();
    if (!deck) return res.status(404).json({ error: 'Slide deck not found' });

    const fileName = sanitizeDownloadName(deck.title || 'hallaym-slide-deck', 'pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await streamSlideDeckPdf(res, serializeSlideDeck(deck));
  } catch (e) {
    console.error('GET /api/slides/:deckId/export.pdf error:', e);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to export PDF' });
    }
    res.end();
  }
});

app.get('/api/slides/export-asset', authenticateToken, async (req, res) => {
  try {
    const imageUrl = cleanText(req.query?.url, 1000);
    if (!isSafeSlideExportAssetUrl(imageUrl)) {
      return res.status(400).json({ error: 'Invalid asset url' });
    }
    const out = await fetchBinaryWithTimeout(imageUrl, {
      timeoutMs: 15000,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    const mimeType = guessImageMimeType(imageUrl, out?.contentType);
    if (!/^image\//i.test(mimeType)) {
      return res.status(400).json({ error: 'Asset is not an image' });
    }
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=900');
    return res.end(out?.buffer || Buffer.alloc(0));
  } catch (e) {
    console.error('GET /api/slides/export-asset error:', e);
    return res.status(500).json({ error: 'Failed to load export asset' });
  }
});

app.get('/api/slides/:deckId/export.pptx', authenticateToken, async (req, res) => {
  try {
    const deckId = String(req.params.deckId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(deckId)) {
      return res.status(400).json({ error: 'Invalid deck id' });
    }

    const deck = await SlideDeck.findOne({ _id: deckId, userId: req.userId }).lean();
    if (!deck) return res.status(404).json({ error: 'Slide deck not found' });

    const serializedDeck = serializeSlideDeck(deck);
    const buffer = await buildSlideDeckPptxBuffer(serializedDeck);
    const fileName = sanitizeDownloadName(deck.title || 'hallaym-slide-deck', 'pptx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.end(buffer);
  } catch (e) {
    console.error('GET /api/slides/:deckId/export.pptx error:', e);
    return res.status(500).json({ error: 'Failed to export PPTX' });
  }
});

app.delete('/api/slides/:deckId', authenticateToken, async (req, res) => {
  try {
    const deckId = String(req.params.deckId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(deckId)) {
      return res.status(400).json({ error: 'Invalid deck id' });
    }

    const removed = await SlideDeck.findOneAndDelete({ _id: deckId, userId: req.userId }).lean();
    if (!removed) return res.status(404).json({ error: 'Slide deck not found' });

    return res.json({
      success: true,
      deckId
    });
  } catch (e) {
    console.error('DELETE /api/slides/:deckId error:', e);
    return res.status(500).json({ error: 'Failed to delete slide deck' });
  }
});

function normalizeWebsiteColor(value, fallback) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  return fallback;
}

function normalizeWebsiteSlugInput(value, fallback = 'startup-site') {
  const out = normalizeWebsiteRenderSlug(String(value || '').trim());
  return out || normalizeWebsiteRenderSlug(fallback || 'startup-site');
}

function normalizeWebsiteFeatureFlags(raw) {
  return {
    authEnabled: raw?.authEnabled !== false,
    waitlistEnabled: raw?.waitlistEnabled !== false,
    contactEnabled: raw?.contactEnabled !== false
  };
}

function normalizeWebsiteMetrics(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      label: cleanText(item?.label, 70),
      value: cleanText(item?.value, 40)
    }))
    .filter((item) => item.label && item.value)
    .slice(0, 4);
}

function normalizeWebsiteItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      title: cleanText(item?.title || item?.label, 120),
      body: cleanText(item?.body || item?.detail || item?.quote, 260),
      value: cleanText(item?.value, 48),
      meta: cleanText(item?.meta || item?.author, 120)
    }))
    .filter((item) => item.title || item.body || item.value)
    .slice(0, 6);
}

function normalizeWebsiteSections(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((section) => ({
      type: cleanText(section?.type, 40) || 'section',
      kicker: cleanText(section?.kicker, 80),
      title: cleanText(section?.title, 120),
      subtitle: cleanText(section?.subtitle, 240),
      items: normalizeWebsiteItems(section?.items)
    }))
    .filter((section) => section.title && section.items.length)
    .slice(0, 5);
}

function normalizeWebsiteList(list, { maxItems = 6, maxLen = 120 } = {}) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => cleanText(item, maxLen)).filter(Boolean).slice(0, maxItems);
}

function normalizeWebsiteCopyBlock(raw, defaults = {}) {
  const block = raw && typeof raw === 'object' ? raw : {};
  return {
    headline: cleanText(block.headline, 140) || defaults.headline || '',
    subheadline: cleanText(block.subheadline, 220) || defaults.subheadline || '',
    helper: cleanText(block.helper, 200) || defaults.helper || '',
    benefits: normalizeWebsiteList(block.benefits, { maxItems: 5, maxLen: 90 }),
    checklist: normalizeWebsiteList(block.checklist, { maxItems: 5, maxLen: 90 })
  };
}

function normalizeWebsiteProjectPayload(raw, input = {}, meta = {}) {
  const featureFlags = normalizeWebsiteFeatureFlags(raw?.serverFeatures || input?.serverFeatures || {});
  const startupName = cleanText(raw?.startupName || input?.startupName || input?.prompt || 'Startup site', 90) || 'Startup site';
  const summary = cleanText(raw?.summary || input?.prompt || `${startupName} uchun premium startup landing.`, 320);
  return {
    startupName,
    slug: normalizeWebsiteSlugInput(raw?.slug || raw?.subdomainSuggestion || input?.slug || startupName, startupName),
    prompt: cleanText(input?.prompt, 1600),
    audience: cleanText(raw?.audience || input?.audience, 140),
    category: cleanText(raw?.category || input?.category, 80),
    tone: cleanText(raw?.tone || input?.tone, 80),
    templateId: cleanText(raw?.templateId || input?.templateId, 40) || 'startup-pitch',
    seoTitle: cleanText(raw?.seoTitle || `${startupName} | HALLAYM startup site`, 120),
    seoDescription: cleanText(raw?.seoDescription || summary, 220),
    kicker: cleanText(raw?.kicker || 'HALLAYM AI website', 80),
    summary,
    brandLine: cleanText(raw?.brandLine || `${startupName} competition-ready website`, 140),
    heroTitle: cleanText(raw?.heroTitle || startupName, 140),
    heroSubtitle: cleanText(raw?.heroSubtitle || summary, 260),
    heroCardTitle: cleanText(raw?.heroCardTitle || 'AI bilan tayyorlangan landing va auth oqimi', 120),
    heroChecklist: normalizeWebsiteList(raw?.heroChecklist || ['Landing page', 'Register / Login', 'Lead yig\'ish', 'Subdomain publish'], { maxItems: 5, maxLen: 70 }),
    ctaPrimary: cleanText(raw?.ctaPrimary || 'Boshlash', 50),
    ctaSecondary: cleanText(raw?.ctaSecondary || 'Batafsil', 50),
    finalCtaTitle: cleanText(raw?.finalCtaTitle || `${startupName} ni ishga tushirishga tayyormisiz?`, 140),
    finalCtaBody: cleanText(raw?.finalCtaBody || 'Minimal server funksiyalar va startup competition uchun kerakli landing bu yerda tayyor.', 220),
    finalCtaPrimary: cleanText(raw?.finalCtaPrimary || 'Akkaunt ochish', 60),
    finalCtaSecondary: cleanText(raw?.finalCtaSecondary || 'Aloqa qoldirish', 60),
    highlights: normalizeWebsiteList(raw?.highlights || ['Tanlov uchun mos landing', 'Tez registratsiya', 'Lead yig\'ish'], { maxItems: 6, maxLen: 70 }),
    metrics: normalizeWebsiteMetrics(raw?.metrics || []),
    sections: normalizeWebsiteSections(raw?.sections || []),
    registerCopy: normalizeWebsiteCopyBlock(raw?.registerCopy, {
      headline: `${startupName} ga qo'shiling`,
      subheadline: 'Yangi foydalanuvchi uchun minimal register sahifasi.',
      helper: 'Form backend bilan bog\'langan.'
    }),
    loginCopy: normalizeWebsiteCopyBlock(raw?.loginCopy, {
      headline: `${startupName} akkauntiga kiring`,
      subheadline: 'Mavjud foydalanuvchi uchun minimal login sahifasi.',
      helper: 'Session local token orqali saqlanadi.'
    }),
    accountCopy: normalizeWebsiteCopyBlock(raw?.accountCopy, {
      headline: 'A\'zo kabineti',
      subheadline: 'Ro\'yxatdan o\'tgan foydalanuvchi uchun minimal account sahifasi.'
    }),
    serverFeatures: featureFlags,
    palette: {
      accent: normalizeWebsiteColor(raw?.palette?.accent, '#14968b'),
      accentSoft: normalizeWebsiteColor(raw?.palette?.accentSoft, '#6fd8cb'),
      highlight: normalizeWebsiteColor(raw?.palette?.highlight, '#f0b348'),
      dark: normalizeWebsiteColor(raw?.palette?.dark, '#082026'),
      surface: normalizeWebsiteColor(raw?.palette?.surface, '#f6fcfb')
    },
    footerText: cleanText(raw?.footerText || `${startupName} powered by HALLAYM AI website studio`, 180),
    aiProvider: cleanText(meta?.aiProvider || raw?.aiProvider || 'template', 32),
    aiModel: cleanText(meta?.aiModel || raw?.aiModel, 120),
    generationMode: cleanText(meta?.generationMode || raw?.generationMode || 'template', 32),
    status: raw?.status === 'draft' ? 'draft' : 'published',
    publishedAt: meta?.publishedAt || new Date()
  };
}

function buildWebsiteProjectFallback(input = {}) {
  const startupName = cleanText(input.startupName || input.prompt || 'Startup site', 90) || 'Startup site';
  const templateId = cleanText(input.templateId, 40) || 'startup-pitch';
  const prompt = cleanText(input.prompt, 1600);
  const audience = cleanText(input.audience, 140) || 'startup jury va early users';
  const category = cleanText(input.category, 80) || 'startup';
  return normalizeWebsiteProjectPayload({
    startupName,
    templateId,
    summary: prompt || `${startupName} uchun startup competition-ready landing page.`,
    brandLine: `${category} yo'nalishidagi premium web taqdimot`,
    heroTitle: `${startupName} bilan ${audience} uchun aniq va chiroyli yechim`,
    heroSubtitle: prompt || `${startupName} uchun landing page, login/register va lead yig'ish oqimi bitta saytda ishlaydi.`,
    heroChecklist: ['Landing page', 'Register / Login', 'Contact / Waitlist', 'Subdomain publish'],
    highlights: ['AI tayyorlangan copy', 'Minimal server funksiyalar', 'Tanlov uchun tayyor ko\'rinish'],
    metrics: [
      { value: '1 kun', label: 'Tez ishga tushirish' },
      { value: '4 sahifa', label: 'Landing + auth + account' },
      { value: '24/7', label: 'Online preview' }
    ],
    sections: [
      {
        type: 'features',
        kicker: 'Why it works',
        title: 'Startup tanlovlari uchun kerakli asosiy bloklar',
        subtitle: 'Investor yoki hakam bir qarashda g\'oyani tushunishi uchun.',
        items: [
          { title: 'Aniq pitch', body: 'Muammo, yechim va qiymat taklifi qisqa va ravshan bloklarda beriladi.' },
          { title: 'Minimal auth', body: 'Register va login oqimi early access yoki demo foydalanuvchilar uchun tayyor bo\'ladi.' },
          { title: 'Lead yig\'ish', body: 'Waitlist yoki contact form orqali qiziqqan foydalanuvchilar saqlanadi.' }
        ]
      },
      {
        type: 'steps',
        kicker: 'Launch flow',
        title: 'Qanday ishlaydi',
        subtitle: 'HALLAYM AI tayyorlaydi, siz esa publish qilib yuborasiz.',
        items: [
          { title: '1. G\'oya kiritiladi', body: 'Startup nima qilishi va kim uchun ekanini yozasiz.' },
          { title: '2. AI website tayyorlaydi', body: 'Landing, register, login va account sahifalari yaratiladi.' },
          { title: '3. Subdomain beriladi', body: 'Slug asosida edu.hallaym.site subdomain tayyor bo\'ladi.' }
        ]
      }
    ],
    registerCopy: {
      headline: `${startupName} early access`,
      subheadline: 'Demo va beta foydalanuvchilar uchun tez register sahifasi.',
      benefits: ['Tez kirish', 'Minimal forma', 'Competition-ready flow']
    },
    loginCopy: {
      headline: `${startupName} ga qayta kirish`,
      subheadline: 'Mavjud foydalanuvchi akkauntiga kiradi.',
      benefits: ['Email login', 'Minimal auth', 'Account preview']
    },
    accountCopy: {
      headline: `${startupName} account`,
      subheadline: 'User ichki sahifasi va keyingi qadamlar.',
      checklist: ['Demo ko\'rish', 'Pitch deck tayyorlash', 'Jamoa bilan ulashish']
    },
    serverFeatures: input.serverFeatures || { authEnabled: true, waitlistEnabled: true, contactEnabled: true }
  }, input, { aiProvider: 'hallaym-ai', generationMode: 'template' });
}

async function ensureUniqueWebsiteSlug(baseSlug, ignoreId = '') {
  let slug = normalizeWebsiteSlugInput(baseSlug);
  let index = 2;
  while (true) {
    const found = await WebsiteProject.findOne({
      slug,
      ...(ignoreId && mongoose.Types.ObjectId.isValid(ignoreId) ? { _id: { $ne: ignoreId } } : {})
    }).select('_id').lean();
    if (!found) return slug;
    slug = `${normalizeWebsiteSlugInput(baseSlug).slice(0, 26)}-${index}`;
    index += 1;
  }
}

async function requestGroqWebsiteProjectJson({ systemPrompt, userMessage }) {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  const model = String(process.env.GROQ_WEBSITE_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const { content } = await requestOpenAiCompatibleChat({
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey,
    model,
    systemPrompt,
    history: [],
    userMessage,
    temperature: 0.35,
    maxTokens: 2600,
    responseFormat: { type: 'json_object' }
  });
  const parsed = parseJsonObjectLoose(content);
  if (!parsed || typeof parsed !== 'object') throw new Error('Website AI JSON parse failed');
  return { parsed, model, generationMode: 'ai' };
}

async function generateStartupWebsiteProject({ user, startupName, slug, prompt, audience, category, tone, templateId, serverFeatures }) {
  const input = {
    startupName,
    slug,
    prompt,
    audience,
    category,
    tone,
    templateId,
    serverFeatures
  };
  const fallback = buildWebsiteProjectFallback(input);
  try {
    const systemPrompt = [
      'You are HALLAYM AI and you create startup competition-ready micro websites for a university platform.',
      'Return only JSON. Do not mention Groq, providers, prompts, JSON, or internal tooling.',
      'The result must include a premium landing page and minimal register, login, and member area copy.',
      'Keep it realistic, polished, modern, and investor-friendly.',
      'All visible copy must stay in Uzbek unless the prompt explicitly asks for another language.',
      'Prefer crisp sections, clear CTA text, and compact content blocks.',
      'Use tasteful color palette values as hex colors.'
    ].join('\n');
    const userMessage = [
      `Startup name: ${startupName}`,
      `Preferred slug: ${slug}`,
      `Prompt: ${prompt}`,
      `Audience: ${audience || 'startup jury and early users'}`,
      `Category: ${category || 'startup'}`,
      `Tone: ${tone || 'premium and simple'}`,
      `Template direction: ${templateId || 'startup-pitch'}`,
      `Server features: auth=${serverFeatures?.authEnabled !== false}, waitlist=${serverFeatures?.waitlistEnabled !== false}, contact=${serverFeatures?.contactEnabled !== false}`,
      `Owner name: ${cleanText(user?.fullName || user?.username, 80) || 'Founder'}`
    ].join('\n');
    const { parsed, model, generationMode } = await requestGroqWebsiteProjectJson({ systemPrompt, userMessage });
    return normalizeWebsiteProjectPayload(parsed, input, { aiProvider: 'hallaym-ai', aiModel: model, generationMode });
  } catch (e) {
    console.warn('website ai generation fallback:', String(e?.message || e || 'fallback'));
    return fallback;
  }
}

function getPublicAppOrigin(req) {
  const direct = String(process.env.PUBLIC_APP_URL || process.env.PUBLIC_ORIGIN || process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (direct) return direct;
  if (req && typeof req.protocol === 'string' && typeof req.get === 'function') {
    const host = String(req.get('host') || '').trim();
    if (host) return `${req.protocol}://${host}`.replace(/\/+$/, '');
  }
  return 'https://edu.hallaym.site';
}

function serializeWebsiteProject(project, stats = {}, options = {}) {
  const origin = String(options?.origin || '').trim();
  const links = buildWebsiteLinks(project?.slug || '', { origin });
  return {
    id: String(project?._id || ''),
    startupName: cleanText(project?.startupName, 90),
    slug: cleanText(project?.slug, 40),
    summary: cleanText(project?.summary, 320),
    templateId: cleanText(project?.templateId, 40),
    status: cleanText(project?.status, 20) || 'published',
    audience: cleanText(project?.audience, 140),
    category: cleanText(project?.category, 80),
    tone: cleanText(project?.tone, 80),
    prompt: cleanText(project?.prompt, 1600),
    serverFeatures: project?.serverFeatures || {},
    palette: project?.palette || {},
    aiProvider: cleanText(project?.aiProvider, 40),
    aiModel: cleanText(project?.aiModel, 120),
    generationMode: cleanText(project?.generationMode, 32),
    previewUrl: links.previewUrl,
    publishedUrl: links.publishedUrl,
    publishedAliasUrl: links.wildcardUrl,
    pageLinks: {
      index: links.previewUrl,
      register: links.registerPreviewUrl,
      login: links.loginPreviewUrl,
      account: links.accountPreviewUrl
    },
    publishedPageLinks: {
      index: links.publishedUrl,
      register: links.registerPublishedUrl,
      login: links.loginPublishedUrl,
      account: links.accountPublishedUrl
    },
    leadCount: Number(stats?.leadCount || 0),
    memberCount: Number(stats?.memberCount || 0),
    createdAt: project?.createdAt,
    updatedAt: project?.updatedAt,
    publishedAt: project?.publishedAt
  };
}

function extractWebsiteBuilderSlugFromHost(host) {
  const cleanHost = String(host || '').split(':')[0].trim().toLowerCase();
  const suffix = '.edu.hallaym.site';
  if (!cleanHost.endsWith(suffix)) return '';
  const prefix = cleanHost.slice(0, -suffix.length);
  if (!prefix || prefix.includes('.')) return '';
  return normalizeWebsiteSlugInput(prefix);
}

async function loadWebsiteProjectBySlug(slug, { allowDraft = false } = {}) {
  if (!slug) return null;
  const query = allowDraft ? { slug } : { slug, status: 'published' };
  return WebsiteProject.findOne(query).lean();
}

async function tryServeGeneratedWebsiteRequest({ req, res, slug, pageSlug, allowDraft = false, preview = false, routeBase = '' }) {
  const project = await loadWebsiteProjectBySlug(slug, { allowDraft });
  if (!project) return false;
  const html = renderWebsiteProjectHtml(project, {
    pageSlug: normalizeWebsiteRenderPageSlug(pageSlug),
    preview,
    origin: getPublicAppOrigin(req),
    routeBase
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
  return true;
}

function signWebsiteMemberToken(member, project) {
  return jwt.sign({
    scope: 'site-member',
    websiteId: String(project?._id || ''),
    siteMemberId: String(member?._id || ''),
    subdomain: String(project?.slug || '')
  }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

async function authenticateWebsiteMember(req, slug) {
  const auth = String(req.headers.authorization || '').trim();
  if (!auth.toLowerCase().startsWith('bearer ')) throw new Error('Token required');
  const token = auth.slice(7).trim();
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded?.scope !== 'site-member') throw new Error('Invalid token');
  const project = await loadWebsiteProjectBySlug(slug, { allowDraft: true });
  if (!project) throw new Error('Website not found');
  if (String(decoded.websiteId || '') !== String(project._id || '')) throw new Error('Token mismatch');
  const member = await WebsiteMember.findOne({ _id: decoded.siteMemberId, websiteId: project._id }).lean();
  if (!member) throw new Error('Member not found');
  return { project, member };
}

app.get('/api/websites/templates', authenticateToken, async (req, res) => {
  return res.json({ success: true, templates: WEBSITE_TEMPLATE_PRESETS });
});

app.get('/api/websites', authenticateToken, async (req, res) => {
  try {
    const projects = await WebsiteProject.find({ ownerId: req.userId }).sort({ updatedAt: -1 }).limit(24).lean();
    const enriched = await Promise.all((projects || []).map(async (project) => {
      const [leadCount, memberCount] = await Promise.all([
        WebsiteLead.countDocuments({ websiteId: project._id }),
        WebsiteMember.countDocuments({ websiteId: project._id })
      ]);
      return serializeWebsiteProject(project, { leadCount, memberCount }, { origin: getPublicAppOrigin(req) });
    }));
    return res.json({ success: true, templates: WEBSITE_TEMPLATE_PRESETS, projects: enriched });
  } catch (e) {
    console.error('GET /api/websites error:', e);
    return res.status(500).json({ error: 'Failed to load websites' });
  }
});

app.post('/api/websites/generate', authenticateToken, async (req, res) => {
  try {
    if (denyIfMuted(req, res)) return;
    const startupName = cleanText(req.body?.startupName, 90);
    const prompt = cleanText(req.body?.prompt, 1800);
    if (!startupName || !prompt) {
      return res.status(400).json({ error: 'startupName and prompt required' });
    }
    const audience = cleanText(req.body?.audience, 140);
    const category = cleanText(req.body?.category, 80);
    const tone = cleanText(req.body?.tone, 80);
    const templateId = cleanText(req.body?.templateId, 40) || 'startup-pitch';
    const desiredSlug = normalizeWebsiteSlugInput(req.body?.slug || startupName, startupName);
    const uniqueSlug = await ensureUniqueWebsiteSlug(desiredSlug);
    const serverFeatures = normalizeWebsiteFeatureFlags(req.body?.serverFeatures || {});
    const premiumAccess = await checkPremiumAiAccess(req.userId, 'website_generate');
    if (!premiumAccess.ok) {
      return res.status(403).json({
        error: premiumAccess.error || 'Premium required',
        code: premiumAccess.code || 'PREMIUM_REQUIRED',
        redirect: premiumAccess.redirect || '/payment.html?focus=user',
        creditsRemaining: Number(premiumAccess.creditsRemaining || 0)
      });
    }
    const me = await User.findById(req.userId).select('fullName username').lean().catch(() => null);
    const projectPayload = await generateStartupWebsiteProject({
      user: me || {},
      startupName,
      slug: uniqueSlug,
      prompt,
      audience,
      category,
      tone,
      templateId,
      serverFeatures
    });
    projectPayload.slug = await ensureUniqueWebsiteSlug(projectPayload.slug || uniqueSlug);
    projectPayload.status = 'published';
    projectPayload.publishedAt = new Date();

    const created = await WebsiteProject.create({
      ownerId: req.userId,
      ...projectPayload
    });

    const creditState = await consumePremiumAiCredits(req.userId, 'website_generate');

    return res.json({
      success: true,
      project: serializeWebsiteProject(created, {}, { origin: getPublicAppOrigin(req) }),
      templates: WEBSITE_TEMPLATE_PRESETS,
      premium: creditState?.premium || premiumAccess.premium,
      creditsRemaining: Number(creditState?.creditsRemaining ?? premiumAccess.creditsRemaining ?? 0)
    });
  } catch (e) {
    console.error('POST /api/websites/generate error:', e);
    return res.status(500).json({ error: 'Failed to generate website' });
  }
});

app.get('/api/websites/:projectId', authenticateToken, async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const project = await WebsiteProject.findOne({ _id: projectId, ownerId: req.userId }).lean();
    if (!project) return res.status(404).json({ error: 'Website project not found' });
    const [leadCount, memberCount, recentLeads, recentMembers] = await Promise.all([
      WebsiteLead.countDocuments({ websiteId: project._id }),
      WebsiteMember.countDocuments({ websiteId: project._id }),
      WebsiteLead.find({ websiteId: project._id }).sort({ createdAt: -1 }).limit(8).lean(),
      WebsiteMember.find({ websiteId: project._id }).sort({ createdAt: -1 }).limit(8).lean()
    ]);
    return res.json({
      success: true,
      project: serializeWebsiteProject(project, { leadCount, memberCount }, { origin: getPublicAppOrigin(req) }),
      recentLeads: (recentLeads || []).map((item) => ({
        id: String(item._id || ''),
        leadType: cleanText(item.leadType, 20),
        name: cleanText(item.name, 90),
        email: cleanText(item.email, 120),
        company: cleanText(item.company, 120),
        message: cleanText(item.message, 240),
        createdAt: item.createdAt
      })),
      recentMembers: (recentMembers || []).map((item) => ({
        id: String(item._id || ''),
        fullName: cleanText(item.fullName, 120),
        email: cleanText(item.email, 120),
        company: cleanText(item.company, 120),
        createdAt: item.createdAt,
        lastLoginAt: item.lastLoginAt
      }))
    });
  } catch (e) {
    console.error('GET /api/websites/:projectId error:', e);
    return res.status(500).json({ error: 'Failed to load website project' });
  }
});

app.post('/api/websites/:projectId/publish', authenticateToken, async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const status = String(req.body?.status || 'published').trim().toLowerCase() === 'draft' ? 'draft' : 'published';
    const updated = await WebsiteProject.findOneAndUpdate(
      { _id: projectId, ownerId: req.userId },
      { $set: { status, publishedAt: status === 'published' ? new Date() : null } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'Website project not found' });
    const [leadCount, memberCount] = await Promise.all([
      WebsiteLead.countDocuments({ websiteId: updated._id }),
      WebsiteMember.countDocuments({ websiteId: updated._id })
    ]);
    return res.json({ success: true, project: serializeWebsiteProject(updated, { leadCount, memberCount }, { origin: getPublicAppOrigin(req) }) });
  } catch (e) {
    console.error('POST /api/websites/:projectId/publish error:', e);
    return res.status(500).json({ error: 'Failed to update publish status' });
  }
});

app.delete('/api/websites/:projectId', authenticateToken, async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const project = await WebsiteProject.findOneAndDelete({ _id: projectId, ownerId: req.userId }).lean();
    if (!project) return res.status(404).json({ error: 'Website project not found' });
    await Promise.all([
      WebsiteLead.deleteMany({ websiteId: project._id }),
      WebsiteMember.deleteMany({ websiteId: project._id })
    ]);
    return res.json({ success: true, projectId });
  } catch (e) {
    console.error('DELETE /api/websites/:projectId error:', e);
    return res.status(500).json({ error: 'Failed to delete website project' });
  }
});

app.get(['/site-preview/:slug', '/site-preview/:slug/:pageSlug'], async (req, res) => {
  try {
    const safeSlug = normalizeWebsiteSlugInput(req.params.slug);
    const handled = await tryServeGeneratedWebsiteRequest({
      req,
      res,
      slug: safeSlug,
      pageSlug: req.params.pageSlug || 'index',
      allowDraft: true,
      preview: true,
      routeBase: `/site-preview/${safeSlug}`
    });
    if (handled) return;
    return res.status(404).send('Website preview not found');
  } catch (e) {
    console.error('GET /site-preview error:', e);
    return res.status(500).send('Website preview unavailable');
  }
});

app.get(['/site/:slug', '/site/:slug/:pageSlug'], async (req, res) => {
  try {
    const safeSlug = normalizeWebsiteSlugInput(req.params.slug);
    const handled = await tryServeGeneratedWebsiteRequest({
      req,
      res,
      slug: safeSlug,
      pageSlug: req.params.pageSlug || 'index',
      allowDraft: false,
      preview: false,
      routeBase: `/site/${safeSlug}`
    });
    if (handled) return;
    return res.status(404).send('Website not found');
  } catch (e) {
    console.error('GET /site error:', e);
    return res.status(500).send('Website unavailable');
  }
});

app.post('/api/website-builder/public/:slug/register', async (req, res) => {
  try {
    const project = await loadWebsiteProjectBySlug(normalizeWebsiteSlugInput(req.params.slug), { allowDraft: true });
    if (!project) return res.status(404).json({ error: 'Website not found' });
    const fullName = cleanText(req.body?.fullName, 120);
    const email = cleanText(req.body?.email, 160).toLowerCase();
    const company = cleanText(req.body?.company, 120);
    const password = String(req.body?.password || '');
    if (!fullName || !email || password.length < 5) {
      return res.status(400).json({ error: 'fullName, email, and password required' });
    }
    const exists = await WebsiteMember.findOne({ websiteId: project._id, email }).lean();
    if (exists) return res.status(409).json({ error: 'Bu email bilan akkaunt allaqachon mavjud' });
    const passwordHash = await bcrypt.hash(password, 10);
    const member = await WebsiteMember.create({ websiteId: project._id, fullName, email, company, passwordHash, lastLoginAt: new Date() });
    const token = signWebsiteMemberToken(member, project);
    return res.json({
      success: true,
      token,
      member: { id: String(member._id || ''), fullName, email, company }
    });
  } catch (e) {
    console.error('POST /api/website-builder/public/:slug/register error:', e);
    return res.status(500).json({ error: 'Register ishlamadi' });
  }
});

app.post('/api/website-builder/public/:slug/login', async (req, res) => {
  try {
    const project = await loadWebsiteProjectBySlug(normalizeWebsiteSlugInput(req.params.slug), { allowDraft: true });
    if (!project) return res.status(404).json({ error: 'Website not found' });
    const email = cleanText(req.body?.email, 160).toLowerCase();
    const password = String(req.body?.password || '');
    const member = await WebsiteMember.findOne({ websiteId: project._id, email });
    if (!member) return res.status(404).json({ error: 'Akkaunt topilmadi' });
    const ok = await bcrypt.compare(password, member.passwordHash || '');
    if (!ok) return res.status(401).json({ error: 'Parol noto\'g\'ri' });
    member.lastLoginAt = new Date();
    await member.save();
    const token = signWebsiteMemberToken(member, project);
    return res.json({
      success: true,
      token,
      member: { id: String(member._id || ''), fullName: cleanText(member.fullName, 120), email: cleanText(member.email, 160), company: cleanText(member.company, 120) }
    });
  } catch (e) {
    console.error('POST /api/website-builder/public/:slug/login error:', e);
    return res.status(500).json({ error: 'Login ishlamadi' });
  }
});

app.get('/api/website-builder/public/:slug/me', async (req, res) => {
  try {
    const { project, member } = await authenticateWebsiteMember(req, normalizeWebsiteSlugInput(req.params.slug));
    return res.json({
      success: true,
      website: { startupName: cleanText(project.startupName, 90), slug: cleanText(project.slug, 40) },
      member: {
        id: String(member._id || ''),
        fullName: cleanText(member.fullName, 120),
        email: cleanText(member.email, 160),
        company: cleanText(member.company, 120),
        createdAt: member.createdAt,
        lastLoginAt: member.lastLoginAt
      }
    });
  } catch (e) {
    return res.status(401).json({ error: 'Session topilmadi' });
  }
});

async function storeWebsiteLeadByType(req, res, leadType) {
  try {
    const project = await loadWebsiteProjectBySlug(normalizeWebsiteSlugInput(req.params.slug), { allowDraft: true });
    if (!project) return res.status(404).json({ error: 'Website not found' });
    const name = cleanText(req.body?.name, 120);
    const email = cleanText(req.body?.email, 160).toLowerCase();
    const company = cleanText(req.body?.company, 120);
    const message = cleanText(req.body?.message, 500);
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });
    await WebsiteLead.create({ websiteId: project._id, leadType, name, email, company, message });
    return res.json({
      success: true,
      message: leadType === 'waitlist' ? 'Waitlistga qo\'shildingiz.' : 'Xabaringiz yuborildi.'
    });
  } catch (e) {
    console.error(`POST /api/website-builder/public/:slug/${leadType} error:`, e);
    return res.status(500).json({ error: 'Lead saqlanmadi' });
  }
}

app.post('/api/website-builder/public/:slug/contact', async (req, res) => storeWebsiteLeadByType(req, res, 'contact'));
app.post('/api/website-builder/public/:slug/waitlist', async (req, res) => storeWebsiteLeadByType(req, res, 'waitlist'));

// ==================== GROUP LESSONS API ====================
// List group lessons (recordings) - accessible to group members
app.get('/api/group-lessons', authenticateToken, async (req, res) => {
  try {
    const groupId = String(req.query.groupId || '');
    if (!groupId) return res.status(400).json({ error: 'groupId required' });

    const group = await Group.findById(groupId).select('isPublic members university faculty studyType studyGroup name username').lean();
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const me = await User.findById(req.userId).select('fullName username role isAdmin university faculty').lean().catch(() => null);
    const role = String(me?.role || '').toLowerCase();
    const isAdmin = !!(me?.isAdmin || role === 'admin');
    const isScopedOrganizer = canUserModerateGroupByScope(me, group);
    const isMember = !!(group.isPublic || (group.members || []).some((m) => String(m) === String(req.userId)));
    const isHostTeacher = !!(await GroupLesson.exists({ groupId, hostId: req.userId }).catch(() => null));

    if (!(isMember || isAdmin || isScopedOrganizer || isHostTeacher)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const lessons = await GroupLesson.find({ groupId }).sort({ startedAt: -1 }).limit(200).lean();
    const hostIds = Array.from(new Set(lessons.map(x => String(x.hostId)).filter(Boolean)));
    const hosts = await User.find({ _id: { $in: hostIds } }).select('fullName username role').lean();
    const hmap = new Map(hosts.map(u => [String(u._id), u]));

    return res.json({
      lessons: lessons.map(l => ({
        _id: String(l._id),
        groupId: String(l.groupId),
        callId: l.callId,
        title: l.title || 'Live dars',
        mode: l.mode,
        status: l.status,
        startedAt: l.startedAt,
        endedAt: l.endedAt,
        recordingUrl: l.recordingUrl || '',
        recordingDurationSec: Math.max(0, Math.round(Number(l.recordingDurationSec || 0))),
        liveDurationSec: computeLessonDurationSec(l),
        attendanceVisible: !!(
          isAdmin
          || isScopedOrganizer
          || String(l.hostId || '') === String(req.userId)
        ),
        host: (() => {
          const h = hmap.get(String(l.hostId));
          return h ? { userId: String(h._id), fullName: h.fullName, username: h.username, role: h.role } : { userId: String(l.hostId), fullName: 'Teacher', username: '', role: 'teacher' };
        })(),
        group: {
          _id: String(group._id),
          name: group.name || '',
          username: group.username || '',
          university: group.university || '',
          faculty: group.faculty || '',
          studyType: group.studyType || '',
          studyGroup: group.studyGroup || ''
        }
      }))
    });
  } catch (e) {
    console.error('GET /api/group-lessons error:', e);
    return res.status(500).json({ error: 'Failed to load lessons' });
  }
});

// Download a lesson recording (auth + group member check).
// Used for local /uploads/lessons files where browser download headers are needed.
app.get('/api/group-lessons/download', authenticateToken, async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) return res.status(400).json({ error: 'url required' });

    let recordingUrl = rawUrl;
    try { recordingUrl = decodeURIComponent(rawUrl); } catch (_) {}
    if (!recordingUrl) return res.status(400).json({ error: 'Invalid url' });
    if (/[\r\n]/.test(recordingUrl)) return res.status(400).json({ error: 'Invalid url' });

    const lesson = await GroupLesson.findOne({ recordingUrl }).select('groupId recordingUrl hostId').lean();
    if (!lesson) return res.status(404).json({ error: 'Recording not found' });

    const group = await Group.findById(String(lesson.groupId || '')).select('isPublic members university faculty').lean().catch(() => null);
    const viewer = await User.findById(req.userId).select('role isAdmin university faculty').lean().catch(() => null);
    const isMember = !!(group && (group.isPublic || (group.members || []).some((m) => String(m) === String(req.userId))));
    const isAdmin = !!viewer?.isAdmin || String(viewer?.role || '').toLowerCase() === 'admin';
    const isHost = String(lesson.hostId || '') === String(req.userId || '');
    const isScopedOrganizer = canUserModerateGroupByScope(viewer, group);
    let ok = !!(isMember || isAdmin || isHost || isScopedOrganizer);
    if (!ok) return res.status(403).json({ error: 'Access denied' });

    const recUrl = String(lesson.recordingUrl || '');
    if (!recUrl) return res.status(404).json({ error: 'Recording empty' });

    if (recUrl.startsWith('/uploads/lessons/')) {
      const fs = require('fs');
      const fileName = path.basename(recUrl);
      const baseDir = path.join(__dirname, 'uploads', 'lessons');
      const filePath = path.join(baseDir, fileName);
      if (!filePath.startsWith(baseDir)) return res.status(400).json({ error: 'Invalid path' });
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

      const ext = path.extname(fileName).toLowerCase();
      const mime = (ext === '.mp4') ? 'video/mp4'
        : (ext === '.webm') ? 'video/webm'
        : (ext === '.mov') ? 'video/quicktime'
        : 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.download(filePath, fileName);
    }

    // For remote recordings (e.g., cloud), redirect after access check.
    try {
      const u = new URL(recUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return res.status(400).json({ error: 'Unsupported recording URL' });
      }
      return res.redirect(u.toString());
    } catch (_) {
      return res.status(400).json({ error: 'Invalid recording URL' });
    }
  } catch (e) {
    console.error('GET /api/group-lessons/download error:', e);
    return res.status(500).json({ error: 'Failed to download recording' });
  }
});

// Attendance report (teacher only: host or admin). Returns joined + absent lists.
// Attendance report (teacher only: host or admin). Returns joined + absent lists.
app.get('/api/group-lessons/:lessonId/attendance', authenticateToken, attachUserRole, async (req, res) => {
  try {
    const lessonId = String(req.params.lessonId || '');
    const lesson = await GroupLesson.findById(lessonId).lean();
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const isHost = String(lesson.hostId) === String(req.userId);

    // Host/admin should be allowed even if they are not in members (common in real use),
    // but for safety we still validate group existence.
    const group = await Group.findById(String(lesson.groupId)).select('isPublic members university faculty').lean();
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const me = await User.findById(req.userId).select('role isAdmin university faculty username').lean().catch(() => null);
    const role = String(me?.role || req.userRole || '').toLowerCase();
    const isAdmin = !!(me?.isAdmin || role === 'admin');
    const isScopedOrganizer = canUserModerateGroupByScope(me, group);

    if (!(isAdmin || isHost || isScopedOrganizer)) {
      return res.status(403).json({ error: 'Attendance is visible only to lesson teacher, admin, or scoped organizer' });
    }

    // For public groups, ok. For private groups, host/admin already allowed above.
    // (If you ever want to restrict admins too, add membership check here.)
    const memberIds = (group.members || []).map(String).filter(Boolean);

    const atts = await GroupAttendance.find({ lessonId }).lean();
    const attMap = new Map(atts.map(a => [String(a.userId), a]));

    // Fetch members (for absent list). If members list is empty, return empty arrays (no crash).
    const members = memberIds.length
      ? await User.find({ _id: { $in: memberIds } }).select('fullName username role').lean()
      : [];

    const joined = [];
    const absent = [];
    const nowMs = Date.now();
    const lessonDurationSec = computeLessonDurationSec(lesson, nowMs);

    for (const u of members) {
      const a = attMap.get(String(u._id));
      if (a) {
        const joinedMs = a?.joinedAt ? new Date(a.joinedAt).getTime() : nowMs;
        const leftMs = a?.leftAt ? new Date(a.leftAt).getTime() : null;
        const liveDuration = Math.max(0, Math.floor(((leftMs || nowMs) - joinedMs) / 1000));
        joined.push({
          userId: String(u._id),
          fullName: u.fullName,
          username: u.username,
          role: u.role,
          joinedAt: a.joinedAt,
          leftAt: a.leftAt,
          durationSec: liveDuration
        });
      } else {
        // Only count students as absent (teachers/admins not)
        if (String(u.role || '').toLowerCase() === 'student') {
          absent.push({ userId: String(u._id), fullName: u.fullName, username: u.username });
        }
      }
    }

    // Sort joined by joinedAt
    joined.sort((a,b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());

    return res.json({
      lessonId,
      groupId: String(lesson.groupId),
      joined,
      absent,
      lessonDurationSec,
      recordingDurationSec: Number(lesson.recordingDurationSec || 0),
      serverNow: new Date(nowMs).toISOString()
    });
  } catch (e) {
    console.error('GET /api/group-lessons/:lessonId/attendance error:', e);
    return res.status(500).json({ error: 'Failed to load attendance' });
  }
});

function getLessonUploadsTmpDir() {
  const fsx = require('fs');
  const dir = path.join(__dirname, 'uploads', 'lessons_tmp');
  try { fsx.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

function getLessonUploadsFinalDir() {
  const fsx = require('fs');
  const dir = path.join(__dirname, 'uploads', 'lessons');
  try { fsx.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

async function finalizeLessonRecordingFromPath({ lesson, filePath, incomingTitle = '', fallbackDurationSec = 0 }) {
  const fsx = require('fs');
  const fsp = fsx.promises;
  const lessonId = String(lesson?._id || '');
  const groupId = String(lesson?.groupId || '');
  let uploadResult = null;
  const hasCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

  async function saveLocalFromPath(srcPath) {
    const uploadsDir = getLessonUploadsFinalDir();
    const stat = await fsp.stat(srcPath);
    const ext = (path.extname(srcPath || '') || '.webm').toLowerCase();
    const fname = `lesson_${lessonId}_${Date.now()}${ext || '.webm'}`;
    const dest = path.join(uploadsDir, fname);
    try {
      await fsp.rename(srcPath, dest);
    } catch (_) {
      await fsp.copyFile(srcPath, dest);
      try { await fsp.unlink(srcPath); } catch (_) {}
    }
    const url = `/uploads/lessons/${fname}`;
    return { secure_url: url, url, public_id: '', bytes: stat.size || 0, duration: 0, _local: true };
  }

  if (hasCloudinary) {
    const folder = `schat_lessons/group_${groupId}`;
    try {
      const stat = await fsp.stat(filePath).catch(() => ({ size: 0 }));
      const largeThreshold = 95 * 1024 * 1024;
      if (Number(stat?.size || 0) >= largeThreshold) {
        // More resilient for long lessons / big files.
        uploadResult = await cloudinary.uploader.upload_large(filePath, {
          resource_type: 'video',
          folder,
          overwrite: true,
          chunk_size: 8 * 1024 * 1024,
          eager: [
            { width: 1280, height: 720, crop: 'limit', quality: 'auto', fetch_format: 'mp4' }
          ],
          eager_async: false
        });
      } else {
        uploadResult = await cloudinary.uploader.upload(filePath, {
          resource_type: 'video',
          folder,
          overwrite: true,
          eager: [
            { width: 1280, height: 720, crop: 'limit', quality: 'auto', fetch_format: 'mp4' }
          ],
          eager_async: false
        });
      }
      try { await fsp.unlink(filePath); } catch (_) {}
    } catch (cloudErr) {
      console.warn('Cloudinary upload failed, fallback to local:', cloudErr?.message || cloudErr);
      uploadResult = await saveLocalFromPath(filePath);
    }
  } else {
    uploadResult = await saveLocalFromPath(filePath);
  }

  const parsedUploadDuration = Number(uploadResult?.duration || 0);
  const uploadDurationSec = Number.isFinite(parsedUploadDuration) ? Math.max(0, Math.round(parsedUploadDuration)) : 0;
  const parsedFallbackDuration = Number(fallbackDurationSec || 0);
  const fallbackSec = Number.isFinite(parsedFallbackDuration) ? Math.max(0, Math.round(parsedFallbackDuration)) : 0;
  const resolvedDurationSec = uploadDurationSec > 0 ? uploadDurationSec : fallbackSec;
  if (resolvedDurationSec > 0 && !(uploadDurationSec > 0)) {
    uploadResult.duration = resolvedDurationSec;
  }

  await GroupLesson.updateOne({ _id: lesson._id }, {
    $set: Object.assign({
      recordingUrl: uploadResult.secure_url || uploadResult.url || '',
      recordingPublicId: uploadResult.public_id || '',
      recordingBytes: uploadResult.bytes || 0,
      recordingDurationSec: resolvedDurationSec
    }, (incomingTitle ? { title: incomingTitle } : {}))
  });

  return uploadResult;
}

// Create/resume chunk upload session for lesson recording.
app.post('/api/group-lessons/:lessonId/recording/session', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const lessonId = String(req.params.lessonId || '').trim();
    const lesson = await GroupLesson.findById(lessonId).lean();
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const role = String(req.userRole || '').toLowerCase();
    const isHost = String(lesson.hostId) === String(req.userId);
    if (!(role === 'admin' || isHost)) return res.status(403).json({ error: 'Only host teacher can upload recording' });

    const streaming = String(req.body?.streaming || '').toLowerCase() === 'true' || req.body?.streaming === true || req.body?.streaming === 1;
    const totalBytes = Math.max(0, Number(req.body?.totalBytes || 0));
    if (!streaming && (!Number.isFinite(totalBytes) || totalBytes < 1)) {
      return res.status(400).json({ error: 'totalBytes required' });
    }
    if (!streaming && totalBytes > 3 * 1024 * 1024 * 1024) {
      return res.status(400).json({ error: 'Recording too large' });
    }

    const incomingTitle = String(req.body?.title || '').trim().slice(0, 120);
    const mimeType = String(req.body?.mimeType || 'video/webm').trim() || 'video/webm';
    const fileName = String(req.body?.filename || `lesson_${lessonId}.webm`).trim().slice(0, 180);
    const reqChunk = Number(req.body?.chunkSize || 0);
    const chunkSize = Number.isFinite(reqChunk) && reqChunk >= 256 * 1024 && reqChunk <= 8 * 1024 * 1024
      ? Math.round(reqChunk)
      : (1024 * 1024);

    const activeStates = ['uploading', 'uploaded', 'processing'];
    let session = await GroupLessonUploadSession.findOne({
      lessonId: lesson._id,
      hostId: req.userId,
      status: { $in: activeStates }
    }).sort({ updatedAt: -1 });

    if (session) {
      // If size mismatches, create a new session instead of corrupting offsets.
      const sessionIsStreaming = !(Number(session.totalBytes || 0) > 0);
      if ((!streaming && Number(session.totalBytes || 0) !== Math.round(totalBytes)) || (streaming && !sessionIsStreaming)) {
        session = null;
      } else {
        session.lastSeenAt = new Date();
        if (incomingTitle) session.title = incomingTitle;
        await session.save();
      }
    }

    if (!session) {
      const tmpDir = getLessonUploadsTmpDir();
      const sid = `sess_${uuidv4()}`;
      const tmpPath = path.join(tmpDir, `${lessonId}_${String(req.userId)}_${sid}.part`);
      session = await GroupLessonUploadSession.create({
        lessonId: lesson._id,
        groupId: lesson.groupId,
        hostId: req.userId,
        fileName,
        mimeType,
        title: incomingTitle,
        totalBytes: streaming ? 0 : Math.round(totalBytes),
        uploadedBytes: 0,
        chunkSize,
        tempPath: tmpPath,
        status: 'uploading',
        lastSeenAt: new Date()
      });
    }

    return res.json({
      ok: true,
      sessionId: String(session._id),
      uploadedBytes: Number(session.uploadedBytes || 0),
      totalBytes: Number(session.totalBytes || 0),
      chunkSize: Number(session.chunkSize || chunkSize),
      status: String(session.status || 'uploading'),
      streaming: !(Number(session.totalBytes || 0) > 0)
    });
  } catch (e) {
    console.error('POST /api/group-lessons/:lessonId/recording/session error:', e);
    return res.status(500).json({ error: 'Failed to create upload session' });
  }
});

// Get active upload session state (used after re-login/device switch).
app.get('/api/group-lessons/:lessonId/recording/session', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const lessonId = String(req.params.lessonId || '').trim();
    const lesson = await GroupLesson.findById(lessonId).lean();
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const role = String(req.userRole || '').toLowerCase();
    const isHost = String(lesson.hostId) === String(req.userId);
    if (!(role === 'admin' || isHost)) return res.status(403).json({ error: 'Only host teacher can view upload session' });

    const session = await GroupLessonUploadSession.findOne({
      lessonId: lesson._id,
      hostId: req.userId,
      status: { $in: ['uploading', 'uploaded', 'processing', 'completed'] }
    }).sort({ updatedAt: -1 }).lean();

    if (!session) return res.json({ ok: true, session: null });
    return res.json({
      ok: true,
      session: {
        sessionId: String(session._id),
        uploadedBytes: Number(session.uploadedBytes || 0),
        totalBytes: Number(session.totalBytes || 0),
        chunkSize: Number(session.chunkSize || 1024 * 1024),
        status: String(session.status || ''),
        recordingUrl: String(session.recordingUrl || ''),
        streaming: !(Number(session.totalBytes || 0) > 0)
      }
    });
  } catch (e) {
    console.error('GET /api/group-lessons/:lessonId/recording/session error:', e);
    return res.status(500).json({ error: 'Failed to load upload session' });
  }
});

// Upload one binary chunk to an existing session.
app.patch('/api/group-lessons/:lessonId/recording/session/:sessionId/chunk',
  authenticateToken,
  attachUserRole,
  requireRole(['teacher', 'admin']),
  express.raw({ type: 'application/octet-stream', limit: '10mb' }),
  async (req, res) => {
    try {
      const lessonId = String(req.params.lessonId || '').trim();
      const sessionId = String(req.params.sessionId || '').trim();
      const lesson = await GroupLesson.findById(lessonId).lean();
      if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

      const role = String(req.userRole || '').toLowerCase();
      const isHost = String(lesson.hostId) === String(req.userId);
      if (!(role === 'admin' || isHost)) return res.status(403).json({ error: 'Only host teacher can upload recording' });

      const session = await GroupLessonUploadSession.findOne({ _id: sessionId, lessonId: lesson._id });
      if (!session) return res.status(404).json({ error: 'Upload session not found' });
      if (String(session.hostId) !== String(req.userId) && role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden session owner' });
      }
      if (session.status === 'completed') {
        return res.json({
          ok: true,
          uploadedBytes: Number(session.uploadedBytes || 0),
          totalBytes: Number(session.totalBytes || 0),
          complete: true
        });
      }
      if (session.status === 'processing') return res.status(409).json({ error: 'Session is processing', status: 'processing' });

      const startByte = Number(req.headers['x-start-byte'] || req.headers['x-offset'] || req.query.start || 0);
      if (!Number.isFinite(startByte) || startByte < 0) return res.status(400).json({ error: 'Invalid start byte' });

      const expectedStart = Number(session.uploadedBytes || 0);
      if (startByte !== expectedStart) {
        return res.status(409).json({ error: 'Offset mismatch', expectedStart });
      }

      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (!buf.length) return res.status(400).json({ error: 'Chunk body empty' });

      const fsx = require('fs');
      const fsp = fsx.promises;
      const tmpPath = String(session.tempPath || '').trim();
      if (!tmpPath) return res.status(400).json({ error: 'Session temp path missing' });
      try { fsx.mkdirSync(path.dirname(tmpPath), { recursive: true }); } catch (_) {}
      await fsp.appendFile(tmpPath, buf);

      session.uploadedBytes = expectedStart + buf.length;
      const streaming = !(Number(session.totalBytes || 0) > 0);
      const rawDurationSec = Number(req.headers['x-duration-sec'] || req.query.durationSec || 0);
      if (Number.isFinite(rawDurationSec) && rawDurationSec > 0) {
        session.recordingDurationSec = Math.max(
          Math.round(Number(session.recordingDurationSec || 0)),
          Math.round(rawDurationSec)
        );
      }
      session.status = streaming
        ? 'uploading'
        : (session.uploadedBytes >= Number(session.totalBytes || 0) ? 'uploaded' : 'uploading');
      session.lastSeenAt = new Date();
      session.error = '';
      await session.save();

      const total = Number(session.totalBytes || 0);
      const uploaded = Number(session.uploadedBytes || 0);
      const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((uploaded / total) * 100))) : 0;
      return res.json({
        ok: true,
        uploadedBytes: uploaded,
        totalBytes: total,
        percent,
        complete: total > 0 ? uploaded >= total : false,
        streaming
      });
    } catch (e) {
      console.error('PATCH /api/group-lessons/:lessonId/recording/session/:sessionId/chunk error:', e);
      return res.status(500).json({ error: 'Failed to upload chunk' });
    }
  }
);

// Finalize chunk upload: persist to Cloudinary/local and update GroupLesson.
app.post('/api/group-lessons/:lessonId/recording/session/:sessionId/complete', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const lessonId = String(req.params.lessonId || '').trim();
    const sessionId = String(req.params.sessionId || '').trim();
    const lesson = await GroupLesson.findById(lessonId).lean();
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const role = String(req.userRole || '').toLowerCase();
    const isHost = String(lesson.hostId) === String(req.userId);
    if (!(role === 'admin' || isHost)) return res.status(403).json({ error: 'Only host teacher can complete recording' });

    let session = await GroupLessonUploadSession.findOne({ _id: sessionId, lessonId: lesson._id });
    if (!session) return res.status(404).json({ error: 'Upload session not found' });
    if (String(session.hostId) !== String(req.userId) && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden session owner' });
    }
    if (session.status === 'completed' && String(session.recordingUrl || '').trim()) {
      return res.json({
        ok: true,
        recordingUrl: session.recordingUrl,
        publicId: session.recordingPublicId || '',
        bytes: Number(session.recordingBytes || 0),
        duration: Number(session.recordingDurationSec || 0),
        resumed: true
      });
    }

    const totalBytes = Number(session.totalBytes || 0);
    const readyToFinalize = totalBytes > 0
      ? Number(session.uploadedBytes || 0) >= totalBytes
      : Number(session.uploadedBytes || 0) > 0;
    if (!readyToFinalize) {
      return res.status(409).json({
        error: 'Upload not finished',
        uploadedBytes: Number(session.uploadedBytes || 0),
        totalBytes
      });
    }

    // Concurrency guard:
    // two tabs/devices can call "complete" at once. Only one may move to processing.
    const locked = await GroupLessonUploadSession.findOneAndUpdate(
      { _id: session._id, status: { $nin: ['processing', 'completed'] } },
      { $set: { status: 'processing', lastSeenAt: new Date(), error: '' } },
      { new: true }
    );
    if (!locked) {
      const latest = await GroupLessonUploadSession.findById(session._id).lean().catch(() => null);
      if (String(latest?.status || '') === 'completed' && String(latest?.recordingUrl || '').trim()) {
        return res.json({
          ok: true,
          recordingUrl: String(latest.recordingUrl || ''),
          publicId: String(latest.recordingPublicId || ''),
          bytes: Number(latest.recordingBytes || 0),
          duration: Number(latest.recordingDurationSec || 0),
          resumed: true
        });
      }
      return res.status(409).json({ error: 'Session is processing', status: String(latest?.status || 'processing') });
    }
    session = locked;

    const tempPath = String(session.tempPath || '').trim();
    if (!tempPath) return res.status(400).json({ error: 'Session temp file missing' });
    const fsx = require('fs');
    try {
      await fsx.promises.stat(tempPath);
    } catch (_) {
      await GroupLessonUploadSession.updateOne(
        { _id: session._id },
        { $set: { status: 'failed', error: 'temp file missing', lastSeenAt: new Date() } }
      ).catch(() => {});
      return res.status(404).json({ error: 'Temp recording file not found' });
    }

    const incomingTitle = String(req.body?.title || session.title || '').trim().slice(0, 120);
    const rawDurationSec = Number(req.body?.durationSec || session.recordingDurationSec || 0);
    const fallbackDurationSec = Number.isFinite(rawDurationSec) ? Math.max(0, Math.round(rawDurationSec)) : 0;
    const uploadResult = await finalizeLessonRecordingFromPath({ lesson, filePath: tempPath, incomingTitle, fallbackDurationSec });

    session.status = 'completed';
    session.completedAt = new Date();
    session.lastSeenAt = new Date();
    session.recordingUrl = uploadResult.secure_url || uploadResult.url || '';
    session.recordingPublicId = uploadResult.public_id || '';
    session.recordingBytes = uploadResult.bytes || 0;
    session.recordingDurationSec = Math.max(0, Math.round(Number(uploadResult.duration || fallbackDurationSec || 0)));
    await session.save();

    return res.json({
      ok: true,
      recordingUrl: uploadResult.secure_url || uploadResult.url || '',
      publicId: uploadResult.public_id || '',
      bytes: uploadResult.bytes || 0,
      duration: Number(uploadResult.duration || fallbackDurationSec || 0)
    });
  } catch (e) {
    console.error('POST /api/group-lessons/:lessonId/recording/session/:sessionId/complete error:', e);
    try {
      const sessionId = String(req.params.sessionId || '').trim();
      if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
        await GroupLessonUploadSession.updateOne({ _id: sessionId }, {
          $set: { status: 'failed', error: String(e?.message || 'complete failed').slice(0, 400), lastSeenAt: new Date() }
        });
      }
    } catch (_) {}
    return res.status(500).json({ error: 'Failed to finalize recording upload' });
  }
});

// Upload recording (teacher host only). Client sends multipart form-data with field "recording".
app.post('/api/group-lessons/:lessonId/recording', authenticateToken, attachUserRole, requireRole(['teacher','admin']), recordingUpload.single('recording'), async (req, res) => {
  try {
    const lessonId = String(req.params.lessonId || '');
    const lesson = await GroupLesson.findById(lessonId).lean();
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const role = String(req.userRole || '').toLowerCase();
    const isHost = String(lesson.hostId) === String(req.userId);
    if (!(role === 'admin' || isHost)) return res.status(403).json({ error: 'Only host teacher can upload recording' });

    const incomingTitle = (req.body && req.body.title ? String(req.body.title) : '').trim();
    const rawDurationSec = Number(req.body?.durationSec || 0);
    const fallbackDurationSec = Number.isFinite(rawDurationSec) ? Math.max(0, Math.round(rawDurationSec)) : 0;

    if (!req.file) return res.status(400).json({ error: 'No recording file uploaded' });

    // Legacy one-shot upload endpoint (kept for backwards compatibility).
    // Prefer multer disk temp path to avoid loading huge files into memory.
    const fsx = require('fs');
    const tmpDir = getLessonUploadsTmpDir();
    let tempPath = String(req.file.path || '').trim();
    if (!tempPath) {
      tempPath = path.join(tmpDir, `${lessonId}_${String(req.userId)}_legacy_${Date.now()}.part`);
      if (Buffer.isBuffer(req.file.buffer) && req.file.buffer.length > 0) {
        await fsx.promises.writeFile(tempPath, req.file.buffer);
      } else {
        return res.status(400).json({ error: 'Recording temp file is missing' });
      }
    }

    const uploadResult = await finalizeLessonRecordingFromPath({ lesson, filePath: tempPath, incomingTitle, fallbackDurationSec });

    return res.json({
      ok: true,
      recordingUrl: uploadResult.secure_url || uploadResult.url || '',
      publicId: uploadResult.public_id || '',
      bytes: uploadResult.bytes || 0,
      duration: Number(uploadResult.duration || fallbackDurationSec || 0)
    });

  } catch (e) {
    console.error('POST /api/group-lessons/:lessonId/recording error:', e);
    return res.status(500).json({ error: 'Failed to upload recording' });
  }
});


// Update lesson metadata (title/mode) - host teacher/admin only
app.put('/api/group-lessons/:lessonId/meta', authenticateToken, attachUserRole, requireRole(['teacher','admin']), async (req, res) => {
  try {
    const lessonId = String(req.params.lessonId || '');
    const lesson = await GroupLesson.findById(lessonId).lean();
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const role = String(req.userRole || '').toLowerCase();
    const isHost = String(lesson.hostId) === String(req.userId);
    if (!(role === 'admin' || isHost)) return res.status(403).json({ error: 'Only host teacher can update lesson' });

    const title = (req.body && req.body.title ? String(req.body.title) : '').trim();
    const mode = (req.body && req.body.mode ? String(req.body.mode) : '').trim();

    const $set = {};
    if (title) $set.title = title.slice(0, 120);
    if (mode && (mode === 'camera' || mode === 'screen')) $set.mode = mode;

    if (!Object.keys($set).length) return res.json({ ok: true, updated: false });

    await GroupLesson.updateOne({ _id: lesson._id }, { $set });
    return res.json({ ok: true, updated: true });
  } catch (e) {
    console.error('PUT /api/group-lessons/:lessonId/meta error:', e);
    return res.status(500).json({ error: 'Failed to update lesson meta' });
  }
});




// ==================== ADMIN MIDDLEWARE ====================
// Admin check uses DB (authoritative). We keep it simple + secure.
async function requireAdmin(req, res, next) {
  try {
    const u = await User.findById(req.userId).select('isAdmin role username').lean();
    if (!u || (!u.isAdmin && u.role !== 'admin')) {
      return res.status(403).json({ error: 'Admin required' });
    }
    req.adminUser = u;
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Admin check failed' });
  }
}

async function requireOrganizerOrAdmin(req, res, next) {
  try {
    const u = await User.findById(req.userId).select('isAdmin role username university faculty studyType studyGroup').lean();
    const rawRole = String(u?.role || '').toLowerCase();
    const isAdmin = !!u?.isAdmin || rawRole === 'admin';
    const role = isAdmin ? 'admin' : rawRole;
    const ok = !!(isAdmin || role === 'organizer');
    if (!ok) return res.status(403).json({ error: 'Organizer or admin required' });
    req.scopeUser = {
      _id: u?._id,
      username: u?.username || '',
      role,
      isAdmin,
      university: cleanText(u?.university, 180),
      faculty: cleanText(u?.faculty, 180),
      studyType: cleanText(u?.studyType, 80),
      studyGroup: cleanText(u?.studyGroup, 80)
    };
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Role check failed' });
  }
}

async function resolveScopedUniversity(req, requestedUniversity) {
  const scope = req.scopeUser || {};
  const role = String(scope.role || '').toLowerCase();
  const isAdmin = !!(scope.isAdmin || role === 'admin');
  const ownUniRaw = cleanText(scope.university, 180);
  const requestedRaw = cleanText(requestedUniversity, 180);

  if (requestedRaw) {
    const requestedDoc = await findUniversityDocInsensitive(requestedRaw);
    if (!requestedDoc) return { ok: false, error: 'Unknown university. Configure catalog first.' };
    if (!isAdmin && ownUniRaw && String(requestedDoc.name || '') !== String(ownUniRaw)) {
      return { ok: false, error: 'Organizer can manage only own university' };
    }
    return { ok: true, university: String(requestedDoc.name || '').trim() };
  }

  if (!isAdmin) {
    if (!ownUniRaw) return { ok: false, error: 'University scope is missing on your profile' };
    const ownDoc = await findUniversityDocInsensitive(ownUniRaw);
    if (!ownDoc) return { ok: false, error: 'Unknown university. Configure catalog first.' };
    return { ok: true, university: String(ownDoc.name || '').trim() };
  }

  // Admin fallback: if own profile university is not in catalog, pick first catalog university.
  if (ownUniRaw) {
    const ownDoc = await findUniversityDocInsensitive(ownUniRaw);
    if (ownDoc) return { ok: true, university: String(ownDoc.name || '').trim() };
  }

  const firstUni = await UniversityCatalog.findOne({}).sort({ name: 1 }).lean();
  if (!firstUni?.name) return { ok: false, error: 'No universities found in catalog' };
  return { ok: true, university: String(firstUni.name || '').trim() };
}

function isScopedAdminUser(scope = {}) {
  const role = String(scope.role || '').toLowerCase();
  return !!(scope.isAdmin || role === 'admin');
}

async function resolveScopedFaculty(req, scopedUniversityRaw, requestedFacultyRaw, opts = {}) {
  const options = { requireForAdmin: false, ...opts };
  const scope = req.scopeUser || {};
  const isAdmin = isScopedAdminUser(scope);
  const scopedUniversity = cleanText(scopedUniversityRaw, 180);
  const requestedFaculty = cleanText(requestedFacultyRaw, 180);

  const uniDoc = scopedUniversity
    ? await UniversityCatalog.findOne({ name: scopedUniversity }).lean().catch(() => null)
    : null;

  if (isAdmin) {
    if (!requestedFaculty) {
      if (options.requireForAdmin) return { ok: false, error: 'faculty required' };
      return { ok: true, faculty: '', isAdmin: true };
    }
    const canonicalFaculty = pickCanonicalFaculty(uniDoc, requestedFaculty);
    if (!canonicalFaculty) return { ok: false, error: 'Unknown faculty for selected university' };
    return { ok: true, faculty: canonicalFaculty, isAdmin: true };
  }

  const ownFacultyRaw = cleanText(scope.faculty, 180);
  if (!ownFacultyRaw) return { ok: false, error: 'Faculty scope is missing on your profile' };
  const ownCanonical = pickCanonicalFaculty(uniDoc, ownFacultyRaw) || ownFacultyRaw;
  if (!ownCanonical) return { ok: false, error: 'Faculty scope is missing on your profile' };

  if (requestedFaculty) {
    const requestedCanonical = pickCanonicalFaculty(uniDoc, requestedFaculty) || requestedFaculty;
    if (String(requestedCanonical).toLowerCase() !== String(ownCanonical).toLowerCase()) {
      return { ok: false, error: 'Organizer can manage only own faculty' };
    }
  }

  return { ok: true, faculty: ownCanonical, isAdmin: false };
}

function canUserModerateGroupByScope(userDoc, groupDoc) {
  if (!userDoc || !groupDoc) return false;
  const role = String(userDoc.role || '').toLowerCase();
  const isAdmin = !!(userDoc.isAdmin || role === 'admin');
  if (isAdmin) return true;
  if (role !== 'organizer') return false;

  const userUniversity = cleanText(userDoc.university, 180);
  const userFaculty = cleanText(userDoc.faculty, 180);
  const groupUniversity = cleanText(groupDoc.university, 180);
  const groupFaculty = cleanText(groupDoc.faculty, 180);

  if (!userUniversity || !groupUniversity) return false;
  if (String(userUniversity).toLowerCase() !== String(groupUniversity).toLowerCase()) return false;
  if (!userFaculty) return true;
  if (!groupFaculty) return false;
  return String(userFaculty).toLowerCase() === String(groupFaculty).toLowerCase();
}

// Admin realtime room helpers
function adminEmit(event, payload) {
  io.to('admin').emit(event, payload);
}


// ==================== HELPER FUNCTIONS ====================
// A user can have multiple active sockets (multiple tabs/devices).
function getUserSocketIds(userId) {
  const userData = onlineUsers.get(userId);
  if (!userData) return [];
  // Backward compatibility if old shape is present
  if (userData.socketId) return [userData.socketId];
  return Array.from(userData.sockets || []);
}

// Backward-compatible helper: returns the first socketId if available.
function getUserSocketId(userId) {
  return getUserSocketIds(userId)[0] || null;
}

function emitToUser(userId, event, payload) {
  const socketIds = getUserSocketIds(userId);
  socketIds.forEach((sid) => io.to(sid).emit(event, payload));
}

function isUserOnline(userId) {
  return getUserSocketIds(userId).length > 0;
}

function getChatRoomName(userId1, userId2) {
  const sortedIds = [userId1, userId2].sort();
  return `chat_${sortedIds[0]}_${sortedIds[1]}`;
}

// ==================== SOCKET.IO ====================
// Presence state (in-memory)
// onlineUsers: userId -> { sockets: Set<string>, lastActive: number, lastDbUpdate?: number }
// userSockets: socketId -> userId
const onlineUsers = new Map();
const userSockets = new Map();
const sessionSockets = new Map();
const socketSessions = new Map();

// Group call state (in-memory): groupId -> { callId, startedBy, startedAt, participants: Set<userId> }
const activeGroupCalls = new Map();

// Zakovat state (in-memory): sessionId -> host-centric exam room
// Topology:
// - Host media/audio is sent to everyone.
// - Participant media/audio is sent only to host.
// - Participants never connect to each other.
const activeZakovatSessions = new Map();
const ZAKOVAT_MIN_DURATION_SEC = 5 * 60;
const ZAKOVAT_MAX_DURATION_SEC = 6 * 60 * 60;
const ZAKOVAT_MAX_PARTICIPANTS = Math.max(10, Math.min(200, Number(process.env.ZAKOVAT_MAX_PARTICIPANTS || 80)));

function normalizeZakovatSessionId(raw) {
  const base = cleanText(raw, 120).toLowerCase();
  const normalized = base.replace(/[^a-z0-9:_-]/g, '').slice(0, 80);
  return normalized || '';
}

function isZakovatHostRole(roleRaw, isAdminRaw) {
  const role = String(roleRaw || '').toLowerCase();
  const isAdmin = !!isAdminRaw || role === 'admin';
  return isAdmin || role === 'teacher' || role === 'organizer';
}

function findUserZakovatSession(userId) {
  const uid = String(userId || '');
  if (!uid) return null;
  for (const [sid, session] of activeZakovatSessions.entries()) {
    if (!session || session.status !== 'live') continue;
    if (session.participants && session.participants.has(uid)) return { sessionId: String(sid), session };
  }
  return null;
}

function ensureZakovatSession(userId, sessionId, opts = {}) {
  const sid = normalizeZakovatSessionId(sessionId);
  const uid = String(userId || '');
  if (!sid || !uid) return null;
  let s = activeZakovatSessions.get(sid);
  if (!s) {
    const durationSecRaw = Number(opts.durationSec || (45 * 60));
    const durationSec = Math.max(
      ZAKOVAT_MIN_DURATION_SEC,
      Math.min(ZAKOVAT_MAX_DURATION_SEC, Math.floor(durationSecRaw || 0))
    );
    const startedAt = Date.now();
    s = {
      sessionId: sid,
      title: cleanText(opts.title, 120) || 'Zakovat',
      hostId: uid,
      startedAt,
      endsAt: startedAt + (durationSec * 1000),
      durationSec,
      status: 'live',
      participants: new Set([uid]),
      socketMembers: new Map(), // userId -> Set<socketId>
      lockedUsers: new Set(),
      violations: new Map(), // userId -> { count, reason, at }
      userMeta: new Map() // userId -> { userId, fullName, username, role }
    };
    activeZakovatSessions.set(sid, s);
  }
  return s;
}

function addZakovatSocket(session, userId, socketId) {
  if (!session || !userId || !socketId) return;
  const uid = String(userId);
  const sid = String(socketId);
  let set = session.socketMembers.get(uid);
  if (!set) set = new Set();
  set.add(sid);
  session.socketMembers.set(uid, set);
}

function removeZakovatSocket(session, userId, socketId) {
  if (!session || !userId || !socketId) return 0;
  const uid = String(userId);
  const sid = String(socketId);
  const set = session.socketMembers.get(uid);
  if (!set) return 0;
  set.delete(sid);
  if (!set.size) session.socketMembers.delete(uid);
  else session.socketMembers.set(uid, set);
  return set.size;
}

function getZakovatParticipantsPayload(session) {
  if (!session) return [];
  const out = [];
  for (const uid of Array.from(session.participants || [])) {
    const meta = session.userMeta?.get?.(String(uid)) || {};
    out.push({
      userId: String(uid),
      fullName: String(meta.fullName || ''),
      username: String(meta.username || ''),
      role: String(meta.role || 'student'),
      host: String(uid) === String(session.hostId || '')
    });
  }
  return out;
}

function getZakovatSessionPayload(session, userId) {
  if (!session) return null;
  const now = Date.now();
  const uid = String(userId || '');
  const hostId = String(session.hostId || '');
  return {
    sessionId: String(session.sessionId || ''),
    title: String(session.title || 'Zakovat'),
    hostId,
    isHost: uid && uid === hostId,
    startedAt: Number(session.startedAt || now),
    endsAt: Number(session.endsAt || now),
    durationSec: Number(session.durationSec || 0),
    remainingSec: Math.max(0, Math.floor((Number(session.endsAt || now) - now) / 1000)),
    status: String(session.status || 'live'),
    participants: getZakovatParticipantsPayload(session),
    maxParticipants: ZAKOVAT_MAX_PARTICIPANTS
  };
}

function emitZakovatSession(session) {
  if (!session) return;
  const room = getZakovatRoomName(String(session.sessionId || ''));
  io.to(room).emit('zakovat:session', getZakovatSessionPayload(session, ''));
}

function markZakovatViolation(session, userId, reason) {
  if (!session || !userId) return { count: 0, reason: '' };
  const uid = String(userId);
  const prev = session.violations.get(uid) || { count: 0, reason: '', at: Date.now() };
  const next = {
    count: Number(prev.count || 0) + 1,
    reason: cleanText(reason, 120) || 'policy',
    at: Date.now()
  };
  session.violations.set(uid, next);
  return next;
}

function detachZakovatParticipant(session, userId, reason = 'left') {
  if (!session || !userId) return;
  const uid = String(userId);
  session.participants.delete(uid);
  session.socketMembers.delete(uid);
  io.to(getZakovatRoomName(String(session.sessionId || ''))).emit('zakovat:userLeft', {
    sessionId: String(session.sessionId || ''),
    userId: uid,
    reason: String(reason || 'left'),
    at: Date.now()
  });
}

function endZakovatSession(sessionId, reason = 'ended', endedBy = '') {
  const sid = normalizeZakovatSessionId(sessionId);
  if (!sid) return;
  const session = activeZakovatSessions.get(sid);
  if (!session) return;
  session.status = 'ended';
  activeZakovatSessions.delete(sid);
  io.to(getZakovatRoomName(sid)).emit('zakovat:ended', {
    sessionId: sid,
    reason: String(reason || 'ended'),
    endedBy: String(endedBy || ''),
    endedAt: Date.now()
  });
}

const zakovatTimerInterval = setInterval(() => {
  try {
    const now = Date.now();
    for (const [sid, session] of activeZakovatSessions.entries()) {
      if (!session || session.status !== 'live') continue;
      const remainingSec = Math.max(0, Math.floor((Number(session.endsAt || now) - now) / 1000));
      io.to(getZakovatRoomName(sid)).emit('zakovat:timer', {
        sessionId: String(sid),
        remainingSec,
        now
      });
      if (remainingSec <= 0) {
        endZakovatSession(sid, 'timer_finished', 'system');
      }
    }
  } catch (e) {
    console.warn('zakovat timer warn:', e?.message || e);
  }
}, 1000);
if (typeof zakovatTimerInterval.unref === 'function') zakovatTimerInterval.unref();

// ===== Group Call Stage Control (Owner teacher + Pin) =====
// Stored inside activeGroupCalls entries under call.stage:
//  { ownerTeacherId: string|null, pinnedUserId: string|null, teacherJoinOrder: string[] }
function getCallStage(call){
  if (!call) return null;
  if (!call.stage) call.stage = { ownerTeacherId: null, pinnedUserId: null, teacherJoinOrder: [] };
  if (!Array.isArray(call.stage.teacherJoinOrder)) call.stage.teacherJoinOrder = [];
  return call.stage;
}

function stagePayload(call){
  const st = getCallStage(call);
  return {
    ownerTeacherId: st?.ownerTeacherId ? String(st.ownerTeacherId) : null,
    pinnedUserId: st?.pinnedUserId ? String(st.pinnedUserId) : null
  };
}

function emitGroupStageState(groupId, call){
  try{
    io.to(getGroupRoomName(String(groupId))).emit('groupStageState', {
      groupId: String(groupId),
      callId: String(call?.callId || ''),
      stage: stagePayload(call),
      timestamp: Date.now()
    });
  }catch(e){}
}

function normalizeLabType(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return '';
  if (t.startsWith('phy') || t.includes('fizik')) return 'physics';
  if (t.startsWith('chem') || t.includes('kimyo')) return 'chemistry';
  if (t.startsWith('bio') || t.includes('biolog')) return 'biology';
  return '';
}

function isScienceSubject(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return false;
  return /fizik|physics|kimyo|chem|biolog|bio/.test(t);
}

function getCallLabState(call) {
  if (!call) return null;
  if (!call.labState || typeof call.labState !== 'object') {
    call.labState = {
      enabled: false,
      labType: '',
      state: {},
      sharedStudentId: '',
      controllerId: '',
      updatedAt: Date.now()
    };
  }
  if (!call.labState.state || typeof call.labState.state !== 'object') call.labState.state = {};
  call.labState.labType = normalizeLabType(call.labState.labType);
  call.labState.sharedStudentId = String(call.labState.sharedStudentId || '');
  call.labState.controllerId = String(call.labState.controllerId || '');
  call.labState.enabled = !!call.labState.enabled;
  return call.labState;
}

async function isTeacherUser(userId){
  try{
    const u = await User.findById(userId).select('role isAdmin').lean();
    const role = String(u?.role || '').toLowerCase();
    const isAdmin = !!(u?.isAdmin || role === 'admin');
    return { isTeacher: (role === 'teacher') || isAdmin, isAdmin };
  }catch(e){
    return { isTeacher:false, isAdmin:false };
  }
}

function normalizeTeacherJoinOrder(call){
  const st = getCallStage(call);
  const set = new Set(st.teacherJoinOrder.map(String));
  st.teacherJoinOrder = Array.from(set);
  // Ensure owner is first element if exists
  if (st.ownerTeacherId) {
    const oid = String(st.ownerTeacherId);
    st.teacherJoinOrder = [oid, ...st.teacherJoinOrder.filter(x => String(x) !== oid)];
  }
}

function recalcOwnerIfNeeded(call){
  const st = getCallStage(call);
  normalizeTeacherJoinOrder(call);
  if (st.ownerTeacherId && st.teacherJoinOrder.includes(String(st.ownerTeacherId))) return;
  st.ownerTeacherId = st.teacherJoinOrder.length ? String(st.teacherJoinOrder[0]) : null;
}


// Lesson control owner state (in-memory): lessonId -> { controllerId, updatedAt }
const lessonControllers = new Map();

// Helper: pick initial controller (host teacher)
function setLessonController(lessonId, userId) {
  if (!lessonId) return;
  lessonControllers.set(String(lessonId), { controllerId: String(userId || ''), updatedAt: Date.now() });
}
function getLessonController(lessonId) {
  const st = lessonControllers.get(String(lessonId));
  return st ? st.controllerId : '';
}

// Private call state (in-memory): callId -> { callId, callerId, receiverId, type, status, startedAt }
const activePrivateCalls = new Map();



// Channel live stream state (in-memory): channelId -> { hostId, startedAt, mode, viewers: Set<userId> }
// NOTE: This is a SIMPLE one-to-many WebRTC mesh from host -> each viewer (host uplink scales with viewers).
// Good for MVP/demo. For production-scale, move to SFU (LiveKit/Janus/mediasoup).
const activeChannelLives = new Map();

// Course live sessions state (in-memory): liveId -> { hostId, startedAt, mode, viewers: Set<userId> }
const activeCourseLives = new Map();

// ==================== MINI GAMES (Queue + PVP state) ====================
const MINI_GAME_DAILY_CAPS = Object.freeze({
  solo: 120,
  pvp: 180
});

const MINI_COIN_MISSIONS = Object.freeze([
  {
    key: 'daily_login',
    title: 'Daily login bonus',
    description: 'Har kuni bir marta bonus coin oling.',
    reward: 20,
    cycle: 'daily'
  },
  {
    key: 'daily_chat',
    title: 'Daily chat bonus',
    description: 'Bugun kamida bitta xabar yuboring.',
    reward: 16,
    cycle: 'daily'
  },
  {
    key: 'daily_play',
    title: 'Daily gamer bonus',
    description: 'Bugun mini game oynang.',
    reward: 22,
    cycle: 'daily'
  },
  {
    key: 'profile_complete',
    title: 'Profile completed',
    description: 'Profilni toliq toldirib bir martalik bonus oling.',
    reward: 40,
    cycle: 'once'
  }
]);

const MINI_SOLO_GAMES = Object.freeze(['tap_rush', 'guess_number', 'memory_flip']);

const miniGameQueues = {
  tic_tac_toe: {
    global: [],              // userId[]
    group: new Map(),        // groupId -> userId[]
    duel: new Map()          // pairKey -> Set<userId>
  }
};

// gameId -> state
const activeMiniGames = new Map();
// userId -> gameId
const userMiniGame = new Map();

function getMiniMissionByKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return MINI_COIN_MISSIONS.find((m) => String(m.key) === k) || null;
}

function dayStartLocal(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKeyLocal(date = new Date()) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeMiniScope(scope) {
  const s = String(scope || '').toLowerCase();
  if (s === 'group') return 'group';
  if (s === 'duel') return 'duel';
  return 'global';
}

function miniMissionClaimDayKey(missionKey) {
  const m = getMiniMissionByKey(missionKey);
  if (!m) return dayKeyLocal();
  return String(m.cycle) === 'once' ? 'once' : dayKeyLocal();
}

function duelPairKey(a, b) {
  return [String(a || ''), String(b || '')].sort().join(':');
}

function isObjectIdLike(value) {
  try { return mongoose.Types.ObjectId.isValid(String(value || '')); } catch (_) { return false; }
}

function isProfileCompleteForCoinMission(userDoc) {
  const u = userDoc || {};
  const has = (v) => String(v || '').trim().length > 0;
  const hasShortBio = String(u.bio || '').trim().length >= 8;
  return has(u.fullName) && has(u.nickname) && has(u.university) && has(u.faculty) && has(u.studyType) && has(u.studyGroup) && hasShortBio;
}

function calcSoloReward(gameType, scoreRaw) {
  const game = String(gameType || '').trim().toLowerCase();
  const score = Math.max(0, Math.floor(Number(scoreRaw || 0)));
  if (game === 'tap_rush') {
    return Math.min(60, 6 + Math.floor(score / 11));
  }
  if (game === 'guess_number') {
    // Score should be lower when attempts are lower. Frontend sends 1..20.
    const attempts = Math.max(1, score || 20);
    return Math.max(8, 36 - attempts);
  }
  if (game === 'memory_flip') {
    return Math.min(50, 10 + Math.floor(score / 2));
  }
  return Math.min(30, 6 + Math.floor(score / 10));
}

function summarizeSoloGameResult(gameType, scoreRaw) {
  const game = String(gameType || '').trim().toLowerCase();
  const score = Math.max(0, Math.floor(Number(scoreRaw || 0)));
  if (game === 'tap_rush') {
    if (score >= 340) return 'win';
    if (score >= 180) return 'participate';
    return 'participate';
  }
  if (game === 'guess_number') {
    return (score > 0 && score <= 20) ? 'win' : 'participate';
  }
  if (game === 'memory_flip') {
    if (score >= 12) return 'win';
    return 'participate';
  }
  return 'participate';
}

async function resolveMiniContextForUser(userId, payload = {}) {
  const scope = normalizeMiniScope(payload.scope);
  const out = {
    ok: true,
    scope,
    groupId: '',
    opponentId: ''
  };

  if (scope === 'group') {
    const groupId = String(payload.groupId || '').trim();
    if (!isObjectIdLike(groupId)) return { ok: false, error: 'groupId invalid' };
    const canJoin = await isGroupMember(groupId, userId);
    if (!canJoin) return { ok: false, error: 'Group access denied' };
    out.groupId = groupId;
    return out;
  }

  if (scope === 'duel') {
    const opponentId = String(payload.opponentId || '').trim();
    if (!isObjectIdLike(opponentId)) return { ok: false, error: 'opponentId invalid' };
    if (String(opponentId) === String(userId)) return { ok: false, error: 'You cannot duel yourself' };
    const exists = await User.findById(opponentId).select('_id').lean();
    if (!exists) return { ok: false, error: 'Opponent not found' };
    out.opponentId = opponentId;
    return out;
  }

  return out;
}

function enqueueUnique(arr, userId) {
  const uid = String(userId || '');
  if (!uid) return;
  if (!arr.includes(uid)) arr.push(uid);
}

function dequeueDistinctPair(arr) {
  while (arr.length > 0 && !arr[0]) arr.shift();
  if (arr.length < 2) return null;
  const first = arr.shift();
  let second = null;
  while (arr.length > 0 && !second) {
    const cand = arr.shift();
    if (cand && String(cand) !== String(first)) second = cand;
  }
  if (!second) {
    if (first) arr.unshift(first);
    return null;
  }
  return [String(first), String(second)];
}

function getQueuePosition(arr, userId) {
  if (!Array.isArray(arr)) return 0;
  const pos = arr.findIndex((u) => String(u) === String(userId));
  return pos >= 0 ? (pos + 1) : 0;
}

function emitMiniQueueStateToUser(userId, data = {}) {
  const uid = String(userId || '');
  if (!uid) return;
  emitToUser(uid, 'game:queueState', {
    success: true,
    gameType: 'tic_tac_toe',
    ...data
  });
}

async function tryMatchMiniQueue(gameType, scope, options = {}) {
  const g = String(gameType || '').trim().toLowerCase();
  const s = normalizeMiniScope(scope);
  if (g !== 'tic_tac_toe') return null;

  if (s === 'global') {
    const q = miniGameQueues.tic_tac_toe.global;
    while (q.length >= 2) {
      const pair = dequeueDistinctPair(q);
      if (!pair) break;
      const [u1, u2] = pair;
      if (!isUserOnline(u1) || !isUserOnline(u2)) continue;
      if (userMiniGame.has(u1) || userMiniGame.has(u2)) continue;
      const state = await startTicTacToeGame([u1, u2], { scope: 'global' });
      if (state) return state;
    }
    return null;
  }

  if (s === 'group') {
    const groupId = String(options.groupId || '');
    if (!groupId) return null;
    const q = miniGameQueues.tic_tac_toe.group.get(groupId) || [];
    while (q.length >= 2) {
      const pair = dequeueDistinctPair(q);
      if (!pair) break;
      const [u1, u2] = pair;
      if (!isUserOnline(u1) || !isUserOnline(u2)) continue;
      if (userMiniGame.has(u1) || userMiniGame.has(u2)) continue;
      const state = await startTicTacToeGame([u1, u2], { scope: 'group', groupId });
      if (state) {
        miniGameQueues.tic_tac_toe.group.set(groupId, q);
        return state;
      }
    }
    if (q.length) miniGameQueues.tic_tac_toe.group.set(groupId, q);
    else miniGameQueues.tic_tac_toe.group.delete(groupId);
    return null;
  }

  if (s === 'duel') {
    const pairKey = String(options.pairKey || '');
    if (!pairKey) return null;
    const set = miniGameQueues.tic_tac_toe.duel.get(pairKey);
    if (!set) return null;
    const players = Array.from(set).map(String).filter(Boolean).filter((uid) => isUserOnline(uid) && !userMiniGame.has(uid));
    if (players.length < 2) return null;
    const [u1, u2] = players;
    set.delete(u1);
    set.delete(u2);
    if (!set.size) miniGameQueues.tic_tac_toe.duel.delete(pairKey);
    const opponentId = (String(options.userId || '') === String(u1)) ? u2 : u1;
    const state = await startTicTacToeGame([u1, u2], { scope: 'duel', opponentId });
    return state || null;
  }

  return null;
}

function removeUserFromMiniGameQueues(userId) {
  const uid = String(userId || '');
  if (!uid) return;

  const gq = miniGameQueues.tic_tac_toe.global;
  miniGameQueues.tic_tac_toe.global = gq.filter((u) => String(u) !== uid);

  for (const [gid, arr] of miniGameQueues.tic_tac_toe.group.entries()) {
    const next = (arr || []).filter((u) => String(u) !== uid);
    if (next.length) miniGameQueues.tic_tac_toe.group.set(gid, next);
    else miniGameQueues.tic_tac_toe.group.delete(gid);
  }

  for (const [key, set] of miniGameQueues.tic_tac_toe.duel.entries()) {
    set.delete(uid);
    if (!set.size) miniGameQueues.tic_tac_toe.duel.delete(key);
  }
}

function findTicWinnerSymbol(board) {
  const b = Array.isArray(board) ? board : [];
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a, c, d] of lines) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return '';
}

function boardIsFull(board) {
  return Array.isArray(board) && board.length === 9 && board.every(Boolean);
}

async function getTodayGameCoins(userId, mode) {
  const uid = String(userId || '');
  if (!uid) return 0;
  const match = { userId: new mongoose.Types.ObjectId(uid), createdAt: { $gte: dayStartLocal() } };
  if (mode) match.mode = String(mode);
  const agg = await GameActivity.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$coinsAwarded' } } }
  ]);
  return Number(agg?.[0]?.total || 0);
}

async function creditCoinsWithCap(userId, desiredCoins, mode) {
  const uid = String(userId || '');
  const desired = Math.max(0, Number(desiredCoins || 0));
  if (!uid || !desired) return { awarded: 0, cap: MINI_GAME_DAILY_CAPS[mode] || 0, used: 0 };

  const cap = Number(MINI_GAME_DAILY_CAPS[mode] || 0);
  if (!cap) return { awarded: 0, cap: 0, used: 0 };
  const used = await getTodayGameCoins(uid, mode);
  const left = Math.max(0, cap - used);
  const awarded = Math.max(0, Math.min(left, desired));
  if (awarded > 0) {
    await User.updateOne({ _id: uid }, { $inc: { coins: awarded } });
  }
  return { awarded, cap, used };
}

function getMiniProfile(state, userId) {
  const uid = String(userId || '');
  return (state?.profiles && state.profiles[uid]) || {
    userId: uid,
    username: uid,
    nickname: uid,
    avatar: ''
  };
}

function buildTicStateForUser(state, viewerId, extras = {}) {
  const me = String(viewerId || '');
  const opponentId = (state.players || []).find((u) => String(u) !== me) || null;
  const yourSymbol = state.symbols?.[me] || '';
  const oppSymbol = opponentId ? (state.symbols?.[opponentId] || '') : '';
  return {
    success: true,
    game: {
      gameId: state.gameId,
      gameType: state.gameType,
      scope: state.scope,
      groupId: state.groupId || '',
      status: state.status,
      board: state.board,
      turn: state.turn,
      yourTurn: String(state.turn) === me,
      yourSymbol,
      opponentSymbol: oppSymbol,
      startedAt: state.startedAt,
      endedAt: state.endedAt || null
    },
    players: (state.players || []).map((uid) => {
      const p = getMiniProfile(state, uid);
      return {
        userId: String(uid),
        username: p.username || '',
        nickname: p.nickname || p.username || 'User',
        avatar: p.avatar || '',
        symbol: state.symbols?.[String(uid)] || '',
        isYou: String(uid) === me
      };
    }),
    ...extras
  };
}

async function emitTicState(state, eventName = 'game:update', extrasByUser = {}) {
  for (const uid of (state.players || [])) {
    const payload = buildTicStateForUser(state, uid, extrasByUser[String(uid)] || {});
    emitToUser(String(uid), eventName, payload);
  }
}

async function startTicTacToeGame(players, opts = {}) {
  const uniqPlayers = Array.from(new Set((players || []).map((x) => String(x || '')).filter(Boolean)));
  if (uniqPlayers.length !== 2) return null;
  const [a, b] = uniqPlayers;
  if (userMiniGame.has(a) || userMiniGame.has(b)) return null;

  const first = Math.random() < 0.5 ? a : b;
  const second = String(first) === String(a) ? b : a;
  const gameId = `ttt_${uuidv4()}`;
  const users = await User.find({ _id: { $in: [a, b] } }).select('username nickname avatar').lean();
  const profiles = {};
  for (const u of (users || [])) {
    profiles[String(u._id)] = {
      userId: String(u._id),
      username: String(u.username || ''),
      nickname: String(u.nickname || u.username || 'User'),
      avatar: String(u.avatar || '')
    };
  }

  const state = {
    gameId,
    gameType: 'tic_tac_toe',
    scope: normalizeMiniScope(opts.scope),
    groupId: opts.groupId ? String(opts.groupId) : '',
    players: [first, second],
    symbols: { [first]: 'X', [second]: 'O' },
    board: Array(9).fill(''),
    turn: first,
    status: 'active',
    startedAt: Date.now(),
    endedAt: null,
    profiles
  };

  activeMiniGames.set(gameId, state);
  userMiniGame.set(first, gameId);
  userMiniGame.set(second, gameId);

  await emitTicState(state, 'game:start', {
    [first]: { message: 'O‘yin boshlandi' },
    [second]: { message: 'O‘yin boshlandi' }
  });
  return state;
}

async function finalizeTicGame(gameId, winnerId = null, reason = 'completed') {
  const state = activeMiniGames.get(String(gameId || ''));
  if (!state || state.status !== 'active') return null;

  state.status = 'ended';
  state.endedAt = Date.now();

  const p1 = String(state.players?.[0] || '');
  const p2 = String(state.players?.[1] || '');
  const hasWinner = !!winnerId && (String(winnerId) === p1 || String(winnerId) === p2);
  const loserId = hasWinner ? (String(winnerId) === p1 ? p2 : p1) : '';

  const baseReward = {};
  if (hasWinner) {
    baseReward[String(winnerId)] = 30;
    if (loserId) baseReward[String(loserId)] = 8;
  } else {
    if (p1) baseReward[p1] = 14;
    if (p2) baseReward[p2] = 14;
  }

  const rewardResult = {};
  for (const uid of (state.players || [])) {
    rewardResult[String(uid)] = await creditCoinsWithCap(String(uid), Number(baseReward[String(uid)] || 0), 'pvp');
  }

  const docs = [];
  for (const uid of (state.players || [])) {
    const me = String(uid);
    const opponent = (state.players || []).find((x) => String(x) !== me) || null;
    const r = rewardResult[me] || { awarded: 0 };
    let result = 'draw';
    if (hasWinner) result = (String(winnerId) === me) ? 'win' : 'lose';

    docs.push({
      gameId: String(state.gameId),
      userId: me,
      gameType: 'tic_tac_toe',
      mode: 'pvp',
      scope: state.scope || 'global',
      groupId: isObjectIdLike(state.groupId) ? state.groupId : null,
      opponentId: isObjectIdLike(opponent) ? opponent : null,
      score: result === 'win' ? 1 : (result === 'draw' ? 0 : -1),
      result,
      coinsAwarded: Number(r.awarded || 0),
      meta: { reason, board: state.board, startedAt: state.startedAt, endedAt: state.endedAt }
    });
  }
  if (docs.length) await GameActivity.insertMany(docs).catch(() => null);

  const ids = (state.players || []).map((x) => new mongoose.Types.ObjectId(String(x)));
  const coinRows = await User.find({ _id: { $in: ids } }).select('_id coins').lean();
  const coinMap = new Map(coinRows.map((u) => [String(u._id), Number(u.coins || 0)]));

  const extras = {};
  for (const uid of (state.players || [])) {
    const me = String(uid);
    const rr = rewardResult[me] || { awarded: 0 };
    extras[me] = {
      winnerId: hasWinner ? String(winnerId) : null,
      reason,
      reward: Number(rr.awarded || 0),
      coins: Number(coinMap.get(me) || 0),
      cap: Number(rr.cap || MINI_GAME_DAILY_CAPS.pvp),
      usedToday: Number(rr.used || 0)
    };
  }
  await emitTicState(state, 'game:end', extras);

  for (const uid of (state.players || [])) {
    userMiniGame.delete(String(uid));
  }
  activeMiniGames.delete(String(gameId));
  return state;
}

async function forfeitMiniGame(userId, reason = 'forfeit') {
  const uid = String(userId || '');
  if (!uid) return;
  const gid = userMiniGame.get(uid);
  if (!gid) return;
  const state = activeMiniGames.get(String(gid));
  if (!state || state.status !== 'active') {
    userMiniGame.delete(uid);
    return;
  }
  const opp = (state.players || []).find((x) => String(x) !== uid) || null;
  await finalizeTicGame(String(gid), opp ? String(opp) : null, reason);
}

async function evaluateCoinMissionStatus(userId, missionKey, userDoc = null) {
  const mission = getMiniMissionByKey(missionKey);
  if (!mission) return null;
  const uid = String(userId || '');
  if (!uid) return null;
  const todayStart = dayStartLocal();
  const claimDayKey = miniMissionClaimDayKey(mission.key);

  const claim = await CoinMissionClaim.findOne({
    userId: uid,
    missionKey: mission.key,
    dayKey: claimDayKey
  }).select('_id createdAt').lean();

  if (claim) {
    return {
      ...mission,
      claimed: true,
      claimDayKey,
      eligible: false,
      progress: { current: 1, target: 1 }
    };
  }

  if (mission.key === 'daily_login') {
    return {
      ...mission,
      claimed: false,
      claimDayKey,
      eligible: true,
      progress: { current: 1, target: 1 }
    };
  }

  if (mission.key === 'daily_chat') {
    const [pmCount, gmCount] = await Promise.all([
      Message.countDocuments({ senderId: uid, createdAt: { $gte: todayStart } }),
      GroupMessage.countDocuments({ senderId: uid, createdAt: { $gte: todayStart } })
    ]);
    const total = Number(pmCount || 0) + Number(gmCount || 0);
    return {
      ...mission,
      claimed: false,
      claimDayKey,
      eligible: total >= 1,
      progress: { current: Math.min(total, 1), target: 1, raw: total }
    };
  }

  if (mission.key === 'daily_play') {
    const gamesToday = await GameActivity.countDocuments({ userId: uid, createdAt: { $gte: todayStart } });
    return {
      ...mission,
      claimed: false,
      claimDayKey,
      eligible: Number(gamesToday || 0) >= 1,
      progress: { current: Math.min(Number(gamesToday || 0), 1), target: 1, raw: Number(gamesToday || 0) }
    };
  }

  if (mission.key === 'profile_complete') {
    const me = userDoc || await User.findById(uid).select('fullName nickname bio university faculty studyType studyGroup avatar').lean();
    const done = isProfileCompleteForCoinMission(me);
    return {
      ...mission,
      claimed: false,
      claimDayKey,
      eligible: done,
      progress: { current: done ? 1 : 0, target: 1 }
    };
  }

  return {
    ...mission,
    claimed: false,
    claimDayKey,
    eligible: false,
    progress: { current: 0, target: 1 }
  };
}

async function getCoinMissionStatuses(userId, userDoc = null) {
  const out = [];
  for (const m of MINI_COIN_MISSIONS) {
    const status = await evaluateCoinMissionStatus(userId, m.key, userDoc);
    if (status) out.push(status);
  }
  return out;
}

// ==================== LIVE SESSIONS MODELS ====================
// LiveSession: teacher scheduled/live events (free/paid)
const LiveSessionSchema = new mongoose.Schema({
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  previewImage: { type: String, default: '' },
  startAt: { type: Date, default: null, index: true },
  status: { type: String, enum: ['scheduled','live','ended','cancelled'], default: 'scheduled', index: true },
  type: { type: String, enum: ['free','paid'], default: 'free', index: true },
  price: { type: Number, default: 0 },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },


// Targeting (university/faculty/groups). Empty targetGroups => open for all groups in faculty/university
university: { type: String, default: '', index: true },
faculty: { type: String, default: '', index: true },
targetGroups: { type: [String], default: [], index: true },
lessonKind: { type: String, enum: ['lecture','practice','other'], default: 'other', index: true },
notifySentAt: { type: Date, default: null },
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

LiveSessionSchema.index({ title: 'text', description: 'text' });

const LiveSession = mongoose.models.LiveSession || mongoose.model('LiveSession', LiveSessionSchema);

// LiveAccess: remembers if a student paid/entered (prevents double charge)
const LiveAccessSchema = new mongoose.Schema({
  liveId: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  paid: { type: Boolean, default: false },
  amount: { type: Number, default: 0 },
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

LiveAccessSchema.index({ liveId: 1, userId: 1 }, { unique: true });

const LiveAccess = mongoose.models.LiveAccess || mongoose.model('LiveAccess', LiveAccessSchema);


function getLiveRoomName(liveId){ return `live_${liveId}`; }


function getChannelLiveRoomName(channelId){ return `channel_live_${channelId}`; }
function getGroupRoomName(groupId){ return `group_${groupId}`; }
function getZakovatRoomName(sessionId){ return `zakovat_${sessionId}`; }

function addUserSocket(userId, socketId, sessionId = '') {
  const existing = onlineUsers.get(userId) || { sockets: new Set(), lastActive: Date.now() };
  if (!existing.sockets) existing.sockets = new Set();
  existing.sockets.add(socketId);
  existing.lastActive = Date.now();
  onlineUsers.set(userId, existing);
  userSockets.set(socketId, userId);
  if (sessionId) {
    const sessionKey = String(sessionId);
    const existingSessionSockets = sessionSockets.get(sessionKey) || new Set();
    existingSessionSockets.add(socketId);
    sessionSockets.set(sessionKey, existingSessionSockets);
    socketSessions.set(socketId, sessionKey);
  }
}

function removeUserSocket(userId, socketId) {
  const existing = onlineUsers.get(userId);
  const sessionId = socketSessions.get(socketId);
  if (sessionId) {
    const existingSessionSockets = sessionSockets.get(sessionId);
    if (existingSessionSockets) {
      existingSessionSockets.delete(socketId);
      if (existingSessionSockets.size > 0) sessionSockets.set(sessionId, existingSessionSockets);
      else sessionSockets.delete(sessionId);
    }
    socketSessions.delete(socketId);
  }
  if (!existing) {
    userSockets.delete(socketId);
    return { becameOffline: true };
  }
  if (existing.sockets) existing.sockets.delete(socketId);
  userSockets.delete(socketId);
  const stillOnline = existing.sockets && existing.sockets.size > 0;
  if (!stillOnline) {
    onlineUsers.delete(userId);
    return { becameOffline: true };
  }
  onlineUsers.set(userId, existing);
  return { becameOffline: false };
}

function getSessionSocketIds(sessionId) {
  if (!sessionId) return [];
  return Array.from(sessionSockets.get(String(sessionId)) || []);
}

async function syncUserPresenceFromSockets(userId) {
  try {
    const online = isUserOnline(userId);
    if (online) {
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastActive: Date.now()
      });
      return;
    }
    await User.findByIdAndUpdate(userId, {
      isOnline: false,
      lastSeen: Date.now(),
      lastActive: Date.now(),
      socketId: ''
    });
  } catch (error) {
    console.warn('syncUserPresenceFromSockets warning:', error?.message || error);
  }
}

function disconnectSessionSockets(sessionId, reason = 'revoked') {
  const targetSocketIds = getSessionSocketIds(sessionId);
  targetSocketIds.forEach((sid) => {
    try {
      io.to(sid).emit('auth:session-revoked', { reason, sessionId: String(sessionId || '') });
      const liveSocket = io.sockets.sockets.get(sid);
      if (liveSocket) liveSocket.disconnect(true);
    } catch (error) {
      console.warn('disconnectSessionSockets warning:', error?.message || error);
    }
  });
  return targetSocketIds.length;
}

async function revokeAuthSessionsForUser(userId, { excludeSessionId = '', onlySessionId = '', reason = 'revoked' } = {}) {
  const filter = {
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  };
  if (onlySessionId) filter._id = onlySessionId;
  if (excludeSessionId) filter._id = { ...(filter._id || {}), $ne: excludeSessionId };

  const targetSessions = await AuthSession.find(filter).select('_id').lean();
  if (!targetSessions.length) return [];

  const ids = targetSessions.map((row) => String(row._id));
  await AuthSession.updateMany(
    { _id: { $in: ids } },
    { $set: { revokedAt: new Date(), revokedReason: cleanText(reason, 80) || 'revoked' } }
  );
  ids.forEach((id) => disconnectSessionSockets(id, reason));
  return ids;
}

io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);
  
  // User authentication via socket
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.userId.toString();
      const sessionState = await ensureActiveAuthSessionForToken({
        userId,
        token,
        decoded,
        headers: socket.handshake?.headers || {},
        ip: getSocketClientIp(socket),
        createdFrom: 'socket'
      });
      if (!sessionState?.ok || !sessionState?.session?._id) {
        socket.emit('authenticated', {
          success: false,
          error: sessionState?.code === 'SESSION_REVOKED' ? 'Session revoked' : 'Session expired',
          code: sessionState?.code || 'SESSION_INVALID'
        });
        socket.emit('auth:session-revoked', {
          reason: sessionState?.code || 'SESSION_INVALID'
        });
        return socket.disconnect(true);
      }
      const sessionId = String(sessionState.session._id);
      
      // Store socket with user ID (supports multi-tab / multi-device)
      const wasOnline = isUserOnline(userId);
      addUserSocket(userId, socket.id, sessionId);
      socket.userId = userId;
      socket.authSessionId = sessionId;
      
      // Update user status in database only when the user becomes online
      if (!wasOnline) {
        await User.findByIdAndUpdate(userId, {
          isOnline: true,
          lastSeen: Date.now(),
          lastActive: Date.now(),
          socketId: socket.id
        });
      } else {
        // Keep lastActive fresh, but don't flip status unnecessarily
        await User.findByIdAndUpdate(userId, {
          lastActive: Date.now(),
          socketId: socket.id
        });
      }
      


      // NOTE: do not reference `data` here; auth event only receives the token.
      // Call state updates are handled inside callOffer/callAnswer/callEnded/callRejected/callTimeout.


      console.log('✅ User authenticated:', userId);
      
      // Join university room (for services/signals broadcasts)
      const u = await User.findById(userId).select('university faculty studyType studyGroup isAdmin role username').lean();
      if (u && u.university) {
        socket.university = u.university;
        socket.join('uni:' + u.university);
      }
      socket.userUniversity = cleanText(u?.university, 180);
      socket.userFaculty = cleanText(u?.faculty, 180);
      socket.userRole = String(u?.role || '').toLowerCase();
      socket.username = String(u?.username || '');

      // Join user's personal room
      socket.join(userId);
      socket.join(`user_${userId}`);

      // Admin sockets join a protected room for realtime monitoring
      if (u && (u.isAdmin || u.role === 'admin')) {
        socket.isAdmin = true;
        socket.join('admin');
        socket.emit('admin:ready', { success: true, username: u.username || 'admin' });
        // Push an initial snapshot (lightweight) after auth
        try {
          adminEmit('admin:presence', { onlineUsersCount: onlineUsers.size, timestamp: Date.now() });
        } catch (e) {}
      }

      
      // Presence broadcast: show ONLINE to everyone (requirement)
      if (!wasOnline) {
        io.emit('userOnline', { userId, timestamp: Date.now() });
        adminEmit('admin:userOnline', { userId, timestamp: Date.now() });
      }
      
      // Send confirmation to client
      socket.emit('authenticated', { 
        success: true, 
        userId: userId,
        socketId: socket.id,
        sessionId
      });

      // If there are already active group calls, push a lightweight invite snapshot.
      // This lets users who are currently on other pages still see "join now?" popup.
      try {
        const activeEntries = Array.from(activeGroupCalls.entries() || []);
        if (activeEntries.length) {
          const activeGroupIds = activeEntries
            .map(([gid]) => String(gid || '').trim())
            .filter((gid) => mongoose.Types.ObjectId.isValid(gid));

          if (activeGroupIds.length) {
            const groups = await Group.find({ _id: { $in: activeGroupIds } })
              .select('_id name username members university faculty studyType studyGroup')
              .lean();
            const gmap = new Map((groups || []).map((g) => [String(g._id), g]));

            const startedByIds = Array.from(new Set(activeEntries.map(([, c]) => String(c?.startedBy || '')).filter(Boolean)));
            const starters = startedByIds.length
              ? await User.find({ _id: { $in: startedByIds } }).select('fullName nickname username avatar').lean()
              : [];
            const smap = new Map((starters || []).map((s) => [String(s._id), s]));

            const meUni = cleanText(u?.university, 180);
            const meFac = cleanText(u?.faculty, 180);
            const meType = cleanText(u?.studyType, 80);
            const meGroup = cleanText(u?.studyGroup, 80);

            const inScope = (g) => {
              const gUni = cleanText(g?.university, 180);
              const gFac = cleanText(g?.faculty, 180);
              const gType = cleanText(g?.studyType, 80);
              const gGroup = cleanText(g?.studyGroup, 80);
              if (gUni && (!meUni || gUni !== meUni)) return false;
              if (gFac && (!meFac || gFac !== meFac)) return false;
              if (gType && (!meType || gType !== meType)) return false;
              if (gGroup && (!meGroup || gGroup !== meGroup)) return false;
              return true;
            };

            for (const [gid, call] of activeEntries) {
              const groupDoc = gmap.get(String(gid));
              if (!groupDoc || !call) continue;

              const isMember = (groupDoc.members || []).some((m) => String(m) === String(userId));
              if (!isMember && !inScope(groupDoc)) continue;
              if (String(call.startedBy || '') === String(userId)) continue;

              const st = smap.get(String(call.startedBy || '')) || {};
              socket.emit('groupCallIncomingGlobal', {
                groupId: String(gid),
                callId: String(call.callId || ''),
                callType: String(call.callType || 'video'),
                title: String(call.title || 'Live dars'),
                from: String(call.startedBy || ''),
                fromName: String(st.fullName || st.nickname || st.username || 'Teacher'),
                fromAvatar: String(st.avatar || ''),
                groupName: String(groupDoc.name || ''),
                groupUsername: String(groupDoc.username || ''),
                startedAt: call.startedAt || Date.now(),
                active: true
              });
            }
          }
        }
      } catch (activeErr) {
        console.warn('socket auth active-call snapshot warn:', activeErr?.message || activeErr);
      }
      
    } catch (error) {
      console.error('❌ Socket authentication error:', error);
      socket.emit('authenticationError', { error: 'Invalid token' });
      socket.disconnect();
    }
  });
  

  // Join/leave group room (for real-time group events)
  socket.on('joinGroup', async (groupId) => {
    try {
      if (!socket.userId) return socket.emit('groupError', { error: 'Not authenticated' });
      if (!groupId) return;

      // Security: only members/public group, or scoped organizer/admin can join
      const group = await Group.findById(groupId).select('isPublic members university faculty name username').lean();
      if (!group) return socket.emit('groupError', { error: 'Group not found' });

      const isMember = (group.members || []).some(m => String(m) === String(socket.userId));
      const canScopedModerate = canUserModerateGroupByScope({
        role: socket.userRole,
        isAdmin: socket.isAdmin,
        university: socket.userUniversity || socket.university,
        faculty: socket.userFaculty
      }, group);
      if (!isMember && !group.isPublic && !canScopedModerate) return socket.emit('groupError', { error: 'Access denied' });

      const room = getGroupRoomName(groupId);
      socket.join(room);
      socket._joinedGroups = socket._joinedGroups || new Set();
      socket._joinedGroups.add(String(groupId));

      socket.emit('groupJoined', { groupId });

      // If a group call is active, inform the joiner
      const call = activeGroupCalls.get(String(groupId));
      if (call) {
        getCallLabState(call);
        socket.emit('groupCallActive', {
          groupId: String(groupId),
          callId: call.callId,
          callType: call.callType,
          title: call.title,
          teacherSubject: cleanText(call.lessonSubject, 80) || '',
          labState: getCallLabState(call),
          startedBy: call.startedBy,
          startedAt: call.startedAt,
          participants: Array.from(call.participants || [])
              ,
          stage: stagePayload(call)
        });
      }

      console.log(`👥 Socket ${socket.id} joined group room ${room}`);
    } catch (e) {
      console.error('joinGroup error:', e);
      socket.emit('groupError', { error: 'Failed to join group' });
    }
  });

  socket.on('leaveGroup', (groupId) => {
    try {
      if (!groupId) return;
      const room = getGroupRoomName(groupId);
      socket.leave(room);
      if (socket._joinedGroups) socket._joinedGroups.delete(String(groupId));
      socket.emit('groupLeft', { groupId });
    } catch (e) {
      console.error('leaveGroup error:', e);
    }
  });

  
  // ==================== LESSON CONTROL OWNER (Teacher handover) ====================
  // Only current controller (or admin) can transfer control to another teacher.
  socket.on('lessonEnter', async (data) => {
    try {
      if (!socket.userId) return;
      const lessonId = String(data?.lessonId || '');
      if (!lessonId) return;
      const lesson = await GroupLesson.findById(lessonId).select('hostId groupId status').lean();
      if (!lesson || lesson.status !== 'live') return;

      // Only group member
      const ok = await isGroupMember(String(lesson.groupId), socket.userId);
      if (!ok) return;

      // If no controller set, default to host
      const current = getLessonController(lessonId);
      if (!current) setLessonController(lessonId, String(lesson.hostId));

      socket.emit('lessonState', { lessonId, controllerId: getLessonController(lessonId) });
    } catch(e) {
      console.error('lessonEnter error', e);
    }
  });

  

socket.on('lessonRequestControl', async (data) => {
  try {
    if (!socket.userId) return;
    const lessonId = String(data?.lessonId || '');
    if (!lessonId) return;

    const lesson = await GroupLesson.findById(lessonId).select('hostId groupId status').lean();
    if (!lesson || lesson.status !== 'live') return;

    const ok = await isGroupMember(String(lesson.groupId), socket.userId);
    if (!ok) return;

    const me = await User.findById(socket.userId).select('role fullName username').lean();
    if (!me || String(me.role || '').toLowerCase() !== 'teacher') return;

    // lightweight cooldown: one request per 10s per lesson per user
    const key = `${lessonId}:${socket.userId}`;
    const now = Date.now();
    if (!global.__lessonReqCooldown) global.__lessonReqCooldown = new Map();
    const cd = global.__lessonReqCooldown.get(key) || 0;
    if (now - cd < 10000) return;
    global.__lessonReqCooldown.set(key, now);

    // ensure controller exists
    const current = getLessonController(lessonId) || String(lesson.hostId || '');
    if (!current) return;

    io.to(getGroupRoomName(String(lesson.groupId))).emit('lessonControlRequested', {
      lessonId,
      controllerId: current,
      fromUserId: String(socket.userId),
      fromName: String(me.fullName || me.username || socket.userId)
    });
  } catch (e) {
    console.error('lessonRequestControl error', e);
  }
});

socket.on('lessonTransferControl', async (data) => {
    try {
      if (!socket.userId) return;
      const lessonId = String(data?.lessonId || '');
      const toUserId = String(data?.toUserId || '');
      if (!lessonId || !toUserId) return;

      const lesson = await GroupLesson.findById(lessonId).select('hostId groupId status').lean();
      if (!lesson || lesson.status !== 'live') return;

      const ok = await isGroupMember(String(lesson.groupId), socket.userId);
      if (!ok) return;

      const me = await User.findById(socket.userId).select('role isAdmin').lean();
      const isAdmin = !!(me?.isAdmin || String(me?.role||'').toLowerCase()==='admin');

      const current = getLessonController(lessonId) || String(lesson.hostId);
      if (!isAdmin && String(current) !== String(socket.userId)) {
        return socket.emit('lessonError', { error: 'Only current controller can transfer' });
      }

      const target = await User.findById(toUserId).select('role').lean();
      if (!target || String(target.role||'').toLowerCase() !== 'teacher') {
        return socket.emit('lessonError', { error: 'Target must be a teacher' });
      }

      setLessonController(lessonId, toUserId);

      // Notify everyone in group room
      io.to(getGroupRoomName(String(lesson.groupId))).emit('lessonState', { lessonId, controllerId: toUserId });
      socket.emit('lessonTransferOk', { lessonId, controllerId: toUserId });
    } catch(e) {
      console.error('lessonTransferControl error', e);
      socket.emit('lessonError', { error: 'Transfer failed' });
    }
  });

  // Heartbeat keeps presence fresh during long lessons (without refresh)
  socket.on('heartbeat', async (data) => {
    try {
      if (!socket.userId) return;
      // update lastActive lightly
      const userId = String(socket.userId);
      const ud = onlineUsers.get(userId);
      if (ud) { ud.lastActive = Date.now(); onlineUsers.set(userId, ud); }
      // optional: DB update throttled
    } catch(e){}
  });

// ==================== GROUP CALL (WebRTC Mesh Signaling) ====================
  const MAX_GROUP_CALL_PARTICIPANTS = Math.max(8, Math.min(120, Number(process.env.MAX_GROUP_CALL_PARTICIPANTS || 50)));
  // Notes:
  // - This is signaling only (offers/answers/ICE); media flows peer-to-peer (mesh).
  // - One active call per groupId (simple + reliable for demo).
  socket.on('groupCallStart', async (data) => {
    try {
      if (!socket.userId) return socket.emit('groupCallError', { error: 'Not authenticated' });
      const groupId = String(data?.groupId || '');
      const callType = (data?.callType === 'audio') ? 'audio' : 'video';
      if (!groupId) return;

      // Ensure access
      const group = await Group.findById(groupId).select('isPublic members university faculty studyType studyGroup name username').lean();
      if (!group) return socket.emit('groupCallError', { error: 'Group not found' });
      const isMember = (group.members || []).some(m => String(m) === String(socket.userId));
      const canScopedModerate = canUserModerateGroupByScope({
        role: socket.userRole,
        isAdmin: socket.isAdmin,
        university: socket.userUniversity || socket.university,
        faculty: socket.userFaculty
      }, group);
      if (!isMember && !group.isPublic && !canScopedModerate) return socket.emit('groupCallError', { error: 'Access denied' });

      // If already active, just join
      let call = activeGroupCalls.get(groupId);
      if (!call) {
        const starterDoc = await User.findById(socket.userId)
          .select('role fullName nickname username avatar teachingSubject teachingSubjects')
          .lean()
          .catch(() => null);
        const lessonSubject = cleanText(
          data?.lessonSubject || data?.subject || starterDoc?.teachingSubject || (starterDoc?.teachingSubjects?.[0] || ''),
          80
        );
        const callId = uuidv4();
        call = {
          callId,
          startedBy: socket.userId,
          startedAt: Date.now(),
          callType,
          title: (data?.title || '').toString().trim() || 'Live dars',
          lessonSubject,
          participants: new Set([socket.userId]),
          stage: { ownerTeacherId: null, pinnedUserId: null, teacherJoinOrder: [] },
          labState: {
            enabled: false,
            labType: '',
            state: {},
            sharedStudentId: '',
            controllerId: '',
            updatedAt: Date.now()
          }
        };
        activeGroupCalls.set(groupId, call);

        // Stage owner teacher is the FIRST teacher who enters (usually the starter).
        try {
          const chk = await isTeacherUser(socket.userId);
          if (chk.isTeacher) {
            const st = getCallStage(call);
            st.teacherJoinOrder = [String(socket.userId), ...(st.teacherJoinOrder || []).filter(x=>String(x)!==String(socket.userId))];
            st.ownerTeacherId = String(st.ownerTeacherId || socket.userId);
            normalizeTeacherJoinOrder(call);
          }
        } catch(e) {}


        // Broadcast "incoming group call" to group room
        io.to(getGroupRoomName(groupId)).emit('groupCallIncoming', {
          groupId,
          callId,
          callType,
          title: call.title,
          teacherSubject: call.lessonSubject || '',
          from: socket.userId,
          startedAt: call.startedAt
        });

        // Global site popup support:
        // Notify each group member directly (works even when user is on other pages).
        try {
          const starter = starterDoc || await User.findById(socket.userId).select('fullName nickname username avatar').lean();
          const starterName = String(starter?.fullName || starter?.nickname || starter?.username || 'Teacher').trim();
          const incomingPayload = {
            groupId,
            callId,
            callType,
            title: call.title,
            teacherSubject: call.lessonSubject || '',
            from: String(socket.userId),
            fromName: starterName,
            fromAvatar: String(starter?.avatar || '').trim(),
            groupName: String(group?.name || '').trim(),
            groupUsername: String(group?.username || '').trim(),
            startedAt: call.startedAt
          };

          const notifyIds = new Set((group.members || []).map((m) => String(m || '')).filter(Boolean));

          // Also notify users in the same academic scope (helps students who haven't opened/joined group page yet).
          const scopeFilter = { _id: { $ne: socket.userId } };
          if (group.university) scopeFilter.university = String(group.university || '').trim();
          if (group.faculty) scopeFilter.faculty = String(group.faculty || '').trim();
          if (group.studyType) scopeFilter.studyType = String(group.studyType || '').trim();
          if (group.studyGroup) scopeFilter.studyGroup = String(group.studyGroup || '').trim();
          const hasScope = !!(scopeFilter.university || scopeFilter.faculty || scopeFilter.studyType || scopeFilter.studyGroup);
          if (hasScope) {
            const scopedUsers = await User.find(scopeFilter).select('_id').limit(5000).lean().catch(() => []);
            for (const su of (scopedUsers || [])) notifyIds.add(String(su?._id || ''));
          }

          for (const uid of Array.from(notifyIds)) {
            if (String(uid) === String(socket.userId)) continue;
            emitToUser(uid, 'groupCallIncomingGlobal', incomingPayload);
          }
        } catch (notifyErr) {
          console.warn('groupCallStart global notify warn:', notifyErr?.message || notifyErr);
        }

        console.log('📞 Group call started:', { groupId, callId, by: socket.userId, callType });
      } else {
        const alreadyInCall = call.participants?.has(socket.userId);
        const currentCount = Number(call.participants?.size || 0);
        if (!alreadyInCall && currentCount >= MAX_GROUP_CALL_PARTICIPANTS) {
          return socket.emit('groupCallError', { error: `Bu guruh call'ida maksimal ${MAX_GROUP_CALL_PARTICIPANTS} qatnashchi mumkin` });
        }
        call.participants.add(socket.userId);
        activeGroupCalls.set(groupId, call);
      }
      // Keep lesson subject/lab state normalized for existing calls too
      if (!cleanText(call.lessonSubject, 80)) {
        const u = await User.findById(socket.userId).select('teachingSubject teachingSubjects').lean().catch(() => null);
        call.lessonSubject = cleanText(u?.teachingSubject || (u?.teachingSubjects?.[0] || ''), 80);
      }
      getCallLabState(call);
      activeGroupCalls.set(groupId, call);

      // Build participant infos (roles/names) for UI layout/attendance
      const participantInfos = await getUsersBrief(Array.from(call.participants || []));
      let lessonId = null;

      // If starter is a teacher, create/attach a GroupLesson (used for attendance + recording)
      try {
        const starter = await User.findById(socket.userId).select('role fullName').lean();
        if (starter && String(starter.role || '').toLowerCase() === 'teacher') {
          const existingLesson = await GroupLesson.findOne({ groupId, callId: call.callId }).select('_id').lean();
          const lesson = existingLesson ? existingLesson : await GroupLesson.create({
            groupId,
            callId: call.callId,
            hostId: socket.userId,
            title: (data?.title || '').toString().trim() || 'Live dars',
            mode: (data?.mode === 'screen') ? 'screen' : 'camera',
            status: 'live',
            startedAt: new Date()
          });
          lessonId = String(lesson._id);
          if (!getLessonController(lessonId)) setLessonController(lessonId, socket.userId);
          try { io.to(getGroupRoomName(String(groupId))).emit('lessonState', { lessonId, controllerId: getLessonController(lessonId) }); } catch(e){}

          // Upsert attendance for starter
          await GroupAttendance.updateOne({ lessonId: lesson._id, groupId, userId: socket.userId }, { $setOnInsert: { joinedAt: new Date() } }, { upsert: true }).catch(()=>{});
        }
      } catch(e) {
        console.warn('GroupLesson create skipped:', e?.message || e);
      }

      socket._activeGroupCall = { groupId: String(groupId), callId: String(call.callId) };

      socket.emit('groupCallStarted', {
        groupId,
        callId: call.callId,
        callType: call.callType,
        title: call.title,
        teacherSubject: cleanText(call.lessonSubject, 80) || '',
        labState: getCallLabState(call),
        maxParticipants: MAX_GROUP_CALL_PARTICIPANTS,
        startedBy: call.startedBy,
        selfUserId: String(socket.userId),
        participants: Array.from(call.participants),
        participantInfos,
        lessonId,
        stage: stagePayload(call)
      });

// Notify others that this user joined
      io.to(getGroupRoomName(groupId)).emit('groupCallUserJoined', {
        groupId,
        callId: call.callId,
        callType: call.callType,
        title: call.title,
        teacherSubject: cleanText(call.lessonSubject, 80) || '',
        labState: getCallLabState(call),
        maxParticipants: MAX_GROUP_CALL_PARTICIPANTS,
        startedBy: call.startedBy,
        userId: socket.userId,
        participants: Array.from(call.participants),
        participantInfos,
        stage: stagePayload(call)
      });
adminEmit('admin:groupCallUpdate', { action: 'joined', groupId: String(groupId), callId: String(call.callId), userId: String(socket.userId), participants: Array.from(call.participants).map(String), timestamp: Date.now() });

    } catch (e) {
      console.error('groupCallStart error:', e);
      socket.emit('groupCallError', { error: 'Failed to start call' });
    }
  });

  socket.on('groupCallJoin', async (data) => {
    try {
      if (!socket.userId) return socket.emit('groupCallError', { error: 'Not authenticated' });
      const groupId = String(data?.groupId || '');
      const callId = String(data?.callId || '');
      if (!groupId || !callId) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId) !== callId) {
        return socket.emit('groupCallError', { error: 'Call not active' });
      }

      const group = await Group.findById(groupId).select('isPublic members university faculty').lean();
      if (!group) return socket.emit('groupCallError', { error: 'Group not found' });
      const isMember = (group.members || []).some(m => String(m) === String(socket.userId));
      const canScopedModerate = canUserModerateGroupByScope({
        role: socket.userRole,
        isAdmin: socket.isAdmin,
        university: socket.userUniversity || socket.university,
        faculty: socket.userFaculty
      }, group);
      if (!isMember && !group.isPublic && !canScopedModerate) {
        return socket.emit('groupCallError', { error: 'Access denied' });
      }

      const alreadyInCall = call.participants?.has(socket.userId);
      const currentCount = Number(call.participants?.size || 0);
      if (!alreadyInCall && currentCount >= MAX_GROUP_CALL_PARTICIPANTS) {
        return socket.emit('groupCallError', { error: `Bu guruh call'ida maksimal ${MAX_GROUP_CALL_PARTICIPANTS} qatnashchi mumkin` });
      }

      call.participants.add(socket.userId);
      activeGroupCalls.set(groupId, call);
      getCallLabState(call);

      // If a teacher joins and owner is not set, lock the FIRST teacher as owner.
      try {
        const chk = await isTeacherUser(socket.userId);
        if (chk.isTeacher) {
          const st = getCallStage(call);
          const uid = String(socket.userId);
          st.teacherJoinOrder = [ ...new Set([uid, ...(st.teacherJoinOrder || [])]) ];
          if (!st.ownerTeacherId) st.ownerTeacherId = uid;
          normalizeTeacherJoinOrder(call);
          activeGroupCalls.set(groupId, call);
          emitGroupStageState(groupId, call);
        }
      } catch(e) {}

      const participantInfos = await getUsersBrief(Array.from(call.participants || []));
      const lesson = await GroupLesson.findOne({ groupId, callId }).select('_id hostId status').lean().catch(() => null);
      const lessonId = lesson? String(lesson._id) : null;
      if (lesson && lesson._id) {
        await GroupAttendance.updateOne({ lessonId: lesson._id, groupId, userId: socket.userId }, { $setOnInsert: { joinedAt: new Date() } }, { upsert: true }).catch(()=>{});
      }

      socket._activeGroupCall = { groupId: String(groupId), callId: String(callId) };

      socket.emit('groupCallJoined', {
        groupId,
        callId,
        callType: call.callType,
        teacherSubject: cleanText(call.lessonSubject, 80) || '',
        labState: getCallLabState(call),
        maxParticipants: MAX_GROUP_CALL_PARTICIPANTS,
        startedBy: call.startedBy,
        selfUserId: String(socket.userId),
        participants: Array.from(call.participants),
        participantInfos,
        lessonId,
        stage: stagePayload(call)
      });

io.to(getGroupRoomName(groupId)).emit('groupCallUserJoined', {
        groupId,
        callId,
        callType: call.callType,
        teacherSubject: cleanText(call.lessonSubject, 80) || '',
        labState: getCallLabState(call),
        maxParticipants: MAX_GROUP_CALL_PARTICIPANTS,
        startedBy: call.startedBy,
        userId: socket.userId,
        participants: Array.from(call.participants),
        participantInfos,
        stage: stagePayload(call)
      });
} catch (e) {
      console.error('groupCallJoin error:', e);
      socket.emit('groupCallError', { error: 'Failed to join call' });
    }
  });

  // Generic signaling relay: offer/answer/ice
  socket.on('groupCallSignal', (payload) => {
    try {
      if (!socket.userId) return;
      const groupId = String(payload?.groupId || '');
      const callId = String(payload?.callId || '');
      const to = String(payload?.to || '');
      const type = String(payload?.type || '');
      const data = payload?.data;

      if (!groupId || !callId || !to || !type) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId) !== callId) return;

      // Relay to target user
      emitToUser(to, 'groupCallSignal', {
        groupId,
        callId,
        from: socket.userId,
        type,
        data,
        timestamp: Date.now()
      });

    } catch (e) {
      console.error('groupCallSignal error:', e);
    }
  });

  socket.on('groupCallCaption', (payload) => {
    try {
      if (!socket.userId) return;
      const groupId = String(payload?.groupId || '').trim();
      const callId = String(payload?.callId || '').trim();
      if (!groupId || !callId) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId || '') !== callId) return;
      if (!(call.participants && call.participants.has(String(socket.userId)))) return;

      const text = cleanText(payload?.text, 240);
      if (!text) return;
      const sourceLang = normalizeCaptionLang(payload?.sourceLang || 'uz', 'uz');
      const st = getCallStage(call);
      const ownerTeacherId = String(st?.ownerTeacherId || '').trim();
      const pinnedUserId = String(st?.pinnedUserId || '').trim();
      const visibleStageUserIds = new Set([ownerTeacherId, pinnedUserId].filter(Boolean));
      const meId = String(socket.userId || '').trim();
      const meRole = String(socket.userRole || '').toLowerCase();
      const isAdmin = !!socket.isAdmin || meRole === 'admin';

      // Only users currently visible on 1-stage can publish live captions.
      if (visibleStageUserIds.size) {
        if (!visibleStageUserIds.has(meId) && !isAdmin) return;
      } else if (!isAdmin && meRole !== 'teacher') {
        return;
      }

      const effectiveStageUserId = visibleStageUserIds.has(meId)
        ? meId
        : (pinnedUserId || ownerTeacherId || meId);

      io.to(getGroupRoomName(groupId)).emit('groupCallCaption', {
        groupId,
        callId,
        byUserId: meId,
        stageUserId: effectiveStageUserId,
        text,
        final: !!payload?.final,
        sourceLang,
        ts: Date.now()
      });
    } catch (e) {
      console.error('groupCallCaption error:', e);
    }
  });

  socket.on('groupLabStateUpdate', async (payload) => {
    try {
      if (!socket.userId) return;
      const groupId = String(payload?.groupId || '');
      const callId = String(payload?.callId || '');
      if (!groupId || !callId) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId) !== callId) return;
      if (!(call.participants && call.participants.has(socket.userId))) return;

      const st = getCallStage(call);
      const lab = getCallLabState(call);
      const me = await User.findById(socket.userId).select('role isAdmin teachingSubject teachingSubjects fullName username').lean();
      const role = String(me?.role || '').toLowerCase();
      const isAdmin = !!(me?.isAdmin || role === 'admin');
      const isTeacher = role === 'teacher' || isAdmin;
      const isOwnerTeacher = !!(st?.ownerTeacherId && String(st.ownerTeacherId) === String(socket.userId));
      const isSharedStudent = !!(lab.sharedStudentId && String(lab.sharedStudentId) === String(socket.userId));

      if (!((isTeacher && (isOwnerTeacher || isAdmin)) || isSharedStudent)) return;

      const teacherSubject = cleanText(
        call.lessonSubject || me?.teachingSubject || (me?.teachingSubjects?.[0] || ''),
        80
      );
      if (!isScienceSubject(teacherSubject)) {
        return socket.emit('groupLabError', { error: 'Lab faqat fizika/kimyo/biologiya uchun ochiladi' });
      }

      const nextType = normalizeLabType(payload?.labType) || normalizeLabType(teacherSubject) || lab.labType || '';
      if (!nextType) {
        return socket.emit('groupLabError', { error: 'Lab turi aniqlanmadi (physics/chemistry/biology)' });
      }

      const nextState = (payload && typeof payload.state === 'object' && payload.state) ? payload.state : lab.state || {};
      lab.enabled = Object.prototype.hasOwnProperty.call(payload || {}, 'enabled') ? !!payload.enabled : true;
      lab.labType = nextType;
      lab.state = nextState;
      lab.controllerId = String(socket.userId);
      lab.updatedAt = Date.now();
      call.lessonSubject = teacherSubject;
      activeGroupCalls.set(groupId, call);

      io.to(getGroupRoomName(groupId)).emit('groupLabState', {
        groupId,
        callId,
        teacherSubject,
        presenterId: String(socket.userId),
        labState: lab
      });
    } catch (e) {
      console.error('groupLabStateUpdate error:', e);
      socket.emit('groupLabError', { error: 'Lab update failed' });
    }
  });

  socket.on('groupLabTryRequest', async (payload) => {
    try {
      if (!socket.userId) return;
      const groupId = String(payload?.groupId || '');
      const callId = String(payload?.callId || '');
      if (!groupId || !callId) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId) !== callId) return;
      if (!(call.participants && call.participants.has(socket.userId))) return;

      const me = await User.findById(socket.userId).select('role fullName username').lean();
      const role = String(me?.role || '').toLowerCase();
      if (role === 'teacher' || role === 'admin') return;

      const teacherId = String(getCallStage(call)?.ownerTeacherId || call.startedBy || '');
      if (!teacherId) return;
      emitToUser(teacherId, 'groupLabTryRequested', {
        groupId,
        callId,
        fromUserId: String(socket.userId),
        fromName: String(me?.fullName || me?.username || socket.userId),
        at: Date.now()
      });
    } catch (e) {
      console.error('groupLabTryRequest error:', e);
    }
  });

  socket.on('groupLabControlGrant', async (payload) => {
    try {
      if (!socket.userId) return;
      const groupId = String(payload?.groupId || '');
      const callId = String(payload?.callId || '');
      const studentId = String(payload?.studentId || '');
      const enabled = !!payload?.enabled;
      if (!groupId || !callId) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId) !== callId) return;
      if (!(call.participants && call.participants.has(socket.userId))) return;

      const st = getCallStage(call);
      const me = await User.findById(socket.userId).select('role isAdmin').lean();
      const role = String(me?.role || '').toLowerCase();
      const isAdmin = !!(me?.isAdmin || role === 'admin');
      const isOwnerTeacher = !!(st?.ownerTeacherId && String(st.ownerTeacherId) === String(socket.userId));
      if (!(isOwnerTeacher || isAdmin)) return;
      const teacherSubject = cleanText(call.lessonSubject || '', 80);
      if (!isScienceSubject(teacherSubject)) {
        return socket.emit('groupLabError', { error: 'Lab faqat fizika/kimyo/biologiya fanlarida' });
      }

      const lab = getCallLabState(call);
      const canGrant = enabled && studentId && call.participants.has(studentId);
      lab.sharedStudentId = canGrant ? studentId : '';
      lab.updatedAt = Date.now();
      activeGroupCalls.set(groupId, call);

      io.to(getGroupRoomName(groupId)).emit('groupLabControl', {
        groupId,
        callId,
        sharedStudentId: lab.sharedStudentId,
        enabled: !!lab.sharedStudentId,
        grantedBy: String(socket.userId),
        at: Date.now()
      });
    } catch (e) {
      console.error('groupLabControlGrant error:', e);
      socket.emit('groupLabError', { error: 'Lab grant failed' });
    }
  });

  async function leaveGroupCallInternal(groupId, userId, reason) {
    try {
      const call = activeGroupCalls.get(groupId);
      const lesson = call?.callId
        ? await GroupLesson.findOne({ groupId, callId: call.callId }).select('_id hostId startedAt endedAt title').lean().catch(() => null)
        : null;
      // Attendance: mark user left (if this call is linked to a GroupLesson)
      try {
        if (lesson && lesson._id) {
          const att = await GroupAttendance.findOne({ lessonId: lesson._id, userId }).select('_id joinedAt').lean().catch(()=>null);
          if (att && att._id) {
            const leftAt = new Date();
            const durationSec = att.joinedAt ? Math.max(0, Math.round((leftAt.getTime() - new Date(att.joinedAt).getTime())/1000)) : 0;
            await GroupAttendance.updateOne({ _id: att._id }, { $set: { leftAt, durationSec } }).catch(()=>{});
          }
        }
      } catch(e) {
        // ignore attendance errors
      }

      if (!call) return;
      if (call.participants) call.participants.delete(userId);
      const isLessonHostLeaving = !!(lesson && String(lesson.hostId || '') === String(userId));

      // Stage cleanup: if pinned user/owner left, update stage and broadcast
      try {
        const st = getCallStage(call);
        const uid = String(userId);
        if (st.pinnedUserId && String(st.pinnedUserId) === uid) st.pinnedUserId = null;
        if (Array.isArray(st.teacherJoinOrder)) st.teacherJoinOrder = st.teacherJoinOrder.filter(x => String(x) !== uid);
        const lab = getCallLabState(call);
        if (String(lab.sharedStudentId || '') === uid) {
          lab.sharedStudentId = '';
          lab.updatedAt = Date.now();
          io.to(getGroupRoomName(groupId)).emit('groupLabControl', {
            groupId,
            callId: String(call.callId || ''),
            sharedStudentId: '',
            enabled: false,
            grantedBy: String(st.ownerTeacherId || ''),
            at: Date.now()
          });
        }

        // If owner left, re-pick owner from remaining teacherJoinOrder
        if (st.ownerTeacherId && String(st.ownerTeacherId) === uid) st.ownerTeacherId = null;
        recalcOwnerIfNeeded(call);
        activeGroupCalls.set(groupId, call);
        emitGroupStageState(groupId, call);
      } catch(e) {}


      const participantsArr = Array.from(call.participants || []);
      if (isLessonHostLeaving) {
        activeGroupCalls.delete(groupId);
        const endedAt = new Date();
        await endGroupLessonLifecycle(groupId, call.callId, {
          endedAt,
          userIds: [String(userId), ...participantsArr.map(String)]
        });
        io.to(getGroupRoomName(groupId)).emit('groupCallEnded', {
          groupId,
          callId: call.callId,
          reason: 'teacher_left',
          timestamp: endedAt.getTime()
        });
        adminEmit('admin:groupCallUpdate', {
          action: 'ended',
          groupId: String(groupId),
          callId: String(call.callId),
          reason: 'teacher_left',
          endedBy: String(userId),
          participants: participantsArr.map(String),
          timestamp: endedAt.getTime()
        });
        return;
      }

      io.to(getGroupRoomName(groupId)).emit('groupCallUserLeft', {
        groupId,
        callId: call.callId,
        userId,
        reason: reason || 'left',
        participants: participantsArr
      });
      adminEmit('admin:groupCallUpdate', { action: 'left', groupId: String(groupId), callId: String(call.callId), userId: String(userId), reason: reason || 'left', participants: participantsArr.map(String), timestamp: Date.now() });

      // End call if nobody left
      if (participantsArr.length === 0) {
        activeGroupCalls.delete(groupId);
        const endedAt = new Date();
        await endGroupLessonLifecycle(groupId, call.callId, { endedAt, userIds: [String(userId)] });
        io.to(getGroupRoomName(groupId)).emit('groupCallEnded', {
          groupId,
          callId: call.callId,
          reason: 'empty',
          timestamp: endedAt.getTime()
        });
        adminEmit('admin:groupCallUpdate', { action: 'ended', groupId: String(groupId), callId: String(call.callId), reason: 'empty', timestamp: endedAt.getTime() });
      } else {
        activeGroupCalls.set(groupId, call);
      }
    } catch (e) {
      console.error('leaveGroupCallInternal error:', e);
    }
  }

  
  // ===== Group Call Stage Pin (owner teacher controls) =====
  socket.on('groupStagePin', async (data) => {
    try {
      if (!socket.userId) return;
      const groupId = String(data?.groupId || '');
      const callId = String(data?.callId || '');
      const targetUserId = String(data?.userId || '');
      if (!groupId || !callId || !targetUserId) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId) !== callId) return;

      const st = getCallStage(call);
      // Only owner teacher (or admin) can pin
      const chk = await isTeacherUser(socket.userId);
      const isOwner = (st.ownerTeacherId && String(st.ownerTeacherId) === String(socket.userId));
      if (!chk.isTeacher || (!isOwner && !chk.isAdmin)) return;

      // Only pin someone who is currently in the call
      if (!(call.participants && call.participants.has(targetUserId))) return;

      st.pinnedUserId = targetUserId;
      activeGroupCalls.set(groupId, call);
      emitGroupStageState(groupId, call);
    } catch (e) {
      console.error('groupStagePin error:', e);
    }
  });

  socket.on('groupStageUnpin', async (data) => {
    try {
      if (!socket.userId) return;
      const groupId = String(data?.groupId || '');
      const callId = String(data?.callId || '');
      if (!groupId || !callId) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId) !== callId) return;

      const st = getCallStage(call);
      const chk = await isTeacherUser(socket.userId);
      const isOwner = (st.ownerTeacherId && String(st.ownerTeacherId) === String(socket.userId));
      if (!chk.isTeacher || (!isOwner && !chk.isAdmin)) return;

      st.pinnedUserId = null;
      activeGroupCalls.set(groupId, call);
      emitGroupStageState(groupId, call);
    } catch (e) {
      console.error('groupStageUnpin error:', e);
    }
  });

socket.on('groupCallLeave', async (data) => {
    try {
      if (!socket.userId) return;
      const groupId = String(data?.groupId || '');
      const callId = String(data?.callId || '');
      if (!groupId || !callId) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId) !== callId) return;

      await leaveGroupCallInternal(groupId, socket.userId, 'left');
      socket._activeGroupCall = null;
    } catch (e) {
      console.error('groupCallLeave error:', e);
    }
  });

  socket.on('groupCallEnd', (data) => {
    (async () => {
    try {
      if (!socket.userId) return;
      const groupId = String(data?.groupId || '');
      const callId = String(data?.callId || '');
      if (!groupId || !callId) return;

      const call = activeGroupCalls.get(groupId);
      if (!call || String(call.callId) !== callId) return;

      // Only starter can end (simple rule)
      if (String(call.startedBy) !== String(socket.userId)) {
        return socket.emit('groupCallError', { error: 'Only starter can end the call' });
      }

      activeGroupCalls.delete(groupId);
      socket._activeGroupCall = null;
      const participantIds = Array.from(call.participants || []).map(String);
      const endedAt = new Date();
      await endGroupLessonLifecycle(groupId, callId, { endedAt, userIds: participantIds });
      io.to(getGroupRoomName(groupId)).emit('groupCallEnded', {
        groupId,
        callId,
        reason: 'ended_by_starter',
        timestamp: endedAt.getTime()
      });
      adminEmit('admin:groupCallUpdate', {
        action: 'ended',
        groupId: String(groupId),
        callId: String(callId),
        reason: 'ended_by_starter',
        endedBy: String(socket.userId),
        timestamp: endedAt.getTime()
      });

    } catch (e) {
      console.error('groupCallEnd error:', e);
      socket.emit('groupCallError', { error: 'Failed to end call' });
    }
    })();
  });

  // ==================== ZAKOVAT (Host-centric anti-cheat mode) ====================
  async function leaveZakovatInternal(sessionIdRaw, userIdRaw, socketIdRaw, reason = 'left') {
    const sid = normalizeZakovatSessionId(sessionIdRaw);
    const uid = String(userIdRaw || '');
    if (!sid || !uid) return;
    const session = activeZakovatSessions.get(sid);
    if (!session) return;

    if (socketIdRaw) removeZakovatSocket(session, uid, socketIdRaw);
    else session.socketMembers.delete(uid);

    const stillConnected = Number(session.socketMembers.get(uid)?.size || 0) > 0;
    if (stillConnected) {
      activeZakovatSessions.set(sid, session);
      return;
    }

    const hostId = String(session.hostId || '');
    if (uid === hostId) {
      endZakovatSession(sid, reason === 'disconnect' ? 'host_disconnected' : 'host_left', uid);
      return;
    }

    if (session.participants.has(uid)) {
      detachZakovatParticipant(session, uid, reason);
      activeZakovatSessions.set(sid, session);
      emitZakovatSession(session);
    }
  }

  socket.on('zakovat:start', async (payload) => {
    try {
      if (!socket.userId) return socket.emit('zakovat:error', { error: 'Not authenticated' });
      const uid = String(socket.userId || '');
      const sid = normalizeZakovatSessionId(payload?.sessionId || payload?.groupId || payload?.code || payload?.room);
      if (!sid) return socket.emit('zakovat:error', { error: 'sessionId required' });

      const role = String(socket.userRole || '').toLowerCase();
      if (!isZakovatHostRole(role, socket.isAdmin)) {
        return socket.emit('zakovat:error', { error: 'Only teacher/organizer/admin can start zakovat' });
      }

      const existingUserSession = findUserZakovatSession(uid);
      if (existingUserSession && String(existingUserSession.sessionId) !== sid) {
        return socket.emit('zakovat:error', { error: 'You are already active in another zakovat session' });
      }

      let session = activeZakovatSessions.get(sid);
      if (session && session.status === 'live' && String(session.hostId || '') !== uid) {
        return socket.emit('zakovat:error', { error: 'Session already has an active host' });
      }

      const me = await User.findById(uid).select('fullName username role isAdmin').lean().catch(() => null);
      const effectiveRole = String(me?.role || role || 'teacher').toLowerCase();
      if (!isZakovatHostRole(effectiveRole, !!(me?.isAdmin || socket.isAdmin))) {
        return socket.emit('zakovat:error', { error: 'Host permission denied' });
      }

      session = ensureZakovatSession(uid, sid, {
        title: payload?.title,
        durationSec: payload?.durationSec
      });
      if (!session) return socket.emit('zakovat:error', { error: 'Failed to start session' });

      session.hostId = uid;
      session.participants.add(uid);
      session.userMeta.set(uid, {
        userId: uid,
        fullName: String(me?.fullName || ''),
        username: String(me?.username || socket.username || ''),
        role: String(effectiveRole || 'teacher')
      });

      addZakovatSocket(session, uid, socket.id);
      activeZakovatSessions.set(sid, session);
      socket.join(getZakovatRoomName(sid));
      socket._zakovatSessionId = sid;

      socket.emit('zakovat:started', getZakovatSessionPayload(session, uid));
      emitZakovatSession(session);
    } catch (e) {
      console.error('zakovat:start error:', e);
      socket.emit('zakovat:error', { error: 'Failed to start zakovat session' });
    }
  });

  socket.on('zakovat:join', async (payload) => {
    try {
      if (!socket.userId) return socket.emit('zakovat:error', { error: 'Not authenticated' });
      const uid = String(socket.userId || '');
      const sid = normalizeZakovatSessionId(payload?.sessionId || payload?.groupId || payload?.code || payload?.room);
      if (!sid) return socket.emit('zakovat:error', { error: 'sessionId required' });

      const session = activeZakovatSessions.get(sid);
      if (!session || session.status !== 'live') {
        return socket.emit('zakovat:error', { error: 'Session not active' });
      }

      const existingUserSession = findUserZakovatSession(uid);
      if (existingUserSession && String(existingUserSession.sessionId) !== sid) {
        return socket.emit('zakovat:error', { error: 'You are already active in another zakovat session' });
      }

      if (session.lockedUsers.has(uid)) {
        return socket.emit('zakovat:blocked', {
          sessionId: sid,
          reason: 'locked_until_end',
          message: 'Cheating policy violated. Rejoin after session end.'
        });
      }

      const role = String(socket.userRole || '').toLowerCase();
      const isHost = String(session.hostId || '') === uid;

      if (!isHost && !session.participants.has(uid) && session.participants.size >= ZAKOVAT_MAX_PARTICIPANTS) {
        return socket.emit('zakovat:error', { error: `Max participants: ${ZAKOVAT_MAX_PARTICIPANTS}` });
      }

      const me = await User.findById(uid).select('fullName username role').lean().catch(() => null);
      session.participants.add(uid);
      session.userMeta.set(uid, {
        userId: uid,
        fullName: String(me?.fullName || ''),
        username: String(me?.username || socket.username || ''),
        role: String(me?.role || role || 'student')
      });

      addZakovatSocket(session, uid, socket.id);
      activeZakovatSessions.set(sid, session);
      socket.join(getZakovatRoomName(sid));
      socket._zakovatSessionId = sid;

      const joinedPayload = getZakovatSessionPayload(session, uid);
      socket.emit('zakovat:joined', joinedPayload);
      io.to(getZakovatRoomName(sid)).emit('zakovat:userJoined', {
        sessionId: sid,
        user: session.userMeta.get(uid),
        at: Date.now()
      });
      emitZakovatSession(session);
    } catch (e) {
      console.error('zakovat:join error:', e);
      socket.emit('zakovat:error', { error: 'Failed to join zakovat session' });
    }
  });

  socket.on('zakovat:signal', (payload) => {
    try {
      if (!socket.userId) return;
      const sid = normalizeZakovatSessionId(payload?.sessionId);
      const to = String(payload?.to || '').trim();
      const type = String(payload?.type || '').trim();
      const data = payload?.data;
      if (!sid || !to || !type) return;

      const session = activeZakovatSessions.get(sid);
      if (!session || session.status !== 'live') return;

      const from = String(socket.userId || '');
      const hostId = String(session.hostId || '');
      if (!(session.participants && session.participants.has(from))) return;
      if (!(session.participants && session.participants.has(to))) return;

      const fromIsHost = from === hostId;
      if (fromIsHost) {
        if (to === hostId) return;
      } else {
        if (to !== hostId) return; // participant -> host only
      }

      emitToUser(to, 'zakovat:signal', {
        sessionId: sid,
        from,
        type,
        data,
        timestamp: Date.now()
      });
    } catch (e) {
      console.error('zakovat:signal error:', e);
    }
  });

  socket.on('zakovat:cheat', (payload) => {
    try {
      if (!socket.userId) return;
      const sid = normalizeZakovatSessionId(payload?.sessionId);
      if (!sid) return;
      const session = activeZakovatSessions.get(sid);
      if (!session || session.status !== 'live') return;

      const uid = String(socket.userId || '');
      const hostId = String(session.hostId || '');
      if (uid === hostId) return; // do not auto-kick host from client signal
      if (!(session.participants && session.participants.has(uid))) return;

      const reason = cleanText(payload?.reason, 120) || 'policy';
      const violation = markZakovatViolation(session, uid, reason);
      session.lockedUsers.add(uid);
      detachZakovatParticipant(session, uid, 'cheat');
      activeZakovatSessions.set(sid, session);

      const userSocketsList = getUserSocketIds(uid);
      for (const sidSocket of userSocketsList) {
        try {
          const s = io.sockets.sockets.get(String(sidSocket));
          if (s) {
            s.leave(getZakovatRoomName(sid));
            if (String(s._zakovatSessionId || '') === sid) s._zakovatSessionId = null;
          }
        } catch (_) {}
      }

      emitToUser(uid, 'zakovat:blocked', {
        sessionId: sid,
        reason,
        message: 'Cheating policy violated. Rejoin after session end.'
      });

      emitToUser(hostId, 'zakovat:cheatDetected', {
        sessionId: sid,
        userId: uid,
        reason,
        count: Number(violation.count || 1),
        at: Date.now()
      });

      emitZakovatSession(session);
    } catch (e) {
      console.error('zakovat:cheat error:', e);
    }
  });

  socket.on('zakovat:leave', async (payload) => {
    try {
      if (!socket.userId) return;
      const sid = normalizeZakovatSessionId(payload?.sessionId || socket._zakovatSessionId || '');
      if (!sid) return;
      await leaveZakovatInternal(sid, socket.userId, socket.id, 'left');
      if (String(socket._zakovatSessionId || '') === sid) socket._zakovatSessionId = null;
    } catch (e) {
      console.error('zakovat:leave error:', e);
    }
  });

  socket.on('zakovat:end', (payload) => {
    try {
      if (!socket.userId) return;
      const sid = normalizeZakovatSessionId(payload?.sessionId || socket._zakovatSessionId || '');
      if (!sid) return;
      const session = activeZakovatSessions.get(sid);
      if (!session || session.status !== 'live') return;
      const isOwner = String(session.hostId || '') === String(socket.userId || '');
      const isAdmin = !!socket.isAdmin || String(socket.userRole || '').toLowerCase() === 'admin';
      if (!isOwner && !isAdmin) return;
      endZakovatSession(sid, 'ended_by_host', String(socket.userId || ''));
    } catch (e) {
      console.error('zakovat:end error:', e);
    }
  });

  socket.on('zakovat:state', (payload) => {
    try {
      if (!socket.userId) return;
      const sid = normalizeZakovatSessionId(payload?.sessionId || socket._zakovatSessionId || '');
      if (!sid) return;
      const session = activeZakovatSessions.get(sid);
      if (!session || session.status !== 'live') return;
      if (!(session.participants && session.participants.has(String(socket.userId || '')))) return;
      socket.emit('zakovat:session', getZakovatSessionPayload(session, socket.userId));
    } catch (e) {
      console.error('zakovat:state error:', e);
    }
  });

  // ==================== MINI GAMES SOCKET (Realtime PVP) ====================
  socket.on('game:resume', async () => {
    try {
      if (!socket.userId) return;
      const uid = String(socket.userId);
      const gameId = userMiniGame.get(uid);
      if (!gameId) return;
      const state = activeMiniGames.get(String(gameId));
      if (!state || state.status !== 'active') return;
      const payload = buildTicStateForUser(state, uid, { message: 'Active game resumed' });
      socket.emit('game:update', payload);
    } catch (e) {
      console.error('game:resume error:', e);
    }
  });

  socket.on('game:queueJoin', async (payload) => {
    try {
      if (!socket.userId) return socket.emit('game:error', { error: 'Not authenticated' });
      const uid = String(socket.userId);
      const role = String(socket.userRole || '').toLowerCase();
      if (role === 'teacher' || role === 'admin' || role === 'organizer') {
        return socket.emit('game:error', { error: 'Mini games are available for students during call' });
      }
      const gameType = String(payload?.gameType || 'tic_tac_toe').trim().toLowerCase();
      if (gameType !== 'tic_tac_toe') {
        return socket.emit('game:error', { error: 'Only tic_tac_toe is currently supported' });
      }

      const context = await resolveMiniContextForUser(uid, {
        scope: payload?.scope,
        groupId: payload?.groupId,
        opponentId: payload?.opponentId
      });
      if (!context.ok) return socket.emit('game:error', { error: context.error || 'Invalid context' });

      // If already in active game, push its current state.
      const existingGameId = userMiniGame.get(uid);
      if (existingGameId) {
        const state = activeMiniGames.get(String(existingGameId));
        if (state && state.status === 'active') {
          socket.emit('game:update', buildTicStateForUser(state, uid, { message: 'Already in active game' }));
          return;
        }
        userMiniGame.delete(uid);
      }

      // Keep each user in only one queue at a time.
      removeUserFromMiniGameQueues(uid);

      if (context.scope === 'global') {
        enqueueUnique(miniGameQueues.tic_tac_toe.global, uid);
        const state = await tryMatchMiniQueue('tic_tac_toe', 'global');
        if (!state) {
          emitMiniQueueStateToUser(uid, {
            scope: 'global',
            status: 'waiting',
            waiting: miniGameQueues.tic_tac_toe.global.length,
            position: getQueuePosition(miniGameQueues.tic_tac_toe.global, uid)
          });
        } else {
          for (const p of (state.players || [])) {
            emitMiniQueueStateToUser(p, { scope: 'global', status: 'matched', waiting: 0, position: 0 });
          }
        }
        return;
      }

      if (context.scope === 'group') {
        const gid = String(context.groupId || '');
        const q = miniGameQueues.tic_tac_toe.group.get(gid) || [];
        enqueueUnique(q, uid);
        miniGameQueues.tic_tac_toe.group.set(gid, q);

        const state = await tryMatchMiniQueue('tic_tac_toe', 'group', { groupId: gid });
        if (!state) {
          emitMiniQueueStateToUser(uid, {
            scope: 'group',
            groupId: gid,
            status: 'waiting',
            waiting: q.length,
            position: getQueuePosition(q, uid)
          });
        } else {
          for (const p of (state.players || [])) {
            emitMiniQueueStateToUser(p, { scope: 'group', groupId: gid, status: 'matched', waiting: 0, position: 0 });
          }
        }
        return;
      }

      // Duel scope
      const opponentId = String(context.opponentId || '');
      const key = duelPairKey(uid, opponentId);
      const set = miniGameQueues.tic_tac_toe.duel.get(key) || new Set();
      set.add(uid);
      miniGameQueues.tic_tac_toe.duel.set(key, set);

      const meName = (socket.username || socket.userName || '').toString().trim();
      emitToUser(opponentId, 'game:duelInvite', {
        success: true,
        gameType: 'tic_tac_toe',
        fromUserId: uid,
        fromName: meName || 'User',
        scope: 'duel'
      });

      const state = await tryMatchMiniQueue('tic_tac_toe', 'duel', { pairKey: key, userId: uid });
      if (!state) {
        emitMiniQueueStateToUser(uid, {
          scope: 'duel',
          opponentId,
          status: 'waiting',
          waiting: set.size,
          position: set.size
        });
      } else {
        for (const p of (state.players || [])) {
          const opp = (state.players || []).find((x) => String(x) !== String(p)) || '';
          emitMiniQueueStateToUser(p, { scope: 'duel', opponentId: String(opp), status: 'matched', waiting: 0, position: 0 });
        }
      }
    } catch (e) {
      console.error('game:queueJoin error:', e);
      socket.emit('game:error', { error: 'Failed to join game queue' });
    }
  });

  socket.on('game:queueLeave', () => {
    try {
      if (!socket.userId) return;
      removeUserFromMiniGameQueues(String(socket.userId));
      socket.emit('game:queueState', {
        success: true,
        gameType: 'tic_tac_toe',
        status: 'left',
        waiting: 0,
        position: 0
      });
    } catch (e) {
      console.error('game:queueLeave error:', e);
    }
  });

  socket.on('game:move', async (payload) => {
    try {
      if (!socket.userId) return;
      const uid = String(socket.userId);
      const gameId = String(payload?.gameId || userMiniGame.get(uid) || '');
      const index = Math.floor(Number(payload?.index));
      if (!gameId) return socket.emit('game:error', { error: 'gameId missing' });
      if (!Number.isInteger(index) || index < 0 || index > 8) return socket.emit('game:error', { error: 'Invalid move index' });

      const state = activeMiniGames.get(gameId);
      if (!state) return socket.emit('game:error', { error: 'Game not found' });
      if (state.status !== 'active') return socket.emit('game:error', { error: 'Game already finished' });
      if (String(state.gameType) !== 'tic_tac_toe') return socket.emit('game:error', { error: 'Unsupported game' });
      if (!(state.players || []).some((x) => String(x) === uid)) return socket.emit('game:error', { error: 'Not your game' });
      if (String(state.turn) !== uid) return socket.emit('game:error', { error: 'Not your turn' });
      if ((state.board || [])[index]) return socket.emit('game:error', { error: 'Cell already occupied' });

      const mySymbol = state.symbols?.[uid];
      if (!mySymbol) return socket.emit('game:error', { error: 'Your symbol not found' });
      state.board[index] = mySymbol;

      const winnerSymbol = findTicWinnerSymbol(state.board);
      if (winnerSymbol) {
        const winnerId = (state.players || []).find((u) => String(state.symbols?.[String(u)] || '') === String(winnerSymbol)) || null;
        await finalizeTicGame(gameId, winnerId ? String(winnerId) : null, 'completed');
        return;
      }

      if (boardIsFull(state.board)) {
        await finalizeTicGame(gameId, null, 'draw');
        return;
      }

      const next = (state.players || []).find((x) => String(x) !== uid) || uid;
      state.turn = String(next);
      activeMiniGames.set(gameId, state);
      await emitTicState(state, 'game:update', {
        [uid]: { lastMove: index },
        [String(next)]: { lastMove: index }
      });
    } catch (e) {
      console.error('game:move error:', e);
      socket.emit('game:error', { error: 'Failed to apply move' });
    }
  });

  socket.on('game:leave', async () => {
    try {
      if (!socket.userId) return;
      removeUserFromMiniGameQueues(String(socket.userId));
      await forfeitMiniGame(String(socket.userId), 'left_game');
    } catch (e) {
      console.error('game:leave error:', e);
    }
  });

  // ==================== CHANNEL LIVE (WebRTC one-to-many) ====================
  // Host (channel creator) can start a live stream (camera or screen share).
  // Viewers can join to watch (receive-only).
  //
  // Signaling flow (per viewer):
  // - Viewer clicks Join -> server notifies host: channelLive:viewerJoin
  // - Host creates RTCPeerConnection, adds tracks, creates OFFER -> server relays to viewer
  // - Viewer sets remote offer, creates ANSWER -> server relays to host
  // - ICE candidates exchanged both ways.
  //
  // Security:
  // - Only channel.creatorId can start/stop.
  // - Viewers must be subscribed OR channel is public OR viewer is creator/moderator.
  socket.on('channelLive:ping', async (data) => {
    try {
      const channelId = String(data?.channelId || '');
      if (!channelId) return;

      const live = activeChannelLives.get(channelId);
      socket.emit('channelLive:status', {
        channelId,
        isLive: !!live,
        hostId: live?.hostId || null,
        startedAt: live?.startedAt || null,
        mode: live?.mode || null,
        viewersCount: live?.viewers ? live.viewers.size : 0
      });
    } catch (e) {
      console.error('channelLive:ping error:', e);
    }
  });

  socket.on('channelLive:start', async (data) => {
    try {
      if (!socket.userId) return socket.emit('channelLive:error', { error: 'Not authenticated' });

      const channelId = String(data?.channelId || '');
      const mode = String(data?.mode || 'camera'); // camera | screen
      if (!channelId) return;

      const ch = await Channel.findById(channelId).select('creatorId moderators isPublic subscribers').lean();
      if (!ch) return socket.emit('channelLive:error', { error: 'Channel not found' });

      const isCreator = String(ch.creatorId) === String(socket.userId);
      if (!isCreator) return socket.emit('channelLive:error', { error: 'Only channel owner can start live' });

      const live = {
        hostId: String(socket.userId),
        startedAt: Date.now(),
        mode: (mode === 'screen' ? 'screen' : 'camera'),
        viewers: new Set()
      };

      activeChannelLives.set(channelId, live);
      adminEmit('admin:channelLiveUpdate', { action: 'viewer_joined', channelId: String(channelId), userId: String(socket.userId), viewersCount: (live.viewers && live.viewers.size) ? live.viewers.size : 0, timestamp: Date.now() });

      // Put host into live room
      socket.join(getChannelLiveRoomName(channelId));

      // Notify everyone in channel room that live started
      io.to(`channel_${channelId}`).emit('channelLive:status', {
        channelId,
        isLive: true,
        hostId: live.hostId,
        startedAt: live.startedAt,
        mode: live.mode,
        viewersCount: 0
      });

      socket.emit('channelLive:started', {
        channelId,
        startedAt: live.startedAt,
        mode: live.mode
      });
      adminEmit('admin:channelLiveUpdate', { action: 'started', channelId: String(channelId), hostId: String(live.hostId), mode: String(live.mode), startedAt: live.startedAt, timestamp: Date.now() });

      console.log(`🔴 Live started: channel=${channelId} host=${live.hostId} mode=${live.mode}`);
    } catch (e) {
      console.error('channelLive:start error:', e);
      socket.emit('channelLive:error', { error: 'Failed to start live' });
    }
  });

  socket.on('channelLive:stop', async (data) => {
    try {
      if (!socket.userId) return;
      const channelId = String(data?.channelId || '');
      if (!channelId) return;

      const live = activeChannelLives.get(channelId);
      if (!live) return;

      if (String(live.hostId) !== String(socket.userId)) {
        return socket.emit('channelLive:error', { error: 'Only host can stop live' });
      }

      activeChannelLives.delete(channelId);

      // Notify viewers + channel room
      io.to(getChannelLiveRoomName(channelId)).emit('channelLive:ended', {
        channelId,
        hostId: live.hostId,
        reason: 'stopped',
        timestamp: Date.now()
      });
      adminEmit('admin:channelLiveUpdate', { action: 'stopped', channelId: String(channelId), hostId: String(live.hostId), reason: 'stopped', timestamp: Date.now() });

      io.to(`channel_${channelId}`).emit('channelLive:status', {
        channelId,
        isLive: false,
        hostId: live.hostId,
        startedAt: null,
        mode: null,
        viewersCount: 0
      });

      // Leave room
      socket.leave(getChannelLiveRoomName(channelId));

      console.log(`⏹️ Live stopped: channel=${channelId} host=${live.hostId}`);
    } catch (e) {
      console.error('channelLive:stop error:', e);
      socket.emit('channelLive:error', { error: 'Failed to stop live' });
    }
  });

  socket.on('channelLive:join', async (data) => {
    try {
      if (!socket.userId) return socket.emit('channelLive:error', { error: 'Not authenticated' });

      const channelId = String(data?.channelId || '');
      if (!channelId) return;

      const live = activeChannelLives.get(channelId);
      if (!live) {
        socket.emit('channelLive:status', { channelId, isLive: false, hostId: null });
        return;
      }

      // Access control (simple)
      const ch = await Channel.findById(channelId).select('creatorId moderators isPublic subscribers').lean();
      if (!ch) return socket.emit('channelLive:error', { error: 'Channel not found' });

      const isCreator = String(ch.creatorId) === String(socket.userId);
      const isModerator = Array.isArray(ch.moderators) && ch.moderators.some(id => String(id) === String(socket.userId));
      const isSubscriber = Array.isArray(ch.subscribers) && ch.subscribers.some(id => String(id) === String(socket.userId));
      const canView = !!ch.isPublic || isSubscriber || isCreator || isModerator;

      if (!canView) return socket.emit('channelLive:error', { error: 'You must subscribe to watch this live' });

      // Join viewer to live room
      socket.join(getChannelLiveRoomName(channelId));
      live.viewers.add(String(socket.userId));
      activeChannelLives.set(channelId, live);

      socket.emit('channelLive:joined', {
        channelId,
        hostId: live.hostId,
        startedAt: live.startedAt,
        mode: live.mode
      });

      // Inform host to create offer for this viewer
      emitToUser(live.hostId, 'channelLive:viewerJoin', {
        channelId,
        viewerId: String(socket.userId)
      });

      // Broadcast status update to channel room
      io.to(`channel_${channelId}`).emit('channelLive:status', {
        channelId,
        isLive: true,
        hostId: live.hostId,
        startedAt: live.startedAt,
        mode: live.mode,
        viewersCount: live.viewers.size
      });

      console.log(`👀 Viewer joined live: channel=${channelId} viewer=${socket.userId} host=${live.hostId}`);
    } catch (e) {
      console.error('channelLive:join error:', e);
      socket.emit('channelLive:error', { error: 'Failed to join live' });
    }
  });

  socket.on('channelLive:leave', (data) => {
    try {
      if (!socket.userId) return;
      const channelId = String(data?.channelId || '');
      if (!channelId) return;

      const live = activeChannelLives.get(channelId);
      if (!live) return;

      // Host leaving => stop
      if (String(live.hostId) === String(socket.userId)) {
        activeChannelLives.delete(channelId);

        io.to(getChannelLiveRoomName(channelId)).emit('channelLive:ended', {
          channelId,
          hostId: live.hostId,
          reason: 'host_left',
          timestamp: Date.now()
        });

        io.to(`channel_${channelId}`).emit('channelLive:status', {
          channelId,
          isLive: false,
          hostId: live.hostId,
          startedAt: null,
          mode: null,
          viewersCount: 0
        });

        socket.leave(getChannelLiveRoomName(channelId));
        return;
      }

      // Viewer leaving
      live.viewers.delete(String(socket.userId));
      activeChannelLives.set(channelId, live);
      adminEmit('admin:channelLiveUpdate', { action: 'viewer_left', channelId: String(channelId), userId: String(socket.userId), viewersCount: (live.viewers && live.viewers.size) ? live.viewers.size : 0, timestamp: Date.now() });
      socket.leave(getChannelLiveRoomName(channelId));

      emitToUser(live.hostId, 'channelLive:viewerLeft', {
        channelId,
        viewerId: String(socket.userId)
      });

      io.to(`channel_${channelId}`).emit('channelLive:status', {
        channelId,
        isLive: true,
        hostId: live.hostId,
        startedAt: live.startedAt,
        mode: live.mode,
        viewersCount: live.viewers.size
      });

      console.log(`🚪 Viewer left live: channel=${channelId} viewer=${socket.userId}`);
    } catch (e) {
      console.error('channelLive:leave error:', e);
    }
  });

  // Relay signaling: host -> viewer
  socket.on('channelLive:offer', (data) => {
    try {
      if (!socket.userId) return;
      const channelId = String(data?.channelId || '');
      const to = String(data?.to || '');
      const sdp = data?.sdp;
      if (!channelId || !to || !sdp) return;

      const live = activeChannelLives.get(channelId);
      if (!live) return;
      if (String(live.hostId) !== String(socket.userId)) return; // only host can send offers

      emitToUser(to, 'channelLive:offer', {
        channelId,
        from: String(socket.userId),
        sdp
      });
    } catch (e) {
      console.error('channelLive:offer error:', e);
    }
  });

  // Relay signaling: viewer -> host
  socket.on('channelLive:answer', (data) => {
    try {
      if (!socket.userId) return;
      const channelId = String(data?.channelId || '');
      const sdp = data?.sdp;
      if (!channelId || !sdp) return;

      const live = activeChannelLives.get(channelId);
      if (!live) return;

      emitToUser(live.hostId, 'channelLive:answer', {
        channelId,
        from: String(socket.userId),
        sdp
      });
    } catch (e) {
      console.error('channelLive:answer error:', e);
    }
  });

  // ICE relay both directions (viewer -> host via no "to"; host -> viewer includes "to")
  socket.on('channelLive:ice', (data) => {
    try {
      if (!socket.userId) return;
      const channelId = String(data?.channelId || '');
      const candidate = data?.candidate;
      if (!channelId || !candidate) return;

      const live = activeChannelLives.get(channelId);
      if (!live) return;

      // host sending to a viewer
      if (String(live.hostId) === String(socket.userId)) {
        const to = String(data?.to || '');
        if (!to) return;
        emitToUser(to, 'channelLive:ice', {
          channelId,
          from: String(socket.userId),
          candidate
        });
        return;
      }

      // viewer sending to host
      emitToUser(live.hostId, 'channelLive:ice', {
        channelId,
        from: String(socket.userId),
        candidate
      });
    } catch (e) {
      console.error('channelLive:ice error:', e);
    }
  });




  // Join chat room

  // Join/leave channel room (for real-time channel posts/updates)
  socket.on('joinChannel', (channelId) => {
    try {
      if (!channelId) return;
      socket.join(`channel_${channelId}`);
      socket.emit('channelJoined', { channelId });
      console.log(`📡 Socket ${socket.id} joined channel room channel_${channelId}`);
    } catch (e) {
      console.error('joinChannel error:', e);
    }
  });

  socket.on('leaveChannel', (channelId) => {
    try {
      if (!channelId) return;
      socket.leave(`channel_${channelId}`);
      socket.emit('channelLeft', { channelId });
    } catch (e) {
      console.error('leaveChannel error:', e);
    }
  });

  socket.on('joinChat', async ({ userId, targetUserId }) => {
    try {
      const roomName = getChatRoomName(userId, targetUserId);
      socket.join(roomName);
      console.log(`👥 User ${userId} joined chat room: ${roomName}`);
      
      socket.emit('chatJoined', { roomName });
    } catch (error) {
      console.error('Join chat error:', error);
    }
  });
  
  // Leave chat room
  socket.on('leaveChat', ({ userId, targetUserId }) => {
    const roomName = getChatRoomName(userId, targetUserId);
    socket.leave(roomName);
    console.log(`👋 User ${userId} left chat room: ${roomName}`);
  });
  
  // Private message (1v1 chat)
  socket.on('privateMessage', async (data) => {
    try {
      const { senderId, receiverId, text, mediaUrl, mediaType, mediaMetadata, clientTempId } = data;
      
      console.log(`📨 Message from ${senderId} to ${receiverId}:`, text?.substring(0, 50));
      
      // Normalize mediaType:
      // - Client may send '' for plain text
      // - Older clients may send 'text' (not in enum)
      const normalizedMediaType = (typeof mediaType === 'string' && mediaType.trim() === 'text')
        ? ''
        : (mediaType || '');

      const message = new Message({
        senderId: senderId,
        receiverId: receiverId,
        text: text || '',
        mediaUrl: mediaUrl || '',
        mediaType: normalizedMediaType,
        mediaMetadata: mediaMetadata,
        isRead: false,
        isDelivered: false
      });
      
      await message.save();
      
      // Update stats
      await Stats.findOneAndUpdate({}, { $inc: { totalMessages: 1 } });
      
      const populatedMessageDoc = await Message.findById(message._id)
        .populate('senderId', 'username nickname avatar')
        .populate('receiverId', 'username nickname avatar');

      // Attach clientTempId (used for optimistic UI reconciliation)
      const populatedMessage = populatedMessageDoc.toObject();
      if (clientTempId) populatedMessage.clientTempId = clientTempId;
      
      const roomName = getChatRoomName(senderId, receiverId);
      
      // Emit to the chat room (both users will receive)
      io.to(roomName).emit('newMessage', populatedMessage);
      
      // Mark as delivered if receiver is in room
      const receiverSocketId = getUserSocketId(receiverId);
      if (receiverSocketId) {
        message.isDelivered = true;
        await message.save();
        
        io.to(receiverSocketId).emit('messageNotification', {
          message: populatedMessage,
          unreadCount: await Message.countDocuments({
            receiverId: receiverId,
            senderId: senderId,
            isRead: false
          })
        });
      }
      
      // Update sender's socket about message sent
      const senderSocketId = getUserSocketId(senderId);
      if (senderSocketId) {
        io.to(senderSocketId).emit('messageSent', populatedMessage);
      }
      
    } catch (error) {
      console.error('❌ Error sending private message:', error);
      socket.emit('messageError', { error: 'Failed to send message' });
    }
  });
  
  // Typing indicator
  socket.on('typing', (data) => {
    const { userId, isTyping } = data;
    
    if (userId && socket.userId) {
      const targetSocketId = getUserSocketId(userId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('userTyping', { 
          userId: socket.userId, 
          isTyping: isTyping,
          timestamp: Date.now()
        });
      }
    }
  });
  
  // Mark message as read
  socket.on('markMessageRead', async (data) => {
    try {
      const { messageId, readerId } = data;
      
      const message = await Message.findById(messageId);
      if (message && message.receiverId.toString() === readerId) {
        message.isRead = true;
        await message.save();
        
        const senderSocketId = getUserSocketId(message.senderId.toString());
        if (senderSocketId) {
          io.to(senderSocketId).emit('messageRead', {
            messageId: messageId,
            readerId: readerId,
            timestamp: Date.now()
          });
        }
      }
    } catch (error) {
      console.error('❌ Error marking message as read:', error);
    }
  });
  
  // Mark messages as delivered
  socket.on('markMessagesDelivered', async (data) => {
    try {
      const { messageIds, userId } = data;
      
      await Message.updateMany(
        { _id: { $in: messageIds }, receiverId: userId },
        { isDelivered: true }
      );
      
      const messages = await Message.find({ _id: { $in: messageIds } });
      messages.forEach(async (message) => {
        const senderSocketId = getUserSocketId(message.senderId.toString());
        if (senderSocketId) {
          io.to(senderSocketId).emit('messageDelivered', {
            messageId: message._id,
            receiverId: userId,
            timestamp: Date.now()
          });
        }
      });
    } catch (error) {
      console.error('Error marking messages delivered:', error);
    }
  });
  
  // WebRTC Signaling
  
  // Call offer
  socket.on('callOffer', async (data) => {
    try {
      console.log('📞 Call offer from:', socket.userId, 'to:', data.to, 'type:', data.type);
      
      const receiver = await User.findById(data.to);
      if (!receiver) {
        socket.emit('callError', { error: 'User not found' });
        return;
      }
      
      if (!isUserOnline(data.to)) {
        const callHistory = new CallHistory({
          callerId: socket.userId,
          receiverId: data.to,
          type: data.type,
          status: 'missed',
          duration: 0
        });
        await callHistory.save();

      // Track active private call for admin realtime
      activePrivateCalls.set(String(callHistory._id), {
        callId: String(callHistory._id),
        callerId: String(socket.userId),
        receiverId: String(data.to),
        type: data.type,
        status: 'initiated',
        startedAt: Date.now()
      });
      adminEmit('admin:privateCallUpdate', { action: 'initiated', callId: String(callHistory._id), callerId: String(socket.userId), receiverId: String(data.to), type: data.type, timestamp: Date.now() });

        
        socket.emit('callError', { error: 'User is offline' });
        return;
      }
      
      const callHistory = new CallHistory({
        callerId: socket.userId,
        receiverId: data.to,
        type: data.type,
        status: 'initiated',
        duration: 0
      });
      await callHistory.save();
      
      const caller = await User.findById(socket.userId).select('username nickname avatar');
      
      const offerData = {
        ...data,
        from: socket.userId,
        callerInfo: {
          userId: socket.userId,
          nickname: caller.nickname,
          avatar: caller.avatar,
          callId: callHistory._id,
          timestamp: Date.now()
        }
      };
      
      emitToUser(data.to, 'callOffer', offerData);
      
      console.log(`📞 Call offer sent to ${data.to}`);
      
    } catch (error) {
      console.error('Call offer error:', error);
      socket.emit('callError', { error: 'Failed to initiate call' });
    }
  });
  
  // Call answer
  socket.on('callAnswer', async (data) => {
    try {
      console.log('✅ Call answer from:', socket.userId, 'to:', data.to);
      
      if (data.callId) {
        await CallHistory.findByIdAndUpdate(data.callId, {
          status: data.answer ? 'accepted' : 'rejected'
        });
      }
      
      const answerData = {
        ...data,
        from: socket.userId,
        timestamp: Date.now()
      };
      
      emitToUser(data.to, 'callAnswer', answerData);
      
    } catch (error) {
      console.error('Call answer error:', error);
    }
  });
  
  // ICE candidate
  socket.on('iceCandidate', (data) => {
    console.log('❄️ ICE candidate from:', socket.userId, 'to:', data.to);
    
    const candidateData = {
      ...data,
      from: socket.userId,
      timestamp: Date.now()
    };
    
    emitToUser(data.to, 'iceCandidate', candidateData);
  });
  
  // Call ended
  socket.on('callEnded', async (data) => {
    try {
      console.log('📞 Call ended from:', socket.userId, 'to:', data.to);
      
      if (data.callId) {
        await CallHistory.findByIdAndUpdate(data.callId, {
          status: 'completed',
          duration: data.duration || 0,
          endedAt: Date.now()
        });
      }

      // Remove from active private calls (admin realtime)
      if (data.callId) {
        const id = String(data.callId);
        activePrivateCalls.delete(id);
        adminEmit('admin:privateCallUpdate', { action: 'ended', callId: id, from: String(socket.userId), to: String(data.to), duration: data.duration || 0, timestamp: Date.now() });
      }

      const endData = {
        ...data,
        from: socket.userId,
        timestamp: Date.now()
      };
      
      emitToUser(data.to, 'callEnded', endData);
      
      if (data.roomId) {
        io.to(data.roomId).emit('callEnded', endData);
      }
      
    } catch (error) {
      console.error('Call ended error:', error);
    }
  });
  
  // Call rejected
  socket.on('callRejected', async (data) => {
    try {
      console.log('❌ Call rejected from:', socket.userId, 'to:', data.to);
      
      if (data.callId) {
        await CallHistory.findByIdAndUpdate(data.callId, {
          status: 'rejected',
          endedAt: Date.now()
        });
      }

      // Remove from active private calls (admin realtime)
      if (data.callId) {
        const id = String(data.callId);
        activePrivateCalls.delete(id);
        adminEmit('admin:privateCallUpdate', { action: 'rejected', callId: id, from: String(socket.userId), to: String(data.to), timestamp: Date.now() });
      }

      const rejectData = {
        ...data,
        from: socket.userId,
        timestamp: Date.now()
      };
      
      emitToUser(data.to, 'callRejected', rejectData);
    } catch (error) {
      console.error('Call rejected error:', error);
    }
  });
  
  // Call missed
  socket.on('callMissed', async (data) => {
    try {
      console.log('📞 Call missed from:', socket.userId, 'to:', data.to);
      
      if (data.callId) {
        await CallHistory.findByIdAndUpdate(data.callId, {
          status: 'missed',
          endedAt: Date.now()
        });
      }

      // Remove from active private calls (admin realtime)
      if (data.callId) {
        const id = String(data.callId);
        activePrivateCalls.delete(id);
        adminEmit('admin:privateCallUpdate', { action: 'missed', callId: id, from: String(socket.userId), to: String(data.to), timestamp: Date.now() });
      }
    } catch (error) {
      console.error('Call missed error:', error);
    }
  });
  
  // Call timeout (no answer)
  socket.on('callTimeout', async (data) => {
    try {
      console.log('⏰ Call timeout from:', socket.userId, 'to:', data.to);
      
      if (data.callId) {
        await CallHistory.findByIdAndUpdate(data.callId, {
          status: 'missed',
          endedAt: Date.now()
        });
      }

      // Remove from active private calls (admin realtime)
      if (data.callId) {
        const id = String(data.callId);
        activePrivateCalls.delete(id);
        adminEmit('admin:privateCallUpdate', { action: 'timeout', callId: id, from: String(socket.userId), to: String(data.to), timestamp: Date.now() });
      }
      
      emitToUser(data.to, 'callTimeout', {
        to: data.to,
        callId: data.callId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Call timeout error:', error);
    }
  });
  
  // Get online status
  socket.on('checkOnline', (data) => {
    const { userId } = data;
    const userData = onlineUsers.get(userId);
    const isOnline = isUserOnline(userId);
    
    socket.emit('onlineStatus', { 
      userId, 
      isOnline,
      lastActive: userData?.lastActive 
    });
  });
  
  // Get online users
  socket.on('getOnlineUsers', () => {
    const onlineUserIds = Array.from(onlineUsers.keys());
    socket.emit('onlineUsersList', { 
      users: onlineUserIds,
      count: onlineUserIds.length,
      timestamp: Date.now()
    });
  });
  
  // User activity ping
  socket.on('activityPing', async () => {
    if (socket.userId) {
      const userData = onlineUsers.get(socket.userId);
      if (userData) {
        userData.lastActive = Date.now();
        onlineUsers.set(socket.userId, userData);
        
        const now = Date.now();
        if (!userData.lastDbUpdate || (now - userData.lastDbUpdate) > 60000) {
          await User.findByIdAndUpdate(socket.userId, {
            lastActive: now
          });
          userData.lastDbUpdate = now;
          onlineUsers.set(socket.userId, userData);
        }
      }
    }
  });
  
  

// ==================== COURSE LIVE (WebRTC one-to-many) ====================
// Flow:
// 1) Teacher schedules via /api/lives, then calls /api/lives/:id/start
// 2) Host opens /live.html?id=LIVE_ID&host=1 and socket emits live:hostJoin
// 3) Students call /api/lives/:id/enter (coin gate), then open /live.html?id=LIVE_ID and socket emits live:viewerJoin
// 4) Signaling is relayed via socket events below (simple mesh: host -> each viewer)

socket.on('live:hostJoin', async ({ liveId }) => {
  try {
    if (!socket.userId) return socket.emit('live:error', { error: 'Not authenticated' });
    if (!liveId) return socket.emit('live:error', { error: 'liveId required' });

    const live = await LiveSession.findById(liveId).lean();
    if (!live) return socket.emit('live:error', { error: 'Live not found' });
    if (String(live.hostId) !== String(socket.userId)) return socket.emit('live:error', { error: 'Only host' });
    if (live.status !== 'live' && live.status !== 'scheduled') return socket.emit('live:error', { error: 'Live is ended' });

    const room = getLiveRoomName(String(liveId));
    socket.join(room);

    const st = activeCourseLives.get(String(liveId)) || { hostId: socket.userId, startedAt: Date.now(), mode: 'mesh', viewers: new Set() };
    st.hostId = socket.userId;
    activeCourseLives.set(String(liveId), st);

    io.to(room).emit('live:status', { liveId: String(liveId), status: 'live', hostId: socket.userId, viewers: st.viewers.size });
    socket.emit('live:hostReady', { liveId: String(liveId) });
  } catch (e) {
    console.error('❌ live:hostJoin error:', e);
    socket.emit('live:error', { error: 'Host join failed' });
  }
});

socket.on('live:viewerJoin', async ({ liveId }) => {
  try {
    if (!socket.userId) return socket.emit('live:error', { error: 'Not authenticated' });
    if (!liveId) return socket.emit('live:error', { error: 'liveId required' });

    const live = await LiveSession.findById(liveId).lean();
    if (!live) return socket.emit('live:error', { error: 'Live not found' });
    if (live.status !== 'live' && live.status !== 'scheduled') return socket.emit('live:error', { error: 'Live ended' });

    // Access check (paid gate must be done via /api/lives/:id/enter)
    if (String(live.hostId) !== String(socket.userId) && live.type === 'paid' && (live.price || 0) > 0) {
      const access = await LiveAccess.findOne({ liveId: live._id, userId: socket.userId }).lean();
      if (!access || !access.paid) {
        return socket.emit('live:error', { error: 'Paid access required', redirect: '/topup.html' });
      }
    }

    const room = getLiveRoomName(String(liveId));
    socket.join(room);

    const st = activeCourseLives.get(String(liveId)) || { hostId: String(live.hostId), startedAt: Date.now(), mode: 'mesh', viewers: new Set() };
    st.viewers.add(String(socket.userId));
    activeCourseLives.set(String(liveId), st);

    // Notify host & room
    io.to(room).emit('live:viewers', { liveId: String(liveId), viewers: st.viewers.size });
    io.to(`user_${st.hostId}`).emit('live:viewerJoined', { liveId: String(liveId), viewerId: String(socket.userId) });
    socket.emit('live:viewerReady', { liveId: String(liveId), hostId: st.hostId });
  } catch (e) {
    console.error('❌ live:viewerJoin error:', e);
    socket.emit('live:error', { error: 'Viewer join failed' });
  }
});

// Signaling relay: host -> viewer (offer, ice), viewer -> host (answer, ice)
socket.on('live:offer', ({ liveId, toUserId, offer }) => {
  if (!socket.userId) return;
  io.to(`user_${toUserId}`).emit('live:offer', { liveId, fromUserId: socket.userId, offer });
});
socket.on('live:answer', ({ liveId, toUserId, answer }) => {
  if (!socket.userId) return;
  io.to(`user_${toUserId}`).emit('live:answer', { liveId, fromUserId: socket.userId, answer });
});
socket.on('live:ice', ({ liveId, toUserId, candidate }) => {
  if (!socket.userId) return;
  io.to(`user_${toUserId}`).emit('live:ice', { liveId, fromUserId: socket.userId, candidate });
});

// MVP live chat (no DB): broadcast to live room
socket.on('chat:live', ({ liveId, text }) => {
  try{
    if (!socket.userId) return;
    const clean = String(text || '').slice(0, 500);
    const room = getLiveRoomName(String(liveId));
    io.to(room).emit('chat:live', { liveId: String(liveId), userId: socket.userId, name: socket.username || 'User', text: clean, ts: Date.now() });
  }catch(_){}
});

// Disconnect handler
  socket.on('disconnect', async () => {
    console.log('🔌 Client disconnected:', socket.id);
    
    

    // Auto-leave active group calls (mesh signaling cleanup)
    try {
      if (socket.userId) {
        // COURSE LIVE cleanup
        try {
          for (const [liveId, st] of activeCourseLives.entries()) {
            if (String(st.hostId) === String(socket.userId)) {
              // host disconnected: mark ended for viewers (best-effort)
              activeCourseLives.delete(liveId);
              io.to(getLiveRoomName(liveId)).emit('live:status', { liveId, status: 'ended' });
            } else if (st.viewers && st.viewers.has(String(socket.userId))) {
              st.viewers.delete(String(socket.userId));
              io.to(getLiveRoomName(liveId)).emit('live:viewers', { liveId, viewers: st.viewers.size });
            }
          }
        } catch (_) {}
        const activeCall = socket._activeGroupCall || null;
        if (activeCall?.groupId && activeCall?.callId) {
          const gid = String(activeCall.groupId);
          const call = activeGroupCalls.get(gid);
          if (call && String(call.callId || '') === String(activeCall.callId || '') && call.participants && call.participants.has(socket.userId)) {
            await leaveGroupCallInternal(gid, String(socket.userId), 'disconnect');
          }
        }
      }
    } catch (e) {
      console.error('disconnect groupcall cleanup error:', e);
    }

    // Auto-leave zakovat sessions
    try {
      if (socket.userId) {
        const sid = normalizeZakovatSessionId(socket._zakovatSessionId || '');
        if (sid) {
          const session = activeZakovatSessions.get(sid);
          if (session && session.status === 'live') {
            removeZakovatSocket(session, socket.userId, socket.id);
            const uid = String(socket.userId || '');
            const stillConnected = Number(session.socketMembers.get(uid)?.size || 0) > 0;
            if (!stillConnected) {
              if (String(session.hostId || '') === uid) {
                endZakovatSession(sid, 'host_disconnected', uid);
              } else if (session.participants.has(uid)) {
                detachZakovatParticipant(session, uid, 'disconnect');
                activeZakovatSessions.set(sid, session);
                emitZakovatSession(session);
              }
            } else {
              activeZakovatSessions.set(sid, session);
            }
          }
        }
      }
    } catch (e) {
      console.error('disconnect zakovat cleanup error:', e);
    }

    // Cleanup mini-game queues + active PVP game
    try {
      if (socket.userId) {
        removeUserFromMiniGameQueues(String(socket.userId));
        await forfeitMiniGame(String(socket.userId), 'disconnect');
      }
    } catch (e) {
      console.error('disconnect mini-game cleanup error:', e);
    }


    // Auto-cleanup channel live streams
    try {
      if (socket.userId) {
        for (const [cid, live] of activeChannelLives.entries()) {
          if (!live) continue;

          // Host disconnected => end live
          if (String(live.hostId) === String(socket.userId)) {
            activeChannelLives.delete(String(cid));

            io.to(getChannelLiveRoomName(String(cid))).emit('channelLive:ended', {
              channelId: String(cid),
              hostId: String(live.hostId),
              reason: 'host_disconnected',
              timestamp: Date.now()
            });

            io.to(`channel_${String(cid)}`).emit('channelLive:status', {
              channelId: String(cid),
              isLive: false,
              hostId: String(live.hostId),
              startedAt: null,
              mode: null,
              viewersCount: 0
            });

            continue;
          }

          // Viewer disconnected
          if (live.viewers && live.viewers.has(String(socket.userId))) {
            live.viewers.delete(String(socket.userId));
            activeChannelLives.set(String(cid), live);

            emitToUser(String(live.hostId), 'channelLive:viewerLeft', {
              channelId: String(cid),
              viewerId: String(socket.userId)
            });

            io.to(`channel_${String(cid)}`).emit('channelLive:status', {
              channelId: String(cid),
              isLive: true,
              hostId: String(live.hostId),
              startedAt: live.startedAt,
              mode: live.mode,
              viewersCount: live.viewers.size
            });
          }
        }
      }
    } catch (e) {
      console.error('disconnect channelLive cleanup error:', e);
    }

const userId = userSockets.get(socket.id);
    if (!userId) return;

    const { becameOffline } = removeUserSocket(userId, socket.id);

    if (becameOffline) {
      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: Date.now(),
        socketId: ''
      });

      console.log('👤 User marked as offline:', userId);

      // Presence broadcast: show OFFLINE to everyone (requirement)
      io.emit('userOffline', { userId, timestamp: Date.now() });
      adminEmit('admin:userOffline', { userId, timestamp: Date.now() });
    }
  });
  
  // Error handler
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });
});


// ==================== SERVICES MARKETPLACE MODELS ====================

// Service Listing (student offers)
const ServiceSchema = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  university: { type: String, required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  category: { type: String, required: true, index: true },
  tags: [{ type: String, index: true }],
  priceType: { type: String, enum: ['fixed', 'hour'], default: 'fixed' },
  price: { type: Number, required: true, min: 0 },
  slaHours: { type: Number, default: 24, min: 1 },
  mediaUrl: { type: String, default: '' },
  mediaType: { type: String, enum: ['image', 'video', 'audio', 'document', 'file', ''], default: '' },
  status: { type: String, enum: ['active', 'paused'], default: 'active', index: true },
  createdAt: { type: Date, default: Date.now }
});
ServiceSchema.index({ university: 1, category: 1, status: 1, createdAt: -1 });
ServiceSchema.index({ title: 'text', description: 'text', tags: 'text' });

const Service = mongoose.model('Service', ServiceSchema);

// Service Requests / Orders (buyer requests seller)
const ServiceOrderSchema = new mongoose.Schema({
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
  buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  university: { type: String, required: true, index: true },
  note: { type: String, default: '', maxlength: 2000 },
  agreedPrice: { type: Number, required: true, min: 0 },
  status: { 
    type: String, 
    enum: ['created', 'in_progress', 'submitted', 'accepted', 'disputed', 'cancelled'],
    default: 'created',
    index: true
  },
  dueAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
ServiceOrderSchema.index({ university: 1, status: 1, createdAt: -1 });

const ServiceOrder = mongoose.model('ServiceOrder', ServiceOrderSchema);

// Deliverables for order
const ServiceDeliverableSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceOrder', required: true, index: true },
  uploaderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mediaUrl: { type: String, required: true },
  mediaType: { type: String, default: 'file' },
  note: { type: String, default: '', maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});
const ServiceDeliverable = mongoose.model('ServiceDeliverable', ServiceDeliverableSchema);

// Favorites
const ServiceFavoriteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
  createdAt: { type: Date, default: Date.now }
});
ServiceFavoriteSchema.index({ userId: 1, serviceId: 1 }, { unique: true });
const ServiceFavorite = mongoose.model('ServiceFavorite', ServiceFavoriteSchema);

// Reviews (only after accepted)
const ServiceReviewSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceOrder', required: true, unique: true },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  revieweeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  text: { type: String, default: '', maxlength: 3000 },
  createdAt: { type: Date, default: Date.now }
});
const ServiceReview = mongoose.model('ServiceReview', ServiceReviewSchema);

// ==================== ANONYMOUS CAMPUS SIGNALS MODELS ====================

const SignalSchema = new mongoose.Schema({
  university: { type: String, required: true, index: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // hidden in API responses
  title: { type: String, required: true, trim: true, maxlength: 140 },
  body: { type: String, required: true, trim: true, maxlength: 8000 },
  tags: [{ type: String, index: true }],
  urgency: { type: Number, min: 1, max: 5, default: 3 },
  status: { type: String, enum: ['open', 'acknowledged', 'in_progress', 'resolved', 'rejected'], default: 'open', index: true },
  visibility: { type: String, enum: ['public', 'pending', 'hidden'], default: 'pending', index: true },
  impactScore: { type: Number, default: 0, index: true },
  createdAt: { type: Date, default: Date.now }
});
SignalSchema.index({ university: 1, status: 1, visibility: 1, impactScore: -1, createdAt: -1 });
SignalSchema.index({ title: 'text', body: 'text', tags: 'text' });
const Signal = mongoose.model('Signal', SignalSchema);

const SignalVoteSchema = new mongoose.Schema({
  signalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  vote: { type: Number, enum: [1, -1], required: true },
  createdAt: { type: Date, default: Date.now }
});
SignalVoteSchema.index({ signalId: 1, userId: 1 }, { unique: true });
const SignalVote = mongoose.model('SignalVote', SignalVoteSchema);

const SignalCommentSchema = new mongoose.Schema({
  signalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal', required: true, index: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // hidden in response
  body: { type: String, required: true, trim: true, maxlength: 4000 },
  createdAt: { type: Date, default: Date.now }
});
const SignalComment = mongoose.model('SignalComment', SignalCommentSchema);

const SignalReportSchema = new mongoose.Schema({
  signalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal', required: true, index: true },
  reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reason: { type: String, required: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now }
});
const SignalReport = mongoose.model('SignalReport', SignalReportSchema);

const SignalModerationSchema = new mongoose.Schema({
  signalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal', required: true, index: true },
  moderatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  note: { type: String, default: '', maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
});
const SignalModeration = mongoose.model('SignalModeration', SignalModerationSchema);

const SlideDeckSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  subtitle: { type: String, default: '', trim: true, maxlength: 240 },
  summary: { type: String, default: '', trim: true, maxlength: 600 },
  prompt: { type: String, required: true, trim: true, maxlength: 3000 },
  audience: { type: String, default: '', trim: true, maxlength: 160 },
  language: { type: String, default: 'uz', trim: true, maxlength: 16 },
  styleRequested: { type: String, default: 'auto', trim: true, maxlength: 64 },
  themeId: { type: String, default: 'teal-minimal', trim: true, maxlength: 64 },
  themeLabel: { type: String, default: 'Teal Minimal', trim: true, maxlength: 120 },
  slideCount: { type: Number, default: 6, min: 1, max: 12 },
  watermark: { type: String, default: '', trim: true, maxlength: 200 },
  heroImageUrl: { type: String, default: '', trim: true, maxlength: 500 },
  researchSummary: { type: String, default: '', trim: true, maxlength: 2000 },
  sourceLinks: [{ type: String, trim: true, maxlength: 500 }],
  aiProvider: { type: String, default: 'hallaym-ai', trim: true, maxlength: 32 },
  aiModel: { type: String, default: '', trim: true, maxlength: 120 },
  generationMode: { type: String, default: 'ai', trim: true, maxlength: 32 },
  slides: [{
    order: { type: Number, default: 1, min: 1, max: 30 },
    layout: { type: String, default: 'content', trim: true, maxlength: 32 },
    kicker: { type: String, default: '', trim: true, maxlength: 120 },
    title: { type: String, required: true, trim: true, maxlength: 220 },
    subtitle: { type: String, default: '', trim: true, maxlength: 260 },
    body: { type: String, default: '', trim: true, maxlength: 1000 },
    bullets: [{ type: String, trim: true, maxlength: 160 }],
    leftTitle: { type: String, default: '', trim: true, maxlength: 120 },
    leftBullets: [{ type: String, trim: true, maxlength: 160 }],
    rightTitle: { type: String, default: '', trim: true, maxlength: 120 },
    rightBullets: [{ type: String, trim: true, maxlength: 160 }],
    stats: [{
      label: { type: String, default: '', trim: true, maxlength: 80 },
      value: { type: String, default: '', trim: true, maxlength: 80 }
    }],
    timeline: [{
      title: { type: String, default: '', trim: true, maxlength: 120 },
      detail: { type: String, default: '', trim: true, maxlength: 220 }
    }],
    quote: { type: String, default: '', trim: true, maxlength: 320 },
    quoteAuthor: { type: String, default: '', trim: true, maxlength: 120 },
    imageUrl: { type: String, default: '', trim: true, maxlength: 500 },
    imageCaption: { type: String, default: '', trim: true, maxlength: 160 },
    sourceLinks: [{ type: String, trim: true, maxlength: 500 }],
    callout: { type: String, default: '', trim: true, maxlength: 220 },
    speakerNote: { type: String, default: '', trim: true, maxlength: 400 }
  }]
}, { timestamps: true });
SlideDeckSchema.index({ userId: 1, createdAt: -1 });
const SlideDeck = mongoose.models.SlideDeck || mongoose.model('SlideDeck', SlideDeckSchema);


// ==================== ROUTES ====================

// Register User
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, nickname, username, bio, university, faculty, studyType, studyGroup, phone, email, password, role } = req.body;

// Required: fullName (ism familiya), username, password
const _fullName = String(fullName || '').trim();
const _usernameRaw = String(username || '').trim();
const _password = String(password || '');

if (!_fullName) return res.status(400).json({ error: 'Full name required' });
if (!_usernameRaw) return res.status(400).json({ error: 'Username required' });
if (_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

// Username format (simple + safe)
if (!/^[a-zA-Z0-9._]{3,24}$/.test(_usernameRaw)) {
  return res.status(400).json({ error: 'Username format invalid (3-24, letters/numbers/._)' });
}

// Optional fields (email/phone may be empty)
const _nickname = String(nickname || '').trim() || _fullName.split(/\s+/)[0] || _usernameRaw;
const phoneNorm = String(phone || '').trim();
const emailNorm = String(email || '').trim().toLowerCase();

const phoneVal = phoneNorm ? phoneNorm : null;
const emailVal = emailNorm ? emailNorm : null;

const safeRole = (String(role || 'student')).toLowerCase();
const finalRole = ['student','teacher'].includes(safeRole) ? safeRole : 'student';
const isTeacherRegister = finalRole === 'teacher';
const normalizeSubjectList = (raw) => {
  if (Array.isArray(raw)) return raw.map((x) => cleanText(x, 80)).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((x) => cleanText(x, 80)).filter(Boolean);
  return [];
};
const subjectList = normalizeSubjectList(req.body?.teachingSubjects || req.body?.subjects || req.body?.subject);
const subjectPrimary = cleanText(req.body?.teachingSubject || req.body?.subject, 80) || (subjectList[0] || '');
const teacherSubjects = Array.from(new Set([subjectPrimary, ...subjectList].filter(Boolean)));
if (isTeacherRegister && !subjectPrimary) {
  return res.status(400).json({ error: 'Teacher subject is required' });
}

    const academic = await normalizeAcademicIdentity({
      university,
      faculty,
      studyType: isTeacherRegister ? (studyType || 'Kunduzgi') : studyType,
      studyGroup: isTeacherRegister ? (studyGroup || "O'qituvchilar") : studyGroup
    }, {
      requireUniversity: true,
      requireFaculty: true,
      requireStudyType: !isTeacherRegister,
      requireStudyGroup: !isTeacherRegister,
      strictStudyType: !isTeacherRegister,
      strictStudyGroup: !isTeacherRegister
    });
    if (!academic.ok) return res.status(400).json({ error: academic.error });

    const canonicalUniversity = academic.value.university;
    const canonicalFaculty = academic.value.faculty;
    const canonicalStudyType = academic.value.studyType || 'Kunduzgi';
    const canonicalStudyGroup = academic.value.studyGroup || "O'qituvchilar";

    const existingUser = await User.findOne({ username: _usernameRaw });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    if (phoneVal) {
  const existingPhone = await User.findOne({ phone: phoneVal });
  if (existingPhone) {
    return res.status(400).json({ error: 'Phone number already registered' });
  }
}

if (emailVal) {
  const existingEmail = await User.findOne({ email: emailVal });
  if (existingEmail) {
    return res.status(400).json({ error: 'Email already registered' });
  }
}

const hashedPassword = await bcrypt.hash(_password, 10);
    
    const user = new User({
      fullName: _fullName,
      nickname: _nickname,
      username: _usernameRaw,
      bio,
      university: canonicalUniversity,
      faculty: canonicalFaculty,
      studyType: canonicalStudyType,
      studyGroup: canonicalStudyGroup,
      role: finalRole,
      teachingSubject: isTeacherRegister ? subjectPrimary : '',
      teachingSubjects: isTeacherRegister ? teacherSubjects : [],
      teacherBalance: 0,
      phone: phoneVal,
      email: emailVal,
      password: hashedPassword
    });
    
    await user.save();
    
    await Stats.findOneAndUpdate({}, { $inc: { totalUsers: 1 } });
    
    const token = jwt.sign({ userId: user._id, username: user.username, role: (user.isAdmin ? 'admin' : (user.role || 'student')), isAdmin: !!user.isAdmin }, process.env.JWT_SECRET, { expiresIn: '30d' });
    await ensureActiveAuthSessionForToken({
      userId: user._id,
      token,
      decoded: jwt.decode(token) || {},
      headers: req.headers || {},
      ip: getRequestClientIp(req),
      createdFrom: 'register'
    });
    await pruneExpiredAuthSessions(user._id);
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        university: user.university,
        role: (user.isAdmin ? 'admin' : (user.role || 'student')),
        teachingSubject: user.teachingSubject || '',
        teachingSubjects: Array.isArray(user.teachingSubjects) ? user.teachingSubjects : [],
        coins: user.coins || 0,
        teacherBalance: user.teacherBalance || 0,
        isOnline: false
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});



// Check username availability (public)
app.get('/api/auth/check-username', async (req, res) => {
  try {
    const u = String(req.query.username || '').trim();
    if (!u) return res.json({ success: true, available: false, reason: 'empty' });
    const exists = await User.findOne({ username: u }).select('_id').lean();
    res.json({ success: true, available: !exists });
  } catch (e) {
    res.status(500).json({ error: 'Failed to check username' });
  }
});

// Forgot password (public) - generates one-time token
// NOTE: In production, you MUST send this token to user's email/SMS instead of returning it.
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Username required' });

    const user = await User.findOne({ username });
    // Always respond success to prevent user enumeration
    if (!user) return res.json({ success: true, message: 'If account exists, reset info was generated' });

    if (!user.email && !user.phone) {
      return res.status(400).json({ error: 'This account has no email/phone. Add contact in profile or contact support.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await User.updateOne({ _id: user._id }, { $set: { resetPasswordTokenHash: tokenHash, resetPasswordExpires: expires } });

    res.json({ success: true, token, expiresAt: expires.getTime() });
  } catch (e) {
    console.error('forgot-password error:', e);
    res.status(500).json({ error: 'Failed to start password reset' });
  }
});

// Reset password (public)
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const newPassword = String(req.body.newPassword || '');
    if (!token) return res.status(400).json({ error: 'Token required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ error: 'Token invalid or expired' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await User.updateOne({ _id: user._id }, { $set: { password: hashedPassword, resetPasswordTokenHash: null, resetPasswordExpires: null } });
    await revokeAuthSessionsForUser(user._id, { reason: 'password_reset' });

    res.json({ success: true, message: 'Password updated' });
  } catch (e) {
    console.error('reset-password error:', e);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Login User
app.post('/api/login', async (req, res) => {
  try {
    const username = (req.body.username || req.body.login || req.body.user || '').toString().trim();
    const password = (req.body.password || '').toString();
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Update presence without triggering full-document validation (legacy users may miss required fields)
    await User.updateOne({ _id: user._id }, { $set: {
      isOnline: true,
      lastSeen: new Date(),
      lastActive: new Date()
    }});

    const token = jwt.sign({ userId: user._id, username: user.username, role: (user.isAdmin ? 'admin' : (user.role || 'student')), isAdmin: !!user.isAdmin }, process.env.JWT_SECRET, { expiresIn: '30d' });
    await ensureActiveAuthSessionForToken({
      userId: user._id,
      token,
      decoded: jwt.decode(token) || {},
      headers: req.headers || {},
      ip: getRequestClientIp(req),
      createdFrom: 'login'
    });
    await pruneExpiredAuthSessions(user._id);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        university: user.university,
        role: (user.isAdmin ? 'admin' : (user.role || 'student')),
        teachingSubject: user.teachingSubject || '',
        teachingSubjects: Array.isArray(user.teachingSubjects) ? user.teachingSubjects : [],
        coins: user.coins || 0,
        teacherBalance: user.teacherBalance || 0,
        isOnline: true
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/logout', authenticateToken, async (req, res) => {
  try {
    if (req.authSessionId) {
      await revokeAuthSessionsForUser(req.userId, {
        onlySessionId: req.authSessionId,
        reason: 'logout'
      });
    }
    await syncUserPresenceFromSockets(req.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

app.get('/api/security/sessions', authenticateToken, async (req, res) => {
  try {
    await pruneExpiredAuthSessions(req.userId);
    const sessions = await AuthSession.find({
      userId: req.userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    }).sort({ lastActiveAt: -1, createdAt: -1 }).lean();

    const formatted = sessions.map((session) => ({
      ...formatSessionForClient(session, req.authSessionId),
      connectedNow: getSessionSocketIds(session?._id).length > 0
    }));
    const otherSessions = formatted.filter((session) => !session.isCurrent);
    const advice = otherSessions.length
      ? 'Begona qurilma ko‘rinsa, uni darhol chiqarib yuboring va parolni yangilang.'
      : 'Faqat sizning joriy qurilmangiz ko‘rinmoqda. Baribir kuchli parol ishlating.';

    res.json({
      success: true,
      currentSessionId: String(req.authSessionId || ''),
      activeCount: formatted.length,
      otherDevicesCount: otherSessions.length,
      recommendPasswordChange: otherSessions.length > 0,
      advice,
      sessions: formatted
    });
  } catch (error) {
    console.error('GET /api/security/sessions error:', error);
    res.status(500).json({ error: 'Failed to load security sessions' });
  }
});

app.post('/api/security/sessions/revoke-others', authenticateToken, async (req, res) => {
  try {
    const revokedIds = await revokeAuthSessionsForUser(req.userId, {
      excludeSessionId: req.authSessionId,
      reason: 'revoked_by_user'
    });
    await syncUserPresenceFromSockets(req.userId);
    res.json({ success: true, revokedCount: revokedIds.length });
  } catch (error) {
    console.error('POST /api/security/sessions/revoke-others error:', error);
    res.status(500).json({ error: 'Failed to revoke other sessions' });
  }
});

app.post('/api/security/sessions/:sessionId/revoke', authenticateToken, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: 'Invalid session id' });
    }
    if (String(sessionId) === String(req.authSessionId || '')) {
      return res.status(400).json({ error: 'Current session should use logout' });
    }
    const target = await AuthSession.findOne({
      _id: sessionId,
      userId: req.userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    }).lean();
    if (!target) return res.status(404).json({ error: 'Session not found' });

    const revokedIds = await revokeAuthSessionsForUser(req.userId, {
      onlySessionId: sessionId,
      reason: 'revoked_by_user'
    });
    await syncUserPresenceFromSockets(req.userId);
    res.json({ success: true, revokedCount: revokedIds.length });
  } catch (error) {
    console.error('POST /api/security/sessions/:sessionId/revoke error:', error);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

app.post('/api/security/change-password', authenticateToken, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const user = await User.findById(req.userId).select('username password role isAdmin');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ error: 'Current password incorrect' });

    const sameAsOld = await bcrypt.compare(newPassword, user.password).catch(() => false);
    if (sameAsOld) return res.status(400).json({ error: 'Choose a different password' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.updateOne({
      _id: req.userId
    }, {
      $set: {
        password: hashedPassword,
        resetPasswordTokenHash: null,
        resetPasswordExpires: null
      }
    });

    const freshToken = jwt.sign({
      userId: user._id,
      username: user.username,
      role: (user.isAdmin ? 'admin' : (user.role || 'student')),
      isAdmin: !!user.isAdmin
    }, process.env.JWT_SECRET, { expiresIn: '30d' });

    const freshSessionState = await ensureActiveAuthSessionForToken({
      userId: user._id,
      token: freshToken,
      decoded: jwt.decode(freshToken) || {},
      headers: req.headers || {},
      ip: getRequestClientIp(req),
      createdFrom: 'password_change'
    });
    const freshSessionId = String(freshSessionState?.session?._id || '');
    const revokedIds = await revokeAuthSessionsForUser(req.userId, {
      excludeSessionId: freshSessionId,
      reason: 'password_changed'
    });
    await pruneExpiredAuthSessions(req.userId);
    await syncUserPresenceFromSockets(req.userId);

    res.json({
      success: true,
      message: 'Password updated',
      token: freshToken,
      currentSessionId: freshSessionId,
      revokedCount: revokedIds.length
    });
  } catch (error) {
    console.error('POST /api/security/change-password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Get Current User
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Ensure robot + inventory + companions are ready for profile UI
    try {
      ensureInventoryArrays(user);
      ensureCompanions(user);
      ensureRobots(user);
      ensureUserSettingsState(user);
      syncPremiumDerivedState(user);
      // Save without full validation (legacy users may miss required fields like university)
      await user.save({ validateBeforeSave: false });
    } catch (e) {
      console.warn('ensureRobots/companions warning:', e?.message || e);
    }

    const activeRobot = (user.robots || []).find(r => r._id && String(r._id) === String(user.activeRobotId)) || (user.robots || [])[0] || null;
    const activeCompanion = (user.companions || []).find(c => c._id && String(c._id) === String(user.activeCompanionId)) || (user.companions || []).find(c => c.equipped) || (user.companions || [])[0] || null;

    const safeUser = user.toObject ? user.toObject() : user;
    delete safeUser.password;
    // Backward compatibility: derive/override role
    safeUser.role = safeUser.isAdmin ? 'admin' : (safeUser.role || 'student');
    // UI compatibility fields
    safeUser.group = safeUser.studyGroup || safeUser.group || '';
    safeUser.faculty = safeUser.faculty || '';
    safeUser.teachingSubject = String(safeUser.teachingSubject || '').trim();
    safeUser.teachingSubjects = Array.isArray(safeUser.teachingSubjects) ? safeUser.teachingSubjects : (safeUser.teachingSubject ? [safeUser.teachingSubject] : []);
    safeUser.activeRobot = activeRobot;
    safeUser.activeCompanion = activeCompanion;
    safeUser.settings = ensureUserSettingsState({ settings: safeUser.settings });
    safeUser.premium = serializePremiumState(safeUser);
    safeUser.verified = effectiveVerifiedFlag(safeUser);

    // Front-end compatibility: return user fields at top-level AND under {user}
    safeUser.fullname = safeUser.fullname || safeUser.fullName || safeUser.name || '';
    // coins normalization
    if (safeUser.coins === undefined || safeUser.coins === null) {
      safeUser.coins = (safeUser.coin !== undefined && safeUser.coin !== null) ? safeUser.coin : (safeUser.coinBalance ?? 0);
    }
    res.json({ ...safeUser, success: true, user: safeUser });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// ==================== MINI GAMES + COIN MISSIONS API ====================
app.get('/api/coins/missions', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('fullName nickname bio university faculty studyType studyGroup avatar coins').lean();
    if (!me) return res.status(404).json({ error: 'User not found' });

    const [missions, soloUsed, pvpUsed] = await Promise.all([
      getCoinMissionStatuses(req.userId, me),
      getTodayGameCoins(req.userId, 'solo'),
      getTodayGameCoins(req.userId, 'pvp')
    ]);

    res.json({
      success: true,
      dayKey: dayKeyLocal(),
      coins: Number(me.coins || 0),
      missions,
      caps: {
        solo: { used: Number(soloUsed || 0), cap: Number(MINI_GAME_DAILY_CAPS.solo || 0) },
        pvp: { used: Number(pvpUsed || 0), cap: Number(MINI_GAME_DAILY_CAPS.pvp || 0) }
      }
    });
  } catch (error) {
    console.error('GET /api/coins/missions error:', error);
    res.status(500).json({ error: 'Failed to load missions' });
  }
});

app.post('/api/coins/missions/:missionKey/claim', authenticateToken, async (req, res) => {
  try {
    const mission = getMiniMissionByKey(req.params.missionKey);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    const me = await User.findById(req.userId).select('fullName nickname bio university faculty studyType studyGroup avatar coins').lean();
    if (!me) return res.status(404).json({ error: 'User not found' });

    const status = await evaluateCoinMissionStatus(req.userId, mission.key, me);
    if (!status) return res.status(404).json({ error: 'Mission not found' });
    if (status.claimed) return res.status(400).json({ error: 'Mission already claimed', mission: status });
    if (!status.eligible) return res.status(400).json({ error: 'Mission conditions not met yet', mission: status });

    const claimDayKey = status.claimDayKey || miniMissionClaimDayKey(mission.key);
    try {
      await CoinMissionClaim.create({
        userId: req.userId,
        missionKey: mission.key,
        dayKey: claimDayKey,
        meta: { from: 'api_claim' }
      });
    } catch (e) {
      if (Number(e?.code) === 11000) {
        return res.status(400).json({ error: 'Mission already claimed' });
      }
      throw e;
    }

    await User.updateOne({ _id: req.userId }, { $inc: { coins: Number(mission.reward || 0) } });
    const updated = await User.findById(req.userId).select('coins').lean();

    res.json({
      success: true,
      reward: Number(mission.reward || 0),
      coins: Number(updated?.coins || 0),
      mission: {
        ...mission,
        claimed: true,
        claimDayKey
      }
    });
  } catch (error) {
    console.error('POST /api/coins/missions/:missionKey/claim error:', error);
    res.status(500).json({ error: 'Failed to claim mission' });
  }
});

app.post('/api/games/solo-result', authenticateToken, async (req, res) => {
  try {
    const gameType = String(req.body?.gameType || '').trim().toLowerCase();
    if (!MINI_SOLO_GAMES.includes(gameType)) {
      return res.status(400).json({ error: 'Unsupported gameType' });
    }

    const score = Math.max(0, Math.floor(Number(req.body?.score || 0)));
    const scopeCtx = await resolveMiniContextForUser(req.userId, {
      scope: req.body?.scope,
      groupId: req.body?.groupId,
      opponentId: req.body?.opponentId
    });
    if (!scopeCtx.ok) return res.status(400).json({ error: scopeCtx.error || 'Invalid game scope' });

    const desiredReward = calcSoloReward(gameType, score);
    const credit = await creditCoinsWithCap(req.userId, desiredReward, 'solo');
    const result = summarizeSoloGameResult(gameType, score);

    const rawMeta = (req.body && typeof req.body.meta === 'object' && req.body.meta) ? req.body.meta : {};
    const meta = {
      level: Number(rawMeta.level || 1),
      durationMs: Number(rawMeta.durationMs || 0),
      source: String(rawMeta.source || 'mini-games-ui').slice(0, 80)
    };

    const activity = await GameActivity.create({
      gameId: `solo_${uuidv4()}`,
      userId: req.userId,
      gameType,
      mode: 'solo',
      scope: scopeCtx.scope,
      groupId: isObjectIdLike(scopeCtx.groupId) ? scopeCtx.groupId : null,
      opponentId: isObjectIdLike(scopeCtx.opponentId) ? scopeCtx.opponentId : null,
      score,
      result,
      coinsAwarded: Number(credit.awarded || 0),
      meta
    });

    const me = await User.findById(req.userId).select('coins').lean();

    res.json({
      success: true,
      activityId: String(activity._id),
      gameType,
      score,
      result,
      desiredReward: Number(desiredReward || 0),
      reward: Number(credit.awarded || 0),
      coins: Number(me?.coins || 0),
      cap: Number(credit.cap || MINI_GAME_DAILY_CAPS.solo),
      usedToday: Number(credit.used || 0)
    });
  } catch (error) {
    console.error('POST /api/games/solo-result error:', error);
    res.status(500).json({ error: 'Failed to save game result' });
  }
});

app.get('/api/games/my-activity', authenticateToken, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 30);
    const limit = Math.min(120, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 30));

    const rows = await GameActivity.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('opponentId', 'username nickname avatar')
      .populate('groupId', 'name username studyGroup')
      .lean();

    const [soloUsed, pvpUsed] = await Promise.all([
      getTodayGameCoins(req.userId, 'solo'),
      getTodayGameCoins(req.userId, 'pvp')
    ]);

    const items = (rows || []).map((r) => ({
      id: String(r._id),
      gameId: String(r.gameId || ''),
      gameType: String(r.gameType || ''),
      mode: String(r.mode || 'solo'),
      scope: String(r.scope || 'global'),
      group: r.groupId ? {
        id: String(r.groupId._id || ''),
        name: String(r.groupId.name || ''),
        username: String(r.groupId.username || ''),
        studyGroup: String(r.groupId.studyGroup || '')
      } : null,
      opponent: r.opponentId ? {
        id: String(r.opponentId._id || ''),
        username: String(r.opponentId.username || ''),
        nickname: String(r.opponentId.nickname || r.opponentId.username || ''),
        avatar: String(r.opponentId.avatar || '')
      } : null,
      score: Number(r.score || 0),
      result: String(r.result || 'participate'),
      coinsAwarded: Number(r.coinsAwarded || 0),
      createdAt: r.createdAt
    }));

    res.json({
      success: true,
      items,
      caps: {
        solo: { used: Number(soloUsed || 0), cap: Number(MINI_GAME_DAILY_CAPS.solo || 0) },
        pvp: { used: Number(pvpUsed || 0), cap: Number(MINI_GAME_DAILY_CAPS.pvp || 0) }
      }
    });
  } catch (error) {
    console.error('GET /api/games/my-activity error:', error);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

app.get('/api/games/leaderboard', authenticateToken, async (req, res) => {
  try {
    const range = String(req.query.range || 'week').toLowerCase();
    const mode = String(req.query.mode || '').toLowerCase();
    const gameType = String(req.query.gameType || '').toLowerCase();
    const scope = String(req.query.scope || '').toLowerCase();
    const groupId = String(req.query.groupId || '').trim();

    const now = Date.now();
    let since = new Date(now - (7 * 24 * 60 * 60 * 1000));
    if (range === 'day') since = new Date(now - (24 * 60 * 60 * 1000));
    if (range === 'month') since = new Date(now - (30 * 24 * 60 * 60 * 1000));

    const match = {
      createdAt: { $gte: since },
      coinsAwarded: { $gt: 0 }
    };

    if (mode === 'solo' || mode === 'pvp') match.mode = mode;
    if (gameType && (MINI_SOLO_GAMES.includes(gameType) || gameType === 'tic_tac_toe')) match.gameType = gameType;
    if (scope === 'global' || scope === 'group' || scope === 'duel') match.scope = scope;

    if (scope === 'group' && groupId) {
      if (!isObjectIdLike(groupId)) return res.status(400).json({ error: 'groupId invalid' });
      const canJoin = await isGroupMember(groupId, req.userId);
      if (!canJoin) return res.status(403).json({ error: 'Group access denied' });
      match.groupId = new mongoose.Types.ObjectId(groupId);
    }

    const rows = await GameActivity.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$userId',
          totalCoins: { $sum: '$coinsAwarded' },
          totalGames: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          scoreTotal: { $sum: '$score' }
        }
      },
      { $sort: { totalCoins: -1, wins: -1, totalGames: -1, scoreTotal: -1 } },
      { $limit: 40 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          totalCoins: 1,
          totalGames: 1,
          wins: 1,
          scoreTotal: 1,
          username: '$user.username',
          nickname: '$user.nickname',
          avatar: '$user.avatar'
        }
      }
    ]);

    const items = (rows || []).map((r, idx) => ({
      rank: idx + 1,
      userId: String(r.userId || ''),
      username: String(r.username || ''),
      nickname: String(r.nickname || r.username || 'User'),
      avatar: String(r.avatar || ''),
      totalCoins: Number(r.totalCoins || 0),
      totalGames: Number(r.totalGames || 0),
      wins: Number(r.wins || 0),
      scoreTotal: Number(r.scoreTotal || 0),
      isMe: String(r.userId || '') === String(req.userId)
    }));

    res.json({
      success: true,
      range: ['day', 'week', 'month'].includes(range) ? range : 'week',
      mode: (mode === 'solo' || mode === 'pvp') ? mode : '',
      gameType: gameType || '',
      scope: (scope === 'global' || scope === 'group' || scope === 'duel') ? scope : '',
      groupId: groupId || '',
      items
    });
  } catch (error) {
    console.error('GET /api/games/leaderboard error:', error);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// Update Profile (safe whitelist)
app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const role = String(user.role || '').toLowerCase();
    const isOrganizerOnly = role === 'organizer' && !user.isAdmin;
    const prevUniversity = cleanText(user.university, 180);
    const prevFaculty = cleanText(user.faculty, 180);
    const prevStudyType = cleanText(user.studyType, 80);
    const prevStudyGroup = cleanText(user.studyGroup, 80);

    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const pickStr = (v, max=200) => {
      const s = String(v ?? '').trim();
      if (!s) return '';
      return s.length > max ? s.slice(0, max) : s;
    };

    // Whitelist fields users can edit
    const updates = {};
    if (body.nickname !== undefined) updates.nickname = pickStr(body.nickname, 40);
    if (body.fullName !== undefined) updates.fullName = pickStr(body.fullName, 80);
    if (body.bio !== undefined) updates.bio = pickStr(body.bio, 500);
    if (body.phone !== undefined) {
      const phoneVal = pickStr(body.phone, 30);
      updates.phone = phoneVal || null;
    }
    if (body.email !== undefined) {
      const emailVal = pickStr(body.email, 120).toLowerCase();
      updates.email = emailVal || null;
    }
    if (body.teachingSubject !== undefined) {
      updates.teachingSubject = pickStr(body.teachingSubject, 80);
    }
    if (body.teachingSubjects !== undefined) {
      const raw = body.teachingSubjects;
      if (Array.isArray(raw)) updates.teachingSubjects = raw.map((x) => pickStr(x, 80)).filter(Boolean);
      else updates.teachingSubjects = String(raw || '').split(',').map((x) => pickStr(x, 80)).filter(Boolean);
    }

    // Academic identity (used by schedule / groups)
    // Organizer role is faculty-scoped by admin assignment and cannot self-change academic scope.
    if (!isOrganizerOnly) {
      if (body.university !== undefined) updates.university = pickStr(body.university, 120);
      if (body.faculty !== undefined) updates.faculty = pickStr(body.faculty, 120);
      if (body.studyType !== undefined) updates.studyType = pickStr(body.studyType, 80);
      if (body.studyGroup !== undefined || body.group !== undefined) {
        // accept both keys for compatibility
        updates.studyGroup = pickStr(body.studyGroup ?? body.group, 60);
      }
    }

    // Username change: enforce cooldown + uniqueness
    if (body.username !== undefined) {
      const newUsername = pickStr(body.username, 32).toLowerCase().replace(/\s+/g,'');
      if (newUsername && newUsername !== String(user.username || '').toLowerCase()) {
        const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
        if (user.lastUsernameChange && user.lastUsernameChange > fifteenDaysAgo) {
          return res.status(400).json({
            error: 'Username can only be changed once every 15 days',
            nextChange: new Date(user.lastUsernameChange.getTime() + 15 * 24 * 60 * 60 * 1000)
          });
        }
        const exists = await User.findOne({ username: newUsername, _id: { $ne: user._id } }).select('_id').lean();
        if (exists) return res.status(400).json({ error: 'Username already taken' });
        updates.username = newUsername;
        updates.lastUsernameChange = new Date();
      }
    }

    // Prevent privilege escalation / dangerous edits
    const forbidden = ['password','isAdmin','role','coins','verified','isOnline','lastSeen','robots','inventory','companions','activeRobotId','activeCompanionId'];
    for (const k of forbidden) {
      if (k in updates) delete updates[k];
    }

    const nextUniversity = (updates.university !== undefined) ? updates.university : pickStr(user.university, 120);
    const nextFaculty = (updates.faculty !== undefined) ? updates.faculty : pickStr(user.faculty, 120);
    const nextStudyType = (updates.studyType !== undefined) ? updates.studyType : pickStr(user.studyType, 80);
    const nextStudyGroup = (updates.studyGroup !== undefined) ? updates.studyGroup : pickStr(user.studyGroup, 60);

    const academic = await normalizeAcademicIdentity({
      university: nextUniversity,
      faculty: nextFaculty,
      studyType: nextStudyType,
      studyGroup: nextStudyGroup
    }, {
      requireUniversity: true,
      requireFaculty: true,
      requireStudyType: role !== 'teacher',
      requireStudyGroup: role !== 'teacher',
      strictStudyType: role !== 'teacher',
      strictStudyGroup: role !== 'teacher'
    });
    if (!academic.ok) return res.status(400).json({ error: academic.error });

    updates.university = academic.value.university;
    updates.faculty = academic.value.faculty;
    updates.studyType = academic.value.studyType || (role === 'teacher' ? 'Kunduzgi' : '');
    updates.studyGroup = academic.value.studyGroup || (role === 'teacher' ? "O'qituvchilar" : '');

    if (Object.prototype.hasOwnProperty.call(updates, 'phone') && updates.phone) {
      const existingPhone = await User.findOne({ phone: updates.phone, _id: { $ne: user._id } }).select('_id').lean();
      if (existingPhone) return res.status(409).json({ error: 'Phone number already registered' });
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'email') && updates.email) {
      const existingEmail = await User.findOne({ email: updates.email, _id: { $ne: user._id } }).select('_id').lean();
      if (existingEmail) return res.status(409).json({ error: 'Email already registered' });
    }

    // Apply
    Object.assign(user, updates);

    await user.save();

    const uniChanged = prevUniversity !== String(user.university || '').trim();
    const facChanged = prevFaculty !== String(user.faculty || '').trim();
    const typeChanged = prevStudyType !== String(user.studyType || '').trim();
    const groupChanged = prevStudyGroup !== String(user.studyGroup || '').trim();
    if (uniChanged || facChanged || typeChanged || groupChanged) {
      const groupSet = {};
      if (uniChanged) groupSet.university = String(user.university || '').trim();
      if (facChanged) groupSet.faculty = String(user.faculty || '').trim();
      if (typeChanged) groupSet.studyType = String(user.studyType || '').trim();
      if (groupChanged) groupSet.studyGroup = String(user.studyGroup || '').trim();

      await Group.updateMany({ creatorId: user._id }, { $set: groupSet }).catch(() => {});
      if (uniChanged) {
        await Channel.updateMany({ creatorId: user._id }, { $set: { university: String(user.university || '').trim() } }).catch(() => {});
      }
    }

    const safe = await User.findById(req.userId).select('-password').lean();
    if (safe) {
      safe.role = safe.isAdmin ? 'admin' : (safe.role || 'student');
      safe.group = safe.studyGroup || safe.group || '';
    }
    res.json({ success: true, user: safe });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// Upload Avatar

app.post('/api/upload-avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'avatars',
      width: 300,
      height: 300,
      crop: 'fill'
    });
    
    const user = await User.findByIdAndUpdate(
      req.userId,
      { avatar: result.secure_url },
      { new: true, select: '-password' }
    );
    
    res.json({ success: true, avatar: user.avatar });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }


// Upload Cover Banner
app.post('/api/upload-cover', authenticateToken, upload.single('cover'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'covers',
      width: 1600,
      height: 600,
      crop: 'fill',
      quality: 'auto',
      fetch_format: 'auto'
    });

    const user = await User.findByIdAndUpdate(
      req.userId,
      { coverBanner: result.secure_url },
      { new: true, select: '-password' }
    );

    res.json({ success: true, coverBanner: user.coverBanner });
  } catch (error) {
    console.error('Upload cover error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

});

// Search Users
app.get('/api/search/users', authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;
    const users = await User.find({
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { nickname: { $regex: query, $options: 'i' } },
        { fullName: { $regex: query, $options: 'i' } },
        { university: { $regex: query, $options: 'i' } }
      ],
      _id: { $ne: req.userId }
    })
    .select('username fullName nickname avatar university isOnline lastSeen verified premium')
    .limit(20);

    const safeUsers = (users || []).map((user) => {
      const raw = user?.toObject ? user.toObject() : user;
      raw.verified = effectiveVerifiedFlag(raw);
      raw.premium = serializePremiumState(raw);
      return raw;
    });
    
    res.json({ success: true, users: safeUsers });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get User by ID
app.get('/api/user/:userId', authenticateToken, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Ensure robots exist for viewing (migrate legacy pet once)
    try {
      ensureInventoryArrays(user);
      ensureRobots(user);
      await user.save();
    } catch (e) {
      // safety: do not fail profile view if migration fails
      console.warn('ensureRobots warning:', e?.message || e);
    }

    const active = (user.robots || []).find(r => String(r._id) === String(user.activeRobotId)) || (user.robots || [])[0] || null;

    // Public user response (safe fields)
    const publicUser = {
      _id: user._id,
      username: user.username,
      fullName: user.fullName,
      nickname: user.nickname,
      bio: user.bio || '',
      university: user.university,
      studyGroup: user.studyGroup,
      avatar: user.avatar,
      coverBanner: user.coverBanner || '',
      isOnline: !!user.isOnline,
      lastSeen: user.lastSeen,
      status: user.status || (user.isOnline ? 'online' : 'offline'),
      verified: effectiveVerifiedFlag(user),
      premium: serializePremiumState(user),
      pet: user.pet || null,
      activeRobotId: user.activeRobotId || '',
      activeRobot: active ? {
        _id: active._id,
        typeId: active.typeId,
        name: active.name,
        baseColor: active.baseColor,
        outfitColor: active.outfitColor,
        hunger: active.hunger,
        cuteness: active.cuteness,
        level: active.level,
        xp: active.xp,
        mood: active.mood,
        equipped: !!active.equipped
      } : null,
      robots: (user.robots || []).map(r => ({
        _id: r._id,
        typeId: r.typeId,
        name: r.name,
        baseColor: r.baseColor,
        outfitColor: r.outfitColor,
        hunger: r.hunger,
        cuteness: r.cuteness,
        level: r.level,
        xp: r.xp,
        mood: r.mood,
        equipped: !!r.equipped
      })),

      companions: (user.companions || []).map(c => ({
        _id: c._id,
        typeId: c.typeId,
        name: c.name,
        emoji: c.emoji,
        rarity: c.rarity,
        moodBoost: c.moodBoost,
        equipped: !!c.equipped
      })),
      activeCompanionId: user.activeCompanionId || '',
      petScene: normalizePetScene(user.petScene || {}),
};

    res.json({ success: true, user: publicUser });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

app.get('/api/user/by-username/:username', authenticateToken, async (req, res) => {
  try {
    const uname = (req.params.username || '').trim();
    if (!uname) return res.status(400).json({ error: 'Username required' });

    const user = await User.findOne({ username: uname }).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Ensure robots for view
    try {
      ensureInventoryArrays(user);
      ensureRobots(user);
      await user.save();
    } catch (e) {}

    const active = (user.robots || []).find(r => String(r._id) === String(user.activeRobotId)) || (user.robots || [])[0] || null;

    const publicUser = {
      _id: user._id,
      username: user.username,
      fullName: user.fullName,
      nickname: user.nickname,
      bio: user.bio || '',
      university: user.university,
      studyGroup: user.studyGroup,
      avatar: user.avatar,
      coverBanner: user.coverBanner || '',
      isOnline: !!user.isOnline,
      lastSeen: user.lastSeen,
      status: user.status || (user.isOnline ? 'online' : 'offline'),
      verified: effectiveVerifiedFlag(user),
      premium: serializePremiumState(user),
      pet: user.pet || null,
      activeRobotId: user.activeRobotId || '',
      activeRobot: active ? {
        _id: active._id,
        typeId: active.typeId,
        name: active.name,
        baseColor: active.baseColor,
        outfitColor: active.outfitColor,
        hunger: active.hunger,
        cuteness: active.cuteness,
        level: active.level,
        xp: active.xp,
        mood: active.mood,
        equipped: !!active.equipped
      } : null,
      robots: (user.robots || []).map(r => ({
        _id: r._id,
        typeId: r.typeId,
        name: r.name,
        baseColor: r.baseColor,
        outfitColor: r.outfitColor,
        hunger: r.hunger,
        cuteness: r.cuteness,
        level: r.level,
        xp: r.xp,
        mood: r.mood,
        equipped: !!r.equipped
      })),
      companions: (user.companions || []).map(c => ({
        _id: c._id,
        typeId: c.typeId,
        name: c.name,
        emoji: c.emoji,
        rarity: c.rarity,
        moodBoost: c.moodBoost,
        equipped: !!c.equipped
      })),
      activeCompanionId: user.activeCompanionId || '',
      petScene: normalizePetScene(user.petScene || {})
    };

    return res.json({ success: true, user: publicUser });
  } catch (e) {
    console.error('Get user by username error:', e);
    return res.status(500).json({ error: 'Failed to get user' });
  }
});


// Get Conversations
app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    // NOTE: In newer bson/mongoose versions, ObjectId is a class and must be instantiated with `new`.
    const me = new mongoose.Types.ObjectId(req.userId);
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { senderId: me },
            { receiverId: me }
          ]
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: {
            $cond: {
              if: { $eq: ["$senderId", me] },
              then: "$receiverId",
              else: "$senderId"
            }
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $ne: ["$senderId", me] },
                    { $eq: ["$isRead", false] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          userId: '$_id',
          username: '$user.username',
          fullName: '$user.fullName',
          nickname: '$user.nickname',
          avatar: '$user.avatar',
          university: '$user.university',
          verified: '$user.verified',
          premium: '$user.premium',
          isOnline: '$user.isOnline',
          lastSeen: '$user.lastSeen',
          lastMessage: {
            text: '$lastMessage.text',
            mediaType: '$lastMessage.mediaType',
            createdAt: '$lastMessage.createdAt'
          },
          unreadCount: 1
        }
      },
      {
        $sort: { 'lastMessage.createdAt': -1 }
      }
    ]);
    
    const safeConversations = (conversations || []).map((item) => {
      const safe = Object.assign({}, item || {});
      safe.premium = serializePremiumState(safe);
      safe.verified = effectiveVerifiedFlag(safe);
      return safe;
    });
    res.json({ success: true, conversations: safeConversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get Messages with a user
async function getPopulatedPrivateMessage(messageId) {
  const doc = await Message.findById(messageId)
    .populate('senderId', 'fullName username nickname avatar verified premium')
    .populate('receiverId', 'fullName username nickname avatar verified premium');
  return decoratePrivateMessageUsers(doc);
}

function decorateLightUserProfile(rawUser) {
  if (!rawUser) return rawUser;
  const safe = rawUser.toObject ? rawUser.toObject() : Object.assign({}, rawUser);
  safe.premium = serializePremiumState(safe);
  safe.verified = effectiveVerifiedFlag(safe);
  return safe;
}

function decoratePrivateMessageUsers(message) {
  if (!message) return message;
  const safe = message.toObject ? message.toObject() : Object.assign({}, message);
  if (safe.senderId && typeof safe.senderId === 'object') safe.senderId = decorateLightUserProfile(safe.senderId);
  if (safe.receiverId && typeof safe.receiverId === 'object') safe.receiverId = decorateLightUserProfile(safe.receiverId);
  return safe;
}

app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;
    
    const messages = await Message.find({
      $or: [
        { senderId: req.userId, receiverId: userId },
        { senderId: userId, receiverId: req.userId }
      ]
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate('senderId', 'fullName username nickname avatar verified premium')
    .populate('receiverId', 'fullName username nickname avatar verified premium');
    
    await Message.updateMany(
      { 
        senderId: userId, 
        receiverId: req.userId, 
        isRead: false 
      },
      { 
        isRead: true,
        isDelivered: true
      }
    );
    
    await Message.updateMany(
      { 
        senderId: req.userId, 
        receiverId: userId, 
        isDelivered: false 
      },
      { 
        isDelivered: true 
      }
    );
    
    res.json({ 
      success: true, 
      messages: messages.reverse().map((item) => decoratePrivateMessageUsers(item)),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Send Message
app.post('/api/messages', authenticateToken, async (req, res) => {
  try {  if (denyIfMuted(req, res)) return;

    const { receiverId, text, mediaUrl, mediaType, mediaMetadata } = req.body;
    
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const normalizedMediaType = String(mediaType || '').trim().toLowerCase();
    if (normalizedMediaType === 'sticker') {
      const sender = await User.findById(req.userId).select('verified premium').lean();
      if (!sender) return res.status(404).json({ error: 'User not found' });
      if (!hasPremiumFeature(sender, 'animatedStickers')) {
        return res.status(403).json({ error: 'Animated stickers only for premium users', redirect: '/payment.html?focus=user' });
      }
      if (!String(mediaUrl || '').trim()) {
        return res.status(400).json({ error: 'Sticker URL required' });
      }
    }

    const message = new Message({
      senderId: req.userId,
      receiverId,
      text,
      mediaUrl,
      mediaType: normalizedMediaType,
      mediaMetadata,
      isDelivered: false,
      isRead: false
    });
    
    await message.save();
    
    await Stats.findOneAndUpdate({}, { $inc: { totalMessages: 1 } });
    
    const populatedMessage = await getPopulatedPrivateMessage(message._id);
    
    const receiverSocketId = getUserSocketId(receiverId);
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('newMessage', populatedMessage);
      message.isDelivered = true;
      await message.save();
    }
    
    const senderSocketId = getUserSocketId(req.userId);
    if (senderSocketId) {
      io.to(senderSocketId).emit('messageSent', populatedMessage);
    }
    
    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Edit own private message
app.put('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Message text is required' });

    const msg = await Message.findById(messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (String(msg.senderId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Only sender can edit this message' });
    }
    if (msg.deletedAt) return res.status(400).json({ error: 'Message already deleted' });

    msg.text = text;
    msg.editedAt = new Date();
    await msg.save();

    const populatedMessage = await getPopulatedPrivateMessage(msg._id);
    try {
      emitToUser(String(msg.senderId), 'messageUpdated', populatedMessage);
      emitToUser(String(msg.receiverId), 'messageUpdated', populatedMessage);
    } catch (_) {}

    return res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Edit private message error:', error);
    return res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Delete own private message
app.delete('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const msg = await Message.findById(messageId).select('senderId receiverId');
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const canDelete = String(msg.senderId) === String(req.userId) || String(req.userRole || '').toLowerCase() === 'admin';
    if (!canDelete) return res.status(403).json({ error: 'Not allowed to delete this message' });

    await Message.deleteOne({ _id: msg._id });
    try {
      emitToUser(String(msg.senderId), 'messageDeleted', { messageId: String(msg._id) });
      emitToUser(String(msg.receiverId), 'messageDeleted', { messageId: String(msg._id) });
    } catch (_) {}

    return res.json({ success: true, messageId: String(msg._id) });
  } catch (error) {
    console.error('Delete private message error:', error);
    return res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Toggle reaction on a private message
app.post('/api/messages/:messageId/reactions', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const emoji = String(req.body?.emoji || '').trim().slice(0, 16);
    if (!emoji) return res.status(400).json({ error: 'emoji required' });

    const msg = await Message.findById(messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const me = String(req.userId);
    const isParticipant = String(msg.senderId) === me || String(msg.receiverId) === me;
    if (!isParticipant) return res.status(403).json({ error: 'Not allowed' });

    if (!Array.isArray(msg.reactions)) msg.reactions = [];
    let row = msg.reactions.find((r) => String(r.emoji) === emoji);
    if (!row) {
      row = { emoji, users: [] };
      msg.reactions.push(row);
    }
    const idx = row.users.findIndex((u) => String(u) === me);
    if (idx >= 0) row.users.splice(idx, 1);
    else row.users.push(me);

    msg.reactions = msg.reactions.filter((r) => Array.isArray(r.users) && r.users.length > 0);
    await msg.save();

    const populatedMessage = await getPopulatedPrivateMessage(msg._id);
    try {
      emitToUser(String(msg.senderId), 'messageReaction', populatedMessage);
      emitToUser(String(msg.receiverId), 'messageReaction', populatedMessage);
    } catch (_) {}

    return res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Private reaction error:', error);
    return res.status(500).json({ error: 'Failed to react to message' });
  }
});

// Mark message as read
app.post('/api/messages/:messageId/read', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    if (!message.receiverId.equals(req.userId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    message.isRead = true;
    await message.save();
    
    const senderSocketId = getUserSocketId(message.senderId.toString());
    if (senderSocketId) {
      io.to(senderSocketId).emit('messageRead', {
        messageId: message._id,
        receiverId: req.userId,
        timestamp: Date.now()
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Mark message read error:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

// Mark messages as delivered
app.post('/api/messages/delivered', authenticateToken, async (req, res) => {
  try {
    const { messageIds } = req.body;
    
    await Message.updateMany(
      { _id: { $in: messageIds }, receiverId: req.userId },
      { isDelivered: true }
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Mark messages delivered error:', error);
    res.status(500).json({ error: 'Failed to mark messages as delivered' });
  }
});

// Voice message upload endpoint
app.post('/api/messages/voice', authenticateToken, upload.single('audio'), async (req, res) => {
  try {  if (denyIfMuted(req, res)) return;

    const { receiverId } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'video',
      folder: 'voice_messages',
      format: 'webm',
      timeout: 120000
    });
    
    const duration = '0:00';
    
    const message = new Message({
      senderId: req.userId,
      receiverId,
      text: 'Voice message 🎤',
      mediaUrl: result.secure_url,
      mediaType: 'voice',
      mediaMetadata: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        duration: duration
      },
      isDelivered: false,
      isRead: false
    });
    
    await message.save();
    
    await Stats.findOneAndUpdate({}, { $inc: { totalMessages: 1 } });
    
    const populatedMessage = await Message.findById(message._id)
      .populate('senderId', 'username nickname avatar')
      .populate('receiverId', 'username nickname avatar');
    
    const receiverSocketId = getUserSocketId(receiverId);
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('newMessage', populatedMessage);
      message.isDelivered = true;
      await message.save();
    }
    
    const senderSocketId = getUserSocketId(req.userId);
    if (senderSocketId) {
      io.to(senderSocketId).emit('messageSent', populatedMessage);
    }
    
    const fs = require('fs');
    fs.unlinkSync(req.file.path);
    
    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Voice message upload error:', error);
    res.status(500).json({ error: 'Failed to send voice message' });
  }
});

// File upload endpoint
app.post('/api/messages/file', authenticateToken, upload.single('file'), async (req, res) => {
  try {  if (denyIfMuted(req, res)) return;

    const { receiverId, text = '' } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    let result;
    const mediaType = getMediaType(req.file.mimetype);
    
    if (req.file.mimetype.startsWith('image/')) {
      result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'chat_images',
        quality: 'auto',
        fetch_format: 'auto'
      });
    } else if (req.file.mimetype.startsWith('video/')) {
      result = await cloudinary.uploader.upload(req.file.path, {
        resource_type: 'video',
        folder: 'chat_videos',
        chunk_size: 6000000
      });
    } else if (req.file.mimetype.startsWith('audio/')) {
      result = await cloudinary.uploader.upload(req.file.path, {
        resource_type: 'video',
        folder: 'chat_audio'
      });
    } else {
      result = await cloudinary.uploader.upload(req.file.path, {
        resource_type: 'raw',
        folder: 'chat_files'
      });
    }
    
    const message = new Message({
      senderId: req.userId,
      receiverId,
      text: text || `File: ${req.file.originalname}`,
      mediaUrl: result.secure_url,
      mediaType: mediaType,
      mediaMetadata: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        duration: mediaType === 'audio' || mediaType === 'voice' ? '0:00' : undefined
      },
      isDelivered: false,
      isRead: false
    });
    
    await message.save();
    
    await Stats.findOneAndUpdate({}, { $inc: { totalMessages: 1 } });
    
    const populatedMessage = await Message.findById(message._id)
      .populate('senderId', 'username nickname avatar')
      .populate('receiverId', 'username nickname avatar');
    
    const receiverSocketId = getUserSocketId(receiverId);
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('newMessage', populatedMessage);
      message.isDelivered = true;
      await message.save();
    }
    
    const senderSocketId = getUserSocketId(req.userId);
    if (senderSocketId) {
      io.to(senderSocketId).emit('messageSent', populatedMessage);
    }
    
    const fs = require('fs');
    fs.unlinkSync(req.file.path);
    
    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Failed to send file' });
  }
});

// Get user's online status
app.get('/api/user/:userId/status', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const isOnline = onlineUsers.has(req.params.userId);
    
    res.json({
      success: true,
      isOnline,
      lastSeen: user.lastSeen,
      status: user.status
    });
  } catch (error) {
    console.error('Get user status error:', error);
    res.status(500).json({ error: 'Failed to get user status' });
  }
});

// Get online users
app.get('/api/users/online', authenticateToken, async (req, res) => {
  try {
    const onlineUserIds = Array.from(onlineUsers.keys());
    const users = await User.find({
      _id: { $in: onlineUserIds, $ne: req.userId }
    })
    .select('_id username nickname avatar university')
    .limit(50);
    
    res.json({ success: true, users });
  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({ error: 'Failed to get online users' });
  }
});

// Call History
app.get('/api/calls/history', authenticateToken, async (req, res) => {
  try {
    const calls = await CallHistory.find({
      $or: [
        { callerId: req.userId },
        { receiverId: req.userId }
      ]
    })
    .sort({ startedAt: -1 })
    .populate('callerId', 'username nickname avatar')
    .populate('receiverId', 'username nickname avatar')
    .limit(20);
    
    res.json({ success: true, calls });
  } catch (error) {
    console.error('Get call history error:', error);
    res.status(500).json({ error: 'Failed to get call history' });
  }
});

// Get call statistics
app.get('/api/calls/stats', authenticateToken, async (req, res) => {
  try {
    const me = new mongoose.Types.ObjectId(req.userId);
    const totalCalls = await CallHistory.countDocuments({
      $or: [
        { callerId: req.userId },
        { receiverId: req.userId }
      ]
    });
    
    const completedCalls = await CallHistory.countDocuments({
      $or: [
        { callerId: req.userId, status: 'completed' },
        { receiverId: req.userId, status: 'completed' }
      ]
    });
    
    const totalDuration = await CallHistory.aggregate([
      {
        $match: {
          $or: [
            { callerId: me },
            { receiverId: me }
          ],
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$duration" }
        }
      }
    ]);
    
    res.json({
      success: true,
      stats: {
        totalCalls,
        completedCalls,
        totalDuration: totalDuration[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get call stats error:', error);
    res.status(500).json({ error: 'Failed to get call statistics' });
  }
});

// Create Group
app.post('/api/groups', authenticateToken, async (req, res) => {
  try {
    const { name, username, description, university, faculty, studyType, studyGroup, isPrivate } = req.body || {};

    const creator = await User.findById(req.userId).select('university faculty studyType studyGroup role isAdmin').lean();
    if (!creator) return res.status(404).json({ error: 'User not found' });

    const creatorRole = String(creator.role || '').toLowerCase();
    const isAdminActor = !!(creator.isAdmin || creatorRole === 'admin');

    const requestedUniversity = isAdminActor
      ? (cleanText(university, 180) || cleanText(creator.university, 180))
      : cleanText(creator.university, 180);
    const requestedFaculty = cleanText(faculty, 180) || cleanText(creator.faculty, 180);
    const requestedStudyType = cleanText(studyType, 80) || cleanText(creator.studyType, 80);
    const requestedStudyGroup = cleanText(studyGroup, 80) || cleanText(creator.studyGroup, 80);

    const academic = await normalizeAcademicIdentity({
      university: requestedUniversity,
      faculty: requestedFaculty,
      studyType: requestedStudyType,
      studyGroup: requestedStudyGroup
    }, {
      requireUniversity: true,
      requireFaculty: true,
      requireStudyType: true,
      requireStudyGroup: true
    });
    if (!academic.ok) return res.status(400).json({ error: academic.error });

    const nameVal = cleanText(name, 120);
    const usernameVal = normalizeHandle(username);
    const descriptionVal = cleanText(description, 500);
    if (!nameVal) return res.status(400).json({ error: 'Group name required' });
    if (!usernameVal) return res.status(400).json({ error: 'Group username invalid' });
    const existing = await Group.findOne({ username: usernameVal }).select('_id').lean();
    if (existing) return res.status(409).json({ error: 'Group username already exists' });

    const group = new Group({
      name: nameVal,
      username: usernameVal,
      description: descriptionVal,
      university: academic.value.university,
      faculty: academic.value.faculty,
      studyType: academic.value.studyType,
      studyGroup: academic.value.studyGroup,
      creatorId: req.userId,
      members: [req.userId],
      isPublic: !(String(isPrivate || '').toLowerCase() === 'true' || String(isPrivate || '').toLowerCase() === 'on' || String(isPrivate || '') === '1')
    });
    
    await group.save();
    
    await Stats.findOneAndUpdate({}, { $inc: { totalGroups: 1 } });
    
    res.json({ success: true, group });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Get User Groups
app.get('/api/groups', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const query = { members: req.userId };
    if (me?.university) query.university = me.university;

    const groups = await Group.find(query)
      .populate('creatorId', 'username nickname')
      .populate('members', 'username nickname avatar');
    
    res.json({ success: true, groups });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Failed to get groups' });
  }
});

// Get Group Messages
app.get('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const me = await User.findById(req.userId).select('university faculty role isAdmin').lean();
    const group = await Group.findById(groupId).select('members isPublic creatorId university faculty').lean();
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const isMember = (group.members || []).some(m => String(m) === String(req.userId));
    const canScopedModerate = canUserModerateGroupByScope(me, group);

    if (!canScopedModerate) {
      if (group.university && me?.university && String(group.university) !== String(me.university)) {
        return res.status(403).json({ error: 'This group belongs to another university' });
      }
      if (!group.isPublic && !isMember && String(group.creatorId) !== String(req.userId)) {
        return res.status(403).json({ error: 'Not a group member' });
      }
    }

    const messages = await GroupMessage.find({ groupId })
      .sort({ createdAt: 1 })
      .populate('senderId', 'username nickname avatar');
    
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get group messages error:', error);
    res.status(500).json({ error: 'Failed to get group messages' });
  }
});

// Send Group Message

// Upload a file/media and send as a group message (HALLAYM edu)
app.post('/api/groups/:groupId/messages/file', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (denyIfMuted(req, res)) return;
    const { groupId } = req.params;
    const text = String(req.body?.text || '');
    const me = await User.findById(req.userId).select('university').lean();
    if (!req.file) return res.status(400).json({ success:false, error: 'No file uploaded' });

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success:false, error: 'Group not found' });
    if (group.university && me?.university && String(group.university) !== String(me.university)) {
      return res.status(403).json({ success:false, error: 'This group belongs to another university' });
    }
    if (!(group.members || []).some(m => String(m) === String(req.userId))) {
      return res.status(403).json({ success:false, error: 'Not a group member' });
    }

    // Max 5MB for group chat uploads
    const maxBytes = 5 * 1024 * 1024;
    if (Number(req.file.size || 0) > maxBytes) {
      try { require('fs').unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ success:false, error: 'File size must be <= 5MB' });
    }

    const mime = String(req.file.mimetype || '').toLowerCase();
    const allow = (
      mime.startsWith('image/') ||
      mime.startsWith('video/') ||
      mime.startsWith('audio/') ||
      mime === 'application/pdf' ||
      mime.includes('msword') ||
      mime.includes('officedocument') ||
      mime.startsWith('text/')
    );
    if (!allow) {
      try { require('fs').unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ success:false, error: 'Unsupported file type' });
    }

    const mediaType = getMediaType(req.file.mimetype);
    const result = await cloudinary.uploader.upload(req.file.path, { folder:'group_messages', resource_type:'auto' });

    const msg = new GroupMessage({
      groupId,
      senderId: req.userId,
      text,
      mediaUrl: result.secure_url,
      mediaType,
      mediaName: req.file.originalname || '',
      mediaSize: Number(req.file.size || 0),
      mediaMime: req.file.mimetype || ''
    });
    await msg.save();

    const populated = await GroupMessage.findById(msg._id).populate('senderId', 'username nickname avatar');
    io.to(`group_${groupId}`).emit('newGroupMessage', populated);
    try { require('fs').unlinkSync(req.file.path); } catch (_) {}

    return res.json({ success:true, message: populated });
  } catch (e) {
    console.error('group file message error', e);
    return res.status(500).json({ success:false, error: 'Server error' });
  }
});
app.post('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
  try {  if (denyIfMuted(req, res)) return;

    const { groupId } = req.params;
    const { text, mediaUrl, mediaType } = req.body;
    const me = await User.findById(req.userId).select('university').lean();
    
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.university && me?.university && String(group.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This group belongs to another university' });
    }
    if (!(group.members || []).some(m => String(m) === String(req.userId))) {
      return res.status(403).json({ error: 'Not a group member' });
    }

    const safeText = String(text || '').trim();
    if (!safeText && !String(mediaUrl || '').trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    
    const message = new GroupMessage({
      groupId,
      senderId: req.userId,
      text: safeText,
      mediaUrl,
      mediaType
    });
    
    await message.save();
    
    const populatedMessage = await GroupMessage.findById(message._id)
      .populate('senderId', 'username nickname avatar');
    
    io.to(`group_${groupId}`).emit('newGroupMessage', populatedMessage);
    
    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Send group message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Edit own group message
app.put('/api/groups/:groupId/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    if (denyIfMuted(req, res)) return;
    const { groupId, messageId } = req.params;
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const msg = await GroupMessage.findOne({ _id: messageId, groupId });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (String(msg.senderId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Only sender can edit this message' });
    }
    if (msg.deletedAt) return res.status(400).json({ error: 'Message already deleted' });

    msg.text = text;
    msg.editedAt = new Date();
    await msg.save();

    const populated = await GroupMessage.findById(msg._id).populate('senderId', 'username nickname avatar');
    io.to(`group_${groupId}`).emit('groupMessageUpdated', populated);
    return res.json({ success: true, message: populated });
  } catch (e) {
    console.error('Edit group message error:', e);
    return res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Delete own group message (or creator/admin)
app.delete('/api/groups/:groupId/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const msg = await GroupMessage.findOne({ _id: messageId, groupId });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const g = await Group.findById(groupId).select('creatorId').lean();
    const me = await User.findById(req.userId).select('isAdmin role').lean();
    const canDelete = (
      String(msg.senderId) === String(req.userId) ||
      String(g?.creatorId || '') === String(req.userId) ||
      !!(me?.isAdmin || String(me?.role || '').toLowerCase() === 'admin')
    );
    if (!canDelete) return res.status(403).json({ error: 'Not allowed to delete this message' });

    await GroupMessage.deleteOne({ _id: msg._id });
    io.to(`group_${groupId}`).emit('groupMessageDeleted', { _id: String(msg._id), groupId: String(groupId) });
    return res.json({ success: true });
  } catch (e) {
    console.error('Delete group message error:', e);
    return res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Toggle reaction on a group message
app.post('/api/groups/:groupId/messages/:messageId/reactions', authenticateToken, async (req, res) => {
  try {
    if (denyIfMuted(req, res)) return;
    const { groupId, messageId } = req.params;
    const emoji = String(req.body?.emoji || '').trim();
    if (!emoji || emoji.length > 8) return res.status(400).json({ error: 'Invalid emoji' });

    const me = await User.findById(req.userId).select('university').lean();
    const group = await Group.findById(groupId).select('members university').lean();
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.university && me?.university && String(group.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This group belongs to another university' });
    }
    const isMember = (group.members || []).some(m => String(m) === String(req.userId));
    if (!isMember) return res.status(403).json({ error: 'Not a group member' });

    const msg = await GroupMessage.findOne({ _id: messageId, groupId });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    if (!Array.isArray(msg.reactions)) msg.reactions = [];
    let row = msg.reactions.find(r => String(r.emoji) === emoji);
    if (!row) {
      row = { emoji, users: [] };
      msg.reactions.push(row);
    }

    const uid = String(req.userId);
    const has = (row.users || []).some(u => String(u) === uid);
    if (has) {
      row.users = (row.users || []).filter(u => String(u) !== uid);
    } else {
      row.users = [...(row.users || []), req.userId];
    }
    msg.reactions = msg.reactions.filter(r => Array.isArray(r.users) && r.users.length > 0);
    await msg.save();

    const populated = await GroupMessage.findById(msg._id).populate('senderId', 'username nickname avatar');
    io.to(`group_${groupId}`).emit('groupMessageReaction', populated);
    return res.json({ success: true, message: populated });
  } catch (e) {
    console.error('Group reaction error:', e);
    return res.status(500).json({ error: 'Failed to react to message' });
  }
});

// Create Channel
app.post('/api/channels', authenticateToken, async (req, res) => {
  try {
    const { name, username, description, category, university, isPublic } = req.body || {};

    const actor = await User.findById(req.userId).select('university role isAdmin').lean();
    if (!actor) return res.status(404).json({ error: 'User not found' });
    const actorRole = String(actor.role || '').toLowerCase();
    const isAdminActor = !!(actor.isAdmin || actorRole === 'admin');

    const channelUniversity = isAdminActor
      ? (cleanText(university, 180) || cleanText(actor.university, 180))
      : cleanText(actor.university, 180);
    if (!channelUniversity) return res.status(400).json({ error: 'University required in profile' });

    const uniDoc = await findUniversityDocInsensitive(channelUniversity);
    if (!uniDoc) return res.status(400).json({ error: 'Unknown university. Choose from the list.' });

    const usernameVal = normalizeHandle(username);
    if (!usernameVal) return res.status(400).json({ error: 'Channel username invalid' });

    const existingChannel = await Channel.findOne({ username: usernameVal });
    if (existingChannel) {
      return res.status(400).json({ error: 'Channel username already exists' });
    }

    const nameVal = cleanText(name, 120);
    if (!nameVal) return res.status(400).json({ error: 'Channel name required' });

    const channel = new Channel({
      name: nameVal,
      username: usernameVal,
      description: cleanText(description, 500),
      category: cleanText(category, 60) || 'other',
      university: uniDoc.name,
      isPublic: isPublic !== false,
      creatorId: req.userId,
      moderators: [req.userId],
      subscribers: [req.userId],
      inviteLink: uuidv4()
    });
    
    await channel.save();
    
    await Stats.findOneAndUpdate({}, { 
      $inc: { totalChannels: 1 } 
    });
    
    res.json({ 
      success: true, 
      channel: {
        ...channel.toObject(),
        isSubscribed: true,
        subscriberCount: 1,
        postCount: 0
      }
    });
  } catch (error) {
    console.error('Create channel error:', error);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// Update Channel (metadata)
app.put('/api/channels/:channelId([0-9a-fA-F]{24})', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.params;
    const { name, username, description, category, university, isPublic } = req.body;

    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const isCreator = channel.creatorId.equals(req.userId);
    const isModerator = channel.moderators.some(mod => mod.equals(req.userId));
    if (!isCreator && !isModerator) {
      return res.status(403).json({ error: 'Only channel admins can edit channel' });
    }

    // If username changed, ensure uniqueness
    if (username && username !== channel.username) {
      const normalized = normalizeHandle(username);
      if (!normalized) return res.status(400).json({ error: 'Channel username invalid' });
      const exists = await Channel.findOne({ username: normalized });
      if (exists) return res.status(400).json({ error: 'Channel username already exists' });
      channel.username = normalized;
    }

    if (typeof name === 'string' && name.trim()) channel.name = name.trim();
    if (typeof description === 'string') channel.description = description;
    if (typeof category === 'string' && category.trim()) channel.category = category.trim();
    if (typeof university === 'string') {
      const me = await User.findById(req.userId).select('university role isAdmin').lean();
      const role = String(me?.role || '').toLowerCase();
      const isAdminActor = !!(me?.isAdmin || role === 'admin');
      if (isAdminActor) {
        const uni = cleanText(university, 180);
        if (uni) {
          const uniDoc = await findUniversityDocInsensitive(uni);
          if (!uniDoc) return res.status(400).json({ error: 'Unknown university. Choose from the list.' });
          channel.university = uniDoc.name;
        }
      } else {
        channel.university = cleanText(me?.university, 180);
      }
    }
    if (typeof isPublic === 'boolean') channel.isPublic = isPublic;

    await channel.save();

    io.to(`channel_${channelId}`).emit('channelUpdated', {
      channelId,
      name: channel.name,
      username: channel.username,
      description: channel.description,
      category: channel.category,
      university: channel.university,
      isPublic: channel.isPublic,
      avatar: channel.avatar,
      coverBanner: channel.coverBanner || ''
    });

    res.json({ success: true, channel });
  } catch (error) {
    console.error('Update channel error:', error);
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

// Upload Channel Avatar
app.post('/api/channels/:channelId([0-9a-fA-F]{24})/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    const { channelId } = req.params;

    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const isCreator = channel.creatorId.equals(req.userId);
    const isModerator = channel.moderators.some(mod => mod.equals(req.userId));
    if (!isCreator && !isModerator) {
      return res.status(403).json({ error: 'Only channel admins can change avatar' });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const result = await cloudinary.uploader.upload(req.file.path, { folder: 'channels/avatars' });
    try { require('fs').unlinkSync(req.file.path); } catch (_) {}

    channel.avatar = result.secure_url;
    await channel.save();

    io.to(`channel_${channelId}`).emit('channelUpdated', { channelId, avatar: channel.avatar });

    res.json({ success: true, avatar: channel.avatar });
  } catch (error) {
    console.error('Upload channel avatar error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Upload Channel Cover Banner
app.post('/api/channels/:channelId([0-9a-fA-F]{24})/banner', authenticateToken, upload.single('banner'), async (req, res) => {
  try {
    const { channelId } = req.params;

    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const isCreator = channel.creatorId.equals(req.userId);
    const isModerator = channel.moderators.some(mod => mod.equals(req.userId));
    if (!isCreator && !isModerator) {
      return res.status(403).json({ error: 'Only channel admins can change banner' });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const result = await cloudinary.uploader.upload(req.file.path, { folder: 'channels/banners' });
    try { require('fs').unlinkSync(req.file.path); } catch (_) {}

    channel.coverBanner = result.secure_url;
    await channel.save();

    io.to(`channel_${channelId}`).emit('channelUpdated', { channelId, coverBanner: channel.coverBanner });

    res.json({ success: true, coverBanner: channel.coverBanner });
  } catch (error) {
    console.error('Upload channel banner error:', error);
    res.status(500).json({ error: 'Failed to upload banner' });
  }
});

// Upload Channel Post Media (multipart)
app.post('/api/channels/:channelId([0-9a-fA-F]{24})/posts/upload', authenticateToken, upload.single('media'), async (req, res) => {
  try {  if (denyIfMuted(req, res)) return;

    const { channelId } = req.params;
    const me = await User.findById(req.userId).select('university role isAdmin').lean();

    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const role = String(me?.role || '').toLowerCase();
    const isAdminActor = !!(me?.isAdmin || role === 'admin');
    if (!isAdminActor && channel.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This channel belongs to another university' });
    }

    const isCreator = channel.creatorId.equals(req.userId);
    const isModerator = channel.moderators.some(mod => mod.equals(req.userId));
    if (!isCreator && !isModerator) {
      return res.status(403).json({ error: 'Only channel admins can upload media' });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const result = await cloudinary.uploader.upload(req.file.path, { folder: 'channels/posts', resource_type: 'auto' });
    const mediaType = getMediaType(req.file.mimetype);
    try { require('fs').unlinkSync(req.file.path); } catch (_) {}

    res.json({ success: true, url: result.secure_url, mediaType });
  } catch (error) {
    console.error('Upload post media error:', error);
    res.status(500).json({ error: 'Failed to upload post media' });
  }
});


// Get Channel Posts
app.get('/api/channels/:channelId([0-9a-fA-F]{24})/posts', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.params;
    const me = await User.findById(req.userId).select('university').lean();
    const channel = await Channel.findById(channelId).select('university').lean();
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This channel belongs to another university' });
    }
    const posts = await ChannelPost.find({ channelId })
      .sort({ createdAt: -1 })
      .populate('channelId', 'name username');
    
    res.json({ success: true, posts });
  } catch (error) {
    console.error('Get channel posts error:', error);
    res.status(500).json({ error: 'Failed to get channel posts' });
  }
});

// Create Channel Post
app.post('/api/channels/:channelId([0-9a-fA-F]{24})/posts', authenticateToken, async (req, res) => {
  try {  if (denyIfMuted(req, res)) return;

    const { channelId } = req.params;
    const { content, mediaUrl, mediaType, type } = req.body;
    const me = await User.findById(req.userId).select('university role isAdmin').lean();
    
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const role = String(me?.role || '').toLowerCase();
    const isAdminActor = !!(me?.isAdmin || role === 'admin');
    if (!isAdminActor && channel.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This channel belongs to another university' });
    }
    
    const isCreator = channel.creatorId.equals(req.userId);
    const isModerator = channel.moderators.some(mod => mod.equals(req.userId));
    
    if (!isCreator && !isModerator) {
      return res.status(403).json({ error: 'Only channel admins can post' });
    }
    
    const post = new ChannelPost({
      channelId,
      content,
      mediaUrl,
      mediaType,
      type: type || 'announcement'
    });
    
    await post.save();
    
    io.to(`channel_${channelId}`).emit('newPost', {
      ...post.toObject(),
      channelId: {
        _id: channel._id,
        name: channel.name,
        username: channel.username
      }
    });
    
    res.json({ success: true, post });
  } catch (error) {
    console.error('Create channel post error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Get Stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await Stats.findOne();
    
    if (req.query.increment === 'true') {
      await Stats.findOneAndUpdate({}, { $inc: { dailyVisits: 1 } });
      const updatedStats = await Stats.findOne();
      return res.json({ success: true, stats: updatedStats });
    }
    
    res.json({ success: true, stats: stats || {} });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get detailed statistics
app.get('/api/stats/detailed', authenticateToken, async (req, res) => {
  try {
    const stats = await Stats.findOne();
    
    const activeUsers = await User.countDocuments({ isOnline: true });
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMessages = await Message.countDocuments({ createdAt: { $gte: today } });
    
    const todayGroups = await Group.countDocuments({ createdAt: { $gte: today } });
    
    const todayChannels = await Channel.countDocuments({ createdAt: { $gte: today } });
    
    const universityStats = await User.aggregate([
      { $group: { _id: '$university', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    res.json({
      success: true,
      stats: {
        ...stats.toObject(),
        activeUsers,
        todayMessages,
        todayGroups,
        todayChannels,
        universityStats: universityStats.map(u => ({
          name: u._id || 'Not specified',
          count: u.count
        }))
      }
    });
  } catch (error) {
    console.error('Get detailed stats error:', error);
    res.status(500).json({ error: 'Failed to get detailed stats' });
  }
});

// Join group
app.post('/api/groups/:groupId/join', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const me = await User.findById(req.userId).select('university').lean();
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (group.university && me?.university && String(group.university) !== String(me.university)) {
      return res.status(403).json({ error: 'You can only join groups in your university' });
    }

    if ((group.members || []).some((m) => String(m) === String(req.userId))) {
      return res.status(400).json({ error: 'Already a member' });
    }
    
    group.members.push(req.userId);
    await group.save();
    
    res.json({ success: true, group });
  } catch (error) {
    console.error('Join group error:', error);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// Leave group
app.post('/api/groups/:groupId/leave', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    if (group.creatorId.equals(req.userId)) {
      return res.status(400).json({ error: 'Group creator cannot leave. Transfer ownership first.' });
    }
    
    group.members = group.members.filter(memberId => !memberId.equals(req.userId));
    await group.save();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

// Subscribe to channel
app.post('/api/channels/:channelId([0-9a-fA-F]{24})/subscribe', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.params;
    const me = await User.findById(req.userId).select('university').lean();
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    if (channel.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'You can only subscribe to channels in your university' });
    }

    if ((channel.subscribers || []).some((s) => String(s) === String(req.userId))) {
      return res.status(400).json({ error: 'Already subscribed' });
    }
    
    channel.subscribers.push(req.userId);
    await channel.save();
    
    io.to(`channel_${channelId}`).emit('channelSubscriptionUpdate', {
      channelId,
      action: 'subscribe',
      userId: req.userId
    });
    
    res.json({ success: true, channel });
  } catch (error) {
    console.error('Subscribe to channel error:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Unsubscribe from channel
app.post('/api/channels/:channelId([0-9a-fA-F]{24})/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.params;
    const me = await User.findById(req.userId).select('university').lean();
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    if (channel.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This channel belongs to another university' });
    }

    channel.subscribers = channel.subscribers.filter(subId => !subId.equals(req.userId));
    await channel.save();
    
    io.to(`channel_${channelId}`).emit('channelSubscriptionUpdate', {
      channelId,
      action: 'unsubscribe',
      userId: req.userId
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Unsubscribe from channel error:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Get user's groups
app.get('/api/groups/my', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const query = { creatorId: req.userId };
    if (me?.university) query.university = me.university;

    const groups = await Group.find(query)
      .populate('members', 'username nickname avatar')
      .populate('creatorId', 'username nickname');
    
    res.json({ 
      success: true, 
      groups,
      stats: {
        myGroups: groups.length,
        totalMembers: groups.reduce((sum, group) => sum + group.members.length, 0)
      }
    });
  } catch (error) {
    console.error('Get user groups error:', error);
    res.status(500).json({ error: 'Failed to get groups' });
  }
});

// Get joined groups
app.get('/api/groups/joined', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const query = {
      members: req.userId,
      creatorId: { $ne: req.userId }
    };
    if (me?.university) query.university = me.university;

    const groups = await Group.find({ 
      ...query
    })
    .populate('members', 'username nickname avatar')
    .populate('creatorId', 'username nickname');

    const totalGroups = await Group.countDocuments(me?.university ? { university: me.university } : {});
    
    res.json({ 
      success: true, 
      groups,
      stats: {
        joinedGroups: groups.length,
        totalGroups
      }
    });
  } catch (error) {
    console.error('Get joined groups error:', error);
    res.status(500).json({ error: 'Failed to get groups' });
  }
});

// Search Messages
app.get('/api/search/messages', authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;
    const messages = await Message.find({
      text: { $regex: query, $options: 'i' },
      $or: [
        { senderId: req.userId },
        { receiverId: req.userId }
      ]
    })
    .populate('senderId', 'username nickname avatar')
    .populate('receiverId', 'username nickname avatar')
    .limit(20);
    
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Search Groups
app.get('/api/search/groups', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const q = String(req.query.query || '').trim();
    const re = new RegExp(escapeRegex(q), 'i');
    const filter = {
      $or: [
        { name: re },
        { username: re },
        { description: re }
      ]
    };
    if (me?.university) filter.university = me.university;

    const groups = await Group.find(filter).populate('creatorId', 'username nickname').limit(20);
    
    res.json({ success: true, groups });
  } catch (error) {
    console.error('Search groups error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Search Channels
app.get('/api/search/channels', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const q = String(req.query.query || '').trim();
    const re = new RegExp(escapeRegex(q), 'i');
    const filter = {
      $or: [
        { name: re },
        { username: re },
        { description: re }
      ]
    };
    if (me?.university) filter.university = me.university;

    const channels = await Channel.find(filter).populate('creatorId', 'username nickname').limit(20);
    
    res.json({ success: true, channels });
  } catch (error) {
    console.error('Search channels error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get all public groups
app.get('/api/groups/all', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const query = me?.university ? { university: me.university } : {};

    const groups = await Group.find(query)
      .populate('members', 'username nickname avatar')
      .populate('creatorId', 'username nickname')
      .limit(50);

    const totalGroups = await Group.countDocuments(query);
    const totalMembers = await Group.aggregate([
      ...(me?.university ? [{ $match: { university: me.university } }] : []),
      { $project: { memberCount: { $size: "$members" } } },
      { $group: { _id: null, total: { $sum: "$memberCount" } } }
    ]);
    
    res.json({ 
      success: true, 
      groups,
      stats: {
        totalGroups,
        totalMembers: totalMembers[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get all groups error:', error);
    res.status(500).json({ error: 'Failed to get groups' });
  }
});

// Get group information
app.get('/api/groups/:groupId', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university faculty role isAdmin').lean();
    const group = await Group.findById(req.params.groupId)
      .populate('creatorId', 'username nickname avatar')
      .populate('members', 'username nickname avatar isOnline');
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const isMember = group.members.some(member => member._id.equals(req.userId));
    const canScopedModerate = canUserModerateGroupByScope(me, group);
    if (!canScopedModerate) {
      if (group.university && me?.university && String(group.university) !== String(me.university)) {
        return res.status(403).json({ error: 'This group belongs to another university' });
      }
      if (!isMember && !group.isPublic) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    res.json({ success: true, group });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ error: 'Failed to get group' });
  }
});

// Invite user to group
app.post('/api/groups/:groupId/invite', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;
    
    const group = await Group.findById(groupId);
    
    if (!group.creatorId.equals(req.userId)) {
      return res.status(403).json({ error: 'Only group creator can invite users' });
    }
    
    if ((group.members || []).some((m) => String(m) === String(userId))) {
      return res.status(400).json({ error: 'User already in group' });
    }

    const invited = await User.findById(userId).select('university username nickname avatar').lean();
    if (!invited) return res.status(404).json({ error: 'User not found' });
    if (group.university && invited.university && String(group.university) !== String(invited.university)) {
      return res.status(400).json({ error: 'Only users from same university can be invited' });
    }
    
    group.members.push(userId);
    await group.save();
    
    const user = invited;
    io.to(`group_${groupId}`).emit('groupMemberUpdate', {
      groupId,
      action: 'add',
      user
    });
    
    res.json({ success: true, group });
  } catch (error) {
    console.error('Invite to group error:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

// Delete group
app.delete('/api/groups/:groupId', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    if (!group.creatorId.equals(req.userId)) {
      return res.status(403).json({ error: 'Only group creator can delete group' });
    }
    
    await GroupMessage.deleteMany({ groupId });
    
    await Group.findByIdAndDelete(groupId);
    
    await Stats.findOneAndUpdate({}, { $inc: { totalGroups: -1 } });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// Profile stats
app.get('/api/profile/stats', authenticateToken, async (req, res) => {
  try {
    const friendsCount = await User.countDocuments({
      _id: { $ne: req.userId }
    });
    
    const groupsCount = await Group.countDocuments({
      members: req.userId
    });
    
    const messagesCount = await Message.countDocuments({
      $or: [
        { senderId: req.userId },
        { receiverId: req.userId }
      ]
    });
    
    res.json({
      success: true,
      stats: {
        friends: friendsCount,
        groups: groupsCount,
        messages: messagesCount
      }
    });
  } catch (error) {
    console.error('Get profile stats error:', error);
    res.status(500).json({ error: 'Failed to get profile stats' });
  }
});

// Profile activity
app.get('/api/profile/activity', authenticateToken, async (req, res) => {
  try {
    const recentMessages = await Message.find({
      $or: [
        { senderId: req.userId },
        { receiverId: req.userId }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('senderId', 'nickname avatar')
    .populate('receiverId', 'nickname avatar');
    
    const activity = recentMessages.map(msg => ({
      type: 'message',
      icon: 'comment',
      description: `${msg.senderId.nickname} sent a message to ${msg.receiverId.nickname}`,
      timestamp: msg.createdAt
    }));
    
    const totalMessages = await Message.countDocuments({
      $or: [
        { senderId: req.userId },
        { receiverId: req.userId }
      ]
    });
    
    const me = new mongoose.Types.ObjectId(req.userId);
    const activeDays = await Message.aggregate([
      {
        $match: {
          $or: [
            { senderId: me },
            { receiverId: me }
          ]
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          }
        }
      },
      {
        $count: "days"
      }
    ]);
    
    res.json({
      success: true,
      activity: {
        recent: activity,
        totalMessages: totalMessages,
        activeDays: activeDays[0]?.days || 0,
        avgMessages: Math.round(totalMessages / 30)
      }
    });
  } catch (error) {
    console.error('Get profile activity error:', error);
    res.status(500).json({ error: 'Failed to get activity' });
  }
});



// Get channel by username (for share links like /channel.html?username=xxx)
app.get('/api/channels/by-username/:username', authenticateToken, async (req, res) => {
  try {
    const uname = String(req.params.username || '').trim();
    if (!uname) return res.status(400).json({ error: 'Username is required' });
    const me = await User.findById(req.userId).select('university').lean();

    const channel = await Channel.findOne({ username: new RegExp('^' + escapeRegex(uname) + '$', 'i') })
      .populate('creatorId', 'username nickname avatar')
      .populate('moderators', 'username nickname avatar')
      .populate('subscribers', 'username nickname avatar');

    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This channel belongs to another university' });
    }

    const isSubscribed = channel.subscribers.some(sub => sub._id.equals(req.userId));

    const postCount = await ChannelPost.countDocuments({ channelId: channel._id });

    const totalViews = await ChannelPost.aggregate([
      { $match: { channelId: channel._id } },
      { $group: { _id: null, total: { $sum: "$viewsCount" } } }
    ]);

    res.json({
      success: true,
      channel: {
        ...channel.toObject(),
        isSubscribed,
        postCount,
        totalViews: totalViews[0]?.total || 0,
        subscriberCount: channel.subscribers.length
      }
    });
  } catch (error) {
    console.error('Get channel by username error:', error);
    res.status(500).json({ error: 'Failed to get channel' });
  }
});
// Get channel by ID
app.get('/api/channels/:channelId([0-9a-fA-F]{24})', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const channel = await Channel.findById(req.params.channelId)
      .populate('creatorId', 'username nickname avatar')
      .populate('moderators', 'username nickname avatar')
      .populate('subscribers', 'username nickname avatar');
    
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (channel.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This channel belongs to another university' });
    }
    
    const isSubscribed = channel.subscribers.some(sub => 
      sub._id.equals(req.userId)
    );
    
    const postCount = await ChannelPost.countDocuments({ channelId: channel._id });
    
    const totalViews = await ChannelPost.aggregate([
      { $match: { channelId: channel._id } },
      { $group: { _id: null, total: { $sum: "$viewsCount" } } }
    ]);
    
    res.json({
      success: true,
      channel: {
        ...channel.toObject(),
        isSubscribed,
        postCount,
        totalViews: totalViews[0]?.total || 0,
        subscriberCount: channel.subscribers.length
      }
    });
  } catch (error) {
    console.error('Get channel error:', error);
    res.status(500).json({ error: 'Failed to get channel' });
  }
});

// Get paginated channel posts
app.get('/api/channels/:channelId([0-9a-fA-F]{24})/posts', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.params;
    const me = await User.findById(req.userId).select('university').lean();
    const channel = await Channel.findById(channelId).select('university').lean();
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This channel belongs to another university' });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const posts = await ChannelPost.find({ channelId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('channelId', 'name username');
    
    const totalPosts = await ChannelPost.countDocuments({ channelId });
    
    res.json({
      success: true,
      posts,
      hasMore: skip + posts.length < totalPosts,
      total: totalPosts
    });
  } catch (error) {
    console.error('Get channel posts error:', error);
    res.status(500).json({ error: 'Failed to get posts' });
  }
});

// Get channel subscribers
app.get('/api/channels/:channelId([0-9a-fA-F]{24})/subscribers', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.params;
    const me = await User.findById(req.userId).select('university').lean();
    
    const channel = await Channel.findById(channelId)
      .populate('subscribers', 'username nickname avatar isOnline');
    
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (channel.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This channel belongs to another university' });
    }
    
    res.json({
      success: true,
      subscribers: channel.subscribers
    });
  } catch (error) {
    console.error('Get channel subscribers error:', error);
    res.status(500).json({ error: 'Failed to get subscribers' });
  }
});

// Get post by ID
app.get('/api/posts/:postId', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const post = await ChannelPost.findById(req.params.postId)
      .populate('channelId', 'name username');
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const channel = await Channel.findById(post.channelId?._id || post.channelId).select('university').lean();
    if (channel?.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This post belongs to another university channel' });
    }
    res.json({ success: true, post });
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Failed to get post' });
  }
});

// Like/Unlike post
app.post('/api/posts/:postId/like', authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const me = await User.findById(req.userId).select('university').lean();
    
    const post = await ChannelPost.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const channel = await Channel.findById(post.channelId).select('university').lean();
    if (channel?.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This post belongs to another university channel' });
    }
    
    const alreadyLiked = post.likes.includes(req.userId);
    
    if (alreadyLiked) {
      post.likes = post.likes.filter(userId => !userId.equals(req.userId));
    } else {
      post.likes.push(req.userId);
    }
    
    await post.save();
    
    res.json({
      success: true,
      liked: !alreadyLiked,
      likeCount: post.likes.length
    });
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ error: 'Failed to like post' });
  }
});

// Get media messages
app.get('/api/messages/:userId/media', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const mediaMessages = await Message.find({
      $or: [
        { senderId: req.userId, receiverId: userId },
        { senderId: userId, receiverId: req.userId }
      ],
      mediaUrl: { $ne: '' }
    })
    .select('mediaUrl mediaType createdAt')
    .sort({ createdAt: -1 })
    .limit(50);
    
    res.json({
      success: true,
      media: mediaMessages
    });
  } catch (error) {
    console.error('Get media messages error:', error);
    res.status(500).json({ error: 'Failed to get media' });
  }
});

// Get channels
app.get('/api/channels', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;
    const me = await User.findById(req.userId).select('university').lean();
    
    const query = {};
    if (me?.university) query.university = me.university;
    
    if (req.query.category && req.query.category !== 'all') {
      query.category = req.query.category;
    }
    
    if (req.query.university && !query.university) {
      query.university = req.query.university;
    }
    
    if (req.query.search) {
      const re = new RegExp(escapeRegex(String(req.query.search || '')), 'i');
      query.$or = [
        { name: re },
        { description: re },
        { username: re }
      ];
    }
    
    let sort = { createdAt: -1 };
    if (req.query.sort === 'popular') {
      sort = { subscribers: -1 };
    }
    
    const channels = await Channel.find(query)
      .populate('creatorId', 'username nickname avatar')
      .sort(sort)
      .skip(skip)
      .limit(limit);
    
    const channelsWithSubscription = await Promise.all(
      channels.map(async (channel) => {
        const isSubscribed = channel.subscribers.some(subId => 
          subId.equals(req.userId)
        );
        
        const recentPosts = await ChannelPost.find({ channelId: channel._id })
          .sort({ createdAt: -1 })
          .limit(2)
          .select('content');
        
        return {
          ...channel.toObject(),
          isSubscribed,
          subscriberCount: channel.subscribers.length,
          postCount: await ChannelPost.countDocuments({ channelId: channel._id }),
          recentPosts
        };
      })
    );
    
    const totalChannels = await Channel.countDocuments(query);
    
    res.json({
      success: true,
      channels: channelsWithSubscription,
      hasMore: skip + channels.length < totalChannels,
      total: totalChannels
    });
  } catch (error) {
    console.error('Get channels error:', error);
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

// Get channel stats
app.get('/api/channels/stats', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const scope = me?.university ? { university: me.university } : {};

    const totalChannels = await Channel.countDocuments(scope);

    const channels = await Channel.find(scope);
    let totalSubscribers = 0;
    channels.forEach(channel => {
      totalSubscribers += channel.subscribers.length;
    });
    
    const myChannels = await Channel.countDocuments({ creatorId: req.userId, ...scope });
    
    const subscribedChannels = await Channel.countDocuments({ 
      subscribers: req.userId,
      ...scope
    });
    
    res.json({
      success: true,
      stats: {
        totalChannels,
        totalSubscribers,
        myChannels,
        subscribedChannels
      }
    });
  } catch (error) {
    console.error('Get channel stats error:', error);
    res.status(500).json({ error: 'Failed to get channel stats' });
  }
});

// Get featured channels
app.get('/api/channels/featured', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('university').lean();
    const pipeline = [];
    if (me?.university) pipeline.push({ $match: { university: me.university } });
    const channels = await Channel.aggregate([
      ...pipeline,
      {
        $addFields: {
          subscriberCount: { $size: "$subscribers" }
        }
      },
      { $sort: { subscriberCount: -1 } },
      { $limit: 3 },
      {
        $lookup: {
          from: 'users',
          localField: 'creatorId',
          foreignField: '_id',
          as: 'creatorId'
        }
      },
      { $unwind: '$creatorId' }
    ]);
    
    res.json({
      success: true,
      channels
    });
  } catch (error) {
    console.error('Get featured channels error:', error);
    res.status(500).json({ error: 'Failed to get featured channels' });
  }
});

// Get university statistics
app.get('/api/stats/universities', authenticateToken, async (req, res) => {
  try {
    const universities = await User.aggregate([
      { $group: { _id: '$university', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);
    
    res.json({
      success: true,
      universities: universities.map(u => ({
        name: u._id || 'Not specified',
        count: u.count
      }))
    });
  } catch (error) {
    console.error('Get university stats error:', error);
    res.status(500).json({ error: 'Failed to get university stats' });
  }
});

// Save/unsave post
app.post('/api/posts/:postId/save', authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const me = await User.findById(req.userId).select('university').lean();
    
    const post = await ChannelPost.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const channel = await Channel.findById(post.channelId).select('university').lean();
    if (channel?.university && me?.university && String(channel.university) !== String(me.university)) {
      return res.status(403).json({ error: 'This post belongs to another university channel' });
    }
    
    const saved = Math.random() > 0.5;
    
    res.json({
      success: true,
      saved,
      message: saved ? 'Post saved' : 'Post removed from saved'
    });
  } catch (error) {
    console.error('Save post error:', error);
    res.status(500).json({ error: 'Failed to save post' });
  }
});

// Increment Post Views
app.post('/api/posts/:postId/view', authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    await ChannelPost.findByIdAndUpdate(postId, { $inc: { viewsCount: 1 } });
    res.json({ success: true });
  } catch (error) {
    console.error('Increment post views error:', error);
    res.status(500).json({ error: 'Failed to increment views' });
  }
});

// Get post comments
app.get('/api/posts/:postId/comments', authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ error: 'Invalid postId' });
    }

    const comments = await ChannelPostComment.find({ postId })
      .sort({ createdAt: 1 })
      .populate('userId', 'username nickname avatar');

    res.json({
      success: true,
      comments: comments.map(c => ({
        _id: c._id,
        content: c.content,
        createdAt: c.createdAt,
        user: c.userId ? {
          _id: c.userId._id,
          username: c.userId.username,
          nickname: c.userId.nickname,
          avatar: c.userId.avatar
        } : null
      }))
    });
  } catch (error) {
    console.error('Get post comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

// Add comment to post
app.post('/api/posts/:postId/comments', authenticateToken, async (req, res) => {
  try {  if (denyIfMuted(req, res)) return;

    const { postId } = req.params;
    const { content } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ error: 'Invalid postId' });
    }
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'Comment content required' });
    }

    const post = await ChannelPost.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const comment = await ChannelPostComment.create({
      postId,
      userId: req.userId,
      content: String(content).trim()
    });

    const populated = await comment.populate('userId', 'username nickname avatar');

    // Notify viewers in channel room
    try {
      io.to('channel_' + post.channelId.toString()).emit('channelPostComment:new', {
        postId: postId,
        comment: {
          _id: comment._id,
          content: comment.content,
          createdAt: comment.createdAt,
          user: populated.userId ? {
            _id: populated.userId._id,
            username: populated.userId.username,
            nickname: populated.userId.nickname,
            avatar: populated.userId.avatar
          } : null
        }
      });
    } catch (e) {}

    res.json({
      success: true,
      comment: {
        _id: comment._id,
        content: comment.content,
        createdAt: comment.createdAt,
        user: populated.userId ? {
          _id: populated.userId._id,
          username: populated.userId.username,
          nickname: populated.userId.nickname,
          avatar: populated.userId.avatar
        } : null
      }
    });
  } catch (error) {
    console.error('Add post comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});


// Cloudinary upload endpoint
app.post('/api/upload', authenticateToken, async (req, res) => {
  try {
    const { fileUrl, fileType } = req.body;
    
    res.json({ 
      success: true, 
      url: fileUrl,
      type: fileType || 'image'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Update user's online status
app.post('/api/user/status', authenticateToken, async (req, res) => {
  try {
    const { isOnline } = req.body;
    
    await User.findByIdAndUpdate(req.userId, { 
      isOnline: isOnline,
      lastSeen: Date.now()
    });
    
    const socketId = getUserSocketId(req.userId);
    if (socketId) {
      io.emit('userOnline', req.userId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});


// Public Post Permalink (Open Graph preview)
app.get('/post/:postId', async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await ChannelPost.findById(postId).populate('channelId', 'name username avatar coverBanner isPublic');
    if (!post) return res.status(404).send('Post not found');

    const channel = post.channelId;
    if (channel && channel.isPublic === false) {
      return res.status(403).send('This channel is private');
    }

    const origin = (process.env.PUBLIC_ORIGIN || (req.protocol + '://' + req.get('host')));
    const url = origin + '/post/' + postId;
    const title = (post.title && post.title.trim()) ? post.title.trim() : (channel?.name ? `${channel.name} post` : 'Channel post');
    const descRaw = (post.content || '').replace(/\s+/g,' ').trim();
    const description = descRaw.length > 180 ? descRaw.slice(0, 177) + '...' : descRaw || 'View post';
    const image = post.mediaType === 'image' && post.mediaUrl ? post.mediaUrl : (channel?.coverBanner || channel?.avatar || '');

    // Basic HTML with OG tags
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<link rel="canonical" href="${escapeAttr(url)}"/>
<meta property="og:type" content="article"/>
<meta property="og:title" content="${escapeAttr(title)}"/>
<meta property="og:description" content="${escapeAttr(description)}"/>
<meta property="og:url" content="${escapeAttr(url)}"/>
${image ? `<meta property="og:image" content="${escapeAttr(image)}"/>` : ``}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}"/>
<meta name="twitter:title" content="${escapeAttr(title)}"/>
<meta name="twitter:description" content="${escapeAttr(description)}"/>
${image ? `<meta name="twitter:image" content="${escapeAttr(image)}"/>` : ``}
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b1220;color:#e5e7eb;margin:0;padding:24px;}
  .wrap{max-width:860px;margin:0 auto;}
  .card{background:#111827;border:1px solid #1f2937;border-radius:14px;padding:18px;}
  .meta{color:#9ca3af;font-size:13px;margin-bottom:10px}
  .btn{display:inline-block;margin-top:14px;background:#2563eb;color:white;padding:10px 14px;border-radius:10px;text-decoration:none}
  img{max-width:100%;border-radius:12px;margin-top:14px}
  .title{font-size:20px;font-weight:700;margin:0 0 10px}
  .content{white-space:pre-wrap;line-height:1.5}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="meta">${escapeHtml(channel?.name || 'Channel')} • ${new Date(post.createdAt).toLocaleString()}</div>
    <h1 class="title">${escapeHtml(title)}</h1>
    <div class="content">${escapeHtml(post.content || '')}</div>
    ${post.mediaUrl ? (post.mediaType === 'image' ? `<img src="${escapeAttr(post.mediaUrl)}" alt="post media"/>` :
      `<div class="meta" style="margin-top:14px">Media: <a href="${escapeAttr(post.mediaUrl)}" style="color:#93c5fd">open</a></div>`) : ``}
    <a class="btn" href="/channel.html?channelId=${channel?._id || ''}&postId=${postId}">Open in app</a>
  </div>
</div>
</body>
</html>`);
  } catch (error) {
    console.error('Public permalink error:', error);
    res.status(500).send('Server error');
  }
});

// Escape helpers for permalink HTML
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}
function escapeAttr(str) { return escapeHtml(str); }

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: Date.now(),
    onlineUsers: onlineUsers.size,
    connectedSockets: io.engine.clientsCount
  });
});


// Get server stats
app.get('/api/server/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await Stats.findOne();
    
    res.json({
      success: true,
      stats: {
        ...stats.toObject(),
        onlineUsers: onlineUsers.size,
        connectedSockets: io.engine.clientsCount,
        uptime: process.uptime()
      }
    });
  } catch (error) {
    console.error('Get server stats error:', error);
    res.status(500).json({ error: 'Failed to get server stats' });
  }
});






// ==================== UNIVERSITY CATALOG ROUTES ====================
// Public: universities list + faculties list (used by register page)
app.get('/api/catalog/universities', async (req, res) => {
  try {
    const list = await UniversityCatalog.find({}).sort({ name: 1 }).lean();
    res.json({ success: true, universities: list.map(u => ({ name: u.name })) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load universities' });
  }
});
app.get('/api/catalog/faculties', async (req, res) => {
  try {
    const uni = String(req.query.university || '').trim();
    if (!uni) return res.json({ success: true, faculties: [] });
    const doc = await UniversityCatalog.findOne({ name: uni }).lean();
    res.json({ success: true, faculties: doc?.faculties || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load faculties' });
  }
});
app.get('/api/catalog/study-types', async (req, res) => {
  try {
    const university = cleanText(req.query.university, 180);
    const faculty = cleanText(req.query.faculty, 180);
    const q = cleanText(req.query.q, 120);

    if (!university || !faculty) {
      return res.json({ success: true, studyTypes: [] });
    }

    const filter = { university, faculty };
    if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
    const list = await StudyTypeCatalog.find(filter).sort({ name: 1 }).limit(500).lean();
    res.json({
      success: true,
      studyTypes: list.map((x) => ({ _id: x._id, name: x.name, faculty: x.faculty }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load study types' });
  }
});
app.get('/api/catalog/study-groups', async (req, res) => {
  try {
    const university = cleanText(req.query.university, 180);
    const faculty = cleanText(req.query.faculty, 180);
    const studyType = cleanText(req.query.studyType, 80);
    const q = cleanText(req.query.q, 120);

    if (!university || !faculty || !studyType) {
      return res.json({ success: true, studyGroups: [] });
    }

    const filter = { university, faculty, studyType };
    if (q) {
      filter.name = { $regex: escapeRegex(q), $options: 'i' };
    }

    const list = await StudyGroupCatalog.find(filter).sort({ name: 1 }).limit(2000).lean();
    res.json({
      success: true,
      studyGroups: list.map((x) => ({ _id: x._id, name: x.name, faculty: x.faculty, studyType: x.studyType }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load study groups' });
  }
});
app.get('/api/catalog/programs', async (req, res) => {
  try {
    const university = String(req.query.university || '').trim();
    const faculty = String(req.query.faculty || '').trim();
    const q = String(req.query.q || '').trim();
    const filter = {};
    if (university) filter.university = university;
    if (faculty) filter.faculty = faculty;
    if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    const list = await ProgramCatalog.find(filter).sort({ name: 1 }).limit(500).lean();
    res.json({ success: true, programs: list.map(p => ({ code: p.code, name: p.name, faculty: p.faculty })) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load programs' });
  }
});



// Admin: manage catalog
app.post('/api/admin/catalog/universities', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    await UniversityCatalog.updateOne({ name }, { $setOnInsert: { name, faculties: [] } }, { upsert: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add university' });
  }
});
app.post('/api/admin/catalog/faculties', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const uni = String(req.body.university || '').trim();
    const faculty = String(req.body.faculty || '').trim();
    if (!uni || !faculty) return res.status(400).json({ error: 'university and faculty required' });
    await UniversityCatalog.updateOne({ name: uni }, { $addToSet: { faculties: faculty } }, { upsert: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add faculty' });
  }
});

// Admin: full catalog CRUD (universities/faculties/programs)
app.get('/api/admin/catalog/universities', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = q
      ? { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      : {};
    const list = await UniversityCatalog.find(filter).sort({ name: 1 }).limit(1000).lean();
    res.json({ success: true, universities: list });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load universities' });
  }
});

app.patch('/api/admin/catalog/universities/:name', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const oldName = decodeURIComponent(String(req.params.name || '')).trim();
    const newName = String(req.body.name || '').trim();
    if (!oldName || !newName) return res.status(400).json({ error: 'name required' });
    if (oldName === newName) return res.json({ success: true });

    const exists = await UniversityCatalog.findOne({ name: newName }).lean();
    if (exists) return res.status(409).json({ error: 'University already exists' });

    const uni = await UniversityCatalog.findOne({ name: oldName });
    if (!uni) return res.status(404).json({ error: 'University not found' });
    uni.name = newName;
    await uni.save();

    // best-effort: update users + groups/channels + live sessions + program catalog
    await Promise.all([
      User.updateMany({ university: oldName }, { $set: { university: newName } }).catch(() => {}),
      Group.updateMany({ university: oldName }, { $set: { university: newName } }).catch(() => {}),
      Channel.updateMany({ university: oldName }, { $set: { university: newName } }).catch(() => {}),
      LiveSession.updateMany({ university: oldName }, { $set: { university: newName } }).catch(() => {}),
      ProgramCatalog.updateMany({ university: oldName }, { $set: { university: newName } }).catch(() => {}),
      StudyTypeCatalog.updateMany({ university: oldName }, { $set: { university: newName } }).catch(() => {}),
      StudyGroupCatalog.updateMany({ university: oldName }, { $set: { university: newName } }).catch(() => {})
    ]);

    res.json({ success: true });
  } catch (e) {
    console.error('PATCH /api/admin/catalog/universities/:name error:', e);
    res.status(500).json({ error: 'Failed to update university' });
  }
});

app.delete('/api/admin/catalog/universities/:name', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const name = decodeURIComponent(String(req.params.name || '')).trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    await UniversityCatalog.deleteOne({ name });
    await ProgramCatalog.deleteMany({ university: name }).catch(() => {});
    await StudyTypeCatalog.deleteMany({ university: name }).catch(() => {});
    await StudyGroupCatalog.deleteMany({ university: name }).catch(() => {});
    // Do NOT auto-delete users; keep their profile value as-is.
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete university' });
  }
});

app.get('/api/admin/catalog/faculties', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const uni = String(req.query.university || '').trim();
    if (!uni) return res.json({ success: true, faculties: [] });
    const doc = await UniversityCatalog.findOne({ name: uni }).lean();
    res.json({ success: true, faculties: doc?.faculties || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load faculties' });
  }
});

app.delete('/api/admin/catalog/faculties', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const uni = String(req.body.university || '').trim();
    const faculty = String(req.body.faculty || '').trim();
    if (!uni || !faculty) return res.status(400).json({ error: 'university and faculty required' });
    await UniversityCatalog.updateOne({ name: uni }, { $pull: { faculties: faculty } });
    // best-effort: remove programs under this faculty
    await ProgramCatalog.deleteMany({ university: uni, faculty }).catch(() => {});
    await StudyTypeCatalog.deleteMany({ university: uni, faculty }).catch(() => {});
    await StudyGroupCatalog.deleteMany({ university: uni, faculty }).catch(() => {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete faculty' });
  }
});

app.patch('/api/admin/catalog/faculties', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const uni = String(req.body.university || '').trim();
    const oldFaculty = String(req.body.oldFaculty || req.body.from || '').trim();
    const newFaculty = String(req.body.newFaculty || req.body.to || '').trim();
    if (!uni || !oldFaculty || !newFaculty) {
      return res.status(400).json({ error: 'university, oldFaculty, newFaculty required' });
    }
    if (oldFaculty === newFaculty) return res.json({ success: true });

    const doc = await UniversityCatalog.findOne({ name: uni });
    if (!doc) return res.status(404).json({ error: 'University not found' });

    const faculties = Array.isArray(doc.faculties) ? doc.faculties.map((x) => String(x || '').trim()) : [];
    const hasOld = faculties.some((f) => f.toLowerCase() === oldFaculty.toLowerCase());
    if (!hasOld) return res.status(404).json({ error: 'Faculty not found' });
    const hasNew = faculties.some((f) => f.toLowerCase() === newFaculty.toLowerCase());
    if (hasNew) return res.status(409).json({ error: 'New faculty already exists' });

    doc.faculties = faculties.map((f) => (f.toLowerCase() === oldFaculty.toLowerCase() ? newFaculty : f));
    await doc.save();

    await Promise.all([
      User.updateMany({ university: uni, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      Group.updateMany({ university: uni, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      ProgramCatalog.updateMany({ university: uni, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      StudyTypeCatalog.updateMany({ university: uni, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      StudyGroupCatalog.updateMany({ university: uni, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      LiveSession.updateMany({ university: uni, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {})
    ]);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to rename faculty' });
  }
});

// Admin programs CRUD
app.get('/api/admin/catalog/programs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const university = String(req.query.university || '').trim();
    const faculty = String(req.query.faculty || '').trim();
    const q = String(req.query.q || '').trim();
    const filter = {};
    if (university) filter.university = university;
    if (faculty) filter.faculty = faculty;
    if (q) {
      const re = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      filter.$or = [{ name: re }, { code: re }];
    }
    const list = await ProgramCatalog.find(filter).sort({ university: 1, faculty: 1, name: 1 }).limit(2000).lean();
    res.json({ success: true, programs: list });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load programs' });
  }
});

app.post('/api/admin/catalog/programs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const universityRaw = String(req.body.university || '').trim();
    const facultyRaw = String(req.body.faculty || '').trim();
    const code = String(req.body.code || '').trim();
    const name = String(req.body.name || '').trim();
    if (!universityRaw || !facultyRaw || !name) return res.status(400).json({ error: 'university, faculty, name required' });

    const uniDoc = await findUniversityDocInsensitive(universityRaw);
    if (!uniDoc) return res.status(400).json({ error: 'Unknown university. Choose from the list.' });
    const faculty = pickCanonicalFaculty(uniDoc, facultyRaw);
    if (!faculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });

    const doc = await ProgramCatalog.create({ university: uniDoc.name, faculty, code, name });
    res.status(201).json({ success: true, program: doc });
  } catch (e) {
    console.error('POST /api/admin/catalog/programs error:', e);
    res.status(500).json({ error: 'Failed to add program' });
  }
});

app.patch('/api/admin/catalog/programs/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const patch = {};
    const current = await ProgramCatalog.findById(id).lean();
    if (!current) return res.status(404).json({ error: 'Program not found' });

    const nextUniversityRaw = req.body.university !== undefined ? String(req.body.university || '').trim() : String(current.university || '').trim();
    const nextFacultyRaw = req.body.faculty !== undefined ? String(req.body.faculty || '').trim() : String(current.faculty || '').trim();

    const uniDoc = await findUniversityDocInsensitive(nextUniversityRaw);
    if (!uniDoc) return res.status(400).json({ error: 'Unknown university. Choose from the list.' });
    const faculty = pickCanonicalFaculty(uniDoc, nextFacultyRaw);
    if (!faculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });

    patch.university = uniDoc.name;
    patch.faculty = faculty;
    if (req.body.code !== undefined) patch.code = String(req.body.code || '').trim();
    if (req.body.name !== undefined) patch.name = String(req.body.name || '').trim();

    const doc = await ProgramCatalog.findByIdAndUpdate(id, { $set: patch }, { new: true });
    res.json({ success: true, program: doc });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update program' });
  }
});

app.delete('/api/admin/catalog/programs/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    await ProgramCatalog.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete program' });
  }
});

// Admin study-types CRUD
app.get('/api/admin/catalog/study-types', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const universityRaw = cleanText(req.query.university, 180);
    const facultyRaw = cleanText(req.query.faculty, 180);
    const q = cleanText(req.query.q, 120);
    const filter = {};

    if (universityRaw) {
      const uniDoc = await findUniversityDocInsensitive(universityRaw);
      if (!uniDoc) return res.json({ success: true, studyTypes: [] });
      filter.university = cleanText(uniDoc.name, 180);
      if (facultyRaw) {
        const canonicalFaculty = pickCanonicalFaculty(uniDoc, facultyRaw);
        if (!canonicalFaculty) return res.json({ success: true, studyTypes: [] });
        filter.faculty = canonicalFaculty;
      }
    } else if (facultyRaw) {
      filter.faculty = facultyRaw;
    }

    if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
    const list = await StudyTypeCatalog.find(filter)
      .sort({ university: 1, faculty: 1, name: 1 })
      .limit(3000)
      .lean();
    res.json({ success: true, studyTypes: list });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load study types' });
  }
});

app.post('/api/admin/catalog/study-types', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const universityRaw = cleanText(req.body?.university, 180);
    const facultyRaw = cleanText(req.body?.faculty, 180);
    const name = cleanText(req.body?.name || req.body?.studyType, 80);
    if (!universityRaw || !facultyRaw || !name) {
      return res.status(400).json({ error: 'university, faculty, name required' });
    }

    const uniDoc = await findUniversityDocInsensitive(universityRaw);
    if (!uniDoc) return res.status(400).json({ error: 'Unknown university. Choose from the list.' });
    const university = cleanText(uniDoc.name, 180);
    const faculty = pickCanonicalFaculty(uniDoc, facultyRaw);
    if (!faculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });

    const exists = await StudyTypeCatalog.findOne({
      university,
      faculty,
      name: new RegExp(`^${escapeRegex(name)}$`, 'i')
    }).lean();
    if (exists) return res.status(409).json({ error: 'Study type already exists' });

    const created = await StudyTypeCatalog.create({ university, faculty, name });
    res.status(201).json({ success: true, studyType: created });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Study type already exists' });
    res.status(500).json({ error: 'Failed to add study type' });
  }
});

app.patch('/api/admin/catalog/study-types/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    const existing = await StudyTypeCatalog.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Study type not found' });

    const nextUniversityRaw = req.body?.university !== undefined
      ? cleanText(req.body.university, 180)
      : cleanText(existing.university, 180);
    const nextFacultyRaw = req.body?.faculty !== undefined
      ? cleanText(req.body.faculty, 180)
      : cleanText(existing.faculty, 180);
    const nextName = req.body?.name !== undefined
      ? cleanText(req.body.name, 80)
      : cleanText(existing.name, 80);
    if (!nextUniversityRaw || !nextFacultyRaw || !nextName) {
      return res.status(400).json({ error: 'university, faculty, name required' });
    }

    const uniDoc = await findUniversityDocInsensitive(nextUniversityRaw);
    if (!uniDoc) return res.status(400).json({ error: 'Unknown university. Choose from the list.' });
    const university = cleanText(uniDoc.name, 180);
    const faculty = pickCanonicalFaculty(uniDoc, nextFacultyRaw);
    if (!faculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });

    const duplicate = await StudyTypeCatalog.findOne({
      _id: { $ne: id },
      university,
      faculty,
      name: new RegExp(`^${escapeRegex(nextName)}$`, 'i')
    }).lean();
    if (duplicate) return res.status(409).json({ error: 'Study type already exists' });

    const updated = await StudyTypeCatalog.findByIdAndUpdate(
      id,
      { $set: { university, faculty, name: nextName } },
      { new: true }
    ).lean();

    const oldUniversity = cleanText(existing.university, 180);
    const oldFaculty = cleanText(existing.faculty, 180);
    const oldName = cleanText(existing.name, 80);
    if (oldUniversity !== university || oldFaculty !== faculty || oldName !== nextName) {
      await Promise.all([
        StudyGroupCatalog.updateMany(
          { university: oldUniversity, faculty: oldFaculty, studyType: oldName },
          { $set: { university, faculty, studyType: nextName } }
        ).catch(() => {}),
        User.updateMany(
          { university: oldUniversity, faculty: oldFaculty, studyType: oldName },
          { $set: { university, faculty, studyType: nextName } }
        ).catch(() => {}),
        Group.updateMany(
          { university: oldUniversity, faculty: oldFaculty, studyType: oldName },
          { $set: { university, faculty, studyType: nextName } }
        ).catch(() => {})
      ]);
    }

    res.json({ success: true, studyType: updated });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Study type already exists' });
    res.status(500).json({ error: 'Failed to update study type' });
  }
});

app.delete('/api/admin/catalog/study-types/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    const existing = await StudyTypeCatalog.findById(id).lean();
    if (existing) {
      await StudyGroupCatalog.deleteMany({
        university: cleanText(existing.university, 180),
        faculty: cleanText(existing.faculty, 180),
        studyType: cleanText(existing.name, 80)
      }).catch(() => {});
    }
    await StudyTypeCatalog.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete study type' });
  }
});

// Admin study-groups CRUD
app.get('/api/admin/catalog/study-groups', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const universityRaw = cleanText(req.query.university, 180);
    const facultyRaw = cleanText(req.query.faculty, 180);
    const studyTypeRaw = cleanText(req.query.studyType, 80);
    const q = cleanText(req.query.q, 120);
    const filter = {};

    if (universityRaw) {
      const uniDoc = await findUniversityDocInsensitive(universityRaw);
      if (!uniDoc) return res.json({ success: true, studyGroups: [] });
      filter.university = String(uniDoc.name || '').trim();

      if (facultyRaw) {
        const canonicalFaculty = pickCanonicalFaculty(uniDoc, facultyRaw);
        if (!canonicalFaculty) return res.json({ success: true, studyGroups: [] });
        filter.faculty = canonicalFaculty;
      }
      if (studyTypeRaw && filter.faculty) {
        const canonicalStudyType = await pickCanonicalStudyType(filter.university, filter.faculty, studyTypeRaw);
        if (!canonicalStudyType) return res.json({ success: true, studyGroups: [] });
        filter.studyType = canonicalStudyType;
      } else if (studyTypeRaw) {
        filter.studyType = studyTypeRaw;
      }
    } else if (facultyRaw) {
      filter.faculty = facultyRaw;
      if (studyTypeRaw) filter.studyType = studyTypeRaw;
    } else if (studyTypeRaw) {
      filter.studyType = studyTypeRaw;
    }

    if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

    const list = await StudyGroupCatalog.find(filter)
      .sort({ university: 1, faculty: 1, studyType: 1, name: 1 })
      .limit(5000)
      .lean();

    res.json({ success: true, studyGroups: list });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load study groups' });
  }
});

app.post('/api/admin/catalog/study-groups', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const universityRaw = cleanText(req.body?.university, 180);
    const facultyRaw = cleanText(req.body?.faculty, 180);
    const studyTypeRaw = cleanText(req.body?.studyType, 80);
    const name = cleanText(req.body?.name || req.body?.studyGroup, 80);
    if (!universityRaw || !facultyRaw || !studyTypeRaw || !name) {
      return res.status(400).json({ error: 'university, faculty, studyType, name required' });
    }

    const uniDoc = await findUniversityDocInsensitive(universityRaw);
    if (!uniDoc) return res.status(400).json({ error: 'Unknown university. Choose from the list.' });
    const university = cleanText(uniDoc.name, 180);
    const faculty = pickCanonicalFaculty(uniDoc, facultyRaw);
    if (!faculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });
    const studyType = await pickCanonicalStudyType(university, faculty, studyTypeRaw);
    if (!studyType) return res.status(400).json({ error: 'Unknown study type for selected university and faculty' });

    const exists = await StudyGroupCatalog.findOne({
      university,
      faculty,
      studyType,
      name: new RegExp(`^${escapeRegex(name)}$`, 'i')
    }).lean();
    if (exists) return res.status(409).json({ error: 'Study group already exists' });

    const created = await StudyGroupCatalog.create({ university, faculty, studyType, name });
    res.status(201).json({ success: true, studyGroup: created });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Study group already exists' });
    res.status(500).json({ error: 'Failed to add study group' });
  }
});

app.patch('/api/admin/catalog/study-groups/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    const existing = await StudyGroupCatalog.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Study group not found' });

    const nextUniversityRaw = req.body?.university !== undefined
      ? cleanText(req.body.university, 180)
      : cleanText(existing.university, 180);
    const nextFacultyRaw = req.body?.faculty !== undefined
      ? cleanText(req.body.faculty, 180)
      : cleanText(existing.faculty, 180);
    const nextStudyTypeRaw = req.body?.studyType !== undefined
      ? cleanText(req.body.studyType, 80)
      : cleanText(existing.studyType, 80);
    const nextName = req.body?.name !== undefined
      ? cleanText(req.body.name, 80)
      : cleanText(existing.name, 80);

    if (!nextUniversityRaw || !nextFacultyRaw || !nextStudyTypeRaw || !nextName) {
      return res.status(400).json({ error: 'university, faculty, studyType, name required' });
    }

    const uniDoc = await findUniversityDocInsensitive(nextUniversityRaw);
    if (!uniDoc) return res.status(400).json({ error: 'Unknown university. Choose from the list.' });
    const university = cleanText(uniDoc.name, 180);
    const faculty = pickCanonicalFaculty(uniDoc, nextFacultyRaw);
    if (!faculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });
    const studyType = await pickCanonicalStudyType(university, faculty, nextStudyTypeRaw);
    if (!studyType) return res.status(400).json({ error: 'Unknown study type for selected university and faculty' });

    const duplicate = await StudyGroupCatalog.findOne({
      _id: { $ne: id },
      university,
      faculty,
      studyType,
      name: new RegExp(`^${escapeRegex(nextName)}$`, 'i')
    }).lean();
    if (duplicate) return res.status(409).json({ error: 'Study group already exists' });

    const updated = await StudyGroupCatalog.findByIdAndUpdate(
      id,
      { $set: { university, faculty, studyType, name: nextName } },
      { new: true }
    ).lean();

    const oldUniversity = cleanText(existing.university, 180);
    const oldFaculty = cleanText(existing.faculty, 180);
    const oldStudyType = cleanText(existing.studyType, 80);
    const oldName = cleanText(existing.name, 80);
    if (oldUniversity !== university || oldFaculty !== faculty || oldStudyType !== studyType || oldName !== nextName) {
      await Promise.all([
        User.updateMany(
          { university: oldUniversity, faculty: oldFaculty, studyType: oldStudyType, studyGroup: oldName },
          { $set: { university, faculty, studyType, studyGroup: nextName } }
        ).catch(() => {}),
        Group.updateMany(
          { university: oldUniversity, faculty: oldFaculty, studyType: oldStudyType, studyGroup: oldName },
          { $set: { university, faculty, studyType, studyGroup: nextName } }
        ).catch(() => {})
      ]);
    }

    res.json({ success: true, studyGroup: updated });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Study group already exists' });
    res.status(500).json({ error: 'Failed to update study group' });
  }
});

app.delete('/api/admin/catalog/study-groups/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    await StudyGroupCatalog.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete study group' });
  }
});

// Organizer (limited admin) routes: scoped by organizer university
app.get('/api/organizer/me', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  const scoped = await resolveScopedUniversity(req, req.query.university);
  if (!scoped.ok) return res.status(400).json({ error: scoped.error });
  const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
  if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
  return res.json({
    success: true,
    scope: {
      role: req.scopeUser?.role || 'organizer',
      university: scoped.university,
      faculty: facultyScope.faculty || '',
      studyType: req.scopeUser?.studyType || '',
      studyGroup: req.scopeUser?.studyGroup || ''
    }
  });
});

app.get('/api/organizer/overview', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const university = scoped.university;
    const base = { university };
    if (facultyScope.faculty) base.faculty = facultyScope.faculty;

    const [users, groups, channels, programs, studyTypes, studyGroups] = await Promise.all([
      User.countDocuments(base),
      Group.countDocuments(base),
      Channel.countDocuments(base),
      ProgramCatalog.countDocuments(base),
      StudyTypeCatalog.countDocuments(base),
      StudyGroupCatalog.countDocuments(base)
    ]);

    res.json({
      success: true,
      overview: {
        university,
        faculty: facultyScope.faculty || '',
        users,
        groups,
        channels,
        programs,
        studyTypes,
        studyGroups
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load organizer overview' });
  }
});

app.get('/api/organizer/catalog/faculties', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const doc = await UniversityCatalog.findOne({ name: scoped.university }).lean();
    const all = Array.isArray(doc?.faculties) ? doc.faculties : [];
    const faculties = facultyScope.isAdmin
      ? all
      : (facultyScope.faculty ? [facultyScope.faculty] : []);
    res.json({ success: true, university: scoped.university, faculties });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load faculties' });
  }
});

app.post('/api/organizer/catalog/faculties', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    if (!isScopedAdminUser(req.scopeUser)) {
      return res.status(403).json({ error: 'Organizer can manage only own faculty data' });
    }
    const faculty = cleanText(req.body?.faculty, 180);
    if (!faculty) return res.status(400).json({ error: 'faculty required' });
    await UniversityCatalog.updateOne({ name: scoped.university }, { $addToSet: { faculties: faculty } }, { upsert: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add faculty' });
  }
});

app.patch('/api/organizer/catalog/faculties', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.body?.oldFaculty || req.body?.from);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    if (!facultyScope.isAdmin) return res.status(403).json({ error: 'Organizer can manage only own faculty data' });
    const oldFaculty = cleanText(req.body?.oldFaculty || req.body?.from, 180);
    const newFaculty = cleanText(req.body?.newFaculty || req.body?.to, 180);
    if (!oldFaculty || !newFaculty) return res.status(400).json({ error: 'oldFaculty and newFaculty required' });
    if (oldFaculty === newFaculty) return res.json({ success: true });

    const doc = await UniversityCatalog.findOne({ name: scoped.university });
    if (!doc) return res.status(404).json({ error: 'University not found' });
    const faculties = Array.isArray(doc.faculties) ? doc.faculties.map((x) => String(x || '').trim()) : [];
    const hasOld = faculties.some((f) => f.toLowerCase() === oldFaculty.toLowerCase());
    if (!hasOld) return res.status(404).json({ error: 'Faculty not found' });
    const hasNew = faculties.some((f) => f.toLowerCase() === newFaculty.toLowerCase());
    if (hasNew) return res.status(409).json({ error: 'New faculty already exists' });

    doc.faculties = faculties.map((f) => (f.toLowerCase() === oldFaculty.toLowerCase() ? newFaculty : f));
    await doc.save();

    await Promise.all([
      User.updateMany({ university: scoped.university, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      Group.updateMany({ university: scoped.university, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      ProgramCatalog.updateMany({ university: scoped.university, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      StudyTypeCatalog.updateMany({ university: scoped.university, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      StudyGroupCatalog.updateMany({ university: scoped.university, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {}),
      LiveSession.updateMany({ university: scoped.university, faculty: oldFaculty }, { $set: { faculty: newFaculty } }).catch(() => {})
    ]);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to rename faculty' });
  }
});

app.delete('/api/organizer/catalog/faculties', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.body?.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    if (!facultyScope.isAdmin) return res.status(403).json({ error: 'Organizer can manage only own faculty data' });
    const faculty = cleanText(req.body?.faculty, 180);
    if (!faculty) return res.status(400).json({ error: 'faculty required' });
    await UniversityCatalog.updateOne({ name: scoped.university }, { $pull: { faculties: faculty } });
    await ProgramCatalog.deleteMany({ university: scoped.university, faculty }).catch(() => {});
    await StudyTypeCatalog.deleteMany({ university: scoped.university, faculty }).catch(() => {});
    await StudyGroupCatalog.deleteMany({ university: scoped.university, faculty }).catch(() => {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete faculty' });
  }
});

app.get('/api/organizer/catalog/programs', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const q = cleanText(req.query.q, 180);
    const filter = { university: scoped.university };
    if (facultyScope.faculty) filter.faculty = facultyScope.faculty;
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: re }, { code: re }];
    }
    const list = await ProgramCatalog.find(filter).sort({ faculty: 1, name: 1 }).limit(2000).lean();
    res.json({ success: true, programs: list, university: scoped.university });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load programs' });
  }
});

app.post('/api/organizer/catalog/programs', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.body?.faculty, { requireForAdmin: true });
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const faculty = cleanText(facultyScope.faculty, 180);
    const code = cleanText(req.body?.code, 80);
    const name = cleanText(req.body?.name, 180);
    if (!faculty || !name) return res.status(400).json({ error: 'faculty and name required' });

    const uniDoc = await UniversityCatalog.findOne({ name: scoped.university }).lean();
    const canonicalFaculty = pickCanonicalFaculty(uniDoc, faculty);
    if (!canonicalFaculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });

    const doc = await ProgramCatalog.create({ university: scoped.university, faculty: canonicalFaculty, code, name });
    res.status(201).json({ success: true, program: doc });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Program already exists' });
    res.status(500).json({ error: 'Failed to add program' });
  }
});

app.patch('/api/organizer/catalog/programs/:id', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    const scoped = await resolveScopedUniversity(req, req.body?.university || req.query?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.body?.faculty || req.query?.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });

    const existing = await ProgramCatalog.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Program not found' });
    if (String(existing.university || '') !== String(scoped.university)) {
      return res.status(403).json({ error: 'Program belongs to another university' });
    }
    if (!facultyScope.isAdmin && String(existing.faculty || '').toLowerCase() !== String(facultyScope.faculty || '').toLowerCase()) {
      return res.status(403).json({ error: 'Program belongs to another faculty' });
    }

    const patch = {};
    const uniDoc = await UniversityCatalog.findOne({ name: scoped.university }).lean();
    if (facultyScope.isAdmin && req.body?.faculty !== undefined) {
      const canonicalFaculty = pickCanonicalFaculty(uniDoc, req.body.faculty);
      if (!canonicalFaculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });
      patch.faculty = canonicalFaculty;
    } else if (!facultyScope.isAdmin) {
      const canonicalScopedFaculty = pickCanonicalFaculty(uniDoc, facultyScope.faculty) || facultyScope.faculty;
      patch.faculty = canonicalScopedFaculty;
    }
    if (req.body?.code !== undefined) patch.code = cleanText(req.body.code, 80);
    if (req.body?.name !== undefined) patch.name = cleanText(req.body.name, 180);
    patch.university = scoped.university;

    const doc = await ProgramCatalog.findByIdAndUpdate(id, { $set: patch }, { new: true });
    res.json({ success: true, program: doc });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Program already exists' });
    res.status(500).json({ error: 'Failed to update program' });
  }
});

app.delete('/api/organizer/catalog/programs/:id', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    const scoped = await resolveScopedUniversity(req, req.query?.university || req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query?.faculty || req.body?.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const existing = await ProgramCatalog.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Program not found' });
    if (String(existing.university || '') !== String(scoped.university)) {
      return res.status(403).json({ error: 'Program belongs to another university' });
    }
    if (!facultyScope.isAdmin && String(existing.faculty || '').toLowerCase() !== String(facultyScope.faculty || '').toLowerCase()) {
      return res.status(403).json({ error: 'Program belongs to another faculty' });
    }
    await ProgramCatalog.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete program' });
  }
});

app.get('/api/organizer/catalog/study-types', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const uniDoc = await UniversityCatalog.findOne({ name: scoped.university }).lean();
    const q = cleanText(req.query.q, 120);

    const filter = { university: scoped.university };
    if (facultyScope.faculty) {
      const canonicalFaculty = pickCanonicalFaculty(uniDoc, facultyScope.faculty);
      if (!canonicalFaculty) return res.json({ success: true, studyTypes: [], university: scoped.university });
      filter.faculty = canonicalFaculty;
    }
    if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

    const list = await StudyTypeCatalog.find(filter).sort({ faculty: 1, name: 1 }).limit(3000).lean();
    res.json({ success: true, studyTypes: list, university: scoped.university });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load study types' });
  }
});

app.post('/api/organizer/catalog/study-types', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.body?.faculty, { requireForAdmin: true });
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const facultyRaw = cleanText(facultyScope.faculty, 180);
    const name = cleanText(req.body?.name || req.body?.studyType, 80);
    if (!facultyRaw || !name) return res.status(400).json({ error: 'faculty and name required' });

    const uniDoc = await UniversityCatalog.findOne({ name: scoped.university }).lean();
    const canonicalFaculty = pickCanonicalFaculty(uniDoc, facultyRaw);
    if (!canonicalFaculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });

    const exists = await StudyTypeCatalog.findOne({
      university: scoped.university,
      faculty: canonicalFaculty,
      name: new RegExp(`^${escapeRegex(name)}$`, 'i')
    }).lean();
    if (exists) return res.status(409).json({ error: 'Study type already exists' });

    const created = await StudyTypeCatalog.create({
      university: scoped.university,
      faculty: canonicalFaculty,
      name
    });
    res.status(201).json({ success: true, studyType: created });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Study type already exists' });
    res.status(500).json({ error: 'Failed to add study type' });
  }
});

app.patch('/api/organizer/catalog/study-types/:id', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    const scoped = await resolveScopedUniversity(req, req.body?.university || req.query?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.body?.faculty || req.query?.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });

    const existing = await StudyTypeCatalog.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Study type not found' });
    if (String(existing.university || '') !== String(scoped.university)) {
      return res.status(403).json({ error: 'Study type belongs to another university' });
    }
    if (!facultyScope.isAdmin && String(existing.faculty || '').toLowerCase() !== String(facultyScope.faculty || '').toLowerCase()) {
      return res.status(403).json({ error: 'Study type belongs to another faculty' });
    }

    const uniDoc = await UniversityCatalog.findOne({ name: scoped.university }).lean();
    const nextFacultyRaw = facultyScope.isAdmin
      ? (req.body?.faculty !== undefined
        ? cleanText(req.body.faculty, 180)
        : cleanText(existing.faculty, 180))
      : cleanText(facultyScope.faculty, 180);
    const nextName = req.body?.name !== undefined
      ? cleanText(req.body.name, 80)
      : cleanText(existing.name, 80);
    if (!nextFacultyRaw || !nextName) return res.status(400).json({ error: 'faculty and name required' });

    const canonicalFaculty = pickCanonicalFaculty(uniDoc, nextFacultyRaw);
    if (!canonicalFaculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });

    const duplicate = await StudyTypeCatalog.findOne({
      _id: { $ne: id },
      university: scoped.university,
      faculty: canonicalFaculty,
      name: new RegExp(`^${escapeRegex(nextName)}$`, 'i')
    }).lean();
    if (duplicate) return res.status(409).json({ error: 'Study type already exists' });

    const updated = await StudyTypeCatalog.findByIdAndUpdate(
      id,
      { $set: { university: scoped.university, faculty: canonicalFaculty, name: nextName } },
      { new: true }
    ).lean();

    const oldFaculty = cleanText(existing.faculty, 180);
    const oldName = cleanText(existing.name, 80);
    if (oldFaculty !== canonicalFaculty || oldName !== nextName) {
      await Promise.all([
        StudyGroupCatalog.updateMany(
          { university: scoped.university, faculty: oldFaculty, studyType: oldName },
          { $set: { faculty: canonicalFaculty, studyType: nextName } }
        ).catch(() => {}),
        User.updateMany(
          { university: scoped.university, faculty: oldFaculty, studyType: oldName },
          { $set: { faculty: canonicalFaculty, studyType: nextName } }
        ).catch(() => {}),
        Group.updateMany(
          { university: scoped.university, faculty: oldFaculty, studyType: oldName },
          { $set: { faculty: canonicalFaculty, studyType: nextName } }
        ).catch(() => {})
      ]);
    }

    res.json({ success: true, studyType: updated });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Study type already exists' });
    res.status(500).json({ error: 'Failed to update study type' });
  }
});

app.delete('/api/organizer/catalog/study-types/:id', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    const scoped = await resolveScopedUniversity(req, req.query?.university || req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query?.faculty || req.body?.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const existing = await StudyTypeCatalog.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Study type not found' });
    if (String(existing.university || '') !== String(scoped.university)) {
      return res.status(403).json({ error: 'Study type belongs to another university' });
    }
    if (!facultyScope.isAdmin && String(existing.faculty || '').toLowerCase() !== String(facultyScope.faculty || '').toLowerCase()) {
      return res.status(403).json({ error: 'Study type belongs to another faculty' });
    }
    await StudyGroupCatalog.deleteMany({
      university: cleanText(existing.university, 180),
      faculty: cleanText(existing.faculty, 180),
      studyType: cleanText(existing.name, 80)
    }).catch(() => {});
    await StudyTypeCatalog.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete study type' });
  }
});

app.get('/api/organizer/catalog/study-groups', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });

    const uniDoc = await UniversityCatalog.findOne({ name: scoped.university }).lean();
    const studyTypeRaw = cleanText(req.query.studyType, 80);
    const q = cleanText(req.query.q, 120);

    const filter = { university: scoped.university };
    if (facultyScope.faculty) {
      const canonicalFaculty = pickCanonicalFaculty(uniDoc, facultyScope.faculty);
      if (!canonicalFaculty) return res.json({ success: true, studyGroups: [], university: scoped.university });
      filter.faculty = canonicalFaculty;
    }
    if (studyTypeRaw) {
      if (!filter.faculty) return res.json({ success: true, studyGroups: [], university: scoped.university });
      const canonicalStudyType = await pickCanonicalStudyType(scoped.university, filter.faculty, studyTypeRaw);
      if (!canonicalStudyType) return res.json({ success: true, studyGroups: [], university: scoped.university });
      filter.studyType = canonicalStudyType;
    }
    if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

    const list = await StudyGroupCatalog.find(filter)
      .sort({ faculty: 1, studyType: 1, name: 1 })
      .limit(5000)
      .lean();

    res.json({ success: true, studyGroups: list, university: scoped.university });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load study groups' });
  }
});

app.post('/api/organizer/catalog/study-groups', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.body?.faculty, { requireForAdmin: true });
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });

    const facultyRaw = cleanText(facultyScope.faculty, 180);
    const studyTypeRaw = cleanText(req.body?.studyType, 80);
    const name = cleanText(req.body?.name || req.body?.studyGroup, 80);
    if (!facultyRaw || !studyTypeRaw || !name) return res.status(400).json({ error: 'faculty, studyType and name required' });

    const uniDoc = await UniversityCatalog.findOne({ name: scoped.university }).lean();
    const canonicalFaculty = pickCanonicalFaculty(uniDoc, facultyRaw);
    if (!canonicalFaculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });
    const canonicalStudyType = await pickCanonicalStudyType(scoped.university, canonicalFaculty, studyTypeRaw);
    if (!canonicalStudyType) return res.status(400).json({ error: 'Unknown study type for selected university and faculty' });

    const exists = await StudyGroupCatalog.findOne({
      university: scoped.university,
      faculty: canonicalFaculty,
      studyType: canonicalStudyType,
      name: new RegExp(`^${escapeRegex(name)}$`, 'i')
    }).lean();
    if (exists) return res.status(409).json({ error: 'Study group already exists' });

    const created = await StudyGroupCatalog.create({
      university: scoped.university,
      faculty: canonicalFaculty,
      studyType: canonicalStudyType,
      name
    });

    res.status(201).json({ success: true, studyGroup: created });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Study group already exists' });
    res.status(500).json({ error: 'Failed to add study group' });
  }
});

app.patch('/api/organizer/catalog/study-groups/:id', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    const scoped = await resolveScopedUniversity(req, req.body?.university || req.query?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.body?.faculty || req.query?.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });

    const existing = await StudyGroupCatalog.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Study group not found' });
    if (String(existing.university || '') !== String(scoped.university)) {
      return res.status(403).json({ error: 'Study group belongs to another university' });
    }
    if (!facultyScope.isAdmin && String(existing.faculty || '').toLowerCase() !== String(facultyScope.faculty || '').toLowerCase()) {
      return res.status(403).json({ error: 'Study group belongs to another faculty' });
    }

    const uniDoc = await UniversityCatalog.findOne({ name: scoped.university }).lean();
    const nextFacultyRaw = facultyScope.isAdmin
      ? (req.body?.faculty !== undefined
        ? cleanText(req.body.faculty, 180)
        : cleanText(existing.faculty, 180))
      : cleanText(facultyScope.faculty, 180);
    const nextStudyTypeRaw = req.body?.studyType !== undefined
      ? cleanText(req.body.studyType, 80)
      : cleanText(existing.studyType, 80);
    const nextName = req.body?.name !== undefined
      ? cleanText(req.body.name, 80)
      : cleanText(existing.name, 80);
    if (!nextFacultyRaw || !nextStudyTypeRaw || !nextName) return res.status(400).json({ error: 'faculty, studyType and name required' });

    const canonicalFaculty = pickCanonicalFaculty(uniDoc, nextFacultyRaw);
    if (!canonicalFaculty) return res.status(400).json({ error: 'Unknown faculty for selected university' });
    const canonicalStudyType = await pickCanonicalStudyType(scoped.university, canonicalFaculty, nextStudyTypeRaw);
    if (!canonicalStudyType) return res.status(400).json({ error: 'Unknown study type for selected university and faculty' });

    const duplicate = await StudyGroupCatalog.findOne({
      _id: { $ne: id },
      university: scoped.university,
      faculty: canonicalFaculty,
      studyType: canonicalStudyType,
      name: new RegExp(`^${escapeRegex(nextName)}$`, 'i')
    }).lean();
    if (duplicate) return res.status(409).json({ error: 'Study group already exists' });

    const updated = await StudyGroupCatalog.findByIdAndUpdate(
      id,
      { $set: { university: scoped.university, faculty: canonicalFaculty, studyType: canonicalStudyType, name: nextName } },
      { new: true }
    ).lean();

    const oldFaculty = cleanText(existing.faculty, 180);
    const oldStudyType = cleanText(existing.studyType, 80);
    const oldName = cleanText(existing.name, 80);
    if (oldFaculty !== canonicalFaculty || oldStudyType !== canonicalStudyType || oldName !== nextName) {
      await Promise.all([
        User.updateMany(
          { university: scoped.university, faculty: oldFaculty, studyType: oldStudyType, studyGroup: oldName },
          { $set: { faculty: canonicalFaculty, studyType: canonicalStudyType, studyGroup: nextName } }
        ).catch(() => {}),
        Group.updateMany(
          { university: scoped.university, faculty: oldFaculty, studyType: oldStudyType, studyGroup: oldName },
          { $set: { faculty: canonicalFaculty, studyType: canonicalStudyType, studyGroup: nextName } }
        ).catch(() => {})
      ]);
    }

    res.json({ success: true, studyGroup: updated });
  } catch (e) {
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Study group already exists' });
    res.status(500).json({ error: 'Failed to update study group' });
  }
});

app.delete('/api/organizer/catalog/study-groups/:id', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 60);
    const scoped = await resolveScopedUniversity(req, req.query?.university || req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query?.faculty || req.body?.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });

    const existing = await StudyGroupCatalog.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Study group not found' });
    if (String(existing.university || '') !== String(scoped.university)) {
      return res.status(403).json({ error: 'Study group belongs to another university' });
    }
    if (!facultyScope.isAdmin && String(existing.faculty || '').toLowerCase() !== String(facultyScope.faculty || '').toLowerCase()) {
      return res.status(403).json({ error: 'Study group belongs to another faculty' });
    }

    await StudyGroupCatalog.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete study group' });
  }
});

app.get('/api/organizer/groups', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const { page, limit, skip } = parsePaging(req);
    const q = cleanText(req.query.q, 180);
    const filter = { university: scoped.university };
    if (facultyScope.faculty) filter.faculty = facultyScope.faculty;
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: re }, { username: re }, { description: re }];
    }
    const [total, groups] = await Promise.all([
      Group.countDocuments(filter),
      Group.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);
    res.json({ success: true, page, limit, total, groups, university: scoped.university });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load groups' });
  }
});

app.delete('/api/organizer/groups/:id', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university || req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query?.faculty || req.body?.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const id = cleanText(req.params.id, 60);
    const g = await Group.findById(id).lean();
    if (!g) return res.status(404).json({ error: 'Group not found' });
    if (String(g.university || '') !== String(scoped.university)) {
      return res.status(403).json({ error: 'Group belongs to another university' });
    }
    if (!facultyScope.isAdmin && String(g.faculty || '').toLowerCase() !== String(facultyScope.faculty || '').toLowerCase()) {
      return res.status(403).json({ error: 'Group belongs to another faculty' });
    }

    await Group.deleteOne({ _id: id });
    await GroupMessage.deleteMany({ groupId: id });
    await GroupLesson.deleteMany({ groupId: id }).catch(()=>null);
    await GroupAttendance.deleteMany({ groupId: id }).catch(()=>null);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

app.get('/api/organizer/channels', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const { page, limit, skip } = parsePaging(req);
    const q = cleanText(req.query.q, 180);
    const filter = { university: scoped.university };
    if (facultyScope.faculty) filter.faculty = facultyScope.faculty;
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: re }, { username: re }, { description: re }];
    }
    const [total, channels] = await Promise.all([
      Channel.countDocuments(filter),
      Channel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);
    res.json({ success: true, page, limit, total, channels, university: scoped.university });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

app.delete('/api/organizer/channels/:id', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university || req.body?.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query?.faculty || req.body?.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });
    const id = cleanText(req.params.id, 60);
    const ch = await Channel.findById(id).lean();
    if (!ch) return res.status(404).json({ error: 'Channel not found' });
    if (String(ch.university || '') !== String(scoped.university)) {
      return res.status(403).json({ error: 'Channel belongs to another university' });
    }
    if (!facultyScope.isAdmin && String(ch.faculty || '').toLowerCase() !== String(facultyScope.faculty || '').toLowerCase()) {
      return res.status(403).json({ error: 'Channel belongs to another faculty' });
    }

    const posts = await ChannelPost.find({ channelId: id }).select('_id').lean();
    const postIds = (posts || []).map((p) => p._id);
    if (postIds.length) await ChannelPostComment.deleteMany({ postId: { $in: postIds } });
    await ChannelPost.deleteMany({ channelId: id });
    await Channel.deleteOne({ _id: id });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

app.get('/api/organizer/group-calls', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });

    const entries = Array.from(activeGroupCalls.entries()).map(([groupId, call]) => ({
      groupId: String(groupId || ''),
      call
    }));
    if (!entries.length) {
      return res.json({
        success: true,
        university: scoped.university,
        faculty: facultyScope.faculty || '',
        count: 0,
        calls: []
      });
    }

    const groupObjectIds = entries
      .map((x) => x.groupId)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const groupFilter = { _id: { $in: groupObjectIds }, university: scoped.university };
    if (facultyScope.faculty) groupFilter.faculty = facultyScope.faculty;

    const groups = await Group.find(groupFilter)
      .select('name username university faculty studyType studyGroup')
      .lean();
    const groupMap = new Map((groups || []).map((g) => [String(g._id), g]));

    const userIdSet = new Set();
    entries.forEach((entry) => {
      const call = entry.call || {};
      if (call.startedBy) userIdSet.add(String(call.startedBy));
      Array.from(call.participants || []).forEach((uid) => userIdSet.add(String(uid)));
      const stage = call.stage || {};
      if (stage.ownerTeacherId) userIdSet.add(String(stage.ownerTeacherId));
      if (stage.pinnedUserId) userIdSet.add(String(stage.pinnedUserId));
    });
    const userIds = Array.from(userIdSet).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select('fullName username avatar role').lean()
      : [];
    const userMap = new Map((users || []).map((u) => [String(u._id), u]));

    const now = Date.now();
    const calls = entries.map((entry) => {
      const group = groupMap.get(entry.groupId);
      if (!group) return null;
      const call = entry.call || {};
      const startedBy = call.startedBy ? userMap.get(String(call.startedBy)) : null;
      const participants = Array.from(call.participants || []).map((uid) => {
        const u = userMap.get(String(uid));
        return {
          userId: String(uid),
          fullName: u?.fullName || '',
          username: u?.username || '',
          avatar: u?.avatar || '',
          role: u?.role || ''
        };
      });
      const startedAt = call.startedAt ? new Date(call.startedAt) : null;
      return {
        groupId: entry.groupId,
        callId: String(call.callId || ''),
        callType: call.callType === 'audio' ? 'audio' : 'video',
        title: String(call.title || 'Live dars'),
        startedAt,
        durationSec: startedAt ? Math.max(0, Math.floor((now - startedAt.getTime()) / 1000)) : 0,
        participantsCount: participants.length,
        participants,
        stage: stagePayload(call),
        startedBy: startedBy
          ? {
              _id: String(startedBy._id),
              fullName: startedBy.fullName || '',
              username: startedBy.username || '',
              avatar: startedBy.avatar || '',
              role: startedBy.role || ''
            }
          : null,
        group: {
          _id: String(group._id),
          name: group.name || '',
          username: group.username || '',
          university: group.university || '',
          faculty: group.faculty || '',
          studyType: group.studyType || '',
          studyGroup: group.studyGroup || ''
        },
        watchUrl: `/group.html?id=${encodeURIComponent(entry.groupId)}&observer=1&autoJoin=1`
      };
    }).filter(Boolean)
      .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());

    res.json({
      success: true,
      university: scoped.university,
      faculty: facultyScope.faculty || '',
      count: calls.length,
      calls
    });
  } catch (e) {
    console.error('GET /api/organizer/group-calls error:', e);
    res.status(500).json({ error: 'Failed to load active calls' });
  }
});

app.get('/api/organizer/group-lessons', authenticateToken, requireOrganizerOrAdmin, async (req, res) => {
  try {
    const scoped = await resolveScopedUniversity(req, req.query.university);
    if (!scoped.ok) return res.status(400).json({ error: scoped.error });
    const facultyScope = await resolveScopedFaculty(req, scoped.university, req.query.faculty);
    if (!facultyScope.ok) return res.status(400).json({ error: facultyScope.error });

    const { page, limit, skip } = parsePaging(req);
    const groupIdRaw = cleanText(req.query.groupId, 60);
    const status = cleanText(req.query.status, 20).toLowerCase();
    const q = cleanText(req.query.q, 120);
    const onlyRecordedRaw = String(req.query.onlyRecorded || req.query.recorded || '').toLowerCase();
    const onlyRecorded = onlyRecordedRaw === '1' || onlyRecordedRaw === 'true' || onlyRecordedRaw === 'yes';

    const preLookupMatch = {};
    if (groupIdRaw) {
      if (!mongoose.Types.ObjectId.isValid(groupIdRaw)) return res.status(400).json({ error: 'Invalid groupId' });
      preLookupMatch.groupId = new mongoose.Types.ObjectId(groupIdRaw);
    }
    if (status === 'live' || status === 'ended') preLookupMatch.status = status;
    if (onlyRecorded) preLookupMatch.recordingUrl = { $exists: true, $ne: '' };

    const scopeMatch = { 'group.university': scoped.university };
    if (facultyScope.faculty) scopeMatch['group.faculty'] = facultyScope.faculty;

    const makePipeline = (forCount = false) => {
      const pipeline = [];
      if (Object.keys(preLookupMatch).length) pipeline.push({ $match: preLookupMatch });
      pipeline.push({
        $lookup: {
          from: 'groups',
          localField: 'groupId',
          foreignField: '_id',
          as: 'group'
        }
      });
      pipeline.push({ $unwind: '$group' });
      pipeline.push({ $match: scopeMatch });

      if (q) {
        const re = new RegExp(escapeRegex(q), 'i');
        pipeline.push({
          $match: {
            $or: [
              { title: re },
              { 'group.name': re },
              { 'group.username': re }
            ]
          }
        });
      }

      if (forCount) {
        pipeline.push({ $count: 'total' });
      } else {
        pipeline.push({ $sort: { startedAt: -1 } });
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limit });
      }

      return pipeline;
    };

    const [countRows, rows] = await Promise.all([
      GroupLesson.aggregate(makePipeline(true)),
      GroupLesson.aggregate(makePipeline(false))
    ]);

    const total = Number(countRows?.[0]?.total || 0);
    const hostIds = Array.from(new Set((rows || []).map((x) => String(x.hostId || '')).filter((id) => mongoose.Types.ObjectId.isValid(id))));
    const hosts = hostIds.length
      ? await User.find({ _id: { $in: hostIds } }).select('fullName username avatar role').lean()
      : [];
    const hostMap = new Map((hosts || []).map((u) => [String(u._id), u]));

    const items = (rows || []).map((x) => {
      const host = hostMap.get(String(x.hostId || ''));
      const recordingUrl = String(x.recordingUrl || '').trim();
      return {
        _id: String(x._id),
        groupId: String(x.groupId),
        callId: String(x.callId || ''),
        title: x.title || '',
        mode: x.mode || 'camera',
        status: x.status || '',
        startedAt: x.startedAt || null,
        endedAt: x.endedAt || null,
        recordingUrl,
        hasRecording: !!recordingUrl,
        recordingBytes: Number(x.recordingBytes || 0),
        recordingDurationSec: Number(x.recordingDurationSec || 0),
        group: x.group
          ? {
              _id: String(x.group._id),
              name: x.group.name || '',
              username: x.group.username || '',
              university: x.group.university || '',
              faculty: x.group.faculty || '',
              studyType: x.group.studyType || '',
              studyGroup: x.group.studyGroup || ''
            }
          : null,
        host: host
          ? {
              _id: String(host._id),
              fullName: host.fullName || '',
              username: host.username || '',
              avatar: host.avatar || '',
              role: host.role || ''
            }
          : null
      };
    });

    res.json({
      success: true,
      page,
      limit,
      total,
      university: scoped.university,
      faculty: facultyScope.faculty || '',
      items
    });
  } catch (e) {
    console.error('GET /api/organizer/group-lessons error:', e);
    res.status(500).json({ error: 'Failed to load group lessons' });
  }
});

// Admin broadcast notification (in-app). Payload can target university/faculty/group or all.
app.post('/api/admin/broadcast', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '').trim();
    const university = String(req.body.university || '').trim();
    const faculty = String(req.body.faculty || '').trim();
    const studyGroup = String(req.body.studyGroup || '').trim();
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });

    const filter = {};
    if (university) filter.university = university;
    if (faculty) filter.faculty = faculty;
    if (studyGroup) filter.studyGroup = studyGroup;

    const users = await User.find(filter).select('_id').lean();
    if (!users.length) return res.json({ success: true, created: 0 });

    const docs = users.map(u => ({
      userId: String(u._id),
      title,
      body,
      link: '/profile.html',
      read: false,
      createdAt: new Date()
    }));
    await Notification.insertMany(docs, { ordered: false });

    // realtime push (best-effort)
    users.forEach(u => {
      const ids = getUserSocketIds(String(u._id));
      ids.forEach(sid => {
        try { io.to(sid).emit('notification', { title, message: body, type: 'admin_broadcast', timestamp: Date.now() }); } catch {}
      });
    });

    res.json({ success: true, created: users.length });
  } catch (e) {
    console.error('POST /api/admin/broadcast error:', e);
    res.status(500).json({ error: 'Failed to broadcast' });
  }
});

// ==================== NOTIFICATIONS ROUTES ====================
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const unreadOnly = normalizeBoolInput(req.query.unreadOnly, false);
    const q = { userId: req.userId };
    if (unreadOnly) q.read = false;
    const [items, unreadCount] = await Promise.all([
      Notification.find(q).sort({ createdAt: -1 }).limit(200).lean(),
      Notification.countDocuments({ userId: req.userId, read: false })
    ]);
    res.json({ success: true, notifications: items, unreadCount });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});
app.post('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.userId }, { $set: { read: true } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark read' });
  }
});
app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.userId, read: false }, { $set: { read: true } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
  try {
    await Notification.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

function normalizeBoolInput(value, fallback = false) {
  if (value === undefined || value === null) return !!fallback;
  if (typeof value === 'boolean') return value;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return !!fallback;
}

function normalizePremiumScope(value) {
  return String(value || '').trim().toLowerCase() === 'university' ? 'university' : 'user';
}

function serializePremiumPaymentRequest(request) {
  const safe = request?.toObject ? request.toObject() : Object.assign({}, request || {});
  return {
    id: String(safe._id || ''),
    userId: String(safe.userId?._id || safe.userId || ''),
    user: safe.userId && typeof safe.userId === 'object' ? {
      _id: String(safe.userId._id || ''),
      username: safe.userId.username || '',
      fullName: safe.userId.fullName || '',
      nickname: safe.userId.nickname || '',
      avatar: safe.userId.avatar || '',
      university: safe.userId.university || '',
      verified: effectiveVerifiedFlag(safe.userId),
      premium: serializePremiumState(safe.userId)
    } : null,
    planScope: cleanText(safe.planScope, 40),
    planId: cleanText(safe.planId, 40),
    planLabel: cleanText(safe.planLabel, 120),
    billingCycle: cleanText(safe.billingCycle, 20),
    priceAmount: Number(safe.priceAmount || 0),
    currency: cleanText(safe.currency, 12) || 'UZS',
    screenshotUrl: cleanText(safe.screenshotUrl, 400),
    note: cleanText(safe.note, 500),
    status: cleanText(safe.status, 20) || 'pending',
    adminNote: cleanText(safe.adminNote, 400),
    reviewedBy: String(safe.reviewedBy || ''),
    reviewedAt: safe.reviewedAt || null,
    createdAt: safe.createdAt || null
  };
}

app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('fullName username nickname email phone avatar university faculty studyType studyGroup role verified premium settings').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const settings = ensureUserSettingsState({ settings: user.settings });
    const premium = serializePremiumState(user);
    res.json({
      success: true,
      settings,
      premium,
      paymentMethod: PREMIUM_PAYMENT_METHOD,
      plans: serializePremiumPlanCatalog(),
      user: {
        _id: String(user._id || ''),
        fullName: user.fullName || '',
        username: user.username || '',
        nickname: user.nickname || '',
        email: user.email || '',
        phone: user.phone || '',
        avatar: user.avatar || '',
        university: user.university || '',
        faculty: user.faculty || '',
        studyType: user.studyType || '',
        studyGroup: user.studyGroup || '',
        role: user.role || 'student',
        verified: effectiveVerifiedFlag(user)
      }
    });
  } catch (error) {
    console.error('GET /api/settings error:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.put('/api/settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('settings premium').catch(() => null);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const current = ensureUserSettingsState(user);
    const body = req.body || {};
    const next = {
      language: ['uz', 'en', 'ru'].includes(String(body.language || current.language).toLowerCase()) ? String(body.language || current.language).toLowerCase() : current.language,
      theme: ['light', 'dark', 'system'].includes(String(body.theme || current.theme).toLowerCase()) ? String(body.theme || current.theme).toLowerCase() : current.theme,
      notifications: {
        directMessages: normalizeBoolInput(body.notifications?.directMessages, current.notifications.directMessages),
        courseUpdates: normalizeBoolInput(body.notifications?.courseUpdates, current.notifications.courseUpdates),
        liveClasses: normalizeBoolInput(body.notifications?.liveClasses, current.notifications.liveClasses),
        aiProducts: normalizeBoolInput(body.notifications?.aiProducts, current.notifications.aiProducts),
        billing: normalizeBoolInput(body.notifications?.billing, current.notifications.billing),
        marketing: normalizeBoolInput(body.notifications?.marketing, current.notifications.marketing)
      },
      privacy: {
        showEmail: normalizeBoolInput(body.privacy?.showEmail, current.privacy.showEmail),
        showPhone: normalizeBoolInput(body.privacy?.showPhone, current.privacy.showPhone),
        profileVisibility: ['public', 'campus', 'private'].includes(String(body.privacy?.profileVisibility || current.privacy.profileVisibility).toLowerCase())
          ? String(body.privacy?.profileVisibility || current.privacy.profileVisibility).toLowerCase()
          : current.privacy.profileVisibility
      },
      animatedStickers: normalizeBoolInput(body.animatedStickers, current.animatedStickers),
      stickerAutoplay: normalizeBoolInput(body.stickerAutoplay, current.stickerAutoplay),
      compactMode: normalizeBoolInput(body.compactMode, current.compactMode),
      soundEnabled: normalizeBoolInput(body.soundEnabled, current.soundEnabled),
      updatedAt: new Date()
    };
    user.settings = next;
    user.markModified('settings');
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, settings: next, premium: serializePremiumState(user) });
  } catch (error) {
    console.error('PUT /api/settings error:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.get('/api/stickers/catalog', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('verified premium settings').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      success: true,
      enabled: hasPremiumFeature(user, 'animatedStickers'),
      premium: serializePremiumState(user),
      settings: ensureUserSettingsState({ settings: user.settings }),
      packs: buildStickerCatalogForUser(user)
    });
  } catch (error) {
    console.error('GET /api/stickers/catalog error:', error);
    res.status(500).json({ error: 'Failed to load stickers' });
  }
});

app.get('/api/premium/plans', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('premium verified role university').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const [pendingRequests, websiteCount, slideCount] = await Promise.all([
      PremiumPaymentRequest.countDocuments({ userId: req.userId, status: 'pending' }),
      WebsiteProject.countDocuments({ ownerId: req.userId }).catch(() => 0),
      SlideDeck.countDocuments({ userId: req.userId }).catch(() => 0)
    ]);
    res.json({
      success: true,
      plans: serializePremiumPlanCatalog(),
      paymentMethod: PREMIUM_PAYMENT_METHOD,
      premium: serializePremiumState(user),
      pendingRequests,
      usage: {
        websites: Number(websiteCount || 0),
        slides: Number(slideCount || 0)
      }
    });
  } catch (error) {
    console.error('GET /api/premium/plans error:', error);
    res.status(500).json({ error: 'Failed to load premium plans' });
  }
});

app.get('/api/premium/payments', authenticateToken, async (req, res) => {
  try {
    const requests = await PremiumPaymentRequest.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(40).lean();
    const user = await User.findById(req.userId).select('premium verified').lean();
    res.json({
      success: true,
      requests: (requests || []).map((item) => serializePremiumPaymentRequest(item)),
      premium: serializePremiumState(user || {})
    });
  } catch (error) {
    console.error('GET /api/premium/payments error:', error);
    res.status(500).json({ error: 'Failed to load premium payment requests' });
  }
});

app.post('/api/premium/payments/request', authenticateToken, upload.single('screenshot'), async (req, res) => {
  try {
    const planScope = normalizePremiumScope(req.body?.planScope);
    const planId = cleanText(req.body?.planId, 40).toLowerCase();
    const billingCycle = String(req.body?.billingCycle || 'monthly').trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
    const note = cleanText(req.body?.note, 500);
    const plan = getPremiumPlanDefinition(planScope, planId);
    if (!plan) return res.status(400).json({ error: 'Plan not found' });
    const screenshotUrl = req.file ? (`/uploads/${req.file.filename}`) : '';
    if (!screenshotUrl) return res.status(400).json({ error: 'Payment screenshot required' });

    const existingPending = await PremiumPaymentRequest.findOne({
      userId: req.userId,
      status: 'pending',
      planScope,
      planId,
      billingCycle
    }).lean();
    if (existingPending) {
      return res.status(400).json({ error: 'Bu tarif uchun kutilayotgan so‘rov allaqachon mavjud' });
    }

    const request = await PremiumPaymentRequest.create({
      userId: req.userId,
      planScope,
      planId,
      planLabel: plan.label,
      billingCycle,
      priceAmount: Number(billingCycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice),
      currency: 'UZS',
      screenshotUrl,
      note,
      status: 'pending'
    });

    await pushUserNotification(req.userId, {
      type: 'billing',
      icon: 'fa-wallet',
      title: 'Premium so‘rov yuborildi',
      body: `${plan.label} (${billingCycle === 'yearly' ? 'yillik' : 'oylik'}) so‘rovingiz admin tekshiruviga yuborildi.`,
      link: '/payment.html'
    }).catch(() => null);

    try {
      adminEmit('admin:premium:new', {
        requestId: String(request._id || ''),
        planScope,
        planId,
        billingCycle,
        userId: String(req.userId || '')
      });
    } catch (_) {}

    res.json({
      success: true,
      request: serializePremiumPaymentRequest(request),
      paymentMethod: PREMIUM_PAYMENT_METHOD
    });
  } catch (error) {
    console.error('POST /api/premium/payments/request error:', error);
    res.status(500).json({ error: 'Failed to create premium request' });
  }
});

// ==================== SUPPORT CHAT ROUTES ====================
function normalizeSupportText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

app.get('/api/support/thread', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.userId || '');
    const messages = await SupportMessage.find({ userId })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();
    const unreadForUser = await SupportMessage.countDocuments({
      userId,
      senderRole: 'admin',
      readByUser: false
    });
    res.json({ success: true, messages, unreadForUser });
  } catch (e) {
    console.error('GET /api/support/thread error:', e);
    res.status(500).json({ error: 'Failed to load support thread' });
  }
});

app.post('/api/support/thread', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.userId || '');
    const text = normalizeSupportText(req.body?.text);
    if (!text) return res.status(400).json({ error: 'text required' });

    const doc = await SupportMessage.create({
      userId,
      senderRole: 'user',
      senderId: userId,
      text,
      readByUser: true,
      readByAdmin: false
    });

    try {
      adminEmit('admin:support:new', {
        userId,
        text,
        createdAt: doc.createdAt,
        messageId: String(doc._id)
      });
    } catch (_) {}

    res.json({ success: true, message: doc });
  } catch (e) {
    console.error('POST /api/support/thread error:', e);
    res.status(500).json({ error: 'Failed to send support message' });
  }
});

app.post('/api/support/thread/read', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.userId || '');
    await SupportMessage.updateMany(
      { userId, senderRole: 'admin', readByUser: false },
      { $set: { readByUser: true } }
    );
    res.json({ success: true });
  } catch (e) {
    console.error('POST /api/support/thread/read error:', e);
    res.status(500).json({ error: 'Failed to mark support messages as read' });
  }
});

app.get('/api/admin/support/threads', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const q = String(req.query?.q || '').trim().toLowerCase();
    const rows = await SupportMessage.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$userId',
          lastAt: { $max: '$createdAt' },
          lastText: { $first: '$text' },
          unreadForAdmin: {
            $sum: {
              $cond: [
                { $and: [ { $eq: ['$senderRole', 'user'] }, { $eq: ['$readByAdmin', false] } ] },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { lastAt: -1 } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          userId: '$_id',
          _id: 0,
          lastAt: 1,
          lastText: 1,
          unreadForAdmin: 1,
          user: {
            _id: '$user._id',
            fullName: '$user.fullName',
            username: '$user.username',
            avatar: '$user.avatar',
            university: '$user.university',
            faculty: '$user.faculty',
            studyGroup: '$user.studyGroup'
          }
        }
      }
    ]);

    const items = (rows || []).filter((r) => {
      if (!q) return true;
      const bag = `${r?.user?.fullName || ''} ${r?.user?.username || ''} ${r?.user?.university || ''} ${r?.user?.faculty || ''} ${r?.user?.studyGroup || ''} ${r?.lastText || ''}`.toLowerCase();
      return bag.includes(q);
    });

    res.json({ success: true, items });
  } catch (e) {
    console.error('GET /api/admin/support/threads error:', e);
    res.status(500).json({ error: 'Failed to load support threads' });
  }
});

app.get('/api/admin/support/threads/:userId/messages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params?.userId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ error: 'Invalid userId' });
    const messages = await SupportMessage.find({ userId }).sort({ createdAt: 1 }).limit(1000).lean();
    res.json({ success: true, messages });
  } catch (e) {
    console.error('GET /api/admin/support/threads/:userId/messages error:', e);
    res.status(500).json({ error: 'Failed to load support messages' });
  }
});

app.post('/api/admin/support/threads/:userId/reply', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params?.userId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ error: 'Invalid userId' });
    const text = normalizeSupportText(req.body?.text);
    if (!text) return res.status(400).json({ error: 'text required' });

    const doc = await SupportMessage.create({
      userId,
      senderRole: 'admin',
      senderId: req.userId,
      text,
      readByUser: false,
      readByAdmin: true
    });

    try {
      await Notification.create({
        userId,
        title: 'Admin javobi',
        body: text,
        link: '/profile.html',
        read: false,
        createdAt: new Date()
      });
    } catch (_) {}

    try {
      emitToUser(userId, 'support:message', {
        from: 'admin',
        text,
        createdAt: doc.createdAt,
        messageId: String(doc._id)
      });
      emitToUser(userId, 'notification', {
        title: 'Admin javobi',
        message: text,
        type: 'support_reply',
        timestamp: Date.now()
      });
      adminEmit('admin:support:updated', { userId, messageId: String(doc._id), createdAt: doc.createdAt });
    } catch (_) {}

    res.json({ success: true, message: doc });
  } catch (e) {
    console.error('POST /api/admin/support/threads/:userId/reply error:', e);
    res.status(500).json({ error: 'Failed to send support reply' });
  }
});

app.post('/api/admin/support/threads/:userId/read', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params?.userId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ error: 'Invalid userId' });
    await SupportMessage.updateMany(
      { userId, senderRole: 'user', readByAdmin: false },
      { $set: { readByAdmin: true } }
    );
    res.json({ success: true });
  } catch (e) {
    console.error('POST /api/admin/support/threads/:userId/read error:', e);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// ==================== LIVE SESSIONS ROUTES ====================
// List lives. Query: status=scheduled|live|ended|cancelled, mine=1 (teacher), q=search, courseId=...
app.get('/api/lives', authenticateToken, async (req, res) => {
  try {
    const { status, mine, q, courseId } = req.query;
    const user = await User.findById(req.userId).select('role university faculty studyGroup').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const query = {};
    if (status) query.status = status;
    if (courseId) query.courseId = courseId;
    if (mine === '1') query.hostId = req.userId;

    // Students should only see lives targeted to their university/faculty/group
    if (user.role === 'student') {
      if (user.university) query.university = user.university;
      if (user.faculty) query.faculty = user.faculty;
      // group match: either empty targetGroups (open) or includes student's studyGroup
      query.$or = [ { targetGroups: { $size: 0 } }, { targetGroups: user.studyGroup } ];
    }
    let lives;
    if (q && q.trim()) {
      lives = await LiveSession.find({ ...query, $text: { $search: q.trim() } })
        .sort({ status: 1, startAt: 1, createdAt: -1 })
        .limit(200)
        .lean();
    } else {
      lives = await LiveSession.find(query)
        .sort({ status: 1, startAt: 1, createdAt: -1 })
        .limit(200)
        .lean();
    }
    res.json({ success: true, lives });
  } catch (e) {
    console.error('❌ List lives error:', e);
    res.status(500).json({ error: 'Failed to list lives' });
  }
});

// Live detail
app.get('/api/lives/:id', authenticateToken, async (req, res) => {
  try {
    const live = await LiveSession.findById(req.params.id).lean();
    if (!live) return res.status(404).json({ error: 'Live not found' });

    const host = await User.findById(live.hostId).select('fullName username avatar role').lean();
    const access = await LiveAccess.findOne({ liveId: live._id, userId: req.userId }).lean();

    res.json({ success: true, live, host, access: access || null });
  } catch (e) {
    console.error('❌ Live detail error:', e);
    res.status(500).json({ error: 'Failed to get live' });
  }
});

// Create/schedule live (teacher only)
app.post('/api/lives', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('role').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'teacher' && user.role !== 'admin') return res.status(403).json({ error: 'Teacher required' });

    const { title, description, previewImage, startAt, courseId, type, price } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });

    const host = await User.findById(req.userId).select('university faculty').lean();
    const uni = String(university || host?.university || '').trim();
    const fac = String(faculty || host?.faculty || '').trim();
    const tg = Array.isArray(targetGroups) ? targetGroups.map(s=>String(s).trim()).filter(Boolean) : (String(targetGroups||'').split(',').map(s=>s.trim()).filter(Boolean));

    const live = await LiveSession.create({
      hostId: req.userId,
      university: uni,
      faculty: fac,
      targetGroups: tg,
      lessonKind: ['lecture','practice','other'].includes(String(lessonKind||'other')) ? String(lessonKind||'other') : 'other',
      courseId: courseId || null,
      title: String(title).trim(),
      description: String(description || ''),
      previewImage: String(previewImage || ''),
      startAt: startAt ? new Date(startAt) : null,
      type: type === 'paid' ? 'paid' : 'free',
      price: type === 'paid' ? Math.max(1, Number(price || 0)) : 0,
      status: 'scheduled'
    });

    res.json({ success: true, live });
  } catch (e) {
    console.error('❌ Create live error:', e);
    res.status(500).json({ error: 'Failed to create live' });
  }
});

// Update live (teacher only, owner)
app.put('/api/lives/:id', authenticateToken, async (req, res) => {
  try {
    const live = await LiveSession.findById(req.params.id);
    if (!live) return res.status(404).json({ error: 'Live not found' });
    if (String(live.hostId) !== String(req.userId)) return res.status(403).json({ error: 'Forbidden' });
    if (live.status === 'live') return res.status(400).json({ error: 'Cannot edit while live' });

    const { title, description, previewImage, startAt, type, price, status } = req.body || {};
    if (typeof title === 'string' && title.trim()) live.title = title.trim();
    if (typeof description === 'string') live.description = description;
    if (typeof previewImage === 'string') live.previewImage = previewImage;
    if (typeof startAt !== 'undefined') live.startAt = startAt ? new Date(startAt) : null;
    if (type === 'paid' || type === 'free') {
      live.type = type;
      live.price = type === 'paid' ? Math.max(1, Number(price || live.price || 1)) : 0;
    }
    if (status === 'cancelled') live.status = 'cancelled';

    await live.save();
    res.json({ success: true, live: live.toObject() });
  } catch (e) {
    console.error('❌ Update live error:', e);
    res.status(500).json({ error: 'Failed to update live' });
  }
});

// Start live (teacher only, owner)
app.post('/api/lives/:id/start', authenticateToken, async (req, res) => {
  try {
    const live = await LiveSession.findById(req.params.id);
    if (!live) return res.status(404).json({ error: 'Live not found' });
    if (String(live.hostId) !== String(req.userId)) return res.status(403).json({ error: 'Forbidden' });
    if (live.status === 'cancelled') return res.status(400).json({ error: 'Live cancelled' });

    live.status = 'live';
    live.startedAt = new Date();
    live.endedAt = null;
    await live.save();

    if (io) {
      io.emit('live:status', { liveId: String(live._id), status: 'live', startedAt: live.startedAt });
      io.to(getLiveRoomName(String(live._id))).emit('live:status', { liveId: String(live._id), status: 'live', startedAt: live.startedAt });
    }
    res.json({ success: true, live: live.toObject() });
  } catch (e) {
    console.error('❌ Start live error:', e);
    res.status(500).json({ error: 'Failed to start live' });
  }
});

// Stop live (teacher only, owner)
app.post('/api/lives/:id/stop', authenticateToken, async (req, res) => {
  try {
    const live = await LiveSession.findById(req.params.id);
    if (!live) return res.status(404).json({ error: 'Live not found' });
    if (String(live.hostId) !== String(req.userId)) return res.status(403).json({ error: 'Forbidden' });

    live.status = 'ended';
    live.endedAt = new Date();
    await live.save();

    if (io) {
      io.emit('live:status', { liveId: String(live._id), status: 'ended', endedAt: live.endedAt });
      io.to(getLiveRoomName(String(live._id))).emit('live:status', { liveId: String(live._id), status: 'ended', endedAt: live.endedAt });
    }
    res.json({ success: true, live: live.toObject() });
  } catch (e) {
    console.error('❌ Stop live error:', e);
    res.status(500).json({ error: 'Failed to stop live' });
  }
});

// New front-end alias: set live status (expects {status:"live"/"offline"/"ended"/"scheduled"})
app.post('/api/lives/:id/status', authenticateToken, attachUserRole, requireRole(['teacher','admin']), async (req, res) => {
  try {
    const status = String(req.body.status || '').toLowerCase();
    if (!status) return res.status(400).json({ error: 'status required' });

    // map offline->scheduled (or keep offline)
    if (status === 'live') {
      // reuse start logic by calling same updates
      const live = await LiveSession.findById(req.params.id);
      if (!live) return res.status(404).json({ error: 'Live not found' });
      const role = String(req.userRole || '').toLowerCase();
      if (role !== 'admin' && String(live.hostId) !== String(req.userId)) return res.status(403).json({ error: 'Only host teacher or admin' });

      live.status = 'live';
      live.startedAt = live.startedAt || new Date();
      live.startAt = live.startAt || new Date();
      await live.save();
      return res.json({ success: true, live });
    }

    if (status === 'offline' || status === 'scheduled') {
      const live = await LiveSession.findById(req.params.id);
      if (!live) return res.status(404).json({ error: 'Live not found' });
      const role = String(req.userRole || '').toLowerCase();
      if (role !== 'admin' && String(live.hostId) !== String(req.userId)) return res.status(403).json({ error: 'Only host teacher or admin' });
      live.status = 'scheduled';
      await live.save();
      return res.json({ success: true, live });
    }

    if (status === 'ended') {
      const live = await LiveSession.findById(req.params.id);
      if (!live) return res.status(404).json({ error: 'Live not found' });
      const role = String(req.userRole || '').toLowerCase();
      if (role !== 'admin' && String(live.hostId) !== String(req.userId)) return res.status(403).json({ error: 'Only host teacher or admin' });
      live.status = 'ended';
      live.endedAt = live.endedAt || new Date();
      await live.save();
      return res.json({ success: true, live });
    }

    return res.status(400).json({ error: 'Unsupported status' });
  } catch (e) {
    console.error('POST /api/lives/:id/status error:', e);
    res.status(500).json({ error: 'Failed to update live status' });
  }
});

// Enter live (students pay here once, then socket join allowed)
app.post('/api/lives/:id/enter', authenticateToken, async (req, res) => {
  try {
    const live = await LiveSession.findById(req.params.id).lean();
    if (!live) return res.status(404).json({ error: 'Live not found' });
    if (live.status === 'cancelled') return res.status(400).json({ error: 'Live cancelled' });

    // owner always ok
    if (String(live.hostId) === String(req.userId)) {
      await LiveAccess.updateOne(
        { liveId: live._id, userId: req.userId },
        { $setOnInsert: { paid: false, amount: 0 } },
        { upsert: true }
      );
      return res.json({ success: true, ok: true, paid: false });
    }

    // Free live
    if (live.type === 'free' || !live.price) {
      await LiveAccess.updateOne(
        { liveId: live._id, userId: req.userId },
        { $setOnInsert: { paid: false, amount: 0 } },
        { upsert: true }
      );
      return res.json({ success: true, ok: true, paid: false });
    }

    // Paid: charge only once
    const existing = await LiveAccess.findOne({ liveId: live._id, userId: req.userId }).lean();
    if (existing && existing.paid) {
      return res.json({ success: true, ok: true, paid: true, amount: existing.amount });
    }

    const user = await User.findById(req.userId).select('coins').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const price = Math.max(1, Number(live.price || 0));
    if ((user.coins || 0) < price) {
      return res.status(402).json({
        error: 'Insufficient coins',
        redirect: '/topup.html',
        needed: price,
        current: user.coins || 0
      });
    }

    await User.updateOne({ _id: req.userId }, { $inc: { coins: -price } });
    await User.updateOne({ _id: live.hostId }, { $inc: { teacherBalance: price * 0.5 } });

    await LiveAccess.updateOne(
      { liveId: live._id, userId: req.userId },
      { $set: { paid: true, amount: price } },
      { upsert: true }
    );

    res.json({ success: true, ok: true, paid: true, amount: price });
  } catch (e) {
    console.error('❌ Enter live error:', e);
    res.status(500).json({ error: 'Failed to enter live' });
  }
});

// ==================== SERVICES MARKETPLACE ROUTES ====================

// Create service listing (with optional media upload)
app.post('/api/services', authenticateToken, upload.single('media'), async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('university username fullName avatar verified');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { title, description, category, tags, priceType, price, slaHours, status } = req.body;

    let mediaUrl = '';
    let mediaType = '';
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, { folder: 'services' });
      mediaUrl = result.secure_url;
      mediaType = getMediaType(req.file.mimetype);
      // cleanup local file
      try { require('fs').unlinkSync(req.file.path); } catch (_) {}
    }

    const tagList = (tags || '').split(',').map(t => t.trim()).filter(Boolean);

    const service = await Service.create({
      sellerId: user._id,
      university: user.university,
      title,
      description,
      category,
      tags: tagList,
      priceType: priceType === 'hour' ? 'hour' : 'fixed',
      price: Number(price || 0),
      slaHours: Number(slaHours || 24),
      mediaUrl,
      mediaType,
      status: status === 'paused' ? 'paused' : 'active'
    });

    // Notify university room
    if (io) {
      io.to('uni:' + user.university).emit('service:new', {
        id: service._id,
        title: service.title,
        category: service.category,
        price: service.price,
        priceType: service.priceType
      });
    }

    res.json({ success: true, service });
  } catch (error) {
    console.error('❌ Create service error:', error);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// List services
app.get('/api/services', async (req, res) => {
  try {
    const { university, category, q, tag, status, sort, page, limit } = req.query;
    const query = {};
    if (university) query.university = university;
    if (category) query.category = category;
    query.status = status || 'active';
    if (tag) query.tags = tag;

    let cursor = Service.find(query);

    if (q && q.trim()) {
      cursor = Service.find({ ...query, $text: { $search: q.trim() } }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 });
    } else {
      const sortKey = (sort || 'new').toLowerCase();
      if (sortKey === 'price_asc') cursor = cursor.sort({ price: 1 });
      else if (sortKey === 'price_desc') cursor = cursor.sort({ price: -1 });
      else cursor = cursor.sort({ createdAt: -1 });
    }

    const p = Math.max(1, parseInt(page || '1', 10));
    const l = Math.min(50, Math.max(5, parseInt(limit || '12', 10)));

    const [items, total] = await Promise.all([
      cursor.skip((p - 1) * l).limit(l).lean(),
      Service.countDocuments(query)
    ]);

    res.json({ success: true, services: items, total, page: p, pages: Math.ceil(total / l) });
  } catch (error) {
    console.error('❌ List services error:', error);
    res.status(500).json({ error: 'Failed to list services' });
  }
});

// Service detail (with seller + rating)
app.get('/api/services/:id', async (req, res) => {
  try {
    const service = await Service.findById(req.params.id).lean();
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const seller = await User.findById(service.sellerId).select('fullName username avatar university verified').lean();

    const ratingAgg = await ServiceReview.aggregate([
      { $lookup: { from: 'serviceorders', localField: 'orderId', foreignField: '_id', as: 'order' } },
      { $unwind: '$order' },
      { $match: { 'order.serviceId': service._id } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]);

    const rating = ratingAgg[0] ? { average: Number(ratingAgg[0].avg.toFixed(2)), count: ratingAgg[0].count } : { average: 0, count: 0 };

    res.json({ success: true, service, seller, rating });
  } catch (error) {
    console.error('❌ Service detail error:', error);
    res.status(500).json({ error: 'Failed to get service' });
  }
});

// Update service (seller only)
app.put('/api/services/:id', authenticateToken, upload.single('media'), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });
    if (service.sellerId.toString() !== req.userId) return res.status(403).json({ error: 'Forbidden' });

    const { title, description, category, tags, priceType, price, slaHours, status } = req.body;

    if (title) service.title = title;
    if (description) service.description = description;
    if (category) service.category = category;
    if (typeof tags !== 'undefined') service.tags = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
    if (priceType) service.priceType = priceType === 'hour' ? 'hour' : 'fixed';
    if (typeof price !== 'undefined') service.price = Number(price);
    if (typeof slaHours !== 'undefined') service.slaHours = Number(slaHours);
    if (status) service.status = status === 'paused' ? 'paused' : 'active';

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, { folder: 'services' });
      service.mediaUrl = result.secure_url;
      service.mediaType = getMediaType(req.file.mimetype);
      try { require('fs').unlinkSync(req.file.path); } catch (_) {}
    }

    await service.save();
    res.json({ success: true, service });
  } catch (error) {
    console.error('❌ Update service error:', error);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// Delete service (seller only)
app.delete('/api/services/:id', authenticateToken, async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });
    if (service.sellerId.toString() !== req.userId) return res.status(403).json({ error: 'Forbidden' });

    await ServiceFavorite.deleteMany({ serviceId: service._id });
    await Service.deleteOne({ _id: service._id });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Delete service error:', error);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// Favorite toggle
app.post('/api/services/:id/favorite', authenticateToken, async (req, res) => {
  try {
    const serviceId = req.params.id;
    const existing = await ServiceFavorite.findOne({ userId: req.userId, serviceId });
    if (existing) {
      await ServiceFavorite.deleteOne({ _id: existing._id });
      return res.json({ success: true, favorited: false });
    }
    await ServiceFavorite.create({ userId: req.userId, serviceId });
    res.json({ success: true, favorited: true });
  } catch (error) {
    console.error('❌ Favorite error:', error);
    res.status(500).json({ error: 'Failed to favorite' });
  }
});

// Create order / request service
app.post('/api/service-orders', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('university');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { serviceId, note } = req.body;
    const service = await Service.findById(serviceId);
    if (!service || service.status !== 'active') return res.status(404).json({ error: 'Service not available' });
    if (service.university !== user.university) return res.status(403).json({ error: 'University mismatch' });
    if (service.sellerId.toString() === req.userId) return res.status(400).json({ error: 'Cannot order your own service' });

    const dueAt = new Date(Date.now() + (service.slaHours || 24) * 60 * 60 * 1000);

    const order = await ServiceOrder.create({
      serviceId: service._id,
      buyerId: req.userId,
      sellerId: service.sellerId,
      university: user.university,
      note: note || '',
      agreedPrice: service.price,
      status: 'created',
      dueAt
    });

    if (io) {
      io.to(service.sellerId.toString()).emit('service:order:new', { orderId: order._id });
    }

    res.json({ success: true, order });
  } catch (error) {
    console.error('❌ Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// List my orders (buyer/seller)
app.get('/api/service-orders', authenticateToken, async (req, res) => {
  try {
    const { role, status } = req.query; // role=buyer|seller
    const query = {};
    if (role === 'seller') query.sellerId = req.userId;
    else query.buyerId = req.userId;
    if (status) query.status = status;

    const orders = await ServiceOrder.find(query).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, orders });
  } catch (error) {
    console.error('❌ List orders error:', error);
    res.status(500).json({ error: 'Failed to list orders' });
  }
});

// Order detail
app.get('/api/service-orders/:id', authenticateToken, async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (![order.buyerId.toString(), order.sellerId.toString()].includes(req.userId)) return res.status(403).json({ error: 'Forbidden' });

    const service = await Service.findById(order.serviceId).lean();
    const deliverables = await ServiceDeliverable.find({ orderId: order._id }).sort({ createdAt: -1 }).lean();

    res.json({ success: true, order, service, deliverables });
  } catch (error) {
    console.error('❌ Order detail error:', error);
    res.status(500).json({ error: 'Failed to get order' });
  }
});

// Seller sets in_progress
app.post('/api/service-orders/:id/start', authenticateToken, async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.sellerId.toString() !== req.userId) return res.status(403).json({ error: 'Forbidden' });

    order.status = 'in_progress';
    await order.save();
    res.json({ success: true, order });
  } catch (error) {
    console.error('❌ Order start error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// Upload deliverable (seller or buyer)
app.post('/api/service-orders/:id/deliverable', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (![order.buyerId.toString(), order.sellerId.toString()].includes(req.userId)) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const result = await cloudinary.uploader.upload(req.file.path, { folder: 'deliverables' });
    const d = await ServiceDeliverable.create({
      orderId: order._id,
      uploaderId: req.userId,
      mediaUrl: result.secure_url,
      mediaType: getMediaType(req.file.mimetype),
      note: (req.body.note || '')
    });
    try { require('fs').unlinkSync(req.file.path); } catch (_) {}

    // If seller uploaded deliverable, set submitted
    if (order.sellerId.toString() === req.userId) {
      order.status = 'submitted';
      await order.save();
    }

    res.json({ success: true, deliverable: d, order });
  } catch (error) {
    console.error('❌ Deliverable error:', error);
    res.status(500).json({ error: 'Failed to upload deliverable' });
  }
});

// Buyer accepts
app.post('/api/service-orders/:id/accept', authenticateToken, async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyerId.toString() !== req.userId) return res.status(403).json({ error: 'Forbidden' });

    order.status = 'accepted';
    await order.save();
    res.json({ success: true, order });
  } catch (error) {
    console.error('❌ Accept error:', error);
    res.status(500).json({ error: 'Failed to accept' });
  }
});

// Dispute / Cancel
app.post('/api/service-orders/:id/dispute', authenticateToken, async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (![order.buyerId.toString(), order.sellerId.toString()].includes(req.userId)) return res.status(403).json({ error: 'Forbidden' });

    order.status = 'disputed';
    await order.save();
    res.json({ success: true, order });
  } catch (error) {
    console.error('❌ Dispute error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/service-orders/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyerId.toString() !== req.userId) return res.status(403).json({ error: 'Forbidden' });

    order.status = 'cancelled';
    await order.save();
    res.json({ success: true, order });
  } catch (error) {
    console.error('❌ Cancel error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// Review (buyer only, accepted orders)
app.post('/api/service-orders/:id/review', authenticateToken, async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyerId.toString() !== req.userId) return res.status(403).json({ error: 'Forbidden' });
    if (order.status !== 'accepted') return res.status(400).json({ error: 'Order not accepted yet' });

    const { rating, text } = req.body;
    const review = await ServiceReview.create({
      orderId: order._id,
      reviewerId: order.buyerId,
      revieweeId: order.sellerId,
      rating: Number(rating),
      text: text || ''
    });

    res.json({ success: true, review });
  } catch (error) {
    console.error('❌ Review error:', error);
    res.status(500).json({ error: 'Failed to review' });
  }
});

// ==================== ANONYMOUS CAMPUS SIGNALS ROUTES ====================

function sanitizeSignalPublic(signalDoc) {
  const s = { ...signalDoc };
  delete s.authorId;
  return s;
}

// Simple toxicity wordlist (extend later)
function isPotentiallyToxic(text) {
  const t = (text || '').toLowerCase();
  const banned = ['kill', 'suicide', 'terror', 'bomb', 'rape'];
  return banned.some(w => t.includes(w));
}

// Rate limit: verified 3/day else 1/day
async function signalRateLimit(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('verified');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const limit = user.verified ? 3 : 1;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await Signal.countDocuments({ authorId: req.userId, createdAt: { $gte: since } });
    if (count >= limit) return res.status(429).json({ error: 'Daily signal limit reached' });
    next();
  } catch (e) {
    console.error('❌ Signal rate limit error:', e);
    res.status(500).json({ error: 'Rate limit check failed' });
  }
}

// Admin gate for moderation
async function requireSignalAdmin(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('username');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const admins = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!admins.length) return res.status(403).json({ error: 'Admin list not configured' });
    if (!admins.includes(user.username)) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch (e) {
    console.error('❌ requireSignalAdmin error:', e);
    res.status(500).json({ error: 'Auth failed' });
  }
}

// Create signal (anonymous to public)
app.post('/api/signals', authenticateToken, signalRateLimit, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('university');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { title, body, tags, urgency } = req.body;
    const tagList = Array.isArray(tags) ? tags : (tags || '').split(',').map(t => t.trim()).filter(Boolean);

    const pending = isPotentiallyToxic(title + ' ' + body);

    const signal = await Signal.create({
      university: user.university,
      authorId: req.userId,
      title,
      body,
      tags: tagList,
      urgency: Math.max(1, Math.min(5, Number(urgency || 3))),
      visibility: pending ? 'pending' : 'public'
    });

    // Realtime push only if public
    if (io && signal.visibility === 'public') {
      io.to('uni:' + user.university).emit('signal:new', sanitizeSignalPublic(signal.toObject()));
    }

    res.json({ success: true, signal: sanitizeSignalPublic(signal.toObject()) });
  } catch (error) {
    console.error('❌ Create signal error:', error);
    res.status(500).json({ error: 'Failed to create signal' });
  }
});

// List signals
app.get('/api/signals', async (req, res) => {
  try {
    const { university, tag, status, sort, q, page, limit } = req.query;
    const query = { visibility: 'public' };
    if (university) query.university = university;
    if (tag) query.tags = tag;
    if (status) query.status = status;

    let cursor = Signal.find(query);

    if (q && q.trim()) {
      cursor = Signal.find({ ...query, $text: { $search: q.trim() } }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 });
    } else {
      const s = (sort || 'hot').toLowerCase();
      if (s === 'new') cursor = cursor.sort({ createdAt: -1 });
      else cursor = cursor.sort({ impactScore: -1, createdAt: -1 });
    }

    const p = Math.max(1, parseInt(page || '1', 10));
    const l = Math.min(50, Math.max(10, parseInt(limit || '20', 10)));

    const [items, total] = await Promise.all([
      cursor.skip((p - 1) * l).limit(l).lean(),
      Signal.countDocuments(query)
    ]);

    res.json({ success: true, signals: items.map(sanitizeSignalPublic), total, page: p, pages: Math.ceil(total / l) });
  } catch (error) {
    console.error('❌ List signals error:', error);
    res.status(500).json({ error: 'Failed to list signals' });
  }
});

// Signal detail (public)
app.get('/api/signals/:id', async (req, res) => {
  try {
    const signal = await Signal.findById(req.params.id).lean();
    if (!signal || signal.visibility !== 'public') return res.status(404).json({ error: 'Signal not found' });

    const comments = await SignalComment.find({ signalId: signal._id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, signal: sanitizeSignalPublic(signal), comments: comments.map(c => ({ ...c, authorId: undefined })) });
  } catch (error) {
    console.error('❌ Signal detail error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// Vote
app.post('/api/signals/:id/vote', authenticateToken, async (req, res) => {
  try {
    const { vote } = req.body;
    const v = Number(vote);
    if (![1, -1].includes(v)) return res.status(400).json({ error: 'Invalid vote' });

    const signal = await Signal.findById(req.params.id);
    if (!signal || signal.visibility !== 'public') return res.status(404).json({ error: 'Signal not found' });

    await SignalVote.findOneAndUpdate(
      { signalId: signal._id, userId: req.userId },
      { vote: v, createdAt: new Date() },
      { upsert: true, new: true }
    );

    const votesAgg = await SignalVote.aggregate([
      { $match: { signalId: signal._id } },
      { $group: { _id: null, score: { $sum: '$vote' }, count: { $sum: 1 } } }
    ]);
    const commentsCount = await SignalComment.countDocuments({ signalId: signal._id });

    const score = votesAgg[0] ? votesAgg[0].score : 0;
    signal.impactScore = score + Math.min(20, commentsCount * 0.5) + (signal.urgency - 3) * 0.3;
    await signal.save();

    res.json({ success: true, impactScore: signal.impactScore });
  } catch (error) {
    console.error('❌ Vote error:', error);
    res.status(500).json({ error: 'Failed to vote' });
  }
});

// Comment
app.post('/api/signals/:id/comment', authenticateToken, async (req, res) => {
  try {
    const signal = await Signal.findById(req.params.id);
    if (!signal || signal.visibility !== 'public') return res.status(404).json({ error: 'Signal not found' });

    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Empty comment' });

    await SignalComment.create({
      signalId: signal._id,
      authorId: req.userId,
      body: body.trim()
    });

    const commentsCount = await SignalComment.countDocuments({ signalId: signal._id });
    signal.impactScore = (signal.impactScore || 0) + Math.min(1, commentsCount * 0.02);
    await signal.save();

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Comment error:', error);
    res.status(500).json({ error: 'Failed to comment' });
  }
});

// Report
app.post('/api/signals/:id/report', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason required' });
    await SignalReport.create({
      signalId: req.params.id,
      reporterId: req.userId,
      reason: reason.trim()
    });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Report error:', error);
    res.status(500).json({ error: 'Failed to report' });
  }
});

// Moderation queue
app.get('/api/mod/signals', authenticateToken, requireSignalAdmin, async (req, res) => {
  try {
    const { visibility, status } = req.query;
    const query = {};
    if (visibility) query.visibility = visibility;
    if (status) query.status = status;

    const signals = await Signal.find(query).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, signals });
  } catch (error) {
    console.error('❌ Mod queue error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// Approve / Reject / Set status
app.post('/api/mod/signals/:id/action', authenticateToken, requireSignalAdmin, async (req, res) => {
  try {
    const { action, note, status } = req.body;
    const signal = await Signal.findById(req.params.id);
    if (!signal) return res.status(404).json({ error: 'Not found' });

    if (action === 'approve') signal.visibility = 'public';
    if (action === 'hide') signal.visibility = 'hidden';
    if (action === 'reject') { signal.visibility = 'hidden'; signal.status = 'rejected'; }
    if (action === 'set_status' && status) signal.status = status;

    await signal.save();
    await SignalModeration.create({
      signalId: signal._id,
      moderatorId: req.userId,
      action: action || 'unknown',
      note: note || '',
      createdAt: new Date()
    });

    if (io && signal.visibility === 'public') {
      io.to('uni:' + signal.university).emit('signal:new', sanitizeSignalPublic(signal.toObject()));
    }

    res.json({ success: true, signal: sanitizeSignalPublic(signal.toObject()) });
  } catch (error) {
    console.error('❌ Mod action error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// ==================== PET + COINS API ====================
// NOTE: requireAdmin middleware is defined earlier (Admin check uses DB). Removed duplicate declaration.


// Get my pet + coins + inventory + shop catalog
app.get('/api/pet/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureInventoryArrays(user);
    ensureRobots(user);
    if (!user.petScene) user.petScene = normalizePetScene({});
    if (!user.pet) user.pet = { name: 'Robotcha', color: '#6366f1', outfitColor: '#ec4899', hunger: 60, xp: 0, level: 1 };
    ensureCompanions(user);
    await user.save({ validateBeforeSave: false });
    const activeCompanion = (user.companions || []).find(c => c._id && String(c._id) === String(user.activeCompanionId)) || (user.companions || []).find(c => c.equipped) || (user.companions || [])[0] || null;
res.json({
      success: true,
      coins: user.coins || 0,
      pet: user.pet,
      inventory: user.inventory,
      companions: user.companions || [],
      activeCompanion,
      petScene: normalizePetScene(user.petScene || {}),
      market: PET_MARKET,
      isAdmin: !!user.isAdmin
    });
  } catch (e) {
    console.error('pet/me error', e);
    res.status(500).json({ error: 'Failed to load pet' });
  }
});

// Save / load profile robot scene preferences (motion/theme/fx)
app.get('/api/pet/scene', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('petScene').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, scene: normalizePetScene(user.petScene || {}) });
  } catch (e) {
    console.error('pet/scene get error', e);
    res.status(500).json({ error: 'Failed to load scene' });
  }
});

app.post('/api/pet/scene', authenticateToken, async (req, res) => {
  try {
    const scene = normalizePetScene(req.body || {});
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.petScene = scene;
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, scene: normalizePetScene(user.petScene || {}) });
  } catch (e) {
    console.error('pet/scene save error', e);
    res.status(500).json({ error: 'Failed to save scene' });
  }
});


// ==================== ROBOT COLLECTION API ====================

// Robot katalog (shop)
app.get('/api/robots/catalog', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, catalog: ROBOT_CATALOG, upgrades: ROBOT_UPGRADES });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load robot catalog' });
  }
});

// Mening robotlarim (collection + active)
app.get('/api/robots/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureInventoryArrays(user);
    ensureRobots(user);
    await user.save();
    const active = user.robots.find(r => String(r._id) === String(user.activeRobotId)) || user.robots[0];
    res.json({ success: true, coins: user.coins || 0, robots: user.robots, activeRobotId: user.activeRobotId, active });
  } catch (e) {
    console.error('robots/me error', e);
    res.status(500).json({ error: 'Failed to load robots' });
  }
});

// Robot sotib olish (coins)
app.post('/api/robots/buy', authenticateToken, async (req, res) => {
  try {
    const robotTypeId = String(req.body?.robotTypeId || req.body?.typeId || req.body?.id || '').trim();
    const item = ROBOT_CATALOG.find(x => x.id === robotTypeId);
    if (!item) return res.status(400).json({ error: 'Robot not found' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    ensureInventoryArrays(user);
    ensureRobots(user);

    // Oldin sotib olgan bo'lsa, qayta sotib olmasin
    const owned = user.robots.some(r => r.typeId === item.id);
    if (owned) return res.status(400).json({ error: 'Bu robot sizda allaqachon bor' });

    const price = item.price || 0;
    if ((user.coins || 0) < price) return res.status(400).json({ error: 'Coins yetarli emas' });

    user.coins = (user.coins || 0) - price;

    user.robots.push({
      typeId: item.id,
      name: item.name,
      baseColor: '#6366f1',
      outfitColor: '#ec4899',
      hunger: 60,
      lastFedAt: null,
      cuteness: item.baseCuteness,
      level: 1,
      xp: 0,
      mood: 'happy',
      equipped: false,
      createdAt: new Date()
    });

    await user.save();
    res.json({ success: true, coins: user.coins, robots: user.robots });
  } catch (e) {
    console.error('robots/buy error', e);
    res.status(500).json({ error: 'Failed to buy robot' });
  }
});

// Robotni tanlash (equip)
app.post('/api/robots/equip', authenticateToken, async (req, res) => {
  try {
    const { robotId } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    ensureRobots(user);

    const r = user.robots.id(robotId);
    if (!r) return res.status(404).json({ error: 'Robot not found' });

    user.activeRobotId = String(r._id);
    user.robots.forEach(x => x.equipped = (String(x._id) === String(r._id)));

    // sync legacy pet
    ensureRobots(user);
    await user.save();

    res.json({ success: true, activeRobotId: user.activeRobotId, pet: user.pet, active: r });
  } catch (e) {
    console.error('robots/equip error', e);
    res.status(500).json({ error: 'Failed to equip robot' });
  }
});

// Robot upgrade (coins) - yoqimtoylik + XP
app.post('/api/robots/upgrade', authenticateToken, async (req, res) => {
  try {
    const { robotId, upgradeId } = req.body;
    const up = ROBOT_UPGRADES[upgradeId];
    if (!up) return res.status(400).json({ error: 'Upgrade not found' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    ensureRobots(user);

    const r = user.robots.id(robotId);
    if (!r) return res.status(404).json({ error: 'Robot not found' });

    if ((user.coins || 0) < up.price) return res.status(400).json({ error: 'Coins yetarli emas' });

    user.coins = (user.coins || 0) - up.price;
    r.cuteness = Math.min(100, (r.cuteness || 0) + (up.cutenessPlus || 0));
    r.xp = (r.xp || 0) + (up.xpPlus || 0);

    // level up simple rule: every 40 xp
    const lvl = Math.floor((r.xp || 0) / 40) + 1;
    r.level = Math.max(r.level || 1, lvl);
    r.mood = 'happy';

    // sync if active
    if (String(user.activeRobotId) === String(r._id)) {
      user.pet.xp = r.xp;
      user.pet.level = r.level;
    }

    await user.save();
    res.json({ success: true, coins: user.coins, robot: r, pet: user.pet });
  } catch (e) {
    console.error('robots/upgrade error', e);
    res.status(500).json({ error: 'Failed to upgrade robot' });
  }
});

// Robot o'ynash (boshqa user robotchasi bilan interaktiv)
app.post('/api/robots/play', authenticateToken, async (req, res) => {
  try {
    const { targetUserId, robotId, action } = req.body || {};
    const mongoose = require('mongoose');

    // Decide target user (default: self)
    let target = req.user;
    let targetId = String(req.user?._id || '');

    if (targetUserId) {
      if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res.status(400).json({ error: 'Invalid target id' });
      }
      const t = await User.findById(targetUserId);
      if (!t) return res.status(404).json({ error: 'User not found' });
      target = t;
      targetId = String(t._id);
    }

    ensureRobots(target);

    // Decide which robot: explicit robotId (only allowed for self), else active
    let active = null;

    if (robotId) {
      if (String(target._id) !== String(req.user._id)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      active = target.robots.find(r => String(r._id) === String(robotId));
      if (!active) return res.status(400).json({ error: 'Robot not found' });
    } else {
      active = target.robots.find(r => String(r._id) === String(target.activeRobotId)) || target.robots.find(r => r.equipped) || target.robots[0];
      if (!active) return res.status(400).json({ error: 'Robot not found' });
    }

    const c = Math.max(0, Math.min(100, active.cuteness || 50));

    let reaction = 'neutral';
    let text = 'Robotcha sizga qaradi.';

    switch (action) {
      case 'wave':
        reaction = (c >= 60 ? 'happy' : 'neutral');
        text = (c >= 60 ? 'Robotcha quvonib qo‘l siltadi!' : 'Robotcha muloyim qo‘l siltadi.');
        break;
      case 'dance':
        reaction = (c >= 70 ? 'happy' : 'thinking');
        text = (c >= 70 ? 'Robotcha raqsga tushdi!' : 'Robotcha raqsni o‘ylab ko‘rdi...');
        break;
      case 'poke':
        reaction = (c >= 55 ? 'surprised' : 'sad');
        text = (c >= 55 ? 'Robotcha hayron bo‘ldi va kulib yubordi.' : 'Robotcha xafa bo‘lib qaradi...');
        break;
      case 'joke':
        reaction = (c >= 75 ? 'happy' : 'neutral');
        text = (c >= 75 ? 'Robotcha juda yoqimli hazil qildi!' : 'Robotcha qisqa hazil qildi.');
        break;
      default:
        reaction = (c >= 80 ? 'happy' : (c <= 35 ? 'sad' : 'neutral'));
        text = (reaction === 'happy') ? 'Robotcha sizni ko‘rib xursand bo‘ldi!' :
              (reaction === 'sad') ? 'Robotcha biroz xafa ko‘rindi...' :
              'Robotcha sizni kuzatmoqda.';
    }

    // If playing your own robot: add tiny XP
    if (String(target._id) === String(req.user._id)) {
      active.xp = (active.xp || 0) + 2;
      if ((active.xp || 0) >= (active.level || 1) * 50) {
        active.level = (active.level || 1) + 1;
        active.xp = 0;
      }
      ensureRobots(target);
      await target.save();
    }

    res.json({
      success: true,
      targetUserId: targetId,
      reaction,
      text,
      robot: {
        id: String(active._id),
        typeId: active.typeId,
        name: active.name,
        level: active.level || 1,
        xp: active.xp || 0,
        cuteness: c,
        baseColor: active.baseColor,
        outfitColor: active.outfitColor
      }
    });
  } catch (e) {
    console.error('robots/play error', e);
    res.status(500).json({ error: 'Failed to play robot' });
  }
});

// Buy item from pet market (coins)
app.post('/api/shop/buy', authenticateToken, async (req, res) => {
  try {
    const { itemId, id } = req.body || {};
    const buyId = (itemId ?? id ?? '').toString().trim();
    const found = findMarketItem(buyId);
    if (!found) {
      return res.status(400).json({ error: 'Item not found', itemId: buyId });
    }
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureInventoryArrays(user);
    const price = found.item.price || 0;
    if ((user.coins || 0) < price) return res.status(400).json({ error: 'Coins yetarli emas' });
    user.coins = (user.coins || 0) - price;
    if (found.type === 'foods') invAdd(user.inventory.foods, found.item);
    if (found.type === 'paints') invAdd(user.inventory.paints, found.item);
    if (found.type === 'outfits') invAdd(user.inventory.outfits, found.item);
    if (found.type === 'companions') {
      const already = (user.companions || []).some(c => c.typeId === found.item.id);
      if (already) return res.status(400).json({ error: 'Bu hayvoncha sizda allaqachon bor' });
      user.companions.push({
        typeId: found.item.id,
        name: found.item.name,
        emoji: found.item.emoji || '🐾',
        rarity: found.item.rarity || 'common',
        moodBoost: found.item.moodBoost || 0,
        equipped: false,
        createdAt: new Date()
      });
      // Auto-equip first companion
      ensureCompanions(user);
    }
    await user.save();
    res.json({ success: true, coins: user.coins, inventory: user.inventory, companions: user.companions || [] });
  } catch (e) {
    console.error('shop/buy error', e);
    res.status(500).json({ error: 'Buy failed' });
  }
});

// Feed robot (consume food, increase hunger + xp)
app.post('/api/pet/feed', authenticateToken, async (req, res) => {
  try {
    const { foodId } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureInventoryArrays(user);
    if (!user.pet) user.pet = { name: 'Robotcha', color: '#6366f1', outfitColor: '#ec4899', hunger: 60, xp: 0, level: 1 };
    const ok = invConsume(user.inventory.foods, foodId);
    if (!ok) return res.status(400).json({ error: 'Ovqat inventarda yo‘q yoki tugagan' });
    const found = PET_MARKET.foods.find(x => x.id === foodId);
    const plus = (found && found.hungerPlus) ? found.hungerPlus : 10;
    user.pet.hunger = clamp((user.pet.hunger || 0) + plus, 0, 100);
    user.pet.xp = (user.pet.xp || 0) + Math.ceil(plus / 2);
    user.pet.lastFedAt = new Date();
    // level up rule: 100xp each level
    while ((user.pet.xp || 0) >= 100) {
      user.pet.xp -= 100;
      user.pet.level = (user.pet.level || 1) + 1;
    }
    await user.save();
    res.json({ success: true, pet: user.pet, inventory: user.inventory });
  } catch (e) {
    console.error('pet/feed error', e);
    res.status(500).json({ error: 'Feed failed' });
  }
});

// Paint robot color (consume paint)
app.post('/api/pet/paint', authenticateToken, async (req, res) => {
  try {
    const { paintId, target } = req.body; // target: 'body' | 'outfit'
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureInventoryArrays(user);
    if (!user.pet) user.pet = { name: 'Robotcha', color: '#6366f1', outfitColor: '#ec4899', hunger: 60, xp: 0, level: 1 };
    const ok = invConsume(user.inventory.paints, paintId);
    if (!ok) return res.status(400).json({ error: 'Bo‘yoq inventarda yo‘q yoki tugagan' });
    const found = PET_MARKET.paints.find(x => x.id === paintId);
    const color = (found && found.color) ? found.color : '#6366f1';
    if (target === 'outfit') user.pet.outfitColor = color;
    else user.pet.color = color;
    await user.save();
    res.json({ success: true, pet: user.pet, inventory: user.inventory });
  } catch (e) {
    console.error('pet/paint error', e);
    res.status(500).json({ error: 'Paint failed' });
  }
});

// Equip outfit (consume outfit item and set outfit color)
app.post('/api/pet/equip', authenticateToken, async (req, res) => {
  try {
    const { outfitId } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureInventoryArrays(user);
    if (!user.pet) user.pet = { name: 'Robotcha', color: '#6366f1', outfitColor: '#ec4899', hunger: 60, xp: 0, level: 1 };
    const ok = invConsume(user.inventory.outfits, outfitId);
    if (!ok) return res.status(400).json({ error: 'Kiyim inventarda yo‘q yoki tugagan' });
    const found = PET_MARKET.outfits.find(x => x.id === outfitId);
    user.pet.outfitColor = (found && found.color) ? found.color : user.pet.outfitColor;
    await user.save();
    res.json({ success: true, pet: user.pet, inventory: user.inventory });
  } catch (e) {
    console.error('pet/equip error', e);
    res.status(500).json({ error: 'Equip failed' });
  }
});
// Equip companion (cute animal)
app.post('/api/companions/equip', authenticateToken, async (req, res) => {
  try {
    const { companionId } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureCompanions(user);
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const found = (user.companions || []).find(c => c._id && String(c._id) === String(companionId));
    if (!found) return res.status(404).json({ error: 'Companion not found' });

    user.activeCompanionId = String(found._id);
    (user.companions || []).forEach(c => c.equipped = (c._id && String(c._id) === String(found._id)));
    await user.save();
    res.json({ success: true, activeCompanionId: user.activeCompanionId, companions: user.companions });
  } catch (e) {
    console.error('companions/equip error', e);
    res.status(500).json({ error: 'Equip failed' });
  }
});



// ==================== WALLET / TOPUP REQUEST ====================
// Create topup request with screenshot (admin approves later)
app.post('/api/wallet/topup-request', authenticateToken, upload.single('screenshot'), async (req, res) => {
  try {
    const coins = parseInt(req.body.coins || '0', 10);
    if (!coins || coins <= 0) return res.status(400).json({ error: 'Coins miqdorini kiriting' });
    const amountSom = coins * 100; // 1 coin = 100 so'm
    const screenshotUrl = req.file ? ('/uploads/' + req.file.filename) : '';
    if (!screenshotUrl) return res.status(400).json({ error: 'To‘lov skrinshotini yuklang' });
    const r = await TopUpRequest.create({ userId: req.userId, coins, amountSom, screenshotUrl, status: 'pending' });
    res.json({ success: true, request: r });
  } catch (e) {
    console.error('topup-request error', e);
    res.status(500).json({ error: 'Topup request failed' });
  }
});

// My topup requests
app.get('/api/wallet/topup-requests', authenticateToken, async (req, res) => {
  try {
    const list = await TopUpRequest.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json({ success: true, requests: list });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// ==================== ADMIN (Topup Approvals) ====================
app.get('/api/admin/topup-requests', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const q = status ? { status } : {};
    const list = await TopUpRequest.find(q).populate('userId', 'username nickname fullName phone email avatar coins').sort({ createdAt: -1 });
    res.json({ success: true, requests: list });
  } catch (e) {
    console.error('admin/topup-requests error', e);
    res.status(500).json({ error: 'Failed to load admin requests' });
  }
});

app.post('/api/admin/topup-requests/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await TopUpRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });
    const user = await User.findById(r.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.coins = (user.coins || 0) + (r.coins || 0);
    await user.save();
    r.status = 'approved';
    r.reviewedBy = req.userId;
    r.reviewedAt = new Date();
    r.adminNote = req.body.adminNote || '';
    await r.save();
    res.json({ success: true, request: r, userCoins: user.coins });
  } catch (e) {
    console.error('approve error', e);
    res.status(500).json({ error: 'Approve failed' });
  }
});

app.post('/api/admin/topup-requests/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await TopUpRequest.findById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });
    r.status = 'rejected';
    r.reviewedBy = req.userId;
    r.reviewedAt = new Date();
    r.adminNote = req.body.adminNote || 'Rad etildi';
    await r.save();
    res.json({ success: true, request: r });
  } catch (e) {
    console.error('reject error', e);
    res.status(500).json({ error: 'Reject failed' });
  }
});

app.get('/api/admin/premium-requests', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = cleanText(req.query.status, 20);
    const planScope = normalizePremiumScope(req.query.planScope);
    const q = {};
    if (status) q.status = status;
    if (req.query.planScope) q.planScope = planScope;
    const list = await PremiumPaymentRequest.find(q)
      .populate('userId', 'username nickname fullName avatar university verified premium')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ success: true, requests: (list || []).map((item) => serializePremiumPaymentRequest(item)) });
  } catch (error) {
    console.error('GET /api/admin/premium-requests error:', error);
    res.status(500).json({ error: 'Failed to load premium requests' });
  }
});

app.post('/api/admin/premium-requests/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const record = await PremiumPaymentRequest.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Premium request not found' });
    if (String(record.status || '') !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });

    const user = await User.findById(record.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const plan = getPremiumPlanDefinition(record.planScope, record.planId);
    if (!plan) return res.status(400).json({ error: 'Plan not found' });

    if (String(record.planScope) === 'university') {
      applyInstitutionPremiumPlanToUserDoc(user, plan, record.billingCycle);
    } else {
      applyUserPremiumPlanToUserDoc(user, plan, record.billingCycle);
    }
    await user.save({ validateBeforeSave: false });

    record.status = 'approved';
    record.adminNote = cleanText(req.body?.adminNote, 400);
    record.reviewedBy = req.userId;
    record.reviewedAt = new Date();
    await record.save();

    await pushUserNotification(user._id, {
      type: 'billing',
      icon: 'fa-circle-check',
      title: 'Premium tasdiqlandi',
      body: `${record.planLabel} tarifi siz uchun faollashtirildi. Premium imkoniyatlar ochildi.`,
      link: '/settings-center.html',
      meta: { requestId: String(record._id || ''), planScope: record.planScope, planId: record.planId }
    }).catch(() => null);

    try {
      adminEmit('admin:premium:updated', { requestId: String(record._id || ''), status: 'approved' });
    } catch (_) {}

    res.json({
      success: true,
      request: serializePremiumPaymentRequest(record),
      premium: serializePremiumState(user)
    });
  } catch (error) {
    console.error('POST /api/admin/premium-requests/:id/approve error:', error);
    res.status(500).json({ error: 'Failed to approve premium request' });
  }
});

app.post('/api/admin/premium-requests/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const record = await PremiumPaymentRequest.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Premium request not found' });
    if (String(record.status || '') !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });
    record.status = 'rejected';
    record.adminNote = cleanText(req.body?.adminNote, 400) || 'Rad etildi';
    record.reviewedBy = req.userId;
    record.reviewedAt = new Date();
    await record.save();

    await pushUserNotification(record.userId, {
      type: 'billing',
      icon: 'fa-circle-xmark',
      title: 'Premium so‘rovi rad etildi',
      body: record.adminNote || 'Screenshot yoki ma’lumotlar qayta tekshirish uchun rad etildi.',
      link: '/payment.html'
    }).catch(() => null);

    try {
      adminEmit('admin:premium:updated', { requestId: String(record._id || ''), status: 'rejected' });
    } catch (_) {}

    res.json({ success: true, request: serializePremiumPaymentRequest(record) });
  } catch (error) {
    console.error('POST /api/admin/premium-requests/:id/reject error:', error);
    res.status(500).json({ error: 'Failed to reject premium request' });
  }
});

// Admin: update user coins directly
app.patch('/api/admin/users/:id/coins', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const delta = Number(req.body.delta || 0);
    const setTo = req.body.setTo;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (typeof setTo !== 'undefined') user.coins = Number(setTo);
    else user.coins = (user.coins || 0) + delta;
    await user.save();
    res.json({ success: true, userId: user._id, coins: user.coins });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update coins' });
  }
});

// Update user profile + moderation fields (ban/mute/role/verified/admin)
// Body supports: { fullName, nickname, bio, university, faculty, studyType, studyGroup, phone, email, role, isAdmin, verified, coins, banned, banReason, mutedUntil }
// NOTE: Actions are audited.
app.patch('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const body = req.body || {};

    const allow = [
      'fullName','nickname','avatar','bio','university','faculty','studyType','studyGroup','phone','email',
      'teachingSubject','teachingSubjects',
      'role','isAdmin','verified','coins',
      'banned','banReason','mutedUntil'
    ];

    const $set = {};
    for (const k of allow) {
      if (Object.prototype.hasOwnProperty.call(body, k)) $set[k] = body[k];
    }

    // Normalize types
    if (Object.prototype.hasOwnProperty.call($set, 'isAdmin')) $set.isAdmin = !!$set.isAdmin;
    if (Object.prototype.hasOwnProperty.call($set, 'verified')) $set.verified = !!$set.verified;
    if (Object.prototype.hasOwnProperty.call($set, 'banned')) $set.banned = !!$set.banned;
    if (Object.prototype.hasOwnProperty.call($set, 'coins')) $set.coins = Number($set.coins || 0);
    if (Object.prototype.hasOwnProperty.call($set, 'phone')) $set.phone = cleanText($set.phone, 30) || null;
    if (Object.prototype.hasOwnProperty.call($set, 'email')) $set.email = cleanText($set.email, 120).toLowerCase() || null;
    if (Object.prototype.hasOwnProperty.call($set, 'teachingSubject')) $set.teachingSubject = cleanText($set.teachingSubject, 80) || '';
    if (Object.prototype.hasOwnProperty.call($set, 'teachingSubjects')) {
      const raw = $set.teachingSubjects;
      if (Array.isArray(raw)) $set.teachingSubjects = raw.map((x) => cleanText(x, 80)).filter(Boolean);
      else $set.teachingSubjects = String(raw || '').split(',').map((x) => cleanText(x, 80)).filter(Boolean);
    }

    if (Object.prototype.hasOwnProperty.call($set, 'role')) {
      const r = String($set.role || '').toLowerCase();
      if (!['student','teacher','admin','organizer'].includes(r)) return res.status(400).json({ error: 'Invalid role' });
      $set.role = r;
    }

    if (Object.prototype.hasOwnProperty.call($set, 'mutedUntil')) {
      const v = $set.mutedUntil;
      if (!v) $set.mutedUntil = null;
      else {
        const d = new Date(v);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid mutedUntil date' });
        $set.mutedUntil = d;
      }
    }

    // Prevent locking yourself out: the last admin can't be demoted/banned.
    const target = await User.findById(id).select('_id username role isAdmin banned university faculty studyType studyGroup').lean();
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (
      Object.prototype.hasOwnProperty.call($set, 'university') ||
      Object.prototype.hasOwnProperty.call($set, 'faculty') ||
      Object.prototype.hasOwnProperty.call($set, 'studyType') ||
      Object.prototype.hasOwnProperty.call($set, 'studyGroup')
    ) {
      const nextUniversity = Object.prototype.hasOwnProperty.call($set, 'university')
        ? cleanText($set.university, 180)
        : cleanText(target.university, 180);
      const nextFaculty = Object.prototype.hasOwnProperty.call($set, 'faculty')
        ? cleanText($set.faculty, 180)
        : cleanText(target.faculty, 180);
      const nextStudyType = Object.prototype.hasOwnProperty.call($set, 'studyType')
        ? cleanText($set.studyType, 80)
        : cleanText(target.studyType, 80);
      const nextStudyGroup = Object.prototype.hasOwnProperty.call($set, 'studyGroup')
        ? cleanText($set.studyGroup, 80)
        : cleanText(target.studyGroup, 80);

      const academic = await normalizeAcademicIdentity({
        university: nextUniversity,
        faculty: nextFaculty,
        studyType: nextStudyType,
        studyGroup: nextStudyGroup
      }, {
        requireUniversity: true,
        requireFaculty: true,
        requireStudyType: true,
        requireStudyGroup: true
      });
      if (!academic.ok) return res.status(400).json({ error: academic.error });

      $set.university = academic.value.university;
      $set.faculty = academic.value.faculty;
      $set.studyType = academic.value.studyType;
      $set.studyGroup = academic.value.studyGroup;
    }

    const isTargetAdmin = !!(target.isAdmin || target.role === 'admin');
    if (isTargetAdmin) {
      // Count other admins
      const adminsCount = await User.countDocuments({ $or: [{ isAdmin: true }, { role: 'admin' }] });
      const willDemote = (Object.prototype.hasOwnProperty.call($set, 'isAdmin') && !$set.isAdmin) ||
                         (Object.prototype.hasOwnProperty.call($set, 'role') && $set.role !== 'admin');
      const willBan = (Object.prototype.hasOwnProperty.call($set, 'banned') && $set.banned);

      if (adminsCount <= 1 && (willDemote || willBan)) {
        return res.status(400).json({ error: 'Cannot demote/ban the last admin' });
      }
    }

    const updated = await User.findByIdAndUpdate(id, { $set }, { new: true })
      .select('username fullName nickname email avatar university faculty studyGroup teachingSubject teachingSubjects role isAdmin verified coins banned banReason mutedUntil isOnline status lastSeen createdAt')
      .lean();

    await audit(req, 'USER_UPDATE', 'user', id, { set: Object.keys($set) });

    // If user got banned/kicked -> disconnect their sockets
    if (updated?.banned) {
      try {
        const ids = getUserSocketIds(id);
        for (const sid of ids) io.to(sid).emit('force_logout', { reason: 'banned' });
        for (const sid of ids) io.sockets.sockets.get(sid)?.disconnect(true);
      } catch (_) {}
    }

    res.json({ success: true, user: updated });
  } catch (e) {
    console.error('PATCH /api/admin/users/:id error:', e);
    if (String(e?.code) === '11000') {
      return res.status(409).json({ error: 'Duplicate value (username/phone/email must be unique)' });
    }
    res.status(500).json({ error: 'Failed to update user' });
  }
});



// Admin: delete user (dangerous) + clean references
// Removes user document and pulls them from groups/channels; deletes their messages.
// NOTE: Group lessons/recordings are kept for audit/history (teacherId may point to missing user).
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Prevent self-delete
    if (String(req.userId) === id) return res.status(400).json({ error: 'You cannot delete yourself' });

    const target = await User.findById(id).select('_id username role isAdmin').lean();
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Do not allow deleting admins via UI (safety). You can change role first if needed.
    const isTargetAdmin = !!(target.isAdmin || target.role === 'admin');
    if (isTargetAdmin) return res.status(400).json({ error: 'Refusing to delete an admin account' });

    // Clean references
    await Promise.allSettled([
      Group.updateMany({ members: id }, { $pull: { members: id } }),
      Group.updateMany({ creatorId: id }, { $set: { creatorId: null } }),
      Channel.updateMany({ subscribers: id }, { $pull: { subscribers: id } }),
      Channel.updateMany({ admins: id }, { $pull: { admins: id } }),
      Message.deleteMany({ $or: [{ senderId: id }, { receiverId: id }] }),
      GroupMessage.deleteMany({ senderId: id }),
      ChannelPost.deleteMany({ authorId: id }),
      ChannelPostComment.deleteMany({ authorId: id })
    ]);

    // Disconnect any live sockets for the user
    try {
      const ids = getUserSocketIds(id);
      for (const sid of ids) io.to(sid).emit('force_logout', { reason: 'deleted' });
      for (const sid of ids) io.sockets.sockets.get(sid)?.disconnect(true);
    } catch (_) {}

    await User.findByIdAndDelete(id);
    await audit(req, 'USER_DELETE', 'user', id, { username: target.username });

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/admin/users/:id error:', e);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Bootstrap: set an admin (one-time) using secret env (optional but recommended)
// Usage: POST /api/admin/bootstrap { username, secret }
app.post('/api/admin/bootstrap', async (req, res) => {
  try {
    const { username, secret } = req.body || {};
    if (!process.env.ADMIN_BOOTSTRAP_SECRET) return res.status(400).json({ error: 'Bootstrap disabled' });
    if (secret !== process.env.ADMIN_BOOTSTRAP_SECRET) return res.status(403).json({ error: 'Invalid secret' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.isAdmin = true;
    await user.save();
    res.json({ success: true, adminUser: { id: user._id, username: user.username } });
  } catch (e) {
    res.status(500).json({ error: 'Bootstrap failed' });
  }
});


// ==================== ADMIN (Test / Smoke) ====================
// Quick sanity checks so you can verify auth + admin gating fast.
// Usage examples (Windows PowerShell):
//   $t="PASTE_TOKEN_HERE"
//   iwr http://localhost:3000/api/admin/ping -Headers @{Authorization="Bearer $t"}
//
// Or curl:
//   curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/admin/ping

app.get('/api/admin/ping', authenticateToken, requireAdmin, async (req, res) => {
  res.json({ success: true, message: 'admin pong', time: new Date().toISOString(), userId: req.user?.userId || req.user?.id || null });
});

// Who am I (includes admin flag + coins)
app.get('/api/admin/whoami', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // authenticateToken sets: req.userId
    const me = await User.findById(req.userId).select('username nickname fullName coins isAdmin role createdAt').lean();
    if (!me) return res.status(404).json({ error: 'User not found' });
    // keep response shape stable for frontend
    res.json({ success: true, admin: { _id: me._id, username: me.username, nickname: me.nickname, fullName: me.fullName, coins: me.coins, isAdmin: !!me.isAdmin, role: me.role, createdAt: me.createdAt } });
  } catch (e) {
    console.error('GET /api/admin/whoami error', e);
    res.status(500).json({ error: 'Failed to verify admin' });
  }
});


// Create a dummy pending topup request for your own user (for testing admin approval flow)
// Body: { "coins": 50 }  => creates pending request with placeholder screenshot URL
app.post('/api/admin/test/create-topup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const uid = req.user?.userId || req.user?.id;
    const coins = Math.max(1, parseInt(req.body?.coins || '50', 10));
    const amountSom = coins * 100;
    const r = await TopUpRequest.create({
      userId: uid,
      coins,
      amountSom,
      status: 'pending',
      screenshotUrl: '/uploads/test-proof.png',
      adminNote: 'TEST: auto-created'
    });
    res.json({ success: true, request: r });
  } catch (e) {
    console.error('admin test create-topup error', e);
    res.status(500).json({ error: 'Failed to create test topup' });
  }
});

// Seed/Reset your own pet stats quickly (for demo)
// Body: { "hunger": 40, "xp": 0, "level": 1 }
app.post('/api/admin/test/reset-pet', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const uid = req.user?.userId || req.user?.id;
    const hunger = Math.max(0, Math.min(100, parseInt(req.body?.hunger ?? 50, 10)));
    const xp = Math.max(0, parseInt(req.body?.xp ?? 0, 10));
    const level = Math.max(1, parseInt(req.body?.level ?? 1, 10));
    const pet = await Pet.findOneAndUpdate(
      { userId: uid },
      { $set: { hunger, xp, level, updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    res.json({ success: true, pet });
  } catch (e) {
    console.error('admin test reset-pet error', e);
    res.status(500).json({ error: 'Failed to reset pet' });
  }
});

// 
// ==================== LMS MODELS & APIs (Courses / Tests / Certificates) ====================
// Note: These routes are designed to work with the provided front-end pages:
// courses.html, course.html, joinedcourse.html, tests.html, test.html, certificate.html


// For compatibility with existing UI fields
function userGroup(u) { return u?.studyGroup || u?.group || ''; }
function userFaculty(u) { return u?.faculty || ''; }

function normalizeGroups(groups) {
  if (!groups) return [];
  if (Array.isArray(groups)) return groups.map(x => String(x).trim()).filter(Boolean);
  if (typeof groups === 'string') return groups.split(',').map(x => x.trim()).filter(Boolean);
  return [];
}

function parseQuestionsFromText(text) {
  // Same format as tests.html:
  // Q: ...
  // A) ...
  // B) ...
  // C) ...
  // D) ...
  // ANS: B
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let cur = null;

  const pushCur = () => {
    if (!cur) return;
    if (cur.text && cur.options.length >= 2 && cur.answerKey) out.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.toUpperCase().startsWith('Q:')) {
      pushCur();
      cur = { text: line.slice(2).trim(), options: [], answerKey: '' };
      continue;
    }
    if (!cur) continue;

    const m = line.match(/^([A-Da-d])\)\s*(.+)$/);
    if (m) {
      cur.options.push({ key: m[1].toUpperCase(), text: m[2].trim() });
      continue;
    }
    if (line.toUpperCase().startsWith('ANS:')) {
      cur.answerKey = (line.split(':')[1] || '').trim().toUpperCase();
      continue;
    }
    // continuation lines
    cur.text += ' ' + line;
  }
  pushCur();

  return out;
}

function computeScore(questions, answers = {}) {
  const total = questions.length;
  let correct = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = String(answers[q._id?.toString?.() || q.id || `q${i + 1}`] || '').toUpperCase();
    const key = String(q.answerKey || '').toUpperCase();
    if (a && key && a === key) correct++;
  }
  const pct = total ? Math.round((correct / total) * 100) : 0;
  return { total, correct, pct };
}

function makeSerial(prefix, sourceId) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rnd = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${String(prefix).toUpperCase()}-${yyyy}${mm}${dd}-${String(sourceId || 'X').slice(0, 6)}-${rnd}`;
}

function toObjectIdOrNull(value) {
  try {
    if (!value) return null;
    const s = String(value).trim();
    if (!mongoose.Types.ObjectId.isValid(s)) return null;
    return new mongoose.Types.ObjectId(s);
  } catch (_) {
    return null;
  }
}

function normalizeMoneyValue(rawValue) {
  const n = Number(rawValue || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function makeCertificateSecureKey(prefix = 'KEY') {
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${String(prefix || 'KEY').toUpperCase()}-${rand}`;
}

function buildCertificateHolderHash({ userId, fullName, facultyGroup, sourceId, secureKey }) {
  const payload = [
    String(userId || ''),
    String(fullName || '').trim(),
    String(facultyGroup || '').trim(),
    String(sourceId || '').trim(),
    String(secureKey || '').trim()
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function getCertificateSignSecret() {
  return String(process.env.CERT_SIGNING_SECRET || process.env.JWT_SECRET || 'schat_cert_secret');
}

function buildCertificateSignature({ certId, serial, userId, sourceId, secureKey, issuedAt }) {
  const body = [
    String(certId || ''),
    String(serial || ''),
    String(userId || ''),
    String(sourceId || ''),
    String(secureKey || ''),
    String(issuedAt instanceof Date ? issuedAt.toISOString() : (issuedAt || ''))
  ].join('|');
  return crypto.createHmac('sha256', getCertificateSignSecret()).update(body).digest('hex');
}

function buildCertificateVerifyUrl(certId, req) {
  const path = `/certificate.html?verify=${encodeURIComponent(String(certId || ''))}`;
  const origin = getPublicAppOrigin(req);
  return origin ? `${origin}${path}` : path;
}

function buildCertificateQrUrl(verifyUrl) {
  const text = encodeURIComponent(String(verifyUrl || ''));
  return `https://quickchart.io/qr?size=300&text=${text}`;
}

function getSubmissionPassPct(testDoc) {
  const p = Number(testDoc?.passPct || 60);
  if (!Number.isFinite(p)) return 60;
  return Math.max(1, Math.min(100, Math.round(p)));
}

function isYoutubeLikeUrl(url) {
  const v = String(url || '').toLowerCase();
  if (!v) return false;
  return v.includes('youtube.com/') || v.includes('youtu.be/');
}

function normalizeCourseMaterialEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const idRaw = String(raw._id || raw.id || '').trim();
  const id = mongoose.Types.ObjectId.isValid(idRaw) ? idRaw : '';
  const name = String(raw.name || raw.originalName || raw.fileName || '').trim().slice(0, 220);
  const url = String(raw.url || raw.secure_url || '').trim();
  if (!name || !url) return null;
  const mimeType = String(raw.mimeType || raw.mime || '').trim().slice(0, 140);
  const publicId = String(raw.publicId || '').trim().slice(0, 260);
  const sizeBytes = Math.max(0, Number(raw.sizeBytes || raw.size || 0) || 0);
  const textExtract = String(raw.textExtract || '').slice(0, COURSE_MATERIAL_MAX_TEXT_CHARS);
  return { ...(id ? { _id: id } : {}), name, url, mimeType, sizeBytes, textExtract, publicId };
}

function normalizeCourseMaterials(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const raw of rawList) {
    const item = normalizeCourseMaterialEntry(raw);
    if (!item) continue;
    if (out.length >= COURSE_MATERIAL_MAX_FILES) break;
    out.push(item);
  }
  return out;
}

function normalizeCourseShortText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeCourseLongText(value, max = 5000) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function normalizeCourseRatingValue(rawValue) {
  const n = Math.round(Number(rawValue || 0));
  if (!Number.isFinite(n)) return 0;
  return Math.max(1, Math.min(5, n));
}

function buildLessonQuizOptionKey(index) {
  return String.fromCharCode(65 + Math.max(0, Math.min(25, Number(index || 0))));
}

function normalizeCourseQuizOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) return [];
  const out = [];
  for (let i = 0; i < rawOptions.length; i += 1) {
    const option = rawOptions[i] || {};
    const text = normalizeCourseShortText(option.text || option.label || option.value || '', 240);
    if (!text) continue;
    const rawKey = String(option.key || '').trim().toUpperCase();
    const key = rawKey || buildLessonQuizOptionKey(out.length);
    out.push({ key, text });
    if (out.length >= COURSE_LESSON_QUIZ_MAX_OPTIONS) break;
  }
  return out;
}

function normalizeCourseQuizQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) return [];
  const out = [];
  for (let i = 0; i < rawQuestions.length; i += 1) {
    const question = rawQuestions[i] || {};
    const text = normalizeCourseLongText(question.text || question.question || '', 520);
    const options = normalizeCourseQuizOptions(question.options);
    if (!text || options.length < 2) continue;
    let answerKey = String(question.answerKey || question.correctKey || question.answer || '').trim().toUpperCase();
    if (!options.some((option) => option.key === answerKey)) {
      answerKey = String(options[0]?.key || 'A');
    }
    out.push({
      id: normalizeCourseShortText(question.id || `q${out.length + 1}`, 60) || `q${out.length + 1}`,
      text,
      options,
      answerKey,
      explanation: normalizeCourseLongText(question.explanation || '', 520)
    });
    if (out.length >= COURSE_LESSON_QUIZ_MAX_QUESTIONS) break;
  }
  return out;
}

function normalizeLessonQuizPayload(raw = {}) {
  const quizQuestions = normalizeCourseQuizQuestions(raw.quizQuestions || raw.questions);
  const rawQuizEnabled = raw.quizEnabled;
  const quizEnabled = rawQuizEnabled === true
    || String(rawQuizEnabled || '').toLowerCase() === 'true'
    || quizQuestions.length > 0;
  const passPct = Math.max(1, Math.min(100, Number(raw.quizPassPct || raw.passPct || 60) || 60));
  return {
    durationMinutes: Math.max(0, Number(raw.durationMinutes || raw.durationMin || 0) || 0),
    isPreview: raw.isPreview === true || String(raw.isPreview || '').toLowerCase() === 'true',
    quizEnabled: !!quizEnabled,
    quizTitle: normalizeCourseShortText(raw.quizTitle || raw.quizName || '', 180),
    quizPassPct: passPct,
    quizQuestions
  };
}

function sanitizeCourseContentForRole(rawItem, includeAnswers = false) {
  const item = rawItem && typeof rawItem.toObject === 'function'
    ? rawItem.toObject()
    : { ...(rawItem || {}) };
  const quizQuestions = normalizeCourseQuizQuestions(item.quizQuestions);
  item.durationMinutes = Math.max(0, Number(item.durationMinutes || 0) || 0);
  item.isPreview = !!item.isPreview;
  item.quizEnabled = !!(item.quizEnabled && quizQuestions.length);
  item.quizTitle = normalizeCourseShortText(item.quizTitle || '', 180);
  item.quizPassPct = Math.max(1, Math.min(100, Number(item.quizPassPct || 60) || 60));
  item.quizQuestions = quizQuestions.map((question) => includeAnswers ? question : ({
    id: String(question.id || ''),
    text: question.text,
    options: Array.isArray(question.options) ? question.options : []
  }));
  item.materials = normalizeCourseMaterials(item.materials);
  return item;
}

function buildCourseNotificationLink(courseId) {
  return `/course.html?id=${encodeURIComponent(String(courseId || ''))}`;
}

function getDisplayNameFromUser(user) {
  return normalizeCourseShortText(
    user?.fullName || user?.fullname || user?.name || user?.nickname || user?.username || 'Foydalanuvchi',
    120
  ) || 'Foydalanuvchi';
}

async function createUserNotification({ userId, title, body, link = '' }) {
  if (!userId) return null;
  const notification = await Notification.create({
    userId,
    title: normalizeCourseShortText(title || '', 180),
    body: normalizeCourseLongText(body || '', 600),
    link: String(link || '').trim().slice(0, 260)
  });
  emitToUser(String(userId), 'notification', notification);
  return notification;
}

async function enrollUserIntoCourse({ course, userId, role = 'student', enforceVisibility = true }) {
  const me = await User.findById(userId);
  if (!me) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const normalizedRole = String(role || 'student').toLowerCase();
  if (enforceVisibility && normalizedRole === 'student' && String(course?.status || '') !== 'published') {
    const err = new Error('Course is not published');
    err.status = 403;
    throw err;
  }

  let isSourceGroupStudent = false;
  if (normalizedRole === 'student') {
    const cFaculty = String(course?.faculty || '').trim();
    const uFaculty = String(userFaculty(me) || '').trim();
    if (cFaculty && uFaculty && cFaculty !== uFaculty) {
      const err = new Error('Course is for another faculty');
      err.status = 403;
      throw err;
    }
    const allowedGroups = (course?.groups || []).map((x) => String(x).trim()).filter(Boolean);
    const meGroup = String(userGroup(me) || '').trim();
    const sourceGroup = String(course?.sourceStudyGroup || '').trim();
    isSourceGroupStudent = !!(course?.freeForSourceGroup && meGroup && sourceGroup && meGroup.toLowerCase() === sourceGroup.toLowerCase());
    if (allowedGroups.length) {
      if (!meGroup) {
        const err = new Error('User group is missing');
        err.status = 403;
        throw err;
      }
      const allowed = allowedGroups.some((group) => group.toLowerCase() === meGroup.toLowerCase());
      if (!allowed && !isSourceGroupStudent) {
        const err = new Error('Course is not open for your group');
        err.status = 403;
        throw err;
      }
    }
  }

  const existed = await CourseEnrollment.findOne({ courseId: course._id, userId: me._id }).lean();
  if (existed) {
    return {
      success: true,
      alreadyJoined: true,
      paidAmount: Number(existed.paidAmount || 0),
      isSourceGroupStudent
    };
  }

  let paidAmount = 0;
  if (normalizedRole === 'student' && String(course?.type || 'free') === 'paid' && !isSourceGroupStudent) {
    const price = normalizeMoneyValue(course?.price || 0);
    if (price < 1) {
      const err = new Error('Invalid course price');
      err.status = 400;
      throw err;
    }
    if (Number(me.coins || 0) < price) {
      const err = new Error('Insufficient balance');
      err.status = 400;
      throw err;
    }

    paidAmount = price;
    const teacherShare = Math.floor(price * 0.5);
    const adminShare = price - teacherShare;
    me.coins = Number(me.coins || 0) - price;

    const teacher = await User.findById(course.teacherId);
    if (teacher) {
      teacher.teacherBalance = Number(teacher.teacherBalance || 0) + teacherShare;
      await teacher.save();
    }

    await PlatformWallet.findOneAndUpdate(
      { key: 'platform_wallet' },
      { $inc: { adminBalance: adminShare } },
      { upsert: true, new: true }
    );

    await me.save();
  }

  await CourseEnrollment.create({ courseId: course._id, userId: me._id, paidAmount });
  await Course.updateOne({ _id: course._id }, { $inc: { enrolledCount: 1 } });
  return { success: true, alreadyJoined: false, paidAmount, isSourceGroupStudent };
}

function buildCourseContentDocFromLesson(lesson, courseId, index) {
  const l = lesson || {};
  const rawType = String(l.type || l.kind || '').toLowerCase().trim();
  const url = String(l.url || l.link || '').trim();
  let youtubeUrl = String(l.youtubeUrl || '').trim();
  let videoUrl = String(l.videoUrl || '').trim();
  let pdfUrl = String(l.pdfUrl || '').trim();
  const text = String(l.text || l.body || '').trim();

  if (!youtubeUrl && !videoUrl && url) {
    if (isYoutubeLikeUrl(url)) youtubeUrl = url;
    else videoUrl = url;
  }
  if (!pdfUrl && rawType === 'pdf' && url) pdfUrl = url;

  let type = rawType;
  if (!['youtube', 'video', 'text', 'pdf'].includes(type)) {
    if (youtubeUrl) type = 'youtube';
    else if (videoUrl) type = 'video';
    else if (pdfUrl) type = 'pdf';
    else type = 'text';
  }

  if (type === 'video' && !videoUrl && youtubeUrl) videoUrl = youtubeUrl;
  if (type === 'youtube' && !youtubeUrl && videoUrl && isYoutubeLikeUrl(videoUrl)) youtubeUrl = videoUrl;
  const quizMeta = normalizeLessonQuizPayload(l);

  return {
    courseId,
    order: Number(l.order || (index + 1)),
    type,
    title: String(l.title || l.name || `Bolim ${index + 1}`).trim(),
    text: type === 'text' ? text : String(text || '').trim(),
    youtubeUrl: type === 'youtube' ? youtubeUrl : '',
    videoUrl: type === 'video' ? videoUrl : '',
    pdfUrl: type === 'pdf' ? pdfUrl : '',
    materials: normalizeCourseMaterials(l.materials),
    durationMinutes: quizMeta.durationMinutes,
    isPreview: quizMeta.isPreview,
    quizEnabled: quizMeta.quizEnabled,
    quizTitle: quizMeta.quizTitle,
    quizPassPct: quizMeta.quizPassPct,
    quizQuestions: quizMeta.quizQuestions
  };
}

function isProbablyReadableMime(mimeType, originalName) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (mime.includes('json') || mime.includes('xml') || mime.includes('yaml') || mime.includes('csv')) return true;
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.js', '.ts', '.css', '.yml', '.yaml', '.log'].includes(ext);
}

function extractReadableTextFromMaterial(file) {
  try {
    if (!file?.buffer) return '';
    const readAsUtf8 = () => {
      const raw = file.buffer.toString('utf8');
      if (!raw) return '';
      return raw
        .replace(/\u0000/g, '')
        .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    if (isProbablyReadableMime(file.mimetype, file.originalname)) {
      return readAsUtf8().slice(0, COURSE_MATERIAL_MAX_TEXT_CHARS);
    }

    // Heuristic fallback for binary formats (pdf/docx/pptx and similar):
    // extract human-readable fragments so AI can still build basic questions.
    const latin = file.buffer.toString('latin1');
    const chunks = latin.match(/[A-Za-z0-9\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F\s,.;:()_\-\/]{24,}/g) || [];
    const unique = [];
    for (const c of chunks) {
      const cleaned = String(c || '').replace(/\s+/g, ' ').trim();
      if (!cleaned || cleaned.length < 24) continue;
      if (unique.includes(cleaned)) continue;
      unique.push(cleaned);
      if (unique.length >= 20) break;
    }
    return unique.join('\n').slice(0, COURSE_MATERIAL_MAX_TEXT_CHARS);
  } catch (_) {
    return '';
  }
}

function uploadBufferToCloudinaryRaw({ buffer, fileName, folder, resourceType = 'raw' }) {
  return new Promise((resolve, reject) => {
    const safeBase = String(path.basename(fileName || 'material')).replace(/\.[^.]+$/, '') || 'material';
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folder || 'course_materials',
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
        filename_override: safeBase
      },
      (err, result) => {
        if (err) return reject(err);
        return resolve(result || {});
      }
    );
    Readable.from(buffer || Buffer.from('')).pipe(stream);
  });
}

function extractFirstJsonObjectFromText(text) {
  const src = String(text || '').trim();
  if (!src) return null;
  try { return JSON.parse(src); } catch (_) {}
  const m = src.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

function normalizeAiQuizQuestion(rawQuestion, fallbackTitle = 'Mavzu') {
  if (!rawQuestion || typeof rawQuestion !== 'object') return null;
  const text = String(rawQuestion.text || rawQuestion.question || '').trim();
  const answerRaw = String(rawQuestion.answerKey || rawQuestion.correctKey || '').trim().toUpperCase();

  let options = [];
  if (Array.isArray(rawQuestion.options)) {
    options = rawQuestion.options.map((x, i) => {
      if (x && typeof x === 'object') {
        const key = String(x.key || x.id || String.fromCharCode(65 + i)).trim().toUpperCase();
        const optText = String(x.text || '').trim();
        return { key, text: optText };
      }
      const key = String.fromCharCode(65 + i);
      return { key, text: String(x || '').trim() };
    });
  }
  options = options.filter((x) => x.key && x.text).slice(0, 6);
  if (!text || options.length < 2) return null;

  let answerKey = answerRaw;
  if (!answerKey || !options.some((x) => x.key === answerKey)) {
    answerKey = options[0].key;
  }

  return {
    id: String(rawQuestion.id || `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`),
    text,
    options,
    answerKey,
    explanation: String(rawQuestion.explanation || `Savol ${fallbackTitle} mavzusiga asoslangan.`).trim()
  };
}

function buildFallbackAiQuizQuestion(contentDoc, questionIndex = 1) {
  const title = String(contentDoc?.title || 'Mavzu').trim();
  return {
    id: `fallback_${Date.now().toString(36)}_${questionIndex}`,
    text: `${questionIndex}-savol: "${title}" darsining asosiy mavzusi qaysi javobda to'g'ri berilgan?`,
    options: [
      { key: 'A', text: title || 'Ushbu dars mavzusi' },
      { key: 'B', text: 'Mavzuga boglanmagan umumiy javob' },
      { key: 'C', text: 'Faqat yakuniy test natijasi' },
      { key: 'D', text: 'Faqat amaliy topshiriq nomi' }
    ],
    answerKey: 'A',
    explanation: 'Togri javob darsning sarlavhasi va mazmuniga mos boladi.'
  };
}

function buildCourseContentStudyText(contentDoc) {
  const parts = [];
  const title = String(contentDoc?.title || '').trim();
  if (title) parts.push(`Mavzu: ${title}`);
  const text = String(contentDoc?.text || '').trim();
  if (text) parts.push(`Matn: ${text}`);
  const materials = Array.isArray(contentDoc?.materials) ? contentDoc.materials : [];
  if (materials.length) {
    const names = materials.map((m) => String(m?.name || '').trim()).filter(Boolean);
    if (names.length) parts.push(`Materiallar: ${names.join(', ')}`);
    const readable = materials
      .map((m) => String(m?.textExtract || '').trim())
      .filter(Boolean)
      .join('\n');
    if (readable) parts.push(`Material matni: ${readable}`);
  }
  return parts.join('\n').slice(0, COURSE_AI_SOURCE_MAX_CHARS);
}

// ---------- Schemas ----------
const CourseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  type: { type: String, enum: ['free', 'paid'], default: 'free' },
  price: { type: Number, default: 0, min: 0 },
  pricingCurrency: { type: String, default: 'UZS' }, // display currency (so'm)
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  joinMode: { type: String, enum: ['open', 'approval'], default: 'open' },
  allowComments: { type: Boolean, default: true },
  allowRatings: { type: Boolean, default: true },
  allowSequential: { type: Boolean, default: true },
  category: { type: String, default: '', trim: true },
  level: { type: String, default: 'beginner', trim: true }, // beginner/intermediate/advanced
  language: { type: String, default: 'uz', trim: true },
  durationMinutes: { type: Number, default: 0, min: 0 },
  tags: { type: [String], default: [] },
  requirements: { type: String, default: '', trim: true },
  outcomes: { type: String, default: '', trim: true },
  faculty: { type: String, default: '', trim: true },
  groups: { type: [String], default: [] }, // empty => open for all groups (within faculty rule if faculty set)
  youtubeUrl: { type: String, default: '', trim: true },
  coverUrl: { type: String, default: '', trim: true },
  sourceGroupLessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupLesson', default: null, index: true },
  sourceGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null, index: true },
  sourceUniversity: { type: String, default: '', trim: true },
  sourceFaculty: { type: String, default: '', trim: true },
  sourceStudyGroup: { type: String, default: '', trim: true },
  freeForSourceGroup: { type: Boolean, default: true },
  importedFromRecordedLesson: { type: Boolean, default: false },
  testIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Test' }],
  finalTestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', default: null },

  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacherName: { type: String, default: '' }, // cached

  enrolledCount: { type: Number, default: 0 }
}, { timestamps: true });

const CourseContentSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  order: { type: Number, default: 1 },
  type: { type: String, enum: ['youtube', 'video', 'text', 'pdf'], required: true },
  title: { type: String, default: 'Bo‘lim', trim: true },
  text: { type: String, default: '' },
  youtubeUrl: { type: String, default: '' },
  videoUrl: { type: String, default: '' },
  pdfUrl: { type: String, default: '' },
  durationMinutes: { type: Number, default: 0, min: 0 },
  isPreview: { type: Boolean, default: false },
  quizEnabled: { type: Boolean, default: false },
  quizTitle: { type: String, default: '', trim: true },
  quizPassPct: { type: Number, default: 60, min: 1, max: 100 },
  quizQuestions: {
    type: [{
      id: { type: String, default: '' },
      text: { type: String, default: '' },
      options: [{
        key: { type: String, default: '' },
        text: { type: String, default: '' }
      }],
      answerKey: { type: String, default: '' },
      explanation: { type: String, default: '' }
    }],
    default: []
  },
  materials: {
    type: [{
      name: { type: String, default: '', trim: true },
      url: { type: String, default: '', trim: true },
      mimeType: { type: String, default: '', trim: true },
      sizeBytes: { type: Number, default: 0, min: 0 },
      textExtract: { type: String, default: '' },
      publicId: { type: String, default: '', trim: true }
    }],
    default: []
  }
}, { timestamps: true });

const CourseEnrollmentSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  joinedAt: { type: Date, default: Date.now },
  paidAmount: { type: Number, default: 0 }
}, { timestamps: true });
CourseEnrollmentSchema.index({ courseId: 1, userId: 1 }, { unique: true });

const CourseProgressSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  progress: { type: mongoose.Schema.Types.Mixed, default: {} }, // { contentId: true }
  testsPassed: { type: mongoose.Schema.Types.Mixed, default: {} }, // { testId: true }
  lessonQuizResults: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastLessonId: { type: String, default: '' },
  lastActivityAt: { type: Date, default: Date.now }
}, { timestamps: true });
CourseProgressSchema.index({ courseId: 1, userId: 1 }, { unique: true });

const CourseRatingSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  authorName: { type: String, default: '', trim: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  reviewText: { type: String, default: '' }
}, { timestamps: true });
CourseRatingSchema.index({ courseId: 1, userId: 1 }, { unique: true });

const CourseCommentSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  authorName: { type: String, default: '', trim: true },
  authorRole: { type: String, default: 'student', trim: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CourseComment', default: null, index: true },
  body: { type: String, default: '' }
}, { timestamps: true });
CourseCommentSchema.index({ courseId: 1, createdAt: -1 });

const CourseEnrollmentRequestSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  message: { type: String, default: '' },
  reviewNote: { type: String, default: '' },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });
CourseEnrollmentRequestSchema.index({ courseId: 1, userId: 1 }, { unique: true });

const TestSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  subject: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  faculty: { type: String, default: '' },
  groups: { type: [String], default: [] },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null, index: true },
  phase: { type: String, enum: ['during', 'after'], default: 'after', index: true },
  passPct: { type: Number, default: 60, min: 1, max: 100 },
  timeMin: { type: Number, default: 0, min: 0 },
  isFinal: { type: Boolean, default: false },

  // Either store structured questions, or raw text
  questions: {
    type: [{
      id: { type: String, default: '' },
      text: { type: String, required: true },
      options: [{ key: { type: String }, text: { type: String } }],
      answerKey: { type: String, required: true }
    }],
    default: []
  },
  questionsText: { type: String, default: '' },

  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacherName: { type: String, default: '' }
}, { timestamps: true });

const TestSubmissionSchema = new mongoose.Schema({
  testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  answers: { type: mongoose.Schema.Types.Mixed, default: {} },
  score: { type: Number, default: 0 },   // percent
  correct: { type: Number, default: 0 },
  total: { type: Number, default: 0 }
}, { timestamps: true });

const CertificateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['course', 'test'], required: true },
  sourceId: { type: String, required: true }, // courseId or testId as string
  title: { type: String, default: '' }, // course/test title cached
  fullName: { type: String, default: '' },
  facultyGroup: { type: String, default: '' },
  courseTitle: { type: String, default: '' },
  teacherName: { type: String, default: '' },
  dateISO: { type: String, default: '' },
  score: { type: Number, default: null }, // for tests
  serial: { type: String, required: true, unique: true },
  certId: { type: String, default: '', index: true },
  verifyUrl: { type: String, default: '' },
  qrCodeUrl: { type: String, default: '' },
  secureKey: { type: String, default: '' }, // unique per certificate, shown to owner
  holderHash: { type: String, default: '' }, // binds cert to exact person profile
  signature: { type: String, default: '', index: true }, // HMAC-like signature
  issuedByTeacher: { type: String, default: '' },
  issuedByPlatform: { type: String, default: 'HALLAYM edu' },
  issuedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const WebsiteProjectSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  startupName: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, unique: true, index: true },
  prompt: { type: String, default: '' },
  audience: { type: String, default: '' },
  category: { type: String, default: '' },
  tone: { type: String, default: '' },
  templateId: { type: String, default: 'startup-pitch' },
  seoTitle: { type: String, default: '' },
  seoDescription: { type: String, default: '' },
  kicker: { type: String, default: '' },
  summary: { type: String, default: '' },
  brandLine: { type: String, default: '' },
  heroTitle: { type: String, default: '' },
  heroSubtitle: { type: String, default: '' },
  heroCardTitle: { type: String, default: '' },
  heroChecklist: { type: [String], default: [] },
  ctaPrimary: { type: String, default: '' },
  ctaSecondary: { type: String, default: '' },
  finalCtaTitle: { type: String, default: '' },
  finalCtaBody: { type: String, default: '' },
  finalCtaPrimary: { type: String, default: '' },
  finalCtaSecondary: { type: String, default: '' },
  highlights: { type: [String], default: [] },
  metrics: { type: mongoose.Schema.Types.Mixed, default: [] },
  sections: { type: mongoose.Schema.Types.Mixed, default: [] },
  registerCopy: { type: mongoose.Schema.Types.Mixed, default: {} },
  loginCopy: { type: mongoose.Schema.Types.Mixed, default: {} },
  accountCopy: { type: mongoose.Schema.Types.Mixed, default: {} },
  serverFeatures: { type: mongoose.Schema.Types.Mixed, default: {} },
  palette: { type: mongoose.Schema.Types.Mixed, default: {} },
  footerText: { type: String, default: '' },
  aiProvider: { type: String, default: 'template' },
  aiModel: { type: String, default: '' },
  generationMode: { type: String, default: 'template' },
  status: { type: String, enum: ['draft', 'published'], default: 'published', index: true },
  publishedAt: { type: Date, default: null },
  previewEnabled: { type: Boolean, default: true }
}, { timestamps: true });

const WebsiteMemberSchema = new mongoose.Schema({
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'WebsiteProject', required: true, index: true },
  fullName: { type: String, default: '' },
  email: { type: String, required: true, trim: true, index: true },
  company: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true });

WebsiteMemberSchema.index({ websiteId: 1, email: 1 }, { unique: true });

const WebsiteLeadSchema = new mongoose.Schema({
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'WebsiteProject', required: true, index: true },
  leadType: { type: String, enum: ['contact', 'waitlist'], required: true, index: true },
  name: { type: String, default: '' },
  email: { type: String, default: '', index: true },
  company: { type: String, default: '' },
  message: { type: String, default: '' }
}, { timestamps: true });

const PlatformWalletSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'platform_wallet' },
  adminBalance: { type: Number, default: 0 }
}, { timestamps: true });

// ---------- Models ----------
const Course = mongoose.models.Course || mongoose.model('Course', CourseSchema);
const CourseContent = mongoose.models.CourseContent || mongoose.model('CourseContent', CourseContentSchema);
const CourseEnrollment = mongoose.models.CourseEnrollment || mongoose.model('CourseEnrollment', CourseEnrollmentSchema);
const CourseProgress = mongoose.models.CourseProgress || mongoose.model('CourseProgress', CourseProgressSchema);
const CourseRating = mongoose.models.CourseRating || mongoose.model('CourseRating', CourseRatingSchema);
const CourseComment = mongoose.models.CourseComment || mongoose.model('CourseComment', CourseCommentSchema);
const CourseEnrollmentRequest = mongoose.models.CourseEnrollmentRequest || mongoose.model('CourseEnrollmentRequest', CourseEnrollmentRequestSchema);
const Test = mongoose.models.Test || mongoose.model('Test', TestSchema);
const TestSubmission = mongoose.models.TestSubmission || mongoose.model('TestSubmission', TestSubmissionSchema);
const Certificate = mongoose.models.Certificate || mongoose.model('Certificate', CertificateSchema);
const WebsiteProject = mongoose.models.WebsiteProject || mongoose.model('WebsiteProject', WebsiteProjectSchema);
const WebsiteMember = mongoose.models.WebsiteMember || mongoose.model('WebsiteMember', WebsiteMemberSchema);
const WebsiteLead = mongoose.models.WebsiteLead || mongoose.model('WebsiteLead', WebsiteLeadSchema);
const PlatformWallet = mongoose.models.PlatformWallet || mongoose.model('PlatformWallet', PlatformWalletSchema);

// ---------- Ensure User schema has faculty field (non-breaking) ----------
try {
  if (!UserSchema.path('faculty')) {
    UserSchema.add({ faculty: { type: String, default: '' } });
  }
} catch (e) { /* ignore */ }

// ---------- Attach role to requests for these routes ----------
app.use(['/api/courses', '/api/tests', '/api/certificates'], authenticateToken, attachUserRole);

// ==================== COURSES ====================

async function getCourseStatsMap(courseIds = []) {
  const normalizedIds = Array.from(
    new Set((courseIds || []).map((id) => String(id || '').trim()).filter((id) => mongoose.Types.ObjectId.isValid(id)))
  ).map((id) => new mongoose.Types.ObjectId(id));
  if (!normalizedIds.length) return new Map();

  const [ratingAgg, lessonAgg, commentAgg, pendingAgg] = await Promise.all([
    CourseRating.aggregate([
      { $match: { courseId: { $in: normalizedIds } } },
      { $group: { _id: '$courseId', average: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]),
    CourseContent.aggregate([
      { $match: { courseId: { $in: normalizedIds } } },
      { $group: { _id: '$courseId', count: { $sum: 1 } } }
    ]),
    CourseComment.aggregate([
      { $match: { courseId: { $in: normalizedIds } } },
      { $group: { _id: '$courseId', count: { $sum: 1 } } }
    ]),
    CourseEnrollmentRequest.aggregate([
      { $match: { courseId: { $in: normalizedIds }, status: 'pending' } },
      { $group: { _id: '$courseId', count: { $sum: 1 } } }
    ])
  ]);

  const map = new Map();
  for (const id of normalizedIds) {
    map.set(String(id), {
      ratingAverage: 0,
      ratingCount: 0,
      lessonCount: 0,
      commentCount: 0,
      pendingRequests: 0
    });
  }

  for (const row of ratingAgg || []) {
    const item = map.get(String(row?._id)) || {};
    item.ratingAverage = Number(row?.average || 0);
    item.ratingCount = Number(row?.count || 0);
    map.set(String(row?._id), item);
  }
  for (const row of lessonAgg || []) {
    const item = map.get(String(row?._id)) || {};
    item.lessonCount = Number(row?.count || 0);
    map.set(String(row?._id), item);
  }
  for (const row of commentAgg || []) {
    const item = map.get(String(row?._id)) || {};
    item.commentCount = Number(row?.count || 0);
    map.set(String(row?._id), item);
  }
  for (const row of pendingAgg || []) {
    const item = map.get(String(row?._id)) || {};
    item.pendingRequests = Number(row?.count || 0);
    map.set(String(row?._id), item);
  }

  return map;
}

async function getCourseViewerState(course, userId) {
  if (!course || !userId) {
    return {
      joined: false,
      requestStatus: '',
      pendingRequest: false,
      requestId: '',
      myRating: 0
    };
  }

  const [joinedDoc, requestDoc, ratingDoc] = await Promise.all([
    CourseEnrollment.findOne({ courseId: course._id, userId }).select('_id').lean(),
    CourseEnrollmentRequest.findOne({ courseId: course._id, userId }).sort({ updatedAt: -1 }).lean(),
    CourseRating.findOne({ courseId: course._id, userId }).select('rating').lean()
  ]);

  return {
    joined: !!joinedDoc,
    requestStatus: String(requestDoc?.status || ''),
    pendingRequest: String(requestDoc?.status || '') === 'pending',
    requestId: requestDoc?._id ? String(requestDoc._id) : '',
    myRating: Number(ratingDoc?.rating || 0)
  };
}

// List courses
app.get('/api/courses', async (req, res) => {
  try {
    const role = (req.userRole || 'student').toLowerCase();
    const mine = String(req.query.mine || '') === '1';
    const teacherIdFilter = String(req.query.teacherId || req.query.teacher || '').trim();
    const includeDraftForOwner = String(req.query.includeDraft || '') === '1';

    let query = {};

    if (mine && req.userId) {
      query.teacherId = req.userId;
    } else if (teacherIdFilter && toObjectIdOrNull(teacherIdFilter)) {
      query.teacherId = toObjectIdOrNull(teacherIdFilter);
      if (!(role === 'admin' || (req.userId && String(req.userId) === String(teacherIdFilter) && includeDraftForOwner))) {
        query.status = 'published';
      }
    } else if (role === 'student') {
      query.status = 'published';
    } else if (role === 'teacher') {
      query = mine ? { teacherId: req.userId } : { $or: [{ teacherId: req.userId }, { status: 'published' }] };
    }

    const list = await Course.find(query).sort({ createdAt: -1 }).lean();
    const statsMap = await getCourseStatsMap(list.map((course) => course._id));
    const courses = list.map((course) => ({
      ...course,
      ...(statsMap.get(String(course._id)) || {})
    }));
    res.json({ courses });
  } catch (e) {
    console.error('GET /api/courses error:', e);
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

// Get one course
app.get('/api/courses/:id', async (req, res) => {
  try {
    const role = (req.userRole || 'student').toLowerCase();
    const c = await Course.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ error: 'Course not found' });

    if (role === 'student' && c.status !== 'published') {
      return res.status(403).json({ error: 'Course is not published' });
    }
    if (role === 'teacher' && String(c.teacherId || '') !== String(req.userId || '') && c.status !== 'published') {
      return res.status(403).json({ error: 'Course is not published' });
    }
    const statsMap = await getCourseStatsMap([c._id]);
    const viewer = await getCourseViewerState(c, req.userId);
    res.json({
      course: {
        ...c,
        ...(statsMap.get(String(c._id)) || {}),
        viewer,
        isOwner: String(c.teacherId || '') === String(req.userId || '')
      }
    });
  } catch (e) {
    console.error('GET /api/courses/:id error:', e);
    res.status(500).json({ error: 'Failed to load course' });
  }
});

// Create course (teacher/admin)
app.post('/api/courses', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const teacher = await User.findById(req.userId).select('fullName nickname username role');
    if (!teacher) return res.status(404).json({ error: 'User not found' });

    const groups = normalizeGroups(req.body.groups);
    const tags = Array.isArray(req.body.tags)
      ? req.body.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 24)
      : String(req.body.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 24);
    const type = (req.body.type || 'free').toLowerCase();
    const price = normalizeMoneyValue(req.body.price);
    const pricingCurrency = String(req.body.pricingCurrency || 'UZS').toUpperCase();
    const freeForSourceGroup = (req.body.freeForSourceGroup !== false);
    const joinMode = String(req.body.joinMode || 'open').toLowerCase() === 'approval' ? 'approval' : 'open';
    const allowComments = req.body.allowComments !== false;
    const allowRatings = req.body.allowRatings !== false;
    const allowSequential = req.body.allowSequential !== false;
    const testIdsInput = Array.isArray(req.body.testIds) ? req.body.testIds : [];
    const testIds = Array.from(new Set(testIdsInput.map((x) => String(x || '').trim()).filter((x) => mongoose.Types.ObjectId.isValid(x))))
      .map((x) => new mongoose.Types.ObjectId(x));
    const finalTestId = String(req.body.finalTestId || '').trim();
    const finalTestObjId = mongoose.Types.ObjectId.isValid(finalTestId) ? new mongoose.Types.ObjectId(finalTestId) : null;

    if (!req.body.title || !String(req.body.title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (type === 'paid' && (!Number.isFinite(price) || price < 1)) {
      return res.status(400).json({ error: 'paid course must have price >= 1' });
    }

    const course = await Course.create({
      title: String(req.body.title).trim(),
      description: String(req.body.description || '').trim(),
      type: type === 'paid' ? 'paid' : 'free',
      price: type === 'paid' ? price : 0,
      pricingCurrency,
      status: (req.body.status || 'draft') === 'published' ? 'published' : 'draft',
      joinMode,
      allowComments,
      allowRatings,
      allowSequential,
      category: String(req.body.category || '').trim(),
      level: String(req.body.level || 'beginner').trim().toLowerCase(),
      language: String(req.body.language || 'uz').trim().toLowerCase(),
      durationMinutes: Math.max(0, Number(req.body.durationMinutes || req.body.durationMin || 0) || 0),
      tags,
      requirements: String(req.body.requirements || '').trim(),
      outcomes: String(req.body.outcomes || '').trim(),
      faculty: String(req.body.faculty || '').trim(),
      groups,
      youtubeUrl: String(req.body.youtubeUrl || '').trim(),
      coverUrl: String(req.body.coverUrl || req.body.cover || req.body.previewImage || req.body.preview || '').trim(),
      sourceUniversity: String(req.body.sourceUniversity || '').trim(),
      sourceFaculty: String(req.body.sourceFaculty || '').trim(),
      sourceStudyGroup: String(req.body.sourceStudyGroup || '').trim(),
      freeForSourceGroup,
      sourceGroupLessonId: toObjectIdOrNull(req.body.sourceGroupLessonId),
      sourceGroupId: toObjectIdOrNull(req.body.sourceGroupId),
      importedFromRecordedLesson: !!req.body.importedFromRecordedLesson,
      testIds,
      finalTestId: finalTestObjId,
      teacherId: teacher._id,
      teacherName: teacher.fullName || teacher.nickname || teacher.username || 'Teacher'
    });


    // If client sends lessons[] (new UI), mirror them into CourseContent for joinedcourse.html
    if (Array.isArray(req.body.lessons) && req.body.lessons.length) {
      const docs = req.body.lessons
        .map((l, i) => buildCourseContentDocFromLesson(l, course._id, i))
        .filter((d) => d && d.title);
      if (docs.length) await CourseContent.insertMany(docs);
    }

    res.status(201).json({ course });
  } catch (e) {
    console.error('POST /api/courses error:', e);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

// Teacher/Admin: list own recorded group lessons (to import as course)
app.get('/api/teacher/group-lessons/recorded', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const role = String(req.userRole || '').toLowerCase();
    const hostIdQuery = String(req.query.hostId || '').trim();
    const hostId = (role === 'admin' && mongoose.Types.ObjectId.isValid(hostIdQuery))
      ? hostIdQuery
      : String(req.userId);

    const query = {
      hostId,
      recordingUrl: { $exists: true, $ne: '' }
    };

    const lessons = await GroupLesson.find(query).sort({ startedAt: -1 }).limit(200).lean();
    const groupIds = Array.from(new Set((lessons || []).map((l) => String(l.groupId || '')).filter(Boolean)));
    const groups = await Group.find({ _id: { $in: groupIds } }).select('name username university faculty studyType studyGroup').lean();
    const groupMap = new Map(groups.map((g) => [String(g._id), g]));

    const items = (lessons || []).map((l) => {
      const g = groupMap.get(String(l.groupId || '')) || {};
      return {
        lessonId: String(l._id),
        groupId: String(l.groupId || ''),
        groupName: String(g.name || ''),
        groupUsername: String(g.username || ''),
        university: String(g.university || ''),
        faculty: String(g.faculty || ''),
        studyType: String(g.studyType || ''),
        studyGroup: String(g.studyGroup || ''),
        title: String(l.title || 'Recorded lesson'),
        mode: String(l.mode || 'camera'),
        recordingUrl: String(l.recordingUrl || ''),
        startedAt: l.startedAt,
        endedAt: l.endedAt
      };
    });

    res.json({ success: true, items });
  } catch (e) {
    console.error('GET /api/teacher/group-lessons/recorded error:', e);
    res.status(500).json({ error: 'Failed to load recorded lessons' });
  }
});

// Teacher/Admin: create a course from previously recorded own group lesson
app.post('/api/courses/from-group-lesson', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const role = String(req.userRole || '').toLowerCase();
    const lessonId = String(req.body.lessonId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(lessonId)) return res.status(400).json({ error: 'lessonId required' });

    const lesson = await GroupLesson.findById(lessonId).lean();
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    if (!String(lesson.recordingUrl || '').trim()) return res.status(400).json({ error: 'Lesson has no recording yet' });

    if (role !== 'admin' && String(lesson.hostId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Only lesson host teacher can import this recording' });
    }

    const teacher = await User.findById(req.userId).select('fullName nickname username').lean();
    if (!teacher) return res.status(404).json({ error: 'User not found' });

    const group = await Group.findById(String(lesson.groupId || '')).select('name university faculty studyType studyGroup').lean();

    const type = String(req.body.type || 'free').toLowerCase() === 'paid' ? 'paid' : 'free';
    const price = normalizeMoneyValue(req.body.price || 0);
    if (type === 'paid' && price < 1) return res.status(400).json({ error: 'Paid course price must be at least 1' });
    const tags = Array.isArray(req.body.tags)
      ? req.body.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 24)
      : String(req.body.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 24);

    const title = String(req.body.title || '').trim() || String(lesson.title || '').trim() || 'Recorded lesson course';
    const description = String(req.body.description || '').trim()
      || 'Group live recording converted to course format.';
    const status = String(req.body.status || 'draft') === 'published' ? 'published' : 'draft';
    const freeForSourceGroup = (req.body.freeForSourceGroup !== false);
    const extraGroups = normalizeGroups(req.body.groups);
    const sourceStudyGroup = String(group?.studyGroup || '').trim();
    const groups = Array.from(new Set([...(sourceStudyGroup ? [sourceStudyGroup] : []), ...extraGroups]));

    const testIdsInput = Array.isArray(req.body.testIds) ? req.body.testIds : [];
    const testIds = Array.from(new Set(testIdsInput.map((x) => String(x || '').trim()).filter((x) => mongoose.Types.ObjectId.isValid(x))))
      .map((x) => new mongoose.Types.ObjectId(x));
    const finalTestIdRaw = String(req.body.finalTestId || '').trim();
    const finalTestId = mongoose.Types.ObjectId.isValid(finalTestIdRaw) ? new mongoose.Types.ObjectId(finalTestIdRaw) : null;

    const course = await Course.create({
      title,
      description,
      type,
      price: type === 'paid' ? price : 0,
      pricingCurrency: String(req.body.pricingCurrency || 'UZS').toUpperCase(),
      status,
      category: String(req.body.category || 'recorded-lesson').trim(),
      level: String(req.body.level || 'intermediate').trim().toLowerCase(),
      language: String(req.body.language || 'uz').trim().toLowerCase(),
      durationMinutes: Math.max(0, Number(req.body.durationMinutes || req.body.durationMin || 0) || 0),
      tags,
      requirements: String(req.body.requirements || '').trim(),
      outcomes: String(req.body.outcomes || '').trim(),
      faculty: String(req.body.faculty || group?.faculty || '').trim(),
      groups,
      coverUrl: String(req.body.coverUrl || req.body.previewImage || '').trim(),
      teacherId: req.userId,
      teacherName: teacher.fullName || teacher.nickname || teacher.username || 'Teacher',
      sourceGroupLessonId: lesson._id,
      sourceGroupId: toObjectIdOrNull(lesson.groupId),
      sourceUniversity: String(group?.university || '').trim(),
      sourceFaculty: String(group?.faculty || '').trim(),
      sourceStudyGroup: sourceStudyGroup,
      freeForSourceGroup,
      importedFromRecordedLesson: true,
      testIds,
      finalTestId
    });

    const recordedUrl = String(lesson.recordingUrl || '').trim();
    const contentType = isYoutubeLikeUrl(recordedUrl) ? 'youtube' : 'video';
    await CourseContent.create({
      courseId: course._id,
      order: 1,
      type: contentType,
      title: 'Recorded live lesson',
      youtubeUrl: contentType === 'youtube' ? recordedUrl : '',
      videoUrl: contentType === 'video' ? recordedUrl : '',
      text: '',
      pdfUrl: ''
    });

    res.status(201).json({
      success: true,
      course,
      importedFromLesson: {
        lessonId: String(lesson._id),
        groupId: String(lesson.groupId || ''),
        recordingUrl: recordedUrl
      }
    });
  } catch (e) {
    console.error('POST /api/courses/from-group-lesson error:', e);
    res.status(500).json({ error: 'Failed to import recorded lesson as course' });
  }
});

// Update course (owner teacher/admin)
app.put('/api/courses/:id', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const role = (req.userRole || '').toLowerCase();
    const c = await Course.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Course not found' });

    if (role === 'teacher' && String(c.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    if (req.body.title !== undefined) c.title = String(req.body.title).trim();
    if (req.body.description !== undefined) c.description = String(req.body.description || '').trim();
    if (req.body.status !== undefined) c.status = (req.body.status === 'published') ? 'published' : 'draft';
    if (req.body.joinMode !== undefined) c.joinMode = String(req.body.joinMode || 'open').toLowerCase() === 'approval' ? 'approval' : 'open';
    if (req.body.allowComments !== undefined) c.allowComments = req.body.allowComments !== false;
    if (req.body.allowRatings !== undefined) c.allowRatings = req.body.allowRatings !== false;
    if (req.body.allowSequential !== undefined) c.allowSequential = req.body.allowSequential !== false;
    if (req.body.category !== undefined) c.category = String(req.body.category || '').trim();
    if (req.body.level !== undefined) c.level = String(req.body.level || 'beginner').trim().toLowerCase();
    if (req.body.language !== undefined) c.language = String(req.body.language || 'uz').trim().toLowerCase();
    if (req.body.durationMinutes !== undefined || req.body.durationMin !== undefined) {
      c.durationMinutes = Math.max(0, Number(req.body.durationMinutes ?? req.body.durationMin ?? 0) || 0);
    }
    if (req.body.tags !== undefined) {
      c.tags = Array.isArray(req.body.tags)
        ? req.body.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 24)
        : String(req.body.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 24);
    }
    if (req.body.requirements !== undefined) c.requirements = String(req.body.requirements || '').trim();
    if (req.body.outcomes !== undefined) c.outcomes = String(req.body.outcomes || '').trim();
    if (req.body.faculty !== undefined) c.faculty = String(req.body.faculty || '').trim();
    if (req.body.groups !== undefined) c.groups = normalizeGroups(req.body.groups);
    if (req.body.youtubeUrl !== undefined) c.youtubeUrl = String(req.body.youtubeUrl || '').trim();
    if (
      req.body.coverUrl !== undefined ||
      req.body.cover !== undefined ||
      req.body.previewImage !== undefined ||
      req.body.preview !== undefined
    ) {
      c.coverUrl = String(
        req.body.coverUrl ||
        req.body.cover ||
        req.body.previewImage ||
        req.body.preview ||
        ''
      ).trim();
    }
    if (req.body.pricingCurrency !== undefined) c.pricingCurrency = String(req.body.pricingCurrency || 'UZS').toUpperCase();
    if (req.body.freeForSourceGroup !== undefined) c.freeForSourceGroup = (req.body.freeForSourceGroup !== false);
    if (req.body.sourceUniversity !== undefined) c.sourceUniversity = String(req.body.sourceUniversity || '').trim();
    if (req.body.sourceFaculty !== undefined) c.sourceFaculty = String(req.body.sourceFaculty || '').trim();
    if (req.body.sourceStudyGroup !== undefined) c.sourceStudyGroup = String(req.body.sourceStudyGroup || '').trim();

    if (req.body.testIds !== undefined) {
      const arr = Array.isArray(req.body.testIds) ? req.body.testIds : [];
      c.testIds = Array.from(new Set(arr.map((x) => String(x || '').trim()).filter((x) => mongoose.Types.ObjectId.isValid(x))))
        .map((x) => new mongoose.Types.ObjectId(x));
    }
    if (req.body.finalTestId !== undefined) {
      const v = String(req.body.finalTestId || '').trim();
      c.finalTestId = mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : null;
    }

    if (req.body.type !== undefined) {
      const type = String(req.body.type).toLowerCase();
      const price = normalizeMoneyValue(req.body.price || c.price || 0);
      if (type === 'paid') {
        if (!Number.isFinite(price) || price < 1) return res.status(400).json({ error: 'price >= 1 required for paid' });
        c.type = 'paid';
        c.price = price;
      } else {
        c.type = 'free';
        c.price = 0;
      }
    } else if (req.body.price !== undefined && c.type === 'paid') {
      const price = normalizeMoneyValue(req.body.price || 0);
      if (!Number.isFinite(price) || price < 1) return res.status(400).json({ error: 'price >= 1 required' });
      c.price = price;
    }

    await c.save();

    if (req.body.lessons !== undefined) {
      const lessons = Array.isArray(req.body.lessons) ? req.body.lessons : [];
      await CourseContent.deleteMany({ courseId: c._id });
      const docs = lessons
        .map((l, i) => buildCourseContentDocFromLesson(l, c._id, i))
        .filter((d) => d && d.title);
      if (docs.length) await CourseContent.insertMany(docs);
    }

    res.json({ course: c });
  } catch (e) {
    console.error('PUT /api/courses/:id error:', e);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

app.delete('/api/courses/:id', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const role = String(req.userRole || '').toLowerCase();
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const contents = await CourseContent.find({ courseId: course._id }).select('materials').lean();
    for (const content of contents || []) {
      const materials = Array.isArray(content?.materials) ? content.materials : [];
      for (const material of materials) {
        if (material?.publicId) {
          cloudinary.uploader.destroy(String(material.publicId), { resource_type: 'raw', invalidate: true }).catch(() => null);
        }
      }
    }

    await Promise.all([
      CourseContent.deleteMany({ courseId: course._id }),
      CourseEnrollment.deleteMany({ courseId: course._id }),
      CourseEnrollmentRequest.deleteMany({ courseId: course._id }),
      CourseProgress.deleteMany({ courseId: course._id }),
      CourseRating.deleteMany({ courseId: course._id }),
      CourseComment.deleteMany({ courseId: course._id }),
      Course.deleteOne({ _id: course._id })
    ]);

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/courses/:id error:', e);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// Join course (student)
app.post('/api/courses/:id/join', authenticateToken, attachUserRole, requireRole(['student', 'admin', 'teacher']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const role = String(req.userRole || 'student').toLowerCase();

    if (role === 'student' && String(course.joinMode || 'open') === 'approval') {
      const existing = await CourseEnrollment.findOne({ courseId: course._id, userId: req.userId }).lean();
      if (existing) return res.json({ success: true, alreadyJoined: true, joined: true });

      const message = normalizeCourseLongText(req.body?.message || '', COURSE_REQUEST_MAX_CHARS);
      const requestDoc = await CourseEnrollmentRequest.findOneAndUpdate(
        { courseId: course._id, userId: req.userId },
        {
          $set: {
            teacherId: course.teacherId,
            status: 'pending',
            message,
            reviewNote: '',
            reviewedAt: null,
            reviewedBy: null
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (String(course.teacherId || '') !== String(req.userId || '')) {
        await createUserNotification({
          userId: course.teacherId,
          title: 'Yangi kurs so\'rovi',
          body: `Kurs: ${course.title}. Talaba qo'shilish uchun so'rov yubordi.`,
          link: `/course-progress.html?id=${encodeURIComponent(String(course._id))}`
        });
      }

      return res.json({
        success: true,
        requested: true,
        status: 'pending',
        requestId: String(requestDoc?._id || '')
      });
    }

    const result = await enrollUserIntoCourse({ course, userId: req.userId, role });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('POST /api/courses/:id/join error:', e);
    if (String(e?.code) === '11000') return res.json({ success: true, alreadyJoined: true });
    res.status(Number(e?.status || 500)).json({ error: e?.message || 'Failed to join course' });
  }
});

// Course content list (joined students / owner teacher / admin)
app.get('/api/courses/:id/content', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = (req.userRole || 'student').toLowerCase();
    if (role === 'student') {
      const joined = await CourseEnrollment.findOne({ courseId: course._id, userId: req.userId }).lean();
      if (!joined) return res.status(403).json({ error: 'Not joined' });
    } else if (role === 'teacher') {
      if (String(course.teacherId) !== String(req.userId)) return res.status(403).json({ error: 'Not owner' });
    }

    const includeAnswers = role === 'admin' || (role === 'teacher' && String(course.teacherId) === String(req.userId));
    const items = await CourseContent.find({ courseId: course._id }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ items: items.map((item) => sanitizeCourseContentForRole(item, includeAnswers)) });
  } catch (e) {
    console.error('GET /api/courses/:id/content error:', e);
    res.status(500).json({ error: 'Failed to load course content' });
  }
});

// Add content (teacher owner/admin)
app.post('/api/courses/:id/content', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = (req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const type = String(req.body.type || '').toLowerCase();
    if (!['youtube', 'video', 'text', 'pdf'].includes(type)) return res.status(400).json({ error: 'Invalid content type' });

    const order = Number(req.body.order || 0);
    const maxOrder = await CourseContent.findOne({ courseId: course._id }).sort({ order: -1 }).lean();
    const nextOrder = Number.isFinite(order) && order > 0 ? order : ((maxOrder?.order || 0) + 1);
    const quizMeta = normalizeLessonQuizPayload(req.body || {});

    const item = await CourseContent.create({
      courseId: course._id,
      order: nextOrder,
      type,
      title: String(req.body.title || 'Bo‘lim').trim(),
      text: String(req.body.text || ''),
      youtubeUrl: String(req.body.youtubeUrl || ''),
      videoUrl: String(req.body.videoUrl || req.body.url || ''),
      pdfUrl: String(req.body.pdfUrl || ''),
      materials: normalizeCourseMaterials(req.body.materials),
      durationMinutes: quizMeta.durationMinutes,
      isPreview: quizMeta.isPreview,
      quizEnabled: quizMeta.quizEnabled,
      quizTitle: quizMeta.quizTitle,
      quizPassPct: quizMeta.quizPassPct,
      quizQuestions: quizMeta.quizQuestions
    });

    res.status(201).json({ item: sanitizeCourseContentForRole(item, true) });
  } catch (e) {
    console.error('POST /api/courses/:id/content error:', e);
    res.status(500).json({ error: 'Failed to add content' });
  }
});

// Update content (teacher owner/admin)
app.put('/api/courses/:id/content/:contentId', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = (req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const item = await CourseContent.findOne({ _id: req.params.contentId, courseId: req.params.id });
    if (!item) return res.status(404).json({ error: 'Content not found' });

    if (req.body.order !== undefined) item.order = Number(req.body.order || item.order);
    if (req.body.title !== undefined) item.title = String(req.body.title || '').trim();
    if (req.body.type !== undefined) {
      const t = String(req.body.type || '').toLowerCase();
      if (!['youtube', 'video', 'text', 'pdf'].includes(t)) return res.status(400).json({ error: 'Invalid content type' });
      item.type = t;
    }
    if (req.body.text !== undefined) item.text = String(req.body.text || '');
    if (req.body.youtubeUrl !== undefined) item.youtubeUrl = String(req.body.youtubeUrl || '');
    if (req.body.videoUrl !== undefined || req.body.url !== undefined) item.videoUrl = String(req.body.videoUrl || req.body.url || '');
    if (req.body.pdfUrl !== undefined) item.pdfUrl = String(req.body.pdfUrl || '');
    if (req.body.materials !== undefined) item.materials = normalizeCourseMaterials(req.body.materials);
    if (
      req.body.durationMinutes !== undefined ||
      req.body.durationMin !== undefined ||
      req.body.isPreview !== undefined ||
      req.body.quizEnabled !== undefined ||
      req.body.quizTitle !== undefined ||
      req.body.quizName !== undefined ||
      req.body.quizPassPct !== undefined ||
      req.body.passPct !== undefined ||
      req.body.quizQuestions !== undefined ||
      req.body.questions !== undefined
    ) {
      const quizMeta = normalizeLessonQuizPayload({ ...item.toObject(), ...req.body });
      item.durationMinutes = quizMeta.durationMinutes;
      item.isPreview = quizMeta.isPreview;
      item.quizEnabled = quizMeta.quizEnabled;
      item.quizTitle = quizMeta.quizTitle;
      item.quizPassPct = quizMeta.quizPassPct;
      item.quizQuestions = quizMeta.quizQuestions;
    }

    await item.save();
    res.json({ item: sanitizeCourseContentForRole(item, true) });
  } catch (e) {
    console.error('PUT /api/courses/:id/content/:contentId error:', e);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// Delete content (teacher owner/admin)
app.delete('/api/courses/:id/content/:contentId', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = (req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    await CourseContent.deleteOne({ _id: req.params.contentId, courseId: req.params.id });
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/courses/:id/content/:contentId error:', e);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

app.post('/api/courses/:id/content/:contentId/asset', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), upload.single('file'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = String(req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const item = await CourseContent.findOne({ _id: req.params.contentId, courseId: req.params.id });
    if (!item) return res.status(404).json({ error: 'Content not found' });
    if (!req.file) return res.status(400).json({ error: 'file required' });

    const ext = String(path.extname(req.file.originalname || '') || '').toLowerCase();
    const mime = String(req.file.mimetype || '').toLowerCase();
    const localUrl = `/uploads/${req.file.filename}`;
    const target = String(req.body?.target || 'auto').toLowerCase();
    const isPdf = mime.includes('pdf') || ext === '.pdf';
    const isVideo = mime.startsWith('video/') || ['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv'].includes(ext);
    const isImage = mime.startsWith('image/');

    if (target === 'cover' && isImage) {
      course.coverUrl = localUrl;
      await course.save();
      return res.json({ success: true, coverUrl: localUrl, course });
    }

    if ((target === 'pdf' || (target === 'auto' && isPdf))) {
      item.type = 'pdf';
      item.pdfUrl = localUrl;
      item.videoUrl = '';
      item.youtubeUrl = '';
    } else if ((target === 'video' || (target === 'auto' && isVideo))) {
      item.type = 'video';
      item.videoUrl = localUrl;
      item.youtubeUrl = '';
      item.pdfUrl = '';
    } else {
      const existing = normalizeCourseMaterials(item.materials);
      if (existing.length >= COURSE_MATERIAL_MAX_FILES) {
        return res.status(400).json({ error: 'Max 3 materials allowed per lesson' });
      }
      existing.push(normalizeCourseMaterialEntry({
        name: req.file.originalname || 'material',
        url: localUrl,
        mimeType: mime,
        sizeBytes: Number(req.file.size || 0),
        textExtract: '',
        publicId: ''
      }));
      item.materials = normalizeCourseMaterials(existing);
    }

    await item.save();
    res.json({ success: true, fileUrl: localUrl, item: sanitizeCourseContentForRole(item, true) });
  } catch (e) {
    console.error('POST /api/courses/:id/content/:contentId/asset error:', e);
    res.status(500).json({ error: 'Failed to upload lesson asset' });
  }
});

// Upload lesson materials (teacher owner/admin)
app.post('/api/courses/:id/content/:contentId/materials', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), withCourseMaterialUpload, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = String(req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const item = await CourseContent.findOne({ _id: req.params.contentId, courseId: req.params.id });
    if (!item) return res.status(404).json({ error: 'Content not found' });

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: 'No material files uploaded' });

    const existing = normalizeCourseMaterials(item.materials);
    if (existing.length + files.length > COURSE_MATERIAL_MAX_FILES) {
      return res.status(400).json({ error: 'Max 3 materials allowed per lesson' });
    }

    const created = [];
    for (const file of files) {
      if (Number(file.size || 0) > COURSE_MATERIAL_MAX_BYTES) {
        return res.status(400).json({ error: 'Each material file must be <= 5MB' });
      }

      const uploaded = await uploadBufferToCloudinaryRaw({
        buffer: file.buffer,
        fileName: file.originalname || 'material',
        folder: 'course_materials',
        resourceType: 'raw'
      });

      const material = normalizeCourseMaterialEntry({
        name: file.originalname || 'material',
        url: uploaded?.secure_url || uploaded?.url || '',
        mimeType: file.mimetype || '',
        sizeBytes: Number(file.size || 0),
        textExtract: extractReadableTextFromMaterial(file),
        publicId: String(uploaded?.public_id || '')
      });
      if (material) created.push(material);
    }

    item.materials = [...existing, ...created].slice(0, COURSE_MATERIAL_MAX_FILES);
    await item.save();
    return res.json({ success: true, item, added: created });
  } catch (e) {
    console.error('POST /api/courses/:id/content/:contentId/materials error:', e);
    return res.status(500).json({ error: 'Failed to upload lesson materials' });
  }
});

// Delete one lesson material (teacher owner/admin)
app.delete('/api/courses/:id/content/:contentId/materials/:materialId', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = String(req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const item = await CourseContent.findOne({ _id: req.params.contentId, courseId: req.params.id });
    if (!item) return res.status(404).json({ error: 'Content not found' });

    const rawList = Array.isArray(item.materials)
      ? item.materials.map((m) => (typeof m?.toObject === 'function' ? m.toObject() : m))
      : [];
    const idx = rawList.findIndex((m) => String(m?._id || m?.id || '') === String(req.params.materialId || ''));
    if (idx < 0) return res.status(404).json({ error: 'Material not found' });

    const removed = rawList[idx];
    rawList.splice(idx, 1);
    item.materials = normalizeCourseMaterials(rawList);
    await item.save();

    if (removed?.publicId) {
      cloudinary.uploader
        .destroy(String(removed.publicId), { resource_type: 'raw', invalidate: true })
        .catch(() => null);
    }

    return res.json({ success: true, item });
  } catch (e) {
    console.error('DELETE /api/courses/:id/content/:contentId/materials/:materialId error:', e);
    return res.status(500).json({ error: 'Failed to delete lesson material' });
  }
});

app.get('/api/courses/:id/join-state', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const viewer = await getCourseViewerState(course, req.userId);
    res.json({
      success: true,
      joined: viewer.joined,
      requestStatus: viewer.requestStatus,
      pendingRequest: viewer.pendingRequest,
      requestId: viewer.requestId,
      joinMode: String(course.joinMode || 'open'),
      isOwner: String(course.teacherId || '') === String(req.userId || '')
    });
  } catch (e) {
    console.error('GET /api/courses/:id/join-state error:', e);
    res.status(500).json({ error: 'Failed to load join state' });
  }
});

app.get('/api/courses/:id/ratings', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (String(req.userRole || 'student').toLowerCase() === 'student' && String(course.status || '') !== 'published') {
      return res.status(403).json({ error: 'Course is not published' });
    }

    const [ratings, myRatingDoc] = await Promise.all([
      CourseRating.find({ courseId: course._id }).sort({ createdAt: -1 }).lean(),
      req.userId ? CourseRating.findOne({ courseId: course._id, userId: req.userId }).lean() : null
    ]);

    const summary = {
      average: ratings.length
        ? Number((ratings.reduce((sum, item) => sum + Number(item.rating || 0), 0) / ratings.length).toFixed(2))
        : 0,
      count: ratings.length,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
    for (const rating of ratings) {
      const key = String(normalizeCourseRatingValue(rating.rating));
      if (summary.distribution[key] !== undefined) summary.distribution[key] += 1;
    }

    res.json({
      success: true,
      summary,
      myRating: Number(myRatingDoc?.rating || 0),
      ratings: ratings.map((rating) => ({
        id: String(rating._id),
        userId: String(rating.userId || ''),
        authorName: rating.authorName || 'Talaba',
        rating: Number(rating.rating || 0),
        reviewText: String(rating.reviewText || ''),
        createdAt: rating.createdAt,
        updatedAt: rating.updatedAt
      }))
    });
  } catch (e) {
    console.error('GET /api/courses/:id/ratings error:', e);
    res.status(500).json({ error: 'Failed to load ratings' });
  }
});

app.post('/api/courses/:id/ratings', authenticateToken, attachUserRole, requireRole(['student', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!course.allowRatings) return res.status(403).json({ error: 'Ratings are disabled for this course' });

    const joined = await CourseEnrollment.findOne({ courseId: course._id, userId: req.userId }).lean();
    if (String(req.userRole || '').toLowerCase() === 'student' && !joined) {
      return res.status(403).json({ error: 'Only joined students can rate this course' });
    }

    const ratingValue = normalizeCourseRatingValue(req.body?.rating);
    if (!ratingValue) return res.status(400).json({ error: 'rating must be between 1 and 5' });

    const me = await User.findById(req.userId).select('fullName fullname nickname username').lean();
    const rating = await CourseRating.findOneAndUpdate(
      { courseId: course._id, userId: req.userId },
      {
        $set: {
          authorName: getDisplayNameFromUser(me),
          rating: ratingValue,
          reviewText: normalizeCourseLongText(req.body?.reviewText || req.body?.text || '', COURSE_RATING_REVIEW_MAX_CHARS)
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    if (String(course.teacherId || '') !== String(req.userId || '')) {
      await createUserNotification({
        userId: course.teacherId,
        title: 'Kurs baholandi',
        body: `"${course.title}" kursiga ${ratingValue} yulduzli baho qoldirildi.`,
        link: buildCourseNotificationLink(course._id)
      });
    }

    const statsMap = await getCourseStatsMap([course._id]);
    res.json({
      success: true,
      rating,
      summary: statsMap.get(String(course._id)) || { ratingAverage: ratingValue, ratingCount: 1 }
    });
  } catch (e) {
    console.error('POST /api/courses/:id/ratings error:', e);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

app.get('/api/courses/:id/comments', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (String(req.userRole || 'student').toLowerCase() === 'student' && String(course.status || '') !== 'published') {
      return res.status(403).json({ error: 'Course is not published' });
    }

    const comments = await CourseComment.find({ courseId: course._id }).sort({ createdAt: 1 }).limit(500).lean();
    res.json({
      success: true,
      comments: comments.map((comment) => ({
        id: String(comment._id),
        courseId: String(comment.courseId || ''),
        userId: String(comment.userId || ''),
        authorName: comment.authorName || 'Talaba',
        authorRole: comment.authorRole || 'student',
        parentId: comment.parentId ? String(comment.parentId) : '',
        body: String(comment.body || ''),
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt
      }))
    });
  } catch (e) {
    console.error('GET /api/courses/:id/comments error:', e);
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

app.post('/api/courses/:id/comments', authenticateToken, attachUserRole, requireRole(['student', 'teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!course.allowComments) return res.status(403).json({ error: 'Comments are disabled for this course' });

    const role = String(req.userRole || 'student').toLowerCase();
    const isOwner = String(course.teacherId || '') === String(req.userId || '');
    if (!isOwner && role !== 'admin') {
      const joined = await CourseEnrollment.findOne({ courseId: course._id, userId: req.userId }).lean();
      if (!joined) return res.status(403).json({ error: 'Only joined students can comment on this course' });
    }

    const body = normalizeCourseLongText(req.body?.body || req.body?.text || '', COURSE_COMMENT_MAX_CHARS);
    if (!body) return res.status(400).json({ error: 'Comment text required' });

    const parentId = toObjectIdOrNull(req.body?.parentId);
    let parentComment = null;
    if (parentId) {
      parentComment = await CourseComment.findOne({ _id: parentId, courseId: course._id }).lean();
      if (!parentComment) return res.status(404).json({ error: 'Reply target not found' });
    }

    const me = await User.findById(req.userId).select('fullName fullname nickname username').lean();
    const comment = await CourseComment.create({
      courseId: course._id,
      userId: req.userId,
      authorName: getDisplayNameFromUser(me),
      authorRole: role,
      parentId: parentId || null,
      body
    });

    if (parentComment && String(parentComment.userId || '') !== String(req.userId || '')) {
      await createUserNotification({
        userId: parentComment.userId,
        title: 'Kurs kommentiga javob keldi',
        body: `"${course.title}" kursidagi kommentingizga javob yozildi.`,
        link: buildCourseNotificationLink(course._id)
      });
    } else if (!parentComment && String(course.teacherId || '') !== String(req.userId || '')) {
      await createUserNotification({
        userId: course.teacherId,
        title: 'Yangi kurs kommenti',
        body: `"${course.title}" kursiga yangi komment qoldirildi.`,
        link: buildCourseNotificationLink(course._id)
      });
    }

    res.status(201).json({
      success: true,
      comment: {
        id: String(comment._id),
        courseId: String(comment.courseId || ''),
        userId: String(comment.userId || ''),
        authorName: comment.authorName || 'Talaba',
        authorRole: comment.authorRole || role,
        parentId: comment.parentId ? String(comment.parentId) : '',
        body: String(comment.body || ''),
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt
      }
    });
  } catch (e) {
    console.error('POST /api/courses/:id/comments error:', e);
    res.status(500).json({ error: 'Failed to save comment' });
  }
});

app.post('/api/courses/:id/requests', authenticateToken, attachUserRole, requireRole(['student']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (String(course.status || '') !== 'published') return res.status(403).json({ error: 'Course is not published' });
    if (String(course.joinMode || 'open') !== 'approval') {
      return res.status(400).json({ error: 'This course does not require approval' });
    }

    const existingEnrollment = await CourseEnrollment.findOne({ courseId: course._id, userId: req.userId }).lean();
    if (existingEnrollment) return res.json({ success: true, alreadyJoined: true, joined: true });

    const message = normalizeCourseLongText(req.body?.message || '', COURSE_REQUEST_MAX_CHARS);
    const requestDoc = await CourseEnrollmentRequest.findOneAndUpdate(
      { courseId: course._id, userId: req.userId },
      {
        $set: {
          teacherId: course.teacherId,
          status: 'pending',
          message,
          reviewNote: '',
          reviewedAt: null,
          reviewedBy: null
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    if (String(course.teacherId || '') !== String(req.userId || '')) {
      await createUserNotification({
        userId: course.teacherId,
        title: 'Yangi kurs so\'rovi',
        body: `Talaba "${course.title}" kursiga qo'shilish uchun so'rov yubordi.`,
        link: `/course-progress.html?id=${encodeURIComponent(String(course._id))}`
      });
    }

    res.json({ success: true, request: requestDoc });
  } catch (e) {
    console.error('POST /api/courses/:id/requests error:', e);
    res.status(500).json({ error: 'Failed to create join request' });
  }
});

app.get('/api/courses/:id/requests', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const role = String(req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId || '') !== String(req.userId || '')) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const requests = await CourseEnrollmentRequest.find({ courseId: course._id }).sort({ createdAt: -1 }).lean();
    const users = await User.find({ _id: { $in: requests.map((request) => request.userId).filter(Boolean) } })
      .select('fullName fullname nickname username faculty studyGroup group')
      .lean();
    const userMap = new Map(users.map((user) => [String(user._id), user]));

    res.json({
      success: true,
      requests: requests.map((request) => {
        const user = userMap.get(String(request.userId || '')) || {};
        return {
          id: String(request._id),
          userId: String(request.userId || ''),
          fullName: getDisplayNameFromUser(user),
          faculty: String(user?.faculty || ''),
          group: String(userGroup(user) || ''),
          message: String(request.message || ''),
          reviewNote: String(request.reviewNote || ''),
          status: String(request.status || 'pending'),
          createdAt: request.createdAt,
          reviewedAt: request.reviewedAt
        };
      })
    });
  } catch (e) {
    console.error('GET /api/courses/:id/requests error:', e);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

app.post('/api/courses/:id/requests/:requestId/review', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const role = String(req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId || '') !== String(req.userId || '')) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const requestDoc = await CourseEnrollmentRequest.findOne({ _id: req.params.requestId, courseId: course._id });
    if (!requestDoc) return res.status(404).json({ error: 'Request not found' });

    const nextStatus = String(req.body?.status || '').toLowerCase();
    if (!['approved', 'rejected'].includes(nextStatus)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }

    requestDoc.status = nextStatus;
    requestDoc.reviewNote = normalizeCourseLongText(req.body?.reviewNote || req.body?.note || '', COURSE_REVIEW_MAX_CHARS);
    requestDoc.reviewedAt = new Date();
    requestDoc.reviewedBy = req.userId;

    let enrollResult = null;
    if (nextStatus === 'approved') {
      enrollResult = await enrollUserIntoCourse({ course, userId: requestDoc.userId, role: 'student' });
    }

    await requestDoc.save();

    await createUserNotification({
      userId: requestDoc.userId,
      title: nextStatus === 'approved' ? 'Kurs so\'rovi tasdiqlandi' : 'Kurs so\'rovi rad etildi',
      body: nextStatus === 'approved'
        ? `"${course.title}" kursiga kirish siz uchun ochildi.`
        : `"${course.title}" kursi uchun so'rovingiz rad etildi.`,
      link: buildCourseNotificationLink(course._id)
    });

    res.json({ success: true, request: requestDoc, enrollResult });
  } catch (e) {
    console.error('POST /api/courses/:id/requests/:requestId/review error:', e);
    res.status(Number(e?.status || 500)).json({ error: e?.message || 'Failed to review request' });
  }
});

app.post('/api/courses/:id/content/:contentId/lesson-quiz/submit', authenticateToken, attachUserRole, requireRole(['student', 'teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = String(req.userRole || '').toLowerCase();
    if (role === 'student') {
      const joined = await CourseEnrollment.findOne({ courseId: course._id, userId: req.userId }).lean();
      if (!joined) return res.status(403).json({ error: 'Not joined' });
    } else if (role === 'teacher' && String(course.teacherId || '') !== String(req.userId || '')) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const item = await CourseContent.findOne({ _id: req.params.contentId, courseId: req.params.id });
    if (!item) return res.status(404).json({ error: 'Content not found' });

    const questions = normalizeCourseQuizQuestions(item.quizQuestions);
    if (!item.quizEnabled || !questions.length) {
      return res.status(400).json({ error: 'Lesson quiz is not configured' });
    }

    const answers = (req.body?.answers && typeof req.body.answers === 'object') ? req.body.answers : {};
    let correct = 0;
    const review = [];
    for (const question of questions) {
      const answer = String(answers[question.id] || '').trim().toUpperCase();
      const answerKey = String(question.answerKey || '').trim().toUpperCase();
      const isCorrect = !!answer && answer === answerKey;
      if (isCorrect) correct += 1;
      review.push({
        id: String(question.id || ''),
        text: question.text,
        yourAnswer: answer,
        correctKey: answerKey,
        explanation: String(question.explanation || ''),
        correct: isCorrect
      });
    }

    const total = questions.length;
    const score = total ? Math.round((correct / total) * 100) : 0;
    const passPct = Math.max(1, Math.min(100, Number(item.quizPassPct || 60) || 60));
    const passed = score >= passPct;

    let attempts = 0;
    if (role === 'student') {
      const progressDoc = await CourseProgress.findOne({ courseId: course._id, userId: req.userId });
      const quizMap = (progressDoc?.lessonQuizResults && typeof progressDoc.lessonQuizResults === 'object')
        ? { ...progressDoc.lessonQuizResults }
        : {};
      const prev = (quizMap[String(item._id)] && typeof quizMap[String(item._id)] === 'object')
        ? quizMap[String(item._id)]
        : {};
      attempts = Number(prev.attempts || 0) + 1;
      quizMap[String(item._id)] = {
        bestScore: Math.max(Number(prev.bestScore || 0), score),
        lastScore: score,
        attempts,
        passed: !!(prev.passed || passed),
        correct,
        total,
        passPct,
        quizTitle: item.quizTitle || item.title || '',
        submittedAt: new Date().toISOString()
      };
      await CourseProgress.findOneAndUpdate(
        { courseId: course._id, userId: req.userId },
        {
          $set: {
            lessonQuizResults: quizMap,
            lastLessonId: String(item._id),
            lastActivityAt: new Date()
          }
        },
        { upsert: true, new: true }
      );
    }

    res.json({
      success: true,
      result: {
        score,
        correct,
        total,
        passPct,
        passed,
        attempts,
        review
      }
    });
  } catch (e) {
    console.error('POST /api/courses/:id/content/:contentId/lesson-quiz/submit error:', e);
    res.status(500).json({ error: 'Failed to submit lesson quiz' });
  }
});

app.get('/api/courses/:id/analytics', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const role = String(req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId || '') !== String(req.userId || '')) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const [contents, enrollments, progressDocs, requestDocs, ratingDocs, commentDocs] = await Promise.all([
      CourseContent.find({ courseId: course._id }).sort({ order: 1, createdAt: 1 }).lean(),
      CourseEnrollment.find({ courseId: course._id }).sort({ joinedAt: -1 }).lean(),
      CourseProgress.find({ courseId: course._id }).lean(),
      CourseEnrollmentRequest.find({ courseId: course._id }).sort({ createdAt: -1 }).lean(),
      CourseRating.find({ courseId: course._id }).sort({ createdAt: -1 }).lean(),
      CourseComment.find({ courseId: course._id }).sort({ createdAt: -1 }).limit(200).lean()
    ]);

    const userIds = Array.from(new Set([
      ...enrollments.map((row) => String(row.userId || '')).filter(Boolean),
      ...requestDocs.map((row) => String(row.userId || '')).filter(Boolean)
    ])).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const users = await User.find({ _id: { $in: userIds } })
      .select('fullName fullname nickname username faculty studyGroup group')
      .lean();
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    const contentMap = new Map(contents.map((content) => [String(content._id), content]));
    const progressMap = new Map(progressDocs.map((doc) => [String(doc.userId), doc]));
    const totalLessons = contents.length;

    const students = enrollments.map((enrollment) => {
      const user = userMap.get(String(enrollment.userId || '')) || {};
      const progressDoc = progressMap.get(String(enrollment.userId || '')) || {};
      const progressMapRaw = (progressDoc.progress && typeof progressDoc.progress === 'object') ? progressDoc.progress : {};
      const doneIds = Object.keys(progressMapRaw).filter((key) => progressMapRaw[key]);
      const doneCount = doneIds.length;
      const progressPercent = totalLessons ? Math.round((doneCount / totalLessons) * 100) : 0;
      const quizResults = (progressDoc.lessonQuizResults && typeof progressDoc.lessonQuizResults === 'object')
        ? progressDoc.lessonQuizResults
        : {};
      const quizResultValues = Object.values(quizResults).filter((value) => value && typeof value === 'object');
      const quizPassedCount = quizResultValues.filter((value) => value.passed).length;
      const quizAttemptCount = quizResultValues.reduce((sum, value) => sum + Number(value.attempts || 0), 0);
      const lastLessonId = String(progressDoc.lastLessonId || '');
      const lastLesson = contentMap.get(lastLessonId);
      return {
        userId: String(enrollment.userId || ''),
        fullName: getDisplayNameFromUser(user),
        faculty: String(user?.faculty || ''),
        group: String(userGroup(user) || ''),
        joinedAt: enrollment.joinedAt,
        paidAmount: Number(enrollment.paidAmount || 0),
        progressPercent,
        doneCount,
        totalLessons,
        lastLessonId,
        lastLessonTitle: String(lastLesson?.title || ''),
        quizPassedCount,
        quizAttemptCount,
        lastActivityAt: progressDoc.lastActivityAt || progressDoc.updatedAt || enrollment.joinedAt
      };
    });

    const lessonStats = contents.map((content) => {
      const contentId = String(content._id);
      let quizAttempts = 0;
      let quizPassedUsers = 0;
      let bestScoreSum = 0;
      let bestScoreCount = 0;
      let completedUsers = 0;

      for (const progressDoc of progressDocs) {
        const progressRaw = (progressDoc.progress && typeof progressDoc.progress === 'object') ? progressDoc.progress : {};
        if (progressRaw[contentId]) completedUsers += 1;
        const result = progressDoc.lessonQuizResults?.[contentId];
        if (result && typeof result === 'object') {
          quizAttempts += Number(result.attempts || 0);
          if (result.passed) quizPassedUsers += 1;
          if (result.bestScore !== undefined) {
            bestScoreSum += Number(result.bestScore || 0);
            bestScoreCount += 1;
          }
        }
      }

      return {
        contentId,
        title: String(content.title || ''),
        type: String(content.type || 'text'),
        order: Number(content.order || 0),
        quizEnabled: !!(content.quizEnabled && Array.isArray(content.quizQuestions) && content.quizQuestions.length),
        quizPassPct: Math.max(1, Math.min(100, Number(content.quizPassPct || 60) || 60)),
        completedUsers,
        quizAttempts,
        quizPassedUsers,
        avgBestScore: bestScoreCount ? Number((bestScoreSum / bestScoreCount).toFixed(1)) : 0
      };
    });

    const averageRating = ratingDocs.length
      ? Number((ratingDocs.reduce((sum, rating) => sum + Number(rating.rating || 0), 0) / ratingDocs.length).toFixed(2))
      : 0;
    const averageProgress = students.length
      ? Number((students.reduce((sum, student) => sum + Number(student.progressPercent || 0), 0) / students.length).toFixed(1))
      : 0;
    const completedStudents = students.filter((student) => Number(student.progressPercent || 0) >= 100).length;

    res.json({
      success: true,
      course: {
        ...course,
        lessonCount: totalLessons,
        ratingAverage: averageRating,
        ratingCount: ratingDocs.length,
        commentCount: commentDocs.length,
        pendingRequests: requestDocs.filter((request) => String(request.status || '') === 'pending').length
      },
      summary: {
        totalLessons,
        quizLessonCount: lessonStats.filter((lesson) => lesson.quizEnabled).length,
        enrolledCount: enrollments.length,
        pendingRequests: requestDocs.filter((request) => String(request.status || '') === 'pending').length,
        averageRating,
        ratingCount: ratingDocs.length,
        commentCount: commentDocs.length,
        averageProgress,
        completionRate: students.length ? Math.round((completedStudents / students.length) * 100) : 0
      },
      students,
      requests: requestDocs.map((request) => {
        const user = userMap.get(String(request.userId || '')) || {};
        return {
          id: String(request._id),
          userId: String(request.userId || ''),
          fullName: getDisplayNameFromUser(user),
          faculty: String(user?.faculty || ''),
          group: String(userGroup(user) || ''),
          message: String(request.message || ''),
          reviewNote: String(request.reviewNote || ''),
          status: String(request.status || 'pending'),
          createdAt: request.createdAt,
          reviewedAt: request.reviewedAt
        };
      }),
      lessonStats,
      ratings: ratingDocs.map((rating) => ({
        id: String(rating._id),
        userId: String(rating.userId || ''),
        authorName: rating.authorName || 'Talaba',
        rating: Number(rating.rating || 0),
        reviewText: String(rating.reviewText || ''),
        createdAt: rating.createdAt
      })),
      comments: commentDocs.map((comment) => ({
        id: String(comment._id),
        userId: String(comment.userId || ''),
        authorName: comment.authorName || 'Talaba',
        authorRole: comment.authorRole || 'student',
        parentId: comment.parentId ? String(comment.parentId) : '',
        body: String(comment.body || ''),
        createdAt: comment.createdAt
      }))
    });
  } catch (e) {
    console.error('GET /api/courses/:id/analytics error:', e);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// AI generated quiz for current lesson content
app.post('/api/courses/:id/content/:contentId/ai-quiz', authenticateToken, attachUserRole, requireRole(['student', 'teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = String(req.userRole || '').toLowerCase();
    if (role === 'student') {
      const joined = await CourseEnrollment.findOne({ courseId: course._id, userId: req.userId }).lean();
      if (!joined) return res.status(403).json({ error: 'Not joined' });
    } else if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const contentDoc = await CourseContent.findOne({ _id: req.params.contentId, courseId: req.params.id }).lean();
    if (!contentDoc) return res.status(404).json({ error: 'Content not found' });

    const questionIndex = Math.max(1, Math.min(200, Number(req.body?.questionIndex || 1) || 1));
    const excludeQuestions = Array.isArray(req.body?.excludeQuestions)
      ? req.body.excludeQuestions.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20)
      : [];

    const sourceText = buildCourseContentStudyText(contentDoc);
    let question = null;
    let aiMeta = { provider: '', model: '' };

    try {
      const sys = [
        'You generate one short multiple-choice quiz question for a course lesson.',
        'Language: Uzbek (latin).',
        'Return ONLY valid JSON with keys: text, options, answerKey, explanation.',
        'options must be array of objects with keys: key, text.',
        'Provide 4 options (A-D) and exactly one correct answer.'
      ].join(' ');
      const userMessage = [
        `Course: ${String(course.title || '').trim() || 'Kurs'}`,
        `Lesson title: ${String(contentDoc.title || '').trim() || 'Mavzu'}`,
        `Question index: ${questionIndex}`,
        excludeQuestions.length ? `Avoid repeating these questions: ${excludeQuestions.join(' | ')}` : '',
        `Lesson source text: ${sourceText || 'Mavzu matni mavjud emas, umumiy savol yarating.'}`
      ].filter(Boolean).join('\n');

      const out = await generateAssistantAiAnswer({
        systemPrompt: sys,
        history: [],
        userMessage,
        req
      });
      const parsed = extractFirstJsonObjectFromText(out?.answer || '');
      question = normalizeAiQuizQuestion(parsed, contentDoc.title);
      aiMeta = { provider: String(out?.provider || ''), model: String(out?.model || '') };
    } catch (aiErr) {
      console.warn('ai lesson quiz fallback:', aiErr?.message || aiErr);
    }

    if (!question) {
      question = buildFallbackAiQuizQuestion(contentDoc, questionIndex);
    }

    return res.json({
      success: true,
      question,
      source: aiMeta.provider ? 'ai' : 'fallback',
      provider: aiMeta.provider,
      model: aiMeta.model
    });
  } catch (e) {
    console.error('POST /api/courses/:id/content/:contentId/ai-quiz error:', e);
    return res.status(500).json({ error: 'Failed to generate AI quiz' });
  }
});

// List tests linked to a course
app.get('/api/courses/:id/tests', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = (req.userRole || 'student').toLowerCase();
    if (role === 'student') {
      const joined = await CourseEnrollment.findOne({ courseId: course._id, userId: req.userId }).lean();
      if (!joined) return res.status(403).json({ error: 'Not joined' });
    } else if (role === 'teacher') {
      const isOwner = String(course.teacherId) === String(req.userId);
      if (!isOwner && course.status !== 'published') return res.status(403).json({ error: 'Not allowed' });
    }

    const query = { courseId: course._id };
    if (role === 'student') query.status = 'published';
    const tests = await Test.find(query)
      .sort({ createdAt: -1 })
      .select('_id title subject description status passPct phase isFinal teacherName createdAt')
      .lean();

    const finalTestId = course.finalTestId ? String(course.finalTestId) : '';
    const items = (tests || []).map((t) => ({
      ...t,
      isFinal: !!(t.isFinal || (finalTestId && String(t._id) === finalTestId))
    }));

    res.json({ success: true, tests: items, finalTestId });
  } catch (e) {
    console.error('GET /api/courses/:id/tests error:', e);
    res.status(500).json({ error: 'Failed to load course tests' });
  }
});

// Link existing tests to a course and optionally set final test
app.post('/api/courses/:id/tests/link', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = String(req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const idsRaw = Array.isArray(req.body?.testIds) ? req.body.testIds : [];
    const testIds = Array.from(new Set(idsRaw.map((x) => String(x || '').trim()).filter((x) => mongoose.Types.ObjectId.isValid(x))));
    if (!testIds.length) return res.status(400).json({ error: 'testIds required' });

    const tests = await Test.find({ _id: { $in: testIds } });
    if (tests.length !== testIds.length) return res.status(404).json({ error: 'Some tests not found' });
    if (role === 'teacher') {
      const allMine = tests.every((t) => String(t.teacherId) === String(req.userId));
      if (!allMine) return res.status(403).json({ error: 'Teacher can link only own tests' });
    }

    await Test.updateMany({ _id: { $in: testIds } }, { $set: { courseId: course._id } });

    const merged = new Set([...(course.testIds || []).map((x) => String(x)), ...testIds]);
    course.testIds = Array.from(merged).map((x) => new mongoose.Types.ObjectId(x));

    const finalTestIdRaw = String(req.body?.finalTestId || '').trim();
    if (finalTestIdRaw) {
      if (!merged.has(finalTestIdRaw)) return res.status(400).json({ error: 'finalTestId must be linked test' });
      course.finalTestId = new mongoose.Types.ObjectId(finalTestIdRaw);
      await Test.updateMany({ _id: { $in: testIds } }, { $set: { isFinal: false } });
      await Test.updateOne({ _id: finalTestIdRaw }, { $set: { isFinal: true } });
    }

    await course.save();
    res.json({
      success: true,
      course: {
        _id: course._id,
        testIds: (course.testIds || []).map((x) => String(x)),
        finalTestId: course.finalTestId ? String(course.finalTestId) : ''
      }
    });
  } catch (e) {
    console.error('POST /api/courses/:id/tests/link error:', e);
    res.status(500).json({ error: 'Failed to link tests' });
  }
});

// Save progress (student) - expects {progress:{contentId:true}}
app.post('/api/courses/:id/progress', async (req, res) => {
  try {
    const role = (req.userRole || 'student').toLowerCase();
    if (role !== 'student') return res.status(403).json({ error: 'Only students can save progress' });

    const joined = await CourseEnrollment.findOne({ courseId: req.params.id, userId: req.userId }).lean();
    if (!joined) return res.status(403).json({ error: 'Not joined' });

    const progress = req.body.progress && typeof req.body.progress === 'object' ? req.body.progress : {};
    const doc = await CourseProgress.findOneAndUpdate(
      { courseId: req.params.id, userId: req.userId },
      { $set: { progress } },
      { upsert: true, new: true }
    );

    res.json({ success: true, progress: doc.progress });
  } catch (e) {
    console.error('POST /api/courses/:id/progress error:', e);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// ==================== TESTS ====================

// List tests
app.get('/api/tests', async (req, res) => {
  try {
    const role = (req.userRole || 'student').toLowerCase();
    const courseId = String(req.query.courseId || '').trim();
    let query = {};
    if (role === 'student') query.status = 'published';
    if (role === 'teacher') query = { $or: [{ teacherId: req.userId }, { status: 'published' }] };
    if (courseId && mongoose.Types.ObjectId.isValid(courseId)) query.courseId = new mongoose.Types.ObjectId(courseId);
    const list = await Test.find(query).sort({ createdAt: -1 }).lean();
    res.json({ tests: list });
  } catch (e) {
    console.error('GET /api/tests error:', e);
    res.status(500).json({ error: 'Failed to load tests' });
  }
});

// My submissions — avoid hitting "/api/tests/:id" with "my-submissions"
// Returns latest submission per test (sorted by latest activity)
app.get('/api/tests/my-submissions', authenticateToken, attachUserRole, requireRole(['student','teacher','admin']), async (req, res) => {
  try {
    const uid = String(req.userId);
    const submissions = await TestSubmission.find({ userId: uid })
      .sort({ createdAt: -1 })
      .lean();

    // Keep only latest submission per testId
    const latestByTest = new Map();
    for (const s of submissions) {
      const tid = String(s.testId);
      if (!latestByTest.has(tid)) latestByTest.set(tid, s);
    }

    const testIds = Array.from(latestByTest.keys());
    const tests = await Test.find({ _id: { $in: testIds } }).select('title subject status teacherName updatedAt createdAt').lean();
    const testMap = new Map(tests.map(t => [String(t._id), t]));

    const items = [];
    for (const [tid, sub] of latestByTest.entries()) {
      const t = testMap.get(tid);
      if (!t) continue;
      items.push({
        testId: tid,
        test: t,
        submission: sub
      });
    }

    items.sort((a, b) => {
      const ta = new Date(a.submission?.createdAt || 0).getTime();
      const tb = new Date(b.submission?.createdAt || 0).getTime();
      return tb - ta;
    });

    res.json({ submissions: items });
  } catch (e) {
    console.error('GET /api/tests/my-submissions error:', e);
    res.status(500).json({ error: 'Failed to load submissions' });
  }
});

// Get one test
app.get('/api/tests/:id', async (req, res) => {
  try {
    const role = (req.userRole || 'student').toLowerCase();
    // Prevent ObjectId CastError for non-id paths
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Test not found' });
    }
    const t = await Test.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ error: 'Test not found' });
    if (role === 'student' && t.status !== 'published') return res.status(403).json({ error: 'Test is not published' });
    res.json({ test: t });
  } catch (e) {
    console.error('GET /api/tests/:id error:', e);
    res.status(500).json({ error: 'Failed to load test' });
  }
});

// Create test (teacher/admin)
app.post('/api/tests', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const teacher = await User.findById(req.userId).select('fullName nickname username role');
    if (!teacher) return res.status(404).json({ error: 'User not found' });

    const title = String(req.body.title || '').trim();
    const subject = String(req.body.subject || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!subject) return res.status(400).json({ error: 'subject is required' });

    const courseIdRaw = String(req.body.courseId || '').trim();
    const courseObjId = mongoose.Types.ObjectId.isValid(courseIdRaw) ? new mongoose.Types.ObjectId(courseIdRaw) : null;
    let course = null;
    if (courseObjId) {
      course = await Course.findById(courseObjId).select('_id teacherId faculty groups testIds finalTestId').lean();
      if (!course) return res.status(404).json({ error: 'Linked course not found' });
      const role = String(req.userRole || '').toLowerCase();
      if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
        return res.status(403).json({ error: 'Only course owner can attach tests to this course' });
      }
    }

    const groups = normalizeGroups(req.body.groups || course?.groups || []);
    const status = (req.body.status || 'draft') === 'published' ? 'published' : 'draft';
    const phase = (String(req.body.phase || 'after').toLowerCase() === 'during') ? 'during' : 'after';
    const passPct = getSubmissionPassPct({ passPct: req.body.passPct });
    const timeMin = Math.max(0, Math.round(Number(req.body.timeMin || 0)));
    const isFinal = !!req.body.isFinal;

    let questions = [];
    let questionsText = String(req.body.questionsText || req.body.questions_raw || '').trim();

    if (Array.isArray(req.body.questions) && req.body.questions.length) {
      questions = req.body.questions.map((q, idx) => ({
        id: q.id || `q${idx + 1}`,
        text: String(q.text || q.question || '').trim(),
        options: (q.options || []).map(o => ({ key: String(o.key || '').toUpperCase(), text: String(o.text || '').trim() })),
        answerKey: String(q.answerKey || q.ans || q.correct || '').toUpperCase()
      })).filter(x => x.text && x.options.length >= 2 && x.answerKey);
    } else if (questionsText) {
      questions = parseQuestionsFromText(questionsText).map((q, idx) => ({
        id: q.id || `q${idx + 1}`,
        text: q.text,
        options: q.options,
        answerKey: q.answerKey
      }));
    }

    if (!questions.length) {
      return res.status(400).json({ error: 'Questions are required (questionsText or questions[])' });
    }

    const test = await Test.create({
      title,
      subject,
      description: String(req.body.description || '').trim(),
      status,
      faculty: String(req.body.faculty || course?.faculty || '').trim(),
      groups,
      courseId: courseObjId,
      phase,
      passPct,
      timeMin,
      isFinal,
      questions,
      questionsText,
      teacherId: teacher._id,
      teacherName: teacher.fullName || teacher.nickname || teacher.username || 'Teacher'
    });

    if (courseObjId) {
      const testIds = Array.from(new Set([...(course?.testIds || []).map((x) => String(x)), String(test._id)]))
        .map((x) => new mongoose.Types.ObjectId(x));
      const set = { testIds };
      if (isFinal) set.finalTestId = test._id;
      await Course.updateOne({ _id: courseObjId }, { $set: set });
      if (isFinal) {
        await Test.updateMany({ courseId: courseObjId, _id: { $ne: test._id } }, { $set: { isFinal: false } });
      }
    }

    res.status(201).json({ test });
  } catch (e) {
    console.error('POST /api/tests error:', e);
    res.status(500).json({ error: 'Failed to create test' });
  }
});

// Update test (owner teacher/admin)
app.put('/api/tests/:id', authenticateToken, attachUserRole, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const role = (req.userRole || '').toLowerCase();
    const t = await Test.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Test not found' });

    if (role === 'teacher' && String(t.teacherId) !== String(req.userId)) return res.status(403).json({ error: 'Not owner' });

    if (req.body.title !== undefined) t.title = String(req.body.title || '').trim();
    if (req.body.subject !== undefined) t.subject = String(req.body.subject || '').trim();
    if (req.body.description !== undefined) t.description = String(req.body.description || '').trim();
    if (req.body.status !== undefined) t.status = (req.body.status === 'published') ? 'published' : 'draft';
    if (req.body.faculty !== undefined) t.faculty = String(req.body.faculty || '').trim();
    if (req.body.groups !== undefined) t.groups = normalizeGroups(req.body.groups);
    if (req.body.phase !== undefined) t.phase = (String(req.body.phase || '').toLowerCase() === 'during') ? 'during' : 'after';
    if (req.body.passPct !== undefined) t.passPct = getSubmissionPassPct({ passPct: req.body.passPct });
    if (req.body.timeMin !== undefined) t.timeMin = Math.max(0, Math.round(Number(req.body.timeMin || 0)));
    if (req.body.isFinal !== undefined) t.isFinal = !!req.body.isFinal;

    if (req.body.courseId !== undefined) {
      const nextCourseId = String(req.body.courseId || '').trim();
      if (nextCourseId) {
        if (!mongoose.Types.ObjectId.isValid(nextCourseId)) return res.status(400).json({ error: 'Invalid courseId' });
        const c = await Course.findById(nextCourseId).select('_id teacherId testIds').lean();
        if (!c) return res.status(404).json({ error: 'Linked course not found' });
        if (role === 'teacher' && String(c.teacherId) !== String(req.userId)) {
          return res.status(403).json({ error: 'Only course owner can attach this test' });
        }
        t.courseId = c._id;
      } else {
        t.courseId = null;
      }
    }

    // Update questions: accept questions[] or questionsText
    if (req.body.questions !== undefined) {
      const qArr = Array.isArray(req.body.questions) ? req.body.questions : [];
      const questions = qArr.map((q, idx) => ({
        id: q.id || `q${idx + 1}`,
        text: String(q.text || q.question || '').trim(),
        options: (q.options || []).map(o => ({ key: String(o.key || '').toUpperCase(), text: String(o.text || '').trim() })),
        answerKey: String(q.answerKey || q.ans || q.correct || '').toUpperCase()
      })).filter(x => x.text && x.options.length >= 2 && x.answerKey);
      if (!questions.length) return res.status(400).json({ error: 'Invalid questions[]' });
      t.questions = questions;
    } else if (req.body.questionsText !== undefined) {
      const qt = String(req.body.questionsText || '').trim();
      const questions = parseQuestionsFromText(qt).map((q, idx) => ({
        id: q.id || `q${idx + 1}`,
        text: q.text,
        options: q.options,
        answerKey: q.answerKey
      }));
      if (!questions.length) return res.status(400).json({ error: 'Invalid questionsText' });
      t.questionsText = qt;
      t.questions = questions;
    }

    await t.save();

    if (t.courseId) {
      const c = await Course.findById(t.courseId);
      if (c) {
        const merged = new Set([...(c.testIds || []).map((x) => String(x)), String(t._id)]);
        c.testIds = Array.from(merged).map((x) => new mongoose.Types.ObjectId(x));
        if (t.isFinal) c.finalTestId = t._id;
        await c.save();
        if (t.isFinal) {
          await Test.updateMany({ courseId: c._id, _id: { $ne: t._id } }, { $set: { isFinal: false } });
        }
      }
    }

    res.json({ test: t });
  } catch (e) {
    console.error('PUT /api/tests/:id error:', e);
    res.status(500).json({ error: 'Failed to update test' });
  }
});

// Delete test (teacher/admin)
app.delete('/api/tests/:id', authenticateToken, attachUserRole, requireRole(['teacher','admin']), async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    // Only owner teacher can delete, admin can delete
    const role = String(req.userRole || '').toLowerCase();
    if (role !== 'admin' && String(test.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Only owner teacher or admin can delete' });
    }

    const linkedCourseId = test.courseId ? String(test.courseId) : '';
    await TestSubmission.deleteMany({ testId: test._id });
    await test.deleteOne();

    if (linkedCourseId && mongoose.Types.ObjectId.isValid(linkedCourseId)) {
      const c = await Course.findById(linkedCourseId);
      if (c) {
        const next = (c.testIds || []).map((x) => String(x)).filter((x) => x !== String(test._id));
        c.testIds = next.map((x) => new mongoose.Types.ObjectId(x));
        if (c.finalTestId && String(c.finalTestId) === String(test._id)) c.finalTestId = null;
        await c.save();
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/tests/:id error:', e);
    res.status(500).json({ error: 'Failed to delete test' });
  }
});

// Submit test (student)
app.post('/api/tests/:id/submit', requireRole(['student']), async (req, res) => {
  try {
    const test = await Test.findById(req.params.id).lean();
    if (!test) return res.status(404).json({ error: 'Test not found' });

    if ((test.status || 'published') !== 'published') return res.status(403).json({ error: 'Test is not published' });

    const me = await User.findById(req.userId).select('faculty studyGroup');
    if (!me) return res.status(404).json({ error: 'User not found' });

    // Faculty / group checks (server-side)
    const tFaculty = String(test.faculty || '').trim();
    const uFaculty = String(userFaculty(me) || '').trim();
    if (tFaculty && uFaculty && tFaculty !== uFaculty) return res.status(403).json({ error: 'Test is for another faculty' });

    const allowedGroups = (test.groups || []).map(x => String(x).trim()).filter(Boolean);
    if (allowedGroups.length) {
      const mg = String(userGroup(me) || '').trim();
      if (!mg) return res.status(403).json({ error: 'User group is missing' });
      const ok = allowedGroups.some(g => g.toLowerCase() === mg.toLowerCase());
      if (!ok) return res.status(403).json({ error: 'Test is not open for your group' });
    }

    const answers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const score = computeScore(test.questions || [], answers);
    const passPct = getSubmissionPassPct(test);
    const passed = Number(score.pct || 0) >= passPct;

    const submission = await TestSubmission.create({
      testId: test._id,
      userId: req.userId,
      answers,
      score: score.pct,
      correct: score.correct,
      total: score.total
    });

    if (passed && test.courseId) {
      const progress = await CourseProgress.findOne({ courseId: test.courseId, userId: req.userId }).lean();
      const tp = (progress?.testsPassed && typeof progress.testsPassed === 'object') ? progress.testsPassed : {};
      tp[String(test._id)] = true;
      await CourseProgress.findOneAndUpdate(
        { courseId: test.courseId, userId: req.userId },
        { $set: { testsPassed: tp } },
        { upsert: true, new: true }
      ).catch(() => null);
    }

    res.json({
      success: true,
      score: score.pct,
      correct: score.correct,
      total: score.total,
      passPct,
      passed,
      courseId: test.courseId ? String(test.courseId) : '',
      submissionId: submission._id
    });
  } catch (e) {
    console.error('POST /api/tests/:id/submit error:', e);
    res.status(500).json({ error: 'Failed to submit test' });
  }
});

// Compatibility endpoint used by front-end fallback
app.post('/api/submit-test', authenticateToken, attachUserRole, requireRole(['student']), async (req, res) => {
  try {
    const testId = req.body.testId || req.body.id;
    if (!testId) return res.status(400).json({ error: 'testId required' });
    req.params.id = testId;
    // Reuse handler: call internal function by redirecting logic
    // Minimal: duplicate call
    const test = await Test.findById(testId).lean();
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const answers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const score = computeScore(test.questions || [], answers);
    const passPct = getSubmissionPassPct(test);
    const passed = Number(score.pct || 0) >= passPct;

    const submission = await TestSubmission.create({
      testId: test._id,
      userId: req.userId,
      answers,
      score: score.pct,
      correct: score.correct,
      total: score.total
    });

    if (passed && test.courseId) {
      const progress = await CourseProgress.findOne({ courseId: test.courseId, userId: req.userId }).lean();
      const tp = (progress?.testsPassed && typeof progress.testsPassed === 'object') ? progress.testsPassed : {};
      tp[String(test._id)] = true;
      await CourseProgress.findOneAndUpdate(
        { courseId: test.courseId, userId: req.userId },
        { $set: { testsPassed: tp } },
        { upsert: true, new: true }
      ).catch(() => null);
    }

    res.json({
      success: true,
      score: score.pct,
      correct: score.correct,
      total: score.total,
      passPct,
      passed,
      courseId: test.courseId ? String(test.courseId) : '',
      submissionId: submission._id
    });
  } catch (e) {
    console.error('POST /api/submit-test error:', e);
    res.status(500).json({ error: 'Failed to submit test' });
  }
});

// New front-end alias
app.post('/api/test/submit', authenticateToken, attachUserRole, requireRole(['student']), async (req, res) => {
  try {
    const testId = req.body.testId || req.body.id;
    if (!testId) return res.status(400).json({ error: 'testId required' });
    const test = await Test.findById(testId).lean();
    if (!test) return res.status(404).json({ error: 'Test not found' });

    if ((test.status || 'published') !== 'published') return res.status(403).json({ error: 'Test is not published' });

    const me = await User.findById(req.userId).select('faculty studyGroup');
    if (!me) return res.status(404).json({ error: 'User not found' });

    const tFaculty = String(test.faculty || '').trim();
    const uFaculty = String(userFaculty(me) || '').trim();
    if (tFaculty && uFaculty && tFaculty !== uFaculty) return res.status(403).json({ error: 'Test is for another faculty' });

    const allowedGroups = (test.groups || []).map(x => String(x).trim()).filter(Boolean);
    if (allowedGroups.length) {
      const mg = String(userGroup(me) || '').trim();
      if (!mg) return res.status(403).json({ error: 'User group is missing' });
      const ok = allowedGroups.some(g => g.toLowerCase() === mg.toLowerCase());
      if (!ok) return res.status(403).json({ error: 'Test is not open for your group' });
    }

    const answers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const score = computeScore(test.questions || [], answers);
    const passPct = getSubmissionPassPct(test);
    const passed = Number(score.pct || 0) >= passPct;
    const submission = await TestSubmission.create({
      testId: test._id,
      userId: req.userId,
      answers,
      score: score.pct,
      correct: score.correct,
      total: score.total
    });
    if (passed && test.courseId) {
      const progress = await CourseProgress.findOne({ courseId: test.courseId, userId: req.userId }).lean();
      const tp = (progress?.testsPassed && typeof progress.testsPassed === 'object') ? progress.testsPassed : {};
      tp[String(test._id)] = true;
      await CourseProgress.findOneAndUpdate(
        { courseId: test.courseId, userId: req.userId },
        { $set: { testsPassed: tp } },
        { upsert: true, new: true }
      ).catch(() => null);
    }
    res.json({
      success: true,
      score: score.pct,
      correct: score.correct,
      total: score.total,
      passPct,
      passed,
      courseId: test.courseId ? String(test.courseId) : '',
      submissionId: submission._id
    });
  } catch (e) {
    console.error('POST /api/test/submit error:', e);
    res.status(500).json({ error: 'Failed to submit test' });
  }
});

// ==================== CERTIFICATES ====================

// List my certificates
app.get('/api/certificates/my', async (req, res) => {
  try {
    const list = await Certificate.find({ userId: req.userId }).sort({ issuedAt: -1, createdAt: -1 }).lean();
    res.json({ certificates: list });
  } catch (e) {
    console.error('GET /api/certificates/my error:', e);
    res.status(500).json({ error: 'Failed to load certificates' });
  }
});

// Generate certificate (server-side eligibility check + serial)
app.post('/api/certificates/generate', requireRole(['student']), async (req, res) => {
  try {
    const type = String(req.body.type || '').toLowerCase();
    const sourceId = String(req.body.sourceId || req.body.id || '').trim();
    if (!['course', 'test'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    if (!sourceId) return res.status(400).json({ error: 'sourceId required' });

    // Prevent duplicates (same user+type+sourceId)
    const existed = await Certificate.findOne({ userId: req.userId, type, sourceId }).lean();
    if (existed) return res.json({ success: true, certificate: existed, alreadyIssued: true });

    let title = '';
    let scoreVal = null;
    let issuedByTeacher = '';
    let issuedByPlatform = 'HALLAYM edu';

    if (type === 'course') {
      const course = await Course.findById(sourceId).lean();
      if (!course) return res.status(404).json({ error: 'Course not found' });

      // Must be joined
      const joined = await CourseEnrollment.findOne({ courseId: course._id, userId: req.userId }).lean();
      if (!joined) return res.status(403).json({ error: 'Not joined' });

      // Must complete all content items
      const items = await CourseContent.find({ courseId: course._id }).select('_id').lean();
      if (!items.length) return res.status(400).json({ error: 'Course has no content yet' });

      const prog = await CourseProgress.findOne({ courseId: course._id, userId: req.userId }).lean();
      const pmap = (prog?.progress && typeof prog.progress === 'object') ? prog.progress : {};
      const allDone = items.every(it => pmap[String(it._id)] === true);
      if (!allDone) return res.status(403).json({ error: 'Course is not completed yet' });
      const tStatus = await getCourseTestStatus(req.userId, course._id);
      if (!tStatus.passed) return res.status(403).json({ error: 'Final test is not passed yet' });

      title = course.title || 'Course';
      issuedByTeacher = String(course.teacherName || '').trim();
    } else {
      const test = await Test.findById(sourceId).lean();
      if (!test) return res.status(404).json({ error: 'Test not found' });

      // Must have passing submission (>=60)
      const last = await TestSubmission.findOne({ testId: test._id, userId: req.userId }).sort({ createdAt: -1 }).lean();
      if (!last) return res.status(403).json({ error: 'No submission' });
      const passPct = getSubmissionPassPct(test);
      if (Number(last.score || 0) < passPct) return res.status(403).json({ error: 'Score is below passing threshold' });

      title = test.title || 'Test';
      scoreVal = Number(last.score || 0);
      issuedByTeacher = String(test.teacherName || '').trim();
    }

    const serial = makeSerial(type, sourceId);
    const certId = makeSerial('CERT', sourceId);
    const secureKey = makeCertificateSecureKey('SK');
    const me = await User.findById(req.userId).select('fullName nickname username faculty studyGroup').lean();
    const fullName = String(
      req.body?.fullName ||
      me?.fullName ||
      me?.nickname ||
      me?.username ||
      'Student'
    ).trim().slice(0, 160);
    const facultyGroup = String(
      req.body?.facultyGroup ||
      [String(me?.faculty || '').trim(), String(me?.studyGroup || '').trim()].filter(Boolean).join(' • ')
    ).trim().slice(0, 200);
    if (!fullName) return res.status(400).json({ error: 'fullName required' });
    const verifyUrl = buildCertificateVerifyUrl(certId, req);
    const qrCodeUrl = buildCertificateQrUrl(verifyUrl);
    const issuedAt = new Date();
    const holderHash = buildCertificateHolderHash({
      userId: req.userId,
      fullName,
      facultyGroup,
      sourceId,
      secureKey
    });
    const signature = buildCertificateSignature({
      certId,
      serial,
      userId: req.userId,
      sourceId,
      secureKey,
      issuedAt
    });

    const cert = await Certificate.create({
      userId: req.userId,
      type,
      sourceId,
      title,
      fullName,
      facultyGroup,
      courseTitle: title,
      teacherName: issuedByTeacher,
      dateISO: issuedAt.toISOString().slice(0, 10),
      score: scoreVal,
      serial,
      certId,
      verifyUrl,
      qrCodeUrl,
      secureKey,
      holderHash,
      signature,
      issuedByTeacher,
      issuedByPlatform,
      issuedAt
    });

    res.status(201).json({ success: true, certificate: cert });
  } catch (e) {
    console.error('POST /api/certificates/generate error:', e);
    if (String(e?.code) === '11000') {
      const existed = await Certificate.findOne({ userId: req.userId, type: req.body.type, sourceId: String(req.body.sourceId || req.body.id || '') }).lean();
      return res.json({ success: true, certificate: existed, alreadyIssued: true });
    }
    res.status(500).json({ error: 'Failed to generate certificate' });
  }
});

// Admin: check platform wallet (adminBalance)
app.get('/api/admin/wallet', authenticateToken, attachUserRole, requireRole(['admin']), async (req, res) => {
  try {
    const wallet = await PlatformWallet.findOne({ key: 'platform_wallet' }).lean();
    res.json({ adminBalance: Number(wallet?.adminBalance || 0) });
  } catch (e) {
    console.error('GET /api/admin/wallet error:', e);
    res.status(500).json({ error: 'Failed to load wallet' });
  }
});


// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;

const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads', { recursive: true });
}


// ==================== ADMIN REALTIME (SNAPSHOT + ACTIONS) ====================

// Snapshot for admin dashboard (polling fallback + initial load)
app.get('/api/admin/realtime', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [usersCount, channelsCount, groupsCount] = await Promise.all([
      User.countDocuments(),
      Channel.countDocuments(),
      Group.countDocuments()
    ]);

    const onlineList = [];
    for (const [userId, s] of onlineUsers.entries()) {
      onlineList.push({
        userId,
        socketsCount: (s?.sockets && s.sockets.size) ? s.sockets.size : (s?.socketId ? 1 : 0),
        lastActive: s?.lastActive || Date.now()
      });
    }

    const privateCalls = Array.from(activePrivateCalls.values()).map(c => ({
      callId: String(c.callId),
      type: c.type,
      status: c.status,
      callerId: String(c.callerId),
      receiverId: String(c.receiverId),
      startedAt: c.startedAt
    }));

    const groupCalls = Array.from(activeGroupCalls.entries()).map(([groupId, call]) => ({
      groupId: String(groupId),
      callId: String(call.callId),
      callType: call.callType,
      startedBy: String(call.startedBy),
      startedAt: call.startedAt,
      participants: Array.from(call.participants || []).map(String)
    }));

    const channelLives = Array.from(activeChannelLives.entries()).map(([channelId, live]) => ({
      channelId: String(channelId),
      hostId: String(live.hostId),
      startedAt: live.startedAt,
      mode: live.mode,
      viewers: Array.from(live.viewers || []).map(String),
      viewersCount: (live.viewers && live.viewers.size) ? live.viewers.size : 0
    }));

    res.json({
      success: true,
      counts: {
        users: usersCount,
        channels: channelsCount,
        groups: groupsCount,
        onlineUsers: onlineUsers.size,
        activePrivateCalls: privateCalls.length,
        activeGroupCalls: groupCalls.length,
        activeChannelLives: channelLives.length
      },
      onlineUsers: onlineList,
      activePrivateCalls: privateCalls,
      activeGroupCalls: groupCalls,
      activeChannelLives: channelLives,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Admin realtime snapshot error:', error);
    res.status(500).json({ error: 'Failed to load realtime snapshot' });
  }
});

// Kick user (disconnect all sockets)
app.post('/api/admin/users/:id/kick', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.params.id || '');
    if (!userId) return res.status(400).json({ error: 'UserId required' });

    const socketIds = getUserSocketIds(userId);
    socketIds.forEach((sid) => {
      try {
        io.to(sid).emit('forceLogout', { reason: 'kicked_by_admin', timestamp: Date.now() });
        const s = io.sockets.sockets.get(sid);
        if (s) s.disconnect(true);
      } catch (e) {}
    });

    // Update DB to offline
    await User.findByIdAndUpdate(userId, { isOnline: false, status: 'offline', lastSeen: Date.now() }).catch(() => {});

    adminEmit('admin:action', { action: 'kick', userId, by: req.userId, timestamp: Date.now() });

    res.json({ success: true });
  } catch (error) {
    console.error('Admin kick user error:', error);
    res.status(500).json({ error: 'Failed to kick user' });
  }
});

// End group call
app.post('/api/admin/group-calls/:groupId/end', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const groupId = String(req.params.groupId || '');
    if (!groupId) return res.status(400).json({ error: 'GroupId required' });

    const call = activeGroupCalls.get(groupId);
    if (!call) return res.status(404).json({ error: 'No active call' });

    activeGroupCalls.delete(groupId);
    io.to(getGroupRoomName(groupId)).emit('groupCallEnded', {
      groupId,
      callId: call.callId,
      reason: 'ended_by_admin',
      timestamp: Date.now()
    });

    adminEmit('admin:action', { action: 'end_group_call', groupId, callId: call.callId, by: req.userId, timestamp: Date.now() });

    res.json({ success: true });
  } catch (error) {
    console.error('Admin end group call error:', error);
    res.status(500).json({ error: 'Failed to end group call' });
  }
});

// Stop channel live
app.post('/api/admin/channel-lives/:channelId/stop', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const channelId = String(req.params.channelId || '');
    if (!channelId) return res.status(400).json({ error: 'ChannelId required' });

    const live = activeChannelLives.get(channelId);
    if (!live) return res.status(404).json({ error: 'No active live' });

    activeChannelLives.delete(channelId);

    io.to(getChannelLiveRoomName(channelId)).emit('channelLive:ended', {
      channelId,
      hostId: live.hostId,
      reason: 'stopped_by_admin',
      timestamp: Date.now()
    });

    io.to(`channel_${channelId}`).emit('channelLive:status', {
      channelId,
      isLive: false,
      hostId: live.hostId,
      startedAt: null,
      mode: null,
      viewersCount: 0
    });

    adminEmit('admin:action', { action: 'stop_channel_live', channelId, hostId: live.hostId, by: req.userId, timestamp: Date.now() });

    res.json({ success: true });
  } catch (error) {
    console.error('Admin stop channel live error:', error);
    res.status(500).json({ error: 'Failed to stop channel live' });
  }
});


// ==================== ADMIN DASHBOARD (FULL CONTROL) ====================
// These endpoints are used by admin-dashboard3.html / admin-dashboard2.html
// All endpoints are protected by authenticateToken + requireAdmin

function parsePaging(req){
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '25', 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// Overview cards
app.get('/api/admin/overview', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [users, channels, groups, topupsPending, premiumPending, services] = await Promise.all([
      User.countDocuments(),
      Channel.countDocuments(),
      Group.countDocuments(),
      TopUpRequest.countDocuments({ status: 'pending' }),
      PremiumPaymentRequest.countDocuments({ status: 'pending' }),
      Service.countDocuments()
    ]);

    res.json({
      success: true,
      users,
      channels,
      groups,
      services,
      topupsPending,
      premiumPending,
      onlineUsers: onlineUsers.size,
      activePrivateCalls: activePrivateCalls.size,
      activeGroupCalls: activeGroupCalls.size,
      activeChannelLives: activeChannelLives.size,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('admin overview error', e);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// Users list (search + paging)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const q = String(req.query.q || '').trim();
    const query = {};
    if (q) {
      query.$or = [
        { username: new RegExp(q, 'i') },
        { fullName: new RegExp(q, 'i') },
        { nickname: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') }
      ];
    }
    const [total, items] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('username fullName nickname email avatar university faculty studyType studyGroup teachingSubject teachingSubjects role isAdmin verified coins banned banReason mutedUntil isOnline status lastSeen createdAt')
        .lean()
    ]);
    res.json({ success: true, page, limit, total, items, users: items });
  } catch (e) {
    console.error('admin users list error', e);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// Organizer accounts (created only by admin)
app.get('/api/admin/organizers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const q = cleanText(req.query.q, 120);
    const query = { role: 'organizer', isAdmin: { $ne: true } };
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      query.$or = [
        { username: re },
        { fullName: re },
        { nickname: re },
        { university: re },
        { faculty: re },
        { studyType: re },
        { studyGroup: re }
      ];
    }
    const items = await User.find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .select('username fullName nickname email phone university faculty studyType studyGroup role createdAt')
      .lean();
    res.json({ success: true, organizers: items });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load organizers' });
  }
});

app.post('/api/admin/organizers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const fullName = cleanText(body.fullName, 80);
    const nickname = cleanText(body.nickname, 40) || (fullName ? fullName.split(/\s+/)[0] : '');
    const username = cleanText(body.username, 40).toLowerCase();
    const password = String(body.password || '');
    const phone = cleanText(body.phone, 30);
    const email = cleanText(body.email, 120).toLowerCase();
    const bio = cleanText(body.bio, 500);

    if (!fullName) return res.status(400).json({ error: 'Full name required' });
    if (!username) return res.status(400).json({ error: 'Username required' });
    if (!/^[a-zA-Z0-9._]{3,24}$/.test(username)) {
      return res.status(400).json({ error: 'Username format invalid (3-24, letters/numbers/._)' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const academic = await normalizeAcademicIdentity({
      university: body.university,
      faculty: body.faculty
    }, {
      requireUniversity: true,
      requireFaculty: true,
      requireStudyType: false,
      requireStudyGroup: false
    });
    if (!academic.ok) return res.status(400).json({ error: academic.error });

    let canonicalStudyType = await pickCanonicalStudyType(
      academic.value.university,
      academic.value.faculty,
      'Kunduzgi'
    );
    if (!canonicalStudyType) {
      const firstType = await StudyTypeCatalog.findOne({
        university: academic.value.university,
        faculty: academic.value.faculty
      }).sort({ name: 1 }).lean();
      canonicalStudyType = cleanText(firstType?.name, 80) || 'Kunduzgi';
      if (!firstType) {
        await StudyTypeCatalog.updateOne(
          { university: academic.value.university, faculty: academic.value.faculty, name: canonicalStudyType },
          { $setOnInsert: { university: academic.value.university, faculty: academic.value.faculty, name: canonicalStudyType } },
          { upsert: true }
        ).catch(() => {});
      }
    }

    let canonicalStudyGroup = '';
    const firstGroup = await StudyGroupCatalog.findOne({
      university: academic.value.university,
      faculty: academic.value.faculty,
      studyType: canonicalStudyType
    }).sort({ name: 1 }).lean();
    canonicalStudyGroup = cleanText(firstGroup?.name, 80);
    if (!canonicalStudyGroup) {
      let candidate = 'Organizer-Default';
      let i = 2;
      while (await StudyGroupCatalog.findOne({
        university: academic.value.university,
        faculty: academic.value.faculty,
        studyType: canonicalStudyType,
        name: new RegExp(`^${escapeRegex(candidate)}$`, 'i')
      }).lean()) {
        candidate = `Organizer-${i++}`;
      }
      canonicalStudyGroup = candidate;
      await StudyGroupCatalog.updateOne(
        {
          university: academic.value.university,
          faculty: academic.value.faculty,
          studyType: canonicalStudyType,
          name: canonicalStudyGroup
        },
        {
          $setOnInsert: {
            university: academic.value.university,
            faculty: academic.value.faculty,
            studyType: canonicalStudyType,
            name: canonicalStudyGroup
          }
        },
        { upsert: true }
      ).catch(() => {});
    }

    const existingUsername = await User.findOne({ username }).select('_id').lean();
    if (existingUsername) return res.status(409).json({ error: 'Username already exists' });
    if (phone) {
      const existingPhone = await User.findOne({ phone }).select('_id').lean();
      if (existingPhone) return res.status(409).json({ error: 'Phone number already registered' });
    }
    if (email) {
      const existingEmail = await User.findOne({ email }).select('_id').lean();
      if (existingEmail) return res.status(409).json({ error: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const created = await User.create({
      fullName,
      nickname,
      username,
      bio,
      university: academic.value.university,
      faculty: academic.value.faculty,
      studyType: canonicalStudyType,
      studyGroup: canonicalStudyGroup,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      password: hashed,
      role: 'organizer',
      isAdmin: false
    });

    await Stats.findOneAndUpdate({}, { $inc: { totalUsers: 1 } }).catch(() => null);
    await audit(req, 'ORGANIZER_CREATE', 'user', String(created._id), { username: created.username });

    const safe = await User.findById(created._id)
      .select('username fullName nickname email phone university faculty studyType studyGroup role createdAt')
      .lean();
    res.status(201).json({ success: true, organizer: safe });
  } catch (e) {
    console.error('POST /api/admin/organizers error:', e);
    if (String(e?.code) === '11000') return res.status(409).json({ error: 'Duplicate value (username/phone/email)' });
    res.status(500).json({ error: 'Failed to create organizer' });
  }
});

// Channels list
app.get('/api/admin/channels', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const q = String(req.query.q || '').trim();
    const query = {};
    if (q) {
      query.$or = [
        { name: new RegExp(q, 'i') },
        { title: new RegExp(q, 'i') },
        { description: new RegExp(q, 'i') }
      ];
    }
    const [total, items] = await Promise.all([
      Channel.countDocuments(query),
      Channel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);
    res.json({ success: true, page, limit, total, items, channels: items });
  } catch (e) {
    console.error('admin channels list error', e);
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

// Groups list
app.get('/api/admin/groups', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const q = String(req.query.q || '').trim();
    const query = {};
    if (q) {
      query.$or = [
        { name: new RegExp(q, 'i') },
        { title: new RegExp(q, 'i') },
        { description: new RegExp(q, 'i') }
      ];
    }
    const [total, items] = await Promise.all([
      Group.countDocuments(query),
      Group.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);
    res.json({ success: true, page, limit, total, items, groups: items });
  } catch (e) {
    console.error('admin groups list error', e);
    res.status(500).json({ error: 'Failed to load groups' });
  }
});

// Services list
app.get('/api/admin/services', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const q = String(req.query.q || '').trim();
    const query = {};
    if (q) {
      query.$or = [
        { title: new RegExp(q, 'i') },
        { description: new RegExp(q, 'i') },
        { category: new RegExp(q, 'i') }
      ];
    }
    const [total, items] = await Promise.all([
      Service.countDocuments(query),
      Service.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);
    res.json({ success: true, page, limit, total, items, services: items });
  } catch (e) {
    console.error('admin services list error', e);
    res.status(500).json({ error: 'Failed to load services' });
  }
});

// Private messages list (moderation)
app.get('/api/admin/private-messages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const q = String(req.query.q || '').trim();
    const query = {};
    if (q) {
      // match message text and optional sender/receiver ids
      query.$or = [
        { text: new RegExp(q, 'i') },
        { message: new RegExp(q, 'i') },
        { senderId: q },
        { receiverId: q }
      ];
    }
    const [total, items] = await Promise.all([
      Message.countDocuments(query),
      Message.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);
    res.json({ success: true, page, limit, total, items, messages: items });
  } catch (e) {
    console.error('admin private-messages list error', e);
    res.status(500).json({ error: 'Failed to load private messages' });
  }
});





// ==================== ADMIN MODERATION / MANAGEMENT ====================

// Delete a private message by id (moderation)
// NOTE: This action is audited.
app.delete('/api/admin/private-messages/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const msg = await Message.findById(id).lean();
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    await Message.deleteOne({ _id: id });
    await audit(req, 'PM_DELETE', 'message', id, { senderId: String(msg.senderId), receiverId: String(msg.receiverId) });

    res.json({ success: true });
  } catch (e) {
    console.error('admin private-messages delete error', e);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Conversations list (who talks with whom) WITHOUT loading full thread by default.
// Returns unique pairs with last message metadata.
app.get('/api/admin/conversations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const q = String(req.query.q || '').trim();

    // Aggregate by unordered pair (A,B)
    const pipeline = [
      {
        $project: {
          senderId: 1,
          receiverId: 1,
          text: 1,
          mediaType: 1,
          createdAt: 1,
          pairA: { $cond: [{ $lt: ['$senderId', '$receiverId'] }, '$senderId', '$receiverId'] },
          pairB: { $cond: [{ $lt: ['$senderId', '$receiverId'] }, '$receiverId', '$senderId'] }
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { a: '$pairA', b: '$pairB' },
          lastAt: { $first: '$createdAt' },
          lastText: { $first: '$text' },
          lastMediaType: { $first: '$mediaType' }
        }
      },
      { $sort: { lastAt: -1 } }
    ];

    // Optional search: by userId or by text snippet
    // For better UX, allow q to match either an ObjectId string or lastText.
    if (q) {
      pipeline.unshift({
        $match: {
          $or: [
            { senderId: mongoose.Types.ObjectId.isValid(q) ? new mongoose.Types.ObjectId(q) : undefined },
            { receiverId: mongoose.Types.ObjectId.isValid(q) ? new mongoose.Types.ObjectId(q) : undefined },
            { text: new RegExp(q, 'i') }
          ].filter(Boolean)
        }
      });
    }

    const all = await Message.aggregate(pipeline);
    const total = all.length;
    const slice = all.slice(skip, skip + limit);

    const ids = Array.from(new Set(slice.flatMap(x => [String(x._id.a), String(x._id.b)])));
    const users = await User.find({ _id: { $in: ids } }).select('fullName username role avatar').lean();
    const umap = new Map(users.map(u => [String(u._id), u]));

    const items = slice.map(x => ({
      a: String(x._id.a),
      b: String(x._id.b),
      lastAt: x.lastAt,
      lastText: x.lastText || '',
      lastMediaType: x.lastMediaType || '',
      userA: umap.get(String(x._id.a)) || null,
      userB: umap.get(String(x._id.b)) || null
    }));

    await audit(req, 'PM_CONVERSATIONS_LIST', 'message', '', { q, page, limit });

    res.json({ success: true, page, limit, total, items });
  } catch (e) {
    console.error('admin conversations list error', e);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// Conversation thread (paginated)
app.get('/api/admin/conversations/:a/:b/messages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const a = req.params.a;
    const b = req.params.b;
    if (!mongoose.Types.ObjectId.isValid(a) || !mongoose.Types.ObjectId.isValid(b)) {
      return res.status(400).json({ error: 'Invalid user ids' });
    }

    const q = String(req.query.q || '').trim();
    const query = {
      $or: [
        { senderId: a, receiverId: b },
        { senderId: b, receiverId: a }
      ]
    };
    if (q) query.text = new RegExp(q, 'i');

    const [total, items] = await Promise.all([
      Message.countDocuments(query),
      Message.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);

    await audit(req, 'PM_THREAD_VIEW', 'user', `${a}<->${b}`, { q, page, limit });

    res.json({ success: true, page, limit, total, items });
  } catch (e) {
    console.error('admin conversation thread error', e);
    res.status(500).json({ error: 'Failed to load thread' });
  }
});

// Group messages (by groupId)
app.get('/api/admin/group-messages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const groupId = String(req.query.groupId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(groupId)) return res.status(400).json({ error: 'groupId required' });

    const q = String(req.query.q || '').trim();
    const query = { groupId };
    if (q) query.text = new RegExp(q, 'i');

    const [total, raw] = await Promise.all([
      GroupMessage.countDocuments(query),
      GroupMessage.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);

    // Enrich sender info (fullName + username) for UI
    const senderIds = Array.from(new Set((raw || []).map(m => String(m.senderId)).filter(Boolean)));
    const senders = senderIds.length
      ? await User.find({ _id: { $in: senderIds } }).select('fullName username avatar').lean()
      : [];
    const senderMap = new Map((senders || []).map(u => [String(u._id), u]));

    const items = (raw || []).map(m => ({
      ...m,
      sender: (() => {
        const u = senderMap.get(String(m.senderId));
        return u ? { _id: String(u._id), fullName: u.fullName || '', username: u.username || '', avatar: u.avatar || '' } : null;
      })()
    }));

    await audit(req, 'GROUP_MSG_LIST', 'group', groupId, { q, page, limit });

    res.json({ success: true, page, limit, total, items });
  } catch (e) {
    console.error('admin group-messages list error', e);
    res.status(500).json({ error: 'Failed to load group messages' });
  }
});

// Delete group message
app.delete('/api/admin/group-messages/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const msg = await GroupMessage.findById(id).lean();
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    await GroupMessage.deleteOne({ _id: id });
    await audit(req, 'GROUP_MSG_DELETE', 'message', id, { groupId: String(msg.groupId), senderId: String(msg.senderId) });

    res.json({ success: true });
  } catch (e) {
    console.error('admin group-messages delete error', e);
    res.status(500).json({ error: 'Failed to delete group message' });
  }
});

// Channel posts list (by channelId)
app.get('/api/admin/channel-posts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const channelId = String(req.query.channelId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(channelId)) return res.status(400).json({ error: 'channelId required' });

    const q = String(req.query.q || '').trim();
    const query = { channelId };
    if (q) query.$or = [{ title: new RegExp(q, 'i') }, { content: new RegExp(q, 'i') }];

    const [total, items] = await Promise.all([
      ChannelPost.countDocuments(query),
      ChannelPost.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);

    await audit(req, 'CHANNEL_POST_LIST', 'channel', channelId, { q, page, limit });

    res.json({ success: true, page, limit, total, items });
  } catch (e) {
    console.error('admin channel-posts list error', e);
    res.status(500).json({ error: 'Failed to load channel posts' });
  }
});

// Delete ch
// ==================== ADMIN EDIT: GROUPS / CHANNELS ====================
function normalizeHandle(v){
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

app.patch('/api/admin/groups/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid group id' });

    const g = await Group.findById(id);
    if (!g) return res.status(404).json({ error: 'Group not found' });

    const payload = req.body || {};
    const updates = {};

    if (payload.name !== undefined) updates.name = String(payload.name || '').trim();
    if (payload.description !== undefined) updates.description = String(payload.description || '').trim();
    if (payload.avatar !== undefined) updates.avatar = String(payload.avatar || '').trim();
    if (payload.previewImage !== undefined) updates.previewImage = String(payload.previewImage || '').trim();
    if (payload.isPublic !== undefined) updates.isPublic = !!payload.isPublic;

    if (payload.username !== undefined) {
      const u = normalizeHandle(payload.username);
      if (!u) return res.status(400).json({ error: 'username invalid' });
      const exists = await Group.findOne({ username: u, _id: { $ne: id } }).select('_id').lean();
      if (exists) return res.status(409).json({ error: 'username already used' });
      updates.username = u;
    }

    Object.assign(g, updates);
    await g.save();

    await audit(req, 'GROUP_UPDATE', 'group', id, { updates: Object.keys(updates) });

    res.json({ success: true, group: g.toObject() });
  } catch (e) {
    console.error('admin group patch error', e);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

app.patch('/api/admin/channels/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid channel id' });

    const ch = await Channel.findById(id);
    if (!ch) return res.status(404).json({ error: 'Channel not found' });

    const payload = req.body || {};
    const updates = {};

    if (payload.name !== undefined) updates.name = String(payload.name || '').trim();
    if (payload.description !== undefined) updates.description = String(payload.description || '').trim();
    if (payload.avatar !== undefined) updates.avatar = String(payload.avatar || '').trim();
    if (payload.category !== undefined) updates.category = String(payload.category || '').trim();
    if (payload.university !== undefined) updates.university = String(payload.university || '').trim();
    if (payload.isPublic !== undefined) updates.isPublic = !!payload.isPublic;

    if (payload.username !== undefined) {
      const u = normalizeHandle(payload.username);
      if (!u) return res.status(400).json({ error: 'username invalid' });
      const exists = await Channel.findOne({ username: u, _id: { $ne: id } }).select('_id').lean();
      if (exists) return res.status(409).json({ error: 'username already used' });
      updates.username = u;
    }

    Object.assign(ch, updates);
    await ch.save();

    await audit(req, 'CHANNEL_UPDATE', 'channel', id, { updates: Object.keys(updates) });

    res.json({ success: true, channel: ch.toObject() });
  } catch (e) {
    console.error('admin channel patch error', e);
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

// ==================== ADMIN: GROUP LESSONS (recordings list) ====================
// Lists recorded lessons (and live/ended sessions) by group for admin panel.
app.get('/api/admin/group-lessons', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const groupId = String(req.query.groupId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(groupId)) return res.status(400).json({ error: 'groupId required' });

    const q = String(req.query.q || '').trim();
    const query = { groupId };
    if (q) query.title = new RegExp(q, 'i');

    const [total, raw] = await Promise.all([
      GroupLesson.countDocuments(query),
      GroupLesson.find(query).sort({ startedAt: -1 }).skip(skip).limit(limit).lean()
    ]);

    const hostIds = Array.from(new Set((raw || []).map(x => String(x.hostId)).filter(Boolean)));
    const hosts = hostIds.length
      ? await User.find({ _id: { $in: hostIds } }).select('fullName username avatar role').lean()
      : [];
    const hostMap = new Map((hosts || []).map(u => [String(u._id), u]));

    const group = await Group.findById(groupId).select('name username').lean();

    const items = (raw || []).map(x => ({
      ...x,
      group: group ? { _id: String(group._id), name: group.name || '', username: group.username || '' } : null,
      host: (() => {
        const u = hostMap.get(String(x.hostId));
        return u ? { _id: String(u._id), fullName: u.fullName || '', username: u.username || '', avatar: u.avatar || '', role: u.role || '' } : null;
      })()
    }));

    await audit(req, 'GROUP_LESSON_LIST', 'group', groupId, { q, page, limit });

    res.json({ success: true, page, limit, total, items });
  } catch (e) {
    console.error('admin group-lessons list error', e);
    res.status(500).json({ error: 'Failed to load group lessons' });
  }
});

// Admin: delete only lesson recording media (keeps lesson + attendance metadata)
app.delete('/api/admin/group-lessons/:lessonId/recording', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const lessonId = String(req.params.lessonId || '');
    if (!mongoose.Types.ObjectId.isValid(lessonId)) {
      return res.status(400).json({ error: 'Invalid lesson id' });
    }

    const lesson = await GroupLesson.findById(lessonId);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const recordingUrl = String(lesson.recordingUrl || '').trim();
    const recordingPublicId = String(lesson.recordingPublicId || '').trim();

    // Cloudinary cleanup (best effort)
    if (recordingPublicId) {
      try {
        await cloudinary.uploader.destroy(recordingPublicId, { resource_type: 'video', invalidate: true });
      } catch (cloudErr) {
        console.warn('admin lesson recording delete cloudinary warn:', cloudErr?.message || cloudErr);
      }
    }

    // Local file cleanup (best effort)
    if (recordingUrl.startsWith('/uploads/lessons/')) {
      try {
        const fs = require('fs');
        const baseDir = path.join(__dirname, 'uploads', 'lessons');
        const fileName = path.basename(recordingUrl);
        const filePath = path.join(baseDir, fileName);
        if (filePath.startsWith(baseDir) && fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath).catch(() => null);
        }
      } catch (localErr) {
        console.warn('admin lesson recording delete local warn:', localErr?.message || localErr);
      }
    }

    lesson.recordingUrl = '';
    lesson.recordingPublicId = '';
    lesson.recordingBytes = 0;
    lesson.recordingDurationSec = 0;
    await lesson.save();

    await audit(req, 'GROUP_LESSON_RECORDING_DELETE', 'lesson', lessonId, {
      groupId: String(lesson.groupId || ''),
      hadRecording: !!recordingUrl
    });

    res.json({ success: true });
  } catch (e) {
    console.error('admin group lesson recording delete error', e);
    res.status(500).json({ error: 'Failed to delete lesson recording' });
  }
});

// Delete channel post
app.delete('/api/admin/channel-posts/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const post = await ChannelPost.findById(id).lean();
    if (!post) return res.status(404).json({ error: 'Post not found' });

    await ChannelPost.deleteOne({ _id: id });
    await ChannelPostComment.deleteMany({ postId: id });

    await audit(req, 'CHANNEL_POST_DELETE', 'post', id, { channelId: String(post.channelId) });

    res.json({ success: true });
  } catch (e) {
    console.error('admin channel-posts delete error', e);
    res.status(500).json({ error: 'Failed to delete channel post' });
  }
});

// Admin deletes for core entities (channels/groups/services)
// NOTE: Also cascade-delete related docs to prevent orphaned data.
app.delete('/api/admin/channels/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const ch = await Channel.findById(id).lean();
    if (!ch) return res.status(404).json({ error: 'Channel not found' });

    // collect post ids first for comment cleanup
    const posts = await ChannelPost.find({ channelId: id }).select('_id').lean();
    const postIds = (posts || []).map(p => p._id);

    if (postIds.length) {
      await ChannelPostComment.deleteMany({ postId: { $in: postIds } });
    }
    await ChannelPost.deleteMany({ channelId: id });
    await Channel.deleteOne({ _id: id });

    await audit(req, 'CHANNEL_DELETE', 'channel', id, { username: ch.username });

    res.json({ success: true });
  } catch (e) {
    console.error('admin channel delete error', e);
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

app.delete('/api/admin/groups/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const g = await Group.findById(id).lean();
    if (!g) return res.status(404).json({ error: 'Group not found' });

    await Group.deleteOne({ _id: id });
    await GroupMessage.deleteMany({ groupId: id });
    await GroupLesson.deleteMany({ groupId: id }).catch(()=>null);
    await GroupAttendance.deleteMany({ groupId: id }).catch(()=>null);

    await audit(req, 'GROUP_DELETE', 'group', id, { username: g.username });

    res.json({ success: true });
  } catch (e) {
    console.error('admin group delete error', e);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

app.delete('/api/admin/services/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const svc = await Service.findById(id).lean();
    if (!svc) return res.status(404).json({ error: 'Service not found' });

    await Service.deleteOne({ _id: id });
    await ServiceOrder.deleteMany({ serviceId: id }).catch(()=>null);
    await ServiceReview.deleteMany({ serviceId: id }).catch(()=>null);

    await audit(req, 'SERVICE_DELETE', 'service', id, { title: svc.title });

    res.json({ success: true });
  } catch (e) {
    console.error('admin service delete error', e);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// Audit logs list (for transparency/compliance)
app.get('/api/admin/audit', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req);
    const q = String(req.query.q || '').trim();
    const query = {};
    if (q) {
      query.$or = [
        { action: new RegExp(q, 'i') },
        { targetType: new RegExp(q, 'i') },
        { targetId: new RegExp(q, 'i') }
      ];
    }
    const [total, items] = await Promise.all([
      AdminAudit.countDocuments(query),
      AdminAudit.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);
    res.json({ success: true, page, limit, total, items });
  } catch (e) {
    console.error('admin audit list error', e);
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});



// ==================== LMS V2 COMPATIBILITY (server84) ====================

// Compute course completion percentage based on CourseProgress + CourseContent count
async function getCourseCompletion(userId, courseId) {
  const contents = await CourseContent.find({ courseId }).select('_id').lean();
  const totalLessons = contents.length;
  const pr = await CourseProgress.findOne({ courseId, userId }).lean();
  const map = (pr && pr.progress && typeof pr.progress === 'object') ? pr.progress : {};
  const doneIds = Object.keys(map).filter(k => map[k]);
  const doneLessonIds = doneIds;
  const pct = totalLessons ? Math.round((doneLessonIds.length / totalLessons) * 100) : (doneLessonIds.length ? 100 : 0);
  return { totalLessons, doneLessonIds, pct };
}

async function getCourseTestStatus(userId, courseId) {
  const course = await Course.findById(courseId).select('finalTestId testIds').lean();
  if (!course) return { required: false, passed: false, finalTestId: '', passedTestIds: [] };

  const rawIds = [];
  if (course.finalTestId) rawIds.push(String(course.finalTestId));
  if (Array.isArray(course.testIds)) rawIds.push(...course.testIds.map((x) => String(x)));
  const testIds = Array.from(new Set(rawIds.filter(Boolean)));
  if (!testIds.length) return { required: false, passed: true, finalTestId: '', passedTestIds: [] };

  const [tests, submissions, pr] = await Promise.all([
    Test.find({ _id: { $in: testIds } }).select('_id passPct').lean(),
    TestSubmission.find({ userId, testId: { $in: testIds } }).sort({ createdAt: -1 }).lean(),
    CourseProgress.findOne({ courseId, userId }).select('testsPassed').lean()
  ]);

  const passByTest = new Map();
  const passPctMap = new Map((tests || []).map((t) => [String(t._id), getSubmissionPassPct(t)]));
  for (const t of (tests || [])) passByTest.set(String(t._id), false);

  for (const s of (submissions || [])) {
    const tid = String(s.testId);
    if (!passByTest.has(tid) || passByTest.get(tid)) continue;
    const need = Number(passPctMap.get(tid) || 60);
    if (Number(s.score || 0) >= need) passByTest.set(tid, true);
  }

  const passedMap = (pr?.testsPassed && typeof pr.testsPassed === 'object') ? pr.testsPassed : {};
  for (const tid of testIds) {
    if (passedMap[tid] === true) passByTest.set(tid, true);
  }

  const finalTestId = course.finalTestId ? String(course.finalTestId) : '';
  const required = !!finalTestId;
  const passed = required ? !!passByTest.get(finalTestId) : true;
  const passedTestIds = testIds.filter((tid) => !!passByTest.get(tid));

  return { required, passed, finalTestId, allTestIds: testIds, passedTestIds };
}

// New: progress endpoints used by improved joinedcourse/certificate
app.get('/api/progress/:courseId', authenticateToken, attachUserRole, requireRole(['student','admin','teacher']), async (req, res) => {
  try {
    const courseId = req.params.courseId;
    const [info, test, progressDoc] = await Promise.all([
      getCourseCompletion(req.userId, courseId),
      getCourseTestStatus(req.userId, courseId),
      CourseProgress.findOne({ courseId, userId: req.userId }).lean()
    ]);
    res.json({
      ok: true,
      courseId,
      ...info,
      lastLessonId: String(progressDoc?.lastLessonId || ''),
      lessonQuizResults: (progressDoc?.lessonQuizResults && typeof progressDoc.lessonQuizResults === 'object')
        ? progressDoc.lessonQuizResults
        : {},
      testPassed: !!test.passed,
      requiredFinalTest: !!test.required,
      finalTestId: test.finalTestId || '',
      passedTestIds: test.passedTestIds || []
    });
  } catch (e) {
    console.error('GET /api/progress/:courseId error:', e);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

// Accept {doneLessonIds:[contentId]} OR {contentId, done:true/false}
app.post('/api/progress/:courseId', authenticateToken, attachUserRole, requireRole(['student','admin','teacher']), async (req, res) => {
  try {
    const courseId = req.params.courseId;
    const body = req.body || {};
    const setMap = {};

    if (Array.isArray(body.doneLessonIds)) {
      for (const id of body.doneLessonIds) setMap[String(id)] = true;
    } else if (body.contentId) {
      setMap[String(body.contentId)] = body.done !== false;
    } else {
      return res.status(400).json({ error: 'doneLessonIds[] or contentId required' });
    }

    const cur = await CourseProgress.findOne({ courseId, userId: req.userId });
    const merged = Object.assign({}, (cur?.progress && typeof cur.progress === 'object') ? cur.progress : {}, setMap);
    const mergedLessonQuizResults = (
      body.lessonQuizResults && typeof body.lessonQuizResults === 'object'
    ) ? Object.assign({}, (cur?.lessonQuizResults && typeof cur.lessonQuizResults === 'object') ? cur.lessonQuizResults : {}, body.lessonQuizResults) : (
      (cur?.lessonQuizResults && typeof cur.lessonQuizResults === 'object') ? cur.lessonQuizResults : {}
    );
    const lastLessonId = String(body.lastLessonId || body.contentId || cur?.lastLessonId || '').trim();

    const updated = await CourseProgress.findOneAndUpdate(
      { courseId, userId: req.userId },
      {
        $set: {
          progress: merged,
          lessonQuizResults: mergedLessonQuizResults,
          lastLessonId,
          lastActivityAt: new Date()
        }
      },
      { upsert: true, new: true }
    ).lean();

    const info = await getCourseCompletion(req.userId, courseId);
    const test = await getCourseTestStatus(req.userId, courseId);
    res.json({
      ok: true,
      progress: updated?.progress || {},
      ...info,
      lastLessonId: String(updated?.lastLessonId || ''),
      lessonQuizResults: (updated?.lessonQuizResults && typeof updated.lessonQuizResults === 'object')
        ? updated.lessonQuizResults
        : {},
      testPassed: !!test.passed,
      requiredFinalTest: !!test.required,
      finalTestId: test.finalTestId || '',
      passedTestIds: test.passedTestIds || []
    });
  } catch (e) {
    console.error('POST /api/progress/:courseId error:', e);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// Compatibility aliases used by legacy pages
app.get('/api/progress', authenticateToken, attachUserRole, requireRole(['student','admin','teacher']), async (req, res) => {
  try {
    const courseId = String(req.query.courseId || req.query.id || '').trim();
    if (!courseId) return res.status(400).json({ error: 'courseId required' });
    const [info, test, progressDoc] = await Promise.all([
      getCourseCompletion(req.userId, courseId),
      getCourseTestStatus(req.userId, courseId),
      CourseProgress.findOne({ courseId, userId: req.userId }).lean()
    ]);
    res.json({
      ok: true,
      courseId,
      ...info,
      lastLessonId: String(progressDoc?.lastLessonId || ''),
      lessonQuizResults: (progressDoc?.lessonQuizResults && typeof progressDoc.lessonQuizResults === 'object')
        ? progressDoc.lessonQuizResults
        : {},
      testPassed: !!test.passed,
      requiredFinalTest: !!test.required,
      finalTestId: test.finalTestId || '',
      passedTestIds: test.passedTestIds || []
    });
  } catch (e) {
    console.error('GET /api/progress error:', e);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

app.post('/api/progress', authenticateToken, attachUserRole, requireRole(['student','admin','teacher']), async (req, res) => {
  try {
    const courseId = String(req.body?.courseId || req.body?.id || '').trim();
    if (!courseId) return res.status(400).json({ error: 'courseId required' });
    const body = req.body || {};
    const setMap = {};

    if (Array.isArray(body.doneLessonIds)) {
      for (const id of body.doneLessonIds) setMap[String(id)] = true;
    } else if (body.contentId) {
      setMap[String(body.contentId)] = body.done !== false;
    } else if (body.progress && typeof body.progress === 'object') {
      Object.assign(setMap, body.progress);
    } else {
      return res.status(400).json({ error: 'doneLessonIds[] or contentId required' });
    }

    const cur = await CourseProgress.findOne({ courseId, userId: req.userId }).lean();
    const merged = Object.assign({}, (cur?.progress && typeof cur.progress === 'object') ? cur.progress : {}, setMap);
    const mergedLessonQuizResults = (
      body.lessonQuizResults && typeof body.lessonQuizResults === 'object'
    ) ? Object.assign({}, (cur?.lessonQuizResults && typeof cur.lessonQuizResults === 'object') ? cur.lessonQuizResults : {}, body.lessonQuizResults) : (
      (cur?.lessonQuizResults && typeof cur.lessonQuizResults === 'object') ? cur.lessonQuizResults : {}
    );
    const updated = await CourseProgress.findOneAndUpdate(
      { courseId, userId: req.userId },
      {
        $set: {
          progress: merged,
          lessonQuizResults: mergedLessonQuizResults,
          lastLessonId: String(body.lastLessonId || body.contentId || cur?.lastLessonId || '').trim(),
          lastActivityAt: new Date()
        }
      },
      { upsert: true, new: true }
    ).lean();

    const info = await getCourseCompletion(req.userId, courseId);
    const test = await getCourseTestStatus(req.userId, courseId);
    res.json({
      ok: true,
      courseId,
      ...info,
      lastLessonId: String(updated?.lastLessonId || ''),
      lessonQuizResults: (updated?.lessonQuizResults && typeof updated.lessonQuizResults === 'object')
        ? updated.lessonQuizResults
        : {},
      testPassed: !!test.passed,
      requiredFinalTest: !!test.required,
      finalTestId: test.finalTestId || '',
      passedTestIds: test.passedTestIds || []
    });
  } catch (e) {
    console.error('POST /api/progress error:', e);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// Eligibility check (new front-end)
app.get('/api/certificate/check', authenticateToken, attachUserRole, requireRole(['student','admin']), async (req, res) => {
  try {
    const courseId = req.query.courseId;
    if (!courseId) return res.status(400).json({ error: 'courseId required' });

    const course = await Course.findById(courseId).select('title status type price teacherId teacherName').lean();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    // Must be joined (for student)
    const role = String(req.userRole || '').toLowerCase();
    if (role === 'student') {
      const en = await CourseEnrollment.findOne({ courseId, userId: req.userId }).lean();
      if (!en) return res.json({ ok: false, eligible: false, reason: 'not_joined' });
    }

    const info = await getCourseCompletion(req.userId, courseId);
    const test = await getCourseTestStatus(req.userId, courseId);
    const eligible = info.pct >= 100 && (!!test.passed);
    res.json({
      ok: eligible,
      eligible,
      courseId,
      pct: info.pct,
      totalLessons: info.totalLessons,
      doneLessonIds: info.doneLessonIds,
      requiredFinalTest: !!test.required,
      finalTestId: test.finalTestId || '',
      testPassed: !!test.passed,
      passedTestIds: test.passedTestIds || [],
      reason: eligible ? '' : (info.pct < 100 ? 'course_not_completed' : 'final_test_not_passed')
    });
  } catch (e) {
    console.error('GET /api/certificate/check error:', e);
    res.status(500).json({ error: 'Failed to check eligibility' });
  }
});

// Alias
app.get('/api/certificates/eligible', authenticateToken, attachUserRole, requireRole(['student','admin']), async (req, res) => {
  try {
    const courseId = String(req.query.courseId || req.query.id || '').trim();
    if (!courseId) return res.status(400).json({ error: 'courseId required' });

    const role = String(req.userRole || '').toLowerCase();
    if (role === 'student') {
      const en = await CourseEnrollment.findOne({ courseId, userId: req.userId }).lean();
      if (!en) return res.json({ ok: false, eligible: false, reason: 'not_joined' });
    }

    const info = await getCourseCompletion(req.userId, courseId);
    const test = await getCourseTestStatus(req.userId, courseId);
    const eligible = info.pct >= 100 && (!!test.passed);
    res.json({
      ok: eligible,
      eligible,
      courseId,
      pct: info.pct,
      totalLessons: info.totalLessons,
      doneLessonIds: info.doneLessonIds,
      requiredFinalTest: !!test.required,
      finalTestId: test.finalTestId || '',
      testPassed: !!test.passed,
      passedTestIds: test.passedTestIds || [],
      reason: eligible ? '' : (info.pct < 100 ? 'course_not_completed' : 'final_test_not_passed')
    });
  } catch (e) {
    console.error('GET /api/certificates/eligible error:', e);
    res.status(500).json({ error: 'Failed to check eligibility' });
  }
});

// Create certificate record (new UI)
app.post('/api/certificates', authenticateToken, attachUserRole, requireRole(['student','admin']), async (req, res) => {
  try {
    const body = req.body || {};
    const certId = String(body.certId || body.serial || makeSerial('CERT', body.courseId || body.sourceId || 'COURSE')).trim();
    const courseId = String(body.courseId || body.sourceId || '').trim();
    if (!courseId) return res.status(400).json({ error: 'courseId required' });

    // server-side eligibility (student)
    const role = String(req.userRole || '').toLowerCase();
    if (role === 'student') {
      const en = await CourseEnrollment.findOne({ courseId, userId: req.userId }).lean();
      if (!en) return res.status(403).json({ error: 'Not joined' });
    }
    const info = await getCourseCompletion(req.userId, courseId);
    if (info.pct < 100) return res.status(403).json({ error: 'Course not completed' });
    const test = await getCourseTestStatus(req.userId, courseId);
    if (!test.passed) return res.status(403).json({ error: 'Final test is not passed' });

    const course = await Course.findById(courseId).select('title teacherName').lean();
    const me = await User.findById(req.userId).select('fullName nickname username faculty studyGroup').lean();
    const fullName = String(body.fullName || me?.fullName || me?.nickname || me?.username || '').trim().slice(0, 160);
    const facultyGroup = String(body.facultyGroup || body.fg || [me?.faculty, me?.studyGroup].filter(Boolean).join(' • ') || '').trim().slice(0, 200);
    if (!fullName) return res.status(400).json({ error: 'fullName required' });
    const serial = String(body.serial || makeSerial('COURSE', courseId)).trim();
    const secureKey = String(body.secureKey || makeCertificateSecureKey('SK')).trim();
    const issuedAt = new Date();
    const verifyUrl = String(body.verifyUrl || buildCertificateVerifyUrl(certId, req)).trim();
    const qrCodeUrl = String(body.qrCodeUrl || buildCertificateQrUrl(verifyUrl)).trim();
    const holderHash = buildCertificateHolderHash({
      userId: req.userId,
      fullName,
      facultyGroup,
      sourceId: courseId,
      secureKey
    });
    const signature = buildCertificateSignature({
      certId,
      serial,
      userId: req.userId,
      sourceId: courseId,
      secureKey,
      issuedAt
    });

    const doc = await Certificate.findOneAndUpdate(
      { userId: req.userId, type: 'course', sourceId: courseId },
      {
        $set: {
          title: String(body.courseTitle || course?.title || '').trim(),
          serial,
          issuedAt,
          certId,
          verifyUrl,
          qrCodeUrl,
          secureKey,
          holderHash,
          fullName,
          facultyGroup,
          courseTitle: String(body.courseTitle || course?.title || '').trim(),
          teacherName: String(body.teacherName || course?.teacherName || '').trim(),
          dateISO: String(body.dateISO || '').trim(),
          signature,
          issuedByTeacher: String(body.teacherName || course?.teacherName || '').trim(),
          issuedByPlatform: String(body.platformName || 'HALLAYM edu').trim()
        }
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ ok: true, certificate: doc });
  } catch (e) {
    console.error('POST /api/certificates error:', e);
    res.status(500).json({ error: 'Failed to create certificate' });
  }
});

// Verify certificate (API)
app.get('/api/certificates/verify', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });

    const cert = await Certificate.findOne({ $or: [{ certId: id }, { serial: id }] }).lean();
    if (!cert) return res.json({ ok: false, valid: false });

    const expectedSig = buildCertificateSignature({
      certId: cert.certId || cert.serial || '',
      serial: cert.serial || '',
      userId: cert.userId,
      sourceId: cert.sourceId,
      secureKey: cert.secureKey || '',
      issuedAt: cert.issuedAt
    });
    const valid = !!(cert.signature && expectedSig && String(cert.signature) === String(expectedSig));

    res.json({
      ok: true,
      valid,
      reason: valid ? '' : 'signature_mismatch',
      certificate: cert
    });
  } catch (e) {
    console.error('GET /api/certificates/verify error:', e);
    res.status(500).json({ error: 'Failed to verify certificate' });
  }
});

// Safer eligible alias without relying on internal router
app.get('/api/certificates/eligible2', authenticateToken, attachUserRole, requireRole(['student','admin']), async (req, res) => {
  req.query.courseId = req.query.courseId || req.query.id;
  // call same logic
  try{
    const courseId = req.query.courseId;
    if (!courseId) return res.status(400).json({ error: 'courseId required' });
    const info = await getCourseCompletion(req.userId, courseId);
    const test = await getCourseTestStatus(req.userId, courseId);
    const eligible = info.pct >= 100 && (!!test.passed);
    res.json({
      ok: eligible,
      eligible,
      courseId,
      pct: info.pct,
      totalLessons: info.totalLessons,
      doneLessonIds: info.doneLessonIds,
      requiredFinalTest: !!test.required,
      finalTestId: test.finalTestId || '',
      testPassed: !!test.passed,
      passedTestIds: test.passedTestIds || []
    });
  }catch(e){
    res.status(500).json({ error: 'Failed' });
  }
});



// ==================== SCHEDULE NOTIFIER (1 hour before) ====================
function startLiveNotificationScheduler() {
  const tickMs = 60 * 1000;
  setInterval(async () => {
    try {
      const now = Date.now();
      const from = new Date(now + 59*60*1000);
      const to   = new Date(now + 61*60*1000);
      const due = await LiveSession.find({
        status: 'scheduled',
        startAt: { $gte: from, $lte: to },
        notifySentAt: null
      }).lean();

      for (const live of due) {
        // find matching students
        const q = { role: 'student' };
        if (live.university) q.university = live.university;
        if (live.faculty) q.faculty = live.faculty;
        if (Array.isArray(live.targetGroups) && live.targetGroups.length) q.studyGroup = { $in: live.targetGroups };
        const students = await User.find(q).select('_id socketId').lean();

        const title = 'Dars 1 soatdan keyin boshlanadi';
        const body = `${live.title || 'Dars'} — ${new Date(live.startAt).toLocaleString()}`;
        const link = `/live.html?id=${live._id}`;

        for (const s of students) {
          const n = await Notification.create({ userId: s._id, title, body, link });
          if (s.socketId && io.sockets.sockets.get(s.socketId)) {
            io.to(s.socketId).emit('notification:new', { notification: n });
          }
        }
        await LiveSession.updateOne({ _id: live._id }, { $set: { notifySentAt: new Date() } });
      }
    } catch (e) {
      // keep silent to avoid log spam
    }
  }, tickMs);
}

// Start HTTP only after Mongo is ready (bufferCommands=false => queries before connect will crash)
(async () => {
  await waitForMongoReady();
  await initializeStats();

  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
    console.log(`🛡️ Default admin target: ${DEFAULT_ADMIN_USERNAME}`);
  });
})();
  setInterval(() => {
    const dir = 'uploads';
    if (fs.existsSync(dir)) {
      fs.readdir(dir, (err, files) => {
        if (err) return;
        
        files.forEach(file => {
          const filePath = path.join(dir, file);
          fs.stat(filePath, (err, stat) => {
            if (err) return;
            
            if (Date.now() - stat.mtimeMs > 3600000) {
              fs.unlinkSync(filePath);
            }
          });
        });
      });
    }
  }, 3600000);

// Cleanup stale resumable upload sessions/files every 30 minutes.
setInterval(() => {
  cleanupStaleRecordingSessions().catch(() => {});
}, 30 * 60 * 1000);

// Robot sozlash (rang/kiyim/nom) — faqat egasi
app.post('/api/robots/customize', authenticateToken, async (req, res) => {
  try {
    const { robotId, name, baseColor, outfitColor } = req.body || {};
    if (!robotId) return res.status(400).json({ error: 'robotId required' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureRobots(user);
    const r = user.robots.find(x => String(x._id) === String(robotId));
    if (!r) return res.status(400).json({ error: 'Robot not found' });

    const colorOk = (v) => !v || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v).trim());
    if (!colorOk(baseColor) || !colorOk(outfitColor)) {
      return res.status(400).json({ error: 'Invalid color' });
    }

    if (typeof name === 'string' && name.trim()) r.name = name.trim().slice(0, 40);
    if (baseColor) r.baseColor = baseColor.trim();
    if (outfitColor) r.outfitColor = outfitColor.trim();

    ensureRobots(user);
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, robot: r, pet: user.pet });
  } catch (e) {
    console.error('robots/customize error', e);
    res.status(500).json({ error: 'Failed to customize robot' });
  }
});

// Hamrohni ovqatlantirish
app.post('/api/companions/feed', authenticateToken, async (req, res) => {
  try {
    const { companionId, foodId } = req.body || {};
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const u = await User.findById(req.userId);
    if (!u) return res.status(404).json({ error: 'User not found' });
    ensureCompanions(u);
    const c = (u.companions || []).find(x => String(x._id) === String(companionId));
    if (!c) return res.status(400).json({ error: 'Companion not found' });

    let boost = 18;
    let mood = 2;
    if (foodId && typeof PET_MARKET !== 'undefined' && PET_MARKET.foods) {
      const f = PET_MARKET.foods.find(x => x.id === foodId);
      if (f) { boost = Number(f.hungerBoost || 18); mood = Number(f.moodBoost || 2); }
    }

    c.hunger = Math.max(0, Math.min(100, (c.hunger ?? 70) + boost));
    c.xp = (c.xp || 0) + (10 + mood);
    c.lastFedAt = new Date();

    const need = (c.level || 1) * 60;
    if ((c.xp || 0) >= need) {
      c.level = (c.level || 1) + 1;
      c.xp = 0;
    }

    await u.save({ validateBeforeSave: false });
    res.json({ success: true, companion: c, companions: u.companions, activeCompanionId: u.activeCompanionId });
  } catch (e) {
    console.error('companions/feed error', e);
    res.status(500).json({ error: 'Failed to feed companion' });
  }
});

// Hamroh sozlash (nom/rang/aksessuar rangi)
app.post('/api/companions/customize', authenticateToken, async (req, res) => {
  try {
    const { companionId, name, color, accessoryColor } = req.body || {};
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const u = await User.findById(req.userId);
    if (!u) return res.status(404).json({ error: 'User not found' });
    ensureCompanions(u);
    const c = (u.companions || []).find(x => String(x._id) === String(companionId));
    if (!c) return res.status(400).json({ error: 'Companion not found' });

    const colorOk = (v) => !v || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v).trim());
    if (!colorOk(color) || !colorOk(accessoryColor)) {
      return res.status(400).json({ error: 'Invalid color' });
    }

    if (typeof name === 'string' && name.trim()) c.name = name.trim().slice(0, 30);
    if (color) c.color = color.trim();
    if (accessoryColor) c.accessoryColor = accessoryColor.trim();

    await u.save({ validateBeforeSave: false });
    res.json({ success: true, companion: c, companions: u.companions });
  } catch (e) {
    console.error('companions/customize error', e);
    res.status(500).json({ error: 'Failed to customize companion' });
  }
});

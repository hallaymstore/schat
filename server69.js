const express = require('express');
const mongoose = require('mongoose');
const socketIO = require('socket.io');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
// const { AccessToken } = require('livekit-server-sdk'); // (disabled) using pure WebRTC signaling now
const cors = require('cors');
const path = require('path');
require('dotenv').config();


// ==================== DEFAULT ADMIN (Hardcoded) ====================
// Requested: username=admin, password=admin123
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin123';


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

/* LiveKit token endpoint disabled.
   To enable: uncomment the AccessToken import at the top:
     const { AccessToken } = require('livekit-server-sdk');
   and restore the endpoint body (ensure LIVEKIT_* env vars are set).
*/

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
// Serve uploaded files (screenshots, media)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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

// Helper function to determine media type
function getMediaType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf')) return 'document';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'document';
  return 'file';
}

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('✅ MongoDB Connected');
  await ensureDefaultAdmin();
})
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ==================== MODELS ====================

// User Model
const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  nickname: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  bio: { type: String, default: '' },
  university: { type: String, required: true },
  faculty: { type: String, default: '' },
  studyGroup: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  email: { type: String, default: '' },
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
  // ==================== COINS + PET (Robotcha) ====================
isAdmin: { type: Boolean, default: false },
  role: { type: String, enum: ['student','teacher','admin'], default: 'student' },
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

  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);


async function ensureDefaultAdmin() {
  try {
    const existing = await User.findOne({ username: DEFAULT_ADMIN_USERNAME });
    const hashed = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

    if (!existing) {
      await User.create({
        fullName: 'Administrator',
        nickname: 'Admin',
        username: DEFAULT_ADMIN_USERNAME,
        bio: 'SChat Administrator account',
        university: 'SChat',
        studyGroup: 'Admin',
        phone: '998000000000', // required & unique
        email: '',
        password: hashed,
        avatar: '',
        isAdmin: true,
        role: 'admin',
        coins: 0
      });
      console.log('🛡️ Default admin created: admin / admin123');
      return;
    }

    // Ensure admin flag + password as requested
    const updates = {};
    if (!existing.isAdmin) updates.isAdmin = true;
    if (existing.role !== 'admin') updates.role = 'admin';

    const ok = await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, existing.password).catch(() => false);
    if (!ok) updates.password = hashed;

    if (Object.keys(updates).length) {
      await User.updateOne({ _id: existing._id }, { $set: updates });
      console.log('🛡️ Default admin ensured: admin / admin123');
    } else {
      console.log('🛡️ Default admin present: admin / admin123');
    }
  } catch (e) {
    // If phone unique collision happens, try a different phone once
    if (String(e?.code) === '11000') {
      try {
        const existing = await User.findOne({ username: DEFAULT_ADMIN_USERNAME });
        if (!existing) {
          const hashed = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
          await User.create({
            fullName: 'Administrator',
            nickname: 'Admin',
            username: DEFAULT_ADMIN_USERNAME,
            bio: 'SChat Administrator account',
            university: 'SChat',
            studyGroup: 'Admin',
            phone: 'admin_phone_' + Date.now(),
            email: '',
            password: hashed,
            avatar: '',
            isAdmin: true,
             role: 'admin',
             coins: 0
           });
          console.log('🛡️ Default admin created (fallback phone): admin / admin123');
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
  mediaType: { type: String, enum: ['image', 'video', 'audio', 'document', 'voice', 'file', ''], default: '' },
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
  mediaType: { type: String, enum: ['image', 'video', 'audio', 'document', 'voice', 'file', ''], default: '' },
  createdAt: { type: Date, default: Date.now }
});
const GroupMessage = mongoose.model('GroupMessage', GroupMessageSchema);

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

// Initialize Stats
async function initializeStats() {
  const stats = await Stats.findOne();
  if (!stats) {
    await Stats.create({});
  }
}

// ==================== AUTHENTICATION MIDDLEWARE ====================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

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

function addUserSocket(userId, socketId) {
  const existing = onlineUsers.get(userId) || { sockets: new Set(), lastActive: Date.now() };
  if (!existing.sockets) existing.sockets = new Set();
  existing.sockets.add(socketId);
  existing.lastActive = Date.now();
  onlineUsers.set(userId, existing);
  userSockets.set(socketId, userId);
}

function removeUserSocket(userId, socketId) {
  const existing = onlineUsers.get(userId);
  if (!existing) return { becameOffline: true };
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

io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);
  
  // User authentication via socket
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.userId.toString();
      
      // Store socket with user ID (supports multi-tab / multi-device)
      const wasOnline = isUserOnline(userId);
      addUserSocket(userId, socket.id);
      socket.userId = userId;
      
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
      
      console.log('✅ User authenticated:', userId);
      
      // Join university room (for services/signals broadcasts)
      const u = await User.findById(userId).select('university');
      if (u && u.university) {
        socket.university = u.university;
        socket.join('uni:' + u.university);
      }

      // Join user's personal room
      socket.join(userId);
      socket.join(`user_${userId}`);
      
      // Presence broadcast: show ONLINE to everyone (requirement)
      if (!wasOnline) {
        io.emit('userOnline', { userId, timestamp: Date.now() });
      }
      
      // Send confirmation to client
      socket.emit('authenticated', { 
        success: true, 
        userId: userId,
        socketId: socket.id
      });
      
    } catch (error) {
      console.error('❌ Socket authentication error:', error);
      socket.emit('authenticationError', { error: 'Invalid token' });
      socket.disconnect();
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
  
  // Disconnect handler
  socket.on('disconnect', async () => {
    console.log('🔌 Client disconnected:', socket.id);
    
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


// ==================== ROUTES ====================

// Register User
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, nickname, username, bio, university, studyGroup, phone, email, password, role } = req.body;
    const safeRole = (String(role || 'student')).toLowerCase();
    const finalRole = ['student','teacher'].includes(safeRole) ? safeRole : 'student';
    
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      fullName,
      nickname,
      username,
      bio,
      university,
      studyGroup,
      role: finalRole,
      teacherBalance: 0,
      phone,
      email,
      password: hashedPassword
    });
    
    await user.save();
    
    await Stats.findOneAndUpdate({}, { $inc: { totalUsers: 1 } });
    
    const token = jwt.sign({ userId: user._id, username: user.username, role: (user.isAdmin ? 'admin' : (user.role || 'student')), isAdmin: !!user.isAdmin }, process.env.JWT_SECRET, { expiresIn: '30d' });
    
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
    await User.findByIdAndUpdate(req.userId, { 
      isOnline: false, 
      lastSeen: Date.now(),
      lastActive: Date.now()
    });
    
    const socketId = getUserSocketId(req.userId);
    if (socketId) {
      onlineUsers.delete(req.userId);
      userSockets.delete(socketId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
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
    safeUser.activeRobot = activeRobot;
    safeUser.activeCompanion = activeCompanion;

    res.json({ success: true, user: safeUser });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update Profile
app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const updates = req.body;
    const user = await User.findById(req.userId);
    
    if (updates.username && updates.username !== user.username) {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      if (user.lastUsernameChange && user.lastUsernameChange > fifteenDaysAgo) {
        return res.status(400).json({ 
          error: 'Username can only be changed once every 15 days',
          nextChange: new Date(user.lastUsernameChange.getTime() + 15 * 24 * 60 * 60 * 1000)
        });
      }
      updates.lastUsernameChange = Date.now();
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      updates,
      { new: true, select: '-password' }
    );
    
    res.json({ success: true, user: updatedUser });
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
    .select('username nickname avatar university isOnline lastSeen')
    .limit(20);
    
    res.json({ success: true, users });
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
      verified: !!user.verified,
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
      verified: !!user.verified,
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
      }))
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
          nickname: '$user.nickname',
          avatar: '$user.avatar',
          university: '$user.university',
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
    
    res.json({ success: true, conversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get Messages with a user
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
    .populate('senderId', 'username nickname avatar')
    .populate('receiverId', 'username nickname avatar');
    
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
      messages: messages.reverse(),
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
  try {
    const { receiverId, text, mediaUrl, mediaType, mediaMetadata } = req.body;
    
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const message = new Message({
      senderId: req.userId,
      receiverId,
      text,
      mediaUrl,
      mediaType,
      mediaMetadata,
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
    
    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
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
  try {
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
  try {
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
    const { name, username, description } = req.body;
    
    const group = new Group({
      name,
      username,
      description,
      creatorId: req.userId,
      members: [req.userId]
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
    const groups = await Group.find({ members: req.userId })
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
app.post('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { text, mediaUrl, mediaType } = req.body;
    
    const group = await Group.findById(groupId);
    if (!group.members.includes(req.userId)) {
      return res.status(403).json({ error: 'Not a group member' });
    }
    
    const message = new GroupMessage({
      groupId,
      senderId: req.userId,
      text,
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

// Create Channel
app.post('/api/channels', authenticateToken, async (req, res) => {
  try {
    const { name, username, description, category, university, isPublic } = req.body;
    
    const existingChannel = await Channel.findOne({ username });
    if (existingChannel) {
      return res.status(400).json({ error: 'Channel username already exists' });
    }
    
    const channel = new Channel({
      name,
      username,
      description,
      category: category || 'other',
      university: university || '',
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
      const exists = await Channel.findOne({ username });
      if (exists) return res.status(400).json({ error: 'Channel username already exists' });
      channel.username = username;
    }

    if (typeof name === 'string' && name.trim()) channel.name = name.trim();
    if (typeof description === 'string') channel.description = description;
    if (typeof category === 'string' && category.trim()) channel.category = category.trim();
    if (typeof university === 'string') channel.university = university.trim();
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
  try {
    const { channelId } = req.params;

    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

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
  try {
    const { channelId } = req.params;
    const { content, mediaUrl, mediaType, type } = req.body;
    
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
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
    
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    if (group.members.includes(req.userId)) {
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
    
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    
    if (channel.subscribers.includes(req.userId)) {
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
    
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
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
    const groups = await Group.find({ creatorId: req.userId })
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
    const groups = await Group.find({ 
      members: req.userId,
      creatorId: { $ne: req.userId }
    })
    .populate('members', 'username nickname avatar')
    .populate('creatorId', 'username nickname');
    
    const totalGroups = await Group.countDocuments();
    
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
    const { query } = req.query;
    const groups = await Group.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { username: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } }
      ]
    }).populate('creatorId', 'username nickname').limit(20);
    
    res.json({ success: true, groups });
  } catch (error) {
    console.error('Search groups error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Search Channels
app.get('/api/search/channels', authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;
    const channels = await Channel.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { username: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } }
      ]
    }).populate('creatorId', 'username nickname').limit(20);
    
    res.json({ success: true, channels });
  } catch (error) {
    console.error('Search channels error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get all public groups
app.get('/api/groups/all', authenticateToken, async (req, res) => {
  try {
    const groups = await Group.find()
      .populate('members', 'username nickname avatar')
      .populate('creatorId', 'username nickname')
      .limit(50);
    
    const totalGroups = await Group.countDocuments();
    const totalMembers = await Group.aggregate([
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
    const group = await Group.findById(req.params.groupId)
      .populate('creatorId', 'username nickname avatar')
      .populate('members', 'username nickname avatar isOnline');
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    const isMember = group.members.some(member => member._id.equals(req.userId));
    if (!isMember && !group.isPublic) {
      return res.status(403).json({ error: 'Access denied' });
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
    
    if (group.members.includes(userId)) {
      return res.status(400).json({ error: 'User already in group' });
    }
    
    group.members.push(userId);
    await group.save();
    
    const user = await User.findById(userId).select('username nickname avatar');
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

// Get channel by ID
app.get('/api/channels/:channelId([0-9a-fA-F]{24})', authenticateToken, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.channelId)
      .populate('creatorId', 'username nickname avatar')
      .populate('moderators', 'username nickname avatar')
      .populate('subscribers', 'username nickname avatar');
    
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
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
    
    const channel = await Channel.findById(channelId)
      .populate('subscribers', 'username nickname avatar isOnline');
    
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
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
    const post = await ChannelPost.findById(req.params.postId)
      .populate('channelId', 'name username');
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
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
    
    const post = await ChannelPost.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
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
    
    const query = {};
    
    if (req.query.category && req.query.category !== 'all') {
      query.category = req.query.category;
    }
    
    if (req.query.university) {
      query.university = req.query.university;
    }
    
    if (req.query.search) {
      query.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } },
        { username: { $regex: req.query.search, $options: 'i' } }
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
    const totalChannels = await Channel.countDocuments();
    
    const channels = await Channel.find({});
    let totalSubscribers = 0;
    channels.forEach(channel => {
      totalSubscribers += channel.subscribers.length;
    });
    
    const myChannels = await Channel.countDocuments({ creatorId: req.userId });
    
    const subscribedChannels = await Channel.countDocuments({ 
      subscribers: req.userId 
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
    const channels = await Channel.aggregate([
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
    
    const post = await ChannelPost.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
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
  try {
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
async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('username');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const admins = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!admins.length) return res.status(403).json({ error: 'Admin list not configured' });
    if (!admins.includes(user.username)) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch (e) {
    console.error('❌ requireAdmin error:', e);
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
app.get('/api/mod/signals', authenticateToken, requireAdmin, async (req, res) => {
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
app.post('/api/mod/signals/:id/action', authenticateToken, requireAdmin, async (req, res) => {
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
const requireAdminRole = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('isAdmin role');
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const role = user.role || (user.isAdmin ? 'admin' : 'student');
    if (!(user.isAdmin || role === 'admin')) return res.status(403).json({ error: 'Admin only' });
    req.userRole = role;
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Role check failed' });
  }
};


// Get my pet + coins + inventory + shop catalog
app.get('/api/pet/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureInventoryArrays(user);
    if (!user.pet) user.pet = { name: 'Robotcha', color: '#6366f1', outfitColor: '#ec4899', hunger: 60, xp: 0, level: 1 };
    await user.save();
        ensureCompanions(user);
    const activeCompanion = (user.companions || []).find(c => c._id && String(c._id) === String(user.activeCompanionId)) || (user.companions || []).find(c => c.equipped) || (user.companions || [])[0] || null;
res.json({
      success: true,
      coins: user.coins || 0,
      pet: user.pet,
      inventory: user.inventory,
      companions: user.companions || [],
      activeCompanion,
      market: PET_MARKET,
      isAdmin: !!user.isAdmin
    });
  } catch (e) {
    console.error('pet/me error', e);
    res.status(500).json({ error: 'Failed to load pet' });
  }


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
    const { robotTypeId } = req.body;
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
app.get('/api/admin/topup-requests', authenticateToken, requireAdminRole, async (req, res) => {
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

app.post('/api/admin/topup-requests/:id/approve', authenticateToken, requireAdminRole, async (req, res) => {
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

app.post('/api/admin/topup-requests/:id/reject', authenticateToken, requireAdminRole, async (req, res) => {
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

// Admin: update user coins directly
app.patch('/api/admin/users/:id/coins', authenticateToken, requireAdminRole, async (req, res) => {
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

// Bootstrap: set an admin (one-time) using secret env (optional but recommended)
// Usage: POST /api/admin/bootstrap { username, secret }
app.post('/api/admin/bootstrap', async (req, res) => {
  try {
    const { username, secret } = req.body || {};
    if (!process.env.ADMIN_BOOTSTRAP_SECRET) return res.status(400).json({ error: 'Bootstrap disabled' });


// ==================== ADMIN (Test / Smoke) ====================
// Quick sanity checks so you can verify auth + admin gating fast.
// Usage examples (Windows PowerShell):
//   $t="PASTE_TOKEN_HERE"
//   iwr http://localhost:3000/api/admin/ping -Headers @{Authorization="Bearer $t"}
//
// Or curl:
//   curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/admin/ping

app.get('/api/admin/ping', authenticateToken, requireAdminRole, async (req, res) => {
  res.json({ success: true, message: 'admin pong', time: new Date().toISOString(), userId: req.user?.userId || req.user?.id || null });
});

// Who am I (includes admin flag + coins)
app.get('/api/admin/whoami', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    const uid = req.user?.userId || req.user?.id;
    const me = await User.findById(uid).select('username nickname fullName coins isAdmin createdAt');
    if (!me) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, me });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load me' });
  }
});

// Create a dummy pending topup request for your own user (for testing admin approval flow)
// Body: { "coins": 50 }  => creates pending request with placeholder screenshot URL
app.post('/api/admin/test/create-topup', authenticateToken, requireAdminRole, async (req, res) => {
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
app.post('/api/admin/test/reset-pet', authenticateToken, requireAdminRole, async (req, res) => {
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

// 
// ==================== LMS MODELS & APIs (Courses / Tests / Certificates) ====================
// Note: These routes are designed to work with the provided front-end pages:
// courses.html, course.html, joinedcourse.html, tests.html, test.html, certificate.html

// ---------- Helpers ----------
const requireRole = (roles = []) => (req, res, next) => {
  try {
    const role = (req.userRole || '').toLowerCase();
    if (!roles.length) return next();
    if (roles.includes(role)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  } catch (e) {
    return res.status(403).json({ error: 'Forbidden' });
  }
};

async function attachUserRole(req, res, next) {
  try {
    const u = await User.findById(req.userId).select('role isAdmin');
    req.userRole = (u?.role || (u?.isAdmin ? 'admin' : 'student') || 'student').toLowerCase();
  } catch (e) {
    req.userRole = 'student';
  }
  next();
}

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

// ---------- Schemas ----------
const CourseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  type: { type: String, enum: ['free', 'paid'], default: 'free' },
  price: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  faculty: { type: String, default: '', trim: true },
  groups: { type: [String], default: [] }, // empty => open for all groups (within faculty rule if faculty set)
  youtubeUrl: { type: String, default: '', trim: true },
  coverUrl: { type: String, default: '', trim: true },

  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacherName: { type: String, default: '' }, // cached

  enrolledCount: { type: Number, default: 0 }
}, { timestamps: true });

const CourseContentSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  order: { type: Number, default: 1 },
  type: { type: String, enum: ['youtube', 'text', 'pdf'], required: true },
  title: { type: String, default: 'Bo‘lim', trim: true },
  text: { type: String, default: '' },
  youtubeUrl: { type: String, default: '' },
  pdfUrl: { type: String, default: '' }
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
  progress: { type: mongoose.Schema.Types.Mixed, default: {} } // { contentId: true }
}, { timestamps: true });
CourseProgressSchema.index({ courseId: 1, userId: 1 }, { unique: true });

const TestSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  subject: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  faculty: { type: String, default: '' },
  groups: { type: [String], default: [] },

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
  score: { type: Number, default: null }, // for tests
  serial: { type: String, required: true, unique: true },
  issuedAt: { type: Date, default: Date.now }
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
const Test = mongoose.models.Test || mongoose.model('Test', TestSchema);
const TestSubmission = mongoose.models.TestSubmission || mongoose.model('TestSubmission', TestSubmissionSchema);
const Certificate = mongoose.models.Certificate || mongoose.model('Certificate', CertificateSchema);
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

// List courses
app.get('/api/courses', async (req, res) => {
  try {
    const role = (req.userRole || 'student').toLowerCase();
    let query = {};
    if (role === 'student') {
      query.status = 'published';
    }
    // Teacher sees own + published by others? usually teacher needs own
    if (role === 'teacher') {
      query = { $or: [{ teacherId: req.userId }, { status: 'published' }] };
    }
    const list = await Course.find(query).sort({ createdAt: -1 }).lean();
    res.json({ courses: list });
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
    res.json({ course: c });
  } catch (e) {
    console.error('GET /api/courses/:id error:', e);
    res.status(500).json({ error: 'Failed to load course' });
  }
});

// Create course (teacher/admin)
app.post('/api/courses', requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const teacher = await User.findById(req.userId).select('fullName nickname username role');
    if (!teacher) return res.status(404).json({ error: 'User not found' });

    const groups = normalizeGroups(req.body.groups);
    const type = (req.body.type || 'free').toLowerCase();
    const price = Number(req.body.price || 0);

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
      status: (req.body.status || 'draft') === 'published' ? 'published' : 'draft',
      faculty: String(req.body.faculty || '').trim(),
      groups,
      youtubeUrl: String(req.body.youtubeUrl || '').trim(),
      coverUrl: String(req.body.coverUrl || '').trim(),
      teacherId: teacher._id,
      teacherName: teacher.fullName || teacher.nickname || teacher.username || 'Teacher'
    });

    res.status(201).json({ course });
  } catch (e) {
    console.error('POST /api/courses error:', e);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

// Update course (owner teacher/admin)
app.put('/api/courses/:id', requireRole(['teacher', 'admin']), async (req, res) => {
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
    if (req.body.faculty !== undefined) c.faculty = String(req.body.faculty || '').trim();
    if (req.body.groups !== undefined) c.groups = normalizeGroups(req.body.groups);
    if (req.body.youtubeUrl !== undefined) c.youtubeUrl = String(req.body.youtubeUrl || '').trim();
    if (req.body.coverUrl !== undefined) c.coverUrl = String(req.body.coverUrl || '').trim();

    if (req.body.type !== undefined) {
      const type = String(req.body.type).toLowerCase();
      const price = Number(req.body.price || c.price || 0);
      if (type === 'paid') {
        if (!Number.isFinite(price) || price < 1) return res.status(400).json({ error: 'price >= 1 required for paid' });
        c.type = 'paid';
        c.price = price;
      } else {
        c.type = 'free';
        c.price = 0;
      }
    } else if (req.body.price !== undefined && c.type === 'paid') {
      const price = Number(req.body.price || 0);
      if (!Number.isFinite(price) || price < 1) return res.status(400).json({ error: 'price >= 1 required' });
      c.price = price;
    }

    await c.save();
    res.json({ course: c });
  } catch (e) {
    console.error('PUT /api/courses/:id error:', e);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

// Join course (student)
app.post('/api/courses/:id/join', requireRole(['student', 'admin', 'teacher']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const me = await User.findById(req.userId);
    if (!me) return res.status(404).json({ error: 'User not found' });

    // Only students can "buy/join" normally; allow admin/teacher for testing but no payment
    const role = (req.userRole || 'student').toLowerCase();

    // Published check for student
    if (role === 'student' && course.status !== 'published') {
      return res.status(403).json({ error: 'Course is not published' });
    }

    // Faculty/group restriction for student
    if (role === 'student') {
      const cFaculty = String(course.faculty || '').trim();
      const uFaculty = String(userFaculty(me) || '').trim();
      if (cFaculty && uFaculty && cFaculty !== uFaculty) {
        return res.status(403).json({ error: 'Course is for another faculty' });
      }
      const allowedGroups = (course.groups || []).map(x => String(x).trim()).filter(Boolean);
      if (allowedGroups.length) {
        const mg = String(userGroup(me) || '').trim();
        if (!mg) return res.status(403).json({ error: 'User group is missing' });
        const ok = allowedGroups.some(g => g.toLowerCase() === mg.toLowerCase());
        if (!ok) return res.status(403).json({ error: 'Course is not open for your group' });
      }
    }

    // Prevent duplicate join
    const existed = await CourseEnrollment.findOne({ courseId: course._id, userId: me._id }).lean();
    if (existed) return res.json({ success: true, alreadyJoined: true });

    let paidAmount = 0;

    if (role === 'student' && course.type === 'paid') {
      const price = Number(course.price || 0);
      if (price < 1) return res.status(400).json({ error: 'Invalid course price' });
      if (Number(me.coins || 0) < price) return res.status(400).json({ error: 'Insufficient coins' });

      // Split: 50% teacherBalance, 50% platform adminBalance
      paidAmount = price;
      const teacherShare = Math.floor(price * 0.5);
      const adminShare = price - teacherShare;

      me.coins = Number(me.coins || 0) - price;

      const teacher = await User.findById(course.teacherId);
      if (teacher) teacher.teacherBalance = Number(teacher.teacherBalance || 0) + teacherShare;

      const wallet = await PlatformWallet.findOneAndUpdate(
        { key: 'platform_wallet' },
        { $inc: { adminBalance: adminShare } },
        { upsert: true, new: true }
      );

      await me.save();
      if (teacher) await teacher.save();
    }

    await CourseEnrollment.create({ courseId: course._id, userId: me._id, paidAmount });
    course.enrolledCount = Number(course.enrolledCount || 0) + 1;
    await course.save();

    res.json({ success: true });
  } catch (e) {
    console.error('POST /api/courses/:id/join error:', e);
    if (String(e?.code) === '11000') return res.json({ success: true, alreadyJoined: true });
    res.status(500).json({ error: 'Failed to join course' });
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

    const items = await CourseContent.find({ courseId: course._id }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ items });
  } catch (e) {
    console.error('GET /api/courses/:id/content error:', e);
    res.status(500).json({ error: 'Failed to load course content' });
  }
});

// Add content (teacher owner/admin)
app.post('/api/courses/:id/content', requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const role = (req.userRole || '').toLowerCase();
    if (role === 'teacher' && String(course.teacherId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Not owner' });
    }

    const type = String(req.body.type || '').toLowerCase();
    if (!['youtube', 'text', 'pdf'].includes(type)) return res.status(400).json({ error: 'Invalid content type' });

    const order = Number(req.body.order || 0);
    const maxOrder = await CourseContent.findOne({ courseId: course._id }).sort({ order: -1 }).lean();
    const nextOrder = Number.isFinite(order) && order > 0 ? order : ((maxOrder?.order || 0) + 1);

    const item = await CourseContent.create({
      courseId: course._id,
      order: nextOrder,
      type,
      title: String(req.body.title || 'Bo‘lim').trim(),
      text: String(req.body.text || ''),
      youtubeUrl: String(req.body.youtubeUrl || ''),
      pdfUrl: String(req.body.pdfUrl || '')
    });

    res.status(201).json({ item });
  } catch (e) {
    console.error('POST /api/courses/:id/content error:', e);
    res.status(500).json({ error: 'Failed to add content' });
  }
});

// Update content (teacher owner/admin)
app.put('/api/courses/:id/content/:contentId', requireRole(['teacher', 'admin']), async (req, res) => {
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
      if (!['youtube', 'text', 'pdf'].includes(t)) return res.status(400).json({ error: 'Invalid content type' });
      item.type = t;
    }
    if (req.body.text !== undefined) item.text = String(req.body.text || '');
    if (req.body.youtubeUrl !== undefined) item.youtubeUrl = String(req.body.youtubeUrl || '');
    if (req.body.pdfUrl !== undefined) item.pdfUrl = String(req.body.pdfUrl || '');

    await item.save();
    res.json({ item });
  } catch (e) {
    console.error('PUT /api/courses/:id/content/:contentId error:', e);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// Delete content (teacher owner/admin)
app.delete('/api/courses/:id/content/:contentId', requireRole(['teacher', 'admin']), async (req, res) => {
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
    let query = {};
    if (role === 'student') query.status = 'published';
    if (role === 'teacher') query = { $or: [{ teacherId: req.userId }, { status: 'published' }] };
    const list = await Test.find(query).sort({ createdAt: -1 }).lean();
    res.json({ tests: list });
  } catch (e) {
    console.error('GET /api/tests error:', e);
    res.status(500).json({ error: 'Failed to load tests' });
  }
});

// Get one test
app.get('/api/tests/:id', async (req, res) => {
  try {
    const role = (req.userRole || 'student').toLowerCase();
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
app.post('/api/tests', requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const teacher = await User.findById(req.userId).select('fullName nickname username role');
    if (!teacher) return res.status(404).json({ error: 'User not found' });

    const title = String(req.body.title || '').trim();
    const subject = String(req.body.subject || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!subject) return res.status(400).json({ error: 'subject is required' });

    const groups = normalizeGroups(req.body.groups);
    const status = (req.body.status || 'draft') === 'published' ? 'published' : 'draft';

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
      faculty: String(req.body.faculty || '').trim(),
      groups,
      questions,
      questionsText,
      teacherId: teacher._id,
      teacherName: teacher.fullName || teacher.nickname || teacher.username || 'Teacher'
    });

    res.status(201).json({ test });
  } catch (e) {
    console.error('POST /api/tests error:', e);
    res.status(500).json({ error: 'Failed to create test' });
  }
});

// Update test (owner teacher/admin)
app.put('/api/tests/:id', requireRole(['teacher', 'admin']), async (req, res) => {
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
    res.json({ test: t });
  } catch (e) {
    console.error('PUT /api/tests/:id error:', e);
    res.status(500).json({ error: 'Failed to update test' });
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

    const submission = await TestSubmission.create({
      testId: test._id,
      userId: req.userId,
      answers,
      score: score.pct,
      correct: score.correct,
      total: score.total
    });

    res.json({ success: true, score: score.pct, correct: score.correct, total: score.total, submissionId: submission._id });
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

    const submission = await TestSubmission.create({
      testId: test._id,
      userId: req.userId,
      answers,
      score: score.pct,
      correct: score.correct,
      total: score.total
    });

    res.json({ success: true, score: score.pct, correct: score.correct, total: score.total, submissionId: submission._id });
  } catch (e) {
    console.error('POST /api/submit-test error:', e);
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

      title = course.title || 'Course';
    } else {
      const test = await Test.findById(sourceId).lean();
      if (!test) return res.status(404).json({ error: 'Test not found' });

      // Must have passing submission (>=60)
      const last = await TestSubmission.findOne({ testId: test._id, userId: req.userId }).sort({ createdAt: -1 }).lean();
      if (!last) return res.status(403).json({ error: 'No submission' });
      if (Number(last.score || 0) < 60) return res.status(403).json({ error: 'Score is below passing threshold' });

      title = test.title || 'Test';
      scoreVal = Number(last.score || 0);
    }

    const serial = makeSerial(type, sourceId);

    const cert = await Certificate.create({
      userId: req.userId,
      type,
      sourceId,
      title,
      score: scoreVal,
      serial,
      issuedAt: new Date()
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

server.listen(PORT, async () => {
  await initializeStats();
  
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
  
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      await Stats.findOneAndUpdate({}, { dailyVisits: 0 });
      console.log('📊 Daily stats reset');
    }
  }, 60000);
  
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
});

// Robot sozlash (rang/kiyim/nom) — faqat egasi
app.post('/api/robots/customize', authenticateToken, async (req, res) => {
  try {
    const { robotId, name, baseColor, outfitColor } = req.body || {};
    if (!robotId) return res.status(400).json({ error: 'robotId required' });

    ensureRobots(req.user);
    const r = req.user.robots.find(x => String(x._id) === String(robotId));
    if (!r) return res.status(400).json({ error: 'Robot not found' });

    const colorOk = (v) => !v || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v).trim());
    if (!colorOk(baseColor) || !colorOk(outfitColor)) {
      return res.status(400).json({ error: 'Invalid color' });
    }

    if (typeof name === 'string' && name.trim()) r.name = name.trim().slice(0, 40);
    if (baseColor) r.baseColor = baseColor.trim();
    if (outfitColor) r.outfitColor = outfitColor.trim();

    ensureRobots(req.user);
    await req.user.save();

    res.json({ success: true, robot: r, pet: req.user.pet });
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

    const u = req.user;
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

    await u.save();
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

    const u = req.user;
    const c = (u.companions || []).find(x => String(x._id) === String(companionId));
    if (!c) return res.status(400).json({ error: 'Companion not found' });

    const colorOk = (v) => !v || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v).trim());
    if (!colorOk(color) || !colorOk(accessoryColor)) {
      return res.status(400).json({ error: 'Invalid color' });
    }

    if (typeof name === 'string' && name.trim()) c.name = name.trim().slice(0, 30);
    if (color) c.color = color.trim();
    if (accessoryColor) c.accessoryColor = accessoryColor.trim();

    await u.save();
    res.json({ success: true, companion: c, companions: u.companions });
  } catch (e) {
    console.error('companions/customize error', e);
    res.status(500).json({ error: 'Failed to customize companion' });
  }
});

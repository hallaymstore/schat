const express = require('express');
const mongoose = require('mongoose');
const socketIO = require('socket.io');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: ['http://localhost:3000', 'https://schat-q1nj.onrender.com'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'https://schat-q1nj.onrender.com'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

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
}).then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ==================== MODELS ====================

// User Model
const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  nickname: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  bio: { type: String, default: '' },
  university: { type: String, required: true },
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

  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

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
  status: { type: String, enum: ['missed', 'completed', 'rejected', 'cancelled', 'initiated'], required: true },
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
    { id: 'food_noodle', name: 'Lag‘mon', hungerPlus: 18, price: 25 },
    { id: 'food_samsa', name: 'Somsa', hungerPlus: 12, price: 18 },
    { id: 'food_plov', name: 'Osh (plov)', hungerPlus: 28, price: 40 },
    { id: 'food_salad', name: 'Salat', hungerPlus: 8, price: 10 }
  ],
  paints: [
    { id: 'paint_indigo', name: 'Indigo', color: '#6366f1', price: 55 },
    { id: 'paint_pink', name: 'Pink', color: '#ec4899', price: 55 },
    { id: 'paint_emerald', name: 'Emerald', color: '#10b981', price: 55 },
    { id: 'paint_amber', name: 'Amber', color: '#f59e0b', price: 55 }
  ],
  outfits: [
    { id: 'outfit_neon', name: 'Neon kiyim', color: '#22c55e', price: 75 },
    { id: 'outfit_royal', name: 'Royal kiyim', color: '#a855f7', price: 75 },
    { id: 'outfit_sky', name: 'Sky kiyim', color: '#0ea5e9', price: 75 },
    { id: 'outfit_mono', name: 'Mono kiyim', color: '#111827', price: 60 }
  ]
};

function findMarketItem(itemId) {
  for (const k of ['foods','paints','outfits']) {
    const item = PET_MARKET[k].find(x => x.id === itemId);
    if (item) return { type: k, item };
  }
  return null;
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
    const { fullName, nickname, username, bio, university, studyGroup, phone, email, password } = req.body;
    
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
      phone,
      email,
      password: hashedPassword
    });
    
    await user.save();
    
    await Stats.findOneAndUpdate({}, { $inc: { totalUsers: 1 } });
    
    const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        university: user.university,
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
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    user.isOnline = true;
    user.lastSeen = Date.now();
    user.lastActive = Date.now();
    await user.save();
    
    const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        university: user.university,
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
    res.json({ success: true, user });
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
    const user = await User.findById(req.params.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
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
    const user = await User.findById(req.userId);
    if (!user || !user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    req.adminUser = user;
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Admin check failed' });
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
    res.json({
      success: true,
      coins: user.coins || 0,
      pet: user.pet,
      inventory: user.inventory,
      market: PET_MARKET,
      isAdmin: !!user.isAdmin
    });
  } catch (e) {
    console.error('pet/me error', e);
    res.status(500).json({ error: 'Failed to load pet' });
  }
});

// Buy item from pet market (coins)
app.post('/api/shop/buy', authenticateToken, async (req, res) => {
  try {
    const { itemId } = req.body;
    const found = findMarketItem(itemId);
    if (!found) return res.status(400).json({ error: 'Item not found' });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    ensureInventoryArrays(user);
    const price = found.item.price || 0;
    if ((user.coins || 0) < price) return res.status(400).json({ error: 'Coins yetarli emas' });
    user.coins = (user.coins || 0) - price;
    if (found.type === 'foods') invAdd(user.inventory.foods, found.item);
    if (found.type === 'paints') invAdd(user.inventory.paints, found.item);
    if (found.type === 'outfits') invAdd(user.inventory.outfits, found.item);
    await user.save();
    res.json({ success: true, coins: user.coins, inventory: user.inventory });
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

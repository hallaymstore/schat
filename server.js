const express = require('express');
const mongoose = require('mongoose');
const socketIO = require('socket.io');
const http = require('http');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const cors = require('cors');
require('dotenv').config();

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true }
}));

// Cloudinary configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

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
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    lastUsernameChange: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Message Model (1v1)
const MessageSchema = new mongoose.Schema({
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    mediaType: { type: String, enum: ['image', 'video', 'audio', ''], default: '' },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// Group Model
const GroupSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    avatar: { type: String, default: 'https://res.cloudinary.com/demo/image/upload/v1692290000/default-group.png' },
    createdAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', GroupSchema);

// Group Message Model
const GroupMessageSchema = new mongoose.Schema({
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    mediaType: { type: String, enum: ['image', 'video', 'audio', ''], default: '' },
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
    avatar: { type: String, default: 'https://res.cloudinary.com/demo/image/upload/v1692290000/default-channel.png' },
    createdAt: { type: Date, default: Date.now }
});
const Channel = mongoose.model('Channel', ChannelSchema);

// Channel Post Model
const ChannelPostSchema = new mongoose.Schema({
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
    content: { type: String, required: true },
    mediaUrl: { type: String, default: '' },
    mediaType: { type: String, enum: ['image', 'video', ''], default: '' },
    viewsCount: { type: Number, default: 0 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now }
});
const ChannelPost = mongoose.model('ChannelPost', ChannelPostSchema);

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

// Initialize Stats
async function initializeStats() {
    const stats = await Stats.findOne();
    if (!stats) {
        await Stats.create({});
    }
}

// ==================== AUTHENTICATION MIDDLEWARE ====================
const authenticateToken = (req, res, next) => {
    const token = req.session.token || req.headers['authorization'];
    
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

// ==================== ROUTES ====================

// Register User
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, nickname, username, bio, university, studyGroup, phone, email, password } = req.body;
        
        // Check if username exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        // Check if phone exists
        const existingPhone = await User.findOne({ phone });
        if (existingPhone) {
            return res.status(400).json({ error: 'Phone number already registered' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
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
        
        // Update stats
        await Stats.findOneAndUpdate({}, { $inc: { totalUsers: 1 } });
        
        // Create JWT token
        const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        // Store token in session
        req.session.token = token;
        req.session.userId = user._id;
        
        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                username: user.username,
                nickname: user.nickname,
                avatar: user.avatar
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
        
        // Update online status
        user.isOnline = true;
        user.lastSeen = Date.now();
        await user.save();
        
        const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        req.session.token = token;
        req.session.userId = user._id;
        
        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                username: user.username,
                nickname: user.nickname,
                avatar: user.avatar
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.post('/api/logout', authenticateToken, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.userId, { isOnline: false, lastSeen: Date.now() });
        req.session.destroy();
        res.json({ success: true });
    } catch (error) {
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
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Update Profile
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const updates = req.body;
        const user = await User.findById(req.userId);
        
        // Check username change rule (15 days)
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
        res.status(500).json({ error: 'Profile update failed' });
    }
});

// Upload Avatar
app.post('/api/upload-avatar', authenticateToken, async (req, res) => {
    try {
        // In production, use multer for file upload
        // This is a simplified version
        const { imageUrl } = req.body;
        
        const user = await User.findByIdAndUpdate(
            req.userId,
            { avatar: imageUrl },
            { new: true, select: '-password' }
        );
        
        res.json({ success: true, avatar: user.avatar });
    } catch (error) {
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
                { university: { $regex: query, $options: 'i' } }
            ]
        }).select('username nickname avatar university isOnline').limit(20);
        
        res.json({ success: true, users });
    } catch (error) {
        res.status(500).json({ error: 'Search failed' });
    }
});

// Search Messages
app.get('/api/search/messages', authenticateToken, async (req, res) => {
    try {
        const { query } = req.query;
        const messages = await Message.find({
            $or: [
                { text: { $regex: query, $options: 'i' } }
            ],
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
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get Conversations
app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const conversations = await Message.aggregate([
            {
                $match: {
                    $or: [
                        { senderId: mongoose.Types.ObjectId(req.userId) },
                        { receiverId: mongoose.Types.ObjectId(req.userId) }
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
                            if: { $eq: ["$senderId", mongoose.Types.ObjectId(req.userId)] },
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
                                        { $ne: ["$senderId", mongoose.Types.ObjectId(req.userId)] },
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
                    isOnline: '$user.isOnline',
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
        const messages = await Message.find({
            $or: [
                { senderId: req.userId, receiverId: userId },
                { senderId: userId, receiverId: req.userId }
            ]
        })
        .sort({ createdAt: 1 })
        .populate('senderId', 'username nickname avatar');
        
        // Mark messages as read
        await Message.updateMany(
            { senderId: userId, receiverId: req.userId, isRead: false },
            { isRead: true }
        );
        
        res.json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// Send Message
app.post('/api/messages', authenticateToken, async (req, res) => {
    try {
        const { receiverId, text, mediaUrl, mediaType } = req.body;
        
        const message = new Message({
            senderId: req.userId,
            receiverId,
            text,
            mediaUrl,
            mediaType
        });
        
        await message.save();
        
        // Update stats
        await Stats.findOneAndUpdate({}, { $inc: { totalMessages: 1 } });
        
        const populatedMessage = await Message.findById(message._id)
            .populate('senderId', 'username nickname avatar')
            .populate('receiverId', 'username nickname avatar');
        
        // Emit real-time event
        io.to(receiverId).emit('newMessage', populatedMessage);
        io.to(req.userId).emit('messageSent', populatedMessage);
        
        res.json({ success: true, message: populatedMessage });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send message' });
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
        
        // Update stats
        await Stats.findOneAndUpdate({}, { $inc: { totalGroups: 1 } });
        
        res.json({ success: true, group });
    } catch (error) {
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
        res.status(500).json({ error: 'Failed to get group messages' });
    }
});

// Create Channel
app.post('/api/channels', authenticateToken, async (req, res) => {
    try {
        const { name, username, description } = req.body;
        
        const channel = new Channel({
            name,
            username,
            description,
            creatorId: req.userId,
            subscribers: [req.userId]
        });
        
        await channel.save();
        
        // Update stats
        await Stats.findOneAndUpdate({}, { $inc: { totalChannels: 1 } });
        
        res.json({ success: true, channel });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create channel' });
    }
});

// Get Channel Posts
app.get('/api/channels/:channelId/posts', authenticateToken, async (req, res) => {
    try {
        const { channelId } = req.params;
        const posts = await ChannelPost.find({ channelId })
            .sort({ createdAt: -1 })
            .populate('channelId', 'name username');
        
        res.json({ success: true, posts });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get channel posts' });
    }
});

// Create Channel Post
app.post('/api/channels/:channelId/posts', authenticateToken, async (req, res) => {
    try {
        const { channelId } = req.params;
        const { content, mediaUrl, mediaType } = req.body;
        
        // Check if user is channel creator
        const channel = await Channel.findById(channelId);
        if (!channel.creatorId.equals(req.userId)) {
            return res.status(403).json({ error: 'Only channel creator can post' });
        }
        
        const post = new ChannelPost({
            channelId,
            content,
            mediaUrl,
            mediaType
        });
        
        await post.save();
        
        // Emit new post event to subscribers
        io.to(channelId).emit('newPost', post);
        
        res.json({ success: true, post });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create post' });
    }
});

// Increment Post Views
app.post('/api/posts/:postId/view', authenticateToken, async (req, res) => {
    try {
        const { postId } = req.params;
        await ChannelPost.findByIdAndUpdate(postId, { $inc: { viewsCount: 1 } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to increment views' });
    }
});

// Get Stats
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await Stats.findOne();
        
        // Increment daily visits on landing page
        if (req.query.increment === 'true') {
            await Stats.findOneAndUpdate({}, { $inc: { dailyVisits: 1 } });
            const updatedStats = await Stats.findOne();
            return res.json({ success: true, stats: updatedStats });
        }
        
        res.json({ success: true, stats: stats || {} });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// ==================== SOCKET.IO ====================
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // User authentication via socket
    socket.on('authenticate', (token) => {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const userId = decoded.userId;
            
            // Store socket with user ID
            onlineUsers.set(userId, socket.id);
            socket.userId = userId;
            
            // Join user room
            socket.join(userId);
            
            // Update user status
            User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: Date.now() });
            
            // Notify others
            socket.broadcast.emit('userOnline', userId);
        } catch (error) {
            console.error('Socket authentication error:', error);
        }
    });
    
    // Join group
    socket.on('joinGroup', (groupId) => {
        socket.join(`group_${groupId}`);
    });
    
    // Leave group
    socket.on('leaveGroup', (groupId) => {
        socket.leave(`group_${groupId}`);
    });
    
    // Join channel
    socket.on('joinChannel', (channelId) => {
        socket.join(`channel_${channelId}`);
    });
    
    // Send group message
    socket.on('groupMessage', async (data) => {
        try {
            const { groupId, text, mediaUrl, mediaType } = data;
            
            const message = new GroupMessage({
                groupId,
                senderId: socket.userId,
                text,
                mediaUrl,
                mediaType
            });
            
            await message.save();
            
            const populatedMessage = await GroupMessage.findById(message._id)
                .populate('senderId', 'username nickname avatar');
            
            // Emit to group room
            io.to(`group_${groupId}`).emit('newGroupMessage', populatedMessage);
        } catch (error) {
            console.error('Group message error:', error);
        }
    });
    
    // Typing indicators
    socket.on('typing', (data) => {
        const { userId, isTyping } = data;
        socket.to(userId).emit('userTyping', { userId: socket.userId, isTyping });
    });
    
    // Disconnect
    socket.on('disconnect', async () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            
            // Update user status
            await User.findByIdAndUpdate(socket.userId, { 
                isOnline: false, 
                lastSeen: Date.now() 
            });
            
            // Notify others
            socket.broadcast.emit('userOffline', socket.userId);
        }
    });
});

// server.js ga quyidagi endpointlarni qo'shing:

// Get user by ID
app.get('/api/user/:userId', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('-password');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get user' });
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
        
        // Check if already a member
        if (group.members.includes(req.userId)) {
            return res.status(400).json({ error: 'Already a member' });
        }
        
        group.members.push(req.userId);
        await group.save();
        
        res.json({ success: true, group });
    } catch (error) {
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
        
        // Check if creator is trying to leave
        if (group.creatorId.equals(req.userId)) {
            return res.status(400).json({ error: 'Group creator cannot leave. Transfer ownership first.' });
        }
        
        group.members = group.members.filter(memberId => !memberId.equals(req.userId));
        await group.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to leave group' });
    }
});

// Subscribe to channel
app.post('/api/channels/:channelId/subscribe', authenticateToken, async (req, res) => {
    try {
        const { channelId } = req.params;
        
        const channel = await Channel.findById(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        // Check if already subscribed
        if (channel.subscribers.includes(req.userId)) {
            return res.status(400).json({ error: 'Already subscribed' });
        }
        
        channel.subscribers.push(req.userId);
        await channel.save();
        
        res.json({ success: true, channel });
    } catch (error) {
        res.status(500).json({ error: 'Failed to subscribe' });
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
        res.status(500).json({ error: 'Failed to get groups' });
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
        res.status(500).json({ error: 'Failed to get groups' });
    }
});

// Cloudinary upload endpoint
app.post('/api/upload', authenticateToken, async (req, res) => {
    try {
        // This would handle file upload via multer
        // For simplicity, we'll accept a URL
        const { fileUrl, fileType } = req.body;
        
        res.json({ 
            success: true, 
            url: fileUrl,
            type: fileType || 'image'
        });
    } catch (error) {
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Statistics endpoints

// Get detailed statistics
app.get('/api/stats/detailed', authenticateToken, async (req, res) => {
    try {
        const stats = await Stats.findOne();
        
        // Get active users count
        const activeUsers = await User.countDocuments({ isOnline: true });
        
        // Get today's messages
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayMessages = await Message.countDocuments({ createdAt: { $gte: today } });
        
        // Get today's groups
        const todayGroups = await Group.countDocuments({ createdAt: { $gte: today } });
        
        // Get today's channels
        const todayChannels = await Channel.countDocuments({ createdAt: { $gte: today } });
        
        // Get university distribution
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
        res.status(500).json({ error: 'Failed to get detailed stats' });
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
        res.status(500).json({ error: 'Failed to get university stats' });
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
        
        // Check if user is a member
        const isMember = group.members.some(member => member._id.equals(req.userId));
        if (!isMember && !group.isPublic) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        res.json({ success: true, group });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get group' });
    }
});

// Send group message
app.post('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        const { text, mediaUrl, mediaType } = req.body;
        
        // Check if user is a group member
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
        
        // Emit real-time event
        io.to(`group_${groupId}`).emit('newGroupMessage', populatedMessage);
        
        res.json({ success: true, message: populatedMessage });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Get group messages
app.get('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        
        // Check if user is a group member
        const group = await Group.findById(groupId);
        if (!group.members.includes(req.userId)) {
            return res.status(403).json({ error: 'Not a group member' });
        }
        
        const messages = await GroupMessage.find({ groupId })
            .sort({ createdAt: 1 })
            .populate('senderId', 'username nickname avatar')
            .limit(100);
        
        res.json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// Invite user to group
app.post('/api/groups/:groupId/invite', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.body;
        
        const group = await Group.findById(groupId);
        
        // Check if user is group creator or admin
        if (!group.creatorId.equals(req.userId)) {
            return res.status(403).json({ error: 'Only group creator can invite users' });
        }
        
        // Check if user already in group
        if (group.members.includes(userId)) {
            return res.status(400).json({ error: 'User already in group' });
        }
        
        group.members.push(userId);
        await group.save();
        
        // Emit member update
        const user = await User.findById(userId).select('username nickname avatar');
        io.to(`group_${groupId}`).emit('groupMemberUpdate', {
            groupId,
            action: 'add',
            user
        });
        
        res.json({ success: true, group });
    } catch (error) {
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
        
        // Check if user is group creator
        if (!group.creatorId.equals(req.userId)) {
            return res.status(403).json({ error: 'Only group creator can delete group' });
        }
        
        // Delete group messages
        await GroupMessage.deleteMany({ groupId });
        
        // Delete group
        await Group.findByIdAndDelete(groupId);
        
        // Update stats
        await Stats.findOneAndUpdate({}, { $inc: { totalGroups: -1 } });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete group' });
    }
});

// Profile endpoints
app.get('/api/profile/stats', authenticateToken, async (req, res) => {
    try {
        // Get user's friends count
        const friendsCount = await User.countDocuments({
            _id: { $ne: req.userId }
            // Add friend logic here
        });
        
        // Get user's groups count
        const groupsCount = await Group.countDocuments({
            members: req.userId
        });
        
        // Get user's messages count
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
        res.status(500).json({ error: 'Failed to get profile stats' });
    }
});

app.get('/api/profile/activity', authenticateToken, async (req, res) => {
    try {
        // Get recent messages
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
        
        // Format activity
        const activity = recentMessages.map(msg => ({
            type: 'message',
            icon: 'comment',
            description: `${msg.senderId.nickname} sent a message to ${msg.receiverId.nickname}`,
            timestamp: msg.createdAt
        }));
        
        // Get total messages count
        const totalMessages = await Message.countDocuments({
            $or: [
                { senderId: req.userId },
                { receiverId: req.userId }
            ]
        });
        
        // Get active days (days with at least one message)
        const activeDays = await Message.aggregate([
            {
                $match: {
                    $or: [
                        { senderId: mongoose.Types.ObjectId(req.userId) },
                        { receiverId: mongoose.Types.ObjectId(req.userId) }
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
                avgMessages: Math.round(totalMessages / 30) // Average per 30 days
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get activity' });
    }
});

// Channel endpoints
app.get('/api/channels/:channelId', authenticateToken, async (req, res) => {
    try {
        const channel = await Channel.findById(req.params.channelId)
            .populate('creatorId', 'username nickname avatar')
            .populate('subscribers', 'username nickname avatar');
        
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        // Get post count
        const postCount = await ChannelPost.countDocuments({ channelId: channel._id });
        
        // Get total views
        const totalViews = await ChannelPost.aggregate([
            { $match: { channelId: channel._id } },
            { $group: { _id: null, total: { $sum: "$viewsCount" } } }
        ]);
        
        res.json({
            success: true,
            channel: {
                ...channel.toObject(),
                postCount,
                totalViews: totalViews[0]?.total || 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get channel' });
    }
});

app.get('/api/channels/:channelId/posts', authenticateToken, async (req, res) => {
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
        res.status(500).json({ error: 'Failed to get posts' });
    }
});

app.post('/api/channels/:channelId/posts', authenticateToken, async (req, res) => {
    try {
        const { channelId } = req.params;
        const { content, mediaUrl, mediaType, type } = req.body;
        
        // Check if user is channel creator
        const channel = await Channel.findById(channelId);
        if (!channel.creatorId.equals(req.userId)) {
            return res.status(403).json({ error: 'Only channel creator can post' });
        }
        
        const post = new ChannelPost({
            channelId,
            content,
            mediaUrl,
            mediaType,
            type
        });
        
        await post.save();
        
        // Emit new post event to subscribers
        io.to(`channel_${channelId}`).emit('newPost', post);
        
        res.json({ success: true, post });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create post' });
    }
});

app.get('/api/channels/:channelId/subscribers', authenticateToken, async (req, res) => {
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
        res.status(500).json({ error: 'Failed to get subscribers' });
    }
});

app.post('/api/channels/:channelId/unsubscribe', authenticateToken, async (req, res) => {
    try {
        const { channelId } = req.params;
        
        const channel = await Channel.findById(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        channel.subscribers = channel.subscribers.filter(subId => !subId.equals(req.userId));
        await channel.save();
        
        // Emit subscription update
        io.to(`channel_${channelId}`).emit('channelSubscriptionUpdate', {
            channelId,
            action: 'unsubscribe',
            userId: req.userId
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

// Post endpoints
app.get('/api/posts/:postId', authenticateToken, async (req, res) => {
    try {
        const post = await ChannelPost.findById(req.params.postId)
            .populate('channelId', 'name username');
        
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        res.json({ success: true, post });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get post' });
    }
});

app.post('/api/posts/:postId/like', authenticateToken, async (req, res) => {
    try {
        const { postId } = req.params;
        
        const post = await ChannelPost.findById(postId);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        const alreadyLiked = post.likes.includes(req.userId);
        
        if (alreadyLiked) {
            // Unlike
            post.likes = post.likes.filter(userId => !userId.equals(req.userId));
        } else {
            // Like
            post.likes.push(req.userId);
        }
        
        await post.save();
        
        res.json({
            success: true,
            liked: !alreadyLiked,
            likeCount: post.likes.length
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to like post' });
    }
});

app.get('/api/posts/:postId/comments', authenticateToken, async (req, res) => {
    try {
        // Assuming you have a Comment model
        // const comments = await Comment.find({ postId: req.params.postId })
        //     .populate('userId', 'username nickname avatar')
        //     .sort({ createdAt: -1 });
        
        res.json({
            success: true,
            comments: [] // Placeholder
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get comments' });
    }
});

// Media endpoints for chat
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
        res.status(500).json({ error: 'Failed to get media' });
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
        
        // Check if user is the receiver
        if (!message.receiverId.equals(req.userId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        
        message.isRead = true;
        await message.save();
        
        // Emit read receipt
        io.to(message.senderId.toString()).emit('messageRead', {
            messageId: message._id,
            receiverId: req.userId,
            senderId: message.senderId
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark message as read' });
    }
});

// Channels endpoints
app.get('/api/channels', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const skip = (page - 1) * limit;
        
        const query = {};
        
        // Filter by category
        if (req.query.category && req.query.category !== 'all') {
            query.category = req.query.category;
        }
        
        // Filter by university
        if (req.query.university) {
            query.university = req.query.university;
        }
        
        // Search query
        if (req.query.search) {
            query.$or = [
                { name: { $regex: req.query.search, $options: 'i' } },
                { description: { $regex: req.query.search, $options: 'i' } },
                { username: { $regex: req.query.search, $options: 'i' } }
            ];
        }
        
        // Sort options
        let sort = { createdAt: -1 };
        if (req.query.sort === 'popular') {
            sort = { subscriberCount: -1 };
        } else if (req.query.sort === 'subscribers') {
            sort = { 'subscribers': -1 };
        }
        
        const channels = await Channel.find(query)
            .populate('creatorId', 'username nickname avatar')
            .sort(sort)
            .skip(skip)
            .limit(limit);
        
        // Check if user is subscribed to each channel
        const channelsWithSubscription = await Promise.all(
            channels.map(async (channel) => {
                const isSubscribed = channel.subscribers.some(subId => 
                    subId.equals(req.userId)
                );
                
                // Get recent posts
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
        console.error('Failed to get channels:', error);
        res.status(500).json({ error: 'Failed to get channels' });
    }
});

app.get('/api/channels/stats', authenticateToken, async (req, res) => {
    try {
        const totalChannels = await Channel.countDocuments();
        
        // Get total subscribers across all channels
        const channels = await Channel.find({});
        let totalSubscribers = 0;
        channels.forEach(channel => {
            totalSubscribers += channel.subscribers.length;
        });
        
        // Get user's created channels
        const myChannels = await Channel.countDocuments({ creatorId: req.userId });
        
        // Get user's subscribed channels
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
        res.status(500).json({ error: 'Failed to get channel stats' });
    }
});

app.get('/api/channels/featured', authenticateToken, async (req, res) => {
    try {
        // Get channels with most subscribers (featured)
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
        res.status(500).json({ error: 'Failed to get featured channels' });
    }
});

app.post('/api/channels', authenticateToken, async (req, res) => {
    try {
        const { name, username, description, category, university, isPublic } = req.body;
        
        // Check if username exists
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
            admins: [req.userId],
            members: [req.userId],
            subscribers: [req.userId],
            inviteLink: uuidv4()
        });
        
        await channel.save();
        
        // Update stats
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
        console.error('Failed to create channel:', error);
        res.status(500).json({ error: 'Failed to create channel' });
    }
});

// Channel subscription
app.post('/api/channels/:channelId/subscribe', authenticateToken, async (req, res) => {
    try {
        const { channelId } = req.params;
        
        const channel = await Channel.findById(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        // Check if already subscribed
        if (channel.subscribers.includes(req.userId)) {
            return res.status(400).json({ error: 'Already subscribed' });
        }
        
        channel.subscribers.push(req.userId);
        await channel.save();
        
        // Emit subscription update
        io.to(`channel_${channelId}`).emit('channelSubscriptionUpdate', {
            channelId,
            action: 'subscribe',
            userId: req.userId
        });
        
        res.json({ success: true, channel });
    } catch (error) {
        res.status(500).json({ error: 'Failed to subscribe' });
    }
});

app.post('/api/channels/:channelId/unsubscribe', authenticateToken, async (req, res) => {
    try {
        const { channelId } = req.params;
        
        const channel = await Channel.findById(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        channel.subscribers = channel.subscribers.filter(subId => !subId.equals(req.userId));
        await channel.save();
        
        // Emit subscription update
        io.to(`channel_${channelId}`).emit('channelSubscriptionUpdate', {
            channelId,
            action: 'unsubscribe',
            userId: req.userId
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

// Get channel by ID
app.get('/api/channels/:channelId', authenticateToken, async (req, res) => {
    try {
        const channel = await Channel.findById(req.params.channelId)
            .populate('creatorId', 'username nickname avatar')
            .populate('moderators', 'username nickname avatar')
            .populate('subscribers', 'username nickname avatar');
        
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        // Check if user is subscribed
        const isSubscribed = channel.subscribers.some(sub => 
            sub._id.equals(req.userId)
        );
        
        // Get post count
        const postCount = await ChannelPost.countDocuments({ channelId: channel._id });
        
        // Get total views
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
        res.status(500).json({ error: 'Failed to get channel' });
    }
});

// Get channel posts
app.get('/api/channels/:channelId/posts', authenticateToken, async (req, res) => {
    try {
        const { channelId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        // Check if channel exists and user has access
        const channel = await Channel.findById(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        // For private channels, check if user is subscribed
        if (!channel.isPublic && !channel.subscribers.includes(req.userId)) {
            return res.status(403).json({ error: 'Access denied. Subscribe to view posts.' });
        }
        
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
        res.status(500).json({ error: 'Failed to get posts' });
    }
});

// Create channel post
app.post('/api/channels/:channelId/posts', authenticateToken, async (req, res) => {
    try {
        const { channelId } = req.params;
        const { content, mediaUrl, mediaType, type } = req.body;
        
        // Check if channel exists
        const channel = await Channel.findById(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        // Check if user is channel creator or moderator
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
        
        // Emit new post event to subscribers
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
        res.status(500).json({ error: 'Failed to create post' });
    }
});

// Like/unlike post
app.post('/api/posts/:postId/like', authenticateToken, async (req, res) => {
    try {
        const { postId } = req.params;
        
        const post = await ChannelPost.findById(postId);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        const alreadyLiked = post.likes.includes(req.userId);
        
        if (alreadyLiked) {
            // Unlike
            post.likes = post.likes.filter(userId => !userId.equals(req.userId));
        } else {
            // Like
            post.likes.push(req.userId);
        }
        
        await post.save();
        
        res.json({
            success: true,
            liked: !alreadyLiked,
            likeCount: post.likes.length
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to like post' });
    }
});

// Increment post views
app.post('/api/posts/:postId/view', authenticateToken, async (req, res) => {
    try {
        const { postId } = req.params;
        
        await ChannelPost.findByIdAndUpdate(postId, { 
            $inc: { viewsCount: 1 } 
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to increment views' });
    }
});

// Get post by ID
app.get('/api/posts/:postId', authenticateToken, async (req, res) => {
    try {
        const post = await ChannelPost.findById(req.params.postId)
            .populate('channelId', 'name username')
            .populate('likes', 'username nickname avatar');
        
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        res.json({ success: true, post });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get post' });
    }
});

// Save/unsave post
app.post('/api/posts/:postId/save', authenticateToken, async (req, res) => {
    try {
        const { postId } = req.params;
        
        // Check if post exists
        const post = await ChannelPost.findById(postId);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        // Here you would implement saving posts to user's profile
        // For now, we'll just return success
        const saved = Math.random() > 0.5; // Simulate save/unsave
        
        res.json({
            success: true,
            saved,
            message: saved ? 'Post saved' : 'Post removed from saved'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save post' });
    }
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
    await initializeStats();
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
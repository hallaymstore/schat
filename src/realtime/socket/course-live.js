function registerCourseLiveHandlers(socket, deps) {
  const {
    io,
    LiveSession,
    LiveAccess,
    activeCourseLives,
    getLiveRoomName
  } = deps;

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

      const state = activeCourseLives.get(String(liveId)) || {
        hostId: socket.userId,
        startedAt: Date.now(),
        mode: 'mesh',
        viewers: new Set()
      };
      state.hostId = socket.userId;
      activeCourseLives.set(String(liveId), state);

      io.to(room).emit('live:status', {
        liveId: String(liveId),
        status: 'live',
        hostId: socket.userId,
        viewers: state.viewers.size
      });
      socket.emit('live:hostReady', { liveId: String(liveId) });
    } catch (error) {
      console.error('live:hostJoin error:', error);
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

      if (String(live.hostId) !== String(socket.userId) && live.type === 'paid' && (live.price || 0) > 0) {
        const access = await LiveAccess.findOne({ liveId: live._id, userId: socket.userId }).lean();
        if (!access || !access.paid) {
          return socket.emit('live:error', { error: 'Paid access required', redirect: '/topup.html' });
        }
      }

      const room = getLiveRoomName(String(liveId));
      socket.join(room);

      const state = activeCourseLives.get(String(liveId)) || {
        hostId: String(live.hostId),
        startedAt: Date.now(),
        mode: 'mesh',
        viewers: new Set()
      };
      state.viewers.add(String(socket.userId));
      activeCourseLives.set(String(liveId), state);

      io.to(room).emit('live:viewers', { liveId: String(liveId), viewers: state.viewers.size });
      io.to(`user_${state.hostId}`).emit('live:viewerJoined', { liveId: String(liveId), viewerId: String(socket.userId) });
      socket.emit('live:viewerReady', { liveId: String(liveId), hostId: state.hostId });
    } catch (error) {
      console.error('live:viewerJoin error:', error);
      socket.emit('live:error', { error: 'Viewer join failed' });
    }
  });

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

  socket.on('chat:live', ({ liveId, text }) => {
    try {
      if (!socket.userId) return;
      const clean = String(text || '').slice(0, 500);
      const room = getLiveRoomName(String(liveId));
      io.to(room).emit('chat:live', {
        liveId: String(liveId),
        userId: socket.userId,
        name: socket.username || 'User',
        text: clean,
        ts: Date.now()
      });
    } catch (_) {}
  });
}

module.exports = {
  registerCourseLiveHandlers
};

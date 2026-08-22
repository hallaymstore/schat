function registerPrivateCallHandlers(socket, deps) {
  const {
    io,
    ensureMediasoupRuntime,
    User,
    CallHistory,
    activePrivateCalls,
    isUserOnline,
    emitToUser,
    adminEmit,
    getPreferredRealtimeTransport,
    getPrivateSfuRoomKey,
    closeSfuRoomIfPossible,
    ackSocketSuccess,
    ackSocketError
  } = deps;

  socket.on('callOffer', async (data, ack) => {
    try {
      await ensureMediasoupRuntime(socket);
      console.log('Call offer from:', socket.userId, 'to:', data.to, 'type:', data.type);

      const receiver = await User.findById(data.to);
      if (!receiver) {
        socket.emit('callError', { error: 'User not found' });
        ackSocketError(ack, 'User not found');
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

        activePrivateCalls.set(String(callHistory._id), {
          callId: String(callHistory._id),
          callerId: String(socket.userId),
          receiverId: String(data.to),
          type: data.type,
          status: 'missed',
          startedAt: Date.now()
        });
        adminEmit('admin:privateCallUpdate', {
          action: 'missed',
          callId: String(callHistory._id),
          callerId: String(socket.userId),
          receiverId: String(data.to),
          type: data.type,
          timestamp: Date.now()
        });
        activePrivateCalls.delete(String(callHistory._id));

        socket.emit('callError', { error: 'User is offline' });
        ackSocketError(ack, 'User is offline');
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

      const callId = String(callHistory._id || '');
      const transport = getPreferredRealtimeTransport();
      const sfuRoomKey = getPrivateSfuRoomKey(callId);

      activePrivateCalls.set(callId, {
        callId,
        callerId: String(socket.userId),
        receiverId: String(data.to),
        type: data.type,
        status: 'initiated',
        startedAt: Date.now()
      });

      adminEmit('admin:privateCallUpdate', {
        action: 'initiated',
        callId,
        callerId: String(socket.userId),
        receiverId: String(data.to),
        type: data.type,
        transport,
        timestamp: Date.now()
      });

      const caller = await User.findById(socket.userId).select('username nickname avatar');
      const offerData = {
        ...data,
        from: socket.userId,
        callId,
        transport,
        sfuRoomKey,
        callerInfo: {
          userId: socket.userId,
          nickname: caller?.nickname || '',
          avatar: caller?.avatar || '',
          callId,
          timestamp: Date.now()
        }
      };

      emitToUser(data.to, 'callOffer', offerData);
      console.log(`Call offer sent to ${data.to}`);
      ackSocketSuccess(ack, { callId, transport, sfuRoomKey });
    } catch (error) {
      console.error('Call offer error:', error);
      socket.emit('callError', { error: 'Failed to initiate call' });
      ackSocketError(ack, error, 'Failed to initiate call');
    }
  });

  socket.on('callAnswer', async (data) => {
    try {
      console.log('Call answer from:', socket.userId, 'to:', data.to);

      const callId = String(data.callId || '').trim();
      const accepted = data.accepted === true || !!data.answer;

      if (callId) {
        await CallHistory.findByIdAndUpdate(callId, {
          status: accepted ? 'accepted' : 'rejected'
        });

        const activeCall = activePrivateCalls.get(callId);
        if (activeCall) {
          activeCall.status = accepted ? 'accepted' : 'rejected';
          activePrivateCalls.set(callId, activeCall);
          adminEmit('admin:privateCallUpdate', {
            action: accepted ? 'accepted' : 'rejected',
            callId,
            callerId: String(activeCall.callerId || ''),
            receiverId: String(activeCall.receiverId || ''),
            type: String(activeCall.type || data.type || ''),
            transport: String(data.transport || getPreferredRealtimeTransport()),
            timestamp: Date.now()
          });
        }
      }

      emitToUser(data.to, 'callAnswer', {
        ...data,
        from: socket.userId,
        callId,
        transport: String(data.transport || getPreferredRealtimeTransport()),
        sfuRoomKey: callId ? getPrivateSfuRoomKey(callId) : '',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Call answer error:', error);
    }
  });

  socket.on('iceCandidate', (data) => {
    console.log('ICE candidate from:', socket.userId, 'to:', data.to);

    emitToUser(data.to, 'iceCandidate', {
      ...data,
      from: socket.userId,
      timestamp: Date.now()
    });
  });

  socket.on('callEnded', async (data) => {
    try {
      console.log('Call ended from:', socket.userId, 'to:', data.to);

      if (data.callId) {
        await CallHistory.findByIdAndUpdate(data.callId, {
          status: 'completed',
          duration: data.duration || 0,
          endedAt: Date.now()
        });
      }

      if (data.callId) {
        const id = String(data.callId);
        activePrivateCalls.delete(id);
        closeSfuRoomIfPossible(getPrivateSfuRoomKey(id));
        adminEmit('admin:privateCallUpdate', {
          action: 'ended',
          callId: id,
          from: String(socket.userId),
          to: String(data.to),
          duration: data.duration || 0,
          timestamp: Date.now()
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

  socket.on('callRejected', async (data) => {
    try {
      console.log('Call rejected from:', socket.userId, 'to:', data.to);

      if (data.callId) {
        await CallHistory.findByIdAndUpdate(data.callId, {
          status: 'rejected',
          endedAt: Date.now()
        });
      }

      if (data.callId) {
        const id = String(data.callId);
        activePrivateCalls.delete(id);
        closeSfuRoomIfPossible(getPrivateSfuRoomKey(id));
        adminEmit('admin:privateCallUpdate', {
          action: 'rejected',
          callId: id,
          from: String(socket.userId),
          to: String(data.to),
          timestamp: Date.now()
        });
      }

      emitToUser(data.to, 'callRejected', {
        ...data,
        from: socket.userId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Call rejected error:', error);
    }
  });

  socket.on('callMissed', async (data) => {
    try {
      console.log('Call missed from:', socket.userId, 'to:', data.to);

      if (data.callId) {
        await CallHistory.findByIdAndUpdate(data.callId, {
          status: 'missed',
          endedAt: Date.now()
        });
      }

      if (data.callId) {
        const id = String(data.callId);
        activePrivateCalls.delete(id);
        closeSfuRoomIfPossible(getPrivateSfuRoomKey(id));
        adminEmit('admin:privateCallUpdate', {
          action: 'missed',
          callId: id,
          from: String(socket.userId),
          to: String(data.to),
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Call missed error:', error);
    }
  });

  socket.on('callTimeout', async (data) => {
    try {
      console.log('Call timeout from:', socket.userId, 'to:', data.to);

      if (data.callId) {
        await CallHistory.findByIdAndUpdate(data.callId, {
          status: 'missed',
          endedAt: Date.now()
        });
      }

      if (data.callId) {
        const id = String(data.callId);
        activePrivateCalls.delete(id);
        closeSfuRoomIfPossible(getPrivateSfuRoomKey(id));
        adminEmit('admin:privateCallUpdate', {
          action: 'timeout',
          callId: id,
          from: String(socket.userId),
          to: String(data.to),
          timestamp: Date.now()
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
}

module.exports = {
  registerPrivateCallHandlers
};

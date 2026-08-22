function registerSharedSfuHandlers(socket, deps) {
  const {
    io,
    ensureMediasoupRuntime,
    resolveSfuRoomAccess,
    isMediasoupTransportReady,
    getMediasoupManager,
    ackSocketSuccess,
    ackSocketError,
    closeSfuPeerIfPossible
  } = deps;

  socket.on('sfu:joinRoom', async (payload, ack) => {
    try {
      if (!socket.userId) throw new Error('Not authenticated');
      await ensureMediasoupRuntime(socket);
      if (!isMediasoupTransportReady()) throw new Error('Mediasoup transport unavailable');

      const roomKey = String(payload?.roomKey || '').trim();
      const access = resolveSfuRoomAccess(socket, roomKey);
      if (!access.ok) throw new Error(access.error || 'SFU room access denied');

      const peerMeta = Object.assign({}, payload?.peerMeta || {}, {
        userId: String(socket.userId || ''),
        role: String(socket.userRole || '').toLowerCase()
      });

      const result = await getMediasoupManager().joinPeer({
        roomKey,
        socket,
        peerId: access.peerId,
        userId: String(socket.userId || ''),
        peerMeta,
        roomMeta: access.roomMeta || {}
      });

      if (!(socket._sfuRooms instanceof Set)) socket._sfuRooms = new Set();
      socket._sfuRooms.add(roomKey);
      ackSocketSuccess(ack, result);
    } catch (error) {
      console.error('sfu:joinRoom error:', error);
      ackSocketError(ack, error, 'Failed to join SFU room');
    }
  });

  socket.on('sfu:createTransport', async (payload, ack) => {
    try {
      if (!socket.userId) throw new Error('Not authenticated');
      await ensureMediasoupRuntime(socket);
      if (!isMediasoupTransportReady()) throw new Error('Mediasoup transport unavailable');

      const roomKey = String(payload?.roomKey || '').trim();
      const access = resolveSfuRoomAccess(socket, roomKey);
      if (!access.ok) throw new Error(access.error || 'SFU room access denied');

      const transport = await getMediasoupManager().createTransport({
        roomKey,
        socketId: socket.id,
        direction: String(payload?.direction || 'send').toLowerCase() === 'recv' ? 'recv' : 'send'
      });

      ackSocketSuccess(ack, { transport });
    } catch (error) {
      console.error('sfu:createTransport error:', error);
      ackSocketError(ack, error, 'Failed to create SFU transport');
    }
  });

  socket.on('sfu:connectTransport', async (payload, ack) => {
    try {
      if (!socket.userId) throw new Error('Not authenticated');
      await ensureMediasoupRuntime(socket);
      if (!isMediasoupTransportReady()) throw new Error('Mediasoup transport unavailable');

      const roomKey = String(payload?.roomKey || '').trim();
      const access = resolveSfuRoomAccess(socket, roomKey);
      if (!access.ok) throw new Error(access.error || 'SFU room access denied');

      const result = await getMediasoupManager().connectTransport({
        roomKey,
        socketId: socket.id,
        transportId: String(payload?.transportId || '').trim(),
        dtlsParameters: payload?.dtlsParameters || null
      });

      ackSocketSuccess(ack, result);
    } catch (error) {
      console.error('sfu:connectTransport error:', error);
      ackSocketError(ack, error, 'Failed to connect SFU transport');
    }
  });

  socket.on('sfu:produce', async (payload, ack) => {
    try {
      if (!socket.userId) throw new Error('Not authenticated');
      await ensureMediasoupRuntime(socket);
      if (!isMediasoupTransportReady()) throw new Error('Mediasoup transport unavailable');

      const roomKey = String(payload?.roomKey || '').trim();
      const access = resolveSfuRoomAccess(socket, roomKey);
      if (!access.ok) throw new Error(access.error || 'SFU room access denied');
      if (access.kind === 'channel' && String(access.roomMeta?.role || '') !== 'host') {
        throw new Error('Only live host can publish media');
      }

      const result = await getMediasoupManager().produce({
        roomKey,
        socketId: socket.id,
        transportId: String(payload?.transportId || '').trim(),
        kind: String(payload?.kind || '').trim(),
        rtpParameters: payload?.rtpParameters || null,
        appData: payload?.appData || {}
      });

      ackSocketSuccess(ack, result);
    } catch (error) {
      console.error('sfu:produce error:', error);
      ackSocketError(ack, error, 'Failed to publish SFU media');
    }
  });

  socket.on('sfu:consume', async (payload, ack) => {
    try {
      if (!socket.userId) throw new Error('Not authenticated');
      await ensureMediasoupRuntime(socket);
      if (!isMediasoupTransportReady()) throw new Error('Mediasoup transport unavailable');

      const roomKey = String(payload?.roomKey || '').trim();
      const access = resolveSfuRoomAccess(socket, roomKey);
      if (!access.ok) throw new Error(access.error || 'SFU room access denied');

      const result = await getMediasoupManager().consume({
        roomKey,
        socketId: socket.id,
        transportId: String(payload?.transportId || '').trim(),
        producerId: String(payload?.producerId || '').trim(),
        rtpCapabilities: payload?.rtpCapabilities || null
      });

      ackSocketSuccess(ack, result);
    } catch (error) {
      console.error('sfu:consume error:', error);
      ackSocketError(ack, error, 'Failed to consume SFU media');
    }
  });

  socket.on('sfu:resumeConsumer', async (payload, ack) => {
    try {
      if (!socket.userId) throw new Error('Not authenticated');
      await ensureMediasoupRuntime(socket);
      if (!isMediasoupTransportReady()) throw new Error('Mediasoup transport unavailable');

      const roomKey = String(payload?.roomKey || '').trim();
      const access = resolveSfuRoomAccess(socket, roomKey);
      if (!access.ok) throw new Error(access.error || 'SFU room access denied');

      const result = await getMediasoupManager().resumeConsumer({
        roomKey,
        socketId: socket.id,
        consumerId: String(payload?.consumerId || '').trim()
      });

      ackSocketSuccess(ack, result);
    } catch (error) {
      console.error('sfu:resumeConsumer error:', error);
      ackSocketError(ack, error, 'Failed to resume SFU consumer');
    }
  });

  socket.on('sfu:leaveRoom', async (payload, ack) => {
    try {
      const roomKey = String(payload?.roomKey || '').trim();
      if (!roomKey) throw new Error('roomKey required');
      closeSfuPeerIfPossible(roomKey, socket.id);
      if (socket._sfuRooms instanceof Set) socket._sfuRooms.delete(roomKey);
      ackSocketSuccess(ack, { left: true });
    } catch (error) {
      console.error('sfu:leaveRoom error:', error);
      ackSocketError(ack, error, 'Failed to leave SFU room');
    }
  });
}

module.exports = {
  registerSharedSfuHandlers
};

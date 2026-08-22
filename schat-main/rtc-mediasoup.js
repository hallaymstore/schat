const os = require('os');
const mediasoup = require('mediasoup');

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function toInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeAnnouncedAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').replace(/:\d+$/, '');
}

function isLoopbackOrLocalAddress(value) {
  const host = String(value || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.local')) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

function buildDefaultMediaCodecs() {
  return [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: {
        'x-google-start-bitrate': 1000
      }
    },
    {
      kind: 'video',
      mimeType: 'video/H264',
      clockRate: 90000,
      parameters: {
        'level-asymmetry-allowed': 1,
        'packetization-mode': 1,
        'profile-level-id': '42e01f',
        'x-google-start-bitrate': 1000
      }
    }
  ];
}

function buildMediasoupRuntimeConfig(env = process.env, options = {}) {
  const cpuCount = Math.max(1, Number(os.cpus()?.length || 1));
  const workerCount = clamp(
    toInt(env.MEDIASOUP_WORKERS, Math.min(cpuCount, 4)),
    1,
    Math.max(1, cpuCount)
  );
  const listenIp = String(env.MEDIASOUP_LISTEN_IP || '0.0.0.0').trim() || '0.0.0.0';
  const announcedAddress = sanitizeAnnouncedAddress(
    options.announcedAddress ||
    env.MEDIASOUP_ANNOUNCED_IP ||
    env.MEDIASOUP_ANNOUNCED_ADDRESS ||
    env.PUBLIC_HOST ||
    ''
  );
  const rtcMinPort = clamp(toInt(env.MEDIASOUP_MIN_PORT, 40000), 10000, 65000);
  const rtcMaxPort = clamp(toInt(env.MEDIASOUP_MAX_PORT, 49999), rtcMinPort + 99, 65535);
  const enableTcp = toBool(env.MEDIASOUP_ENABLE_TCP, true);
  const enableUdp = toBool(env.MEDIASOUP_ENABLE_UDP, true);
  const preferUdp = enableUdp && !toBool(env.MEDIASOUP_FORCE_TCP, false);
  const preferTcp = enableTcp && !preferUdp;
  const initialAvailableOutgoingBitrate = clamp(
    toInt(env.MEDIASOUP_INITIAL_OUTGOING_BITRATE, 1500000),
    200000,
    100000000
  );
  const maxIncomingBitrate = clamp(
    toInt(env.MEDIASOUP_MAX_INCOMING_BITRATE, 6000000),
    0,
    100000000
  );
  const maxPeersPerRoom = clamp(toInt(env.MEDIASOUP_MAX_PEERS_PER_ROOM, 250), 2, 1000);
  const logLevel = String(env.MEDIASOUP_LOG_LEVEL || 'warn').trim().toLowerCase() || 'warn';
  const logTags = String(env.MEDIASOUP_LOG_TAGS || 'ice,dtls,rtp,srtp,rtcp')
    .split(/[\s,;]+/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const explicitEnabled = String(env.MEDIASOUP_ENABLED || '').trim();
  const enabled = explicitEnabled
    ? (toBool(explicitEnabled, false) && !!announcedAddress)
    : (!!announcedAddress && !isLoopbackOrLocalAddress(announcedAddress));

  return {
    enabled,
    announcedAddress,
    listenIp,
    workerCount,
    rtcMinPort,
    rtcMaxPort,
    enableTcp,
    enableUdp,
    preferUdp,
    preferTcp,
    logLevel,
    logTags,
    initialAvailableOutgoingBitrate,
    maxIncomingBitrate,
    maxPeersPerRoom,
    mediaCodecs: buildDefaultMediaCodecs()
  };
}

function buildListenInfos(config) {
  const base = {
    ip: config.listenIp,
    announcedAddress: config.announcedAddress,
    portRange: {
      min: config.rtcMinPort,
      max: config.rtcMaxPort
    }
  };
  const infos = [];
  if (config.enableUdp) infos.push({ ...base, protocol: 'udp' });
  if (config.enableTcp) infos.push({ ...base, protocol: 'tcp' });
  return infos;
}

class MediasoupManager {
  constructor(options = {}) {
    this.io = options.io;
    this.config = options.config || buildMediasoupRuntimeConfig();
    this.getIceServers = typeof options.getIceServers === 'function' ? options.getIceServers : (() => []);
    this.getIceTransportPolicy = typeof options.getIceTransportPolicy === 'function' ? options.getIceTransportPolicy : (() => 'all');
    this.log = typeof options.log === 'function' ? options.log : (() => {});
    this.error = typeof options.error === 'function' ? options.error : (() => {});
    this.workers = [];
    this.rooms = new Map();
    this.nextWorkerIdx = 0;
    this.ready = false;
  }

  isEnabled() {
    return !!(this.config?.enabled && this.ready);
  }

  getPublicInfo() {
    return {
      enabled: this.isEnabled(),
      announcedAddress: this.config.announcedAddress,
      rtcMinPort: this.config.rtcMinPort,
      rtcMaxPort: this.config.rtcMaxPort,
      preferUdp: !!this.config.preferUdp,
      preferTcp: !!this.config.preferTcp,
      maxPeersPerRoom: Number(this.config.maxPeersPerRoom || 250)
    };
  }

  async init() {
    if (!this.config?.enabled) {
      this.log('mediasoup disabled: MEDIASOUP_ENABLED!=1 or announced address missing');
      return false;
    }

    const count = clamp(Number(this.config.workerCount || 1), 1, 32);
    for (let index = 0; index < count; index += 1) {
      const worker = await mediasoup.createWorker({
        logLevel: this.config.logLevel,
        logTags: this.config.logTags,
        rtcMinPort: this.config.rtcMinPort,
        rtcMaxPort: this.config.rtcMaxPort
      });

      worker.on('died', () => {
        this.error('mediasoup worker died', { pid: worker.pid });
      });

      this.workers.push(worker);
    }

    this.ready = this.workers.length > 0;
    this.log('mediasoup ready', {
      workers: this.workers.length,
      announcedAddress: this.config.announcedAddress,
      portRange: `${this.config.rtcMinPort}-${this.config.rtcMaxPort}`
    });
    return this.ready;
  }

  _requireRoom(roomKey) {
    const room = this.rooms.get(String(roomKey || ''));
    if (!room) throw new Error('SFU room not found');
    return room;
  }

  _requirePeer(roomKey, socketId) {
    const room = this._requireRoom(roomKey);
    const peer = room.peers.get(String(socketId || ''));
    if (!peer) throw new Error('SFU peer not joined');
    return { room, peer };
  }

  _nextWorker() {
    if (!this.workers.length) throw new Error('Mediasoup not initialized');
    const worker = this.workers[this.nextWorkerIdx % this.workers.length];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return worker;
  }

  _serializeTransport(transport) {
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters || null,
      iceServers: this.getIceServers(),
      iceTransportPolicy: String(this.getIceTransportPolicy() || 'all').trim().toLowerCase() === 'relay' ? 'relay' : 'all'
    };
  }

  _findProducerPeer(room, producerId) {
    for (const peer of room.peers.values()) {
      if (peer.producers.has(String(producerId || ''))) return peer;
    }
    return null;
  }

  _listExistingProducers(room, excludeSocketId = '') {
    const out = [];
    for (const [socketId, peer] of room.peers.entries()) {
      if (String(socketId) === String(excludeSocketId || '')) continue;
      for (const producer of peer.producers.values()) {
        out.push({
          producerId: producer.id,
          peerId: peer.peerId,
          kind: producer.kind,
          appData: producer.appData || {}
        });
      }
    }
    return out;
  }

  async ensureRoom(roomKey, roomMeta = {}) {
    const normalizedKey = String(roomKey || '').trim();
    if (!normalizedKey) throw new Error('roomKey required');
    let room = this.rooms.get(normalizedKey);
    if (room) {
      room.meta = Object.assign({}, room.meta || {}, roomMeta || {});
      return room;
    }

    const worker = this._nextWorker();
    const router = await worker.createRouter({
      mediaCodecs: this.config.mediaCodecs
    });

    room = {
      roomKey: normalizedKey,
      router,
      peers: new Map(),
      workerPid: worker.pid,
      meta: Object.assign({}, roomMeta || {}),
      createdAt: Date.now()
    };
    this.rooms.set(normalizedKey, room);
    return room;
  }

  async joinPeer({ roomKey, socket, peerId, userId, peerMeta = {}, roomMeta = {} }) {
    if (!this.isEnabled()) throw new Error('Mediasoup disabled');
    const room = await this.ensureRoom(roomKey, roomMeta);
    const socketId = String(socket?.id || '');
    if (!socketId) throw new Error('socket.id required');

    socket.join(`sfu:${room.roomKey}`);

    let peer = room.peers.get(socketId);
    if (!peer) {
      if (room.peers.size >= Number(this.config.maxPeersPerRoom || 250)) {
        throw new Error('SFU room participant limit reached');
      }
      peer = {
        socketId,
        userId: String(userId || ''),
        peerId: String(peerId || userId || socketId),
        joinedAt: Date.now(),
        meta: Object.assign({}, peerMeta || {}),
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      };
      room.peers.set(socketId, peer);
    } else {
      peer.userId = String(userId || peer.userId || '');
      peer.peerId = String(peerId || peer.peerId || peer.userId || socketId);
      peer.meta = Object.assign({}, peer.meta || {}, peerMeta || {});
    }

    return {
      roomKey: room.roomKey,
      routerRtpCapabilities: room.router.rtpCapabilities,
      peerId: peer.peerId,
      existingProducers: this._listExistingProducers(room, socketId),
      roomMeta: room.meta || {}
    };
  }

  async createTransport({ roomKey, socketId, direction = 'send' }) {
    if (!this.isEnabled()) throw new Error('Mediasoup disabled');
    const { room, peer } = this._requirePeer(roomKey, socketId);
    const transport = await room.router.createWebRtcTransport({
      listenInfos: buildListenInfos(this.config),
      enableUdp: !!this.config.enableUdp,
      enableTcp: !!this.config.enableTcp,
      preferUdp: !!this.config.preferUdp,
      preferTcp: !!this.config.preferTcp,
      initialAvailableOutgoingBitrate: this.config.initialAvailableOutgoingBitrate,
      appData: {
        peerId: peer.peerId,
        direction
      }
    });

    if (Number(this.config.maxIncomingBitrate || 0) > 0) {
      await transport.setMaxIncomingBitrate(Number(this.config.maxIncomingBitrate)).catch(() => {});
    }

    const transportId = String(transport.id || '');
    peer.transports.set(transportId, { transport, direction });

    transport.on('close', () => {
      peer.transports.delete(transportId);
    });

    return this._serializeTransport(transport);
  }

  async connectTransport({ roomKey, socketId, transportId, dtlsParameters }) {
    const { peer } = this._requirePeer(roomKey, socketId);
    const transportRef = peer.transports.get(String(transportId || ''));
    if (!transportRef?.transport) throw new Error('SFU transport not found');
    await transportRef.transport.connect({ dtlsParameters });
    return { connected: true };
  }

  async produce({ roomKey, socketId, transportId, kind, rtpParameters, appData = {} }) {
    const { room, peer } = this._requirePeer(roomKey, socketId);
    const transportRef = peer.transports.get(String(transportId || ''));
    if (!transportRef?.transport) throw new Error('SFU transport not found');

    const producer = await transportRef.transport.produce({
      kind,
      rtpParameters,
      appData: Object.assign({}, appData || {}, {
        peerId: peer.peerId,
        userId: peer.userId
      })
    });

    const producerId = String(producer.id || '');
    peer.producers.set(producerId, producer);

    const notifyProducerClosed = () => {
      if (!peer.producers.has(producerId)) return;
      peer.producers.delete(producerId);
      this.io.to(`sfu:${room.roomKey}`).emit('sfu:producerClosed', {
        roomKey: room.roomKey,
        producerId,
        peerId: peer.peerId,
        kind: producer.kind,
        appData: producer.appData || {}
      });
    };

    producer.on('transportclose', notifyProducerClosed);
    producer.on('close', notifyProducerClosed);

    this.io.to(`sfu:${room.roomKey}`).emit('sfu:newProducer', {
      roomKey: room.roomKey,
      producerId,
      peerId: peer.peerId,
      kind: producer.kind,
      appData: producer.appData || {}
    });

    return {
      id: producer.id
    };
  }

  async consume({ roomKey, socketId, transportId, producerId, rtpCapabilities }) {
    const { room, peer } = this._requirePeer(roomKey, socketId);
    const transportRef = peer.transports.get(String(transportId || ''));
    if (!transportRef?.transport) throw new Error('SFU transport not found');
    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Producer cannot be consumed by this device');
    }

    const producerPeer = this._findProducerPeer(room, producerId);
    const producer = producerPeer?.producers?.get(String(producerId || '')) || null;
    if (!producerPeer || !producer) throw new Error('Producer not found');

    const consumer = await transportRef.transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
      appData: Object.assign({}, producer.appData || {}, {
        producerPeerId: producerPeer.peerId
      })
    });

    const consumerId = String(consumer.id || '');
    peer.consumers.set(consumerId, consumer);

    const cleanupConsumer = () => {
      peer.consumers.delete(consumerId);
    };

    consumer.on('transportclose', cleanupConsumer);
    consumer.on('producerclose', cleanupConsumer);
    consumer.on('close', cleanupConsumer);

    return {
      id: consumer.id,
      producerId,
      peerId: producerPeer.peerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      appData: consumer.appData || {},
      producerPaused: consumer.producerPaused
    };
  }

  async resumeConsumer({ roomKey, socketId, consumerId }) {
    const { peer } = this._requirePeer(roomKey, socketId);
    const consumer = peer.consumers.get(String(consumerId || ''));
    if (!consumer) throw new Error('SFU consumer not found');
    await consumer.resume();
    return { resumed: true };
  }

  closePeer(roomKey, socketId) {
    const room = this.rooms.get(String(roomKey || ''));
    if (!room) return { closed: false, empty: true };

    const peer = room.peers.get(String(socketId || ''));
    if (!peer) {
      return { closed: false, empty: room.peers.size === 0 };
    }

    for (const producer of peer.producers.values()) {
      try { producer.close(); } catch (_) {}
    }
    for (const consumer of peer.consumers.values()) {
      try { consumer.close(); } catch (_) {}
    }
    for (const ref of peer.transports.values()) {
      try { ref.transport.close(); } catch (_) {}
    }

    room.peers.delete(String(socketId || ''));

    if (room.peers.size === 0) {
      try { room.router.close(); } catch (_) {}
      this.rooms.delete(room.roomKey);
      return { closed: true, empty: true };
    }

    return { closed: true, empty: false };
  }

  closeRoom(roomKey) {
    const room = this.rooms.get(String(roomKey || ''));
    if (!room) return { closed: false, empty: true };

    for (const socketId of Array.from(room.peers.keys())) {
      try {
        this.closePeer(roomKey, socketId);
      } catch (error) {
        this.error('mediasoup closeRoom peer cleanup error', {
          roomKey,
          socketId,
          error: error?.message || error
        });
      }
    }

    if (this.rooms.has(room.roomKey)) {
      try { room.router.close(); } catch (_) {}
      this.rooms.delete(room.roomKey);
    }

    return { closed: true, empty: true };
  }

  cleanupSocket(socketId) {
    for (const roomKey of Array.from(this.rooms.keys())) {
      try {
        this.closePeer(roomKey, socketId);
      } catch (error) {
        this.error('mediasoup cleanupSocket error', { roomKey, socketId, error: error?.message || error });
      }
    }
  }
}

module.exports = {
  buildMediasoupRuntimeConfig,
  MediasoupManager,
  sanitizeAnnouncedAddress,
  isLoopbackOrLocalAddress
};

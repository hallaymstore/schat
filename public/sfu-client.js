(function () {
  function createEmitter() {
    const listeners = new Map();
    return {
      on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
        return () => this.off(event, handler);
      },
      off(event, handler) {
        const bucket = listeners.get(event);
        if (!bucket) return;
        bucket.delete(handler);
        if (!bucket.size) listeners.delete(event);
      },
      emit(event, payload) {
        const bucket = listeners.get(event);
        if (!bucket) return;
        for (const handler of Array.from(bucket)) {
          try { handler(payload); } catch (error) { console.error('SfuClient listener error:', error); }
        }
      }
    };
  }

  class SfuRoomClient {
    constructor(options = {}) {
      this.socket = options.socket || null;
      this.roomKey = String(options.roomKey || '');
      this.peerId = String(options.peerId || '');
      this.logLabel = String(options.logLabel || this.roomKey || 'sfu').trim();
      this.device = null;
      this.joined = false;
      this.sendTransport = null;
      this.recvTransport = null;
      this.producers = new Map(); // source -> producer
      this.producerMeta = new Map(); // producerId -> { source, kind }
      this.consumers = new Map(); // consumerId -> consumer
      this.consumerByProducerId = new Map(); // producerId -> consumerId
      this.peerStreams = new Map(); // peerId -> MediaStream
      this._emitter = createEmitter();
      this._bound = false;
      this.roomMeta = {};
      this._socketHandlers = {
        newProducer: (payload) => this._handleNewProducer(payload),
        producerClosed: (payload) => this._handleProducerClosed(payload),
        disconnect: () => this._emitter.emit('disconnect', { roomKey: this.roomKey })
      };
    }

    on(event, handler) {
      return this._emitter.on(event, handler);
    }

    off(event, handler) {
      this._emitter.off(event, handler);
    }

    _requireSocket() {
      if (!this.socket) throw new Error('Socket is required for SFU room');
      return this.socket;
    }

    async _request(event, payload = {}, timeoutMs = 15000) {
      const socket = this._requireSocket();
      return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error(`${event} timeout`));
        }, timeoutMs);

        socket.emit(event, payload, (response) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (!response || response.ok === false) {
            reject(new Error(response?.error || `${event} failed`));
            return;
          }
          resolve(response);
        });
      });
    }

    _getClientLib() {
      const lib = window.SchatMediasoupClient || window.mediasoupClient || null;
      if (!lib?.Device) throw new Error('mediasoup-client bundle topilmadi');
      return lib;
    }

    _bindSocketEvents() {
      if (this._bound) return;
      const socket = this._requireSocket();
      socket.on('sfu:newProducer', this._socketHandlers.newProducer);
      socket.on('sfu:producerClosed', this._socketHandlers.producerClosed);
      socket.on('disconnect', this._socketHandlers.disconnect);
      this._bound = true;
    }

    _unbindSocketEvents() {
      if (!this._bound || !this.socket) return;
      this.socket.off('sfu:newProducer', this._socketHandlers.newProducer);
      this.socket.off('sfu:producerClosed', this._socketHandlers.producerClosed);
      this.socket.off('disconnect', this._socketHandlers.disconnect);
      this._bound = false;
    }

    async join({ peerMeta = {}, roomMeta = {} } = {}) {
      if (this.joined) return this;
      if (!this.roomKey) throw new Error('roomKey required');
      if (!this.peerId) throw new Error('peerId required');

      const response = await this._request('sfu:joinRoom', {
        roomKey: this.roomKey,
        peerId: this.peerId,
        peerMeta,
        roomMeta
      });

      const lib = this._getClientLib();
      this.device = new lib.Device();
      await this.device.load({ routerRtpCapabilities: response.routerRtpCapabilities });
      this.roomMeta = response.roomMeta || {};
      this.joined = true;
      this._bindSocketEvents();

      const existing = Array.isArray(response.existingProducers) ? response.existingProducers : [];
      for (const producerInfo of existing) {
        await this.consumeProducer(producerInfo).catch((error) => {
          console.warn(`[${this.logLabel}] consume existing producer failed`, error);
        });
      }

      this._emitter.emit('joined', {
        roomKey: this.roomKey,
        peerId: this.peerId,
        roomMeta: this.roomMeta
      });
      return this;
    }

    async ensureSendTransport() {
      if (this.sendTransport) return this.sendTransport;
      if (!this.device) throw new Error('Device not ready');

      const response = await this._request('sfu:createTransport', {
        roomKey: this.roomKey,
        direction: 'send'
      });

      const transport = this.device.createSendTransport(response.transport);
      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this._request('sfu:connectTransport', {
          roomKey: this.roomKey,
          transportId: transport.id,
          dtlsParameters
        }).then(() => callback()).catch(errback);
      });

      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this._request('sfu:produce', {
          roomKey: this.roomKey,
          transportId: transport.id,
          kind,
          rtpParameters,
          appData
        }).then((result) => callback({ id: result.id })).catch(errback);
      });

      transport.on('connectionstatechange', (state) => {
        this._emitter.emit('transportstate', { direction: 'send', state });
      });

      this.sendTransport = transport;
      return transport;
    }

    async ensureRecvTransport() {
      if (this.recvTransport) return this.recvTransport;
      if (!this.device) throw new Error('Device not ready');

      const response = await this._request('sfu:createTransport', {
        roomKey: this.roomKey,
        direction: 'recv'
      });

      const transport = this.device.createRecvTransport(response.transport);
      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this._request('sfu:connectTransport', {
          roomKey: this.roomKey,
          transportId: transport.id,
          dtlsParameters
        }).then(() => callback()).catch(errback);
      });

      transport.on('connectionstatechange', (state) => {
        this._emitter.emit('transportstate', { direction: 'recv', state });
      });

      this.recvTransport = transport;
      return transport;
    }

    _normalizeEncodings(track, providedEncodings) {
      if (!track || track.kind !== 'video') return providedEncodings;
      if (Array.isArray(providedEncodings) && providedEncodings.length) return providedEncodings;
      return [
        { maxBitrate: 250000, scalabilityMode: 'S1T3' },
        { maxBitrate: 700000, scalabilityMode: 'S1T3' },
        { maxBitrate: 1800000, scalabilityMode: 'S1T3' }
      ];
    }

    async publishTrack(track, options = {}) {
      if (!track) return null;
      const source = String(options.source || (track.kind === 'audio' ? 'microphone' : 'camera'));
      const existing = this.producers.get(source);
      if (existing && !existing.closed) {
        await existing.replaceTrack({ track });
        return existing;
      }

      const transport = await this.ensureSendTransport();
      const producer = await transport.produce({
        track,
        streamId: options.streamId,
        encodings: this._normalizeEncodings(track, options.encodings),
        codecOptions: options.codecOptions,
        stopTracks: false,
        disableTrackOnPause: false,
        zeroRtpOnPause: true,
        appData: {
          source,
          kind: track.kind
        }
      });

      this.producers.set(source, producer);
      this.producerMeta.set(producer.id, { source, kind: track.kind });

      const cleanup = () => {
        this.producers.delete(source);
        this.producerMeta.delete(producer.id);
      };

      producer.on('transportclose', cleanup);
      producer.on('close', cleanup);

      return producer;
    }

    async publishStream(stream, options = {}) {
      if (!stream) return;
      const audioTrack = (stream.getAudioTracks?.() || [])[0] || null;
      const videoTrack = (stream.getVideoTracks?.() || [])[0] || null;
      if (audioTrack) {
        await this.publishTrack(audioTrack, {
          source: options.audioSource || 'microphone',
          streamId: options.streamId || stream.id
        });
      }
      if (videoTrack) {
        await this.publishTrack(videoTrack, {
          source: options.videoSource || 'camera',
          streamId: options.streamId || stream.id,
          encodings: options.videoEncodings,
          codecOptions: options.videoCodecOptions
        });
      }
    }

    async replaceTrack(source, track, options = {}) {
      if (!track) return null;
      return this.publishTrack(track, Object.assign({}, options, { source }));
    }

    _getPeerStream(peerId) {
      const id = String(peerId || '');
      let stream = this.peerStreams.get(id);
      if (!stream) {
        stream = new MediaStream();
        this.peerStreams.set(id, stream);
      }
      return stream;
    }

    async consumeProducer(producerInfo) {
      if (!producerInfo) return null;
      const producerId = String(producerInfo.producerId || '');
      const peerId = String(producerInfo.peerId || '');
      if (!producerId || !peerId || peerId === this.peerId) return null;
      if (this.consumerByProducerId.has(producerId)) return this.consumers.get(this.consumerByProducerId.get(producerId)) || null;

      const transport = await this.ensureRecvTransport();
      const response = await this._request('sfu:consume', {
        roomKey: this.roomKey,
        transportId: transport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      });

      const consumer = await transport.consume({
        id: response.id,
        producerId,
        kind: response.kind,
        rtpParameters: response.rtpParameters,
        streamId: response.appData?.source || response.kind,
        appData: response.appData || {}
      });

      const stream = this._getPeerStream(response.peerId || peerId);
      (stream.getTracks?.() || [])
        .filter((existingTrack) => existingTrack && existingTrack.kind === consumer.track.kind)
        .forEach((existingTrack) => {
          try { stream.removeTrack(existingTrack); } catch (_) {}
        });
      try { stream.addTrack(consumer.track); } catch (_) {}

      this.consumers.set(String(consumer.id), consumer);
      this.consumerByProducerId.set(producerId, String(consumer.id));

      const removeConsumerTrack = () => {
        const currentStream = this.peerStreams.get(String(response.peerId || peerId));
        if (currentStream) {
          try { currentStream.removeTrack(consumer.track); } catch (_) {}
          if (!(currentStream.getTracks?.() || []).length) {
            this.peerStreams.delete(String(response.peerId || peerId));
          }
        }
        this.consumers.delete(String(consumer.id));
        this.consumerByProducerId.delete(producerId);
        this._emitter.emit('trackremoved', {
          peerId: String(response.peerId || peerId),
          producerId,
          consumerId: String(consumer.id),
          kind: consumer.kind
        });
      };

      consumer.on('transportclose', removeConsumerTrack);
      consumer.on('producerclose', removeConsumerTrack);
      consumer.on('close', removeConsumerTrack);

      await this._request('sfu:resumeConsumer', {
        roomKey: this.roomKey,
        consumerId: consumer.id
      }).catch(() => {});

      this._emitter.emit('track', {
        peerId: String(response.peerId || peerId),
        producerId,
        consumerId: String(consumer.id),
        kind: consumer.kind,
        source: response.appData?.source || consumer.kind,
        appData: response.appData || {},
        stream,
        track: consumer.track
      });

      return consumer;
    }

    async _handleNewProducer(payload) {
      if (!payload || String(payload.roomKey || '') !== this.roomKey) return;
      if (String(payload.peerId || '') === this.peerId) return;
      await this.consumeProducer(payload).catch((error) => {
        console.warn(`[${this.logLabel}] consume new producer failed`, error);
      });
    }

    async _handleProducerClosed(payload) {
      if (!payload || String(payload.roomKey || '') !== this.roomKey) return;
      const producerId = String(payload.producerId || '');
      const consumerId = this.consumerByProducerId.get(producerId);
      if (!consumerId) return;
      const consumer = this.consumers.get(String(consumerId));
      if (consumer) {
        try { consumer.close(); } catch (_) {}
      }
    }

    async close({ notifyServer = true } = {}) {
      if (notifyServer && this.joined) {
        await this._request('sfu:leaveRoom', { roomKey: this.roomKey }).catch(() => {});
      }

      this._unbindSocketEvents();

      for (const producer of this.producers.values()) {
        try { producer.close(); } catch (_) {}
      }
      for (const consumer of this.consumers.values()) {
        try { consumer.close(); } catch (_) {}
      }
      try { this.sendTransport?.close(); } catch (_) {}
      try { this.recvTransport?.close(); } catch (_) {}

      this.sendTransport = null;
      this.recvTransport = null;
      this.producers.clear();
      this.producerMeta.clear();
      this.consumers.clear();
      this.consumerByProducerId.clear();
      this.peerStreams.clear();
      this.joined = false;
    }
  }

  window.SchatSfuClient = {
    createRoom(options) {
      return new SfuRoomClient(options);
    }
  };
})();

# Realtime Stack

Bu loyiha realtime/videochat qatlamini alohida modullarga ajratilgan holatda ishlatadi:

- `src/realtime/rtc-config.js`
  - STUN/TURN payload yasaydi
  - ExpressTURN secret yoki username/password bilan ishlaydi
- `src/realtime/socket/shared-sfu.js`
  - mediasoup join/transport/produce/consume socket handlerlari
- `src/realtime/socket/private-calls.js`
  - 1:1 call signaling
- `src/realtime/socket/course-live.js`
  - live room signaling

## Frontend asset build

Canonical realtime sahifalar:

- `public/chat.html`
- `public/group.html`
- `public/channel.html`

CDN o‘rniga lokal assetlar ishlatiladi:

- `public/vendor/tailwind-realtime.css`
- `public/vendor/fontawesome/...`
- `public/vendor/adapter-latest.js`

Build buyruqlari:

```bash
npm run build:realtime
```

## ExpressTURN env

Kamida bittasi kerak:

1. Shared secret usuli:

```env
EXPRESSTURN_SECRET_KEY=your_secret
EXPRESSTURN_HOST=relay1.expressturn.com
```

2. Username/password usuli:

```env
EXPRESSTURN_USERNAME=your_username
EXPRESSTURN_PASSWORD=your_password
EXPRESSTURN_HOST=relay1.expressturn.com
```

Ixtiyoriy:

```env
TURN_FORCE_RELAY=1
EXPRESSTURN_TTL=86400
TURN_MAX_URLS=6
TURN_MAX_URLS_PER_HOST=2
```

Default fallback URL patterni ExpressTURN rasmiy secret-key namunalariga mos:

- `turn:relay1.expressturn.com:3478?transport=udp`
- `turn:relay1.expressturn.com:3478?transport=tcp`
- `turn:relay1.expressturn.com:80?transport=tcp`
- `turn:relay1.expressturn.com:443?transport=tcp`

## Mediasoup env

```env
MEDIASOUP_ANNOUNCED_IP=your-public-domain-or-ip
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
```

`MEDIASOUP_ANNOUNCED_IP` berilmasa, server birinchi public HTTP/WebSocket so'rovdan hostni avtomatik olib SFU'ni yoqishga urinadi.

const crypto = require('crypto');

const DEFAULT_STUN_URLS = Object.freeze([
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun3.l.google.com:19302',
  'stun:stun4.l.google.com:19302'
]);

const DEFAULT_EXPRESSTURN_URLS = Object.freeze([
  'turn:relay1.expressturn.com:3478?transport=udp',
  'turn:relay1.expressturn.com:3478?transport=tcp',
  'turn:relay1.expressturn.com:80?transport=tcp',
  'turn:relay1.expressturn.com:443?transport=tcp'
]);

function splitUrls(raw) {
  return String(raw || '')
    .split(/[\s,;]+/g)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeTurnUrl(url) {
  let value = String(url || '').trim();
  if (!value) return '';
  if (/^turns?:\/\//i.test(value)) {
    const protocol = value.startsWith('turns://') ? 'turns:' : 'turn:';
    value = protocol + value.replace(/^turns?:\/\//i, '');
  }
  return value;
}

function parseEmbeddedCredentials(url) {
  const source = String(url || '').trim();
  const match = source.match(/^(turns?:)(?:\/\/)?([^:@\/\s]+):([^@\/\s]+)@(.+)$/i);
  if (!match) {
    return {
      url: source.replace(/^turns?:\/\//i, (value) => value.replace('//', '')),
      username: '',
      credential: ''
    };
  }

  return {
    url: `${match[1]}${match[4]}`.replace(/^turns?:\/\//i, (value) => value.replace('//', '')),
    username: decodeURIComponent(String(match[2] || '')),
    credential: decodeURIComponent(String(match[3] || ''))
  };
}

function parseTurnUrlMeta(url, index = 0) {
  const source = String(url || '').trim();
  if (!source) return null;

  const lower = source.toLowerCase();
  const withoutProtocol = lower.replace(/^turns?:/i, '').replace(/^\/\//, '');
  const endpoint = withoutProtocol.split('?')[0].split('/')[0];
  const host = endpoint.split(':')[0] || '';
  const portMatch = endpoint.match(/:(\d+)$/);
  const port = Number(portMatch?.[1] || 0);
  const transportMatch = lower.match(/[?&]transport=([a-z0-9]+)/i);
  const transport = String(
    transportMatch?.[1]
    || (lower.startsWith('turns:') ? 'tcp' : '')
    || (port === 443 || port === 80 ? 'tcp' : 'udp')
  ).toLowerCase();
  const isTls = lower.startsWith('turns:');

  let bucket = 'other';
  let rank = 90;
  if (isTls && port === 443) {
    bucket = 'tls443';
    rank = 0;
  } else if (!isTls && transport === 'udp' && port === 3478) {
    bucket = 'udp3478';
    rank = 1;
  } else if (!isTls && transport === 'tcp' && port === 443) {
    bucket = 'tcp443';
    rank = 2;
  } else if (!isTls && transport === 'tcp' && port === 80) {
    bucket = 'tcp80';
    rank = 3;
  } else if (!isTls && transport === 'udp') {
    bucket = 'udp';
    rank = 4;
  } else if (!isTls && transport === 'tcp') {
    bucket = 'tcp';
    rank = 5;
  }

  return {
    url: source,
    host,
    bucket,
    rank,
    index
  };
}

function prioritizeTurnUrls(urls, options = {}) {
  const unique = Array.from(new Set((Array.isArray(urls) ? urls : []).map((item) => String(item || '').trim()).filter(Boolean)));
  if (!unique.length) return [];

  const maxTotalRaw = Number(options.maxTotal);
  const maxPerHostRaw = Number(options.maxPerHost);
  const maxTotal = Number.isFinite(maxTotalRaw) && maxTotalRaw > 0 ? Math.max(1, Math.floor(maxTotalRaw)) : 6;
  const maxPerHost = Number.isFinite(maxPerHostRaw) && maxPerHostRaw > 0 ? Math.max(1, Math.floor(maxPerHostRaw)) : 2;

  const candidates = unique
    .map((url, index) => parseTurnUrlMeta(url, index))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    });

  const perHostBuckets = new Map();
  const perHostCount = new Map();
  const selected = [];

  for (const candidate of candidates) {
    if (selected.length >= maxTotal) break;

    const hostKey = String(candidate.host || '_');
    const usedBuckets = perHostBuckets.get(hostKey) || new Set();
    const usedCount = Number(perHostCount.get(hostKey) || 0);

    if (usedBuckets.has(candidate.bucket)) continue;
    if (usedCount >= maxPerHost) continue;

    usedBuckets.add(candidate.bucket);
    perHostBuckets.set(hostKey, usedBuckets);
    perHostCount.set(hostKey, usedCount + 1);
    selected.push(candidate.url);
  }

  return selected.length ? selected : unique.slice(0, maxTotal);
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function createRtcConfigController(options = {}) {
  const env = options.env || process.env;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const getMediasoupPublicInfo = typeof options.getMediasoupPublicInfo === 'function'
    ? options.getMediasoupPublicInfo
    : () => ({ enabled: false });
  const isMediasoupTransportReady = typeof options.isMediasoupTransportReady === 'function'
    ? options.isMediasoupTransportReady
    : () => false;
  const getRecommendedTransport = typeof options.getRecommendedTransport === 'function'
    ? options.getRecommendedTransport
    : () => 'mesh';

  function resolveExpressTurnUrls() {
    const raw = String(
      env.TURN_URL
      || env.TURN_URLS
      || env.TURN_SERVER
      || env.EXPRESS_TURN_URL
      || env.EXPRESS_TURN_URLS
      || env.EXPRESSTURN_URL
      || env.EXPRESSTURN_URLS
      || env.EXPRESS_TURN_URI
      || env.EXPRESSTURN_URI
      || env.TURN_URI
      || ''
    ).trim();

    let embeddedUsername = '';
    let embeddedCredential = '';

    let urls = splitUrls(raw)
      .map((item) => {
        const parsed = parseEmbeddedCredentials(item);
        if (!embeddedUsername && parsed.username) embeddedUsername = parsed.username;
        if (!embeddedCredential && parsed.credential) embeddedCredential = parsed.credential;
        return normalizeTurnUrl(parsed.url);
      })
      .filter(Boolean);

    if (!urls.length) {
      const defaultHost = String(
        env.EXPRESSTURN_HOST
        || env.EXPRESS_TURN_HOST
        || env.EXPRESSTURN_SERVER
        || env.EXPRESS_TURN_SERVER
        || 'relay1.expressturn.com'
      ).trim();
      const allowDefaultFallback = parseBoolean(
        env.EXPRESSTURN_AUTO_URLS
        || env.EXPRESS_TURN_AUTO_URLS
        || env.EXPRESSTURN_FALLBACK
        || env.EXPRESS_TURN_FALLBACK
        || (defaultHost ? '1' : ''),
        true
      );

      if (allowDefaultFallback && defaultHost) {
        urls = DEFAULT_EXPRESSTURN_URLS.map((item) => item.replace('relay1.expressturn.com', defaultHost));
      }
    }

    return {
      urls: prioritizeTurnUrls(Array.from(new Set(urls)), {
        maxTotal: Number(env.TURN_MAX_URLS || env.EXPRESSTURN_MAX_URLS || 6),
        maxPerHost: Number(env.TURN_MAX_URLS_PER_HOST || env.EXPRESSTURN_MAX_URLS_PER_HOST || 2)
      }),
      embeddedUsername,
      embeddedCredential
    };
  }

  function buildRtcConfigPayload() {
    const iceServers = [{ urls: DEFAULT_STUN_URLS.slice() }];
    const { urls, embeddedUsername, embeddedCredential } = resolveExpressTurnUrls();

    const turnUsername = String(
      env.TURN_USERNAME
      || env.TURN_USER
      || env.EXPRESS_TURN_USERNAME
      || env.EXPRESSTURN_USERNAME
      || env.EXPRESS_TURN_USER
      || env.EXPRESSTURN_USER
      || ''
    ).trim();
    const turnCredential = String(
      env.TURN_CREDENTIAL
      || env.TURN_PASSWORD
      || env.EXPRESS_TURN_CREDENTIAL
      || env.EXPRESS_TURN_PASSWORD
      || env.EXPRESSTURN_CREDENTIAL
      || env.EXPRESSTURN_PASSWORD
      || env.EXPRESS_TURN_PASS
      || env.EXPRESSTURN_PASS
      || ''
    ).trim();
    const customUser = turnUsername || embeddedUsername;
    const customPass = turnCredential || embeddedCredential;

    const disableTurn = parseBoolean(env.DISABLE_TURN, false);
    const forceRelayDefault = parseBoolean(env.TURN_FORCE_RELAY || env.FORCE_RELAY, false);

    const expressTurnSecret = String(
      env.EXPRESSTURN_SECRET_KEY
      || env.EXPRESS_TURN_SECRET_KEY
      || env.EXPRESSTURN_SECRET
      || env.EXPRESS_TURN_SECRET
      || env.TURN_SECRET
      || env.TURN_SECRET_KEY
      || ''
    ).trim();
    const secretIdentity = String(
      env.EXPRESSTURN_USERNAME_LABEL
      || env.EXPRESS_TURN_USERNAME_LABEL
      || env.EXPRESSTURN_SHARED_USER
      || env.EXPRESS_TURN_SHARED_USER
      || 'expressturn'
    ).trim() || 'expressturn';
    const secretTtl = Math.max(300, Number(
      env.TURN_TTL_SECONDS
      || env.EXPRESS_TURN_TTL_SECONDS
      || env.EXPRESSTURN_TTL_SECONDS
      || env.EXPRESSTURN_TTL
      || env.EXPRESS_TURN_TTL
      || 86400
    ) || 86400);

    let hasTurn = false;
    let turnProvider = 'stun';

    if (!disableTurn && urls.length) {
      if (expressTurnSecret) {
        const unixExpiry = Math.floor(Date.now() / 1000) + secretTtl;
        const username = `${unixExpiry}:${secretIdentity}`;
        const credential = crypto.createHmac('sha1', expressTurnSecret).update(username).digest('base64');
        iceServers.push({
          urls,
          username,
          credential
        });
        hasTurn = true;
        turnProvider = 'expressturn';
      } else if (customUser && customPass) {
        iceServers.push({
          urls,
          username: customUser,
          credential: customPass
        });
        hasTurn = true;
        turnProvider = String(
          env.EXPRESSTURN_HOST
          || env.EXPRESS_TURN_HOST
          || env.EXPRESSTURN_URL
          || env.EXPRESS_TURN_URL
          || ''
        ).trim() ? 'expressturn' : 'custom';
      } else {
        log('RTC config: TURN urls present but credentials missing, serving STUN-only fallback');
      }
    }

    return {
      success: true,
      iceServers,
      hasTurn,
      forceRelayDefault,
      turnProvider,
      livekitConfigured: false,
      mediasoupConfigured: isMediasoupTransportReady(),
      mediasoup: getMediasoupPublicInfo(),
      recommendedTransport: getRecommendedTransport()
    };
  }

  function respondWithRtcConfig(req, res) {
    res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=300');
    return res.json(buildRtcConfigPayload());
  }

  function handlePublicRequest(req, res) {
    try {
      return respondWithRtcConfig(req, res);
    } catch (error) {
      log('RTC config public handler failed', error);
      return res.status(500).json({ success: false, error: 'Failed to build rtc config' });
    }
  }

  function handleExternalRequest(req, res) {
    try {
      return respondWithRtcConfig(req, res);
    } catch (error) {
      log('RTC config external handler failed', error);
      return res.status(500).json({ error: 'Failed to build rtc config' });
    }
  }

  return {
    buildRtcConfigPayload,
    handlePublicRequest,
    handleExternalRequest
  };
}

module.exports = {
  DEFAULT_STUN_URLS,
  DEFAULT_EXPRESSTURN_URLS,
  createRtcConfigController,
  normalizeTurnUrl,
  parseTurnUrlMeta,
  prioritizeTurnUrls
};

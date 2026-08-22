# HALLAYM EDU v3 — Codex server handoff

Bu arxiv serverga ulash uchun tayyorlangan yakuniy loyiha. `npm start` kirish
nuqtasi `server115007.js`. Mavjud `.env` qiymatlari dizayn yangilanishi vaqtida
o‘zgartirilmagan. Arxivni ochiq repozitoriyga yoki ommaviy fayl almashuviga
joylamang.

## 1. Production `.env`

Serverda quyidagilarni majburiy tekshiring:

```env
NODE_ENV=production
PORT=3000
HTTP_HOST=0.0.0.0
APP_URL=https://edu.example.uz
CORS_ORIGINS=https://edu.example.uz

MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/DB?retryWrites=true&w=majority
JWT_ACCESS_SECRET=GENERATE_A_NEW_RANDOM_SECRET_OF_32_PLUS_CHARACTERS
JWT_ACCESS_TTL=15m
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax

MEDIASOUP_ENABLED=1
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=PUBLIC_IPV4_OR_PUBLIC_HOST
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
MEDIASOUP_WORKERS=4
MEDIASOUP_MAX_PEERS_PER_ROOM=250
```

`MEDIASOUP_ANNOUNCED_IP` productionda `127.0.0.1` bo‘lmasligi shart. JWT
kalitini `openssl rand -base64 48` bilan yarating. Chatda yoki avvalgi paketda
ko‘ringan MongoDB/Groq parollarini productionga chiqishdan oldin yangilang.

MongoDB Atlas ichida yangi database user yarating, server public IP manzilini
Network Access ro‘yxatiga kiriting va URI parolidagi maxsus belgilarni URL
formatida kodlang.

## 2. TURN va mediasoup

Mobil operator, universitet Wi-Fi va qat’iy NAT tarmoqlari uchun TURN majburiy.
Quyidagi usullardan bittasini to‘ldiring:

```env
TURN_URLS=turn:turn.example.uz:3478?transport=udp,turn:turn.example.uz:3478?transport=tcp,turns:turn.example.uz:5349?transport=tcp
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

yoki vaqtinchalik credential beruvchi shared secret:

```env
TURN_URLS=turn:turn.example.uz:3478?transport=udp,turn:turn.example.uz:3478?transport=tcp,turns:turn.example.uz:5349?transport=tcp
TURN_SECRET=...
TURN_TTL_SECONDS=86400
```

Firewall/security group:

- TCP `80`, `443` — reverse proxy;
- UDP va TCP `40000–49999` — mediasoup;
- TURN o‘z serveringizda bo‘lsa UDP/TCP `3478` va TLS/TCP `5349`.

Bir container nusxasi mediasoup xonalarini xotirada saqlaydi. Horizontal scale
qilishdan oldin Socket.IO adapter, sticky sessions va xonalarni instansiyaga
yo‘naltirish arxitekturasini alohida sozlang.

## 3. Storage

`STORAGE_DRIVER=local` ishlaydi, lekin ephemeral hostingda fayllar restartdan
keyin yo‘qolishi mumkin. Production uchun Cloudflare R2 tavsiya qilinadi:

```env
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=hallaym-edu
R2_PUBLIC_BASE_URL=https://media.example.uz
MAX_UPLOAD_MB=250
UPLOAD_TMP_DIR=/tmp/hallaym-edu-uploads
```

## 4. O‘rnatish va ishga tushirish

```bash
npm ci
npm test
npm start
```

Node.js 20 LTS yoki 22 LTS, mediasoup uchun Linux build vositalari va yetarli
`ulimit -n` kerak. Process manager sifatida systemd yoki PM2 ishlating; avariya
holatida avtomatik restart yoqilgan bo‘lsin.

Nginx/Cloudflare WebSocket upgrade’ni saqlashi, proxy timeout’ni uzoq darslar
uchun kamida bir necha soatga qo‘yishi va `client_max_body_size` ni
`MAX_UPLOAD_MB` bilan moslashtirishi kerak. Kamera, mikrofon, ekran ulashish,
SpeechRecognition va PiP productionda faqat HTTPS secure contextda ishlaydi.

## 5. Birinchi admin

`BOOTSTRAP_ADMIN_*` qiymatlari faqat birinchi ishga tushirishda ishlatiladi.
Admin yaratilgach `BOOTSTRAP_ADMIN_PASSWORD` ni `.env` dan olib tashlang.
Server mavjud admin parolini avtomatik almashtirmaydi; faqat ataylab
`BOOTSTRAP_ADMIN_RESET_PASSWORD=true` berilsa yangilaydi.

## 6. Qabul testi

1. `GET /api/health` `200` qaytarsin.
2. `GET /api/rtc-config` ichida `mediasoupConfigured: true` va productionda
   `hasTurn: true` bo‘lsin.
3. Ikki turli internet tarmog‘idagi qurilmada guruh darsiga kiring.
4. Kamera/mikrofonni yoqib-o‘chiring, ekranni ulashing, 10+ daqiqa kuzating.
5. Oq doskada qalam, matn, shakl, undo/redo va o‘qituvchi PiP’ini tekshiring.
6. `Ovoz` va `Imo` tugmalariga kamera/mikrofon ruxsatini bering.
7. O‘zbek/Rus/Ingliz subtitrlarini ikki ishtirokchida sinang.
8. Telefon, planshet va desktopda kunduzgi/tungi mavzuni tekshiring.

Brauzer konsolida doimiy WebSocket reconnect, ICE failure yoki mediasoup worker
`died` logi bo‘lmasligi kerak. TURN relayi uchun vaqtincha `TURN_FORCE_RELAY=1`
bilan sinov o‘tkazib, keyin odatiy rejimga qaytaring.

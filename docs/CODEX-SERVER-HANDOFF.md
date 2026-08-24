# HALLAYM EDU v5.3.1 — Codex server handoff

Bu arxiv serverga ulash uchun tayyorlangan yakuniy loyiha. `npm start` kirish
nuqtasi `server115007.js`. Mavjud `.env` qiymatlari dizayn yangilanishi vaqtida
o‘zgartirilmagan. Arxivni ochiq repozitoriyga yoki ommaviy fayl almashuviga
joylamang.

Arxivda foydalanuvchi bergan asl loyihadagi to‘liq `node_modules` ham saqlangan.
Server operatsion tizimi yoki Node.js versiyasi boshqacha bo‘lsa, native
`mediasoup` moduli aynan server uchun qayta yig‘ilishi sabab `npm ci` baribir
tavsiya qilinadi.

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

FACE_AUTH_REQUIRED=true
FACE_TEMPLATE_SECRET=GENERATE_A_SEPARATE_RANDOM_SECRET_AND_KEEP_IT_STABLE
FACE_CHALLENGE_TTL=5m
FACE_MAX_FAILED_ATTEMPTS=5
FACE_LOCK_MINUTES=15

MEDIASOUP_ENABLED=1
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=PUBLIC_IPV4_OR_PUBLIC_HOST
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
MEDIASOUP_WORKERS=4
MEDIASOUP_MAX_PEERS_PER_ROOM=250
```

`MEDIASOUP_ANNOUNCED_IP` productionda `127.0.0.1` bo‘lmasligi shart. JWT va
`FACE_TEMPLATE_SECRET` kalitlarini `openssl rand -base64 48` bilan alohida
yarating. `FACE_TEMPLATE_SECRET` almashtirilsa barcha foydalanuvchilardan yuzni
qayta ro‘yxatdan o‘tkazish talab etiladi. Chatda yoki avvalgi paketda
ko‘ringan MongoDB/Groq parollarini productionga chiqishdan oldin yangilang.

MongoDB Atlas ichida yangi database user yarating, server public IP manzilini
Network Access ro‘yxatiga kiriting va URI parolidagi maxsus belgilarni URL
formatida kodlang.

Server ishga tushgach `GET /api/rtc-health` ni oching. Javobda
`turn.ready: true` bo‘lishi kerak. `mediasoup.ready: false` bo‘lsa videoqo‘ng‘iroq
ExpressTURN mesh orqali ishlaydi; SFU ishga tushishi uchun public announced IP
va media portlari ochiq bo‘lishi shart.

## 2. Yuz tasdig‘i va maxfiylik

Ro‘yxatdan o‘tishda yoki eski akkauntning birinchi keyingi loginida kamera bitta
yuzni oladi va tasodifiy ko‘z qisish, tabassum yoki bosh burish topshirig‘i bilan
jonlilikni tekshiradi. Serverga kamera rasmi emas, yuz nuqtalari va kichik tekstura
vektori yuboriladi; u MongoDB’da AES-256-GCM bilan shifrlangan holda saqlanadi.
Keyingi loginlarda parol to‘g‘ri bo‘lsa ham shu yuz mos tushmaguncha JWT va sessiya
berilmaydi. Besh xato urinish akkauntning yuz tekshiruvini 15 daqiqaga qulflaydi.

Eski access-tokenlar v5.3 ishga tushgach yuz tasdig‘ini chetlab o‘ta olmaydi va
qayta login talab qiladi. Kamera ishlashi uchun HTTPS va brauzer ruxsati shart.
Foydalanuvchi kamera/yuz ma’lumotiga rozilik bermasa majburiy rejimda akkauntga
kira olmaydi. Admin paneldagi `Yuz reset` foydalanuvchining shifrlangan shablonini
o‘chiradi va uning faol sessiyalarini bekor qiladi; keyingi login yangi yuz oladi.

Bu brauzer ichidagi jonlilik kundalik LMS kirishi uchun anti-spoof qatlamidir,
bank darajasidagi biometrik identifikatsiya emas. Yuqori huquqli rollar uchun
keyinchalik WebAuthn/passkey yoki sertifikatlangan server-side face provayderini
ikkinchi omil sifatida ulash tavsiya qilinadi.

## 3. TURN va mediasoup

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

ExpressTURN premium dashboard nomlari bilan ham ishlaydi:

```env
EXPRESSTURN_HOST=relay1.expressturn.com
EXPRESSTURN_USERNAME=...
EXPRESSTURN_PASSWORD=...
# Yoki username/password o‘rniga:
EXPRESSTURN_SECRET_KEY=...
EXPRESSTURN_TTL=86400
```

Firewall/security group:

- TCP `80`, `443` — reverse proxy;
- UDP va TCP `40000–49999` — mediasoup;
- TURN o‘z serveringizda bo‘lsa UDP/TCP `3478` va TLS/TCP `5349`.

Bir container nusxasi mediasoup xonalarini xotirada saqlaydi. Horizontal scale
qilishdan oldin Socket.IO adapter, sticky sessions va xonalarni instansiyaga
yo‘naltirish arxitekturasini alohida sozlang.

## 4. Storage

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
COURSE_VIDEO_MAX_GB=5
COURSE_VIDEO_PART_MB=8
COURSE_VIDEO_UPLOAD_TTL_SECONDS=86400
```

`R2_PUBLIC_BASE_URL` public R2 custom domain bo‘lishi kerak. 1 GB+ videolar 8 MB
bo‘laklarda yuklanadi va uzilishdan keyin aynan qolgan qismidan davom etadi.
Nginx uchun `client_max_body_size 10m;` yetarli, chunki katta fayl bitta request
emas. R2/custom domain `Range` so‘rovlarini saqlashi kerak; shunda 40–80 daqiqalik
video istalgan joyidan tez ochiladi.

## 5. O‘rnatish va ishga tushirish

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

## 6. Birinchi admin

`BOOTSTRAP_ADMIN_*` qiymatlari faqat birinchi ishga tushirishda ishlatiladi.
Admin yaratilgach `BOOTSTRAP_ADMIN_PASSWORD` ni `.env` dan olib tashlang.
Server mavjud admin parolini avtomatik almashtirmaydi; faqat ataylab
`BOOTSTRAP_ADMIN_RESET_PASSWORD=true` berilsa yangilaydi.

## 7. Qabul testi

1. `GET /api/health` `200` qaytarsin.
2. `GET /api/rtc-health` ichida `turn.ready: true` bo‘lsin; SFU ishlatilsa
   `mediasoup.ready: true` va `publicAnnouncedAddress: true` bo‘lsin.
3. Ikki turli internet tarmog‘idagi qurilmada guruh darsiga kiring.
4. Kamera/mikrofonni yoqib-o‘chiring, ekranni ulashing, 10+ daqiqa kuzating.
5. Asosiy kamera to‘liq 16:9 qolganini, bo‘sh primary-slot sabab yarim ekran
   paydo bo‘lmasligini tekshiring; so‘ng alohida oq doska PiP’ini oching;
   ikki foydalanuvchida qalamning jonli sinxroni, matn, shaklni ko‘chirish,
   kattalashtirish, aylantirish va undo/redo’ni tekshiring.
6. AI fokusda yuz kuzatuvi, ko‘rsatkich bilan nuqtani qotirish va musht bilan
   yuz kuzatuviga qaytishni tekshiring; asosiy kamera kadrining kesilmasligini
   alohida tasdiqlang.
7. `Ovoz` va `Imo` tugmalariga kamera/mikrofon ruxsatini bering; yordamchi o‘z
   javobini buyruq deb qayta qabul qilmasligini sinang.
8. O‘zbek/Rus/Ingliz subtitrlarini ikki ishtirokchida sinang; tilni dars paytida
   almashtirib, audio uzilmasdan yangi recognizer darhol ishga tushishini tekshiring.
9. Telefon, planshet va desktopda kunduzgi/tungi mavzuni tekshiring.
10. Teacher Studio orqali kamida 1 GB qurilma videosi va bitta YouTube darsi
    qo‘shing; uploadni o‘rtada pauza qilib va sahifani qayta ochib davom ettiring.
    Katalog hover-preview, 16:9 watch player, Range seek va playlistni tekshiring.
11. Video-like, root comment, reply va ikkala comment-like hisobini ikki
    foydalanuvchi bilan tekshiring.
12. Profil rasmini bo‘sh qoldirib teacher, qiz/ayol, o‘g‘il/erkak va neytral
    avtomatik SVG ikonlarini guruh a’zolari hamda chat xabarlarida tekshiring.
13. Ovozli yordamchiga 5 soniyadan uzun va noto‘g‘riroq talaffuzli buyruq ayting;
    sahifa almashtirgach ovoz va imo-navigatsiya avtomatik qaytishini tekshiring.
14. Ochiq kursni enrollment qilmagan talaba ko‘ra olishini, izoh/reply/like
    ishlashini va “Siz uchun” ro‘yxati fan/fakultet/guruhga mosligini tekshiring.
15. Mobil telefonda global aylanadigan loader ko‘rinmasligini, elementlar bosilishi
    davom etishini va talabalar kamerasi bir xil 16:9 panjarada turishini tekshiring.
16. Yangi registratsiyada yuz/rozilik topshirig‘ini, eski akkaunt loginida birinchi
    enrollmentni, keyingi loginda mos yuzni va boshqa yuz rad qilinishini tekshiring.
17. Admin, rektor, prorektor va tyutor bilan kirib, har biri o‘z paneliga yo‘naltirilishi,
    tyutor faqat o‘z fakulteti guruhlari va darslarini boshqarishini tekshiring.

Brauzer konsolida doimiy WebSocket reconnect, ICE failure yoki mediasoup worker
`died` logi bo‘lmasligi kerak. TURN relayi uchun vaqtincha `TURN_FORCE_RELAY=1`
bilan sinov o‘tkazib, keyin odatiy rejimga qaytaring.

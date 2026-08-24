# HALLAYM EDU v5.3.1 — `.env` deployment holati

Ushbu paketdagi `.env` yangi `.env.example` strukturasiga ko‘chirildi.

- `NODE_ENV=production`, public host va secure cookie sozlangan.
- Public URL va CORS `https://edu.hallaym.site` ga sozlangan.
- Avvalgi MongoDB Atlas, Cloudflare R2, Cloudinary, Groq, TURN/ExpressTURN,
  LiveKit va to‘lov qiymatlari saqlangan.
- Eski `JWT_SECRET` va `SESSION_SECRET` placeholderlari o‘rniga yangi kuchli
  `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` yaratildi; eski nomlar ham aynan shu
  yangi qiymatlarga compatibility alias sifatida qoldirildi.
- Yuz shablonini AES-256-GCM bilan shifrlash uchun alohida kuchli
  `FACE_TEMPLATE_SECRET` yaratildi.
- `.env.example` ichidagi barcha 81 ta maydon `.env`da mavjud; eski versiyada
  ishlatilgan qo‘shimcha aliaslar ham yo‘qotilmagan.

Maxfiy `.env` faylini GitHub yoki ochiq fayl almashuviga joylamang. Serverga
faqat himoyalangan kanal orqali ko‘chiring. Reverse proxy HTTPS va WebSocket
upgrade’ni saqlashi kerak.

`MEDIASOUP_ANNOUNCED_IP` ataylab bo‘sh qoldirilgan: dastur birinchi public
request/socket hostidan public hint oladi. DevOps aniq public IPv4 ajratsa,
keyinchalik shu qiymatni statik public IPv4 bilan to‘ldirishi mumkin.

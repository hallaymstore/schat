# HALLAYM EDU — Accessible Classroom

Ushbu modul mavjud mediasoup/WebRTC qo‘ng‘iroq tizimini almashtirmaydi. U mavjud
SFU/mesh media oqimining ustiga ixcham oq-ko‘k interfeys, o‘qituvchi sahnasi,
ikki xil imo-ishora boshqaruvi, ovozli buyruqlar va jonli subtitr qatlamini qo‘shadi.

## Interfeys

- Butun sayt uchun oq-ko‘k enterprise palitra va kontrasti tekshirilgan tungi mavzu.
- Kartalar, maydonlar, tugmalar va oynalar 2–3 px radiusda.
- Asosiy shrift 12–13 px; sarlavhalar responsive.
- Kontent 1800 px gacha kengayadi, tor eski konteynerlar bekor qilingan.
- O‘qituvchi sahnasi qat’iy 16:9.
- Kamera doim alohida mediasoup/WebRTC video treki va `object-fit: contain`
  bilan to‘liq 16:9 kadrda qoladi; oq doska kamerani almashtirmaydi.
- Oq doska o‘qituvchi va talabalarga alohida 16:9 PiP sifatida Socket.IO orqali
  sinxronlanadi. Erkin chiziqlar ixcham koordinata operatsiyalari bilan jonli,
  to‘liq holat esa tahrir tugagach siqilgan 960×540 kadr bilan tekislanadi.
  Oynani ko‘chirish, burchagidan o‘lchash va to‘liq yoyish mumkin.
- Oq doskada qalam, o‘chirgich, tanlash, ko‘chiriladigan matn, shrift oilasi,
  14–140 px o‘lcham, qalinlik, tekislash, chiziq, strelka, doira,
  to‘rtburchak, shaklni ko‘chirish/kattalashtirish/kichraytirish/aylantirish,
  takrorlash, o‘chirish, undo va redo mavjud.
- Klaviatura va screen-reader uchun fokus halqasi, skip-link va ARIA live holatlari.

## AI imo-ishora boshqaruvi

O‘qituvchi videodars oynasidagi qo‘l ikonasi orqali rejimni yoqadi. Kamera
tasviri brauzer ichida MediaPipe Tasks Vision bilan qayta ishlanadi; video yoki
biometrik kadr serverga yuborilmaydi. Serverga faqat 0–1 oralig‘idagi fokus
koordinatalari va rejim nomi jo‘natiladi.

- Yuz topilsa — alohida 16:9 AI fokus oynasi o‘qituvchi yuzini kuzatadi;
  asosiy kamera kesilmaydi va kattalashtirilmaydi.
- Ko‘rsatkich barmoq — AI fokus oynasida ko‘rsatilgan joyni 2.55x yaqinlashtiradi
  va barmoq yo‘qolganda oxirgi joyda qotib qoladi.
- Ochiq kaft (STOP) — joriy fokusni qotirib saqlaydi.
- Musht — qotirilgan nuqtani bo‘shatib, yuz kuzatuviga qaytaradi.
- Oq doskada ko‘rsatkich barmoq — erkin chizadi.
- Ikki barmoq — doira chizadi.
- Uch barmoq — to‘rtburchak chizadi.
- Bosh va ko‘rsatkich barmoqni qisish — chiziq chizadi.

AI model birinchi ishga tushganda rasmiy MediaPipe model fayllarini yuklaydi.
Model yuklanmasa, oddiy sichqoncha/touch chizish va `+`, `-`, `1:1` fokus
boshqaruvlari ishlashda davom etadi.

### Butun sayt bo‘ylab imo-navigatsiya

Pastdagi `Imo` tugmasi yoki `Alt+G` orqali kamera navigatsiyasi yoqiladi. Bu
rejim bosh sahifadan boshlab ishlaydi:

- Ko‘rsatkich barmoq — ekrandagi kursorni yuritadi.
- Bosh va ko‘rsatkich barmoqni qisish — tanlangan tugmani bosadi.
- Ochiq kaftni chap/o‘ng silkitish — ekrandagi tugma, karta va bo‘limlar bo‘ylab
  birma-bir yuradi; kamera PiP oynasi ochiq qoladi.
- V belgisi — faol videodarsni topib qo‘shiladi.
- Uch barmoq — xabarlar sahifasini ochadi.
- Musht — oldingi sahifaga qaytadi.

Bu funksional qat’iy buyruqlar lug‘ati bo‘lib, tabiiy imo-ishora tilini tarjima
qiluvchi vosita emas. Kamera kadrlari brauzer ichida qayta ishlanadi.

## Ovozli yordamchi

Brauzer xavfsizlik talabi sabab mikrofon avtomatik yoqilmaydi. Foydalanuvchi
saytning pastki chap burchagidagi `Ovoz` tugmasini yoki `Alt+V` ni bir marta
bosadi. Qo‘llab-quvvatlanadigan buyruqlar:

Yordamchi o‘zi gapirayotganda SpeechRecognition vaqtincha to‘xtaydi va javob
tugagach 900 ms himoya oralig‘idan so‘ng qayta yoqiladi. Bu echo/self-listening
zanjirini to‘xtatadi.

- `Guruhimga kir`
- `Darsga qo‘shil`
- `Chatga yoz ...`
- `Oxirgi 3 ta xabarni o‘qi` (1–10 oralig‘i qo‘llanadi)
- `Bosh sahifa`, `Guruhlar`, `Xabarlar`, `Kurslar`, `Jadval`, `Profil`
- `Pastga`, `Yuqoriga`, `Keyingi tugma`, `Oldingi tugma`, `Tanla`
- `Sahifani o‘qi`, `Tungi mavzuni yoq`, `Kunduzgi mavzuni yoq`
- `Subtitrlarni yoq` / `Subtitrlarni o‘chir`
- `Subtitr O‘zbek`, `Subtitr Rus`, `Subtitr Ingliz`
- `Oq doskani och` / `Oq doskani yop`
- `Doska qalam`, `Doska matn`, `Doska doira`, `Doska strelka`, `Bekor qil`
- `Doskani kattalashtir`, `Doskani kichraytir`, `Shaklni kattalashtir`,
  `Shaklni kichraytir`, `Shaklni chapga/o‘ngga aylantir`
- `Kamerani yoq` / `Kamerani o‘chir`
- `Mikrofonni yoq` / `Mikrofonni o‘chir`
- `Ekranni ulash`, `Davomatni och`, `To‘liq ekran`, `Yaqinlashtir`
- `Navigatsiya imoni yoq` / `Navigatsiya imoni o‘chir`
- `AI imoni yoq` / `AI imoni o‘chir`

Chrome yoki Edge tavsiya qilinadi. Kamera, mikrofon, SpeechRecognition va PiP
ishlashi uchun production domen HTTPS orqali ochilishi kerak.

## Jonli subtitr

Asosiy o‘qituvchi brauzeri nutqni transkripsiya qiladi va mavjud
`groupCallCaption` Socket.IO kanali orqali dars ishtirokchilariga uzatadi.
Talaba O‘zbek, English yoki Русский ko‘rinishini tanlay oladi. Subtitr tugmasi
har bir foydalanuvchi uchun alohida saqlanadi. Qabul qiluvchi tomonda subtitr
oldidan gapirayotgan foydalanuvchining ismi ham ko‘rsatiladi.

## Tekshirish

```bash
npm install
npm test
npm start
```

Productionda mediasoup UDP portlari, tashqi announced IP va autentifikatsiyali
TURN/TCP/TLS serveri to‘liq sozlanishi shart.

Kamera ishga tushishi uchun foydalanuvchi brauzer ruxsatini berishi kerak.
Ilova talablarni bosqichma-bosqich 720p, 360p va oddiy kamera rejimigacha
pasaytirib qayta urinadi; ruxsat, band kamera yoki HTTPS xatosini aniq ko‘rsatadi.

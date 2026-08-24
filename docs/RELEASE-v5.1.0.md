# HALLAYM EDU v5.1.0 — Classroom performance release

## Tuzatilgan asosiy muammolar

- O‘qituvchi video tile’i bo‘sh primary-slot ostida ikkinchi qator bo‘lib qolishi bartaraf etildi.
- O‘qituvchi kamerasi qat’iy 16:9 sahnada `contain` rejimida to‘liq ko‘rinadi.
- Talabalar kamerasi bir xil 16:9 responsive panjarada tartiblandi.
- Global aylanuvchi loading olib tashlandi; fon so‘rovlari sahifani to‘smaydi.
- Mobil, kuchsiz qurilma va videodarsda avtomatik yengil render profili ishlaydi.
- AI kamera yaqin yuzda to‘liq kadrga qaytadi, uzoq yuzda asta yaqinlashadi.
- Ko‘rsatkich barmoq aniqlanganda alohida AI fokus PiP ko‘rsatilgan nuqtani kuzatadi.
- AI hand/face tahlili mobil qurilmada turli intervalda ishlaydi va CPU yukini kamaytiradi.
- Jonli subtitrlar Uzbek/English/Russian tilini almashtirganda eski recognizer bekor qilinib, yangisi 40 ms navbat bilan ishga tushadi.
- Tarjima 1.2 soniya bilan cheklangan; audio transkripsiya tarjimani kutib qotmaydi.
- Barcha platforma sahifalari yagona oq–ko‘k palitraga o‘tkazildi; alohida bloklar och ko‘k fon va ko‘k chegara bilan ajratiladi.
- Profil qopqog‘i, tugmalar, kartalar, statuslar va standart robot ranglaridagi eski yashil/sariq/binafsha aralashmalar olib tashlandi.
- Semantik farqni yo‘qotmaslik uchun faqat xato, xavf va qo‘ng‘iroqni yakunlash kabi destruktiv holatlar qizil qoldirildi.

## Ishga tushirish

1. `.env` ichida MongoDB Atlas, JWT, TURN va mediasoup server IP qiymatlarini production serverga moslang.
2. `npm install`
3. `npm test`
4. `npm start`

Production kamerasi, mikrofon, SpeechRecognition va WebRTC uchun HTTPS talab qilinadi.

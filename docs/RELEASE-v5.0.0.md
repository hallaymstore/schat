# HALLAYM EDU 5.0.0

## Video kurslar

- Kurs katalogi soddalashtirilib, YouTube uslubidagi responsive video kartalarga
  o‘tkazildi.
- Qurilmadan yuklangan MP4/WebM video va YouTube havolalari bir xil watch
  sahifasida ochiladi.
- Kursor video kartasi ustida turganda 7 soniyalik bo‘laklar orqali videoning
  turli qismlaridan ovozsiz tezkor preview ko‘rsatiladi. `Save-Data` yoki
  `prefers-reduced-motion` yoqilgan qurilmada bu avtomatik o‘chadi.
- Watch sahifasida 16:9 player, dars playlisti, video-like, izoh, izohga javob,
  izoh-like, ulashish va kurs bahosi mavjud.
- Pullik kursning to‘liq video manzili katalogga berilmaydi; faqat o‘qituvchi
  `isPreview` deb belgilagan dars preview qilinadi.

## Uzluksiz accessibility

- Ovozli yordamchi gapni 5 soniyalik jimlikdan keyin bajaradi va bir uzluksiz
  nutqni 60 soniyagacha jamlaydi.
- Talaffuz farqlariga yaqinlik bo‘yicha moslashuvchi buyruq aniqlash qo‘shildi.
- Noma’lum buyruqda yordamchi ovoz bilan qayta-qayta “tushunmadim” demaydi.
- Ovoz va kamera orqali imo-navigatsiya bir marta yoqilgach sahifa almashganda
  localStorage holatidan avtomatik tiklanadi. Brauzer xavfsizlik qoidasi sabab
  yangi documentda kamera fizik jihatdan qayta olinadi, ammo qayta tugma bosish
  talab qilinmaydi (ruxsat saqlangan bo‘lsa).
- Ro‘yxatdan o‘tish va profil tahririda maxsus qulaylik holati, turi va kerakli
  yordamchi funksiyalar ixtiyoriy va rozilik asosida saqlanadi.

## Avtomatik profil ikonlari

- Profil rasmi bo‘lmaganlar uchun server yaratadigan lokal SVG avatarlar bor.
- O‘qituvchi/rahbar uchun akademik ikon, ixtiyoriy tanlov asosida qiz/ayol,
  o‘g‘il/erkak yoki neytral talaba ikoni ko‘rsatiladi.
- Eski Cloudinary demo avatar manzili singan bo‘lsa, barcha HTML sahifalarda
  global fallback avtomatik ishlaydi.

## Tekshiruv

- O‘zgartirilgan server va browser JavaScript fayllari parser tekshiruvidan o‘tdi.
- `node --test tests/*.test.js`: 11/11 test o‘tdi.
- Asl `.env` fayli o‘zgartirilmadi.


# HALLAYM EDU v5.2.0

## Videoqo‘ng‘iroq

- Mediasoup real remote trek bermasa qisqa media timeoutdan keyin, transportning
  o‘zi xato bersa esa ikki urinishdan so‘ng xona barcha qatnashchilar uchun bir
  vaqtda ExpressTURN mesh rejimiga o‘tadi.
- Desktop va mobil qatnashchi bir-birini ko‘rishi/eshitishi uchun non-stage audio
  darajasi tuzatildi.
- O‘qituvchi sahnasi bitta qat’iy 16:9 qatlamda ishlaydi; kech kelgan kamera treki
  ikkinchi qator hosil qilmaydi.
- `GET /api/rtc-health` credentiallarni oshkor qilmasdan TURN/SFU holati va kerakli
  media portlarini ko‘rsatadi.

## Guruhlar

- Faol videodars guruh kartasida ko‘k pulsli `JONLI` belgisi, dars nomi va
  qatnashchilar soni bilan ko‘rinadi.
- Ro‘yxat bloklovchi loader ko‘rsatmasdan 7 soniyada yangilanadi.

## Video kurslar

- Published public kurslarni barcha autentifikatsiyalangan talabalar enrollment
  qilmasdan ko‘ra oladi, like, comment, reply va comment-like ishlaydi.
- Teacher Studio 1 GB+ videoni R2 ga 8 MB multipart bo‘laklarda yuklaydi.
  Pauza, bekor qilish va uzilishdan keyin davom ettirish mavjud.
- Katalog va ichki watch sahifasida fan, fakultet, o‘quv guruhi, tarix, reyting va
  ommaboplik asosidagi `Siz uchun` tavsiyalari bor.
- Qurilma videosi va YouTube havolasi bir xil oq-ko‘k YouTube-uslubidagi 16:9
  player, playlist va tezkor preview oqimida ishlaydi.

Serverga ulashdan oldin `docs/CODEX-SERVER-HANDOFF.md` dagi firewall, ExpressTURN,
R2 public domain va qabul testlarini bajaring.

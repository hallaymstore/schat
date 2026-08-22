# HALLAYM EDU 4.0.0

## Tuzatilgan asosiy muammolar

- O‘qituvchi kamerasiga AI masshtab qo‘llash olib tashlandi: asosiy kamera doim
  to‘liq, kesilmagan 16:9 kadrda qoladi.
- Yuz va ko‘rsatkich kuzatuvi alohida 16:9 `AI FOKUS` PiP oynasiga ko‘chirildi.
- Ko‘rsatkich barmoq ko‘rinib turganda fokus uning ortidan yuradi; barmoq
  yo‘qolganda so‘nggi nuqta saqlanadi; musht yuz kuzatuviga qaytaradi.
- Oq doska kamera video trekini endi almashtirmaydi. U alohida ko‘chiriladigan,
  16:9 nisbatini saqlaydigan va kattalashtiriladigan PiP oynadir.
- Oq doska barcha dars ishtirokchilariga sinxronlanadi. Jonli qalam chiziqlari
  kichik koordinata operatsiyalari bilan, yakuniy holat esa siqilgan kadr bilan
  tekislanadi.
- Chiziq, strelka, doira va to‘rtburchaklar vektor obyektlar bo‘lib saqlanadi;
  ularni tanlash, ko‘chirish, burchagidan o‘lchash va aylantirish mumkin.
- Ovozli yordamchi gapirayotganda SpeechRecognition to‘xtaydi va 900 ms echo
  himoyasidan keyin qayta tinglaydi. O‘zbekcha buyruq variantlari kengaytirildi.
- Sayt bo‘ylab imo-navigatsiyada ochiq kaftni chap/o‘ng silkitish ko‘rinadigan
  tugma, karta va bo‘limlar bo‘ylab birma-bir yuradi; kamera PiP ochiq qoladi.

## Tekshiruv

- `server115007.js` sintaksisi: o‘tdi.
- `public/accessibility-assistant.js` sintaksisi: o‘tdi.
- `public/group.html` ichidagi 8 ta inline skript parser tekshiruvi: o‘tdi.
- `node --test tests/*.test.js`: 7/7 o‘tdi.
- Asl `.env` SHA-256 qiymati saqlandi.
- Asl arxivdagi 24 696 ta `node_modules` fayli yakuniy paketga kiritildi.

Production server sozlamalari va qabul testlari uchun
`docs/CODEX-SERVER-HANDOFF.md` fayliga qarang.

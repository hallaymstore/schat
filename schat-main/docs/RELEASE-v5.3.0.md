# HALLAYM EDU v5.3.0

## Yangi imkoniyatlar

- Registratsiya va har keyingi login uchun bitta-yuz hamda jonlilik tekshiruvi.
- Xom kamera rasmi saqlanmaydi; 160 qiymatli yuz shabloni AES-256-GCM bilan
  shifrlanib MongoDB’da saqlanadi.
- Besh xato yuz urinishidan keyin 15 daqiqalik blok, bir martalik challenge va
  eski JWT sessiyalarini yuz tasdig‘isiz rad qilish.
- Admin panelda foydalanuvchi yuz shablonini xavfsiz reset qilish va barcha faol
  sessiyalarini bekor qilish.
- `tutor` roli, fakultet scope’i, dars/guruh boshqaruv huquqlari va alohida
  mobilga mos `tutor-dashboard.html`.
- Admin, rektor va prorektor panellari saqlangan; login yo‘naltirishlari tyutor
  rolini ham qamrab oladi.
- Guruh chatlari, a’zolar paneli, dars banneri va yuz tasdiq modalida oq-ko‘k
  kunduzgi hamda kontrastli tungi ranglar.
- CSS/JS cache versiyasi `v=5.3.0`; eski brauzer keshi tufayli ranglarning
  aralashib qolishi kamaytirildi.

## Muhim deployment qadamlari

1. Production `.env` ichida `FACE_TEMPLATE_SECRET` ni JWT kalitidan alohida,
   `openssl rand -base64 48` bilan yarating.
2. Saytni HTTPS orqali oching; aks holda kamera ruxsati ishlamaydi.
3. Server ko‘chirilgach `npm ci`, `npm test`, so‘ng `npm start` bajaring.
4. Yangi va eski akkaunt, mos yuz, boshqa yuz, admin `Yuz reset` va tyutor
   fakultet scope’ini qabul testidan o‘tkazing.

`FACE_TEMPLATE_SECRET` yo‘qolsa yoki almashtirilsa avvalgi shablonlar ochilmaydi;
admin reset orqali foydalanuvchilar yuzini qayta ro‘yxatdan o‘tkazish kerak.

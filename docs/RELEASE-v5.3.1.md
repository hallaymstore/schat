# HALLAYM EDU v5.3.1 login hotfix

- MongoDB Atlas `500/500 collections` limitida yuz challenge’i yangi collection
  yaratishga uringani sabab `/api/login` qaytargan HTTP 500 tuzatildi.
- Login/enroll/verify challenge’i endi atomik tarzda mavjud `users.faceAuth`
  maydonlarida saqlanadi; yangi MongoDB collection yaratilmaydi.
- Registratsiyadagi besh daqiqalik bir martalik nonce server xotirasida saqlanadi;
  unda parol, kamera rasmi yoki biometrik shablon bo‘lmaydi.
- Atlas dastlabki ulanishi uzilsa, login va registratsiya so‘rovi bitta boshqarilgan
  qayta ulanishni bajaradi va muvaffaqiyatsizlikda tushunarli HTTP 503 qaytaradi.
- Brauzer eski face-auth faylini keshlamasligi uchun global asset versiyasi
  `v=5.3.1` ga yangilandi.
- Yakuniy ZIP tashqi `schat-main` qobig‘isiz tarqatiladi: fayllarni
  `C:\Users\hp\Desktop\schat-main` ichiga chiqargach shu papkada `npm start` ishlaydi.

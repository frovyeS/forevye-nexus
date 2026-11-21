-- Önce normal kayıt olun, sonra e-postanızı yazarak çalıştırın:
-- wrangler d1 execute forevye-nexus --remote --file=scripts/make-superadmin.sql
-- (E-postayı aşağıda değiştirin.) İlk yönetici yalnızca veritabanından atanır; uygulamadan atanamaz.
UPDATE users SET role = 'superadmin' WHERE email = 'ornek@example.com';

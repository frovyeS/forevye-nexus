import { HttpError } from './util.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export function normEmail(v) {
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_email', 'Geçerli bir e-posta girin.');
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !EMAIL.test(e)) throw new HttpError(400, 'invalid_email', 'Geçerli bir e-posta girin.');
  return e;
}

const RESERVED = new Set(['admin', 'administrator', 'root', 'system', 'support', 'destek', 'nexus', 'forevye', 'forevyenexus', 'moderator', 'mod', 'staff', 'null', 'undefined', 'bank', 'banka']);
export function validateUsername(v) {
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_username', 'Kullanıcı adı geçersiz.');
  const u = v.trim();
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(u)) throw new HttpError(400, 'invalid_username', 'Kullanıcı adı 3-20 karakter olmalı; harf, rakam, _ ve . içerebilir.');
  if (/^[._]|[._]$|\.\.|__/.test(u)) throw new HttpError(400, 'invalid_username', 'Kullanıcı adı . veya _ ile başlayıp bitemez, ardışık kullanılamaz.');
  if (RESERVED.has(u.toLowerCase())) throw new HttpError(400, 'reserved_username', 'Bu kullanıcı adı ayrılmış.');
  return u;
}

const COMMON = new Set(['password123', '1234567890', 'qwertyuiop', 'password1234', 'iloveyou123', '12345678910']);
export function validatePassword(pw, { email = '', username = '' } = {}) {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 128) throw new HttpError(400, 'weak_password', 'Şifre 10-128 karakter olmalı.');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'weak_password', 'Şifre en az bir harf ve bir rakam içermeli.');
  const low = pw.toLowerCase();
  if (COMMON.has(low) || (email && low === email) || (username && low.includes(username.toLowerCase()) && username.length >= 4))
    throw new HttpError(400, 'weak_password', 'Bu şifre çok tahmin edilebilir.');
  return pw;
}

-- Kristal artık dış altın fiyatına bağlı değildir. Eski altın bazlı snapshot/cache temizlenir.
-- Kullanıcı cüzdanları, işlem defteri ve Kristal miktarları korunur.
DELETE FROM market_prices;
DELETE FROM market_state WHERE key IN ('gold_base_usd', 'last_price');

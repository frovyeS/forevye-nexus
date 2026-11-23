-- Make every existing skin-bearing SKU limited, then seed the expanded catalogue via 0007 on fresh installs.
UPDATE shop_products SET stock_total = 80 WHERE id = 'card_platinum' AND stock_total IS NULL;
UPDATE shop_products SET stock_total = 120 WHERE id = 'card_titan' AND stock_total IS NULL;
UPDATE shop_products SET stock_total = 160 WHERE id = 'skin_nebula' AND stock_total IS NULL;
UPDATE shop_products SET stock_total = 180 WHERE id = 'skin_aurora' AND stock_total IS NULL;
UPDATE shop_products SET stock_total = 220 WHERE id = 'skin_carbon' AND stock_total IS NULL;
UPDATE shop_products SET stock_total = 250 WHERE id = 'skin_onyx' AND stock_total IS NULL;

-- Tab 7 (feature/social-share, social products phase 1): a merchant's
-- hashtags on a product — up to eight, stored bare and lower case
-- (src/lib/storefront/share.ts is the one rule). Shown on the product page,
-- carried in every share, and the key of the per-shop tag page
-- /store/<slug>/tag/<tag>. Additive only: a new column with an empty
-- default; no existing row changes meaning.

ALTER TABLE "products" ADD COLUMN "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

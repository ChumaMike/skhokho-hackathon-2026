-- Tab 7 (feature/social-share, social products phase 1): how many times a
-- product was shared. Counted server side when the share sheet or the copy
-- completes — a number on the product, never who shared it. The daily
-- counter event lets Page analytics show shares over a window beside views
-- and taps. Additive only.

ALTER TABLE "products" ADD COLUMN "share_count" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "StorefrontEventType" ADD VALUE 'PRODUCT_SHARE';

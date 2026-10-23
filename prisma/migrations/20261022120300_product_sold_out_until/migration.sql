-- Tab 5: "sold out today" as a merchant control distinct from Hide (additive).
--
-- A product stays listed but can't be ordered until sold_out_until (the end
-- of the trading day in SAST, set from the catalogue), after which it is
-- simply available again. NULL = available. Product.sort_order already
-- existed; the catalogue now exposes it as move up / move down.

ALTER TABLE "products" ADD COLUMN "sold_out_until" TIMESTAMP(3);

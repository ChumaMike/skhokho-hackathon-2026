-- Food Menu Domain Foundation (Phase 4). Additive/backward-compatible:
-- product_categories gains one nullable column; every new table starts
-- empty and has zero effect on any existing Product/Order/OrderItem until
-- an owner explicitly attaches a category or option group to something.

ALTER TABLE "public"."product_categories" ADD COLUMN "description" TEXT;

CREATE TYPE "public"."MenuOptionSelectionType" AS ENUM ('SINGLE', 'MULTIPLE');

CREATE TABLE "public"."menu_option_groups" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "selection_type" "public"."MenuOptionSelectionType" NOT NULL DEFAULT 'SINGLE',
    "min_selections" INTEGER NOT NULL DEFAULT 0,
    "max_selections" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_option_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."menu_options" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."product_option_groups" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."order_item_options" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "group_id" TEXT,
    "option_id" TEXT,
    "group_name_snapshot" TEXT NOT NULL,
    "option_name_snapshot" TEXT NOT NULL,
    "price_delta_snapshot" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "menu_option_groups_business_id_idx" ON "public"."menu_option_groups"("business_id");
CREATE INDEX "menu_option_groups_business_id_is_active_idx" ON "public"."menu_option_groups"("business_id", "is_active");

CREATE INDEX "menu_options_group_id_idx" ON "public"."menu_options"("group_id");
CREATE INDEX "menu_options_business_id_idx" ON "public"."menu_options"("business_id");

CREATE UNIQUE INDEX "product_option_groups_product_id_group_id_key" ON "public"."product_option_groups"("product_id", "group_id");
CREATE INDEX "product_option_groups_business_id_idx" ON "public"."product_option_groups"("business_id");
CREATE INDEX "product_option_groups_product_id_idx" ON "public"."product_option_groups"("product_id");

CREATE INDEX "order_item_options_order_item_id_idx" ON "public"."order_item_options"("order_item_id");

ALTER TABLE "public"."menu_option_groups" ADD CONSTRAINT "menu_option_groups_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."menu_options" ADD CONSTRAINT "menu_options_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."menu_options" ADD CONSTRAINT "menu_options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."menu_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."product_option_groups" ADD CONSTRAINT "product_option_groups_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."product_option_groups" ADD CONSTRAINT "product_option_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."product_option_groups" ADD CONSTRAINT "product_option_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."menu_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."order_item_options" ADD CONSTRAINT "order_item_options_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."order_item_options" ADD CONSTRAINT "order_item_options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."menu_option_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."order_item_options" ADD CONSTRAINT "order_item_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."menu_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

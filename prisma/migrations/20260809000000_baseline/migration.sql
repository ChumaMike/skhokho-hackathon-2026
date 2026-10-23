-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AppRole" AS ENUM ('OWNER', 'AGENT', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "public"."BusinessCategory" AS ENUM ('SALON', 'FOOD_VENDOR', 'CAR_WASH', 'RETAIL_STORE', 'TUCK_SHOP', 'MECHANIC', 'HAIR_BRAIDER', 'NAIL_TECHNICIAN', 'EVENTS', 'CHILDCARE', 'LAUNDRY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."BusinessStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "public"."EnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'QUOTED', 'WON', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'READY', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('CASH', 'CARD', 'EFT', 'SNAPSCAN', 'OZOW', 'ZAPPER', 'CAPITEC_PAY', 'LOYALTY_POINTS', 'CREDIT');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."StaffRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF', 'CASHIER', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "public"."StockMovementType" AS ENUM ('PURCHASE', 'SALE', 'ADJUSTMENT', 'RETURN', 'WASTE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "public"."SubscriptionPlan" AS ENUM ('FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateTable
CREATE TABLE "public"."app_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "public"."AppRole" NOT NULL,
    "department" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "must_set_password" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."appointments" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID,
    "staff_id" TEXT,
    "service_id" TEXT,
    "status" "public"."AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "price" DECIMAL(10,2),
    "reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "reminder_sent_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "business_id" UUID,
    "action" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."business_metrics" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "metric_key" TEXT NOT NULL,
    "value" DECIMAL(15,4) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."business_notifications" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."business_roles" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."business_staff" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "role_id" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "reset_token" TEXT,
    "reset_token_expiry" TIMESTAMP(3),
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "avatar_url" TEXT,
    "staff_role" "public"."StaffRole" NOT NULL DEFAULT 'STAFF',
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."business_staff_sessions" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "device_info" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."business_subscriptions" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "plan" "public"."SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_staff" INTEGER NOT NULL DEFAULT 2,
    "max_products" INTEGER NOT NULL DEFAULT 50,
    "max_services" INTEGER NOT NULL DEFAULT 10,
    "has_analytics" BOOLEAN NOT NULL DEFAULT false,
    "has_custom_domain" BOOLEAN NOT NULL DEFAULT false,
    "has_appointments" BOOLEAN NOT NULL DEFAULT true,
    "has_inventory" BOOLEAN NOT NULL DEFAULT true,
    "has_loyalty" BOOLEAN NOT NULL DEFAULT false,
    "has_api_access" BOOLEAN NOT NULL DEFAULT false,
    "billing_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."businesses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "preview_token" TEXT,
    "config" JSONB,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "category" "public"."BusinessCategory" NOT NULL DEFAULT 'OTHER',
    "status" "public"."BusinessStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "address" TEXT,
    "suburb" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'ZA',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "logo_url" TEXT,
    "banner_url" TEXT,
    "primary_color" TEXT DEFAULT '#2563EB',
    "accent_color" TEXT DEFAULT '#F59E0B',
    "settings" JSONB,
    "custom_domain" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "operating_hours" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."consents" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customer_id" UUID NOT NULL,
    "business_id" UUID,
    "purpose" TEXT NOT NULL,
    "channel" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_identifiers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customer_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "display_name" TEXT,
    "language" TEXT,
    "merged_into" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_items" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "min_quantity" INTEGER NOT NULL DEFAULT 0,
    "max_quantity" INTEGER,
    "unit" TEXT,
    "location" TEXT,
    "last_restocked_at" TIMESTAMP(3),
    "last_count_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."memberships" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customer_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "short_code" TEXT NOT NULL,
    "display_name" TEXT,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "service_id" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."orders" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID,
    "staff_id" TEXT,
    "order_number" TEXT NOT NULL,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount_code" TEXT,
    "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "payment_method" "public"."PaymentMethod",
    "payment_status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "payment_ref" TEXT,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."platform_enquiries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "business_name" TEXT,
    "interest" TEXT NOT NULL,
    "message" TEXT,
    "status" "public"."EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'showcase',
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_categories" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "image_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."products" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "category_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "images" TEXT[],
    "sku" TEXT,
    "barcode" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "cost_price" DECIMAL(10,2),
    "compare_at_price" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "track_stock" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."services" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "duration" INTEGER,
    "buffer_time" INTEGER DEFAULT 0,
    "max_bookings" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_movements" (
    "id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "staff_id" TEXT,
    "type" "public"."StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "previous_qty" INTEGER NOT NULL,
    "new_qty" INTEGER NOT NULL,
    "unit_cost" DECIMAL(10,2),
    "note" TEXT,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."visits" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "membership_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_key" ON "public"."app_users"("email" ASC);

-- CreateIndex
CREATE INDEX "app_users_role_idx" ON "public"."app_users"("role" ASC);

-- CreateIndex
CREATE INDEX "appointments_business_id_idx" ON "public"."appointments"("business_id" ASC);

-- CreateIndex
CREATE INDEX "appointments_business_id_start_time_idx" ON "public"."appointments"("business_id" ASC, "start_time" ASC);

-- CreateIndex
CREATE INDEX "appointments_membership_id_idx" ON "public"."appointments"("membership_id" ASC);

-- CreateIndex
CREATE INDEX "appointments_staff_id_start_time_idx" ON "public"."appointments"("staff_id" ASC, "start_time" ASC);

-- CreateIndex
CREATE INDEX "audit_log_business_id_created_at_idx" ON "public"."audit_log"("business_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "business_metrics_business_id_date_idx" ON "public"."business_metrics"("business_id" ASC, "date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "business_metrics_business_id_date_metric_key_key" ON "public"."business_metrics"("business_id" ASC, "date" ASC, "metric_key" ASC);

-- CreateIndex
CREATE INDEX "business_notifications_business_id_created_at_idx" ON "public"."business_notifications"("business_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "business_notifications_business_id_is_read_idx" ON "public"."business_notifications"("business_id" ASC, "is_read" ASC);

-- CreateIndex
CREATE INDEX "business_roles_business_id_idx" ON "public"."business_roles"("business_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "business_roles_business_id_name_key" ON "public"."business_roles"("business_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "business_staff_business_id_email_key" ON "public"."business_staff"("business_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "business_staff_business_id_idx" ON "public"."business_staff"("business_id" ASC);

-- CreateIndex
CREATE INDEX "business_staff_sessions_staff_id_idx" ON "public"."business_staff_sessions"("staff_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "business_staff_sessions_token_key" ON "public"."business_staff_sessions"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "business_subscriptions_business_id_key" ON "public"."business_subscriptions"("business_id" ASC);

-- CreateIndex
CREATE INDEX "businesses_auth_user_id_idx" ON "public"."businesses"("auth_user_id" ASC);

-- CreateIndex
CREATE INDEX "businesses_category_idx" ON "public"."businesses"("category" ASC);

-- CreateIndex
CREATE INDEX "businesses_city_idx" ON "public"."businesses"("city" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_custom_domain_key" ON "public"."businesses"("custom_domain" ASC);

-- CreateIndex
CREATE INDEX "businesses_slug_idx" ON "public"."businesses"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_slug_key" ON "public"."businesses"("slug" ASC);

-- CreateIndex
CREATE INDEX "businesses_status_idx" ON "public"."businesses"("status" ASC);

-- CreateIndex
CREATE INDEX "consents_customer_id_purpose_idx" ON "public"."consents"("customer_id" ASC, "purpose" ASC);

-- CreateIndex
CREATE INDEX "customer_identifiers_customer_id_idx" ON "public"."customer_identifiers"("customer_id" ASC);

-- CreateIndex
CREATE INDEX "customer_identifiers_type_value_idx" ON "public"."customer_identifiers"("type" ASC, "value" ASC);

-- CreateIndex
CREATE INDEX "inventory_items_business_id_idx" ON "public"."inventory_items"("business_id" ASC);

-- CreateIndex
CREATE INDEX "inventory_items_business_id_quantity_idx" ON "public"."inventory_items"("business_id" ASC, "quantity" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_product_id_key" ON "public"."inventory_items"("product_id" ASC);

-- CreateIndex
CREATE INDEX "memberships_business_id_idx" ON "public"."memberships"("business_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "memberships_business_id_short_code_key" ON "public"."memberships"("business_id" ASC, "short_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "memberships_customer_id_business_id_key" ON "public"."memberships"("customer_id" ASC, "business_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "memberships_public_id_key" ON "public"."memberships"("public_id" ASC);

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "public"."order_items"("order_id" ASC);

-- CreateIndex
CREATE INDEX "orders_business_id_created_at_idx" ON "public"."orders"("business_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "orders_business_id_idx" ON "public"."orders"("business_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "orders_business_id_order_number_key" ON "public"."orders"("business_id" ASC, "order_number" ASC);

-- CreateIndex
CREATE INDEX "orders_business_id_payment_status_idx" ON "public"."orders"("business_id" ASC, "payment_status" ASC);

-- CreateIndex
CREATE INDEX "orders_business_id_status_idx" ON "public"."orders"("business_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "orders_membership_id_idx" ON "public"."orders"("membership_id" ASC);

-- CreateIndex
CREATE INDEX "platform_enquiries_business_id_idx" ON "public"."platform_enquiries"("business_id" ASC);

-- CreateIndex
CREATE INDEX "platform_enquiries_status_created_at_idx" ON "public"."platform_enquiries"("status" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "product_categories_business_id_idx" ON "public"."product_categories"("business_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_business_id_name_key" ON "public"."product_categories"("business_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "public"."product_variants"("product_id" ASC);

-- CreateIndex
CREATE INDEX "products_business_id_category_id_idx" ON "public"."products"("business_id" ASC, "category_id" ASC);

-- CreateIndex
CREATE INDEX "products_business_id_idx" ON "public"."products"("business_id" ASC);

-- CreateIndex
CREATE INDEX "products_business_id_is_active_idx" ON "public"."products"("business_id" ASC, "is_active" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "products_business_id_sku_key" ON "public"."products"("business_id" ASC, "sku" ASC);

-- CreateIndex
CREATE INDEX "services_business_id_idx" ON "public"."services"("business_id" ASC);

-- CreateIndex
CREATE INDEX "services_business_id_is_active_idx" ON "public"."services"("business_id" ASC, "is_active" ASC);

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "public"."stock_movements"("created_at" ASC);

-- CreateIndex
CREATE INDEX "stock_movements_inventory_item_id_idx" ON "public"."stock_movements"("inventory_item_id" ASC);

-- CreateIndex
CREATE INDEX "visits_business_id_created_at_idx" ON "public"."visits"("business_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "visits_membership_id_kind_idx" ON "public"."visits"("membership_id" ASC, "kind" ASC);

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."business_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."business_metrics" ADD CONSTRAINT "business_metrics_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."business_notifications" ADD CONSTRAINT "business_notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."business_roles" ADD CONSTRAINT "business_roles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."business_staff" ADD CONSTRAINT "business_staff_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."business_staff" ADD CONSTRAINT "business_staff_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."business_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."business_staff_sessions" ADD CONSTRAINT "business_staff_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."business_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."business_subscriptions" ADD CONSTRAINT "business_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."businesses" ADD CONSTRAINT "businesses_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "public"."app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consents" ADD CONSTRAINT "consents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consents" ADD CONSTRAINT "consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_identifiers" ADD CONSTRAINT "customer_identifiers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customers" ADD CONSTRAINT "customers_merged_into_fkey" FOREIGN KEY ("merged_into") REFERENCES "public"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_items" ADD CONSTRAINT "inventory_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_items" ADD CONSTRAINT "inventory_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_items" ADD CONSTRAINT "order_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."business_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_categories" ADD CONSTRAINT "product_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."business_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."visits" ADD CONSTRAINT "visits_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."visits" ADD CONSTRAINT "visits_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


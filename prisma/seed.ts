/**
 * Prisma Seed — Skhokho Platform (Neon)
 *
 * Creates a working demo on a fresh database:
 *  1. A platform ADMIN login (AppUser, role ADMIN)
 *  2. A demo business ("Beauty by Nomsa") — ACTIVE, with subscription, roles,
 *     an owner (AppUser role OWNER + BusinessStaff), services and products.
 *
 * NO live production data is copied. Run: pnpm db:seed
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const OWNER_PERMS = {
  canManageStaff: true, canManageInventory: true, canManageOrders: true,
  canViewAnalytics: true, canManageCustomers: true, canManageServices: true,
  canProcessPayments: true, canManageSettings: true,
}
const STAFF_PERMS = {
  canManageStaff: false, canManageInventory: false, canManageOrders: true,
  canViewAnalytics: false, canManageCustomers: true, canManageServices: false,
  canProcessPayments: true, canManageSettings: false,
}

async function main() {
  // Demo data with a well-known admin password: local development only.
  // A production or preview database must never receive it (docs/platform-admin.md:
  // the first real admin is made with scripts/admin-bootstrap.ts create-admin).
  if (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data into a production/preview environment.')
  }
  if (process.env.SEED_DEMO_DATA !== 'yes') {
    throw new Error('Set SEED_DEMO_DATA=yes to seed demo data (local development only).')
  }
  console.log('🌱 Seeding Skhokho Platform...')

  // 1. Platform admin -------------------------------------------------------
  const admin = await prisma.appUser.upsert({
    where: { email: 'admin@skhokho.app' },
    update: {},
    create: {
      email: 'admin@skhokho.app',
      passwordHash: await bcrypt.hash('Admin@Skhokho2026!', 12),
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    },
  })
  console.log(`✅ Admin: ${admin.email}`)

  // 2. Demo business --------------------------------------------------------
  const existing = await prisma.business.findUnique({ where: { slug: 'beauty-by-nomsa' } })
  if (existing) {
    console.log('⏭️  Demo business already exists, skipping')
  } else {
    const ownerUser = await prisma.appUser.upsert({
      where: { email: 'nomsa@beautybynomsa.co.za' },
      update: {},
      create: {
        email: 'nomsa@beautybynomsa.co.za',
        passwordHash: await bcrypt.hash('Owner@Salon2026!', 12),
        role: 'OWNER',
        emailVerifiedAt: new Date(),
      },
    })

    const business = await prisma.business.create({
      data: {
        ownerUserId: ownerUser.id,
        active: true,
        name: 'Beauty by Nomsa',
        slug: 'beauty-by-nomsa',
        category: 'SALON',
        status: 'ACTIVE',
        email: 'nomsa@beautybynomsa.co.za',
        phone: '011 123 4567',
        whatsapp: '+27711234567',
        address: '12 Khumalo Street',
        suburb: 'Soweto',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '1818',
        description: 'Your go-to salon in Soweto for braids, relaxers, and nail care.',
        primaryColor: '#8B5CF6',
        accentColor: '#F59E0B',
        config: { loyalty_stamps_required: 10 },
        operatingHours: {
          monday: { open: '08:00', close: '18:00', closed: false },
          saturday: { open: '09:00', close: '17:00', closed: false },
          sunday: { open: '00:00', close: '00:00', closed: true },
        },
      },
    })

    await prisma.businessSubscription.create({
      data: {
        businessId: business.id,
        plan: 'STARTER',
        hasAnalytics: true,
        maxStaff: 5,
        maxProducts: 200,
        maxServices: 25,
      },
    })

    const ownerRole = await prisma.businessRole.create({
      data: { businessId: business.id, name: 'Owner', isDefault: false, permissions: OWNER_PERMS },
    })
    await prisma.businessRole.create({
      data: { businessId: business.id, name: 'Stylist', isDefault: true, permissions: STAFF_PERMS },
    })

    await prisma.businessStaff.create({
      data: {
        businessId: business.id,
        roleId: ownerRole.id,
        email: 'nomsa@beautybynomsa.co.za',
        passwordHash: await bcrypt.hash('Owner@Salon2026!', 12),
        firstName: 'Nomsa',
        lastName: 'Dlamini',
        phone: '+27711234567',
        staffRole: 'OWNER',
        isOwner: true,
      },
    })

    // Marks onboarding as already done for this demo account — without this,
    // InterviewGate (src/app/dashboard/onboarding/InterviewGate.tsx) finds no
    // BusinessProfile row at all and shouldOpenInterview(null) returns true,
    // so the "What do people actually buy from you?" dialog auto-opens over
    // the dashboard on every single fresh seed. That's correct behaviour for
    // a genuinely new signup, but wrong for a demo business whose whole point
    // is to already look like a real, running salon (it already has real
    // services/products/staff seeded above) — and it broke the visual-smoke
    // dashboard-home screenshot, which expects the dashboard with no modal.
    await prisma.businessProfile.create({
      data: {
        businessId: business.id,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    })

    await prisma.service.createMany({
      data: [
        { businessId: business.id, name: 'Box Braids', price: 350, duration: 180 },
        { businessId: business.id, name: 'Relaxer + Blow-dry', price: 180, duration: 90 },
        { businessId: business.id, name: 'Manicure', price: 80, duration: 45 },
        { businessId: business.id, name: 'Pedicure', price: 100, duration: 60 },
        { businessId: business.id, name: 'Weave Install', price: 450, duration: 120 },
      ],
    })

    const hair = await prisma.productCategory.create({
      data: { businessId: business.id, name: 'Hair Products', slug: 'hair-products' },
    })
    const nails = await prisma.productCategory.create({
      data: { businessId: business.id, name: 'Nail Products', slug: 'nail-products' },
    })
    await prisma.product.createMany({
      data: [
        { businessId: business.id, categoryId: hair.id, name: 'Dark & Lovely Relaxer Kit', price: 89.99, costPrice: 45, sku: 'DL-REL-001' },
        { businessId: business.id, categoryId: hair.id, name: 'ORS Olive Oil Sheen Spray', price: 49.99, costPrice: 25, sku: 'ORS-SS-001' },
        { businessId: business.id, categoryId: nails.id, name: 'OPI Nail Polish — Red', price: 79.99, costPrice: 38, sku: 'OPI-RED-001' },
      ],
    })

    console.log(`✅ Demo business: ${business.slug}`)
    console.log(`   Owner login: nomsa@beautybynomsa.co.za / Owner@Salon2026!`)
  }

  console.log('\n🚀 Seed complete!')
  console.log('─────────────────────────────────────────')
  console.log('Admin login: admin@skhokho.app / Admin@Skhokho2026!')
  console.log('Demo tenant: beauty-by-nomsa (subdomain resolves via PLATFORM_DOMAIN)')
  console.log('─────────────────────────────────────────')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

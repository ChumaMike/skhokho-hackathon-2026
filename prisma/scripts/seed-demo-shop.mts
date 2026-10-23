/**
 * Creates one published demo shop for walking the storefront and ordering
 * flow end to end: an owner, a catalogue, delivery switched on, and a driver
 * who can actually log in.
 *
 * Online card payment is deliberately switched OFF on this business, so the
 * checkout exercises the pay-in-person path (pay on collection / pay the
 * driver) rather than handing off to a gateway. That is the state Skhokho is
 * actually in while the payment provider is down.
 *
 * Idempotent: re-running updates the same rows rather than creating a second
 * shop. Safe to run repeatedly against a dev database.
 *
 *   node --env-file-if-exists=.env.local --import tsx prisma/scripts/seed-demo-shop.mts
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { setDeliverySettings, setPaymentSettings } from '../../src/modules/tenant/capabilities'
import { inviteStaff, completeStaffSetPassword } from '../../src/modules/staff/staff.service'

const prisma = new PrismaClient()

const SLUG = 'kasi-eats-demo'
const OWNER_EMAIL = 'owner@kasi-eats-demo.local'
const DRIVER_EMAIL = 'driver@kasi-eats-demo.local'
const PASSWORD = 'Demo@Skhokho2026!'

const MENU: { name: string; description: string; price: number }[] = [
  { name: 'Kota Special', description: 'Quarter loaf, chips, polony, cheese and atchar.', price: 65 },
  { name: 'Loaded chips', description: 'Chips with cheese sauce and Russian.', price: 45 },
  { name: 'Grilled chicken & pap', description: 'Half chicken, pap and chakalaka.', price: 89 },
  { name: 'Wings (6)', description: 'Grilled or fried, mild or hot.', price: 75 },
  { name: 'Cold drink 500ml', description: 'Assorted.', price: 20 },
]

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12)

  const owner = await prisma.appUser.upsert({
    where: { email: OWNER_EMAIL },
    update: { passwordHash, isActive: true },
    create: {
      email: OWNER_EMAIL,
      passwordHash,
      role: 'OWNER',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  })

  const business = await prisma.business.upsert({
    where: { slug: SLUG },
    update: { status: 'ACTIVE', active: true, ownerUserId: owner.id },
    create: {
      name: 'Kasi Eats (Demo)',
      slug: SLUG,
      description: 'Good food, good people and an independent local kitchen.',
      category: 'FOOD_VENDOR',
      status: 'ACTIVE',
      active: true,
      ownerUserId: owner.id,
      email: OWNER_EMAIL,
      phone: '+27 82 000 0000',
      suburb: 'Soweto',
      city: 'Johannesburg',
      province: 'Gauteng',
    },
  })

  // Delivery on, so the pay-the-driver path is reachable. Fee in cents.
  await setDeliverySettings(business.id, {
    enabled: true,
    feeCents: 1500,
    areaInfo: 'We deliver around Soweto, up to 8km.',
  })

  // The point of the demo: no card handoff, settle in person.
  await setPaymentSettings(business.id, { online: false })

  for (const item of MENU) {
    const existing = await prisma.product.findFirst({
      where: { businessId: business.id, name: item.name },
      select: { id: true },
    })
    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: { price: item.price, description: item.description, isActive: true },
      })
    } else {
      await prisma.product.create({
        data: {
          businessId: business.id,
          name: item.name,
          description: item.description,
          price: item.price,
          isActive: true,
        },
      })
    }
  }

  // Driver goes through the real invite + set-password path rather than a
  // hand-written row, so the permissions and workspace it ends up with are
  // exactly what a real invite produces.
  let driverNote = 'already existed — password reset'
  const existingDriver = await prisma.businessStaff.findUnique({
    where: { businessId_email: { businessId: business.id, email: DRIVER_EMAIL } },
    select: { id: true },
  })
  if (existingDriver) {
    await prisma.businessStaff.update({
      where: { id: existingDriver.id },
      data: { passwordHash, isActive: true, resetToken: null, resetTokenExpiry: null },
    })
  } else {
    const { token } = await inviteStaff(business.id, {
      email: DRIVER_EMAIL,
      firstName: 'Sipho',
      lastName: 'Dlamini',
      preset: 'DRIVER',
    })
    await completeStaffSetPassword(token, PASSWORD)
    driverNote = 'invited via the real invite flow'
  }

  console.log(`
Demo shop ready.

  Storefront    /store/${SLUG}
  Owner login   /login            ${OWNER_EMAIL}
  Driver login  /staff-login      ${DRIVER_EMAIL}  (${driverNote})
  Password      ${PASSWORD}

  Delivery      on, R 15.00 fee
  Card payment  OFF - checkout uses pay on collection / pay the driver
  Menu          ${MENU.length} items
`)
}

main()
  .catch((e) => {
    console.error('seed-demo-shop failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

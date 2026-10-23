import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_HASHTAGS, buildShareMessage, hashtagLine, normaliseHashtag, parseHashtags, productSharePath, productsWithTag, shareImagePath, shareImageVersion, tagPagePath, uniqueHashtags } from './share'

test('a hashtag is stored bare, lower case, letters digits and underscores only', () => {
  assert.equal(normaliseHashtag('#Kota Special!'), 'kotaspecial')
  assert.equal(normaliseHashtag('  SOWETO_braai '), 'soweto_braai')
  assert.equal(normaliseHashtag('ikota🔥'), 'ikota')
  assert.equal(normaliseHashtag('#'), null)
  assert.equal(normaliseHashtag('___'), null, 'must start with a letter or digit')
  assert.equal(normaliseHashtag('a'.repeat(40))?.length, 30)
  assert.equal(normaliseHashtag('isiXhosa'), 'isixhosa')
  assert.equal(normaliseHashtag('ükota'), 'ükota', 'letters in any script stay')
})

test('what the merchant typed becomes a short, de-duplicated list in their order', () => {
  assert.deepEqual(parseHashtags('#kota, #soweto braai #Kota'), ['kota', 'soweto', 'braai'])
  assert.deepEqual(parseHashtags(['kota', '#kota', 'chips & gravy']), ['kota', 'chips', 'gravy'], 'a space ends a tag, as it does on Instagram')
  assert.deepEqual(parseHashtags(''), [])
  const many = parseHashtags(Array.from({ length: 12 }, (_, i) => `tag${i}`))
  assert.equal(many.length, MAX_HASHTAGS)
  assert.equal(many[0], 'tag0')
  assert.equal(many[MAX_HASHTAGS - 1], `tag${MAX_HASHTAGS - 1}`)
})

test('the share says name, price as R 1 234.56, shop, hashtags, then the link', () => {
  const message = buildShareMessage({
    name: 'Kasi Kota',
    price: '1234.5',
    businessName: 'Kota-Tainment',
    hashtags: ['kota', 'soweto'],
    url: 'https://kota-tainment.co.za/product/prod_1',
  })
  assert.equal(message.title, 'Kasi Kota · Kota-Tainment')
  assert.equal(message.text, 'Kasi Kota · R 1 234.50 · Kota-Tainment\n#kota #soweto')
  assert.equal(message.url, 'https://kota-tainment.co.za/product/prod_1')
  assert.equal(message.full, 'Kasi Kota · R 1 234.50 · Kota-Tainment\n#kota #soweto\nhttps://kota-tainment.co.za/product/prod_1')
})

test('no hashtags means no empty line; the link is always last', () => {
  const message = buildShareMessage({ name: ' Russian & chips ', price: 45, businessName: 'Mam Dee', url: 'https://x.test/product/p' })
  assert.equal(message.text, 'Russian & chips · R 45.00 · Mam Dee')
  assert.equal(message.full.split('\n').at(-1), 'https://x.test/product/p')
})

test('a tag page matches by the stored rule and is a 404 when nothing carries the tag', () => {
  const products = [
    { id: 'a', hashtags: ['kota', 'soweto'] },
    { id: 'b', hashtags: ['kota'] },
    { id: 'c', hashtags: [] },
    { id: 'd' },
  ]
  assert.deepEqual(productsWithTag(products, '#Kota')?.products.map((p) => p.id), ['a', 'b'])
  assert.equal(productsWithTag(products, 'KOTA')?.tag, 'kota')
  assert.deepEqual(productsWithTag(products, 'soweto')?.products.map((p) => p.id), ['a'])
  assert.equal(productsWithTag(products, 'braai'), null)
  assert.equal(productsWithTag(products, '#'), null)
  assert.deepEqual(uniqueHashtags(products), ['kota', 'soweto'])
})

test('the share card address carries a version that moves only when the card would look different', () => {
  const base = { name: 'Kasi Kota', price: '45', imageUrl: 'https://blob.test/kota.jpg', businessName: 'Kota-Tainment', logoUrl: null }
  const v = shareImageVersion(base)
  assert.match(v, /^[a-z0-9]{1,7}$/)
  assert.equal(shareImageVersion({ ...base }), v, 'stable for the same inputs')
  assert.notEqual(shareImageVersion({ ...base, price: '50' }), v)
  assert.notEqual(shareImageVersion({ ...base, imageUrl: null }), v)
  assert.notEqual(shareImageVersion({ ...base, logoUrl: 'https://blob.test/logo.png' }), v)
  assert.equal(shareImagePath('prod_1', v), `/product/prod_1/share-image?v=${v}`)
})

test('paths: the product page and the tag page, relative to the storefront root', () => {
  assert.equal(productSharePath('prod_1'), '/product/prod_1')
  assert.equal(tagPagePath('kota'), '/tag/kota')
  assert.equal(tagPagePath('ükota'), '/tag/%C3%BCkota')
  assert.equal(hashtagLine([]), '')
})

import test from "node:test";
import assert from "node:assert/strict";
import { canonicalStorefrontUrl, canonicalStorefrontHost, storefrontRootHost, legacyStorefrontPath } from "./storefront-url";
import { buildStorefrontMetadata, buildLocalBusinessJsonLd } from "./storefront-seo";

const original = { STOREFRONT_DOMAIN: process.env.STOREFRONT_DOMAIN, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL };

function withEnv(env: { STOREFRONT_DOMAIN?: string; NEXT_PUBLIC_APP_URL?: string }, fn: () => void) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const APP = "https://skhokho.sgdataint.co.za";

test("legacy route: canonical stays /store/<slug> while STOREFRONT_DOMAIN is unset (today's behaviour)", () => {
  withEnv({ STOREFRONT_DOMAIN: undefined, NEXT_PUBLIC_APP_URL: APP }, () => {
    assert.equal(canonicalStorefrontHost("kota-tainment"), null);
    assert.equal(canonicalStorefrontUrl("kota-tainment"), `${APP}/store/kota-tainment`);
    assert.equal(canonicalStorefrontUrl("kota-tainment", "/about"), `${APP}/store/kota-tainment/about`);
  });
});

test("canonical route: <slug>.<storefront domain> once STOREFRONT_DOMAIN is set", () => {
  withEnv({ STOREFRONT_DOMAIN: "skhokholabs.app", NEXT_PUBLIC_APP_URL: APP }, () => {
    assert.equal(canonicalStorefrontUrl("kota-tainment"), "https://kota-tainment.skhokholabs.app");
    assert.equal(canonicalStorefrontUrl("kota-tainment", "/about"), "https://kota-tainment.skhokholabs.app/about");
  });
});

test("STOREFRONT_DOMAIN is normalized (case, trailing dot) and a dev port is kept for URLs only", () => {
  withEnv({ STOREFRONT_DOMAIN: "SkhokhoLabs.App." }, () => {
    assert.equal(storefrontRootHost(), "skhokholabs.app");
  });
  withEnv({ STOREFRONT_DOMAIN: "localhost:3002" }, () => {
    assert.equal(storefrontRootHost(), "localhost");
    assert.equal(canonicalStorefrontUrl("kota"), "http://kota.localhost:3002");
  });
});

test("a trailing slash on NEXT_PUBLIC_APP_URL never doubles up", () => {
  withEnv({ STOREFRONT_DOMAIN: undefined, NEXT_PUBLIC_APP_URL: `${APP}/` }, () => {
    assert.equal(canonicalStorefrontUrl("kota"), `${APP}/store/kota`);
  });
});

test("legacyStorefrontPath is the /store/<slug> compatibility route", () => {
  assert.equal(legacyStorefrontPath("kota-tainment"), "/store/kota-tainment");
});

const SEO_BUSINESS = {
  name: "Kota Tainment",
  slug: "kota-tainment",
  description: null,
  category: "FOOD_VENDOR" as const,
  bannerUrl: null,
  logoUrl: null,
  suburb: "Soweto",
  city: "Johannesburg",
};

test("storefront metadata carries ONE canonical URL however the page was reached", () => {
  withEnv({ STOREFRONT_DOMAIN: "skhokholabs.app", NEXT_PUBLIC_APP_URL: APP }, () => {
    const home = buildStorefrontMetadata(SEO_BUSINESS, "HOME");
    assert.equal(home.alternates?.canonical, "https://kota-tainment.skhokholabs.app");
    assert.equal((home.openGraph as { url?: string }).url, "https://kota-tainment.skhokholabs.app");
    assert.equal(buildStorefrontMetadata(SEO_BUSINESS, "CONTACT").alternates?.canonical, "https://kota-tainment.skhokholabs.app/contact");
  });
  withEnv({ STOREFRONT_DOMAIN: undefined, NEXT_PUBLIC_APP_URL: APP }, () => {
    assert.equal(buildStorefrontMetadata(SEO_BUSINESS, "HOME").alternates?.canonical, `${APP}/store/kota-tainment`);
  });
});

test("LocalBusiness JSON-LD url is the canonical storefront address", () => {
  withEnv({ STOREFRONT_DOMAIN: "skhokholabs.app" }, () => {
    const json = buildLocalBusinessJsonLd({ ...SEO_BUSINESS, phone: null, address: null, province: null, postalCode: null });
    assert.equal(json.url, "https://kota-tainment.skhokholabs.app");
  });
});

import { getOffer, upsertOffer } from "../src/lib/repo";
import { whop, whopAccountId, type WhopEnv } from "../src/lib/whop";

// Creates a Whop checkout link for each offer and stores it in the offers table.
// Existing offers are kept; --force creates fresh links and replaces them.
// Usage, from the repo root: npm run script -- scripts/whop-offers.ts <sandbox|live> [--force]

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the process environment.
}

const OFFERS = [
  {
    sku: "pilot",
    title: "Second Instance Pilot",
    priceUsd: 29,
    description:
      "We connect your support agent (API or MCP tool), load your refund policy and limits, " +
      "and include 2 independent human reviews of AI refund decisions.",
  },
  {
    sku: "review_pack",
    title: "Human Review Pack",
    priceUsd: 15,
    description:
      "One more independent human review of an AI refund decision, with a second reviewer included when needed.",
  },
];

async function createLink(env: WhopEnv, offer: (typeof OFFERS)[number], productId?: string) {
  return whop(env).checkoutConfigurations.create({
    account_id: whopAccountId(env),
    plan: {
      title: offer.title,
      description: offer.description,
      initial_price: offer.priceUsd,
      currency: "usd",
      plan_type: "one_time",
      metadata: { sku: offer.sku },
      ...(productId ? { product_id: productId } : {}),
    },
    // Copied onto the payment, which is how a sale is matched back to its offer.
    metadata: { sku: offer.sku },
    redirect_url: `${process.env.APP_BASE_URL?.replace(/\/+$/, "")}/thanks?sku=${offer.sku}`,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const env = args.find((a) => a === "live" || a === "sandbox") as WhopEnv | undefined;
  const force = args.includes("--force");
  if (!env) throw new Error("Usage: npm run script -- scripts/whop-offers.ts <sandbox|live> [--force]");
  if (!process.env.APP_BASE_URL) throw new Error("APP_BASE_URL is not set");

  let productId: string | undefined;
  for (const offer of OFFERS) {
    const existing = await getOffer(offer.sku, env);
    if (existing && !force) {
      console.log(`[${env}] ${offer.sku}: kept ${existing.purchase_url}`);
      continue;
    }

    let link;
    try {
      link = await createLink(env, offer, productId);
    } catch (err) {
      // Some accounts need inline variants to belong to a product: create one and retry once.
      if (productId || !/product/i.test(String(err))) throw err;
      const product = await whop(env).products.create({
        account_id: whopAccountId(env),
        title: "Second Instance",
        description: "Independent human review of AI refund decisions.",
      });
      productId = product.id;
      console.log(`[${env}] created product ${productId}`);
      link = await createLink(env, offer, productId);
    }
    if (!link.purchase_url) throw new Error(`checkout ${link.id} has no purchase_url`);

    await upsertOffer({
      sku: offer.sku,
      env,
      checkout_config_id: link.id,
      purchase_url: link.purchase_url,
      price_cents: offer.priceUsd * 100,
    });
    console.log(`[${env}] ${offer.sku} ($${offer.priceUsd}): ${link.purchase_url}`);
  }
}

main().catch((err) => {
  console.error("whop-offers failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

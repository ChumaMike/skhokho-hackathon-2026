/** Customer-facing wording for a refused cart quote. Codes come from resolveStorefrontCartQuote. */
export function quoteErrorMessage(code: string, minOrderAmount?: string): string {
  switch (code) {
    case "HOURS_CLOSED":
      return "This business is closed right now.";
    case "ORDERS_PAUSED":
      return "This business has paused new orders for a little while. Please try again soon.";
    case "COLLECTION_UNAVAILABLE":
      return "This business doesn't offer collection.";
    case "DELIVERY_UNAVAILABLE":
      return "This business doesn't offer delivery.";
    case "OUTSIDE_SERVICE_AREA":
      return "Sorry — this business doesn't deliver to that area.";
    case "BELOW_MINIMUM_ORDER":
      return minOrderAmount
        ? `Your basket is below this business's ${minOrderAmount} minimum order.`
        : "Your basket is below the minimum order for this delivery area.";
    case "DELIVERY_PRICING_UNAVAILABLE":
      return "Delivery pricing isn't available right now — please contact the business.";
    case "DELIVERY_DISTANCE_UNAVAILABLE":
      return "We couldn't find that address. Check it and try again.";
    case "CART_EMPTY":
      return "Your basket is empty or no longer available.";
    default:
      return "This business is not currently accepting orders.";
  }
}

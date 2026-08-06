export const onRequest = async (context) => {
  const url = new URL(context.request.url);

  // Only intercept visitors hitting the absolute root domain
  if (url.pathname === "/") {
    const acceptLanguage = context.request.headers.get("accept-language") || "";
    
    // If Japanese is explicitly the first preferred language in the browser
    if (acceptLanguage.toLowerCase().startsWith("ja")) {
      return Response.redirect(`${url.origin}/ja/introduction/`, 302);
    }
    
    // Otherwise fallback to English
    return Response.redirect(`${url.origin}/en/introduction/`, 302);
  }

  // For all other routes, let Cloudflare serve the static Astro HTML files normally
  return context.next();
};

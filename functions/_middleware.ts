export async function onRequest(context: {request: Request; next: () => Promise<Response>}) {
  const url = new URL(context.request.url);
  if (url.hostname === 'cloudmini-notepad.pages.dev' || url.hostname.endsWith('.cloudmini-notepad.pages.dev')) {
    return Response.redirect(`https://notepad.cloudmini.net${url.pathname}${url.search}`, 308);
  }
  const response = await context.next();
  const pathname = url.pathname;
  if (pathname === '/' || pathname.startsWith('/assets/') ||
      ['/favicon.svg', '/robots.txt', '/sitemap.xml'].includes(pathname)) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

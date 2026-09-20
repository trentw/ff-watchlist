// Sends www.ffwatchlist.com to the bare domain, so a saved lineup always
// lives under one origin.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = "ffwatchlist.com";
    return Response.redirect(url.toString(), 301);
  },
};

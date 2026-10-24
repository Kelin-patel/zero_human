import { connection } from "next/server";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Course unavailable | Example Academy (fictional)</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#18181b}
.note{background:#fef3c7;color:#78350f;padding:.5rem .75rem;border-radius:.375rem;font-size:.875rem}</style>
</head>
<body>
<p class="note">Prepared demo: Example Academy is a fictional store used to demonstrate refund reviews.</p>
<h1>404: course content not found</h1>
<p>The lessons for this course could not be loaded. This is a problem on the store's side.</p>
</body>
</html>`;

// The fictional store's broken course page. It must answer with a real 404 status so access
// checks record the same failure a customer would see.
export async function GET() {
  await connection();
  return new Response(html, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

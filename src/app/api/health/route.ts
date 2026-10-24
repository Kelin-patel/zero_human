import { connection } from "next/server";

export async function GET() {
  // Always answer at request time; never serve a prerendered timestamp.
  await connection();
  return Response.json({ ok: true, time: new Date().toISOString() });
}

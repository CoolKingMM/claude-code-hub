export function GET(): Response {
  return Response.json({ error: "This management feature has been retired." }, { status: 410 });
}

export const POST = GET;

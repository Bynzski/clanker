/** Upgrade legacy JSON/text fetch fixtures to real, consumable Response bodies. */
export async function responseFromFixture(fixture: {
  status: number; ok: boolean; text?: () => Promise<string>; json?: () => Promise<unknown>;
}): Promise<Response> {
  const body = fixture.ok
    ? (fixture.text ? await fixture.text() : JSON.stringify(await fixture.json?.()))
    : null;
  return new Response(body, { status: fixture.status });
}

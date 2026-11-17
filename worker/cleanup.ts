const DAY = 86_400_000;
const INACTIVE_DAYS = 21;

export default {
  async scheduled(_: unknown, env: { DB: { prepare(sql: string): any } }) {
    const now = Date.now();
    const inactiveBefore = now - INACTIVE_DAYS * DAY;
    await env.DB.prepare(
      `DELETE FROM notes WHERE id IN (
        SELECT id FROM notes
        WHERE expires_at <= ? OR (updated_at <= ? AND last_viewed_at <= ?)
        ORDER BY CASE WHEN expires_at <= ? THEN expires_at ELSE MAX(updated_at, last_viewed_at) END
        LIMIT 1000
      )`
    ).bind(now, inactiveBefore, inactiveBefore, now).run();
  }
};

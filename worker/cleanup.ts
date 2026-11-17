export default {
  async scheduled(_: unknown, env: { DB: { prepare(sql: string): any } }) {
    await env.DB.prepare(
      'DELETE FROM notes WHERE id IN (SELECT id FROM notes WHERE expires_at <= ? ORDER BY expires_at LIMIT 1000)'
    ).bind(Date.now()).run();
  }
};

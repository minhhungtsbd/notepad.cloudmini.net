import { createRemoteJWKSet, jwtVerify } from 'jose';

const DAY = 86_400_000;
const INACTIVE_DAYS = 21;
const encoder = new TextEncoder();
const random = () => crypto.randomUUID().replaceAll('-', '');
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), x => x.toString(16).padStart(2, '0')).join('');
const hash = async (value: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const fail = (status: number, message: string): never => { throw new ApiError(status, message); };
class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Env = { DB: any; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };
type Note = {
  id: string; slug: string; title: string; content: string; edit_hash: string;
  password_hash: string | null; version: number; views: number; updated_at: number; last_viewed_at: number; expires_at: number;
};
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const summary = ({id, slug, title, content, version, views, updated_at, expires_at, password_hash}: Note) =>
  ({ id, slug, title, content, version, views, updated_at, expires_at, locked: Boolean(password_hash) });

async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100_000 }, key, 256
  ));
}

async function signature(note: Note, expiry: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(note.password_hash!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(note.id + ':' + expiry)));
}

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function readBody(request: Request) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') fail(415, 'Yêu cầu JSON.');
  const reader = request.body?.getReader();
  if (!reader) return fail(400, 'Thiếu dữ liệu.');
  let length = 0;
  let data = '';
  const decoder = new TextDecoder();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 800_000) {
      await reader.cancel();
      fail(413, 'Ghi chú quá lớn.');
    }
    data += decoder.decode(value, {stream: true});
  }
  try {
    const result = JSON.parse(data + decoder.decode());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { return fail(400, 'JSON không hợp lệ.'); }
}

function field(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || value.length > max) return fail(400, name + ' không hợp lệ.');
  return value;
}

function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(400, 'Thiếu phiên bản ghi chú.');
  return Number(value);
}

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
async function admin(request: Request, env: Env) {
  const issuer = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!issuer || !env.ACCESS_AUD || !token) return fail(403, 'Cần đăng nhập quản trị.');
  try {
    if (!jwks.has(issuer)) jwks.set(issuer, createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer)));
    await jwtVerify(token, jwks.get(issuer)!, {issuer, audience: env.ACCESS_AUD, algorithms: ['RS256']});
  } catch { fail(403, 'Phiên quản trị không hợp lệ.'); }
}

export async function onRequest({request, env}: {request: Request; env: Env}) {
  try {
    if (!env.DB) return fail(503, 'Chưa cấu hình cơ sở dữ liệu.');
    const url = new URL(request.url);
    const method = request.method;
    if (!['GET', 'HEAD'].includes(method) && request.headers.get('Origin') &&
        request.headers.get('Origin') !== url.origin) fail(403, 'Nguồn yêu cầu không hợp lệ.');
    const [, , group, slug, action, extra] = url.pathname.split('/');
    if (extra) fail(404, 'Không tìm thấy.');
    const db = env.DB;
    const now = Date.now();

    if (group === 'admin') {
      await admin(request, env);
      const inactiveBefore = now - INACTIVE_DAYS * DAY;
      if (slug === 'stats' && !action && method === 'GET') {
        const stats = await db.prepare(`SELECT COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END), 0) AS expired,
          COALESCE(SUM(CASE WHEN expires_at > ? AND updated_at <= ? AND last_viewed_at <= ? THEN 1 ELSE 0 END), 0) AS inactive,
          COALESCE(SUM(views), 0) AS views FROM notes`)
          .bind(now, now, inactiveBefore, inactiveBefore).first();
        return json({...stats, inactiveDays: INACTIVE_DAYS});
      }
      if (slug === 'cleanup' && !action && method === 'POST') {
        const result = await db.prepare(`DELETE FROM notes WHERE id IN (
          SELECT id FROM notes WHERE expires_at <= ? OR (updated_at <= ? AND last_viewed_at <= ?)
          ORDER BY CASE WHEN expires_at <= ? THEN expires_at ELSE MAX(updated_at, last_viewed_at) END LIMIT 1000
        )`).bind(now, inactiveBefore, inactiveBefore, now).run();
        return json({deleted: result.meta.changes});
      }
      if (slug !== 'notes') return fail(404, 'Không tìm thấy.');
      if (!action && method === 'GET') {
        const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
        const filter = url.searchParams.get('filter') || 'all';
        if (!['all', 'inactive', 'expired'].includes(filter)) return fail(400, 'Bộ lọc không hợp lệ.');
        const where = filter === 'inactive' ? 'WHERE expires_at > ? AND updated_at <= ? AND last_viewed_at <= ?'
          : filter === 'expired' ? 'WHERE expires_at <= ?' : '';
        const values = filter === 'inactive' ? [now, inactiveBefore, inactiveBefore]
          : filter === 'expired' ? [now] : [];
        const {results} = await db.prepare(`SELECT id, slug, title, updated_at, last_viewed_at, expires_at, views
          FROM notes ${where} ORDER BY updated_at DESC, id LIMIT 21 OFFSET ?`)
          .bind(...values, (page - 1) * 20).all();
        return json({ notes: results.slice(0, 20), more: results.length > 20 });
      }
      if (action && method === 'PATCH') {
        const {expires_at} = await readBody(request);
        if (!Number.isSafeInteger(expires_at) || expires_at <= 0 || expires_at > 8.64e15) return fail(400, 'Ngày hết hạn không hợp lệ.');
        const result = await db.prepare('UPDATE notes SET expires_at = ?, last_viewed_at = ?, version = version + 1 WHERE id = ?')
          .bind(expires_at, now, action).run();
        if (!result.meta.changes) return fail(404, 'Không tìm thấy ghi chú.');
        return json({ok:true});
      }
      if (action && method === 'DELETE') {
        await db.prepare('DELETE FROM notes WHERE id = ?').bind(action).run();
        return json({ok:true});
      }
      return fail(405, 'Phương thức không được hỗ trợ.');
    }
    if (group !== 'notes') return fail(404, 'Không tìm thấy.');

    if (!slug && method === 'POST') {
      const body = await readBody(request);
      const title = field(body.title, 160, 'Tiêu đề');
      const content = field(body.content, 100_000, 'Nội dung');
      if (!title.trim() && !content.trim()) return fail(400, 'Ghi chú đang trống.');
      const id = random();
      const editKey = random() + random();
      await db.prepare('INSERT INTO notes (id, slug, title, content, edit_hash, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, id, title, content, await hash(editKey), now, now + 30 * DAY).run();
      return json({ id, slug:id, title, content, editKey, version:1, views:0, updated_at:now, expires_at:now + 30 * DAY, locked:false, editable:true }, 201);
    }
    if (!slug || !/^[A-Za-z0-9_-]{1,80}$/.test(slug)) return fail(404, 'Không tìm thấy ghi chú.');
    const note: Note | null = await db.prepare('SELECT notes.* FROM note_aliases JOIN notes ON notes.id = note_aliases.note_id WHERE note_aliases.slug = ? AND notes.expires_at > ?')
      .bind(slug, now).first();
    if (!note) return fail(404, 'Ghi chú không tồn tại hoặc đã hết hạn.');

    const editKey = request.headers.get('X-Edit-Key') || '';
    const editable = /^[a-f0-9]{64}$/.test(editKey) && equal(await hash(editKey), note.edit_hash);
    if (action === 'unlock' && method === 'POST') {
      const {password} = await readBody(request);
      if (!note.password_hash) return json({ok:true});
      const [salt, expected] = note.password_hash.split(':');
      if (!equal(await derive(field(password, 128, 'Mật khẩu'), salt), expected)) return fail(403, 'Sai mật khẩu.');
      const expiry = now + DAY;
      return json({ unlock: expiry + '.' + await signature(note, expiry) });
    }

    if (method === 'GET' && (!action || action === 'raw')) {
      if (note.password_hash && !editable) {
        const [time, mac] = (request.headers.get('X-Note-Unlock') || '').split('.');
        const expiry = Number(time);
        if (!mac || !Number.isSafeInteger(expiry) || expiry <= now || !equal(mac, await signature(note, expiry))) {
          return fail(401, 'Ghi chú cần mật khẩu.');
        }
      }
      if (action === 'raw') return new Response(note.content, {headers: {...headers, 'Content-Type': 'text/plain; charset=utf-8'}});
      if (url.searchParams.get('view') === '1') {
        await db.prepare('UPDATE notes SET views = views + ?, last_viewed_at = ? WHERE id = ? AND expires_at > ?')
          .bind(editable ? 0 : 1, now, note.id, now).run();
        if (!editable) note.views++;
      }
      return json({...summary(note), editable});
    }

    if ((!action && ['PATCH', 'DELETE'].includes(method)) || (action === 'settings' && method === 'PATCH')) {
      if (!editable) return fail(403, 'Cần link chỉnh sửa.');
      if (method === 'DELETE') {
        await db.prepare('DELETE FROM notes WHERE id = ?').bind(note.id).run();
        return json({ok:true});
      }
      const body = await readBody(request);
      const expected = version(body.version);
      if (expected !== note.version) return fail(409, 'Ghi chú đã thay đổi ở nơi khác.');
      if (!action) {
        const title = field(body.title, 160, 'Tiêu đề');
        const content = field(body.content, 100_000, 'Nội dung');
        const result = await db.prepare('UPDATE notes SET title = ?, content = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND expires_at > ? RETURNING *')
          .bind(title, content, now, note.id, expected, now).first();
        if (!result) return fail(409, 'Ghi chú đã thay đổi ở nơi khác.');
        return json({...summary(result), editable});
      }
      const newSlug = field(body.slug, 80, 'Đường dẫn');
      if (newSlug !== note.slug && (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(newSlug) ||
        ['api','admin','assets','view_raw','view_code','view_markdown'].includes(newSlug))) return fail(400, 'URL cần 3–80 ký tự: chữ thường, số, dấu gạch ngang hoặc gạch dưới.');
      let passwordHash = note.password_hash;
      if (body.password !== undefined) {
        const password = field(body.password, 128, 'Mật khẩu');
        if (password && password.length < 8) return fail(400, 'Mật khẩu cần ít nhất 8 ký tự.');
        const salt = random();
        passwordHash = password ? salt + ':' + await derive(password, salt) : null;
      }
      let result;
      try {
        result = await db.prepare('UPDATE notes SET slug = ?, password_hash = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND expires_at > ? RETURNING *')
          .bind(newSlug, passwordHash, now, note.id, expected, now).first();
      } catch (error) {
        if (String(error).includes('slug already in use') || String(error).includes('UNIQUE constraint failed')) return fail(409, 'URL đã được sử dụng.');
        throw error;
      }
      if (!result) return fail(409, 'Ghi chú đã thay đổi ở nơi khác.');
      return json({...summary(result), editable});
    }
    return fail(405, 'Phương thức không được hỗ trợ.');
  } catch (error) {
    if (error instanceof ApiError) return json({error:error.message}, error.status);
    console.error('Notepad request failed', error instanceof Error ? error.name : 'UnknownError');
    return json({error:'Máy chủ gặp lỗi. Vui lòng thử lại.'}, 500);
  }
}

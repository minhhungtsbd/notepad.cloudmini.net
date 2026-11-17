import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import Markdown from 'react-markdown';
import gfm from 'remark-gfm';
import {common, createLowlight} from 'lowlight';
import './style.css';

type Draft = {title:string; content:string};
type Note = Draft & {id:string; slug:string; version:number; views:number; updated_at:number; expires_at:number; editable:boolean; locked:boolean; editKey?:string};
type Mode = 'edit' | 'markdown' | 'raw' | 'code';
class ApiError extends Error {
  constructor(readonly status:number, message:string) { super(message); }
}
const empty = {title:'', content:''};
const read = (key:string) => { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } };
function cache(key:string, value:string) { try { sessionStorage.setItem(key, value); } catch {} }
const when = (time:number) => new Date(time).toLocaleString('vi-VN');
const lowlight = createLowlight(common);
const highlight = () => (tree:any) => {
  function visit(node:any) {
    if (node.tagName === 'code') {
      const lang = node.properties?.className?.find((name:string) => name.startsWith('language-'))?.slice(9);
      if (lang && lowlight.registered(lang) && node.children.every((child:any) => child.type === 'text')) {
        node.children = lowlight.highlight(lang, node.children.map((child:any) => child.value).join('')).children;
      }
    }
    node.children?.forEach(visit);
  }
  visit(tree);
};
async function api(path:string, method = 'GET', body?:unknown, key = '', unlock = '') {
  const headers:Record<string,string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['X-Edit-Key'] = key;
  if (unlock) headers['X-Note-Unlock'] = unlock;
  const response = await fetch('/api/' + path, {method, headers, body:body === undefined ? undefined : JSON.stringify(body)});
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw new ApiError(response.status, 'Máy chủ chưa sẵn sàng. Vui lòng thử lại.');
  }
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error || 'Không thể kết nối.');
  return data;
}
const path = location.pathname.split('/').filter(Boolean);
const legacy:Record<string,Mode> = {view_markdown:'markdown', view_code:'code', view_raw:'raw'};
const initialSlug = legacy[path[0]] ? path[1] : path[0];
const link = (slug:string, editKey = '') => location.origin + '/' + slug + (editKey ? '#edit=' + editKey : '');
function rememberedDraft(id:string, version:number, base:Draft) {
  try {
    const saved = JSON.parse(read('draft:' + id));
    return saved && saved.version === version ? saved.draft as Draft : base;
  } catch { return base; }
}
function download(text:string, filename:string) {
  const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const [slug, setSlug] = useState(initialSlug || '');
  const [note, setNote] = useState<Note|null>(null);
  const [draft, setDraft] = useState<Draft>(() => slug ? empty : rememberedDraft('new', 0, empty));
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [loading, setLoading] = useState(Boolean(slug));
  const [locked, setLocked] = useState(false);
  const [missing, setMissing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [mode, setMode] = useState<Mode>(legacy[path[0]] || 'edit');
  const [panel, setPanel] = useState<'share'|'settings'|''>('');
  const [configSlug, setConfigSlug] = useState('');
  const [configPassword, setConfigPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(() => read('theme') === 'dark');
  const key = useRef(new URLSearchParams(location.hash.slice(1)).get('edit') || read('edit:' + slug));
  const pending = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const editable = !slug || Boolean(note?.editable);
  const dirty = editable && (draft.title !== (note?.title || '') || draft.content !== (note?.content || ''));
  const notify = (message:string, error = false) => {setStatus(message); setStatusError(error);};

  function adopt(result:Note) {
    setNote(result);
    setSlug(result.slug);
    if (result.editable && key.current) {
      cache('edit:' + result.slug, key.current);
      if (slug) cache('edit:' + slug, key.current);
    }
    if (!legacy[path[0]] || result.editable) history.replaceState(null, '', '/' + result.slug);
  }
  async function load(unlock = read('unlock:' + slug)) {
    setLoading(true);
    try {
      const result:Note = await api('notes/' + slug + '?view=1', 'GET', undefined, key.current, unlock);
      adopt(result);
      let initial:Draft = result;
      if (result.editable) {
        const saved = read('draft:' + result.id);
        if (saved) {
          try {
            const local = JSON.parse(saved);
            initial = local.draft;
            if (local.version !== result.version && (initial.title !== result.title || initial.content !== result.content)) {
              setConflict(true);
              notify('Có bản nháp khác với bản trên máy chủ. Hãy tải xuống hoặc lưu thành ghi chú mới.', true);
            }
          } catch {}
        }
      }
      setDraft({title:initial.title, content:initial.content});
      setLocked(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setLocked(true);
      else {
        setMissing(true);
        notify((error as Error).message, true);
      }
    } finally {setLoading(false);}
  }
  useEffect(() => { if (slug) void load(); }, []);
  useEffect(() => {document.documentElement.dataset.theme = dark ? 'dark' : 'light'; cache('theme', dark ? 'dark' : 'light');}, [dark]);
  useEffect(() => {
    if (!dirty) return;
    const id = 'draft:' + (note?.id || 'new');
    let base = note?.version || 0;
    if (conflict) {
      try { base = JSON.parse(read(id))?.version ?? base; } catch {}
    }
    cache(id, JSON.stringify({version:base, draft}));
  }, [draft, dirty, note?.version, conflict]);

  async function save(copy = false) {
    if (pending.current || (!copy && (conflict || !dirty))) return;
    if (copy && note?.locked && !confirm('Bản sao sẽ chưa có mật khẩu. Bạn muốn tiếp tục?')) return;
    pending.current = true;
    setBusy(true);
    const creating = copy || !note;
    notify('Đang lưu…');
    try {
      const result:Note = creating
        ? await api('notes', 'POST', draft)
        : await api('notes/' + slug, 'PATCH', {...draft, version:note.version}, key.current);
      if (result.editKey) key.current = result.editKey;
      cache('draft:' + (note?.id || 'new'), '');
      adopt(result);
      setConflict(false);
      notify('Đã lưu');
    } catch (error) {
      if (!creating && error instanceof ApiError && error.status === 409) setConflict(true);
      notify((error as Error).message, true);
    } finally { pending.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!dirty || busy || conflict || !editable || (!note && !draft.title.trim() && !draft.content.trim())) return;
    const timer = statusError ? undefined : setTimeout(() => void save(), 900);
    const retry = () => void save();
    window.addEventListener('online', retry);
    return () => {clearTimeout(timer); window.removeEventListener('online', retry);};
  }, [draft, busy, conflict, dirty, editable, note?.version, statusError]);
  useEffect(() => {
    const handler = (event:KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (editable) void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  useEffect(() => {
    if (!dirty) return;
    const handler = (event:BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  async function unlockNote(event:React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api('notes/' + slug + '/unlock', 'POST', {password});
      cache('unlock:' + slug, result.unlock || '');
      setPassword('');
      notify('');
      await load(result.unlock);
    } catch (error) { notify((error as Error).message, true); }
    finally {setBusy(false);}
  }

  async function updateSettings(event:React.FormEvent) {
    event.preventDefault();
    if (pending.current || !note || dirty || conflict) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await api('notes/' + slug + '/settings', 'PATCH', {
        version:note.version, slug:configSlug, password:removePassword ? '' : configPassword || undefined
      }, key.current);
      adopt(result);
      setPanel('');
      notify('Đã cập nhật cài đặt');
    } catch (error) { notify((error as Error).message, true); }
    finally {pending.current = false; setBusy(false);}
  }

  async function remove() {
    if (pending.current || !confirm('Xóa vĩnh viễn ghi chú này?')) return;
    pending.current = true;
    setBusy(true);
    try {
      await api('notes/' + slug, 'DELETE', undefined, key.current);
      cache('draft:' + note?.id, '');
      cache('edit:' + slug, '');
      location.assign('/');
    } catch (error) { notify((error as Error).message, true); pending.current = false; setBusy(false); }
  }

  function enter(event:React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    const {selectionStart, selectionEnd, value} = event.currentTarget;
    const line = value.slice(0, selectionStart).split('\n').at(-1) || '';
    const match = line.match(/^(\s*)([-*+]|\d+\.) +(\[[ xX]\] +)?(.+)$/);
    if (!match) return;
    event.preventDefault();
    const bullet = /^\d/.test(match[2]) ? Number.parseInt(match[2]) + 1 + '.' : match[2];
    const insert = '\n' + match[1] + bullet + ' ' + (match[3] ? '[ ] ' : '');
    setDraft({...draft, content:(value.slice(0, selectionStart) + insert + value.slice(selectionEnd)).slice(0, 100000)});
    requestAnimationFrame(() => editor.current?.setSelectionRange(selectionStart + insert.length, selectionStart + insert.length));
  }
  async function copy(value:string) {
    try {await navigator.clipboard.writeText(value); notify('Đã sao chép liên kết');}
    catch {notify('Hãy chọn và sao chép liên kết trong ô bên trên.', true);}
  }

  return <><header className="top"><div className="bar"><a className="brand" href="/"><span className="brand-icon" aria-hidden="true">▤</span> Cloudmini <strong>Notepad</strong></a>
    <div className="tools"><button onClick={() => setDark(!dark)} aria-label={dark ? 'Giao diện sáng' : 'Giao diện tối'}>{dark ? '☀' : '☾'}</button><a className="button" href="/">＋ Ghi chú mới</a></div></div></header>
    <main>
    {loading ? <section className="surface standalone">Đang tải ghi chú…</section> : locked ?
      <section className="surface standalone"><h1>Ghi chú có mật khẩu</h1><form onSubmit={unlockNote}>
        <label htmlFor="unlock">Mật khẩu</label><input id="unlock" autoFocus type="password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required />
        <button className="primary" disabled={busy}>Mở ghi chú</button></form><p role="status" className="error">{status}</p></section>
    : missing ? <section className="surface standalone"><h1>Không thể mở ghi chú</h1><p role="status">{status}</p><a href="/">Tạo ghi chú mới</a></section> :
    <section className="surface">
      <div className="note-head"><input className="title" aria-label="Tiêu đề ghi chú" placeholder="Ghi chú chưa có tiêu đề" maxLength={160} value={draft.title} readOnly={!editable} onChange={e => setDraft({...draft,title:e.target.value})}/>
        <div className="tools">{note && <button onClick={() => setPanel(panel === 'share' ? '' : 'share')}>Chia sẻ</button>}
        {editable && <button className="primary" onClick={() => void save()} disabled={!dirty || busy || conflict}>Lưu</button>}</div></div>
      <div className="toolbar">
        <div className="tabs" aria-label="Chế độ hiển thị">{([['edit',editable ? 'Soạn thảo' : 'Văn bản'],['markdown','Markdown'],['raw','Raw'],['code','Code']] as const).map(([id,label]) =>
          <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>
        <div className="tools">
          {editable && <button onClick={() => file.current?.click()}>Mở file</button>}
          <button onClick={() => download(draft.content, (draft.title || 'ghi-chu') + (mode === 'markdown' ? '.md' : '.txt'))}>Tải xuống</button>
          {note?.editable && <button onClick={() => {setConfigSlug(slug); setConfigPassword(''); setRemovePassword(false); setPanel(panel === 'settings' ? '' : 'settings');}}>Cài đặt</button>}
        </div>
      </div>
      <input ref={file} type="file" hidden accept=".txt,.md,text/plain,text/markdown" onChange={async e => {
        const input = e.currentTarget; const selected = input.files?.[0]; input.value = '';
        if (!selected) return;
        if (draft.content && !confirm('Thay nội dung đang soạn bằng nội dung file này?')) return;
        if (selected.size > 400000) {notify('File quá lớn.', true); return;}
        try {
          const content = await selected.text();
          if (content.length > 100000) {notify('File vượt quá 100.000 ký tự.', true); return;}
          setDraft({title:selected.name.replace(/\.[^.]+$/, '').slice(0,160),content}); setMode('edit');
        } catch {notify('Không thể đọc file.', true);}
      }}/>
      {panel === 'share' && <div className="panel"><label>Link xem</label><div className="field-row"><input readOnly value={link(slug)} aria-label="Link xem" /><button onClick={() => copy(link(slug))}>Sao chép</button></div>
        {note?.editable && <><label>Link chỉnh sửa</label><div className="field-row"><input readOnly value={link(slug,key.current)} aria-label="Link chỉnh sửa"/><button onClick={() => copy(link(slug,key.current))}>Sao chép</button></div><small>Bất kỳ ai có link chỉnh sửa đều có thể sửa hoặc xóa ghi chú.</small></>}</div>}
      {panel === 'settings' && <form className="panel" onSubmit={updateSettings}>
        <label htmlFor="slug">Đường dẫn</label><input id="slug" value={configSlug} onChange={e => setConfigSlug(e.target.value)} required maxLength={80}/>
        <label htmlFor="new-password">{note?.locked ? 'Đổi mật khẩu xem' : 'Mật khẩu xem'}</label><input id="new-password" type="password" placeholder="Ít nhất 8 ký tự" disabled={removePassword} minLength={8} maxLength={128} value={configPassword} onChange={e => setConfigPassword(e.target.value)}/>
        {note?.locked && <label className="check"><input type="checkbox" checked={removePassword} onChange={e => setRemovePassword(e.target.checked)}/> Bỏ mật khẩu xem</label>}
        <div className="tools"><button className="primary" disabled={busy || dirty || conflict}>Lưu cài đặt</button><button className="error" type="button" onClick={remove} disabled={busy}>Xóa ghi chú</button></div>
      </form>}
      {conflict && <div className="panel conflict"><span>Ghi chú đã thay đổi ở nơi khác. Bản đang soạn vẫn còn ở đây.</span><button onClick={() => void save(true)} disabled={busy}>Lưu thành ghi chú mới</button></div>}
      {mode === 'edit' ? <textarea ref={editor} className="editor" aria-label="Nội dung ghi chú" placeholder="Bắt đầu viết…" readOnly={!editable} maxLength={100000} value={draft.content}
        onChange={e => setDraft({...draft,content:e.target.value})} onKeyDown={editable ? enter : undefined}/>
      : mode === 'markdown' ? <article className="preview"><Markdown skipHtml remarkPlugins={[gfm]} rehypePlugins={[highlight]} components={{img:({alt}) => <span>{alt}</span>}}>{draft.content}</Markdown></article>
      : mode === 'code' ? <pre className="code">{draft.content.split('\n').map((line,index) => <div key={index}><span aria-hidden="true">{index+1}</span>{line || ' '}</div>)}</pre>
      : <pre className="raw">{draft.content}</pre>}
      <footer><div className="stats"><span>{draft.content.trim() ? draft.content.trim().split(/\s+/u).length : 0} từ</span><span>{Array.from(draft.content).length} ký tự</span>
        {note && <><span>{note.views} lượt xem</span><span>Cập nhật {when(note.updated_at)}</span><span>Hết hạn {when(note.expires_at)}</span></>}</div>
        <span role="status" className={statusError ? 'error' : 'status'}>{status || (note?.editable ? 'Có quyền chỉnh sửa' : note ? 'Chỉ xem' : '')}</span>
      </footer>
    </section>}
    </main>
    <div className="site-footer"><p>Cloudmini đầu tư và duy trì Notepad miễn phí này cho cộng đồng. Khám phá thêm dịch vụ <a href="https://cloudmini.net/price/" target="_blank" rel="noopener noreferrer">VPS</a> và <a href="https://cloudmini.net/proxy/" target="_blank" rel="noopener noreferrer">Proxy</a> của chúng tôi.</p></div></>;
}

function Admin() {
  type Row = Pick<Note, 'id'|'slug'|'title'|'updated_at'|'expires_at'|'views'> & {last_viewed_at:number};
  type Stats = {total:number; expired:number; inactive:number; views:number; inactiveDays:number};
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats|null>(null);
  const [filter, setFilter] = useState<'all'|'inactive'|'expired'>('all');
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(true);
  async function load(selected:number, selectedFilter = filter) {
    setBusy(true);
    try {
      const [result, totals] = await Promise.all([
        api('admin/notes?page=' + selected + '&filter=' + selectedFilter),
        api('admin/stats')
      ]);
      setRows(result.notes); setMore(result.more); setPage(selected); setFilter(selectedFilter); setStats(totals);
    } catch (error) {setStatus((error as Error).message);}
    finally {setBusy(false);}
  }
  useEffect(() => { void load(1); }, []);
  async function change(id:string, method:string, date?:string) {
    setBusy(true);
    try {
      await api('admin/notes/' + id, method, date ? {expires_at:new Date(date).getTime()} : undefined);
      setStatus('Đã cập nhật');
      await load(page);
    } catch (error) {setStatus((error as Error).message); setBusy(false);}
  }
  async function cleanup() {
    if (!confirm('Xóa vĩnh viễn tối đa 1.000 ghi chú hết hạn hoặc không hoạt động?')) return;
    setBusy(true);
    try {
      const result = await api('admin/cleanup', 'POST');
      setStatus(`Đã dọn ${result.deleted} ghi chú.`);
      await load(1);
    } catch (error) {setStatus((error as Error).message); setBusy(false);}
  }
  return <main><section className="surface standalone admin"><a href="/">← Notepad</a><h1>Quản lý ghi chú</h1><p>Ghi chú không có lượt xem hay cập nhật trong 21 ngày được dọn tự động mỗi 30 phút. Ghi chú hết hạn cũng được dọn.</p><p role="status">{status}</p>
    {stats && <div className="admin-cards">
      <div><strong>{stats.total}</strong><span>Tổng ghi chú</span></div>
      <div><strong>{stats.total - stats.expired - stats.inactive}</strong><span>Đang hoạt động</span></div>
      <div><strong>{stats.inactive}</strong><span>Không hoạt động {stats.inactiveDays} ngày</span></div>
      <div><strong>{stats.expired}</strong><span>Đã hết hạn</span></div>
      <div><strong>{stats.views}</strong><span>Tổng lượt xem</span></div>
    </div>}
    <div className="tools admin-controls"><label htmlFor="admin-filter">Hiển thị</label><select id="admin-filter" value={filter} disabled={busy} onChange={e => void load(1, e.target.value as typeof filter)}><option value="all">Tất cả</option><option value="inactive">Không hoạt động</option><option value="expired">Hết hạn</option></select><button disabled={busy} onClick={() => void load(page)}>Làm mới</button><button className="error" disabled={busy || !stats || stats.inactive + stats.expired === 0} onClick={() => void cleanup()}>Dọn ngay</button></div>
    <div className="table"><table><thead><tr><th>Ghi chú</th><th>Lượt xem</th><th>Cập nhật</th><th>Xem gần nhất</th><th>Ngày hết hạn</th><th>Thao tác</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}><td><a href={'/' + row.slug}>{row.title || row.slug}</a></td>
        <td>{row.views}</td><td>{when(row.updated_at)}</td><td>{row.last_viewed_at ? when(row.last_viewed_at) : 'Chưa có'}</td><td>{when(row.expires_at)}</td><td><form className="tools" onSubmit={e => {
          e.preventDefault(); void change(row.id,'PATCH',String(new FormData(e.currentTarget).get('expiry')));
        }}><input aria-label="Ngày hết hạn mới" name="expiry" type="datetime-local" required/><button disabled={busy}>Đổi hạn</button>
          <button type="button" className="error" disabled={busy} onClick={() => {if(confirm('Xóa vĩnh viễn ghi chú này?')) void change(row.id,'DELETE');}}>Xóa</button></form></td></tr>)}
    </tbody></table></div>
    <div className="tools"><button disabled={busy || page === 1} onClick={() => void load(page-1)}>Trước</button><span>Trang {page}</span><button disabled={busy || !more} onClick={() => void load(page+1)}>Sau</button></div>
    </section></main>;
}
createRoot(document.getElementById('root')!).render(path[0] === 'admin' ? <Admin/> : <App/>);

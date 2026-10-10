import { useMemo, useState } from 'react';
import type { AppActions, AppState, Book, LibraryEntry, Shelf } from './types';
import { Avatar, BookCover, Icon, Modal } from './ui';
import './personal.css';

type CommonProps = {
  state: AppState;
  actions: AppActions;
  navigate: (path: string) => void;
  notify: (message: string) => void;
};

const statusLabels: Record<LibraryEntry['status'], string> = {
  want: '読みたい', reading: '読書中', read: '読了', unread: '積読',
};
const statusOptions = Object.entries(statusLabels) as [LibraryEntry['status'], string][];
const findBook = (state: AppState, id: string) => state.books.find(book => book.id === id);
const matchesBook = (book: Book, query: string) => {
  const term = query.trim().toLocaleLowerCase();
  const isbnTerm = term.replace(/[\s-]/g, '');
  return `${book.title} ${book.author} ${book.isbn}`.toLocaleLowerCase().includes(term)
    || (isbnTerm.length > 0 && /^[\dXx\s-]+$/.test(term) && book.isbn.replace(/[\s-]/g, '').toLocaleLowerCase().includes(isbnTerm));
};

export function ProfilePage({ state, actions, navigate, notify, userId, onCompose }: CommonProps & { userId: string; onCompose: (bookId?: string) => void }) {
  const own = userId === state.me.id;
  const user = own ? state.me : state.users.find(person => person.id === userId);
  const [tab, setTab] = useState<'shelves' | 'posts'>('shelves');
  const [editor, setEditor] = useState<'nine' | 'profile' | 'shelf' | null>(null);
  const [nine, setNine] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [editingShelf, setEditingShelf] = useState<Shelf | null>(null);
  const [shelfName, setShelfName] = useState('');
  const [shelfPublic, setShelfPublic] = useState(true);
  const [shelfBooks, setShelfBooks] = useState<string[]>([]);

  if (!user) return <div className="empty-state"><Icon name="user" size={36} /><h2>読書家が見つかりませんでした</h2><button className="button" onClick={() => navigate('/')}>ホームへ戻る</button></div>;

  const shelves = user.shelves.filter(shelf => own || shelf.isPublic);
  const posts = state.posts.filter(post => post.userId === user.id && !post.anonymous);
  const selectedBooks = state.books.filter(book => matchesBook(book, query));
  const following = state.following.includes(user.id);

  function openNine() {
    setNine([...user!.lifeNine]); setNotes({ ...user!.nineNotes }); setQuery(''); setEditor('nine');
  }
  function openShelf(shelf?: Shelf) {
    setEditingShelf(shelf || null); setShelfName(shelf?.name || ''); setShelfPublic(shelf?.isPublic ?? true);
    setShelfBooks([...(shelf?.bookIds || [])]); setQuery(''); setEditor('shelf');
  }
  function moveNine(index: number, offset: number) {
    const next = [...nine]; const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]]; setNine(next);
  }
  function saveShelf() {
    if (!shelfName.trim()) return;
    if (editingShelf) actions.updateShelf({ ...editingShelf, name: shelfName.trim(), isPublic: shelfPublic, bookIds: shelfBooks });
    else {
      const id = actions.addShelf(shelfName.trim(), shelfPublic);
      if (typeof id === 'string') actions.updateShelf({ id, name: shelfName.trim(), isPublic: shelfPublic, bookIds: shelfBooks });
    }
    setEditor(null); notify(editingShelf ? '本棚を更新しました' : '新しい本棚を作りました');
  }

  return <div className="personal-page profile-page">
    <div className="p-page-top"><span className="eyebrow">READER’S PROFILE</span><button className="ghost p-back" onClick={() => navigate('/')}><Icon name="arrow" size={17} /> ホーム</button></div>
    <section className="p-profile-intro">
      <Avatar user={user} size={76} />
      <div className="p-profile-copy"><div className="p-name-line"><h1>{user.name}</h1>{user.demo && <span className="p-demo">デモ読書家</span>}</div><span className="muted p-handle">@{user.handle}</span><p>{user.bio}</p></div>
      <div className="p-profile-actions">{own ? <button className="button secondary p-compact" onClick={() => { setName(user.name); setBio(user.bio); setEditor('profile'); }}><Icon name="edit" size={15} /> プロフィールを編集</button> : <button className={`button ${following ? 'secondary' : ''} p-compact`} onClick={() => { actions.toggleFollow(user.id); notify(following ? 'フォローを解除しました' : `${user.name}さんをフォローしました`); }}><Icon name={following ? 'check' : 'plus'} size={16} />{following ? 'フォロー中' : 'フォローする'}</button>}</div>
    </section>

    <section className="p-nine-section">
      <div className="p-section-heading"><div><span className="eyebrow">THE BOOKS THAT MADE ME</span><h2>人生の<span className="p-nine-number">9</span>冊</h2></div>{own && <button className="ghost p-edit-button" onClick={openNine}><Icon name="edit" size={16} /> 編集</button>}</div>
      <p className="p-section-note">{own ? 'いまのあなたをつくった本。ひとつの空白も、あなたらしく。' : `${user.name}さんの、心に残る本たち。`}</p>
      <div className="p-nine-grid">{Array.from({ length: 9 }, (_, index) => {
        const book = user.lifeNine[index] ? findBook(state, user.lifeNine[index]) : undefined;
        return <div className="p-nine-slot" key={index}>{book ? <><BookCover book={book} className="p-nine-cover" onClick={() => navigate(`/book/${book.id}`)} /><p className="p-nine-title">{book.title}</p>{user.nineNotes[book.id] && <p className="p-nine-note">{user.nineNotes[book.id]}</p>}</> : <>{own ? <button className="p-nine-empty" onClick={openNine} aria-label={`${index + 1}冊目を選ぶ`}><Icon name="plus" size={22} /><span>ここに一冊</span></button> : <div className="p-nine-empty"><span className="p-empty-number">{String(index + 1).padStart(2, '0')}</span></div>}<p className="p-nine-title p-blank-title">まだ、余白</p></>}</div>;
      })}</div>
      {own && !user.lifeNine.length && <button className="button secondary p-nine-start" onClick={openNine}>心に残る一冊を選ぶ <Icon name="arrow" size={16} /></button>}
    </section>

    <div className="p-tabs" role="tablist" aria-label="プロフィールの表示"><button role="tab" aria-selected={tab === 'shelves'} className={tab === 'shelves' ? 'active' : ''} onClick={() => setTab('shelves')}>本棚</button><button role="tab" aria-selected={tab === 'posts'} className={tab === 'posts' ? 'active' : ''} onClick={() => setTab('posts')}>感想・ことば</button></div>

    {tab === 'shelves' ? <div className="p-shelves">
      <div className="p-shelf-title-line"><span className="muted">{own ? '本の並べ方にも、あなたらしさを。' : '本棚をめくって、好きの輪郭を知る。'}</span>{own && <button className="ghost" onClick={() => openShelf()}><Icon name="plus" size={16} /> 本棚をつくる</button>}</div>
      {own && <button className="p-library-link" onClick={() => navigate('/library')}><span><Icon name="book" size={20} /> マイライブラリ</span><span className="muted">読みたい・所有・読了の管理 <Icon name="chevron" size={17} /></span></button>}
      {shelves.length ? shelves.map(shelf => <section className="p-shelf-section" key={shelf.id}><div className="p-section-heading"><div className="p-shelf-name"><h3>{shelf.name}</h3>{own && <span className="p-privacy"><Icon name={shelf.isPublic ? 'eye' : 'lock'} size={13} />{shelf.isPublic ? '公開' : '自分だけ'}</span>}</div>{own && <button className="ghost" onClick={() => openShelf(shelf)} aria-label={`${shelf.name}を編集`}><Icon name="edit" size={16} /></button>}</div><div className="p-shelf-scroll">{shelf.bookIds.map(id => findBook(state, id)).filter((book): book is Book => Boolean(book)).map(book => <div className="p-shelf-book" key={book.id}><BookCover book={book} onClick={() => navigate(`/book/${book.id}`)} /><p>{book.title}</p></div>)}</div>{!shelf.bookIds.length && <div className="p-shelf-empty"><Icon name="book" size={22} /><p>これから出会う本のための、余白。</p>{own && <button className="ghost" onClick={() => openShelf(shelf)}>本を並べる <Icon name="plus" size={15} /></button>}</div>}</section>) : <div className="empty-state"><Icon name="book" size={30} /><p>{own ? '好きな名前で、最初の本棚をつくりましょう。' : '公開されている本棚はまだありません。'}</p>{own && <button className="button secondary" onClick={() => openShelf()}>本棚をつくる</button>}</div>}
    </div> : <div className="p-profile-posts">{posts.length ? posts.map(post => { const book = post.bookId ? findBook(state, post.bookId) : undefined; return <ProfilePost key={post.id} post={post} book={book} navigate={navigate} />; }) : <div className="empty-state"><Icon name="comment" size={30} /><p>ここには、公開アカウントで書いたことばが並びます。</p>{own && <button className="button secondary" onClick={() => onCompose()}>感想を書いてみる</button>}</div>}</div>}

    {editor === 'profile' && <Modal title="プロフィールを編集" onClose={() => setEditor(null)}><form onSubmit={event => { event.preventDefault(); if (!name.trim()) return; actions.updateProfile(name.trim(), bio.trim()); setEditor(null); notify('プロフィールを更新しました'); }}><label className="p-form-label">お名前<input className="field" value={name} onChange={event => setName(event.target.value)} maxLength={30} required autoFocus /></label><label className="p-form-label">自己紹介<textarea className="field p-textarea" value={bio} onChange={event => setBio(event.target.value)} maxLength={300} placeholder="好きな本や、どんな読み方をするか。自由にどうぞ。" /></label><div className="p-modal-actions"><button type="button" className="button secondary" onClick={() => setEditor(null)}>キャンセル</button><button className="button" type="submit">保存する</button></div></form></Modal>}

    {editor === 'nine' && <Modal title="人生の9冊を、あなたらしく" onClose={() => setEditor(null)} wide><p className="p-editor-lead">9冊すべてを埋めなくても大丈夫。いま、大切に思う本から。</p><div className="p-nine-editor-list">{nine.map((id, index) => { const book = findBook(state, id); if (!book) return null; return <div className="p-nine-editor-row" key={id}><span className="p-editor-number">{String(index + 1).padStart(2, '0')}</span><BookCover book={book} className="p-editor-cover" /><div className="p-editor-book-info"><strong>{book.title}</strong><input className="field p-note-field" value={notes[id] || ''} onChange={event => setNotes({ ...notes, [id]: event.target.value })} maxLength={80} placeholder="この本へのひとこと（任意）" /></div><div className="p-reorder"><button className="ghost" disabled={index === 0} onClick={() => moveNine(index, -1)} aria-label={`${book.title}を前に`}>↑</button><button className="ghost" disabled={index === nine.length - 1} onClick={() => moveNine(index, 1)} aria-label={`${book.title}を後ろに`}>↓</button><button className="ghost" onClick={() => setNine(nine.filter(selected => selected !== id))} aria-label={`${book.title}を外す`}><Icon name="close" size={14} /></button></div></div>; })}</div><div className="p-editor-search"><Icon name="search" size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="本のタイトル・著者で探す" aria-label="人生の9冊に追加する本を検索" /><span>{nine.length} / 9</span></div><div className="p-picker-grid">{selectedBooks.map(book => <button className={`p-picker-book ${nine.includes(book.id) ? 'selected' : ''}`} key={book.id} disabled={!nine.includes(book.id) && nine.length >= 9} onClick={() => setNine(nine.includes(book.id) ? nine.filter(id => id !== book.id) : [...nine, book.id])}><BookCover book={book} /><span>{book.title}</span>{nine.includes(book.id) && <span className="p-picker-check"><Icon name="check" size={14} /></span>}</button>)}</div>{!selectedBooks.length && <p className="p-inline-empty">一致する本がありません。マイライブラリから新しい本を登録できます。</p>}<div className="p-modal-actions p-sticky-actions"><button className="button secondary" onClick={() => setEditor(null)}>キャンセル</button><button className="button" onClick={() => { actions.updateNine(nine, notes); setEditor(null); notify('人生の9冊を更新しました'); }}>この本たちを並べる</button></div></Modal>}

    {editor === 'shelf' && <Modal title={editingShelf ? '本棚を編集' : 'あなたの本棚をつくる'} onClose={() => setEditor(null)} wide><label className="p-form-label">本棚の名前<input className="field" value={shelfName} onChange={event => setShelfName(event.target.value)} placeholder="例：雨の日に読み返す本" maxLength={40} autoFocus /></label><div className="p-privacy-choice"><button className={shelfPublic ? 'selected' : ''} onClick={() => setShelfPublic(true)}><Icon name="eye" size={17} /><span>みんなに公開<small>読書家が本棚を訪ねられます</small></span>{shelfPublic && <Icon name="check" size={16} />}</button><button className={!shelfPublic ? 'selected' : ''} onClick={() => setShelfPublic(false)}><Icon name="lock" size={17} /><span>自分だけ<small>あなたにだけ見える本棚です</small></span>{!shelfPublic && <Icon name="check" size={16} />}</button></div><div className="p-editor-search"><Icon name="search" size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="並べたい本を探す" aria-label="本棚に並べる本を検索" /><span>{shelfBooks.length}冊</span></div><div className="p-picker-grid">{selectedBooks.map(book => <button key={book.id} className={`p-picker-book ${shelfBooks.includes(book.id) ? 'selected' : ''}`} onClick={() => setShelfBooks(shelfBooks.includes(book.id) ? shelfBooks.filter(id => id !== book.id) : [...shelfBooks, book.id])}><BookCover book={book} /><span>{book.title}</span>{shelfBooks.includes(book.id) && <span className="p-picker-check"><Icon name="check" size={14} /></span>}</button>)}</div>{!selectedBooks.length && <p className="p-inline-empty">一致する本がありません。</p>}<div className="p-modal-actions p-sticky-actions"><button className="button secondary" onClick={() => setEditor(null)}>キャンセル</button><button className="button" onClick={saveShelf} disabled={!shelfName.trim()}>保存する</button></div></Modal>}
  </div>;
}

function ProfilePost({ post, book, navigate }: { post: AppState['posts'][number]; book?: Book; navigate: (path: string) => void }) {
  const [revealed, setRevealed] = useState(false);
  return <article className="p-past-post"><span className="p-post-date">{new Date(post.createdAt).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })}{post.demo && ' · デモ投稿'}</span>{post.spoiler && !revealed ? <button className="p-spoiler-button" onClick={() => setRevealed(true)}><Icon name="eye" size={18} /><span>ネタバレを含む感想<small>タップして読む</small></span></button> : <p className="p-post-text">{post.text}</p>}{book && <button className="p-post-book" onClick={() => navigate(`/book/${book.id}`)}><Icon name="book" size={15} /><span>{book.title}</span><Icon name="chevron" size={14} /></button>}</article>;
}

export function LibraryPage({ state, actions, navigate, notify }: CommonProps) {
  const [filter, setFilter] = useState('all');
  const [genre, setGenre] = useState('all');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [scanInfo, setScanInfo] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [custom, setCustom] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [newGenre, setNewGenre] = useState('小説');
  const [isbn, setIsbn] = useState('');
  const [status, setStatus] = useState<LibraryEntry['status']>('want');
  const [owned, setOwned] = useState(false);

  const collection = state.library.map(entry => ({ entry, book: findBook(state, entry.bookId) })).filter((item): item is { entry: LibraryEntry; book: Book } => Boolean(item.book));
  const genreStats = useMemo(() => {
    const result: Record<string, number> = {};
    collection.forEach(({ book }) => { result[book.genre] = (result[book.genre] || 0) + 1; });
    return Object.entries(result).sort((a, b) => b[1] - a[1]);
  }, [state.library, state.books]);
  const visible = collection.filter(({ entry, book }) => (filter === 'all' || (filter === 'owned' ? entry.owned : entry.status === filter)) && (genre === 'all' || book.genre === genre) && matchesBook(book, query));
  const grouped = [...new Set(visible.map(item => item.book.genre))].map(label => ({ label, items: visible.filter(item => item.book.genre === label) }));
  const colors = ['#385c49', '#8c9f79', '#b89d78', '#7d99a3', '#c1b494', '#9c8d9e', '#728c7e', '#d5b59e'];
  let cursor = 0;
  const gradient = genreStats.map(([, count], index) => { const start = cursor; cursor += count / (collection.length || 1) * 100; return `${colors[index % colors.length]} ${start}% ${cursor}%`; }).join(', ');
  const candidates = state.books.filter(book => matchesBook(book, addQuery));

  function openAdd() { setAdding(true); setAddQuery(''); setCustom(false); setTitle(''); setAuthor(''); setNewGenre('小説'); setIsbn(''); setStatus('want'); setOwned(false); }
  function addToLibrary(bookId: string) {
    actions.setBookStatus(bookId, status);
    const present = state.library.find(entry => entry.bookId === bookId);
    if (Boolean(present?.owned) !== owned) actions.toggleOwned(bookId);
    setAdding(false); notify(`「${statusLabels[status]}」に本を追加しました`);
  }
  function addCustom() {
    if (!title.trim() || !author.trim()) return;
    const bookId = actions.addBook({ title: title.trim(), author: author.trim(), genre: newGenre.trim() || 'その他', isbn: isbn.trim(), description: 'あなたがマイライブラリに登録した一冊。あらすじはまだありません。', color: '#eee9dc', accent: '#3d5a4b', design: 3 });
    if (!bookId) return;
    actions.setBookStatus(bookId, status);
    // addBook registers the new (or matching existing) title as owned.
    if (!owned) actions.toggleOwned(bookId);
    setAdding(false); notify(`「${statusLabels[status]}」に本を追加しました`);
  }

  return <div className="personal-page library-page"><div className="p-page-top"><span className="eyebrow">MY LIBRARY</span><button className="ghost p-scan" onClick={() => setScanInfo(true)}><Icon name="scan" size={18} /> バーコード</button></div><div className="p-library-heading"><div><h1 className="page-title">わたしの本棚</h1><p className="muted">まだ読んでいない世界も、忘れられない一冊も。</p></div><button className="button p-add-book" onClick={openAdd}><Icon name="plus" size={18} /> 本を登録</button></div>

    <div className="p-library-layout"><main className="p-library-main"><div className="p-library-search"><Icon name="search" size={18} /><input aria-label="ライブラリをタイトル・著者・ISBNで検索" placeholder="タイトル、著者、ISBNで探す" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="ghost" onClick={() => setQuery('')} aria-label="検索をクリア"><Icon name="close" size={15} /></button>}</div><div className="p-filter-row" aria-label="本の状態で絞り込む">{[['all', 'すべて'], ['want', '読みたい'], ['reading', '読書中'], ['read', '読了'], ['unread', '積読'], ['owned', '所有']].map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="p-library-sort"><span className="muted">{visible.length}冊の本</span><label><Icon name="leaf" size={14} /><select aria-label="ジャンルで絞り込む" value={genre} onChange={event => setGenre(event.target.value)}><option value="all">すべてのジャンル</option>{genreStats.map(([label]) => <option key={label} value={label}>{label}</option>)}</select></label></div>
    {grouped.length ? grouped.map(group => <section className="p-genre-section" key={group.label}><h2>{group.label}<span>{group.items.length}</span></h2><div className="p-library-books">{group.items.map(({ book, entry }) => <article className="p-library-book" key={book.id}><BookCover book={book} className="p-library-cover" onClick={() => navigate(`/book/${book.id}`)} /><div className="p-library-book-info"><button className="p-book-title-link" onClick={() => navigate(`/book/${book.id}`)}>{book.title}</button><span className="muted p-book-author">{book.author}</span><div className="p-book-controls"><select className="p-status-select" value={entry.status} aria-label={`${book.title}の読書状態`} onChange={event => { actions.setBookStatus(book.id, event.target.value as LibraryEntry['status']); notify('読書状態を更新しました'); }}>{statusOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><button className={`p-owned-toggle ${entry.owned ? 'active' : ''}`} aria-pressed={entry.owned} onClick={() => actions.toggleOwned(book.id)}><Icon name={entry.owned ? 'check' : 'plus'} size={13} />{entry.owned ? '所有' : '所有にする'}</button></div></div></article>)}</div></section>) : <div className="empty-state p-library-empty"><Icon name="book" size={34} /><h2>{collection.length ? 'この条件の本は、まだありません' : '本棚のはじまりは、一冊から'}</h2><p>{collection.length ? '検索や絞り込みを変えてみてください。' : '気になる本や、大切にしている本を並べてみましょう。'}</p><button className="button secondary" onClick={collection.length ? () => { setQuery(''); setFilter('all'); setGenre('all'); } : openAdd}>{collection.length ? '絞り込みをリセット' : '本を登録する'}</button></div>}</main>

    <aside className="p-library-aside"><section className="p-genre-card"><span className="eyebrow">YOUR READING WORLD</span><h2>本棚にある世界</h2><p className="muted">あなたの興味の、いまのかたち。</p><div className="p-donut" role="img" aria-label={genreStats.length ? `本棚のジャンル構成：${genreStats.map(([label, count]) => `${label} ${count}冊`).join('、')}` : '本が登録されるとジャンル構成を表示します'} style={{ background: gradient ? `conic-gradient(${gradient})` : '#e7e6dd' }}><div><Icon name="leaf" size={23} /><strong>{collection.length}</strong><span>冊の世界</span></div></div><div className="p-genre-legend">{genreStats.map(([label, count], index) => <button key={label} onClick={() => setGenre(genre === label ? 'all' : label)} aria-pressed={genre === label}><span className="p-legend-dot" style={{ backgroundColor: colors[index % colors.length] }} /><span>{label}</span><small>{count}冊</small></button>)}</div>{!genreStats.length && <p className="p-inline-empty">本を登録すると、ジャンルごとの本棚が育ちます。</p>}</section><button className="p-own-profile-link" onClick={() => navigate(`/profile/${state.me.id}`)}><Icon name="grid" size={21} /><span>人生の9冊を並べる<small>あなたの本棚を、名刺に。</small></span><Icon name="chevron" size={17} /></button><p className="p-library-footnote">本は、人と出会うための入り口。<br />この一冊の向こうにも、誰かがいます。</p></aside></div>

    {adding && <Modal title="本棚に、一冊を迎える" onClose={() => setAdding(false)} wide><div className="p-add-mode"><button className={!custom ? 'active' : ''} onClick={() => setCustom(false)}>本を探す</button><button className={custom ? 'active' : ''} onClick={() => { setCustom(true); if (addQuery && !title) setTitle(addQuery); }}>新しい本を登録</button></div><div className="p-register-status"><label>本とのいまの関係<select className="field" value={status} onChange={event => setStatus(event.target.value as LibraryEntry['status'])}>{statusOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="p-checkbox-label"><input type="checkbox" checked={owned} onChange={event => setOwned(event.target.checked)} /> 所有している</label></div>{custom ? <form onSubmit={event => { event.preventDefault(); addCustom(); }}><label className="p-form-label">タイトル<input className="field" value={title} onChange={event => setTitle(event.target.value)} placeholder="本のタイトル" required autoFocus /></label><label className="p-form-label">著者<input className="field" value={author} onChange={event => setAuthor(event.target.value)} placeholder="著者名" required /></label><div className="p-form-two"><label className="p-form-label">ジャンル<input className="field" value={newGenre} onChange={event => setNewGenre(event.target.value)} list="p-genres" /><datalist id="p-genres">{['小説', '詩歌', 'エッセイ', '哲学・思想', '人文', '科学', '絵本', '漫画', 'その他'].map(label => <option key={label} value={label} />)}</datalist></label><label className="p-form-label">ISBN（任意）<input className="field" value={isbn} onChange={event => setIsbn(event.target.value)} inputMode="numeric" placeholder="978…" /></label></div><p className="p-inline-empty">表紙は仮の装丁で表示します。外部の書籍データには接続していません。</p><div className="p-modal-actions"><button className="button secondary" type="button" onClick={() => setAdding(false)}>キャンセル</button><button className="button" type="submit" disabled={!title.trim() || !author.trim()}>本棚に追加する</button></div></form> : <><div className="p-editor-search"><Icon name="search" size={18} /><input value={addQuery} onChange={event => setAddQuery(event.target.value)} placeholder="タイトル・著者・ISBN" aria-label="登録する本を検索" autoFocus /></div><div className="p-add-candidates">{candidates.map(book => <button key={book.id} className="p-add-candidate" onClick={() => addToLibrary(book.id)}><BookCover book={book} className="p-candidate-cover" /><span><strong>{book.title}</strong><small>{book.author}</small>{state.library.some(entry => entry.bookId === book.id) && <em>本棚に登録済み · 状態を更新</em>}</span><Icon name="plus" size={19} /></button>)}</div>{!candidates.length && <div className="empty-state"><p>この本は、まだ見つかりませんでした。</p><button className="button secondary" onClick={() => { setCustom(true); setTitle(addQuery); }}>新しい本として登録する</button></div>}</>}</Modal>}
    {scanInfo && <Modal title="バーコードで、すぐに本棚へ" onClose={() => setScanInfo(false)}><div className="p-scan-info"><Icon name="scan" size={48} /><h3>これからの、本の登録</h3><p>本の裏表紙のバーコードを読み取って、手軽に登録できる機能を予定しています。</p><p className="muted">この試作品では、タイトル・著者・ISBNで検索するか、新しい本を手入力で登録できます。</p><button className="button" onClick={() => { setScanInfo(false); openAdd(); }}>本を探して登録する</button></div></Modal>}
  </div>;
}

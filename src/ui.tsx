import {useEffect,useRef, type ReactNode,type CSSProperties} from 'react';
import type {Book,User} from './types';

const paths:Record<string,ReactNode>={
 home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z"/></>,
 search:<><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></>,
 plus:<path d="M12 5v14M5 12h14"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,
 book:<><path d="M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2z"/><path d="M12 6v15"/></>,
 user:<><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
 arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,back:<path d="M20 12H4m6-6-6 6 6 6"/>,
 heart:<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
 comment:<path d="M21 11.5a9 9 0 0 1-9.5 9H3l1.6-5.1A9 9 0 1 1 21 11.5Z"/>,
 check:<path d="m5 12 4 4L19 6"/>,chevron:<path d="m9 5 7 7-7 7"/>,
 lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></>,
 edit:<><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></>,
 scan:<><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7v10m4-10v10m3-10v10m3-10v10"/></>,
 leaf:<><path d="M20 3c-16-2-20 16-10 18 10 0 10-11 10-18Z"/><path d="M4 21 15 9"/></>,
 more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
 grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
 shuffle:<><path d="M3 6h4l10 12h4m-4-4 4 4-4 4M3 18h4L17 6h4m-4-4 4 4-4 4"/></>,
 eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
 bookmark:<path d="M6 3h12v18l-6-4-6 4z"/>,bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></>,spark:<><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z"/></>,
};
export function Icon({name,size=20}:{name:string;size?:number}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]||paths.book}</svg>}
export function BookCover({book,className='',onClick}:{book:Book;className?:string;onClick?:()=>void}){
 const inner=<><div className="cover-spine"/><span className="cover-edition">YOHAKU LIBRARY</span><span className="cover-art" data-design={book.design%6}><i/><i/><i/></span><span className="cover-title">{book.title}</span><span className="cover-author">{book.author}</span><span className="cover-publisher">余白文庫</span></>;
 const style={background:book.color,color:book.accent,'--cover-accent':book.accent} as CSSProperties;
 return onClick?<button className={`book-cover ${className}`} style={style} onClick={onClick} aria-label={`${book.title}の詳細`}>{inner}</button>:<div className={`book-cover ${className}`} style={style} role="img" aria-label={`${book.title}の仮表紙`}>{inner}</div>;
}
export function Avatar({user,size=40}:{user:User;size?:number}){
 const palette=['#dde5d9','#ebe0cf','#d8e3e3','#e8d9d5','#dedce8']; const n=Array.from(user.id).reduce((s,c)=>s+c.charCodeAt(0),0);
 return <span className="avatar" style={{width:size,height:size,background:palette[n%palette.length],fontSize:size*.35}} aria-label={user.name}>{user.name.slice(0,1)}<i/></span>
}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null; const old=document.body.style.overflow;document.body.style.overflow='hidden';(ref.current?.querySelector<HTMLElement>('textarea,input,select')??ref.current?.querySelector<HTMLElement>('button'))?.focus();const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const all=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]')||[]);const first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};document.addEventListener('keydown',handler);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',handler);previous?.focus()}},[]);
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'wide':''}`}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="閉じる"><Icon name="close"/></button></div>{children}</div></div>
}

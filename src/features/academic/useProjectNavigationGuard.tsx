import {useContext,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {UNSAFE_NavigationContext,useLocation} from 'react-router-dom';
import {Button} from '../../shared/ui';
import {EnrollmentDialog} from './EnrollmentDialog';
export function useProjectNavigationGuard(dirty:boolean,save:()=>Promise<boolean>,discard:()=>void){
  const route=useLocation(),lastUrl=useRef(location.href);
  useLayoutEffect(()=>{lastUrl.current=location.href;},[route]);
  const {navigator}=useContext(UNSAFE_NavigationContext),current=useRef({dirty,save,discard});current.current={dirty,save,discard};
  const [pending,setPending]=useState<(()=>void)|null>(null),[saving,setSaving]=useState(false);
  useEffect(()=>{
    const nav=navigator as any,original={push:nav.push,replace:nav.replace,go:nav.go};
    const block=(work:()=>void)=>{if(!current.current.dirty){work();return;}window.dispatchEvent(new Event('project-navigation-blocked'));setPending(()=>work);};
    for(const key of ['push','replace','go'])nav[key]=(...args:any[])=>block(()=>original[key].apply(nav,args));

    const pop=()=>{if(!current.current.dirty){lastUrl.current=location.href;return;}const next=location.href;history.pushState(history.state,'',lastUrl.current);setPending(()=>()=>{location.href=next;});window.dispatchEvent(new Event('project-navigation-blocked'));};
    const before=(e:BeforeUnloadEvent)=>{if(current.current.dirty){e.preventDefault();e.returnValue='';}};
    const capture=(e:PopStateEvent)=>{if(current.current.dirty){e.stopImmediatePropagation();pop();}else lastUrl.current=location.href;};
    window.addEventListener('popstate',capture,true);window.addEventListener('beforeunload',before);
    return()=>{Object.assign(nav,original);window.removeEventListener('popstate',capture,true);window.removeEventListener('beforeunload',before);};
  },[navigator]);
  const guard=(work:()=>void)=>{if(dirty)setPending(()=>work);else work();};
  const dialog=pending?<EnrollmentDialog title="Thay đổi chưa lưu" close={()=>{if(!saving)setPending(null);}}><p className="text-sm mb-4">Bạn có thay đổi chưa lưu trong danh sách sinh viên.</p><div className="flex flex-wrap gap-2"><Button disabled={saving} onClick={()=>setPending(null)}>Ở lại</Button><Button disabled={saving} onClick={()=>{discard();current.current.dirty=false;const work=pending;setPending(null);work();}}>Bỏ thay đổi</Button><Button variant="primary" disabled={saving} onClick={async()=>{setSaving(true);try{if(await save()){current.current.dirty=false;const work=pending;setPending(null);work();}else setPending(null);}finally{setSaving(false);}}}>Lưu và tiếp tục</Button></div></EnrollmentDialog>:null;
  return {dialog,guard};
}

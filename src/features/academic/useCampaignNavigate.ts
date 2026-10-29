import {useLocation,useNavigate,type NavigateOptions,type To} from 'react-router-dom';
export function useCampaignNavigate() {
  const navigate=useNavigate(),location=useLocation();
  return (to:To|number,options?:NavigateOptions)=>{
    if(typeof to==='string'&&location.pathname.startsWith('/campaigns/')) {
      const tab:Record<string,string>={'/admin':'overview','/admin/settings':'settings','/admin/plan':'plan-editor','/admin/registration-rules':'rules-editor','/admin/lecturer-guide':'guide-editor','/admin/faq':'faq-editor','/plan':'plan','/lecturer-guide':'guide','/faq':'questions'};
      if(tab[to]){const q=new URLSearchParams(location.search);q.set('tab',tab[to]);for(const name of ['enrollmentId','panel','page','status'])q.delete(name);return navigate(`${location.pathname}?${q}`,options);}
    }
    return typeof to==='number'?navigate(to):navigate(to,options);
  };
}

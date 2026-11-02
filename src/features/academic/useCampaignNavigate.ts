import {useLocation,useNavigate,type NavigateOptions,type To} from 'react-router-dom';
import {useCampaignLayout} from './CampaignLayoutContext';
export function useCampaignNavigate() {
  const navigate=useNavigate(),location=useLocation(),layout=useCampaignLayout();
  return (to:To|number,options?:NavigateOptions)=>{
    if(typeof to==='string'&&location.pathname.startsWith('/campaigns/')) {
      const tab:Record<string,string>={'/admin':'overview','/admin/settings':'settings','/admin/plan':'plan-editor','/admin/registration-rules':'rules-editor','/admin/lecturer-guide':'guide-editor','/admin/faq':'faq-editor','/plan':'plan','/lecturer-guide':'guide','/faq':'questions','/chat':'chat','/grades':'grades','/lecturer/grades':'grades','/admin/registrations':'registrations','/admin/reports':'reports','/admin/grades':'grades','/admin/final-internships':'final-internships','/admin/advisors':'assignments','/admin/advisors/requests':'assignments','/admin/advisors/quotas':'assignments'};
      if(tab[to]){const patch:Record<string,string>={tab:tab[to],enrollmentId:'',panel:'',page:'',status:''};
        if(to.startsWith('/admin/advisors'))patch.view=to.endsWith('/requests')?'requests':to.endsWith('/quotas')?'quotas':'assignments';
        if(layout)return layout.editQuery(patch,options);
        const q=new URLSearchParams(location.search);for(const [key,value]of Object.entries(patch))value?q.set(key,value):q.delete(key);
        return navigate(`${location.pathname}?${q}`,options);}
    }
    return typeof to==='number'?navigate(to):navigate(to,options);
  };
}

import {isDbQuotaError,isTransientLibsqlError} from '../db';
export function databaseProvider(){return(process.env.DB_PROVIDER||(process.env.CLOUDFLARE_API_TOKEN||process.env.CLOUDFLARE_D1_API_TOKEN?'d1':'turso')).toLowerCase();}
export function isDatabaseUnavailable(error:any){return isDbQuotaError(error)||isTransientLibsqlError(error)||/database|libsql|d1 (?:http|query|batch|executemultiple) error|sqlite/i.test(String(error?.message||error));}
export function databaseAvailability(error:unknown,at=Date.now()){
 const quota=isDbQuotaError(error),provider=databaseProvider();
 const daily=provider==='d1'&&quota&&/daily (?:row )?(?:read|write) limit/i.test(String((error as any)?.message||error));
 const next=new Date(at);next.setUTCHours(24,0,0,0);
 return{code:quota?'DB_QUOTA_EXCEEDED':'DB_CONNECTION_ERROR',database:quota?'quota_blocked':'unavailable',databaseProvider:provider,
  error:quota?'Cơ sở dữ liệu đã hết hạn mức truy vấn. Đăng nhập và truy cập dữ liệu tạm thời bị gián đoạn.':'Hệ thống tạm thời không kết nối được cơ sở dữ liệu. Vui lòng thử lại sau.',
  ...(daily?{retryAt:next.toISOString()}:{}),
 };
}

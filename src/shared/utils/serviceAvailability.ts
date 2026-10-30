export function serviceAvailability(data:any={}){
 const quota=data.code==='DB_QUOTA_EXCEEDED'||data.database==='quota_blocked'||/quota|daily (?:row )?(?:read|write) limit/i.test(String(data.error||''));
 const retry=Date.parse(data.retryAt||'');
 return{
  message:quota?'Hệ thống tạm gián đoạn do cơ sở dữ liệu đã hết hạn mức truy vấn.':'Hệ thống tạm thời không truy cập được dữ liệu.',
  details:Number.isFinite(retry)?`Có thể thử lại sau ${new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric',hour12:false}).format(retry)} (giờ Việt Nam).`:'Vui lòng thử lại sau hoặc liên hệ quản trị viên. Đăng nhập lại không khắc phục được lỗi dịch vụ này.',
 };
}

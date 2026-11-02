export function createBookingService(capacity){let id=0;return {reserve(){return {ok:true,bookingId:String(++id)}},cancel(){return false}}}

# Fixed public contract

The booking service now has a capacity limit and users may retry requests. Update `createBookingService(capacity)` so `reserve(user, requestId)` returns `{ok:true, bookingId}` for a new seat; repeating the same request ID for the same user returns the same result without taking another seat. Reject a request ID reused by another user with `{ok:false, reason:'request_conflict'}` and reject a new request when full with `{ok:false, reason:'full'}`. `cancel(bookingId)` frees a seat and returns `true` only on the first cancellation; it returns `false` for unknown or already cancelled IDs. Repeated reservation of a cancelled request returns its original booking ID and does not reactivate it. IDs need only be unique within the service instance.

Run the project tests with `node --test`. These requirements are public; facilitator checks may cover additional examples of the same behavior.

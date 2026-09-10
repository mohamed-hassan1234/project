import mongoose from 'mongoose';

// Standalone MongoDB instances (no replica set) do not support multi-document
// transactions. Local development often runs standalone Mongo, while
// production (Atlas, or a properly configured replica set) supports them.
// This helper tries a real session transaction first and transparently falls
// back to running the callback without a session if the server rejects
// transactions, so the same code works in both environments. For true
// atomicity in production, deploy MongoDB as a replica set (Atlas does this
// by default).
export async function runInTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    const notSupported =
      err?.code === 20 ||
      /Transaction numbers are only allowed on a replica set member|IllegalOperation|Transactions are not supported/i.test(
        err?.message || ''
      );
    if (!notSupported) throw err;
    return fn(null);
  } finally {
    session.endSession();
  }
}
